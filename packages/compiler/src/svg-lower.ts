// packages/compiler/src/svg-lower.ts
// ★2026-09-09 G-62 SVG→Skyline P0：静态 SVG 子树 → <image> data-URI（编译期 lowering）。
//
// 背景：Skyline 无 SVG DOM/渲染（<svg> 标签不渲染）。地基 spike 实证（examples/pages/image-spike.vue）：
//   Skyline 下 <image src="data:image/svg+xml;base64,..."> 能**完整渲染** SVG（path/stroke/circle 均正确，
//   真机模拟器截图确认）；而 canvas 路线当前被阻塞（node() 通道不回调，见专项 §9）。
// 因此 P0 走 image 路线：编译期把静态 <svg> 子树序列化回 SVG 字符串 → base64 data-URI → <image>。
//
// 边界（诚实）：仅处理**静态** SVG（无 {{ }} 插值 / 无 v-bind / v-if / v-for / 事件）。
//   含动态绑定的 SVG 属 P1（响应式矢量，需 canvas 或 SVG 重生成）——本模块返回 null，由调用方诚实警告。

import type { ElementNode, TemplateChildNode } from '@vue/compiler-dom'
import { NodeTypes } from '@vue/compiler-dom'

/** ★2026-09-09 G-62 P2：Skyline `<image>` 渲染 SVG 的**实测特性支持表**（真机 spike: examples/pages/svg-p2-spike.vue）。
 *  结论：Skyline image 的 SVG 渲染能力远超预期——mask/clipPath/渐变/transform/dasharray/opacity/filter 全部原生支持，
 *  无需 canvas 路线（P2 因此大幅简化）。仅 use+symbol / text 不支持（实测空白）。 */
export const SVG_P2_SUPPORT = {
  /** ✅ 实测支持（放行，无警告） */
  supported: [
    'linearGradient', 'radialGradient', 'stop', 'defs',
    'clipPath', 'mask',
    'transform（translate/rotate/scale 矩阵）',
    'stroke-dasharray / stroke-dashoffset', 'opacity / fill-opacity / stroke-opacity',
    'g（嵌套组）', 'filter（feGaussianBlur 等）',
  ],
  /** ❌ 实测不支持（编译期诚实警告——渲染为空白）。★use/symbol 已由编译期展开解决（见 useExpanded） */
  unsupported: ['text', 'tspan'],
  /** ★编译期展开解决（原始渲染空白，展开后完美渲染——真机实证） */
  useExpanded: ['use', 'symbol'],
} as const

/** P2 不支持标签（实测空白——渲染无产出）。★use/symbol 已由编译期展开处理（不再警告）；text/tspan 仍不支持 */
const SVG_UNSUPPORTED_TAGS = new Set(['text', 'tspan'])

/** use/symbol 标签（编译期展开为内联图形——不警告） */
const SVG_USE_TAGS = new Set(['use', 'symbol'])

/** 收集子树内**实测不支持**的 SVG 标签（去重，供诚实警告）。
 *  ★use/symbol 已由编译期展开处理——仅当 use 引用的 symbol **未在本文档定义**（外部 sprite）时，
 *  展开失败才计入警告（键名 'use(外部引用)'）。 */
