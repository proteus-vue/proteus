// hosts/ios/ProteusHost/runtime/InvokeWire.swift
// ★★★invoke 通道的**二进制线格式**（Swift 侧唯一实现）—— SSOT = `packages/api/src/invoke-wire.ts`
//
// 【为什么有本文件（决策 #903 / T-app-wire · 用户 2026-10-13 指令）】「跨语言数据通道不要用 JSON 字符串，
//   性能损耗太大，走纯二进制方向」。此前 invoke 通道派发 `JSON.stringify({...args,__reqId})`、回推
//   `__proteusHostResolve(reqId, json)` —— **两处都是 JSON 文本**；响应体几 MB 时每字节膨胀 3~4×
//   + 两次 UTF-8 编解码 + 一次 parse（1MB 级 ~10ms）。本文件是 iOS 宿主侧的解码/编码端。
//
// 【★与 TS 的等价性是**硬契约**，不是"大致相同"】三端原生编解码器必须与
//   `packages/api/src/invoke-wire.ts` **逐字节等价**——判据 = `pnpm check:invoke-wire-parity`
//   （Node 侧用 TS 编解码器产 golden 帧 → `swiftc` 编译本文件 + `hosts/ios/tools/InvokeWireParity.swift`
//   → 逐字节比对；这是本仓纪律 #22「第 N 份手写副本 = 下一个静默缺陷」的**机器化对策**：
//   手写副本不可怕，没有对拍才可怕）。同名对拍已有 Java 腿（`hosts/android/.../InvokeWire.java`）。
//
// 【线格式（与 `blob.rs`「PLYT」/ `rects_bin.rs`「PRES」/ `slot-runtime/buffer.ts`「PVOP」同族纪律）】
//   · 全**小端**；`magic u32 + version u32` 开头（去程 `PINV` / 回程 `PRSP`），magic 不符即拒；
//   · 定长 header（20B）+ 长度前缀变长区（解码即游标推进，无字符扫描、无 JSON 语法层）；
//   · 大块载荷（请求 / 响应 body）**裸字节垫底**（不 base64、不当字符串）；
//   · 未知 TLV tag **跳过而不报错**（版本演进：老宿主遇新 tag 应忽略，而非崩）。
//
//   去程帧布局：
//     [0..20)  magic u32 · version u32 · flags u32 · metaBytes u32 · bodyBytes u32
//     [20..)   method(u16 len + utf8) · reqId(u16 len + utf8) · meta(TLV) · body(裸字节)
//   回程帧布局（字段更少）：
//     [0..20)  magic u32 · version u32 · flags u32 · metaBytes u32 · bodyBytes u32
//     [20..)   reqId(u16 len + utf8) · meta(TLV) · body(裸字节)
//   TLV 项：`tag u8 · len u32 · payload`
//
// 【★为什么本文件**只 import Foundation**（零 UIKit / 零 JavaScriptCore）】① 可在本机 macOS 上
//   `swiftc` 直编并跑对拍（不需要真机/模拟器/Xcode 工程）；② 编解码是**纯字节变换**，与平台无关——
//   引入 UIKit 只会让"能对拍"变成"不能对拍"。
//
// 【★两个 Swift 特有的坑（Java/TS 不存在，故在此钉住）】
//   ① **name-value 必须是有序数组，不能用 Dictionary**：TS 用 `Object.entries`（插入序）、Java 用
//      `LinkedHashMap` ⇒ 编码顺序是**契约的一部分**（有对拍向量含多组 headers）。Swift `Dictionary`
//      无序 ⇒ 用它写 TLV 会让字节**随机漂移**（对拍门禁会间歇红，是"最难查的一类红"）。
//      故本文件的 `headers` / `params` 一律 `[(String, String)]`。
//   ② **可选字段判据必须与 TS `!== undefined` 对齐**：Swift `String?` / `UInt32?` / `Bool?` 天然区分
//      「未指定」与「显式 0 / false」——**不要**把 nil 折叠成 0（那会让 `timeoutMs=0` 这类显式值消失）。
//
// 【★诚实边界】UTF-8 用 Swift 标准实现（`Array(s.utf8)` / `String(decoding:as:UTF8.self)`）。
//   与 TS 侧的手写 UTF-8 在**合法字符串**上逐字节一致；差别只在**非法输入**（孤立代理对 / 畸形序列）：
//   TS 侧严格报错、Swift 侧宽松替换（与 Java 侧同一取舍）。本通道的输入由同进程的 JS 引擎产出（合法），
//   故取"代码更少、审查面更小"的一侧；若将来出现外部构造帧，须换成严格实现（本行即该边界的登记处）。

