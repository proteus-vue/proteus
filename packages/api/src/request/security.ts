// packages/api/src/request/security.ts
// ★★★#1342 请求库的**安全通道层**：脱敏 · 请求签名 · 防重放。
//
// 【为什么这三件事放在「通道层」而不是「拦截器」】
//   拦截器是**业务的扩展点**——业务可以不加、可以顺序写错、可以在某条路径绕过。
//   而脱敏/签名/防重放是**平台合规要求**，必须由 client 强制执行：
//     · 业务拿不到原始 token（凭证托管在 `auth`）
//     · 业务改不了签名算法（client 统一注入）
//     · 业务关不掉脱敏（默认开，且日志/trace 都过这一层）
//   ⇒ 这是本库对痛点 #12/#13/#14 的答案：安全不能依赖调用方自觉。
//
// 【诚实边界】
//   · 签名**不持有密钥**：`sign` 由调用方注入（密钥属宿主/安全模块）。
//     本库只保证"签名被正确规范化并注入到每个发出的请求"，不保证算法强度。
//   · 防重放只在**客户端**加 timestamp/nonce；真正的窗口校验在服务端。
//     客户端能做的是"让每个请求独一无二且可验"，不能阻止服务端重放（那需要服务端存 nonce）。
//   · 脱敏是**尽力而为**的字段名匹配（不是内容识别）：业务若把 token 塞进 `X-Custom` 且
//     没加进黑名单，就漏了。⇒ 黑名单必须由平台方按自己的头约定配置完整。

import type { AntiReplayPolicy, RedactPolicy, RequestSigningPolicy } from './types'

/* ══════════════════════ ① 脱敏 ══════════════════════ */

/**
 * 默认要脱敏的 header（★大小写不敏感比较）。
 * ★这些是「一旦泄漏就能冒充用户/会话」的项——不含业务自定义头（那要平台方自己加）。
 */
export const DEFAULT_REDACT_HEADERS: readonly string[] = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
]

/**
 * 默认要脱敏的 body/query 字段名（★递归匹配，大小写不敏感）。
 * 依据：《个人信息保护法》常见敏感项 + 本仓已有的 DevTools 默认黑名单
 * （`packages/devtools-runtime/src/index.ts:46` 的 `password/token/authorization/idcard/phone`）。
 */
export const DEFAULT_REDACT_FIELDS: readonly string[] = [
  'password',
  'passwd',
  'pwd',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'secret',
  'apikey',
  'api_key',
  'idcard',
  'id_number',
  'phone',
  'mobile',
  'bankcard',
  'cardno',
  'cvv',
  'idempotencykey', // ★不脱敏内容，只在 trace 里遮住（审计仍记 key 的 hash 形态由业务决定）
]

const DEFAULT_MASK = '***'

/** 归一化脱敏配置（未传则用默认黑名单） */
export function normalizeRedact(policy?: RedactPolicy): {
  headers: Set<string>
  fields: Set<string>
  mask: string
} {
  const headers = new Set((policy?.headers ?? DEFAULT_REDACT_HEADERS).map((h) => h.toLowerCase()))
  const fields = new Set((policy?.fields ?? DEFAULT_REDACT_FIELDS).map((f) => f.toLowerCase()))
  return { headers, fields, mask: policy?.mask ?? DEFAULT_MASK }
}

/** 脱敏 header 表（返回新对象，不改原值） */
export function redactHeaders(
  headers: Record<string, string> | undefined,
  policy?: RedactPolicy,
): Record<string, string> {
  if (!headers) return {}
  const { headers: names, mask } = normalizeRedact(policy)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = names.has(k.toLowerCase()) ? mask : v
  }
  return out
}

/**
 * 脱敏 URL 的 query 值（★path 不脱敏：path 往往是资源标识，遮掉会失去排查价值；
 *   但 query 里常带 token/signature，必须遮）。
 */
export function redactUrl(rawUrl: string, policy?: RedactPolicy): string {
  const { fields, mask } = normalizeRedact(policy)
  const q = rawUrl.indexOf('?')
  if (q < 0) return rawUrl
  const base = rawUrl.slice(0, q)
  const query = rawUrl.slice(q + 1)
  const parts = query.split('&').map((pair) => {
    const eq = pair.indexOf('=')
    if (eq < 0) return pair
    const key = pair.slice(0, eq)
    if (fields.has(decodeURIComponent(key).toLowerCase())) return `${key}=${mask}`
    return pair
  })
  return `${base}?${parts.join('&')}`
}

/**
 * 深层脱敏 body（对象/数组递归；字符串原样）。
 * ★限制递归深度（防循环引用把递归打死）+ 数组只处理前 N 项（避免大 body 拖慢）。
 */
export function redactBody(value: unknown, policy?: RedactPolicy, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 6) return '[depth-limit]'
  if (value === null || typeof value !== 'object') return value
  const { fields, mask } = normalizeRedact(policy)
  if (seen.has(value as object)) return '[circular]'
  seen.add(value as object)
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((v) => redactBody(v, policy, depth + 1, seen))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = fields.has(k.toLowerCase()) ? mask : redactBody(v, policy, depth + 1, seen)
  }
  return out
}

