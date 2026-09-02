// packages/compiler-backend/src/g38-session.ts
// ★G-38（compiler-backend-spi-plan 01 §5/04-incremental-compilation.md）真 IncrementalSession（决策 #336）
//   ——Node 参考从 noop 升级为真实现（G-38 B3 前置：增量语义先在参考实现定形，Rust/WASM 后端照抄）：
//   依赖图（file → imports deps + 反向索引 dependents）+ 签名缓存（hash(内容|版本)——命中跳过 parse+transform，
//   01 §5.3 cacheKey 语义）+ invalidate → recompute 仅重算脏文件及其反向依赖（affectedFiles）+
//   commit（内存快照固化）/ rollback（丢弃 recompute 后未提交变更回滚到上次 commit 点）+ getStats（缓存命中率可观测 C-10-02）
//   宿主驱动：track(file, content, deps?) 注册已知文件（首次全量构建循环）；getContent 注入式可单测
import { g38Hash } from './g38'
import type { G38CompilerBackend, G38IRModuleDiff, G38IncrementalSession, G38SourceFile } from './g38'

export interface G38SessionOptions {
  /** 会话 id（缺省 'incr'） */
  id?: string
  /** 内容提供者（recompute 重算脏文件时取内容；缺省 → 用 track 注入的内容） */
  getContent?: (file: string) => string | null
}

interface TrackedFile {
  signature: string
  content: string
  deps: string[]
  moduleHash: string | null
}

/** ★createG38IncrementalSession：真增量会话（依赖图 + 签名缓存 + 局部重算 + commit/rollback 快照） */
export function createG38IncrementalSession(
  backend: G38CompilerBackend,
  cacheDir: string,
  opts: G38SessionOptions = {},
): G38IncrementalSession {
  void cacheDir // 快照持久化（磁盘）属后续——commit/rollback 以内存快照语义先行
  const sessionId = opts.id ?? 'incr'
  /** 已跟踪文件（首次全量 track 建立依赖图） */
  const tracked = new Map<string, TrackedFile>()
  /** 反向依赖索引：dep 文件 → 依赖它的文件（affectedFiles 闭包用） */
  const dependents = new Map<string, Set<string>>()
  /** 脏集合（invalidate 标记 → recompute 重算） */
  const invalidated = new Set<string>()
  /** commit 点快照（rollback 恢复） */
  let committed: { tracked: Map<string, TrackedFile>; dependents: Map<string, Set<string>> } | null = null
  let cacheHits = 0
  let recomputes = 0

  const regDeps = (file: string, deps: string[]): void => {
    for (const d of deps) {
      if (!dependents.has(d)) dependents.set(d, new Set())
      dependents.get(d)!.add(file)
    }
  }

  /** track 内部实现（recompute 互调不走 session.track?.()——避免可选调用） */
  const trackFile = (file: string, content: string, deps: string[] = []): void => {
    const sig = g38Hash(`${content}|${backend.version}`)
    const prev = tracked.get(file)
    if (prev && prev.signature === sig) {
      cacheHits++
      return // 01 §5.3：签名命中 → 跳过 parse + transform（复用上次 moduleHash）
    }
    recomputes++
    const ast = backend.parse({ content, path: file })
    const moduleHash = ast.diagnostics?.length ? null : g38Hash(JSON.stringify(backend.transform(ast)))
    // 依赖图更新（旧 deps 反索引清理后重挂）
    if (prev) {
      for (const d of prev.deps) {
        const set = dependents.get(d)
        if (set) {
          set.delete(file)
          if (!set.size) dependents.delete(d)
        }
      }
    }
    tracked.set(file, { signature: sig, content, deps, moduleHash })
    regDeps(file, deps)
    invalidated.delete(file)
  }

  const session: G38IncrementalSession = {
    id: sessionId,

    /** ★宿主驱动：注册文件内容 + 依赖（首次全量构建逐文件调用；同签名 → 缓存命中跳过重算） */
    track: trackFile,

    invalidate(file: string): void {
      invalidated.add(file)
    },

    invalidateAll(): void {
      for (const f of tracked.keys()) invalidated.add(f)
    },

    /** ★局部重算：脏文件（+ 反向依赖闭包）re-track——无内容提供者时用已 track 内容比对签名 */
    recompute(): G38IRModuleDiff {
      const changed: string[] = []
      const removed: string[] = []
      const added: string[] = []
      const affected = new Set<string>()
      // 脏文件（+首次全量：tracked 空且无脏 → 空 diff——宿主以 track 驱动）
      const dirty = invalidated.size ? [...invalidated] : []
      for (const file of dirty) {
        let content = tracked.get(file)?.content ?? null
        if (opts.getContent) {
          content = opts.getContent(file)
          if (content == null) {
            // 内容消失 → removed
            removed.push(file)
            tracked.delete(file)
            continue
          }
        }
        if (content == null) continue // 无内容来源（未 track + 无 provider）——跳过
        const sig = g38Hash(`${content}|${backend.version}`)
        const prev = tracked.get(file)
        if (prev && prev.signature === sig) {
          cacheHits++
          invalidated.delete(file)
          continue // 内容未变 → 签名命中
        }
        trackFile(file, content, prev?.deps ?? [])
        changed.push(file)
        affected.add(file)
        // 反向依赖闭包（依赖了 dirty 文件者也可能受影响——其模块 hash 引用旧依赖产物）
        const visitDependents = (f: string): void => {
          const set = dependents.get(f)
          if (!set) return
          for (const dep of set) {
            if (!affected.has(dep)) {
              affected.add(dep)
              changed.push(dep)
              visitDependents(dep)
            }
          }
        }
        visitDependents(file)
      }
      invalidated.clear()
      return { changed, removed, added, affectedFiles: [...affected] }
    },

    getDependencies(file: string): string[] {
      return [...(tracked.get(file)?.deps ?? [])]
    },

    getDependents(file: string): string[] {
      return [...(dependents.get(file) ?? [])]
    },

    commit(): void {
      // 固化当前依赖图 + 签名（快照供 rollback 恢复——磁盘持久化属后续批次）
      committed = {
        tracked: new Map(tracked),
        dependents: new Map([...dependents].map(([k, v]) => [k, new Set(v)])),
      }
    },

    rollback(): void {
      // 丢弃 commit 后发生的变更 → 恢复上次 commit 点（未 commit 过 → 清空增量态）
      if (committed) {
        tracked.clear()
        dependents.clear()
        for (const [f, t] of committed.tracked) tracked.set(f, { ...t, deps: [...t.deps] })
        for (const [d, set] of committed.dependents) dependents.set(d, new Set(set))
      } else {
        tracked.clear()
        dependents.clear()
      }
      invalidated.clear()
    },

    getStats(): Record<string, unknown> {
      return { incremental: true, mode: 'tracking', files: tracked.size, cacheHits, recomputes, hitRate: tracked.size ? Number(((cacheHits / (cacheHits + recomputes)) * 100).toFixed(1)) : 0 }
    },

    dispose(): void {
      tracked.clear()
      dependents.clear()
      invalidated.clear()
    },
  }
  return session
}

/** 便捷：解析 SFC script 块 import 依赖（相对/包裸名——module-plan B0 同款正则；模板无 import → []） */
export function scanSfcImports(source: string): string[] {
  const script = source.includes('<script') ? (source.match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? '') : source
  const out: string[] = []
  for (const m of script.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    if (m[1] && !m[1].startsWith('@proteus-vue/types')) out.push(m[1])
  }
  return out
}
