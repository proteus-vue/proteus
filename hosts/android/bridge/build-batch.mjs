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

// ★★类型检查（**esbuild 不做类型检查**——本仓实测踩到，2026-09-29）
//
// 【为什么必须放在构建路径上（一次真实的漏网）】esbuild 只**擦除**类型，不校验：
//   本入口曾有一个 `Expected 2 arguments, but got 0` 的错误，esbuild 一路绿灯出了 bundle，
//   直到真机跑到那一行才炸。而 `hosts/**` **不在根 tsconfig 的 include 里**
//   ⇒ 全仓没有任何门禁覆盖它（`npx vue-tsc --noEmit` 看不到这些文件）。
//   ⇒ 把类型检查**接进构建路径**——否则 clone 后这一步静默缺失（本仓纪律：
//     「生成物/检查必须在构建路径上」）。
//   ★本门禁已声明为 LOCAL_ONLY（需完整 node_modules 才能解析 workspace 路径，CI 不装）。
// 跳过方式（仅在明知故犯时用）：PROTEUS_SKIP_BRIDGE_TSC=1 node hosts/android/bridge/build-batch.mjs
if (process.env.PROTEUS_SKIP_BRIDGE_TSC !== '1') {
  const { spawnSync } = await import('node:child_process')
  const tsc = spawnSync('npx', ['tsc', '--noEmit', '-p', path.join(HERE, 'tsconfig.bridge.json')], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  const out = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`
  if (tsc.status !== 0) {
    console.error('✗ 桥接入口**类型检查**失败（esbuild 不会替你做这件事）：')
    console.error(out.trim().split('\n').slice(0, 20).join('\n'))
    process.exit(3)
  }
  console.log('[android-bundle] ✅ 类型检查通过（tsconfig.bridge.json）')
}

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
