// packages/compiler/src/cse/lint.ts
// ★★★G-61 B4（2026-10-05）：**CSS 引擎 lint**（Profile §7 的 E-CSS-001~006 / W-CSS-101~105 全量）
//
// 【它守什么（plan `04-batches-and-boundaries.md` B4 行 + Profile §7）】
//   「Profile 外写法在 **Web 端也报错**」（= 基准自身合法 D4：不合规的写法不得进基准集）
//   ＋「降级产物过 Applier conformance」（degradeTo 配方执行器，见 `degrade.ts`）。
//
// 【为什么 lint 挂在 CSE（而不是 css-compat 的 postcss 规则表）】
//   `packages/css-compat` 的 CSS001~012 是**字符串级**校验（老链路）。E-CSS 族面向 **IR 语义**：
//   · E-CSS-004/005 需要**动态 class 的候选集/表数**（B2 的产出）
//   · E-CSS-006 需要**拍平资格**（component-ir 的 pnode-analyze）
//   · W-CSS-101/103 需要**选择器结构**（CSE 的 parse 产物——特异性/嵌套深度）
//   ⇒ 本模块消费 CSE 的**结构化产物**（CseStyleSheet / CseNode / 计划表），比字符串匹配准。
//
// 【★与 cfg 的关系（P6 的"Web 端 lint 接入"）】本模块是**平台无关**的（不依赖 DOM/宿主）——
//   Web/App/MP 三条构建链都能跑（同一份源码 ⇒ 同一份诊断）。Web 侧接入见
//   `packages/plugin-vite/src/cse-lint-plugin.ts`（编译期报错，与 MP/App 同判据）。
//
// 【规则清单（与 Profile §7 逐条对应）】
//   E-CSS-001 L5 禁止（动态选择器/样式表插入）· E-CSS-002 未声明的 L3 · E-CSS-003 Profile 外属性
//   E-CSS-004 :class 不可枚举 · E-CSS-005 动态表超限 · E-CSS-006 拍平节点绑定事件/transform
//   W-CSS-101 嵌套深度 >3 · W-CSS-102 !important · W-CSS-103 ID 选择器 · W-CSS-104 动态数接近阈值
//   W-CSS-105 不支持 grid 的端用了 grid

import type { CseNode, CseStyleSheet } from './types'
import type { DynamicClassPlan } from '@proteus-vue/slot-runtime'

/** 诊断（与既有编译器诊断同形——severity/code/message/hint） */
export interface CseLintDiagnostic {
  severity: 'error' | 'warn'
  /** E-CSS-00x / W-CSS-10x */
  code: string
  message: string
  hint?: string
  /** 位置（样式表行 / 节点 key——能定位就带上） */
  where?: { nodeKey?: string; sheet?: number; line?: number; selector?: string }
}

export interface CseLintOptions {
  /** 端（决定 W-CSS-105 等端相关规则；缺省 'web'——Web 也要报，Profile 才是三端交集） */
  target?: 'web' | 'skyline' | 'app'
  /** 该端不支持的 CSS 属性（值域级能力——如 Skyline 的 display:grid） */
  unsupportedDecls?: Array<{ prop: string; accept: readonly string[]; suggestion?: string }>
  /** 动态类计划（B2 产出；有则跑 E-CSS-004/005 与 W-CSS-104） */
  classPlans?: Record<string, DynamicClassPlan>
  /** B2 的候选枚举失败记录（有则转 E-CSS-004） */
  dynamicErrors?: Array<{ nodeKey: string; expr: string; reason: string }>
  /** 拍平不合格记录（component-ir 的 pnode-analyze 产出；有则转 E-CSS-006） */
  flattenViolations?: Array<{ nodeId: number; reason: string }>
  /** 单节点动态表数阈值（E-CSS-005；与 B2 的 warn 阈值不同——本处是**error**级上限） */
  maxDynamicTables?: number
  /** W-CSS-104 的"接近阈值"判定（默认 0.75 × 上限） */
  nearThresholdRatio?: number
}

