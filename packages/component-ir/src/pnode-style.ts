// packages/component-ir/src/pnode-style.ts
// ★★M0：样式归一化（`Proteus_CSS_Profile规格.md` §3.2 / §4 的**编译期折叠**实现）。
//
// 目标（Profile §8.3 门禁）：**运行时不得存在 CSS 解析 / 单位换算**——
//   全部在编译期折叠为 `PProps`（结构化 + 单位已换算）。
//
// 三条纪律：
//  ① **单位折叠**：px → dp（绝对）；% / vw / vh / rpx / em / rem → 比例系数 + 基准（运行时按基准求值）
//  ② **分级管控**（Profile §3 L1–L5）：L1/L2 直接归一化；**L3 归一化但标记 `needsCompositingLayer`
//     + 出 warn 诊断**（z-index / fixed / filter / shadow / 3D 各占一块 backing store，
//     实测内存专项 §12 已确认其成本）；**Profile 外 → error 诊断**（不留到运行时静默降级）
//  ③ **PaintHint 编译期推导**（Profile §12.4「禁止运行时判断」）：承载已实测的绘制策略
import type {
  Edges,
  LayoutProps,
  PDiagnostic,
  PKind,
  PProps,
  PaintProps,
  PaintHint,
  ResolvedLength,
  TextProps,
  Transform2D,
} from './pnode'

import { isOpaqueColor } from './color'

/** 长度解析上下文（基准语义） */
export interface LengthContext {
  /** 属性归属轴——决定 `%` 的基准（width/margin/padding → parentWidth；height → parentHeight） */
  axis: 'horizontal' | 'vertical'
}

/**
 * 单位折叠（Profile §3.2：编译期折叠为逻辑像素或比例系数）。
 * · `px` / 无单位 0 → 绝对 dp
 * · `%` → ratio（基准按轴）
 * · `vw` / `vh` → ratio（视口基准）
 * · `rpx` → ratio = v/750（小程序 750 设计宽语义；App 端同样按视口宽比例求值）
 * · `em` → ratio（父字号基准）· `rem` → ratio（根字号基准）
 * 非法值 → undefined（由调用方出诊断）
 */
export function resolveLength(raw: string, ctx: LengthContext = { axis: 'horizontal' }): ResolvedLength | undefined {
  const v = raw.trim().toLowerCase()
  if (!v) return undefined
  if (v === '0' || /^0(\.0+)?$/.test(v)) return { kind: 'absolute', dp: 0 }
  if (v === 'auto') return undefined // auto 不是长度（调用方单独处理）
  const m = /^(-?\d*\.?\d+)\s*([a-z%]*)$/.exec(v)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n)) return undefined
  switch (m[2]) {
    case '':
    case 'px':
      return { kind: 'absolute', dp: n }
    case '%':
      return {
        kind: 'ratio',
        ratio: n / 100,
        base: ctx.axis === 'vertical' ? 'parentHeight' : 'parentWidth',
      }
    case 'vw':
      return { kind: 'ratio', ratio: n / 100, base: 'viewportWidth' }
    case 'vh':
      return { kind: 'ratio', ratio: n / 100, base: 'viewportHeight' }
    case 'rpx':
      // 750rpx = 视口宽（小程序设计宽语义）
      return { kind: 'ratio', ratio: n / 750, base: 'viewportWidth' }
    case 'em':
      return { kind: 'ratio', ratio: n, base: 'fontSize' }
    case 'rem':
      return { kind: 'ratio', ratio: n, base: 'rootFontSize' }
    case 'pt':
      return { kind: 'absolute', dp: n }
    default:
      return undefined
  }
}

/** 声明列表解析（`color: red; font-size: 14px` → 键值对；键统一 camelCase） */
export function parseStyleString(style: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':')
    if (i <= 0) continue
    const key = camel(decl.slice(0, i).trim())
    const val = decl.slice(i + 1).trim()
    if (key && val) out[key] = val
  }
  return out
}

/** kebab-case → camelCase（CSS 与 Vue style 对象两种写法都吃） */
export function camel(k: string): string {
  return k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
}

/** 空格分隔值拆分（跳过函数括号内的空格：`1px solid rgb(0, 0, 0)`） */
export function splitTopLevel(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of value) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (/\s/.test(ch) && depth === 0) {
      if (cur) parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}

/** 四边简写展开（1/2/3/4 值语义，对齐 CSS） */
export function expandEdges<T>(parts: T[]): Partial<Edges<T>> {
  const [a, b, c, d] = parts
  if (parts.length === 1) return { top: a!, right: a!, bottom: a!, left: a! }
  if (parts.length === 2) return { top: a!, right: b!, bottom: a!, left: b! }
  if (parts.length === 3) return { top: a!, right: b!, bottom: c!, left: b! }
  return { top: a!, right: b!, bottom: c!, left: d! }
}

