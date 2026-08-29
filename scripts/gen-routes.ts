// scripts/gen-routes.ts
// ============================================================
// 编译期路由表生成器（P2-2 / P2-3）
//
// 输入：proteus.config.ts 的 pagesDir / subPackages / skyline
// 输出：
//   1. src/router/auto-routes.ts（路由表，AUTO-GENERATED，勿手动编辑）
//   2. dist/mp-weixin/app.json（页面声明 + 分包 + window + tabBar）
//   3. dist/mp-weixin/**/<page>.json（每页 Skyline 配置）
//
// 运行：tsx scripts/gen-routes.ts（dev:mp / build:mp 前置步骤）
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../proteus.config'
import type { RouteRecord, RouteMeta } from '../src/router/types'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 应用根目录（页面/入口所在目录，从 pagesDir 推导：examples/pages → examples）
const APP_DIR = path.resolve(ROOT, path.dirname(config.pagesDir))
const OUT_DIR = path.join(ROOT, 'dist', 'mp-weixin')

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
}

/** 递归收集目录下所有 .vue 文件（跳过隐藏目录） */
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
 * 文件路径 → 命名路由（kebab-case）
 * - pages/index.vue            → "index"
 * - pages/user/index.vue       → "user"（目录名）
 * - pages/user/profile.vue     → "user-profile"
 * - subpackages/order/pages/list.vue → "order-pages-list"
 */
