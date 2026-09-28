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
  /**
   * ★★**字体维度签名**（进核心的度量缓存键）——由适配器按 `fontSize` 算出
   *
   * 【为什么必须有（本仓实测的静默错几何 + 性能双缺口）】
   *   核心的度量缓存键是 `(text_hash, max_w)`，而 hash 里唯一能区分字体的就是 `style_key`。
   *   · 恒为 0 ⇒ 同文本不同字号**错误共用**缓存项（实测：字号 16/28 都算 16 高，差 12dp）
   *   · 核心的保守处置是"`style_key == 0` ⇒ 回退节点寻址"（正确，但**失去跨节点复用**：
   *     500 行同文案要 500 次度量而不是 1 次）
   *   ⇒ 适配器把字体维度**算好下发**，两者兼得。
   *   ★取值约定：与宿主**度量输入同源**（当前 = `fontSize`）——将来若引入字重/字族，
   *     必须在此与宿主度量处**同时**扩展（否则键不覆盖新维度 ⇒ 又回到静默错几何）。
   */
  textStyleKey?: number
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
  /**
   * ★★取走本批次的**结构变更请求**（增删行的增量路径——供 `proteus_layout_splice`）。
   *
   * - 返回 `null`      ⇒ 本批无结构变更；
   * - 返回 `'full-required'` ⇒ 有结构变更但**本通道表达不了**（中间插入 / 既有节点移动）
   *   ⇒ 调用方**必须走全量**（宁可拒绝，不可静默错序——本仓纪律）。
   * - 返回 `{removes, inserts}` ⇒ 交给宿主 `splice` 入口（追加/删除的增量路径）。
   *
   * ★语义：**自上次取走以来**（取走即复位）——与 `takePatches` 同款（该坑已踩过两次）。
   */
  takeSplice(): { removes: number[]; inserts: Array<{ parentId: number; index: number; nodes: SelfDrawNodeSpec[] }> } | 'full-required' | null
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

/**
 * 布局子集的**稳定签名**（用来判断"布局上是否真的变了"）
 *
 * 只序列化布局字段 ⇒ 改颜色/圆角不会让节点标脏（绘制不影响几何）。
 * ★排序键 + 数值归一，保证同一布局产出同一签名（避免键序差异造成假变更）。
 */
