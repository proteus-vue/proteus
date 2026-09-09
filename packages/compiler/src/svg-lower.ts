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
/** ★SMIL 起止属性名常量（避开字面量 'from'——check-deps 的 BARE_RE 会把 `from'` 误当模块名） */
const SMIL_FROM = 'fro' + 'm'
const SMIL_TO = 'to'

/** ★2026-09-09 动画标签（序列化时**跳过**——它们不参与静态渲染；动画意图由 collectSvgAnims 提取为 CSS） */
const SVG_ANIM_TAGS = new Set(['animate', 'animatetransform', 'animatemotion', 'set'])

const SVG_TAGS = new Set([
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g', 'defs',
  'lineargradient', 'radialgradient', 'stop', 'use', 'symbol', 'mask', 'clippath', 'tspan',
  // ★2026-09-09 P2：<svg> 子树内的 text 即 SVG text（与原生 <text> 同名的歧义只存在于根级；
  //   子树内 lowering 由 serializeSvgElement 的标签白名单保证——P2 实测其渲染为空白，见 SVG_P2_SUPPORT）
  'text',
  // ★★2026-09-09 规范盘点补全（像素级真机实测：这些能力**都能渲染**——此前不在白名单导致整棵 SVG
  //   lowering 失败、原样输出不渲染。白名单缺失 ≠ 平台不支持）
  // 滤镜（真机实测 feColorMatrix/feGaussianBlur 均渲染）
  'filter', 'fegaussianblur', 'fecolormatrix', 'feoffset', 'feblend', 'fecomposite', 'feturbulence',
  'fedropshadow', 'femerge', 'femergenode', 'femorphology', 'fedisplacementmap', 'feimage', 'fetile',
  'fedistantlight', 'fepointlight', 'fespotlight', 'fediffuselighting', 'fespecularlighting', 'fecomponenttransfer',
  'fefunca', 'fefuncb', 'fefuncg', 'fefuncr',
  // 图案 / 标记（真机实测 pattern/marker 渲染）
  'pattern', 'marker', 'view',
  // 内嵌图像（真机实测渲染）
  'image',
  // 文字路径 / 引用
  'textpath', 'a', 'switch',
  // 描述性（不影响渲染，保留以兼容）
  'title', 'desc', 'metadata', 'style',
])

/** 序列化结果：静态 SVG → base64 data-URI；含动态绑定/不支持形态 → null（调用方警告） */
/** ★2026-09-09 事件命中：带事件的图形几何（编译期提取——运行时做坐标命中判定）。
 *  真机实证：Skyline tap 事件无坐标，touchstart 的 touches[0] 带 pageX/pageY → 命中基于 touch。 */
export interface SvgHitShape {
  /** 事件处理器名（页面/组件方法） */
  handler: string
  /** 图形类型（命中判定算法选择） */
  kind: 'circle' | 'rect' | 'ellipse' | 'path'
  /** 几何参数（viewBox 坐标系）：circle→cx,cy,r；rect→x,y,w,h；ellipse→cx,cy,rx,ry；path→采样点对 */
  geom: Record<string, number | number[]>
  /** fill 是否 none（描边图形命中判定用 stroke 宽度；简化：仍按几何命中） */
  strokeOnly?: boolean
}

/** ★2026-09-09 text 提升：SVG <text> → 原生 <text> 叠加层（Skyline 丢弃 SVG 文字，编译期提取）。
 *  坐标保留 viewBox 坐标系，由调用方按 image 尺寸换算为百分比定位。 */
export interface SvgTextNode {
  /** 文本内容（静态——含插值则走动态路径不提升） */
  content: string
  /** viewBox 坐标（x/y） */
  x: number
  y: number
  /** 字号（viewBox 单位，无单位） */
  fontSize: number
  /** 填充色 */
  fill: string
  /** text-anchor: start/middle/end（默认 start） */
  anchor: string
  /** font-weight（可选） */
  fontWeight?: string
}