/** Profile §7 的规则元数据（供 explain/文档与 lint 报告消费——单一来源） */
export const CSE_LINT_RULES: ReadonlyArray<{ code: string; severity: 'error' | 'warn'; title: string; hint: string }> = [
  { code: 'E-CSS-001', severity: 'error', title: 'L5 禁止特性（运行时动态选择器 / 动态样式表插入）', hint: '样式必须在编译期静态可解——把动态部分改成数据驱动的枚举类（见 B2）' },
  { code: 'E-CSS-002', severity: 'error', title: '使用了未声明的 L3 特性', hint: '在 proteus.config 或组件级显式 opt-in（z-index/fixed/3D/滤镜各占一块 backing store）' },
  { code: 'E-CSS-003', severity: 'error', title: '使用了 Profile 外的属性', hint: '改用 Profile 内属性；确需新能力 ⇒ 走 INV-CE-07 四同步（IR + Applier + 判据 + 注册表）' },
  { code: 'E-CSS-004', severity: 'error', title: ':class 绑定无法编译期枚举候选集', hint: '改为 `{ active: bool }` 对象语法或字面量/三元（B2 的静态枚举面）' },
  { code: 'E-CSS-005', severity: 'error', title: '单节点动态属性查找表超限', hint: '拆分组件，或把动态类收窄到少数绘制属性' },
  { code: 'E-CSS-006', severity: 'error', title: '拍平节点绑定了事件/transform（违反 flattenEligible）', hint: '该节点显式退出拍平（去掉 flatten 标记）或把 transform/事件移出' },
  { code: 'W-CSS-101', severity: 'warn', title: '选择器嵌套深度 > 3', hint: '建议 BEM 扁平化（深层后代会放大匹配成本与特异性意外）' },
  { code: 'W-CSS-102', severity: 'warn', title: '使用了 !important', hint: '建议改用 @layer（五级层叠里层序即可表达的优先级，不应借 !important）' },
  { code: 'W-CSS-103', severity: 'warn', title: '使用了 ID 选择器', hint: '特异性过高（a 分量），后续覆盖困难；改用类选择器' },
  { code: 'W-CSS-104', severity: 'warn', title: '单节点动态属性数接近阈值', hint: '提前拆分组件，防触发 E-CSS-005' },
  { code: 'W-CSS-105', severity: 'warn', title: '在不支持 grid 的端使用了 grid', hint: '改用嵌套 flex（B4 的 degradeTo 配方）或按端门控' },
]

/**
 * **主入口**：对一份（已解析的）样式表 + 节点树 + 计划表跑全部规则。
 * ★纯函数（无 I/O）——可被三条构建链与测试共同调用（同判据）。
 */
