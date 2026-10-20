// packages/api/src/capability-transfer.ts
// ★★★决策 #1095（2026-10-19）：App 端 C29 `useUpload` / C30 `useDownload` 桥。
//
// 【为什么之前 App 端没有这两项】
//   它们的 wx 形态是「临时文件路径 + 表单上传 / 下载到临时文件」，而 App 端**没有 wx 那套
//   uploadFile/downloadFile 原生 API**。但底子其实都在：
//     · `http.request`（#903 字节腿）已支持 `responseType: 'arraybuffer'` ⇒ 能拿/发裸字节；
//     · 缺的只有"字节落盘"与"文件读成字节"——那是宿主文件系统（JS 侧无 FS）。
//   ⇒ 本轮补两个宿主方法（见 `APP_NATIVE_METHODS.fsWriteBytes/fsReadBytes/fsRemove`），
//     再用 `http.request` 拼出两条腿。**不新增网络栈**，复用 G-46 会话共享（Cookie 已在 http.request 里）。
//
// 【与 wx 行为的对齐（诚实说明差异）】
//   · **下载**：wx 的 `responseType: 'path'` 回临时文件路径；App 端同样落盘到宿主沙箱并回 `path`。
//     `blob`/`text`/`json` 走 `http.request` 原样返回（不需要落盘）。
//   · **上传**：wx 的 `formData` 是 multipart 表单；App 端**手工组 multipart**（RFC 7578 最小集），
//     因为宿主侧没有表单构造器。★只支持**单文件**（`filePath` 或 `file`）——与 wx 同限制。
//   · **进度**：wx 有 `onProgressUpdate`；`http.request` 的字节腿**无分块进度**（一次性回包）
//     ⇒ App 端进度只在"开始 0 / 完成 100"两个点上报，**中间值不伪造**。
//
// 【诚实边界】
//   · 大文件会**整块进 JS 内存**（arraybuffer）再交宿主写盘——未做流式落盘（需宿主改成分块协议）。
//     已在能力页端边界写明；大文件场景建议走分片上传（业务侧）。
//   · `Blob` 在 App 引擎里不存在 ⇒ `options.file` 这条腿在 App 端**如实 unsupported**，
//     只支持 `filePath`（与 wx 一致）。

import { invokeHost, invokeHostAsync } from './capability-invoke'
import { CapError as ProteusCapError } from './capability-types'
import type { CapResult, DownloadOptions, DownloadResult, ProgressCallback, UploadOptions, UploadResult } from './capability-types'
import type { CapabilityResource, CapabilityResourceRegistry } from './capability-resources'   // ★#1094

/** 宿主方法名（与服务端/宿主契约对齐） */
export const APP_TRANSFER_METHODS = {
  writeBytes: 'fs.writeBytes',
  readBytes: 'fs.readBytes',
  remove: 'fs.remove',
} as const

type R<T, E extends Error = ProteusCapError> = { ok: true; data: T } | { ok: false; error: E }

function errOf(code: string, message: string): ProteusCapError {
  const e = new ProteusCapError(code, message) as ProteusCapError & { code?: string }
  if (typeof (e as { code?: unknown }).code !== 'string') {
    Object.defineProperty(e, 'code', { value: code, enumerable: true, configurable: true })
  }
  return e
}


/** 从宿主回执取字节（`number[]` 或 base64 都接受——三端壳习惯不同）。 */
function bytesFromReply(d: unknown): Uint8Array | null {
  if (!d || typeof d !== 'object') return null
  const o = d as { bytes?: unknown }
  if (Array.isArray(o.bytes)) return Uint8Array.from(o.bytes as number[])
  return null
}

/**
 * ★#1119：`writeToHost` 已删除——download 的 `path` 语义改由**宿主直写沙箱**（`savePath` meta），
 *   JS 侧不再"收整包 → 转字节 → 调 fs.writeBytes"（那条路让 JS 堆随文件大小增长）。
 *   `fs.writeBytes` 仍保留（业务仍可能用它写小文件）。
 */

/** 从宿主沙箱读字节。 */
async function readFromHost(path: string): Promise<Uint8Array> {
  const r = await invokeHostAsync(APP_TRANSFER_METHODS.readBytes, { path }, 30000)
  const bytes = bytesFromReply(r)
  if (!bytes) throw errOf('upload.failed', `fs.readBytes 未返回字节（收到 ${JSON.stringify(r)}）`)
  return bytes
}

/** 从 `filePath` 推断 multipart 的 filename（取最后一段；无则 'file'）。 */
function filenameOf(path: string): string {
  const seg = path.split('/').filter(Boolean)
  return seg.length ? (seg[seg.length - 1] as string) : 'file'
}

