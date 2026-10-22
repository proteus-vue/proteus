// hosts/ios/ProteusHost/runtime/http-capability-dns-session.swift
// ★★★#1180：`HttpCapability` 的 **HTTPDNS 会话管理**（从 `http-capability.swift` 抽出）。
//
// 【为什么单独一个文件】
//   ① 职责不同：`http-capability.swift` 管「一条 http.request 怎么发」，这里只管
//      「这次请求该用哪个 URLSession」；
//   ② 那个文件已在 1000 行红线附近（抽出前 1013 行），按"一个文件几个职责"纪律拆。
//   ★这不是"为过门禁而拆"：会话选择有自己的三条硬约束（见下），独立成文件后
//     改它不需要重读整条请求路径。
//
// 【三条硬约束（都是实测踩出来的）】
//   1. **一个表 ⇒ 一个 session**：`connectionProxyDictionary` 是 per-session 的
//      ⇒ 不同业务给不同 `httpDns` 表时必须走各自的代理，否则表会串。
//   2. **session 必须按表缓存**：每请求 new `URLSession` = 连接池归零
//      （#1155/#1160 实测过两次：pinning 首版每次新建 SSLContext ⇒ 复用 4/1 退化到 5/5）。
//   3. **超上限必须如实报错**：表数量 > `HttpDnsProxies.maxTables` 时**不得**悄悄回落到
//      默认 session——那会让业务以为表生效了、实际走系统 DNS（假数据比缺数据更糟）。
//
// 【生产默认路径】无 `httpDns` ⇒ `defaultSession`（零代理键）⇒ **行为完全不变**。

import Foundation

extension HttpCapability {
    /// 进程级默认会话（零代理键）。
    /// ★#1178/#1179 保留 `PROTEUS_B_PROXY` 探针开关：只配 **HTTP** 代理键
    ///   （iOS 没有 HTTPS 代理键，`kCFNetworkProxiesHTTPSEnable` 是 `CF_AVAILABLE(10_6, NA)`），
    ///   实测 https 会经它走 `CONNECT` 隧道。**不设该变量时一个键都不加**。
    static let defaultSession: URLSession = makeSession { c in
        c.httpShouldSetCookies = true
        c.httpCookieStorage = HTTPCookieStorage.shared
        if let proxy = ProcessInfo.processInfo.environment["PROTEUS_B_PROXY"], !proxy.isEmpty {
            let parts = proxy.split(separator: ":")
            if parts.count == 2, let port = Int(parts[1]) {
                c.connectionProxyDictionary = proxyDictionary(host: String(parts[0]), port: port)
            }
        }
    }

    private static let sessionLock = NSLock()
    private static var sessionByTable: [String: URLSession] = [:]

    static func makeSession(_ configure: (URLSessionConfiguration) -> Void) -> URLSession {
        let c = URLSessionConfiguration.default
        configure(c)
        return URLSession(configuration: c, delegate: BodyLimitDelegate.shared, delegateQueue: nil)
    }

    private static func proxyDictionary(host: String, port: Int) -> [AnyHashable: Any] {
        [
            "HTTPEnable": 1, "HTTPProxy": host, "HTTPPort": port,
            "HTTPSEnable": 1, "HTTPSProxy": host, "HTTPSPort": port,
        ]
    }

    /// 为该请求选 session：有 `httpDns` 表 ⇒ 该表对应的代理 session；否则默认 session。
    /// - Parameter dns: **线格式形态**（name-values，值 = 逗号分隔 IP）
    /// - Returns: `nil` = 表超上限或代理起不来（调用方**须如实报错**）
    static func session(for dns: InvokeWire.NameValues?) -> URLSession? {
        let normalized = HttpDnsProxies.normalize(dns)
        guard !normalized.isEmpty else { return defaultSession }
        let key = HttpDnsProxies.key(for: normalized)
        sessionLock.lock()
        if let s = sessionByTable[key] { sessionLock.unlock(); return s }
        sessionLock.unlock()

        guard let proxy = HttpDnsProxies.proxy(for: normalized) else { return nil }
        let s = makeSession { c in
            c.httpShouldSetCookies = true
            c.httpCookieStorage = HTTPCookieStorage.shared
            c.connectionProxyDictionary = proxyDictionary(host: "127.0.0.1", port: Int(proxy.port))
        }
        sessionLock.lock()
        sessionByTable[key] = s
        sessionLock.unlock()
        NSLog("[proteus] HTTPDNS_SESSION_READY hosts=%d port=%d", normalized.count, Int(proxy.port))
        return s
    }
}
