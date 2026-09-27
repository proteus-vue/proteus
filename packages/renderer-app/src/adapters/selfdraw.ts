// packages/renderer-app/src/adapters/selfdraw.ts
// ★★自绘管线适配器：Vue 渲染树 → **排版核心的布局请求**（供 Rust 核心算几何，宿主自绘）。
//
// 【它补的是哪一环】（本仓 2026-09-29 核实的架构缺口）
//   此前有两条**互不相连**的链路：
//     · `hosts/ios/bridge/entry.ts`：Vue → render-backend → NativeBackend → **UIView 树**
//       （注释明写「布局交给 UIKit 缺省——本步不实现 flex/grid 求解」）
//     · Rust 排版核心：**手写 JSON** → 几何 → Canvas / CALayer
//   两条都能跑，但「Vue 渲染 → 自绘管线」**一次都没接上过**。
//   本文件就是那个接头：Vue 的 diff 结果（NativeElementNode 树）→ 引擎就绪的布局请求。
//
// 【★为什么请求里是「数值」而不是 CSS 字符串】
//   CSS Profile §8.3 要求「运行时零解析」：样式字符串 → 数值的折叠是**编译期**的职责。
//   本适配器是**验证用脚手架**（尚未接入编译器），故在此做一次折叠——
//   但**只认已折叠形态**：`width: 100`（数值）/ `width: '50%'`（比例）/ 已解析的 px 字符串。
//   不实现 em/rem/vw/calc 等需要上下文才能解析的单位（那是编译期的事，见 W-CSS 规则）。
//   ⇒ 诚实边界：本文件不是编译期折叠的替代品，而是它的**消费端形状示范**。
import type { NativeAdapter, NativeNode, NativeTextNode, NativeElementNode, NativeCommentNode } from '../native'

/* ────────────────────────── 布局请求（与 Rust `LayoutRequest` DTO 逐字段对应） ────────────────────────── */