/** 2D 变换解析；含 3D 分量 → 返回 `threeD: true`（由调用方标记 L3） */
export function parseTransform(raw: string): { t: Transform2D; threeD: boolean } {
  const t: Transform2D = {}
  let threeD = false
  for (const m of raw.matchAll(/([a-zA-Z0-9]+)\(([^)]*)\)/g)) {
    const fn = m[1]!.toLowerCase()
    const args = m[2]!.split(',').map((s) => s.trim())
    const num = (i: number): number => Number.parseFloat(args[i] ?? '0')
    switch (fn) {
      case 'translatex':
        t.translateX = resolveLength(args[0] ?? '0')?.kind === 'absolute' ? (resolveLength(args[0]!) as { dp: number }).dp : num(0)
        break
      case 'translatey':
        t.translateY = resolveLength(args[0] ?? '0')?.kind === 'absolute' ? (resolveLength(args[0]!) as { dp: number }).dp : num(0)
        break
      case 'translate':
        t.translateX = num(0)
        t.translateY = num(1)
        break
      case 'scale':
        t.scale = args.length > 1 ? num(0) : num(0)
        break
      case 'rotate':
        t.rotate = args[0]?.endsWith('deg') ? num(0) : num(0)
        break
      // 3D（L3：创建合成层）
      case 'translatez':
      case 'translate3d':
      case 'rotatex':
      case 'rotatey':
      case 'rotate3d':
      case 'perspective':
      case 'matrix3d':
        threeD = true
        break
      default:
        // 未知函数（如 skew）不在 Profile 内——交由调用方按 unsupported 处理
        threeD = true
        break
    }
  }
  return { t, threeD }
}

/* ─────────────────── 属性分级表（对齐 Profile §3 L1–L5） ─────────────────── */

/** L3 属性：归一化但需 opt-in，且**计入合成层预算**（iOS 上每层一块 backing store） */
const L3_PROPS = new Set([
  'zIndex',
  'boxShadow',
  'filter',
  'backdropFilter',
  'willChange',
  'position', // 仅 fixed/sticky 属 L3（由值判定）
])

/** Profile 外属性：**编译期 error**（Profile §1 原则 5「超出 Profile 即编译期报错」） */
const OUT_OF_PROFILE = new Set([
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridArea',
  'gridColumn',
  'gridRow',
  'float',
  'clear',
  'animation',
  'animationName',
  'animationDuration',
  'transition',
  'transitionProperty',
  'cursor',
  'userSelect',
  'content',
  'clipPath',
  'mask',
  'mixBlendMode',
])

/** L4（复用平台能力，不在自研层实现）：接受但**不进渲染 IR**（由平台文本栈处理） */
const L4_PASSTHROUGH = new Set(['fontFamily', 'fontStyle', 'fontVariant', 'textDecoration', 'direction', 'unicodeBidi'])

export interface NormalizeResult {
  props: PProps
  diagnostics: PDiagnostic[]
}

export interface NormalizeOptions {
  /** 节点类型（影响 PaintHint 推导——文本单色 / 纯背景） */
  kind?: PKind
  /** 源码定位（诊断用） */
  source?: { tag: string; line?: number }
  nodeId?: number
}

/**
 * 归一化：声明表 → `PProps`（**编译期完成，运行时零解析**）。
 * 诊断按 Profile 分级：L3 → warn（需 opt-in）；Profile 外 → error；非法单位 → warn。
 */