function toRouteName(relSrc: string): string {
  const base = relSrc.split('/').pop()!
  if (base === 'index') {
    const dir = relSrc.slice(0, relSrc.lastIndexOf('/')) // 如 pages/user
    const stripped = dir.replace(/^(pages|subpackages)(\/|$)/, '').replace(/\/$/, '')
    return stripped ? stripped.replace(/\//g, '-') : 'index'
  }
  const stripped = relSrc.replace(/^(pages|subpackages)\//, '')
  return stripped.replace(/\//g, '-')
}

/** 解析 .vue 的 <route> 块（JSON），提取 meta / customRouteKeyName / pageJson */
function parseRouteBlock(file: string): Pick<PageInfo, 'meta' | 'customRouteKeyName' | 'pageJson'> {
  const src = fs.readFileSync(file, 'utf-8')
  const m = src.match(/<route\b[^>]*>([\s\S]*?)<\/route>/i)
  if (!m) return {}
  try {
    const block = JSON.parse(m[1].trim()) as {
      meta?: RouteMeta
      customRouteKeyName?: string
      pageJson?: Record<string, unknown>
    }
    return { meta: block.meta, customRouteKeyName: block.customRouteKeyName, pageJson: block.pageJson }
  } catch (err) {
    console.warn(`[gen-routes] ${file} 的 <route> 块不是合法 JSON，已忽略：${(err as Error).message}`)
    return {}
  }
}

/** 扫描页面集合（主包 + 分包） */
function scanPages(): PageInfo[] {
  const pages: PageInfo[] = []

  // 主包：pagesDir
  for (const file of walkVueFiles(path.join(ROOT, config.pagesDir))) {
    const relSrc = path.relative(APP_DIR, file).replace(/\\/g, '/').replace(/\.vue$/, '')
    pages.push({ file, relSrc, mpPath: relSrc, ...parseRouteBlock(file) })
  }

  // 分包：subPackages[].root
  for (const sp of config.subPackages ?? []) {
    const spRootAbs = path.join(ROOT, sp.root)
    const spName = sp.name ?? path.basename(sp.root)
    for (const file of walkVueFiles(spRootAbs)) {
      const relSrc = path.relative(APP_DIR, file).replace(/\\/g, '/').replace(/\.vue$/, '')
      const relInSub = path.relative(spRootAbs, file).replace(/\\/g, '/').replace(/\.vue$/, '')
      pages.push({ file, relSrc, mpPath: relSrc, subPackage: spName, relInSub, ...parseRouteBlock(file) })
    }
  }

  return pages
}

/** 组装路由记录（含父子关系：同目录存在 index.vue 时为其子路由） */
function buildRoutes(pages: PageInfo[]): RouteRecord[] {
  const nameByRel = new Map(pages.map(p => [p.relSrc, toRouteName(p.relSrc)]))

  const routes: RouteRecord[] = pages.map(p => {
    const r: RouteRecord = {
      name: nameByRel.get(p.relSrc)!,
      path: p.mpPath,
      // 相对 RouterView 所在目录（{appDir}/router）的路径，Web 端 import.meta.glob 按此匹配
      component: path.relative(path.join(APP_DIR, 'router'), p.file).replace(/\\/g, '/'),
    }
    if (p.subPackage) r.subPackage = p.subPackage
    if (p.meta && Object.keys(p.meta).length > 0) r.meta = p.meta
    if (p.customRouteKeyName) r.customRouteKeyName = p.customRouteKeyName
    return r
  })

  // 父子关系：src/pages/user/profile.vue → parent = src/pages/user/index.vue 的 name（若存在）
  for (const p of pages) {
    if (p.relSrc.endsWith('/index') || p.relSrc === 'index') continue
    const dirIndex = p.relSrc.replace(/\/[^/]+$/, '/index')
    const parentName = nameByRel.get(dirIndex)
    if (parentName) {
      const r = routes.find(r => r.name === nameByRel.get(p.relSrc))
      if (r) r.parent = parentName
    }
  }

  return routes
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

/** 生成 src/router/auto-routes.ts */
function writeAutoRoutes(routes: RouteRecord[]): void {
  const lines = [
    '// src/router/auto-routes.ts',
    '// AUTO-GENERATED by scripts/gen-routes.ts. DO NOT EDIT.',
    "import type { RouteRecord } from './types'",
    '',
    'export const routes: RouteRecord[] = [',
    ...routes.map(formatRoute),
    ']',
    '',
    "export const tabRoutes: RouteRecord[] = routes.filter(r => r.meta?.isTab)",
    "export const routeMap: Record<string, RouteRecord> = routes.reduce((m, r) => { m[r.name] = r; return m }, {} as Record<string, RouteRecord>)",
    '',
  ]
  const outFile = path.join(ROOT, config.routesOutput)
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, lines.join('\n'))
  console.log(`[gen-routes] 已生成 ${path.relative(ROOT, outFile)}（${routes.length} 条路由）`)
}

/** 生成 dist/mp-weixin/app.json */
function writeAppJson(pages: PageInfo[], routes: RouteRecord[]): void {
  const mainPages = pages.filter(p => !p.subPackage).map(p => p.mpPath)

  const subPackages = (config.subPackages ?? [])
    .filter(sp => pages.some(p => p.subPackage === (sp.name ?? path.basename(sp.root))))
    .map(sp => {
      const spName = sp.name ?? path.basename(sp.root)
      return {
        root: path.relative(APP_DIR, path.join(ROOT, sp.root)).replace(/\\/g, '/'),
        ...(sp.name ? { name: sp.name } : {}),
        pages: pages.filter(p => p.subPackage === spName && p.relInSub).map(p => p.relInSub!),
      }
    })

  const windowConfig: Record<string, unknown> = { navigationStyle: 'custom' }
  // 注意：不在此处声明 window.renderer —— 真机校验报"无效的 app.json window[renderer]"，
  // Skyline 改为页面级声明（writePageJsons 输出各页 renderer: skyline）

  const tabRoutes = routes.filter(r => r.meta?.isTab)
  const appJson: Record<string, unknown> = { pages: mainPages }
  if (subPackages.length) appJson.subPackages = subPackages
  appJson.window = windowConfig
  // Skyline 渲染前提（微信平台校验）：页面 renderer=skyline 时必须声明 requiredComponents
  if (config.skyline) appJson.lazyCodeLoading = 'requiredComponents'
  // 平台硬边界：tabBar.list 至少 2 项（微信校验），不足时告警并忽略
  if (tabRoutes.length >= 2) {
    appJson.tabBar = {
      list: tabRoutes.map(r => ({ pagePath: r.path, text: (r.meta?.title as string) ?? r.name })),
    }
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
])
const HTML_TAGS = new Set([
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'br', 'ul', 'ol', 'li', 'section', 'header',
  'footer', 'main', 'aside', 'nav', 'article', 'strong', 'em', 'b', 'i', 'small', 'code', 'pre', 'select', 'option',
  'table', 'tr', 'td', 'th', 'form', 'label', 'tbody', 'thead', 'caption', 'figure', 'figcaption', 'details', 'summary',
])

/**
 * 扫描页面模板中的自定义组件标签（非原生/HTML 标签）→ usingComponents 映射
 * 解析顺序：应用组件 <appRoot>/components/<tag>/index(.vue) → 框架内置组件 src/components/<tag>/index(.vue)
 * 路径：应用 /components/<tag>/index；框架 /proteus/<tag>/index（插件产物 rel 前缀 proteus/，与应用隔离）
 * config.rules.customTags 的标签是自定义映射（非组件），加入白名单
 */
function collectComponents(file: string): Record<string, string> {
  const src = fs.readFileSync(file, 'utf-8')
  const tpl = src.match(/<template[^>]*>([\s\S]*?)<\/template>/i)?.[1] ?? ''
  const customTags = new Set(Object.keys(config.rules?.customTags ?? {}))
  const used = new Set<string>()
  const tagRe = /<([a-z][\w-]*)/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(tpl))) {
    const tag = m[1]
    if (tag.startsWith('!')) continue // 注释
    if (NATIVE_MP_TAGS.has(tag) || HTML_TAGS.has(tag) || customTags.has(tag)) continue
    used.add(tag)
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
    // 框架内置组件（src/components/）：产物 rel 前缀 proteus/
    const fwCandidates = [path.join(ROOT, 'src', 'components', tag, 'index.vue'), path.join(ROOT, 'src', 'components', `${tag}.vue`)]
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
    const components = collectComponents(p.file)
    if (Object.keys(components).length) pageJson.usingComponents = components
    // 注意：不再输出 customRouteKeyName —— 真机校验报"无效的 page.json [customRouteKeyName]"；
    // 自定义路由仅靠 wx.navigateTo({ routeType }) + 已注册 builder 生效，page.json 无需声明
    const outFile = path.join(OUT_DIR, p.mpPath + '.json')
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    fs.writeFileSync(outFile, JSON.stringify(pageJson, null, 2) + '\n')
  }
  console.log(`[gen-routes] 已生成 ${pages.length} 个页面 page.json`)
}

// ---- 主流程 ----
fs.rmSync(OUT_DIR, { recursive: true, force: true }) // 清理陈旧产物
const pages = scanPages()
const routes = buildRoutes(pages)
validate(pages, routes)
writeAutoRoutes(routes)
writeAppJson(pages, routes)
writePageJsons(pages)
console.log(`[gen-routes] 完成：共 ${pages.length} 个页面`)