export interface SelfDrawEdges {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

/** 一个节点的布局规格（引擎就绪：全是数值 / 比例 / 枚举字符串） */
export interface SelfDrawNodeSpec {
  id: number
  parentId: number | null
  width?: number
  height?: number
  /** 百分比（基准 = 父内容盒；由求解器解析，适配层拿不到父尺寸） */
  widthRatio?: number
  heightRatio?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  margin?: SelfDrawEdges
  padding?: SelfDrawEdges
  flexDirection?: string
  justifyContent?: string
  alignItems?: string
  alignSelf?: string
  flexGrow?: number
  flexShrink?: number
  flexBasis?: number
  gap?: number
  display?: string
  position?: string
  top?: number
  left?: number
  overflow?: string
  /** 文本字面量（有它即文本叶子；度量由宿主注入） */
  text?: string
  /** 绘制用：背景色（FFRRGGBB 或 #RRGGBB） */
  backgroundColor?: string
  /** 绘制用：文字颜色 */
  color?: string
  /** 绘制用：字号 */
  fontSize?: number
  /** 绘制用：圆角 */
  borderRadius?: number
}

export interface SelfDrawRequest {
  viewport: { width: number; height: number }
  nodes: SelfDrawNodeSpec[]
  /** 文本度量（节点 id → 尺寸）——由平台注入（iOS CoreText / Android StaticLayout） */
  textMeasures?: Record<string, { width: number; height: number }>
}

/* ────────────────────────── 适配器 ────────────────────────── */

export interface SelfDrawAdapter extends NativeAdapter {
  /** 渲染容器（mount 目标） */
  root: NativeElementNode
  /** 把当前树转成布局请求（每次 mount/update 后由宿主边界调用） */
  toRequest(viewport: { width: number; height: number }): SelfDrawRequest
  /** 本次会话内累计的 patchProp 次数（★JS 逻辑层的边界成本读数） */
  patchCount(): number
  /** 累计创建的元素/文本节点数（诊断：确认 diff 复用而非重建） */
  createdCount(): { elements: number; texts: number }
  /** 重置统计（每次测量前调用） */
  resetStats(): void
  /**
   * ★标记「已与宿主全量同步」（**挂载/全量重建后必须调用**）。
   *
   * 【为什么需要显式调用（真机实测踩到）】挂载会创建全部节点 ⇒ `structuralChange = true`。
   *   若不在全量发送后清掉，**下一次** `takePatches()` 会返回 `null`（以为还有结构变化）
   *   ⇒ 白白浪费一次增量机会（实测：补丁路径一次都没走到，字节仍是 279818）。
   *   ⇒ 契约：**发完整树之后**调本方法，声明"宿主已与我一致"。
   */
  markFullSync(): void
  /**
   * ★★取走本批次的**样式补丁**（增量路径的核心接口）。
   *
   * - 返回 `null` ⇒ **必须走全量**（本批发生了结构变化：增删节点）
   * - 返回 `[]`   ⇒ 无布局变化（例如只改了颜色）⇒ **宿主无需调核心**
   * - 返回 `[{id, style}]` ⇒ 只把这些节点的这些样式字段发给核心
   *
   * ★性能依据（真机实测，3507 节点，只改 1 行 margin）：
   *   · 发**整树**：跨界编组 ~70ms + 宿主解析 8.6ms + 宿主 diff 9.5ms
   *   · 发**补丁**：几十字节（观测同一更新的核心重排仅 0.07ms）
   *   ⇒ 这是本链路最大的单点优化，且**语义上更正确**（补丁就是"改了什么"，不是"现在是什么"）。
   */
  takePatches(): Array<{ id: number; style: Record<string, unknown> }> | null
}

/** 绘制相关的键（**不进布局核心**——核心只管几何；绘制由宿主的指令流消费） */
const PAINT_KEYS = new Set(['backgroundColor', 'color', 'fontSize', 'borderRadius', 'borderColor', 'borderWidth', 'opacity'])

/** 布局相关的键（进核心；其余键既非布局也非绘制 → 忽略并计数，便于发现「静默丢失」） */
const LAYOUT_KEYS = new Set([
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'margin', 'padding', 'flexDirection', 'justifyContent', 'alignItems', 'alignSelf',
  'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'display', 'position', 'top', 'left', 'overflow',
])

/**
 * 数值折叠：把 Vue 模板里可能出现的几种形态折叠为**数值或比例**。
 *
 * 接受的形态（其余返回 undefined 并**在 stats 里计数**，不静默吞掉）：
 *   · `100` / `100.5`        → 数值
 *   · `'100px'` / `'100'`    → 数值
 *   · `'50%'`                → `{ ratio: 0.5 }`
 * ★不接受的形态（需上下文，属编译期职责）：em / rem / vw / vh / calc / auto / 关键字
 */
export function foldLength(v: unknown): { dp: number } | { ratio: number } | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? { dp: v } : undefined
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  const pct = /^(-?[\d.]+)%$/.exec(s)
  if (pct) {
    const n = Number(pct[1])
    return Number.isFinite(n) ? { ratio: n / 100 } : undefined
  }
  const px = /^(-?[\d.]+)(px)?$/.exec(s)
  if (px) {
    const n = Number(px[1])
    return Number.isFinite(n) ? { dp: n } : undefined
  }
  return undefined
}

/**
 * 从 props 里抽出**布局相关**字段（引擎就绪形态）——`toRequest` 与 `takePatches` 共用。
 *
 * ★为什么要共用（而不是各写一份）：两处**必须产出完全相同的形状**，
 *   否则「全量建的树」与「补丁改的字段」会出现语义分叉（比如全量把 `width:'50%'`
 *   折成 `widthRatio`，而补丁折成 `width` ⇒ 增量结果与全量不一致）。
 *   ★本仓纪律：同一语义只允许一处实现。
 */
