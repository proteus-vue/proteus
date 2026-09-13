// packages/router/src/variant.ts —— Web 端平台变体组件解析（第 2 层配套）
//
// 背景：路由表（auto-routes）在 Web/MP 间**共享**，其中 `component` 写的是**基准路径**
//   （如 `../pages/login.vue`）。真实文件可能是平台变体（`login.web.vue` / `login.mp.vue`）。
//   Web 端 `import.meta.glob` 收集到的是**实际文件**，故需把基准路径解析到本平台变体。
//
// 规则与 compiler/platform-variant 一致：`base.web.vue` 优先 → `base.vue` 回退。

/** 在 glob 键集合中，把基准组件路径解析为本平台变体路径。
 * @param keys  `import.meta.glob` 的所有键（实际文件路径）
 * @param component 路由表里的基准路径（如 '../pages/login.vue'）
 * @param platform  目标平台后缀（默认 'web'；兼容别名 skyline→mp）
 */
export function resolveVariantComponentKey(
  keys: readonly string[],
  component: string,
  platform: 'web' | 'mp' | 'ios' | 'android' | 'harmony' | 'native' = 'web',
): string | undefined {
  if (keys.includes(component)) {
    // 基准存在：若同时存在本平台变体则优先变体（变体覆盖基准语义）
    const variant = withSuffix(component, platform)
    if (variant && keys.includes(variant)) return variant
    return component
  }
  const variant = withSuffix(component, platform)
  if (variant && keys.includes(variant)) return variant
  return undefined
}

/** 在 `.vue` 前插入平台后缀：`a/b.vue` → `a/b.web.vue` */
function withSuffix(component: string, platform: string): string | undefined {
  const m = component.match(/^(.*)\.([a-zA-Z0-9]+)$/)
  if (!m) return undefined
  return `${m[1]}.${platform}.${m[2]}`
}

/** 路由是否在当前平台生效（第 4 层门控）：无 platforms 声明 = 全平台；有则须包含本平台。 */
export function routeAppliesToPlatform(
  route: { webOnly?: boolean; platforms?: string[] },
  platform: 'web' | 'mp' | 'ios' | 'android' | 'harmony' | 'native' = 'web',
): boolean {
  if (platform === 'web' && route.webOnly) return true // webOnly 即仅 web
  if (route.webOnly && platform !== 'web') return false
  if (!route.platforms || route.platforms.length === 0) return true
  const norm = route.platforms.map(normalizeRouterPlatform)
  if (norm.includes(platform)) return true
  // 族回退：native 族平台（ios/android/harmony）命中 'native' 声明
  const fam = platform === 'ios' || platform === 'android' || platform === 'harmony' ? 'native' : platform
  return fam !== platform && norm.includes(fam)
}

/** 路由平台 id 归一（与 compiler/platform-variant 同规则；内联避免 router→compiler 依赖） */
function normalizeRouterPlatform(p: string): string {
  const m: Record<string, string> = {
    web: 'web', mp: 'mp', 'mp-weixin': 'mp', skyline: 'mp',
    ios: 'ios', 'native-ios': 'ios', android: 'android', 'native-android': 'android',
    harmony: 'harmony', 'native-harmony': 'harmony', native: 'native', app: 'native',
  }
  return m[p.trim().toLowerCase()] ?? p
}
