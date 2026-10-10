// packages/slot-runtime/src/dynamic-class.ts
// ★★★G-61 B2（2026-10-05）：**动态 `:class` 预计算计划 · 运行时查表**（Profile §5 的落地）
//
// 【它解决什么（B2 的核心）】动态 `:class` 的样式在**编译期**已按「属性维度分解」展开成小查找表
//   （见 `packages/compiler/src/cse/dynamic.ts` 的生成端）——运行期只做**位图 + O(1) 数组索引**，
//   零选择器匹配、零层叠、零 2ⁿ 组合枚举。
//
// 【与既有 `resolveDynamicClasses`（线性匹配，批次 30）的关系】
//   既有函数在运行期**逐规则**匹配（`rules.every(c => active.has(c))`）并按 (特异性,源序) 覆盖——
//   它有两个结构性代价：① 每次变更 O(规则数) 匹配；② **无法表达"取消激活时回退到基线值"**
//   （它只返回"当前激活类贡献的字段"，未激活的字段不在返回值里 ⇒ 主机侧需要自己知道旧值）。
//   本模块的 plan 表**每个字段在每种位图下都有确定值**（含位图 0 = 静态基线）——
//   取消激活时照样写回基线 ⇒ 回退语义**由表保证**，不依赖主机记忆旧值。
//
// 【表形态（与生成端同源——改这里必须同步 compiler/src/cse/dynamic.ts）】
//   · bits 表：索引 = `bitmap & mask`（bit i ↔ plan.classes[i]）；适合非互斥类
//   · group 表：索引 = 互斥组状态（0 = 组内无活跃；i+1 = 组内第 i 个类活跃）——k 个互斥类只需 k+1 项
//
// 【O(1) 纪律（plan B2 验收："查表 O(1) 有 profile 证据"）】
//   `applyDynamicClassPlan` 对每个字段**恰好一次数组索引**（无扫描/无匹配循环）——
//   机器判据在 `tests/cse-dynamic.test.ts`（Proxy 计次：读次数 == 字段数，与表大小无关）。

import { collectActiveClasses } from './table'

/** 单字段查找表 */
export interface DynamicClassLookup {
  /**
   * 索引方式：
   * · `bits`：`values[map[bitmap & mask]]`（生成端预计算的**稠密**映射——masked bitmap 可能含高位，
   *   直接当数组下标会爆；map 字典键只含"实际可达"的 masked 值）
   * · `group`：`values[groupState(group)]`（互斥组——`mutexGroups[group]` 的位索引列表）
   */
  kind: 'bits' | 'group'
  /** kind=bits：位掩码 */
  mask?: number
  /** kind=bits：`bitmap & mask` → `values` 下标（稠密化） */
  map?: Record<number, number>
  /** kind=group：互斥组序号 */
  group?: number
  /** 值表（`bits`：长 = 取值数；`group`：长 k+1） */
  values: unknown[]
}

/** 动态类计划（编译期产出 · 序列化下发；每节点一份） */
export interface DynamicClassPlan {
  /** 候选动态类（位序 = 数组序；bit i ↔ classes[i]）；上限 32（见生成端守卫） */
  classes: string[]
  /** 逐 IR 字段的查找表（键 = StyleIR 字段名） */
  tables: Record<string, DynamicClassLookup>
  /** 互斥组（每项 = `classes` 的位索引列表；至多一个活跃——生成端按可证明的形态识别） */
  mutexGroups?: number[][]
  /** 生成端统计（编译期透出——爆炸保护与 explain 消费） */
  stats: {
    /** 表数（= 受动态类影响的字段数） */
    dynamicProps: number
    /** 单表最大取值数 */
    maxValues: number
    /** 未压缩时的组合数（Σ 2^|Dp| 口径见生成端） */
    combos: number
    /** 互斥压缩前→后（有互斥组时给出；供"互斥分组优化"可观测） */
    compressed?: { before: number; after: number }
  }
}

/** 位图（`classes` 的活跃位） */
export function bitmapOfDynamicClasses(active: Set<string>, classes: string[]): number {
  let b = 0
  for (let i = 0; i < classes.length; i++) if (active.has(classes[i]!)) b |= 1 << i
  return b >>> 0
}

