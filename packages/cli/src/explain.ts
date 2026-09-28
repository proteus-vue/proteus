// packages/cli/src/explain.ts
// proteus explain —— 底线循环 ② 的命令行化：
//   <vue 文件> → 决策 trace（该文件实际触发的全部转换规则）
//   <规则 ID>  → 该规则的 AI 说明书（what/why/when/example/verify/source）
import fs from 'node:fs'
import { explainTransform, formatTransformTrace, getTransformRule, formatTransformRule } from '@proteus-vue/compiler'
// ★★M0 出口条件（计划 §M0）：「proteus explain 能输出拍平/静态提升的完整决策 trace」
//   渲染 IR 决策与「转换规则 trace」是两类问题（前者=画什么/怎么画，后者=源码怎么改写），
//   故以 **--ir 开关并列**而非混入 —— 既有输出零变化。
import { buildPTree, analyzePTree, formatPTrace, rawFromComponentIR, toComponentIR } from '@proteus-vue/component-ir'
// ★★Vapor IR V2 出口条件（方案 §5.5：「proteus explain 必须能输出每个槽位的分层判定与理由」
//   ——「没有这个能力，L0/L1 混跑将完全无法调试。这是硬性要求」）
import { buildVaporSubscriptions } from '@proteus-vue/compiler'
import { decisionsToRows } from '@proteus-vue/slot-runtime'

export interface ExplainTargetOptions {
  /** 额外输出「渲染 IR 决策 trace」（拍平资格 / 静态子树 / PaintHint） */
  withIR?: boolean
  /** 只显示受阻节点（排查「为什么这个节点不能拍平」） */
  onlyBlocked?: boolean
  /** 节点显示上限（防输出爆炸） */
  maxNodes?: number
  /** ★额外输出「Vapor 槽位分层判定」（方案 §5.5 硬性要求：L0/L1 混跑的可观测性） */
  withVapor?: boolean
}

/**
 * Vapor 槽位分层判定报告（方案 §5.5 的输出形态）
 *
 * 【为什么必须有（方案原文）】「没有这个能力，L0/L1 混跑将完全无法调试。这是硬性要求。」
 *   输出三块：① 逐槽位判定（slot / 片段 / 层级 / 理由）
 *             ② 依赖图（源 → 槽位；解释"这个源变化会写哪些槽位"）
 *             ③ 覆盖率与降级原因汇总（L1 覆盖率是 §10 验收指标）
 */
export function explainVapor(source: string, opts: ExplainTargetOptions = {}): string {
  const res = buildVaporSubscriptions(source, 'explain.vue')
  const lines: string[] = []
  lines.push('── Vapor 槽位分层（Vapor for Proteus IR · V2） ──')
  // ★★诊断优先展示（本仓纪律：**不静默**）——error 级必须显眼
  //   （典型：无 `:key` ⇒ splice 后静默错行，方案坑位 #5）
  const errs = res.diagnostics.filter((d) => d.severity === 'error')
  const warns = res.diagnostics.filter((d) => d.severity === 'warn')
  for (const d of errs) {
    lines.push(`  ✗ [${d.code}] ${d.message}`)
    if (d.hint) lines.push(`      → ${d.hint}`)
  }
  for (const d of warns) {
    lines.push(`  ⚠ [${d.code}] ${d.message}`)
    if (d.hint) lines.push(`      → ${d.hint}`)
  }
  if (errs.length > 0 || warns.length > 0) lines.push('')
  if (!res.ok) {
    lines.push('  ✗ 源扫描失败 ⇒ 全部降级 L0（不猜测）：')
    for (const n of res.notes) lines.push(`    ${n}`)
    return lines.join('\n')
  }
  lines.push(...decisionsToRows(res.decisions).map((l) => `  ${l}`))
  const { l1, l0, l1Rate } = res.table.stats
  lines.push('')
  lines.push(`  L1 覆盖率：${(l1Rate * 100).toFixed(1)}%（L1 ${l1} / L0 ${l0}，合计 ${l1 + l0} 个槽位）`)
  if (res.table.sources.length > 0) {
    lines.push('')
    lines.push('  依赖图（源 → 槽位）：')
    for (const s of res.table.sources) {
      const ids = s.slots.map((x) => `slot_${x.slotId}(${x.propKey})`).join(', ')
      lines.push(`    ${s.sourceName} [${s.sourceKind}] → ${ids}`)
    }
  }
  if (res.notes.length > 0 && opts.onlyBlocked) {
    lines.push('')
    lines.push('  诊断：')
    for (const n of res.notes) lines.push(`    ${n}`)
  }
  return lines.join('\n')
}

