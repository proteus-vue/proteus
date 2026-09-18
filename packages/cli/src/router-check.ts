// packages/cli/src/router-check.ts
// proteus router:check —— 路由检查器（docs/proteus-router-plan 08-migration Step 1 + router-plus G-32 strict-router）
// 扫描 pagesDir 的 .vue → scanRoutes（★决策 #112/#113：derivePath + includeNoRoute——
//   <route> 块完全可选，path/name 从文件路径推导，meta 由 config 集中注入；块仅覆盖 path/meta/params/pageJson）
// ★router-plus strict-router：ROUTE003（path kebab-case）/ ROUTE004（meta.stack 非法值）
// ★透明化：报错精确到 文件:行号；通过后输出路由摘要 + 嵌套决策 trace（--trace-router 语义）
import path from 'node:path'
import fs from 'node:fs'
import { scanRoutes } from '@proteus-vue/router/scan'
import { buildRouteTree } from '@proteus-vue/router/tree'
import { listRouteRules } from '@proteus-vue/router/rules'
import { validateStackSemantic } from '@proteus-vue/router/navigation'

export interface RouterCheckResult {
  ok: boolean
  pageCount: number
  routeCount: number
  errors: string[]
  summary: string[]
}

/**
 * 解析 pages 目录（★约定式路由回归修复）：优先读 proteus.config.ts 的 pagesDir（轻量正则，不加载 esbuild 链）
 * root/pagesDir 存在 → 用之（对齐 gen-routes 双管线）；否则 fallback root（独立编译模式/无 pages 目录）
 */
export function resolvePagesDir(root: string): string {
  const configFile = path.join(root, 'proteus.config.ts')
  let pagesDir = 'pages'
  if (fs.existsSync(configFile)) {
    try {
      const src = fs.readFileSync(configFile, 'utf-8')
      const m = src.match(/pagesDir\s*:\s*['"]([^'"]+)['"]/)
      if (m) pagesDir = m[1] as string
    } catch {
      /* 解析失败 fallback 默认 */
    }
  }
  const full = path.join(root, pagesDir)
  return fs.existsSync(full) ? full : root
}

/**
 * 路由检查（纯函数，可单测）：
 * 1. 扫描页面（derivePath + includeNoRoute：<route> 块可选，path/name 推导）
 * 2. ★strict-router：ROUTE003 path kebab-case / ROUTE004 meta.stack 非法值（router-plus G-32）
 * 3. 构建嵌套树（显式 parent / path 推导 trace）
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

  // ★strict-router（G-32）：ROUTE003 path kebab-case / ROUTE004 meta.stack 非法值
  // （兼容两种 path 格式：Vue Router '/home' 前导斜杠 + 小程序 'pages/home' 无前导斜杠）
  for (const r of routes) {
    const loc = `${path.relative(process.cwd(), r.loc.file)}:${r.loc.line}`
    if (!/^\/?[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(r.path)) {
      errors.push(`[ROUTE003] ${loc} path "${r.path}" 非 kebab-case（小写 + 连字符，参数用 :name）`)
    }
    const stackErr = validateStackSemantic(r.meta?.stack)
    if (stackErr) {
      errors.push(`[ROUTE004] ${loc} ${stackErr}`)
    }
  }

  const tree = buildRouteTree(routes, {}, trace)
  summary.push(`[route] 共 ${routes.length} 条路由，${tree.length} 个根路由（嵌套树构建完成）`)

  if (errors.length) return { ok: false, pageCount: routes.length, routeCount: routes.length, errors, summary }
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
