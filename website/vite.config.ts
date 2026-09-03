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
  },
})
