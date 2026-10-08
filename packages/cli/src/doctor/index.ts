// packages/cli/src/doctor/index.ts —— ★★`proteus doctor` 编排（2026-10-09 · 决策 #686）
//
// 【做什么】《10-m5-doctor.md》：跨端工程"能不能跑起来"体检器。分组并行 → 收集 → 投影聚合（hosts）
//   → 归一报告（human/json）→ 退出码。**不新写探测逻辑**（零逻辑复制，对齐 gate.ts）。
// 【四条硬约束（Apollo）】码自建 / 禁猜因（未知→PT-EX-000 且无 cause）/ 保留原文（evidence）/ 不自动修复。
// 【超时】每项经 ctx.runCmd 的硬超时；编排层再加一道 `withTimeout` 兜底（承诺挂死也不 hang 整个 doctor）。
import { buildDoctorContext, DEFAULT_TIMEOUT_MS } from './context'
import { CHECKS, GROUP_ORDER } from './registry'
import { projectHosts } from './checks/hosts'
import { makeDiag } from '../diag'
import type { DoctorContext, DoctorFinding, DoctorGroupResult, DoctorReport, DoctorGroup, DoctorCheck } from './types'
import { GROUP_TITLES } from './types'

export interface DoctorOptions {
  root: string
  targets: string[]
  cliVersion: string
  /** 只跑这些组 */
  only?: DoctorGroup[]
  /** 跳过这些组 */
  skip?: DoctorGroup[]
  /** 只查指定端（覆盖 targets——hosts 投影用） */
  target?: string
  /** 启用慢检查（devices）；否则 devices 组默认跳过 */
  deep?: boolean
  /** 串行（调试） */
  noParallel?: boolean
  /** 单检查超时 */
  timeoutMs?: number
  /** 注入（测试） */
  contextOverrides?: Partial<DoctorContext>
}

