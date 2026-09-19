// packages/compat-miniprogram/src/route-table.ts
// ★G-32 B6（proteus-semantic-primitives-plus-plan batches.md §1 B6——迁移工具链）：路由名表
//   从旧小程序源码的 wx 导航调用（navigateTo/switchTab/reLaunch/redirectTo）收集路由目标
//   → 生成「路由名候选表」：`router.push({ name, params })` 需要的 name（wx.navigateTo → router.push 语义化桥）
//   ★命名与 router 包 deriveNameFromFile **逐条同规则**（index 归并目录名、剥 pages/subpackages 前缀、`/`→`-`）：
//   产出 **kebab** name（如 pages/user/profile → `user-profile`）——这正是 derivePath 模式下框架
//   gen-routes / scanRoutes 真实写进 routeMap 的 name（实测产物 auto-routes.js：`builtin-components-demo`）。
//   ★2026-09-19 修正（本文件此前 bug）：原实现产出小驼峰（userProfile），依据是 schema NAME_RE
//   （`^[a-z][a-zA-Z0-9]*$`）——但 NAME_RE 约束的是**显式 `<route name>`**；derivePath 推导名走
//   NAME_KEBAB_RE（kebab）。规则抄错 → codemod 打印的 name 在 routeMap 里查不到（死引用）。
//   一致性由 tests/route-table.test.ts 跨包断言（routeNameFromPath ≡ deriveNameFromFile）机器守住。
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

/**
 * 路由路径 → 路由名（与 packages/router/src/scan.ts deriveNameFromFile **同规则**，见文件头）：
 * index 归并目录名 · 剥 pages/subpackages 前缀 · `/`→`-`（kebab，非小驼峰）
 */
export function routeNameFromPath(path: string): string {
  const clean = path.split('?')[0].replace(/^\/+/, '').replace(/\.vue$/, '')
  const segs = clean.split('/').filter(Boolean)
  const base = segs[segs.length - 1] ?? ''
  if (base === 'index') {
    const dir = segs.slice(0, -1).join('/')
    const stripped = dir.replace(/^(pages|subpackages)(\/|$)/, '').replace(/\/$/, '')
    return stripped ? stripped.replace(/\//g, '-') : 'index'
  }
  return clean.replace(/^(pages|subpackages)\//, '').replace(/\//g, '-')
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