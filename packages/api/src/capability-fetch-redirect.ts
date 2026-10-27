// packages/api/src/capability-fetch-redirect.ts
// ★★★决策 #1134：**重定向策略层**（跟随 / 不跟随 / 逐步拦截）——跨端同一份。
//
// 【为什么策略在 JS 而不在宿主（架构取舍）】
//   业务要的不是"能跟随"，是**能看见每一跳并决定跟不跟**：
//     · 安全：API 返回 302 到第三方域时，若宿主自动跟随，`Authorization` 会被带过去（open-redirect
//       凭据泄露的典型形态），而业务侧**完全无感**（只拿到最终响应）。
//     · 观测：埋点/风控要记录"那次请求跳了几跳、跳到哪"。
//     · 控制：跨域跳转、http→https 升级、短链解析，各有各的策略。
//   这些**全是策略**，必须能跑在 JS 里。若放宿主，要么"网络线程回调 JS"（违反线程纪律），
//   要么两端各实现一套规则（必然分叉）。
//   ⇒ 宿主只做一条最小能力：`redirectManual` ⇒ **不跟随**（#903 加 `Redirect` tag）。
//     跟随循环、上限、拦截判定都在本文件。
//
// 【★与 wx.request 的关系】微信不暴露重定向控制（隐式跟随，业务看不见）。
//   我们**对齐能力面并超出**：`redirect: 'manual'` 语义对齐 fetch 标准，`onRedirect` 是框架增量。
//
// 【诚实边界】
//   ① 每跳一次 = 一次完整请求（含排队）；`maxRedirects` 计的是**跳数**不是总时长。
//   ② 3xx 的 body 不保留（业务要的是 status + Location；省一次内存拷贝）。
//   ③ MP 端**做不到**：`wx.request` 不支持不跟随 ⇒ `fetch.unsupported`（如实，不假装）。
//      Web 端用原生 `redirect: 'manual'`（无需宿主配合）。

import type { FetchConfig } from './capability-fetch-types'
import type { FetchMeta } from './capability-fetch-types'

/** 单跳记录（`onRedirect` 的入参、`FetchResult.redirects` 的元素）。 */
export interface RedirectHop {
  /** 本跳的状态码（301 / 302 / 303 / 307 / 308…） */
  status: number
  /** 本跳请求的 URL（跳转**前**） */
  from: string
  /** 目标 URL（来自 `Location`，已按 RFC 3986 相对解析） */
  to: string
  /** 方法是否被改写（303 ⇒ 通常改 GET；301/302 按浏览器惯例也改 GET） */
  methodChanged: boolean
}

/** `onRedirect` 的返回值：继续跟随 / 拒绝 / 改写目标。 */
export type RedirectDecision =
  | { action: 'follow'; url?: string }
  | { action: 'stop'; reason?: string }

/**
 * 把 `Location` 解析成绝对 URL（RFC 3986 相对引用）。
 *
 * ★为什么不直接用 `new URL(location, base)`：App 精简引擎（QuickJS/JSC 精简版）**没有 URL 构造器**
 *   （与 #1071「无 TextDecoder」、#1095「无 TextEncoder」同族）。这里只覆盖 Location 的三种实际形态：
 *     ① 绝对（`http(s)://…`）② 根相对（`/path`）③ 相对（`path` / `./path` / `../path`）
 *   不处理协议相对（`//host/path`）之外的晦涩形态（如 `?query` 仅改查询串）——那两种也支持，见下。
 *   ★排障：若真出现别的形态，会走 throw（不静默拼错 URL）。
 */