import Foundation

/// 线格式错误（解码失败一律抛它——宿主**不许静默接受**坏帧；与 TS 抛 Error / Java 抛异常同语义）
struct InvokeWireError: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
    init(_ m: String) { message = m }
}

enum InvokeWire {

    /* ────────────────────────── 常量（与 TS / Java 同源；改一处必须三端同步 + WIRE_VERSION +1） ────────────────────────── */

    /// 去程 magic = "PINV"（小端字节序 50 49 4E 56）
    static let INVOKE_MAGIC: UInt32 = 0x564e4950
    /// 回程 magic = "PRSP"（小端字节序 50 52 53 50）
    static let RESOLVE_MAGIC: UInt32 = 0x50535250
    /// 线格式版本（★字段增删 / 语义变更 ⇒ +1；三端必须同步）
    static let WIRE_VERSION: UInt32 = 1
    /// header 字节数（去程 / 回程同构）
    static let HEADER_BYTES = 20

    /// 去程 flags 位
    static let INVOKE_FLAG_HAS_BODY: UInt32 = 1 << 0
    /// 回程 flags 位
    static let RESOLVE_FLAG_HAS_BODY: UInt32 = 1 << 0
    /// 回程 flags 位：`ok === false`
    static let RESOLVE_FLAG_IS_ERROR: UInt32 = 1 << 1

    /* 去程 meta 的 TLV tag（★1–15 段留去程） */
    static let TAG_URL: UInt8 = 1
    static let TAG_HTTP_METHOD: UInt8 = 2
    static let TAG_HEADERS: UInt8 = 3
    static let TAG_PARAMS: UInt8 = 4
    static let TAG_TIMEOUT_MS: UInt8 = 5
    static let TAG_RESPONSE_TYPE: UInt8 = 6
    static let TAG_CONTENT_TYPE: UInt8 = 7
    /// ★#1118：请求分块回推（1 = 流式；nil = 整包）
    static let TAG_STREAM: UInt8 = 8
    /// ★#1119：落盘路径（宿主直写沙箱，JS 不碰字节）
    static let TAG_SAVE_PATH: UInt8 = 9
    /// ★#1120：流式上传规格（宿主自读文件 + 自拼 multipart）
    static let TAG_UPLOAD_PATH: UInt8 = 10
    /// ★#1134：重定向控制（1 = 宿主**不跟随**，把 3xx + Location 回给 JS；nil = 跟随）
    static let TAG_REDIRECT: UInt8 = 11
    /// ★#1153：TLS 证书 pinning（string = 换行分隔的 base64 SHA-256 **SPKI** 指纹）
    static let TAG_PINS: UInt8 = 12
    /// ★#1153：pinning 信任语义（1 = 用 pin **替代**系统信任；nil = 叠加）
    static let TAG_PIN_ONLY: UInt8 = 13

