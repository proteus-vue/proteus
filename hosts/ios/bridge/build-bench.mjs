// hosts/ios/bridge/build-bench.mjs —— 自绘管线 bundle（Vue → 自绘适配器 → 宿主）
//
// 【与 build.mjs 的差别】
//   · build.mjs        → Vue → render-backend → NativeBackend（UIView 树，布局交 UIKit）
//   · 本文件            → Vue → **renderer-app 的 SelfDraw 适配器**（自绘：几何交 Rust 核心）
//   两者共用同一份 Vue 运行时与 alias 策略，避免构建方式分叉。
//
// 【产物】hosts/ios/bridge/dist/bundle-bench.js（被 selfdraw 场景拷进 .app）
//
// 用法：node hosts/ios/bridge/build-bench.mjs
import { build } from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const OUT = path.join(HERE, 'dist', 'bundle-bench.js')

// ★同 build.mjs：pnpm 布局下 @vue/runtime-core 需从声明它的包位置解析
const require_ = createRequire(path.join(ROOT, 'packages/renderer-app/package.json'))
const aliasRuntimeCore = path.dirname(require_.resolve('@vue/runtime-core/package.json'))

// ★@proteus-vue/renderer-app **不是根 package 的依赖** → 根 node_modules 下无 link，
//   esbuild 按 node resolution 找不到它。故显式 alias 到**已构建的 dist**
//   （与 build.mjs 对 @vue/runtime-core 的处理同款思路：不靠隐式解析，靠显式路径）。
//   ⇒ 前置条件：先跑 `pnpm --filter @proteus-vue/renderer-app run build`（本脚本会检查并提示）。
const APP_DIST = path.join(ROOT, 'packages/renderer-app/dist')
for (const f of ['index.js', 'adapters/selfdraw.js']) {
  if (!fs.existsSync(path.join(APP_DIST, f))) {
    console.error(`✗ 缺少 ${path.relative(ROOT, path.join(APP_DIST, f))} —— 先跑：pnpm --filter @proteus-vue/renderer-app run build`)
    process.exit(2)
  }
}

// ★V3：构建期生成订阅表（编译器不进 app——见 gen-vapor-table.mjs 顶注）
const { execFileSync } = await import('node:child_process')
execFileSync('node', [path.join(HERE, 'gen-vapor-table.mjs')], { cwd: ROOT, stdio: 'inherit' })

await build({
  entryPoints: [path.join(HERE, 'entry-bench.ts')],
  outfile: OUT,
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', __VUE_PROD_DEVTOOLS__: 'false' },
  alias: {
    '@vue/runtime-core': aliasRuntimeCore,
    // ★子路径**必须排在包名之前**（esbuild 按 alias 键顺序匹配前缀）
    '@proteus-vue/renderer-app/adapters/selfdraw': path.join(APP_DIST, 'adapters/selfdraw.js'),
    '@proteus-vue/renderer-app': path.join(APP_DIST, 'index.js'),
  },
  logLevel: 'info',
  absWorkingDir: ROOT,
})

const size = (fs.statSync(OUT).size / 1024).toFixed(1)
console.log(`[bridge] 逻辑层基准 bundle 产出：${path.relative(ROOT, OUT)} · ${size} KB`)
