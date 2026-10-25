// tests/capability-app-log.test.ts —— ★★★#1225 App 能力批 1：`log` 通道判据
//
// 【判据分两层】
//   ① **桥层**：宿主有 `log` ⇒ 装配出 `log`；宿主没有 ⇒ 不提供（`useLog` 如实 unsupported）。
//      且`log()` 必须**真的把参数送到宿主**（断言 invokeHost 收到的 payload，而不是"Promise resolve 了"）。
//   ② **契约层**：`log` 在 `HOST_CAPABILITY_METHODS` 里（否则覆盖率门禁看不见它 = #1121 同族缺陷）。
//
// ★为什么不做"日志内容真的进 logcat"的单测：那需要真机。真机判据在 hosts/android 的探针里，
//   本文件只覆盖"桥 → 宿主调用"这一段（可在 Node 里确定性地判）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: Array<{ method: string; args: unknown }> = []
let hostResult: { ok: true; data: unknown } | { ok: false; reason: string; missing: boolean } = {
  ok: true,
  data: { written: true },
}

vi.mock('../packages/api/src/capability-invoke', () => ({
  invokeHost: (method: string, args?: unknown) => {
    calls.push({ method, args })
    return hostResult
  },
}))

describe('★★★App 能力批 1 · log 通道（#1225）', () => {
  beforeEach(async () => {
    calls.length = 0
    hostResult = { ok: true, data: { written: true } }
    // ★模块级队列/计数在用例间共享 ⇒ 每条先归零（否则计数断言互相污染）
    const m = await import('../packages/api/src/capability-app-log')
    m.__resetLogState()
  })

  it('① 宿主有 log ⇒ 桥提供 log，且把 (level, message, data) 真的送到宿主', async () => {
    const { createAppLog } = await import('../packages/api/src/capability-app-log')
    const bridge = createAppLog()
    expect(typeof bridge.log, '宿主可用 ⇒ 提供 log').toBe('function')
    await bridge.log!('warn', 'hello', { a: 1 })
    const call = calls.find((c) => c.method === 'log' && (c.args as { message?: string })?.message === 'hello')
    expect(call, '参数真的送到了宿主').toBeTruthy()
    expect(call!.args).toMatchObject({ level: 'warn', message: 'hello', data: { a: 1 } })
  })

  it('② 宿主缺 log（missing）⇒ 桥不提供 log（useLog 如实 unsupported，不内存兜底）', async () => {
    hostResult = { ok: false, reason: 'unknown method', missing: true }
    const { createAppLog, appLogAvailable } = await import('../packages/api/src/capability-app-log')
    expect(appLogAvailable(), '探测为不可用').toBe(false)
    // ★注意：createAppLog 的成员表是静态的（抽取器契约），装配层据 appLogAvailable 决定是否 spread
    expect(typeof createAppLog().log).toBe('function')
  })

  it('③ 宿主报"未知方法"时 log() 如实 reject（码里带 unsupported，不静默成功）', async () => {
    hostResult = { ok: false, reason: 'unknown method log', missing: true }
    const { createAppLog } = await import('../packages/api/src/capability-app-log')
    await expect(createAppLog().log!('log', 'x')).rejects.toThrow(/log\.unsupported/)
  })

  it('④ 宿主执行失败（非 missing）⇒ reject 且码是 failed（区分"没这能力"与"执行失败"）', async () => {
    hostResult = { ok: false, reason: 'boom', missing: false }
    const { createAppLog } = await import('../packages/api/src/capability-app-log')
    await expect(createAppLog().log!('error', 'x')).rejects.toThrow(/log\.failed/)
  })

  it('⑤ 契约登记：log 在 HOST_CAPABILITY_METHODS 里（否则覆盖率门禁看不见 = #1121 同族）', async () => {
    const mod = await import('../packages/render-backend/src/host-invoke-contract')
    const set = new Set<string>(
      (mod as unknown as { HOST_CAPABILITY_METHODS: readonly string[] }).HOST_CAPABILITY_METHODS,
    )
    expect(set.has('log'), 'log 已登记进宿主契约').toBe(true)
  })

  // ══════════════ ★★★#1240 四项必答（§1.0 S3）的可触发判据 ══════════════
  // ★这五条断言的是**行为**（截断后长度 / 计数变化 / 队列深度 / release 后归零），
  //   不是"源码里有这个常量"。本仓教训：`textIndent` 的丢弃分支曾被前面的通用分支吃掉
  //   ⇒ 死代码也算"有实现"（假绿）。判据必须能**被破坏**，否则等于没判。

  it('⑥ ① 上限：超长 message 按字节截断且计入 truncated（不是静默丢整条）', async () => {
    const m = await import('../packages/api/src/capability-app-log')
    const bridge = m.createAppLog()
    const huge = 'x'.repeat(m.LOG_MAX_MESSAGE_BYTES + 500)
    await bridge.log!('info', huge)
    const sent = calls.filter((c) => c.method === 'log').pop()!
    const msg = (sent.args as { message: string }).message
    expect(msg.length, '截断到上限内（含省略号）').toBeLessThanOrEqual(m.LOG_MAX_MESSAGE_BYTES)
    expect(msg.endsWith('…'), '截断留可辨识标记').toBe(true)
    expect(m.logStats().truncated, '截断被计数（可观测）').toBe(1)
    expect(m.logStats().written, '仍发出（没有整条丢弃）').toBe(1)
  })

  it('⑦ ① 上限的显式报错通道：onOverflow=throw ⇒ 抛 log.tooLarge', async () => {
    const m = await import('../packages/api/src/capability-app-log')
    const bridge = m.createAppLog({ onOverflow: 'throw' })
    await expect(bridge.log!('info', 'y'.repeat(m.LOG_MAX_MESSAGE_BYTES + 1))).rejects.toThrow(/log\.tooLarge/)
  })

  it('⑧ ② 背压：批量模式下队列超上界 ⇒ 淘汰最旧并计数 dropped', async () => {
    const m = await import('../packages/api/src/capability-app-log')
    const bridge = m.createAppLog({ autoFlush: false })
    const overflow = 5
    for (let i = 0; i < m.LOG_MAX_QUEUE + overflow; i++) await bridge.log!('info', 'm' + i)
    const st = m.logStats()
    expect(st.queued, '队列深度被上界钉住').toBe(m.LOG_MAX_QUEUE)
    expect(st.dropped, '淘汰了最旧的那几条').toBe(overflow)
    // ★"淘汰最旧"而不是"拒绝最新"：队首应是第 overflow 条（前 overflow 条被丢）
    const r = m.flushLogQueue()
    expect(r.sent, '批量 flush 一次最多 LOG_MAX_BATCH 条').toBe(m.LOG_MAX_BATCH)
    const firstSent = (calls.find((c) => c.method === 'log')!.args as { message: string }).message
    expect(firstSent, '队首是最旧保留项（前若干条已淘汰）').toBe('m' + overflow)
  })

  it('⑨ ③ 回收：队列登记进资源账本，release 后队列归零', async () => {
    const { createCapabilityResourceRegistry } = await import('../packages/api/src/capability-resources')
    const m = await import('../packages/api/src/capability-app-log')
    const registry = createCapabilityResourceRegistry({ owner: 'test' })
    const bridge = m.createAppLog({ autoFlush: false, resources: registry })
    await bridge.log!('info', 'q1')
    await bridge.log!('info', 'q2')
    expect(m.logStats().queued).toBe(2)
    expect(registry.countsByType()['log-queue'], '队列已登记为边界资源').toBe(1)
    registry.releaseAll()
    expect(m.logStats().queued, 'release ⇒ 队列清空（内存回落）').toBe(0)
    expect(registry.size(), '账本归零').toBe(0)
  })

  it('⑩ ④ 并发/淘汰：LOG_PENDING_MAX 与队列上界同值，统计读数四项齐全', async () => {
    const m = await import('../packages/api/src/capability-app-log')
    expect(m.LOG_PENDING_MAX).toBe(m.LOG_MAX_QUEUE)
    const st = m.logStats()
    expect(Object.keys(st).sort()).toEqual(['dropped', 'queued', 'truncated', 'written'])
  })
})
