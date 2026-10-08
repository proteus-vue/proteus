// packages/cli/src/app-bundle.ts —— ★★★完整宿主 · 项目侧运行期 bundle 构建（2026-10-08）
//
// 【它补什么（用户「dist/app 里三端只有三个简单文件，没有完整宿主项目」）】
//   App 壳运行期入口是 `bundle-superapp.js`——它把**项目内容**（编译产物 + 运行期 tpl/table/events）
//   内联进去，宿主 eval 它即得完整应用（路由/交互/响应式/导航）。此前这份 bundle 的构建在
//   **框架路径**（`hosts/android/bridge/build-batch.mjs`，靠 `PROTEUS_APP_PROJECT` 指项目、
//   写回 `hosts/**/assets`）——属"框架内部测试装置"形态，不是**项目驱动的 CLI 构建**。
//   ⇒ 本模块把「项目 → bundle」做成 CLI 的一等能力：产出 `<project>/dist/app/<platform>/bundle-superapp.js`。
//
// 【唯一实现（本仓纪律）】内容模块的生成逻辑在此**一处**；框架内的 `gen-app-screen-content.mjs`
//   改为**调用本模块**（不再自带一份）。
//
// 【为什么不直接复用 build-batch.mjs】那个脚本同时负责**5 个** entry（batch/app-stack/host-runtime/
//   lights/vapor）+ 同步到 assets——是**框架自测**的批量构建。本项目侧只需要 superapp 一个 entry，
//   且产物落**项目 dist**。两者共享同一份 `entry-superapp.ts` 源与同一套 alias 策略（不重造）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveAppRoutes } from './app-routes'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 本 CLI 包根（`src` 与 `dist` 两种形态下都是 `<pkg>`）——随包资源（模板/桥源）以此为锚 */
const CLI_PKG_ROOT = path.resolve(HERE, '..')

/** 向上找框架仓根（含 `pnpm-workspace.yaml` 且有 `hosts/shared/bridge`）；找不到返回 null（不抛）。 */
export function findFrameworkRoot(): string | null {
  let dir = HERE
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) && fs.existsSync(path.join(dir, 'hosts/shared/bridge'))) {
      return dir
    }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

/** 向上找框架仓根（找不到 throw）——保留给"确需框架"的调用方/测试。 */
export function resolveFrameworkRoot(): string {
  const r = findFrameworkRoot()
  if (!r) {
    throw new Error('找不到框架仓根（含 pnpm-workspace.yaml 与 hosts/shared/bridge）——PROTEUS_FRAMEWORK_ROOT 可显式指定')
  }
  return r
}

/** 随包桥源目录（无框架时的回退）——`templates-host/shared/bridge`（随 CLI 发布） */
export function cliBridgeDir(): string {
  return path.join(CLI_PKG_ROOT, 'templates-host', 'shared', 'bridge')
}

export function resolveBridgeDir(): string {
  const override = process.env.PROTEUS_FRAMEWORK_ROOT
  // ① 显式框架根 ② 就近框架仓 ③ **随包回退**（纯 npm 安装、无框架 checkout 的情形）
  const root = override ? path.resolve(override) : findFrameworkRoot()
  const candidates = [
    root ? path.join(root, 'hosts/shared/bridge') : null,
    cliBridgeDir(),
  ].filter((c): c is string => !!c)
  const hit = candidates.find((b) => fs.existsSync(path.join(b, 'entry-superapp.ts')))
  if (!hit) {
    throw new Error(
      `找不到 superapp 运行期桥源（entry-superapp.ts）：已试 ${candidates.map((c) => path.relative(process.cwd(), c)).join(' / ')}` +
        '（PROTEUS_FRAMEWORK_ROOT 可显式指定）',
    )
  }
  return hit
}

export interface AppContentModuleOptions {
  /** 项目根（含 router/auto-routes.ts 与 dist/app/<platform>/） */
  projectRoot: string
  platform: string
  /** 生成模块内 `import type { ScreenContent }` 的相对路径基准目录；缺省 = 框架桥目录 */
  importBaseDir?: string
}

/**
 * 生成**项目专属**的内容模块源码（`APP_SCREEN_CONTENT` / `APP_SCREEN_REGISTRY` / `APP_RUNTIME_CONTENT`）。
 * ★与 `gen-app-screen-content.mjs` 的产物**同形**（同一份 import shape）——因为下游 `entry-superapp.ts`
 *   就 import 这三个导出；本函数是**唯一实现**。
 */
