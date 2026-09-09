// packages/plugin-vite/src/gen-routes.ts
// ============================================================
// 编译期路由表生成器（P2-2 / P2-3 + 拆包步骤 5 归 @proteus-vue/plugin-vite）
//
// 输入：ProteusConfig（pagesDir / subPackages / skyline / routesOutput）
// 输出：
//   1. 应用侧路由表（路径 = config.routesOutput，默认 src/router/auto-routes.ts）
//   2. dist/mp-weixin/app.json（页面声明 + 分包 + window + tabBar）
//   3. dist/mp-weixin/**/<page>.json（每页 Skyline 配置）
//
// ★拆包步骤 5：纯函数库（runGenRoutes），CLI 入口见同目录 cli.ts；测试直接调本函数
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import type { RouteRecord, RouteMeta } from '@proteus-vue/router'
import { mergeMeta } from '@proteus-vue/router/merge'
import type { RouteBlock } from '@proteus-vue/router/types'
import { scanRoutes } from '@proteus-vue/router/scan'
import { buildRouteTree } from '@proteus-vue/router/tree'
import { resolveRouterConfig } from '@proteus-vue/types'
import type { ProteusConfig } from './config'

/** 入口选项：config 为项目编译配置，root 为项目根目录（默认 process.cwd()） */
export interface GenRoutesOptions {
  config: ProteusConfig
  root?: string
  /** --trace-router：输出每条路由的生成决策（来源登记 + 父路由推导依据） */
  trace?: (msg: string) => void
  /**
   * ★框架内置组件目录（组件库未拆包，决策 #115）：显式传入绝对路径（如 monorepo 根 src/components）；
   * 缺省相对 root 的 src/components（create-proteus 模板工程用）
   * ★v2.0 退役：@proteus-vue/components 拆为独立 npm 包后本选项删除（改 resolvePkgPath 包内路径，见 docs/packages.md）
   */
  frameworkComponentsDir?: string
  /**
   * ★module-plan B5：模块契约（@proteus-vue/module 扫描产物，调用方 async 扫描后传入）：
   * 分包依赖（dependencies）与 preloadRule 生成——模块 chunk/name 与 config.subPackages 的 name/root 基名匹配
   */
  moduleConfigs?: Array<{ name: string; chunk?: string; dependencies?: Record<string, string>; preload?: string[] }>
}

/**
 * 运行路由表生成（纯函数，可单测）：清理 dist 产物 → 扫描页面 → 生成 auto-routes/app.json/page.json/component.json
 */
