// packages/desktop/src/deeplink.ts
// ★G-24 B2（proteus-semantic-primitives-plan 04-system-integration §深链）：p-deeplink 纯逻辑
//   · parseDeepLink(url)：scheme://host/path?query 归一（相对 /path 亦支持——路由内深链）
//   · matchDeepLink(pattern, url)：'proteus://user/:id' 或 '/user/:id' 参数化匹配 → { matched, params }
//   Compiler 侧：iOS Associated Domains + apple-app-site-association / Android intent-filter / 鸿蒙 Want 声明（04 §4）
//   运行期：路由配置天然支持（G-17 router.onDeepLink）——本模块提供匹配纯逻辑供路由/宿主接线
//   纯函数零依赖；非法 URL → null（不抛）
export interface DeepLink {
  scheme: string
  host: string
  path: string[]
  query: Record<string, string>
  raw: string
}

export interface DeepLinkMatch {
  matched: boolean
  params: Record<string, string>
}

/** 解析深链 URL：'proteus://user/profile?id=1' → { scheme, host, path, query }；相对 '/user/1' → scheme/host 空 */
export function parseDeepLink(url: string): DeepLink | null {
  if (!url || typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!trimmed) return null
  let rest = trimmed
  let scheme = ''
  let host = ''
  // scheme://（仅字母开头协议——防 'http:foo' 误判）
  const proto = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(trimmed)
  if (proto) {
    scheme = proto[1].toLowerCase()
    rest = trimmed.slice(proto[0].length)
  } else if (!trimmed.startsWith('/')) {
    return null // 既无协议又非 / 开头 → 非法深链
  }
  // host（仅 scheme 形式——rest 首段到 /）
  if (scheme) {
    const slash = rest.indexOf('/')
    if (slash >= 0) {
      host = rest.slice(0, slash)
      rest = rest.slice(slash)
    } else {
      host = rest
      rest = ''
    }
  }
  // query（? 后 k=v&… decode）
  let query: Record<string, string> = {}
  const qIdx = rest.indexOf('?')
  let pathPart = rest
  if (qIdx >= 0) {
    pathPart = rest.slice(0, qIdx)
    const qs = rest.slice(qIdx + 1)
    for (const seg of qs.split('&')) {
      if (!seg) continue
      const eq = seg.indexOf('=')
      if (eq < 0) {
        query[decodeURIComponent(seg)] = ''
      } else {
        query[decodeURIComponent(seg.slice(0, eq))] = decodeURIComponent(seg.slice(eq + 1))
      }
    }
  }
  const path = pathPart.split('/').filter((s) => s.length > 0).map((s) => decodeURIComponent(s))
  return { scheme, host, path, query, raw: trimmed }
}

/** 参数化匹配：':name' 段捕获；字面量段须相等；scheme/host 缺省不约束（相对 path 模式通配任意 scheme） */
export function matchDeepLink(pattern: string, url: string): DeepLinkMatch {
  const link = parseDeepLink(url)
  if (!link) return { matched: false, params: {} }
  const parsedPattern = parseDeepLink(pattern)
  if (!parsedPattern) return { matched: false, params: {} }
  if (parsedPattern.scheme && parsedPattern.scheme !== link.scheme) return { matched: false, params: {} }
  if (parsedPattern.host && parsedPattern.host !== link.host) return { matched: false, params: {} }
  if (parsedPattern.path.length !== link.path.length) return { matched: false, params: {} }
  const params: Record<string, string> = {}
  for (let i = 0; i < parsedPattern.path.length; i++) {
    const seg = parsedPattern.path[i]
    if (seg.startsWith(':')) {
      params[seg.slice(1)] = link.path[i]
    } else if (seg !== link.path[i]) {
      return { matched: false, params: {} }
    }
  }
  return { matched: true, params }
}
