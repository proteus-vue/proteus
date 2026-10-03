// packages/slot-runtime/src/instantiate.ts
// ★★V4 遗留项收官：**LayoutTemplate 实例化**（模板 + 数据 → 引擎就绪节点树）
//
// 【这一层补的是什么】编译器（`buildLayoutTemplate`）产出**静态结构**（节点/样式/文本占位 +
//   v-for 行模板）；本模块把**运行时数据**（订阅表的源值）灌进去 ⇒ 得到可直接发给
//   自绘宿主/引擎的 `{ viewport, nodes }`。这是「全量 SFC → 端上渲染」链的最后一环
//   （此前设备验证用的是**手写节点数组**，节点树从没由 SFC 生成过）。
//
// 【★id 分配（必须与订阅表一致，否则指令写错节点）】
//   · 静态节点：id 直接用模板序（与 `SlotSubscription.nodeId` 同源）
//   · **v-for 行实例**：模板序 id 只覆盖"第一行"；第 2..N 行是**新增节点** ⇒ 从
//     `firstRowInstanceId`（调用方给，须 > 模板最大 id）起**顺序分配**
//   · 同时回填 `ListRegistry`（(listId,itemKey,itemSlotId) → 行内节点 id）——
//     这是行内槽位能发出**普通 SET_STYLE/SET_TEXT** 的前提（否则退回 LIST_UPDATE）
import { ListRegistry } from './list-registry'
import type { SubscriptionTable } from './table'
import type { ComponentDef, InstantiatedNode, LayoutNode, LayoutTemplate, ListTemplate } from './layout-template'
// ★★初值回填复用**运行时同一套实现**（求值器重建 + 行作用域读取）——见下方注释：
//   组合表达式（`'a' + item.x + 'b'`）不能靠"取单个字段"回填，且两处各写一份必然分叉。
//   ★文本段求值也走同一套 `evalExpr`（同一求值语义）
import { VaporRuntime, makeScopedRead } from './runtime'
import type { EvalContext } from './runtime'
import { evalExpr } from './expr'

export interface InstantiateOptions {
  /** 视口（写进返回值，便于宿主一次拿到完整请求） */
  viewport: { width: number; height: number }
  /**
   * ★第一行实例的起始 id（模板序 id 只覆盖首行；后续行从这里开始分配）
   *   缺省 = 模板最大 id + 1（**必须大于它**，否则与静态节点冲突）
   */
  firstRowInstanceId?: number
  /** 列表项注册表（提供它 ⇒ 行内槽位可解析到具体节点） */
  registry?: ListRegistry
  /** 源取值（与运行时同一契约：`ctx.read('list')` 返回数组） */
  read: (name: string) => unknown
  /** 订阅表（含行内槽位定义、itemValueField/itemKeyField、sourceExpr） */
  table?: SubscriptionTable
  /**
   * ★★★**id 偏移**（P1-3 组件系统）：本棵树内所有 id 统一加该偏移。
   *
   * 【为什么必须有（不偏移就会撞车）】子组件的模板序 id 从 **0** 开始——
   *   直接挂进父树会与父节点的 id **正面冲突**（内核按 id 建索引 ⇒ 树结构静默错乱）。
   *   ⇒ 组件展开时由父级传入"当前 id 高水位"作为偏移，整棵子树平移。
   */
  idOffset?: number
  /**
   * ★★★**组件注册表**（P1-3）：`组件名 → 定义`——提供它才会**展开组件内部**。
   *
   * 【缺失时的行为（诚实）】节点仍带 `component` 标记（P1 第一批的语义），
   *   但**内部为空**（占位）——不静默假装渲染了内容。
   * 【递归】子树里的组件节点用**同一张注册表**继续展开（任意层，带深度上限防自引用）。
   */
  components?: Record<string, ComponentDef>
  /** ★内部用：组件展开深度（防自引用无限递归；缺省 0，上限 8） */
  componentDepth?: number
}

/**
 * ★★★**组件挂载记录**（P1-3）——组件内部渲染后，桥/宿主据此**驱动子组件更新**。
 *
 * 【为什么必须由实例化给出】"这个边界节点下挂了哪个组件实例、它的 props 从哪读、
 *   它的子树是哪些 id"——只有实例化知道（与 `virtual.rows` 同款理由）。
 *   ★**props 上行更新**：父级某源变化 ⇒ 桥从 `onComponentProp` 拿到 (boundaryId, prop, value)
 *   ⇒ 更新 `props` 对象 ⇒ 调子运行时的 `writeSlotsOfSource(prop, ctx)`（见 entry-vapor 装配）。
 */
export interface ComponentMount {
  /** 边界节点 id（父树里的组件位） */
  boundaryNodeId: number
  /** 组件名 */
  name: string
  /**
   * ★**props 对象**（**可变**——桥在父级 props 变化时直接改它）。
   * 子组件的求值上下文按它读值（`read(prop)` ⇒ 这里）。
   */
  props: Record<string, unknown>
  /** 子组件的求值上下文（`read` = props ?? data ?? 父级 read）——桥驱动更新时传它 */
  ctx: import('./runtime').EvalContext
  /** 子组件订阅表（无表 ⇒ 该组件无 props/无内部更新，仅静态子树） */
  table?: SubscriptionTable
  /** 子组件实例注册表（子组件**自己的** v-for 行解析用；无子列表时为空表） */
  registry?: ListRegistry
  /** 子树（含后代）的节点 id（虚拟化/诊断用） */
  nodeIds: number[]
  /**
   * ★★**子树 id 偏移**（P1-3）——子组件的指令要把 nodeId 从 local 空间平移到本树空间。
   *   = `opts.idOffset + 子树起点`（即子模板 local id + 本值 = 宿主看到的 id）。
   *   桥把它透传给子运行时的 `nodeIdOffset`（见 `VaporRuntime` 构造）。
   */
  idOffset: number
  /**
   * ★★★**边界所在树的偏移**（P1-3 emits，2026-10-03）——`boundaryNodeId` 是**该树 local 空间**
   *   的 id；宿主看到的 id = `boundaryNodeId + treeOffset`。
   *   【为什么必须单列（实测的两种情形）】顶层树的 `idOffset` 参数是 0 ⇒ treeOffset 0；
   *   而嵌在**子组件树**里的挂载，其 `boundaryNodeId` 是子树的 local id（如 5），
   *   宿主空间要加**子树当时拿到的偏移**（如 42）——**不是**本挂载自己的 `idOffset`
   *   （那是"子组件的子树的偏移"，另一层）。emit 路由靠它把边界映射回宿主 id。
   */
  treeOffset: number
}

/**
 * ★★★**插槽分发记录**（P1-3 插槽分发，2026-10-03）——一个 `<slot>` 出口的分发结果。
 *
 * 【为什么由实例化给出】"哪个出口被哪个内容填了、后备有没有渲染"只有实例化知道
 *   （与 `componentMounts` 同款理由）；桥/判据据此核"内容真的到了子组件位置"。
 */
export interface SlotMount {
  /** 出口节点 id（**最终 id**；出口自身已溶解——此 id 仅作溯源，不在树里） */
  outletNodeId: number
  /** 插槽名（`default` / 具名） */
  name: string
  /** 是否被父级内容填充（false ⇒ 走了后备/空） */
  filled: boolean
  /** 分发落位的内容根 id（filled 时非空） */
  contentIds: number[]
  /** 后备渲染的节点 id（未填充且有元素后备时非空） */
  fallbackIds: number[]
}

