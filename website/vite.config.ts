import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
// ★官网 B2（决策 #374）：内容即数据——md 由 @proteus-vue/docs 引擎构建期编译为组件
//   （frontmatter/title/html/toc 构建期产出，运行时零解析——文档也是编译产物）
import { docsMdPlugin } from '@proteus-vue/docs/vite'

export default defineConfig({
  plugins: [
    vue(),
    docsMdPlugin(),
  ],
  resolve: {
    alias: [
      // ★dogfooding：p-* 内置组件 + installFluidLayout 沿用框架组件库源（与 examples 同一约定）
      { find: '@proteus-vue/components', replacement: fileURLToPath(new URL('../src/components', import.meta.url)) },
    ],
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      // ★#389i 多页入口：spirit.html = Three.js 3D 海神精灵（iframe 嵌入——three 隔离在独立 chunk，不进主应用）
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        spirit: fileURLToPath(new URL('./spirit.html', import.meta.url)),
      },
      output: {
        // ★拆包：@vue/compiler-sfc（Playground 编译内核 ~500KB）独立 chunk——首屏不拉
        manualChunks(id: string) {
          if (id.includes('@vue/compiler-sfc') || id.includes('@vue/compiler-dom') || id.includes('@vue/compiler-core')) return 'compiler-sfc'
          // ★three.js 隔离在精灵 chunk（iframe 专用——主应用 bundle 零增量）
          if (id.includes('node_modules/three')) return 'spirit-three'
        },
      },
    },
  },
})
