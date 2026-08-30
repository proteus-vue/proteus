// tests/module-audit.test.ts
// ★module-plan B8（M8.6 CI 审计门禁）：auditModule 综合审计（契约 + 图谱 + 产物体积/重复）+ module-graph.json
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { auditModule } from '../packages/module/src'
import { formatAuditReport, runAuditModule } from '../packages/cli/src/module-audit'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-audit-'))

function write(rel: string, content: string | Buffer): void {
  const full = path.join(TMP, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('auditModule（M8.6 综合审计）', () => {
  it('合规项目 → ok（契约 + 图谱 + 产物）', async () => {
    write('proteus-module.config.ts', `import { defineModule } from '@proteus-vue/module'\nexport default defineModule({ name: 'app', version: '1.0.0' })\n`)
    write('app.json', JSON.stringify({ pages: ['pages/index'], subPackages: [{ root: 'subpackages/order' }] }))
    write('subpackages/order/pages/list.js', 'const a = 1')
    const audit = await auditModule(TMP, TMP)
    expect(audit.ok).toBe(true)
    expect(audit.cycles).toEqual([])
    expect(audit.sizeIssues).toEqual([])
    expect(audit.duplicateFiles).toEqual([])
    expect(audit.graphManifest.modules.some((m) => m.name === 'app')).toBe(true)
  })

  it('违规项目（契约失败 + 环）→ ok false 且各违规项检出', async () => {
    write('proteus-module.config.ts', `import { defineModule } from '@proteus-vue/module'\nexport default defineModule({ name: 'app', version: '1.0.0', dependencies: { trade: '^1.0.0' } })\n`)
    write('modules/trade/proteus-module.config.ts', `import { defineModule } from '@proteus-vue/module'\nexport default defineModule({ name: 'trade', version: '1.0.0', dependencies: { app: '^1.0.0' } })\n`)
    write('modules/broken/proteus-module.config.ts', `import { defineModule } from '@proteus-vue/module'\nexport default defineModule({ version: '1.0.0' })\n`)
    const audit = await auditModule(TMP)
    expect(audit.ok).toBe(false)
    expect(audit.cycles.length).toBe(1)
    expect(audit.modules.some((m) => !m.ok)).toBe(true)
  })

  it('产物违规（分包超硬限 + 分包间重复）→ ok false', async () => {
    write('proteus-module.config.ts', `import { defineModule } from '@proteus-vue/module'\nexport default defineModule({ name: 'app', version: '1.0.0' })\n`)
    write('app.json', JSON.stringify({ pages: ['pages/index'], subPackages: [{ root: 'subpackages/a' }, { root: 'subpackages/b' }] }))
    write('subpackages/a/pages/x.js', Buffer.alloc(2048 * 1024 + 1, 1)) // 超 2MB 硬限
    write('subpackages/a/pages/y.js', 'dup')
    write('subpackages/b/pages/z.js', 'dup') // 与 a/y.js 重复
    const audit = await auditModule(TMP, TMP)
    expect(audit.ok).toBe(false)
    expect(audit.sizeIssues.length).toBeGreaterThan(0)
    expect(audit.duplicateFiles.length).toBe(1)
  })
})

describe('runAuditModule（module-graph.json 落盘 + 报告渲染）', () => {
  it('落盘 module-graph.json（默认 .proteus/ 下）', async () => {
    const sub = path.join(TMP, 'graph')
    fs.mkdirSync(sub, { recursive: true })
    write('graph/proteus-module.config.ts', `import { defineModule } from '@proteus-vue/module'\nexport default defineModule({ name: 'app', version: '1.0.0' })\n`)
    const { text, audit } = await runAuditModule({ root: sub })
    expect(audit.ok).toBe(true)
    const graphJson = JSON.parse(fs.readFileSync(path.join(sub, '.proteus/module-graph.json'), 'utf-8'))
    expect(graphJson.modules[0].name).toBe('app')
    expect(graphJson.initOrder).toEqual(['app'])
    expect(text).toContain('module-graph.json 已落盘')
  })

  it('报告渲染：通过 / 违规标注', async () => {
    const sub = path.join(TMP, 'report')
    fs.mkdirSync(sub, { recursive: true })
    write('report/proteus-module.config.ts', `import { defineModule } from '@proteus-vue/module'\nexport default defineModule({ name: 'app', version: '1.0.0' })\n`)
    const a1 = await auditModule(sub)
    expect(formatAuditReport(a1)).toContain('全部通过')
    const fake: typeof a1 = { ...a1, ok: false, cycles: [['a', 'b']] }
    expect(formatAuditReport(fake)).toContain('循环依赖')
    expect(formatAuditReport(fake)).toContain('CI 阻断')
  })
})
