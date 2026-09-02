// tests/compiler-backend-g38.test.ts
// ★G-38（compiler-backend-spi-plan）B1/B2-Node：parse/transform/emit 三阶段 SPI 参考实现门禁（决策 #334）
//   conformance-runner.js --backend 指向本实现已 42 项 0 FAIL（capability SKIP 合规）；本文件仓库内防回归：
//   ① parse：裸模板片段/SFC 模板解析 + loc + 语法错误 diagnostics 不抛（C-03-03）+ TSX 明确报错（C-03-05）
//   ② transform：p-* → ComponentIR 语义树（真 TAG_SEMANTIC_MAP）+ capabilities 收集 + 确定性（C-04-01/05/06）
//   ③ emit：code/hash + 确定性（C-05-01/03/05）④ 生命周期 initialize/dispose/幂等（C-02）⑤ session noop 形状（C-06-01）
//   ⑥ cacheKey/artifactHash（C-09-01）⑦ capabilities 诚实声明（incremental:false → C-06-02~05 SKIP 依据）
import { describe, it, expect } from 'vitest'
import { createG38NodeBackend, g38Hash } from '@proteus-vue/compiler-backend'

const backend = createG38NodeBackend()

describe('G-38 Node 参考实现：parse', () => {
  it('裸模板片段 → ProgramIR（顶层 + 嵌套元素 + loc——C-03-01/04）', () => {
    const ir = backend.parse({ content: '<p-grid><p-text>hi</p-text></p-grid>' })
    expect(ir.nodes[0].tag).toBe('p-grid')
    expect(ir.nodes[0].children[0].tag).toBe('p-text')
    expect(ir.nodes[0].loc.line).toBeGreaterThan(0)
    expect(ir.nodes[0].loc.column).toBeGreaterThan(0)
  })

  it('SFC 源码 → 取 <template> 解析（<p-stack> 顶层——C-03-02）', () => {
    const sfc = `<template>\n  <p-stack>\n    <p-button @click="onSave">保存</p-button>\n  </p-stack>\n</template>\n<script setup lang="ts">\nfunction onSave() {}\n</script>`
    const ir = backend.parse({ content: sfc, path: 'x.vue' })
    expect(ir.nodes[0].tag).toBe('p-stack')
    // @click 指令不落 attributes（绑定收集非语义面）；静态属性保留
  })

  it('语法错误 → diagnostics 而非抛异常（C-03-03）', () => {
    const ir = backend.parse({ content: '<unclosed' })
    expect(Array.isArray(ir.diagnostics)).toBe(true)
    expect(ir.diagnostics.length).toBeGreaterThan(0)
  })

  it('未知 p- 标签 parse 不抛（C-03-05——诊断或正常返回）', () => {
    const ir = backend.parse({ content: '<p-unsupported-xxx></p-unsupported-xxx>' })
    expect(ir.nodes[0].tag).toBe('p-unsupported-xxx')
  })

  it('TSX/JSX 超出能力声明 → 明确报错（C-03-05 不静默）', () => {
    expect(() => backend.parse({ content: '<pStack />', path: 'a.tsx' }, { filename: 'a.tsx' })).toThrow(/不支持语言/)
  })
})

