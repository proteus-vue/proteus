// packages/api/src/router-engineering.ts
// ★G-32 B5 续（proteus-semantic-primitives-plus-plan §8 ⑥）：E10-E17 路由语义化——对接既有 `@proteus-vue/router`
//   设计：工程原语 = 语义面（不绑死实现）——消费方注入兼容 router 实例（@proteus-vue/router 的 createRouter 产物或 mock）
//   E10 useRoute（响应式当前路由）/ E11 push / E12 replace / E13 back / E14 switchTab / E15 reLaunch / E16 beforeEach / E17 afterEach
//   MP 产物安全（决策 #32/#36）：无 ?. / ??；无数组解构
import type { Reactivity } from './engineering'

/** 路由目标（E11-E15 导航入参） */
export interface RouterTargetOptions {
  name?: string
  path?: string
  query?: Record<string, string>
  params?: Record<string, unknown>
  /** 转场类型（保留——web 端由 adapter 用于 CSS 转场） */
  routeType?: string
}

/** 兼容 Router 接口（@proteus-vue/router RouterInstance 的结构子集；mock 注入可单测） */
export interface RouterLike {
  /** 命名/路径跳转（switchTab/replace/reLaunch 为语义标志——router.push 内部处理） */
  push(options: RouterTargetOptions & { switchTab?: boolean; replace?: boolean; reLaunch?: boolean }): Promise<void>
  /** 后退 delta 层 */
  back(delta?: number): void
  /** 前置守卫（返回 false 取消导航） */
  beforeEach?(guard: (to: RouterTargetOptions, from: RouterTargetOptions) => boolean | Promise<boolean>): void
  /** 后置守卫 */
  afterEach?(guard: (to: RouterTargetOptions, from: RouterTargetOptions) => void): void
}

/** 当前路由读取结果（E10 useRoute） */
export interface CurrentRoute {
  path: string
  name?: string
  query?: Record<string, string>
  params?: Record<string, unknown>
}

/** createRouterEngineering 注入项 */
export interface RouterEngineeringOptions {
  /** 兼容 router 实例（@proteus-vue/router createRouter 产物被允许；mock 注入可单测） */
  router: RouterLike
  /** reactivity（注入——与 createEngineering 同族） */
  reactivity: Reactivity
  /** 当前路由读取源（缺省 undefined——useRoute 返回 undefined 直到有实际导航） */
  getCurrentRoute?: () => CurrentRoute | undefined
}

/** G-32 §8 ⑥ 路由语义化（E10-E17） */
export interface RouterEngineering {
  /** E10 useRoute：响应式当前路由（注入 getCurrentRoute 源） */
  useRoute(): { value: CurrentRoute | undefined }
  /** E11 router.push：命名/路径跳转 */
  push(options: RouterTargetOptions): Promise<void>
  /** E12 router.replace：替换当前页 */
  replace(options: RouterTargetOptions): Promise<void>
  /** E13 router.back：后退 */
  back(delta?: number): void
  /** E14 router.switchTab：切 Tab 页 */
  switchTab(options: RouterTargetOptions): Promise<void>
  /** E15 router.reLaunch：重启到某页 */
  reLaunch(options: RouterTargetOptions): Promise<void>
  /** E16 router.beforeEach：注册前置守卫 */
  beforeEach(guard: (to: RouterTargetOptions, from: RouterTargetOptions) => boolean | Promise<boolean>): void
  /** E17 router.afterEach：注册后置守卫 */
  afterEach(guard: (to: RouterTargetOptions, from: RouterTargetOptions) => void): void
}

/**
 * ★createRouterEngineering：路由语义化实例（注入式——router + reactivity + 当前路由源）
 * 用法：const rx = createRouterEngineering({ router, reactivity: { ref, computed, watch }, getCurrentRoute: () => currentPage })
 * 设计：E11-E17 为既有 router 的语义包装（不改 router 包）；E10 useRoute 用注入 getCurrentRoute 响应式读取
 * 后续可扩展：route 守卫组合（E16/E17 返回卸载函数）、route params 响应式映射（对接 usePageParam）
 */
export function createRouterEngineering(options: RouterEngineeringOptions): RouterEngineering {
  const { router } = options
  const current = options.reactivity.ref<CurrentRoute | undefined>(options.getCurrentRoute ? options.getCurrentRoute() : undefined)

  return {
    useRoute: () => current,
    push: (target) => router.push(target),
    replace: (target) => router.push({ ...target, replace: true }),
    back: (delta) => router.back(delta),
    switchTab: (target) => router.push({ ...target, switchTab: true }),
    reLaunch: (target) => router.push({ ...target, reLaunch: true }),
    beforeEach: (guard) => {
      if (router.beforeEach) router.beforeEach(guard)
    },
    afterEach: (guard) => {
      if (router.afterEach) router.afterEach(guard)
    },
  }
}