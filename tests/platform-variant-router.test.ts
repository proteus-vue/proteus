// tests/platform-variant-router.test.ts
// ★平台变体·路由层回归锁（2026-09-13，第 2/4 层）：
//   ① 路由表 component 写**基准路径**，两端各自解析变体（resolveVariantComponentKey）；
//   ② platforms 白名单门控：非本平台路由不生效（routeAppliesToPlatform）。
import { describe, it, expect } from 'vitest'
import { resolveVariantComponentKey, routeAppliesToPlatform } from '../packages/router/src/variant'

describe('★第 2 层：Web 组件路径变体解析', () => {
  const keys = [
    '../pages/login.vue',
    '../pages/login.web.vue',
    '../pages/only-mp.mp.vue',
    '../pages/shared.vue',
  ]

  it('本平台变体优先（base + base.web 共存 → 选 .web）', () => {
    expect(resolveVariantComponentKey(keys, '../pages/login.vue', 'web')).toBe('../pages/login.web.vue')
  })

  it('无变体 → 基准', () => {
    expect(resolveVariantComponentKey(keys, '../pages/shared.vue', 'web')).toBe('../pages/shared.vue')
  })

  it('仅他端变体 → undefined（不误用 MP 变体）', () => {
    expect(resolveVariantComponentKey(['../pages/only-mp.mp.vue'], '../pages/only-mp.vue', 'web')).toBeUndefined()
    expect(resolveVariantComponentKey(['../pages/only-mp.mp.vue'], '../pages/only-mp.vue', 'mp')).toBe('../pages/only-mp.mp.vue')
  })

  it('基准不存在且无本平台变体 → undefined', () => {
    expect(resolveVariantComponentKey([], '../pages/x.vue', 'web')).toBeUndefined()
  })
})

describe('★第 4 层：路由平台门控', () => {
  it('无声明 → 全平台', () => {
    expect(routeAppliesToPlatform({}, 'web')).toBe(true)
    expect(routeAppliesToPlatform({}, 'mp')).toBe(true)
  })

  it('webOnly → 仅 web', () => {
    expect(routeAppliesToPlatform({ webOnly: true }, 'web')).toBe(true)
    expect(routeAppliesToPlatform({ webOnly: true }, 'mp')).toBe(false)
  })

  it('platforms 白名单', () => {
    expect(routeAppliesToPlatform({ platforms: ['mp'] }, 'mp')).toBe(true)
    expect(routeAppliesToPlatform({ platforms: ['mp'] }, 'web')).toBe(false)
    expect(routeAppliesToPlatform({ platforms: ['web', 'mp'] }, 'web')).toBe(true)
    expect(routeAppliesToPlatform({ platforms: ['native'] }, 'mp')).toBe(false)
  })

  it('别名归一：skyline→mp、app→native', () => {
    expect(routeAppliesToPlatform({ platforms: ['skyline'] }, 'mp')).toBe(true)
    expect(routeAppliesToPlatform({ platforms: ['skyline'] }, 'web')).toBe(false)
    expect(routeAppliesToPlatform({ platforms: ['app'] }, 'native')).toBe(true)
  })
})
