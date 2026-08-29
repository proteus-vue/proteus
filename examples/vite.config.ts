// examples/vite.config.ts —— Proteus 示例工程 Vite 配置（完整工程形态，自包含）
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import config from './proteus.config'
import { mpTransform } from '@proteus/plugin-vite'

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

export default defineConfig(({ mode }) => {
  const platform = mode === 'mp-weixin' || mode === 'web' ? mode : config.platform
  const isMp = platform === 'mp-weixin'

  return {
    define: {
      __PROTEUS_DEBUG__: process.env.PROTEUS_DEBUG === '1',
      // Skyline 开关注入：mp 构建时 __PROTEUS_SKYLINE__ = config.skyline（router/skyline 解耦 config）
      __PROTEUS_SKYLINE__: isMp && config.skyline,
    },
    plugins: isMp
      ? [
          // 小程序端：独占编译管线（不用 plugin-vue），标准 Vue SFC → wxml/wxss/js
          mpTransform({ config }),
        ]
      : [vue(), routeBlocksPlugin()],
    resolve: {
      alias: [
        // ★真实 npm 包使用方式（决策 #115）：@proteus/{router,runtime,shared,plugin-vite} 走 workspace 链接的
        //   npm 包 dist（与 create-proteus 生成工程一致）；仅 @proteus/components 保留 alias（组件库未拆包，v2.0 方向）
        { find: '@proteus/components', replacement: fileURLToPath(new URL('../src/components', import.meta.url)) },
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
        : undefined,
    },
  }
})