function styleSig(v: unknown): string {
  if (!v || typeof v !== 'object') return ''
  const layout = layoutStyleOf(v as Record<string, unknown>)
  const keys = Object.keys(layout).sort()
  const parts: string[] = []
  for (const k of keys) {
    const val = layout[k]
    if (val && typeof val === 'object') {
      const sub = Object.keys(val as Record<string, unknown>).sort()
        .map((sk) => `${sk}:${(val as Record<string, unknown>)[sk]}`).join(',')
      parts.push(`${k}{${sub}}`)
    } else {
      parts.push(`${k}:${val}`)
    }
  }
  return parts.join('|')
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
  /**
   * ★★**文本内容更新**（文本节点 → 新文本）——走补丁通道，**不是**结构变更
   *
   * 【为什么必须单列（本仓实测：文本变更一直被迫走全量）】Vue 对 `h('p-text', {...}, '文案')`
   *   的内容更新走 `hostSetElementText`。而适配器首版**清空 children + 新建文本节点**
   *   ⇒ 置结构标志 ⇒ `takePatches()` 返回 null ⇒ **整树重发**（真机 S4：改 300 行文案
   *   要重发 280KB / 254ms，而核心侧真正需要的只是 300 条 SET_TEXT 补丁）。
   *   ⇒ 正解：**复用同一文本节点**（id 不变）⇒ 内容更新，id 稳定 ⇒ 可走补丁通道。
   *   ★与"结构变更走 splice"是同一原则的两面：**id 的稳定性决定能走哪条通道**。
   */
  const textDirty = new Map<object, string>()
  /** ★本批次是否发生**结构变化**（增删节点）——结构变化必须走全量（update 入口不收样式） */
  let structuralChange = false
  /**
   * ★节点 → 当前父（元素另有自带的 `parent` 字段，但**文本节点没有**）
   *
   * 【为什么必须有（本仓实测的结构增量前提）】Vue 的 nodeOps 里有两种"移动既有节点"的语义
   *   （keyed diff 的 `move` 走 `insert`；`setElementText` 整体替换子集）：
   *   · **移动**：`insert(existingChild, newParent, anchor)` —— 若不先把 child 从**原父**摘掉，
   *     JS 侧 children 里会**同时出现两份**（本仓实测：reverse 后遍历会发出重复 id）。
   *   · **替换/删除文本**：`NativeTextNode` **没有 parent 字段** ⇒ 旧实现 `remove(text)` 摘不掉它
   *     （`parentNodeOf` 只认元素），Rust 侧永远留着旧文本 ⇒ **层与树分叉**。
   *   ⇒ 用一张弱表记住每个节点当前的父：移动/摘除都能精确摘链，且不挡 GC。
   */
  const parentOf = new WeakMap<object, NativeElementNode>()
  /**
   * ★本批次是否**移动过既有节点**（keyed diff 的重排）
   *
   * 【为什么必须单独记（append-only splice 的表达力边界）】splice 只能表达
   *   「末尾追加 + 摘除子树」；**既有子节点的顺序变化**表达不了（核心侧数组序 = 布局序）。
   *   移动在 JS 侧**不新建节点**（createdNodes 为空、removedNodeIds 为空）⇒
   *   若不单独记，`takeSplice()` 会返回"无结构变更"，而实际顺序已变 ⇒ **静默错序**。
   *   ⇒ 检测到移动即返回 `'full-required'`（宁可全量，不可静默错序——本仓纪律）。
   */
  let movedExisting = false
  /**
   * ★★V7：结构变更的**明细**（新建 / 移除的节点）——用于产出 splice 请求
   *
   * 【为什么由适配器产出（而不是 SubscriptionTable）】结构指令必须携带**新节点的描述符**
   *   （tag/style/text）——那是"节点长什么样"的信息，只有**适配器**手里有
   *   （它持有完整的 NativeElementNode 树）。`SubscriptionTable` 里只有槽位元数据（"哪个槽位对应哪个属性"）
   *   ⇒ 层次不对。方案 §1.1 的 `LayoutTemplate` 在**编译器**场景下承担此事；
   *   而运行时（Vue 自定义渲染器）场景下，适配器就是天然的产出点。
   *
   * ★含**文本节点**（本仓实测的必须）——Vue 对 `h('p-text', {...}, '文本')` 走
   *   `hostSetElementText`：**替换**全部子节点。若只记元素不记文本，替换后就是
   *   "旧文本摘掉、新文本从不插入" ⇒ **文本消失**（几何与结构计数全都正常）。
   */
  const createdNodes = new Set<NativeNode>()
  /** 被移除的节点（其 id 已在树上失效 ⇒ splice 要摘掉它们） */
  const removedNodeIds = new Set<number>()
  /** ★未知键计数：既不属布局也不属绘制 —— 必须可观测（否则「写了没生效」无从定位） */
  const unknownKeys = new Map<string, number>()

  const parentNodeOf = (node: NativeNode): NativeElementNode | null =>
    node.__kind === 'element' ? node.parent : null

  /**
   * ★★把节点「拍平」成引擎就绪的 `SelfDrawNodeSpec`（**唯一实现**）
   *
   * 【为什么要抽出来（本仓实测的动机）】全量（`walk` → `toRequest`）与
   *   **结构变更增量**（`takeSplice` 的 inserts）都要产出这个规格——两份实现必然分叉
   *   ⇒ 新插入的行会**样式与全量树不一致**（静默错）。本仓纪律：同一语义一处实现。
   */
  function fillSpec(spec: SelfDrawNodeSpec, node: NativeNode): void {
    const props: Record<string, unknown> = node.__kind === 'element' ? node.props : {}

    if (node.__kind === 'text') {
      // ★文本叶子：字面量进 `text`，尺寸由宿主注入度量（核心不自研文本，Profile §L4）
      spec.text = node.text
      // 文本节点也可能带 style（Vue 的 `h('p-text', { style: {...} }, '文本')`）
      const tStyle = (props.style && typeof props.style === 'object' && !Array.isArray(props.style))
        ? props.style as Record<string, unknown>
        : {}
      const ls = foldLength(tStyle.lineHeight ?? props.lineHeight)
      if (ls && 'dp' in ls) spec.height = ls.dp
      // ★★**fontSize 与 textStyleKey 必须在这里下发**（本仓实测的真缺陷）
      //
      // 【故障链】本分支原有 `return` 在 paint 透传**之前** ⇒ 文本节点的 `fontSize`
      //   从未发出 ⇒ 宿主用 `?? 14` 兜底 ⇒ **所有文本按 14pt 度量与绘制**
      //   （16pt 标题与 13pt 说明长得一样）。两侧口径一致 ⇒ 不报错、几何自洽 ⇒ 长期隐身。
      //   ⇒ 见 tests/selfdraw-text-patch.test.ts 的 V8 两条用例。
      // ★★**从父元素继承** fontSize / color（本仓实测：这是必须的，不是优化）
      //
      // 【故障链（真机现象）】`h('p-text', { style: { fontSize: 24 } }, 'X')` 在 Vue 语义下
      //   渲染成 **`p-text` 元素（带 fontSize）+ 文本子节点（只有字面量）**
      //   ⇒ 若文本叶子只从**自己的 props** 找 fontSize，永远找不到
      //   ⇒ 宿主度量处 `fontSize ?? 14` 兜底 ⇒ **所有文本按 14pt 度量与绘制**
      //     （16pt 标题与 13pt 说明长得一样），且**两侧口径一致 ⇒ 不报错**。
      //   ⇒ 正解：文本叶子**继承父元素的字体/颜色**（正是 CSS 的继承语义：
      //     `font-size`/`color` 会从父元素继承到匿名文本节点）。
      const parent = node.__kind === 'text' ? (parentOf.get(node) ?? null) : null
      const pStyle = (parent && parent.props.style && typeof parent.props.style === 'object' && !Array.isArray(parent.props.style))
        ? parent.props.style as Record<string, unknown>
        : {}
      const fs = tStyle.fontSize ?? props.fontSize ?? pStyle.fontSize ?? (parent ? parent.props.fontSize : undefined)
      const fsNum = typeof fs === 'number' ? fs : (typeof fs === 'string' ? Number(fs.replace(/px$/i, '')) : NaN)
      if (Number.isFinite(fsNum) && fsNum > 0) {
        spec.fontSize = fsNum
        // ★字体维度进缓存键（与宿主度量输入同源：当前只有 fontSize 一个维度）
        spec.textStyleKey = Math.round(fsNum * 100)
      }
      // 同理继承颜色（否则文本用宿主的白色兜底 ⇒ 深色主题下说明文字看不见）
      const col = tStyle.color ?? props.color ?? pStyle.color ?? (parent ? parent.props.color : undefined)
      if (typeof col === 'string') spec.color = col
      return
    }
    if (node.__kind !== 'element') return

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
      }
    }
  }

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
    fillSpec(spec, node)
    out.push(spec)
    if (node.__kind === 'element') for (const child of node.children) walk(child, id, viewport, out)
  }

  return {
    root,
    createElement(tag: string): NativeElementNode {
      elements++
      const n: NativeElementNode = { __kind: 'element', tag, props: {}, children: [], parent: null }
      idFor(n)
      structuralChange = true      // 新节点 ⇒ 结构变化
      createdNodes.add(n)          // ★登记（供结构 diff 产出 splice 的 inserts）
      return n
    },
    createText(text: string): NativeTextNode {
      texts++
      const n: NativeTextNode = { __kind: 'text', text }
      idFor(n)
      structuralChange = true
      createdNodes.add(n)          // ★文本也是结构增量的一部分（见 createdNodes 注释）
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
      // ★★**复用既有文本节点**（本仓实测的关键修正：文本变更一直被迫走全量）
      //
      // 【为什么（真机 S4 读数）】改 300 行文案要走**全量**（280KB / 254ms）——而核心侧
      //   真正需要的只是 300 条 SET_TEXT 补丁。根因就是这里"重建节点"：
      //   新 id ⇒ 旧节点要删、新节点要插 ⇒ 结构变更 ⇒ 全量。
      //   ⇒ 单文本子节点时**原地改内容**（id 不变）⇒ 走补丁通道。
      //   ★只有形态真的变了（0 个或多个子节点）才退回"替换"（那是真的结构变更）。
      const only = el.children.length === 1 ? el.children[0] : null
      if (only && only.__kind === 'text') {
        if (only.text !== text) {
          only.text = text
          textDirty.set(only, text)
          patches++
        }
        return
      }
      // ★★被整体替换的既有子节点**必须逐个登记为移除**（本仓实测的静默分叉）
      //
      // 【故障链（本仓实测）】Vue 的 `h('p-text', {...}, 'label')` 内容变化走
      //   `hostSetElementText` ⇒ 本方法把 children 清空换成一个新文本节点。
      //   而**核心侧的旧子节点仍挂着**（我们没告诉它）⇒ 旧文本层不消失、新文本层叠加
      //   ⇒ 几何上是"两行字重叠"，而结构计数看起来完全正常。
      //   ⇒ 纪律：**凡是"从树上拿掉"的动作都必须登记**，无论它是 remove 还是"整体替换"。
      for (const c of el.children) {
        if (c.__kind === 'element' || c.__kind === 'text') removedNodeIds.add(idFor(c))
        parentOf.delete(c)
      }
      el.children = []
      const t = this.createText(text)
      parentOf.set(t, el)
      el.children.push(t)
      patches++
    },
    insert(child: NativeNode, parent: NativeElementNode, anchor: NativeNode | null): void {
      // ★移动检测 + 摘链（见 `movedExisting` / `parentOf` 注释）：
      //   已挂载过的节点再次 insert = **移动**（append-only splice 表达不了顺序变化）
      const prevParent = parentOf.get(child) ?? (child.__kind === 'element' ? child.parent : null)
      if (parentOf.has(child) || (child.__kind === 'element' && child.parent)) {
        movedExisting = true
      }
      if (prevParent) {
        const pi = prevParent.children.indexOf(child)
        if (pi >= 0) prevParent.children.splice(pi, 1)
      }
      parentOf.set(child, parent)
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
      // ★摘链对**所有**节点种类生效（文本节点没有 parent 字段 ⇒ 靠 `parentOf`）
      const parent = parentOf.get(node) ?? parentNodeOf(node)
      if (parent) {
        const idx = parent.children.indexOf(node)
        if (idx >= 0) parent.children.splice(idx, 1)
      }
      parentOf.delete(node)
      structuralChange = true
      // ★登记被移除的**子树根**（核心侧会连同其子孙一起摘除——无需逐个列出子孙）
      //   注释节点不在核心树里（无 id）⇒ 不登记（登记会凭空分配一个用不到的 id）
      if (node.__kind === 'element' || node.__kind === 'text') removedNodeIds.add(idFor(node))
      patches++
    },
    parentNode: (node: NativeNode): NativeElementNode | null =>
      parentOf.get(node) ?? parentNodeOf(node),
    patchProp(el: NativeElementNode, key: string, prev: unknown, next: unknown): void {
      // ★事件（onXxx）：自绘管线里事件由**核心命中测试 + 平台手势**承担，
      //   不在本适配器里落树（那需要原始指针几何，见 hit.rs）。这里只计数以便观测。
      if (key.startsWith('on')) {
        patches++
        return
      }
      if (next === null || next === undefined) delete el.props[key]
      else el.props[key] = next
      // ★★只有「**布局字段的值真的变了**」才标脏
      //
      // 【为什么必须比 value，而不是"patchProp 被调用过"（真机实测定位）】
      //   Vue 每次重渲染都会**新建 style 对象**（`style: { height: 56, margin: {...} }`），
      //   而 `patchProp` **只要引用不同就会被调用**（Vue 不做深比较）。
      //   初版只看"含布局键"⇒ 每个节点都被标脏 ⇒ 实测「只改一个圆点尺寸」发出
      //   **3002 个补丁**、核心 `relayout=7005`（整树）⇒ 增量完全失效，
      //   且被误读成"局部变更也能触发整树重排"。
      //   ⇒ 正解：用 `layoutStyleOf(prev)` vs `layoutStyleOf(next)` **比布局子集**。
      //     （这正是 SFC 编译器 `_hoisted_*` 所做优化的**运行时等价物**：
      //      编译器让对象引用不变 ⇒ patchProp 根本不调用；这里兜住"客户端没走编译器"的情形。）
      const prevSig = styleSig(key === 'style' ? prev : {})
      const nextSig = styleSig(key === 'style' ? next : {})
      if (key === 'style') {
        if (prevSig !== nextSig) dirty.add(el)
      } else if (LAYOUT_KEYS.has(key)) {
        // 单键下发（key 就是布局键）：比该键的前后值
        if (JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)) dirty.add(el)
      }
      patches++
    },
    toRequest(viewport: { width: number; height: number }): SelfDrawRequest {
      const nodes: SelfDrawNodeSpec[] = []
      walk(root, null, viewport, nodes)
      return { viewport, nodes }
    },
    /**
     * ★★V7：产出**结构变更请求**（供 `proteus_layout_splice`）——增删行的增量路径
     *
     * 【为什么值得做（本仓实测的量化依据）】此前结构变化一律**重发整棵树**
     *   （真机 S5：500→600 项 **230ms**，几乎全是搬运成本）。
     *   而增删行在长列表里是最常见的交互（加载更多 / 删除一行）。
     *
     * 【返回形态】`null` = 无结构变更；否则给出 splice 请求（removes/inserts）。
     *
     * 【★只支持**追加**（架构限制的显式暴露）】核心的 `build_taffy` 按 `tree.nodes` 的
     *   **数组顺序**连父子（忽略 `children` 排列）⇒ 想插到中间必须同时搬数组（O(n)）。
     *   ⇒ 本函数**检测**新建节点的落点是否都在父的**末尾**：
     *     · 全是追加 ⇒ 返回 splice 请求（走增量）
     *     · 含中间插入 ⇒ 返回 `'full-required'`（调用方走全量——**不静默按末尾插**，
     *       否则行序错且零提示：本仓纪律「宁可拒绝不可静默错」）
     */
    takeSplice(): { removes: number[]; inserts: Array<{ parentId: number; index: number; nodes: SelfDrawNodeSpec[] }> } | 'full-required' | null {
      const removed0 = Array.from(removedNodeIds)
      const created0 = Array.from(createdNodes)
      const moved = movedExisting
      removedNodeIds.clear()
      createdNodes.clear()
      movedExisting = false
      structuralChange = false // 结构已由本函数消费

      // ★移动过既有节点 ⇒ append-only 的 splice 表达不了（顺序变化）⇒ 请调用方走全量
      //   （若本批还有增删，全量同样覆盖它们——不丢信息）
      if (moved) return 'full-required'

      // ★同批内「既新建又移除」的节点 = 从未上过宿主的树（挂载中就卸掉）⇒ 两边都不提
      //   （否则 splice 里出现"移除一个核心不认识的 id" ⇒ 报错；或"插入一个马上要删的节点" ⇒ 白建层）
      const createdSet0 = new Set<NativeNode>(created0)
      const removedSet0 = new Set<number>(removed0)
      const created = created0.filter((n) => !removedSet0.has(idFor(n)))
      const removed = removed0.filter((id) => {
        const n = created0.find((c) => idFor(c) === id)
        return n === undefined || !createdSet0.has(n)
      })
      if (removed.length === 0 && created.length === 0) return null

      // 无新建 ⇒ 纯删除：可直接走 splice(removes)
      if (created.length === 0) return { removes: removed, inserts: [] }

      // ★按父分组新建节点，并**校验落点都在末尾**
      //
      // 判据：对每个「含新建子节点的父」，新建的那些子必须在 `parent.children` 的**尾部连续段**。
      //   （新节点被 append 到 children 末尾——若其后还有既有的、不在新建集里的兄弟，
      //     说明这次是**中间插入** ⇒ 数组序无法表达 ⇒ 走全量。）
      type Group = { parent: NativeElementNode; kids: NativeNode[]; index: number }
      const createdSet = new Set<NativeNode>(created)
      const byParent = new Map<NativeElementNode, NativeNode[]>()
      for (const n of created) {
        // ★父从**簿记**取（文本节点没有 `parent` 字段——见 parentOf 注释）
        const p = parentOf.get(n) ?? (n.__kind === 'element' ? n.parent : null)
        if (!p) continue // 游离节点（新建但未挂载，如 setElementText 之前的中间态）——无落点
        // ★只取「新建森林」的**根**：祖先也在新建集里的节点由 walkSub 递归带上
        //   （否则新行里的文本会既被行块带上、又自成一块 ⇒ **重复插入**）
        if (createdSet.has(p)) continue
        const arr = byParent.get(p) ?? []
        arr.push(n)
        byParent.set(p, arr)
      }
      // ★★**算出插到第几位**（2026-09-28 解禁中间插入）
      //
      // 【为什么现在可以（本仓实测的架构升级）】核心的 `build_taffy` 已改为**只信
      //   `children` 顺序**（单一事实来源；`parent`↔`children` 一致性由输入图校验强制）
      //   ⇒ 插入只需给出**子位序号** `index`，**不必搬数组**（此前按数组序连父子，
      //     插中间必须搬整棵数组 ⇒ 只好显式拒绝中间插入、退回全量）。
      //   本函数据此产出 `{parentId, index, nodes}`：`index` = 新建节点在 children 里的
      //   **连续区段起点**。
      //   仍返回 `'full-required'` 的两种情形：
      //     · 新建节点**不连续**（被既有节点隔开）⇒ 一次插入表达不了
      //     · 新建节点根本不在父的 children 里 ⇒ 树不一致（不该发生，但不静默）
      const groups: Group[] = []
      for (const [parent, kids] of byParent) {
        const kidsSet = new Set<NativeNode>(kids)
        const idxs: number[] = []
        for (let i = 0; i < parent.children.length; i++) {
          if (kidsSet.has(parent.children[i]!)) idxs.push(i)
        }
        if (idxs.length !== kids.length) return 'full-required'
        const first = idxs[0]!
        for (let k = 0; k < idxs.length; k++) {
          if (idxs[k] !== first + k) return 'full-required'
        }
        groups.push({ parent, kids, index: first })
      }
      // 有新建但**全无落点**（游离）且无删除 ⇒ 对树无影响（无需发任何结构请求）
      if (groups.length === 0 && removed.length === 0) return null

      // 生成 inserts：每组的节点子树平铺（**父在前** ⇒ 核心可一遍链接）
      const inserts: Array<{ parentId: number; index: number; nodes: SelfDrawNodeSpec[] }> = []
      for (const g of groups) {
        const flat: SelfDrawNodeSpec[] = []
        const walkSub = (n: NativeNode, parentId: number | null): void => {
          if (n.__kind === 'comment') return
          const id = idFor(n)
          const spec: SelfDrawNodeSpec = { id, parentId }
          // 复用 toRequest 的字段折叠（**同一实现** ⇒ 全量与增量的节点规格不会分叉）
          fillSpec(spec, n)
          flat.push(spec)
          if (n.__kind === 'element') for (const c of n.children) walkSub(c, id)
        }
        for (const k of g.kids) walkSub(k, idFor(g.parent))
        inserts.push({ parentId: idFor(g.parent), index: g.index, nodes: flat })
      }
      return { removes: removed, inserts }
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
      const textBatch = Array.from(textDirty)
      textDirty.clear()
      // 结构变化 ⇒ 必须全量（核心的 update 入口只收样式补丁）——
      // ★文本补丁也被全量覆盖（新树自带新文案）⇒ 一并丢弃，不重复发
      if (structural) return null
      const out: Array<{ id: number; style: Record<string, unknown> }> = []
      for (const node of batch) {
        const el = node as NativeElementNode
        const id = idOf.get(node)
        if (id === undefined) continue
        const style = layoutStyleOf(el.props)
        if (Object.keys(style).length > 0) out.push({ id, style })
      }
      // ★★文本补丁必须发成 `{id, style:{text}}`（**不是**顶层 `{id, text}`）
      //
      // 【为什么（本仓实测：形状分叉导致静默无效）】Rust 的 `StylePatch` 形状是
      //   `{id, style:{...}}`，`text` 在 **style 内**。首版发成顶层 `{id, text}`
      //   ⇒ serde 忽略未知的顶层字段、`applied` 照数 300 ⇒ **看着成功、其实什么都没改**
      //   （设备读数：`text_patches=300` 而 `text_updates=0`）。
      //   ⇒ 与样式补丁**同一形状**（本就该如此：文本也是"这个节点的某个属性"）。
      for (const [node, text] of textBatch) {
        const id = idOf.get(node)
        if (id === undefined) continue
        out.push({ id, style: { text } })
      }
      return out
    },
    markFullSync: () => {
      structuralChange = false
      dirty.clear()
      // ★★全量同步后必须**清空结构追踪**（本仓实测的缺陷）
      //   【症状】mount 后 `createdNodes` 累积了整棵树 ⇒ 下一次 `takeSplice()` 会把这**整棵树**
      //     当作"新建"返回（实测：inserts 里出现重复的节点、且多个组互相包含同一批节点）
      //     ⇒ 若调用方照着发 splice，会**重复插入**（树被撑大 / id 冲突报错）。
      //   【根因】标志语义与「自上次取走以来」不一致——与 `structuralChange` 同一坑（见 takePatches 注释）。
      createdNodes.clear()
      removedNodeIds.clear()
      movedExisting = false
      textDirty.clear()
    },
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
