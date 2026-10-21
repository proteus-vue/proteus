// packages/api/src/capability-fetch-cache.ts
// ★★★决策 #1149：**HTTP 条件请求缓存**（矩阵 P2）——框架层的 304 复用，跨端同一份。
//
// 【为什么必须在框架层做（而不是靠平台）】
//   取证（2026-10-21 真机/源码双证）：
//     · Android 腿是**裸 `HttpURLConnection`**（`HttpCapability.perform`）⇒ 进程内没有启用
//       `ResponseCache`，**不会**自动发条件请求、也不会把 304 还原成 200；
//     · iOS 腿用 `URLSessionConfiguration.default` ⇒ 系统 `URLCache` **可能**介入，
//       行为与平台版本/磁盘缓存状态有关（这正是"同一份源码三端不一致"的典型来源）；
//     · Web 腿走浏览器 `fetch` ⇒ 浏览器自带 HTTP 缓存（会替你发条件请求）。
//   ⇒ 只有把缓存语义收回框架层，三端才可能"同一份源码同一套语义"；
//     浏览器那一层由 `bypassPlatformCache` 显式让开，避免双重缓存导致的行为漂移。
//
// 【语义基准 = Web 标准（本仓纪律：多端一致性以 Web/标准为真值）】
//   `config.cache` 取 `Request.cache` 的六个标准值：
//     default / no-store / reload / no-cache / force-cache / only-if-cached。
//   响应侧按 RFC 9111 的**子集**实现（不假装完整）：
//     · `Cache-Control: no-store` ⇒ 不存；
//     · `Cache-Control: no-cache` ⇒ 存但每次必须回源校验；
//     · `max-age` / `Expires` / `Age` ⇒ 新鲜期；
//     · `must-revalidate` ⇒ 过期后不得直接用（本实现本来就不用过期条目）；
//     · `Vary` ⇒ 按请求头分桶（`Vary: *` ⇒ 不缓存）；
//     · `ETag` / `Last-Modified` ⇒ 条件请求（`If-None-Match` / `If-Modified-Since`）；
//     · 304 ⇒ 用缓存体合成 200，并用 304 的响应头更新缓存（RFC 9111 §4.3.4）。
//
// 【★诚实边界（写进判据，不粉饰）】
//   ① 只在**内存**（进程内 LRU，默认 5 MiB）——`04-cache-layers.md` 的 L2 磁盘层未实现，
//      重启即失效；不谎称"持久缓存"。
//   ② 只缓存 **GET** 的 200/203，且要求"有新鲜期或有校验器"（否则存了也用不上）；
//      流式（`onChunk`）/落盘（`savePath`）/上传（`upload`）一律不缓存。
//   ③ 不实现 `stale-while-revalidate` / `stale-if-error` / 请求折叠（那是独立批次）。
//   ④ 带 `Authorization` 的请求按 RFC 7234 §3.2 保守处理：响应无 `public`/`must-revalidate`/`s-maxage`
//      就不存（避免把用户私有数据写进共享缓存）。★宿主注入的 Cookie 对 JS 不可见，
//      这类请求按普通私有缓存处理（同一设备同一用户，可接受；不冒充"跨用户隔离"）。
//   ⑤ 缓存键含 `responseType`（同一 URL 以 text/json 取会分开存）——避免"猜"反序列化形态。

import type { FetchConfig, FetchResult } from './capability-fetch-types'

/** `Request.cache` 的六个标准值（与浏览器同名同义）。 */
export type FetchCacheMode = 'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached'

/** 一次请求的缓存结局（`FetchMeta.cache.status`）。 */
export type FetchCacheStatus =
  | 'hit'
  | 'revalidated'
  | 'miss'
  | 'bypass'
  /**
   * ★★★#1150 过期条目**被直接返回**（RFC 5861）：`stale` = 窗口内主动复用（随后后台校验），
   * 或 `stale-if-error` 在回源失败后兜底。业务可据此打"数据可能过期"的提示。
   */
  | 'stale'

/** `FetchMeta.cache`：没有它就无法回答"这次到底走了网络没有"。 */
export interface FetchCacheMeta {
  /** hit = 直接命中新鲜缓存；revalidated = 304 复用；miss = 回源；bypass = 未启用/不适用；stale = 返回过期值 */
  status: FetchCacheStatus
  /** 命中条目的年龄（ms，仅 hit / revalidated / stale / force-cache 时有意义） */
  ageMs?: number
  /** 本次响应是否写进了缓存（miss 时才有意义；304 更新也算 true） */
  stored?: boolean
  /** 实际使用的缓存模式（排障用：确认业务传的 cache 生效了） */
  mode?: FetchCacheMode
  /** ★#1150：stale 的来源——`swr` 窗口内主动复用 / `stale-if-error` 回源失败兜底 / `force-cache` 业务要求 */
  staleReason?: 'swr' | 'stale-if-error' | 'force-cache'
  /** ★#1150：本次是否触发了**后台校验**（SWR 专用；`true` 表示旧值已返回、新值稍后进缓存） */
  revalidating?: boolean
}