export function collectUnsupportedSvgTags(node: ElementNode, acc: Set<string> = new Set()): Set<string> {
  // 先收集本文档内的 symbol 定义（判定 use 能否展开）
  const symbols: SymbolMap = new Map()
  collectSymbols(node, symbols)
  const walk = (n: ElementNode): void => {
    const lower = n.tag.toLowerCase()
    if (SVG_UNSUPPORTED_TAGS.has(lower)) acc.add(lower)
    if (lower === 'use') {
      const href = staticAttr(n, 'href') ?? staticAttr(n, 'xlink:href') ?? ''
      const id = href.replace(/^#/, '')
      if (!id || !symbols.has(id)) acc.add('use(外部引用)')
    }
    for (const c of n.children as TemplateChildNode[]) {
      if (c.type === NodeTypes.ELEMENT) walk(c as ElementNode)
    }
  }
  walk(node)
  return acc
}

/** 支持的 SVG 标签（P0 静态子集——与 template.ts 的 SVG_NAMESPACE_TAGS 对齐） */
const SVG_TAGS = new Set([
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g', 'defs',
  'lineargradient', 'radialgradient', 'stop', 'use', 'symbol', 'mask', 'clippath', 'tspan',
  // ★2026-09-09 P2：<svg> 子树内的 text 即 SVG text（与原生 <text> 同名的歧义只存在于根级；
  //   子树内 lowering 由 serializeSvgElement 的标签白名单保证——P2 实测其渲染为空白，见 SVG_P2_SUPPORT）
  'text',
])

/** 序列化结果：静态 SVG → base64 data-URI；含动态绑定/不支持形态 → null（调用方警告） */
export interface SvgLowerResult {
  /** data-URI（可直接作 <image src>） */
  dataUri: string
  /** 原始 viewBox（用于推导 image 尺寸/比例） */
  viewBox: string
}

/** 属性名规范化：SVG 在 WXML/HTML 解析后可能小写化（viewBox → viewbox）——回写时恢复驼峰 */
const CAMEL_ATTRS: Record<string, string> = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  patternunits: 'patternUnits',
  clippathunits: 'clipPathUnits',
  maskunits: 'maskUnits',
  markerwidth: 'markerWidth',
  markerheight: 'markerHeight',
  refx: 'refX',
  refy: 'refY',
  textlength: 'textLength',
  lengthadjust: 'lengthAdjust',
  stddeviation: 'stdDeviation',
  basefrequency: 'baseFrequency',
  numoctaves: 'numOctaves',
  stopcolor: 'stop-color',
  stopopacity: 'stop-opacity',
  strokewidth: 'stroke-width',
  strokelinecap: 'stroke-linecap',
  strokelinejoin: 'stroke-linejoin',
  strokedasharray: 'stroke-dasharray',
  strokedashoffset: 'stroke-dashoffset',
  fillopacity: 'fill-opacity',
  fillrule: 'fill-rule',
  cliprule: 'clip-rule',
}

/** HTML 转义（属性值与文本内容） */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 自闭合标签（SVG 中无子节点时输出 <x/>） */
const SELF_CLOSING = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'stop', 'use'])

/** ★2026-09-09 P2 补：<use href="#id"> 编译期展开（真机实证 use/symbol 渲染空白，展开后完美渲染）。
 *  收集 <defs>/<symbol id> 定义 → 遇到 <use href="#id" x y> 时把 symbol 内容包进 <g transform="translate(x,y)"> 内联。
 *  纯编译期转换（零运行时依赖）。 */
type SymbolMap = Map<string, ElementNode>

/** 递归收集子树内的 <symbol id="..."> 定义（含 defs 内） */
function collectSymbols(node: ElementNode, map: SymbolMap): void {
  if (node.tag.toLowerCase() === 'symbol') {
    const idAttr = node.props.find(
      (p) => p.type === NodeTypes.ATTRIBUTE && (p as { name: string }).name.toLowerCase() === 'id',
    ) as { value?: { content: string } } | undefined
    if (idAttr?.value?.content) map.set(idAttr.value.content, node)
  }
  for (const c of node.children as TemplateChildNode[]) {
    if (c.type === NodeTypes.ELEMENT) collectSymbols(c as ElementNode, map)
  }
}

/** 读取元素上的静态属性值（无 → undefined） */
function staticAttr(node: ElementNode, name: string): string | undefined {
  const a = node.props.find(
    (p) => p.type === NodeTypes.ATTRIBUTE && (p as { name: string }).name.toLowerCase() === name.toLowerCase(),
  ) as { value?: { content: string } } | undefined
  return a?.value?.content
}

/**
 * 把静态 SVG 元素子树序列化为 SVG 字符串。
 * 返回 null 表示含动态绑定（{{ }} / v-bind / v-if / v-for / v-on / 其它指令）——P0 不处理。
 */
