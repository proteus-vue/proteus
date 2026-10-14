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
    private static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.httpShouldSetCookies = true
        cfg.httpCookieStorage = HTTPCookieStorage.shared
        return URLSession(configuration: cfg)
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
        session.dataTask(with: req) { data, resp, err in
            let frame: [UInt8]
            do {
                if let err {
                    frame = try InvokeWire.encodeResolve(.makeErr(reqId, "http.request 失败：\(err.localizedDescription)"))
                } else if let http = resp as? HTTPURLResponse {
                    var r = InvokeWire.ResolveFrame.makeOK(reqId)
                    r.status = UInt32(max(0, http.statusCode))
                    r.headers = headerPairs(http)
                    r.body = Array(data ?? Data())
                    frame = try InvokeWire.encodeResolve(r)
                } else {
                    frame = try InvokeWire.encodeResolve(.makeErr(reqId, "http.request 失败：响应不是 HTTP 响应"))
                }
            } catch {
                frame = (try? InvokeWire.encodeResolve(.makeErr(reqId, "http.request 回程帧编码失败：\(error)"))) ?? []
            }
            // ★回 JS 必须在**主线程**（G-39 线程纪律：禁止在网络线程直接调 JS）
            DispatchQueue.main.async { push(frame) }
        }.resume()

        return try InvokeWire.encodeResolve(.makePending(reqId))
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
