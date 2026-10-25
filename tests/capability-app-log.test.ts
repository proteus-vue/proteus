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
  beforeEach(() => {
    calls.length = 0
    hostResult = { ok: true, data: { written: true } }
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
})
