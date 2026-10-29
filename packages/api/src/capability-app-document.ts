// packages/api/src/capability-app-document.ts
// ★★★#1384 App 能力 C84：`openDocument` —— 文档预览（App 桥实现）。
//
// 【为什么现在补】C84 自 NC1（2026-09-30）起只有 **MP（`wx.openDocument`）+ Web（`window.open`）**
//   两条腿，App 端在 `bridge-decls/open-document.ts` 里被标成"属声明层，随宿主工程接线"
//   ⇒ `useOpenDocument` 在 App 恒 `document.open.unsupported`。而三端平台本来都有原生预览入口：
//     · Android `Intent.ACTION_VIEW` + `content://`（本端自建 ContentProvider 供 URI）
//     · iOS     `QLPreviewController`（QuickLook 系统预览器）
//     · 鸿蒙    `filePreview.openPreview`（HMS `@kit.PreviewKit`，`@since 4.1.0(11)`）
//   ⇒ 属"有平台能力、没接线"。这与 C21 拨号（#1285）、C22 分享（#1336）是同一条主线。
//
// 【★★语义边界（三件事别混）】
//   ① 本方法 = **预览**（只读展示）——不编辑、不回写、不返回用户改过的内容；
//   ② 它**不是"选择文件"**（那是 picker，`wx.chooseMessageFile` 一类的另一个能力）；
//   ③ 返回只代表**预览器已交给系统**（`{presented|dispatched:true}` / 鸿蒙 `{accepted:true}`），
//      不代表"用户看完了"——系统预览器没有回调通道，本方法不谎称回执含交互结果。
//
// 【★★路径纪律：只认沙箱相对路径（与 `fs.*` 同一条 deny-by-default）】
//   App 端所有文件能力（`fs.readBytes`/`fs.writeBytes`/upload/download 的 savePath）都只接受
//   **沙箱相对路径**，宿主各自解析到私有目录（Android `getFilesDir()` / iOS `Documents` /
//   鸿蒙 `filesDir`）。本方法沿用同一口径：**绝对路径与 `..` 一律拒绝**。
//   ★为什么不做"绝对路径也放行"：预览会把文件字节交给**另一个 App**（系统预览器/第三方阅读器）
//     ——放开绝对路径等于给业务一个"把任意私有文件递出去"的接口。拒绝比放行安全。
//
// 【★★扩展名白名单（不是"拿到什么就预览什么"）】
//   宿主需要 MIME 才能让系统知道交给谁：Android 的 `Intent` 没有 type 就解析不到接收方、
//   鸿蒙 `PreviewInfo.mimeType` 是**必填**。而"猜不出 MIME"时若硬塞 `application/octet-stream`，
//   系统会当成二进制附件（多数设备无接收方 ⇒ 表现为"点了没反应"，最难归因的失败形态）。
//   ⇒ **白名单**：pdf/doc/docx/xls/xlsx/ppt/pptx/txt（前 7 项与 `wx.openDocument` 的官方支持集对齐，
//     `txt` 是本端扩展——三端原生预览器都认）。不在白名单 ⇒ 直接报错，不猜、不降级。
//
// 【诚实边界（分端如实登记，不粉饰）】
//   · **能否真的预览取决于设备上有没有处理该 MIME 的应用**：Android 找不到接收方 ⇒
//     `ActivityNotFoundException` ⇒ 本端 `document.open.unsupported`（不是假成功）；
//     iOS/鸿蒙由系统预览器兜底（通常恒有）。
//   · **单文件上限 64 MiB**（与 `fs.readBytes` 同值）：预览要把整份文件交给系统，
//     超大文件在低端机上会 OOM/卡死，与本仓"边界资源要设闸"的纪律一致。
//   · **鸿蒙走动作队列**（同步 napi 里不能 await `openPreview`）⇒ 回执是 `{accepted:true}`（已入队），
//     真正拉起的证据是设备日志 `PROTEUS_DOC_PREVIEW_OK`（见 `hosts/harmony/run-document-probe.sh`）。
//   · ★★★**本文件不得使用 `new URL()` / `URL` 构造器**：App 精简引擎（QuickJS/JSC 精简版）
//     没有 URL —— #1336 真机实测过（Node 单测全绿、iOS 真机直接抛）。扩展名解析一律纯正则。
import { invokeHost } from './capability-invoke'

/** 路径长度上限（沙箱相对路径不该有这么长；超长一律按非法处理，也防把整个 payload 塞进来） */
export const DOC_OPEN_MAX_PATH_LEN = 512
/** 单文件上限 64 MiB（与 `fs.readBytes` 的 `MAX_READ_BYTES` **同值**，改一处要改四处） */
export const DOC_OPEN_MAX_BYTES = 64 * 1024 * 1024

/**
 * 扩展名 → MIME（**白名单**；三端宿主各有同一份映射，改一处要改四处）。
 * ★顺序即展示顺序，不含逻辑依赖。
 */
export const DOC_OPEN_MIME: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
}