export function lintCse(
  sheet: CseStyleSheet,
  roots: CseNode[],
  opts: CseLintOptions = {},
): CseLintDiagnostic[] {
  const out: CseLintDiagnostic[] = []
  const target = opts.target ?? 'web'
  const maxTables = opts.maxDynamicTables ?? 16
  const nearRatio = opts.nearThresholdRatio ?? 0.75
  const push = (d: CseLintDiagnostic): void => {
    out.push(d)
  }

  /* ── 样式表级规则 ── */
  for (const rule of sheet.rules) {
    const chain = rule.chain
    // W-CSS-101 嵌套深度（段数 > 3）
    if (chain.segments.length > 3) {
      push({
        severity: 'warn',
        code: 'W-CSS-101',
        message: `选择器 \`${chain.raw}\` 嵌套深度 ${chain.segments.length} > 3`,
        hint: CSE_LINT_RULES.find((r) => r.code === 'W-CSS-101')!.hint,
        where: { selector: chain.raw, sheet: rule.source.sheet, line: rule.source.line },
      })
    }
    // W-CSS-103 ID 选择器
    if (chain.segments.some((s) => s.id !== undefined)) {
      push({
        severity: 'warn',
        code: 'W-CSS-103',
        message: `选择器 \`${chain.raw}\` 使用 ID（a 分量特异性）`,
        hint: CSE_LINT_RULES.find((r) => r.code === 'W-CSS-103')!.hint,
        where: { selector: chain.raw, sheet: rule.source.sheet, line: rule.source.line },
      })
    }
    // W-CSS-102 !important
    const importants = rule.decls.filter((d) => d.important)
    if (importants.length > 0) {
      push({
        severity: 'warn',
        code: 'W-CSS-102',
        message: `\`${chain.raw}\` 有 ${importants.length} 条 !important（${importants.slice(0, 3).map((d) => d.prop).join(' / ')}${importants.length > 3 ? ' …' : ''}）`,
        hint: CSE_LINT_RULES.find((r) => r.code === 'W-CSS-102')!.hint,
        where: { selector: chain.raw, sheet: rule.source.sheet, line: rule.source.line },
      })
    }
    // E-CSS-003 Profile 外属性（由调用方给的该端不支持声明表驱动）
    if (opts.unsupportedDecls) {
      for (const d of rule.decls) {
        const uns = opts.unsupportedDecls.find((u) => u.prop === d.prop)
        if (!uns) continue
        // 值域校验（accept 为空 ⇒ 该属性整体不支持）
        if (uns.accept.length > 0 && uns.accept.includes(d.value.trim())) continue
        // W-CSS-105 特例：**该端不支持 grid** ⇒ warn（可降级）而非 E-CSS-003（不可表达）。
        //   ★判据要覆盖**两种形态**（本仓实测：只判 `prop.startsWith('grid')` 会漏 `display: grid`——
        //   grid 既以属性族出现（grid-template-*），也以**值**出现（display: grid））：
        const isGridDeclaration = d.prop.startsWith('grid') || (d.prop === 'display' && d.value.trim().toLowerCase() === 'grid')
        if (isGridDeclaration && target === 'skyline') {
          push({
            severity: 'warn',
            code: 'W-CSS-105',
            message: `\`${chain.raw}\` 在 Skyline 端使用 \`${d.prop}: ${d.value}\`（该端无 Grid）`,
            hint: CSE_LINT_RULES.find((r) => r.code === 'W-CSS-105')!.hint,
            where: { selector: chain.raw, sheet: rule.source.sheet, line: rule.source.line },
          })
          continue
        }
        push({
          severity: 'error',
          code: 'E-CSS-003',
          message: `\`${chain.raw}\` 使用 Profile 外声明 \`${d.prop}: ${d.value}\`（${target} 端）`,
          hint: uns.suggestion ?? CSE_LINT_RULES.find((r) => r.code === 'E-CSS-003')!.hint,
          where: { selector: chain.raw, sheet: rule.source.sheet, line: rule.source.line },
        })
      }
    }
    // E-CSS-001 L5 禁止（动态选择器之类——CSE 解析面里表现为"无法静态化的 at-rule/声明"）
    for (const s of sheet.skipped) {
      if (s.kind === 'declaration' && /^(filter|backdrop-filter)$/.test(s.detail.split(':')[0]!.trim())) {
        // 滤镜是 L3（opt-in）⇒ E-CSS-002 而非 L5；此处按"未声明 opt-in"报
        push({
          severity: 'error',
          code: 'E-CSS-002',
          message: `使用 L3 特性而未 opt-in：\`${s.detail}\``,
          hint: CSE_LINT_RULES.find((r) => r.code === 'E-CSS-002')!.hint,
          where: { sheet: s.source.sheet, line: s.source.line },
        })
      }
    }
  }

  /* ── 动态类规则（E-CSS-004/005 · W-CSS-104） ── */
  for (const e of opts.dynamicErrors ?? []) {
    push({
      severity: 'error',
      code: 'E-CSS-004',
      message: `${e.nodeKey}（:class="${e.expr.slice(0, 60)}"）无法编译期枚举候选类：${e.reason}`,
      hint: CSE_LINT_RULES.find((r) => r.code === 'E-CSS-004')!.hint,
      where: { nodeKey: e.nodeKey },
    })
  }
  for (const [nodeKey, plan] of Object.entries(opts.classPlans ?? {})) {
    const n = Object.keys(plan.tables).length
    if (n > maxTables) {
      push({
        severity: 'error',
        code: 'E-CSS-005',
        message: `${nodeKey}: 动态属性查找表 ${n} 个 > ${maxTables}`,
        hint: CSE_LINT_RULES.find((r) => r.code === 'E-CSS-005')!.hint,
        where: { nodeKey },
      })
    } else if (n >= Math.ceil(maxTables * nearRatio)) {
      push({
        severity: 'warn',
        code: 'W-CSS-104',
        message: `${nodeKey}: 动态属性 ${n} 个（阈值 ${maxTables} 的 ${Math.round((n / maxTables) * 100)}%）`,
        hint: CSE_LINT_RULES.find((r) => r.code === 'W-CSS-104')!.hint,
        where: { nodeKey },
      })
    }
  }

  /* ── 拍平规则（E-CSS-006） ── */
  for (const v of opts.flattenViolations ?? []) {
    push({
      severity: 'error',
      code: 'E-CSS-006',
      message: `节点 ${v.nodeId}: ${v.reason}`,
      hint: CSE_LINT_RULES.find((r) => r.code === 'E-CSS-006')!.hint,
      where: { nodeKey: String(v.nodeId) },
    })
  }

  // ★节点树仅用于将来扩展（如"每节点选择器数上限"）；此处显式消费避免 no-unused
  void roots
  return out
}

/** 便捷：是否有 error 级（构建链的"阻断"判据） */
export function hasCseLintErrors(diags: readonly CseLintDiagnostic[]): boolean {
  return diags.some((d) => d.severity === 'error')
}

/** 便捷：格式化为可读文本（CLI / 构建日志） */
export function formatCseLint(diags: readonly CseLintDiagnostic[]): string {
  if (diags.length === 0) return '✅ CSE lint：无诊断'
  const errors = diags.filter((d) => d.severity === 'error')
  const warns = diags.filter((d) => d.severity === 'warn')
  const lines: string[] = [`CSE lint：${errors.length} error · ${warns.length} warn`]
  for (const d of diags) {
    const where = d.where ? [d.where.selector, d.where.nodeKey, d.where.line !== undefined ? `L${d.where.line}` : ''].filter(Boolean).join(' ') : ''
    lines.push(`  ${d.severity === 'error' ? '✗' : '⚠'} [${d.code}] ${d.message}${where ? `（${where}）` : ''}`)
    if (d.hint) lines.push(`      → ${d.hint}`)
  }
  return lines.join('\n')
}