export function runGenRoutes(options: GenRoutesOptions): void {
  const config = options.config
  const ROOT = options.root ?? process.cwd()
  // ★#492 项目级路由管理：解析生效路由配置（router.* 优先，顶层三字段为兼容别名；双处声明提示收敛）
  const { router: rc, duplicates } = resolveRouterConfig(config as never)
  for (const d of duplicates) console.warn(`[gen-routes] 路由字段 "${d}" 在顶层与 router 段同时声明——已取 router.${d}（#492 统一路由管理：建议删除顶层遗留写法）`)
  // --trace-router：路由生成决策链输出（来源登记 + 父路由推导依据，对齐 --trace-transform）
  const trace = options.trace ?? (() => {})
  // 应用根目录（页面/入口所在目录，从 pagesDir 推导：examples/pages → examples）
  const APP_DIR = path.resolve(ROOT, path.dirname(config.pagesDir))
  const OUT_DIR = path.join(ROOT, 'dist', 'mp-weixin')
  // ★框架内置组件目录（@proteus-vue/components 未拆包时的定位方式，决策 #115）
  // ★#495 修复：config.frameworkComponentsDir（相对 root）此前从未被 CLI 传入 → FW_COMPONENTS 落空
  //  （examples 的组件目录是仓库根 ../src/components）→ 页面 usingComponents 与组件 component.json 双双缺失 →
  //  WXML 未注册组件整块不渲染（柔性布局等全部 p-* 组件在 MP 失效，Web 正常）。相对路径基于 ROOT 归一。
  const fwDir = options.frameworkComponentsDir
  const FW_COMPONENTS = fwDir && path.isAbsolute(fwDir) ? fwDir : path.resolve(ROOT, fwDir ?? path.join('src', 'components'))
  // ★module-plan B5：模块契约（分包依赖 / preloadRule）——模块名→chunk 映射 + 分包→模块映射
  const moduleChunks = new Map<string, string>() // 模块名 → chunk（缺省 = 模块名）
  for (const mc of options.moduleConfigs ?? []) moduleChunks.set(mc.name, mc.chunk ?? mc.name)
  const subPackageModules = new Map<string, { deps: string[]; preload: string[] }>() // 分包名 → 模块信息
  for (const mc of options.moduleConfigs ?? []) {
    const chunk = mc.chunk ?? mc.name
    const matched = rc.subPackages.some((sp) => (sp.name ?? path.basename(sp.root)) === chunk)
    if (matched) subPackageModules.set(chunk, { deps: Object.keys(mc.dependencies ?? {}), preload: mc.preload ?? [] })
    // ★校验：模块依赖引用未知模块（透明化，反黑盒）
    for (const dep of Object.keys(mc.dependencies ?? {})) {
      if (!moduleChunks.has(dep)) console.warn(`[gen-routes] 模块 ${mc.name} 依赖 "${dep}" 未找到对应模块契约（proteus-module.config.ts）——依赖将不生效`)
    }
  }
  // 依赖模块是否为分包（chunk 匹配分包名）→ 分包名；否则 undefined（主包模块不产生分包依赖）
  const subPackageNameOf = (moduleName: string): string | undefined => {
    const chunk = moduleChunks.get(moduleName)
    return rc.subPackages.some((sp) => (sp.name ?? path.basename(sp.root)) === chunk) ? chunk : undefined
  }

/** 扫描到的页面 */
interface PageInfo {
  /** .vue 文件绝对路径 */
  file: string
  /** 相对 src/ 的路径（去扩展名），如 pages/user/profile */
  relSrc: string
  /** 小程序页面路径（= relSrc，含分包 root 前缀） */
  mpPath: string
  /** 所属分包名（主包为 undefined） */
  subPackage?: string
  /** 分包内相对路径（分包页面用，如 pages/list） */
  relInSub?: string
  /** <route> 块解析结果 */
  meta?: RouteMeta
  customRouteKeyName?: string
  /** <route> 块 pageJson 扩展：合并进页面 page.json（如半屏页透明背景） */
  pageJson?: Record<string, unknown>
  /** ★Router M7.1：页面归属模块分包（与模块 chunk 对齐校验） */
  chunk?: string
  /** <route> 块 params 声明：字段名 → 类型名（string/number/boolean），生成 RouteParamsByName */
  params?: Record<string, string>
  /** ★G-42/官网：仅 Web 路由（<route> 块 webOnly: true）——MP app.json 不收录 + mpTransform 跳过编译 */
  webOnly?: boolean
}

/** 递归收集目录下所有 .vue 文件（跳过隐藏目录）——组件扫描用 */
function walkVueFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkVueFiles(full, acc)
    else if (entry.name.endsWith('.vue')) acc.push(full)
  }
  return acc
}

/**
 * 解析集中式 meta（决策 #113）：目录前缀（最长匹配）为基底 + 精确路径细化（mergeMeta 精确胜）
 * 键 = pagesDir 相对路径去扩展名（'user/profile'；目录级 'user' 前缀匹配其下全部页面）
 */
function resolveConfigMeta(configMeta: Record<string, RouteMeta> | undefined, pageRel: string): RouteMeta | undefined {
  if (!configMeta) return undefined
  let dirMeta: RouteMeta | undefined
  const segs = pageRel.split('/')
  for (let i = segs.length - 1; i >= 1; i--) {
    const prefix = segs.slice(0, i).join('/')
    if (configMeta[prefix]) {
      dirMeta = configMeta[prefix]
      break
    }
  }
  const exact = configMeta[pageRel]
  if (dirMeta && exact) return mergeMeta(dirMeta, exact) // 精确细化目录（精确胜）
  return dirMeta ?? exact
}