/** 支持的扩展名（不含点，小写）——错误信息里用它列出允许集 */
export const DOC_OPEN_EXTENSIONS: readonly string[] = Object.keys(DOC_OPEN_MIME)

/** 归一化后的预览请求（三端宿主收到的形状） */
export interface NormalizedDocumentRequest {
  /** 沙箱相对路径（原样透传，宿主各自解析到私有目录） */
  path: string
  /** 由扩展名推出的 MIME；宿主**不信任**本字段，会自己按扩展名再推一遍 */
  mimeType: string
  /** 预览器标题（取文件名，去掉目录与扩展名） */
  title: string
}

/** 去掉路径分隔符后的文件名（纯字符串处理——**不能用 `URL`/`path`**，见文件头） */
function baseName(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

/**
 * 校验并归一化预览请求；非法抛 `Error`（调用方负责包成 rejection）。
 * ★导出以便判据直接验证规则本身，而不是只测"最终有没有报错"。
 */
export function assertDocumentRequest(filePath: unknown): NormalizedDocumentRequest {
  if (typeof filePath !== 'string') {
    throw new Error('document.open.invalid: filePath 必须是字符串')
  }
  const p = filePath.trim()
  if (p.length === 0) throw new Error('document.open.invalid: filePath 为空')
  if (p.length > DOC_OPEN_MAX_PATH_LEN) {
    throw new Error(`document.open.invalid: filePath 过长（${p.length} > ${DOC_OPEN_MAX_PATH_LEN}）`)
  }
  // ★不回显原始路径的敏感部分：错误信息里只给"形态问题"，不回显整串（可能含业务目录名）
  if (p.startsWith('/')) {
    throw new Error('document.open.invalid: 只接受沙箱相对路径（不接受绝对路径）')
  }
  // 反斜杠/控制字符：POSIX 上虽是合法文件名字符，但三端宿主语义不同 ⇒ 一律拒（不猜）
  if (/[\\\u0000-\u001f\u007f]/.test(p)) {
    throw new Error('document.open.invalid: 路径含非法字符（反斜杠或控制字符）')
  }
  for (const seg of p.split('/')) {
    if (seg === '..') throw new Error('document.open.invalid: 路径不得含 ".."（拒绝目录穿越）')
  }
  const name = baseName(p)
  if (name.length === 0) throw new Error('document.open.invalid: 路径缺少文件名')
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) {
    throw new Error('document.open.invalid: 文件没有扩展名，无法判定预览类型')
  }
  const ext = name.slice(dot + 1).toLowerCase()
  const mimeType = DOC_OPEN_MIME[ext]
  if (!mimeType) {
    // ★不回显扩展名以外的信息；列出允许集，让业务知道该先转格式
    throw new Error(
      `document.open.unsupported-format: 不支持 .${ext}（支持：${DOC_OPEN_EXTENSIONS.join('/')}）`,
    )
  }
  return { path: p, mimeType, title: name.slice(0, dot) }
}

/** 桥成员对象（★抽取器契约：顶层唯一 `return { 显式属性 }`） */
export interface AppDocumentBridge {
  openDocument?: (filePath: string) => Promise<void>
}

/** 宿主是否提供文档预览（缺 `document.open` ⇒ 不提供该方法 ⇒ useOpenDocument 如实 unsupported） */
export function appOpenDocumentAvailable(): boolean {
  const r = invokeHost('document.open', { probe: true })
  // 与 capability-app-phone/share/log 同款写法（短路联合窄化）：
  //   `{probe:true}` 一定会被宿主按"非法参数"拒掉，但**拒掉 ≠ 没有该方法**——
  //   只有 missing:true 才代表宿主没有这个方法。
  return r.ok || !(!r.ok && r.missing)
}

export function createAppDocument(): AppDocumentBridge {
  return {
    openDocument: (filePath: string) => {
      // ★★★必须返回 rejected Promise，不能同步 throw：签名是 `Promise<void>`（与 Web/MP 契约一致），
      //   同步抛错会绕过调用方的 `.catch()`，变成"未捕获异常"（#1285/#1336 同款坑）。
      let req: NormalizedDocumentRequest
      try {
        req = assertDocumentRequest(filePath)
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)))
      }
      const r = invokeHost('document.open', req)
      if (!r.ok) {
        // ★missing（宿主未实现）也应落到这里：装配层已用 appOpenDocumentAvailable() 挡过一层，
        //   但业务可能绕过装配直接构造桥 ⇒ 保留分档信息在 reason 里。
        const kind = r.missing ? 'document.open.unsupported' : 'document.open.failed'
        return Promise.reject(new Error(`${kind}: 宿主拒绝预览（${r.reason ?? '未知原因'}）`))
      }
      // ★宿主回执两种形态都接受：直接拉起（Android `{dispatched:true}` / iOS `{presented:true}`）
      //   或已入队（鸿蒙 `{accepted:true}`）——**不得**把"已入队"报成"已打开"。
      return Promise.resolve()
    },
  }
}
