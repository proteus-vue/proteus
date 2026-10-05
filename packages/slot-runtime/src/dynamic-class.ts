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