/** 给单检查套一层超时兜底：超时 ⇒ warn + evidence 记 timeout（绝不 hang——方案 §9⑥） */
async function withTimeout(check: DoctorCheck, ctx: DoctorContext, timeoutMs: number): Promise<DoctorFinding> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<DoctorFinding>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        checkId: check.id,
        level: 'warn',
        title: '检查超时',
        diagCode: 'PT-EE-023',
        actual: `> ${timeoutMs}ms`,
        evidence: [{ note: `检查 '${check.id}' 超过 ${timeoutMs}ms 未返回` }],
      })
    }, timeoutMs)
  })
  try {
    return await Promise.race([Promise.resolve(check.run(ctx)), timeout])
  } catch (e) {
    // 探测异常 ⇒ 未知类（只定位不猜因——Apollo §3.3；不编造 cause）
    return {
      checkId: check.id,
      level: 'warn',
      title: '检查异常',
      diagCode: 'PT-EX-000',
      actual: e instanceof Error ? e.message : String(e),
      evidence: [{ note: `检查 '${check.id}' 抛错：${e instanceof Error ? e.message : String(e)}` }],
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 该检查是否启用（组过滤 + 慢检查 + 条件启用） */
function enabled(check: DoctorCheck, ctx: DoctorContext, opts: DoctorOptions): boolean {
  const only = opts.only
  if (only && only.length && !only.includes(check.group)) return false
  if (opts.skip && opts.skip.includes(check.group)) return false
  // 慢检查默认跳过——除非 --deep 或显式 --only 该组
  if (check.slow && !opts.deep && !(only && only.includes(check.group))) return false
  if (check.appliesTo && !check.appliesTo(ctx)) return false
  return true
}

/** 跑体检，返回报告 */
export async function runDoctor(opts: DoctorOptions): Promise<DoctorReport> {
  const startedAt = new Date()
  const t0 = Date.now()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const targets = opts.target ? [opts.target] : opts.targets
  const ctx = buildDoctorContext({ root: opts.root, targets, cliVersion: opts.cliVersion, overrides: opts.contextOverrides })

  // 分组执行（默认并行——方案 §3.6；`--no-parallel` 串行）
  const active = CHECKS.filter((c) => enabled(c, ctx, opts))
  const findings: DoctorFinding[] = []
  if (opts.noParallel) {
    for (const c of active) findings.push(await withTimeout(c, ctx, timeoutMs))
  } else {
    const results = await Promise.all(active.map((c) => withTimeout(c, ctx, timeoutMs)))
    findings.push(...results)
  }

  // hosts 组：投影聚合（决策 §4.5——不新增探测）
  const byId = new Map(findings.map((f) => [f.checkId, f]))
  const hostFindings = projectHosts(targets, byId)
  const allFindings = [...findings, ...hostFindings]

  // 分组（跨 skip 的组仍展示；组顺序见 GROUP_ORDER）
  const groups: DoctorGroupResult[] = []
  for (const g of GROUP_ORDER) {
    const fs = allFindings.filter((f) => groupOf(f) === g)
    if (!fs.length) continue
    groups.push({ id: g, title: GROUP_TITLES[g], findings: orderFindings(fs) })
  }

  // 汇总（skip 不计分母——方案附录 A）
  const counted = allFindings.filter((f) => f.level !== 'skip')
  const summary = {
    total: counted.length,
    ok: counted.filter((f) => f.level === 'ok').length,
    warn: counted.filter((f) => f.level === 'warn').length,
    error: counted.filter((f) => f.level === 'error').length,
    skip: allFindings.filter((f) => f.level === 'skip').length,
    blocked: counted.some((f) => f.level === 'error'),
  }

  // diagnostics（与 diag.ts ProteusDiagnostic 同构——喂 Apollo 消费方）
  const diagnostics = counted
    .filter((f) => f.diagCode)
    .map((f) => makeDiag(f.diagCode as string, {
      context: f.checkId,
      // ★禁猜因：只在有确定 cause 语义时给（doctor 的 finding 无 cause 字段 ⇒ 不生成"根因"行）
      suggestions: undefined,
      raw: f.evidence.map((e) => e.command ?? e.note ?? '').filter(Boolean).join('\n') || (f.actual ?? ''),
      severity: f.level === 'error' ? 'error' : 'warn',
    }))

  const durationMs = Date.now() - t0
  return {
    schemaVersion: 1,
    tool: { name: 'proteus', version: opts.cliVersion },
    root: ctx.root,
    platform: { os: ctx.tool.platform, arch: ctx.tool.arch, node: ctx.tool.nodeVersion },
    targets,
    startedAt: startedAt.toISOString(),
    durationMs,
    summary,
    groups,
    diagnostics,
    ok: summary.error === 0,
  }
}

/** finding → 组（由 checkId 前缀推；hosts 是投影组） */
function groupOf(f: DoctorFinding): DoctorGroup {
  const g = f.checkId.split('/')[0] as DoctorGroup
  return g
}

/** 组内排序：error → warn → skip → ok（异常优先） */
function orderFindings(fs: DoctorFinding[]): DoctorFinding[] {
  const rank = { error: 0, warn: 1, skip: 2, ok: 3 } as const
  return [...fs].sort((a, b) => rank[a.level] - rank[b.level])
}

/** `--list`：只列检查项目录（不执行） */
export function listChecks(group?: DoctorGroup): string {
  const rows = CHECKS.filter((c) => !group || c.group === group)
  const lines = ['[proteus-doctor] 检查项目录（--list）：']
  let cur: DoctorGroup | null = null
  for (const c of rows) {
    if (c.group !== cur) {
      cur = c.group
      lines.push(`\n  ${GROUP_TITLES[cur]}（${cur}）`)
    }
    const slow = c.slow ? ' [慢]' : ''
    const cond = c.appliesTo ? ' [条件]' : ''
    lines.push(`    ${c.id.padEnd(30)} ${c.level === 'error' ? 'E' : 'W'}${slow}${cond}  ${c.title}`)
  }
  lines.push(`\n  共 ${rows.length} 项（另有 hosts 组为投影聚合，不在目录）`)
  return lines.join('\n')
}
