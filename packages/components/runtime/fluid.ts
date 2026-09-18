// src/components/runtime/fluid.ts
// ★G-22 柔性布局（fluid-layout-plan B3 补）：Web 端 p-fluid 运行时指令
//   用法（Web）：<h1 p-fluid="font-size(20, 32)">——defaultScopedPlugin 改写为 v-p-fluid="'font-size(20, 32)'"
//   语义：设计稿宽度处 = min，视口 max 处 = max，中间线性插值（clamp + vw，零 JS 持续开销）
//   ★公式与 compiler/fluid-layout.ts 的 generateClamp 保持一致（编译期生成同源，此处仅运行时等价实现——
//     两端一处源码语法，Web 运行时 / MP 编译期各自求解）
//   需全局注册：installFluidLayout(app)（examples/main.ts 接入）

export interface FluidGroup {
  prop: string
  min: number
  max: number
}

/** 解析 p-fluid 表达式（prop(min,max) 空格分隔组；非法组忽略） */
export function parseFluidExpr(expr: string): FluidGroup[] {
  const out: FluidGroup[] = []
  const re = /([A-Za-z][A-Za-z-]*)\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(expr))) {
    out.push({ prop: m[1], min: Number(m[2]), max: Number(m[3]) })
  }
  return out
}

/** 生成 clamp CSS 声明串（设计稿设计宽度处 min → 视口 max 处 max；公式与 compiler generateClamp 同源） */
export function createFluidStyle(expr: string, designWidth = 375, viewportMax = 1440): string {
  const groups = parseFluidExpr(expr)
  if (!groups.length) return ''
  const decls = groups.map((g) => {
    const slope = (g.max - g.min) / (viewportMax - designWidth)
    const intercept = g.min - slope * designWidth
    return `${g.prop}: clamp(${g.min}px, calc(${intercept.toFixed(2)}px + ${(slope * 100).toFixed(4)}vw), ${g.max}px)`
  })
  return decls.join('; ')
}

/** 应用指令：挂载/更新时把 p-fluid 生成的 clamp 样式合并进元素 style（保留既有 style 优先级） */
export function applyFluidStyle(el: HTMLElement, expr: string, designWidth?: number, viewportMax?: number): void {
  const css = createFluidStyle(expr, designWidth, viewportMax)
  if (!css) return
  const existing = el.getAttribute('style') ?? ''
  el.setAttribute('style', existing ? existing + '; ' + css : css)
}

/** ★Web 端全局指令（v-p-fluid）：绑定值为表达式字符串（defaultScopedPlugin 已把 p-fluid 属性改写为指令） */
export function createFluidDirective(designWidth = 375, viewportMax = 1440): {
  mounted: (el: HTMLElement, binding: { value?: string }) => void
  updated: (el: HTMLElement, binding: { value?: string }) => void
} {
  const apply = (el: HTMLElement, binding: { value?: string }): void => {
    // 指令绑定值优先；兼容运行时未改写场景（元素残留 p-fluid 属性）——读属性 + 移除（不泄漏进 DOM）
    const expr = binding.value ?? el.getAttribute('p-fluid') ?? ''
    el.removeAttribute('p-fluid')
    applyFluidStyle(el, expr, designWidth, viewportMax)
  }
  return { mounted: apply, updated: apply }
}

/** ★全局注册：installFluidLayout(app, { designWidth?, viewportMax? })——注册 v-p-fluid 指令 */
export function installFluidLayout(app: { directive(name: string, value: unknown): unknown }, options?: { designWidth?: number; viewportMax?: number }): void {
  app.directive('p-fluid', createFluidDirective(options?.designWidth ?? 375, options?.viewportMax ?? 1440))
}
