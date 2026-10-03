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

/**
 * ★★**文本段**（2026-10-03 · P2-2 混合文本）——`a{{x}}b` 的编译期切分产物。
 *
 * 【为什么需要（本仓核实的缺口）】此前"文本 + 插值混合"被诊断拒绝；而"前缀{{x}}后缀"是
 *   模板里极常见的写法。自绘树里文本是**元素属性**（没有独立文本节点），
 *   故正解不是"建多个文本节点"，而是把子节点序列编成**段数组**：
 *   静态段（字面量）+ 表达式段（`ExprProgram`），运行时求值后拼成完整文本。
 *
 * 【与"组合表达式"同源】`a{{x}}b` ≡ `'a' + x + 'b'`——探针/订阅表/表达式编译器
 *   走的是**同一套** `ExprProgram`（不引入第二套求值语义）。
 *   ★表达式段在**编译期**就用 `compileExpr` 编好：编不出的形态当场产诊断
 *   （否则会被静默当成字面量文本 ⇒ 错值且无提示——本仓最忌的形态）。
 *   ★`src` 保留表达式源码：订阅表的**合成绑定**（`'a' + (x) + 'b'`）要按源码重建，
 *     而"程序 → 源码"不可逆 ⇒ 两者一起带（编译产物可序列化，无闭包）。
 */
export type TextSegment = { text: string } | { expr: import('./expr').ExprProgram; src: string }

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
  /**
   * ★★★**过渡声明**（2026-10-03 · P3-3 `Transition` 桥接）——该节点的可见性切换要带过渡。
   *
   * 【为什么是"声明"而不是"实现"】Vue 的 `<Transition>` 在 Web 端靠 CSS class 驱动
   *   （`v-enter-from` → canvas/DOM 自己去过渡）；我方**没有 CSS 引擎**，但**内核有完整动画能力**
   *   （MA0-RT：`proteus_layout_anim_start` + 每帧 tick，曲线/弹簧/序列/循环齐备）。
   *   ⇒ 桥接形态：编译期把 `<Transition name="fade">` 编成**预设动画的通道规格**，
   *     运行时在该节点**可见性真的变化**时把规格交给宿主动画入口（见 entry-vapor.ts 的 drain）。
   *
   * 【预设（闭集，不引入 CSS 语义）】`fade` / `slide-up|down|left|right` / `zoom`——
   *   每个预设 = 若干 `(kind, from, to)` 通道（与内核 `AnimKind` 编号一一对应）。
   *   未知名 ⇒ 编译期诊断（不静默退化成"无过渡"）。
   *
   * 【诚实边界】① 只支持**单子元素**（与 Vue 的 `<Transition>` 同约束；多子/无子 ⇒ 诊断）；
   *   ② `TransitionGroup` 的**列表差异动画**（move 过渡）未支持（需行级 diff，独立批次）；
   *   ③ `v-if` 的**离场**（元素从树上摘除）暂不驱动过渡（结构级动画属 L2 通道）——
   *     本批只做 `v-show` / 可见性切换（TOGGLE_VIS）这条路径。
   */
  transition?: {
    /** 预设名（决定通道规格；见 `TRANSITION_PRESETS`） */
    preset: string
    /** 入场通道（可见性 false→true 时按 from→to 播） */
    enter: Array<{ kind: number; from: number; to: number }>
    /** 离场通道（true→false 时按 from→to 播） */
    leave: Array<{ kind: number; from: number; to: number }>
    /** 时长（ms；`<Transition :duration="...">` 可显式给） */
    durMs: number
    /** 曲线 id（缺省 1 = easeOutCubic，与内核 `AnimCurve` 同源） */
    curve: number
    /** `appear`：首帧（节点初次可见）也播入场 */
    appear?: boolean
  }
  /**
   * ★★**文本段序列**（2026-10-03 · P2-2 混合文本）——按下标=子节点顺序。
   *
   * 存在时表示该节点的文本由**多段拼接**（`a{{x}}b` / `{{a}}-{{b}}` / 插值+静态混排）；
   * `text` 同时置空串占位（既有"插值初值为空串"的形态不变）。
   * 运行时（实例化回填 / 订阅更新）按段求值拼接后写 `text`。
   * ★单段静态文本**不产出本字段**（走 `text` 直赋，既有产物逐字节不变）。
   */
  textSegments?: TextSegment[]
  /** ★该节点是 v-for 行的根 ⇒ 运行时按该 listId 的行数展开 */
  listId?: number
  /**
   * ★★**组件边界**（P1 组件系统，2026-10-03）——该节点是组件标签（`<MyComp>`）的宿主位。
   *
   * 【语义（方案 §7.3 强制规则第 1 条："组件边界强制 L0"）】：
   *   · 组件**内部**由 Vue 标准路径渲染（不穿透）——本字段只标记"这里是个组件边界"；
   *   · 其 `style` 是**宿主位样式**（组件根的尺寸/间距——从标签上的 style 声明取）；
   *   · props 通道走订阅表（`component-prop` 槽位 → `CALL_COMPONENT_UPDATE`）。
   * 【诚实边界】本版只做"**边界标记 + props 通道**"；组件内部渲染、生命周期、插槽分发是后续批次。
   *   未标记的普通元素 = 无组件边界（既有行为不变）。
   */
  component?: string
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
  /**
   * ★★**外层列表 id**（嵌套 v-for，2026-10-03 P2 批次）——该行模板位于哪个外层列表的行内。
   *
   * 【为什么必须有（本仓实测的架构约束）】嵌套 v-for（`<li v-for="g in gs"><i v-for="x in g.x">`）
   *   的内层列表**每个外层行都要展开一份**（外层 3 行 × 内层 2 项 = 6 个内层实例）。
   *   ⇒ 内层 `ListTemplate` 必须知道自己"寄生"在哪个外层行里（运行时按外层 item 递归实例化），
   *     否则内层行会挂到**模板的固定位置**上（所有外层行共用一份内层——几何与数据全错）。
   *   ★单层 v-for 时为 `undefined`（既有行为逐字节不变）。
   */
  parentListId?: number
  /** 本行模板引用的**外层作用域名**（嵌套求值：`g.x` 里的 `g` 由外层行绑定） */
  outerScope?: string
  /**
   * ★**数据源字段名**（嵌套列表用）——源表达式去掉外层作用域前缀后的部分。
   *   例：`<i v-for="x in g.items">` ⇒ `outerScope='g'`、`sourceField='items'`。
   *   运行时按 `row['items']` 取内层行数组（见 instantiate 的递归展开）。
   *   ★单层 v-for 时 = 源表达式本身（运行时既有 rowsOfList 走 table 解析，本字段不影响）。
   */
  sourceField?: string
}

