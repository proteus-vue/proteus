// packages/api/src/request-engineering.ts
// ★G-32 B6 前置 + G-31 B7 收口：请求数据层语义面（api 层，不入 catalog——同 E21-E28 纪律「API 层语义不产 C-IR 节点」）
//   动机与路由语义化同族：把「裸请求」收敛为「带策略的请求语义」，业务不手写缓存/去重/排队逻辑
//   R1 request（策略请求：缓存 + 去重 + 可选排队）· R2 useQuery（SWR 响应式数据获取）
//   R3 enqueue（并发队列）· R4 dedupe（并发合并——R1/R2 内部共享）
//   注入式：client（createApi 产物 / adapter / ★capability 桥适配器——request(config) 执行面）+ reactivity（vue 或 mock）
//   + cache?（CompatStorage 底座——内存/持久化注入）+ concurrency?（队列并发上限）
//   ★G-31 B7 收口：createCapabilityRequestClient——把 useFetch 的底层能力桥（wx.request/fetch 双端）
//     升级为策略请求执行器（useFetch 语义 = req.request 的裸版；增强走缓存/去重/队列）
//   零运行时依赖 vue；MP 产物安全（决策 #32/#36）：无 ?. / ??；无数组解构
//
// ★★★#1342 C2（2026-10-28）：**本文件的定位已明确为「注入式策略原语」，不是终态入口**
//
// 【三层分工（读到这里就不用再猜该用哪个）】
//   L3 请求库 `createRequestClient`（`./request/`）—— **业务首选**：
//      实例配置 · 幂等/熔断/离线/**未知态** · 签名脱敏 · bizId 隔离 · 审计 · 三态结果
//   L2a 本文件 `createRequestEngineering` —— **注入式 R1-R4 原语**：
//      TTL 缓存 + 同飞去重 + FIFO 队列 + useQuery 句柄。**零依赖、可单测、可注入任意 executor**
//      ⇒ 保留它是因为它有独立价值：不依赖 Vue、不依赖能力桥、可套在任意 `RequestExecutor` 上。
//   L2b `useFetch` + fetch pipeline —— **HTTP 语义层**：
//      RFC 9111 缓存 / 5861 SWR / 重定向 / deadline / 并发 / 优先级 / 传输读数
//
// 【为什么不删掉本文件的 TTL 缓存（与痛点 #8 的关系）】
//   痛点 #8 说的是"**同一请求出现两种缓存命中解释**"，正解是**分层清楚**，不是删掉一层：
//   · 本文件的 TTL 缓存 = **查询级**（"这个数据多久内可直接用"，业务语义）
//   · pipeline 的 HTTP 缓存 = **协议级**（Cache-Control/ETag/304，服务端语义）
//   两者解决不同问题。错的是"业务不知道自己在用哪层" ⇒ 上面那张三层表就是答案。
//   ★业务要 HTTP 语义 ⇒ 用 L3（它直接调 useFetch/pipeline）；要"数据 5 分钟内别重拉" ⇒ 用 L2a。
//
// 【C2 修掉的两个真缺陷（都有判据）】
//   ① `defaultCacheKey` 不含 body ⇒ 不同 POST 体被错误合并/互相覆盖（痛点 #9）
//   ② `queue=true` 路径直接 return ⇒ 跳过写缓存 ⇒ `ttl`+`queue` 同时用时永不命中
import type { RequestConfig, RequestResponse } from '@proteus-vue/types/api-types'
import type { Reactivity } from './engineering'
import { CapError } from './capability'
import type { CapabilityBridge, CompatStorage } from './capability'

// —— 类型 ——

/** 请求执行面（createApi 产物 / IRequestAdapter 均满足——结构兼容） */
export interface RequestExecutor {
  request<T = unknown>(config: RequestConfig): Promise<RequestResponse<T>>
}

/** 缓存条目（TTL 语义：staleAt = createdAt + ttl；0 = 不过期） */
export interface RequestCacheEntry<T = unknown> {
  data: T
  createdAt: number
  staleAt: number
}

