// packages/layout-core/src/flex.ts
// ★★M1：**Flexbox 布局求解**（Node 参考实现——M2+ 移植 C++，本文件是对拍基准）。
//
// 协议约束（计划 D3，直接抄 Compose 相对 View 体系做对的地方）：
//   · **约束自顶向下**：父把可用尺寸传给子
//   · **尺寸自底向上**：子的内容尺寸回传给父
//   · **严格单次测量**：每个节点在一次布局中**只被测量一次**（`measureCalls ≈ nodeCount` 是门禁判据）
//     —— 禁 View 体系那种「父子多轮 measure」
//
// 为什么单次测量这么重要（本仓已实测的相关证据）：
//   · 我们已测：commit 成本由**节点总数**决定（+870%），故布局阶段的每次遍历都必须 O(n)
//   · 多轮 measure 在深层树里会退化成 O(n·depth)，这正是 Compose 相对 View 体系的优势来源
//
// 单次测量怎么做到（本实现的两条纪律，改动时不得破坏）：
//   ① 尺寸只在 `measureNode` 决定，且每节点只被父级调用一次；
//   ② 凡是「子级需要的最终尺寸」（flex-basis 主轴、stretch 交叉轴）都在**测量时**以紧约束下发，
//      而不是测量后再改子级矩形——后者会让子级内部的排布基于旧尺寸（经典两遍布局错误）。
//
// 实现范围（CSS Profile L2 的 flex 子集）：
//   flex-direction（row/column/row-reverse/column-reverse）· justify-content · align-items · align-self
//   · flex-grow/shrink/basis · gap/row-gap/column-gap · margin/padding · width/height/min/max
//   · position: relative/absolute（absolute 脱离流，按 inset 定位）· display:none（不参与布局）
//
// ★未实现（诚实边界，M1 范围外）：
//   · flex-wrap（多行）——Profile L2 标记为可用，但 M1 先做单行（长列表场景以 virtual-list 承接）
//   · align-content（仅 wrap 下有意义）
//   · grid（Profile 明确「待定」）
//   · 文本内部的换行/断行（`measureText` 由平台注入：平台返回在给定最大宽下的**换行后尺寸**）
//   · overflow 只影响裁剪（绘制期），不参与布局
import type { Constraints, LayoutDiagnostic, LayoutNode, LayoutResult, Rect, Size } from './types'
import { UNBOUNDED, clampSize, isUnbounded } from './types'
import type { MeasureCache } from './dirty'
import { constraintKey } from './dirty'

/** 求解上下文（统计 + 诊断——可观测性要求：布局可解释） */
interface SolveCtx {
  rects: Map<number, Rect>
  diagnostics: LayoutDiagnostic[]
  measureCalls: number
  /** 命中度量缓存的次数（增量重排的读数——见 M1-3） */
  measureReused: number
  /** 精化测量次数（主轴尺寸变化后对子树的二次排布——见 layoutChildren ★③） */
  refineCalls: number
  relayoutCount: number
  /** 度量缓存（可选：不传 = 全量重排） */
  cache?: MeasureCache
  /**
   * 文本度量记忆化：`nodeId → (maxWidth → Size)`。
   * ★精化重排会再次走到叶子，但**文本 shaping 绝不能重跑**（平台侧最贵的一步）——
   *   Profile §5.3 的「度量按 (文本, 字体, 宽度约束) 缓存」即指此表。
   */
  textCache: Map<number, Map<number, Size>>
}

/** 已测量的子级（主轴/交叉轴的中间态） */
interface MeasuredChild {
  node: LayoutNode
  /** CSS 主轴基准尺寸（不含 margin） */
  mainBase: number
  /** 交叉轴基准尺寸（不含 margin） */
  crossBase: number
  mainMargin: number
  crossMargin: number
  /** 主轴是否已被 flex-basis 锁定（用于诊断） */
  basisLocked: boolean
  /** 基础测量所用的约束（精化测量在其基础上只改主轴——见「精化」段） */
  baseConstraint: Constraints
}

/**
 * 无界归一化（边界处唯一转换点）：
 * 内部用 `Infinity` 表示「不限」，而 `Constraints` 契约用 `NaN`（UNBOUNDED）——
 * ★两种「无界」表示混用是本层最容易出错的地方（曾导致 `Infinity` 漏进契约、被当成有限值参与 min()），
 *   故只在构造 Constraints 时经此函数转换。
 */
