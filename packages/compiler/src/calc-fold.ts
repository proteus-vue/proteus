// packages/compiler/src/calc-fold.ts
// ★★★calc() 常量折叠 —— **唯一实现**（CSE 的 `foldCalc` 与 App 折叠面 `vapor/template.ts` 的 `foldCalc`
//   共用本模块，杜绝两路径分叉）。
//
// 【背景（2026-10-08 · css:next）】此前两处各写一套：App 折叠面支持完整算术（`+ - * /` 与括号、
//   `env(safe-area-inset-*)`），而 CSE 只支持**单层** `N op M`（同单位加减）——
//   实测 `calc(8px * 0.6)` / `calc(2 * 8px)` / `calc(100px / 4)` / `calc((10px + 5px) * 2)` /
//   `env(...)` 在 CSE 全被丢弃（App 却折得出）⇒ **判据①（CSE ≡ 浏览器）与 App 渲染分叉**。
//   ⇒ 抽为单一实现：两路径同口径。
//
// 【能力边界（诚实）】只折 **px / 无单位**参与的算式（`px` 被剥离后按纯数字求值）。
//   含 `%`、`em`/`rem`/`vw`/`vh` 等相对单位 ⇒ 无上下文不可求 ⇒ undefined（调用方诊断，不猜）。
//   `env(safe-area-inset-*, <fallback>)` 取 fallback（App 端无浏览器安全区概念，宿主自管——
//   取 fallback 是与 Web 最接近的确定值；其它 `env()` 变量无确定值 ⇒ 不替换 ⇒ 后续含字母 ⇒ undefined）。

/** `env(safe-area-inset-*, [fallback])` → 其 fallback（或 `0px`）。其它 env 变量原样保留（后续判为不可折）。 */
export function substituteSafeAreaEnv(expr: string): string {
  return expr.replace(
    /env\(\s*safe-area-inset-(?:top|right|bottom|left)\s*(?:,\s*([^()]*?)\s*)?\)/gi,
    (_all, fb?: string) => (fb && fb.trim() ? fb.trim() : '0px'),
  )
}

/** 受限算术求值（`+ - * /` 与括号；递归下降）。非法/非有限 ⇒ undefined。 */
export function evalArith(src: string): number | undefined {
  let i = 0
  const peek = (): string => src[i] ?? ''
  const skip = (): void => { while (/\s/.test(peek())) i++ }
  const expr = (): number | undefined => {
    let v = term(); if (v === undefined) return undefined
    for (;;) {
      skip(); const c = peek()
      if (c === '+' || c === '-') { i++; const r = term(); if (r === undefined) return undefined; v = c === '+' ? v + r : v - r }
      else return v
    }
  }
  const term = (): number | undefined => {
    let v = factor(); if (v === undefined) return undefined
    for (;;) {
      skip(); const c = peek()
      if (c === '*' || c === '/') { i++; const r = factor(); if (r === undefined) return undefined; v = c === '*' ? v * r : (r === 0 ? NaN : v / r) }
      else return v
    }
  }
  const factor = (): number | undefined => {
    skip()
    if (peek() === '(') { i++; const v = expr(); skip(); if (peek() !== ')') return undefined; i++; return v }
    if (peek() === '+') { i++; return factor() }
    if (peek() === '-') { i++; const v = factor(); return v === undefined ? undefined : -v }
    const start = i
    while (/[0-9.]/.test(peek())) i++
    if (i === start) return undefined
    const n = Number(src.slice(start, i))
    return Number.isFinite(n) ? n : undefined
  }
  const r = expr(); skip()
  if (i !== src.length || r === undefined || !Number.isFinite(r)) return undefined
  return r
}

/**
 * `calc()` 内层算式 → 数值（px/无单位参与）。
 * 含相对单位（`%`/`em`/`vw`…）⇒ undefined（不可折叠）。
 */
export function foldCalcArithmetic(expr: string): number | undefined {
  let inner = substituteSafeAreaEnv(expr).replace(/px/gi, '')
  if (/[a-zA-Z%]/.test(inner)) return undefined
  return evalArith(inner)
}
