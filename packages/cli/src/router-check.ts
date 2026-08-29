// packages/cli/src/router-check.ts
// proteus router:check —— 路由迁移检查器（docs/proteus-router-plan 08-migration Step 1）
// 扫描 pagesDir 的 <route> 块 → scanRoutes 严格校验（含 loc 报错）→ 迁移就绪报告
// ★透明化：报错精确到 文件:行号；通过后输出路由摘要 + 嵌套决策 trace（--trace-router 语义）
import path from 'node:path'
import { scanRoutes } from '@proteus/router/scan'
import { buildRouteTree } from '@proteus/router/tree'
import { listRouteRules } from '@proteus/router/rules'

export interface RouterCheckResult {
  ok: boolean
  pageCount: number
  routeCount: number
  errors: string[]
  summary: string[]
}

/**
 * 路由迁移检查（纯函数，可单测）：
 * 1. 扫描 <route> 块（严格 schema 校验，错误带 文件:行号）
 * 2. 构建嵌套树（显式 parent / path 推导 trace）
 * 3. 输出迁移就绪摘要
 */
export function checkRoutes(pagesDir: string): RouterCheckResult {
  const errors: string[] = []
  const summary: string[] = []
  const trace = (msg: string): void => void summary.push(msg)

  let routes: ReturnType<typeof scanRoutes>
  try {
    routes = scanRoutes(path.resolve(pagesDir), true) // verbose：来源登记 trace
  } catch (err) {
    return { ok: false, pageCount: 0, routeCount: 0, errors: [(err as Error).message], summary }
  }

  const tree = buildRouteTree(routes, {}, trace)
  summary.push(`[route] 共 ${routes.length} 条路由，${tree.length} 个根路由（嵌套树构建完成）`)

  // 迁移检查（08-migration §5）：name 建议补充声明（path 推导运行时可用）
  const missingName = routes.filter((r) => !r.name)
  if (missingName.length) {
    summary.push(`[check] ⚠ ${missingName.length} 条路由未声明 name（运行时可用 path 推导，建议补充声明）`)
  }

  return { ok: true, pageCount: routes.length, routeCount: routes.length, errors, summary }
}

/** 渲染 router:check 报告（人可读） */
export function formatRouterCheck(result: RouterCheckResult): string {
  if (!result.ok) {
    return [
      '[proteus] router:check ✗ 校验失败：',
      ...result.errors.map((e) => `  - ${e}`),
      '',
      '（按 文件:行号 修正 <route> 块后重跑；页面 .vue 本体无需改动，见 docs/proteus-router-plan 08）',
    ].join('\n')
  }
  return [
    `[proteus] router:check ✓ ${result.pageCount} 个页面 / ${result.routeCount} 条路由，<route> 块全部合规（迁移就绪）`,
    ...result.summary,
    `[proteus] 路由生成规则 ${listRouteRules().length} 条 AI 说明书（--trace-router 决策链见 summary）`,
  ].join('\n')
}
