// packages/api/src/capability-app-request.ts
// ★★★#1122：**App 端 `http.request` 的桥实现**（从 `capability-app.ts` 抽出）。
//
// 【为什么单列】`capability-app.ts` 已 2096 行（`check:file-size` 棘轮只减不增），
//   而这段逻辑本轮从 8 行涨到 ~20 行（透传 5 个 S3 字段 + 保住错误码）。
//   它是**一次网络请求的完整语义**（选腿 / 透传 / 结果整形 / 错误码归一），与"能力装配"是两个职责。
//
// 【★本文件修的两个真缺陷】
//   ① 此前 args 只带旧 6 个字段 ⇒ 上层传下来的 `responseType/savePath/onChunk/upload/signal`
//      **在这里被静默丢弃**（底层做了 S3、门面也传了，但中间这一层吃掉）。
//   ② 此前 catch 里除 `fetch.tooLarge`/`unsupported` 外**一律压成 `fetch.failed`**
//      ⇒ 取消（`fetch.aborted`）与超时（`fetch.timeout`）在门面上**不可区分**，
//      业务无法决定"该不该重试"。真机实测暴露：取消生效了（宿主 hits=1）但码报成 failed。

import { invokeHostAsync, invokeHostStream } from './capability-invoke'
import type { AppRequestConfig, AppRequestResponse } from './capability-invoke'

/** 宿主方法名（`http.request`）。 */
const HTTP_REQUEST = 'http.request'

/**
 * 发一次 App 端 HTTP 请求。
 *
 * @param CapError 调用方注入的错误类（本模块不 import 具体实现，避免循环依赖）
 * @param config 完整配置（含 S3 字段）
 */
export function appHttpRequest(
  // ★`CapError` 是泛型类（各调用方有自己那个 `E`）⇒ 只要求"能按 (code, message) 构造出 Error"
  CapError: new (code: string, message: string) => Error,
  config: AppRequestConfig,
): Promise<AppRequestResponse<unknown>> {
  // ★五个 S3 字段必须全部透传（此前只带旧 6 个 ⇒ 上层传下来也在此丢掉）
  const args = {
    url: config.url, method: config.method, data: config.data, params: config.params,
    headers: config.headers, timeout: config.timeout, responseType: config.responseType,
    savePath: config.savePath, onChunk: config.onChunk, upload: config.upload, signal: config.signal,
  }
  const budget = (config.timeout ?? 15000) + 2000
  // 有 `onChunk` ⇒ 流式（内存不随响应体增长）；否则整包（受 32 MiB 上限）
  const run = config.onChunk
    ? invokeHostStream(HTTP_REQUEST, args, config.onChunk, budget, config.signal)
    : invokeHostAsync(HTTP_REQUEST, args, budget, { signal: config.signal })
  return run
    .then((d) => {
      const r = (d ?? {}) as { data?: unknown; status?: number; headers?: Record<string, string> }
      return { data: r.data, status: Number(r.status ?? 0), headers: r.headers ?? {}, config }
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      // ★保住错误码：自带 `code` > 消息前缀 > failed（此前一律压成 failed 是真缺陷）
      const ownCode = (e as { code?: unknown })?.code
      const byCode = typeof ownCode === 'string' && /^fetch\./.test(ownCode) ? ownCode : ''
      const byPrefix = /^(fetch\.[a-zA-Z]+):/.exec(msg)?.[1] ?? ''
      const code = byCode || byPrefix || (/^unsupported:/.test(msg) ? 'fetch.unsupported' : 'fetch.failed')
      const clean = msg.replace(/^(fetch\.[a-zA-Z]+|unsupported):\s*/, '')
      throw new CapError(code, clean)
    })
}
