// hosts/android/bridge/build-batch.mjs —— ★S3b：Android JS 引擎的 bundle 构建（真实适配器）
//
// 【产物】hosts/android/bridge/dist/bundle-batch.js（IIFE，供 QuickJS 直接 eval）
//
// 【为什么镜像 iOS 的 build-selfdraw.mjs】两端共用同一份 TS 源（render-backend），
//   构建方式不应分叉（本仓纪律：同一语义一处实现）。差别只在 entry 与产物去向：
//     · iOS：`entry-selfdraw.ts` → 拷进 .app（JSC 直接读文件 eval）
//     · Android：`entry-batch.ts`  → 打进 APK assets（Java 读 assets 后交给 QuickJS eval）
//
// 【为什么显式 alias 到 dist（而不是靠 node resolution）】
//   `@proteus-vue/render-backend` 不是**根** package 的依赖 ⇒ 根 node_modules 下可能无 link，
//   esbuild 按 node resolution 会找不到。⇒ 显式 alias 到**已构建的 dist**
//   （与 iOS 对 `@proteus-vue/renderer-app` 的处理同款：不靠隐式解析）。
//   ★前置：`node scripts/build-packages.mjs`（本脚本会检查并提示）。
//
// 用法：node hosts/android/bridge/build-batch.mjs
import { build } from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const OUT = path.join(HERE, 'dist', 'bundle-batch.js')

const RB_DIST = path.join(ROOT, 'packages/render-backend/dist')
if (!fs.existsSync(path.join(RB_DIST, 'index.js'))) {
  console.error(`✗ 缺少 ${path.relative(ROOT, path.join(RB_DIST, 'index.js'))} —— 先跑：node scripts/build-packages.mjs`)
  process.exit(2)
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })

const result = await build({
  entryPoints: [path.join(HERE, 'entry-batch.ts')],
  outfile: OUT,
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2020', // QuickJS 支持 ES2025，但保守取 es2020（与 iOS bundle 同档）
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
  alias: {
    '@proteus-vue/render-backend': path.join(RB_DIST, 'index.js'),
  },
  legalComments: 'none',
})

const bytes = fs.statSync(OUT).size
console.log(`[android-bundle] ✅ ${path.relative(ROOT, OUT)}（${(bytes / 1024).toFixed(1)} KB）`)
if (result.warnings.length) {
  for (const w of result.warnings) console.warn(`  ⚠ ${w.text}`)
}
