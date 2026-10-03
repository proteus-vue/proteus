// packages/slot-runtime/src/table.ts
// Vapor for Proteus IR —— **订阅表契约**（方案 §4.4）的**归属地**
//
// 【为什么这些类型放运行时包而不是编译器包】
//   依赖方向必须单向：`compiler → slot-runtime`（编译器产出订阅表）；反过来会成环。
//   与 V1 的 `OpCode` 同理——**契约定义在消费端（运行时），生产端（编译器）import**。
//   本仓纪律：同一语义只允许一处定义（复制一份必然在两处分叉）。
import type { SlotKind, UpdateTier } from './opcode'

/** 一个槽位的订阅条目 */
export interface SlotSubscription {
  /** 槽位 id（编译期连续分配；与 component-ir 的 DynamicBinding.slotId 对齐） */
  slotId: number
  /** 目标节点 id（component-ir 分配） */
  nodeId: number
  /** 求值函数 id（指向 `evaluators`；运行时按 id 取函数，不做字符串解析） */
  evaluatorId: number
  tier: UpdateTier
  /** 槽位种类（决定发射哪种指令） */
  kind: SlotKind
  /** 目标属性键（归一化名，进 PropKeyTable） */
  propKey: string

  /* ── ★V4：列表行内槽位（kind='list-item' 时用；方案 §2.3）── */

  /**
   * 所属列表 id（编译期分配）
   *
   * 【为什么需要（本仓实测的功能缺口）】v-for 的行会实例化 N 次 ⇒ 行内绑定**没有单一固定 nodeId**
   *   ⇒ 必须由运行时按 `(listId, itemKey, itemSlotId)` 解析出**具体那一行**的节点
   *   （`ListRegistry` 的职责）。缺这三个字段时，行内绑定会被当成普通槽位写到"模板节点"上（错）。
   */
  listId?: number
  /** 行模板内的槽位序号（稳定：按行模板内绑定的出现顺序分配） */
  itemSlotId?: number
  /** 解析出节点后按什么语义发指令：样式（SET_STYLE）还是文本（SET_TEXT） */
  itemKind?: 'style' | 'text'
  /**
   * ★行内目标值的**取值路径**（相对行对象，如 `w` / `title`）
   *
   * 【为什么需要（本仓实测的接线缺口）】源求值器返回的是**整行数据**（`item` 对象），
   *   而槽位要写的是**该行的某个字段** ⇒ 运行时必须用本字段从行对象里取出目标值，
   *   并与 `keyField`（行标识）一起组成 `{key, value}` 交给发射器。
   *   例：`{{ item.title }}` ⇒ itemKeyField='id'、itemValueField='title'。
   */
  itemValueField?: string
  /**
   * ★行标识取值路径（相对行对象，如 `id`；来自 `:key="item.id"`）
   *
   * 缺省（无 `:key`）⇒ 运行时用**行下标**兜底（方案坑位 #5 警告：index 作 key 在 splice 后会错位）。
   */
  itemKeyField?: string
  /** v-for 别名（行作用域求值用：把「当前行」绑定到该别名） */
  scope?: string
  /**
   * 列表源表达式（`groups` / `group.items`）
   *
   * 【为什么需要（嵌套 v-for）】内层列表的源是**外层行的一个字段**（`group.items`），
   *   其根 `group` 是外层行别名、不是顶层源 ⇒ 运行时须按本表达式逐级求值。
   */
  sourceExpr?: string
  /** 外层列表的 listId（嵌套时才有；运行时先取外层行，再在行上求内层数组） */
  parentListId?: number

  /* ── ★★P2-5（2026-10-03）：v-once / v-memo 语义 ── */

