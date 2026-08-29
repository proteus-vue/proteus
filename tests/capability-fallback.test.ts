// tests/capability-fallback.test.ts
// ★platform-plan B4（M4 运行时降级）：缺失能力不崩溃（UnsupportedAPI）/ required 阻断 / fallback 自动生效 / 错误模型
import { describe, it, expect } from 'vitest'
import { useCapability, unsupported, unsupportedCapability, CapabilityError, clearCapabilities, registerCapability, defineCapability } from '../packages/capabilities/src'

const webAdapter = (supported = true) => ({ platform: 'web' as const, create: () => ({ isSupported: () => supported, ping: () => 'pong' }) })

describe('UnsupportedAPI（§2：缺失能力的显式包装）', () => {
  it('isSupported false + 防 await 误用（thenable 抛 CapabilityError）', () => {
    const api = unsupported('bio', 'web', '未注册') as unknown as { isSupported: () => boolean; then: () => never }
    expect(api.isSupported()).toBe(false)
    expect(() => api.then()).toThrow(CapabilityError)
    expect(() => api.then()).toThrow(/UNSUPPORTED: bio@web/)
  })

  it('unsupportedCapability：降级 Capability（meta + isSupported false）', () => {
    const cap = unsupportedCapability('bio', 'web')
    expect(cap.meta.id).toBe('bio')
    expect(cap.isSupported()).toBe(false)
  })
})

describe('useCapability 降级路径（§7 验收）', () => {
  it('缺失但非 required → 不崩溃（isSupported false，业务走 UI 分支）', () => {
    clearCapabilities()
    const cap = useCapability('ghost', 'web')
    expect(cap.isSupported()).toBe(false)
    // 业务模式：if (!cap.isSupported()) 走替代 UI——不抛
  })

  it('required 缺失 → 抛 CapabilityError 阻断流程（§4）', () => {
    clearCapabilities()
    registerCapability(defineCapability({ meta: { id: 'login.wechat', tier: 3, required: true }, adapters: { web: () => webAdapter() } }))
    expect(() => useCapability('login.wechat', 'skyline')).toThrow(/UNSUPPORTED/)
  })

  it('fallback 自动生效（§3：无命中 → fallback 能力实例）', () => {
    clearCapabilities()
    registerCapability(defineCapability({ meta: { id: 'share', tier: 2 }, adapters: { web: () => webAdapter(false) }, fallback: 'clipboard' }))
    registerCapability(defineCapability({ meta: { id: 'clipboard', tier: 2 }, adapters: { web: () => webAdapter() } }))
    // share web adapter 探测失败 → resolve 无命中 → fallback clipboard（自动切换）
    const cap = useCapability('share', 'web')
    expect(cap.isSupported()).toBe(true)
    expect(cap.meta.id).toBe('clipboard') // resolve 返回 fallback 能力实例
  })

  it('CapabilityError 结构（code/capability/platform/reason）', () => {
    const err = new CapabilityError('PERMISSION_DENIED', 'bio', 'web', '用户拒绝')
    expect(err.code).toBe('PERMISSION_DENIED')
    expect(err.capability).toBe('bio')
    expect(err.platform).toBe('web')
    expect(err.message).toContain('用户拒绝')
  })
})
