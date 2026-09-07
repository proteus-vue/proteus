// tests/compiler-backend.test.ts
// ★G-29（compiler-backend-1-plan B1）：CompilerIR 契约 + NodeBackend 产出合规 IR
//   验证点（06-integration-batches §4）：IR 语义等价确定性（Golden 雏形）/ CMP004 版本 / CMP002 IR 契约 /
//   ★G-31 衔接：真实模板编译 → toComponentIR 语义树（p-* → C-IR）
import { describe, it, expect } from 'vitest'
import {
  createNodeCompilerBackend,
  runCompilerConformance,
  DEFAULT_CONFORMANCE_SFC,
} from '@proteus-vue/compiler-backend'
import type { ProteusCompilerBackend } from '@proteus-vue/compiler-backend'

const GRID_SFC = `<template>
  <p-grid :min-col-width="160" :max-cols="4" :gap="12">
    <p-box />
    <p-text variant="h1">标题</p-text>
  </p-grid>
</template>`

describe('G-29 runCompilerConformance（B1 接口 + IR 契约自检）', () => {
  it('NodeBackend → 全部 check 通过（CMP002/CMP004 + G-31.1 语义链接）', () => {
    const result = runCompilerConformance(createNodeCompilerBackend())
    expect(result.ok, JSON.stringify(result.checks.filter((c) => !c.pass), null, 2)).toBe(true)
    expect(result.checks.map((c) => c.name)).toContain('ir.semantic.countMatch')
    expect(result.checks.map((c) => c.name)).toContain('render.semanticLink')
  })

  it('残缺后端（版本不符 + 缺 bindings）→ fail 并指明', () => {
    const broken: ProteusCompilerBackend = {
      id: 'fake',
      version: '0.0.1',
      minCompatVersion: 99, // CMP004：与契约 1 不兼容
      capabilities: {
        incremental: false,
        sourceMap: false,
        treeShaking: false,
        wasmRuntime: false,
        plugins: false,
        maxFileSize: 0, // 非法（须 > 0）
      },
      compile: () => ({
        version: 2 as unknown as 1, // IR version 不合法
        render: { root: { type: 'p-grid', props: {}, children: [], loc: { line: 1, column: 1 } } },
        semantic: { tree: null, semanticCount: 0, compatCount: 0 },
        // @ts-expect-error 缺 bindings——故意残缺
        bindings: undefined,
      }),
      parse: () => ({ root: { type: 'element', tag: 'template', props: {}, children: [], line: 1 } }),
      generate: () => ({ code: '', warnings: [] }),
    }
    const result = runCompilerConformance(broken)
    expect(result.ok).toBe(false)
    const failNames = result.checks.filter((c) => !c.pass).map((c) => c.name)
    expect(failNames).toContain('minCompatVersion')
    expect(failNames).toContain('ir.version')
    expect(failNames).toContain('bindings.capabilities')
    expect(failNames).toContain('capabilities.maxFileSize')
  })

  it('语义链接漂移：p-* 标签 semantic ≠ TAG_SEMANTIC_MAP → fail（G-31.1 机器验证）', () => {
    const drifted: ProteusCompilerBackend = {
      ...createNodeCompilerBackend(),
      compile: () => ({
        version: 1,
        render: {
          root: {
            type: 'p-grid',
            semantic: 'layout.stack', // 漂移——应为 layout.grid
            props: {},
            children: [],
            loc: { line: 1, column: 1 },
          },
        },
        semantic: { tree: null, semanticCount: 0, compatCount: 0 },
        bindings: { capabilities: [], models: [], handlers: [] },
      }),
    }
    const result = runCompilerConformance(drifted)
    expect(result.ok).toBe(false)
    expect(result.checks.find((c) => c.name === 'render.semanticLink')?.pass).toBe(false)
  })
})

