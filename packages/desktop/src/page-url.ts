// packages/desktop/src/page-url.ts
// ★#449 G-24 B5（proteus-semantic-primitives-plan 续批，p-deeplink 地址栏伴侣）：页面 URL 读写原语
//   语义：当前地址 origin/pathname 读取 + 同址替换（history.replaceState——不产生历史记录）
//   消费：TransformDemo 分享链接（当前地址拼 Playground URL + 随编辑同步地址栏）——location/history 缺口回收
//   分层：纯逻辑 + Web 接线（env 注入可单测；缺省回落真实 location/history——同 network/lifecycle 族惯例）
export interface PageUrlEnv {
  location?: { origin?: string; pathname?: string }
  history?: { replaceState?(data: unknown, unused: string, url?: string): void }
}

function defaultLocation(): PageUrlEnv['location'] | undefined {
  if (typeof location === 'undefined') return undefined
  return location
}
function defaultHistory(): PageUrlEnv['history'] | undefined {
  if (typeof history === 'undefined') return undefined
  return history
}

/** 当前页 origin（无 location 环境 → ''） */
export function currentPageOrigin(env: PageUrlEnv = {}): string {
  return env.location?.origin ?? defaultLocation()?.origin ?? ''
}

/** 当前页 pathname（无 location 环境 → ''） */
export function currentPagePathname(env: PageUrlEnv = {}): string {
  return env.location?.pathname ?? defaultLocation()?.pathname ?? ''
}

/** ★replacePageUrl：同址替换地址栏（history.replaceState——不产生历史记录；无 history 环境静默） */
export function replacePageUrl(url: string, env: PageUrlEnv = {}): void {
  const h = env.history ?? defaultHistory()
  if (h && typeof h.replaceState === 'function') h.replaceState(null, '', url)
}