    /* 回程 meta 的 TLV tag（★16 起留回程，两段不重叠） */
    static let RTAG_HTTP_STATUS: UInt8 = 16
    static let RTAG_REASON: UInt8 = 17
    static let RTAG_MISSING: UInt8 = 18
    static let RTAG_PENDING: UInt8 = 19
    static let RTAG_HEADERS: UInt8 = 20
    /// ★#1118：流式块序号（有本字段 = 本帧是数据块，不结算）
    static let RTAG_STREAM_SEQ: UInt8 = 21
    /// ★★★#1158：传输层读数（name-values：proto/reused/dnsMs/connectMs/tlsMs/ttfbMs；缺键 = 不可得）
    /// ★iOS 是**全字段可得**的一端（`URLSessionTaskMetrics` 提供 DNS/连接/TLS/TTFB 分段 + 复用标记）
    static let RTAG_TRANSPORT: UInt8 = 22

    /// 响应体解释方式（与 `RequestConfig.responseType` 同语义）
    static let RESPONSE_TEXT: UInt8 = 0
    static let RESPONSE_JSON: UInt8 = 1
    static let RESPONSE_ARRAYBUFFER: UInt8 = 2

    /* ────────────────────────── 数据形态 ────────────────────────── */

    /// name-value 的**有序**容器（见文件头坑①——不要换成 Dictionary）。
    typealias NameValues = [(String, String)]

    /// ★★★#1120：流式上传规格（与 TS `UploadSpec` 逐一对应）。
    struct UploadSpec {
        var path = ""
        var fieldName = ""
        var filename = ""
        var boundary = ""
        /// ★有序键值对（与 `NameValues` 同理：编码顺序是契约的一部分，不能用 Dictionary）
        var formData: [(String, String)] = []
    }

    private static func writeUploadSpec(_ w: Writer, _ u: UploadSpec) throws {
        try w.str(u.path)
        try w.str(u.fieldName)
        try w.str(u.filename)
        try w.str(u.boundary)
        guard u.formData.count <= 65535 else { throw InvokeWireError("表单字段过多（>65535）：\(u.formData.count)") }
        w.u16(u.formData.count)
        for (k, v) in u.formData {
            try w.str(k)
            try w.str(v)
        }
    }

    private static func readUploadSpec(_ r: Reader) throws -> UploadSpec {
        var u = UploadSpec()
        u.path = try r.str()
        u.fieldName = try r.str()
        u.filename = try r.str()
        u.boundary = try r.str()
        let n = try r.u16()
        var fd: [(String, String)] = []
        for _ in 0..<n {
            let k = try r.str()
            fd.append((k, try r.str()))
        }
        u.formData = fd
        return u
    }

    /// 去程帧（`PINV`）解码结果——业务无关的"请求元数据 + 裸字节体"。
    struct InvokeFrame {
        var method: String = ""
        var reqId: String = ""
        var url: String?
        var httpMethod: String?
        var headers: NameValues?
        var params: NameValues?
        /// `nil` = **未指定**（对应 TS 侧 `meta.timeoutMs === undefined`）——见文件头坑②。
        var timeoutMs: UInt32?
        /// 见 `RESPONSE_*`；`nil` = **未指定**（同上理由——TS 侧 `!== undefined` 才写 TLV）
        var responseType: UInt8?
        var contentType: String?
        /// ★#1118：`nil` = 未指定（不写 TLV）——与 TS 侧 `meta.stream === true` 对齐
        var stream: Bool?
        /// ★#1119：非 nil ⇒ 宿主把响应体直接写进该沙箱路径
        var savePath: String?
        /// ★#1120：非 nil ⇒ 宿主边读文件边拼 multipart 边发
        var upload: UploadSpec?
        /// ★#1134：true ⇒ 不跟随重定向（nil = 跟随，与老行为一致）
        var redirectManual: Bool?
        /// ★#1153：非 nil ⇒ 只信任这些 SPKI 指纹（换行分隔的 base64 SHA-256）
        var tlsPins: String?
        /// ★#1153：true ⇒ 用 tlsPins **替代**系统信任；nil/false ⇒ 叠加
        var tlsPinOnly: Bool?
        var body: [UInt8] = []

