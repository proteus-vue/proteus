// packages/slot-runtime/src/layout-template.ts
// ★★V4：**LayoutTemplate 契约**（方案 §4.1 的落地形态）——静态结构产物
//
// 【为什么类型定义在**运行时包**而不是编译器包】
//   与本包的 `table.ts`（订阅表契约）同源理由：产物是**跨端契约**——
//   编译器产出它、运行时消费它、宿主/引擎读它。定义在运行时侧才能保证
//   "消费方定义的形状"是唯一的（编译器只是产出方之一）。
//
// 【与订阅表的关系】
//   · 订阅表（`SubscriptionTable`）：**哪个值变了写哪个节点**（动态）
//   · 模板（本文件）：**树上有哪些节点、初始长什么样**（静态）
//   两者的 nodeId 空间**必须同源**（= 模板序 DFS 的元素序号，见 compiler/vapor/deps.ts
//   的 `nextElementIndex`）——否则指令会写到别的节点上（本仓踩过：症状伪装成几何错）。

/** 模板节点（静态部分；`text` 为占位，初始值由运行时按槽位回填） */
export interface LayoutNode {
  /** 引擎节点 id（= 模板序 DFS 的元素序号；与订阅表 nodeId 同源） */
  id: number
  parentId: number | null
  tag: string
  /** 静态样式（**引擎字段名**：width/height/margin/flexDirection/backgroundColor/…） */
  style: Record<string, unknown>
  /** 文本占位（元素含静态文本或插值子节点时存在；插值初值为空串，由运行时回填） */
  text?: string
  /** ★该节点是 v-for 行的根 ⇒ 运行时按该 listId 的行数展开 */
  listId?: number
}

/** v-for 行模板元数据（供运行时展开与注册表回填） */
export interface ListTemplate {
  listId: number
  /** 行根节点 id（模板序） */
  rowRootId: number
  /** 行子树包含的模板节点 id（含行根自身；pre-order 连续） */
  subtreeIds: number[]
  /** v-for 别名（诊断/对账用） */
  scope: string
}

/** 布局模板（编译器产物之一；序列化后即可跨端传输） */
export interface LayoutTemplate {
  nodes: LayoutNode[]
  lists: ListTemplate[]
  /** 模板根节点 id 列表（通常 1 个） */
  roots: number[]
  /** 结构上可用（false ⇒ 调用方应退回标准渲染路径） */
  ok: boolean
}

/** 引擎就绪的节点规格（实例化产物）
 *
 * ★★**样式键必须平铺在顶层**（本仓实测的接口不匹配缺陷）——核心 `NodeDto` 只认顶层字段；
 *   放进 `style` 子对象会被 serde 静默忽略（样式全丢 ⇒ 布局按全 auto 算 ⇒ 增量退化整树重排）。
 *   本接口与 `renderer-app` 的 `SelfDrawNodeSpec` **逐字段同形**（那条链已真机验证）。
 */
export interface InstantiatedNode {
  id: number
  parentId: number | null
  text?: string
  /** 样式字段（width / height / flexDirection / margin / …）——**平铺在节点顶层** */
  [styleKey: string]: unknown
}
