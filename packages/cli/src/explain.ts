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
import { buildVaporSubscriptions, buildLayoutTemplate } from '@proteus-vue/compiler'
// ★VC2-b：`proteus explain <CSS-PB-*>` ——边界规则的说明（卡片验收："可 trace 为什么该属性被拦截"）
import { SKYLINE_BOUNDARY_RULES } from '@proteus-vue/css-compat'
// ★VC8-b：`proteus explain <一致性报告.json>` ——失败报告的解释（卡片验收："可被 proteus explain 消费"）
import { isConsistencyReport, formatReport } from '@proteus-vue/consistency'
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
  /** ★★P4 能力视图（2026-10-03）：与 `withVapor` 合用 ⇒ 输出**机器可读**的能力缺口（CI/门禁消费） */
  json?: boolean
}

/**
 * ★★★**Vapor 能力缺口总账**（P4「能力视图」，2026-10-03）——把页面用的"未支持特性"变成**机器可查**。
 *
 * 【为什么必须有（本仓实测的静默缺陷）】`explain --vapor` 此前**只读订阅表侧诊断**
 *   （`buildVaporSubscriptions`），而**模板侧诊断**（`v-html` / 自定义指令 / 内置组件边界 /
 *   动态组件 / 插槽 / Transition 用法…——**绝大多数能力缺口产生在那里**）**一条都不显示**。
 *   ⇒ 用户跑 explain 自查"这份页面有没有问题"，看到的是"槽位分层全绿"，
 *     而 v-html 没有富文本通道、v-focus 不会运行这类事实**完全不可见**——
 *     **诊断工具自己把诊断吞了**（"静默风险"主线上的最"元"一处）。
 *
 * 【为什么按 code 归类而不是罗列】缺口的**可行动性**在"类"上：一类一个修法。
 *   罗列 N 条重复消息会让真正需要看的那条被淹没（本仓"诊断噪声淹没真问题"的教训同源）。
 *
 * 【诚实边界】"supported" 的判据是「**无 error / warn 级诊断**」——不代表"所有 Vue 语法都支持"，
 *   只代表"本框架的编译链对这份源码**没有未说明的差异**"（每条差异都有诊断，这正是本仓纪律）。
 */
export interface VaporGapSummary {
  /** 合并后的全部诊断（模板侧 + 订阅侧） */
  diagnostics: Array<{ severity: string; code: string; message: string; hint?: string }>
  /** 按 code 归类（计数 + 代表条目 + 代表修法；顺序 = 首现顺序 ⇒ 可复现） */
  byCode: Array<{ code: string; severity: string; count: number; sample: string; hint?: string }>
  errorCount: number
  warnCount: number
  infoCount: number
  /** 机器判据：无 error/warn ⇒ true（CI / 门禁可据此判定"零未说明差异"） */
  supported: boolean
  stats: { tplNodes: number; l1: number; l0: number; l1Rate: number; tplOk: boolean }
}

/**
 * 分析一份 SFC 的 Vapor 能力缺口（**模板侧 + 订阅侧**合并——见上方注释的静默缺陷）。
 * ★这是 `explain --vapor` 与 `--json` 的**共享实现**（一处实现，两种呈现）。
 */
export function analyzeVaporGaps(source: string): VaporGapSummary {
  const tpl = buildLayoutTemplate(source, 'explain.vue')
  const sub = buildVaporSubscriptions(source, 'explain.vue')
  const merged = [
    ...tpl.diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message, hint: d.hint })),
    ...sub.diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message, hint: d.hint })),
  ]
  const order: string[] = []
  const byCodeMap = new Map<string, VaporGapSummary['byCode'][number]>()
  for (const d of merged) {
    const hit = byCodeMap.get(d.code)
    if (hit) {
      hit.count++
      // ★severity 取**更高**一级（同类里出现过 error ⇒ 该类标 error——不给"同类就轻"的错觉）
      if (d.severity === 'error') hit.severity = 'error'
      continue
    }
    order.push(d.code)
    byCodeMap.set(d.code, { code: d.code, severity: d.severity, count: 1, sample: d.message, ...(d.hint ? { hint: d.hint } : {}) })
  }
  const errorCount = merged.filter((d) => d.severity === 'error').length
  const warnCount = merged.filter((d) => d.severity === 'warn').length
  const infoCount = merged.length - errorCount - warnCount
  return {
    diagnostics: merged,
    byCode: order.map((c) => byCodeMap.get(c)!),
    errorCount,
    warnCount,
    infoCount,
    supported: errorCount === 0 && warnCount === 0,
    stats: {
      tplNodes: tpl.template.nodes.length,
      tplOk: tpl.ok,
      l1: sub.table.stats.l1,
      l0: sub.table.stats.l0,
      l1Rate: sub.table.stats.l1Rate,
    },
  }
}