/**
 * ★★★**组件定义**（P1-3 组件系统第二批，2026-10-03）——组件注册表的条目。
 *
 * 【这一层补的是什么（能力清单 P1-3）】P1 第一批只交"组件边界标记 + props 通道"
 *   （`LayoutNode.component` + `component-prop` 槽位 → `CALL_COMPONENT_UPDATE`）——
 *   **组件内部是空的**（标记在那儿，没人渲染它）。
 *   本批交出**内部渲染**：把子组件的模板实例化成**一段子树**挂在边界节点下。
 *
 * 【为什么注册表在**运行时包**（与 LayoutTemplate/SubscriptionTable 同一处置）】
 *   它是"产物之间的引用"：父组件的产物里只有 `component: "Panel"` 这个名字，
 *   真正的形状由本接口定义 ⇒ 消费方（运行时）定契约，生产方（构建期编译器）填内容。
 *   ★**同一份 registry 三端共用**（随 bundle 走）⇒ 内部渲染天然三端一致，宿主零改动。
 *
 * 【诚实边界（本批不做）】① 生命周期（mounted/unmounted 钩子）；② 插槽分发（具名/作用域）；
 *   ③ emits（子→父）；④ 组件自身的**响应式状态**（`data` 是构建期快照——端上不执行 script，
 *   与既有夹具同规）。这四项各有诊断/文档标注。
 */
export interface ComponentDef {
  /** 组件模板（该 SFC 的 `<template>` 编译产物） */
  template: LayoutTemplate
  /** 组件订阅表（props → 槽位；有它才能 props 下行 + 子组件自身更新） */
  table?: import('./table').SubscriptionTable
  /**
   * 组件自身的数据快照（构建期从 `<script setup>` 抽取——**端上不执行 script**，与设备端夹具同规）。
   * 缺省 `{}`。★props 优先于 data（同名时 props 胜——与 Vue 的"props 不可被 data 覆盖"同向）。
   */
  data?: Record<string, unknown>
  /** 组件名（诊断用；缺省取注册表的键） */
  name?: string
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
  /** ★节点标签（原生标签名 or 组件名；2026-10-03 起透传——此前被 emit 丢弃） */
  tag?: string
  /** ★组件边界标记（见 LayoutNode.component；P1 组件系统） */
  component?: string
  text?: string
  /** 样式字段（width / height / flexDirection / margin / …）——**平铺在节点顶层** */
  [styleKey: string]: unknown
}
