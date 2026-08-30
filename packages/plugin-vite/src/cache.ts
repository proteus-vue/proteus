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
    const pkg = JSON.parse(fs.readFileSync(require.resolve('@proteus-vue/compiler/package.json'), 'utf-8')) as { version: string }
    return pkg.version
  } catch {
    return 'unknown'
  }
}

/** esbuild 版本（bundle 缓存键组成部分） */
export function getEsbuildVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(require.resolve('esbuild/package.json'), 'utf-8')) as { version: string }
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

// ============ 共享模块 esbuild bundle 缓存（M8 第二批） ============

/** 输入文件快照（mtime+size 指纹，对齐 webpack/babel-loader 持久化缓存实践） */
export interface BundleInputSnapshot {
  file: string
  mtimeMs: number
  size: number
}

export interface BundleCacheEntry {
  output: string
  inputs: BundleInputSnapshot[]
}

/** bundle 缓存键：sha1(入口文件 + esbuild 版本 + 构建选项) */
export function bundleCacheKey(entryFile: string): string {
  const h = crypto.createHash('sha1')
  h.update(entryFile)
  h.update('|')
  h.update(
    JSON.stringify({
      esbuild: getEsbuildVersion(),
      target: 'es2018',
      format: 'cjs',
      charset: 'utf8',
      minify: true,
      external: ['@proteus-vue/*'],
    }),
  )
  return h.digest('hex')
}

/** 校验输入快照仍有效（文件存在 + mtime/size 未变 → 可复用） */
function inputsValid(inputs: BundleInputSnapshot[]): boolean {
  for (let i = 0; i < inputs.length; i++) {
    try {
      const st = fs.statSync(inputs[i].file)
      if (st.mtimeMs !== inputs[i].mtimeMs || st.size !== inputs[i].size) return false
    } catch {
      return false
    }
  }
  return true
}

/**
 * esbuild bundle 缓存：磁盘 + 内存双层
 * 键 = sha1(入口文件 + esbuild 版本 + 构建选项)；命中需输入快照全部有效（mtime+size 一致）
 * 注意：首次构建需 metafile 记录输入集（第一次必然未命中，后续命中）
 */
export function createBundleCache(cacheDir: string): {
  get(key: string): BundleCacheEntry | null
  set(key: string, entry: BundleCacheEntry): void
  stats(): CompileCacheStats
} {
  fs.mkdirSync(cacheDir, { recursive: true })
  const memory = new Map<string, BundleCacheEntry>()
  let hits = 0
  let misses = 0

  return {
    get(key: string): BundleCacheEntry | null {
      const mem = memory.get(key)
      if (mem && inputsValid(mem.inputs)) {
        hits++
        return mem
      }
      const file = path.join(cacheDir, `${key}.json`)
      if (fs.existsSync(file)) {
        try {
          const entry = JSON.parse(fs.readFileSync(file, 'utf-8')) as BundleCacheEntry
          if (inputsValid(entry.inputs)) {
            memory.set(key, entry)
            hits++
            return entry
          }
        } catch {
          // 损坏/失效缓存 → 未命中
        }
      }
      misses++
      return null
    },
    set(key: string, entry: BundleCacheEntry): void {
      memory.set(key, entry)
      try {
        fs.writeFileSync(path.join(cacheDir, `${key}.json`), JSON.stringify(entry))
      } catch {
        // 尽力而为
      }
    },
    stats() {
      return { hits, misses }
    },
  }
}
