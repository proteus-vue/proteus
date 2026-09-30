// hosts/ios/bridge/build-host-runtime.mjs —— ★★G-39：iOS 宿主运行时 bundle（JSC 直接 evaluate）
//
// 【与 Android 的关系（同一份 TS、两个打包器）】
//   入口是 `hosts/shared/bridge/entry-host-runtime.ts`（**平台中立**：读壳注入的
//   `__PROTEUS_HOST_ID__`/`__PROTEUS_HOST_FRAME_DRIVER__`；内存/GC 走各自宿主桥）。
//   ⇒ 两端打出来的**语义**必须一致（判据脚本同款；内存口径在报告里以 scope 显式分档）。
//
// 【产物】hosts/ios/bridge/dist/bundle-host-runtime.js（被 .app 打包，JSC evaluateScript）
//
// 用法：node hosts/ios/bridge/build-host-runtime.mjs
import { build } from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const OUT = path.join(HERE, 'dist', 'bundle-host-runtime.js')
const ENTRY = path.join(ROOT, 'hosts/shared/bridge/entry-host-runtime.ts')

if (!fs.existsSync(ENTRY)) {
  console.error(`✗ 缺共享入口：${path.relative(ROOT, ENTRY)}（Android/iOS 共用——被误删？）`)
  process.exit(2)
}

await build({
  entryPoints: [ENTRY],
  outfile: OUT,
  bundle: true,
  format: 'iife', // JSC 无模块系统（与其它 iOS bundle 同款）
  platform: 'neutral',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
  alias: {
    // ★与 Android 侧同一策略：alias 指向 **src**（消除"忘了重建 dist ⇒ 测旧代码"陷阱）
    '@proteus-vue/render-backend/quickjs-host': path.join(ROOT, 'packages/render-backend/src/quickjs-host.ts'),
    '@proteus-vue/render-backend/host-conformance': path.join(ROOT, 'packages/render-backend/src/host-conformance.ts'),
    '@proteus-vue/component-ir': path.join(ROOT, 'packages/component-ir/dist/index.js'),
  },
  logLevel: 'warning',
  absWorkingDir: ROOT,
})

const size = (fs.statSync(OUT).size / 1024).toFixed(1)
console.log(`[bridge] 宿主运行时 bundle 产出：${path.relative(ROOT, OUT)} · ${size} KB`)