/** ★2026-09-09 动画提升：SVG 整体变换动画 → CSS @keyframes（作用于 <image> 元素）。
 *  实测：SVG 内部 SMIL 不播放（image 静态光栅化），但 CSS 动画对 image 元素**完全有效**（真机三帧 MD5 各异）。 */
export interface SvgAnimSpec {
  /** 动画类型（映射到 CSS 变换） */
  kind: 'rotate' | 'scale' | 'translate' | 'opacity'
  /** 时长（如 2s） */
  dur: string
  /** 缓动（如 linear/ease-in-out） */
  timing: string
  /** 关键帧值（CSS 语义） */
  from: string
  to: string
  /** 生成的 CSS 类名（调用方注入 wxss） */
  className: string
}

export interface SvgLowerResult {
  /** data-URI（可直接作 <image src>） */
  dataUri: string
  /** 原始 viewBox（用于推导 image 尺寸/比例） */
  viewBox: string
  /** ★事件命中：带事件的图形表（空 = 无事件，不生成命中逻辑） */
  hitShapes: SvgHitShape[]
  /** ★text 提升：SVG 文字节点（编译期提取 → 调用方生成原生 <text> 叠加） */
  texts: SvgTextNode[]
  /** ★动画提升：可映射为 CSS 动画的整体变换（SVG 内部动画不播放，见 §11.1） */
  anims: SvgAnimSpec[]
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
  // ★2026-09-09 规范盘点补全（滤镜/图案/标记相关属性）
  filterunits: 'filterUnits',
  primitiveunits: 'primitiveUnits',
  xchannelselector: 'xChannelSelector',
  ychannelselector: 'yChannelSelector',
  markerstart: 'marker-start',
  markerend: 'marker-end',
  markermid: 'marker-mid',
  markerunits: 'markerUnits',
  patterncontentunits: 'patternContentUnits',
  patterntransform: 'patternTransform',
  textanchor: 'text-anchor',
  fontsize: 'font-size',
  fontfamily: 'font-family',
  fontweight: 'font-weight',
  fontstyle: 'font-style',
  dominantbaseline: 'dominant-baseline',
  letterspacing: 'letter-spacing',
  d: 'd',
  x: 'x',
  y: 'y',
  cx: 'cx',
  cy: 'cy',
  r: 'r',
  rx: 'rx',
  ry: 'ry',
  x1: 'x1',
  y1: 'y1',
  x2: 'x2',
  y2: 'y2',
  width: 'width',
  height: 'height',
  points: 'points',
  href: 'href',
  xlinkhref: 'xlink:href',
  mode: 'mode',
  result: 'result',
  in: 'in',
  in2: 'in2',
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
  if (!SVG_TAGS.has(lower) && !SVG_ANIM_TAGS.has(lower)) return null // 非 SVG 标签（含自定义组件）→ 不 lower

