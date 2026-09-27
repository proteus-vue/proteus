// packages/layout-core/src/from-pnode.ts
// ★★M1-4：**渲染 IR（PNode）→ 布局输入（LayoutNode）** 的适配层。
//
// 两次转换，各有明确理由：
//   ① `ResolvedLength` → 绝对数值：M0 只折叠到「绝对 dp 或比例系数」，
//      **比例需要视口/父尺寸才成为数字**——那属于运行时（本层拿得到 ctx，M0 拿不到）。
//      ★Profile §8.3 的「运行时零解析」指的是**不做 CSS 字符串解析**；比例求值是两次浮点乘法，不是解析。
//   ② `result.rects.get(id)` **线性扫回**写入 `node.rect`：布局结果是一次遍历的副产品，
//      而绘制遍历要按树形顺序读；把结果挂回节点比让绘制层持有 Map 更省一次查表。
//
// ★文本度量注入：`PNode.props.text` 只声明「怎么显示」，**怎么量**只有平台知道
//   （CoreText / StaticLayout / ArkUI）。故 `measureText` 由调用方提供（M1 测试给桩、M2 给真实现）。
import type { Edges, PNode, ResolvedLength } from '@proteus-vue/component-ir'
import type { EdgeValues, LayoutNode, Size } from './types'

/** 比例解算上下文（视口与字体——M0 折叠不到的部分） */
export interface LengthContext {
  viewportWidth: number
  viewportHeight: number
  fontSize: number
  rootFontSize: number
}

/** 比例基准 → 数值 */
export function resolveLength(v: ResolvedLength | undefined, parent: Size, c: LengthContext): number | undefined {
  if (v === undefined) return undefined
  if (v.kind === 'absolute') return v.dp
  switch (v.base) {
    case 'parentWidth':
      return v.ratio * parent.width
    case 'parentHeight':
      return v.ratio * parent.height
    case 'viewportWidth':
      return v.ratio * c.viewportWidth
    case 'viewportHeight':
      return v.ratio * c.viewportHeight
    case 'fontSize':
      return v.ratio * c.fontSize
    case 'rootFontSize':
      return v.ratio * c.rootFontSize
    default:
      return undefined
  }
}

/** 边值解算（缺省 0）——输入是**编译期未折叠**的长度（含比例），故需 parent/视口基准 */
function resolveEdges(
  e: Partial<Edges<ResolvedLength>> | undefined,
  parent: Size,
  c: LengthContext,
): EdgeValues {
  const rl = (side: ResolvedLength | undefined): number => resolveLength(side, parent, c) ?? 0
  return {
    top: rl(e?.top),
    right: rl(e?.right),
    bottom: rl(e?.bottom),
    left: rl(e?.left),
  }
}

/** 文本度量钩子（平台注入；M1 测试给桩，M2+ 给 CoreText/StaticLayout 实现） */
export type TextMeasurer = (node: PNode, maxWidth: number) => Size

export interface FromPNodeOptions {
  lengthContext?: Partial<LengthContext>
  /** 文本度量（缺省：定宽就返回零高——**仅用于无文本场景**，有文本必须注入真实现） */
  measureText?: TextMeasurer
}

/**
 * 把编译期 IR 树转换为布局树。
 * ★不做任何 CSS 解析；比例(`vw`/`%`)在此以浮点乘法解算——见文件头。
 */
export function layoutTreeFromPNode(roots: PNode[], opts: FromPNodeOptions = {}): LayoutNode[] {
  const ctx: LengthContext = {
    viewportWidth: 375,
    viewportHeight: 812,
    fontSize: 16,
    rootFontSize: 16,
    ...opts.lengthContext,
  }
  const self: Size = { width: ctx.viewportWidth, height: ctx.viewportHeight }
  return roots.map((r) => convert(r, self, ctx, opts))
}

