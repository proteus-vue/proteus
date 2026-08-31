// tests/audit-all.test.ts
// ★test-framework B6：proteus audit all —— 全量审计门禁（10-blueprint-integration.md「proteus audit all」）
// 六域聚合（route/module/config/i18n/capabilities/components）+ CI 耗时预算 <12s
// ★route 域扫 pagesDir（resolvePagesDir 对齐 gen-routes）；components 无 src/components 跳过；capabilities 保持 B5 真实门禁
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runAuditAll, formatAuditAll, AUDIT_ALL_BUDGET_MS } from '../packages/cli/src/audit-all'

describe('proteus audit all（test-framework B6 全量门禁）', () => {
  it('examples：六域齐全 + 预算内 + 核心域绿（capabilities 如实报 demo 页 B5 违规）', async () => {
    const result = await runAuditAll('examples')
    expect(result.domains.map((d) => d.name).sort()).toEqual(['capabilities', 'components', 'config', 'i18n', 'module', 'route'])
    expect(result.totalMs).toBeLessThan(AUDIT_ALL_BUDGET_MS)
    expect(result.overBudget).toBe(false)
    // 核心域全绿
    for (const name of ['route', 'module', 'config', 'i18n']) {
      expect(result.domains.find((d) => d.name === name)?.ok, name).toBe(true)
    }
    // components 无 src/components → 跳过（非阻断）
    const components = result.domains.find((d) => d.name === 'components')
    expect(components?.skipped).toBe(true)
    // capabilities 如实报违规（mp-semantics-demo 演示页直写 wx.*，B5 §6 禁止清单——audit all 比 check 更严的门禁）
    expect(result.domains.find((d) => d.name === 'capabilities')?.ok).toBe(false)
  })

  it('空项目：各域跳过/零违规 → ok（独立编译模式语义）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-audit-'))
    try {
      const result = await runAuditAll(dir)
      expect(result.ok).toBe(true)
      expect(result.overBudget).toBe(false)
      // config/module 缺文件 → 跳过；route 空目录 → 零违规；components 无目录 → 跳过
      const config = result.domains.find((d) => d.name === 'config')
      expect(config?.ok).toBe(true)
      expect(config?.detail).toContain('跳过')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('formatAuditAll：汇总行含域数/失败数/耗时/预算', () => {
    const text = formatAuditAll({
      domains: [
        { name: 'route', ok: true, ms: 1, detail: '[route] ok' },
        { name: 'config', ok: false, ms: 2, detail: '[config] 失败' },
      ],
      ok: false,
      totalMs: 3,
      budgetMs: AUDIT_ALL_BUDGET_MS,
      overBudget: false,
    })
    expect(text).toContain('2 域')
    expect(text).toContain('1 失败')
    expect(text).toContain('3ms')
    expect(text).toContain('预算 12000ms')
    expect(text).toContain('exit 1')
  })
})