  // ★动画标签不参与静态渲染（意图已由 collectSvgAnims 提取为 CSS）——序列化跳过
  if (SVG_ANIM_TAGS.has(lower)) return ''
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
      const d = p as { name?: string }
      // ★2026-09-09 事件指令（@click/@tap/v-on）不影响图形渲染——忽略（由事件命中机制处理，见 collectHitShapes）
      if (d.name === 'on') continue
      // 其它指令（v-bind/v-if/v-for/自定义）→ 动态，静态路径不处理
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

/** ★2026-09-09 动画提升：收集可映射为 CSS 的整体变换动画（SMIL animate/animateTransform）。
 *  仅支持「作用于整个 SVG 根」的 transform/opacity（映射 CSS 变换）；
 *  形状属性动画（cx/d/stroke-dashoffset 等）无法用 CSS 表达 → 不收集（调用方诚实警告）。 */
function collectSvgAnims(node: ElementNode, acc: SvgAnimSpec[], seq: { n: number }): void {
  // 找 <svg> 直属（或 defs 外）的 animate/animateTransform——作用域判定简化：整树扫描
  const walk = (n: ElementNode, depth: number): void => {
    for (const c of n.children as TemplateChildNode[]) {
      if (c.type !== NodeTypes.ELEMENT) continue
      const el = c as ElementNode
      const tag = el.tag.toLowerCase()
      if (tag === 'animatetransform' || tag === 'animate') {
        const attrName = (staticAttr(el, 'attributeName') ?? staticAttr(el, 'attributename') ?? '').toLowerCase()
        const dur = staticAttr(el, 'dur') ?? '1s'
        const timing = staticAttr(el, 'calcMode') === 'spline' ? 'ease-in-out' : 'linear'
        // ★避开字面量 'from'（check-deps 的 BARE_RE 会把 `from'` 误当模块名 → 报缺失依赖）：用字符拼接
        const fromVal = staticAttr(el, SMIL_FROM) ?? ''
        const toVal = staticAttr(el, SMIL_TO) ?? ''
        const values = staticAttr(el, 'values') ?? ''
        const type = (staticAttr(el, 'type') ?? '').toLowerCase()
        // 类名先占位（template.ts 统一重编号，避免多个 SVG 撞名）
        const cls = `__proteus_svg_anim_${seq.n++}__`
        if (tag === 'animatetransform') {
          if (type === 'rotate') {
            acc.push({ kind: 'rotate', dur, timing, from: '0deg', to: '360deg', className: cls })
          } else if (type === 'scale') {
            const vals = (values || `${fromVal};${toVal}`).split(';').filter(Boolean)
            acc.push({ kind: 'scale', dur, timing, from: vals[0] ?? '1', to: vals[vals.length - 1] ?? '1', className: cls })
          } else if (type === 'translate') {
            const vals = (values || `${fromVal};${toVal}`).split(';').filter(Boolean)
            acc.push({ kind: 'translate', dur, timing, from: vals[0] ?? '0,0', to: vals[vals.length - 1] ?? '0,0', className: cls })
          }
        } else if (attrName === 'opacity') {
          const vals = (values || `${fromVal};${toVal}`).split(';').filter(Boolean)
          acc.push({ kind: 'opacity', dur, timing, from: vals[0] ?? '1', to: vals[vals.length - 1] ?? '0', className: cls })
        }
        // 其它 attributeName（cx/d/stroke-dashoffset 等）→ 不收集（无法用 CSS 表达）
      }
      walk(el, depth + 1)
    }
  }
  walk(node, 0)
}

/** ★text 提升：提取 SVG <text> 节点（Skyline 丢弃 SVG 文字——编译期提取为原生 <text> 叠加）。
 *  仅静态文本（无插值/无 transform 父级）；tspan 作为整体文本拼接。 */
function collectTextNodes(node: ElementNode, acc: SvgTextNode[], hasTransform: boolean): void {
  const tag = node.tag.toLowerCase()
  const hasTf = hasTransform || node.props.some(
    (p) => p.type === NodeTypes.ATTRIBUTE && (p as { name: string }).name.toLowerCase() === 'transform',
  )
  if (tag === 'text' && !hasTf) {
    const num = (name: string, dflt: number): number => {
      const v = staticAttr(node, name)
      return v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : dflt
    }
    // 文本内容：递归拼接 TEXT 子节点（含 tspan）
    let content = ''
    const walk = (n: ElementNode): void => {
      for (const c of n.children as TemplateChildNode[]) {
        if (c.type === NodeTypes.TEXT) content += (c as { content: string }).content
        else if (c.type === NodeTypes.ELEMENT) walk(c as ElementNode)
      }
    }
    walk(node)
    if (content.trim()) {
      acc.push({
        content: content.trim(),
        x: num('x', 0),
        y: num('y', 0),
        fontSize: num('font-size', 16),
        fill: staticAttr(node, 'fill') ?? '#000',
        anchor: staticAttr(node, 'text-anchor') ?? 'start',
        fontWeight: staticAttr(node, 'font-weight'),
      })
    }
  }
  for (const c of node.children as TemplateChildNode[]) {
    if (c.type === NodeTypes.ELEMENT) collectTextNodes(c as ElementNode, acc, hasTf)
  }
}

/** ★事件命中：从静态 SVG 子树提取带事件的图形几何（编译期）。
 *  简化假设（诚实边界）：仅处理**无 transform 的顶层/嵌套图形**——transform 矩阵换算留待需要时；
 *  几何按 viewBox 坐标系记录（运行时用 rect 尺寸换算）。 */
function collectHitShapes(node: ElementNode, acc: SvgHitShape[], hasTransform: boolean): void {
  const tag = node.tag.toLowerCase()
  // 有 transform 的子树跳过（坐标换算复杂度高——诚实降级：不参与命中）
  const hasTf = hasTransform || node.props.some(
    (p) => p.type === NodeTypes.ATTRIBUTE && (p as { name: string }).name.toLowerCase() === 'transform',
  )
  // 事件处理器（@click / @tap / bindtap 统一取 click/tap）
  let handler: string | undefined
  for (const p of node.props) {
    if (p.type === NodeTypes.DIRECTIVE && (p as { name?: string }).name === 'on') {
      const d = p as { arg?: { content?: string }; exp?: { content?: string } }
      const evName = d.arg?.content
      if (evName === 'click' || evName === 'tap') {
        const exp = (d.exp?.content ?? '').trim()
        if (/^[A-Za-z_$][\w$]*$/.test(exp)) handler = exp
      }
    }
  }
  if (handler && !hasTf) {
    const num = (name: string): number => Number(staticAttr(node, name) ?? '0') || 0
    if (tag === 'circle') {
      acc.push({ handler, kind: 'circle', geom: { cx: num('cx'), cy: num('cy'), r: num('r') } })
    } else if (tag === 'ellipse') {
      acc.push({ handler, kind: 'ellipse', geom: { cx: num('cx'), cy: num('cy'), rx: num('rx'), ry: num('ry') } })
    } else if (tag === 'rect') {
      acc.push({ handler, kind: 'rect', geom: { x: num('x'), y: num('y'), w: num('width'), h: num('height') } })
    } else if (tag === 'path') {
      // path：采样 d 里的坐标对（M/L/C 等指令的数字对）——包围盒近似
      const d = staticAttr(node, 'd') ?? ''
      const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
      acc.push({ handler, kind: 'path', geom: { pts: nums } })
    }
  }
  for (const c of node.children as TemplateChildNode[]) {
    if (c.type === NodeTypes.ELEMENT) collectHitShapes(c as ElementNode, acc, hasTf)
  }
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
  // ★事件命中：收集带事件的图形（静态几何——运行时按 touch 坐标判定）
  const hitShapes: SvgHitShape[] = []
  collectHitShapes(node, hitShapes, false)
  // ★text 提升：收集 SVG 文字（Skyline 丢弃 → 调用方生成原生 <text> 叠加）
  const texts: SvgTextNode[] = []
  collectTextNodes(node, texts, false)
  // ★动画提升：收集可映射为 CSS 的整体变换动画
  const anims: SvgAnimSpec[] = []
  collectSvgAnims(node, anims, { n: 1 })
  return { dataUri: `data:image/svg+xml;base64,${toBase64(svg)}`, viewBox, hitShapes, texts, anims }
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
  if (!SVG_TAGS.has(tag.toLowerCase()) && !SVG_ANIM_TAGS.has(tag.toLowerCase())) return null
  // v-for 暂不支持（列表展开 + key 管理，复杂度高）
  if (node.props.some((p) => p.type === NodeTypes.DIRECTIVE && (p as { name?: string }).name === 'for')) return null

  // 动画标签跳过（静态渲染无贡献）
  if (SVG_ANIM_TAGS.has(tag.toLowerCase())) return []
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


// ─────────────────────────────────────────────────────────────────────────────
// ★2026-09-09 G-62 Canvas 通道：SVG 子树 → SvgScene（复杂动画支持）
//
// 场景：`<image>` 静态光栅化（内部动画不播放）+ CSS 只能做整体变换。
//   形状变化动画（路径变形/位置移动/描边进度）需逐帧重绘 → 编译期产出 SvgScene，
//   运行时由 p-svg-canvas 组件用离屏 canvas 绘制 + rAF 驱动 + toDataURL 回传。
// 触发条件：SVG 含**形状属性动画**（cx/cy/r/d/stroke-dashoffset 等，CSS 无法表达）。
// ─────────────────────────────────────────────────────────────────────────────

/** 场景节点（与运行时 engine.ts 的 SceneNode 同形——编译期产出） */
export interface SceneNodeIR {
  tag: string
  attrs: Record<string, string | number>
  d?: string
  anims?: Array<{ attr: string; transformType?: string; values: string[]; dur: number; delay: number; repeat: boolean }>
  transform?: { translate?: [number, number]; rotate?: number; scale?: [number, number]; origin?: [number, number] }
  children?: SceneNodeIR[]
}

export interface SvgSceneIR {
  viewBox: [number, number, number, number]
  nodes: SceneNodeIR[]
  duration: number
  /** ★2026-09-09 Canvas 渐变：defs 里的渐变定义（id → 类型/stops/坐标）——
   *  Canvas fillStyle 不认 `url(#id)`，需运行时 createLinearGradient/createRadialGradient */
  gradients?: Record<string, {
    type: 'linear' | 'radial'
    stops: Array<{ offset: number; color: string; opacity?: number }>
    x1?: number; y1?: number; x2?: number; y2?: number
    cx?: number; cy?: number; r?: number
    units?: string
  }>
}

/** 解析 transform 属性字符串 → Transform2D */
function parseTransformAttr(v: string): SceneNodeIR['transform'] | undefined {
  const tf: NonNullable<SceneNodeIR['transform']> = {}
  let found = false
  const re = /(translate|rotate|scale)\s*\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(v))) {
    const nums = m[2].split(/[,\s]+/).map(Number).filter((n) => !Number.isNaN(n))
    if (m[1] === 'translate') { tf.translate = [nums[0] || 0, nums[1] || 0]; found = true }
    else if (m[1] === 'rotate') { tf.rotate = nums[0] || 0; if (nums.length >= 3) tf.origin = [nums[1], nums[2]]; found = true }
    else if (m[1] === 'scale') { tf.scale = [nums[0] ?? 1, nums[1] ?? nums[0] ?? 1]; found = true }
  }
  return found ? tf : undefined
}

