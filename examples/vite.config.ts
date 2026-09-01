// examples/vite.config.ts —— Proteus 示例工程 Vite 配置（完整工程形态，自包含）
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import config from './proteus.config'
import { mpTransform, defaultScopedPlugin, devtoolsRelayPlugin } from '@proteus-vue/plugin-vite'
// ★module-plan B4：模块图谱 → Web manualChunks（有 modules/ 目录时自动生效）
import { scanModuleConfigs, DependencyGraph, generateRollupOptions } from '@proteus-vue/module'

/** 处理 <route> 自定义块虚拟模块（?vue&type=route），保证 Web 构建不报错 */
function routeBlocksPlugin(): Plugin {
  return {
    name: 'proteus-route-blocks',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('?vue&type=route')) {
        return { code: `export default ${code}`, map: null }
      }
      return null
    },
  }
}

export default defineConfig(async ({ mode, command }) => {
  const platform = mode === 'mp-weixin' || mode === 'web' ? mode : config.platform
  const isMp = platform === 'mp-weixin'
  // ★module-plan B4：扫描模块契约 → 依赖图 → Web manualChunks（module 目录下文件按 chunk 分组；无模块时为空配置零副作用）
  const scan = await scanModuleConfigs(path.resolve(__dirname))
  const graph = DependencyGraph.fromConfigs(
    scan.modules.filter((m) => m.ok && m.name).map((m) => ({ name: m.name!, version: m.version ?? '0.0.0', chunk: m.chunk, dependencies: m.dependencies })),
  )
  const webRollup = isMp ? {} : generateRollupOptions(graph).rollupOptions

  return {
    define: {
      // ★devtools 打通：dev serve 默认开启可观测（TraceBus/guard/面板有数据）；
      //   build 默认关闭零开销；PROTEUS_DEBUG=1 可强制生产调试（灰度排查）
      __PROTEUS_DEBUG__: command === 'serve' || process.env.PROTEUS_DEBUG === '1',
      // Skyline 开关注入：mp 构建时 __PROTEUS_SKYLINE__ = config.skyline（router/skyline 解耦 config）
      __PROTEUS_SKYLINE__: isMp && config.skyline,
    },
    plugins: isMp
      ? [
          // 小程序端：独占编译管线（不用 plugin-vue），标准 Vue SFC → wxml/wxss/js
          // ★框架内置组件目录显式传入（组件库未拆包，决策 #115）：与下方 @proteus-vue/components alias 同一路径
          mpTransform({
            config,
            frameworkComponentsDir: fileURLToPath(new URL('../src/components', import.meta.url)),
          }),
        ]
      : [defaultScopedPlugin(), vue(), routeBlocksPlugin(), devtoolsRelayPlugin()],
    resolve: {
      alias: [
        // ★真实 npm 包使用方式（决策 #115）：@proteus-vue/{router,runtime,shared,plugin-vite} 走 workspace 链接的
        //   npm 包 dist（与 create-proteus 生成工程一致）；仅 @proteus-vue/components 保留 alias（组件库未拆包，v2.0 方向）
        { find: '@proteus-vue/components', replacement: fileURLToPath(new URL('../src/components', import.meta.url)) },
      ],
    },
    build: {
      target: 'es2018',
      cssCodeSplit: false,
      minify: isMp ? false : undefined,
      outDir: `dist/${platform}`,
      emptyOutDir: !isMp,
      rollupOptions: isMp
        ? { input: 'scripts/mp-entry-stub.ts', output: { entryFileNames: 'mp-entry.js' } }
        : (webRollup as Record<string, unknown>),
    },
  }
})