/** 查询状态（响应式——useQuery 句柄 state） */
export interface QueryState<T = unknown> {
  data: T | undefined
  loading: boolean
  error: unknown
}

/** R2 useQuery 句柄 */
export interface QueryHandle<T = unknown> {
  /** 响应式状态（注入 reactivity——loading/data/error 联动） */
  state: { value: QueryState<T> }
  /** 强制刷新（绕过缓存；更新 state + 缓存） */
  refresh(): Promise<T>
  /** 本地写入（乐观更新——写 state + 缓存，不发请求） */
  mutate(data: T): void
  /** 使缓存失效（下次读取重新请求） */
  invalidate(): void
  /** 是否有 in-flight 请求（是否被 dedupe 合并） */
  pending(): boolean
}

/** useQuery 选项 */
export interface QueryOptions {
  /** 缓存 TTL ms（0 = 只在本句柄生命周期内去重，不写缓存；缺省 0） */
  ttl?: number
  /** 是否命中缓存直接返回（SWR stale-while-revalidate 简化：命中即用，不做后台刷新） */
  useCache?: boolean
}

/** request 策略选项 */
export interface RequestStrategyOptions {
  /** 缓存 key（缺省 = method + ' ' + url + query 序列化） */
  cacheKey?: string
  /** 缓存 TTL ms（>0 才写入缓存） */
  ttl?: number
  /** 是否排队执行（超过并发上限等待） */
  queue?: boolean
}

/** createRequestEngineering 注入项 */
export interface RequestEngineeringOptions {
  /** 请求执行面（createApi 产物 / createRequestAdapter 产物均可注入） */
  client: RequestExecutor
  /** reactivity（注入——与 createEngineering 同族） */
  reactivity: Reactivity
  /** 缓存底座（缺省 undefined——request/useQuery 不写缓存，仅去重） */
  cache?: CompatStorage
  /** 队列并发上限（缺省 4；enqueue/queue 请求共用） */
  concurrency?: number
}

/** 请求数据层语义面（R1-R4） */
export interface RequestEngineering {
  /** R1 request：策略请求（缓存 + 去重 + 可选排队）——业务零手写策略 */
  request<T = unknown>(config: RequestConfig, options?: RequestStrategyOptions): Promise<RequestResponse<T>>
  /** R2 useQuery：SWR 响应式数据获取（缓存命中即用 + in-flight 去重 + refresh/mutate/invalidate） */
  useQuery<T = unknown>(key: string, fetcher: () => Promise<T>, options?: QueryOptions): QueryHandle<T>
  /** R3 enqueue：并发队列执行（concurrency 上限；FIFO；失败隔离） */
  enqueue<T>(task: () => Promise<T>): Promise<T>
  /** R4 dedupe：并发合并（同 key 共享 in-flight；request 内部已用） */
  runOnce<T>(key: string, task: () => Promise<T>): Promise<T>
  /** 清空全部缓存条目 */
  clearCache(): void
  /** 当前队列深度（未开始执行的排队任务数） */
  queued(): number
}

/**
 * 缺省缓存键：method + url + params(+ body)。
 *
 * ★★★#1342 C2 修一个真缺陷：此前**不含 body** ⇒ 两个 `POST /order`（不同订单）
 *   在 `ttl>0` 时会被**错误合并/互相覆盖**（去重键与缓存键同源，决策 #1342 痛点 #9）。
 *   现在：body 存在时追加其**确定性短哈希**（不塞原文——body 可能含敏感字段，也不让键过长）。
 *   ★向后兼容：**无 body 时键格式逐字节不变**（`GET /cache` 仍是 `GET /cache`），
 *     既有持久化缓存与 `defaultCacheKey` 的调用方不受影响。
 */
export function defaultCacheKey(
  method: string,
  url: string,
  params?: Record<string, unknown>,
  body?: unknown,
): string {
  let base = method.toUpperCase() + ' ' + url
  if (params) {
    const qs = Object.keys(params)
      .filter((k) => params[k] !== undefined)
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
      .sort()
      .join('&')
    if (qs) base += '?' + qs
  }
  if (body !== undefined) base += '#' + shortHash(safeStringify(body))
  return base
}