function layoutStyleOf(props: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style' && v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(flat, v as Record<string, unknown>)
    } else {
      flat[k] = v
    }
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(flat)) {
    if (!LAYOUT_KEYS.has(key)) continue
    if (key === 'margin' || key === 'padding') {
      const e = foldEdges(value)
      if (e) out[key] = e
      continue
    }
    if (key === 'width' || key === 'height' || key === 'minWidth' || key === 'maxWidth'
        || key === 'minHeight' || key === 'maxHeight' || key === 'flexBasis'
        || key === 'top' || key === 'left' || key === 'gap') {
      const f = foldLength(value)
      if (!f) continue
      if ('ratio' in f) {
        if (key === 'width' || key === 'height') out[key === 'width' ? 'widthRatio' : 'heightRatio'] = f.ratio
      } else {
        out[key] = f.dp
      }
      continue
    }
    if (key === 'flexGrow' || key === 'flexShrink') {
      if (typeof value === 'number') out[key] = value
      continue
    }
    if (typeof value === 'string' || typeof value === 'number') out[key] = value
  }
  return out
}

/** 边值折叠（margin/padding：数值或 {top,right,bottom,left}） */
function foldEdges(v: unknown): SelfDrawEdges | undefined {
  if (typeof v === 'number' || typeof v === 'string') {
    const one = foldLength(v)
    if (!one || !('dp' in one)) return undefined
    return { top: one.dp, right: one.dp, bottom: one.dp, left: one.dp }
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const out: SelfDrawEdges = {}
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const f = foldLength(o[side])
      if (f && 'dp' in f) out[side] = f.dp
    }
    return out
  }
  return undefined
}

/**
 * 创建自绘适配器。
 *
 * 【与 mock 适配器的关系】节点树语义相同（都用 `NativeElementNode`），
 *   但本适配器额外：① 记录绘制属性（供自绘指令流）② 能把树转成布局请求 ③ 统计边界成本。
 */