/**
 * ★★★B3a（2026-10-10）：**有内核 `SET_STYLE`（f32 二进制）通道的数值布局字段**。
 *
 * 【为什么单列】动态 `:class` 命中的布局字段此前**端上不生效**（诊断 `DYNCLASS_LAYOUT_UNSUPPORTED`）：
 *   运行期把字段值（plan 产出的 **StyleIR 描述符** `{kind:'absolute',dp:N}`）经 `onPaintProp` 交给
 *   宿主补丁通道——而那是**绘制**通道（不认布局/描述符）。⇒ 数值布局字段改走**内核 `SET_STYLE`**
 *   （与 `:width` 绑定同一通道、**host-agnostic**：内核重排 ⇒ 三端零宿主改动即生效）。
 *   ★其余布局字段（枚举 `display`/`flexDirection`…、grid 模板）**无二进制通道** ⇒ 仍不支持（编译期诊断）。
 *   ★与内核 `ops_apply.rs::apply_style_key` 的登记**必须一致**（改一处要同步另一处）。
 */
export const NUMERIC_LAYOUT_FIELDS: ReadonlySet<string> = new Set([
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'rowGap', 'columnGap',
  'top', 'left', 'right', 'bottom',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'aspectRatio',
])

/** 从字段值取**数值**（plan 描述符 `{kind:'absolute',dp|px}` 或原始 number）；非数值 ⇒ null。 */
export function layoutNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value && typeof value === 'object') {
    const o = value as { kind?: unknown; dp?: unknown; px?: unknown }
    if (o.kind === 'absolute') {
      const n = typeof o.dp === 'number' ? o.dp : typeof o.px === 'number' ? o.px : null
      if (n !== null && Number.isFinite(n)) return n
    }
  }
  return null
}

/**
 * ★★★B3b（2026-10-10）：**可数字编码的枚举布局字段**（→ 同一条内核二进制 `SET_STYLE`）。
 *
 * 【为什么单列】枚举字段（`display`/`flexDirection`/…）的 plan 值是**字符串**（如 `"flex"`/`"row"`），
 *   而二进制 `SET_STYLE` 载荷是 f32 ⇒ 用**索引编码**（本表顺序即编码；内核 `apply_style_key` 同表顺序解码）。
 *   `default` = 该字段的**内核默认**索引（类关闭/无基线时回退到它——"清除回退"）。
 *   ★本表顺序与内核 `ops_apply.rs::apply_style_key` 的对应臂**必须逐字一致**（跨语言契约，同 `NUMERIC_LAYOUT_FIELDS`）。
 *   ★`overflowX`/`overflowY` **不在此表**（内核 `LStyle` 无轴级 overflow 字段）⇒ 仍不支持（诊断）。
 */
export const ENUM_LAYOUT_FIELDS: Record<string, { values: readonly string[]; default: number }> = {
  // display：Flex/Grid/None（内核 `Display`）
  display: { values: ['flex', 'grid', 'none'], default: 0 },
  // alignItems：内核 `align_items`（String → taffy）
  alignItems: {
    values: ['normal', 'start', 'end', 'flex-start', 'flex-end', 'self-start', 'self-end', 'center', 'stretch', 'baseline'],
    default: 8, // stretch（内核 default_align）
  },
  // flexDirection：Row/Column/RowReverse/ColumnReverse（内核 `FlexDirection`）
  flexDirection: { values: ['row', 'column', 'row-reverse', 'column-reverse'], default: 1 }, // column
  // flexWrap：Nowrap/Wrap/WrapReverse（内核 `FlexWrap`）
  flexWrap: { values: ['nowrap', 'wrap', 'wrap-reverse'], default: 0 }, // nowrap
  // position：Static/Relative/Absolute/Fixed/Sticky（内核 `Position`）
  position: { values: ['static', 'relative', 'absolute', 'fixed', 'sticky'], default: 0 }, // static
  // overflow：Visible/Hidden/Scroll/Auto（内核 `Overflow`）
  overflow: { values: ['visible', 'hidden', 'scroll', 'auto'], default: 0 }, // visible
  // ★B3c（2026-10-10）：justify-content / align-content / align-self（内核 `parse_justify`/`parse_align_content`/
  //   `parse_align_items` 接受的字符串 **含 CSS 别名 start/end**；本表顺序 = 索引编码；内核解码臂逐字对齐）。
  justifyContent: { values: ['flex-start', 'start', 'flex-end', 'end', 'center', 'space-between', 'space-around', 'space-evenly'], default: 0 },
  alignContent: { values: ['stretch', 'flex-start', 'start', 'flex-end', 'end', 'center', 'space-between', 'space-around', 'space-evenly'], default: 0 },
  // align-self：0=auto（⇒ 清空 None，回落父 justify-items，与 CSS 语义一致）
  alignSelf: { values: ['auto', 'flex-start', 'start', 'flex-end', 'end', 'center', 'baseline', 'stretch'], default: 0 },
}