function bounded(v: number): number {
  return Number.isFinite(v) ? Math.max(0, v) : UNBOUNDED
}

/** 对齐值归一（`auto`/空 → 回退到容器值） */
function alignOf(child: LayoutNode, container: LayoutNode): string {
  const a = child.alignSelf
  return a && a !== 'auto' ? a : container.alignItems
}

/**
 * 计算**子级（或根）**的测量约束。★这是百分比语义的唯一落点。
 *
 * 优先级（CSS 语义）：
 *   主轴：`flex-basis`（数或比例）> 主轴尺寸（数或比例）> 内容自适应
 *   交叉轴：交叉尺寸（数或比例）> stretch 拉伸 > 内容自适应
 *
 * `%` 基准 = **父内容盒**对应维度（调用方传已扣掉 padding 的 `availW/availH`）——
 * 这正是不能在适配层解算的原因（父的内容盒要等布局才知道）。
 *
 * ★签名刻意收 **W/H**（而不是 main/cross）——主轴/交叉轴的换算只在本函数内部发生一次，
 *   调用方无需（也不应）自己做轴换算：曾经因调用方传错顺序导致整棵树尺寸横纵颠倒。
 */
function constraintFor(
  child: LayoutNode,
  availW: number,
  availH: number,
  horizontal: boolean,
  crossMargin: number,
  align: string,
): Constraints {
  const availMain = horizontal ? availW : availH
  const availCross = horizontal ? availH : availW

  // ── 主轴
  const basisAbs = typeof child.flexBasis === 'number' ? child.flexBasis : undefined
  const basisRatio = child.flexBasisRatio
  const sizeAbs = horizontal ? child.width : child.height
  const sizeRatio = horizontal ? child.widthRatio : child.heightRatio

  let mainConstraint: number
  let mainTight: boolean
  if (basisAbs !== undefined && !isUnbounded(availMain)) {
    mainConstraint = basisAbs
    mainTight = true
  } else if (basisRatio !== undefined && !isUnbounded(availMain)) {
    mainConstraint = basisRatio * availMain
    mainTight = true
  } else if (typeof sizeAbs === 'number') {
    // 绝对值不设紧约束（值已写入节点，测量时自然生效；设紧约束反而会掩盖 min/max）
    mainConstraint = bounded(availMain)
    mainTight = false
  } else if (sizeRatio !== undefined && !isUnbounded(availMain)) {
    mainConstraint = sizeRatio * availMain
    mainTight = true
  } else {
    // ★主轴为 auto → CSS 的 **flex base size = max-content**（不是「填满可用」）：
    //   必须用**无界主轴**测量，否则子级内部会用「拉伸/填满」来回答，把基尺寸撑到可用宽，
    //   使 grow/shrink 分配全盘错误（本仓 M1-5 对拍实测：嵌套 row→column 用例差 112dp）。
    //   实测对照：父 340 可用、grow 子内容仅 34 → 浏览器给 228（34 + 余量 194），旧实现给 253.45。
    mainConstraint = UNBOUNDED
    mainTight = false
  }

  // ── 交叉轴
  const crossAbs = horizontal ? child.height : child.width
  const crossRatio = horizontal ? child.heightRatio : child.widthRatio
  const crossDeclared = typeof crossAbs === 'number' || crossRatio !== undefined
  let crossConstraint: number
  let crossTight: boolean
  if (crossRatio !== undefined && !isUnbounded(availCross)) {
    crossConstraint = crossRatio * availCross
    crossTight = true
  } else if (align === 'stretch' && !crossDeclared && Number.isFinite(availCross)) {
    // ★stretch 只在交叉尺寸为 auto 时生效；且仍受自身 margin 挤占
    crossConstraint = Math.max(0, availCross - crossMargin)
    crossTight = true
  } else {
    crossConstraint = bounded(availCross)
    crossTight = false
  }

  return horizontal
    ? { availableWidth: mainConstraint, availableHeight: crossConstraint, tightWidth: mainTight, tightHeight: crossTight }
    : { availableWidth: crossConstraint, availableHeight: mainConstraint, tightWidth: crossTight, tightHeight: mainTight }
}