        /// 取值语义（缺省 = text）——宿主消费时用这个，不要直接读可选字段。
        var responseKind: UInt8 { responseType ?? InvokeWire.RESPONSE_TEXT }

        /// 取值语义（缺省 = 15000ms，与 `RequestConfig` 默认一致）。
        var timeoutOrDefault: UInt32 { timeoutMs ?? 15000 }
    }

    /// 回程帧（`PRSP`）——宿主填它；`ok=false` 对应既有 `{"ok":false}`。
    struct ResolveFrame {
        var reqId: String = ""
        var ok: Bool = true
        /// `ok=false` 时的原因
        var reason: String?
        /// ★保留既有语义：壳未实现该方法（桥据此给 `*.unsupported`）
        var missing: Bool?
        /// ★保留既有语义：壳已受理、结果稍后回推（回推时须再发一帧 `pending=false`）
        var pending: Bool?
        /// HTTP 状态码（网络类回程）
        var status: UInt32?
        var headers: NameValues?
        /// ★#1118：非 nil ⇒ 本帧是流式数据块（不结算）；nil 且 pending != true ⇒ 最终帧
        var streamSeq: UInt32?
        /// ★★★#1158：传输层读数（nil 或空 ⇒ 不写 tag；宿主测不到任何项时不伪造）
        var transport: NameValues?
        var body: [UInt8] = []

        /// ★工厂名与 Java 的 `ok/err/missingMethod/pending` 对应（Swift 侧加 `make` 前缀以免与
        ///   同名属性在看代码时混淆）。
        static func makeOK(_ reqId: String) -> ResolveFrame {
            var f = ResolveFrame()
            f.reqId = reqId
            return f
        }

        static func makeErr(_ reqId: String, _ reason: String) -> ResolveFrame {
            var f = ResolveFrame()
            f.reqId = reqId
            f.ok = false
            f.reason = reason
            return f
        }

        /// ★"无此方法"（不是失败）：桥按 `missing` 给 `*.unsupported`，与既有 JSON 通道同口径。
        static func makeMissingMethod(_ reqId: String, _ reason: String) -> ResolveFrame {
            var f = makeErr(reqId, reason)
            f.missing = true
            return f
        }

        static func makePending(_ reqId: String) -> ResolveFrame {
            var f = makeOK(reqId)
            f.pending = true
            return f
        }
    }

    /* ────────────────────────── 去程：解码（宿主主用） ────────────────────────── */

    /// **只读方法名**（不做全帧解码）—— 给宿主记账 / 日志用。
    ///
    /// 【为什么单列一个】宿主日志端口要的是"哪个能力被调"，而帧是字节；若为记日志去 `decodeInvoke`，
    ///   会把 **body 整块拷贝一遍**（HTTP 请求体可能几 MB）——记日志的开销不该与载荷成正比。
    ///   本方法只走 header + 两个长度前缀，**不碰 meta / body**。
    ///   ★只用于诊断：解码失败返回 `"?"`（调用方本就要处理真正的失败，不该被日志路径影响）。
    static func peekMethod(_ bytes: [UInt8]) -> String {
        do {
            let r = Reader(bytes)
            if try r.u32() != INVOKE_MAGIC { return "?" }
            _ = try r.u32()   // version
            _ = try r.u32()   // flags
            _ = try r.u32()   // metaBytes
            _ = try r.u32()   // bodyBytes
            return try r.str()
        } catch {
            return "?"
        }
    }