describe('G-38 Node 参考实现：transform', () => {
  it('p-grid → layout.grid / p-button → ui.button（C-04-01/03，真 TAG_SEMANTIC_MAP）', () => {
    const m = backend.transform(backend.parse({ content: '<p-grid><p-button>点</p-button></p-grid>' }))
    expect(m.components[0].semantic).toBe('layout.grid')
    expect(m.components[0].children[0].semantic).toBe('ui.button')
    expect(m.components[0].semantic).not.toBe('unknown.p-grid')
    expect(m.metadata.semanticCount).toBe(2)
    expect(m.metadata.compatCount).toBe(0)
  })

  it('组件形态含 tag/props/children——G-37 RenderBackend 可消费（ComponentIR 契约）', () => {
    const m = backend.transform(backend.parse({ content: '<p-stack><p-text class="t">x</p-text></p-stack>' }))
    const c = m.components[0]
    expect(c).toMatchObject({ tag: 'p-stack', semantic: 'layout.stack' })
    expect(c.children[0].props).toEqual({}) // class 非约束属性剔除
    expect(c.children[0].semantic).toBe('ui.text')
  })

  it('确定性：同输入两次 transform 字节一致（C-04-05）', () => {
    const a = backend.transform(backend.parse({ content: '<p-text>hi</p-text>' }))
    const b = backend.transform(backend.parse({ content: '<p-text>hi</p-text>' }))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('capability.* 语义 → IRModule.capabilities（G-28 消费）', () => {
    const m = backend.transform(backend.parse({ content: '<p-scan-qr />' }))
    expect(m.capabilities).toEqual([{ name: 'scan-qr', semantic: 'capability.scan-qr' }])
  })

  it('兼容层容器内嵌 p-* 亦收集（G-38 语义=模板内全部语义组件清单）', () => {
    const m = backend.transform(backend.parse({ content: '<div class="page"><p-text>hi</p-text></div>' }))
    expect(m.components[0].semantic).toBe('ui.text')
    expect(m.metadata.compatCount).toBe(1) // div
  })
})

describe('G-38 Node 参考实现：emit / 生命周期 / 会话 / 哈希', () => {
  it('emit 产 code + hash，同模块两次字节一致（C-05-01/03/05）', () => {
    const m = backend.transform(backend.parse({ content: '<p-grid></p-grid>' }))
    const a1 = backend.emit(m)
    const a2 = backend.emit(m)
    expect(a1.code.length).toBeGreaterThan(0)
    expect(a1.hash).toBeTruthy()
    expect(a1.code).toBe(a2.code)
    expect(a1.hash).toBe(a2.hash)
  })

  it('生命周期：initialize 幂等 / dispose 后可重复 initialize（C-02-03）', async () => {
    await backend.initialize()
    await backend.initialize()
    backend.dispose()
    await backend.initialize()
    backend.dispose()
  })

  it('IncrementalSession：noop 会话形状完整（C-06-01/10-02；incremental:false → 02-05 SKIP 依据）', () => {
    const s = backend.createIncrementalSession('/tmp')
    expect(s.id).toBeTruthy()
    expect(() => {
      s.invalidate('a.sfc')
      s.recompute()
      s.getDependencies('a.sfc')
      s.commit()
      s.rollback()
      s.getStats()
      s.dispose()
    }).not.toThrow()
  })

  it('capabilities 诚实声明（incremental:false/sourceMap:false → 对应组 SKIP）', () => {
    expect(backend.capabilities).toMatchObject({ incremental: false, sourceMap: false, treeShake: false, backend: 'js', deterministic: true, supportedLanguages: ['sfc', 'vue'] })
  })

  it('cacheKey 随输入变化 / artifactHash 确定性（C-09-01）', () => {
    const k1 = backend.getCacheKey({ content: '<p-grid />' })
    const k2 = backend.getCacheKey({ content: '<p-grid>a</p-grid>' })
    expect(k1).not.toBe(k2)
    expect(k1).toBe(backend.getCacheKey({ content: '<p-grid />' }))
    const m = backend.transform(backend.parse({ content: '<p-grid />' }))
    const a = backend.emit(m)
    expect(backend.getArtifactHash(a)).toBe(a.hash)
    expect(backend.getArtifactHash({ code: 'x' } as never)).toBe(g38Hash('x'))
  })

  it('id=node / version 存在 / reportDiagnostics 返回数组（C-10-01）', () => {
    expect(backend.id).toBe('node')
    expect(backend.version).toBeTruthy()
    expect(Array.isArray(backend.reportDiagnostics({} as never))).toBe(true)
  })
})
