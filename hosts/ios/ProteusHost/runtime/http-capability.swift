// hosts/ios/ProteusHost/runtime/http-capability.swift
// ★★★C26 `http.request` 的 **iOS 真实实现**（S2 去 JSON 的首个消费者 · 决策 #903 / T-app-fetch）
//
// 【为什么单独一个文件（与 Android `HttpCapability.java` 同形）】能力对齐专项的首单是 `useFetch`
//   —— 它要的是"App 端真的发得出请求"。本文件把去程帧（`PINV` 的 meta：url/method/headers/params/
//   timeoutMs/responseType/contentType + 裸字节 body）变成**一次真实网络往返**，把结果编成回程帧
//   （`PRSP`：status + headers + 裸字节 body）回推给 JS 侧。
//
// 【形态：**立即回 `pending` 帧 + 网络线程完成后回推**（与 Android 同形）】
//   JS 线程调进来时**不做网络**（会卡住渲染）；`URLSession` 的回调在后台队列 ⇒ 结果经
//   `push` → 主线程 → `__proteusHostResolveBytes`（见 `invoke-bytes-bridge.swift`）。
//
// 【★会话共享（G-46 · 判据 CMP089–096 的 iOS 腿）】
//   · 请求侧：调用方**未显式设 `Cookie`** 时，从 `HTTPCookieStorage.shared` 取该 URL 的 cookie 并注入
//     （对应 Android 的 `CookieManager.getCookie(url)`）。URLSession 默认（`httpShouldSetCookies=true`）
//     本来也会带 cookie ⇒ 本步是**幂等的显式化**：既满足契约，也覆盖调用方关掉默认行为的场景。
//   · 响应侧：`Set-Cookie` 落到哪里**不由本文件决定**——URLSession 默认就在 `HTTPCookieStorage.shared`
//     （与 `URLSessionConfiguration.default` 共用同一存储）⇒ 三端"同一份会话"的 iOS 机制即此。
//     ★**不做二次解析 Set-Cookie**：`allHeaderFields` 会把重复的同名头合并，二次解析反而与系统行为
//     分叉（Android 侧必须自己 `setCookie` 是因为 OkHttp 不落 `CookieManager`——两端机制不同，
//     同一判据是"跨请求带上 cookie"，不是"以相同方式存取"）。
//   ★**诚实边界**：`WKWebView` 用的是 `WKHTTPCookieStore`（另一套存储）——WebView 与原生能力的
//   会话打通**本单未做**（与 Android 侧"登出级联清空未做"同级边界，已登记）。
//
// 【★其它诚实边界】
//   ① 重定向：`URLSession` 默认**跟随**（本实现不暴露 `redirect:'manual'`，与 Android 腿同边界）；
//   ② `request.timeoutInterval` 是**空闲/资源超时**，不等于"总时限"（与 Android
//      `setConnectTimeout/setReadTimeout` 的同一处边界）；真正的总时限由 JS 侧 `invokeHostAsync`
//      的超时兜底（默认 15000ms）；
//   ③ HTTP/2、压缩、连接池全走平台默认（不自造）；
//   ④ `params` 由 `URLComponents` 拼（百分号编码按 RFC 3986）——宿主持平台 API，不自己拼字符串。

import Foundation

final class HttpCapability {