    /// 解码 `PINV` 帧。
    /// ★判据与 TS 侧 `decodeInvokeFrame` 一致：magic / 版本不符即拒；尾部有残留即拒（防长度算错被静默接受）。
    static func decodeInvoke(_ bytes: [UInt8]) throws -> InvokeFrame {
        let r = Reader(bytes)
        let magic = try r.u32()
        if magic != INVOKE_MAGIC {
            throw InvokeWireError("去程帧 magic 不符：0x\(hex32(magic))（期望 0x\(hex32(INVOKE_MAGIC))）")
        }
        let version = try r.u32()
        if version != WIRE_VERSION {
            throw InvokeWireError("去程帧版本不符：\(version)（期望 \(WIRE_VERSION)）")
        }
        _ = try r.u32()   // flags（当前仅 HAS_BODY；body 长度已由 bodyBytes 给出 ⇒ 解码无需它）
        let metaBytes = try r.u32()
        let bodyBytes = try r.u32()
        var f = InvokeFrame()
        f.method = try r.str()
        f.reqId = try r.str()
        try decodeInvokeMeta(Reader(try r.raw(Int(metaBytes))), &f)
        f.body = try r.raw(Int(bodyBytes))
        if r.remaining != 0 {
            throw InvokeWireError("去程帧尾部有 \(r.remaining) 字节残留（格式或长度不符）")
        }
        return f
    }

    /// 解码 `PRSP` 帧（宿主侧一般不用；对拍门禁与诊断用）。
    static func decodeResolve(_ bytes: [UInt8]) throws -> ResolveFrame {
        let r = Reader(bytes)
        let magic = try r.u32()
        if magic != RESOLVE_MAGIC {
            throw InvokeWireError("回程帧 magic 不符：0x\(hex32(magic))（期望 0x\(hex32(RESOLVE_MAGIC))）")
        }
        let version = try r.u32()
        if version != WIRE_VERSION {
            throw InvokeWireError("回程帧版本不符：\(version)（期望 \(WIRE_VERSION)）")
        }
        let flags = try r.u32()
        let metaBytes = try r.u32()
        let bodyBytes = try r.u32()
        var f = ResolveFrame()
        f.reqId = try r.str()
        f.ok = (flags & RESOLVE_FLAG_IS_ERROR) == 0
        try decodeResolveMeta(Reader(try r.raw(Int(metaBytes))), &f)
        f.body = try r.raw(Int(bodyBytes))
        if r.remaining != 0 {
            throw InvokeWireError("回程帧尾部有 \(r.remaining) 字节残留（格式或长度不符）")
        }
        return f
    }

    /* ────────────────────────── 回程：编码（宿主主用） ────────────────────────── */

    /// 编码 `PRSP` 帧（宿主 → JS）。
    static func encodeResolve(_ f: ResolveFrame) throws -> [UInt8] {
        let meta = try encodeResolveMeta(f)
        let body = f.body
        var flags: UInt32 = 0
        if body.count > 0 { flags |= RESOLVE_FLAG_HAS_BODY }
        if !f.ok { flags |= RESOLVE_FLAG_IS_ERROR }
        let w = Writer(64)
        w.u32(RESOLVE_MAGIC)
        w.u32(WIRE_VERSION)
        w.u32(flags)
        w.u32(UInt32(meta.count))
        w.u32(UInt32(body.count))
        try w.str(f.reqId)
        w.raw(meta)
        w.raw(body)
        return w.done()
    }

    /// 编码 `PINV` 帧（宿主侧一般不用；对拍门禁用——与 TS `encodeInvokeFrame` 逐字节比对）。
    static func encodeInvoke(_ f: InvokeFrame) throws -> [UInt8] {
        let meta = try encodeInvokeMeta(f)
        let body = f.body
        let w = Writer(64)
        w.u32(INVOKE_MAGIC)
        w.u32(WIRE_VERSION)
        w.u32(body.count > 0 ? INVOKE_FLAG_HAS_BODY : 0)
        w.u32(UInt32(meta.count))
        w.u32(UInt32(body.count))
        try w.str(f.method)
        try w.str(f.reqId)
        w.raw(meta)
        w.raw(body)
        return w.done()
    }

    /* ────────────────────────── meta 编解码（TLV） ────────────────────────── */

