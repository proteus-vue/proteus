// tests/fetch-request-ledger.test.ts
// ★★★#1243 `fetch` 的**回收**维度（§1.0 S3 的最后一块）：在飞请求登记账本 + 页面退出时真取消。
//
// 【为什么这条判据必须有（fetch 此前唯一缺口）】
//   `fetch` 的上限/显式报错/流式/背压/并发五项都已有证据，唯独**回收**没有：
//   页面卸载时在飞的请求**没人取消** ⇒ 传输继续跑、内存继续涨、结果无人消费。
//   `useFetchTask().abort()` 要业务自己记得调——**默认路径没人兜**（违反 G-43.4）。
//
// 【判据口径（三层，重点是"真的调了 abort"而不是"账本有条目"）】
//   ① 登记：每次 fetchTask 都在账本里留一条 `http-request`
//   ② 销账：正常完成 ⇒ 条目消失（否则账本把已完成请求当泄漏）
//   ③ **真取消**：账本 release ⇒ 该请求的 abort 被真的触发（断言**信号**，不是断言条目消失）
//      ★这是 #1119 的教训：断言"函数/符号存在"等于没断言。
import { describe, it, expect } from 'vitest'
import { createFetchPipeline } from '../packages/api/src/capability-fetch-pipeline'
import { createCapabilityResourceRegistry } from '../packages/api/src/capability-resources'

/** 最小桥桩：`request` 挂起，直到测试主动 resolve（模拟"在飞的请求"） */
function makeBridge() {
  const pending: Array<{ url: string; signal?: { aborted?: boolean; onabort?: () => void }; resolve: (v: unknown) => void }> = []
  // ★管线调用形态是 `bridge.request(config)`（单参数，url 在 config 里）——见 PipelineBridge
  const bridge = {
    request: (config: Record<string, unknown>) => {
      return new Promise((resolve) => {
        pending.push({
          url: String(config.url ?? ''),
          signal: config.signal as { aborted?: boolean; onabort?: () => void } | undefined,
          resolve: (v: unknown) => resolve(v),
        })
      })
    },
  }
  return { bridge, pending }
}

describe('★★★#1243 fetch 在飞请求的账本与回收', () => {
  it('① 登记：fetchTask 会在账本里留一条 http-request', async () => {
    const { bridge } = makeBridge()
    const registry = createCapabilityResourceRegistry({ owner: 'page' })
    const pipe = createFetchPipeline(bridge as never, { resources: registry, concurrency: 10 })
    const t = pipe.fetchTask('https://a.test/x')
    // 排到调度器（微任务）
    await Promise.resolve()
    expect(registry.countsByType()['http-request'], '★在飞请求已登记为边界资源').toBe(1)
    void t
    registry.releaseAll()
  })

  it('② 销账：请求正常完成 ⇒ 账本条目消失（不把已完成请求当泄漏）', async () => {
    const { bridge, pending } = makeBridge()
    const registry = createCapabilityResourceRegistry({ owner: 'page' })
    const pipe = createFetchPipeline(bridge as never, { resources: registry, concurrency: 10 })
    const t = pipe.fetchTask('https://a.test/ok')
    await Promise.resolve()
    expect(registry.size(), '在飞时 1 条').toBe(1)
    pending[0]!.resolve({ ok: true, status: 200, data: 'done' })
    await t.result
    expect(registry.size(), '★完成即销账').toBe(0)
  })

  it('③ 真取消：账本 releaseAll ⇒ 在飞请求的 abort 信号被真的置位并通知下游', async () => {
    const { bridge, pending } = makeBridge()
    const registry = createCapabilityResourceRegistry({ owner: 'page' })
    const pipe = createFetchPipeline(bridge as never, { resources: registry, concurrency: 10 })
    const t = pipe.fetchTask('https://a.test/slow')
    await Promise.resolve()
    const sig = pending[0]?.signal
    expect(sig, '下游收到了取消信号').toBeTruthy()
    expect(sig!.aborted, '请求还没被取消').toBe(false)

    registry.releaseAll()

    // ★断言**信号真的被置位**（这证明 release 调的是 abort，不是只销账）
    expect(sig!.aborted, '★账本 release ⇒ 请求的 signal.aborted 必须为 true').toBe(true)
    const r = await t.result
    expect(r.ok, '结果如实失败').toBe(false)
    if (!r.ok) expect(r.error.code).toBe('fetch.aborted')
  })

  it('④ 不传账本 ⇒ 零行为变化（默认路径不受影响）', async () => {
    const { bridge, pending } = makeBridge()
    const pipe = createFetchPipeline(bridge as never, { concurrency: 10 })
    const t = pipe.fetchTask('https://a.test/noledger')
    await Promise.resolve()
    pending[0]!.resolve({ ok: true, status: 200, data: 'x' })
    const r = await t.result
    expect(r.ok).toBe(true)
  })

  it('⑤ 去重命中：共享结果的任务不占账本（没有自己的传输就不能登记）', async () => {
    const { bridge, pending } = makeBridge()
    const registry = createCapabilityResourceRegistry({ owner: 'page' })
    const pipe = createFetchPipeline(bridge as never, { resources: registry, concurrency: 10, dedupe: true })
    const a = pipe.fetchTask('https://a.test/same')
    const b = pipe.fetchTask('https://a.test/same')
    await Promise.resolve()
    // ★只应有 1 条：b 复用 a 的传输
    expect(registry.countsByType()['http-request'], '★去重命中不重复登记').toBe(1)
    pending[0]!.resolve({ ok: true, status: 200, data: 'z' })
    await Promise.all([a.result, b.result])
    expect(registry.size(), '两者结束 ⇒ 全部销账').toBe(0)
  })
})
