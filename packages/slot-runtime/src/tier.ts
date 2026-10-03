// packages/slot-runtime/src/tier.ts
// Vapor for Proteus IR —— 渐进式安全边界（方案 §5）：L1 准入判定与可观测输出
//
// 【为什么判定逻辑放在运行时包（而不是编译器包）】
//   判定结果要被**三端共用**：编译器产出 `tier` 字段、运行时按 tier 决定走哪条路径、
//   `proteus explain` 展示理由。若把判定只放在编译器里，运行时与诊断会各写一份 ⇒
//   出现「编译器判 L1、运行时按 L0 跑」这类静默分叉（本仓纪律：同一语义只允许一处实现）。
//
// 【★方案 §5.5 原文：没有可观测性，L0/L1 混跑将完全无法调试——"这是硬性要求"】
//   故本文件同时提供 `explainDecision()`（人读）与 `decisionsToRows()`（表格/JSON 输出）。
// ★判定原则（方案 §5.1）：**能证明才激进，否则退回**；误判为 L1 会导致**静默的 UI 不更新**，
//   比慢 10 倍严重得多（方案 §12 第 3 条）⇒ 判据一律按「无法证明 = L0」处理。
import type { UpdateTier } from './opcode'

/** L1 准入条件（方案 §5.3 七条，C1–C7） */
export const L1_CONDITIONS = {
  C1: '表达式为纯函数（无副作用、无 I/O、无闭包写入）',
  C2: '依赖集编译期可枚举（不出现运行时才确定的标识符）',
  C3: '不依赖动态组件（无 `<component :is>` 的运行时解析）',
  C4: '不涉及动态 slot 分发（slot 内容静态确定）',
  C5: '不含运行时才确定的 `v-if` 分支结构（分支条件可静态分析）',
  C6: '不在自定义 render 函数中（手写 `h()` 无法静态分析）',
  C7: '不依赖 `getCurrentInstance` / 内部 API（3.6 Vapor 亦不支持，此处同理）',
} as const

export type ConditionId = keyof typeof L1_CONDITIONS

/** 判定输入（编译器对每个绑定收集的事实） */
export interface TierFacts {
  /** 表达式是纯函数调用（无副作用） */
  pureExpression?: boolean
  /** 依赖标识符全部静态可知 */
  depsEnumerable?: boolean
  /** 是否位于动态组件（`<component :is>`）内 */
  insideDynamicComponent?: boolean
  /** 是否位于动态 slot 分发内 */
  insideDynamicSlot?: boolean
  /** 是否位于运行时才可判定的 v-if 分支内 */
  insideRuntimeBranch?: boolean
  /** 是否位于手写 render / JSX 中 */
  insideRenderFunction?: boolean
  /** 是否依赖 getCurrentInstance 等内部 API */
  usesInstanceInternals?: boolean
  /** ★逃生通道：`// @proteus-pure`（强制升级；违背 C1 时由人工担保） */
  forcePure?: boolean
  /**
   * ★★**内建白名单纯函数**（P2-8，2026-10-03）：表达式里的调用**全部**在 `PURE_CALLS` 内
   *   （`Math.round` / `String` / `parseInt`…）。
   *
   * 【与 forcePure 的区别（必须分开）】两者都让 C1 通过，但**可信度不同**：
   *   · 本字段 = **语言级静态可证**（表是跨端一致的内建语义，可复算）；
   *   · `forcePure` = **开发者承诺**（`@proteus-pure`，人工担保）。
   *   ⇒ 诊断/explain 必须能区分二者（首版把内建纯函数也显示成"人工担保"，属误导）。
   */
  builtinPure?: boolean
  /** ★反向逃生通道：`<!-- @proteus-tier=L0 -->`（强制降级） */
  forceTier?: UpdateTier
}

export interface TierDecision {
  tier: UpdateTier
  /** 未通过的准入条件（空 = 全部通过；L0 时至少一项或 forced） */
  failed: ConditionId[]
  /** 人读理由（`proteus explain` 直接输出） */
  reason: string
  /** 是否被显式注解强制（诊断时需要区分「编译器判定」与「人工指定」） */
  forced: boolean
}

