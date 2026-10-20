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

    /// 进程级单例会话（复用连接池；★`URLSessionConfiguration.default` ⇒ 与 app 其它请求共用
    ///   `HTTPCookieStorage.shared`，这正是 G-46 要的"同一份会话"）。
    ///   ★#1115：**改用 delegate 驱动的会话**（而非 completion 的 `dataTask`）——
    ///     原因见 `BodyLimitDelegate`：completion 回调时**数据已全部进内存**，事后拒绝等于没防住。
    private static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.httpShouldSetCookies = true
        cfg.httpCookieStorage = HTTPCookieStorage.shared
        return URLSession(configuration: cfg, delegate: BodyLimitDelegate.shared, delegateQueue: nil)
    }()

    /// 处理一条 `http.request` 去程帧。
    /// - Returns: **立即**返回 `pending` 回程帧（JS 侧保持挂起）；最终结果经 `push` 回推。
    static func handle(_ f: InvokeWire.InvokeFrame, push: @escaping ([UInt8]) -> Void) throws -> [UInt8] {
        guard let url = buildURL(f) else {
            return try InvokeWire.encodeResolve(.makeErr(f.reqId, "http.request: url 非法或缺失（\(f.url ?? "<nil>")）"))
        }
        var req = URLRequest(url: url)
        req.httpMethod = f.httpMethod ?? "GET"
        req.timeoutInterval = Double(f.timeoutOrDefault) / 1000.0
        for (k, v) in f.headers ?? [] { req.setValue(v, forHTTPHeaderField: k) }
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
        // ★★★决策 #1115：改用 **delegate 驱动**（`dataTask(with:)` 不带 completion）——
        //   这样数据是**逐块**送到 `didReceive data`，超限时能 `cancel()` **真正中止读取**。
        //   ★为什么不能沿用 completion：completion 回调时 `data` **已全部进内存**，
        //     那时再判上限等于"洪水过后才关闸"（#1114 的取证结论就是这一点）。
        let task = session.dataTask(with: req)
        BodyLimitDelegate.shared.register(task, reqId: reqId, push: push)
        task.resume()

        return try InvokeWire.encodeResolve(.makePending(reqId))
    }

    /// 响应体硬上限（与 Android `HttpCapability.MAX_BODY_BYTES` **同值**——两端必须一致，
    /// 否则"同一个请求换端就成败不同"，那是比没有上限更糟的不可预期）。
    static let MAX_BODY_BYTES = 32 * 1024 * 1024

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

    private struct State {
        let reqId: String
        let push: ([UInt8]) -> Void
        var body = Data()
        /// 超限后置位：`didComplete` 时据此编 `fetch.tooLarge` 而不是普通取消
        var tooLargeAt: Int?
    }

    /// ★key = taskIdentifier；只在该 task 的生命周期内存在
    private var states: [Int: State] = [:]

    /// 登记一个新 task（必须在 `resume()` **之前**调用——否则可能先收到数据、后登记，丢块）
    func register(_ task: URLSessionDataTask, reqId: String, push: @escaping ([UInt8]) -> Void) {
        states[task.taskIdentifier] = State(reqId: reqId, push: push)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard var st = states[dataTask.taskIdentifier] else { return }
        // ★第一道闸：Content-Length 声明就超限 ⇒ 立刻取消，不读一块数据
        if st.body.isEmpty,
           let expected = dataTask.response?.expectedContentLength,
           expected > 0,
           expected > Int64(HttpCapability.MAX_BODY_BYTES) {
            st.tooLargeAt = st.body.count
            states[dataTask.taskIdentifier] = st
            dataTask.cancel()
            return
        }
        // ★第二道闸：逐块累计（防 chunked / 谎报长度）
        st.body.append(data)
        if st.body.count > HttpCapability.MAX_BODY_BYTES {
            st.tooLargeAt = st.body.count
            states[dataTask.taskIdentifier] = st
            dataTask.cancel()   // ⇒ 本 task 的读取到此为止（内存不再增长）
            return
        }
        states[dataTask.taskIdentifier] = st
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let st = states[task.taskIdentifier] else { return }
        states.removeValue(forKey: task.taskIdentifier)   // ★先摘表 ⇒ 保证恰好回推一次
        let reqId = st.reqId
        let frame: [UInt8]
        do {
            if let at = st.tooLargeAt {
                // ★超限 = 独立错误档（JS 侧映射 `fetch.tooLarge`），不与网络失败混同
                frame = try InvokeWire.encodeResolve(.makeErr(reqId,
                    "fetch.tooLarge: 响应体超过上限 \(HttpCapability.MAX_BODY_BYTES)B（已读 \(at)B）"))
            } else if let error {
                // ★我们自己 cancel 产生的错误被上面拦下；这里只剩真实网络错误
                frame = try InvokeWire.encodeResolve(.makeErr(reqId, "http.request 失败：\(error.localizedDescription)"))
            } else if let http = task.response as? HTTPURLResponse {
                var r = InvokeWire.ResolveFrame.makeOK(reqId)
                r.status = UInt32(max(0, http.statusCode))
                r.headers = HttpCapability.headerPairsForDelegate(http)
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

