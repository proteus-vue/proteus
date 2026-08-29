// tests/module-graph.test.ts
// ★module-plan B3（M3 DependencyGraph）：循环检测（DFS 三色）+ 拓扑排序（Kahn）+ chunk 分组 + manifest
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DependencyGraph, CycleError, buildModuleGraphManifest, moduleGraphToMermaid } from '../packages/module/src'
import { checkModuleConfigs } from '../packages/cli/src/module-check'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-module-graph-'))

function writeFixture(rel: string, content: string): void {
  const full = path.join(TMP, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

describe('DependencyGraph：环检测 + 拓扑排序', () => {
  it('正常 DAG → 拓扑序（被依赖者先 init）', () => {
    const g = DependencyGraph.fromConfigs([
      { name: 'trade', version: '1.0.0', dependencies: { user: '^1.0.0', payment: '^1.0.0' } },
      { name: 'user', version: '1.0.0' },
      { name: 'payment', version: '2.0.0' },
    ])
    expect(g.detectCycles()).toEqual([])
    const order = g.topologicalSort()
    expect(order.indexOf('user')).toBeLessThan(order.indexOf('trade'))
    expect(order.indexOf('payment')).toBeLessThan(order.indexOf('trade'))
  })

  it('简单环（A→B→A）→ 检出 + 拓扑抛 CycleError（含环路径）', () => {
    const g = DependencyGraph.fromConfigs([
      { name: 'a', version: '1.0.0', dependencies: { b: '^1.0.0' } },
      { name: 'b', version: '1.0.0', dependencies: { a: '^1.0.0' } },
    ])
    expect(g.detectCycles().length).toBe(1)
    expect(() => g.topologicalSort()).toThrow(CycleError)
    expect(() => g.topologicalSort()).toThrow(/a → b/)
  })

  it('复杂环（A→B→C→A）→ 检出完整路径', () => {
    const g = DependencyGraph.fromConfigs([
      { name: 'a', version: '1.0.0', dependencies: { b: '^1.0.0' } },
      { name: 'b', version: '1.0.0', dependencies: { c: '^1.0.0' } },
      { name: 'c', version: '1.0.0', dependencies: { a: '^1.0.0' } },
    ])
    const cycles = g.detectCycles()
    expect(cycles.length).toBe(1)
    expect(cycles[0]).toEqual(['a', 'b', 'c'])
  })

  it('自环（A→A）→ 检出', () => {
    const g = DependencyGraph.fromConfigs([{ name: 'a', version: '1.0.0', dependencies: { a: '^1.0.0' } }])
    expect(g.detectCycles().length).toBe(1)
  })

  it('chunk 分组 + manifest（chunks/initOrder）', () => {
    const g = DependencyGraph.fromConfigs([
      { name: 'trade', version: '1.0.0', chunk: 'trade', dependencies: { user: '^1.0.0' } },
      { name: 'coupon', version: '1.0.0', chunk: 'trade' },
      { name: 'user', version: '1.0.0', chunk: 'user' },
    ])
    const groups = g.chunkGroups()
    expect(groups.get('trade')).toEqual(['trade', 'coupon'])
    const manifest = buildModuleGraphManifest(g)
    expect(manifest.chunks.trade).toEqual(['coupon', 'trade'])
    expect(manifest.initOrder.indexOf('user')).toBeLessThan(manifest.initOrder.indexOf('trade'))
    const trade = manifest.modules.find((m) => m.name === 'trade')
    expect(trade?.dependencies).toEqual(['user'])
  })

  it('版本冲突：同一模块被不同 range 声明 → 检出', () => {
    const g = DependencyGraph.fromConfigs([
      { name: 'trade', version: '1.0.0', dependencies: { user: '^1.0.0' } },
      { name: 'pay', version: '1.0.0', dependencies: { user: '^2.0.0' } },
      { name: 'user', version: '2.0.0' },
    ])
    const conflicts = g.versionConflicts()
    expect(conflicts.length).toBe(1)
    expect(conflicts[0].module).toBe('user')
  })

  it('大图（100 模块链）→ 拓扑序正确且 < 100ms', () => {
    const configs = []
    for (let i = 0; i < 100; i++) {
      configs.push({ name: `m${i}`, version: '1.0.0', dependencies: i > 0 ? { [`m${i - 1}`]: '^1.0.0' } : {} })
    }
    const g = DependencyGraph.fromConfigs(configs as never)
    const t0 = Date.now()
    const order = g.topologicalSort()
    expect(order.length).toBe(100)
    expect(Date.now() - t0).toBeLessThan(100)
  })

  it('Mermaid 输出（拓扑序边方向：依赖 → 使用者）', () => {
    const g = DependencyGraph.fromConfigs([
      { name: 'trade', version: '1.0.0', dependencies: { user: '^1.0.0' } },
      { name: 'user', version: '1.0.0' },
    ])
    const mermaid = moduleGraphToMermaid(g)
    expect(mermaid).toContain('user --> trade')
  })
})

describe('CLI module:check 集成（依赖图）', () => {
  afterAll(() => {
    fs.rmSync(TMP, { recursive: true, force: true })
  })

  it('环依赖 → cycles 检出 + 输出含环路径', async () => {
    writeFixture('proteus-module.config.ts', `import { defineModule } from '@proteus/module'\nexport default defineModule({ name: 'app', version: '1.0.0', dependencies: { trade: '^1.0.0' } })\n`)
    writeFixture('modules/trade/proteus-module.config.ts', `import { defineModule } from '@proteus/module'\nexport default defineModule({ name: 'trade', version: '1.0.0', dependencies: { app: '^1.0.0' } })\n`)
    const { text, result, cycles } = await checkModuleConfigs(TMP)
    expect(result.modules.every((m) => m.ok)).toBe(true)
    expect(cycles.length).toBe(1)
    expect(text).toContain('★循环依赖')
    expect(text).toContain('拓扑序：—（有环，无法拓扑）')
  })

  it('--graph：输出 Mermaid 依赖图（无环 fixture）', async () => {
    // 覆盖上一个测试的环 fixture（app 依赖 trade + trade 依赖 app）为无环
    writeFixture('proteus-module.config.ts', `import { defineModule } from '@proteus/module'\nexport default defineModule({ name: 'app', version: '1.0.0' })\n`)
    writeFixture('modules/trade/proteus-module.config.ts', `import { defineModule } from '@proteus/module'\nexport default defineModule({ name: 'trade', version: '1.0.0', dependencies: { app: '^1.0.0' } })\n`)
    const { text, cycles } = await checkModuleConfigs(TMP, true)
    expect(cycles.length).toBe(0)
    expect(text).toContain('依赖图（Mermaid）：')
    expect(text).toContain('graph TD')
    expect(text).toContain('app --> trade')
  })
})