export async function buildAppContentModuleSource(opts: AppContentModuleOptions): Promise<{ source: string; compiled: number; skipped: number; diagnostics: string[] }> {
  const projectRoot = path.resolve(opts.projectRoot)
  const { buildAppScreenContent } = await import('./app-content')
  const { buildAppRuntimeContent } = await import('./app-runtime-content')
  // platform 收窄到 AppPlatform（调用方保证；非 App 端不该走 bundle 构建）
  const platform = opts.platform as 'ios' | 'android' | 'harmony'

  const r = await buildAppScreenContent(projectRoot, platform)
  const content = JSON.parse(fs.readFileSync(r.outFile, 'utf-8')) as Record<string, unknown>
  const rt = await buildAppRuntimeContent(projectRoot, platform)
  const runtimeContent = JSON.parse(fs.readFileSync(rt.outFile, 'utf-8')) as Record<string, unknown>

  // 屏注册表（来自项目 auto-routes.ts；与 Web/MP 同一棵路由树）
  // ★honor `router.routesOutput`（唯一实现 app-routes.ts）——此前硬编码 ⇒ 新工程（模板缺省
  //   `src/router/auto-routes.ts`）注册表读空 ⇒ 运行期 `app-navigation: 屏注册表为空`（用户实测）。
  const autoRoutesPath = (await resolveAppRoutes(projectRoot)).file
  let registry: unknown = { screens: {}, tabNames: [], tabLabels: {}, indexName: '', routes: [] }
  try {
    if (!fs.existsSync(autoRoutesPath)) throw new Error(`缺 ${path.relative(projectRoot, autoRoutesPath)}`)
    const arMod = (await import(pathToFileURL(autoRoutesPath).href)) as {
      screens?: Record<string, unknown>
      tabNames?: string[]
      routes?: Array<{ name: string; meta?: { title?: string } }>
    }
    const screens = arMod.screens ?? {}
    const tabNames = arMod.tabNames ?? []
    const tabLabels: Record<string, string> = {}
    for (const rr of arMod.routes ?? []) if (rr.meta?.title) tabLabels[rr.name] = rr.meta.title
    const indexName =
      screens && Object.prototype.hasOwnProperty.call(screens, 'index')
        ? 'index'
        : Object.keys(screens)[0] ?? arMod.routes?.[0]?.name ?? ''
    registry = { screens, tabNames, tabLabels, indexName, routes: arMod.routes ?? [] }
  } catch {
    /* 注册表提取失败 ⇒ 保持空（与 gen 脚本同——不阻断构建） */
  }

  // 相对路径基准：生成模块若写在别处，type-only import 仍会被 esbuild 擦除（不解析）⇒ 路径**只需形似**。
  //   ★无框架仓（纯 npm 安装）时用 npm 裸说明符——形似即可，不进 bundle。
  const fwRoot = findFrameworkRoot()
  const baseDir = opts.importBaseDir ?? resolveBridgeDir()
  const importSpec = fwRoot
    ? (() => {
        const relImport = path
          .relative(baseDir, path.join(fwRoot, 'packages/render-backend/src/screen-executor'))
          .replace(/\\/g, '/')
        return relImport.startsWith('.') ? relImport : `./${relImport}`
      })()
    : '@proteus-vue/render-backend/screen-executor'

  const header = `// AUTO-GENERATED by @proteus-vue/cli · app-bundle.ts —— 勿手改
// 来源工程：${fwRoot ? path.relative(fwRoot, projectRoot) : projectRoot}（内容由 CLI buildAppScreenContent 折叠）
/* eslint-disable */
import type { ScreenContent } from '${importSpec}'
export const APP_SCREEN_CONTENT: Record<string, ScreenContent> = ${JSON.stringify(content, null, 2)}

export const APP_SCREEN_REGISTRY = ${JSON.stringify(registry, null, 2)}

export const APP_RUNTIME_CONTENT = ${JSON.stringify(runtimeContent, null, 2)}
`
  return { source: header, compiled: r.compiled, skipped: r.skipped, diagnostics: [...r.diagnostics, ...rt.diagnostics] }
}

export interface BuildAppBundleOptions {
  projectRoot: string
  platform: string
  /** 产物路径（缺省 `<project>/dist/app/<platform>/bundle-superapp.js`） */
  outFile: string
  /** dev 构建：保留可读、不 minify，注入 __DEV__=true（调试友好） */
  dev?: boolean
}

