// packages/module/src/web-codegen.ts
// ★module-plan B4（M4 Web 打包）：模块图谱 → Rollup manualChunks（Web 端按模块边界 code-split）
// 映射：chunk 分组（B3）→ manualChunks（id 匹配 <modulesDir>/<moduleName>/）；共享依赖（vue/pinia）由 Rollup 自动提取 vendor
import type { DependencyGraph } from './graph'

export interface WebCodegenOptions {
  /** 模块源码目录（默认 'modules'，匹配 <dir>/<moduleName>/ 或 <dir>/<moduleName>.<ext>） */
  modulesDir?: string
  /** 产物 chunk 文件名模板 */
  chunkFileNames?: string
  entryFileNames?: string
}

/**
 * 生成 Rollup 配置（模块边界 code-split）：
 * - manualChunks：模块目录下文件 → 所属 chunk（chunk 分组来自 B3 DependencyGraph.chunkGroups）
 * - 输出文件名模板（可读 chunk 名 + hash）
 * - 不匹配任何模块的 id → undefined（Rollup 默认行为；vue/pinia 等共享依赖自动提取 vendor chunk）
 */
export function generateRollupOptions(g: DependencyGraph, opts: WebCodegenOptions = {}): { rollupOptions: { manualChunks: (id: string) => string | undefined; output: { chunkFileNames: string; entryFileNames: string } } } {
  const modulesDir = opts.modulesDir ?? 'modules'
  const chunkFileNames = opts.chunkFileNames ?? 'assets/js/[name]-[hash].js'
  const entryFileNames = opts.entryFileNames ?? 'assets/js/[name]-[hash].js'
  const groups = g.chunkGroups()
  return {
    rollupOptions: {
      manualChunks(id: string) {
        for (const [chunk, names] of groups) {
          for (const n of names) {
            if (id.includes(`/${modulesDir}/${n}/`) || id.includes(`/${modulesDir}/${n}.`)) return chunk
          }
        }
        return undefined
      },
      output: { chunkFileNames, entryFileNames },
    },
  }
}