    private static func decodeInvokeMeta(_ r: Reader, _ f: inout InvokeFrame) throws {
        while r.remaining > 0 {
            let tag = try r.u8()
            let len = try r.u32()
            if r.remaining < Int(len) {
                throw InvokeWireError("meta TLV 被截断：tag=\(tag) len=\(len) 剩余=\(r.remaining)")
            }
            let p = Reader(try r.raw(Int(len)))
            switch tag {
            case TAG_URL: f.url = try p.str()
            case TAG_HTTP_METHOD: f.httpMethod = try p.str()
            case TAG_HEADERS: f.headers = try readNameValues(p)
            case TAG_PARAMS: f.params = try readNameValues(p)
            case TAG_TIMEOUT_MS: f.timeoutMs = try p.u32()
            case TAG_RESPONSE_TYPE: f.responseType = try p.u8()
            case TAG_CONTENT_TYPE: f.contentType = try p.str()
            case TAG_STREAM: f.stream = try p.u8() != 0
            case TAG_SAVE_PATH: f.savePath = try p.str()
            case TAG_UPLOAD_PATH: f.upload = try readUploadSpec(p)
            case TAG_REDIRECT: f.redirectManual = try p.u8() != 0
            case TAG_PINS: f.tlsPins = try p.str()
            case TAG_PIN_ONLY: f.tlsPinOnly = try p.u8() != 0
            // ★未知 tag 跳过（版本演进：老解码头遇到新 tag 应忽略，而非报错）
            default: break
            }
        }
    }

    private static func decodeResolveMeta(_ r: Reader, _ f: inout ResolveFrame) throws {
        while r.remaining > 0 {
            let tag = try r.u8()
            let len = try r.u32()
            if r.remaining < Int(len) {
                throw InvokeWireError("回程 meta TLV 被截断：tag=\(tag) len=\(len) 剩余=\(r.remaining)")
            }
            let p = Reader(try r.raw(Int(len)))
            switch tag {
            case RTAG_HTTP_STATUS: f.status = try p.u32()
            case RTAG_REASON: f.reason = try p.str()
            case RTAG_MISSING: f.missing = try p.u8() != 0
            case RTAG_PENDING: f.pending = try p.u8() != 0
            case RTAG_HEADERS: f.headers = try readNameValues(p)
            case RTAG_STREAM_SEQ: f.streamSeq = try p.u32()
            case RTAG_TRANSPORT: f.transport = try readNameValues(p)
            default: break
            }
        }
    }

    private static func encodeInvokeMeta(_ f: InvokeFrame) throws -> [UInt8] {
        let w = Writer(64)
        if let url = f.url { try writeTlv(w, TAG_URL) { try w.str(url) } }
        if let m = f.httpMethod { try writeTlv(w, TAG_HTTP_METHOD) { try w.str(m) } }
        if let h = f.headers { try writeTlv(w, TAG_HEADERS) { try writeNameValues(w, h) } }
        if let p = f.params { try writeTlv(w, TAG_PARAMS) { try writeNameValues(w, p) } }
        // ★判据与 TS 逐字对齐：TS 是 `!== undefined` 才写 —— 故此处一律 `!= nil`（**不是** `!= 0`）
        if let t = f.timeoutMs { try writeTlv(w, TAG_TIMEOUT_MS) { w.u32(t) } }
        if let rt = f.responseType { try writeTlv(w, TAG_RESPONSE_TYPE) { w.u8(rt) } }
        if let ct = f.contentType { try writeTlv(w, TAG_CONTENT_TYPE) { try w.str(ct) } }
        // ★#1118：只在**显式 true** 时写（与 TS `meta.stream === true` 逐字对齐）
        if f.stream == true { try writeTlv(w, TAG_STREAM) { w.u8(1) } }
        if let sp = f.savePath { try writeTlv(w, TAG_SAVE_PATH) { try w.str(sp) } }
        if let up = f.upload { try writeTlv(w, TAG_UPLOAD_PATH) { try writeUploadSpec(w, up) } }
        // ★#1134：只在**显式要求不跟随**时写（缺省 = 平台跟随）
        if f.redirectManual == true { try writeTlv(w, TAG_REDIRECT) { w.u8(1) } }
        // ★#1153：pinning 只在显式要求时写（缺省 = 平台默认信任链）
        if let pins = f.tlsPins, !pins.isEmpty { try writeTlv(w, TAG_PINS) { try w.str(pins) } }
        if f.tlsPinOnly == true { try writeTlv(w, TAG_PIN_ONLY) { w.u8(1) } }
        return w.done()
    }