    /// 处理一条 `http.request` 去程帧。
    /// - Returns: **立即**返回 `pending` 回程帧（JS 侧保持挂起）；最终结果经 `push` 回推。
    static func handle(_ f: InvokeWire.InvokeFrame, push: @escaping ([UInt8]) -> Void) throws -> [UInt8] {
        guard let url = buildURL(f) else {
            return try InvokeWire.encodeResolve(.makeErr(f.reqId, "http.request: url 非法或缺失（\(f.url ?? "<nil>")）"))
        }
        // ★★★#1180：**HTTPDNS 生产实现（B 路线：进程内本地 CONNECT 代理）**
        //   `f.httpDns` 有表 ⇒ 该表对应的本地代理（`HttpDnsProxy`）替 URLSession 解析，
        //   隧道内 SNI/Host/h2/复用全保留（#1178 模拟器 + #1179 真机实测）。
        //   · 表超上限（`HttpDnsProxies.maxTables`）⇒ **如实报错**（不能悄悄回落到默认 session：
        //     那会让业务以为表生效了、实际走系统 DNS —— 假数据比缺数据更糟）。
        //   · 无表 ⇒ `defaultSession`（零代理键），**生产默认路径完全不变**。
        guard let sess = session(for: f.httpDns) else {
            return try InvokeWire.encodeResolve(.makeErr(
                f.reqId,
                "fetch.unsupported: httpDns 表数量超过上限（\(HttpDnsProxies.maxTables) 张独立表）。" +
                "每张表需要一个独立代理端口与独立连接池——请合并域名或用同一张表"
            ))
        }
        var req = URLRequest(url: url)
        req.httpMethod = f.httpMethod ?? "GET"
        req.timeoutInterval = Double(f.timeoutOrDefault) / 1000.0
        // ★★★#1149：框架层缓存接管时，**关掉 URLSession 自带的 HTTP 缓存**。
        //   【为什么必须关（真机实测，不是推断）】iOS 走 `URLSessionConfiguration.default` ⇒
        //   系统 `URLCache` 会：① 自己发条件请求；② 把 304 **合成 200** 交给调用方
        //   （框架层就永远看不到 304 ⇒ `meta.cache` 只能报 miss，无法区分"谁在服务这次请求"）；
        //   ③ 无缓存头时也可能直接回本地副本（服务端零请求，但那是系统缓存的功劳）。
        //   ⇒ 约定头 `X-Proteus-Bypass-Platform-Cache: 1` 语义 = 绕过平台缓存；
        //     **消费后必须从转发头剔除**（否则这条内部头会外泄给业务服务端）。
        //   ★`f.headers` 是 `[(String, String)]`（有序对，编解码契约的一部分，见 InvokeWire.swift 头注）
        //     ⇒ 不能用字典下标，必须遍历判定（写成字典下标会编译失败）。
        let bypassHeaderName = "x-proteus-bypass-platform-cache"
        var bypassPlatformCache = false
        for (k, v) in f.headers ?? [] where k.lowercased() == bypassHeaderName && v == "1" {
            bypassPlatformCache = true
        }
        if bypassPlatformCache {
            req.cachePolicy = .reloadIgnoringLocalCacheData
        }
        for (k, v) in f.headers ?? [] {
            if k.lowercased() == bypassHeaderName { continue }
            req.setValue(v, forHTTPHeaderField: k)
        }
        if !f.body.isEmpty {
            req.httpBody = Data(f.body)
            if req.value(forHTTPHeaderField: "Content-Type") == nil, let ct = f.contentType {
                req.setValue(ct, forHTTPHeaderField: "Content-Type")
            }
        }
        // ★调用方**未显式设 Cookie** 时才注入（不覆盖调用方意图——与 Android 腿同判据）
        if req.value(forHTTPHeaderField: "Cookie") == nil, let mc = cookieHeader(for: url) {
            req.setValue(mc, forHTTPHeaderField: "Cookie")
        }

        let reqId = f.reqId
        // ★★★#1120：声明了流式上传 ⇒ 宿主**自己拼 multipart 并发送**（JS 不碰文件字节）
        //
        // 【★为什么用"拼成临时文件再 uploadTask(fromFile:)"而不是自定义 InputStream】
        //   本仓真机连试 4 轮自定义 `InputStream` 子类（`httpBodyStream` / `uploadTask(withStreamedRequest:)`
        //   / 补 `streamStatus` / 补 `needNewBodyStream`），**全部卡在"请求发出但服务端收不到"**。
        //   NSURLSession 对自定义 body 流有大量未文档化约束（抽象类成员、重试重建、长度协商）。
        //   ⇒ 改为：**先拼到临时文件**（内存只有一个 16 KiB 块，与文件大小无关），
        //     再用官方 `uploadTask(with:fromFile:)`（成熟路径，系统自己流式读文件发）。
        //   ★诚实登记：这不是"零拷贝流式"，而是"**内存有界** + 官方可靠路径"；
        //     多一次磁盘写（临时文件 ≈ 文件大小 + 头部），发送完即删。
        if let up = f.upload, !up.path.isEmpty {
            guard let src = sandboxSource(up.path) else {
                return try InvokeWire.encodeResolve(.makeErr(reqId, "fetch.failed: 上传路径非法或文件不存在：\(up.path)"))
            }
            guard let packed = packMultipartToTemp(spec: up, fileURL: src) else {
                return try InvokeWire.encodeResolve(.makeErr(reqId, "fetch.failed: 无法建立上传体（拼装临时文件失败）"))
            }
            if req.value(forHTTPHeaderField: "Content-Type") == nil {
                req.setValue("multipart/form-data; boundary=\(up.boundary)", forHTTPHeaderField: "Content-Type")
            }
            NSLog("[proteus] UPLOAD_PACKED total=%lld file=%@", packed.bytes, up.path)
            let task = sess.uploadTask(with: req, fromFile: packed.url)
            registerInflight(reqId, task)   // ★#1121：可取消
            BodyLimitDelegate.shared.registerUpload(task, reqId: reqId, push: push, tempFile: packed.url, manualRedirect: f.redirectManual == true, pins: f.tlsPins, pinOnly: f.tlsPinOnly == true)
            task.resume()
            return try InvokeWire.encodeResolve(.makePending(reqId))
        }

        // ★★★#1119：声明了落盘路径 ⇒ 宿主**边收边写盘**（JS 不碰字节 ⇒ 内存与文件大小解耦）
        if let savePath = f.savePath, !savePath.isEmpty {
            guard let target = sandboxFile(savePath) else {
                return try InvokeWire.encodeResolve(.makeErr(reqId, "fetch.failed: 落盘路径非法（只接受沙箱相对路径）：\(savePath)"))
            }
            let task = sess.dataTask(with: req)
            registerInflight(reqId, task)   // ★#1121：可取消
            BodyLimitDelegate.shared.registerSaving(task, reqId: reqId, push: push, target: target, manualRedirect: f.redirectManual == true, pins: f.tlsPins, pinOnly: f.tlsPinOnly == true)
            task.resume()
            return try InvokeWire.encodeResolve(.makePending(reqId))
        }

        // ★★★#1118：请求声明了流式 ⇒ 走「边读边推」路径（不整包进内存，也不受 32 MiB 上限约束）
        if f.stream == true {
            let task = sess.dataTask(with: req)
            registerInflight(reqId, task)   // ★#1121：可取消
            BodyLimitDelegate.shared.registerStreaming(task, reqId: reqId, push: push, manualRedirect: f.redirectManual == true, pins: f.tlsPins, pinOnly: f.tlsPinOnly == true)
            task.resume()
            return try InvokeWire.encodeResolve(.makePending(reqId))
        }
        // ★★★决策 #1115：改用 **delegate 驱动**（`dataTask(with:)` 不带 completion）——
        //   这样数据是**逐块**送到 `didReceive data`，超限时能 `cancel()` **真正中止读取**。
        //   ★为什么不能沿用 completion：completion 回调时 `data` **已全部进内存**，
        //     那时再判上限等于"洪水过后才关闸"（#1114 的取证结论就是这一点）。
        let task = sess.dataTask(with: req)
        registerInflight(reqId, task)   // ★#1121：可取消
        BodyLimitDelegate.shared.register(task, reqId: reqId, push: push, manualRedirect: f.redirectManual == true, pins: f.tlsPins, pinOnly: f.tlsPinOnly == true)
        task.resume()

        return try InvokeWire.encodeResolve(.makePending(reqId))
    }