/**
 * 事实 → 准入条件的映射（★每条带**极性**）
 *
 * 【为什么必须有极性（本仓实测：首版漏掉它，测试立刻抓到）】C1/C2 是**肯定式**
 *   （"是纯函数"、"依赖可枚举" ⇒ 事实为 `true` 才通过）；C3–C7 是**否定式**
 *   （"**不**依赖动态组件"… ⇒ 事实为 `false` 才通过）。
 *   若统一按"必须为 true"判，则任何**没出现动态组件**的绑定都会被判 L0
 *   ——恰好把最该升级的简单绑定全部降级（方向反了）。
 *   缺省（未提供）在两种极性下都视为**未证明 ⇒ 不通过**（方案 §5.1「能证明才激进」）。
 */
const CONDITION_RULES: Array<{ fact: keyof TierFacts; cond: ConditionId; expect: boolean }> = [
  { fact: 'pureExpression', cond: 'C1', expect: true },
  { fact: 'depsEnumerable', cond: 'C2', expect: true },
  { fact: 'insideDynamicComponent', cond: 'C3', expect: false },
  { fact: 'insideDynamicSlot', cond: 'C4', expect: false },
  { fact: 'insideRuntimeBranch', cond: 'C5', expect: false },
  { fact: 'insideRenderFunction', cond: 'C6', expect: false },
  { fact: 'usesInstanceInternals', cond: 'C7', expect: false },
]

/**
 * 判定一个绑定走 L1 还是 L0（方案 §5.3）
 *
 * 【缺省即降级】`TierFacts` 里未提供的字段按「未知」处理 ⇒ 对应条件视为**未通过**。
 *   这是刻意的：编译期没证明的事，运行时不许假设。
 */
export function decideTier(facts: TierFacts): TierDecision {
  // 反向逃生通道优先级最高（方案 §5.6：用于规避误判）
  if (facts.forceTier === 'L0') {
    return { tier: 'L0', failed: [], reason: '人工指定 @proteus-tier=L0（反向逃生通道）', forced: true }
  }

  const failed: ConditionId[] = []
  for (const { fact, cond, expect } of CONDITION_RULES) {
    // C1 例外：白名单内建纯（语言级可证）或 forcePure（人工担保）把「无法证明纯」升级为通过
    if (cond === 'C1' && (facts.forcePure || facts.builtinPure)) continue
    if (facts[fact] !== expect) failed.push(cond)
  }

  if (failed.length === 0) {
    return {
      tier: 'L1',
      failed: [],
      reason: facts.builtinPure
        ? 'C1 由**内建白名单纯函数**静态保证（PURE_CALLS），其余条件静态证明通过'
        : facts.forcePure
          ? 'C1 由 @proteus-pure 人工担保，其余条件静态证明通过'
          : '纯函数 / 依赖可枚举 / 无动态结构',
      // ★forced 表示"非静态可证"（explain 里显 ⚠）：内建白名单**是**静态可证的 ⇒ 不标 forced
      forced: Boolean(facts.forcePure) && !facts.builtinPure,
    }
  }

  const detail = failed.map((c) => `${c} ${L1_CONDITIONS[c]}`).join('；')
  return { tier: 'L0', failed, reason: `未通过：${detail}`, forced: false }
}

/** `proteus explain` 的行视图（方案 §5.5 的示例形态） */
export interface ExplainRow {
  slotId: number
  /** 源码片段（如 `:class="{active}"`） */
  snippet: string
  tier: UpdateTier
  /** 判定理由 */
  reason: string
  /** 诊断前缀：✓ 通过 / ✗ 未通过 / ⚠ 人工强制 */
  mark: '✓' | '✗' | '⚠'
}

/** 单行渲染（与方案 §5.5 的输出形态对齐） */
export function explainDecision(slotId: number, snippet: string, decision: TierDecision): ExplainRow {
  const mark: ExplainRow['mark'] = decision.forced ? '⚠' : decision.tier === 'L1' ? '✓' : '✗'
  return { slotId, snippet, tier: decision.tier, reason: decision.reason, mark }
}

/** 表格视图（CLI / 测试断言用；列序固定 ⇒ 快照可锁定） */
export function decisionsToRows(rows: ExplainRow[]): string[] {
  return rows.map((r) => `slot_${r.slotId}  ${r.snippet}  → ${r.tier} ${r.mark} ${r.reason}`)
}
