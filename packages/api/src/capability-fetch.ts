// packages/api/src/capability-fetch.ts
// ★★★#1122：**useFetch 的实现**（从 `capability.ts` 抽出）。
//
// 【为什么单列】`capability.ts` 是 1092 行的能力装配面（`check:file-size` 存量棘轮只减不增）。
//   `useFetch` 的实现在本单里从 5 行涨到 ~30 行（要透传 5 个 S3 字段 + 回 status/headers），
//   而它的**语义**（网络请求的入参归一 + 结果整形）与"装配"是两个职责 ⇒ 抽出。
//
// 【★#1122 解决的问题（门面没开口）】此前 `useFetch` 只透传 6 字段、且只回 `data`：
//   · 底层 S3 能力（`responseType`/`savePath`/`onChunk`/`upload`/`signal`）业务**够不着**；
//   · `status` / `headers` 被丢弃 ⇒ 业务无法区分 404/500。
//
// 【★端差异（如实标注，不假装三端一致）】
//   | 能力 | App | Web | MP |
//   |---|---|---|---|
//   | responseType | ✅ 宿主裸字节 | ✅（见 web 腿） | ⚠️ 平台解码 |
//   | savePath（落盘） | ✅ 宿主直写 | ❌ unsupported | ❌ unsupported |
//   | onChunk（流式） | ✅ 逐块回推 | ✅ ReadableStream | ❌ unsupported |
//   | upload（流式上传） | ✅ 宿主自读 | ❌（用 FormData） | ❌（用 wx.uploadFile） |
//   | signal（取消） | ✅ http.cancel | ✅ 原生 AbortSignal | ❌ unsupported |
//   上述 unsupported 分支由**各端桥自己**抛 `fetch.unsupported`（本函数只透传，不猜）。

import { CapError } from './capability-types'
import { capErr } from './capability-types'
import type { FetchConfig, FetchResult } from './capability-fetch-types'
import type { RequestConfig, RequestResponse } from '@proteus-vue/types/api-types'

/** 桥的最小面（只取本函数用到的部分——避免把整个 CapabilityBridge 拖进来）。 */
export interface FetchBridge {
  request?(config: RequestConfig): Promise<RequestResponse<unknown>>
}

/**
 * 发一次网络请求（`useFetch` 的实现）。
 *
 * @returns 成功 = `{ ok:true, data, status, headers }`；失败 = `{ ok:false, error }`（**不抛**，G-32.3）。
 */
export async function runFetch<T>(
  bridge: FetchBridge,
  url: string,
  config?: FetchConfig,
): Promise<FetchResult<T>> {
  if (!bridge.request) {
    return capErr<T>('fetch.unsupported', '桥未提供 request（useFetch 不可用）') as FetchResult<T>
  }
  try {
    // ★S3 字段全部透传（此前一个都没传 ⇒ 底层做了也白做）
    // ★★#1134：新增字段必须**同步加进本清单**——本函数是 useFetch 的唯一出口，
    //   漏一个就是"底层做了但业务够不着"（#1122 的原缺陷形态）。
    //   ★这条写成注释不够：`tests/fetch-redirect.test.ts` 用真 HTTP 服务断言 manual 真的不跟随，
    //     漏透传会当场红（这正是本轮抓到的：先漏了 redirect/redirectManual，4 条判据变红）。
    const r = await bridge.request({
      url,
      method: config?.method,
      data: config?.data,
      params: config?.params,
      headers: config?.headers,
      timeout: config?.timeout,
      responseType: config?.responseType,
      savePath: config?.savePath,
      onChunk: config?.onChunk,
      upload: config?.upload,
      signal: config?.signal,
      // ★retry / priority 是**管线字段**，不下传桥（桥只执行一次请求；重试与排队由管线负责）
      redirect: config?.redirect,
      maxRedirects: config?.maxRedirects,
      onRedirect: config?.onRedirect,
      redirectManual: config?.redirectManual,
      // ★★★#1149：让 Web 腿关掉浏览器自带缓存（框架层缓存是唯一语义来源）。
      //   ★`cache` 本身是**管线字段**，不下传桥（缓存判定与 304 合成都在管线里完成）。
      bypassPlatformCache: config?.bypassPlatformCache,
    })
    return { ok: true, data: r.data as T, status: r.status, headers: r.headers }
  } catch (e) {
    // ★#1122：错误码优先取 `CapError.code`，但**普通 Error 带 `code` 也要认**——
    //   各端桥可能抛自己构造的 Error（如 Web 腿的 `fetch.aborted` / `fetch.timeout`）；
    //   只认 `instanceof CapError` 会把它们全压成 `fetch.failed` ⇒ 业务失去"是否重试"的判断依据。
    const anyE = e as { code?: unknown }
    // ★兜底：也从消息前缀识别（有些抛点只给 message，不给 `code` 属性）
    const msg = e instanceof Error ? e.message : String(e)
    const prefix = /^(fetch\.[a-zA-Z]+):/.exec(msg)?.[1]
    const code = e instanceof CapError ? e.code : (typeof anyE?.code === 'string' ? anyE.code : (prefix ?? 'fetch.failed'))
    return capErr<T>(code, e instanceof Error ? e.message : String(e), e) as FetchResult<T>
  }
}