function serializeSvgElement(node: ElementNode, depth: number, symbols: SymbolMap = new Map()): string | null {
  const tag = node.tag
  const lower = tag.toLowerCase()
  if (!SVG_TAGS.has(lower)) return null // 非 SVG 标签（含自定义组件）→ 不 lower

  // ★P2 补：<symbol> 定义不直接输出（仅作为 <use> 的展开源）；<use> → 展开为 symbol 内容 + translate
  if (lower === 'symbol') return ''
  if (lower === 'use') {
    const href = staticAttr(node, 'href') ?? staticAttr(node, 'xlink:href') ?? ''
    const id = href.replace(/^#/, '')
    const sym = id ? symbols.get(id) : undefined
    if (!sym) return '' // 引用缺失（外部 sprite 等）→ 空（调用方已警告）
    const x = staticAttr(node, 'x') ?? '0'
    const y = staticAttr(node, 'y') ?? '0'
    const inner: string[] = []
    for (const c of sym.children as TemplateChildNode[]) {
      if (c.type === NodeTypes.ELEMENT) {
        const cs = serializeSvgElement(c as ElementNode, depth + 1, symbols)
        if (cs === null) return null
        if (cs) inner.push(cs)
      } else if (c.type === NodeTypes.TEXT) {
        const t = (c as { content: string }).content
        if (t.trim()) inner.push(esc(t.trim()))
      }
    }
    const g = `<g transform="translate(${x},${y})">${inner.join('')}</g>`
    return g
  }

  const attrs: string[] = []
  for (const p of node.props) {
    if (p.type === NodeTypes.ATTRIBUTE) {
      const a = p
      if (a.value === undefined) {
        attrs.push(a.name) // 无值属性（如 gradientUnits 缺省）
      } else {
        const name = CAMEL_ATTRS[a.name.toLowerCase()] ?? a.name
        attrs.push(`${name}="${esc(a.value.content)}"`)
      }
    } else if (p.type === NodeTypes.DIRECTIVE) {
      // 任何指令（v-bind/v-if/v-for/v-on/自定义）→ 动态，P0 不处理
      return null
    }
  }

  const childParts: string[] = []
  let hasChild = false
  for (const c of node.children as TemplateChildNode[]) {
    if (c.type === NodeTypes.ELEMENT) {
      const s = serializeSvgElement(c as ElementNode, depth + 1, symbols)
      if (s === null) return null // 子节点含动态 → 整树不 lower
      if (s) {
        childParts.push(s)
        hasChild = true
      }
    } else if (c.type === NodeTypes.TEXT) {
      const t = (c as { content: string }).content
      if (t.trim()) {
        childParts.push(esc(t.trim()))
        hasChild = true
      }
    } else if (c.type === NodeTypes.INTERPOLATION || c.type === NodeTypes.COMPOUND_EXPRESSION) {
      return null // 插值 → 动态
    } else if (c.type === NodeTypes.COMMENT) {
      // 注释丢弃（不影响渲染）
    }
  }

  const attrStr = attrs.length ? ' ' + attrs.join(' ') : ''
  if (!hasChild && SELF_CLOSING.has(lower)) return `<${tag}${attrStr}/>`
  if (!hasChild) return `<${tag}${attrStr}></${tag}>`
  return `<${tag}${attrStr}>${childParts.join('')}</${tag}>`
}

/** UTF-8 → base64（Node 环境；编译器运行在构建期） */
function toBase64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64')
}

/**
 * 静态 SVG 子树 → <image> data-URI。
 * 前提：调用方已确认 node.tag === 'svg'。含动态绑定 → 返回 null（调用方诚实警告，P1 处理）。
 */
