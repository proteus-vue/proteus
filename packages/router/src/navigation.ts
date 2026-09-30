// packages/router/src/navigation.ts
// ★router-plus G-32 M1：路由语义层 + 五端导航映射（01-router.md §2）
// stack/transition 是**语义**不是平台 API——NAVIGATION_MAP 映射到各端导航实现（原则 #10）
// ★纯逻辑零依赖：Web/Skyline 立即可用，App 端见下（2026-09-30 修正）
//
// ★★2026-09-30 路线修正（用户决策：「吸取小程序和 uni-app 的路由栈数量限制的经验教训…
//   必须高性能，可以参考 Flutter」）：
//   App 端（ios/android/harmony）从「系统导航栈」（UINavigationController / FragmentTransaction /
//   NavPathStack）改为**虚拟栈**（`packages/router/src/app-stack.ts`）：屏 = 树内子树、
//   栈在逻辑层、`display:none` 切可见性——系统导航栈正是小程序「10 层限制」路线的翻版
//   （每屏一个原生容器 ⇒ 内存线性增长 ⇒ 平台只能设层数上限）。
//   ⇒ 本表 App 三端值改为**虚拟栈操作名**（执行器契约，非平台 API 名）。
export type StylePlatform = 'web' | 'skyline' | 'ios' | 'android' | 'harmony'

/** 转场语义（§2.1 meta.stack） */
export const STACK_SEMANTICS = ['push', 'present', 'replace', 'tab'] as const
export type StackSemantic = (typeof STACK_SEMANTICS)[number]

export function isStackSemantic(v: unknown): v is StackSemantic {
  return v === 'push' || v === 'present' || v === 'replace' || v === 'tab'
}

/** 五端导航映射（§2.2 表；Web/Skyline 为运行时可执行指令；App 三端为**虚拟栈操作名**） */
export const NAVIGATION_MAP: Record<StackSemantic, Record<StylePlatform, string>> = {
  push: {
    web: 'history.pushState',
    skyline: 'wx.navigateTo',
    ios: 'app-stack.push',
    android: 'app-stack.push',
    harmony: 'app-stack.push',
  },
  present: {
    web: 'history.replaceState', // 路由替换（SPA 无模态栈）
    skyline: 'wx.navigateTo', // 无模态 → 降级 push（§2.2 标注）
    // App：present = 半屏/模态（下层树保留）——虚拟栈内同是 push，视觉差异由 meta.transition 表达
    ios: 'app-stack.push',
    android: 'app-stack.push',
    harmony: 'app-stack.push',
  },
  replace: {
    web: 'history.replaceState',
    skyline: 'wx.redirectTo',
    ios: 'app-stack.replace',
    android: 'app-stack.replace',
    harmony: 'app-stack.replace',
  },
  tab: {
    web: 'SPA 路由切换',
    skyline: 'wx.switchTab',
    ios: 'app-stack.reset',
    android: 'app-stack.reset',
    harmony: 'app-stack.reset',
  },
}

/** back 语义映射（§2.2 表末行） */
export const BACK_MAP: Record<StylePlatform, string> = {
  web: 'history.back',
  skyline: 'wx.navigateBack',
  ios: 'app-stack.pop',
  android: 'app-stack.pop',
  harmony: 'app-stack.pop',
}

/** meta.stack 校验（ROUTE004 语义：非法值 error） */
export function validateStackSemantic(stack: unknown): string | null {
  if (stack === undefined || stack === null) return null // 缺省合法（默认 push）
  if (!isStackSemantic(stack)) {
    return `meta.stack 非法值 ${String(stack)}（允许：${STACK_SEMANTICS.join('/')}）`
  }
  return null
}

/** 语义 → 端 API（缺省 stack → push；未知端 fallback web） */
export function resolveNavigation(semantic: StackSemantic | undefined, platform: StylePlatform): string {
  const s = semantic ?? 'push'
  const map = NAVIGATION_MAP[s]
  return map[platform] ?? map.web
}
