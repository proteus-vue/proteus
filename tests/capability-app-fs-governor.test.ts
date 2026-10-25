// tests/capability-app-fs-governor.test.ts
// ★★★#1236 文件系统在飞配额池的判据（§1.0 S3 的 ② 背压 / ③ 回收 / ④ 并发）。
//
// 【为什么必须单独测池，而不是只测「readFile 有上限」】
//   逐方法上限只回答「N=1 时会不会爆」；S3 的第 ④ 问是「**同时** N 个实例会怎样」。
//   本仓真问题：`unzip` 单次上限 512 MiB，10 个页面同时解压 = 5 GiB 峰值 ⇒ 必然 OOM。
//   ⇒ 判据必须能证明「**并发总和**有上界」，否则测的仍是 N=1。
//
// 【判据分三层】
//   ① 单次上限（池自己 + 调用方声明都挡）
//   ② 背压（配额不足 ⇒ 排队；前一个 release ⇒ 按序放行；等待队列满 ⇒ 显式拒绝）
//   ③ 回收（账本 releaseAll ⇒ 在飞租约作废、等待者被拒、配额归还）
import { describe, it, expect, beforeEach } from 'vitest'
import {
  FS_MAX_INFLIGHT_BYTES,
  FS_MAX_INFLIGHT_OPS,
  FS_MAX_WAITERS,
  createFsGovernor,
  fsGovernorStats,
  __resetFsGovernorStats,
} from '../packages/api/src/capability-app-fs-governor'
import { createCapabilityResourceRegistry } from '../packages/api/src/capability-resources'

beforeEach(() => {
  __resetFsGovernorStats()
})

