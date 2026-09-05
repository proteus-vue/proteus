// tests/audit-all.test.ts
// ★test-framework B6 + M10 + #450：proteus audit all —— 全量审计门禁（10-blueprint-integration.md「proteus audit all」）
// 八域聚合（route/module/config/i18n/capabilities/components/d2/devtools-budget）+ CI 耗时预算 <12s
// ★route 域扫 pagesDir（resolvePagesDir 对齐 gen-routes）；components 无 src/components 跳过；capabilities 保持 B5 真实门禁；
//   d2 为 opt-in（proteus.config 声明 audit 才跑，未声明跳过）；devtools-budget 性能烟测
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runAuditAll, formatAuditAll, AUDIT_ALL_BUDGET_MS } from '../packages/cli/src/audit-all'

/** 合法工程骨架（config 域校验通过）+ 可选 audit 声明与页面文件 */
function writeProject(dir: string, auditTs: string | null, pages: Record<string, string>): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'audit-all-fixture', private: true }))
  fs.writeFileSync(
    path.join(dir, 'proteus.config.ts'),
    `export default {
  platform: 'web',
  skyline: false,
  appid: '',
  pagesDir: 'src/pages',
  routesOutput: 'src/router/auto-routes.ts',
  customRoute: { registerPresets: false, builders: {} },
  setDataBridge: { batchWindow: 16, perComponent: false },
  style: { px2rpx: false, rpxRatio: 2 },
  ${auditTs ?? ''}
}
`,
  )
  for (const [rel, content] of Object.entries(pages)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
}

describe('proteus audit all（test-framework B6 全量门禁）', () => {
  it('examples：八域齐全 + 预算内 + 核心域绿（capabilities 如实报 demo 页 B5 违规；d2 未声明 audit 跳过）', async () => {
    const result = await runAuditAll('examples')
    expect(result.domains.map((d) => d.name).sort()).toEqual(['capabilities', 'components', 'config', 'd2', 'devtools-budget', 'i18n', 'module', 'route'])
    expect(result.totalMs).toBeLessThan(AUDIT_ALL_BUDGET_MS)
    expect(result.overBudget).toBe(false)
    // 核心域全绿
    for (const name of ['route', 'module', 'config', 'i18n', 'devtools-budget']) {
      expect(result.domains.find((d) => d.name === name)?.ok, name).toBe(true)
    }
    // components 无 src/components → 跳过（非阻断）
    const components = result.domains.find((d) => d.name === 'components')
    expect(components?.skipped).toBe(true)
    // d2：examples 未声明 audit → opt-in 跳过（非阻断）
    const d2 = result.domains.find((d) => d.name === 'd2')
    expect(d2?.skipped).toBe(true)
    expect(d2?.detail).toContain('未声明 audit')
    // capabilities 如实报违规（mp-semantics-demo 演示页直写 wx.*，B5 §6 禁止清单——audit all 比 check 更严的门禁）
    expect(result.domains.find((d) => d.name === 'capabilities')?.ok).toBe(false)
  })

  it('空项目：各域跳过/零违规 → ok（独立编译模式语义）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-audit-'))
    try {
      const result = await runAuditAll(dir)
      expect(result.ok).toBe(true)
      expect(result.overBudget).toBe(false)
      // config/module 缺文件 → 跳过；route 空目录 → 零违规；components 无目录 → 跳过；d2 无配置 → 跳过
      const config = result.domains.find((d) => d.name === 'config')
      expect(config?.ok).toBe(true)
      expect(config?.detail).toContain('跳过')
      expect(result.domains.find((d) => d.name === 'd2')?.detail).toContain('跳过')
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

describe('proteus audit all：D-2 域 opt-in 语义（★#450）', () => {
  it('声明 audit + 违规页面（手写 @media）→ d2 域失败 → audit all 失败', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-audit-d2-'))
    try {
      writeProject(
        dir,
        `audit: { rules: { 'no-media-query': 'error' } },`,
        { 'src/pages/media-demo.vue': `<template><div>x</div></template>\n<style>\n@media (max-width: 820px) { .x { color: red; } }\n</style>` },
      )
      const result = await runAuditAll(dir)
      const d2 = result.domains.find((d) => d.name === 'd2')
      expect(d2?.skipped).toBeFalsy()
      expect(d2?.ok).toBe(false)
      expect(d2?.detail).toContain('[W-6/C8]')
      expect(result.ok).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('声明 audit 且规则 warn → d2 域通过（不阻断 audit all）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-audit-d2-'))
    try {
      writeProject(
        dir,
        `audit: { rules: { 'no-media-query': 'warn' } },`,
        { 'src/pages/media-demo.vue': `<template><div>x</div></template>\n<style>\n@media (max-width: 820px) { .x { color: red; } }\n</style>` },
      )
      const result = await runAuditAll(dir)
      const d2 = result.domains.find((d) => d.name === 'd2')
      expect(d2?.ok).toBe(true)
      expect(d2?.detail).toContain('warn 1')
      expect(result.ok).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