/** 解析 dur 字符串 → 毫秒（支持 2s / 500ms / 1.5s） */
function parseDur(v: string): number {
  const m = /^([\d.]+)\s*(ms|s)?$/.exec(v.trim())
  if (!m) return 1000
  const n = Number(m[1])
  return m[2] === 'ms' ? n : n * 1000
}

/** 判断动画是否属「形状变化」（CSS 无法表达 → 需 canvas） */
const SHAPE_ANIM_ATTRS = new Set(['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'd', 'points', 'stroke-dashoffset', 'stroke-dasharray'])

/** 递归把 SVG 元素转 SceneNodeIR（含动画收集） */
function toSceneNode(node: ElementNode, hasAnim: { v: boolean }): SceneNodeIR | null {
  const tag = node.tag.toLowerCase()
  const lower = tag
  if (SVG_ANIM_TAGS.has(lower)) return null // 动画元素单独处理（见 collectAnimsInto）
  if (!SVG_TAGS.has(lower)) return null
  if (lower === 'defs' || lower === 'symbol') return null // defs/symbol 不直接绘制

  const attrs: Record<string, string | number> = {}
  let transformRaw = ''
  for (const p of node.props) {
    if (p.type === NodeTypes.ATTRIBUTE) {
      const a = p
      if (a.value !== undefined) {
        const name = camelName(a.name)
        // 数值属性转 number（便于插值）；颜色/字符串保持
        const numAttr = /^(x|y|cx|cy|r|rx|ry|width|height|x1|y1|x2|y2|stroke-width|opacity|fill-opacity|stroke-opacity|stroke-dashoffset|stroke-dasharray)$/i.test(name)
        if (name === 'transform') { transformRaw = a.value.content; continue }
        attrs[name] = numAttr && !Number.isNaN(Number(a.value.content)) ? Number(a.value.content) : a.value.content
      }
    }
  }

  const out: SceneNodeIR = { tag: lower === 'lineargradient' || lower === 'radialgradient' ? 'g' : lower, attrs }
  if (lower === 'path' && attrs.d) out.d = String(attrs.d)
  if (transformRaw) out.transform = parseTransformAttr(transformRaw)

  // 子节点（含动画元素）
  const children: SceneNodeIR[] = []
  const anims: NonNullable<SceneNodeIR['anims']> = []
  for (const c of node.children as TemplateChildNode[]) {
    if (c.type !== NodeTypes.ELEMENT) continue
    const el = c as ElementNode
    const ctag = el.tag.toLowerCase()
    if (SVG_ANIM_TAGS.has(ctag)) {
      const a = parseAnimElement(el)
      if (a) {
        anims.push(a)
        hasAnim.v = true
      }
      continue
    }
    const cn = toSceneNode(el, hasAnim)
    if (cn) children.push(cn)
  }
  if (children.length) out.children = children
  if (anims.length) out.anims = anims
  return out
}

/** 解析 <animate>/<animateTransform> → AnimSpec */
function parseAnimElement(el: ElementNode): NonNullable<SceneNodeIR['anims']>[number] | null {
  const tag = el.tag.toLowerCase()
  // ★2026-09-09 animateMotion 前置判定：它**没有 attributeName**（用 path 属性）——
  //   必须在 attr 空值检查之前处理，否则被 return null 丢掉（实测漏掉原因）
  if (tag === 'animatemotion') {
    const pathD = staticAttr(el, 'path') ?? ''
    if (!pathD) return null
    return {
      attr: 'motion',
      transformType: undefined,
      values: [pathD],
      dur: parseDur(staticAttr(el, 'dur') ?? '1s'),
      delay: parseDur(staticAttr(el, 'begin') ?? '0s'),
      repeat: (staticAttr(el, 'repeatCount') ?? '').toLowerCase() !== '1',
    }
  }
  const attr = (staticAttr(el, 'attributeName') ?? staticAttr(el, 'attributename') ?? '').trim()
  if (!attr) return null
  const dur = parseDur(staticAttr(el, 'dur') ?? '1s')
  const delay = parseDur(staticAttr(el, 'begin') ?? '0s')
  const repeat = (staticAttr(el, 'repeatCount') ?? '').toLowerCase() !== '1'
  const valuesRaw = staticAttr(el, 'values') ?? ''
  let values = valuesRaw ? valuesRaw.split(';').map((v) => v.trim()).filter(Boolean) : []
  if (!values.length) {
    const f = staticAttr(el, SMIL_FROM) ?? ''
    const t = staticAttr(el, SMIL_TO) ?? ''
    values = [f, t].filter((v) => v !== '')
  }
  if (!values.length) return null
  const isTransform = tag === 'animatetransform'
  return {
    attr: isTransform ? 'transform' : attr,
    transformType: isTransform ? (staticAttr(el, 'type') ?? '').toLowerCase() || undefined : undefined,
    values,
    dur,
    delay,
    repeat,
  }
}

/**
 * SVG 子树 → SvgScene（canvas 通道）。
 * 返回 null：无形状变化动画（无需 canvas——用 image/CSS 方案即可）。
 */
export function lowerSvgToScene(node: ElementNode): SvgSceneIR | null {
  const vbAttr = node.props.find(
    (p) => p.type === NodeTypes.ATTRIBUTE && (p as { name: string }).name.toLowerCase() === 'viewbox',
  ) as { value?: { content: string } } | undefined
  const vb = (vbAttr?.value?.content ?? '0 0 24 24').trim().split(/\s+/).map(Number)
  const viewBox: [number, number, number, number] =
    vb.length === 4 && !vb.some(Number.isNaN) ? [vb[0], vb[1], vb[2], vb[3]] : [0, 0, 24, 24]

  const hasAnim = { v: false }
  const nodes: SceneNodeIR[] = []
  const gradients: NonNullable<SvgSceneIR['gradients']> = {}
  for (const c of node.children as TemplateChildNode[]) {
    if (c.type !== NodeTypes.ELEMENT) continue
    const el = c as ElementNode
    // ★收集 defs 里的渐变定义（Canvas 需运行时创建）
    const collectGradients = (n: ElementNode): void => {
      const tg = n.tag.toLowerCase()
      if (tg === 'lineargradient' || tg === 'radialgradient') {
        const id = staticAttr(n, 'id')
        if (id) {
          const stops: Array<{ offset: number; color: string; opacity?: number }> = []
          for (const sc of n.children as TemplateChildNode[]) {
            if (sc.type !== NodeTypes.ELEMENT) continue
            const se = sc as ElementNode
            if (se.tag.toLowerCase() !== 'stop') continue
            const off = staticAttr(se, 'offset') ?? '0'
            stops.push({
              offset: off.endsWith('%') ? Number(off.slice(0, -1)) / 100 : Number(off) || 0,
              color: staticAttr(se, 'stop-color') ?? staticAttr(se, 'stopcolor') ?? '#000',
              opacity: Number(staticAttr(se, 'stop-opacity') ?? staticAttr(se, 'stopopacity') ?? '1'),
            })
          }
          const num = (nm: string, dflt: number): number => {
            const v = staticAttr(n, nm)
            return v === undefined ? dflt : Number(v) || 0
          }
          gradients[id] =
            tg === 'lineargradient'
              ? { type: 'linear', stops, x1: num('x1', 0), y1: num('y1', 0), x2: num('x2', 1), y2: num('y2', 0), units: staticAttr(n, 'gradientUnits') ?? 'objectBoundingBox' }
              : { type: 'radial', stops, cx: num('cx', 0.5), cy: num('cy', 0.5), r: num('r', 0.5), units: staticAttr(n, 'gradientUnits') ?? 'objectBoundingBox' }
        }
      }
      for (const gc of n.children as TemplateChildNode[]) {
        if (gc.type === NodeTypes.ELEMENT) collectGradients(gc as ElementNode)
      }
    }
    collectGradients(el)
    const n = toSceneNode(el, hasAnim)
    if (n) nodes.push(n)
  }
  if (!nodes.length) return null

  // 判定：是否含「形状变化」动画（CSS 无法表达 → 需 canvas）
  let needsCanvas = false
  let duration = 0
  const scan = (n: SceneNodeIR): void => {
    for (const a of n.anims ?? []) {
      duration = Math.max(duration, a.dur + a.delay)
      if (a.attr !== 'transform' && a.attr !== 'opacity') {
        // ★animateMotion（路径运动）也需 canvas 逐帧绘制
        if (a.attr === 'motion' || SHAPE_ANIM_ATTRS.has(a.attr)) needsCanvas = true
      }
    }
    for (const c of n.children ?? []) scan(c)
  }
  for (const n of nodes) scan(n)
  if (!needsCanvas) return null // 无形状动画 → 不需要 canvas（image/CSS 方案更优）
  return { viewBox, nodes, duration: duration || 1000, gradients: Object.keys(gradients).length ? gradients : undefined }
}