    /// ★#1120：沙箱相对路径 → 文件 URL（要求**是文件**；与 `sandboxFile` 同一套校验）。
    static func sandboxSource(_ path: String) -> URL? {
        guard let u = sandboxFile(path) else { return nil }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: u.path, isDirectory: &isDir), !isDir.boolValue else { return nil }
        return u
    }


    /// ★★★#1120：把 multipart **拼成临时文件**（内存只用一个 16 KiB 块，与文件大小无关）。
    ///
    /// 【为什么是"拼临时文件"而不是"边读边发"】
    ///   iOS 侧连试 4 轮自定义 `InputStream` 全部失败（详见上传分支注释）⇒ 改用官方
    ///   `uploadTask(with:fromFile:)`。**内存性质不变**：拼装时只持有一个块；发送由系统流式读文件。
    ///
    /// 【临时文件位置】`FileManager.default.temporaryDirectory`（系统可回收），
    ///   文件名带 reqId 前缀避免并发冲突；**发送完在 `didComplete` 里删除**（成败都删）。
    static func packMultipartToTemp(spec: InvokeWire.UploadSpec, fileURL: URL, chunkSize: Int = 16 * 1024) -> (url: URL, bytes: Int64)? {
        var normal = ""
        for (k, v) in spec.formData {
            normal += "--\(spec.boundary)\r\nContent-Disposition: form-data; name=\"\(k)\"\r\n\r\n\(v)\r\n"
        }
        let fileHead = "--\(spec.boundary)\r\n"
            + "Content-Disposition: form-data; name=\"\(spec.fieldName)\"; filename=\"\(spec.filename)\"\r\n"
            + "Content-Type: application/octet-stream\r\n\r\n"
        let end = "\r\n--\(spec.boundary)--\r\n"
        let headData = Data((normal + fileHead).utf8)
        let tailData = Data(end.utf8)

        guard let inStream = InputStream(url: fileURL),
              let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
              let fileLen = (attrs[.size] as? NSNumber)?.int64Value else { return nil }
        let total = Int64(headData.count) + fileLen + Int64(tailData.count)

        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("proteus-upload-\(UUID().uuidString).tmp")
        FileManager.default.createFile(atPath: tmp.path, contents: nil)
        guard let out = FileHandle(forWritingAtPath: tmp.path) else { return nil }
        defer { try? out.close() }

        out.write(headData)
        inStream.open()
        defer { inStream.close() }
        var buf = [UInt8](repeating: 0, count: chunkSize)
        var written = Int64(headData.count)
        // ★#1252：每个块单独计时 ⇒ **拼装侧的慢写**（磁盘 I/O 瓶颈）可观测
        //   ★实现收在 upload-backpressure.swift（本文件已近 1000 行，见那儿的说明）
        UploadBackpressure.reset()
        while true {
            let n = inStream.read(&buf, maxLength: chunkSize)
            if n <= 0 { break }
            let w0 = DispatchTime.now().uptimeNanoseconds
            out.write(Data(buf[0..<n]))
            UploadBackpressure.recordWrite(elapsedNs: DispatchTime.now().uptimeNanoseconds - w0, bytes: n)
            written += Int64(n)
            // ★超 1 GiB 拒绝（与 Android 同值口径）——避免拼出超大临时文件
            if written > Int64(HttpCapability.MAX_SAVE_BYTES) {
                try? FileManager.default.removeItem(at: tmp)
                return nil
            }
        }
        out.write(tailData)
        return (tmp, total)
    }

    /// ★#1119：把沙箱相对路径解析成文件 URL（与 Android `FileTransferCapability.resolve` **同规则**）。
    ///
    /// 【规则】只接受**沙箱相对路径**；拒绝绝对路径与任何 `..` 段（防目录穿越）。
    ///   ★为什么两端必须同规则：否则同一个 `savePath` 在 Android 被拒、在 iOS 被接受 ⇒
    ///     "换端就成败不同"，那是比拒绝更糟的不可预期（与 #1115 上限同值同源纪律）。
    ///
    /// 【落点】App 沙箱的 `Documents` 目录（与 `FileTransferCapability` 的 iOS 实现同一根）。
    static func sandboxFile(_ path: String) -> URL? {
        guard !path.isEmpty, !path.hasPrefix("/") else { return nil }
        for seg in path.split(separator: "/") where seg == ".." { return nil }
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = docs.appendingPathComponent(path)
        // ★双保险：解析后必须在沙箱根之下（符号链接/编码绕过）
        let rootPath = docs.standardizedFileURL.path
        guard url.standardizedFileURL.path.hasPrefix(rootPath) else { return nil }
        return url
    }

    /// ★#1120：文件 URL → **沙箱相对路径**（回给 JS 用；与传下来的 `savePath` 同形）。
    ///   ★为什么不能直接用 `lastPathComponent`：那会丢掉子目录前缀（`download/x` → `x`），
    ///     而 JS 侧后续（读回校验 / 上传）都用相对路径找文件 ⇒ 找不到。
    static func relativePath(_ url: URL) -> String {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].standardizedFileURL.path
        let full = url.standardizedFileURL.path
        guard full.hasPrefix(docs) else { return url.lastPathComponent }
        var rel = String(full.dropFirst(docs.count))
        if rel.hasPrefix("/") { rel.removeFirst() }
        return rel.isEmpty ? url.lastPathComponent : rel
    }

    /// ★#1119：落盘总字节上限（1 GiB，与 Android `MAX_SAVE_BYTES` **同值**）——
    ///   防无限下载填满磁盘；超限删残包并给 `fetch.tooLarge`。
    static let MAX_SAVE_BYTES = 1024 * 1024 * 1024

    /// ★#1119：最近一次落盘记账（真机判据读它证明"内存不随文件增长"）。
    struct SaveStats { var bytes = 0; var path: String?; var completed = false; var error: String? }
    /// ★不设 private(set)：`BodyLimitDelegate`（同文件另一类型）要写它；这是**诊断记账**，不做访问保护。
    static var lastSaveStats = SaveStats()
    /** ★#1153：最近一次网络错误的 domain/code（排障读数；判据可读它确认归因依据）。 */
    static var lastNetworkError = ""
    static func resetSaveStats() { lastSaveStats = SaveStats() }
    static func lastSaveStatsSnapshot() -> [String: Any] {
        var d: [String: Any] = ["bytes": lastSaveStats.bytes, "completed": lastSaveStats.completed]
        if let p = lastSaveStats.path { d["path"] = p }
        if let e = lastSaveStats.error { d["error"] = e }
        return d
    }

    /// JSON 字符串转义（只用于我们自己拼的摘要；不引 JSONEncoder 以免字段顺序漂移）。
    static func jsonQuote(_ s: String) -> String {
        var out = "\""
        for ch in s.unicodeScalars {
            switch ch {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if ch.value < 0x20 { out += String(format: "\\u%04x", ch.value) }
                else { out.unicodeScalars.append(ch) }
            }
        }
        return out + "\""
    }

    /// 响应体硬上限（与 Android `HttpCapability.MAX_BODY_BYTES` **同值**——两端必须一致，
    /// 否则"同一个请求换端就成败不同"，那是比没有上限更糟的不可预期）。
    static let MAX_BODY_BYTES = 32 * 1024 * 1024

    /* ══════════════════ ★★★#1121 取消通道（S3 回收维度） ══════════════════ */

    /// **在途请求表**（reqId → URLSessionTask）。取消时按 reqId 找到 task 并 `cancel()`。
    ///
    /// 【★为什么必须让宿主真停】只 reject JS 侧不改宿主 ⇒ 传输仍在跑、内存仍在涨 ⇒
    ///   "用户以为取消了，其实后台还在下载"。
    ///
    /// 【★并发安全】`URLSession` 回调在并发队列、取消从主线程（JS 调用）进来 ⇒ 必须持锁。
    private static let inflightLock = NSLock()
    private static var inflight: [String: URLSessionTask] = [:]

    static func registerInflight(_ reqId: String, _ task: URLSessionTask) {
        inflightLock.lock(); defer { inflightLock.unlock() }
        inflight[reqId] = task
    }

    static func unregisterInflight(_ reqId: String) {
        inflightLock.lock(); defer { inflightLock.unlock() }
        inflight.removeValue(forKey: reqId)
    }

    /// 取消记账（判据读它证明"取消真的打到宿主"）。
    struct CancelStats { var calls = 0; var hits = 0; var misses = 0 }
    /// 不设 private(set)：`HostRuntimeBridge`（同 target 另一文件）要读它做判据出口。
    static var cancelStatsValue = CancelStats()
    static func cancelStats() -> CancelStats { cancelStatsValue }

    /// `http.cancel`：按 reqId 中止在途请求。
    /// - Returns: `["hit": Bool]`——`hit=false` = 该请求已结算或不存在（**不是错误**，取消与完成天然有竞态）
    static func cancel(_ args: [String: Any]) -> [String: Any] {
        cancelStatsValue.calls += 1
        guard let reqId = args["reqId"] as? String, !reqId.isEmpty else {
            cancelStatsValue.misses += 1
            return ["hit": false]
        }
        inflightLock.lock()
        let task = inflight.removeValue(forKey: reqId)
        inflightLock.unlock()
        guard let t = task else {
            cancelStatsValue.misses += 1
            return ["hit": false]
        }
        cancelStatsValue.hits += 1
        t.cancel()   // ★`cancel()` 会触发 delegate 的 didCompleteWithError ⇒ 读线程/流式推终止
        NSLog("[proteus] http.cancel 已中止 reqId=%@", reqId)
        return ["hit": true]
    }

    /* ────────────────────────── 工具 ────────────────────────── */

    /// `url` + `params` ⇒ `URL`（query 由 `URLComponents` 编码；无 params 时原样解析）。
    private static func buildURL(_ f: InvokeWire.InvokeFrame) -> URL? {
        guard let raw = f.url, !raw.isEmpty else { return nil }
        guard let params = f.params, !params.isEmpty else { return URL(string: raw) }
        guard var comps = URLComponents(string: raw) else { return nil }
        var items = comps.queryItems ?? []
        for (k, v) in params { items.append(URLQueryItem(name: k, value: v)) }
        comps.queryItems = items
        return comps.url
    }

    /// 该 URL 的 cookie ⇒ `Cookie` 头（对应 Android `CookieManager.getCookie(url)`）。
    private static func cookieHeader(for url: URL) -> String? {
        guard let cookies = HTTPCookieStorage.shared.cookies(for: url), !cookies.isEmpty else { return nil }
        return cookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
    }

    /// 响应头 ⇒ **有序**键值对（与 `InvokeWire.NameValues` 契约一致：顺序即编码顺序）。
    /// ★`allHeaderFields` 的键类型是 `AnyHashable`（可能是 NSString）⇒ 统一 `String(describing:)`。
    /// ★#1115：由 `private` 放宽到 internal —— `BodyLimitDelegate` 在同一文件里也要用它
    ///   （delegate 改了响应路径，但仍必须走**同一份**头拍平实现，否则两处排序/合并会分叉）。
    static func headerPairsForDelegate(_ http: HTTPURLResponse) -> InvokeWire.NameValues {
        headerPairs(http)
    }

    private static func headerPairs(_ http: HTTPURLResponse) -> InvokeWire.NameValues {
        var out: InvokeWire.NameValues = []
        for (k, v) in http.allHeaderFields {
            let name = (k as? String) ?? String(describing: k)
            let value = (v as? String) ?? String(describing: v)
            out.append((name, value))
        }
        // ★排序：`allHeaderFields` 是字典（无序）⇒ 不排会让**回程字节随哈希序漂移**
        //   （对拍/快照类判据会间歇红）。按名字排序是确定性最小的代价（JS 侧只按名取值）。
        out.sort { $0.0 < $1.0 }
        return out
    }
}