/** 确定性短哈希（djb2；★不引依赖，且不含原文） */
function shortHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** 稳定序列化（键排序；循环引用退化成 `[circular]`——不抛） */
function safeStringify(v: unknown): string {
  const seen = new WeakSet<object>()
  const walk = (x: unknown): unknown => {
    if (x === null || typeof x !== 'object') return x
    if (seen.has(x as object)) return '[circular]'
    seen.add(x as object)
    if (Array.isArray(x)) return x.map(walk)
    const o = x as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(o).sort()) out[k] = walk(o[k])
    return out
  }
  try {
    return JSON.stringify(walk(v))
  } catch {
    return String(v)
  }
}

/**
 * ★createRequestEngineering：请求数据层语义实例（注入式——client + reactivity + cache + concurrency）
 * 用法：const req = createRequestEngineering({ client: api, reactivity: { ref, computed, watch }, cache, concurrency: 4 })
 * 设计：R1/R4 把「手写缓存+去重」收敛为语义调用；R2 提供 Vue 生态最实用的响应式数据获取（SWR）；
 *      R3 队列纯逻辑（FIFO + 并发上限 + 失败隔离）——全部注入式可单测
 */
export function createRequestEngineering(options: RequestEngineeringOptions): RequestEngineering {
  const { client, reactivity, cache, concurrency } = options
  const limit = concurrency !== undefined ? concurrency : 4
  const now = () => Date.now()

  // —— R4 dedupe：key → in-flight promise 表（R1/R2 共享） ——
  const inflight = new Map<string, Promise<unknown>>()

  function runOnce<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key) as Promise<T> | undefined
    if (existing) return existing
    const p = task().then(
      (v) => {
        inflight.delete(key)
        return v
      },
      (e) => {
        inflight.delete(key)
        throw e
      },
    )
    inflight.set(key, p)
    return p
  }

  // —— R3 enqueue：并发队列（FIFO + limit + 失败隔离） ——
  const queue: Array<() => void> = []
  let running = 0

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        running += 1
        Promise.resolve()
          .then(task)
          .then((v) => {
            running -= 1
            dequeue()
            resolve(v)
          })
          .catch((e) => {
            running -= 1
            dequeue()
            reject(e)
          })
      }
      if (running < limit) run()
      else queue.push(run)
    })
  }

  function dequeue(): void {
    if (running >= limit) return
    const next = queue.shift()
    if (next) next()
  }

  // —— 缓存读写 ——
  function readCache<T>(key: string): T | undefined {
    if (!cache || cache.get === undefined) return undefined
    const entry = cache.get<RequestCacheEntry<T>>(key)
    if (entry === undefined) return undefined
    if (entry.staleAt > 0 && now() > entry.staleAt) {
      cache.remove(key)
      return undefined
    }
    return entry.data
  }

  function writeCache<T>(key: string, data: T, ttl: number): void {
    if (!cache || ttl <= 0) return
    const entry: RequestCacheEntry<T> = { data, createdAt: now(), staleAt: ttl > 0 ? now() + ttl : 0 }
    cache.set(key, entry)
  }

  // —— R1 request：策略请求 ——
  async function strategyRequest<T>(config: RequestConfig, strategy?: RequestStrategyOptions): Promise<RequestResponse<T>> {
    const hasStrategy = strategy !== undefined
    const method = config.method !== undefined ? config.method : 'GET'
    // ★#1342 C2：body 参与键（此前不含 ⇒ 不同 POST 体被错误合并/覆盖）
    const cacheKey =
      hasStrategy && strategy.cacheKey !== undefined
        ? strategy.cacheKey
        : defaultCacheKey(method, config.url, config.params, config.data)
    const ttl = hasStrategy && strategy.ttl !== undefined ? strategy.ttl : 0
    if (ttl > 0) {
      const hit = readCache<RequestResponse<T>>(cacheKey)
      if (hit !== undefined) return hit
    }
    // 去重：同 cacheKey 并发 → 共享同一次执行（即使不进缓存，也避免重复请求）
    const execute = () => client.request<T>(config)
    if (hasStrategy && strategy.queue === true) {
      // ★队列语义：真实网络调用必须发生在队列槽位内（enqueue 前不发请求）——
      //   去重在队列内依旧生效（同 key 排队任务共享同一个 in-flight）
      // ★★★#1342 C2 修 bug：此前 `return enqueue(...)` 直接返回 ⇒ **跳过了写缓存**
      //   ⇒ `ttl` 与 `queue` 同时使用时永远不写缓存（"配了 TTL 却永不命中"）。
      //   现在队列路径也在成功后写缓存。
      const queued = await enqueue(() => runOnce(cacheKey, execute))
      writeCache(cacheKey, queued, ttl)
      return queued
    }
    const run = runOnce(cacheKey, execute)
    const res = await run
    writeCache(cacheKey, res, ttl)
    return res
  }

  // —— R2 useQuery：SWR 响应式数据获取 ——
  function useQuery<T>(key: string, fetcher: () => Promise<T>, queryOptions?: QueryOptions): QueryHandle<T> {
    const useCacheFlag = queryOptions === undefined ? true : queryOptions.useCache !== false
    const ttl = queryOptions !== undefined && queryOptions.ttl !== undefined ? queryOptions.ttl : 0
    let pending = false
    const state = reactivity.ref<QueryState<T>>({ data: undefined, loading: false, error: undefined })
    const cacheKey = 'query:' + key

    const applySuccess = (data: T) => {
      state.value = { data, loading: false, error: undefined }
      if (ttl > 0) writeCache(cacheKey, data, ttl)
    }
    const applyError = (error: unknown) => {
      state.value = { data: state.value.data, loading: false, error }
    }
    const load = (): Promise<T> => {
      state.value = { data: state.value.data, loading: true, error: undefined }
      pending = true
      return runOnce('fetch:' + key, fetcher)
        .then((data) => {
          pending = false
          applySuccess(data)
          return data
        })
        .catch((e) => {
          pending = false
          applyError(e)
          throw e
        })
    }

    // 同步初始化：命中缓存 → 直接用；否则立即发起（loading 态）
    const cached = useCacheFlag ? readCache<T>(cacheKey) : undefined
    if (cached !== undefined) {
      state.value = { data: cached, loading: false, error: undefined }
    } else {
      state.value = { data: undefined, loading: true, error: undefined }
      pending = true
      runOnce('fetch:' + key, fetcher)
        .then((data) => {
          pending = false
          applySuccess(data)
        })
        .catch((e) => {
          pending = false
          applyError(e)
        })
    }

    return {
      state,
      refresh: () => load(),
      mutate: (data) => {
        state.value = { data, loading: false, error: undefined }
        if (ttl > 0) writeCache(cacheKey, data, ttl)
      },
      invalidate: () => {
        if (cache && cache.remove !== undefined) cache.remove(cacheKey)
      },
      pending: () => pending,
    }
  }

  return {
    request: strategyRequest,
    useQuery,
    enqueue,
    runOnce,
    clearCache: () => {
      if (cache && cache.clear !== undefined) cache.clear()
    },
    queued: () => queue.length,
  }
}

/**
 * ★G-31 B7 收口：能力桥 → 请求执行器适配（useFetch 的底层桥成为策略请求的 client）
 * 用法：const req = createRequestEngineering({ client: createCapabilityRequestClient(createCapabilityBridge()), reactivity, cache })
 *       —— req.request/useQuery 走同一平台桥（wx.request / fetch 双端）+ 缓存/去重/队列增强；
 *          useFetch 语义 = req.request 的裸版（无策略）——业务升级只需换入口不换桥
 * 缺桥（bridge.request 缺失）→ request 返回 rejected CapError（G-32.3：非抛同步异常）
 */
export function createCapabilityRequestClient(bridge: CapabilityBridge): RequestExecutor {
  return {
    request: <T = unknown>(config: RequestConfig) => {
      if (!bridge.request) return Promise.reject(new CapError('fetch.unsupported', '能力桥未提供 request（capability 请求不可用）'))
      return bridge.request(config) as Promise<RequestResponse<T>>
    },
  }
}