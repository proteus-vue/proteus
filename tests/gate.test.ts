// tests/gate.test.ts
// ★#453：统一门禁系统 v1——Gate 注册表单一来源（ls 目录 / run 统一执行：presets check·audit + 已接线 d2/devtools-budget/coverage）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GATES, findGate, formatGateList, runGate, gateUsages, GATE_COMMAND_HELP } from '../packages/cli/src/gate'
import { HELP_GROUPS } from '../packages/cli/src/args'

describe('Gate 注册表（★#453 单一来源）', () => {
  it('全量登记：两 preset + 专项/框架族齐全（散落命令收敛目录）', () => {
    const ids = GATES.map((g) => g.id)
    for (const must of ['check', 'audit', 'd2', 'fluid', 'api-check', 'capabilities', 'i18n', 'router', 'module', 'css', 'style', 'config', 'health', 'coverage', 'devtools-budget', 'components', 'conformance']) {
      expect(ids).toContain(must)
    }
    // 每条都有族/scope/usage/desc（目录可读）
    for (const g of GATES) {
      expect(g.group).toBeTruthy()
      expect(['project', 'framework', 'self']).toContain(g.scope)
      expect(g.usage.startsWith('proteus ')).toBe(true)
      expect(g.desc.length).toBeGreaterThan(5)
    }
  })

  it('formatGateList：按族分组 + ●/○ 接线标注 + 汇总行', () => {
    const text = formatGateList()
    expect(text).toContain('── 快速聚合')
    expect(text).toContain('── 深度聚合')
    expect(text).toContain('── 专项检查')
    expect(text).toContain('── 框架自检')
    expect(text).toContain('● audit') // preset 已接线
    expect(text).toContain('● fluid') // #454 专项已接线
    expect(text).toContain('○ conformance') // 未接线（多旗标参考实现门禁）
    expect(text).toMatch(/gate 注册表：\d+ 个门禁/)
    const filtered = formatGateList('深度聚合')
    expect(filtered).toContain('audit')
    expect(filtered).not.toContain('── 专项检查')
  })

  it('#454 专项全部接线（○ 仅剩写型/诊断/多旗标工具）', () => {
    const notWired = GATES.filter((g) => !g.run).map((g) => g.id)
    // 写型（manifest/module-duplicates 产物）/ 诊断（health）/ 多旗标（conformance/audit-module/host-push）保持独立命令形态
    expect(notWired.sort()).toEqual(['audit-module', 'capabilities-manifest', 'conformance', 'health', 'host-push', 'module-duplicates'])
  })

  it('B4-lite：HELP「检查与门禁」组与 GATES 目录 usage 集一致（双目录防漂移守卫）', () => {
    const group = HELP_GROUPS.find((g) => g.title === '检查与门禁')
    expect(group).toBeTruthy()
    const helpUsages = group!.entries.map((e) => e.usage)
    const gateMeta = GATE_COMMAND_HELP.usage // gate 命令本身非门禁——守卫排除
    const registry = new Set(gateUsages())
    for (const u of helpUsages) {
      if (u !== gateMeta) expect(registry.has(u), `HELP 独有（注册表漏录）：${u}`).toBe(true)
    }
    for (const u of registry) expect(helpUsages.includes(u), `注册表独有（HELP 漏录）：${u}`).toBe(true)
  })
})

describe('proteus gate run（统一执行）', () => {
  it('preset audit：空目录聚合通过（缺配置域跳过语义）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-gate-'))
    try {
      const r = await runGate('audit', dir)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('8 域')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('preset check：最小页面工程四/五域通过', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-gate-'))
    try {
      const page = path.join(dir, 'src', 'pages', 'index.vue')
      fs.mkdirSync(path.dirname(page), { recursive: true })
      fs.writeFileSync(page, `<template><p-view class="x">hi</p-view></template>\n<style>\n.x { color: #333; }\n</style>`)
      const r = await runGate('check', dir)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('check 汇总')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('d2：统一执行与 audit d2 同一引擎（空目录默认全 error 零违规 PASS）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-gate-'))
    try {
      const r = await runGate('d2', dir)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('✅ PASS')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('未知 id → 明确报错；未接线门禁 → 提示走独立命令', async () => {
    await expect(runGate('nope', '.')).rejects.toThrow(/未知门禁/)
    await expect(runGate('health', '.')).rejects.toThrow(/尚未接线统一执行器/)
  })

  it('#454：全部已接线门禁在空目录可统一执行（返回结果不抛——skip/fail 语义各归各适配器）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-gate-'))
    try {
      for (const g of GATES.filter((x) => x.run)) {
        if (g.id === 'coverage') continue // coverage 需框架仓语义（vitest cwd=仓根 亦可跑——另测）
        const r = await runGate(g.id, dir)
        expect(typeof r.ok, `${g.id} ok`).toBe('boolean')
        expect(typeof r.text, `${g.id} text`).toBe('string')
        expect(r.text.length).toBeGreaterThan(0)
      }
      // coverage 在仓根 cwd（vitest cwd）可跑且为结果对象
      const cov = await runGate('coverage', process.cwd())
      expect(typeof cov.ok).toBe('boolean')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('findGate 覆盖 preset 与已接线专项（后续接线以注册表 run 为准）', () => {
    expect(findGate('check')?.group).toBe('快速聚合')
    expect(findGate('audit')?.group).toBe('深度聚合')
    for (const id of ['d2', 'fluid', 'css', 'style', 'router', 'module', 'config', 'components', 'i18n', 'api-check', 'capabilities']) {
      expect(typeof findGate(id)?.run, id).toBe('function')
    }
  })
})

describe('proteus gate run：gates.disabled 跳过（★#456）', () => {
  function writeDisabledConfig(dir: string, disabled: string[]): void {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'gate-fixture', private: true }))
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
  gates: { disabled: ${JSON.stringify(disabled)} },
}
`,
    )
  }

  it('禁用单门禁 → 跳过不阻断（exit 0 语义）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-gate-dis-'))
    try {
      writeDisabledConfig(dir, ['d2'])
      const r = await runGate('d2', dir)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('gates.disabled 禁用')
      expect(r.text).toContain('exit 0')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('禁用 preset（audit/check）→ 同样跳过', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-gate-dis-'))
    try {
      writeDisabledConfig(dir, ['audit'])
      const r = await runGate('audit', dir)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('audit 已在 proteus.config gates.disabled 禁用')
      writeDisabledConfig(dir, ['check'])
      const r2 = await runGate('check', dir)
      expect(r2.ok).toBe(true)
      expect(r2.text).toContain('check 已在 proteus.config gates.disabled 禁用')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
