// packages/cli/src/audit-all.ts
// ★test-framework B6：proteus audit all —— 全量审计门禁（10-blueprint-integration.md「proteus audit all」）
// 聚合 route / module / config / i18n / capabilities / components / d2 / api-check / fluid / devtools-budget 十域 + CI 耗时预算（<12s，超预算阻断）
// 复用各检查函数（try/catch + 计时）；缺配置文件/未声明 audit 的域跳过（独立编译模式语义，对齐 check 聚合）
import path from 'node:path'
import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { checkRoutes, formatRouterCheck, resolvePagesDir } from './router-check'
import { runAuditModule } from './module-audit'
import { checkConfigFile } from './config-check'
import { checkI18nUsage, formatI18nCheck } from './i18n-check'
import { runCapabilityCheck } from './capability-manifest'
import { auditComponents, formatComponentAudit } from './component-audit'
import { runDevtoolsBudget, formatDevtoolsBudget } from './devtools-budget'
import { loadProjectConfig } from './config-loader'
import { runD2Audit, formatD2AuditDetail } from './d2-audit'
import { readDisabledGates } from './gate-config'
import { runApiHookCheck, formatApiHookCheck } from './api-hook-check'
import { runFluidCheck, formatFluidCheck } from './fluid-check'

/** 10 §CI 耗时预算：audit all < 12s */
export const AUDIT_ALL_BUDGET_MS = 12000

export interface AuditAllDomain {
  name: string
  ok: boolean
  ms: number
  detail: string
  /** 缺配置跳过（不算失败） */
  skipped?: boolean
}

export interface AuditAllResult {
  domains: AuditAllDomain[]
  ok: boolean
  totalMs: number
  budgetMs: number
  overBudget: boolean
}

async function timed<T>(fn: () => Promise<T> | T): Promise<{ value: T; ms: number }> {
  const start = performance.now()
  const value = await fn()
  return { value, ms: Math.round((performance.now() - start) * 10) / 10 }
}

