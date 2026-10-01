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

// ══════════════════════════════════════════════════════════════════
// ★★M5：第二个 entry —— 路由虚拟栈（app-stack）
//
// 【为什么单独一个 bundle（而不是塞进 entry-batch.ts）】
//   两者是**不同关注点**（渲染适配器 vs 路由栈），且 app-stack 零依赖——
//   单独 bundle 让 S3b/S5 的产物**不受本入口改动影响**（减小回归面）。
//
// 【为什么 alias 指向 src 而不是 dist（与 render-backend 相反，且是刻意的）】
//   render-backend 的 dist 是"已发布产物"（bundle 必须跑它）；
//   而 router 的 src **本身就是唯一实现**，且 app-stack/codegen 只有**类型导入**
//   （esbuild 会擦除）⇒ 直接打 src 有两个好处：
//     ① 消除"忘了重建 dist ⇒ 真机测的是旧代码"这一本仓已踩过的陷阱（陈旧 AAR 同源）；
//     ② 免去 build-packages 前置（router 的 src 可独立编译）。
//   ★若将来 app-stack 引入运行期 import，本 alias 仍然成立（esbuild 会一并打包 src 依赖）。
const OUT_APP_STACK = path.join(HERE, 'dist', 'bundle-app-stack.js')
const resultAppStack = await build({
  entryPoints: [path.join(ROOT, 'hosts', 'shared', 'bridge', 'entry-app-stack.ts')],
  outfile: OUT_APP_STACK,
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
  alias: {
    '@proteus-vue/router/app-stack': path.join(ROOT, 'packages/router/src/app-stack.ts'),
    '@proteus-vue/router/codegen': path.join(ROOT, 'packages/router/src/codegen/index.ts'),
    '@proteus-vue/router/types': path.join(ROOT, 'packages/router/src/types.ts'),
    // ★★场景 E（执行器）新增：动画包 + 执行器——同样 alias 到 **src**（同上"消除陈旧 dist"理由）。
    //   执行器在 render-backend 的 src（dist 是发布产物，但本入口与 S3b/S5 一样要"打最新源"）。
    '@proteus-vue/animation': path.join(ROOT, 'packages/animation/src/index.ts'),
    '@proteus-vue/render-backend/screen-executor': path.join(ROOT, 'packages/render-backend/src/screen-executor.ts'),
    '@proteus-vue/contracts': path.join(ROOT, 'packages/contracts/src/index.ts'),
  },
  legalComments: 'none',
})

const bytesAppStack = fs.statSync(OUT_APP_STACK).size
console.log(`[android-bundle] ✅ ${path.relative(ROOT, OUT_APP_STACK)}（${(bytesAppStack / 1024).toFixed(1)} KB）`)
if (resultAppStack.warnings.length) {
  for (const w of resultAppStack.warnings) console.warn(`  ⚠ ${w.text}`)
}

// ══════════════════════════════════════════════════════════════════
// ★★G-39：第三个 entry —— 宿主运行时（host-runtime：生命周期/事件循环/职责边界/内存账本）
//
// 【为什么指向 src 而非 dist】与 app-stack 同款理由（消除"忘了重建 dist ⇒ 测旧代码"）
//   + quickjs-host.ts 是**本轮新增**（dist 里还没有）⇒ alias 到 src 是唯一正确的形态。
// 【为什么 host-conformance 也走 src】它与 quickjs-host 同在 render-backend/src；
//   esbuild 会一并打包其相对依赖（dispatcher/headless/flutter）；
//   唯一的外部包依赖是 @proteus-vue/component-ir（零依赖纯 TS）——显式 alias 到其 dist。
//   ★★入口在 `hosts/shared/bridge/`（**Android/iOS 两个壳共用同一份**——平台中立：
//     读壳注入的 `__PROTEUS_HOST_ID__` 自报标识；内存/GC 走各自的宿主桥）
const OUT_HOST_RT = path.join(HERE, 'dist', 'bundle-host-runtime.js')
const resultHostRt = await build({
  entryPoints: [path.join(ROOT, 'hosts/shared/bridge/entry-host-runtime.ts')],
  outfile: OUT_HOST_RT,
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
  alias: {
    '@proteus-vue/render-backend/quickjs-host': path.join(ROOT, 'packages/render-backend/src/quickjs-host.ts'),
    '@proteus-vue/router/app-stack': path.join(ROOT, 'packages/router/src/app-stack.ts'),
    '@proteus-vue/api/capability-app': path.join(ROOT, 'packages/api/src/capability-app.ts'),
    '@proteus-vue/api/capability': path.join(ROOT, 'packages/api/src/capability.ts'),
    '@proteus-vue/render-backend/host-conformance': path.join(ROOT, 'packages/render-backend/src/host-conformance.ts'),
    '@proteus-vue/component-ir': path.join(ROOT, 'packages/component-ir/dist/index.js'),
  },
  legalComments: 'none',
})