/* ────────────────────────── ★#1115 响应体上限（delegate 驱动） ────────────────────────── */

/// ★★★决策 #1115：**逐块接收 + 累计上限 + 真中止**。
///
/// 【为什么必须是 delegate（不能沿用 completion）】
///   `dataTask(with:completionHandler:)` 在回调时 `data` **已全部进内存**——
///   那时再判"是否超限"只是事后报警，内存早已吃掉（#1114 取证）。
///   ⇒ 改用 `URLSessionDataDelegate`：数据**逐块**到达（`didReceive data`），
///     累计超限就 `task.cancel()` ⇒ **真正中止读取**，内存到此为止。
///
/// 【三处状态都要收尾，否则会漏回推 / 泄漏】
///   · 正常完成：`didCompleteWithError(nil)` ⇒ 用累积数据编 OK 帧
///   · 超限中止：`cancel()` 会带一个 `NSURLErrorCancelled` 回来 ⇒ **用我们记下的原因**编错误帧
///   · 网络错误：别的 error ⇒ 编错误帧
///   ★每个 task 必须**恰好回推一次**（`finish` 里先摘表再推，防重复）。
///
/// 【诚实边界】本类是**单例**（`URLSession` 的 delegate 只能有一个）——
///   所有请求共用它，状态按 `taskIdentifier` 分表。★并发安全靠
///   `URLSession` 的 delegateQueue 串行调用（`delegateQueue: nil` ⇒ 系统给的串行队列）。
final class BodyLimitDelegate: NSObject, URLSessionDataDelegate {
    static let shared = BodyLimitDelegate()

    /// ★#1118：块大小 / 在途上限（与 Android `STREAM_CHUNK` / `STREAM_QUEUE_DEPTH` **同值**）。
    static let STREAM_CHUNK = 16 * 1024
    static let STREAM_QUEUE_DEPTH = 8

    /// ★#1118：**最近一次流式的宿主记账**（真机判据读它区分"真背压"与"没测到"）。
    struct StreamStats {
        var chunks = 0
        var bytes = 0
        var maxQueued = 0
        var backpressureWaits = 0
        var backpressureMs = 0.0
        var completed = false
        var error: String?
    }
    private(set) static var lastStreamStats = StreamStats()
    /// 供宿主壳读（判据出口）。
    static func lastStatsSnapshot() -> [String: Any] {
        var d: [String: Any] = [
            "chunks": lastStreamStats.chunks,
            "bytes": lastStreamStats.bytes,
            "max_queued": lastStreamStats.maxQueued,
            "backpressure_waits": lastStreamStats.backpressureWaits,
            "backpressure_ms": Int(lastStreamStats.backpressureMs),
            "completed": lastStreamStats.completed,
        ]
        if let e = lastStreamStats.error { d["error"] = e }
        return d
    }

    /// ★#1118：流式许可的唯一持有者（引用类型——见 `State.gate` 的注释）。
    final class StreamGate {
        let sem: DispatchSemaphore
        private let l = NSLock()
        private var _waits = 0
        private var _waitMs = 0.0
        /// `true` = 本次拿到许可是**阻塞过**的（记账用）
        func acquire() -> Bool {
            let t0 = DispatchTime.now().uptimeNanoseconds
            sem.wait()
            let ns = DispatchTime.now().uptimeNanoseconds - t0
            guard ns > 500_000 else { return false }
            l.lock(); _waits += 1; _waitMs += Double(ns) / 1_000_000.0; l.unlock()
            return true
        }
        func release() { sem.signal() }
        func drain() -> (Int, Double) {
            l.lock(); defer { l.unlock() }
            return (_waits, _waitMs)
        }
        init(_ depth: Int) { sem = DispatchSemaphore(value: depth) }
    }

    private struct State {
        let reqId: String
        let push: ([UInt8]) -> Void
        var body = Data()
        /// 超限后置位：`didComplete` 时据此编 `fetch.tooLarge` 而不是普通取消
        var tooLargeAt: Int?
        /// ★#1118：`true` ⇒ 本 task 走**分块回推**（不累积 body、不受 32 MiB 上限）。
        var streaming = false
        /// ★#1119：非 nil ⇒ 边收边写该文件（不累积 body）
        var saveTo: URL?
        var savedBytes = 0
        var savedHandle: FileHandle?
        var savePath: String?
        /// ★#1120：拼好的 multipart 临时文件（收尾要删）
        var uploadTemp: URL?
        /// ★#1119：落盘失败原因（写盘失败 / 超限）
        var saveError: String?
        var seq = 0
        var bytes = 0
        /// ★★★#1118 修复：许可必须是**引用类型**。
        ///   `State` 是 struct（值语义）⇒ 若把 `DispatchSemaphore` 直接放在里面，
        ///   每次 `states[id]` 读出都会**复制一份引用**、写回时又存另一份 —— 表面上"同一个"信号量，
        ///   实际各线程拿到的是不同副本，`signal()` 加到了别处 ⇒ 许可计数失控，
        ///   最终触发 Swift 运行时陷入（实测 `signal 5`，崩在 seq=32/33 跨线程处）。
        ///   ⇒ 用 class 包一层：值拷贝的是**引用**，semaphore 始终唯一。
        var gate: StreamGate
        var status: Int32 = 0
        var headers: InvokeWire.NameValues = []
        /// ★#1134：true ⇒ 本 task **不跟随**重定向（3xx 原样回给 JS，由框架层决定跟不跟）
        var manualRedirect = false
        /// ★★★#1153：TLS pinning（本 task 的 SPKI 指纹；空 = 平台默认信任链）
        var tlsPins: [Data] = []
        /// ★#1153：true ⇒ 用 pin 替代系统信任；false ⇒ 叠加（系统信任 + pin 都要过）
        var tlsPinOnly = false
        /// ★★★#1158：`didFinishCollecting` 记下的传输读数（到达时写，完成帧时读）
        var transport: InvokeWire.NameValues = []
    }

