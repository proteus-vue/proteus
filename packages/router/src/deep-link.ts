// packages/router/src/deep-link.ts
// ★router-plus G-32 M4：Deep Link / Universal Link（04-deep-link.md）
// 统一解析：resolveDeepLink(url) → ResolvedRoute（path + params）+ 冷启动栈构造
// ★纯逻辑零依赖（手写 URL 解析，不依赖 URL 类——小程序无全局 URL，ES5 安全：禁 ?. ?? 展开 解构）
import type { StackSemantic } from './navigation'

/** deepLink 配置（04 §5，defineProteus router.deepLink） */
export interface DeepLinkConfig {
  scheme?: string
  host?: string
  universalLinks?: string[]
  /** pattern → 路由 path 映射（'/product/:id' → '/detail/:id'） */
  routes?: Array<{ pattern: string; path: string; stack?: StackSemantic }>
}

export interface ParsedDeepLink {
  scheme: string
  host: string
  pathname: string
  query: Record<string, string>
}

export interface ResolvedRoute {
  /** 目标路由 path（pattern 映射后） */
  path: string
  params: Record<string, string>
  query: Record<string, string>
  /** 转场语义（缺省 push） */
  stack: StackSemantic
}

/** 手写 URL 解析（deep-link://host/path?query 或 https://host/path?query） */
export function parseDeepLinkUrl(url: string): ParsedDeepLink {
  const schemeEnd = url.indexOf('://')
  const scheme = schemeEnd >= 0 ? url.slice(0, schemeEnd) : ''
  const rest = schemeEnd >= 0 ? url.slice(schemeEnd + 3) : url
  const queryIdx = rest.indexOf('?')
  const pathAndHost = queryIdx >= 0 ? rest.slice(0, queryIdx) : rest
  const queryStr = queryIdx >= 0 ? rest.slice(queryIdx + 1) : ''

  const firstSlash = pathAndHost.indexOf('/')
  const host = firstSlash >= 0 ? pathAndHost.slice(0, firstSlash) : pathAndHost
  const pathname = firstSlash >= 0 ? pathAndHost.slice(firstSlash) : '/'

  const query: Record<string, string> = {}
  if (queryStr) {
    for (const pair of queryStr.split('&')) {
      const eq = pair.indexOf('=')
      if (eq > 0) query[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1))
    }
  }
  return { scheme, host, pathname, query }
}

/** pattern 匹配：'/product/:id' → pathname '/product/42' → params { id: '42' }；不匹配返回 null */
export function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const pSegs = pattern.split('/')
  const uSegs = pathname.split('/')
  if (pSegs.length !== uSegs.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pSegs.length; i++) {
    const p = pSegs[i]
    const u = uSegs[i]
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(u)
    } else if (p !== u) {
      return null
    }
  }
  return params
}

/** 白名单校验（04 §4 安全）：scheme + host 必须匹配配置（universalLinks 含 https 通配） */
export function isDeepLinkAllowed(parsed: ParsedDeepLink, config: DeepLinkConfig): boolean {
  if (config.scheme && parsed.scheme === config.scheme) {
    if (!config.host) return true
    return parsed.host === config.host || !parsed.host // custom scheme 无 host 允许
  }
  // universal link（https）：host 通配匹配
  if (parsed.scheme === 'https' && config.universalLinks) {
    for (const ul of config.universalLinks) {
      const hostRe = new RegExp('^https://' + (ul.includes('://') ? ul.slice(ul.indexOf('://') + 3) : ul).replace('*', '[^/]*').replace(/\//g, '\\/'))
      if (hostRe.test(parsed.scheme + '://' + parsed.host + parsed.pathname)) return true
    }
  }
  return false
}

/** 解析 Deep Link → ResolvedRoute（白名单 + pattern 匹配）；不匹配返回 null */
export function resolveDeepLink(url: string, config: DeepLinkConfig): ResolvedRoute | null {
  const parsed = parseDeepLinkUrl(url)
  if (!isDeepLinkAllowed(parsed, config)) return null
  for (const r of config.routes ?? []) {
    const params = matchPattern(r.pattern, parsed.pathname)
    if (params !== null) {
      return { path: r.path, params, query: parsed.query, stack: r.stack ?? 'push' }
    }
  }
  return null
}

/** 冷启动栈构造（04 §3）：resolve 结果 + 应用路由表 → 初始路由栈（热启动直接 push 栈顶） */
export function buildColdStartStack(routePath: string, allPaths: string[]): string[] {
  // 最深层路由 path 的祖先链（'/a/b/c' → ['/a', '/a/b', '/a/b/c']）；祖先必须在 allPaths 中存在
  const stack: string[] = []
  const segs = routePath.split('/').filter(Boolean)
  let cur = ''
  for (const seg of segs) {
    cur += '/' + seg
    if (allPaths.indexOf(cur) >= 0) stack.push(cur)
  }
  return stack.length > 0 ? stack : [routePath]
}