/**
 * 从 SFC 源码构建渲染 IR 并产出决策 trace。
 * 说明：M0 阶段走「模板标签 → ComponentIR → PNode」的**保守路径**——
 *   只取模板中的 p-* 与原生标签及其静态 style，动态绑定/事件事实由 M2 接入模板分析后补全。
 *   故本 trace 当前主要用于：① 验证拍平判定的**结构**正确性 ② 排查 Profile 违规属性。
 */
export function explainIR(source: string, opts: ExplainTargetOptions = {}): string {
  const tags = [...source.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)]
    .filter((m) => !['template', 'script', 'style', 'template', '/'].includes(m[1]!))
    .map((m) => m[0])
  // 提取每个标签的静态 style 声明（`style="..."` 与 `:style` 的动态部分不在此解析——M2 接入）
  const raws = tags.map((tagSrc) => {
    const tag = /<([a-z][\w-]*)/.exec(tagSrc)?.[1] ?? 'view'
    const styleAttr = /(?:^|\s)style="([^"]*)"/.exec(tagSrc)?.[1]
    const ir = toComponentIR(tag, styleAttr ? { style: styleAttr } : {})
    const raw = ir ? rawFromComponentIR(ir) : { tag }
    // 事件（@click 等）与动态绑定（:xxx）视为「非静态 + 有事件」（保守判定——M2 精确化）
    const hasEvent = /(?:^|\s)@[a-z]/.test(tagSrc) || /(?:^|\s)v-on:/.test(tagSrc)
    const hasDynamic = /(?:^|\s):[a-z]/.test(tagSrc) || /(?:^|\s)v-bind:/.test(tagSrc) || /v-(?:if|for|model)\b/.test(tagSrc)
    if (hasEvent || hasDynamic) {
      raw.facts = { ...(raw.facts ?? {}), hasEvent, ...(hasDynamic ? {} : {}) }
    }
    return { ...raw, ...(hasDynamic ? { bindings: [{ propKey: 'attr', exprId: 'dynamic' }] } : {}) }
  })
  const tree = buildPTree(raws)
  const analysis = analyzePTree(tree)
  return formatPTrace(tree, analysis, { onlyBlocked: opts.onlyBlocked, maxNodes: opts.maxNodes })
}

/** 智能识别目标：文件存在 → vue 决策 trace；否则 → 规则 ID 的 AI 说明书（纯函数，可单测） */
export function explainTarget(target: string, opts: ExplainTargetOptions = {}): string {
  if (fs.existsSync(target)) {
    const source = fs.readFileSync(target, 'utf-8')
    const result = explainTransform(source, { filename: target })
    const base = formatTransformTrace(result)
    // ★--ir：追加渲染 IR 决策 trace（M0 出口条件）
    if (opts.withIR) return `${base}\n\n${explainIR(source, opts)}`
    // ★--vapor：追加槽位分层判定（V2 出口条件，方案 §5.5 硬性要求）
    if (opts.withVapor) return `${base}\n\n${explainVapor(source, opts)}`
    return base
  }
  const rule = getTransformRule(target)
  if (rule) return formatTransformRule(rule)
  throw new Error(`无法识别目标「${target}」：既不是存在的 .vue 文件，也不是注册的规则 ID（用 proteus rules 查看全部规则）`)
}