    /// ★key = taskIdentifier；只在该 task 的生命周期内存在
    private var states: [Int: State] = [:]
    /// ★#1118：`states` 同时被 delegate 队列与主线程（归还许可时读）访问 ⇒ 必须加锁。
    ///   原先只有 delegate 队列访问（串行）故无需锁；加了流式后主线程也会读，不锁就是数据竞争。
    private let lock = NSLock()

    /// 登记一个新 task（必须在 `resume()` **之前**调用——否则可能先收到数据、后登记，丢块）
    func register(_ task: URLSessionDataTask, reqId: String, push: @escaping ([UInt8]) -> Void, manualRedirect: Bool = false, pins: String? = nil, pinOnly: Bool = false) {
        var st = State(reqId: reqId, push: push, gate: StreamGate(BodyLimitDelegate.STREAM_QUEUE_DEPTH))
        st.manualRedirect = manualRedirect
        st.tlsPins = TlsPinningIos.parsePins(pins)
        st.tlsPinOnly = pinOnly
        states[task.taskIdentifier] = st
    }

    /// ★#1118：登记一个**流式** task（同样必须在 `resume()` 之前）。
    ///   ★为什么复用本类而不是另建 `StreamDelegate`：`URLSession` 的 delegate 在**创建时固定**，
    ///     另建一个类根本收不到回调（实测：服务端发完 256 块、宿主记账全 0、Promise 永不结算）。
    func registerStreaming(_ task: URLSessionDataTask, reqId: String, push: @escaping ([UInt8]) -> Void, manualRedirect: Bool = false, pins: String? = nil, pinOnly: Bool = false) {
        lock.lock(); defer { lock.unlock() }
        BodyLimitDelegate.lastStreamStats = StreamStats()
        var st = State(reqId: reqId, push: push, gate: StreamGate(BodyLimitDelegate.STREAM_QUEUE_DEPTH))
        st.streaming = true
        st.manualRedirect = manualRedirect
        st.tlsPins = TlsPinningIos.parsePins(pins)
        st.tlsPinOnly = pinOnly
        states[task.taskIdentifier] = st
    }

    /// ★#1119：登记一个**落盘** task（边收边写文件，不累积 body）。
    func registerSaving(_ task: URLSessionDataTask, reqId: String, push: @escaping ([UInt8]) -> Void, target: URL, manualRedirect: Bool = false, pins: String? = nil, pinOnly: Bool = false) {
        lock.lock(); defer { lock.unlock() }
        var st = State(reqId: reqId, push: push, gate: StreamGate(BodyLimitDelegate.STREAM_QUEUE_DEPTH))
        st.saveTo = target
        // ★★★#1120 真机抓出：回给 JS 的必须是**相对路径**（与传下来的 `savePath` 同形），
        //   不能用 `lastPathComponent`（那会丢掉 `download/` 前缀 ⇒ 后续 fs.readBytes / 上传路径解析全找不到文件）。
        st.savePath = HttpCapability.relativePath(target)
        st.status = 0
        st.manualRedirect = manualRedirect
        st.tlsPins = TlsPinningIos.parsePins(pins)
        st.tlsPinOnly = pinOnly
        states[task.taskIdentifier] = st
    }

    /// ★#1120：登记一个**流式上传** task（响应侧仍走普通累积路径，只是请求侧是流式）。
    /// ★#1120：登记一个**上传** task（响应侧走普通累积；请求体已由 `uploadTask(fromFile:)` 自行读取）。
    ///   `tempFile` 只用于**收尾删除**（拼好的 multipart 临时文件，发送完即删）。
    func registerUpload(_ task: URLSessionDataTask, reqId: String, push: @escaping ([UInt8]) -> Void, tempFile: URL, manualRedirect: Bool = false, pins: String? = nil, pinOnly: Bool = false) {
        lock.lock(); defer { lock.unlock() }
        var st = State(reqId: reqId, push: push, gate: StreamGate(BodyLimitDelegate.STREAM_QUEUE_DEPTH))
        st.uploadTemp = tempFile
        st.manualRedirect = manualRedirect
        st.tlsPins = TlsPinningIos.parsePins(pins)
        st.tlsPinOnly = pinOnly
        states[task.taskIdentifier] = st
    }

    /**
     * ★★★#1153：**TLS pinning 的落点**（`URLSession` 的 server-trust challenge）。
     *
     * 【为什么必须在这里做】iOS 的证书校验发生在握手阶段的 challenge 回调里；
     *   不在这个回调里决策，就只能"事后发现连上了不该连的服务器"。
     *
     * 【三种返回】
     *   · 该 task 没配 pins ⇒ 交给系统默认（`performDefaultHandling`）——老行为完全不变；
     *   · pins 命中 ⇒ `useCredential`（**注意**：叠加模式下 `TlsPinningIos.evaluate` 已先跑过系统校验，
     *     自签证书在这里就会被拒；`pinOnly` 模式则故意跳过系统校验）；
     *   · pins 未命中 ⇒ `cancelAuthenticationChallenge`（**必须取消**，不能"继续但记个日志"——
     *     那等于 MITM 已成功而业务无感）。
     *   ★取消后 task 会以 `NSURLErrorCancelled`(-999) 失败 ⇒ `didCompleteWithError` 里映射成 `fetch.tlsError`
     *     （见那里的判断：本 task 配过 pins 且错误是 -999 ⇒ 归因到证书而不是"用户取消"）。
     */
    /** ★★★#1153：TLS challenge 记账（真机判据读它区分"challenge 没被调用"与"pin 判定错"）。 */
    struct TlsStats {
        var challenges = 0
        var withPins = 0
        var accepted = 0
        var rejected = 0
        var defaultHandled = 0
    }
    private static var _tlsStats = TlsStats()
    private static let tlsLock = NSLock()

