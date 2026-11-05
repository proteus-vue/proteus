// tests/capability-app-permission.test.ts —— ★★★C16 `getPermission`（App 桥）判据
//
// 【判据要点（不是"能调用"就算过）】
//   ① 权限名归一：三端同一集（camera/microphone/geolocation）+ 小程序 scope 写法都认；
//      未知名字**直接报错**（不返回 denied、不静默当 prompt——把"框架不认识"伪装成
//      "系统拒绝"会让业务永远查不出问题）；
//   ② 真的走到宿主 `permission.check`，且传的是**归一后的 scope**（不是调用方原样字符串）；
//   ③ 宿主拒绝时如实报错（不静默成功）；
//   ④ 宿主缺 `permission.check` ⇒ 装配层**不提供**该方法（`usePermission` 才能如实 unsupported）；
//   ⑤ ★宿主回执的 state 必须是 granted/denied 之一：拼错的值（如 'grant'）不得透给业务；
//   ⑥ ★回显的 `permission` 是**调用方原始名字**（与 Web 侧一致），不是内部规范名。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: Array<{ method: string; args: unknown }> = []
let hostResult:
  | { ok: true; data: unknown }
  | { ok: false; reason: string; missing: boolean } = { ok: true, data: { state: 'granted' } }

vi.mock('../packages/api/src/capability-invoke', () => ({
  invokeHost: (method: string, args?: unknown) => {
    calls.push({ method, args })
    return hostResult
  },
}))

describe('★★★C16 App 能力 · getPermission（只查不申请）', () => {
  beforeEach(() => {
    calls.length = 0
    hostResult = { ok: true, data: { scope: 'camera', state: 'granted', declared: true } }
  })

  it('① 三端同一集 + 小程序 scope 写法都能归一', async () => {
    const { normalizePermissionScope } = await import('../packages/api/src/capability-app-permission')
    // 规范名
    expect(normalizePermissionScope('camera')).toBe('camera')
    expect(normalizePermissionScope('microphone')).toBe('microphone')
    expect(normalizePermissionScope('geolocation')).toBe('geolocation')
    // 小程序 scope 写法（同一行业务代码三端共用的常见形态）
    expect(normalizePermissionScope('scope.camera')).toBe('camera')
    expect(normalizePermissionScope('scope.record')).toBe('microphone')
    expect(normalizePermissionScope('scope.userLocation')).toBe('geolocation')
    // 两侧空白不算"另一个名字"
    expect(normalizePermissionScope('  camera  ')).toBe('camera')
  })

  it('★★② 未知/非法权限名必须全部拒绝（不伪装成 denied）', async () => {
    const { normalizePermissionScope } = await import('../packages/api/src/capability-app-permission')
    const bad = [
      '',                 // 空
      '   ',              // 全空白
      'notifications',    // 首批不支持（iOS 只有异步 API ⇒ 单独后续项）
      'scope.bluetooth',  // 不在支持集
      'CAMERA',           // 大小写敏感（不做模糊匹配）
      'camera ',          // ★注意：末尾空格会被 trim ⇒ 这条其实合法，下面用断言说明
    ]
    for (const n of bad) {
      if (n === 'camera ') {
        // ★这条**故意**列在 bad 里再反转：trim 后应通过——防止"顺手把 trim 去掉"时静默改语义
        expect(normalizePermissionScope(n)).toBe('camera')
        continue
      }
      expect(() => normalizePermissionScope(n), `非法权限名被放行：${JSON.stringify(n)}`).toThrow(
        /permission\.invalid/,
      )
    }
    // 非字符串
    expect(() => normalizePermissionScope(42)).toThrow(/permission\.invalid/)
    expect(() => normalizePermissionScope(null)).toThrow(/permission\.invalid/)
  })

  it('③ 真的走到宿主 permission.check，且传的是归一后的 scope', async () => {
    const { createAppPermission } = await import('../packages/api/src/capability-app-permission')
    const bridge = createAppPermission()
    const r = await bridge.getPermission!('scope.record')
    expect(r).toEqual({ permission: 'scope.record', state: 'granted' }) // ★回显原始名字
    const hit = calls.find((c) => c.method === 'permission.check')
    expect(hit, '没有派发到 permission.check').toBeTruthy()
    expect(hit!.args).toEqual({ scope: 'microphone' }) // ★宿主拿到的是规范名
  })

  it('④ 宿主拒绝 ⇒ 如实报错（不静默成功）', async () => {
    const { createAppPermission } = await import('../packages/api/src/capability-app-permission')
    hostResult = { ok: false, reason: 'boom', missing: false }
    await expect(createAppPermission().getPermission!('camera')).rejects.toThrow(/permission\.failed/)
    // missing 与 failed 必须分档（前者是"本端不支持"，后者是"真的出错了"）
    hostResult = { ok: false, reason: 'no such method', missing: true }
    await expect(createAppPermission().getPermission!('camera')).rejects.toThrow(/permission\.unsupported/)
  })

  it('★★⑤ 宿主回执 state 非法 ⇒ 报错，不透给业务', async () => {
    const { createAppPermission } = await import('../packages/api/src/capability-app-permission')
    for (const bad of ['grant', 'denied ', 'GRANTED', '', null, 1, undefined]) {
      hostResult = { ok: true, data: { state: bad } }
      await expect(
        createAppPermission().getPermission!('camera'),
        `非法 state 被放行：${JSON.stringify(bad)}`,
      ).rejects.toThrow(/permission\.failed/)
    }
  })

  it('⑥ 非法权限名 ⇒ rejected Promise（不是同步 throw）', async () => {
    const { createAppPermission } = await import('../packages/api/src/capability-app-permission')
    const bridge = createAppPermission()
    // ★签名是 Promise ⇒ 必须 rejection。同步 throw 会绕过调用方的 .catch()/Result 包装。
    let caught: unknown = null
    try {
      const p = bridge.getPermission!('nope')
      expect(p, '非法权限名应返回 Promise').toBeInstanceOf(Promise)
      await p
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect(String(caught)).toMatch(/permission\.invalid/)
    // ★且**不应**派发到宿主（快速失败，别把明显非法的请求送进原生层）
    expect(calls.filter((c) => c.method === 'permission.check' && (c.args as { probe?: boolean }).probe).every(() => true)).toBe(true)
    expect(calls.filter((c) => c.method === 'permission.check' && !(c.args as { probe?: boolean })?.probe)).toHaveLength(0)
  })

  it('⑦ 可用性探测：宿主有方法 ⇒ true；missing ⇒ false', async () => {
    const { appPermissionAvailable } = await import('../packages/api/src/capability-app-permission')
    hostResult = { ok: false, reason: 'no such method', missing: false } // probe 成功但业务失败也算"方法在"
    expect(appPermissionAvailable()).toBe(true)
    hostResult = { ok: false, reason: 'no such method', missing: true }
    expect(appPermissionAvailable()).toBe(false)
  })

  it('⑧ 装配层：宿主缺 permission.check ⇒ 桥里没有 getPermission（usePermission 才能如实 unsupported）', async () => {
    hostResult = { ok: false, reason: 'no such method', missing: true }
    const { createAppCapabilities } = await import('../packages/api/src/capability-app-device')
    class E extends Error {}
    const caps = createAppCapabilities(E as never) as Record<string, unknown>
    expect(caps.getPermission, '宿主缺方法时不应提供 getPermission（否则会假成功）').toBeUndefined()

    calls.length = 0
    hostResult = { ok: true, data: { state: 'denied' } }
    const caps2 = createAppCapabilities(E as never) as Record<string, unknown>
    expect(typeof caps2.getPermission).toBe('function')
  })
})
