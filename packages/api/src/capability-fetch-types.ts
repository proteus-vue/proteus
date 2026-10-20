// packages/api/src/capability-fetch-types.ts
// ★★★#1122：**useFetch 的类型面**（从 `capability-types.ts` 抽出）。
//
// 【为什么单列】`capability-types.ts` 已 3881 行（`check:file-size` 存量棘轮只减不增）。
//   `FetchConfig` / `FetchResult` / `FetchOk` 是**网络能力专属**的一组类型（它们描述的是
//   `bridge.request` 的入参与出参），与「设备/媒体/支付/存储」那些能力类型没有耦合 ⇒
//   抽出来既让主文件回落，也把"网络请求的契约"集中到一处。
//
// 【★#1122 要解决的问题】此前 `FetchConfig` 只有 6 个字段，而底层 S3 能力
//   （`responseType` / `savePath` / `onChunk` / `upload` / `signal`）**全都没暴露** ⇒
//   业务侧根本够不着。本文件把它们全部开放，并如实标注端差异。

import type { HttpMethod } from '@proteus-vue/types/api-types'
import type { CapError } from './capability-types'

/**
 * useFetch 配置。★#1122：S3 能力（流式/落盘/上传/取消）此前底层做完但**门面没开口**——现已全部开放。
 */
export interface FetchConfig {
  /** HTTP 方法（缺省 GET） */
  method?: HttpMethod
  /** 请求体（POST/PUT；对象自动 JSON 序列化） */
  data?: unknown
  /** URL 查询参数（拼接到 query string） */
  params?: Record<string, unknown>
  /** 自定义请求头 */
  headers?: Record<string, string>
  /** 超时（ms；超时 → Err） */
  timeout?: number
  /** ★#1122 响应体解释方式（`arraybuffer` ⇒ `data` 是裸字节）。端差异：wx 给 `ArrayBuffer`。 */
  responseType?: 'text' | 'json' | 'arraybuffer'
  /** ★#1122 落盘路径（仅 App）：宿主**直接写沙箱文件**，`data` 回路径，内存与文件大小无关。Web/MP ⇒ unsupported。 */
  savePath?: string
  /**
   * ★#1122 流式消费：每块回调一次，内存不随响应体增长。**回调同步**（宿主回推的 JS 线程上）。
   * App 逐块回推；Web 用 ReadableStream（节奏不同）；**MP 不支持** ⇒ unsupported。
   */
  onChunk?: (chunk: Uint8Array, seq: number) => void
  /** ★#1122 流式上传（仅 App）：宿主自读文件、自拼 multipart、边读边发。Web/MP 用各自上传 API ⇒ unsupported。 */
  upload?: UploadSpec
  /**
   * ★#1122 取消：`abort()` ⇒ 立即 `fetch.aborted`，并尽力通知宿主中止传输。
   * App 用 `createAbortController()`（引擎无原生 AbortController）；Web 用原生 `AbortSignal`；**MP 不支持**。
   */
  signal?: AbortSignalLike
}

/** ★#1122：流式上传规格（宿主据此自读文件 + 自拼 multipart）。 */
export interface UploadSpec {
  /** 沙箱相对路径（与 `fs.readBytes` 同一套校验：拒绝绝对路径与 `..`） */
  path: string
  /** multipart 字段名（如 `file`） */
  fieldName: string
  /** 上传文件名（进 `Content-Disposition` 的 filename） */
  filename: string
  /** multipart 边界串——**必须与 `Content-Type` 头里的一致** */
  boundary: string
  /** 普通表单字段（按插入序编码） */
  formData?: Record<string, string>
}

/** 最小取消信号契约（兼容原生 `AbortSignal` 与 `createAbortController()` 的产物）。 */
export interface AbortSignalLike {
  readonly aborted: boolean
}

/** ★#1122：`useFetch` 成功结果（`data` 解构保持兼容；`status`/`headers` 为新增）。 */
export interface FetchOk<T> {
  ok: true
  data: T
  /** ★此前被 `useFetch` 丢弃 ⇒ 业务无法区分 404/500 */
  status: number
  headers: Record<string, string>
}

/** ★#1122：`useFetch` 的结果（成功带 status/headers，失败只有 error）。 */
export type FetchResult<T> = FetchOk<T> | { ok: false; error: CapError }