describe('G-29 NodeBackend（B1 参考实现：真实模板编译 → CompilerIR）', () => {
  it('grid SFC → IR：渲染树语义链接 + C-IR 语义树 + 属性 camelCase + 计数一致', () => {
    const backend = createNodeCompilerBackend()
    const ir = backend.compile({ filename: 'grid.vue', source: GRID_SFC })

    expect(ir.version).toBe(1)
    // 渲染树：p-grid → layout.grid（G-31.1 语义链接），children 递归
    expect(ir.render.root.type).toBe('p-grid')
    expect(ir.render.root.semantic).toBe('layout.grid')
    expect(ir.render.root.props.minColWidth).toEqual({ expr: '160' }) // :min-col-width → camelCase + { expr }
    expect(ir.render.root.props.maxCols).toEqual({ expr: '4' })
    expect(ir.render.root.children.map((c) => c.type)).toEqual(['p-box', 'p-text'])
    expect(ir.render.root.children[1].semantic).toBe('ui.text')
    expect(ir.render.root.children[1].props.variant).toBe('h1') // 静态属性 → 字符串
    expect(ir.render.root.loc.line).toBe(2)

    // C-IR 语义树（★真实模板编译 → toComponentIR）
    expect(ir.semantic.tree).toMatchObject({
      tag: 'p-grid',
      semantic: 'layout.grid',
      props: { minColWidth: { expr: '160' }, maxCols: { expr: '4' }, gap: { expr: '12' } },
    })
    expect(ir.semantic.tree?.children).toHaveLength(2)
    expect(ir.semantic.tree?.children[1]).toMatchObject({ tag: 'p-text', semantic: 'ui.text', props: { variant: 'h1' } })

    // 计数交叉核对（render semantic 节点 3 == semanticCount 3 == C-IR 树 3 节点）
    expect(ir.semantic.semanticCount).toBe(3)
    expect(ir.semantic.compatCount).toBe(0)
  })

  it('★兼容层标签：view/scroll-view 保留在渲染树（无 semantic）、不进 C-IR 树、compatCount 计数', () => {
    const backend = createNodeCompilerBackend()
    const ir = backend.compile({
      filename: 'compat.vue',
      source: `<template>
  <p-box>
    <view class="inner"></view>
    <scroll-view><view /></scroll-view>
  </p-box>
</template>`,
    })
    const root = ir.render.root
    expect(root.semantic).toBe('layout.box')
    expect(root.children.map((c) => c.type)).toEqual(['view', 'scroll-view'])
    expect(root.children[0].semantic).toBeUndefined() // 兼容层无语义
    expect(root.children[1].children[0].type).toBe('view')
    // C-IR 树：p-box 子节点全是兼容层 → children 为空
    expect(ir.semantic.tree?.children).toEqual([])
    expect(ir.semantic.semanticCount).toBe(1) // 仅 p-box
    expect(ir.semantic.compatCount).toBe(3) // view × 2 + scroll-view
  })

  it('bindings：capability 入口 + v-model + 事件收集（G-28 消费）', () => {
    const backend = createNodeCompilerBackend()
    const ir = backend.compile({
      filename: 'form.vue',
      source: `<template>
  <p-stack :gap="8">
    <p-input v-model="keyword" />
    <p-button @click="onSave">保存</p-button>
    <p-scan-qr />
  </p-stack>
</template>`,
    })
    expect(ir.bindings.models).toEqual([{ name: 'modelValue', expr: 'keyword' }])
    expect(ir.bindings.handlers).toEqual([{ name: 'click', target: 'onSave' }])
    expect(ir.bindings.capabilities).toEqual([{ name: 'scan-qr', semantic: 'capability.scan-qr' }])
    // capability 入口语义组件在 C-IR 树中
    expect(ir.semantic.tree?.children[2]).toMatchObject({ tag: 'p-scan-qr', semantic: 'capability.scan-qr' })
  })

  it('★确定性（IR Golden 雏形）：同一 SFC 编译两次 → 深等；跨编译可 diff', () => {
    const backend = createNodeCompilerBackend()
    const a = backend.compile({ filename: 'grid.vue', source: GRID_SFC })
    const b = backend.compile({ filename: 'grid.vue', source: GRID_SFC })
    expect(a).toEqual(b)
  })

  it('parse：模板字符串 → 结构化节点树（与 @vue/compiler-dom 解耦的投影）', () => {
    const backend = createNodeCompilerBackend()
    const ast = backend.parse('<p-grid><p-box /><p-box /></p-grid>')
    expect(ast.root.type).toBe('element')
    expect(ast.root.tag).toBe('p-grid')
    expect(ast.root.children.map((c) => c.tag)).toEqual(['p-box', 'p-box'])
  })

  it('generate：IR → 序列化代码（B1 最小实现）', () => {
    const backend = createNodeCompilerBackend()
    const ir = backend.compile({ filename: 'grid.vue', source: GRID_SFC })
    const gen = backend.generate(ir)
    expect(gen.warnings).toEqual([])
    expect(typeof gen.code).toBe('string')
    expect(JSON.parse(gen.code).semantic.tree.semantic).toBe('layout.grid')
  })

  it('DEFAULT_CONFORMANCE_SFC 编译产物自洽（conformance fixture 的真实性）', () => {
    const backend = createNodeCompilerBackend()
    const ir = backend.compile({ filename: 'conformance.vue', source: DEFAULT_CONFORMANCE_SFC })
    expect(ir.semantic.semanticCount).toBeGreaterThan(0)
    expect(ir.semantic.compatCount).toBeGreaterThan(0) // 含 view 兼容层
    expect(ir.bindings.capabilities.length).toBe(1) // p-scan-qr
    expect(ir.bindings.models.length).toBe(1) // v-model
    expect(ir.render.root.semantic).toBe('layout.stack')
  })
})