/** 缓存条目（store 的实现无关形态：内存 LRU / 未来磁盘层都实现它）。 */
export interface FetchCacheEntry {
  /** 基站键（method + url + params + responseType） */
  key: string
  /** 响应状态（200 / 203） */
  status: number
  /** 合并后的响应头（304 更新后也会写回） */
  headers: Record<string, string>
  /** 响应体：文本（含 JSON 原文）或裸字节 */
  body: { kind: 'text'; text: string } | { kind: 'bytes'; bytes: Uint8Array }
  /** 文本体是否是 JSON（命中时决定是否 `JSON.parse`） */
  json: boolean
  /** 写入时刻（`now()` 口径） */
  storedAt: number
  /** 新鲜寿命（ms；0 = 必须回源校验） */
  lifetimeMs: number
  /** `Cache-Control: no-cache` / `must-revalidate`（过期后不得直接用） */
  mustRevalidate: boolean
  /**
   * ★★★#1150 `stale-while-revalidate` 窗口（ms；0/undefined = 不启用，即默认行为不变）。
   * 语义：变 stale 后仍可**直接回旧值**，同时后台校验（RFC 5861）。
   */
  swrMs?: number
  /** ★★★#1150 `stale-if-error` 窗口（ms）：回源失败时可用旧值兜底的最长时间。 */
  sieMs?: number
  /** 校验器 */
  etag?: string
  lastModified?: string
  /** `Vary` 分桶：规范化后的请求头名 + 当时的取值 */
  varyNames: string[]
  varyValues: Record<string, string>
  /** LRU 记账 */
  lastUsed: number
  /** 估计字节数（预算统计用） */
  bytes: number
}

/** 缓存存储契约（内存实现见 `createMemoryFetchCache`；磁盘层将来实现同一接口即可）。 */
export interface FetchCacheStore {
  /** 按基站键 + 请求头匹配（`Vary` 语义在 store 内完成） */
  match(key: string, requestHeaders: Record<string, string> | undefined, now: number): FetchCacheEntry | undefined
  put(entry: FetchCacheEntry): void
  remove(key: string, entry: FetchCacheEntry): void
  /** 清空（测试/登出场景） */
  clear(): void
  stats(): { entries: number; bytes: number }
}

/** 管线级缓存配置（`createFetchPipeline(bridge, { cache: ... })`）。 */
export interface FetchCacheOptions {
  /** 字节预算（默认 5 MiB；超了按 LRU 淘汰） */
  maxBytes?: number
  /** 条目上限（默认 200） */
  maxEntries?: number
  /**
   * 默认模式：管线开了缓存但业务没写 `config.cache` 时用它。
   * ★默认 `default`（有新鲜期就直接用、过期则条件回源）。
   */
  defaultMode?: FetchCacheMode
  /** 注入 store（判据/自定义持久层）；缺省内存 LRU */
  store?: FetchCacheStore
  /**
   * 是否对该管线的**所有**请求启用缓存（由 `createFetchPipeline` 按 `opts.cache` 置位）。
   * ★false 时仍允许**单请求**用 `config.cache` 显式开启——那是业务意图，不该被管线默认值否决。
   */
  enabled?: boolean
}

/** `Cache-Control` 的解析结果（只保留本实现真正消费的指令）。 */
export interface ParsedCacheControl {
  noStore: boolean
  noCache: boolean
  isPublic: boolean
  mustRevalidate: boolean
  immutable: boolean
  /** `max-age`（ms；未声明则 undefined） */
  maxAgeMs?: number
  /** `s-maxage`（ms；仅用于"带 Authorization 时能否存"的判定） */
  sMaxAgeMs?: number
  /**
   * ★★★#1150 `stale-while-revalidate`（RFC 5861，ms）：
   * 变 stale 之后仍可**直接回旧值**的窗口长度；窗口内同时后台校验。
   */
  staleWhileRevalidateMs?: number
  /**
   * ★★★#1150 `stale-if-error`（RFC 5861，ms）：回源失败（网络错误 / 500·502·503·504）时
   * 仍可用旧值兜底的最长"变 stale 后"时间。
   */
  staleIfErrorMs?: number
}

/**
 * 解析响应/请求的 `Cache-Control`（大小写不敏感；`max-age="60"` 这种带引号也认）。
 *
 * ★#1150：新增 RFC 5861 的两条扩展指令。★**不支持的指令一律忽略、不报错**——
 *   这是 RFC 9111 §5.2 对未知指令的要求（缓存必须忽略不认识的 cache-control 指令）。
 */