/** 全量审计：八域聚合 + 计时预算门禁（★#456 gates.disabled 域级/preset 级过滤） */
export async function runAuditAll(root: string): Promise<AuditAllResult> {
  const domains: AuditAllDomain[] = []
  const disabled = await readDisabledGates(root)
  if (disabled.has('audit')) {
    const result: AuditAllResult = {
      domains: [{ name: 'gates', ok: true, ms: 0, detail: '[proteus-gate] preset audit 已在 proteus.config gates.disabled 禁用——跳过', skipped: true }],
      ok: true,
      totalMs: 0,
      budgetMs: AUDIT_ALL_BUDGET_MS,
      overBudget: false,
    }
    return result
  }

  // route：路由合规（ROUTE001-004；★扫 pages 目录对齐 gen-routes，避免把 App.vue/RouterView 当页面）
  if (!disabled.has('route')) {
    const { value, ms } = await timed(() => checkRoutes(resolvePagesDir(root)))
    domains.push({ name: 'route', ok: value.ok, ms, detail: formatRouterCheck(value) })
  }

  // module：模块契约 + 图谱 + 产物（缺模块契约 → 跳过）
  if (!disabled.has('module')) {
    const { value, ms } = await timed(async () => {
      try {
        const { text, audit } = await runAuditModule({ root, graphJson: false })
        return { ok: audit.ok, text }
      } catch {
        return { ok: true, text: '[proteus-module] 无 proteus-module.config.ts——跳过' }
      }
    })
    domains.push({ name: 'module', ok: value.ok, ms, detail: value.text })
  }

  // config：proteus.config.ts 校验（缺文件 → 跳过，独立编译模式）
  if (!disabled.has('config')) {
    const { value, ms } = await timed(async () => {
      const file = path.join(root, 'proteus.config.ts')
      try {
        const { result, text } = await checkConfigFile(file)
        return { ok: result.ok, text }
      } catch (e) {
        return { ok: true, text: `[proteus-config] ${file} 不存在——跳过（独立编译模式无配置文件）` }
      }
    })
    domains.push({ name: 'config', ok: value.ok, ms, detail: value.text })
  }

  // i18n：硬编码文案 + catalog 对照（缺目录 → 空结果不失败）
  if (!disabled.has('i18n')) {
    const { value, ms } = await timed(() => {
      try {
        const result = checkI18nUsage(root)
        return { ok: result.ok, text: formatI18nCheck(result) }
      } catch (e) {
        return { ok: true, text: `[proteus-i18n] 跳过：${(e as Error).message}` }
      }
    })
    domains.push({ name: 'i18n', ok: value.ok, ms, detail: value.text })
  }

  // capabilities：平台规范静态检查（B5 §6 禁止清单）
  if (!disabled.has('capabilities')) {
    const { value, ms } = await timed(() => {
      try {
        const { text, violations } = runCapabilityCheck(root)
        return { ok: violations.length === 0, text }
      } catch (e) {
        return { ok: true, text: `[proteus-capabilities] 跳过：${(e as Error).message}` }
      }
    })
    domains.push({ name: 'capabilities', ok: value.ok, ms, detail: value.text })
  }

  // components：p-* 组件注册表 vs 使用（无 src/components 目录 → 跳过，非阻断）
  if (!disabled.has('components')) {
    const componentsDir = path.join(root, 'src/components')
    if (!fs.existsSync(componentsDir)) {
      domains.push({ name: 'components', ok: true, ms: 0, detail: '[proteus-components] 无 src/components 目录——跳过', skipped: true })
    } else {
      const { value, ms } = await timed(() => {
        try {
          const result = auditComponents(componentsDir)
          return { ok: result.ok, text: formatComponentAudit(result) }
        } catch (e) {
          return { ok: true, text: `[proteus-components] 跳过：${(e as Error).message}` }
        }
      })
      domains.push({ name: 'components', ok: value.ok, ms, detail: value.text })
    }
  }

  // ★#450 d2：D-2 页面门禁（opt-in——proteus.config 声明 audit 才跑；未声明/无配置 → 跳过不阻断）
  if (!disabled.has('d2')) {
    const { value, ms } = await timed(async () => {
      const file = path.resolve(root, 'proteus.config.ts')
      if (!fs.existsSync(file)) return { ok: true, skipped: true, text: '[proteus-d2] 无 proteus.config.ts——跳过（D-2 门禁需 audit 声明）' }
      let audit: unknown
      try {
        const cfg = (await loadProjectConfig(file)) as { audit?: unknown } | undefined
        audit = cfg?.audit
      } catch (e) {
        return { ok: true, skipped: true, text: `[proteus-d2] 配置加载失败——跳过：${(e as Error).message}` }
      }
      if (audit === undefined) return { ok: true, skipped: true, text: '[proteus-d2] proteus.config 未声明 audit——跳过（D-2 opt-in：声明即启用，未声明规则默认 error）' }
      let dir = 'src'
      if (audit && typeof audit === 'object' && typeof (audit as { dir?: unknown }).dir === 'string') dir = (audit as { dir: string }).dir
      const scanDir = path.resolve(root, dir)
      if (!fs.existsSync(scanDir)) return { ok: true, skipped: true, text: `[proteus-d2] 审计目录不存在 ${scanDir}——跳过` }
      try {
        const report = await runD2Audit(scanDir, { configFile: file, withUsage: false })
        return { ok: report.ok, skipped: false, text: formatD2AuditDetail(report) }
      } catch (e) {
        return { ok: true, skipped: true, text: `[proteus-d2] 跳过：${(e as Error).message}` }
      }
    })
    domains.push({ name: 'd2', ok: value.ok, ms, detail: value.text, skipped: value.skipped })
  }

  // ★#458 api-check：CMP007 门禁（回调式平台 API / 同步存储 / 裸全局能力调用——开发者典型不规范，抓 useXxx 迁移）
  if (!disabled.has('api-check')) {
    const { value, ms } = await timed(() => {
      try {
        const result = runApiHookCheck(root)
        return { ok: result.ok, text: formatApiHookCheck(result) }
      } catch (e) {
        return { ok: true, text: `[proteus-api-check] 跳过：${(e as Error).message}` }
      }
    })
    domains.push({ name: 'api-check', ok: value.ok, ms, detail: value.text })
  }

  // ★#458 fluid：柔性布局严格规则（FLD001-013——手写 @media/硬编码断点/无障碍字号/死尺寸）
  if (!disabled.has('fluid')) {
    const { value, ms } = await timed(() => {
      try {
        const result = runFluidCheck(root)
        return { ok: result.ok, text: formatFluidCheck(result) }
      } catch (e) {
        return { ok: true, text: `[proteus-fluid] 跳过：${(e as Error).message}` }
      }
    })
    domains.push({ name: 'fluid', ok: value.ok, ms, detail: value.text })
  }

  // ★M10 devtools-budget：DevTools 性能预算烟测（bus.emit / 火焰图 / timeline ingest；10 倍余量上界抓病态回归）
  if (!disabled.has('devtools-budget')) {
    const { value, ms } = await timed(() => {
      try {
        const result = runDevtoolsBudget()
        return { ok: result.ok, text: formatDevtoolsBudget(result) }
      } catch (e) {
        return { ok: true, text: `[proteus-devtools-budget] 跳过：${(e as Error).message}` }
      }
    })
    domains.push({ name: 'devtools-budget', ok: value.ok, ms, detail: value.text })
  }

  const totalMs = Math.round(domains.reduce((acc, d) => acc + d.ms, 0) * 10) / 10
  const overBudget = totalMs > AUDIT_ALL_BUDGET_MS
  return { domains, ok: domains.every((d) => d.ok) && !overBudget, totalMs, budgetMs: AUDIT_ALL_BUDGET_MS, overBudget }
}

/** 聚合文本报告（10 §输出：路由矩阵 + 模块依赖图 + 状态注册表 + 能力覆盖矩阵 的 CLI 汇总形态） */
export function formatAuditAll(result: AuditAllResult): string {
  const lines: string[] = []
  lines.push('[proteus] audit all —— 全量审计门禁（test-framework B6 + M10 + #450 D-2）：')
  for (const d of result.domains) {
    lines.push(`\n── ${d.name}（${d.ok ? '✅' : '✗'}，${d.ms}ms）`)
    lines.push(d.detail)
  }
  const failed = result.domains.filter((d) => !d.ok)
  lines.push(`\n[proteus] audit all 汇总：${result.domains.length} 域 / ${failed.length} 失败 / ${result.totalMs}ms（预算 ${result.budgetMs}ms${result.overBudget ? '，⚠ 超预算' : ''}）`)
  lines.push(result.ok ? '[proteus] ✅ audit all 全部通过' : '[proteus] ✗ 请修复后重试（exit 1）')
  return lines.join('\n')
}