/**
 * 节点「自身尺寸」（不含 margin；含 padding）——在给定约束下。
 * ★本函数是**唯一**决定尺寸的地方；每个节点每次布局只应被调用一次（单次测量的实现保障）。
 *
 * M1-3 增量路径：未变更子树且约束签名未变 → **直接复用上次尺寸、不下钻**
 * （文本 shaping 与子树求解一并跳过；这是布局里唯一昂贵的一步）。
 * 定位仍由 `solveLayout` 的 `apply` 全量重算——那是 O(n) 指针算术，不需要重新测量。
 */
function measureNode(node: LayoutNode, c: Constraints, ctx: SolveCtx): Size {
  ctx.measureCalls++
  // ★记录本次测量所用约束（M1-3 布局边界的作用域重排要复用——见 dirty.relayoutScoped）
  node.lastConstraints = c
  let key: string | undefined
  if (ctx.cache) {
    key = constraintKey(c, node)
    if (!node.dirty) {
      const hit = ctx.cache.entries.get(node.id)
      if (hit && hit.key === key) {
        ctx.cache.hits++
        ctx.measureReused++
        node.contentSize = hit.size
        return hit.size
      }
    }
    if (node.dirty) ctx.cache.misses++
  }
  const size = measureNodeInner(node, c, ctx)
  if (ctx.cache && key !== undefined) ctx.cache.entries.set(node.id, { key, size })
  return size
}

/** 真实测量（无缓存路径）——单次测量的实现保障都在这里 */
function measureNodeInner(node: LayoutNode, c: Constraints, ctx: SolveCtx): Size {
  const horizontal = node.flexDirection === 'row' || node.flexDirection === 'row-reverse'

  // display:none → 零尺寸且不参与父级排布（父级在 layoutChildren 里已过滤，此处兜底）
  if (node.display === 'none') return { width: 0, height: 0 }

  // ① 显式尺寸优先（width/height 已由 M0 折叠为绝对值）
  let width = typeof node.width === 'number' ? node.width : undefined
  let height = typeof node.height === 'number' ? node.height : undefined

  // ② 紧约束覆盖显式尺寸（父级强制：flex-basis 主轴 / stretch 交叉轴 / 百分比已解算）
  if (c.tightWidth && !isUnbounded(c.availableWidth)) width = c.availableWidth
  if (c.tightHeight && !isUnbounded(c.availableHeight)) height = c.availableHeight
  // ★min/max 在紧约束之后夹取（CSS 语义：min/max 优先于 width 与 flex-basis）
  if (width !== undefined) width = clampSize(width, node.minWidth, node.maxWidth)
  if (height !== undefined) height = clampSize(height, node.minHeight, node.maxHeight)

  const padW = node.padding.left + node.padding.right
  const padH = node.padding.top + node.padding.bottom

  // 可用内容区（供子级）——内部统一用 Infinity 表示「不限」
  const availW = width !== undefined ? Math.max(0, width - padW) : isUnbounded(c.availableWidth) ? Infinity : Math.max(0, c.availableWidth - padW)
  const availH = height !== undefined ? Math.max(0, height - padH) : isUnbounded(c.availableHeight) ? Infinity : Math.max(0, c.availableHeight - padH)

  // ③ 叶子文本：由平台度量注入（单次调用——文本度量可缓存，见计划 §5.3）
  //   ★即便主轴已被父级锁死（width 有值），仍需度量文本以取得**换行后的高度**——
  //     否则定宽文本会被算成零高（父级高由内容撑开时直接算错）。
  if (node.children.length === 0 && node.measureText) {
    const maxW = Number.isFinite(availW) ? availW : Infinity
    const t = measureTextCached(node, maxW, ctx)
    return finalize(node, {
      width: width ?? t.width + padW,
      height: height ?? t.height + padH,
    }, c)
  }

  // ④ 有子级：单遍排布（子级各测量一次）
  if (node.children.length > 0) {
    // 容器交叉轴尺寸是否已定：row 看 height，column 看 width（未定则由内容极值决定）
    const crossKnown = horizontal ? height !== undefined : width !== undefined
    const laid = layoutChildren(node, availW, availH, horizontal, crossKnown, ctx)
    if (width === undefined) width = laid.width + padW
    if (height === undefined) height = laid.height + padH
  }

  // ⑤ 兜底：无内容无尺寸 → 0（但保留 padding）
  if (width === undefined) width = padW
  if (height === undefined) height = padH

  return finalize(node, { width, height }, c)
}

