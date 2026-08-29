// vite.config.ts
// Proteus 工程骨架 —— P4 阶段在此注入 vite-plugin-mp-transform（仅 mp-weixin mode）
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import config from './proteus.config'
import mpTransform from './vite-plugin-mp-transform'

/**
 * 处理 <route> 自定义块虚拟模块（?vue&type=route）
 * plugin-vue 会将 SFC 自定义块提取为独立虚拟模块，其原始内容是 JSON，
 * 需包装为合法 JS 模块。真正消费 <route> 块的是编译期 gen-routes.ts
 * （直接读源文件），此处仅保证构建不报错、运行时为无害 no-op。
 */
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
  // mode 为显式传入的 web / mp-weixin 时优先，否则回退到 proteus.config.ts 的 platform
  const platform = mode === 'mp-weixin' || mode === 'web' ? mode : config.platform
  const isMp = platform === 'mp-weixin'

  return {
    // 调试开关注入：PROTEUS_DEBUG=1 构建时 __PROTEUS_DEBUG__ = true（runtime/debug 与页面日志共用）
    // Skyline 开关注入：mp 构建时 __PROTEUS_SKYLINE__ = config.skyline（router/skyline 解耦 config，拆包步骤 1）
    define: {
      __PROTEUS_DEBUG__: process.env.PROTEUS_DEBUG === '1',
      __PROTEUS_SKYLINE__: isMp && config.skyline,
    },
    plugins: isMp
      ? [
          // 小程序端：独占编译管线（不用 plugin-vue），标准 Vue SFC → wxml/wxss/js
          mpTransform({ px2rpx: config.style.px2rpx, rpxRatio: config.style.rpxRatio }),
        ]
      : [vue(), routeBlocksPlugin()],
    resolve: {
      alias: [
        // @proteus/* 精确映射（拆包步骤 2：shared 包）；@proteus/compiler 优先
        { find: '@proteus/compiler', replacement: fileURLToPath(new URL('./packages/compiler/src/index.ts', import.meta.url)) },
        { find: '@proteus/shared', replacement: fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)) },
        { find: '@proteus/runtime', replacement: fileURLToPath(new URL('./packages/runtime/src/index.ts', import.meta.url)) },
        // router 指向包目录：'@proteus/router' 裸导入 → src/index.ts（目录索引），子路径 '@proteus/router/types' → src/types（前缀匹配）
        { find: '@proteus/router', replacement: fileURLToPath(new URL('./packages/router/src', import.meta.url)) },
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
        // 其余 @proteus/* 暂指向 src/（runtime/router 等拆包后逐一精确化）
        { find: '@proteus', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      ],
    },
    build: {
      // 小程序兼容目标 + 单文件样式（小程序无按需 CSS）
      target: 'es2018',
      cssCodeSplit: false,
      // 反黑盒：mp 产物不压缩，保持可读可调试（页面 wxml/js/wxss 本就由插件明文输出）
      minify: isMp ? false : undefined,
      outDir: `dist/${platform}`,
      // mp 模式保留 gen-routes 生成的 app.json / page.json（P4 阶段细化产物管线）
      emptyOutDir: !isMp,
      // 小程序端入口为占位 stub：真实 app.js 由 mp-transform 插件 buildStart 直出为纯文本资产
      // （绕开 rollup 打包——微信 worklet 响应式重执行对打包代码不友好，见 examples/main.mp.ts 注释）
      rollupOptions: isMp
        ? { input: 'scripts/mp-entry-stub.ts', output: { entryFileNames: 'mp-entry.js' } }
        : undefined,
    },
  }
})
