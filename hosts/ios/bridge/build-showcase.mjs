// hosts/ios/bridge/build-showcase.mjs —— ★★Morpheus 炫技场 bundle（iOS）
//
// 【入口】`hosts/shared/bridge/entry-showcase.ts`（平台中立：只走 proteusSelfDraw 桥）
// 【产物】hosts/ios/bridge/dist/bundle-showcase.js（被 .app 打包，JSC evaluateScript）
// 用法：node hosts/ios/bridge/build-showcase.mjs
import { build } from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const OUT = path.join(HERE, 'dist', 'bundle-showcase.js')
const ENTRY = path.join(ROOT, 'hosts/shared/bridge/entry-showcase.ts')

if (!fs.existsSync(ENTRY)) {
  console.error(`✗ 缺入口：${path.relative(ROOT, ENTRY)}`)
  process.exit(2)
}

await build({
  entryPoints: [ENTRY],
  outfile: OUT,
  bundle: true,
  format: 'iife',       // JSC 无模块系统
  platform: 'neutral',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
  alias: {
    // ★与其它入口同策略：alias 指向 **src**（消除"忘了重建 dist ⇒ 测旧代码"陷阱）
    '@proteus-vue/animation': path.join(ROOT, 'packages/animation/src/index.ts'),
    '@proteus-vue/contracts': path.join(ROOT, 'packages/contracts/src/index.ts'),
    '@proteus-vue/slot-runtime': path.join(ROOT, 'packages/slot-runtime/src/index.ts'),
  },
  logLevel: 'warning',
  absWorkingDir: ROOT,
})

const size = (fs.statSync(OUT).size / 1024).toFixed(1)
console.log(`[bridge] showcase bundle 产出：${path.relative(ROOT, OUT)} · ${size} KB`)