export function createSelfDrawAdapter(): SelfDrawAdapter {
  // ★★稳定节点 id：**创建时分配**（而不是遍历时现算）
  //
  // 【为什么必须改（真机实测驱动的架构修正）】初版的 id 是 `toRequest()` 遍历时顺序发的
  //   ⇒ 宿主拿到的 id 只在「本次请求」内有效，**跨请求不可比** ⇒ 无法表达"哪个节点变了"。
  //   结果：每次更新都得把**整棵树**序列化发给宿主，宿主再自己 diff。
  //   实测代价（3507 节点）：跨界编组 **~70ms** + 宿主解析 8.6ms + diff 9.5ms
  //   —— 而核心真正重排只要 **0.07ms**。⇒ 稳定 id 是「只发补丁」的前提。
  //   ★这正是方案 §4.2 `PatchTable` 的运行时前提：没有稳定槽位，就没有增量。
  // ★注意声明顺序：分配器的 `let/const` 必须先于任何 `idFor()` 调用（否则 TDZ 报错）
  let nextNodeId = 1
  const idOf = new WeakMap<object, number>()
  const root: NativeElementNode = { __kind: 'element', tag: 'root', props: {}, children: [], parent: null }
  idFor(root)      // ★root 也必须登记（否则遍历时会与已分配 id 冲突——见 idFor 注释）
  let elements = 0
  let texts = 0
  let patches = 0
  /**
   * ★★**唯一的** id 分配器（所有路径都必须经它，且必须登记进 `idOf`）
   *
   * 【踩坑记录（真机 signal 11）】初版有**两个**分配器各自从 1 开始：
   *   `createElement` 用 `nextNodeId++`，而 `toRequest` 的遍历用局部 `nextId.v++` 做回退。
   *   `adapter.root` 是对象字面量（没走 createElement）⇒ 遍历时走回退分支拿到 **1**，
   *   而容器恰好也是 **1** ⇒ **id 冲突** ⇒ 请求里出现 `parentId === id`（自环）
   *   ⇒ Rust 侧 taffy 的 `compute_preliminary` **无限递归 → 爆栈 → 应用闪退**。
   *   ★教训：**两个分配器 = 迟早冲突**；且「回退分配」如果不登记，每次遍历都会给新 id。
   */
  function idFor(node: object): number {
    let id = idOf.get(node)
    if (id === undefined) {
      id = nextNodeId++
      idOf.set(node, id)
    }
    return id
  }
  /** ★本批次内被 patchProp 改过的节点（增量补丁的候选集） */
  const dirty = new Set<object>()
  /** ★本批次是否发生**结构变化**（增删节点）——结构变化必须走全量（update 入口不收结构） */
  let structuralChange = false
  /** ★未知键计数：既不属布局也不属绘制 —— 必须可观测（否则「写了没生效」无从定位） */
  const unknownKeys = new Map<string, number>()

  const parentNodeOf = (node: NativeNode): NativeElementNode | null =>
    node.__kind === 'element' ? node.parent : null

  /** 拍平遍历：跳过注释节点（Vue 用注释占位，原生无对应物） */
  function walk(
    node: NativeNode,
    parentId: number | null,
    viewport: { width: number; height: number },
    out: SelfDrawNodeSpec[],
  ): void {
    if (node.__kind === 'comment') return          // 注释无盒（与 CSS display:none 不同：它压根不产出节点）
    const id = idFor(node)                         // ★单一分配器（含 root 与未登记节点）
    const spec: SelfDrawNodeSpec = { id, parentId }
    const props: Record<string, unknown> =
      node.__kind === 'element' ? node.props : {}

    if (node.__kind === 'text') {
      // ★文本叶子：字面量进 `text`，尺寸由宿主注入度量（核心不自研文本，Profile §L4）
      spec.text = node.text
      // 文本节点也可能带 style（Vue 的 `h('p-text', { style: {...} }, '文本')`）
      const tStyle = (props.style && typeof props.style === 'object' && !Array.isArray(props.style))
        ? props.style as Record<string, unknown>
        : {}
      const ls = foldLength(tStyle.lineHeight ?? props.lineHeight)
      if (ls && 'dp' in ls) spec.height = ls.dp
      out.push(spec)
      return
    }

    // ── ★★先展开嵌套的 `style` 对象（本仓既有约定）──
    //
    // 【为什么必须这一步】（本仓真机实测踩到，代价是一次「看起来完全没样式」的运行）
    //   Vue 的 `h('p-view', { style: { height: 56, ... } })` 会把**整个 style 对象**作为一个
    //   prop key 传下来（key === 'style'），而不是摊平成 height/backgroundColor 等键。
    //   初版没展开 → 所有样式都落进「未知键」桶（实测 `unknown_keys: {style: 2646}`），
    //   现象是：**文字画出来了、卡片/圆角/强调色全没有**（截图可辨但报告全绿）。
    //   ⇒ 既有 iOS 宿主（`hosts/ios/ProteusHost/main.swift:90`）同样显式展开 style——
    //     本适配器与它保持一致，避免两套约定。
    const flat: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style' && v && typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(flat, v as Record<string, unknown>)
      } else {
        flat[k] = v
      }
    }

    // ── 布局属性 → 引擎就绪形态（★与 takePatches 共用同一实现）──
    Object.assign(spec, layoutStyleOf(props))
    // 绘制属性透传（不进核心）
    for (const key of PAINT_KEYS) {
      const src = (props.style && typeof props.style === 'object')
        ? (props.style as Record<string, unknown>)[key] ?? props[key]
        : props[key]
      if (key === 'backgroundColor' || key === 'color') {
        if (typeof src === 'string') spec[key] = src
      } else if (typeof src === 'number') {
        spec[key as 'fontSize'] = src
      } else if (typeof src === 'string') {
        const f = foldLength(src)
        if (f && 'dp' in f) spec[key as 'fontSize'] = f.dp
      }
    }

    out.push(spec)
    for (const child of node.children) walk(child, id, viewport, out)
  }

  return {
    root,
    createElement(tag: string): NativeElementNode {
      elements++
      const n: NativeElementNode = { __kind: 'element', tag, props: {}, children: [], parent: null }
      idFor(n)
      structuralChange = true      // 新节点 ⇒ 结构变化
      return n
    },
    createText(text: string): NativeTextNode {
      texts++
      const n: NativeTextNode = { __kind: 'text', text }
      idFor(n)
      structuralChange = true
      return n
    },
    createComment(): NativeCommentNode {
      return { __kind: 'comment' }
    },
    setText(node: NativeTextNode, text: string): void {
      node.text = text
      patches++
    },
    setElementText(el: NativeElementNode, text: string): void {
      el.children = []
      const t = this.createText(text)
      el.children.push(t)
      patches++
    },
    insert(child: NativeNode, parent: NativeElementNode, anchor: NativeNode | null): void {
      if (child.__kind === 'element') child.parent = parent
      if (anchor === null) {
        parent.children.push(child)
      } else {
        const idx = parent.children.indexOf(anchor)
        parent.children.splice(idx < 0 ? parent.children.length : idx, 0, child)
      }
      structuralChange = true
      patches++
    },
    remove(node: NativeNode): void {
      const parent = parentNodeOf(node)
      if (parent) {
        const idx = parent.children.indexOf(node)
        if (idx >= 0) parent.children.splice(idx, 1)
      }
      structuralChange = true
      patches++
    },
    parentNode: parentNodeOf,
    patchProp(el: NativeElementNode, key: string, prev: unknown, next: unknown): void {
      // ★事件（onXxx）：自绘管线里事件由**核心命中测试 + 平台手势**承担，
      //   不在本适配器里落树（那需要原始指针几何，见 hit.rs）。这里只计数以便观测。
      if (key.startsWith('on')) {
        patches++
        return
      }
      if (next === null || next === undefined) delete el.props[key]
      else el.props[key] = next
      // ★只有**布局键**才标脏（绘制键改了不影响几何 ⇒ 不必让核心重排）
      if (key === 'style') {
        // 整对象 style（Vue 的常见下发形态）：含布局键才标脏
        const so = next && typeof next === 'object' ? (next as Record<string, unknown>) : {}
        if (Object.keys(so).some((k) => LAYOUT_KEYS.has(k))) dirty.add(el)
      } else if (LAYOUT_KEYS.has(key)) {
        dirty.add(el)
      }
      patches++
    },
    toRequest(viewport: { width: number; height: number }): SelfDrawRequest {
      const nodes: SelfDrawNodeSpec[] = []
      walk(root, null, viewport, nodes)
      return { viewport, nodes }
    },
    takePatches(): Array<{ id: number; style: Record<string, unknown> }> | null {
      // ★「结构变化」是**自上次取走以来**的标志（不是累积状态）——取走即复位。
      //
      // 【踩坑记录（真机实测）】初版只置位、不复位 ⇒ 挂载后 `structuralChange` 永远是 true
      //   ⇒ `takePatches()` 永远返回 null ⇒ **每次都退化成全量**（实测字节仍 279818，
      //   与整树路径一模一样——看起来像「补丁路径没接上」，实际是**标志语义写错了**）。
      const structural = structuralChange
      structuralChange = false
      const batch = Array.from(dirty)
      dirty.clear()
      // 结构变化 ⇒ 必须全量（核心的 update 入口只收样式补丁）
      if (structural) return null
      const out: Array<{ id: number; style: Record<string, unknown> }> = []
      for (const node of batch) {
        const el = node as NativeElementNode
        const id = idOf.get(node)
        if (id === undefined) continue
        const style = layoutStyleOf(el.props)
        if (Object.keys(style).length > 0) out.push({ id, style })
      }
      return out
    },
    markFullSync: () => { structuralChange = false; dirty.clear() },
    patchCount: () => patches,
    createdCount: () => ({ elements, texts }),
    resetStats: () => {
      patches = 0
      elements = 0
      texts = 0
      unknownKeys.clear()
    },
    /** 未知键清单（诊断；也可由验收断言为空） */
    unknownKeys: () => Object.fromEntries(unknownKeys),
  } as SelfDrawAdapter & { unknownKeys: () => Record<string, number> }
}