    private static func encodeResolveMeta(_ f: ResolveFrame) throws -> [UInt8] {
        let w = Writer(64)
        if let s = f.status { try writeTlv(w, RTAG_HTTP_STATUS) { w.u32(s) } }
        if let r = f.reason { try writeTlv(w, RTAG_REASON) { try w.str(r) } }
        if let m = f.missing { try writeTlv(w, RTAG_MISSING) { w.u8(m ? 1 : 0) } }
        if let p = f.pending { try writeTlv(w, RTAG_PENDING) { w.u8(p ? 1 : 0) } }
        if let h = f.headers { try writeTlv(w, RTAG_HEADERS) { try writeNameValues(w, h) } }
        if let sq = f.streamSeq { try writeTlv(w, RTAG_STREAM_SEQ) { w.u32(sq) } }
        // ★#1158：传输读数（**非空才写** —— 空数组不写 tag，老宿主/无读数端行为不变）
        if let t = f.transport, !t.isEmpty { try writeTlv(w, RTAG_TRANSPORT) { try writeNameValues(w, t) } }
        return w.done()
    }

    /// 写一个 TLV 项：`tag u8 + len u32 + payload`（len 由**占位回填**得到，payload 只编码一遍）。
    private static func writeTlv(_ w: Writer, _ tag: UInt8, _ payload: () throws -> Void) throws {
        w.u8(tag)
        let lenAt = w.length
        w.u32(0) // 占位
        let payloadAt = w.length
        try payload()
        try w.patchU32(lenAt, UInt32(w.length - payloadAt))
    }

    /// 键值对列表：`count u16 + (name u16len+utf8, value u16len+utf8) × count`
    /// ★有序数组（见文件头坑①）——顺序即契约。
    private static func writeNameValues(_ w: Writer, _ nv: NameValues) throws {
        if nv.count > 0xffff { throw InvokeWireError("键值对过多（>65535）：\(nv.count)") }
        w.u16(nv.count)
        for (k, v) in nv {
            try w.str(k)
            try w.str(v)
        }
    }

    private static func readNameValues(_ r: Reader) throws -> NameValues {
        let n = try r.u16()
        var out: NameValues = []
        out.reserveCapacity(n)
        for _ in 0..<n {
            let k = try r.str()
            out.append((k, try r.str()))
        }
        return out
    }

    /* ────────────────────────── 小端字节游标（与 `shared/src/binary/wire.ts` 同语义） ────────────────────────── */

    /// 写入游标（自动倍增扩容；`done()` 返回已写段）。
    final class Writer {
        private var buf: [UInt8]
        private(set) var length = 0

        init(_ size: Int) { buf = [UInt8](repeating: 0, count: max(8, size)) }

        private func ensure(_ n: Int) {
            if length + n <= buf.count { return }
            var cap = buf.count == 0 ? 64 : buf.count
            while cap < length + n { cap *= 2 }
            buf.append(contentsOf: [UInt8](repeating: 0, count: cap - buf.count))
        }

        func u8(_ v: UInt8) { ensure(1); buf[length] = v; length += 1 }

