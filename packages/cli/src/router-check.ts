// packages/cli/src/router-check.ts
// proteus router:check —— 路由检查器（docs/proteus-router-plan 08-migration Step 1）
// 扫描 pagesDir 的 .vue → scanRoutes（★决策 #112/#113：derivePath + includeNoRoute——
//   <route> 块完全可选，path/name 从文件路径推导，meta 由 config 集中注入；块仅覆盖 path/meta/params/pageJson）
// ★透明化：报错精确到 文件:行号；通过后输出路由摘要 + 嵌套决策 trace（--trace-router 语义）
import path from 'node:path'
import { scanRoutes } from '@proteus-vue/router/scan'
import { buildRouteTree } from '@proteus-vue/router/tree'
import { listRouteRules } from '@proteus-vue/router/rules'

export interface RouterCheckResult {
  ok: boolean
  pageCount: number
  routeCount: number
  errors: string[]
  summary: string[]
}

/**
 * 路由检查（纯函数，可单测）：
 * 1. 扫描页面（derivePath + includeNoRoute：<route> 块可选，path/name 推导）
 * 2. 构建嵌套树（显式 parent / path 推导 trace）
 * 3. 输出摘要
 */
export function checkRoutes(pagesDir: string): RouterCheckResult {
  const errors: string[] = []
  const summary: string[] = []
  const trace = (msg: string): void => void summary.push(msg)

  let routes: ReturnType<typeof scanRoutes>
  try {
    // ★与 gen-routes 双管线统一（决策 #112）：页面零 <route> 声明也收录
    routes = scanRoutes(path.resolve(pagesDir), { verbose: true, derivePath: true, includeNoRoute: true })
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
    `[proteus] router:check ✓ ${result.pageCount} 个页面 / ${result.routeCount} 条路由，路由表全部合规（<route> 块可选，path/name 推导）`,
    ...result.summary,
    `[proteus] 路由生成规则 ${listRouteRules().length} 条 AI 说明书（--trace-router 决策链见 summary）`,
  ].join('\n')
}
