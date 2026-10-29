// packages/api/src/capability-fetch-dedupe.ts
// ★★★#1386：请求管线的**去重身份**计算（从 `capability-fetch-pipeline.ts` 拆出）。
//
// 【为什么单独成文件（不是"为过 1000 行门禁而拆"）】
//   `capability-fetch-pipeline.ts` 一度到 1058 行越过硬上限。按纪律应当**按职责拆**：
//   本文件只有一个职责——**回答"两个在飞请求是不是同一个请求"**。
//   它与管线其它部分（拦截器 / 重试 / 缓存 / 并发 / 观测）没有共享可变状态，
//   输入 `(url, config)` 输出 `string`，是纯函数 ⇒ 拆出来无环、可独立判据。
//
// 【痛点 #9 是什么（本文件的由来）】
//   主流库的去重键常漏 body/headers：`POST` 不同内容被当成同一个、跨租户请求被合并。
//   本仓旧键只有 `method + url + params + body`，注释理由写着
//   "鉴权头由拦截器加，同资源应共享"——那条理由只在**同一鉴权域内**成立。
//   多租户下（本库核心卖点 #1342 #17/#18）两个 bizId 打同一 URL、带不同 Authorization
//   ⇒ 键相同 ⇒ 被合并 ⇒ **A 拿到 B 的应答**（跨租户数据泄漏）。
//
// 【★两条相反方向的失效，本文件同时防】——正确性优先，但不能矫枉过正：
//   · 键**太窄**（漏身份）⇒ 错合并 ⇒ 数据串号（严重）
//   · 键**太宽**（含每请求都变的头）⇒ 去重永不命中 ⇒ 功能名存实亡（也严重）
//   ⇒ 只收"会改变应答内容"的头（下面白名单），既不放行串号、也不收追踪头。
import type { FetchConfig } from './capability-fetch-types'

/**
 * 参与去重键的**身份相关** header（小写比较）。
 *
 * 【收录口径】"换一个值就会得到不同应答"的头：
 *   · `authorization` / `cookie` / `proxy-authorization` —— 身份
 *   · `idempotency-key` —— 幂等语义（不同 key = 不同逻辑请求）
 *   · `x-biz-id` / `x-tenant-id` / `x-org-id` / `x-user-id` —— 多租户轴（本库卖点）
 *   · `accept-language` —— 内容协商
 *   · `content-type` —— 请求体解析方式（同一 body 不同 content-type 是不同语义）
 *
 * 【**不**收录】`x-request-id` / `traceparent` / `x-timestamp` 这类每请求都变的追踪头：
 *   它们一变键就变 ⇒ 去重永远不命中。那不是"更安全"，是把功能关掉了。
 */
export const DEDUPE_IDENTITY_HEADERS: readonly string[] = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'idempotency-key',
  'x-biz-id',
  'x-tenant-id',
  'x-org-id',
  'x-user-id',
  'accept-language',
  'content-type',
]

/**
 * 去重键：**完整请求身份** = 方法 + URL + query + body + 身份头 + responseType + 流式形态。
 *
 * @param url 已拼好 baseURL 的最终地址
 * @param config 请求配置（取 method/params/data/headers/responseType/stream 等）
 *
 * ★为什么 `responseType` 与流式形态也进键：它们的**应答形态不同**
 *   （`arraybuffer` vs `text`、`onChunk` 逐块 vs 整包）⇒ 共享同一份在飞结果会拿到错误形态。
 */
export function dedupeKey(url: string, config: FetchConfig): string {
  const p = config.params
  const params = p
    ? Object.keys(p)
        .filter((k) => p[k] !== undefined)
        .sort()
        .map((k) => `${k}=${String(p[k])}`)
        .join('&')
    : ''
  let body = ''
  if (config.data !== undefined) {
    try {
      body = JSON.stringify(config.data)
    } catch {
      // ★不可序列化的 body（循环引用 / 函数）⇒ 退化为 String()：
      //   键失去区分能力时**宁可让两个请求不合并**（String 后通常也不同），
      //   也不能因为抛错把整个请求打死。
      body = String(config.data)
    }
  }
  // 身份头（名字小写规范化后排序；值原样——键只在进程内 Map 里活，不上日志）
  let identity = ''
  const hs = config.headers
  if (hs) {
    const pairs: string[] = []
    for (const name of Object.keys(hs)) {
      if (!DEDUPE_IDENTITY_HEADERS.includes(name.toLowerCase())) continue
      const v = hs[name]
      if (v === undefined) continue
      pairs.push(`${name.toLowerCase()}=${String(v)}`)
    }
    pairs.sort()
    identity = pairs.join('&')
  }
  // 流式请求的应答形态完全不同（onChunk 会被谁收到？）⇒ 流式不与非流式合并。
  // ★★注意：`FetchConfig` **没有** `stream: boolean` 字段——流式由这两个字段表达
  //   （`savePath` 落盘 / `onChunk` 逐块回调）。我第一版写了 `config.stream`，
  //   `tsc` 当场报 TS2339（"Property 'stream' does not exist"）——`vitest` 不做类型检查，
  //   只有包构建才发现。⇒ 这就是"改完要跑 build-packages 而不只是跑测试"的原因。
  const streaming = config.savePath !== undefined || typeof config.onChunk === 'function'
  const shape = `${config.responseType ?? 'text'}|${streaming ? 'stream' : 'whole'}`
  return `${config.method ?? 'GET'} ${url}?${params} ${body} #${identity} ${shape}`
}
