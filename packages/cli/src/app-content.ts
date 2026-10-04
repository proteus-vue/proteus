// packages/cli/src/app-content.ts —— ★★★App 端屏内容构建（`proteus build --target ios|android|harmony`）
//   项目路由 → 真实 SFC → 编译器 → 屏内容（2026-10-04）
//
// 【它做什么】把项目里每个路由指向的 SFC 编译成 **App 端屏内容**（`ScreenContent`：
//   内核节点描述），产出 `<root>/dist/app/<platform>/screen-content.json`（键 = 屏名）。
//   宿主（Android/iOS 的 ScreenHost）按屏名取内容建真实页面子树。
//
// 【★标准目标（不自造笼统的 `app`）】平台命名与全仓一致（`CONCRETE_PLATFORMS`：
//   web/mp/ios/android/harmony）——App 端**按具体平台**构建（`ios`/`android`/`harmony`），
//   产物分目录 `dist/app/<platform>/`。当前三端内容由**同一编译器**产出（结构一致），
//   但按平台分目录是**标准做法**：平台专属编译（条件编译/平台变体）就绪后，各端产物自然分叉，
//   且宿主按自己的平台取自己的产物（不共享一份隐含默认）。
//
// 【为什么在构建期】`buildLayoutTemplate` 依赖 `@vue/compiler-sfc`（Node API）⇒ 端上（QuickJS/JSC）
//   跑不了。构建期编译、产物下发（与 MP 产 wxml、Vapor 产 layout template 同一形态）。
//
// 【数据来源】项目**统一导航产物** `router/auto-routes.ts`（gen-routes 生成，含 routes 的
//   `component` 字段）——保证 App 屏内容与路由表**同源**（同一棵路由树）。
//
// 【诚实边界】App 路径**不吃 CSS class**（缺口 C1）⇒ 屏内容眼下主要是**结构**（节点/层级）+
//   页面里的 inline style；逐页诊断如实返回（调用方可打印）。CSS class 展开属后续批次。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildLayoutTemplate, parseCssVarTokens } from '@proteus-vue/compiler'
import { screenContentFromLayoutTemplate } from '@proteus-vue/render-backend'
import { APP_PLATFORMS, type AppPlatform } from './targets'

// ★目标/平台名 SSOT 在 ./targets（三处一致，不漂）。此处再导出供既有消费方（hosts 生成器等）。
export { APP_PLATFORMS, type AppPlatform, isAppPlatform } from './targets'

export interface AppScreenContentResult {
  ok: boolean
  /** 平台（产物落在 `<root>/dist/app/<platform>/`） */
  platform: AppPlatform
  /** 产物文件（`<root>/dist/app/<platform>/screen-content.json`） */
  outFile: string
  /** 编译成功页数 */
  compiled: number
  /** 跳过页数（缺 SFC / 编译失败） */
  skipped: number
  /** 逐页诊断（如实；多为 CSS class / 不支持语法） */
  diagnostics: string[]
}

/**
 * 生成 App 屏内容产物（**按平台**）。
 * @param root 项目根（含 `router/auto-routes.ts`——由 gen-routes 产出；调用方负责先跑 gen-routes）
 * @param platform 具体平台（ios/android/harmony；产物落 `dist/app/<platform>/`）
 */
export async function buildAppScreenContent(root: string, platform: AppPlatform = 'android'): Promise<AppScreenContentResult> {
  const autoRoutes = path.join(root, 'router', 'auto-routes.ts')
  if (!fs.existsSync(autoRoutes)) {
    throw new Error(`缺 ${path.relative(root, autoRoutes)}——先运行 gen-routes（proteus build --target skyline/web 会产出）`)
  }
  // ★批次 9：设计令牌（`globalStyle` 声明的 CSS 变量文件）——SFC 内 `var()` 编译期折叠
  //   （App 端无运行时 CSS 引擎）。与 Web/MP 消费同一份令牌文件（单一事实源）。
  let tokens: Record<string, string> | undefined
  try {
    const cfgPath = path.join(root, 'proteus.config.ts')
    if (fs.existsSync(cfgPath)) {
      const { loadProjectConfig } = await import('./config-loader')
      const cfg = (await loadProjectConfig(cfgPath)) as { globalStyle?: string }
      const gs = cfg?.globalStyle ? path.resolve(root, cfg.globalStyle) : undefined
      if (gs && fs.existsSync(gs)) tokens = parseCssVarTokens(fs.readFileSync(gs, 'utf-8'))
    }
  } catch {
    /* 无配置/加载失败 ⇒ 不折叠 var()（保持既有行为，不阻断） */
  }
  const routerDir = path.dirname(autoRoutes)
  // 动态加载（TS 直接 import；auto-routes 仅 type import ⇒ 无运行时依赖）
  const mod = (await import(pathToFileURL(autoRoutes).href)) as {
    routes?: Array<{ name: string; component?: string }>
  }
  const routes = mod.routes ?? []
  if (routes.length === 0) throw new Error(`${path.relative(root, autoRoutes)} 无 routes——格式变了？`)

  const out: Record<string, unknown> = {}
  const diagnostics: string[] = []
  let compiled = 0
  let skipped = 0
  for (const r of routes) {
    const rel = r.component
    if (!rel) {
      diagnostics.push(`${r.name}: 无 component 字段`)
      skipped++
      continue
    }
    const abs = path.resolve(routerDir, rel)
    if (!fs.existsSync(abs)) {
      diagnostics.push(`${r.name}: 缺 SFC（${rel}）`)
      skipped++
      continue
    }
    const res = buildLayoutTemplate(fs.readFileSync(abs, 'utf-8'), path.relative(root, abs), undefined, tokens)
    if (!res.ok) {
      diagnostics.push(`${r.name}: 模板编译失败`)
      skipped++
      continue
    }
    out[r.name] = screenContentFromLayoutTemplate(res.template)
    compiled++
    for (const d of res.diagnostics) diagnostics.push(`${r.name}: ${d.code} ${d.message}`)
  }

  const outDir = path.join(root, 'dist', 'app', platform)
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'screen-content.json')
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2))
  if (compiled === 0) throw new Error('零页面编译成功——App 屏内容产物为空（路由格式/编译器有问题？）')
  return { ok: true, platform, outFile, compiled, skipped, diagnostics }
}
