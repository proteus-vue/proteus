// packages/css-compat/src/budget.ts
// G-21 css-compat B3：样式预算与 CI 门禁（10-benchmark-budgets.md §一/§四）
// CSS_BUDGETS 预算表 + checkCssBudget 门禁校验（CLI css:check --report 与 check-css-report.mjs 共用）
export interface CssBudgetMetric {
  key: string
  label: string
  /** ★#485 英文指标名变体（必填；缺省回退中文） */
  labelEn?: string
  /** 上限（≤）；semanticRatio 为下限（≥） */
  limit: number
  direction: 'max' | 'min'
}

/** 预算指标表（10 §一） */
export const CSS_BUDGETS: CssBudgetMetric[] = [
  {
    key: 'bundleCssBytes',
    label: '全量样式字节数 (gzip)',
    labelEn: 'Total style bytes (gzip)',
    limit: 60_000,
    direction: 'max',
  },
  {
    key: 'criticalCssBytes',
    label: '首屏关键 CSS 字节数',
    labelEn: 'Above-the-fold critical CSS bytes',
    limit: 14_000,
    direction: 'max',
  },
  {
    key: 'styleIRObjects',
    label: 'Style IR 运行时对象数',
    labelEn: 'Style IR runtime objects',
    limit: 1500,
    direction: 'max',
  },
  {
    key: 'selectors',
    label: '选择器数量（编译前）',
    labelEn: 'Selector count (pre-compile)',
    limit: 800,
    direction: 'max',
  },
  {
    key: 'semanticRatio',
    label: '语义组件占比',
    labelEn: 'Semantic component ratio',
    limit: 0.7,
    direction: 'min',
  },
  {
    key: 'forbiddenCount',
    label: '--strict-css 违规（CSS001-007）',
    labelEn: '--strict-css violations (CSS001-007)',
    limit: 0,
    direction: 'max',
  },
]

/** 全局聚合报告（10 §四 check-css-report 输入；CLI 聚合多文件产出） */
export interface CssGlobalReport {
  bundleCssBytes: number
  criticalCssBytes: number
  styleIRObjects: number
  selectors: number
  /** 类选择器数（semanticRatio 分子） */
  classSelectors: number
  /** 类选择器占比（.class 范式 = 语义化；10 §一 ≥70% 目标） */
  semanticRatio: number
  forbiddenCount: number
  fileCount: number
}

export interface BudgetCheckResult {
  metric: CssBudgetMetric
  actual: number
  pass: boolean
}

/** 预算门禁校验：返回逐项结果（全 pass = 通过；10 §四 assert 语义） */
export function checkCssBudget(report: CssGlobalReport): BudgetCheckResult[] {
  return CSS_BUDGETS.map((metric) => {
    const actual = report[metric.key as keyof CssGlobalReport] ?? 0
    const pass = metric.direction === 'max' ? actual <= metric.limit : actual >= metric.limit
    return { metric, actual, pass }
  })
}

export function formatBudgetCheck(checks: BudgetCheckResult[]): string {
  const lines: string[] = []
  for (const c of checks) {
    const mark = c.pass ? '✅' : '✗'
    const arrow = c.metric.direction === 'max' ? '≤' : '≥'
    lines.push(`  ${mark} ${c.metric.label}：${c.actual} ${arrow} ${c.metric.limit}`)
  }
  return lines.join('\n')
}