export function resolveLocation(base: string, location: string): string {
  const loc = String(location ?? '').trim()
  if (!loc) throw new Error('重定向响应缺少 Location')
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(loc)) return loc // ① 绝对
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)([^?#]*)/.exec(base)
  if (!m) throw new Error(`无法解析基准 URL：${base}`)
  const scheme = m[1]
  const authority = m[2]
  const basePath = m[3] || '/'
  // 协议相对：`//host/path` ⇒ 沿用 base 的 scheme
  if (loc.startsWith('//')) return `${scheme}:${loc}`
  // 仅查询串：`?a=1`
  if (loc.startsWith('?')) return `${scheme}://${authority}${basePath}${loc}`
  // 仅片段：`#frag`（极少见；保持原路径）
  if (loc.startsWith('#')) return `${scheme}://${authority}${basePath}${loc}`
  const baseParen = base.indexOf('?')
  let cleanBase = baseParen >= 0 ? base.slice(0, baseParen) : base
  // ② 根相对
  if (loc.startsWith('/')) return `${scheme}://${authority}${loc}`
  // ③ 相对：以 base 的最后一段目录为基准
  const dirEnd = cleanBase.lastIndexOf('/')
  let path = dirEnd >= 0 ? cleanBase.slice(0, dirEnd + 1) : `${scheme}://${authority}/`
  if (!path.startsWith('http')) path = `${scheme}://${authority}${path}`
  const segs = (path.slice(`${scheme}://${authority}`.length) + loc).split('/')
  const outSegs: string[] = []
  for (const s of segs) {
    if (s === '.') continue
    if (s === '..') outSegs.pop()
    else outSegs.push(s)
  }
  return `${scheme}://${authority}/${outSegs.join('/')}`.replace(/\/{2,}/g, '/').replace(`${scheme}:/`, `${scheme}://`)
}

/** 该状态码是否可跟随（3xx 且不是 304 Not Modified——304 是缓存语义，不该跳）。 */
export function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/**
 * 跟随一跳后**方法是否被改写**。
 *
 * ★规则来自 RFC 9110 + 浏览器惯例（本仓纪律：**基准 = 标准真值**，不是"三端各自看着办"）：
 *   · 303 See Other ⇒ **一律**改 GET（语义就是"去看另一个资源"）；
 *   · 301/302 ⇒ **仅 POST 改 GET**（历史惯例；其它方法保持不变）；
 *   · 307/308 ⇒ **不改**（显式要求保持方法与 body）。
 */
export function methodAfterRedirect(status: number, method: string): { method: string; changed: boolean } {
  const m = (method || 'GET').toUpperCase()
  if (status === 303) return m === 'GET' ? { method: 'GET', changed: false } : { method: 'GET', changed: true }
  if ((status === 301 || status === 302) && m === 'POST') return { method: 'GET', changed: true }
  return { method: m, changed: false }
}

/** 取响应头里的 Location（大小写不敏感——各端 header 键大小写不统一）。 */
export function headerOf(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const lower = name.toLowerCase()
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k]
  }
  return undefined
}

/**
 * 凭据类请求头（**唯一定义处**）。
 *
 * ★★★#1257 安全基线：这张清单有两个消费方，必须是同一份：
 *   ① 跨源跳转时**剥掉**（{@link nextHopConfig}）；
 *   ② 判断"本次请求带凭据 ⇒ **必须由 JS 逐跳跟随**"（{@link hasCredentialHeaders}）。
 *   两处各写一份的后果是"剥的名字与判的名字不一致"——那种分叉没有判据能发现。
 */
export const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'cookie2', 'proxy-authorization'] as const

/** 请求头里是否带凭据（大小写不敏感）。 */
export function hasCredentialHeaders(headers: Record<string, string> | undefined): boolean {
  if (!headers) return false
  for (const k of Object.keys(headers)) {
    if ((CREDENTIAL_HEADERS as readonly string[]).includes(k.toLowerCase())) return true
  }
  return false
}

/**
 * 计算下一跳的配置（保留 headers 与超时；按 RFC 决定方法/body）。
 *
 * ★★**跨域时剥离凭据相关头**（安全底线，不是可选优化）：跳转到**不同 origin** 时，
 *   必须去掉 `Authorization` / `Cookie` / `Cookie2` / `Proxy-Authorization`（浏览器与 fetch 标准同样处理）。
 *   若保留，就等于把凭据送给重定向目标——open-redirect 危害的**核心**。
 */
export function nextHopConfig(
  config: FetchConfig,
  hop: RedirectHop,
  nextUrl: string,
): FetchConfig {
  const stripCreds = !sameOrigin(hop.from, nextUrl)
  const headers: Record<string, string> = { ...(config.headers ?? {}) }
  if (stripCreds) {
    for (const k of Object.keys(headers)) {
      if ((CREDENTIAL_HEADERS as readonly string[]).includes(k.toLowerCase())) {
        delete headers[k]
      }
    }
  }
  const next: FetchConfig = { ...config, headers }
  if (hop.methodChanged) {
    next.method = 'GET'
    // ★方法改成 GET 就必须丢掉 body（GET 带 body 在各端行为不一致）
    delete (next as { data?: unknown }).data
    delete (next as { upload?: unknown }).upload
    delete (next as { contentType?: unknown }).contentType
  }
  return next
}

/** 同源判定（scheme + host + port）。 */
export function sameOrigin(a: string, b: string): boolean {
  const pa = originOf(a)
  const pb = originOf(b)
  return pa !== null && pa === pb
}

function originOf(u: string): string | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)/.exec(u)
  if (!m) return null
  const scheme = m[1].toLowerCase()
  let authority = m[2].toLowerCase()
  // 默认端口归一（:80 / :443 与省略等价）
  authority = authority.replace(/:80$/, '').replace(/:443$/, '')
  return `${scheme}://${authority}`
}

/** 跟随循环的记账（放进 `FetchMeta`，让业务/排障能看到跳了几跳）。 */
export interface RedirectTrace {
  hops: RedirectHop[]
  /** 是否因为超过 `maxRedirects` 而停（真实错误，不是成功） */
  exceeded: boolean
  /** 是否被 `onRedirect` 主动停止 */
  stopped: boolean
  stopReason?: string
}

/** 供 `FetchMeta` 携带（可选字段，向后兼容）。 */
export interface FetchMetaWithRedirect extends FetchMeta {
  redirects?: RedirectTrace
}