export interface BuildAppBundleResult {
  outFile: string
  bytes: number
  compiled: number
  skipped: number
  diagnostics: string[]
}

/**
 * 构建项目侧 `bundle-superapp.js`：生成项目内容模块 → esbuild 打包 `entry-superapp.ts`。
 * ★内容模块经 esbuild **plugin** 重定向（entry-superapp.ts 里的相对 import `./app-screen-content.generated`
 *   被解析到 `dist/app/<platform>/app-screen-content.generated.ts`——**不动框架目录**）。
 */
export async function buildAppBundle(opts: BuildAppBundleOptions): Promise<BuildAppBundleResult> {
  const projectRoot = path.resolve(opts.projectRoot)
  const bridge = resolveBridgeDir()
  // ★框架仓可选（决策 #666）：有 ⇒ alias 指 src（消除"忘重建 dist 跑旧代码"）；无 ⇒ 走 npm 解析（dist）。
  const fw = findFrameworkRoot()
  const outFile = path.resolve(opts.outFile)
  const genModule = path.join(projectRoot, 'dist', 'app', opts.platform, 'app-screen-content.generated.ts')

  const { source, compiled, skipped, diagnostics } = await buildAppContentModuleSource({
    projectRoot,
    platform: opts.platform,
    // 生成模块落在 dist/app/<platform>/ ⇒ 相对路径基准用其所在目录（type-only import 会被擦除，形似即可）
    importBaseDir: path.join(projectRoot, 'dist', 'app', opts.platform),
  })
  fs.mkdirSync(path.dirname(genModule), { recursive: true })
  fs.writeFileSync(genModule, source)

  const { build } = await import('esbuild')
  // ★alias 仅在**有框架仓**时启用（src 直指）；无框架 ⇒ 空 alias ⇒ esbuild 按 node_modules 解析
  //   （@proteus-vue/router、/render-backend 是 CLI 的运行时依赖，子路径经各包 exports 映射到 dist）。
  const alias: Record<string, string> = fw
    ? {
        '@proteus-vue/router/app-stack': path.join(fw, 'packages/router/src/app-stack.ts'),
        '@proteus-vue/router/app-route': path.join(fw, 'packages/router/src/app-route.ts'),
        '@proteus-vue/router/types': path.join(fw, 'packages/router/src/types.ts'),
        '@proteus-vue/router': path.join(fw, 'packages/router/src/index.ts'),
        '@proteus-vue/render-backend/app-navigation': path.join(fw, 'packages/render-backend/src/app-navigation.ts'),
        '@proteus-vue/animation': path.join(fw, 'packages/animation/src/index.ts'),
        '@proteus-vue/contracts': path.join(fw, 'packages/contracts/src/index.ts'),
      }
    : {}
  try {
    await build({
      entryPoints: [path.join(bridge, 'entry-superapp.ts')],
      outfile: outFile,
      bundle: true,
      format: 'iife',
      platform: 'neutral',
      target: 'es2020',
      minify: opts.dev ? false : true,
      legalComments: 'none',
      // ★`import.meta` 在 iife 下为空——**预期**（App bundle 不用 `import.meta.env`：平台探测有运行时兜底，
      //   见 shared/platform/index.ts 的 detectMPRuntime）。esbuild 默认把它当警告刷屏（用户实测"终端很吵"）
      //   ⇒ 显式静音该条（不影响其它潜在警告）。
      logOverride: { 'empty-import-meta': 'silent' },
      define: { 'process.env.NODE_ENV': opts.dev ? '"development"' : '"production"', __DEV__: opts.dev ? 'true' : 'false' },
      plugins: [
        {
          // ★把 entry-superapp.ts 的 `./app-screen-content.generated` 重定向到**项目专属**生成模块
          name: 'proteus-app-content-redirect',
          setup(b) {
            b.onResolve({ filter: /app-screen-content\.generated$/ }, () => ({ path: genModule }))
          },
        },
      ],
      // ★子路径键须在前（esbuild 按**最长前缀**匹配，顺序仅为可读性）
      alias,
    })
  } finally {
    fs.rmSync(genModule, { force: true })
  }
  const bytes = fs.statSync(outFile).size
  return { outFile, bytes, compiled, skipped, diagnostics }
}