/** 文本度量（记忆化——同一 (节点, 最大宽) 只向平台要一次；精化重排复用） */
function measureTextCached(node: LayoutNode, maxW: number, ctx: SolveCtx): Size {
  const fn = node.measureText
  if (!fn) return { width: 0, height: 0 }
  let per = ctx.textCache.get(node.id)
  if (!per) {
    per = new Map()
    ctx.textCache.set(node.id, per)
  }
  const hit = per.get(maxW)
  if (hit) return hit
  const t = fn(maxW)
  per.set(maxW, t)
  return t
}

/** 夹取 min/max 并处理紧约束（测量出口唯一） */
function finalize(node: LayoutNode, size: Size, c: Constraints): Size {
  let { width, height } = size
  if (c.tightWidth && !isUnbounded(c.availableWidth)) width = c.availableWidth
  if (c.tightHeight && !isUnbounded(c.availableHeight)) height = c.availableHeight
  width = clampSize(width, node.minWidth, node.maxWidth)
  height = clampSize(height, node.minHeight, node.maxHeight)
  node.contentSize = { width, height }
  return { width, height }
}

/**
 * 排布子级（**单遍**）：先算各子基准尺寸 → flex-grow/shrink 分配主轴余量 → 定位。
 * 返回**内容盒尺寸（物理宽高，不含 padding）**——★注意不是主轴/交叉轴顺序。
 */
