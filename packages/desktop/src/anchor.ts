// packages/desktop/src/anchor.ts
// ★#449 G-24 B5（proteus-semantic-primitives-plan 续批）：锚点定位原语——scrollIntoView 收口（元素查询在框架包内）
//   语义：按 id 定位元素并平滑滚动（可选延时——SPA 路由后新渲染的 v-html 内容）
//   消费：DocSearch 结果锚点跳转（v-html 文档 heading）——元素查询缺口回收
//   分层：纯逻辑 + Web 接线（env 注入可单测；缺省回落真实 document——同 network/lifecycle 族惯例）
export interface AnchorScrollEnv {
  /** 按 id 查元素（缺省 document.getElementById） */
  getElementById?: (id: string) => HTMLElement | null
  /** 延时器（缺省 globalThis.setTimeout） */
  setTimeout?: (fn: () => void, ms: number) => unknown
}

function defaultGetElementById(id: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.getElementById(id)
}
function defaultSetTimeout(fn: () => void, ms: number): unknown {
  if (typeof setTimeout === 'function') return setTimeout(fn, ms)
  fn() // 无 setTimeout 环境（如 SSR/测试）→ 同步执行
  return 0
}

/**
 * ★scrollToId：定位 id 锚点并滚动（options.delayMs > 0 → 延时执行——等目标渲染）
 * 返回 true = 目标存在（滚动已调度）；false = 未找到（调用方决定是否提示）
 */
export function scrollToId(id: string, options: { behavior?: ScrollBehavior; delayMs?: number } = {}, env: AnchorScrollEnv = {}): boolean {
  const get = env.getElementById ?? defaultGetElementById
  const el = get(id)
  if (!el) return false
  const behavior = options.behavior ?? 'smooth'
  const go = (): void => {
    el.scrollIntoView({ behavior, block: 'start' })
  }
  if (options.delayMs && options.delayMs > 0) {
    const delay = env.setTimeout ?? defaultSetTimeout
    delay(go, options.delayMs)
  } else {
    go()
  }
  return true
}
