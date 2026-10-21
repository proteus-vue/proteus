// packages/api/src/capability-app-request-types.ts
// ★★#1158：`AppRequestConfig` / `AppRequestResponse` 的**存放地**（从 `capability-invoke.ts` 抽出）。
//
// 【为什么单列一个文件】`capability-invoke.ts` 在 #1158 之前已 998 行（`check:file-size` 硬上限 1000）,
//   本轮加传输读数（`transport`）就把它顶过线。按纪律**不抬基线、不删注释糊弄** ⇒ 抽出来。
//   ★这两段本来就是**线格式字段归类**的契约描述（url/method/headers/params/timeoutMs/responseType
//     各有 TLV tag），与 `capability-invoke.ts` 的 `splitFramePayload` 归类表同源——独立成文件后
//     "字段清单 + 归类"住得更近，比埋在 998 行文件末尾更可维护。

import type { ResponseKind, TransportReadout } from './invoke-wire'
import type { AbortSignalLike } from './capability-fetch-types'

/** 请求配置（对齐 `RequestConfig`） */
export interface AppRequestConfig {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  baseURL?: string
  params?: Record<string, unknown>
  data?: unknown
  headers?: Record<string, string>
  /** ms，默认 15000（与 types 包同默认） */
  timeout?: number
  retry?: number
  retryDelay?: number
  skipAuth?: boolean
  /** ★S2（#903）：响应体解释方式——`arraybuffer` 时 `data` 是**裸 `Uint8Array`**（不做文本解码） */
  responseType?: ResponseKind
  /**
   * ★★★#1120 **流式上传**（S3）：宿主自己从沙箱读文件、拼 multipart、边读边发。
   * 给出本字段 ⇒ **不要**再传 `data`（文件字节由宿主读，JS 不碰）。
   * ★只支持单文件（与 wx 一致）；`boundary` 必须与请求头 `Content-Type` 里的一致。
   */
  upload?: {
    path: string
    fieldName: string
    filename: string
    boundary: string
    formData?: Record<string, string>
  }
  /**
   * ★★★#1119 **落盘路径**（S3）：让**宿主自己**把响应体写进沙箱文件。
   *
   * 【为什么需要】不设本字段时，download 是「宿主收整包 → 回推 JS → JS 调 fs.writeBytes 写盘」
   *   ⇒ **文件多大 JS 堆就吃多大**。设了本字段，宿主边收边写，**JS 完全不碰字节**。
   * ★路径语义与 `fs.writeBytes` 一致（沙箱相对路径，拒绝绝对路径与 `..`）。
   * ★鸿蒙暂不支持（一次性 VM 无回推接收方）⇒ 该端 `unsupported`。
   */
  savePath?: string
  /** ★★★#1118 流式消费（S3）：每块调一次。给了 ⇒ 分块回推（内存不随响应体增长）；不给 ⇒ 整包（受 32 MiB 上限）。
   *  ★回调**同步**（宿主回推的 JS 线程上）——做重活会拖慢后续块，需异步请自行入队。
   *  ★seq 必须连续（丢帧即 reject，不静默拼半截数据）；★鸿蒙无回推接收方 ⇒ `fetch.unsupported`。 */
  onChunk?: (chunk: Uint8Array, seq: number) => void
  /**
   * ★★★#1121 **取消**（S3 回收维度）：取消时 JS 侧立即 reject（`fetch.aborted`），
   * 并**尽力**通知宿主中止传输（`http.cancel`）。
   * ★App 引擎没有 `AbortController` ⇒ 用 `createAbortController()`（本模块导出）。
   * ★诚实边界：宿主未实现 `http.cancel` 时 JS 侧仍会 reject，但**后台传输不会停**。
   */
  signal?: AbortSignalLike
  /** ★#1134 **重定向不跟随**（宿主侧最小能力）：true ⇒ 宿主不跟随 3xx，把 `status` + `Location`
   *  原样回给 JS（跟随/拦截策略在 fetch 管线）。★由管线自动置位，业务一般不直接用。 */
  redirectManual?: boolean
  /**
   * ★#1149 **让平台自带 HTTP 缓存让开**（管线置位；本字段**不进线格式 meta**——`appHttpRequest`
   * 把它翻译成内部头 `X-Proteus-Bypass-Platform-Cache`，宿主消费后从转发头剔除，防外泄）。
   */
  bypassPlatformCache?: boolean
  /** ★#1153：换行分隔的 base64 SHA-256 SPKI 指纹（见 `MetaTagInvoke.Pins`） */
  tlsPins?: string
  /** ★#1153：true ⇒ 用 pin 替代系统信任（见 `MetaTagInvoke.PinOnly`） */
  tlsPinOnly?: boolean
}

/** 请求响应（对齐 `RequestResponse`） */
export interface AppRequestResponse<T> {
  data: T
  status: number
  headers: Record<string, string>
  config: AppRequestConfig
  /**
   * ★★★#1158：宿主侧传输读数（**原始字符串形态**；缺键 = 该端测不到该项）。
   * ★整项缺失 ⇒ 本次请求宿主没提供任何读数（Web/MP，或未升级的老宿主）。
   */
  transport?: TransportReadout
}