// packages/fluid/src/env-vars.ts
// ★★★框架内置 CSS 环境变量（`--pf-*`）——**运行期读数**（决策 #593）
//
// 【它解决什么】安全区/系统栏等运行期环境量在内置变量体系里由各端采集：
//   · Web：built-in-components/style.css 的 `:root{--pf-*:env(...)}`（浏览器原生）；
//   · App（自绘）：编译器发射 env 引用 token → 宿主用平台 insets 解析；
//   · **MP/Skyline**：`env()` 不受支持、wxss 无运行期覆盖 ⇒ 需**运行期读数**（`wx.getWindowInfo`）
//     归一为同名 `--pf-*`，由页面根 `:style` 绑定（MP 唯一可行的自定义属性通道）。
//
// 【本模块】给 MP（及任何 WebView 宿主）提供 `readEnvVars()`：读数 → `--pf-*` → vp/px 映射。
//   与 `p-safe` 的读数逻辑同源（同一份 `wx.getWindowInfo` 换算）。

/** 内置变量名 → 逻辑像素值（键含 `--pf-` 前缀，可直接作内联 `:style` 自定义属性）。 */
export type EnvVarMap = Record<string, string>

interface WxWindowInfo {
  statusBarHeight?: number
  screenWidth?: number
  screenHeight?: number
  safeArea?: { top?: number; bottom?: number; left?: number; right?: number }
}

interface WxLike {
  getWindowInfo?: () => WxWindowInfo
  getMenuButtonBoundingClientRect?: () => { bottom?: number }
}

/**
 * 读 MP 运行期环境变量 → `--pf-*`（px 字符串，MP 逻辑像素）。
 * 无 `wx`（Web/SSR）⇒ 返回空对象（由 Web `:root` 定义接管）。
 */
export function readEnvVars(): EnvVarMap {
  const wx = (globalThis as { wx?: WxLike }).wx
  if (!wx || typeof wx.getWindowInfo !== 'function') return {}
  const info = wx.getWindowInfo()
  const sa = info.safeArea || {}
  const sbH = typeof info.statusBarHeight === 'number' ? info.statusBarHeight : 0
  let top = sbH
  if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
    const cap = wx.getMenuButtonBoundingClientRect().bottom
    if (typeof cap === 'number' && cap > top) top = cap
  }
  const screenH = typeof info.screenHeight === 'number' ? info.screenHeight : 0
  const screenW = typeof info.screenWidth === 'number' ? info.screenWidth : 0
  const bottom = typeof sa.bottom === 'number' && screenH ? Math.max(0, screenH - sa.bottom) : 0
  const left = typeof sa.left === 'number' ? sa.left : 0
  const right = typeof sa.right === 'number' && screenW ? Math.max(0, screenW - sa.right) : 0
  const px = (n: number): string => n + 'px'
  return {
    '--pf-inset-top': px(top),
    '--pf-inset-right': px(right),
    '--pf-inset-bottom': px(bottom),
    '--pf-inset-left': px(left),
    '--pf-status-bar-height': px(sbH),
    '--pf-nav-bar-height': px(0), // 微信容器：底部由 safeArea 表达，无独立三键
    '--pf-indicator-height': px(bottom),
    '--pf-nav-bar-total': px(bottom),
    '--pf-cutout-top': px(0),
    '--pf-cutout-left': px(0),
    '--pf-cutout-right': px(0),
    '--pf-keyboard-height': px(0),
  }
}