export function parseCacheControl(headers: Record<string, string> | undefined): ParsedCacheControl {
  const out: ParsedCacheControl = {
    noStore: false,
    noCache: false,
    isPublic: false,
    mustRevalidate: false,
    immutable: false,
    maxAgeMs: undefined,
    sMaxAgeMs: undefined,
    staleWhileRevalidateMs: undefined,
    staleIfErrorMs: undefined,
  }
  const raw = headerOf(headers, 'cache-control')
  if (!raw) return out
  for (const part of raw.split(',')) {
    const [nameRaw, ...rest] = part.split('=')
    const name = (nameRaw ?? '').trim().toLowerCase()
    const value = rest.join('=').trim().replace(/^"|"$/g, '')
    if (name === 'no-store') out.noStore = true
    else if (name === 'no-cache') out.noCache = true
    else if (name === 'public') out.isPublic = true
    else if (name === 'must-revalidate') out.mustRevalidate = true
    else if (name === 'immutable') out.immutable = true
    else if (name === 'max-age' && /^\d+$/.test(value)) out.maxAgeMs = Number(value) * 1000
    else if (name === 's-maxage' && /^\d+$/.test(value)) out.sMaxAgeMs = Number(value) * 1000
    // ★RFC 5861（扩展指令；delta-seconds）
    else if (name === 'stale-while-revalidate' && /^\d+$/.test(value)) out.staleWhileRevalidateMs = Number(value) * 1000
    else if (name === 'stale-if-error' && /^\d+$/.test(value)) out.staleIfErrorMs = Number(value) * 1000
  }
  return out
}

/** 大小写不敏感取头（各端 header 键大小写不统一）。 */
export function headerOf(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const lower = name.toLowerCase()
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k]
  }
  return undefined
}

/** 大小写不敏感判断响应头里有没有某个头。 */
function hasHeader(headers: Record<string, string> | undefined, name: string): boolean {
  return headerOf(headers, name) !== undefined
}

/** 合并两组响应头：`update` 覆盖 `base`（按头名大小写不敏感去重）。 */
export function mergeHeaders(
  base: Record<string, string>,
  update: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...base }
  for (const k of Object.keys(update)) {
    const lower = k.toLowerCase()
    for (const existing of Object.keys(out)) {
      if (existing.toLowerCase() === lower) delete out[existing]
    }
    out[k] = update[k]!
  }
  return out
}

