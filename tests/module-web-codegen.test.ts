// tests/module-web-codegen.test.ts
// ★module-plan B4（M4 Web 打包）：generateRollupOptions——模块图谱 → manualChunks（Web 端按模块边界 code-split）
import { describe, it, expect } from 'vitest'
import { DependencyGraph, generateRollupOptions } from '@proteus-vue/module'

function tradeGraph(): DependencyGraph {
  return DependencyGraph.fromConfigs([
    { name: 'trade', version: '1.0.0', chunk: 'trade', dependencies: { user: '^1.0.0' } },
    { name: 'user', version: '1.0.0', chunk: 'user' },
  ])
}

describe('generateRollupOptions（manualChunks）', () => {
  it('模块目录下文件 → 所属 chunk（目录 + 单文件两种形态）', () => {
    const { rollupOptions } = generateRollupOptions(tradeGraph())
    expect(rollupOptions.manualChunks('/src/modules/trade/OrderList.vue')).toBe('trade')
    expect(rollupOptions.manualChunks('/src/modules/trade/service.ts')).toBe('trade')
    expect(rollupOptions.manualChunks('/src/modules/user/Profile.vue')).toBe('user')
  })

  it('非模块目录 / 共享依赖 → undefined（Rollup 默认：vendor 提取）', () => {
    const { rollupOptions } = generateRollupOptions(tradeGraph())
    expect(rollupOptions.manualChunks('/node_modules/vue/index.js')).toBeUndefined()
    expect(rollupOptions.manualChunks('/src/pages/index.vue')).toBeUndefined()
    expect(rollupOptions.manualChunks('/src/modules/ghost/x.vue')).toBeUndefined()
  })

  it('自定义 modulesDir + 输出文件名模板', () => {
    const { rollupOptions } = generateRollupOptions(tradeGraph(), { modulesDir: 'features', chunkFileNames: 'chunks/[name].js', entryFileNames: 'entries/[name].js' })
    expect(rollupOptions.manualChunks('/src/features/trade/OrderList.vue')).toBe('trade')
    expect(rollupOptions.output.chunkFileNames).toBe('chunks/[name].js')
    expect(rollupOptions.output.entryFileNames).toBe('entries/[name].js')
  })
})
