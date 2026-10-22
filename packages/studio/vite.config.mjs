// packages/studio/vite.config.mjs
// ★ Studio 壳的构建配置（决策 #1183；2026-10-22 出门迁入 packages/studio，决策 #1187）
//
// 【为什么是 Vite + Vue 3，而不是继续手写单文件 HTML】
//   手写版的状态同步全靠人记（20 个字段散在 5 个区域），已经出过"漏改一处就显示假数据"的事故。
//
// 【为什么不用我们自己的框架（Proteus）编译这个壳】
//   自举死锁：Studio 是排查 Proteus 的工具，如果它的 UI 由 Proteus 运行时渲染，
//   Proteus 一旦有 bug，可能连打开调试器都做不到。**调试器不能依赖被调试对象的运行时。**
//   （Proteus 的正确位置见 README 的 L2/L3：被调试视图与自举试点。）
//
// 【为什么输出目录叫 web-dist 而不是 dist】
//   仓库根 .gitignore:5 有一条 `dist/` —— 我们已经被它坑过一次（手写 HTML 从没进库）。
//   构建产物该被忽略，所以换个不会被误伤的名字，语义也更清楚：这是 build output。

import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'

export default {
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  // Tauri 用自定义协议加载，相对路径最稳（绝对 /assets 在 tauri:// 下会 404）
  base: './',
  plugins: [vue()],
  build: {
    outDir: fileURLToPath(new URL('./web-dist', import.meta.url)),
    emptyOutDir: true,
    // file:// 或 tauri:// 下都不该依赖 modulepreload 的 polyfill
    modulePreload: false,
    target: 'safari16',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./ui/src', import.meta.url)) },
  },
  // 依赖从仓库根 node_modules 解析（本目录不装 node_modules，避免第二套依赖）
  cacheDir: fileURLToPath(new URL('./.vite', import.meta.url)),
  logLevel: 'info',
}
