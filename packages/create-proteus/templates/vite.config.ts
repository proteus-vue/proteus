// vite.config.ts —— Proteus 工程骨架（模板默认值）
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import config from './proteus.config'
import mpTransform from './vite-plugin-mp-transform'

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
    },
    plugins: isMp
      ? [
          // 小程序端：独占编译管线（不用 plugin-vue），标准 Vue SFC → wxml/wxss/js
          // ★拆包步骤 5：插件不再读项目 config，由 vite.config 注入（config 解耦）
          mpTransform({ config }),
        ]
      : [vue(), routeBlocksPlugin()],
    resolve: {
      alias: [
        // 业务代码通过 @proteus/... 访问框架本体（src/ 内）
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
        { find: '@proteus', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
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