export function normalizeStyleDecls(decls: Record<string, string>, opts: NormalizeOptions = {}): NormalizeResult {
  const layout: LayoutProps = {}
  const paint: PaintProps = {}
  const text: TextProps = {}
  const diagnostics: PDiagnostic[] = []
  const push = (severity: 'error' | 'warn', code: string, message: string): void => {
    diagnostics.push({ severity, code, message, nodeId: opts.nodeId, source: opts.source })
  }

  const len = (raw: string, axis: 'horizontal' | 'vertical' = 'horizontal'): ResolvedLength | undefined => {
    const r = resolveLength(raw, { axis })
    if (r === undefined && raw.trim().toLowerCase() !== 'auto') {
      push('warn', 'css.invalid-length', `无法折叠的长度值「${raw}」（profile 支持 px/%/vw/vh/rpx/em/rem/pt）`)
    }
    return r
  }

  let needsCompositing = false
  let hasTransform = false

  for (const [kRaw, raw] of Object.entries(decls)) {
    const k = camel(kRaw)
    const v = raw.trim()
    if (!v) continue

    if (OUT_OF_PROFILE.has(k)) {
      push('error', 'css.out-of-profile', `属性 ${kRaw} 不在 CSS Profile 内（编译期拦截，不留运行时静默降级）`)
      continue
    }
    if (L4_PASSTHROUGH.has(k)) continue // L4：平台负责，不进渲染 IR

    switch (k) {
      /* ── 布局（L2） ── */
      case 'display':
        if (v === 'flex' || v === 'none' || v === 'block' || v === 'inline-block') layout.display = v
        else if (v === 'grid') push('error', 'css.grid-unsupported', 'display:grid 不在 Profile（待定——建议改嵌套 flex）')
        else push('warn', 'css.invalid-value', `display:${v} 未支持`)
        break
      case 'flexDirection':
        if (v === 'row' || v === 'column' || v === 'row-reverse' || v === 'column-reverse') layout.flexDirection = v
        break
      case 'flexWrap':
        if (v === 'nowrap' || v === 'wrap' || v === 'wrap-reverse') layout.flexWrap = v
        break
      case 'justifyContent':
      case 'alignItems':
      case 'alignSelf':
      case 'alignContent':
        layout[k] = v
        break
      case 'flexGrow':
        layout.flexGrow = Number(v)
        break
      case 'flexShrink':
        layout.flexShrink = Number(v)
        break
      case 'flexBasis':
        layout.flexBasis = v === 'auto' ? 'auto' : len(v)
        break
      case 'flex': {
        // 简写：`flex: 1` → grow 1 / shrink 1 / basis 0；`flex: none|auto|initial` 交给平台默认
        if (/^-?\d*\.?\d+$/.test(v)) {
          layout.flexGrow = Number(v)
          layout.flexShrink = 1
          layout.flexBasis = { kind: 'absolute', dp: 0 }
        }
        break
      }
      case 'gap':
      case 'rowGap':
      case 'columnGap': {
        layout[k] = len(v)
        break
      }
      case 'width':
      case 'minWidth':
      case 'maxWidth':
        layout[k] = len(v, 'horizontal')
        break
      case 'height':
      case 'minHeight':
      case 'maxHeight':
        layout[k] = len(v, 'vertical')
        break
      case 'margin':
      case 'padding': {
        const parts = splitTopLevel(v)
        const axis = parts.map((p, i) => len(p, k === 'margin' && i === 1 ? 'horizontal' : 'horizontal'))
        // margin/padding 的百分比一律按**包含块宽度**（CSS 语义：两者皆然，含 top/bottom）
        void axis
        const resolved = parts.map((p) => resolveLength(p, { axis: 'horizontal' })).filter((x): x is ResolvedLength => !!x)
        if (resolved.length === parts.length) layout[k] = expandEdges(resolved)
        break
      }
      case 'marginTop':
      case 'marginRight':
      case 'marginBottom':
      case 'marginLeft':
      case 'paddingTop':
      case 'paddingRight':
      case 'paddingBottom':
      case 'paddingLeft': {
        const side = k.replace(/^(margin|padding)([A-Z].*)$/, '$2')
        const short = k.startsWith('margin') ? 'margin' : 'padding'
        const l = resolveLength(v, { axis: 'horizontal' })
        if (l) {
          layout[short] = layout[short] ?? {}
          ;(layout[short] as Record<string, ResolvedLength>)[side.toLowerCase()] = l
        }
        break
      }
      case 'position':
        if (v === 'static' || v === 'relative' || v === 'absolute') layout.position = v
        else if (v === 'fixed' || v === 'sticky') {
          // ★L3：独立合成层（实测内存成本已确认）——需显式 opt-in
          needsCompositing = true
          push('warn', 'css.l3-opt-in', `position:${v} 属 L3（独立合成层，各占一块 backing store）——需在 config 或组件级 opt-in`)
        } else push('warn', 'css.invalid-value', `position:${v} 未支持`)
        break
      case 'top':
        layout.top = len(v, 'vertical')
        break
      case 'bottom':
        layout.bottom = len(v, 'vertical')
        break
      case 'left':
        layout.left = len(v, 'horizontal')
        break
      case 'right':
        layout.right = len(v, 'horizontal')
        break
      case 'overflow':
      case 'overflowX':
      case 'overflowY': {
        const val = v === 'visible' || v === 'hidden' || v === 'scroll' || v === 'auto' ? v : undefined
        if (val) {
          if (k === 'overflow') layout.overflow = val
          else layout.overflow = val
        }
        break
      }

      /* ── 绘制（L1 + L3） ── */
      case 'backgroundColor':
        paint.backgroundColor = v
        break
      case 'background': {
        // ★2026-09-29：`background` 简写是**最常见写法之一**（实测：探针页与演示页普遍使用），
        //   此前只实现 `background-color` → 简写被判「Profile 外」出 error，属误报。
        //   支持两种形态：纯色（`#000` / `rgb(...)` / 颜色关键字）→ backgroundColor；
        //   渐变（含 gradient(）→ backgroundImage；其余（url 图/多重值）→ 明确诊断不静默。
        if (/gradient\(/.test(v)) paint.backgroundImage = v
        else if (/url\(/.test(v)) push('warn', 'css.unsupported-image', 'background 的图片形态需改用 image 组件（CSS Profile 不含背景图）')
        else {
          const first = splitTopLevel(v)[0] ?? ''
          // 纯色判定：单值，且不含 position/repeat/size 等关键字
          const isPlainColor = !/\b(no-repeat|repeat|cover|contain|center|left|right|top|bottom)\b/.test(v)
          if (isPlainColor && first) paint.backgroundColor = first
          else push('warn', 'css.background-compound', `background 复合值「${v}」无法折叠为单一颜色——请改用 background-color`)
        }
        break
      }
      case 'backgroundImage':
        if (v.includes('gradient(')) paint.backgroundImage = v
        else push('warn', 'css.unsupported-image', 'background-image 仅支持 gradient（其余需走 image 组件）')
        break
      case 'borderRadius': {
        const parts = splitTopLevel(v).map((p) => resolveLength(p, { axis: 'horizontal' }))
        if (parts.every((x) => !!x)) paint.borderRadius = expandEdges(parts as ResolvedLength[])
        break
      }
      case 'borderTopLeftRadius':
      case 'borderTopRightRadius':
      case 'borderBottomLeftRadius':
      case 'borderBottomRightRadius': {
        const side = k.replace(/^border([A-Z].*)Radius$/, '$1')
        const l = resolveLength(v, { axis: 'horizontal' })
        if (l) {
          paint.borderRadius = paint.borderRadius ?? {}
          ;(paint.borderRadius as Record<string, ResolvedLength>)[side.charAt(0).toLowerCase() + side.slice(1)] = l
        }
        break
      }
      case 'border': {
        // 简写：`2px solid #ccc`
        const parts = splitTopLevel(v)
        const w = parts.find((p) => /^-?\d*\.?\d+\s*(px|rpx|pt)?$/.test(p))
        const style = parts.find((p) => ['solid', 'dashed', 'dotted', 'none'].includes(p))
        const color = parts.find((p) => !p.includes('px') && p !== style && p !== w)
        if (w) {
          const l = resolveLength(w, { axis: 'horizontal' })
          if (l) paint.borderWidth = { top: l, right: l, bottom: l, left: l }
        }
        if (style) paint.borderStyle = style as PaintProps['borderStyle']
        if (color) paint.borderColor = color
        break
      }
      case 'borderWidth': {
        const parts = splitTopLevel(v).map((p) => resolveLength(p, { axis: 'horizontal' }))
        if (parts.every((x) => !!x)) paint.borderWidth = expandEdges(parts as ResolvedLength[])
        break
      }
      case 'borderColor':
        paint.borderColor = v
        break
      case 'opacity': {
        const n = Number(v)
        if (Number.isFinite(n)) paint.opacity = n
        break
      }
      case 'transform': {
        const { t, threeD } = parseTransform(v)
        hasTransform = true
        if (threeD) {
          needsCompositing = true
          push('warn', 'css.l3-opt-in', `3D 变换属 L3（合成层 + 光栅化）——需 opt-in；值「${v}」仅供诊断`)
        }
        if (Object.keys(t).length) paint.transform = t
        break
      }
      /* ── L3：标记合成层 + 需 opt-in（不静默丢弃——诊断保留原值） ── */
      case 'zIndex':
      case 'boxShadow':
      case 'filter':
      case 'backdropFilter':
      case 'willChange': {
        needsCompositing = true
        void L3_PROPS
        push('warn', 'css.l3-opt-in', `${kRaw} 属 L3（合成层/离屏渲染——各占一块 backing store）——需显式 opt-in`)
        break
      }

      /* ── 文本 ── */
      case 'fontSize':
        text.fontSize = len(v, 'horizontal')
        break
      case 'fontWeight':
        text.fontWeight = v === 'normal' || v === 'bold' ? v : Number(v)
        break
      case 'lineHeight': {
        const n = Number(v)
        if (Number.isFinite(n) && !/[a-z%]/.test(v)) text.lineHeight = n // 无单位 = 倍数
        else text.lineHeight = resolveLength(v, { axis: 'vertical' })
        break
      }
      case 'letterSpacing':
        text.letterSpacing = len(v, 'horizontal')
        break
      case 'color':
        text.color = v
        break
      case 'textAlign':
        if (v === 'left' || v === 'center' || v === 'right' || v === 'justify') text.textAlign = v
        break
      case 'webkitLineClamp': {
        const n = Number(v)
        if (Number.isFinite(n)) text.maxLines = n
        break
      }
      case 'textOverflow':
        if (v === 'clip' || v === 'ellipsis') text.textOverflow = v
        break
      case 'whiteSpace':
        if (v === 'normal' || v === 'nowrap' || v === 'pre-wrap') text.whiteSpace = v
        break

      default:
        push('error', 'css.out-of-profile', `属性 ${kRaw} 不在 CSS Profile 内`)
        break
    }
  }

  const hasText = Object.keys(text).length > 0
  // ★PaintHint 编译期推导（Profile §12.4；承载已实测的绘制策略——见 pnode.ts 头部注释）
  //
  // ★★★**推导必须"充分"而不只是"不矛盾"**（2026-09-29 修，见 `color.ts` 的实测记录）：
  //   两个字段此前都只检查了**一半**条件，而它们的下游动作是"**换存储格式** / 不分配存储"
  //   ⇒ 条件不充分就**直接画错**（不是慢）。修法：判据写成"该策略成立所需的**全部**条件"，
  //     拿不准一律 false（宁可保守走通用路径，不可优化出错误画面）。
  const bgIsPureColor = isOpaqueColor(paint.backgroundColor)
  const fgIsPureColor = isOpaqueColor(text.color)
  const paintHint: PaintHint = {
    // 单色文本 → 紧凑 backing store 格式（实测 −39% 内存）
    //
    // 【为什么要求这么严（三条，逐条对应一种"会画错"的形态）】
    //   ① **看底色**：紧凑单通道格式**只能表达一种颜色**——白字 + 蓝底放进去会丢一个颜色。
    //      实测（修复前）：`color:#ffffff;background-color:#285ac8`（**4050 夹具的真实形状**）
    //      判 true ⇒ 一旦接线即画面错。
    //   ② **看圆角**：圆角要保留 alpha 边缘（单通道紧凑格式**没有 alpha 通道**）⇒ 边缘会变硬/出错。
    //   ③ **看透明度**：半透明层的合成依赖 alpha（同上）。
    //   ★后两条是**未验证配置**（−39% 实验用的是"纯色白字、无圆角、无透明度"）——
    //     不在已验证配置内就**不放行**（本仓纪律：只声称有依据的东西）。
    //   ★与 `isPureBackground` 用**同一套条件**（该字段既有测试已排除圆角/透明度，标准一致）。
    isMonochrome: !!(
      hasText &&
      fgIsPureColor &&
      !paint.backgroundColor &&
      !paint.backgroundImage &&
      !paint.borderRadius &&
      (paint.opacity === undefined || paint.opacity === 1) &&
      !needsCompositing
    ),
    // 纯色背景 → 走 backgroundColor 通道、**不分配 backing store**（实测：仅色块 4.9MB vs 带文本 186.7MB）
    // 【为什么必须排除"带文本"】本字段的语义是"**这一层只有一块底色要画**"——
    //   有文本就有字形要栅格化，必须有存储。实测（修复前）：`color:#fff;background-color:#285ac8`
    //   同时被判 isPureBackground=true ⇒ 一旦平台据此跳过分配，**文字就不见了**。
    isPureBackground:
      bgIsPureColor &&
      !paint.backgroundImage &&
      !paint.borderWidth &&
      !paint.borderRadius &&
      !needsCompositing &&
      !hasTransform &&
      !hasText &&
      (paint.opacity === undefined || paint.opacity === 1),
    // 由树级分析填充（本函数只管单节点）
    staticSubtree: false,
    needsCompositingLayer: needsCompositing,
  }

  return {
    props: {
      layout,
      paint,
      ...(hasText ? { text } : {}),
      paintHint,
    },
    diagnostics,
  }
}

/** 便捷：样式字符串 → PProps（内部先拆声明列表） */
export function normalizeStyleString(style: string, opts: NormalizeOptions = {}): NormalizeResult {
  return normalizeStyleDecls(parseStyleString(style), opts)
}