/* ══════════════════════ ② 防重放 ══════════════════════ */

const DEFAULT_TS_HEADER = 'x-proteus-timestamp'
const DEFAULT_NONCE_HEADER = 'x-proteus-nonce'

/**
 * 生成防重放头（timestamp + nonce）。
 *
 * ★为什么 nonce 必须真随机：固定 nonce 等于没有防重放（服务端看到的都是同一个值）。
 * ★为什么 timestamp 用毫秒字符串：便于服务端做窗口判定；`Date.parse` 也能直接解。
 * ★顺序固定（timestamp 在前）——签名时按 `signedHeaders` 排序，但生成时保持稳定顺序，
 *   避免"头顺序不同 ⇒ 签名不同 ⇒ 服务端复算失败"。
 */
export function makeAntiReplayHeaders(
  policy: AntiReplayPolicy = {},
  now = Date.now(),
  rand: () => number = Math.random,
): Record<string, string> {
  const tsHeader = policy.timestampHeader ?? DEFAULT_TS_HEADER
  const nonceHeader = policy.nonceHeader ?? DEFAULT_NONCE_HEADER
  const nonce = `${now.toString(36)}${rand().toString(36).slice(2, 10)}`
  return { [tsHeader]: String(now), [nonceHeader]: nonce }
}

/* ══════════════════════ ③ 请求签名 ══════════════════════ */

const DEFAULT_SIG_HEADER = 'x-proteus-signature'

/**
 * ★★★规范化字符串（**服务端必须能复算出同一个串**，否则签名永远对不上）。
 *
 * 【规范（本库的契约，改动即破坏兼容）】
 * ```
 * METHOD\n
 * PATH_WITH_QUERY_NOT_REDACTED\n
 * HEADER_NAME_1:VALUE_1\n      ← 按名排序、名小写、值 trim
 * HEADER_NAME_2:VALUE_2\n
 * \n
 * BODY_STRING                    ← 原样的请求体字符串（空体为空串）
 * ```
 * ★注意用**未脱敏**的 URL/头/体参与签名（脱敏是给日志/trace 看的，签名必须对真实内容）。
 * ★body 用**原始字符串**而不是重新序列化的 JSON：序列化在两端（带/不带空格）可能不同。
 */
export function buildCanonicalString(input: {
  method: string
  url: string
  headers: Record<string, string>
  signedHeaders: string[]
  body: string
}): string {
  const picked = input.signedHeaders
    .map((h) => h.toLowerCase())
    .map((name) => {
      // 按小写名找回原值（头名大小写不敏感）
      const key = Object.keys(input.headers).find((k) => k.toLowerCase() === name)
      return { name, value: key === undefined ? '' : String(input.headers[key]).trim() }
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  const head = picked.map((p) => `${p.name}:${p.value}`).join('\n')
  return `${input.method.toUpperCase()}\n${input.url}\n${head}\n\n${input.body}`
}

/**
 * 注入签名头。返回**新的** headers（不改原对象）。
 *
 * ★`await` 是必要的：真实签名可能走宿主安全模块（异步）。
 * ★若 `sign` 抛错 ⇒ 直接把错误抛出去（**不能**降级成"无签名发送"：
 *   那样服务端会拒，而业务看到的是一个莫名的 401，比"签名失败"更难排查）。
 */
export async function signRequest(input: {
  method: string
  url: string
  headers: Record<string, string>
  body: string
  policy: RequestSigningPolicy
  antiReplay?: AntiReplayPolicy
}): Promise<Record<string, string>> {
  const sigHeader = input.policy.signatureHeader ?? DEFAULT_SIG_HEADER
  const tsHeader = input.antiReplay?.timestampHeader ?? DEFAULT_TS_HEADER
  const nonceHeader = input.antiReplay?.nonceHeader ?? DEFAULT_NONCE_HEADER
  const signedHeaders = input.policy.signedHeaders ?? [tsHeader, nonceHeader]

  const canonical = buildCanonicalString({
    method: input.method,
    url: input.url,
    headers: input.headers,
    signedHeaders,
    body: input.body,
  })
  const signature = await input.policy.sign(canonical)
  return { ...input.headers, [sigHeader]: signature }
}

/* ══════════════════════ ④ 凭证头（托管注入） ══════════════════════ */

/**
 * 构造 `Authorization` 头。
 * ★痛点 #13：业务**拿不到 token**（只能通过 `auth` 的受控接口），因此无法
 *   `axios.defaults.headers.common['Authorization'] = token` 那类绕过。
 */
export function bearerHeader(token: string | undefined | null): Record<string, string> {
  if (!token || token.length === 0) return {}
  // ★防注入：token 里若含换行/空格，拼进头会造成头注入
  const safe = token.replace(/[\r\n\s]/g, '')
  if (safe.length === 0) return {}
  return { Authorization: `Bearer ${safe}` }
}

/** 请求头是否已含某个头（大小写不敏感） */
export function hasHeader(headers: Record<string, string>, name: string): boolean {
  const n = name.toLowerCase()
  return Object.keys(headers).some((k) => k.toLowerCase() === n)
}