export function lowerSvgToImage(node: ElementNode): SvgLowerResult | null {
  // 先提取 viewBox（用于 <image> 尺寸比例；缺失时给默认）
  const viewBoxAttr = node.props.find(
    (p) => p.type === NodeTypes.ATTRIBUTE && (p as { name: string }).name.toLowerCase() === 'viewbox',
  ) as { value?: { content: string } } | undefined
  const viewBox = viewBoxAttr?.value?.content ?? '0 0 24 24'

  // ★P2 补：先收集 <symbol> 定义（供 <use> 展开）
  const symbols: SymbolMap = new Map()
  collectSymbols(node, symbols)
  // 序列化整个 <svg>（含自身属性）
  const inner = serializeSvgElement(node, 0, symbols)
  if (inner === null) return null

  // ★P2 补：清理展开后残留的空 <defs></defs>（symbol 已内联，defs 空壳无意义）
  let svg = inner.replace(/<defs>\s*<\/defs>/g, '')
  // 补 xmlns（SVG 渲染必需；源码常省略，因为是内联 DOM）
  if (!/\sxmlns\s*=/.test(svg)) {
    svg = svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  return { dataUri: `data:image/svg+xml;base64,${toBase64(svg)}`, viewBox }
}

/** 从 viewBox 推导宽高比（供 <image> 默认尺寸；失败 → 1:1） */
export function viewBoxRatio(viewBox: string): number {
  const m = viewBox.trim().split(/\s+/).map(Number)
  if (m.length === 4 && m[2] > 0 && m[3] > 0) return m[2] / m[3]
  return 1
}

// ─────────────────────────────────────────────────────────────────────────────
// ★2026-09-09 P1：动态 SVG → 运行时重生成（computed SVG 字符串 + <image src>）
//
// 背景：P1 原方案（canvas 2D 重画）被 node() 通道阻塞（专项 §9）。地基探测发现**替代路线可行**：
//   微信逻辑层无 `btoa`，但 `encodeURIComponent` 可用 → 动态 SVG 走 URL-encoded data-URI；
//   `image-spike.vue` 真机实证：运行时拼 SVG 字符串 → computed → setData → Skyline 实时重渲染 + 响应式有效。
// 因此 P1 实现 = 把动态 <svg> 子树编译为一条 computed（SVG 字符串拼接）+ <image src="{{x}}">，
//   复用既有 computed 链路（依赖追踪/init/写入补丁重算全现成）——绕开 canvas node 阻塞。
//
// ★实现要点（避免正则误伤）：序列化产出**结构化 Part 树**（lit 字面量 / expr 表达式 / if 条件片段），
//   表达式改写只作用于 expr/if 节点——标签名/属性名/文本永不参与标识符替换（嵌套 v-if 亦然）。
// ─────────────────────────────────────────────────────────────────────────────

/** 结构化片段：lit = 原样 SVG 文本；expr = 动态表达式；if = v-if 条件片段（含子片段） */
export type SvgPart =
  | { t: 'lit'; v: string }
  | { t: 'expr'; v: string }
  | { t: 'if'; cond: string; parts: SvgPart[] }

/** 动态 SVG 编译结果 */
export interface SvgDynamicResult {
  /** 生成的 computed 名（模板 image src 引用） */
  computedName: string
  /** 结构化片段树（script 侧改写 expr 内标识符后拼成模板字面量） */
  parts: SvgPart[]
  /** 依赖的标识符集合 */
  deps: Set<string>
  /** viewBox（尺寸推导） */
  viewBox: string
}

/** 属性名规范化后取值（同 P0） */
function camelName(n: string): string {
  return CAMEL_ATTRS[n.toLowerCase()] ?? n
}

/** 收集表达式内的依赖标识符（排除字面量关键字） */
function collectDeps(expr: string, deps: Set<string>): void {
  for (const id of expr.match(/\b([A-Za-z_$][\w$]*)\b/g) ?? []) {
    if (!/^(true|false|null|undefined|this|Math|JSON|String|Number)$/.test(id)) deps.add(id)
  }
}

/**
 * 动态 SVG 子树 → 结构化片段树。
 * 返回 null：v-for 等复杂形态（调用方保持 svg-no-peer 警告——诚实边界）。
 */
function serializeParts(node: ElementNode, deps: Set<string>): SvgPart[] | null {
  const tag = node.tag
  if (!SVG_TAGS.has(tag.toLowerCase())) return null
  // v-for 暂不支持（列表展开 + key 管理，复杂度高）
  if (node.props.some((p) => p.type === NodeTypes.DIRECTIVE && (p as { name?: string }).name === 'for')) return null

  const out: SvgPart[] = [{ t: 'lit', v: `<${tag}` }]
  for (const p of node.props) {
    if (p.type === NodeTypes.ATTRIBUTE) {
      const a = p
      if (a.value !== undefined) out.push({ t: 'lit', v: ` ${camelName(a.name)}="${esc(a.value.content)}"` })
      else out.push({ t: 'lit', v: ` ${a.name}` })
    } else if (p.type === NodeTypes.DIRECTIVE) {
      const d = p as { name?: string; arg?: { content?: string }; exp?: { content?: string } }
      if (d.name === 'bind' && d.arg?.content) {
        const attrName = d.arg.content
        // ★:style / :class 是外层容器语义（对象值不能进 SVG 属性）——由调用方在 <image> 上处理，跳过
        if (attrName === 'style' || attrName === 'class') continue
        const expr = (d.exp?.content ?? '').trim()
        if (!expr) continue
        collectDeps(expr, deps)
        out.push({ t: 'lit', v: ` ${camelName(attrName)}="` }, { t: 'expr', v: expr }, { t: 'lit', v: '"' })
      }
    }
  }

  const children: SvgPart[] = []
  for (const c of node.children as TemplateChildNode[]) {
    if (c.type === NodeTypes.ELEMENT) {
      const el = c as ElementNode
      const vIf = el.props.find((p) => p.type === NodeTypes.DIRECTIVE && (p as { name?: string }).name === 'if') as
        | { exp?: { content?: string } }
        | undefined
      const inner = serializeParts(el, deps)
      if (inner === null) return null
      if (vIf?.exp?.content) {
        const cond = vIf.exp.content.trim()
        collectDeps(cond, deps)
        children.push({ t: 'if', cond, parts: inner })
      } else {
        children.push(...inner)
      }
    } else if (c.type === NodeTypes.TEXT) {
      const t = (c as { content: string }).content
      if (t.trim()) children.push({ t: 'lit', v: esc(t.trim()) })
    } else if (c.type === NodeTypes.INTERPOLATION) {
      const expr = ((c as { content?: { content?: string } }).content?.content ?? '').trim()
      if (!expr) continue
      collectDeps(expr, deps)
      children.push({ t: 'expr', v: expr })
    }
    // COMMENT 丢弃
  }

  if (!children.length) {
    out.push({ t: 'lit', v: SELF_CLOSING.has(tag.toLowerCase()) ? '/>' : `></${tag}>` })
    return out
  }
  out.push({ t: 'lit', v: '>' }, ...children, { t: 'lit', v: `</${tag}>` })
  return out
}

/**
 * 动态 SVG → 结构化片段树（script 侧改写 expr 标识符后拼接）。
 * 返回 null：形态不支持（v-for 等）——调用方保持 svg-no-peer 警告。
 */
export function lowerSvgDynamic(node: ElementNode, computedName: string): SvgDynamicResult | null {
  const viewBoxAttr = node.props.find(
    (p) => p.type === NodeTypes.ATTRIBUTE && (p as { name: string }).name.toLowerCase() === 'viewbox',
  ) as { value?: { content: string } } | undefined
  const viewBox = viewBoxAttr?.value?.content ?? '0 0 24 24'

  const deps = new Set<string>()
  const parts = serializeParts(node, deps)
  if (parts === null) return null
  // 补 xmlns（SVG 渲染必需；插在 `<svg` 之后）
  if (parts[0]?.t === 'lit' && parts[0].v === '<svg') {
    parts.splice(1, 0, { t: 'lit', v: ' xmlns="http://www.w3.org/2000/svg"' })
  }
  return { computedName, parts, deps, viewBox }
}