/** 扫描页面集合（主包 + 分包）——★决策 #113：全页面收录（无 <route> 块零声明）+ config 集中 meta 注入 */
function scanPages(): PageInfo[] {
  const pages: PageInfo[] = []
  const configMeta = rc.meta

  // 主包：pagesDir
  const mainBlocks = scanRoutes(path.join(ROOT, config.pagesDir), { derivePath: true, verbose: true, includeNoRoute: true })
  for (const b of mainBlocks) {
    const relSrc = path.relative(APP_DIR, b.componentPath).replace(/\\/g, '/').replace(/\.vue$/, '')
    const pageRel = relSrc.replace(/^pages\//, '')
    trace(`[route] ${relSrc} 来源登记（${b.loc.file}:${b.loc.line}，route/scan）`)
    pages.push({
      file: b.componentPath,
      relSrc,
      mpPath: relSrc,
      // ★集中 meta：config（精确/目录前缀）→ 页面 <route> 覆盖（mergeMeta 页面胜）
      meta: mergeMeta(resolveConfigMeta(configMeta, pageRel), b.meta),
      params: b.params,
      pageJson: b.pageJson,
      customRouteKeyName: b.customRouteKeyName,
      webOnly: b.webOnly,
    })
  }

  // 分包：subPackages[].root（各分包独立扫描 + 树推导，跨分包不嵌套）——★#492 生效值来自 router 段（顶层别名兼容）
  for (const sp of rc.subPackages) {
    const spRootAbs = path.join(ROOT, sp.root)
    const spName = sp.name ?? path.basename(sp.root)
    const spBlocks = scanRoutes(spRootAbs, { derivePath: true, verbose: true, includeNoRoute: true })
    for (const b of spBlocks) {
      const relSrc = path.relative(APP_DIR, b.componentPath).replace(/\\/g, '/').replace(/\.vue$/, '')
      const relInSub = path.relative(spRootAbs, b.componentPath).replace(/\\/g, '/').replace(/\.vue$/, '')
      const pageRel = relInSub.replace(/^pages\//, '')
      pages.push({
        file: b.componentPath,
        relSrc,
        mpPath: relSrc,
        subPackage: spName,
        relInSub,
        meta: mergeMeta(resolveConfigMeta(configMeta, pageRel), b.meta),
        params: b.params,
        pageJson: b.pageJson,
        customRouteKeyName: b.customRouteKeyName,
        chunk: b.chunk,
        webOnly: b.webOnly,
      })
      // ★Router M7.1（module-plan 05）：分包页面声明 chunk → 必须与分包名对齐（页面→模块映射；不一致 → 透明化警告）
      if (b.chunk && b.chunk !== spName) {
        console.warn(`[gen-routes] 分包页面 ${relInSub} 声明 chunk="${b.chunk}" 与分包名 "${spName}" 不一致（Router M7.1：页面 chunk 应对齐模块分包名，见 module-plan 05）`)
      }
    }
  }

  return pages
}

/** 组装路由记录（★双管线统一：父子关系走 buildRouteTree——path 前缀推导 + 显式 parent，含 trace） */
function buildRoutes(pages: PageInfo[]): RouteRecord[] {
  const routes: RouteRecord[] = pages.map(p => {
    const r: RouteRecord = {
      // ★统一后 name 由 scan 推导（derivePath 模式：index 归并目录名，与旧 toRouteName 一致）
      name: deriveName(p),
      path: p.mpPath,
      // 相对 RouterView 所在目录（{appDir}/router）的路径，Web 端 import.meta.glob 按此匹配
      component: path.relative(path.join(APP_DIR, 'router'), p.file).replace(/\\/g, '/'),
    }
    if (p.subPackage) r.subPackage = p.subPackage
    if (p.meta && Object.keys(p.meta).length > 0) r.meta = p.meta
    if (p.customRouteKeyName) r.customRouteKeyName = p.customRouteKeyName
    if (p.params && Object.keys(p.params).length > 0) r.params = p.params
    return r
  })

  // ★父子关系：buildRouteTree（path 前缀推导：pages/user + pages/user/profile；显式 parent 覆盖）
  const nameByRel = new Map(pages.map(p => [p.relSrc, deriveName(p)]))
  const blocks = pages.map(p => ({
    loc: { file: p.file, line: 1, column: 1 },
    path: p.relSrc.endsWith('/index') ? p.relSrc.slice(0, -'/index'.length) : p.relSrc,
    name: nameByRel.get(p.relSrc),
    meta: p.meta ?? {},
    componentPath: p.file,
  }))
  const tree = buildRouteTree(blocks, {}, trace)
  const parentByName = new Map<string, string>()
  const walk = (nodes: typeof tree, parent?: string): void => {
    for (const n of nodes) {
      if (n.name && parent) parentByName.set(n.name, parent)
      walk(n.children, n.name)
    }
  }
  walk(tree)
  for (const r of routes) {
    const parent = parentByName.get(r.name)
    if (parent && parent !== r.name) r.parent = parent
  }

  return routes
}

/** name 推导（与 scan derivePath 一致：index 归并目录名）——page 无 name 时用文件位置 */
function deriveName(p: PageInfo): string {
  const base = p.relSrc.split('/').pop() ?? ''
  if (base === 'index') {
    const dir = p.relSrc.slice(0, p.relSrc.lastIndexOf('/'))
    const stripped = dir.replace(/^(pages|subpackages)(\/|$)/, '').replace(/\/$/, '')
    return stripped ? stripped.replace(/\//g, '-') : 'index'
  }
  return p.relSrc.replace(/^(pages|subpackages)\//, '').replace(/\//g, '-')
}

/** 校验硬边界（平台限制，无法突破） */
function validate(pages: PageInfo[], routes: RouteRecord[]): void {
  const mainCount = pages.filter(p => !p.subPackage).length
  if (mainCount > 32) {
    throw new Error(
      `[gen-routes] 主包页面数 ${mainCount} 超过平台硬边界 32，请将部分页面移入分包（platform limitation, cannot exceed）`,
    )
  }
  const dupNames = routes.filter((r, i) => routes.findIndex(x => x.name === r.name) !== i)
  if (dupNames.length) {
    throw new Error(`[gen-routes] 命名路由重复：${dupNames.map(r => r.name).join(', ')}`)
  }
}

/** 格式化一条路由记录（产物保持可读，贴近手写） */
function formatRoute(r: RouteRecord): string {
  const parts = [
    `name: ${JSON.stringify(r.name)}`,
    `path: ${JSON.stringify(r.path)}`,
    `component: ${JSON.stringify(r.component)}`,
  ]
  if (r.parent) parts.push(`parent: ${JSON.stringify(r.parent)}`)
  if (r.subPackage) parts.push(`subPackage: ${JSON.stringify(r.subPackage)}`)
  if (r.meta && Object.keys(r.meta).length) parts.push(`meta: ${JSON.stringify(r.meta)}`)
  if (r.customRouteKeyName) parts.push(`customRouteKeyName: ${JSON.stringify(r.customRouteKeyName)}`)
  return `  { ${parts.join(', ')} },`
}

/** 生成 auto-routes.ts（应用侧路由表，路径由 proteus.config.ts 的 routesOutput 决定） */
function writeAutoRoutes(routes: RouteRecord[]): void {
  const lines = [
    `// ${rc.routesOutput} —— 应用侧路由表（AUTO-GENERATED by scripts/gen-routes.ts，勿手动编辑）`,
    '// ★拆包步骤 4：auto-routes 随应用存放（工厂化后路由表由应用注入 createRouter），不再属于 @proteus-vue/router 包',
    "import type { RouteRecord } from '@proteus-vue/router/types'",
    '',
    'export const routes: RouteRecord[] = [',
    ...routes.map(formatRoute),
    ']',
    '',
    "export const tabRoutes: RouteRecord[] = routes.filter(r => r.meta?.isTab)",
    "export const routeMap: Record<string, RouteRecord> = routes.reduce((m, r) => { m[r.name] = r; return m }, {} as Record<string, RouteRecord>)",
    '',
  ]
  // 类型提示全链路（步骤 1）：按路由名生成参数类型表（<route>.params 声明，未声明为 {}）
  // ★工厂化：改为模块扩充注入 @proteus-vue/router/types 的 RouteParamsByName 基接口（vue-router 同款模式）
  lines.push('// ★ 类型提示：按路由名索引的参数类型表（来源：<route> 块 params 声明）')
  lines.push("declare module '@proteus-vue/router/types' {")
  lines.push('  interface RouteParamsByName {')
  for (const r of routes) {
    const params = (r as RouteRecord & { params?: Record<string, string> }).params ?? {}
    const fields = Object.entries(params)
    const body = fields.length
      ? fields.map(([k, t]) => `${k}?: ${tsType(t)}`).join('; ')
      : ''
    lines.push(`    '${r.name}': { ${body} },`)
  }
  lines.push('  }', '}')
  const outFile = path.join(ROOT, rc.routesOutput)
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, lines.join('\n'))
  console.log(`[gen-routes] 已生成 ${path.relative(ROOT, outFile)}（${routes.length} 条路由 + RouteParamsByName）`)
}

/** <route>.params 类型名 → TS 类型（string/number/boolean；其他 → string + 警告） */
function tsType(t: string): string {
  if (t === 'number') return 'number'
  if (t === 'boolean') return 'boolean'
  if (t !== 'string') {
    console.warn(`[gen-routes] 未知参数类型 ${t}（支持 string/number/boolean），已按 string 处理`)
  }
  return 'string'
}

/** 生成 dist/mp-weixin/app.json */
function writeAppJson(allPages: PageInfo[], routes: RouteRecord[]): void {
  // ★G-42/官网：webOnly 页面不进 MP app.json（仅 Web 路由——官网文档页等无 MP 对等）
  const pages = allPages.filter(p => !(p as { webOnly?: boolean }).webOnly)
  const mainPages = pages.filter(p => !p.subPackage).map(p => p.mpPath)
  // ★默认首页一致性（2026-08）：主包根 index 页（如 pages/index）置顶——小程序 pages[0] = 冷启动默认页，
  //   对齐 Web 端 RouterView 初始路由回退（'pages/index'）；约定 pagesDir/index.vue 为默认首页
  const entryPath = path.relative(APP_DIR, path.join(ROOT, config.pagesDir, 'index')).replace(/\\/g, '/')
  const entryIdx = mainPages.indexOf(entryPath)
  if (entryIdx > 0) {
    mainPages.splice(entryIdx, 1)
    mainPages.unshift(entryPath)
  }

  const subPackages = rc.subPackages
    .filter(sp => pages.some(p => p.subPackage === (sp.name ?? path.basename(sp.root))))
    .map(sp => {
      const spName = sp.name ?? path.basename(sp.root)
      const out: Record<string, unknown> = {
        root: path.relative(APP_DIR, path.join(ROOT, sp.root)).replace(/\\/g, '/'),
        ...(sp.name ? { name: sp.name } : {}),
        pages: pages.filter(p => p.subPackage === spName && p.relInSub).map(p => p.relInSub!),
      }
      // ★module-plan B5：分包依赖（模块 dependencies 中其他分包；微信非独立分包 dependencies 字段）
      const mod = subPackageModules.get(spName)
      if (mod) {
        const depNames = mod.deps.map(subPackageNameOf).filter((n): n is string => Boolean(n))
        if (depNames.length) out.dependencies = depNames
      }
      return out
    })

  // ★module-plan B5：preloadRule——分包模块 preload 引用其他分包 → 分包入口页预加载（network all）
  const preloadRule: Record<string, unknown> = {}
  for (const [spName, mod] of subPackageModules) {
    const targetPackages = mod.preload.map(subPackageNameOf).filter((n): n is string => Boolean(n))
    if (!targetPackages.length) continue
    const entryPage = pages.find((p) => p.subPackage === spName && p.relInSub)
    if (!entryPage) continue
    preloadRule[entryPage.mpPath] = { network: 'all', packages: targetPackages }
  }

  const windowConfig: Record<string, unknown> = { navigationStyle: 'custom' }
  // 注意：不在此处声明 window.renderer —— 真机校验报"无效的 app.json window[renderer]"，
  // Skyline 改为页面级声明（writePageJsons 输出各页 renderer: skyline）

  const tabRoutes = routes.filter(r => r.meta?.isTab)
  const appJson: Record<string, unknown> = { pages: mainPages }
  if (subPackages.length) appJson.subPackages = subPackages
  if (Object.keys(preloadRule).length) appJson.preloadRule = preloadRule
  appJson.window = windowConfig
  // Skyline 渲染前提（微信平台校验）：页面 renderer=skyline 时必须声明 requiredComponents
  if (config.skyline) appJson.lazyCodeLoading = 'requiredComponents'
  // ★Skyline 布局对齐（2026-08 真机实测）：Skyline 节点默认 flex 会 stretch 拉伸表单元素（switch/slider/icon 占满一行居中）
  //   → defaultDisplayBlock 默认 block 对齐 WebView/Web（基础库 2.31.1+）
  //   （text 行内恢复走类选择器 .proteus-text-inline——tagNameStyleIsolation 当前开发者工具校验拒绝，不可用）
  if (config.skyline) {
    appJson.rendererOptions = { skyline: { defaultDisplayBlock: config.skylineLayout?.defaultDisplayBlock ?? true } }
  }
  // 平台硬边界：tabBar.list 至少 2 项（微信校验），不足时告警并忽略
  // ★#492 router.tabBar 真正接线（此前 gen-routes 仅按 meta.isTab 推导，color/selectedColor/list 声明被忽略）：
  //   tabBar.list 显式声明 → 按 list 顺序与文案（name → 路由名查 path）；未声明 → 沿用 meta.isTab 推导（兼容）
  const tabBarDecl = rc.tabBar
  const tabBarListFromDecl = tabBarDecl?.list ?? []
  const tabBarBase = tabBarDecl
    ? { color: tabBarDecl.color ?? '#999999', selectedColor: tabBarDecl.selectedColor ?? '#007AFF' }
    : {}
  if (tabBarListFromDecl.length > 0) {
    if (tabBarListFromDecl.length < 2) {
      console.warn(`[gen-routes] router.tabBar.list 仅声明 ${tabBarListFromDecl.length} 项，微信要求至少 2 项，已忽略 tabBar 配置`)
    } else {
      const byName = new Map(routes.map(r => [r.name, r]))
      const missing = tabBarListFromDecl.filter(item => !byName.has(item.name))
      if (missing.length) {
        console.warn(`[gen-routes] router.tabBar.list 引用未知路由名：${missing.map(m => m.name).join(' / ')}——对应项已跳过（路由名见 ${rc.routesOutput}）`)
      }
      appJson.tabBar = {
        ...tabBarBase,
        list: tabBarListFromDecl
          .filter(item => byName.has(item.name))
          .map(item => {
            const r = byName.get(item.name)!
            const entry: { pagePath: string; text: string; iconPath?: string } = { pagePath: r.path, text: item.text }
            if (item.icon) entry.iconPath = item.icon
            return entry
          }),
      }
    }
  } else if (tabRoutes.length >= 2) {
    appJson.tabBar = { ...tabBarBase, list: tabRoutes.map(r => ({ pagePath: r.path, text: (r.meta?.title as string) ?? r.name })) }
  } else if (tabRoutes.length === 1) {
    console.warn(`[gen-routes] tabBar 仅声明 1 项（${tabRoutes[0].name}），微信要求至少 2 项，已忽略 tabBar 配置；可将更多页面标记 isTab 或移除现有 isTab`)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'app.json'), JSON.stringify(appJson, null, 2) + '\n')
  console.log(`[gen-routes] 已生成 dist/mp-weixin/app.json（主包 ${mainPages.length} 页，分包 ${subPackages.length} 个）`)
}

/** 原生小程序标签 + HTML 标签（模板扫描时用于区分自定义组件标签） */
const NATIVE_MP_TAGS = new Set([
  'view', 'text', 'image', 'button', 'input', 'textarea', 'video', 'canvas', 'scroll-view', 'slot', 'rich-text',
  'swiper', 'swiper-item', 'navigator', 'icon', 'progress', 'checkbox', 'radio', 'form', 'label', 'picker', 'slider',
  'switch', 'map', 'web-view', 'cover-view', 'cover-image', 'movable-area', 'movable-view', 'block', 'template', 'wxs',
  'audio', 'camera', 'live-player', 'ad', 'official-account', 'open-data', 'page-container', 'root-portal', 'match-media',
  // ★vue-compat-advance Batch 2/5：<transition> 由编译器消费（装饰式，产物不输出该标签）——扫描跳过，非自定义组件
  'transition',
  // ★2026-09-09 G-62 SVG→Skyline P0：SVG 标签由编译器 lowering 为 <image> data-URI（template/svg-to-image），
  //   产物不含这些标签——扫描跳过，否则误报「未找到组件 <svg>」并写入 usingComponents（image-spike 实证）
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g', 'defs',
  'linearGradient', 'radialGradient', 'stop', 'use', 'symbol', 'mask', 'clipPath', 'tspan',
  // ★2026-09-09 G-62：SVG 动画标签由编译器消费（转 CSS 或 canvas 场景）——产物无这些标签
  'animate', 'animateTransform', 'animateMotion', 'set',
])
const HTML_TAGS = new Set([
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'br', 'ul', 'ol', 'li', 'section', 'header',
  'footer', 'main', 'aside', 'nav', 'article', 'strong', 'em', 'b', 'i', 'small', 'code', 'pre', 'select', 'option',
  'table', 'tr', 'td', 'th', 'form', 'label', 'tbody', 'thead', 'caption', 'figure', 'figcaption', 'details', 'summary',
])

/**
 * SFC 根 <template> 体提取（深度配对）：内层 <template #slot> / <template v-if> 不截断——
 * 旧实现 /<template[^>]*>([\s\S]*?)<\/template>/ 被首个内层具名插槽 </template> 截断 →
 * 其后的自定义组件标签漏扫描 → page.json usingComponents 缺失 → MP 整块不渲染（fluid-system-demo 侧边栏/容器全丢）。
 * HTML 注释与 <script>/<style> 整块跳过（其中可能含 '<template>' 字面量文本——首配对正则同样误取）
 */
function extractTemplateBody(src: string): string {
  const n = src.length
  let i = 0
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) return ''
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4)
      i = e < 0 ? n : e + 3
      continue
    }
    // <script ...> / <style ...> 整块跳过
    const block = /^<(script|style)\b/i.exec(src.slice(lt, lt + 32))
    if (block) {
      const tag = block[1].toLowerCase()
      const end = src.toLowerCase().indexOf(`</${tag}`, lt + block[0].length)
      if (end < 0) return ''
      const gt = src.indexOf('>', end)
      i = gt < 0 ? n : gt + 1
      continue
    }
    if (/^<template[\s>]/i.test(src.slice(lt, lt + 16))) {
      const gt = src.indexOf('>', lt)
      if (gt < 0) return ''
      let depth = 1
      let j = gt + 1
      while (j < n) {
        const l2 = src.indexOf('<', j)
        if (l2 < 0) return src.slice(gt + 1)
        if (src.startsWith('<!--', l2)) {
          const e = src.indexOf('-->', l2 + 4)
          j = e < 0 ? n : e + 3
          continue
        }
        const seg = src.slice(l2, l2 + 16)
        if (/^<\/template[\s>]/i.test(seg)) {
          depth--
          if (depth === 0) return src.slice(gt + 1, l2)
          j = l2 + '</template>'.length
          continue
        }
        if (/^<template[\s>]/i.test(seg)) {
          depth++
          const g2 = src.indexOf('>', l2)
          j = g2 < 0 ? n : g2 + 1
          continue
        }
        j = l2 + 1
      }
      return src.slice(gt + 1)
    }
    i = lt + 1
  }
  return ''
}

