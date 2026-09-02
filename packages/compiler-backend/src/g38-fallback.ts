// packages/compiler-backend/src/g38-fallback.ts
// ★G-38（compiler-backend-spi-plan 01 §6/03-implementation-guide FallbackBackend）B2 尾：
//   降级选择器——preferred 后端不可用（环境/许可/未安装）→ 自动降级 node，事件可观测（C-07-01/02）
//   与渲染的关键区别（§6）：编译换后端不影响产物语义——Rust/Node 产出字节级一致（deterministic emit G-38.6/CMP030）
//   默认 loader：'node' → createG38NodeBackend；其余（rust/go/wasm/bytecode）尚未接入 → null（诚实降级——rust g38 native 属 B3）
import { createG38NodeBackend } from './g38'
import type { G38CompilerBackend } from './g38'

export interface G38FallbackLog {
  from: string
  to: string
  reason: string
}

export interface G38FallbackOptions {
  /** 首选后端 id（'node' | 'rust' | 'go' | 'wasm' | 'bytecode'） */
  preferred: string
  /** 降级目标（规范 §6 固定 node——Node 参考实现恒可用） */
  fallback?: 'node'
  /** 加载器（注入可单测）：返回后端实例；null/抛错 → 降级 */
  load?: (id: string) => Promise<G38CompilerBackend | null>
  /** 降级事件监听（日志/指标——C-07-02 可观测） */
  onFallback?: (log: G38FallbackLog) => void
}

export interface G38FallbackResult {
  /** 实际选用的后端（preferred 可用 → 它；否则 node 参考实现） */
  backend: G38CompilerBackend
  /** 降级记录（未降级 → null） */
  fallback: G38FallbackLog | null
  isDegraded: boolean
}

/** 默认 loader：Node 参考实现恒可用；Rust/Go/WASM/Bytecode 的 G-38 形态后端未接入 → null（诚实降级） */
async function defaultLoader(id: string): Promise<G38CompilerBackend | null> {
  if (id === 'node') return createG38NodeBackend()
  return null
}

/**
 * ★createG38FallbackBackend：selectCompilerBackend（01 §6 / 03-implementation-guide）
 *   用法：const { backend } = await createG38FallbackBackend({ preferred: 'rust' })
 *   → rust 不可用 → backend = node 参考实现 + fallback 日志（from:rust to:node）
 */
export async function createG38FallbackBackend(opts: G38FallbackOptions): Promise<G38FallbackResult> {
  const load = opts.load ?? defaultLoader
  const fallbackTo: 'node' = opts.fallback ?? 'node'
  try {
    const preferred = await load(opts.preferred)
    if (preferred) {
      return { backend: preferred, fallback: null, isDegraded: false }
    }
    // loader 返回 null → 降级
    const log: G38FallbackLog = { from: opts.preferred, to: fallbackTo, reason: `preferred backend '${opts.preferred}' 不可用（未安装/未接入）` }
    opts.onFallback?.(log)
    return { backend: await load(fallbackTo) ?? createG38NodeBackend(), fallback: log, isDegraded: true }
  } catch (e) {
    // loader 抛错 → 降级（可观测 reason 含错误摘要）
    const log: G38FallbackLog = { from: opts.preferred, to: fallbackTo, reason: `preferred backend '${opts.preferred}' 加载失败：${(e as Error).message.slice(0, 120)}` }
    opts.onFallback?.(log)
    return { backend: createG38NodeBackend(), fallback: log, isDegraded: true }
  }
}
