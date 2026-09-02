// tests/router-engineering.test.ts
// ★G-32 B5 续（proteus-semantic-primitives-plus-plan §8 ⑥）：E10-E17 路由语义化——注入式 createRouterEngineering
//   验证点：useRoute 响应式读取（注入 getCurrentRoute 源）· E11-E15 导航语义委托（push/replace/back/switchTab/reLaunch）·
//   E16/E17 守卫注册（beforeEach/afterEach 委托既有 router）
import { describe, it, expect, vi } from 'vitest'
import { createRouterEngineering } from '@proteus-vue/api'
import type { Reactivity, RouterLike, RouterTargetOptions } from '@proteus-vue/api'

/** 简单 reactivity mock（ref：{value} 可写；computed/watch 静态）——与 engineering.test 同构 */
function mockReactivity(): Reactivity {
  return {
    ref: <T>(initial: T) => {
      let v = initial
      return {
        get value() {
          return v
        },
        set value(nv: T) {
          v = nv
        },
      }
    },
    computed: <T>(getter: () => T) => ({ value: getter() }),
    watch: <T>(getter: () => T, cb: (v: T, o: T) => void) => {
      void getter
      void cb
      return () => undefined
    },
  }
}

/** 记录调用的 mock router（RouterLike 结构） */
function mockRouter() {
  const calls: Array<{ method: string; arg?: unknown }> = []
  const router: RouterLike = {
    push: async (options) => {
      calls.push({ method: 'push', arg: options })
    },
    back: (delta) => {
      calls.push({ method: 'back', arg: delta })
    },
    beforeEach: (guard) => {
      calls.push({ method: 'beforeEach', arg: guard })
    },
    afterEach: (guard) => {
      calls.push({ method: 'afterEach', arg: guard })
    },
  }
  return { router, calls }
}

describe('G-32 B5 续 路由语义化（E10-E17）', () => {
  it('E10 useRoute：响应式当前路由（getCurrentRoute 源注入；可写更新）', () => {
    let current = { path: '/pages/index', name: 'index' }
    const eng = createRouterEngineering({
      router: mockRouter().router,
      reactivity: mockReactivity(),
      getCurrentRoute: () => current,
    })
    const route = eng.useRoute()
    expect(route.value).toMatchObject({ path: '/pages/index', name: 'index' })
    // 外部更新当前路由源 → ref 仍持有旧值（ref 一次性初始化——语义保持；真实场景由 reactive 驱动）
    current = { path: '/pages/user', name: 'user' }
    expect(route.value).toMatchObject({ path: '/pages/index' })
    // 直接写 ref（模拟路由完成后更新）→ 读新值
    route.value = { path: '/pages/user', name: 'user' }
    expect(route.value).toMatchObject({ path: '/pages/user', name: 'user' })
  })

  it('E11-E15 导航语义委托（push/replace/back/switchTab/reLaunch → 对应 router 调用）', async () => {
    const { router, calls } = mockRouter()
    const eng = createRouterEngineering({ router, reactivity: mockReactivity() })
    const target: RouterTargetOptions = { name: 'user', params: { id: '42' } }
    await eng.push(target)
    await eng.replace(target)
    eng.back(1)
    await eng.switchTab({ name: 'mine' })
    await eng.reLaunch({ path: '/pages/entry' })
    expect(calls).toEqual([
      { method: 'push', arg: target },
      { method: 'push', arg: { ...target, replace: true } },
      { method: 'back', arg: 1 },
      { method: 'push', arg: { name: 'mine', switchTab: true } },
      { method: 'push', arg: { path: '/pages/entry', reLaunch: true } },
    ])
  })

  it('E16/E17 守卫注册委托（beforeEach/afterEach——缺省时安全 no-op）', () => {
    const { router, calls } = mockRouter()
    const eng = createRouterEngineering({ router, reactivity: mockReactivity() })
    const beforeGuard = vi.fn((to: RouterTargetOptions) => {
      void to
      return true
    })
    const afterGuard = vi.fn((to: RouterTargetOptions) => {
      void to
    })
    eng.beforeEach(beforeGuard)
    eng.afterEach(afterGuard)
    // 守卫已注册到 router（调用记录中 guard 函数存在）
    expect(calls.some((c) => c.method === 'beforeEach')).toBe(true)
    expect(calls.some((c) => c.method === 'afterEach')).toBe(true)
    // 缺守卫能力（无 beforeEach/afterEach 的 router）→ 注册安全 no-op
    const bare: RouterLike = { push: async () => undefined, back: () => undefined }
    const bareEng = createRouterEngineering({ router: bare, reactivity: mockReactivity() })
    expect(() => bareEng.beforeEach(beforeGuard)).not.toThrow()
    expect(() => bareEng.afterEach(afterGuard)).not.toThrow()
  })
})