/**
 * 扫描页面模板中的自定义组件标签（非原生/HTML 标签）→ usingComponents 映射
 * 解析顺序：应用组件 <appRoot>/components/<tag>/index(.vue) → 框架内置组件 src/components/<tag>/index(.vue)
 * 路径：应用 /components/<tag>/index；框架 /proteus/<tag>/index（插件产物 rel 前缀 proteus/，与应用隔离）
 * config.rules.customTags 的标签是自定义映射（非组件），加入白名单
 */
function collectComponents(file: string, skipSemantic = false): Record<string, string> {
  const src = fs.readFileSync(file, 'utf-8')
  const tpl = extractTemplateBody(src)
  const customTags = new Set(Object.keys(config.rules?.customTags ?? {}))
  // ★#496 语义编译标签（仅页面——产物层展开为 flex 档位容器，不注入 usingComponents；组件模板保留运行时组件需注册）
  // ★#505 M3 批 3：语义跳过须与编译侧规则状态一致——fluid/semantic-grid 被禁用时页面 p-grid 回退运行时组件
  //   （产物保留 <p-grid> 标签）→ 必须注册 usingComponents；规则启用才按语义编译跳过（防禁用后半失效产物：
  //   wxml 引用 <p-grid> 而 page.json 不注册 → MP 整块不渲染）
  const gridRuleDisabled = (config.rules?.disabled ?? []).includes('fluid/semantic-grid')
  const semanticTags = skipSemantic && !gridRuleDisabled ? new Set(['p-grid']) : new Set()
  const used = new Set<string>()
  // 标签扫描跳过 HTML 注释块（注释里可能出现 <p-xxx> 示例文本——旧正则直接扫文本会把注释示例误当使用）
  let idx = 0
  while (idx < tpl.length) {
    const lt = tpl.indexOf('<', idx)
    if (lt < 0) break
    if (tpl.startsWith('<!--', lt)) {
      const e = tpl.indexOf('-->', lt + 4)
      idx = e < 0 ? tpl.length : e + 3
      continue
    }
    if (tpl.startsWith('</', lt)) {
      idx = lt + 2
      continue
    }
    const mm = /^([a-z][\w-]*)/.exec(tpl.slice(lt + 1))
    if (!mm) {
      idx = lt + 1
      continue
    }
    const tag = mm[1]
    if (!(NATIVE_MP_TAGS.has(tag) || HTML_TAGS.has(tag) || customTags.has(tag) || semanticTags.has(tag))) used.add(tag)
    idx = lt + 1 + mm[0].length
  }
  // ★2026-09-09 G-62 Canvas 通道：源码含**形状变化动画**的 SVG（cx/r/d/stroke-dashoffset 等）时，
  //   编译器会 lowering 为 <p-svg-canvas> 组件——源码模板里没有该标签，须在此补注册。
  if (/<(?:svg|circle|rect|ellipse|path|line|polyline|polygon)[\s>][\s\S]*?<animate\b/i.test(tpl)) {
    const shapeAnim = /<animate\s[^>]*attributeName\s*=\s*["'](cx|cy|r|rx|ry|x|y|width|height|d|points|stroke-dashoffset|stroke-dasharray)["']/i
    if (shapeAnim.test(tpl)) used.add('p-svg-canvas')
  }
  const out: Record<string, string> = {}
  for (const tag of used) {
    // 应用组件优先
    const appCandidates = [path.join(APP_DIR, 'components', tag, 'index.vue'), path.join(APP_DIR, 'components', `${tag}.vue`)]
    const appFound = appCandidates.find((c) => fs.existsSync(c))
    if (appFound) {
      out[tag] = `/components/${tag}/index`
      continue
    }
    // 框架内置组件（FW_COMPONENTS/）：产物 rel 前缀 proteus/
    const fwCandidates = [path.join(FW_COMPONENTS, tag, 'index.vue'), path.join(FW_COMPONENTS, `${tag}.vue`)]
    const fwFound = fwCandidates.find((c) => fs.existsSync(c))
    if (fwFound) {
      out[tag] = `/proteus/${tag}/index`
      continue
    }
    console.warn(`[gen-routes] ${file} 使用了组件 <${tag}>，但未找到 ${appCandidates.join(' 或 ')} 或框架组件 ${fwCandidates.join(' 或 ')}`)
  }
  return out
}

/** 生成每页 page.json（P2-3：Skyline 配置，renderer 随 skyline 开关） */
function writePageJsons(pages: PageInfo[]): void {
  for (const p of pages) {
    const pageJson: Record<string, unknown> = {}
    if (config.skyline) {
      pageJson.renderer = 'skyline'
      pageJson.componentFramework = 'glass-easel' // Skyline 强制要求（真机校验：需同时设置）
    }
    // <route> 块 pageJson 扩展（如半屏页透明背景 backgroundColorContent）
    if (p.pageJson) Object.assign(pageJson, p.pageJson)
    // 组件系统（v0.3）：扫描模板中的自定义组件标签 → usingComponents 注入
    // ★#496 页面源 p-grid 已被语义编译（产物无标签）——skipSemantic 排除；组件文件需注册保留
    const components = collectComponents(p.file, true)
    if (Object.keys(components).length) pageJson.usingComponents = components
    // 注意：不再输出 customRouteKeyName —— 真机校验报"无效的 page.json [customRouteKeyName]"；
    // 自定义路由仅靠 wx.navigateTo({ routeType }) + 已注册 builder 生效，page.json 无需声明
    const outFile = path.join(OUT_DIR, p.mpPath + '.json')
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    fs.writeFileSync(outFile, JSON.stringify(pageJson, null, 2) + '\n')
  }
  console.log(`[gen-routes] 已生成 ${pages.length} 个页面 page.json`)
}

/**
 * 组件声明（v0.3 尾 + 修复）：为每个组件生成 component.json——
 * ★修复：无嵌套组件也必须生成 { component: true }（微信要求组件必须有 json 声明，否则 usingComponents 报“未找到组件”）；
 * 有嵌套时附加 usingComponents（组件 A 的模板用组件 B 时声明 B；产物路径与插件 rel 一致：
 * 应用组件 /components/...、框架组件 /proteus/...）
 */
function writeComponentJsons(): void {
  const roots = [
    { dir: path.join(APP_DIR, 'components'), prefix: 'components' },
    { dir: FW_COMPONENTS, prefix: 'proteus' },
  ]
  let count = 0
  for (const { dir, prefix } of roots) {
    if (!fs.existsSync(dir)) continue
    for (const f of walkVueFiles(dir)) {
      const rel = path.relative(dir, f).replace(/\\/g, '/').replace(/\.vue$/, '')
      const comps = collectComponents(f)
      const outFile = path.join(OUT_DIR, prefix, `${rel}.json`)
      fs.mkdirSync(path.dirname(outFile), { recursive: true })
      const json: Record<string, unknown> = { component: true }
      // ★2026-09-07 Skyline 组件声明遗漏修复：页面 json 有 componentFramework: glass-easel，组件 json 此前漏加——
      //   真机/模拟器实证：p-popover 组件内 <root-portal>（官方悬浮层）无该声明不渲染（V2 无效）；
      //   补声明后组件内 portal/悬浮渲染正常（V4 绿块可见）。Skyline 下组件与页面同需该声明。
      if (config.skyline) json.componentFramework = 'glass-easel'
      // ★样式穿透（2026-08 真机实测）：默认 styleIsolation: isolated 使页面 wxss 无法作用于组件内部——
      //   <p-view class="box"> 的 class 虽被微信合并到组件根节点，但页面 .box.data-v-xxx 规则进不去 → 外层容器样式失效。
      //   apply-shared：页面样式可作用组件（等价 Vue 父组件 scoped 样式作用于子组件根节点语义）；组件 wxss 不反向影响页面。
      //   Web 端全局样式本就会作用于组件内部，apply-shared 使 MP 行为与 Web 一致
      json.styleIsolation = 'apply-shared'
      if (Object.keys(comps).length) json.usingComponents = comps
      fs.writeFileSync(outFile, JSON.stringify(json, null, 2) + '\n')
      count++
    }
  }
  if (count) console.log(`[gen-routes] 已生成 ${count} 个组件 component.json（component 声明 + usingComponents 嵌套）`)
}

/**
 * 生成 dist/mp-weixin/project.config.json（★小程序工程配置：产物可导入微信开发者工具 + automator 前置）
 * appid 来自 proteus.config.ts（占位 wx0000000000 需替换为真实 AppID 才能在真机/automator 使用）
 */
function writeProjectConfig(): void {
  const projectName = path.basename(ROOT).replace(/[^\w.-]/g, '-')
  const projectConfig = {
    compileType: 'miniprogram',
    appid: config.appid,
    projectname: projectName,
    // ★2026-09-09 真机复测实证：skyline 项目需 IDE 级 skylineRenderEnable 开关，否则模拟器回落 WebView
    //   （getSkylineInfoSync().isSupported=false / reason=a-b test not enabled——产物 json 声明 renderer:skyline 不够）。
    //   写入 project.config.json（非 private——private 每次重建被清，实测开关丢失后复测全是 WebView 假绿/假红）。
    setting: { minifyWXML: true, urlCheck: false, ...(config.skyline ? { skylineRenderEnable: true } : {}) },
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'project.config.json'), JSON.stringify(projectConfig, null, 2) + '\n')
  console.log(`[gen-routes] 已生成 dist/mp-weixin/project.config.json（appid=${config.appid}，projectname=${projectName}）`)
}

  // ---- 主流程 ----
  fs.rmSync(OUT_DIR, { recursive: true, force: true }) // 清理陈旧产物
  const pages = scanPages()
  const routes = buildRoutes(pages)
  validate(pages, routes)
  writeAutoRoutes(routes)
  writeAppJson(pages, routes)
  writePageJsons(pages)
  writeComponentJsons()
  writeProjectConfig()
  console.log(`[gen-routes] 完成：共 ${pages.length} 个页面`)
}
