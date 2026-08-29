// packages/plugin-vite/src/cache.ts
// ★build-plan M8：编译缓存 —— compileVueSfc 结果按「全入参哈希」缓存（铁律 #4：配置哈希 + 源码哈希 + 依赖哈希）
// 正确性：任一输入变化（源码/px2rpx/rpxRatio/rules/moduleImports/组件标记/debug/编译器版本）→ 键变化 → 自动失效
// 存储：磁盘 node_modules/.cache/proteus/compile/<key>.json + 进程内存 Map；debug 构建跳过缓存
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export interface CompileCacheEntry {
  wxml: string
  js: string
  wxss: string
  warnings: string[]
}

export interface CompileCacheStats {
  hits: number
  misses: number
}

/** 编译器版本（缓存键组成部分——编译器 dist 重建即全局失效） */
export function getCompilerVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(require.resolve('@proteus/compiler/package.json'), 'utf-8')) as { version: string }
    return pkg.version
  } catch {
    return 'unknown'
  }
}

/** 计算缓存键：sha1(源码 + 全编译入参 JSON + 编译器版本) */
export function compileCacheKey(
  source: string,
  options: {
    rel: string
    isComponent: boolean
    px2rpx: boolean
    rpxRatio: number
    rules?: Record<string, unknown>
    moduleImports?: Array<{ source: string; requirePath: string }>
    annotateLines: boolean
    debug: boolean
  },
): string {
  const h = crypto.createHash('sha1')
  h.update(source)
  h.update('|')
  h.update(JSON.stringify({ ...options, compilerVersion: getCompilerVersion() }))
  return h.digest('hex')
}

/** 编译缓存：磁盘 + 内存双层（root 为项目根，缓存目录 node_modules/.cache/proteus/compile/） */
export function createCompileCache(cacheDir: string): {
  get(key: string): CompileCacheEntry | null
  set(key: string, entry: CompileCacheEntry): void
  stats(): CompileCacheStats
} {
  fs.mkdirSync(cacheDir, { recursive: true })
  const memory = new Map<string, CompileCacheEntry>()
  let hits = 0
  let misses = 0

  return {
    get(key: string): CompileCacheEntry | null {
      const mem = memory.get(key)
      if (mem) {
        hits++
        return mem
      }
      const file = path.join(cacheDir, `${key}.json`)
      if (fs.existsSync(file)) {
        try {
          const entry = JSON.parse(fs.readFileSync(file, 'utf-8')) as CompileCacheEntry
          memory.set(key, entry)
          hits++
          return entry
        } catch {
          // 损坏缓存 → 视为未命中（下次编译覆盖）
        }
      }
      misses++
      return null
    },
    set(key: string, entry: CompileCacheEntry): void {
      memory.set(key, entry)
      try {
        fs.writeFileSync(path.join(cacheDir, `${key}.json`), JSON.stringify(entry))
      } catch {
        // 磁盘写失败不阻塞构建（缓存尽力而为）
      }
    },
    stats() {
      return { hits, misses }
    },
  }
}