  /**
   * ★`v-once`：该槽位**只写一次**（首次 relink 写入后永久冻结）。
   *
   * 【语义与实现】（Vue：元素只渲染一次、之后不再更新）
   *   · 编译期：v-once 子树内的绑定打上本标记；
   *   · 运行时：首次写值后记入 `onceWritten`，此后再不写（源变化/relink 都跳过）。
   *   ★为什么是"建槽位但只写一次"而不是"不建槽位"：初值回填走的是同一张槽位表
   *     （`instantiateTemplate` 按槽位填首帧）——不建槽位会让首帧**没有值**（空白）。
   *     观测语义（冻结在首帧值）与"不建槽位"等价，且复用同一条回填链（少一条路径 = 少一处能分叉的实现）。
   *   ★诚实边界：v-for 行内的 v-once 不按此实现（诊断，见 build.ts）——官方在列表里用
   *     **共享缓存槽**（首项内容冻结后复用给所有行，`_cache[0]`），语义反直觉，不照抄。
   */
  once?: boolean
  /**
   * ★`v-memo`：该槽位属于某个 memo 组；组内依赖**全都没变**时跳过写入。
   *
   * 【语义】（Vue：`v-memo="[a,b]"` ⇒ 依赖未变则跳过子树更新）
   *   依赖表达式编译成程序存在 `SubscriptionTable.memoGroups`；运行时按组比较
   *   （Object.is 逐项）——变了才写、并把新值记为基线下一次比较用。
   *   ★关键：依赖源必须在**订阅图**里（编译期把 deps 的根也挂到源上）——
   *     否则"依赖变了"这件事根本不会触发求值（静默漏更新）。
   */
  memoId?: number
}

/**
 * ★★**memo 组**（P2-5）——`v-memo="[a, b]"` 的依赖程序表（纯 JSON，可序列化）。
 *
 * 【为什么依赖单独成表而不是内联在每个槽位上】同一子树里的多个槽位共享同一组依赖
 *   （元素上有 v-memo，子树里可能有多个绑定）⇒ 内联会重复编译同一份表达式，且
 *   运行时同一组要多份快照（组语义是"任一依赖变了 ⇒ 整棵子树更新"）。
 */
export interface MemoGroup {
  /** 组 id（编译期按出现顺序分配） */
  memoId: number
  /** 依赖表达式程序（按源码书写顺序） */
  deps: import('./expr').ExprProgram[]
  /** 依赖源码（诊断/对账用） */
  depsSrc: string[]
}

/** 一个响应式源的订阅条目 */
export interface SourceSubscription {
  sourceId: number
  sourceName: string
  sourceKind: 'ref' | 'reactive' | 'computed' | 'props' | 'model' | 'unknown'
  /** ★该源变化时要直写的槽位（L1）；L0 槽位不出现在这里（走 Vue 渲染） */
  slots: SlotSubscription[]
}

/**
 * 求值函数规格（**可序列化**——不含闭包，运行时可从这份声明重建函数）
 *
 * ★形态只有三种，刻意保持极小：
 *   · `expr`   表达式文本（各端按自己的表达式能力求值）
 *   · `const`  常量（源变化不影响它 ⇒ 一般不出现，保留给静态提升）
 *   · `member` 纯成员访问（`item.name` 这类最常见形态，**免解析**直接取值 —— 热路径优化）
 */
export interface EvaluatorSpec {
  evaluatorId: number
  /**
   * 求值器形态
   *
   * · `member`  纯成员访问（免解析，最快）
   * · `const`   常量
   * · **`program` 结构化表达式程序**（★方案 §4.3 Step 4 的落地形态：可序列化、跨端可执行）
   * · `expr`    原始表达式文本（**参考实现不支持** ⇒ 会进 `uninstantiatedSlots` 上报；
   *             各端可用自己的表达式执行器消费它：Hermes function 构造 / Web `new Function` / MP 走 WXS）
   */
  form: 'expr' | 'const' | 'member' | 'program'
  /** `form='program'` 时的表达式程序（纯 JSON） */
  program?: import('./expr').ExprProgram
  /** form='expr' 时的表达式源码 */
  expr?: string
  /** form='member' 时的完整路径（`a.b.c`）与其根名 */
  path?: string
  root?: string
  /** 纯函数注解（来源：`@proteus-pure`） */
  pure?: boolean
}