/**
 * UTF-8 编码（★**不依赖 TextEncoder**）。
 *
 * 【为什么手写（真机实测抓出）】App 三端 JS 引擎（QuickJS / JSC 精简版 / JSVM）**没有 TextEncoder**
 *   ⇒ `new TextEncoder()` 直接 ReferenceError，上传整个失败。
 *   这与本仓既有的「App 无 TextDecoder」同族（#1071 曾为此手写 utf8Decode）。
 *   本实现覆盖 BMP + 代理对（与标准 UTF-8 一致），仅对孤立代理项按 U+FFFD 处理（标准也这么做）。
 */
function utf8Encode(str: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < str.length; i++) {
    let cp = str.charCodeAt(i)
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
      const lo = str.charCodeAt(i + 1)
      if (lo >= 0xdc00 && lo <= 0xdfff) { cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00); i++ }
      else cp = 0xfffd
    } else if (cp >= 0xd800 && cp <= 0xdfff) {
      cp = 0xfffd
    }
    if (cp < 0x80) out.push(cp)
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
  }
  return Uint8Array.from(out)
}

/** 最小 multipart/form-data 组包（RFC 7578）。★只支持单文件——与 wx 同限制。 */
function buildMultipart(
  boundary: string,
  fieldName: string,
  filename: string,
  fileBytes: Uint8Array,
  formData?: Record<string, string>,
): Uint8Array {
  const parts: Uint8Array[] = []
  // ① 普通字段（先放，与浏览器 FormData 的常见顺序一致）
  for (const k of Object.keys(formData ?? {})) {
    parts.push(utf8Encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${(formData as Record<string, string>)[k]}\r\n`))
  }
  // ② 文件字段
  parts.push(utf8Encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`,
  ))
  parts.push(fileBytes)
  parts.push(utf8Encode(`\r\n--${boundary}--\r\n`))
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

/**
 * App 端**下载**（C30）。
 *
 * `responseType: 'path'` ⇒ 落盘到宿主沙箱并回 `path`；其余 ⇒ 原样回 `data`（不落盘）。
 * ★进度只有 0 / 100 两个点（`http.request` 无分块进度——**中间值不伪造**）。
 */
export function createAppDownload(): (url: string, options?: DownloadOptions, onProgress?: ProgressCallback) => Promise<DownloadResult> {
  return async (url, options = {}, onProgress) => {
    const wantPath = options.responseType === 'path' || options.responseType === undefined
    const wantJson = options.responseType === 'json'
    onProgress?.(0)
    // ★★★#1119（S3）：`path` 语义走**宿主直写沙箱**——JS 侧完全不碰字节，
    //   内存占用与文件大小**解耦**。此前是「整包回推 JS → 再调 fs.writeBytes 写盘」
    //   ⇒ 文件多大 JS 堆就吃多大（视频/安装包直接 OOM）。
    if (wantPath) {
      const target = `download/${Date.now()}-${filenameOf(url)}`
      const d = await invokeHostAsync(
        'http.request',
        { url, method: 'GET', headers: options.headers, timeout: options.timeout, savePath: target },
        (options.timeout ?? 15000) + 2000,
      )
      const r = (d ?? {}) as { data?: unknown; status?: number; headers?: Record<string, string> }
      const status = Number(r.status ?? 0)
      // ★宿主回的 `data` 是 `{path,size}` 摘要（也可能是字符串化的 JSON——两种都接）
      let summary: { path?: unknown; size?: unknown } = {}
      if (typeof r.data === 'string') {
        try { summary = JSON.parse(r.data) as { path?: unknown; size?: unknown } } catch { /* 非 JSON ⇒ 用 target 兜底 */ }
      } else if (r.data && typeof r.data === 'object') {
        summary = r.data as { path?: unknown; size?: unknown }
      }
      const path = typeof summary.path === 'string' ? summary.path : (typeof (summary as { savePath?: unknown }).savePath === 'string' ? (summary as { savePath: string }).savePath : target)
      onProgress?.(100)
      return { status, data: path, path, progress: 100 }
    }
    const responseType = wantJson ? 'text' : options.responseType === 'blob' ? 'arraybuffer' : 'text'
    const d = await invokeHostAsync(
      'http.request',
      { url, method: 'GET', headers: options.headers, timeout: options.timeout, responseType },
      (options.timeout ?? 15000) + 2000,
    )
    const r = (d ?? {}) as { data?: unknown; status?: number; headers?: Record<string, string> }
    const status = Number(r.status ?? 0)
    let data: unknown = r.data
    let path: string | undefined
    if (responseType === 'arraybuffer') {
      const bytes = data instanceof Uint8Array ? data : (Array.isArray(data) ? Uint8Array.from(data as number[]) : null)
      if (!bytes) throw errOf('download.failed', `http.request 未返回字节（收到 ${typeof data}）`)
      // ★#1119：`path` 语义已在上面走"宿主直写"分支 ⇒ 这里只剩 `blob`（原样回字节）
      data = bytes
    } else if (wantJson && typeof data === 'string') {
      try { data = JSON.parse(data) } catch { /* 非 JSON ⇒ 原样回文本（与 wx 一致：不猜） */ }
    }
    onProgress?.(100)
    return { status, data, ...(path !== undefined ? { path } : {}), progress: 100 }
  }
}

/**
 * App 端**上传**（C29）。
 *
 * ★只支持 `filePath`（App 引擎没有 `Blob`——`options.file` 如实 unsupported）。
 * ★手工组 multipart（宿主侧没有表单构造器），复用 `http.request` 发字节。
 */
export function createAppUpload(): (options: UploadOptions, onProgress?: ProgressCallback) => Promise<UploadResult> {
  return async (options, onProgress) => {
    if (options.file) {
      throw errOf('upload.unsupported', 'App 端不支持 Blob 上传（引擎无 Blob）——请用 filePath（与 wx 一致）')
    }
    if (!options.filePath) {
      throw errOf('upload.failed', '上传需要 filePath（wx 同语义：临时文件路径）')
    }
    const fileBytes = await readFromHost(options.filePath)
    const boundary = `----ProteusBoundary${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const body = buildMultipart(boundary, options.name ?? 'file', filenameOf(options.filePath), fileBytes, options.formData)
    const headers: Record<string, string> = {
      ...(options.headers ?? {}),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    }
    onProgress?.(0)
    const d = await invokeHostAsync(
      'http.request',
      // ★★★#1095 真机抓出的契约陷阱：`encodeBody`（capability-invoke）只把
      //   Uint8Array / ArrayBuffer / ArrayBufferView 当**原始字节**；普通 `number[]` 会落到
      //   `JSON.stringify` ⇒ body 变成 `"[1,2,3]"` 文本（服务端解析出 0 字节）。
      //   ⇒ 必须传 Uint8Array 本体，不能传 toByteArray(...)。
      { url: options.url, method: 'POST', headers, data: body, timeout: options.timeout, responseType: 'text' },
      (options.timeout ?? 15000) + 2000,
    )
    const r = (d ?? {}) as { data?: unknown; status?: number }
    onProgress?.(100)
    return { status: Number(r.status ?? 0), data: r.data, progress: 100 }
  }
}

/**
 * App 端 `upload` / `download` 两个桥成员（装配用）。
 *
 * ★大 buffer 也登记进资源账本（G-43）：上传/下载过程中会有整块字节驻留 JS 内存，
 *   页面离开时即便请求还在飞也应可被标记释放（关闭是最佳努力——'http.request' 本身
 *   没有取消通道，这里如实只做"账本销账 + 状态可观测"，不谎称能中断）。
 */
export function createAppTransfer(resOpts: { resources?: CapabilityResourceRegistry; owner?: string } = {}) {
  const download = createAppDownload()
  const upload = createAppUpload()
  return {
    download: (url: string, options?: DownloadOptions, onProgress?: ProgressCallback) => {
      let res: CapabilityResource | null = null
      if (resOpts.resources) {
        res = resOpts.resources.register({
          type: 'transfer-download',
          owner: resOpts.owner,
          sourceLocation: 'packages/api/src/capability-transfer.ts',
          release: () => { /* 见上：http.request 无取消通道——只销账，不谎称能中断 */ },
        })
      }
      const done = (): void => { if (res) { res.release(); res = null } }
      return download(url, options, onProgress).then(
        (r) => { done(); return r },
        (e) => { done(); throw e },
      )
    },
    upload: (options: UploadOptions, onProgress?: ProgressCallback) => {
      let res: CapabilityResource | null = null
      if (resOpts.resources) {
        res = resOpts.resources.register({
          type: 'transfer-upload',
          owner: resOpts.owner,
          sourceLocation: 'packages/api/src/capability-transfer.ts',
          release: () => { /* 同上 */ },
        })
      }
      const done = (): void => { if (res) { res.release(); res = null } }
      return upload(options, onProgress).then(
        (r) => { done(); return r },
        (e) => { done(); throw e },
      )
    },
  }
}

/** 探针用：确认宿主三个 fs 方法是否都在（诊断读数）。 */
export function appTransferProbe(): { writeBytes: boolean; readBytes: boolean; remove: boolean } {
  const has = (m: string): boolean => {
    const r = invokeHost(m, { probe: true })
    // missing ⇒ 宿主没有该方法
    return !(r.ok === false && r.missing === true)
  }
  return {
    writeBytes: has(APP_TRANSFER_METHODS.writeBytes),
    readBytes: has(APP_TRANSFER_METHODS.readBytes),
    remove: has(APP_TRANSFER_METHODS.remove),
  }
}
