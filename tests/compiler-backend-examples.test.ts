// tests/compiler-backend-examples.test.ts
// ★G-29.1（compiler-backend-1-plan 01 §4 / 06-integration-batches B2 后记）：examples 真实页面 × Node/Rust 双端编译跑通 + 语义等价
//   ——G-29.1 铁律从 fixture 级（DEFAULT_CONFORMANCE_SFC Golden）扩展到真实页面级：
//   对 examples/pages + examples/subpackages 全部 .vue 页面，NodeBackend 与 RustBackend（proteus-cc-rust CLI）
//   各自编译成功（不崩），且产出语义等价：
//     ① render 树结构 + 语义序列一致（BFS：p-* → semantic / 兼容层 → type）
//     ② semanticCount / compatCount 一致
//     ③ C-IR 树（semantic.tree）null 与否一致（真实页面根为 div/view——双端同为 null，B1 根约束）
//     ④ bindings.handlers（事件名去修饰符前缀对齐 Node arg）/ models / capabilities 一致
//   ★已知记录：render 树 props 不在语义等价契约内（Node 剔除 class/style/id/key/ref；Rust 保留 class 等——G-29.1 只约束语义与结构）
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createNodeCompilerBackend } from '@proteus-vue/compiler-backend'

const CRATE_DIR = path.resolve('packages/compiler-backend-rust')
const BIN = path.join(CRATE_DIR, 'target', 'debug', 'proteus-cc-rust')
// ★决策 #332 后扩展：真实页面（examples/pages + subpackages）+ 框架组件（src/components——v-if/v-else 顶层兄弟等形态）全部纳入
const WALK_ROOTS = [path.resolve('examples/pages'), path.resolve('examples/subpackages'), path.resolve('src/components')]
const REPO_ROOT = path.resolve('.')

/** 递归收集 .vue 文件（examples/pages + examples/subpackages） */
function walkVue(dir: string, acc: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walkVue(p, acc)
    else if (f.endsWith('.vue')) acc.push(p)
  }
  return acc
}

/** Rust CLI 编译（临时 .vue → IR JSON） */
function compileWithRust(sfc: string): Record<string, unknown> {
  const tmp = path.join(os.tmpdir(), `proteus-rust-${Math.random().toString(36).slice(2)}.vue`)
  fs.writeFileSync(tmp, sfc, 'utf-8')
  try {
    const raw = execFileSync(BIN, ['compile', tmp], { encoding: 'utf-8', timeout: 30000 })
    return JSON.parse(raw) as Record<string, unknown>
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

/** 渲染树 → 语义序列（BFS 扁平：p-* 带 semantic、兼容层带 type——语义等价对比锚点） */
function semanticSeq(node: { type?: string; semantic?: string; children?: unknown[] }): string[] {
  const out: string[] = []
  const walk = (n: { type?: string; semantic?: string; children?: unknown[] }) => {
    out.push(n.semantic ?? n.type ?? '')
    for (const c of (n.children ?? []) as Array<{ type?: string; semantic?: string; children?: unknown[] }>) walk(c)
  }
  walk(node)
  return out
}

/** C-IR 树 → 语义序列（仅语义树节点） */
function cirSeq(node: { semantic?: string; children?: unknown[] } | null | undefined): string[] {
  if (!node) return []
  const out: string[] = [node.semantic ?? '']
  for (const c of (node.children ?? []) as Array<{ semantic?: string; children?: unknown[] }>) out.push(...cirSeq(c))
  return out
}

/** 事件名归一（Node 用 arg（@click.stop → click）；Rust 键带修饰符——去 '.' 前缀对齐） */
function normHandlerName(name: string): string {
  return name.split('.')[0]
}

const PAGES = WALK_ROOTS.reduce((acc, root) => walkVue(root, acc), [] as string[])

beforeAll(() => {
  // ★首次运行 cargo build（debug——缓存后秒级）；二进制不存在才编译
  if (!fs.existsSync(BIN)) {
    execFileSync('cargo', ['build'], { cwd: CRATE_DIR, encoding: 'utf-8', timeout: 300000 })
  }
}, 300000)

describe('G-29.1 examples/组件真实文件：Node/Rust 双端编译跑通 + 语义等价', () => {
  for (const file of PAGES) {
    const rel = path.relative(REPO_ROOT, file)
    it(rel, () => {
      const source = fs.readFileSync(file, 'utf-8')
      // ① 双端编译都成功（不崩）——「跑通」
      const nodeIr = createNodeCompilerBackend().compile({ filename: file, source })
      const rustIr = compileWithRust(source)

      // ② render 树语义序列一致（结构 + 语义标签）
      const nodeSeq = semanticSeq(nodeIr.render.root as never)
      const rustRoot = (rustIr.render as { root: never }).root
      const rustSeq = semanticSeq(rustRoot)
      expect(rustSeq).toEqual(nodeSeq)

      // ③ 计数一致
      const nodeSem = nodeIr.semantic as { semanticCount: number; compatCount: number }
      const rustSem = rustIr.semantic as { semantic_count: number; compat_count: number }
      expect(rustSem.semantic_count).toBe(nodeSem.semanticCount)
      expect(rustSem.compat_count).toBe(nodeSem.compatCount)

      // ④ C-IR 树 null 与否一致（真实页面根为 div/view → 双端同为 null；B1 根约束）
      const nodeTreeNull = (nodeIr.semantic as { tree: unknown }).tree == null
      const rustTreeNull = (rustIr.semantic as { tree: unknown }).tree == null
      expect(rustTreeNull).toBe(nodeTreeNull)
      if (!nodeTreeNull) {
        expect(cirSeq((rustIr.semantic as { tree: never }).tree)).toEqual(cirSeq((nodeIr.semantic as { tree: never }).tree))
      }

      // ⑤ bindings 一致（handlers 事件名归一 / models / capabilities）
      const nodeB = nodeIr.bindings
      const rustB = rustIr.bindings as {
        handlers: Array<{ name: string; target: string }>
        models: Array<{ name: string; expr: string }>
        capabilities: Array<{ name: string; semantic: string }>
      }
      expect(rustB.handlers.map((h) => ({ name: normHandlerName(h.name), target: h.target }))).toEqual(
        nodeB.handlers.map((h) => ({ name: normHandlerName(h.name), target: h.target })),
      )
      expect(rustB.models).toEqual(nodeB.models)
      expect(rustB.capabilities).toEqual(nodeB.capabilities)
    })
  }
})
