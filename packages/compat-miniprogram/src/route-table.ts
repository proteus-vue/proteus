// packages/compat-miniprogram/src/route-table.ts
// ★G-32 B6（proteus-semantic-primitives-plus-plan batches.md §1 B6——迁移工具链）：路由名表
//   从旧小程序源码的 wx 导航调用（navigateTo/switchTab/reLaunch/redirectTo）收集路由目标
//   → 生成「路由名候选表」：`router.push({ name, params })` 需要的 name（wx.navigateTo → router.push 语义化桥）
//   命名对齐 router 包惯例（packages/router/src/scan.ts deriveNameFromFile：index 归并目录名、kebab 路径）：
//   产出小驼峰 name（schema NAME_RE ^[a-z][a-zA-Z0-9]*$——显式路由名规范）
//   纯函数可单测；幂等

/** wx 导航 API（目标收集面） */
export const NAVIGATION_APIS = ['navigateTo', 'switchTab', 'reLaunch', 'redirectTo'] as const

export interface RouteTarget {
  /** 导航 API 名（wx.navigateTo 等） */
  api: string
  /** 原始 url（可能带 query） */
  url: string
  /** 路径（去 query / 去 .vue / 去前导斜杠） */
  path: string
}

/** 路径 → 路由名候选（小驼峰；index 归并目录名——对齐 deriveNameFromFile + NAME_RE） */
export function routeNameFromPath(path: string): string {
  const clean = path.replace(/^\/+/, '').replace(/\.vue$/, '').split('?')[0]
  let segs = clean.split('/').filter(Boolean)
  // 剥 pages/subpackages 前缀（与 deriveNameFromFile 的 rel 语义一致）
  if (segs[0] === 'pages' || segs[0] === 'subpackages') segs = segs.slice(1)
  if (segs.length === 0) return 'index'
  if (segs[segs.length - 1] === 'index') segs = segs.slice(0, -1)
  if (segs.length === 0) return 'index'
  // 全路径 kebab（user/profile → user-profile——deriveNameFromFile 惯例）→ 小驼峰
  const kebab = segs.join('-')
  return kebab
    .split('-')
    .filter(Boolean)
    .map((s, i) => (i === 0 ? s.toLowerCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()))
    .join('')
}

/** 从单份源码收集导航目标（纯函数） */
export function collectRouteTargets(source: string): RouteTarget[] {
  const out: RouteTarget[] = []
  // wx.navigateTo({ url: '/pages/x/y?a=1' }) 等——url 字符串字面量
  const re = /\bwx\.(navigateTo|switchTab|reLaunch|redirectTo)\s*\(\s*\{[^}]*?\burl\s*:\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const url = m[2]
    const path = url.split('?')[0].replace(/^\/+/, '')
    out.push({ api: m[1], url, path })
  }
  return out
}

/** 批量源码 → 去重排序路由名表（按 path） */
export function buildRouteTable(sources: string[]): Array<{ path: string; name: string; apis: string[] }> {
  const byPath = new Map<string, { path: string; name: string; apis: Set<string> }>()
  for (const src of sources) {
    for (const t of collectRouteTargets(src)) {
      const entry = byPath.get(t.path)
      if (entry) entry.apis.add(t.api)
      else byPath.set(t.path, { path: t.path, name: routeNameFromPath(t.path), apis: new Set([t.api]) })
    }
  }
  return [...byPath.values()]
    .map((e) => ({ path: e.path, name: e.name, apis: [...e.apis].sort() }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}