        func u16(_ v: Int) {
            ensure(2)
            buf[length] = UInt8(v & 0xff)
            buf[length + 1] = UInt8((v >> 8) & 0xff)
            length += 2
        }

        func u32(_ v: UInt32) {
            ensure(4)
            buf[length] = UInt8(v & 0xff)
            buf[length + 1] = UInt8((v >> 8) & 0xff)
            buf[length + 2] = UInt8((v >> 16) & 0xff)
            buf[length + 3] = UInt8((v >> 24) & 0xff)
            length += 4
        }

        /// u16 长度前缀 + UTF-8（长度以**字节**计，与 TS `str()` 同约定）。
        /// ★这是"本通道 JSON 被消灭"的落点之一：字符串只在此处编码一次——**无引号转义、无 Unicode
        ///   转义展开**（JSON 文本对非 ASCII 会做这一步，纯字节通道不会）。
        func str(_ s: String) throws {
            let b = Array(s.utf8)
            if b.count > 0xffff { throw InvokeWireError("字符串过长（>65535B）：\(b.count)") }
            ensure(2 + b.count)
            u16(b.count)
            for i in 0..<b.count { buf[length + i] = b[i] }
            length += b.count
        }

        /// 裸字节（无前缀）——大载荷走这里。
        func raw(_ b: [UInt8]) {
            if b.isEmpty { return }
            ensure(b.count)
            for i in 0..<b.count { buf[length + i] = b[i] }
            length += b.count
        }

        /// 在指定位置回填 u32（TLV 长度前缀）。
        func patchU32(_ at: Int, _ v: UInt32) throws {
            if at < 0 || at + 4 > length { throw InvokeWireError("回填越界：@\(at)（已写 \(length) 字节）") }
            buf[at] = UInt8(v & 0xff)
            buf[at + 1] = UInt8((v >> 8) & 0xff)
            buf[at + 2] = UInt8((v >> 16) & 0xff)
            buf[at + 3] = UInt8((v >> 24) & 0xff)
        }

        func done() -> [UInt8] { Array(buf[0..<length]) }
    }

    /// 读取游标（越界即抛，不静默补零）。
    final class Reader {
        private let buf: [UInt8]
        private var pos = 0

        init(_ buf: [UInt8]) { self.buf = buf }

        var remaining: Int { buf.count - pos }

        private func need(_ n: Int, _ what: String) throws {
            if remaining < n { throw InvokeWireError("字节流被截断（\(what)）") }
        }

        func u8() throws -> UInt8 { try need(1, "u8"); defer { pos += 1 }; return buf[pos] }

        func u16() throws -> Int {
            try need(2, "u16")
            let v = Int(buf[pos]) | (Int(buf[pos + 1]) << 8)
            pos += 2
            return v
        }

        func u32() throws -> UInt32 {
            try need(4, "u32")
            let v = UInt32(buf[pos]) | (UInt32(buf[pos + 1]) << 8)
                | (UInt32(buf[pos + 2]) << 16) | (UInt32(buf[pos + 3]) << 24)
            pos += 4
            return v
        }

        func str() throws -> String {
            let len = try u16()
            try need(len, "str")
            let s = String(decoding: buf[pos..<(pos + len)], as: UTF8.self)
            pos += len
            return s
        }

        /// 裸字节**拷贝**（调用方长期持有；TS 侧返回视图，此处不返回视图以免宿主复用底层数组时被改写）。
        func raw(_ n: Int) throws -> [UInt8] {
            try need(n, "raw")
            let out = Array(buf[pos..<(pos + n)])
            pos += n
            return out
        }
    }

    /* ────────────────────────── 工具 ────────────────────────── */

    /// magic 的十六进制回显（错误消息用；固定 8 位小写，与 TS `toString(16)` 的用途一致、格式无关契约）
    static func hex32(_ v: UInt32) -> String {
        let s = String(v, radix: 16)
        return String(repeating: "0", count: max(0, 8 - s.count)) + s
    }
}