export interface InstantiateResult {
  viewport: { width: number; height: number }
  nodes: InstantiatedNode[]
  /** id 分配读数（供对账："首行用模板 id、新增行从哪起"） */
  stats: {
    reusedTemplateIds: number
    allocatedIds: number
    rows: number
    valuesFilled: number
    /** ★P1-3：本棵树的 **local 最大 id**（不含 idOffset）——父级据此推进自己的分配器 */
    maxLocalId: number
    /** ★P1-3：组件展开产出的节点数（0 = 无组件或未提供注册表） */
    componentNodes: number
    /**
     * ★★★P1-3 插槽分发：被**丢弃**的节点最终 id（内容遮掉的后备 / 未消费的内容 / 空出口）。
     * 桥把它传给运行时（`skipNodeIds`）——为不在树里的节点发指令 = 死指令（内核报 unsupported 噪音）。
     */
    droppedNodeIds?: number[]
  }
  /** ★P1-3：组件挂载记录（未展开组件时为 undefined） */
  componentMounts?: ComponentMount[]
  /** ★★★P1-3 插槽分发记录（无插槽出口时为 undefined） */
  slotMounts?: SlotMount[]
  /** ★P1-3：实例化备注（如"组件未注册 / 超出深度上限"——不静默） */
  notes?: string[]
  /**
   * ★★**虚拟化描述**（宿主据此按行物化/回收层——方案 §12.6 / §12.7 P1）
   *
   * 【为什么必须由本函数给出（宿主自己推不出来）】"哪些节点属于第 i 行"只有**实例化**知道：
   *   行内子节点不带 `listId`（模板里只有 v-for 那个元素带）⇒ 宿主按 `listId` 分组只能拿到行根，
   *   无法知道整行有哪些节点 ⇒ 无法整行 acquire/release。
   *   ⇒ 实例化时顺手把 `idMap` 的像集记下来（零额外成本）。
   *
   * 【诚实边界】只覆盖**单层 v-for**（多列表 ⇒ 行号空间不同源，宿主按行号二分会错配）；
   *   嵌套列表（`tpl.lists.length > 1`）此处不给出 ⇒ 宿主退回全量物化（宁可多建，不可错配）。
   *   ★嵌套展开本身已支持（2026-10-03 P2）；此处限制的是**虚拟化描述**的适用范围。
   */
  virtual?: {
    /** 各行**按行号升序**（宿主对可见区做二分查找的前提） */
    rows: Array<{
      /** 行号（0 基） */
      index: number
      /** 行键（订阅表的 itemKeyField 值；无则退化为行号字符串） */
      key: string
      /** 行根节点 id（其绝对 rect 即该行的几何范围） */
      root: number
      /** 该行**全部**节点 id（含行根；父在前 ⇒ 宿主可顺序建层） */
      ids: number[]
    }>
  }
}

/**
 * ★★槽位的 propKey → 引擎字段名（回填**初始值**用）
 *
 * 【为什么必须回填（本仓实测发现的真缺口）】插值文本的模板占位是**空串**
 *   （编译期不知道数据）——若实例化不回填、而调用方又丢弃首帧指令（"值已对"的常见假设），
 *   屏幕上**文本永远为空**（结构全对、无报错）。样式同理：`:width="item.dotW"`
 *   若不在首帧前回填，首帧几何就是错的（要靠后续指令"补上"，白闪一次）。
 *   ⇒ 纪律：**实例化必须产出"结构 + 初始值"完整的第一帧**；增量指令只负责此后 delta。
 */
function engineFieldOf(propKey: string): { kind: 'style'; key: string } | { kind: 'text' } | null {
  if (propKey === 'text.content') return { kind: 'text' }
  const m = propKey.match(/^(?:layout|paint|text)\.(.+)$/)
  if (!m) return null
  return { kind: 'style', key: m[1]! }
}

/**
 * ★★**文本段求值**（2026-10-03 · P2-2 混合文本）——静态段 + 表达式段拼接成完整文本。
 *
 * 【为什么是"参考实现"而不是"唯一实现"】表达式段是 `ExprProgram`（纯 JSON，可序列化）——
 *   各端本可用自家表达式执行器；本函数是**参考实现**（与 `VaporRuntime` 的求值器同一套 `evalExpr`），
 *   供实例化与测试用。★段求值失败（表达式抛错）⇒ 该段按空串处理（不阻断其他段，
 *   也不静默产出半截文本之外的错——页面仍渲染静态段）。
 */
export function evalTextSegments(
  segs: readonly import('./layout-template').TextSegment[],
  read: (name: string) => unknown,
): string {
  let out = ''
  for (const s of segs) {
    if ('text' in s) {
      out += s.text
      continue
    }
    try {
      const v = evalExpr(s.expr, { read })
      out += v === undefined || v === null ? '' : String(v)
    } catch {
      /* 段求值失败 ⇒ 按空串（其余段照常拼接） */
    }
  }
  return out
}

/** 求某列表的行数组：**复用 VaporRuntime 的同一算法**（逐级下钻，任意层嵌套） */function rowsOfList(listId: number, meta: ListTemplate | undefined, table: SubscriptionTable | undefined, read: (n: string) => unknown): Array<Record<string, unknown>> {
  if (!table) return []
  const allSlots = table.sources.flatMap((s) => s.slots)
  const itemSlots = allSlots.filter((x) => x.kind === 'list-item' && x.listId === listId)
  // ★★无 `list-item` 槽位的列表 ⇒ 退回 **list-data 槽位**（2026-10-03 嵌套批次实测修正）
  //
  // 【为什么必须有】外层列表若行内**没有任何可更新绑定**（如 `<li v-for="g in gs">` 里只有
  //   内层 v-for / 或只有 :key），订阅表里只有它的 `list-data` 槽位（`:key` 不建槽位）
  //   ⇒ 首版直接 `return []` ⇒ **外层行集为空 ⇒ 外层 li 整行不展开**（实测：只剩内层 i）。
  const spec = itemSlots[0] ?? allSlots.find((x) => x.kind === 'list-data' && x.listId === listId)
  if (!spec) return []
  const srcName = table.sources.find((s) => s.slots.some((x) => x.listId === listId))?.sourceName ?? ''
  // ★下钻段优先取**模板的 sourceField**（如外层 `gs` / 内层 `items`）：
  //   list-data 槽位没有 sourceExpr（它是"整源换数据"语义），靠 sourceExpr 会取到空 ⇒ 不下钻。
  const segs = (meta?.sourceField || spec.sourceExpr || '').split('.').filter(Boolean)
  const topRows = read(srcName)
  if (!Array.isArray(topRows)) return []
  const walkSegs = segs[0] === srcName ? segs.slice(1) : segs
  let cur: Array<Record<string, unknown>> = topRows as Array<Record<string, unknown>>
  for (const field of walkSegs) {
    const next: Array<Record<string, unknown>> = []
    for (const r of cur) {
      const arr = r?.[field]
      if (!Array.isArray(arr)) continue
      for (const x of arr) next.push(x as Record<string, unknown>)
    }
    cur = next
  }
  return cur
}

/**
 * 实例化：模板 + 数据 → 节点树（并把行内槽位注册进 registry）
 *
 * ★支持**任意层** v-for 嵌套（2026-10-03 P2 批次：外层行克隆时按 `parentListId` 递归展开
 *   内层列表，行根挂到外层行实例；见 `cloneRow` ②.5）。
 */
