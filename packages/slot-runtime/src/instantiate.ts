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
import type { ListRegistry } from './list-registry'
import type { SubscriptionTable } from './table'
import type { InstantiatedNode, LayoutNode, LayoutTemplate, ListTemplate } from './layout-template'

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
}

export interface InstantiateResult {
  viewport: { width: number; height: number }
  nodes: InstantiatedNode[]
  /** id 分配读数（供对账："首行用模板 id、新增行从哪起"） */
  stats: { reusedTemplateIds: number; allocatedIds: number; rows: number; valuesFilled: number }
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

/** 求某列表的行数组：**复用 VaporRuntime 的同一算法**（逐级下钻，任意层嵌套） */
function rowsOfList(listId: number, meta: ListTemplate | undefined, table: SubscriptionTable | undefined, read: (n: string) => unknown): Array<Record<string, unknown>> {
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
  const maxTemplateId = tpl.nodes.reduce((m, n) => Math.max(m, n.id), 0)
  let nextId = opts.firstRowInstanceId ?? maxTemplateId + 1
  let allocated = 0
  let reused = 0
  const rowLists = new Map<number, ListTemplate>(tpl.lists.map((l) => [l.listId, l]))
  /** 已产出的节点（供初始值回填时按 id 定位） */
  const byId = new Map<number, InstantiatedNode>()
  let valuesFilled = 0
  /** ★虚拟化：行号 → {行键, 行根 id, 整行节点 id}（见 InstantiateResult.virtual 注释） */
  const virtualRows: NonNullable<InstantiateResult['virtual']>['rows'] = []

  const emit = (n: LayoutNode, id: number, parentId: number | null): void => {
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
    // ★★`tag` / `component` **必须透传**（2026-10-03 P2 批次补的真缺陷）：本函数此前只写
    //   id/parentId/style/text，`tag` 被丢弃 ⇒ 宿主看不到节点类型（诊断串一直是 `undefined`；
    //   组件边界 `component` 也会丢）。★为什么之前没暴露：既有夹具的样式已足够布局、
    //   宿主也不读 tag ⇒ 三端判据全绿（**假绿形态**）。直到组件系统（P1）需要"这是组件位"
    //   的语义标记、嵌套 v-for（P2）需要区分容器与行，才必须补上。
    if (n.tag) out.tag = n.tag
    if (n.component) out.component = n.component
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
    for (const tplId of meta.subtreeIds) {
      const tn = tpl.nodes.find((x) => x.id === tplId)!
      const engineId = idMap.get(tplId)!
      const tplParent = tn.parentId
      let parentId = tplParent === null ? null : (idMap.get(tplParent) ?? tplParent)
      // ★行根的父在**本子树之外**（模板序不可用）⇒ 用外层行的实例 id
      if (parentOverrideId !== undefined && tplId === meta.rowRootId) parentId = parentOverrideId
      emit(tn, engineId, parentId)
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
        cloneRow(inner.listId, innerRow, innerKey, first && j === 0, j, rowRootId, myIds)
      }
    }
    // ③ 回填注册表：行内槽位（itemSlotId）→ 该行节点 id
    //   ★同时记录**整行节点集合**（虚拟化用；嵌套时含内层后代 ⇒ 行回收整行覆盖）
    virtualRows.push({
      index: rowIndex,
      key: itemKey,
      root: rowRootId,
      ids: [...myIds],
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
        for (const sl of itemSlots) {
          // ★行内槽位的 nodeId 是「模板序」——同一份模板序在这里用 idMap 翻译成实际实例
          const mapped = idMap.get(sl.nodeId)
          if (mapped !== undefined) slotNodes[sl.itemSlotId!] = mapped
          // ④ 初始值
          if (mapped === undefined) continue
          const target = byId.get(mapped)
          const field = sl.itemValueField
          if (!target || !field) continue
          const v = row[field]
          if (v === undefined) continue
          const f = engineFieldOf(sl.propKey)
          if (!f) continue
          if (f.kind === 'text') {
            target.text = String(v)
          } else {
            // ★回填也写**顶层**（与 emit 的摊平一致——否则回填的键核心看不到）
            ;(target as Record<string, unknown>)[f.key] = v
          }
          valuesFilled++
        }
        if (opts.registry && Object.keys(slotNodes).length > 0) {
          opts.registry.registerItem(listId, itemKey, slotNodes)
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
    for (const src of opts.table.sources) {
      const v = opts.read(src.sourceName)
      for (const sl of src.slots) {
        // 行内已由 cloneRow 回填；list-data 是"数据源本身"（不是节点属性）；组件边界不在本树
        if (sl.kind === 'list-item' || sl.kind === 'list-data' || sl.kind === 'component-prop') continue
        const target = byId.get(sl.nodeId)
        if (!target) continue
        const f = engineFieldOf(sl.propKey)
        if (!f) continue
        if (f.kind === 'text') {
          target.text = String(v)
        } else {
          ;(target as Record<string, unknown>)[f.key] = v
        }
        valuesFilled++
      }
    }
  }

  return {
    viewport: opts.viewport,
    nodes,
    stats: { reusedTemplateIds: reused, allocatedIds: allocated, rows: nodes.length, valuesFilled },
    // ★只有**恰好一个**列表时才给虚拟化描述（多个列表 ⇒ 行号空间不同源，宿主按行号二分会错配）
    virtual: virtualRows.length > 0 && tpl.lists.length === 1 ? { rows: virtualRows } : undefined,
  }
}
