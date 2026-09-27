// hosts/ios/bridge/build.mjs —— 把 JS 入口打成 JSC 可加载的单文件 IIFE
//
// 【为什么需要】：iOS 的 JavaScriptCore **没有模块加载器**（无 import/require/动态加载）——
//   必须把 Vue 运行时 + render-backend + 本入口预先打成一份自包含脚本，用 evaluateScript 执行。
// 【为什么 esbuild】：仓库已在用（build-packages.mjs 同款），零新依赖。
// 【产物】：hosts/ios/bridge/dist/bundle.js —— 被 build.sh 拷进 .app 包内。
//
// 用法：node hosts/ios/bridge/build.mjs
import { build } from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const OUT = path.join(HERE, 'dist', 'bundle.js')
// ★pnpm 布局：@vue/runtime-core 是 vue 的传递依赖，根 node_modules 无顶层链接
//   → 用 require.resolve 解析真实路径做 esbuild alias（不要 external——JSC 无模块加载器）
// （从 render-backend 包位置解析——它把 @vue/runtime-core 声明为 peerDependencies，pnpm 才会链接）
const require_ = createRequire(path.join(ROOT, 'packages/render-backend/package.json'))
const aliasRuntimeCore = path.dirname(require_.resolve('@vue/runtime-core/package.json'))

await build({
  entryPoints: [path.join(HERE, 'entry.ts')],
  outfile: OUT,
  bundle: true,
  format: 'iife',            // JSC 无模块系统
  platform: 'neutral',        // 非 Node、非浏览器（无 process/window 假设）
  target: 'es2020',           // JavaScriptCore（iOS 15+）稳妥档
  // Vue 的 prod 分支（避免 process.env.NODE_ENV 在 JSC 不存在：
  // esbuild 会把 process.env.NODE_ENV 常量折叠掉，production 下不产生运行时引用）
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', __VUE_PROD_DEVTOOLS__: 'false' },
  // Vue 的 feature flags（不 define 会在运行时报 undefined 引用）
  alias: { '@vue/runtime-core': aliasRuntimeCore },
  logLevel: 'info',
  absWorkingDir: ROOT,
})

const size = (fs.statSync(OUT).size / 1024).toFixed(1)
console.log(`[bridge] bundle 产出：${path.relative(ROOT, OUT)} · ${size} KB`)