export function instantiateTemplate(tpl: LayoutTemplate, opts: InstantiateOptions): InstantiateResult {
  const nodes: InstantiatedNode[] = []
  /** ★P1-3：本棵树的 id 平移量（组件展开时由父级给；0 = 独立树） */
  const idOffset = opts.idOffset ?? 0
  /** ★P1-3：实例化备注（组件未注册 / 深度超限——不静默） */
  const instNotes: string[] = []
  const maxTemplateId = tpl.nodes.reduce((m, n) => Math.max(m, n.id), 0)
  let nextId = opts.firstRowInstanceId ?? maxTemplateId + 1
  let allocated = 0
  let reused = 0
  const rowLists = new Map<number, ListTemplate>(tpl.lists.map((l) => [l.listId, l]))
  /** 已产出的节点（供初始值回填时按 id 定位） */
  const byId = new Map<number, InstantiatedNode>()
  let valuesFilled = 0
  // ★★**求值器重建**（2026-10-03 初值回填修正）：初值必须按**绑定表达式**求，而不是"取源值/取字段"。
  //
  // 【为什么（本仓实测的缺陷形态）】此前标量回填写 `read(sourceName)`、行内回填写 `row[itemValueField]`
  //   ⇒ 对 `{{ a + b }}` / 混合文本 `a{{x}}b` / `行内 '···' + item.x` 这类**组合表达式**，
  //     回填的是"某个源值"或"某个字段"⇒ **首帧文本错**（而首帧指令被调用方丢弃
  //     ——"初值已由实例化回填"的既有假设，见引擎端 entry-vapor 的 `captured.length = 0`）。
  //   ⇒ 正解：与运行时**同一套**求值器（`VaporRuntime.buildEvaluators`）求初值；求值器缺失
  //     （`expr` 形态：参考实现不支持）时退回既有"取源值/取字段"路径（行为不变，不静默变差）。
  const evaluators: Map<number, (ctx: EvalContext) => unknown> =
    opts.table ? VaporRuntime.buildEvaluators(opts.table.evaluators) : new Map()
  /** 某列表的**别名链**（自外向内，含自身；行作用域读取要与祖先行链按位置对齐） */
  const ancestorScopesOf = (listId: number): string[] => {
    const chain: string[] = []
    let cur: number | undefined = listId
    let guard = 0
    while (cur !== undefined && guard < 32) {
      const meta = rowLists.get(cur)
      if (!meta) break
      chain.unshift(meta.scope ?? '')
      cur = meta.parentListId
      guard++
    }
    return chain
  }
  /**
   * 用一个求值器求初值。
   *
   * ★★返回值语义（2026-10-03 修）：`{ ok: true, value }` = 求值器跑了（**值可能就是 undefined**——
   *   那是合法结果，如 `{{ nothing?.x }}`）；`{ ok: false }` = 没有求值器/抛错（调用方走兜底）。
   *
   * 【本仓实测的真缺陷】首版把二者混成一个 `undefined` 返回 ⇒ 对"表达式结果本来就该是 undefined"
   *   的槽位会**误走源值兜底** ⇒ `String(read('nothing'))` = `'null'` **错值上屏**
   *   （页面显示字面量 "null"——静默错内容）。
   */
  const evalInitial = (evaluatorId: number, ctx: EvalContext): { ok: boolean; value?: unknown } => {
    const impl = evaluators.get(evaluatorId)
    if (!impl) return { ok: false }
    try {
      return { ok: true, value: impl(ctx) }
    } catch {
      return { ok: false }
    }
  }
  /** ★虚拟化：行号 → {行键, 行根 id, 整行节点 id}（见 InstantiateResult.virtual 注释） */
  const virtualRows: NonNullable<InstantiateResult['virtual']>['rows'] = []

  /**
   * @param ctx ★文本段求值用的**行作用域上下文**（2026-10-03 P2-2）——**行内节点必须传行作用域读取**
   *   （`{{ item.title }} 前缀` 的段表达式含 v-for 别名；用顶层 read 会读到 undefined）。
   *   缺省 = 顶层 `opts.read`（静态部分/顶层节点的正确形态）。
   */
  const emit = (n: LayoutNode, id: number, parentId: number | null, ctx: EvalContext = { read: opts.read }): void => {
    // ★★**样式必须摊平到节点顶层**（本仓实测的接口不匹配缺陷）
    //
    // 【为什么（这条链此前静默失效）】核心的 `NodeDto` 期望样式字段**平铺在节点上**
    //   （`{"id":2,"height":56,"flexDirection":"row"}`），而首版把样式放在
    //   **`style: {...}` 子对象**里 ⇒ serde 只认顶层字段 ⇒ **所有样式解析为 None**
    //   （height/flexDirection/alignItems 全丢）⇒ 布局按"全部 auto"算
    //   ⇒ 行不是布局边界 ⇒ **增量更新退化为整树重排**（真机 V11：relayout=3002）。
    //   ★更糟的是：`mount` 仍会成功、层也会建（几何是"某种"结果）⇒ **V6 判据全过（假绿）**。
    //   ⇒ 形态与 `SelfDrawNodeSpec`（自绘适配器的产物）**逐字段一致**——
    //     那条链已验证可行（S1/S5 等真机用例），本函数与之对齐。
    const out: InstantiatedNode = { id, parentId }
    if (n.style) for (const [k, v] of Object.entries(n.style)) {
      ;(out as Record<string, unknown>)[k] = v
    }
    if (n.text !== undefined) out.text = n.text
    // ★★**文本段序列**（2026-10-03 · P2-2 混合文本）：静态段 + 表达式段 ⇒ 实例化时求值拼接。
    //   为什么在实例化做：`textSegments` 只在模板产物里（订阅表编的是**合成表达式**——
    //   `'a' + (x) + 'b'`）；实例化拿不到订阅表的求值器（调用方未传 table 时也要能出首帧），
    //   而表达式段在编译期已编成 `ExprProgram`（纯 JSON）⇒ 本层直接执行即可（无 eval）。
    if (n.textSegments && n.textSegments.length > 0) {
      out.text = evalTextSegments(n.textSegments, ctx.read)
    }
    // ★★`tag` / `component` **必须透传**（2026-10-03 P2 批次补的真缺陷）：本函数此前只写
    //   id/parentId/style/text，`tag` 被丢弃 ⇒ 宿主看不到节点类型（诊断串一直是 `undefined`；
    //   组件边界 `component` 也会丢）。★为什么之前没暴露：既有夹具的样式已足够布局、
    //   宿主也不读 tag ⇒ 三端判据全绿（**假绿形态**）。直到组件系统（P1）需要"这是组件位"
    //   的语义标记、嵌套 v-for（P2）需要区分容器与行，才必须补上。
    if (n.tag) out.tag = n.tag
    if (n.component) out.component = n.component
    // ★★★P1-3 插槽分发（2026-10-03）：出口 / 内容根标记随节点透传——分发在**本函数收尾**做
    //   （标记是**分发期**语义：分发完即摘除，不会出现在给宿主的树里——见 dissolveOutlets）。
    if (n.slotOutlet) out.slotOutlet = n.slotOutlet
    if (n.slotFor) out.slotFor = n.slotFor
    // ★★P1-3：**id 偏移只在写出时应用**（内部 byId/idMap 全用 local 空间——
    //   这样初值回填/行解析等所有既有查找逻辑**零改动**，只有"给宿主的 id"平移）。
    out.id = id + idOffset
    out.parentId = parentId === null ? null : parentId + idOffset
    nodes.push(out)
    byId.set(id, out)
  }

  // ★行模板的成员映射：`模板 id → 在该行内的角色`（行根 + 子节点，按模板序）
  //
  // ★★`parentOverrideId`（2026-10-03 嵌套批次新增）：**外层行的实例 id**
  //   【为什么需要】内层 v-for 的行根（如 `i`）在模板里挂在**外层行根**（`li`，模板 id=1）下；
  //     idMap 只含内层子树 ⇒ 外层父 id 翻译不到 ⇒ 会按**模板序 id** 挂（第一行巧合正确，
  //     第二行起全挂到第一行的 li 上——实测的"内层 i 都挤在第一个 li 里"）。
  //   ⇒ 外层行克隆把自己的**实例 id**（rowRootId）传进来，内层行根挂到它。
  // ★`collect`（2026-10-03 嵌套批次新增）：**上层行**的完整 id 集合——
  //   本行产出（含所有嵌套后代）在收尾时整体并入它；上层行回收时才能整行覆盖（不留孤儿）。
  const cloneRow = (
    listId: number,
    row: Record<string, unknown>,
    itemKey: string,
    first: boolean,
    rowIndex: number,
    parentOverrideId?: number,
    collect?: number[],
    /** ★祖先行链（自外向内；不含自身）——行作用域表达式（引用外层别名）求初值用（2026-10-03） */
    ancestors: Array<Record<string, unknown>> = [],
  ): number => {
    const meta = rowLists.get(listId)!
    const idMap = new Map<number, number>()
    let rowRootId = 0
    /** ★本行**实际产出**的全部节点 id（含嵌套列表的后代；父在前）——见 virtual 注释 */
    const myIds: number[] = []
    // ① 先分配 id（父在前 ⇒ 一遍即可建立映射）
    for (const tplId of meta.subtreeIds) {
      const engineId = first ? tplId : nextId++
      if (!first) allocated++
      else reused++
      idMap.set(tplId, engineId)
      if (tplId === meta.rowRootId) rowRootId = engineId
    }
    // ② 再产出节点（父 id 经映射翻译；行根挂到模板里行根的 parent）
    //    ★行作用域读取**先建**（P2-2）：行内节点的文本段（`前缀{{item.title}}`）求值需要它
    const rowRead = makeScopedRead(meta.scope ?? '', row, ancestors, ancestorScopesOf(listId), { read: opts.read })
    for (const tplId of meta.subtreeIds) {
      const tn = tpl.nodes.find((x) => x.id === tplId)!
      const engineId = idMap.get(tplId)!
      const tplParent = tn.parentId
      let parentId = tplParent === null ? null : (idMap.get(tplParent) ?? tplParent)
      // ★行根的父在**本子树之外**（模板序不可用）⇒ 用外层行的实例 id
      if (parentOverrideId !== undefined && tplId === meta.rowRootId) parentId = parentOverrideId
      emit(tn, engineId, parentId, rowRead)
      myIds.push(engineId)
    }
    // ②.5 ★★**嵌套列表递归展开**（2026-10-03 P2 批次）——任意层
    //
    // 【模型】`lists[]` 里 `parentListId === 本列表` 的就是本行的内层列表：
    //   内层行集 = **本行数据**上按 `sourceField`（如 `items` / `l2.sub`）逐级取的数组
    //   ⇒ 逐行递归克隆，行根挂到本行的实例根（rowRootId）。
    //   ★"首行可用模板 id"仅当**本行也是首行**（first）且是内层第一行（j===0）——
    //     模板 id 全局只能用一次，否则与第一行的内层实例**撞 id**。
    //   ★顺序：内层行按数据序展开 ⇒ 与运行时 rowsOfList 的**全局扁平行序**一致
    //     （LIST_UPDATE 按 itemKey 定位，不依赖顺序；但保持同序便于对账）。
    //   ★collect 传 **myIds**：内层产出的 id 也记进本行（递归逐层向外累积 ⇒ 最外层拿到全量）。
    for (const inner of tpl.lists) {
      if (inner.parentListId !== listId) continue
      // ★sourceField 可含多段（`a.l2.sub` ⇒ `l2.sub`）——逐段下钻，不是单键取值
      let arr: unknown = row
      for (const seg of (inner.sourceField ?? '').split('.').filter(Boolean)) {
        arr = (arr as Record<string, unknown> | undefined)?.[seg]
      }
      if (!Array.isArray(arr)) continue
      const innerKeyField = opts.table?.sources
        .flatMap((s) => s.slots)
        .find((x) => x.kind === 'list-item' && x.listId === inner.listId)?.itemKeyField
      for (let j = 0; j < arr.length; j++) {
        const innerRow = arr[j] as Record<string, unknown>
        const innerKey = innerKeyField && innerRow?.[innerKeyField] !== undefined ? String(innerRow[innerKeyField]) : String(j)
        // ★子行的祖先链 = 父祖先行链 + 父行自身（与运行时 rowsOfList 的累积口径一致）
        cloneRow(inner.listId, innerRow, innerKey, first && j === 0, j, rowRootId, myIds, [...ancestors, row])
      }
    }
    // ③ 回填注册表：行内槽位（itemSlotId）→ 该行节点 id
    //   ★同时记录**整行节点集合**（虚拟化用；嵌套时含内层后代 ⇒ 行回收整行覆盖）
    virtualRows.push({
      index: rowIndex,
      key: itemKey,
      root: rowRootId + idOffset,
      ids: myIds.map((x) => x + idOffset),
    });
    // ★本行完整 id 集并入**上层行**（最外层调用无 collect ⇒ 不产生额外开销）
    if (collect) collect.push(...myIds)
    // ④ **回填初始值**（见 engineFieldOf 注释：不回填 ⇒ 首帧文本为空 / 几何错）
    if (opts.table) {
      const itemSlots = opts.table.sources
        .flatMap((s) => s.slots)
        .filter((x) => x.kind === 'list-item' && x.listId === listId)
      if (itemSlots.length > 0) {
        const slotNodes: Record<number, number> = {}
        // ★行作用域上下文（当前行别名 + 各层祖先别名）——2026-10-03：组合表达式
        //   （`'a' + item.title` / 混合文本 `前缀{{item.title}}`）求初值必须靠它；
        //   与 `VaporRuntime.makeRowCtx` **共用同一实现**（makeScopedRead），两处语义不分叉。
        const rowCtx = makeScopedRead(meta.scope ?? '', row, ancestors, ancestorScopesOf(listId), {
          read: opts.read,
        })
        for (const sl of itemSlots) {
          // ★行内槽位的 nodeId 是「模板序」——同一份模板序在这里用 idMap 翻译成实际实例
          const mapped = idMap.get(sl.nodeId)
          if (mapped !== undefined) slotNodes[sl.itemSlotId!] = mapped
          // ④ 初始值
          if (mapped === undefined) continue
          const target = byId.get(mapped)
          if (!target) continue
          const f = engineFieldOf(sl.propKey)
          if (!f) continue
          // ★① 表达式求值（组合表达式的**唯一正确**路径）；缺失/抛错 ⇒ 退回 ② 字段直取
          const ev0 = evalInitial(sl.evaluatorId, rowCtx)
          let v: unknown
          if (ev0.ok) {
            v = ev0.value  // ★可能就是 undefined（合法结果）——仍要走"写出"（文本渲染为空）
          } else {
            const field = sl.itemValueField
            if (!field) continue
            v = row[field]
            if (v === undefined) continue
          }
          if (f.kind === 'text') {
            // ★P2-9：空值（undefined/null）⇒ **空串**（`String(undefined)` 会把字面量 "undefined" 写上屏）
            target.text = v === undefined || v === null ? '' : String(v)
          } else {
            // ★回填也写**顶层**（与 emit 的摊平一致——否则回填的键核心看不到）
            ;(target as Record<string, unknown>)[f.key] = v
          }
          valuesFilled++
        }
        if (opts.registry && Object.keys(slotNodes).length > 0) {
          // ★P1-3：注册表给的是**宿主看到的 id**（含偏移）——行内指令要按它命中节点
          const shifted: Record<number, number> = {}
          for (const [k, v] of Object.entries(slotNodes)) shifted[Number(k)] = v + idOffset
          opts.registry.registerItem(listId, itemKey, shifted)
        }
      }
    }
    return rowRootId
  }

  // 静态部分 + 行实例（模板序 id 即首行 id）
  //
  // ★★行成员集合必须**先建**（本仓实测踩到的重复 id 缺陷）：行根有 `listId`，
  //   但**行内子节点没有**（模板里只有 v-for 那个元素带 listId）⇒ 若静态分支
  //   只看 `listId === undefined`，行内子节点会被**静态分支与行克隆各产出一次**
  //   ⇒ id 重复 ⇒ 核心输入图校验拒收（`proteus_layout_create 失败`）。
  //   ⇒ 正解：用 `lists[].subtreeIds` 判定"是否属行模板"，属行的**一律只经克隆产出**。
  const rowMemberIds = new Set<number>()
  for (const l of tpl.lists) for (const id of l.subtreeIds) rowMemberIds.add(id)

  for (const n of tpl.nodes) {
    if (rowMemberIds.has(n.id)) {
      // 行成员：只在「行模板根」处触发展开（其子节点随行克隆）
      const meta = tpl.lists.find((l) => l.rowRootId === n.id)
      if (!meta) continue // 行内子节点（非根）——由克隆产出
      // ★★嵌套列表（有父列表）**不在主循环展开**——由父行克隆递归展开（见 cloneRow ②.5）：
      //   两层都从主循环展开 ⇒ 内层列表按"全局扁平行集"扩一次、父行克隆里又扩一次
      //   ⇒ 重复 + id 冲突（实测：内层 i 出现在错误层级 / 撞第一行的 id）。
      if (meta.parentListId !== undefined) continue
      const rows = rowsOfList(meta.listId, meta, opts.table, opts.read)
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!
        const keyOf = (): string => {
          const keyField = opts.table?.sources
            .flatMap((s) => s.slots)
            .find((x) => x.kind === 'list-item' && x.listId === meta.listId)?.itemKeyField
          return keyField && row[keyField] !== undefined ? String(row[keyField]) : String(i)
        }
        cloneRow(meta.listId, row, keyOf(), i === 0, i)
      }
      continue
    }
    emit(n, n.id, n.parentId)
  }

  // ④' ★★**非行内（标量）槽位的初始值回填**（2026-10-02 修复的真缺陷）
  //
  // 【为什么必须有（A/B 事件冒泡判据 ⑦g 当场红的根因）】本函数此前只回填 `list-item`
  //   槽位（见 cloneRow ④），而**标量绑定**（`:width="boxW"` / `:width="padW"` 这类
  //   `kind:'style'` 的槽位）的首帧值**从不回填** ⇒ A 路（Vapor）树里这些节点没有
  //   宽度声明（taffy 按撑满/内容算），直到**某次 relink 触发**才被写上。
  //   ⇒ 表现：tap 前 A/B 两路的按钮几何看着一致（都恰被更新段 relink 覆盖过），而**容器**
  //     （padW 从未在更新段改过）宽度从"撑满"跳到"数据值 + 5" —— 逐跳位移 A=[30,-775]
  //     vs B=[30,5]（B 路 Vue 直接渲染，`padW` 首帧就在树里）。
  //   ★为什么此前一直没暴露：mount 几何对比只采样**文本节点**（全在 v-for 行内、已回填），
  //     更新的比较又发生在 relink 之后（那时标量已被写上）⇒ 恰好绕开了这片盲区。
  //   ⇒ 修复口径与行内回填**完全一致**（同一 `engineFieldOf`、同样写顶层字段）。
  if (opts.table) {
    // ★P2-8：常量槽位（无源）也要回填首帧——与源驱动槽位同一套写出逻辑
    for (const sl of opts.table.constantSlots ?? []) {
      const target = byId.get(sl.nodeId)
      if (!target) continue
      const f = engineFieldOf(sl.propKey)
      if (!f) continue
      const evS = evalInitial(sl.evaluatorId, { read: opts.read })
      if (!evS.ok) continue
      const v = evS.value
      if (f.kind === 'text') {
        target.text = v === undefined || v === null ? '' : String(v)
      } else {
        ;(target as Record<string, unknown>)[f.key] = v
      }
      valuesFilled++
    }
    for (const src of opts.table.sources) {
      for (const sl of src.slots) {
        // 行内已由 cloneRow 回填；list-data 是"数据源本身"（不是节点属性）；组件边界不在本树
        if (sl.kind === 'list-item' || sl.kind === 'list-data' || sl.kind === 'component-prop') continue
        const target = byId.get(sl.nodeId)
        if (!target) continue
        const f = engineFieldOf(sl.propKey)
        if (!f) continue
        // ★★表达式求值优先（2026-10-03 初值回填修正）：`{{ a + b }}` / 混合文本这类**组合表达式**
        //   "取源值"是错的（会把表达式文本的语义丢成单个源值）⇒ 与运行时同一套求值器求初值；
        //   求值器缺失（`expr` 形态）⇒ 退回既有"取源值"路径（行为不变）。
        //   ★"结果就是 undefined"（如 `{{ a?.b }}` 且 a 为空）**不得**触发兜底（否则写 'null' 字符串）
        const evS = evalInitial(sl.evaluatorId, { read: opts.read })
        let v: unknown
        if (evS.ok) {
          v = evS.value
        } else {
          v = opts.read(src.sourceName)
          if (v === undefined) continue
        }
        if (f.kind === 'text') {
          // ★P2-9：空值 ⇒ 空串（同 cloneRow 的口径）
          target.text = v === undefined || v === null ? '' : String(v)
        } else {
          ;(target as Record<string, unknown>)[f.key] = v
        }
        valuesFilled++
      }
    }
  }

  /* ═══════════ ★★★P1-3：**组件内部渲染**（2026-10-03 · 组件系统第二批）═══════════
   *
   * 【这一层补的是什么】P1 第一批只交"边界标记 + props 通道"——组件**内部是空的**。
   *   本层把注册表里命中的组件**实例化成一段子树**挂在边界节点下：
   *     ① props 求值：父订阅表里 `component.<name>` 槽位（该边界节点的）→ 初值对象；
   *     ② 子上下文：`read` = props ?? 子组件 data ?? 父级 read（props 优先，与 Vue 同向）；
   *     ③ **递归实例化**：子模板走同一条链（自己的表/自己的 id 空间/自己的行注册表）；
   *     ④ **id 平移**：子树整体加 offset（子模板 id 从 0 起，不平移必与父树撞车）；
   *     ⑤ 子树的根挂到边界节点下（模板里它们是"根"，在父树里是边界节点的孩子）。
   *
   * 【为什么在 JS 侧做（而不是宿主）】本函数与整条实例化链**三端共用**（同一份 bundle）
   *   ⇒ 组件内部渲染**天然三端一致，宿主零改动**（宿主只看到一棵更大的扁平树）。
   *
   * 【诚实边界（本批）】① 生命周期钩子未做；② 插槽分发未做；③ emits（子→父）未做；
   *   ④ 子组件自身的**响应式状态**未做（`data` 是构建期快照——端上不执行 script）。
   */
  const componentMounts: ComponentMount[] = []
  const slotMounts: SlotMount[] = []
  /**
   * ★★★**被丢弃节点的最终 id**（P1-3 插槽分发）——内容遮掉的后备 / 未消费的内容 / 空出口。
   * 传回桥 ⇒ 运行时据此**跳过**这些节点的槽位（为不在树里的节点发指令 = 死指令 + 内核
   * `unsupported` 噪音——本仓"不静默"纪律下这属**已知丢弃**，要显式跳过而非留噪音）。
   */
  const droppedNodeIds = new Set<number>()
  let componentNodes = 0

  /** 子树（含自身）的 id 集——分发时"整棵摘除"用（后备被遮 / 内容无出口） */
  const subtreeOf = (list: InstantiatedNode[], rootId: number): Set<number> => {
    const doomed = new Set<number>([rootId])
    let grew = true
    while (grew) {
      grew = false
      for (const x of list) {
        if (x.parentId !== null && !doomed.has(x.id) && doomed.has(x.parentId)) {
          doomed.add(x.id)
          grew = true
        }
      }
    }
    return doomed
  }

  /**
   * ★★★**出口分发**（P1-3 插槽分发，2026-10-03）——把 list 里带 `slotOutlet` 标记的节点
   * **溶解**掉（Vue 里 `<slot>` 不渲染包裹元素），按 fills（插槽名 → 内容根）决定谁渲染：
   *
   *   · **有内容**：内容根挂到**出口的父**（即出口原来在的位置——DFS 顺序用"插到出口原位"
   *     保证）；出口自带的后备子树**整棵摘除**（Vue：内容遮蔽后备）。
   *   · **无内容**：后备**元素**子节点挂到出口的父（后备渲染）；出口自带的**裸文本**后备
   *     （`<slot>文字</slot>` 的文字折在出口自身的 `text` 上）改造成 `p-text` **保留**
   *     （自绘树没有独立文本节点——以文本元素承载，见 LayoutNode.slotOutlet 注释）；
   *     空出口（无内容也无后备）直接摘除。
   *
   * 【同名出口多次出现】内容只填**第一个**（其余走后备）——Vue 会**复制**内容到每个出口，
   *   而我方的节点 id 是唯一的（复制 = 重新分配整棵子树，属后续批次）；此处如实记录（note）。
   *
   * 返回：被消费的插槽名 + **已落位的填充**（作用域插槽要靠它做分发时求值——见调用方）。
   */
  const dissolveOutlets = (
    list: InstantiatedNode[],
    fills: Map<string, InstantiatedNode[]>,
    /**
     * ★★★**出口 props 求值**（P1-3 作用域插槽，2026-10-03）——调用方提供（它持有**子组件**的
     *   订阅表/求值器/上下文）。缺省 ⇒ 不求值（顶层出口没有"父级提供内容"这回事）。
     */
    evalProps?: (outlet: InstantiatedNode) => Record<string, unknown>,
  ): {
    consumed: Set<string>
    /** 已落位的填充（含出口 props——作用域求值的输入） */
    placed: Array<{ name: string; fill: InstantiatedNode[]; outlet: InstantiatedNode; props: Record<string, unknown> }>
  } => {
    const consumed = new Set<string>()
    const placed: Array<{ name: string; fill: InstantiatedNode[]; outlet: InstantiatedNode; props: Record<string, unknown> }> = []
    for (const outlet of list.filter((x) => x.slotOutlet)) {
      if (list.indexOf(outlet) < 0) continue   // 已被上一个出口的摘除连带移除（嵌套出口的边缘态）
      const name = (outlet.slotOutlet as { name: string }).name
      const fill = fills.get(name)
      const useFill = fill !== undefined && fill.length > 0 && !consumed.has(name)
      if (useFill) {
        consumed.add(name)
        const outletProps = evalProps ? evalProps(outlet) : {}
        const doomed = subtreeOf(list, outlet.id)
        for (const id of doomed) droppedNodeIds.add(id)
        const idx = list.findIndex((x) => x.id === outlet.id)
        const kept = list.filter((x) => !doomed.has(x.id))
        // 插入点 = 出口原位（摘除只可能发生在出口之后的连续块；出口之前的摘除数为 0）
        kept.splice(Math.min(idx, kept.length), 0, ...fill!)
        list.length = 0
        list.push(...kept)
        for (const r of fill!) {
          r.parentId = outlet.parentId
          delete (r as { slotFor?: unknown }).slotFor   // 标记是分发期语义——落地即摘
        }
        slotMounts.push({ outletNodeId: outlet.id, name, filled: true, contentIds: fill!.map((x) => x.id), fallbackIds: [] })
        placed.push({ name, fill: fill!, outlet, props: outletProps })
      } else {
        const kids = list.filter((x) => x.parentId === outlet.id)
        const fallbackIds: number[] = []
        if (kids.length > 0) {
          // 后备元素：挂到出口的父（出口不产盒——它们顶替出口的位置）
          for (const k of kids) k.parentId = outlet.parentId
          fallbackIds.push(...kids.map((x) => x.id))
          list.splice(list.indexOf(outlet), 1)
          droppedNodeIds.add(outlet.id)
        } else if (typeof outlet.text === 'string' && outlet.text !== '') {
          // 裸文本后备 ⇒ 出口改造成文本元素（保留 id；这是"文字要有元素承载"的最近等价物）
          delete (outlet as { slotOutlet?: unknown }).slotOutlet
          outlet.tag = 'p-text'
        } else {
          list.splice(list.indexOf(outlet), 1)
          droppedNodeIds.add(outlet.id)
        }
        slotMounts.push({ outletNodeId: outlet.id, name, filled: false, contentIds: [], fallbackIds })
      }
    }
    return { consumed, placed }
  }

  /* ═══════════ ★★★P3 动态组件 `:is` 解析（2026-10-03）═══════════
   *
   * 【时机】组件展开**之前**——把 `<component :is="expr">` 的节点解析成"它实际渲染的组件"，
   *   之后走与静态组件**完全同一条链**（注册表查找 / 子树偏移 / props / 插槽）。
   * 【为什么在此层（而不是宿主）】与组件展开同一理由：本函数三端共用 ⇒ 语义天然一致。
   * 【边界行为（都不静默）】
   *   · 求值为**假**（''/null/undefined）⇒ **整节点摘除**（Vue：`:is` 为假渲染空）；
   *   · 求值不是字符串（对象/函数形态——Vue 支持组件对象）⇒ 不展开 + note（我方注册表按名查）；
   *   · 名字不在注册表 ⇒ 不展开 + note（与静态组件"未注册"同一处置）。
   */
  if (opts.table?.componentIs && opts.table.componentIs.length > 0) {
    for (const ci of opts.table.componentIs) {
      const target = byId.get(ci.nodeId)
      if (!target) continue
      const impl = evaluators.get(ci.evaluatorId)
      if (!impl) {
        instNotes.push(`动态组件 \`:is="${ci.expr}"\`（节点 ${ci.nodeId}）求值器未实例化 ⇒ 未解析`)
        continue
      }
      let name: unknown
      try {
        name = impl({ read: opts.read })
      } catch (e) {
        instNotes.push(`动态组件 \`:is="${ci.expr}"\` 求值抛错（${String((e as Error)?.message ?? e)}）⇒ 未解析`)
        continue
      }
      if (name === undefined || name === null || name === '') {
        // 假值 ⇒ 摘除该节点（Vue：`:is` 为假渲染空——不留空壳）
        const doomed = subtreeOf(nodes, ci.nodeId)
        for (const id of doomed) droppedNodeIds.add(id)
        for (let i = nodes.length - 1; i >= 0; i--) if (doomed.has(nodes[i]!.id)) nodes.splice(i, 1)
        instNotes.push(`动态组件 \`:is="${ci.expr}"\` 求值为假（${String(name)}）⇒ 节点已摘除（Vue 同）`)
        continue
      }
      if (typeof name !== 'string') {
        instNotes.push(
          `动态组件 \`:is="${ci.expr}"\` 求值不是字符串（${typeof name}）⇒ 未解析` +
            `（本实现按**组件名**查注册表；组件对象形态为后续批次）`,
        )
        continue
      }
      target.component = name
      delete (target as { componentIs?: unknown }).componentIs
      instNotes.push(`动态组件 \`:is="${ci.expr}"\` ⇒ 解析为 ${name}（实例化期一次性解析）`)
    }
  }

  if (opts.components) {
    const depth = opts.componentDepth ?? 0
    // ★只展开**本棵树**的边界节点（刚展开的子节点在子调用里处理——递归自然覆盖）
    const boundaries = nodes.filter((n) => n.component)
    for (const boundary of boundaries) {
      // ★被分发摘除的边界（内容未被消费的子树里的组件）⇒ 不再展开（否则子块挂到孤儿上）
      if (droppedNodeIds.has(boundary.id)) continue
      const name = boundary.component!
      const def = opts.components[name]
      if (!def) {
        instNotes.push(`组件 ${name}（边界节点 ${boundary.id}）未在注册表里 ⇒ 内部留空（占位）`)
        continue
      }
      if (depth >= 8) {
        instNotes.push(`组件 ${name} 展开深度超上限（8）⇒ 停止递归（防自引用）`)
        continue
      }
      // ① props 求值：父表里该边界节点的 component-prop 槽位（模板序 local id）
      const boundaryLocalId = boundary.id - idOffset
      const props: Record<string, unknown> = {}
      if (opts.table) {
        // ★★两处都要扫（本仓实测的坑）：源驱动的 props 在 `sources`，而**字面量 props**
        //   （`:label="'hi'"`）无源依赖 ⇒ 落在 `constantSlots`（P2-8 为常量表达式建的通道）
        //   ⇒ 只扫 sources 会**拿不到字面量 props**（实测：props 对象为空 ⇒ 子组件读不到值）。
        const allSlots = [
          ...opts.table.sources.flatMap((src) => src.slots.map((sl) => ({ sl, srcName: src.sourceName }))),
          ...(opts.table.constantSlots ?? []).map((sl) => ({ sl, srcName: undefined as string | undefined })),
        ]
        for (const { sl, srcName } of allSlots) {
          if (sl.kind !== 'component-prop' || sl.nodeId !== boundaryLocalId) continue
          const propName = sl.propKey.startsWith('component.') ? sl.propKey.slice('component.'.length) : sl.propKey
          // ★★★两种形态（本仓实测）：**源驱动**的 props（`:label="kidLabel"`）——
          //   初值 = 该源的当前值（`read(srcName)`），**不能**用求值器求（求值器算的是"整个表达式"，
          //   对 `kidLabel` 这种纯成员访问结果相同，但对 `a.b` 形态会取到父级上下文的值——
          //   而 props 语义是"取该源的值"）；**字面量** props（`:label="'hi'"`）在 constantSlots，
          //   用求值器求。⇒ 分开处理（首版只走求值器 ⇒ 响应式 props 首帧为空——实测）。
          if (srcName !== undefined) {
            props[propName] = opts.read(srcName)
          } else {
            const impl = evaluators.get(sl.evaluatorId)
            if (impl) {
              try {
                props[propName] = impl({ read: opts.read })
              } catch {
                props[propName] = undefined
              }
            }
          }
        }
      }
      // ② 子上下文：props 优先 ⇒ 子组件 data ⇒ 父级 read（props 不可被 data 覆盖——与 Vue 同向）
      const childRead = (n: string): unknown => {
        if (Object.prototype.hasOwnProperty.call(props, n)) return props[n]
        const d = def.data
        if (d && Object.prototype.hasOwnProperty.call(d, n)) return d[n]
        return opts.read(n)
      }
      const ctx = { read: childRead }
      // ③ 子组件自己的行注册表（它的 v-for 行解析用——与父树注册表隔离，互不污染）
      const childRegistry = opts.registry ? new ListRegistry() : undefined
      const childOffset = nextId   // 父树当前高水位（local 空间）——子树的起点
      const childInst = instantiateTemplate(def.template, {
        viewport: opts.viewport,
        read: childRead,
        table: def.table,
        registry: childRegistry,
        idOffset: idOffset + childOffset,
        components: opts.components,
        componentDepth: depth + 1,
      })
      // ★★★插槽分发（P1-3，2026-10-03）——**在把子块挂进本树之前**做（此时 `nodes` 里
      //   带 `slotFor` 且 parentId=边界的节点就是"父级提供的内容根"，不会被刚展开的子块污染）。
      const contentRoots = nodes.filter((x) => x.parentId === boundary.id && x.slotFor)
      if (contentRoots.length > 0 || childInst.slotMounts?.length) {
        const fills = new Map<string, InstantiatedNode[]>()
        const scopeOf = new Map<string, string | undefined>()
        /** ★解构绑定（`{ errors }` ⇒ local/key 对）——与 `scope` 互斥（编译期保证） */
        const bindingsOf = new Map<string, Array<{ local: string; key: string }> | undefined>()
        for (const r of contentRoots) {
          const sf = r.slotFor as { name: string; scope?: string; scopeBindings?: Array<{ local: string; key: string }> }
          const arr = fills.get(sf.name) ?? []
          arr.push(r)
          fills.set(sf.name, arr)
          if (!scopeOf.has(sf.name)) scopeOf.set(sf.name, sf.scope)
          if (!bindingsOf.has(sf.name)) bindingsOf.set(sf.name, sf.scopeBindings)
        }
        // ★★★**出口 props 求值**（作用域插槽）：在**子组件作用域**求——
        //   出口上的绑定（`:count="n"`）本就是子组件订阅表的普通槽位（nodeId=出口 local id），
        //   值 = 子表求值器算的（props/data/父级 read）。⇒ 不重复实现"表达式语义"（一处实现）。
        const childEvaluators = def.table ? VaporRuntime.buildEvaluators(def.table.evaluators) : new Map()
        const evalOutletProps = (outlet: InstantiatedNode): Record<string, unknown> => {
          const out: Record<string, unknown> = {}
          const names = (outlet.slotOutlet as { props?: string[] }).props ?? []
          const outletLocal = outlet.id - (idOffset + childOffset)
          const allSlots = def.table
            ? [...def.table.sources.flatMap((s) => s.slots), ...(def.table.constantSlots ?? [])]
            : []
          for (const propName of names) {
            const sl = allSlots.find((s) => s.nodeId === outletLocal && s.propKey === `attr.${propName}`)
            if (!sl) continue
            const impl = childEvaluators.get(sl.evaluatorId)
            if (!impl) continue
            try {
              out[propName] = impl({ read: childRead })
            } catch {
              out[propName] = undefined
            }
          }
          return out
        }
        const { consumed, placed } = dissolveOutlets(childInst.nodes, fills, evalOutletProps)
        // ★★★**作用域绑定应用**（P1-3 作用域插槽）：内容子树里的 `sp.*` 按出口 props 求值——
        //   ① **文本段**重求值（`cnt-{{ sp.count }}`：实例化时 `sp` 读 undefined ⇒ 现在补上）；
        //   ② **作用域样式绑定**（`:width="sp.w"`）按 `slotScopedSlots` 写节点字段。
        //   【为什么在此处（分发时）】出口 props 只有在"内容与出口配对"那一刻才存在——
        //     之前没有任何可读的地方（见 SubscriptionTable.slotScopedSlots 注释）。
        for (const p of placed) {
          const scopeVar = scopeOf.get(p.name)
          const scopeBindings = bindingsOf.get(p.name)
          // ★作用域标记：单名（scopeVar）**或**解构绑定（scopeBindings）——两者都没有 ⇒ 非作用域插槽
          if (!scopeVar && !scopeBindings) continue
          const rootIds = new Set(p.fill.map((x) => x.id))
          // 内容子树 = 落在任何内容根之下的节点（在子块空间里按 parentId 链上溯）
          const byIdOfChild = new Map(childInst.nodes.map((x) => [x.id, x]))
          const subtree: InstantiatedNode[] = []
          for (const x of childInst.nodes) {
            let cur: InstantiatedNode | undefined = x
            let guard = 0
            while (cur !== undefined && guard++ < 64) {
              if (rootIds.has(cur.id)) {
                subtree.push(x)
                break
              }
              cur = cur.parentId === null ? undefined : byIdOfChild.get(cur.parentId)
            }
          }
          // ★★**作用域读取**（2026-10-03 起支持解构）：
          //   · 单名形态：`sp` ⇒ 整个出口 props 对象；
          //   · 解构形态：`{ errors, code: c }` ⇒ 局部名逐个绑到 props 的对应键（Vue 语义）。
          //   ★解构名**只在 props 里查不到时**才落回外层 read（Vue 里解构出的是**遮蔽**语义——
          //     同名局部变量会遮住外层；此处按"props 优先"实现，与 Vue 的绑定遮蔽一致）。
          const scopedRead = (n2: string): unknown => {
            if (scopeVar && n2 === scopeVar) return p.props
            if (scopeBindings) {
              const hit = scopeBindings.find((b) => b.local === n2)
              if (hit) return (p.props as Record<string, unknown>)[hit.key]
            }
            return opts.read(n2)
          }
          /** 该作用域标记的匹配判据（`slotScopedSlots.scope` 记的是**编译期的原文**） */
          const scopeTag = scopeVar ?? scopeBindings!.map((b) => b.local).join(',')
          // ① 文本段重求值（模板产物里带 textSegments 的节点——按**本树 local id** 定位）
          for (const node of subtree) {
            const tn = tpl.nodes.find((x) => x.id === node.id - idOffset)
            if (tn?.textSegments && tn.textSegments.length > 0) {
              node.text = evalTextSegments(tn.textSegments, scopedRead)
            }
          }
          // ② 作用域样式绑定（`slotScopedSlots`：nodeId 是**本树 local id**）
          let appliedScoped = 0
          for (const sc of opts.table?.slotScopedSlots ?? []) {
            // ★匹配：单名形态比 `scope`；解构形态比"该绑定引用的是哪个局部名"
            //   （编译期 `scope` 存的是解构里的局部名——见 deps.ts 的 slotScopes 收集）
            if (scopeVar !== undefined ? sc.scope !== scopeVar : !scopeBindings!.some((b) => b.local === sc.scope)) continue
            const target = subtree.find((x) => x.id === sc.nodeId + idOffset)
            if (!target) continue
            const impl = evaluators.get(sc.evaluatorId)
            if (!impl) continue
            const f = engineFieldOf(sc.propKey)
            if (!f) continue
            let v: unknown
            try {
              v = impl({ read: scopedRead })
            } catch {
              continue
            }
            if (f.kind === 'text') {
              target.text = v === undefined || v === null ? '' : String(v)
            } else {
              ;(target as Record<string, unknown>)[f.key] = v
            }
            appliedScoped++
            valuesFilled++
          }
          instNotes.push(
            `插槽 ${name}#${p.name}：作用域 ${scopeVar ? `\`${scopeVar}\`` : `解构 \`{ ${scopeBindings!.map((b) => b.local).join(', ')} }\``}` +
              ` 绑定出口 props ${JSON.stringify(p.props)}` +
              `（文本段重求值 ${subtree.filter((x) => tpl.nodes.find((t) => t.id === x.id - idOffset)?.textSegments?.length).length} 节点 · 作用域样式 ${appliedScoped} 处）`,
          )
        }
        // ★★遍历 **fills map**（而不是 `contentRoots` 的 `slotFor`——本仓实测：被消费的内容根
        //   在 dissolve 里已摘掉 `slotFor` 标记，再读它 = undefined.name 崩）
        for (const [nm, roots] of fills) {
          if (consumed.has(nm)) {
            // ★★被消费的内容根**从父数组移出**（本仓实测的重复 id 缺陷：不移出则同一对象
            //   既在父数组、又被插入子块数组 ⇒ 给内核的 nodes 里同 id 出现两次 ⇒ 拒收）。
            //   对象此刻已挂在子块的出口位置（`childInst.nodes` 里），父数组这份只是残留。
            for (const r of roots) {
              const i = nodes.indexOf(r)
              if (i >= 0) nodes.splice(i, 1)
            }
            continue
          }
          // 父级提供的内容没有出口接住 ⇒ **整棵摘除**（Vue：未消费的插槽内容不渲染——不静默留盒）
          for (const r of roots) {
            const doomed = subtreeOf(nodes, r.id)
            for (const id of doomed) droppedNodeIds.add(id)
            for (let i = nodes.length - 1; i >= 0; i--) if (doomed.has(nodes[i]!.id)) nodes.splice(i, 1)
          }
          instNotes.push(`插槽 ${name}#${nm} 的内容无出口接住（子组件没有同名 <slot>）⇒ 未渲染`)
        }
      }
      // ④ 子树根挂到边界节点下（模板里它们是"根" ⇒ 在父树里是边界的孩子）
      //   ★内容根此时已带 parentId（出口的父，在子块空间）——不受本行影响（只挑 null 的）
      for (const r of childInst.nodes) if (r.parentId === null) r.parentId = boundary.id
      nodes.push(...childInst.nodes)
      componentNodes += childInst.nodes.length
      // ★回填计数聚合（子树的首帧回填也算本树的——报告/判据读 `inst_values_filled` 才完整）
      valuesFilled += childInst.stats.valuesFilled
      // ⑤ 推进本树分配器（子树的 local 高水位）
      nextId = childOffset + childInst.stats.maxLocalId + 1
      componentMounts.push({
        boundaryNodeId: boundary.id,
        name,
        props,
        ctx,
        table: def.table,
        registry: childRegistry,
        nodeIds: childInst.nodes.map((x) => x.id),
        idOffset: idOffset + childOffset,
        // ★P1-3 emits：边界在**本树**的 id 空间 —— 宿主要加 idOffset 才是它看到的 id
        treeOffset: idOffset,
      })
      // 子树的**嵌套**组件挂载记录 / 插槽记录一并冒出（桥要为每个挂载建运行时）
      for (const m of childInst.componentMounts ?? []) componentMounts.push(m)
      for (const sm of childInst.slotMounts ?? []) slotMounts.push(sm)
      // ★P1-3 插槽分发：子树内丢弃的节点 id 也并入本树（桥要一并跳过——不分层泄漏）
      for (const d of childInst.stats.droppedNodeIds ?? []) droppedNodeIds.add(d)
      for (const nt of childInst.notes ?? []) instNotes.push(nt)
    }
  }
  // ★★★顶层收尾：本树自己的出口（页面模板里的 `<slot>`——没有父组件提供内容）
  //   按"无内容"分发（有元素后备 ⇒ 后备渲染；裸文本 ⇒ 改造成文本元素；空 ⇒ 摘除）。
  //   ★组件子树里的出口**不在此处理**（由父级展开时的 dissolveOutlets 处理——见上）。
  if ((opts.componentDepth ?? 0) === 0) {
    dissolveOutlets(nodes, new Map())
    // ★分发期标记**不带出产物**（`slotFor` 是"谁来填"的中间态——树给宿主时应已全部落地/摘除）。
    //   （`slotOutlet` 只可能残留于"无注册表 ⇒ 组件未展开"的边界场景，一并清掉。）
    for (const x of nodes) {
      const rec = x as { slotFor?: unknown; slotOutlet?: unknown }
      if (rec.slotFor !== undefined) delete rec.slotFor
      if (rec.slotOutlet !== undefined) delete rec.slotOutlet
    }
  }

  return {
    viewport: opts.viewport,
    nodes,
    stats: {
      reusedTemplateIds: reused,
      allocatedIds: allocated,
      rows: nodes.length,
      valuesFilled,
      // ★P1-3：本树 local 高水位（父级据此推进自己的分配器——**不含** idOffset）
      maxLocalId: nextId - 1,
      componentNodes,
      // ★P1-3 插槽分发：丢弃节点（最终 id 空间）——桥传给运行时 `skipNodeIds`
      ...(droppedNodeIds.size > 0 ? { droppedNodeIds: [...droppedNodeIds] } : {}),
    },
    // ★只有**恰好一个**列表时才给虚拟化描述（多个列表 ⇒ 行号空间不同源，宿主按行号二分会错配）
    virtual: virtualRows.length > 0 && tpl.lists.length === 1 ? { rows: virtualRows } : undefined,
    ...(componentMounts.length > 0 ? { componentMounts } : {}),
    ...(slotMounts.length > 0 ? { slotMounts } : {}),
    ...(instNotes.length > 0 ? { notes: instNotes } : {}),
  }
}