function layoutChildren(
  node: LayoutNode,
  availW: number,
  availH: number,
  horizontal: boolean,
  /** 容器交叉轴尺寸是否已确定（显式/tight）——决定对齐参照系（见 ★交叉轴对齐的参照系） */
  crossKnown: boolean,
  ctx: SolveCtx,
): Size {
  const visible = node.children.filter((c) => c.display !== 'none' && c.position !== 'absolute')
  const absolutes = node.children.filter((c) => c.display !== 'none' && c.position === 'absolute')

  const gap = horizontal ? (node.columnGap ?? node.gap) : (node.rowGap ?? node.gap)
  /** 主轴可用尺寸（`Infinity` = 不限） */
  const mainAvail = horizontal ? availW : availH
  /** 交叉轴可用尺寸 */
  const crossAvail = horizontal ? availH : availW

  // ① 测量每个子（**各一次**——单次测量的核心保障）
  const measured: MeasuredChild[] = []
  for (const child of visible) {
    const mMain = horizontal ? child.margin.left + child.margin.right : child.margin.top + child.margin.bottom
    const mCross = horizontal ? child.margin.top + child.margin.bottom : child.margin.left + child.margin.right
    const align = alignOf(child, node)

    // ★主轴/交叉轴约束统一由 constraintFor 决定（百分比语义的唯一落点）
    const c = constraintFor(child, availW, availH, horizontal, mCross, align)
    const hasBasis = typeof child.flexBasis === 'number' || child.flexBasisRatio !== undefined

    const size = measureNode(child, c, ctx)
    measured.push({
      node: child,
      mainBase: horizontal ? size.width : size.height,
      crossBase: horizontal ? size.height : size.width,
      mainMargin: mMain,
      crossMargin: mCross,
      basisLocked: hasBasis,
      baseConstraint: c,
    })
  }

  const totalGap = Math.max(0, measured.length - 1) * gap
  const totalMain = measured.reduce((s, m) => s + m.mainBase + m.mainMargin, 0) + totalGap
  const freeSpace = Number.isFinite(mainAvail) ? mainAvail - totalMain : 0

  // ② 主轴余量分配：flex-grow（正余量）/ flex-shrink（负余量，按 shrink × base 加权）
  //   ★含 min/max 夹取的**冻结—再分配**循环（CSS flex 解析算法 §9.7）：
  //     某子级被 max/min 夹住后，它「少占/多占」的空间必须重新分配给**未冻结**的兄弟，
  //     否则容器主轴会出现空隙（本仓 M1-5 实测：max-width:60 的子级夹取后，
  //     35dp 余量没有转给兄弟，浏览器 130 vs 求解器 95）。
  const finalMain = new Map<number, number>()
  const frozen = new Set<number>()
  const minMainOf = (m: MeasuredChild): number | undefined => (horizontal ? m.node.minWidth : m.node.minHeight)
  const maxMainOf = (m: MeasuredChild): number | undefined => (horizontal ? m.node.maxWidth : m.node.maxHeight)
  const growMode = freeSpace > 0

  for (const m of measured) finalMain.set(m.node.id, m.mainBase)

  // 未受限（Auto 主轴）时不做分配；但仍需夹取一次（CSS：min/max 恒生效）
  const distributing = Number.isFinite(mainAvail)
  for (let iter = 0; iter <= measured.length; iter++) {
    if (distributing) {
      let fixedMain = totalGap
      let unfrozenBase = 0
      for (const m of measured) {
        fixedMain += m.mainMargin
        if (frozen.has(m.node.id)) fixedMain += finalMain.get(m.node.id)!
        else unfrozenBase += m.mainBase
      }
      const free = mainAvail - fixedMain - unfrozenBase
      const weightOf = (m: MeasuredChild): number => (growMode ? m.node.flexGrow : m.node.flexShrink * m.mainBase)
      const weightTotal = measured.reduce((sum, m) => (frozen.has(m.node.id) ? sum : sum + weightOf(m)), 0)
      for (const m of measured) {
        if (frozen.has(m.node.id)) continue
        const extra = weightTotal > 0 ? (free * weightOf(m)) / weightTotal : 0
        finalMain.set(m.node.id, Math.max(0, m.mainBase + extra))
      }
    }
    // 夹取 + 收集违规项（冻结）
    let violated = false
    for (const m of measured) {
      if (frozen.has(m.node.id)) continue
      const v = finalMain.get(m.node.id)!
      const clamped = Math.max(0, clampSize(v, minMainOf(m), maxMainOf(m)))
      if (Math.abs(clamped - v) > 1e-9) {
        finalMain.set(m.node.id, clamped)
        frozen.add(m.node.id)
        violated = true
      }
    }
    if (!violated) break
  }

  let usedMain = totalGap
  for (const m of measured) usedMain += finalMain.get(m.node.id)! + m.mainMargin

  // ★③ 精化测量（refinement）：主轴尺寸被 grow/shrink 改变的子级，其**子树**必须按最终尺寸重排
  //
  //   为什么需要（单次测量下的必然结果）：基础测量回答的是「你的 max-content 是多少」，
  //   而最终尺寸由父级分配决定；两者不同时，子级内部（以及孙子级）的排布必须用最终尺寸重算，
  //   否则会出现「父盒子 228 宽、里面还按 34 宽摆」的错位（M1-5 对拍实测 112dp 偏差）。
  //
  //   为什么代价可控：
  //     · 只对**尺寸真的变了**且有内容的子级重算（显式尺寸的、没变的一律跳过）
  //     · **文本 shaping 不会重复触发**——`measureText` 走 (nodeId, maxWidth) 记忆化（Profile §5.3 的
  //       「度量按 (文本, 字体, 宽度约束) 缓存」正是为此）
  //     · 精化发生在**交叉轴极值与定位之前**，故交叉尺寸/对齐/裁剪都按最终值计算
  for (const m of measured) {
    const fin = finalMain.get(m.node.id)!
    if (Math.abs(fin - m.mainBase) <= 1e-6) continue
    if (m.node.children.length === 0 && !m.node.measureText) continue // 无内容 → 无子树可排
    const c2: Constraints = horizontal
      ? { ...m.baseConstraint, availableWidth: fin, tightWidth: true }
      : { ...m.baseConstraint, availableHeight: fin, tightHeight: true }
    ctx.refineCalls++
    const size2 = measureNode(m.node, c2, ctx)
    m.crossBase = horizontal ? size2.height : size2.width
    m.mainBase = fin // 记录最终值（供 relayoutCount 诊断与缓存一致性）
  }

  // ④ 主轴定位（justify-content）
  const remaining = Number.isFinite(mainAvail) ? Math.max(0, mainAvail - usedMain) : 0
  let cursor = 0
  let spacing = gap
  switch (node.justifyContent) {
    case 'center':
      cursor = remaining / 2
      break
    case 'flex-end':
    case 'end':
      cursor = remaining
      break
    case 'space-between':
      if (measured.length > 1) spacing = gap + remaining / (measured.length - 1)
      break
    case 'space-around':
      if (measured.length > 0) {
        const each = remaining / measured.length
        cursor = each / 2
        spacing = gap + each
      }
      break
    case 'space-evenly':
      if (measured.length > 0) {
        const each = remaining / (measured.length + 1)
        cursor = each
        spacing = gap + each
      }
      break
    default: // flex-start / start
      break
  }

  // ⑤ 交叉轴极值（stretch 已在测量时生效，此处只需统计）
  let maxCross = 0
  for (const m of measured) maxCross = Math.max(maxCross, m.crossBase + m.crossMargin)

  // ★auto 轴的容器尺寸 = **内容尺寸**（CSS：不按可用尺寸封顶——溢出交给 overflow 裁剪，不改变盒子尺寸）
  const contentMain = Number.isFinite(mainAvail) ? Math.min(usedMain, mainAvail) : usedMain
  const contentCross = maxCross

  // ★交叉轴对齐的参照系 = **容器内容盒的实际尺寸**，不是「可用空间」：
  //   容器交叉轴尺寸已定（显式/tight）→ 用它；未定（auto）→ 用内容极值。
  //   本仓 M1-5 实测：用可用空间（视口 667）居中 16dp 文本 → y=325.5，浏览器 y=2（差 323.5dp）。
  const crossContent = crossKnown && Number.isFinite(crossAvail) ? crossAvail : contentCross
  /** 内容盒（物理坐标，供 absolute 定位与返回值） */
  const contentW = horizontal ? contentMain : contentCross
  const contentH = horizontal ? contentCross : contentMain

  // ⑥ 写回子节点矩形（相对**父内容盒**左上角；绝对坐标由 solveLayout 的 apply 叠加）
  for (const m of measured) {
    const mainSize = finalMain.get(m.node.id)!
    const crossSize = m.crossBase
    const align = alignOf(m.node, node)
    const crossFree = Number.isFinite(crossContent) ? Math.max(0, crossContent - (crossSize + m.crossMargin)) : 0
    let crossPos = 0
    switch (align) {
      case 'center':
        crossPos = crossFree / 2
        break
      case 'flex-end':
      case 'end':
        crossPos = crossFree
        break
      default: // flex-start / stretch
        break
    }
    // position:relative → 布局同 static，事后按 inset 偏移（不影响兄弟）
    const relX = m.node.position === 'relative' ? (m.node.left ?? (m.node.right !== undefined ? -m.node.right : 0)) : 0
    const relY = m.node.position === 'relative' ? (m.node.top ?? (m.node.bottom !== undefined ? -m.node.bottom : 0)) : 0

    const x = (horizontal ? cursor + m.node.margin.left : crossPos + m.node.margin.left) + relX
    const y = (horizontal ? crossPos + m.node.margin.top : cursor + m.node.margin.top) + relY
    m.node.rect = {
      x,
      y,
      width: horizontal ? mainSize : crossSize,
      height: horizontal ? crossSize : mainSize,
    }
    cursor += mainSize + m.mainMargin + spacing
  }

  // ⑦ absolute 子级：按 inset 定位（**相对父 padding 盒**，CSS containing block 语义；不参与流式排布）
  if (absolutes.length > 0) {
    const padBoxW = contentW + node.padding.left + node.padding.right
    const padBoxH = contentH + node.padding.top + node.padding.bottom
    for (const abs of absolutes) {
      const ctxs: Constraints = {
        availableWidth: bounded(contentW),
        availableHeight: bounded(contentH),
        tightWidth: false,
        tightHeight: false,
      }
      const size = measureNode(abs, ctxs, ctx)
      const w = typeof abs.width === 'number' ? abs.width : size.width
      const h = typeof abs.height === 'number' ? abs.height : size.height
      // ★CSS containing block = 父的 **padding 盒**，其左/上边界即父 border-box 的左/上边界
      //   （border 为 0）——故 `left/top` 直接用，**不再叠加父 padding**。
      //   本仓 M1-5 实测：父 padding-left 30 时旧实现给 x=90，浏览器 60。
      let x = abs.left ?? 0
      let y = abs.top ?? 0
      if (abs.left === undefined && abs.right !== undefined) x = padBoxW - w - abs.right
      if (abs.top === undefined && abs.bottom !== undefined) y = padBoxH - h - abs.bottom
      abs.rect = { x, y, width: w, height: h }
    }
  }

  return { width: contentW, height: contentH }
}