/** 枚举字段值 → 索引（大小写不敏感）；未识别 ⇒ null（调用方回退默认）。 */
export function layoutEnumIndex(field: string, value: unknown): number | null {
  const spec = ENUM_LAYOUT_FIELDS[field]
  if (!spec || typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  const i = spec.values.indexOf(v)
  return i >= 0 ? i : null
}

/**
 * ★★★B3d（2026-10-10）：**字符串值字段**（值 = token 串，如 `1fr 1fr 200px`）——
 *   走 `SET_STYLE_STR`（f32 的 SET_STYLE 装不下）。★与内核 `apply_style_str_key` 的登记一致。
 *   ★这些字段**不在 CSE 预计算计划里**（计划只分解数值/枚举）⇒ 运行期需从线性规则补（见 runtime）。
 *   ★B-T2（2026-10-10）：并入**文本策略**（`whiteSpace`/`wordBreak`/`lineClamp`）——同为字符串值、
 *     同走 `SET_STYLE_STR`（内核按 key 区分：grid ⇒ 重排/DirtyOk(true)；文本策略 ⇒ 只记变更
 *     `text_policy_updates` 不重排，宿主据回执从内核重读并重度量/重绘）。
 */
export const STRING_LAYOUT_FIELDS: ReadonlySet<string> = new Set([
  'gridTemplateColumns', 'gridTemplateRows', 'gridTemplateAreas',
  'gridAutoColumns', 'gridAutoRows', 'gridAutoFlow',
  // ★B-T2：文本策略（字符串值）——内核持有 = SSOT；动态 :class 改它们走同一条 SET_STYLE_STR。
  'whiteSpace', 'wordBreak', 'lineClamp',
])

/** 互斥组状态：0 = 组内无活跃；i+1 = 组内第 i 个位活跃（按组内位序） */
export function groupStateOf(bitmap: number, groupBits: number[]): number {
  for (let i = 0; i < groupBits.length; i++) if ((bitmap & (1 << groupBits[i]!)) !== 0) return i + 1
  return 0
}

/**
 * **应用动态类计划**（唯一运行时入口；O(1)/字段）。
 *
 * @param classValue `:class` 绑定的值（对象/数组/字符串——与 `collectActiveClasses` 同语义）
 * @param plan 编译期计划
 * @param out 输出容器（键 = IR 字段名；**含基线值**——位图 0 时写回静态基线，回退语义由表保证）
 * @returns 本次写入的字段数（0 = 无表，调用方可跳过脏标记）
 */
export function applyDynamicClassPlan(classValue: unknown, plan: DynamicClassPlan, out: Record<string, unknown>): number {
  const tables = plan.tables
  const fields = Object.keys(tables)
  if (fields.length === 0) return 0
  const active = collectActiveClasses(classValue)
  const bitmap = bitmapOfDynamicClasses(active, plan.classes)
  const groups = plan.mutexGroups
  // 组状态预计算（O(k)，k = 组内位数；每表只做一次数组索引）
  let groupStates: number[] | null = null
  if (groups && groups.length > 0) {
    groupStates = groups.map((bits) => groupStateOf(bitmap, bits))
  }
  let written = 0
  for (const field of fields) {
    const t = tables[field]!
    let v: unknown
    if (t.kind === 'bits') {
      const masked = (bitmap & (t.mask ?? 0)) >>> 0
      v = t.values[t.map![masked]!]
    } else {
      v = t.values[groupStates ? groupStates[t.group ?? 0]! : 0]
    }
    out[field] = v
    written++
  }
  return written
}
