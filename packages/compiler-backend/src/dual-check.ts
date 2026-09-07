// packages/compiler-backend/src/dual-check.ts
// ★G-29 编译器后端插拔（compiler-backend-1-plan 01 §5「切换方式」）——阶段 A 消费点纯逻辑：
//   config.compiler.backend = 'rust'（或 `proteus build --compiler rust`）→ 构建内「双编译语义等价校验」：
//   同一份 SFC → NodeBackend（基准，恒可用） + RustBackend（proteus-cc-rust CLI）→ diff render 语义序列 /
//   计数 / C-IR null / bindings —— 不一致即构建红（G-29.1 真实页面语义）
//   ★阶段定位：产物（wxml/js/wxss）仍由 Node 引擎（compileVueSfc）生成；Rust 当前是「语义等价校验源」——
//   一个 flag 打开真实消费行为、业务零感知；产物级 Rust codegen 属后续批次（B3/B4 路线）
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createNodeCompilerBackend } from './node'

const require = createRequire(import.meta.url)

export type CompilerBackendChoice = 'node' | 'rust'

// —— 语义等价对比锚点（与 tests/compiler-backend-examples.test.ts 同一套） ——

/** 渲染树 → 语义序列（BFS：p-* → semantic；兼容层 → type） */
function semanticSeq(node: { type?: string; semantic?: string; children?: unknown[] }): string[] {
  const out: string[] = []
  const walk = (n: { type?: string; semantic?: string; children?: unknown[] }) => {
    out.push(n.semantic ?? n.type ?? '')
    for (const c of (n.children ?? []) as Array<{ type?: string; semantic?: string; children?: unknown[] }>) walk(c)
  }
  walk(node)
  return out
}

/** 事件名归一（Node 用 arg：@click.stop → click；Rust 键带修饰符） */
function normHandlerName(name: string): string {
  return name.split('.')[0]
}

interface RustBindings {
  handlers?: Array<{ name: string; target: string }>
  models?: Array<{ name: string; expr: string }>
  capabilities?: Array<{ name: string; semantic: string }>
}

/**
 * ★双编译语义等价校验：同一 SFC → Node/Rust 双后端 → diff
 *   @param rustBin  Rust CLI 可执行（bin/cli.js 路径；null → skipped）
 *   @param runRust  注入式 runner（默认 execFileSync node bin compile —— 测试注入 mock 驱动 mismatch/skipped）
 */
export function verifyDualCompilerEquivalence(
  source: string,
  opts: { rustBin: string | null; filename?: string; runRust?: (bin: string, sfc: string) => string },
): { status: 'ok' | 'mismatch' | 'skipped'; details: string[]; reason?: string } {
  if (!opts.rustBin) {
    return {
      status: 'skipped',
      details: [],
      reason: 'Rust 后端二进制未找到（安装 @proteus-vue/compiler-backend-rust 或设 PROTEUS_CC_RUST）——降级 Node 校验',
    }
  }
  // ① 基准：NodeBackend（恒可用——参考实现）
  const nodeIr = createNodeCompilerBackend().compile({ filename: opts.filename ?? 'dual-check.vue', source })
  // ② Rust CLI
  let rustRaw: string
  try {
    rustRaw = opts.runRust ? opts.runRust(opts.rustBin, source) : runRustCli(opts.rustBin, source)
  } catch (e) {
    return {
      status: 'mismatch',
      details: [`Rust CLI 执行失败：${(e as Error).message.slice(0, 160)}`],
      reason: 'rust-cli-error',
    }
  }
  let rustIr: { render?: { root?: never }; semantic?: { semantic_count?: number; compat_count?: number; tree?: unknown }; bindings?: RustBindings }
  try {
    rustIr = JSON.parse(rustRaw) as typeof rustIr
  } catch {
    return { status: 'mismatch', details: ['Rust CLI 输出非法 JSON（非 CompilerIR）'], reason: 'rust-invalid-json' }
  }

  // ③ diff（details 逐项列出漂移——构建红信息可读）
  const details: string[] = []
  const nodeRenderSeq = semanticSeq(nodeIr.render.root as never)
  const rustRoot = rustIr.render?.root
  if (!rustRoot) {
    details.push('Rust render.root 缺失')
  } else if (JSON.stringify(semanticSeq(rustRoot)) !== JSON.stringify(nodeRenderSeq)) {
    details.push('render 树语义序列不一致（G-29.1）')
  }
  const rustSem = rustIr.semantic
  const nodeSem = nodeIr.semantic as { semanticCount: number; compatCount: number }
  if (!rustSem || rustSem.semantic_count !== nodeSem.semanticCount) {
    details.push(`semanticCount 不一致（Node ${nodeSem.semanticCount} vs Rust ${rustSem?.semantic_count ?? '?'}）`)
  }
  if (!rustSem || rustSem.compat_count !== nodeSem.compatCount) {
    details.push(`compatCount 不一致（Node ${nodeSem.compatCount} vs Rust ${rustSem?.compat_count ?? '?'}）`)
  }
  const nodeTreeNull = (nodeIr.semantic as { tree: unknown }).tree == null
  const rustTreeNull = rustSem == null || rustSem.tree == null
  if (rustTreeNull !== nodeTreeNull) {
    details.push(`C-IR tree null 与否不一致（Node ${nodeTreeNull} vs Rust ${rustTreeNull}）`)
  }
  // bindings（事件名归一对齐 Node arg）
  const rb = rustIr.bindings
  const nb = nodeIr.bindings
  if (!rb || JSON.stringify(rb.handlers?.map((h) => ({ name: normHandlerName(h.name), target: h.target })) ?? []) !== JSON.stringify(nb.handlers.map((h) => ({ name: normHandlerName(h.name), target: h.target })))) {
    details.push('bindings.handlers 不一致')
  }
  if (!rb || JSON.stringify(rb.models ?? []) !== JSON.stringify(nb.models)) {
    details.push('bindings.models 不一致')
  }
  if (!rb || JSON.stringify(rb.capabilities ?? []) !== JSON.stringify(nb.capabilities)) {
    details.push('bindings.capabilities 不一致')
  }
  return details.length ? { status: 'mismatch', details, reason: 'ir-drift' } : { status: 'ok', details: [] }
}

/** 默认 Rust runner：临时 .vue → `node bin/cli.js compile` → IR JSON stdout */
function runRustCli(bin: string, source: string): string {
  const tmp = path.join(os.tmpdir(), `proteus-dual-${Math.random().toString(36).slice(2)}.vue`)
  fs.writeFileSync(tmp, source, 'utf-8')
  try {
    return execFileSync(process.execPath, [bin, 'compile', tmp], { encoding: 'utf-8', timeout: 30000 })
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

/**
 * ★定位 Rust CLI 可执行（bin/cli.js——npm bin 壳：release 优先/缺失自动 cargo build）：
 *   ① env PROTEUS_CC_RUST 显式路径 → ② 工程/本包解析 @proteus-vue/compiler-backend-rust 包 → null（调用方降级）
 */
export function resolveRustCliBin(projectRoot: string): string | null {
  const explicit = process.env.PROTEUS_CC_RUST
  if (explicit && fs.existsSync(explicit)) return explicit
  try {
    const pkgJson = require.resolve('@proteus-vue/compiler-backend-rust/package.json', {
      paths: [projectRoot, process.cwd()],
    })
    const bin = path.join(path.dirname(pkgJson), 'bin', 'cli.js')
    return fs.existsSync(bin) ? bin : null
  } catch {
    return null
  }
}
