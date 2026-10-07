// packages/web/src/env-vars.ts
// ★★★内置 CSS 环境变量（--pf-*）· Web 端运行期注入（决策 #598 · Stage 2 余项 · E 组设备标量）
//
// 【为什么需要 JS 注入】E 组 `--pf-hairline`（一条**物理像素**对应的逻辑长度）= 1 / devicePixelRatio。
//   CSS **无法**从设备像素比派生该值（`@media (resolution)` 只能按 dppx 桶近似，而 dpr 可任意如 2.75/3.5）。
//   ⇒ Web 基准真值由 JS 运行期按 devicePixelRatio 精确注入；`built-in-components/style.css` 的 `:root`
//     提供保守兜底 `1px`（SSR / 无 JS 环境）。
// 【与三端宿主同口径】Android `1/density`(dp) · iOS `1/UIScreen.scale`(pt) · 鸿蒙 `1/vp2px(1)`(vp) ·
//   MP `1/pixelRatio`(px)——四端出口都归一到逻辑像素，消费侧零换算（决策 #593 · 坑 P2）。
// 【诚实边界】安全区/视口（--pf-inset-* / --pf-vw / --pf-vh）由 `:root` 的 env()/vw/vh **原生**提供，
//   不在此注入（浏览器值即真值）。

/**
 * 把 CSS 无法派生的设备标量注入 `:root`（当前仅 `--pf-hairline`）。
 * `doc` 可注入（单测）；无 `window`（SSR）⇒ 变为 no-op（由 style.css 兜底）。
 */
export function installEnvVars(doc?: Document): void {
  const g = globalThis as { devicePixelRatio?: number }
  const dpr = typeof g.devicePixelRatio === 'number' && g.devicePixelRatio > 0 ? g.devicePixelRatio : 1
  const target = doc ?? (typeof document !== 'undefined' ? document : undefined)
  if (!target) return
  target.documentElement.style.setProperty('--pf-hairline', 1 / dpr + 'px')
}