describe('★★★#1236 文件系统在飞配额池（S3 ② 背压 / ③ 回收 / ④ 并发）', () => {
  it('① 单次超池配额 ⇒ 当场拒绝 file-system.tooLarge（不进队列）', async () => {
    const gov = createFsGovernor()
    await expect(gov.acquire('big', FS_MAX_INFLIGHT_BYTES + 1)).rejects.toThrow(/file-system\.tooLarge/)
    expect(fsGovernorStats().rejectedBusy).toBe(1)
    expect(fsGovernorStats().waiters, '不进队列').toBe(0)
  })

  it('② 背压：配额用满后再申请 ⇒ 排队（不并发放行）；release 后按序唤醒', async () => {
    const gov = createFsGovernor()
    // 占满字节配额（用 4 个操作各占 1/4）
    const quarter = FS_MAX_INFLIGHT_BYTES / 4
    const held = [
      await gov.acquire('op1', quarter),
      await gov.acquire('op2', quarter),
      await gov.acquire('op3', quarter),
      await gov.acquire('op4', quarter),
    ]
    expect(fsGovernorStats().inflightBytes, '配额恰好占满').toBe(FS_MAX_INFLIGHT_BYTES)

    // 第 5 个申请：拿不到 ⇒ 进等待队列
    let fifth: Awaited<ReturnType<typeof gov.acquire>> | null = null
    const pending = gov.acquire('op5', quarter).then((l) => { fifth = l; return l })
    // ★不 sleep：只让同步代码跑完，队列状态此刻已可断言
    expect(fsGovernorStats().waiters, '★第 5 个在排队（没有并发放行）').toBe(1)
    expect(fifth, '★还没被放行').toBeNull()

    // 释放一个 ⇒ 第 5 个被唤醒
    held[0]!.release()
    const lease5 = await pending
    expect(fifth, '★前一个 release 后被唤醒').not.toBeNull()
    expect(fsGovernorStats().waiters).toBe(0)
    expect(fsGovernorStats().waited, '记录了一次等待（背压生效的直接证据）').toBe(1)
    lease5.release()
    for (let i = 1; i < held.length; i++) held[i]!.release()
    expect(fsGovernorStats().inflightBytes, '全部释放后归零').toBe(0)
  })

  it('③ 并发操作数上界：小字节但数量超 FS_MAX_INFLIGHT_OPS ⇒ 排到第 N+1 个', async () => {
    const gov = createFsGovernor()
    const held: Array<{ release(): void }> = []
    for (let i = 0; i < FS_MAX_INFLIGHT_OPS; i++) held.push(await gov.acquire('op' + i, 1))
    expect(fsGovernorStats().inflightOps).toBe(FS_MAX_INFLIGHT_OPS)
    let got = false
    const pending = gov.acquire('overflow', 1).then((l) => { got = true; return l })
    expect(fsGovernorStats().waiters, '★数量上界同样生效（不只是字节）').toBe(1)
    expect(got).toBe(false)
    held[0]!.release()
    const l = await pending
    expect(got).toBe(true)
    l.release()
    for (let i = 1; i < held.length; i++) held[i]!.release()
  })

  it('④ 等待队列有界：超过 FS_MAX_WAITERS ⇒ 显式拒绝 file-system.busy（不无界堆积）', async () => {
    const gov = createFsGovernor()
    // 用 1 个操作吃满全部字节配额 ⇒ 后续全部排队
    const hog = await gov.acquire('hog', FS_MAX_INFLIGHT_BYTES)
    // ★每个等待者拿到租约就立刻释放 ⇒ 队列能自然排空
    //   （FS_MAX_WAITERS(32) > FS_MAX_INFLIGHT_OPS(16)：只放行不释放会留下 16 个永久排队）
    const pendings: Array<Promise<unknown>> = []
    for (let i = 0; i < FS_MAX_WAITERS; i++) {
      pendings.push(gov.acquire('w' + i, 1).then((l) => { l.release() }).catch(() => null))
    }
    expect(fsGovernorStats().waiters).toBe(FS_MAX_WAITERS)
    // 第 MAX+1 个：队列满 ⇒ 拒绝
    await expect(gov.acquire('overflow', 1)).rejects.toThrow(/file-system\.busy/)
    expect(fsGovernorStats().rejectedBusy).toBe(1)
    // 收尾：释放后所有等待者都能拿到（否则会留下悬挂 Promise）
    hog.release()
    await Promise.all(pendings)
  })

  it('⑤ ③ 回收：账本 releaseAll ⇒ 在飞租约作废 + 等待者被拒 + 配额归还', async () => {
    const registry = createCapabilityResourceRegistry({ owner: 'test' })
    const gov = createFsGovernor({ resources: registry })
    const a = await gov.acquire('opA', FS_MAX_INFLIGHT_BYTES)          // 吃满
    const waiting = gov.acquire('opB', 1)                              // 排队
    expect(registry.countsByType()['fs-op'], '每个租约都登记为边界资源').toBe(1)
    expect(registry.countsByType()['fs-governor'], '池自身也登记（releaseAll 才能作废排队者）').toBe(1)
    expect(fsGovernorStats().waiters).toBe(1)

    registry.releaseAll()

    expect(a.cancelled, '★在飞租约被作废（调用方据此丢弃结果）').toBe(true)
    await expect(waiting, '★排队中的被拒（不永久挂住）').rejects.toThrow(/file-system\.busy/)
    expect(registry.size(), '账本归零').toBe(0)
    a.release()
    expect(fsGovernorStats().inflightBytes, '配额归还（否则池会永久漏）').toBe(0)
    expect(fsGovernorStats().inflightOps).toBe(0)
  })

  it('⑥ ④ 同步面不排队：拿不到配额 ⇒ 当场抛 file-system.busy（排队=死锁）', async () => {
    const gov = createFsGovernor()
    const hog = await gov.acquire('hog', FS_MAX_INFLIGHT_BYTES)
    expect(() => gov.tryAcquire('sync', 1), '★同步面必须当场拒绝').toThrow(/file-system\.busy/)
    hog.release()
    const ok = gov.tryAcquire('sync', 1)
    expect(ok.cancelled).toBe(false)
    ok.release()
  })

  it('⑦ 读数：peakOps/peakBytes 真被逼近过（证明配额不是"写了不生效"）', async () => {
    const gov = createFsGovernor()
    const half = FS_MAX_INFLIGHT_BYTES / 2
    const a = await gov.acquire('a', half)
    const b = await gov.acquire('b', half)
    const st = fsGovernorStats()
    expect(st.peakBytes, '峰值字节达到满配额').toBe(FS_MAX_INFLIGHT_BYTES)
    expect(st.peakOps).toBe(2)
    a.release(); b.release()
    expect(fsGovernorStats().inflightBytes, '释放后当前值归零（峰值保留）').toBe(0)
    expect(fsGovernorStats().peakBytes, '峰值是历史值，不随释放回落').toBe(FS_MAX_INFLIGHT_BYTES)
  })

  it('⑩ 装配点透传账本：页面 scope 的账本能作废在飞文件操作（否则池无账本=回收维度空转）', async () => {
    // ★这条守的是**接线**：工厂支持 resources 参数 ≠ 装配点真的传了。
    //   本仓同族教训：savePath 分支写了但没被调用（#1119 破坏性验证第 1 条）。
    const { createCapabilityResourceRegistry } = await import('../packages/api/src/capability-resources')
    const { createAppFileSystem } = await import('../packages/api/src/capability-app-filesystem')
    const registry = createCapabilityResourceRegistry({ owner: 'page' })
    const bridge = createAppFileSystem({ resources: registry })
    // 有账本时**池自身**会立即登记一条 fs-governor（不依赖宿主是否可用）
    expect(registry.countsByType()['fs-governor'], '★传了 resources ⇒ 池级登记存在').toBe(1)
    void bridge
    registry.releaseAll()
    expect(registry.size(), '释放后归零').toBe(0)
  })

  it('⑪ 装配点必须真的透传账本（静态断言"被调用"，不只是"工厂支持该参数"）', async () => {
    // ★#1119 的教训：断言"函数/分支存在"等于没断言，必须断言**真的被调用**。
    //   ⑩ 测的是工厂支持 resources；本条测的是 **createAppCapabilities 真的把它传下去**。
    //   少了这一条：装配点删掉 resOpts ⇒ 池退化成进程默认池（无账本）⇒ 页面 dispose 作废不了在飞操作，
    //   而 ⑩ 仍然全绿（它自己直接传了 resources）。
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const src = fs.readFileSync(path.join(root, 'packages/api/src/capability-app-device.ts'), 'utf8')
    expect(src, '★createAppCapabilities 必须把 resOpts 传给 createAppFileSystem').toMatch(
      /createAppFileSystem\(\s*resOpts\s*\)/,
    )
  })
})
