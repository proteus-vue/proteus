// hosts/ios/bridge/build-app-stack.mjs —— ★★M5 执行器场景（iOS 腿）bundle
//
// 【与 Android 的关系（同一份 TS、两个打包器）】
//   入口是 `hosts/shared/bridge/entry-app-stack.ts`（**平台中立**——2026-09-30 从 android 目录
//   提到 shared：两个壳共用一份，与 entry-host-runtime 同法）。
//   ⇒ 两端打出来的**语义**必须一致（同一判据脚本 check-app-stack.py 的两组读数对读）。
//
// 【产物】hosts/ios/bridge/dist/bundle-app-stack.js（被 .app 打包，JSC evaluateScript）
//
// 用法：node hosts/ios/bridge/build-app-stack.mjs
import { build } from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const OUT = path.join(HERE, 'dist', 'bundle-app-stack.js')
const ENTRY = path.join(ROOT, 'hosts/shared/bridge/entry-app-stack.ts')

if (!fs.existsSync(ENTRY)) {
  console.error(`✗ 缺共享入口：${path.relative(ROOT, ENTRY)}（Android/iOS 共用——被误删？）`)
  process.exit(2)
}

// ★★★阶段 1b（B5 · 2026-10-04）：先刷新 **SFC 产物 → 屏内容**（入口 import 它；与 Android 同源一份）。
{
  const { execFileSync } = await import('node:child_process')
  try {
    execFileSync('npx', ['tsx', path.join(ROOT, 'hosts/shared/bridge/gen-app-screen-content.mjs')], { cwd: ROOT, stdio: 'inherit' })
  } catch (e) {
    console.error(`✗ 生成 app-screen-content 失败（B5）：${String(e)}`)
    process.exit(3)
  }
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
    '@proteus-vue/router/app-stack': path.join(ROOT, 'packages/router/src/app-stack.ts'),
    '@proteus-vue/router/codegen': path.join(ROOT, 'packages/router/src/codegen/index.ts'),
    // ★★场景 F（2026-10-02 App 端路由收口）：统一 API 两个入口（同样 alias 到 src）
    '@proteus-vue/router/app-route': path.join(ROOT, 'packages/router/src/app-route.ts'),
    '@proteus-vue/render-backend/app-navigation': path.join(ROOT, 'packages/render-backend/src/app-navigation.ts'),
    '@proteus-vue/router/types': path.join(ROOT, 'packages/router/src/types.ts'),
    '@proteus-vue/animation': path.join(ROOT, 'packages/animation/src/index.ts'),
    '@proteus-vue/contracts': path.join(ROOT, 'packages/contracts/src/index.ts'),
  },
  logLevel: 'warning',
  absWorkingDir: ROOT,
})

const size = (fs.statSync(OUT).size / 1024).toFixed(1)
console.log(`[bridge] app-stack bundle 产出：${path.relative(ROOT, OUT)} · ${size} KB`)

// ── 批次 43（superapp 真实应用）：superapp 应用入口 bundle（被 .app 打包，JSC evaluateScript）──
const OUT_SA = path.join(HERE, 'dist', 'bundle-superapp.js')
const ENTRY_SA = path.join(ROOT, 'hosts/shared/bridge/entry-superapp.ts')
await build({
  entryPoints: [ENTRY_SA],
  outfile: OUT_SA,
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
  alias: {
    '@proteus-vue/router': path.join(ROOT, 'packages/router/src/index.ts'),
    '@proteus-vue/router/app-stack': path.join(ROOT, 'packages/router/src/app-stack.ts'),
    '@proteus-vue/router/app-route': path.join(ROOT, 'packages/router/src/app-route.ts'),
    '@proteus-vue/router/types': path.join(ROOT, 'packages/router/src/types.ts'),
    '@proteus-vue/render-backend/app-navigation': path.join(ROOT, 'packages/render-backend/src/app-navigation.ts'),
    '@proteus-vue/animation': path.join(ROOT, 'packages/animation/src/index.ts'),
    '@proteus-vue/contracts': path.join(ROOT, 'packages/contracts/src/index.ts'),
  },
  logLevel: 'warning',
  absWorkingDir: ROOT,
})
const sizeSA = (fs.statSync(OUT_SA).size / 1024).toFixed(1)
console.log(`[bridge] superapp bundle 产出：${path.relative(ROOT, OUT_SA)} · ${sizeSA} KB`)
