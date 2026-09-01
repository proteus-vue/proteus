// vite.config.ts —— Proteus 工程骨架（拆包步骤 7：插件来自 @proteus-vue/plugin-vite npm 包）
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import config from './proteus.config'
import { mpTransform } from '@proteus-vue/plugin-vite'

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

export default defineConfig(({ mode, command }) => {
  const platform = mode === 'mp-weixin' || mode === 'web' ? mode : config.platform
  const isMp = platform === 'mp-weixin'

  return {
    define: {
      // ★devtools 打通：dev serve 默认开启可观测（TraceBus/面板有数据）；
      //   build 默认关闭零开销；PROTEUS_DEBUG=1 可强制生产调试
      __PROTEUS_DEBUG__: command === 'serve' || process.env.PROTEUS_DEBUG === '1',
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
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
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
