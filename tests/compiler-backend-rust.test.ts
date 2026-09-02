// tests/compiler-backend-rust.test.ts
// ★G-29 B2（compiler-backend-1-plan 01 §4 / 06-integration-batches）：RustBackend——同一份 SFC → 语义等价的 CompilerIR
//   G-29.1 铁律：Node/Rust/WASM 三端后端对同一份 SFC 必须产出语义等价的 Compiler IR（IR Golden Test）
//   验证点：① Rust CLI 产出 IR 形状（version:1 / render 语义链接 / C-IR 树 / 计数）② NodeBackend vs RustBackend
//   语义等价（render 树 semantic 序列 + C-IR 树语义序列一致）③ 纯兼容层模板（无 p-* → semanticCount 0）
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createNodeCompilerBackend, DEFAULT_CONFORMANCE_SFC } from '@proteus-vue/compiler-backend'

const CRATE_DIR = path.resolve('packages/compiler-backend-rust')
const BIN = path.join(CRATE_DIR, 'target', 'debug', 'proteus-cc-rust')

/** 跑 Rust CLI：临时 .vue 文件 → IR JSON */
function compileWithRust(sfc: string): { ir: Record<string, unknown>; raw: string } {
  const tmp = path.join(os.tmpdir(), `proteus-rust-${Math.random().toString(36).slice(2)}.vue`)
  fs.writeFileSync(tmp, sfc, 'utf-8')
  try {
    const raw = execFileSync(BIN, ['compile', tmp], { encoding: 'utf-8', timeout: 30000 })
    return { ir: JSON.parse(raw), raw }
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

/** 渲染树 → 语义序列（BFS 扁平——语义等价对比用：p-* 带 semantic、兼容层带 type） */
function semanticSeq(node: { type?: string; semantic?: string; children?: unknown[] }): string[] {
  const out: string[] = []
  const walk = (n: { type?: string; semantic?: string; children?: unknown[] }) => {
    out.push(n.semantic ?? n.type ?? '')
    for (const c of (n.children ?? []) as Array<{ type?: string; semantic?: string; children?: unknown[] }>) walk(c)
  }
  walk(node)
  return out
}

/** C-IR 树 → 语义序列（仅 p-* 语义树节点） */
function cirSeq(node: { semantic?: string; children?: unknown[] } | null | undefined): string[] {
  if (!node) return []
  const out: string[] = [node.semantic ?? '']
  for (const c of (node.children ?? []) as Array<{ semantic?: string; children?: unknown[] }>) out.push(...cirSeq(c))
  return out
}

beforeAll(() => {
  // ★首次运行 cargo build（debug——缓存后秒级）；二进制不存在才编译
  if (!fs.existsSync(BIN)) {
    execFileSync('cargo', ['build'], { cwd: CRATE_DIR, encoding: 'utf-8', timeout: 300000 })
  }
}, 300000)

describe('G-29 B2 RustBackend（同一 SFC → 语义等价 CompilerIR——G-29.1）', () => {
  it('Rust CLI：DEFAULT_CONFORMANCE_SFC → IR 形状（version/render 语义链接/计数/bindings）', () => {
    const { ir } = compileWithRust(DEFAULT_CONFORMANCE_SFC)
    expect(ir.version).toBe(1) // CMP004
    const render = ir.render as { root: { type: string; semantic: string; children: unknown[] } }
    expect(render.root).toMatchObject({ type: 'p-stack', semantic: 'layout.stack' })
    const seq = semanticSeq(render.root)
    // p-stack/p-grid/p-box/view/p-text/p-button/p-input/p-scan-qr
    expect(seq).toContain('layout.grid')
    expect(seq).toContain('layout.box')
    expect(seq).toContain('ui.text')
    expect(seq).toContain('ui.button')
    expect(seq).toContain('ui.input')
    expect(seq).toContain('capability.scan-qr')
    const sem = ir.semantic as { semantic_count: number; compat_count: number }
    expect(sem.semantic_count).toBe(7) // 7 个 p-* 语义节点
    expect(sem.compat_count).toBe(1) // 1 个 view 兼容层
    const bindings = ir.bindings as { capabilities: Array<{ name: string }>; models: Array<{ name: string; expr: string }>; handlers: Array<{ name: string; target: string }> }
    expect(bindings.capabilities).toEqual([{ name: 'scan-qr', semantic: 'capability.scan-qr' }])
    expect(bindings.models).toEqual([{ name: 'modelValue', expr: 'keyword' }])
    expect(bindings.handlers).toEqual([{ name: 'click', target: 'onSave' }])
  })

  it('★G-29.1 语义等价：NodeBackend vs RustBackend——render 树 semantic 序列与 C-IR 树语义序列一致', () => {
    const nodeIr = createNodeCompilerBackend().compile({ filename: 'fixture.vue', source: DEFAULT_CONFORMANCE_SFC })
    const { ir: rustIr } = compileWithRust(DEFAULT_CONFORMANCE_SFC)
    // render 树语义序列（Node render.root vs Rust render.root）
    const nodeRenderSeq = semanticSeq(nodeIr.render.root as never)
    const rustRenderSeq = semanticSeq((rustIr.render as { root: never }).root)
    expect(rustRenderSeq).toEqual(nodeRenderSeq)
    // C-IR 树语义序列（Node semantic.tree vs Rust semantic.tree）
    const nodeCirSeq = cirSeq(nodeIr.semantic.tree as never)
    const rustCirSeq = cirSeq((rustIr.semantic as { tree: never | null }).tree)
    expect(rustCirSeq).toEqual(nodeCirSeq)
    // 计数一致
    expect((rustIr.semantic as { semantic_count: number }).semantic_count).toBe(nodeIr.semantic.semanticCount)
    expect((rustIr.semantic as { compat_count: number }).compat_count).toBe(nodeIr.semantic.compatCount)
  })

  it('纯兼容层模板（无 p-*）→ semanticCount 0 / 兼容层计数正确', () => {
    const sfc = `<template>
  <view class="a">
    <text>你好</text>
    <scroll-view>列表</scroll-view>
  </view>
</template>`
    const { ir } = compileWithRust(sfc)
    const sem = ir.semantic as { semantic_count: number; compat_count: number; tree: unknown }
    expect(sem.semantic_count).toBe(0)
    expect(sem.compat_count).toBe(3) // view/text/scroll-view
    expect(sem.tree).toBeNull() // C-IR 树空（无 p-* 节点）
    const render = ir.render as { root: { type: string; semantic?: string } }
    expect(render.root).toMatchObject({ type: 'view' })
    expect(render.root.semantic).toBeUndefined()
  })

  it('动态绑定 props 提取：:min-col-width → { expr } / 静态字符串 → 原值', () => {
    const sfc = `<template>
  <p-grid :min-col-width="160" label="网格" :max-cols="4" />
</template>`
    const { ir } = compileWithRust(sfc)
    const root = (ir.render as { root: { props: Record<string, unknown>; semantic: string } }).root
    expect(root.semantic).toBe('layout.grid')
    expect(root.props['min-col-width']).toEqual({ expr: '160' })
    expect(root.props['max-cols']).toEqual({ expr: '4' })
    expect(root.props['label']).toBe('网格')
  })
})