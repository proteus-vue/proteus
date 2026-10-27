// tests/capability-app-phone.test.ts —— ★★★#1285 C21 `makePhoneCall`（App 桥）判据
//
// 【判据要点（不是"能调用"就算过）】
//   ① 号码白名单**逐条**验（合法形态放行 / 注入形态必须拒）——这是本能力的安全边界；
//   ② 真的走到宿主 `phone.call`，且**传的是校验后的号码**；
//   ③ 宿主拒绝时如实报错（不静默成功）；
//   ④ 宿主缺 `phone.call` ⇒ 装配层**不提供**该方法（`usePhoneCall` 才能如实 unsupported）；
//   ⑤ ★鸿蒙的"已入队"回执也算受理（`{accepted:true}`），不能当成失败、也不能报成"已拨出"。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: Array<{ method: string; args: unknown }> = []
let hostResult: { ok: true; data: unknown } | { ok: false; reason: string; missing: boolean } = { ok: true, data: {} }

vi.mock('../packages/api/src/capability-invoke', () => ({
  invokeHost: (method: string, args?: unknown) => {
    calls.push({ method, args })
    return hostResult
  },
}))

describe('★★★#1285 App 能力 C21 · makePhoneCall', () => {
  beforeEach(() => {
    calls.length = 0
    hostResult = { ok: true, data: { dispatched: true, uri: 'tel:10086' } }
  })

  it('① 合法号码形态全部放行（含 + 国际区号 / 分隔符 / 分机 / 暂停）', async () => {
    const { assertPhoneNumber } = await import('../packages/api/src/capability-app-phone')
    for (const n of [
      '10086',
      '+86 138 0013 8000',
      '+1-555-0100',
      '(010) 1234-5678',
      '10086,,1',      // 分机
      '*100#',         // USSD
      '+8613800138000',
    ]) {
      expect(assertPhoneNumber(n), `合法号码被拒：${n}`).toBe(n)
    }
  })

  it('★★② 注入形态必须全部拒绝（拼进 tel: URI 前的地雷）', async () => {
    const { assertPhoneNumber } = await import('../packages/api/src/capability-app-phone')
    const bad = [
      '',                        // 空
      '   ',                     // 全空格
      '12/34',                   // 斜杠（能改 URI path 结构）
      '12?x=1',                  // 查询串
      '12&y=2',                  // 参数分隔
      'tel:10086',               // 自带 scheme
      'javascript:alert(1)',     // 伪协议
      '12\n34',                  // 换行（日志注入 / 头注入同族）
      '１２３',                   // 全角数字（不是 0-9）
      '+',                       // 只有加号、无数字
      '-',                       // 只有分隔符
      '1'.repeat(33),            // 超长
    ]
    for (const n of bad) {
      expect(() => assertPhoneNumber(n), `非法号码被放行：${JSON.stringify(n)}`).toThrow(/phone-call\.invalid/)
    }
    // 非字符串
    expect(() => assertPhoneNumber(10086 as unknown)).toThrow(/必须是字符串/)
    expect(() => assertPhoneNumber(undefined as unknown)).toThrow(/必须是字符串/)
  })

  it('③ 真的走到宿主 phone.call，且传的是**校验后**的号码', async () => {
    const { createAppPhone } = await import('../packages/api/src/capability-app-phone')
    const b = createAppPhone()
    expect(typeof b.makePhoneCall, '桥必须提供 makePhoneCall').toBe('function')
    await b.makePhoneCall!('+86 138 0013 8000')
    expect(calls.map((c) => c.method)).toEqual(['phone.call'])
    expect((calls[0]!.args as { number: string }).number, '传给宿主的必须是校验后的号码').toBe('+86 138 0013 8000')
  })

  it('③b 非法号码**在 JS 层就被拦**，不出到宿主', async () => {
    const { createAppPhone } = await import('../packages/api/src/capability-app-phone')
    const b = createAppPhone()
    await expect(b.makePhoneCall!('12/34')).rejects.toThrow(/phone-call\.invalid/)
    expect(calls.length, '★非法号码不该到达宿主（否则宿主成为唯一防线）').toBe(0)
  })

  it('④ 宿主拒绝 ⇒ 如实报错（不静默成功）', async () => {
    const { createAppPhone } = await import('../packages/api/src/capability-app-phone')
    const b = createAppPhone()
    hostResult = { ok: false, reason: '没有可处理拨号的 Activity', missing: false }
    await expect(b.makePhoneCall!('10086')).rejects.toThrow(/phone-call\.failed/)
  })

  it('★★⑤ 宿主"已入队"回执（鸿蒙形态）也算受理，且不报成已拨出', async () => {
    const { createAppPhone } = await import('../packages/api/src/capability-app-phone')
    const b = createAppPhone()
    // 鸿蒙走动作队列 ⇒ 回执是 {accepted:true, queued:N}
    hostResult = { ok: true, data: { accepted: true, queued: 1 } }
    await expect(b.makePhoneCall!('10086')).resolves.toBeUndefined()
  })

  it('⑥ 可用性探测：宿主缺 phone.call ⇒ 不提供该方法', async () => {
    const { appPhoneCallAvailable } = await import('../packages/api/src/capability-app-phone')
    hostResult = { ok: false, reason: '未实现', missing: true }
    expect(appPhoneCallAvailable(), '★宿主缺方法时必须报不可用（否则 usePhoneCall 假可用）').toBe(false)
    hostResult = { ok: true, data: {} }
    expect(appPhoneCallAvailable()).toBe(true)
    // 宿主存在但返错（非 missing）⇒ 仍算可用（错误由调用时报出，不在装配期吞掉）
    hostResult = { ok: false, reason: '运行时错误', missing: false }
    expect(appPhoneCallAvailable()).toBe(true)
  })
})
