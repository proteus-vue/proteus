// hosts/ios/bridge/build-v0-probe.mjs —— V0 探针（桌面 JSC 通道）的 bundle
//
// 与 build-bench.mjs 同款 alias 策略（复用同一份 Vue 运行时与 renderer-app dist），
// 差别只在入口与产物名：产物被 `jsc` 直接执行（见入口文件的用法说明）。
import { build } from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const OUT = path.join(HERE, 'dist', 'bundle-v0-probe.js')

const require_ = createRequire(path.join(ROOT, 'packages/renderer-app/package.json'))
const aliasRuntimeCore = path.dirname(require_.resolve('@vue/runtime-core/package.json'))

const APP_DIST = path.join(ROOT, 'packages/renderer-app/dist')
for (const f of ['index.js', 'adapters/selfdraw.js']) {
  if (!fs.existsSync(path.join(APP_DIST, f))) {
    console.error(`✗ 缺少 ${path.relative(ROOT, path.join(APP_DIST, f))} —— 先跑：pnpm --filter @proteus-vue/renderer-app run build`)
    process.exit(2)
  }
}

await build({
  entryPoints: [path.join(HERE, 'entry-v0-probe.ts')],
  outfile: OUT,
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', __VUE_PROD_DEVTOOLS__: 'false' },
  alias: {
    '@vue/runtime-core': aliasRuntimeCore,
    '@proteus-vue/renderer-app/adapters/selfdraw': path.join(APP_DIST, 'adapters/selfdraw.js'),
    '@proteus-vue/renderer-app': path.join(APP_DIST, 'index.js'),
  },
  logLevel: 'warning',
  absWorkingDir: ROOT,
})

const size = (fs.statSync(OUT).size / 1024).toFixed(1)
console.log(`[bridge] V0 探针 bundle 产出：${path.relative(ROOT, OUT)} · ${size} KB`)
