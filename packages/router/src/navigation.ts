// packages/router/src/navigation.ts
// ★router-plus G-32 M1：路由语义层 + 五端导航映射（01-router.md §2）
// stack/transition 是**语义**不是平台 API——NAVIGATION_MAP 映射到各端原生导航实现（原则 #10）
// ★纯逻辑零依赖：Web/Skyline 立即可用，App 端映射随 G-22 落地
export type StylePlatform = 'web' | 'skyline' | 'ios' | 'android' | 'harmony'

/** 转场语义（§2.1 meta.stack） */
export const STACK_SEMANTICS = ['push', 'present', 'replace', 'tab'] as const
export type StackSemantic = (typeof STACK_SEMANTICS)[number]

export function isStackSemantic(v: unknown): v is StackSemantic {
  return v === 'push' || v === 'present' || v === 'replace' || v === 'tab'
}

/** 五端导航映射（§2.2 表；App 端为原生 API 名，Web/Skyline 为运行时可执行指令） */
export const NAVIGATION_MAP: Record<StackSemantic, Record<StylePlatform, string>> = {
  push: {
    web: 'history.pushState',
    skyline: 'wx.navigateTo',
    ios: 'UINavigationController.pushViewController',
    android: 'FragmentTransaction.add',
    harmony: 'NavPathStack.push',
  },
  present: {
    web: 'history.replaceState', // 路由替换（SPA 无模态栈）
    skyline: 'wx.navigateTo', // 无模态 → 降级 push（§2.2 标注）
    ios: 'presentViewController(modal)',
    android: 'Activity.start(new task)',
    harmony: 'Navigation.pushDestination',
  },
  replace: {
    web: 'history.replaceState',
    skyline: 'wx.redirectTo',
    ios: 'UINavigationController.setViewControllers',
    android: 'FragmentTransaction.replace',
    harmony: 'NavPathStack.replace',
  },
  tab: {
    web: 'SPA 路由切换',
    skyline: 'wx.switchTab',
    ios: 'UITabBarController',
    android: 'BottomNavigationView',
    harmony: 'Tabs + TabContent',
  },
}

/** back 语义映射（§2.2 表末行） */
export const BACK_MAP: Record<StylePlatform, string> = {
  web: 'history.back',
  skyline: 'wx.navigateBack',
  ios: 'UINavigationController.popViewController',
  android: 'popBackStack',
  harmony: 'NavPathStack.pop',
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
