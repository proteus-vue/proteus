// packages/cli/src/doctor/checks/util.ts —— 构造 finding 的小工具（统一字段，避免每处手拼）
import type { DoctorFinding, DoctorEvidence, DoctorLevel } from '../types'

export function ok(checkId: string, title: string, actual?: string, evidence: DoctorEvidence[] = []): DoctorFinding {
  return { checkId, level: 'ok', title, actual, evidence }
}

export function skip(checkId: string, title: string, reason: string): DoctorFinding {
  return { checkId, level: 'skip', title, actual: reason, evidence: [] }
}

export interface FailInput {
  checkId: string
  level: 'error' | 'warn'
  code: string
  title: string
  expected?: string
  actual?: string
  evidence?: DoctorEvidence[]
  fix?: { command?: string; description?: string }
  docs?: string
}

export function fail(i: FailInput): DoctorFinding {
  return {
    checkId: i.checkId,
    level: i.level,
    title: i.title,
    expected: i.expected,
    actual: i.actual,
    diagCode: i.code,
    evidence: i.evidence ?? [],
    fix: i.fix,
    docs: i.docs,
  }
}

/** 从 evidence 里的第一条命令取证，判断"命令不存在"（ENOENT / spawn error） */
export function cmdMissing(ev: DoctorEvidence): boolean {
  return /spawn error|ENOENT|not found/i.test(ev.note ?? '') || (ev.exitCode === 127)
}

/**
 * `.tools/<rel>` 是否存在——★**上溯若干层**（与 host-package.findJdk() 同口径）：
 *   仓内工程（如 css-conformance）可用**框架仓**的 `.tools`（jdk17/ndk/quickjs），故不能只看工程根。
 */
export function hasToolsDir(ctx: { root: string; exists(p: string): boolean }, rel: string): boolean {
  let dir = ctx.root
  for (let i = 0; i < 7; i++) {
    if (ctx.exists(`${dir}/.tools/${rel}`)) return true
    const up = dir.replace(/\/[^/]+\/?$/, '') || '/'
    if (up === dir) break
    dir = up
  }
  return false
}

export type { DoctorFinding, DoctorLevel }
