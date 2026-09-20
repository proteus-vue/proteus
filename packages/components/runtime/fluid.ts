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

/** 生成 clamp 声明表（prop → css 值）——`createFluidStyle` 与 `applyFluidStyle` 的唯一来源
 *  （公式与 compiler/fluid-layout.ts 的 generateClamp 同源：设计稿宽度处 min → 视口 max 处 max） */
export function fluidDeclarations(expr: string, designWidth = 375, viewportMax = 1440): Array<[string, string]> {
  const groups = parseFluidExpr(expr)
  if (!groups.length) return []
  return groups.map((g) => {
    const slope = (g.max - g.min) / (viewportMax - designWidth)
    const intercept = g.min - slope * designWidth
    return [g.prop, `clamp(${g.min}px, calc(${intercept.toFixed(2)}px + ${(slope * 100).toFixed(4)}vw), ${g.max}px)`]
  })
}

/** 生成 clamp CSS 声明串（供样式表/内联字符串场景；等价于 fluidDeclarations 的序列化形式） */
export function createFluidStyle(expr: string, designWidth = 375, viewportMax = 1440): string {
  const decls = fluidDeclarations(expr, designWidth, viewportMax)
  return decls.map(([prop, value]) => `${prop}: ${value}`).join('; ')
}

/**
 * 本指令**上一次写入的声明串**（按元素记录）——幂等的基础。
 * ★为什么不用 `el.style.setProperty`（看似更干净，但实测不可行）：happy-dom / 部分 CSSOM 实现
 *   会按属性值语法**校验并丢弃** `font-size: clamp(...)`（clamp 在它们的 CSS 值解析器里不被接受），
 *   于是样式在测试环境静默消失、真机与 CI 行为不一致。改走「记录+替换」既幂等，又不依赖
 *   CSSOM 对 clamp 的支持（Web 运行时是浏览器，但测试环境必须能复现同样的语义）。
 */
const writtenDecls = new WeakMap<HTMLElement, string>()

/** 应用指令：挂载/更新时把 p-fluid 生成的 clamp 样式写入元素（保留既有 style 优先级）
 *  ★幂等（2026-09-20 修外部实战报告第十一节第四条的阻断级缺陷）：此前实现是 `existing + '; ' + css`
 *    **无条件追加**，而本指令同时挂在 `mounted` 与 `updated` 上——Vue 的元素级 `updated` 在**父组件
 *    每次重渲染**时都会触发，于是元素所在组件每更新一次（如输入框每次击键）style 里就多一份 clamp：
 *    实测「初次挂载 1 份 → 输入 10 个字符后 13 份」，高频元素上会迅速膨胀成几千字符。
 *    修法：先移除**上一次由本指令写入**的声明，再写入本次的——重复执行结果恒等，
 *    且表达式变化时旧属性不会残留（`font-size(20,32) gap(8,16)` → `font-size(24,40)` 后 gap 被清掉）。 */
export function applyFluidStyle(el: HTMLElement, expr: string, designWidth?: number, viewportMax?: number): void {
  const decls = fluidDeclarations(expr, designWidth, viewportMax)
  if (!decls.length) return
  const next = decls.map(([prop, value]) => `${prop}: ${value}`).join('; ')
  const prevWrote = writtenDecls.get(el)
  let base = el.getAttribute('style') ?? ''
  if (prevWrote) {
    const at = base.indexOf(prevWrote)
    if (at >= 0) {
      // 精确移除自己上次追加的那一段，其余声明（业务 style / 其他指令）**逐字保留**
      base = (base.slice(0, at) + base.slice(at + prevWrote.length)).replace(/;\s*;\s*/g, '; ').replace(/^[;\s]+|[;\s]+$/g, '')
    }
  }
  el.setAttribute('style', base ? `${base}; ${next}` : next)
  writtenDecls.set(el, next)
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