/** 从 `Vary` 提取规范化头名；`*` ⇒ 返回 `['*']`（调用方据此拒绝缓存）。 */
export function varyNamesOf(headers: Record<string, string> | undefined): string[] {
  const raw = headerOf(headers, 'vary')
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * 生成**基站键**：方法 + URL + 排序后的 query + responseType。
 * ★`params` 必须排序后再拼：同一组参数不同书写顺序应命中同一条（与去重键同口径）。
 * ★★不能直接用 `encodeURIComponent`——App 精简引擎有（`encodeURIComponent` 是 ES 内建），
 *   但两处拼法必须一致：这里复用与 `encodedFetchUrl` **同一个语义**（k=v&k2=v2，undefined 跳过）。
 */
export function fetchCacheKey(url: string, config: FetchConfig): string {
  const p = config.params
  const params = p
    ? Object.keys(p)
        .filter((k) => p[k] !== undefined)
        .sort()
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]))}`)
        .join('&')
    : ''
  const method = (config.method ?? 'GET').toUpperCase()
  const rt = config.responseType ?? 'auto'
  return `${method} ${url}${url.includes('?') ? '&' : '?'}${params} rt=${rt}`
}

/** 该请求是否值得进缓存（形态层面的硬条件）。 */
export function isCacheableRequest(config: FetchConfig): boolean {
  const method = (config.method ?? 'GET').toUpperCase()
  if (method !== 'GET') return false
  // 流式/落盘/上传的响应体不进 JS（或字节已逐块消费）⇒ 没有可缓存的完整表示
  if (config.onChunk || config.savePath || config.upload) return false
  if (config.data !== undefined) return false
  return true
}

/** 响应是否可存（状态码 + 头部）。 */
export function isCacheableResponse(status: number, headers: Record<string, string> | undefined): boolean {
  if (status !== 200 && status !== 203) return false
  const cc = parseCacheControl(headers)
  if (cc.noStore) return false
  const vary = varyNamesOf(headers)
  if (vary.includes('*')) return false
  return true
}

/**
 * 计算新鲜寿命（ms）。
 *
 * ★优先级：`max-age` > `Expires - Date` > `options.defaultMaxAgeMs`（默认 0 = 立即过期）。
 * ★`Age` 头（共享缓存代理加的）从寿命里扣——它是"这份响应已经在路上活了多久"。
 * ★`no-cache` ⇒ 寿命强制 0（每次都要回源校验）。
 */
export function freshnessLifetimeMs(
  headers: Record<string, string> | undefined,
  storedAt: number,
  defaultMaxAgeMs = 0,
): number {
  const cc = parseCacheControl(headers)
  if (cc.noCache) return 0
  if (cc.maxAgeMs !== undefined) return Math.max(0, cc.maxAgeMs)
  const expires = headerOf(headers, 'expires')
  if (expires) {
    const expiresAt = Date.parse(expires)
    if (!Number.isNaN(expiresAt)) {
      const dateHdr = headerOf(headers, 'date')
      const dateAt = dateHdr ? Date.parse(dateHdr) : NaN
      const base = Number.isNaN(dateAt) ? storedAt : dateAt
      return Math.max(0, expiresAt - base)
    }
  }
  return Math.max(0, defaultMaxAgeMs)
}

/** 条目的当前年龄（ms，含 `Age` 头）。 */
export function entryAgeMs(entry: FetchCacheEntry, now: number): number {
  const ageHdr = Number(headerOf(entry.headers, 'age') ?? 0)
  const ageFromHeader = Number.isFinite(ageHdr) && ageHdr > 0 ? ageHdr * 1000 : 0
  return Math.max(0, now - entry.storedAt) + ageFromHeader
}

/** 条目是否新鲜（可直接用，不必回源）。 */
export function isFresh(entry: FetchCacheEntry, now: number): boolean {
  // no-cache / must-revalidate ⇒ 即使寿命未到也不许直接用（语义就是"先校验"）
  if (entry.mustRevalidate) return false
  return entry.lifetimeMs > 0 && entryAgeMs(entry, now) < entry.lifetimeMs
}

/**
 * ★★★#1150：**能否在该请求里直接回旧值并后台校验**（RFC 5861 `stale-while-revalidate`）。
 *
 * 【判据（逐条对齐 RFC 5861 原文）】
 *   · "caches MAY serve the response … after it becomes stale, up to the indicated number of seconds"
 *     ⇒ 窗口 = `变 stale 之后` 的 `N` 秒，即 `age < lifetime + N`；
 *   · 窗口过后 "it SHOULD NOT continue to be served stale" ⇒ 超出即**不得**再回旧值；
 *   · **`must-revalidate` 优先**（★这是 RFC 5861 **未规定**的一处，必须自己拍：
 *     RFC 9111 §5.2.2.2 说 must-revalidate 的响应一旦 stale 就 **MUST NOT** 被复用，
 *     而 SWR 的语义正是"复用 stale" ⇒ 两者冲突时取**更严格的 must-revalidate**（保守，符合本仓"标准真值优先"）。
 *   · `no-cache` 走 `mustRevalidate` 标记（本文件写入时已合并），同样不启用。
 */
export function isStaleServable(entry: FetchCacheEntry, now: number): boolean {
  if (entry.mustRevalidate) return false
  const window = entry.swrMs ?? 0
  if (window <= 0) return false
  const age = entryAgeMs(entry, now)
  // ★必须"已经 stale"才算 SWR（新鲜期内的命中走 fresh 路径，不计入 SWR 语义）
  return age >= entry.lifetimeMs && age < entry.lifetimeMs + window
}

/**
 * ★★★#1150：**回源失败时能否用旧值兜底**（RFC 5861 `stale-if-error`）。
 *
 * 【RFC 原文口径】"Its value indicates the upper limit to staleness" ⇒ 窗口同样是
 *   `age < lifetime + N`（从"开始 stale"起算）。
 * ★优先级同上：`must-revalidate` 禁止复用 stale ⇒ 不启用（保守）。
 */
export function isStaleOnErrorAvailable(entry: FetchCacheEntry, now: number): boolean {
  if (entry.mustRevalidate) return false
  const window = entry.sieMs ?? 0
  if (window <= 0) return false
  return entryAgeMs(entry, now) < entry.lifetimeMs + window
}

/**
 * ★★★#1150：给**由缓存生成**的响应加上 `Age` 头。
 *
 * 【为什么必须有】RFC 9111 §5.1：「A cache **MUST** generate the Age header field in a response
 *   it generates from a stored response.」⇒ fresh 命中 / stale 复用 / 304 合成 200 三条路径都要带。
 *   没有 Age，业务与上游代理无法判断"这份数据有多旧"——SWR 场景尤其关键（它天生就是旧数据）。
 *
 * ★单位是**整秒**（RFC 定义），且**覆盖**原条目里的 Age（那个值描述的是上游缓存，已被计入 `entryAgeMs`）。
 */
export function withAgeHeader(headers: Record<string, string>, ageMs: number): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === 'age') continue
    out[k] = headers[k]!
  }
  out['Age'] = String(Math.max(0, Math.floor(ageMs / 1000)))
  return out
}

/** 内存 LRU 缓存（进程内；`Map` 插入序 = LRU 序，命中时重排）。 */
export function createMemoryFetchCache(opts: { maxBytes?: number; maxEntries?: number; now?: () => number } = {}): FetchCacheStore {
  const maxBytes = Math.max(0, opts.maxBytes ?? 5 * 1024 * 1024)
  const maxEntries = Math.max(1, opts.maxEntries ?? 200)
  const now = opts.now ?? Date.now
  /** 基站键 → 该键下的全部变体（`Vary` 分桶） */
  const buckets = new Map<string, FetchCacheEntry[]>()
  let totalBytes = 0
  let count = 0

  const entryBytes = (e: FetchCacheEntry): number =>
    e.body.kind === 'bytes' ? e.body.bytes.byteLength : e.body.text.length * 2

  function removeEntry(key: string, entry: FetchCacheEntry): void {
    const list = buckets.get(key)
    if (!list) return
    const i = list.indexOf(entry)
    if (i >= 0) list.splice(i, 1)
    if (list.length === 0) buckets.delete(key)
    totalBytes -= entry.bytes
    count--
  }

  function evictIfNeeded(): void {
    while ((totalBytes > maxBytes || count > maxEntries) && count > 0) {
      let victim: { key: string; entry: FetchCacheEntry } | null = null
      for (const [key, list] of buckets) {
        for (const entry of list) {
          if (!victim || entry.lastUsed < victim.entry.lastUsed) victim = { key, entry }
        }
      }
      if (!victim) return
      removeEntry(victim.key, victim.entry)
    }
  }

  return {
    match(key, requestHeaders, at) {
      const list = buckets.get(key)
      if (!list || list.length === 0) return undefined
      for (const entry of list) {
        let ok = true
        for (const name of entry.varyNames) {
          if (requestHeader(requestHeaders, name) !== entry.varyValues[name]) {
            ok = false
            break
          }
        }
        if (!ok) continue
        entry.lastUsed = at
        return entry
      }
      return undefined
    },
    put(entry) {
      const list = buckets.get(entry.key) ?? []
      // 同**变体**（Vary 头名 + 取值都相同）的旧条目先替换；不同变体必须共存
      // ★★首版只比头名 ⇒ 存 zh 变体时把 en 变体删了（判据 ④ 当场红）——这是"Vary 分桶"的核心语义
      for (const old of [...list]) {
        if (sameVariant(old, entry)) removeEntry(entry.key, old)
      }
      const withBytes = { ...entry, bytes: entryBytes(entry), lastUsed: now() }
      const bucket = buckets.get(entry.key) ?? []
      bucket.push(withBytes)
      buckets.set(entry.key, bucket)
      totalBytes += withBytes.bytes
      count++
      evictIfNeeded()
    },
    remove(key, entry) {
      removeEntry(key, entry)
    },
    clear() {
      buckets.clear()
      totalBytes = 0
      count = 0
    },
    stats() {
      return { entries: count, bytes: totalBytes }
    },
  }
}

function sameVariant(a: FetchCacheEntry, b: FetchCacheEntry): boolean {
  if (a.varyNames.length !== b.varyNames.length) return false
  for (let i = 0; i < a.varyNames.length; i++) {
    const name = a.varyNames[i]!
    if (name !== b.varyNames[i]) return false
    if (a.varyValues[name] !== b.varyValues[name]) return false
  }
  return true
}

function requestHeader(headers: Record<string, string> | undefined, name: string): string {
  return headerOf(headers, name) ?? ''
}

/** 一次缓存查找的结论（管线据此决定是否发请求）。 */
export type CacheLookup =
  | { kind: 'bypass'; mode?: FetchCacheMode }
  /** 新鲜命中：直接返回，不发请求 */
  | { kind: 'fresh'; entry: FetchCacheEntry; mode: FetchCacheMode }
  /**
   * ★★★#1150 **过期但仍可直接回旧值**：立即返回 + 后台校验（RFC 5861 `stale-while-revalidate`）。
   * `reason` 区分来源：`swr`（窗口内）或 `force-cache`（业务显式要求）。
   */
  | { kind: 'stale'; entry: FetchCacheEntry; mode: FetchCacheMode; reason: 'swr' | 'force-cache' }
  /** 需要回源：`config` 已带条件头（有校验器时） */
  | { kind: 'revalidate'; entry?: FetchCacheEntry; config: FetchConfig; mode: FetchCacheMode }
  /** `only-if-cached` 且无条目 ⇒ 不联网，直接失败 */
  | { kind: 'miss-only'; mode: FetchCacheMode }

/**
 * 管线的缓存控制器（纯策略，不碰网络；判据可单独 import 这些函数）。
 *
 * ★为什么单独一个类而不是散在 `execute` 里：`execute` 已有 260 行（含 deadline/重定向/重试），
 *   再塞缓存读/写/304 合成会把它推到难以阅读的规模。缓存的所有判定集中在本文件，
 *   `execute` 只调 `lookup` / `settle` 两个钩子。
 */
export interface FetchCacheController {
  /** 该请求的生效模式（`undefined` = 完全不碰缓存） */
  modeOf(config: FetchConfig): FetchCacheMode | undefined
  /** 请求前：查缓存 / 加条件头 / 判定 only-if-cached 落空 */
  lookup(url: string, config: FetchConfig, mode: FetchCacheMode): CacheLookup
  /** 响应后：304 合成 200 并更新条目；可写则写；返回最终结果与缓存元数据 */
  settle(
    url: string,
    config: FetchConfig,
    lookup: CacheLookup,
    res: FetchResult<unknown>,
    now: number,
  ): { result: FetchResult<unknown>; cache: FetchCacheMeta }
}

/** 建一个缓存控制器（每个管线一个；store 可在多个管线间共享——业务自愿）。 */
export function createFetchCache(opts: FetchCacheOptions = {}, now: () => number = Date.now): FetchCacheController {
  const defaultMode = opts.defaultMode ?? 'default'
  const enabled = opts.enabled ?? true
  const defaultMaxAgeMs = 0
  const store = opts.store ?? createMemoryFetchCache({ maxBytes: opts.maxBytes, maxEntries: opts.maxEntries, now })

  function modeOf(config: FetchConfig): FetchCacheMode | undefined {
    if (config.cache) return config.cache
    return enabled ? defaultMode : undefined
  }

  function requestModeOverride(config: FetchConfig): FetchCacheMode | undefined {
    // 业务手写 `Cache-Control` 头也认（与浏览器一致）：no-store / no-cache / max-age=0
    const cc = parseCacheControl(config.headers)
    if (cc.noStore) return 'no-store'
    if (cc.noCache || cc.maxAgeMs === 0) return 'no-cache'
    return undefined
  }

  function lookup(url: string, config: FetchConfig, modeIn: FetchCacheMode): CacheLookup {
    const mode = requestModeOverride(config) ?? modeIn
    if (mode === 'no-store') return { kind: 'bypass', mode }
    if (!isCacheableRequest(config)) return { kind: 'bypass', mode }
    const key = fetchCacheKey(url, config)
    const entry = store.match(key, config.headers, now())
    const at = now()

    if (mode === 'only-if-cached') {
      if (!entry) return { kind: 'miss-only', mode }
      // ★only-if-cached 的语义就是"只用缓存"⇒ 不新鲜也回（由业务自己承担，meta 会标 stale）
      return isFresh(entry, at) ? { kind: 'fresh', entry, mode } : { kind: 'stale', entry, mode, reason: 'force-cache' }
    }
    if (mode === 'reload') return { kind: 'revalidate', config, mode }
    if (mode === 'force-cache' && entry) {
      // ★业务显式要求用缓存 ⇒ 过不过期都回；新鲜时仍报 fresh（不虚报 stale）
      return isFresh(entry, at) ? { kind: 'fresh', entry, mode } : { kind: 'stale', entry, mode, reason: 'force-cache' }
    }
    if (entry && isFresh(entry, at)) return { kind: 'fresh', entry, mode }
    // ★★★#1150：stale-while-revalidate —— 在窗口内**立即回旧值**（管线负责起后台校验）。
    //   ★只在 `default` 模式生效：业务写 `no-cache`（要求先校验）时不该被 stale 抢先。
    if (mode === 'default' && entry && isStaleServable(entry, at)) {
      return { kind: 'stale', entry, mode, reason: 'swr' }
    }
    if (entry && (entry.etag || entry.lastModified)) {
      return { kind: 'revalidate', entry, config: withValidators(config, entry), mode }
    }
    return { kind: 'revalidate', entry, config, mode }
  }

  function settle(
    url: string,
    config: FetchConfig,
    looked: CacheLookup,
    res: FetchResult<unknown>,
    at: number,
  ): { result: FetchResult<unknown>; cache: FetchCacheMeta } {
    if (looked.kind === 'bypass') return { result: res, cache: { status: 'bypass', ...(looked.mode ? { mode: looked.mode } : {}) } }
    const mode = looked.mode
    const key = fetchCacheKey(url, config)

    // ── 304：用缓存体合成 200（RFC 9111 §4.3.4）──
    if (res.ok && res.status === 304 && 'entry' in looked && looked.entry) {
      const entry = looked.entry
      const merged = mergeHeaders(entry.headers, dropEntityHeaders(res.headers))
      const cc304 = parseCacheControl(merged)
      const updated: FetchCacheEntry = {
        ...entry,
        headers: merged,
        storedAt: at,
        lifetimeMs: freshnessLifetimeMs(merged, at, defaultMaxAgeMs),
        mustRevalidate: cc304.mustRevalidate || cc304.noCache,
        // ★★★#1150：304 可能**刷新**窗口声明（也可能不带这条指令 ⇒ 沿用旧条目）。
        //   若不刷新，`stale-while-revalidate` 会在每次 304 后丢失 ⇒ 特性只在首次生效。
        ...(cc304.staleWhileRevalidateMs !== undefined ? { swrMs: cc304.staleWhileRevalidateMs } : {}),
        ...(cc304.staleIfErrorMs !== undefined ? { sieMs: cc304.staleIfErrorMs } : {}),
        etag: headerOf(merged, 'etag') ?? entry.etag,
        lastModified: headerOf(merged, 'last-modified') ?? entry.lastModified,
      }
      store.put(updated)
      const body = decodeCacheBody(updated, config)
      const ageMs = entryAgeMs(updated, at)
      return {
        // ★RFC 9111 §5.1：由缓存生成的响应 MUST 带 Age
        result: { ok: true, data: body, status: updated.status, headers: withAgeHeader(merged, ageMs) },
        cache: { status: 'revalidated', ageMs, stored: true, mode },
      }
    }

    // ── ★★★#1150 stale-if-error：回源失败时用旧值兜底（RFC 5861）──
    //   【触发条件（RFC 原文口径）】"an error is any situation that would result in a
    //     500, 502, 503, or 504 HTTP response status code being returned"（网络失败同理）。
    //   ★★判据必须用 `isErrorRescuable` 而**不是** `!res.ok`：本仓 `runFetch` 把 5xx 表达为
    //     `ok:true + status`（只有网络/超时才 ok:false）⇒ 用 `!res.ok` 会让**RFC 明确点名的
    //     500/502/503/504 全部漏兜底**（判据 ⑥ 当场红，这条是判据抓出来的真缺陷）。
    //   ★只兜底**可恢复类**失败：`fetch.aborted`（业务主动取消）**绝不**用旧值冒充成功——
    //     那会让"点了取消却拿到数据"，语义错乱。`fetch.unsupported`/`tooLarge` 同理不兜底。
    //   ★窗口 = `age < lifetime + stale-if-error`（RFC: "upper limit to staleness"）。
    if (isErrorRescuable(res) && 'entry' in looked && looked.entry && isStaleOnErrorAvailable(looked.entry, at)) {
      const entry = looked.entry
      const ageMs = entryAgeMs(entry, at)
      const rescued = cachedResponseOf<unknown>(entry, config, ageMs)
      return {
        result: rescued as never,
        cache: { status: 'stale', ageMs, stored: false, mode, staleReason: 'stale-if-error' },
      }
    }

    // ── 普通响应：可存则存 ──
    let stored = false
    if (res.ok) {
      const status = res.status
      const headers = res.headers ?? {}
      if (config.cache !== 'no-store' && isCacheableResponse(status, headers) && isStoreAllowed(config, headers)) {
        const encoded = encodeBody(res.data, config)
        const etag = headerOf(headers, 'etag')
        const lastModified = headerOf(headers, 'last-modified')
        const lifetimeMs = freshnessLifetimeMs(headers, at, defaultMaxAgeMs)
        const cc0 = parseCacheControl(headers)
        // ★★★#1150：「有用」的判据要含 SWR/SIE 窗口——
        //   `Cache-Control: max-age=0, stale-while-revalidate=60` 是**最常见**的 SWR 形态
        //   （新鲜期 0 = 永远变立即 stale，靠 SWR 窗口服务）。若只按 `lifetimeMs > 0 || 校验器` 判，
        //   这条响应会被判成"存了也用不上"⇒ **整个 SWR 特性形同虚设**。
        const hasStaleWindow = (cc0.staleWhileRevalidateMs ?? 0) > 0 || (cc0.staleIfErrorMs ?? 0) > 0
        if (encoded && (lifetimeMs > 0 || etag || lastModified || hasStaleWindow)) {
          const cc = cc0
          const vary = varyNamesOf(headers)
          const varyValues: Record<string, string> = {}
          for (const name of vary) varyValues[name] = requestHeader(config.headers, name)
          store.put({
            key,
            status,
            headers,
            body: encoded.body,
            json: encoded.json,
            storedAt: at,
            lifetimeMs,
            mustRevalidate: cc.noCache || cc.mustRevalidate,
            ...(cc.staleWhileRevalidateMs !== undefined ? { swrMs: cc.staleWhileRevalidateMs } : {}),
            ...(cc.staleIfErrorMs !== undefined ? { sieMs: cc.staleIfErrorMs } : {}),
            ...(etag ? { etag } : {}),
            ...(lastModified ? { lastModified } : {}),
            varyNames: vary,
            varyValues,
            lastUsed: at,
            bytes: 0,
          })
          stored = true
        }
      } else if (parseCacheControl(headers).noStore) {
        // 服务端明确 no-store ⇒ 已有条目也作废
        const old = store.match(key, config.headers, at)
        if (old) store.remove(key, old)
      }
    }

    return { result: res, cache: { status: 'miss', stored, mode } }
  }

  return { modeOf, lookup, settle }
}

/**
 * ★★★#1150：这个失败是否属于 `stale-if-error` 该兜底的"错误"（RFC 5861）。
 *
 * 【RFC 口径】"an error is any situation that would result in a 500, 502, 503, or 504
 *   HTTP response status code being returned"（网络段故障 / DNS 失败亦然）。
 * 【本实现的取舍】
 *   · 兜底：`fetch.failed`（网络/DNS/连接类）、`fetch.timeout`、以及 500/502/503/504 响应；
 *   · **不兜底**：`fetch.aborted`（业务主动取消——用旧值冒充成功会让"点了取消却拿到数据"）、
 *     `fetch.unsupported`（能力缺失，旧值不能掩盖配置错误）、`fetch.tooLarge`、
 *     `fetch.cacheMiss` / `fetch.intercepted`（都不是"源站出错"）。
 *   ★这些"不兜底"是有意的：`stale-if-error` 的目的是**可用性**，不是**掩盖故障**。
 */
export function isErrorRescuable(res: FetchResult<unknown>): boolean {
  if (res.ok) {
    // 5xx 在 runFetch 里是 ok:true + status ⇒ 按 RFC 的 500/502/503/504 判定
    return res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504
  }
  const code = res.error?.code
  return code === 'fetch.failed' || code === 'fetch.timeout'
}

/** `only-if-cached` 落空的统一错误（不联网、不伪造空响应）。 */
export function cacheMissError(): { code: 'fetch.cacheMiss'; message: string } {
  return { code: 'fetch.cacheMiss', message: 'only-if-cached：缓存无可用条目（已阻止网络请求）' }
}

/**
 * ★★★#1150：把缓存条目**组装成业务可见的响应**（fresh / stale 两条路径共用）。
 *
 * 【为什么单列】fresh 命中与 SWR stale 复用的**结果形态必须完全一致**（除 meta 标注外），
 *   否则"业务能否知道自己拿到的是旧数据"取决于走哪条分支 ⇒ 必然分叉。
 *   差异只由 `meta.cache.status`（`hit` vs `stale`）与 `Age` 表达。
 */
export function cachedResponseOf<T>(
  entry: FetchCacheEntry,
  config: FetchConfig,
  ageMs: number,
): { ok: true; data: T; status: number; headers: Record<string, string> } {
  return {
    ok: true,
    data: decodeCacheBody(entry, config) as T,
    status: entry.status,
    // ★RFC 9111 §5.1：缓存生成的响应 MUST 带 Age（SWR 场景尤其关键——它天生就是旧数据）
    headers: withAgeHeader(entry.headers, ageMs),
  }
}

/** 加上条件请求头（有校验器时）。 */
function withValidators(config: FetchConfig, entry: FetchCacheEntry): FetchConfig {
  const headers: Record<string, string> = { ...(config.headers ?? {}) }
  if (entry.etag) headers['If-None-Match'] = entry.etag
  if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified
  return { ...config, headers }
}

/**
 * 从 304 的响应头里去掉**实体头**再合并。
 * ★304 的 `Content-Length` 是"0 或缺失"，直接合并会把缓存的长度抹掉；
 *   `Transfer-Encoding` 同理（304 没有体）。RFC 9111 §3.2 明确这些不该存。
 */
function dropEntityHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(headers ?? {})) {
    const lower = k.toLowerCase()
    if (lower === 'content-length' || lower === 'transfer-encoding' || lower === 'content-encoding' || lower === 'content-type') {
      continue
    }
    out[k] = headers![k]!
  }
  return out
}

/** 带凭据的响应是否允许入私有缓存（RFC 7234 §3.2 的保守口径）。 */
function isStoreAllowed(config: FetchConfig, headers: Record<string, string>): boolean {
  if (!hasHeader(config.headers, 'authorization')) return true
  const cc = parseCacheControl(headers)
  return cc.isPublic || cc.mustRevalidate || cc.sMaxAgeMs !== undefined
}

/** 把响应体编码成可缓存形态（不支持的类型返回 null ⇒ 不缓存）。 */
function encodeBody(data: unknown, config: FetchConfig): { body: FetchCacheEntry['body']; json: boolean } | null {
  if (config.responseType === 'arraybuffer') {
    if (data instanceof Uint8Array) return { body: { kind: 'bytes', bytes: new Uint8Array(data) }, json: false }
    if (data instanceof ArrayBuffer) return { body: { kind: 'bytes', bytes: new Uint8Array(data.slice(0)) }, json: false }
    return null
  }
  if (data === undefined || data === null) return null
  if (typeof data === 'string') {
    // ★只有 `responseType:'text'` 才保证原文；其余（缺省 = 由桥决定 json/text）按内容判一次
    const isJson = config.responseType !== 'text'
    return { body: { kind: 'text', text: data }, json: isJson && looksLikeJson(data) }
  }
  try {
    return { body: { kind: 'text', text: JSON.stringify(data) }, json: true }
  } catch {
    return null
  }
}

/** 把缓存体还原成业务看到的 `data`（按请求的 responseType）。 */
export function decodeCacheBody(entry: FetchCacheEntry, config: FetchConfig): unknown {
  if (config.responseType === 'arraybuffer') {
    if (entry.body.kind === 'bytes') return new Uint8Array(entry.body.bytes)
    // 形态不一致（键里含 responseType，理论上不会发生）⇒ 不猜，返回原文
    return entry.body.kind === 'text' ? entry.body.text : undefined
  }
  const text = entry.body.kind === 'text' ? entry.body.text : undefined
  if (text === undefined) {
    // 二进制条目被文本请求命中（键含 responseType，理论上不会发生）
    return entry.body.kind === 'bytes' ? new Uint8Array(entry.body.bytes) : undefined
  }
  if (config.responseType === 'text') return text
  if (entry.json) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

/** 粗判文本是否为 JSON（避免把纯文本在命中时 JSON.parse 成字符串再变成"看起来一样"的假象）。 */
function looksLikeJson(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  const c = t[0]
  return c === '{' || c === '[' || c === '"' || c === '-' || (c >= '0' && c <= '9') || t === 'true' || t === 'false' || t === 'null'
}