    /**
     * ★★★#1158：**`didFinishCollecting` 的到达顺序记账**（真机判据读它）。
     *
     * 【为什么要记这个】Apple **不保证** `didFinishCollecting(metrics:)` 与
     *   `didCompleteWithError:` 的先后。若 metrics **后到**，完成帧已经发出 ⇒ 那一帧永远没有
     *   `transport`（真机实测：iOS 首跑 `transport_first/last` 全是 `null`，而 Android 有值）。
     *   ⇒ 先量清顺序，再决定修法（"补一个等待"还是"改到后到的路径里回推"）——**不猜**。
     */
    struct MetricsStats {
        /** metrics 回调被调用次数 */
        var collectingCalls = 0
        /** 到达时 task 仍在 `states` 里（= 早于 didComplete）的次数 */
        var arrivedBeforeComplete = 0
        /** 到达时 task 已从 `states` 摘除（= 晚于 didComplete）的次数 */
        var arrivedAfterComplete = 0
    }
    private static var _metricsStats = MetricsStats()
    static func metricsStatsSnapshot() -> [String: Any] {
        tlsLock.lock(); defer { tlsLock.unlock() }
        return [
            "collecting_calls": _metricsStats.collectingCalls,
            "before_complete": _metricsStats.arrivedBeforeComplete,
            "after_complete": _metricsStats.arrivedAfterComplete,
        ]
    }
    static func metricsNote(_ kind: String) {
        tlsLock.lock(); defer { tlsLock.unlock() }
        _metricsStats.collectingCalls += 1
        if kind == "before" { _metricsStats.arrivedBeforeComplete += 1 } else { _metricsStats.arrivedAfterComplete += 1 }
    }
    static func tlsStatsSnapshot() -> [String: Any] {
        tlsLock.lock(); defer { tlsLock.unlock() }
        return [
            "challenges": _tlsStats.challenges,
            "with_pins": _tlsStats.withPins,
            "accepted": _tlsStats.accepted,
            "rejected": _tlsStats.rejected,
            "default_handled": _tlsStats.defaultHandled,
        ]
    }
    static func tlsNote(_ kind: String) {
        tlsLock.lock(); defer { tlsLock.unlock() }
        _tlsStats.challenges += 1
        switch kind {
        case "pins": _tlsStats.withPins += 1
        case "accept": _tlsStats.accepted += 1
        case "reject": _tlsStats.rejected += 1
        default: _tlsStats.defaultHandled += 1
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        lock.lock()
        let st = states[task.taskIdentifier]
        lock.unlock()
        guard let st, !st.tlsPins.isEmpty else {
            // ★记账（不在 challenge 里打 NSLog 依赖 console：真机非 console 模式看不到）
            BodyLimitDelegate.tlsNote("default")
            completionHandler(.performDefaultHandling, nil)
            return
        }
        BodyLimitDelegate.tlsNote("pins")
        let verdict = TlsPinningIos.evaluate(challenge: challenge, pins: st.tlsPins, pinOnly: st.tlsPinOnly)
        if verdict == .accept, let trust = challenge.protectionSpace.serverTrust {
            BodyLimitDelegate.tlsNote("accept")
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            BodyLimitDelegate.tlsNote("reject")
            // ★★★#1153：区分"pin 未命中"与"系统不信任"——
            //   只有 pin **明确未命中**才记 reqId（⇒ didCompleteWithError 归成 fetch.tlsError）；
            //   叠加模式下被系统拒绝的不记（⇒ 保持 fetch.failed，业务去查证书而不是 pin）。
            if verdict == .pinMismatch { TlsPinningIos.notePinMismatch(st.reqId) }
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard var st = states[dataTask.taskIdentifier] else { lock.unlock(); return }
        lock.unlock()
        // ★★★#1119：落盘分支——**边收边写**，内存只与块大小相关（与文件总大小无关）。
        //   ★这里不需要人工背压：消费方是**本地磁盘写**，写不动时 write 自己会阻塞
        //     （与流式回推 JS 不同——那才需要队列/信号量）。
        if let target = st.saveTo {
            if st.status == 0, let http = dataTask.response as? HTTPURLResponse {
                st.status = Int32(max(0, http.statusCode))
                st.headers = HttpCapability.headerPairsForDelegate(http)
            }
            if st.savedHandle == nil {
                // ★★★#1120 真机抓出：`createFile` **不会创建父目录** ⇒ `download/xxx` 这类带子目录的
                //   路径在 iOS 上必然失败（Android 侧显式 mkdirs 了，这里漏了）。
                //   现象：`无法打开落盘文件：...`，而同一路径在 Android 上一切正常。
                let parent = target.deletingLastPathComponent()
                if !FileManager.default.fileExists(atPath: parent.path) {
                    try? FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
                }
                FileManager.default.createFile(atPath: target.path, contents: nil)
                st.savedHandle = FileHandle(forWritingAtPath: target.path)
                if st.savedHandle == nil {
                    st.saveError = "无法打开落盘文件：\(target.lastPathComponent)"
                    lock.lock(); states[dataTask.taskIdentifier] = st; lock.unlock()
                    dataTask.cancel()
                    return
                }
            }
            st.savedBytes += data.count
            if st.savedBytes > HttpCapability.MAX_SAVE_BYTES {
                st.saveError = "fetch.tooLarge: 落盘超过上限 \(HttpCapability.MAX_SAVE_BYTES)B（已收 \(st.savedBytes)B）"
                try? st.savedHandle?.close()
                try? FileManager.default.removeItem(at: target)   // ★不静默留残包
                st.saveTo = nil
                lock.lock(); states[dataTask.taskIdentifier] = st; lock.unlock()
                dataTask.cancel()
                return
            }
            st.savedHandle?.write(data)
            lock.lock(); states[dataTask.taskIdentifier] = st; lock.unlock()
            return
        }
        // ★★★#1118：流式分支——**不累积 body**，逐块回推；越界判断交给 JS 消费侧。
        if st.streaming {
            if st.status == 0, let http = dataTask.response as? HTTPURLResponse {
                st.status = Int32(max(0, http.statusCode))
                st.headers = HttpCapability.headerPairsForDelegate(http)
            }
            let chunk = [UInt8](data)
            guard !chunk.isEmpty else {
                lock.lock(); states[dataTask.taskIdentifier] = st; lock.unlock()
                return
            }
            // ★★背压点：拿不到许可就在这里阻塞（delegate 队列不再投递 ⇒ 网络层收敛）
            //   ★记账在 gate 内部累计（避免多线程同时写 static 统计）
            _ = st.gate.acquire()
            let seq = st.seq
            st.seq += 1
            // ★#1118 修复：`st` 是**值拷贝** ⇒ 必须在**同一次写回**里带上 bytes，
            //   否则收尾时从 states 读到的还是"没有 bytes"的旧值（实测：host bytes 恒 0）。
            // ★不在这里写 static 统计：delegate 队列并发时多线程自增会丢计数 ⇒ 收尾一次性汇总。
            st.bytes += chunk.count
            lock.lock(); states[dataTask.taskIdentifier] = st; lock.unlock()
            var rf = InvokeWire.ResolveFrame.makeOK(st.reqId)
            rf.pending = true
            rf.streamSeq = UInt32(seq)
            rf.body = chunk
            let frame = (try? InvokeWire.encodeResolve(rf)) ?? []
            let tid = dataTask.taskIdentifier
            // ★主线程回推（G-39）；推完才归还许可 ⇒ 在途上限真实约束"JS 已消化"的进度
            DispatchQueue.main.async { [weak self] in
                st.push(frame)
                // ★用完**同一个** gate 引用归还（不重新查 states——那可能已经被收尾摘掉）
                st.gate.release()
                _ = self
            }
            return
        }
        // ★第一道闸：Content-Length 声明就超限 ⇒ 立刻取消，不读一块数据
        if st.body.isEmpty,
           let expected = dataTask.response?.expectedContentLength,
           expected > 0,
           expected > Int64(HttpCapability.MAX_BODY_BYTES) {
            st.tooLargeAt = st.body.count
            lock.lock(); states[dataTask.taskIdentifier] = st; lock.unlock()
            dataTask.cancel()
            return
        }
        // ★第二道闸：逐块累计（防 chunked / 谎报长度）
        st.body.append(data)
        if st.body.count > HttpCapability.MAX_BODY_BYTES {
            st.tooLargeAt = st.body.count
            lock.lock(); states[dataTask.taskIdentifier] = st; lock.unlock()
            dataTask.cancel()   // ⇒ 本 task 的读取到此为止（内存不再增长）
            return
        }
        lock.lock(); states[dataTask.taskIdentifier] = st; lock.unlock()
    }

    /// ★★★#1134：**重定向拦截点**（iOS 的原生钩子）。
    ///
    /// 【语义】`completionHandler(request)` = 跟随（可改写目标）；`completionHandler(nil)` = **不跟随**——
    ///   系统会把 3xx 响应（含 `Location` 头）正常走完 `didReceive`/`didComplete`，JS 侧拿到 status=302。
    ///
    /// 【为什么由**去程帧**决定而不是宿主写死】跟随/不跟随是**业务策略**（可拦域名、可记每一跳）；
    ///   宿主只执行最小动作，策略在 `capability-fetch-pipeline.ts`（跨端同一份）。
    ///   ★缺省（`manualRedirect == false`）⇒ 原样跟随，与改造前行为完全一致。
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        lock.lock()
        let manual = states[task.taskIdentifier]?.manualRedirect ?? false
        lock.unlock()
        if manual {
            // ★不跟随：把当前 3xx 当成最终响应（status/Location 会进 `didReceive response` 与 `didComplete`）
            NSLog("[proteus] REDIRECT_STOP status=%d to=%@", response.statusCode, request.url?.absoluteString ?? "<nil>")
            completionHandler(nil)
        } else {
            completionHandler(request)
        }
    }

    /**
     * ★★★#1158：`URLSessionTaskMetrics` → 传输读数（**iOS 是全字段可得的一端**）。
     *
     * 【为什么用 metrics 而不是自己掐表】`URLSession` 的分段时间（DNS/TCP/TLS/TTFB）
     *   只有它自己知道——自己掐表只能得到一个总数，分不出"慢在解析还是慢在握手"。
     *
     * 【★时序（别想当然）】Apple **不保证** `didFinishCollecting` 与 `didCompleteWithError` 的先后。
     *   ⇒ metrics 到达时写进 `State.transport`；完成帧时读它（有就带上，没有就不写 tag）。
     *   ★绝不"等一小会儿再看"（那是盲等，本仓红线）。
     */
    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        guard let tm = metrics.transactionMetrics.last else { return }
        var nv: InvokeWire.NameValues = []
        if let proto = tm.networkProtocolName, !proto.isEmpty { nv.append(("proto", proto)) }
        // ★`isReusedConnection` 是 Bool ⇒ 线格式统一用 "1"/"0"（判据只认这两个值）
        nv.append(("reused", tm.isReusedConnection ? "1" : "0"))
        /** 区间毫秒（两端都有值才写——`Date?` 缺一个就说明该阶段没发生，如复用连接就没有 DNS/TCP/TLS） */
        func span(_ a: Date?, _ b: Date?, _ key: String) {
            guard let a, let b else { return }
            let ms = b.timeIntervalSince(a) * 1000.0
            if ms >= 0 { nv.append((key, String(format: "%.1f", ms))) }
        }
        span(tm.domainLookupStartDate, tm.domainLookupEndDate, "dnsMs")
        span(tm.connectStartDate, tm.connectEndDate, "connectMs")
        span(tm.secureConnectionStartDate, tm.secureConnectionEndDate, "tlsMs")
        span(tm.requestStartDate, tm.responseStartDate, "ttfbMs")
        /**
         * ★★★#1183：**本次请求的域名解析走了哪一级**（HTTPDNS 可观测面）。
         *
         * 【为什么只在"本次新建了连接"时写】连接**复用**时根本没有解析
         *   ⇒ 写 `dnsSource` 会把上一次的值冒充成本次（假读数）。
         *   本仓纪律：「不可得」与「测到 0」是两件事 ⇒ 复用 / URL 本身是 IP 时**不写这个键**。
         * 【host 来源】`task.originalRequest?.url` 是**原始 URL**（重定向后仍是最初那个），
         *   与代理侧记的 host 一致。
         */
        if !tm.isReusedConnection,
           let host = task.originalRequest?.url?.host?.lowercased(),
           let dnsTable = HttpCapability.table(for: session),
           let src = HttpDnsProxies.source(forHost: host, table: dnsTable) {
            nv.append(("dnsSource", src))
            nv.append(("dnsTableHit", src == "table" ? "1" : "0"))
        }
        lock.lock()
        if var st = states[task.taskIdentifier] {
            st.transport = nv
            states[task.taskIdentifier] = st
            lock.unlock()
            // ★#1158：记"早于 didComplete"（这种顺序下完成帧能带上读数）
            BodyLimitDelegate.metricsNote("before")
        } else {
            lock.unlock()
            /**
             * ★#1158：**晚于 `didComplete` 到达** —— 此时 state 已摘除、帧已发出。
             * ❗这里是本轮真机实测的结论：iOS 的 `transport_first/last` 全是 `null`（见判据）。
             * 不静默：记进 `metricsStats.after_complete`，由 `http.tlsStats` 暴露给判据，
             * 让"为什么没有读数"可归因（而不是笼统的"平台不给"）。
             */
            BodyLimitDelegate.metricsNote("after")
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let st = states.removeValue(forKey: task.taskIdentifier)
        lock.unlock()
        guard let st else { return }   // ★先摘表 ⇒ 保证恰好回推一次
        let reqId = st.reqId
        /**
         * ★★★#1153：**pin 被拒的归因**。
         * 【为什么需要】我们在 challenge 里 `cancelAuthenticationChallenge` ⇒ task 以
         *   `NSURLErrorCancelled`(-999) 结束，与"业务主动取消"**同一个错误码**。
         *   若不区分，业务会看到 `fetch.aborted`（以为是自己取消的），而真因是**证书被拒**。
         * ⇒ 判据：本 task 配过 pins **且** 错误是 -999 ⇒ `fetch.tlsError`。
         *   （业务主动取消走 `http.cancel` 路径，那条会先 `unregisterInflight`，且 st 已摘表/无 pins 需求；
         *    真同时发生时"tlsError"也是更可操作的归因——证书问题必须被看见。）
         */
        let pinRejected: Bool = {
            guard !st.tlsPins.isEmpty, let e = error as NSError? else { return false }
            HttpCapability.lastNetworkError = "domain=\(e.domain) code=\(e.code) pins=\(st.tlsPins.count) reqId=\(st.reqId)"
            /**
             * ★★归因必须区分两件事（真机实测抓出的偏差）：
             *   · **pin 未命中**（我们的 `TlsPinningIos.evaluate` 返回 false）⇒ `fetch.tlsError`
             *   · **系统不信任**（叠加模式下自签证书被 `SecTrustEvaluateWithError` 拒）⇒ 仍是 `fetch.failed`
             *   首版把两者都归成 tlsError ⇒ "叠加模式"那条报 `fetch.tlsError`，
             *   业务会去查 pin 配置，而真因是证书不被系统信任 ⇒ **归因错**（比不归因更误导）。
             * ⇒ 只有"本 task 配了 pins **且** pin 明确未命中"才算 tlsError。
             *   实现：`TlsPinningIos` 在 pin 判定失败时置位 `lastPinMismatch`（按 reqId 记账），
             *   这里查它——而不是靠错误码猜（系统信任与 pin 拒绝在本层是同一种 -999）。
             */
            return e.domain == NSURLErrorDomain && TlsPinningIos.consumePinMismatch(st.reqId)
        }()
        /** ★#1153：网络失败的统一消息（pin 被拒单独成档，不混进 failed/aborted）。 */
        let netErrMsg: (Error) -> String = { e in
            pinRejected ? "fetch.tlsError: 证书 pin 校验未通过（pin 未命中）" : "fetch.failed: \(e.localizedDescription)"
        }
        // ★#1121：请求已结算 ⇒ 从在途表摘掉（取消与完成天然有竞态，这里只是清理）
        HttpCapability.unregisterInflight(reqId)
        // ★#1120：上传用的 multipart 临时文件，无论成败都删（不留在沙箱里占空间）
        if let tmp = st.uploadTemp { try? FileManager.default.removeItem(at: tmp) }
        // ★★★#1119：落盘收尾——回 path/size 摘要（不回字节），并处理写文件失败/超限
        if let target = st.saveTo {
            /**
             * ★★★#1200：**`FileHandle.close()` 不等于落盘**——它只 flush 到内核页缓存
             *   （抗进程被杀，不抗**突然掉电**）。抗掉电需要把数据真正写到存储介质。
             *   ⚠️本仓诚实边界：iOS 上**没有公开的 `fsync` 入口**——
             *     · `FileHandle.fd` 不是公开 API（编译不过，实测）；
             *     · `synchronizeFile()` 是公开的，文档说 "flushes any buffered data"，
             *       但**它是否等价 `fsync` 未被本仓真机取证**（Apple 论坛有"它只到内核"的说法）。
             *   ⇒ 这里用 `synchronizeFile()`，并把 `durable` 标成 `"partial"`（= 已尽力但未证明）。
             *     ★不谎报 `true`：Android 的 `getFD().sync()` 是明确 fsync，本端不是。
             */
            var durableState = "false"
            if let h = st.savedHandle, st.saveError == nil, error == nil {
                h.synchronizeFile()
                durableState = "\"partial\""   // 尽力 flush；未证明等价 fsync
            }
            try? st.savedHandle?.close()
            let path = st.savePath ?? HttpCapability.relativePath(target)
            var frame: [UInt8]
            if let se = st.saveError {
                frame = (try? InvokeWire.encodeResolve(.makeErr(reqId, se))) ?? []
            } else if let e = error {
                try? FileManager.default.removeItem(at: target)
                frame = (try? InvokeWire.encodeResolve(.makeErr(reqId, netErrMsg(e)))) ?? []
            } else {
                var r = InvokeWire.ResolveFrame.makeOK(reqId)
                r.status = UInt32(max(0, st.status))
                r.headers = st.headers
                r.transport = st.transport.isEmpty ? nil : st.transport   // ★#1158
                let summary = "{\"path\":\(HttpCapability.jsonQuote(path)),\"size\":\(st.savedBytes),\"durable\":\(durableState)}"
                r.body = Array(summary.utf8)
                HttpCapability.lastSaveStats.completed = true
                HttpCapability.lastSaveStats.bytes = st.savedBytes
                HttpCapability.lastSaveStats.path = path
                frame = (try? InvokeWire.encodeResolve(r)) ?? []
            }
            if !HttpCapability.lastSaveStats.completed {
                HttpCapability.lastSaveStats.error = st.saveError ?? error?.localizedDescription
            }
            DispatchQueue.main.async { st.push(frame) }
            return
        }
        // ★★★#1118：流式收尾——最终帧（无 seq）带 status/headers，**不带 body**（块已逐块给过）
        if st.streaming {
            var frame: [UInt8]
            if let e = error {
                BodyLimitDelegate.lastStreamStats.error = e.localizedDescription
                frame = (try? InvokeWire.encodeResolve(.makeErr(reqId, netErrMsg(e)))) ?? []
            } else {
                var r = InvokeWire.ResolveFrame.makeOK(reqId)
                r.status = UInt32(max(0, st.status))
                r.headers = st.headers
                r.transport = st.transport.isEmpty ? nil : st.transport   // ★#1158
                r.body = []
                frame = (try? InvokeWire.encodeResolve(r)) ?? []
                BodyLimitDelegate.lastStreamStats.completed = true
            }
            let (waits, waitMs) = st.gate.drain()
            BodyLimitDelegate.lastStreamStats.chunks = st.seq
            BodyLimitDelegate.lastStreamStats.bytes = st.bytes
            BodyLimitDelegate.lastStreamStats.backpressureWaits = waits
            BodyLimitDelegate.lastStreamStats.backpressureMs = waitMs
            DispatchQueue.main.async { st.push(frame) }
            return
        }
        let frame: [UInt8]
        do {
            if let at = st.tooLargeAt {
                // ★超限 = 独立错误档（JS 侧映射 `fetch.tooLarge`），不与网络失败混同
                frame = try InvokeWire.encodeResolve(.makeErr(reqId,
                    "fetch.tooLarge: 响应体超过上限 \(HttpCapability.MAX_BODY_BYTES)B（已读 \(at)B）"))
            } else if let error {
                // ★★★#1153：必须走 `netErrMsg`（pin 被拒要归因成 `fetch.tlsError`）。
                //   ★真机实测：首版这里硬编码 `"http.request 失败：..."` ⇒ pin 拒绝虽然发生了
                //     （记账 rejected>0）但业务看到的仍是 `fetch.failed`，**归因错**。
                //     ⇒ 网络失败的所有分支都要经过同一个消息构造函数（这一点与 #1149 的
                //       "错误码要逐层保住"同族：#1150 也踩过一处遗漏分支）。
                frame = try InvokeWire.encodeResolve(.makeErr(reqId, netErrMsg(error)))
            } else if let http = task.response as? HTTPURLResponse {
                var r = InvokeWire.ResolveFrame.makeOK(reqId)
                r.status = UInt32(max(0, http.statusCode))
                r.headers = HttpCapability.headerPairsForDelegate(http)
                r.transport = st.transport.isEmpty ? nil : st.transport   // ★#1158
                r.body = [UInt8](st.body)
                frame = try InvokeWire.encodeResolve(r)
            } else {
                frame = try InvokeWire.encodeResolve(.makeErr(reqId, "http.request 失败：响应不是 HTTP 响应"))
            }
        } catch {
            frame = (try? InvokeWire.encodeResolve(.makeErr(reqId, "http.request 回程帧编码失败：\(error)"))) ?? []
        }
        // ★回 JS 必须在**主线程**（G-39 线程纪律：禁止在网络线程直接调 JS）
        DispatchQueue.main.async { st.push(frame) }
    }
}

// ★本文件不再有独立的 StreamDelegate —— 原因见 `BodyLimitDelegate.registerStreaming` 的注释：
//   `URLSession` 的 delegate 在**创建时固定**，另建一个 NSObject 子类**永远收不到回调**
//   （实测：服务端发完 256 块 · 宿主记账全 0 · Promise 永不结算 · 120s 超时）。
//   流式复用 `BodyLimitDelegate`（同一 session / 连接池 / cookie 存储）。