/**
 * 求解整棵树（入口）：自顶向下传约束 → 自底向上回尺寸 → 写绝对坐标。
 * ★单遍遍历 + 每个节点**一次**测量（`measureCalls` 统计可验证——见出口条件门禁）。
 */
export function solveLayout(root: LayoutNode, constraints: Constraints, opts: { cache?: MeasureCache } = {}): LayoutResult {
  const ctx: SolveCtx = {
    rects: new Map(),
    diagnostics: [],
    measureCalls: 0,
    measureReused: 0,
    refineCalls: 0,
    relayoutCount: 0,
    textCache: new Map(),
    cache: opts.cache,
  }

  // ★根节点与 flex 项**语义不同**：宿主机（视口/容器）给的是一个真实的盒，
  //   不存在「父级稍后再拉伸我」的情形——故不做 max-content 基尺寸推导（那是 flex 项才有的语义）。
  //   仅在此解算根自身的百分比尺寸（基准 = 传入的约束盒）；调用方声明的紧约束始终保留。
  let rootAvailW = constraints.availableWidth
  let rootAvailH = constraints.availableHeight
  let rootTightW = constraints.tightWidth
  let rootTightH = constraints.tightHeight
  if (root.widthRatio !== undefined && Number.isFinite(rootAvailW)) {
    rootAvailW = root.widthRatio * rootAvailW
    rootTightW = true
  }
  if (root.heightRatio !== undefined && Number.isFinite(rootAvailH)) {
    rootAvailH = root.heightRatio * rootAvailH
    rootTightH = true
  }
  const size = measureNode(
    root,
    { availableWidth: rootAvailW, availableHeight: rootAvailH, tightWidth: rootTightW, tightHeight: rootTightH },
    ctx,
  )
  // 根节点定位在原点（根 margin 忽略——由调用方决定）
  root.rect = { x: 0, y: 0, width: size.width, height: size.height }

  // 绝对坐标叠加（自顶向下一次遍历）
  const apply = (node: LayoutNode, ox: number, oy: number): void => {
    const r = node.rect ?? { x: 0, y: 0, width: 0, height: 0 }
    const abs: Rect = { x: ox + r.x, y: oy + r.y, width: r.width, height: r.height }
    ctx.rects.set(node.id, abs)
    for (const child of node.children) {
      // ★display:none 的子树**在 CSS 中没有盒子**（getBoundingClientRect 全 0）——
      //   不写入 rects（保持「rects 中的节点 = 有盒节点」的不变式），也不下钻
      if (child.display === 'none') continue
      // ★子级坐标系原点：常规子级 = 父内容盒左上（padding 之内）；
      //   absolute 子级 = 父 **padding 盒**左上（CSS containing block 语义——layoutChildren 已按 padding 盒写坐标）
      if (child.position === 'absolute') apply(child, abs.x, abs.y)
      else apply(child, abs.x + node.padding.left, abs.y + node.padding.top)
    }
  }
  apply(root, 0, 0)

  // 校验：单次测量的判据（远小于 2× 说明没有多轮 measure）
  if (ctx.measureCalls > ctx.rects.size * 2) {
    ctx.diagnostics.push({
      severity: 'error',
      code: 'layout.multi-pass',
      message: `测量次数 ${ctx.measureCalls} 超过节点数 ${ctx.rects.size} 的 2 倍——违反单次测量约束（D3）`,
    })
  }

  // 标记整棵树为干净（本次求解已消化全部脏节点——下次 `markDirty` 才能重新触发增量），
  // 同时统计本次**实际重排的节点数**（脏标记是「已受影响」的传播结果，可直接作为读数）
  const clearDirty = (n: LayoutNode): void => {
    if (n.dirty) ctx.relayoutCount++
    n.dirty = false
    for (const c of n.children) clearDirty(c)
  }
  clearDirty(root)

  return {
    rects: ctx.rects,
    diagnostics: ctx.diagnostics,
    stats: {
      nodeCount: ctx.rects.size,
      measureCalls: ctx.measureCalls,
      measureReused: ctx.measureReused,
      refineCalls: ctx.refineCalls,
      relayoutCount: ctx.relayoutCount,
    },
  }
}

/** 便捷：从 LayoutNode 读出绝对矩形（缺省零矩形——便于断言时给出可读失败） */
export function rectOf(result: LayoutResult, id: number): Rect {
  return result.rects.get(id) ?? { x: 0, y: 0, width: 0, height: 0 }
}

export { measureNode as __measureNodeForTest }
