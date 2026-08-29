// tests/adapter-registry.test.ts
// ★platform-plan B2（M2 Adapter Registry）：defineAdapter + CapabilityRegistry（优先级/平台过滤/isSupported 探测/fallback）+ 多实例隔离
import { describe, it, expect } from 'vitest'
import { defineAdapter, CapabilityRegistry, registerAdapter, resolveCapability, useCapability, clearCapabilities } from '../packages/capabilities/src'

const adapter = (capability: string, platform: 'web' | 'skyline', opts: { priority?: number; supported?: boolean } = {}) =>
  defineAdapter({
    capability,
    platform,
    priority: opts.priority,
    isSupported: () => opts.supported ?? true,
    create: () => ({ isSupported: () => opts.supported ?? true, tag: `${capability}:${platform}` }),
  })

describe('defineAdapter / 校验', () => {
  it('合法 adapter → 通过；缺失字段 → 报错', () => {
    expect(adapter('share', 'web').capability).toBe('share')
    expect(() => defineAdapter({ capability: 'x', platform: 'ios', isSupported: () => true, create: () => ({ isSupported: () => true }) } as never)).toThrow(/platform/)
    expect(() => defineAdapter({ capability: 'x', platform: 'web', create: () => ({ isSupported: () => true }) } as never)).toThrow(/isSupported/)
  })

  it('同 capability+platform 重复注册 → 报错（编译期约束）；registerAdapter 幂等跳过', () => {
    const reg = new CapabilityRegistry()
    reg.register(adapter('a', 'web'))
    expect(() => reg.register(adapter('a', 'web'))).toThrow(/重复注册/)
    reg.registerIdempotent(adapter('a', 'web')) // 幂等不抛
    expect(reg.entries().length).toBe(1)
  })
})

describe('CapabilityRegistry：选择策略', () => {
  it('platform 过滤 + isSupported 探测 + priority 降序（entries）', async () => {
    const reg = new CapabilityRegistry()
    reg.register(adapter('pay', 'web', { priority: 5, supported: false })) // 高优先级但探测失败
    reg.register(adapter('pay', 'skyline', { priority: 1 })) // 不同平台不受唯一约束
    expect(await reg.resolve('pay', 'web')).toBeUndefined() // web adapter 探测失败 → 无命中（skyline 平台不匹配）
    const cap = await reg.resolve('pay', 'skyline')
    expect((cap?.api as unknown as { tag: string }).tag).toBe('pay:skyline')
    // priority 降序（entries 展示；同 id+platform 唯一约束下 priority 为多实现预留）
    expect(reg.entries().map((e) => e.priority)).toEqual([5, 1])
  })

  it('异步 isSupported 探测（resolve 完整版）', async () => {
    const reg = new CapabilityRegistry()
    reg.register({
      capability: 'bio',
      platform: 'web',
      isSupported: async () => true,
      create: () => ({ isSupported: () => true }),
    })
    const cap = await reg.resolve('bio', 'web')
    expect(cap).toBeDefined()
  })

  it('无命中 → fallback 递归（返回 fallback 能力实例）；命中 → fallback 属性引用', async () => {
    const reg = new CapabilityRegistry()
    reg.register(adapter('share', 'web', { supported: false }))
    reg.register(adapter('clipboard', 'web'))
    reg.registerFallback('share', 'clipboard')
    // 无命中 → resolve 返回 fallback 能力实例（id = fallback）
    const cap = await reg.resolve('share', 'web')
    expect(cap?.meta.id).toBe('clipboard')
    // 命中 → cap.fallback 属性引用降级能力
    reg.register(adapter('share2', 'web'))
    reg.registerFallback('share2', 'clipboard')
    const cap2 = await reg.resolve('share2', 'web')
    expect(cap2?.meta.id).toBe('share2')
    expect(cap2?.fallback?.meta.id).toBe('clipboard')
    // fallback 不存在 → undefined
    reg.registerFallback('ghost', 'nope')
    expect(await reg.resolve('ghost', 'web')).toBeUndefined()
  })

  it('validate：fallback 引用未注册 → 编译期约束问题', () => {
    const reg = new CapabilityRegistry()
    reg.register(adapter('a', 'web'))
    reg.registerFallback('a', 'missing')
    const issues = reg.validate()
    expect(issues.some((i) => i.field === 'a.fallback' && i.message.includes('未注册'))).toBe(true)
  })

  it('多实例隔离：独立 registry 互不影响', () => {
    const reg1 = new CapabilityRegistry()
    const reg2 = new CapabilityRegistry()
    reg1.register(adapter('a', 'web'))
    expect(reg1.has('a')).toBe(true)
    expect(reg2.has('a')).toBe(false)
  })
})

describe('全局注册中心（B1 兼容 + B2）', () => {
  it('registerAdapter + useCapability / resolveCapability', async () => {
    clearCapabilities()
    registerAdapter(adapter('share', 'web'))
    const cap = useCapability('share', 'web')
    expect((cap.api as unknown as { tag: string }).tag).toBe('share:web')
    clearCapabilities()
    // ★B4：清除后缺失 → unsupported 降级（isSupported false，不崩溃）
    expect(useCapability('share', 'web').isSupported()).toBe(false)
  })

  it('resolveCapability（异步完整解析）', async () => {
    clearCapabilities()
    registerAdapter(adapter('bio', 'web', { supported: true }))
    const cap = await resolveCapability('bio', 'web')
    expect(cap).toBeDefined()
    clearCapabilities()
  })
})