/** `explain --vapor --json` 的机器可读形态（CI / 门禁消费；字段即 `VaporGapSummary`） */
export function explainVaporJson(source: string): string {
  return JSON.stringify(analyzeVaporGaps(source), null, 2)
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
  // ★★★能力缺口总账（P4 能力视图，2026-10-03）——**第一步就展示**：
  //   此前本函数只读订阅表侧诊断（模板侧全被吞——见 analyzeVaporGaps 注释的静默缺陷），
  //   现改为合并两侧、按 code 归类（一类一个修法，防重复消息淹没真问题）。
  const gaps = analyzeVaporGaps(source)
  if (gaps.diagnostics.length > 0) {
    lines.push('')
    lines.push(`── 能力缺口 / 需要注意（共 ${gaps.diagnostics.length} 条 · ${gaps.byCode.length} 类）──`)
    for (const g of gaps.byCode) {
      const mark = g.severity === 'error' ? '✗' : g.severity === 'warn' ? '⚠' : 'ⓘ'
      lines.push(`  ${mark} [${g.code}] × ${g.count}：${g.sample}`)
      if (g.hint) lines.push(`      → ${g.hint}`)
    }
  } else {
    lines.push('')
    lines.push('  能力缺口：无（本框架编译链对这份源码**没有未说明的差异**）')
  }
  lines.push('')
  // ★★诊断优先展示（本仓纪律：**不静默**）——error 级必须显眼
  //   （典型：无 `:key` ⇒ splice 后静默错行，方案坑位 #5）
  const errs = gaps.diagnostics.filter((d) => d.severity === 'error')
  const warns = gaps.diagnostics.filter((d) => d.severity === 'warn')
  if (!res.ok) {
    lines.push('  ✗ 源扫描失败 ⇒ 全部降级 L0（不猜测）：')
    for (const n of res.notes) lines.push(`    ${n}`)
    return lines.join('\n')
  }
  lines.push(...decisionsToRows(res.decisions).map((l) => `  ${l}`))
  const { l1, l0, l1Rate } = res.table.stats
  lines.push('')
  lines.push(`  L1 覆盖率：${(l1Rate * 100).toFixed(1)}%（L1 ${l1} / L0 ${l0}，合计 ${l1 + l0} 个槽位）`)
  void errs
  void warns
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
    // ★VC8-b：一致性失败报告（JSON）→ 解释渲染（含修复建议与 autoFixes）
    if (target.endsWith('.json')) {
      try {
        const parsed = JSON.parse(source) as unknown
        if (isConsistencyReport(parsed)) {
          const head = `目标 ${target} = 一致性失败报告（proteus-consistency-report v${parsed.version}）`
          return `${head}\n\n${formatReport(parsed)}`
        }
      } catch {
        /* 非 JSON 或非本格式 ⇒ 继续按 .vue 处理（向下兼容） */
      }
    }
    const result = explainTransform(source, { filename: target })
    const base = formatTransformTrace(result)
    // ★★P4 能力视图（2026-10-03）：`--json` 输出**机器可读**的能力缺口总账（CI/门禁消费）。
    //   放在最前：这是"这份页面用了哪些未支持特性"的**机器判据**（supported 字段可 gate）。
    if (opts.withVapor && opts.json) return explainVaporJson(source)
    // ★--ir：追加渲染 IR 决策 trace（M0 出口条件）
    if (opts.withIR) return `${base}\n\n${explainIR(source, opts)}`
    // ★--vapor：追加槽位分层判定（V2 出口条件，方案 §5.5 硬性要求）
    if (opts.withVapor) return `${base}\n\n${explainVapor(source, opts)}`
    return base
  }
  const rule = getTransformRule(target)
  if (rule) return formatTransformRule(rule)
  // ★VC2-b：边界规则（CSS-PB-<prop>）——解释"为什么该属性/取值在 Skyline 端被拦截"
  const pb = SKYLINE_BOUNDARY_RULES.find((r) => r.id === target)
  if (pb) {
    return [
      `规则：${pb.id}`,
      `属性：${pb.prop}`,
      `拦截原因：该端（skyline）接受的值域 = ${pb.accept.join(' / ')}；写入其他值 ⇒ 编译期报错（VC2-b）`,
      `替代方案：${pb.suggestion}`,
      `事实来源：${pb.source}`,
      `豁免方式：样式块内注释 \`proteus-allow-profile: <理由>\`（理由非空才生效，豁免计入构建统计）`,
      `全部边界规则：node scripts/gen-end-support-matrix.mjs --check 查看矩阵，或 grep CSS-PB 于 docs/generated/end-support-matrix.json`,
    ].join('\n')
  }
  throw new Error(`无法识别目标「${target}」：既不是存在的 .vue 文件，也不是注册的规则 ID（用 proteus rules 查看全部规则）`)
}
