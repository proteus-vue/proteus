// tests/component-b8.test.ts
// ★组件库落地评估 v2（B8 收官）：proteus components:audit 审计门禁 + 渲染埋点 observability
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { auditComponents, formatComponentAudit } from '../packages/cli/src/component-audit'
import { compileVueSfc } from '@proteus-vue/compiler'
import { componentRender, setObservabilityEnabled } from '../src/components/runtime/observability'

const COMPONENTS_DIR = path.resolve('src/components')

function compileComponent(tag: string) {
  const sfc = fs.readFileSync(path.join(COMPONENTS_DIR, tag, 'index.vue'), 'utf-8')
  return compileVueSfc(sfc, { isComponent: true, filename: `src/components/${tag}/index.vue` })
}

describe('proteus components:audit —— 真实组件目录零违规（硬门禁基线）', () => {
  it('src/components 审计通过：no-platform-api / no-sync-storage / manifest-complete 全部 OK', () => {
    const result = auditComponents(COMPONENTS_DIR)
    expect(result.ok, formatComponentAudit(result)).toBe(true)
    expect(result.componentCount).toBeGreaterThanOrEqual(16)
  })
})

describe('components:audit 违规捕获（故意写违规代码 → 阻断）', () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-comp-b8-'))
  afterAll(() => {
    fs.rmSync(TMP, { recursive: true, force: true })
  })

  function writeComponent(dir: string, tag: string, script: string): void {
    const full = path.join(dir, tag)
    fs.mkdirSync(full, { recursive: true })
    fs.writeFileSync(path.join(full, 'index.vue'), `<script setup lang="ts">\n${script}\n</script>\n<template><view /></template>\n`)
  }

  it('组件内直接 wx.* → no-platform-api 违规', () => {
    const root = path.join(TMP, 'violation1')
    writeComponent(root, 'p-bad', 'function get() {\n  const sys = wx.getSystemInfoSync()\n  return sys\n}')
    fs.writeFileSync(path.join(root, 'index.ts'), `import PBad from './p-bad/index.vue'\nexport { PBad }\n`)
    const result = auditComponents(root)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.rule === 'no-platform-api')).toBe(true)
    expect(formatComponentAudit(result)).toContain('[no-platform-api]')
  })

  it('组件内 document. 直调 → no-platform-api 违规（注释不误报）', () => {
    const root = path.join(TMP, 'violation2')
    writeComponent(root, 'p-doc', '// document.title = "x"（注释应豁免）\nfunction go() {\n  document.title = "y"\n}')
    fs.writeFileSync(path.join(root, 'index.ts'), `import PDoc from './p-doc/index.vue'\nexport { PDoc }\n`)
    const result = auditComponents(root)
    expect(result.violations.filter((v) => v.rule === 'no-platform-api').length).toBe(1)
  })

  it('组件内 wx.setStorageSync → no-sync-storage 违规', () => {
    const root = path.join(TMP, 'violation3')
    writeComponent(root, 'p-store', 'function save() {\n  wx.setStorageSync("k", 1)\n}')
    fs.writeFileSync(path.join(root, 'index.ts'), `import PStore from './p-store/index.vue'\nexport { PStore }\n`)
    const result = auditComponents(root)
    expect(result.violations.some((v) => v.rule === 'no-sync-storage')).toBe(true)
  })

  it('聚合导出缺组件 / 导出不存在目录 → manifest-complete 违规', () => {
    const root = path.join(TMP, 'manifest')
    writeComponent(root, 'p-a', 'function x() { return 1 }')
    fs.writeFileSync(path.join(root, 'index.ts'), `import PMissing from './p-missing/index.vue'\nexport { PMissing }\n`)
    const result = auditComponents(root)
    const rules = result.violations.map((v) => v.rule)
    expect(rules).toContain('manifest-complete')
    // p-a 未导出 → 违规；p-missing 不存在目录 → 违规
    expect(result.violations.filter((v) => v.rule === 'manifest-complete').length).toBeGreaterThanOrEqual(2)
  })
})

describe('渲染埋点 observability（B8）', () => {
  it('默认 no-op（零开销）；开启后输出 [proteus][render]；可关闭', () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...a: unknown[]) => { logs.push(String(a[0])) }
    try {
      componentRender('p-list-view', { durationMs: 1.2, itemCount: 12, strategy: 'virtual' }) // 未开启 → no-op
      setObservabilityEnabled(true)
      componentRender('p-list-view', { durationMs: 1.2, itemCount: 12, strategy: 'virtual' })
      setObservabilityEnabled(false)
      componentRender('p-list-view', { durationMs: 0.5, itemCount: 8, strategy: 'virtual' }) // 关闭 → no-op
    } finally {
      console.log = origLog
    }
    expect(logs.length).toBe(1)
    expect(logs[0]).toContain('[proteus][render] p-list-view 1.2ms')
    expect(logs[0]).toContain('item=12')
    expect(logs[0]).toContain('strategy=virtual')
  })
})

describe('p-list-view 渲染埋点接入（B8）', () => {
  it('calc 内含 componentRender 调用', () => {
    const { js } = compileComponent('p-list-view')
    expect(js).toContain('componentRender(')
    expect(js).toContain("'p-list-view'")
  })
})