const bytesHostRt = fs.statSync(OUT_HOST_RT).size
console.log(`[android-bundle] ✅ ${path.relative(ROOT, OUT_HOST_RT)}（${(bytesHostRt / 1024).toFixed(1)} KB）`)
if (resultHostRt.warnings.length) {
  for (const w of resultHostRt.warnings) console.warn(`  ⚠ ${w.text}`)
}

// ══════════════════════════════════════════════════════════════════
// ★★第四个 entry —— **灯光秀**（Morpheus 第二个炫技节目 · 800 灯颜色编舞）
//
// 【与节目一（showcase）的差别】节目一的设备入口在 iOS 壳（`entry-showcase.ts`，JSC）；
//   灯光秀的用户要求是**在安卓上做** ⇒ 本 entry 面向 Android QuickJS，
//   桥名 = `proteusHost`（动画桥 animStart/animTick/...，见 quickjs_jni.c 条件注入表）。
//   节目单（showcase-lights.ts）在 `hosts/shared/bridge/`——平台中立，同一份声明链。
const OUT_LIGHTS = path.join(HERE, 'dist', 'bundle-lights.js')
const resultLights = await build({
  entryPoints: [path.join(HERE, 'entry-lights.ts')],
  outfile: OUT_LIGHTS,
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
  alias: {
    '@proteus-vue/animation': path.join(ROOT, 'packages/animation/dist/index.js'),
  },
  legalComments: 'none',
})

const bytesLights = fs.statSync(OUT_LIGHTS).size
console.log(`[android-bundle] ✅ ${path.relative(ROOT, OUT_LIGHTS)}（${(bytesLights / 1024).toFixed(1)} KB）`)
if (resultLights.warnings.length) {
  for (const w of resultLights.warnings) console.warn(`  ⚠ ${w.text}`)
}

// ══════════════════════════════════════════════════════════════════
// ★★第五个 entry —— **Vapor 设备端**（真实 SFC 编译产物 → 设备端实例化 → 订阅驱动增量）
//
// 【它补的缺口（2026-10-01 核实）】Android 侧此前跑的是**构建期预实例化的静态树**
//   （`entry-batch.ts` 注释明写「不接 Vue」）。本 entry 把"编译器产出的两件产物"
//   在**设备端**跑起来：实例化 + 订阅驱动的二进制指令更新（见 entry-vapor.ts 头注）。
//   ★依赖 `@proteus-vue/slot-runtime`（纯 TS 零 Node API）——**不是**编译器
//     （编译器依赖 @babel + @vue/compiler-sfc，进不了 QuickJS；故编译在构建期）。
const OUT_VAPOR = path.join(HERE, 'dist', 'bundle-vapor.js')
const resultVapor = await build({
  entryPoints: [path.join(HERE, 'entry-vapor.ts')],
  outfile: OUT_VAPOR,
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
  alias: {
    '@proteus-vue/slot-runtime': path.join(ROOT, 'packages/slot-runtime/dist/index.js'),
  },
  legalComments: 'none',
})

const bytesVapor = fs.statSync(OUT_VAPOR).size
console.log(`[android-bundle] ✅ ${path.relative(ROOT, OUT_VAPOR)}（${(bytesVapor / 1024).toFixed(1)} KB）`)
if (resultVapor.warnings.length) {
  for (const w of resultVapor.warnings) console.warn(`  ⚠ ${w.text}`)
}