/**
 * 订阅表（方案 §4.4 的 `SubscriptionTable`）
 *
 * ★为什么是**可序列化的表**而不是 JS 源码字符串：
 *   方案 §4.4 明确「编译期产出的不是 JS 源码字符串，而是可序列化的订阅表」——
 *   源码字符串要在运行时 eval/new Function（跨端受限，小程序端禁 eval），
 *   而表可以被 JSON 序列化随产物下发，运行时按 id 查函数。
 */
export interface SubscriptionTable {
  /** 契约版本（与 evaluator 形态同步 bump） */
  version: 1
  /** 源表（id 稳定，按声明顺序） */
  sources: SourceSubscription[]
  /** 求值函数表（id → 形态声明） */
  evaluators: EvaluatorSpec[]
  /**
   * ★★memo 组表（P2-5）——`v-memo` 的依赖程序（缺省 = 无 v-memo 使用；既有产物不变）。
   *   运行时按 `memoId` 查依赖、按「组」比较（任一依赖变化 ⇒ 组内槽位照常写）。
   */
  memoGroups?: MemoGroup[]
  /**
   * ★★**常量槽位**（P2-8，2026-10-03）——求值器**无任何源依赖**的槽位（如 `{{ Math.PI }}`
   *   被内联成字面量程序、`{{ 5 }}` 这类常量表达式）。
   *
   * 【为什么必须单列（本仓实测的真缺口）】订阅表以 `sources` 为骨架（"哪个源变写哪个槽位"），
   *   而**没有源的槽位无处安放** ⇒ 既不在任何 source.slots 里、也不在 l0Slots 里 ⇒
   *   实例化回填与 `relink` 都**看不到它** ⇒ **首帧空白**（`{{ Math.PI }}` 渲染成空、且零报错）。
   *   ⇒ 单列本表：它**永不更新**（没有源），但**必须参与首帧回填**（与其余槽位同一条回填链）。
   */
  constantSlots?: SlotSubscription[]
  /**
   * ★★★**作用域插槽内容绑定**（P1-3 作用域插槽，2026-10-03）——父级 `#x="sp"` 内容子树里
   *   **引用 `sp.*` 的样式绑定**（如 `:width="sp.w"`）。
   *
   * 【为什么必须单列（本仓实测的静默丢弃）】这类绑定的依赖是**插槽作用域变量**而非顶层源 ⇒
   *   既挂不到任何 `sources`，也不属 `constantSlots`（它确实有依赖）⇒ 此前**整条绑定消失**
   *   （产物里连槽位都没有，只留一条误导性的"未挂到任何列表源"提示）⇒ 样式静默不生效。
   *   ⇒ 单列本表：**分发时**（出口被内容填充的那一刻）用「作用域读」求值一次并写节点字段。
   *
   * 【诚实边界】只做**初始分发**求值——出口源后续变化不重分发（见 `LayoutNode.slotFor.scope`）。
   */
  slotScopedSlots?: Array<{
    slotId: number
    /** 内容节点的**模板序 local id**（与 LayoutNode.id 同源；分发时按它定位） */
    nodeId: number
    propKey: string
    evaluatorId: number
    /** 作用域变量名（与 `slotFor.scope` 匹配——多重嵌套插槽时区分） */
    scope: string
  }>
  /** 未走 L1 的槽位（诊断：解释"为什么这个绑定没有加速"） */
  l0Slots: Array<{ slotId: number; nodeId: number; propKey: string; reason: string }>
  /** 统计（棘轮 / 覆盖率度量用） */
  stats: {
    l1: number
    l0: number
    /** L1 覆盖率 = l1 / (l1 + l0)（§10 验收：≥70%） */
    l1Rate: number
  }
}