function convert(node: PNode, parent: Size, ctx: LengthContext, opts: FromPNodeOptions): LayoutNode {
  const L = node.props.layout
  const P = node.props.paint
  const T = node.props.text

  // ★百分比留作「比例」交由求解器解算（基准 = 父**内容盒**，适配层拿不到——见 types.ts widthRatio 注释）；
  //   绝对值与视口单位（vw/vh/em/rem，不依赖父尺寸）在此直接解算。
  const declaredW = L.width && L.width.kind === 'absolute' ? L.width.dp : undefined
  const declaredH = L.height && L.height.kind === 'absolute' ? L.height.dp : undefined
  const widthRatio = L.width && L.width.kind === 'ratio' && (L.width.base === 'parentWidth' || L.width.base === 'parentHeight') ? L.width.ratio : undefined
  const heightRatio = L.height && L.height.kind === 'ratio' && (L.height.base === 'parentWidth' || L.height.base === 'parentHeight') ? L.height.ratio : undefined
  // 视口/字体基准的比例（vw/vh/em/rem）与父尺寸无关 → 适配层直接解算为绝对值
  const vw = L.width && L.width.kind === 'ratio' && widthRatio === undefined ? resolveLength(L.width, parent, ctx) : undefined
  const vh = L.height && L.height.kind === 'ratio' && heightRatio === undefined ? resolveLength(L.height, parent, ctx) : undefined

  // 子级的比例基准需要「父的声明尺寸」——仅用于 vw/em 这类与父无关的解算，父尺寸未知时退化为视口
  const selfSize: Size = {
    width: declaredW ?? vw ?? parent.width,
    height: declaredH ?? vh ?? parent.height,
  }

  const children = node.children.map((c) => convert(c, selfSize, ctx, opts))

  const ln: LayoutNode = {
    id: node.id,
    tag: node.semantic ?? node.kind,
    width: declaredW ?? vw,
    height: declaredH ?? vh,
    widthRatio,
    heightRatio,
    minWidth: L.minWidth ? resolveLength(L.minWidth, parent, ctx) : undefined,
    maxWidth: L.maxWidth ? resolveLength(L.maxWidth, parent, ctx) : undefined,
    minHeight: L.minHeight ? resolveLength(L.minHeight, parent, ctx) : undefined,
    maxHeight: L.maxHeight ? resolveLength(L.maxHeight, parent, ctx) : undefined,
    margin: resolveEdges(L.margin, parent, ctx),
    padding: resolveEdges(L.padding, parent, ctx),
    flexDirection: L.flexDirection ?? 'column',
    flexWrap: L.flexWrap ?? 'nowrap',
    justifyContent: L.justifyContent ?? 'flex-start',
    alignItems: L.alignItems ?? 'stretch',
    alignSelf: L.alignSelf,
    alignContent: L.alignContent,
    flexGrow: L.flexGrow ?? 0,
    flexShrink: L.flexShrink ?? 1,
    flexBasis: L.flexBasis && L.flexBasis !== 'auto' && L.flexBasis.kind === 'absolute' ? L.flexBasis.dp : 'auto',
    flexBasisRatio:
      L.flexBasis && L.flexBasis !== 'auto' && L.flexBasis.kind === 'ratio' && (L.flexBasis.base === 'parentWidth' || L.flexBasis.base === 'parentHeight')
        ? L.flexBasis.ratio
        : undefined,
    gap: L.gap ? resolveLength(L.gap, parent, ctx) ?? 0 : 0,
    rowGap: L.rowGap ? resolveLength(L.rowGap, parent, ctx) : undefined,
    columnGap: L.columnGap ? resolveLength(L.columnGap, parent, ctx) : undefined,
    display: L.display ?? 'flex',
    position: L.position ?? 'static',
    top: L.top ? resolveLength(L.top, parent, ctx) : undefined,
    right: L.right ? resolveLength(L.right, parent, ctx) : undefined,
    bottom: L.bottom ? resolveLength(L.bottom, parent, ctx) : undefined,
    left: L.left ? resolveLength(L.left, parent, ctx) : undefined,
    overflow: L.overflow ?? 'visible',
    flattenEligible: node.flags.flattenEligible,
    // ★布局边界（§5.4）：宽高**均为显式值** ⇒ 对外尺寸与子级无关 ⇒ 内部变更不外溢。
    //   M0 的 flags.isLayoutBoundary 为真时也认（编译器可给出更强的判定）。
    isLayoutBoundary: node.flags.isLayoutBoundary || (declaredW !== undefined && declaredH !== undefined && node.props.layout.display !== 'none'),
    children,
  }

  // 文本叶子：注入平台度量（宽度未定才有意义——定宽时高度仍依赖文本换行，交由注入实现处理）
  if ((node.kind === 'text' || node.kind === 'rich-text') && opts.measureText && (node.text ?? '') !== '') {
    const m = opts.measureText
    ln.measureText = (maxWidth: number) => m(node, maxWidth)
  }

  // 绘制属性透传（指令流生成用——不参与布局：布局与绘制是两个阶段）
  ;(ln as LayoutNode & { __paint?: unknown }).__paint = {
    paint: P,
    text: T,
    hint: node.props.paintHint,
    kind: node.kind,
    literal: node.text,
    fallbackWidth: declaredW,
    fallbackHeight: declaredH,
  }

  return ln
}

/** 读取适配层挂载的绘制信息（指令流生成消费） */
export interface PaintInfo {
  paint: PNode['props']['paint']
  text?: PNode['props']['text']
  hint: PNode['props']['paintHint']
  kind: PNode['kind']
  literal?: string
  fallbackWidth?: number
  fallbackHeight?: number
}

export function paintInfoOf(node: LayoutNode): PaintInfo | undefined {
  return (node as LayoutNode & { __paint?: PaintInfo }).__paint
}
