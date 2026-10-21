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
 * ★★★#1153：把 `tlsPins` 的多种书写形态归一成**换行分隔的字符串**。
 *
 * 接受：`string`（已分隔）/ `string[]`（最常见）/ 含逗号或空白分隔的单串。
 * 归一理由：线格式只有一个 `str` 载荷（见 `MetaTagInvoke.Pins`），
 * 若三处各自处理数组形态，迟早有一处漏掉（本仓 #1134 的"四层白名单"同族）。
 * ★去空白 + 去重 + 保序：顺序对语义无影响，但**去重**能避免同一指纹写两遍（诊断时更清楚）。
 */
export function normalizePins(pins: string | string[] | undefined): string | undefined {
  if (pins === undefined) return undefined
  const list = Array.isArray(pins) ? pins : String(pins).split(/[\s,]+/)
  const out: string[] = []
  for (const raw of list) {
    let p = String(raw).trim()
    if (!p) continue
    // ★★★必须与**宿主**同一口径处理 HPKP 风格前缀（`sha256/<b64>`）。
    //   判据实测抓出：TS 侧原样保留 `sha256/`，而 Android 宿主会剥掉 ⇒
    //   "按文档写的 pin 串"在 JS 里看着对、到宿主被剥成另一种形态 ⇒ 两端指纹字面量不一致。
    //   ★★★而且**不能按"第一个 /"切**：base64 字母表含 `/`
    //   ⇒ 判据里就有一张指纹本身带 `/`（`...ji/ixb6...`），按任意 `/` 切会把指纹截断。
    //   只认**确切的**算法前缀（大小写不敏感）。
    const m = /^(?:sha256|sha-256)\//i.exec(p)
    if (m) p = p.slice(m[0].length)
    // ★★统一 base64 字母表并把**填充补回**：
    //   ① URL-safe（`-`/`_`）⇒ 换回标准（`+`/`/`）——装置常这么传，避免 shell 吃掉 `+` `/` `=`；
    //   ② **补 `=` 填充**（★真机抓出的缺陷：首版只在"含 `-`/`_`"时才补，
    //      而某张指纹恰好不含这两个字符却仍被去了填充 ⇒ 归一后是 43 字符无 `=`，
    //      宿主 `Base64.decode` 解析失败 ⇒ 整条 pin 被丢弃 ⇒ pinning **静默失效**）。
    //   ⇒ 填充是**独立于字母表**的一步，必须无条件按长度做。
    if (p.includes('-') || p.includes('_')) p = p.replace(/-/g, '+').replace(/_/g, '/')
    const pad = p.length % 4
    if (pad === 2) p += '=='
    else if (pad === 3) p += '='
    if (p && !out.includes(p)) out.push(p)
  }
  return out.length > 0 ? out.join('\n') : undefined
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
      // ★★★#1153 TLS pinning（App 三端；Web/MP 腿会明确 reject）
      //   ★数组归一成换行串在本层做：下游（appHttpRequest / 线格式）只认字符串，
      //     否则三处各写一遍归一逻辑（且容易有一处漏掉数组形态）。
      tlsPins: normalizePins(config?.tlsPins),
      tlsPinOnly: config?.tlsPinOnly,
    })
    /**
     * ★★★#1158：`transport` 必须透传 —— 第 4 段链路。
     * 【为什么这条要写成注释而不是只加一行代码】本字段一共要穿五段
     *   （宿主 → 线格式 → `settleFromFrame` → `appHttpRequest` → **这里** → 管线），
     *   而 `runFetch` 此前是"挑三个字段重新拼一个对象"的形态 ⇒ 新字段**默认会被丢掉**。
     *   ★这正是 #1134 `redirectManual` 漏在中间层、#1122 五个 S3 字段没进门面的同一类缺陷：
     *     "底层做了、上层没用"。判据 `tests/fetch-pipeline.test.ts` 现在断言到这一层。
     */
    const out: {
      ok: true
      data: T
      status: number
      headers: Record<string, string>
      transport?: Record<string, string>
    } = { ok: true, data: r.data as T, status: r.status, headers: r.headers }
    const tp = (r as { transport?: Record<string, string> }).transport
    if (tp) out.transport = tp
    return out
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
