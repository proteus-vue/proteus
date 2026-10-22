// hosts/ios/ProteusHost/runtime/HttpDnsProxy.swift
// ★★★#1180：**iOS HTTPDNS 生产实现 —— 进程内本地 CONNECT 代理（B 路线）**
//
// 【为什么是"本地代理"这条路（而不是改 URL/改证书校验）】
//   `URLSession` **没有** per-request 的 DNS 钩子（`NSURLSession.h` 里与 DNS 相关的只有
//   `requiresDNSSECValidation` 开关与 `DomainResolutionProtocol` 事后统计）。可选的四条路：
//     A. URL 换 IP + `SecPolicyCreateSSL` 按原域名重校验 —— 便宜，但 **SNI 变成 IP**，
//        CDN/虚拟主机场景会拿错证书；
//     B. **进程内本地 CONNECT 代理** + `connectionProxyDictionary` —— 本文件；
//     C. 用 `Network.framework` 自建 HTTP 栈 —— 等价重造传输层（无 `nw_protocol_http`）；
//     D. 系统级 DNS Proxy/DoH —— 需 Network Extension entitlement，且是进程级策略。
//   ★#1178（模拟器）+ #1179（iPhone 12 真机）已实测 B 可行：
//     https 经 **HTTP** 代理键（iOS 没有 HTTPS 代理键，`kCFNetworkProxiesHTTPSEnable` 是
//     `CF_AVAILABLE(10_6, NA)`）由 CFNetwork 以 `CONNECT host:port` 隧道交给代理，
//     **隧道内 SNI / Host / HTTP/2 / 连接复用全部保留**。
//     证据：`hosts/ios/results/httpdns-b-device.json`（13/13 绿，SNI 三次全是原域名）。
//   ★为什么是 B 而不是 A/C/D（四路线的行业对照与取舍）见
//     `docs/proteus-network-plan/02-ios-httpdns-industry-survey.md`。
//
// 【★为什么"一个表一个代理"而不是"一个代理一进程"】
//   `httpDns` 是 **per-request** 语义（同一 App 里不同业务可以给不同表），而
//   `connectionProxyDictionary` 是 **per-session** 的 ⇒ 只能"一个表 ⇒ 一个代理 + 一个 session"。
//   ★★**session 必须按表缓存**（见 `HttpCapability.session(for:)`）：每请求新建 session
//   = 连接池归零（#1155/#1160 同族纪律，实测过两次）。
//
// 【★表未命中怎么办：回落到系统解析，并**如实标记**】
//   与 Android（`ForwardingDns` 三级回落）/ 鸿蒙（`tableDnsLookup` 未命中返回 nullptr）一致：
//   表只影响表内域名，**绝不能**因为查不到就失败（否则 HTTPDNS 会把无关域名一起弄坏）。
//   但回落**必须可观测**：`lastSource` 记 `table` / `system` / `literal`，
//   `http.dnsStats` 回执里能分辨 ⇒ 业务能判断"我以为走了表，其实走了系统"。
//
// 【诚实边界】
//   · 只做 HTTP/1.1 `CONNECT` 隧道（这正是 CFNetwork 对 https 的形态）；明文 http 请求
//     经代理会以"绝对 URI"形式到达（`GET http://host/path`）——本代理对其**直接拒绝**
//     （501），因为 HTTPDNS 的价值在 TLS 场景，明文改走代理会改变 Host 语义且无收益。
//     业务若对明文 http 传 httpDns ⇒ 该请求失败并给出明确错误（不静默）。
//   · 每表一个监听端口（loopback 临时端口），按表缓存；上限 `maxTables`，
//     超出时**如实报错**（不悄悄共享/驱逐，避免把连接池弄乱）。
//   · 不做解析结果缓存/TTL（表由业务给，缓存归业务侧；与 Android/鸿蒙同边界）。
//   · App 进后台时监听线程随之挂起（iOS 后台限制）；恢复前台后继续可用。

import Foundation

/// 一条被代理的连接（只用于日志/排障计数，不持有 socket）。
enum HttpDnsSource: String {
    case table
    case system
    case literal
}

/// 一个 DNS 表对应的本地 CONNECT 代理。
final class HttpDnsProxy {
    /// 规范化后的表：`host(小写) → [ip...]`（顺序即优先级，命中第一个能连上的）
    let table: [String: [String]]
    /// 监听端口（loopback，系统分配）
    private(set) var port: UInt16 = 0

    private var listenFD: Int32 = -1
    private var running = true
    private let countersLock = NSLock()
    private var _lookups = 0
    private var _tableHits = 0
    private var _misses = 0
    private var _lastSource = ""
    private var _lastHost = ""
    private var _connectErrors = 0
    /**
     * ★★★#1183：**host → 最近一次解析来源**（供 `FetchMeta.transport.dnsSource` 用）。
     *
     * 【为什么按 host 而不是按请求】URLSession **不暴露**"这次请求触发了哪次 CONNECT"——
     *   代理侧只能看到 TCP 连接，看不到它属于哪个 `URLSessionTask`。而 transport 读数在
     *   请求完成后按 **URL 的 host** 取即可对上。
     * ★诚实边界：连接**复用**时根本不会走到代理（没有 CONNECT、没有 lookup）⇒ 该 host 的
     *   `dnsSource` 可能还是上一次的值。⇒ 上层只在**本次真的新建了连接**时才写这个字段
     *   （`reused == false`），复用时不写（"没发生解析"≠"走了系统 DNS"）。
     */
    private var _sourceByHost: [String: String] = [:]

    init?(table: [String: [String]]) {
        self.table = table
        guard startListening() else { return nil }
        let t = Thread { [weak self] in self?.acceptLoop() }
        t.name = "proteus-httpdns-proxy"
        t.start()
    }

    deinit { stop() }

    func stop() {
        running = false
        if listenFD >= 0 {
            // shutdown 会让阻塞中的 accept 立即返回（条件唤醒，不是盲等）
            shutdown(listenFD, Int32(SHUT_RDWR))
            close(listenFD)
            listenFD = -1
        }
    }

    // MARK: - 记账（形状与 Android `http.dnsStats` 一致）

    func statsSnapshot() -> [String: Any] {
        countersLock.lock(); defer { countersLock.unlock() }
        return [
            "lookups": _lookups,
            "tableHits": _tableHits,
            "misses": _misses,
            "connectErrors": _connectErrors,
            "lastSource": _lastSource,
            "lastHost": _lastHost,
        ]
    }

    private func noteLookup(host: String, source: HttpDnsSource) {
        countersLock.lock(); defer { countersLock.unlock() }
        _lookups += 1
        switch source {
        case .table: _tableHits += 1
        case .system, .literal: _misses += 1
        }
        _lastSource = source.rawValue
        _lastHost = host
        _sourceByHost[host] = source.rawValue
    }

    /// ★#1183：该 host 最近一次的解析来源（`nil` = 这个表对应的代理从没解析过它）
    func source(forHost host: String) -> String? {
        countersLock.lock(); defer { countersLock.unlock() }
        return _sourceByHost[host.lowercased()]
    }

    private func noteConnectError() {
        countersLock.lock(); defer { countersLock.unlock() }
        _connectErrors += 1
    }

    // MARK: - 监听

    private func startListening() -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0                     // 系统分配临时端口
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")   // ★只监听 loopback（不对外暴露）

        let bindRC = withUnsafePointer(to: &addr) { p in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindRC == 0 else { close(fd); return false }
        guard listen(fd, 16) == 0 else { close(fd); return false }

        // 读回实际端口
        var bound = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let ok = withUnsafeMutablePointer(to: &bound) { p in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) }
        }
        guard ok == 0 else { close(fd); return false }
        port = UInt16(bigEndian: bound.sin_port)
        listenFD = fd
        NSLog("[proteus] HTTPDNS_PROXY_READY port=%d hosts=%d", Int(port), table.count)
        return true
    }

    private func acceptLoop() {
        while running {
            var addr = sockaddr_in()
            var len = socklen_t(MemoryLayout<sockaddr_in>.size)
            let client = withUnsafeMutablePointer(to: &addr) { p in
                p.withMemoryRebound(to: sockaddr.self, capacity: 1) { accept(listenFD, $0, &len) }
            }
            if client < 0 {
                if errno == EINTR { continue }
                break   // listenFD 已关闭
            }
            let t = Thread { [weak self] in
                self?.serve(client: client)
                close(client)
            }
            t.name = "proteus-httpdns-conn"
            t.start()
        }
    }

    // MARK: - 一条连接

    private func serve(client: Int32) {
        // AWS 的超时只防"对端连上却永不发请求"的半开连接（有界条件，不是盲等）
        guard let head = readHeader(client) else { return }
        guard let (host, targetPort) = parseConnect(head) else {
            writeAll(client, "HTTP/1.1 400 Bad Request\r\n\r\n".data(using: .utf8)!)
            return
        }

        // ★明文代理请求（`GET http://...`）——本代理只做隧道，明确拒绝（不静默改写）
        if host.isEmpty {
            writeAll(client, "HTTP/1.1 501 Not Implemented\r\n\r\n".data(using: .utf8)!)
            return
        }

        let lower = host.lowercased()
        var candidates: [String] = []
        var source: HttpDnsSource = .system
        if isIPLiteral(lower) {
            // URL 本身就是 IP ⇒ 不查任何解析（与 Android/鸿蒙同语义）
            candidates = [lower]
            source = .literal
        } else if let ips = table[lower], !ips.isEmpty {
            candidates = ips
            source = .table
        } else {
            candidates = resolveSystem(lower)
            source = .system
        }
        noteLookup(host: lower, source: source)

        guard !candidates.isEmpty else {
            writeAll(client, "HTTP/1.1 502 Bad Gateway\r\n\r\n".data(using: .utf8)!)
            return
        }

        // 按顺序尝试（HTTPDNS 表常给多个 IP ⇒ 第一个连不上就试下一个）
        var upstream: Int32 = -1
        for ip in candidates {
            upstream = connectTo(ip: ip, port: targetPort)
            if upstream >= 0 { break }
        }
        guard upstream >= 0 else {
            noteConnectError()
            writeAll(client, "HTTP/1.1 502 Bad Gateway\r\n\r\n".data(using: .utf8)!)
            return
        }

        writeAll(client, "HTTP/1.1 200 Connection Established\r\n\r\n".data(using: .utf8)!)
        relay(client, upstream)
        close(upstream)
    }

    /// 读到 `\r\n\r\n`（上限 8 KiB，防恶意长头把内存吃满）
    private func readHeader(_ fd: Int32) -> Data? {
        var buf = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        let deadline = Date().addingTimeInterval(15)
        while buf.count < 8192 {
            let remaining = deadline.timeIntervalSinceNow
            if remaining <= 0 { return nil }
            var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
            let pr = poll(&pfd, 1, Int32(remaining * 1000))
            if pr <= 0 { return nil }
            let n = read(fd, &chunk, chunk.count)
            if n <= 0 { return nil }
            buf.append(contentsOf: chunk[0..<n])
            if let r = buf.range(of: Data("\r\n\r\n".utf8)) {
                _ = r
                return buf
            }
        }
        return nil
    }

    /// 解析 `CONNECT host:port HTTP/1.1`。非 CONNECT ⇒ host 返回空串（当作不支持）。
    private func parseConnect(_ head: Data) -> (String, UInt16)? {
        guard let text = String(data: head, encoding: .utf8) else { return nil }
        guard let firstLine = text.split(separator: "\r\n").first else { return nil }
        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2 else { return nil }
        guard parts[0].uppercased() == "CONNECT" else { return ("", 0) }

        let authority = String(parts[1])
        // IPv6 形态 `[::1]:443`
        if authority.hasPrefix("[") , let closeIdx = authority.firstIndex(of: "]") {
            let host = String(authority[authority.index(after: authority.startIndex)..<closeIdx])
            let rest = authority[authority.index(after: closeIdx)...]
            let port = UInt16(rest.dropFirst().split(separator: ":").first ?? "443") ?? 443
            return (host, port)
        }
        let segs = authority.split(separator: ":")
        let host = String(segs.first ?? "")
        let port = segs.count >= 2 ? (UInt16(segs[1]) ?? 443) : 443
        return (host, port)
    }

    private func isIPLiteral(_ s: String) -> Bool {
        var v4 = in_addr()
        if inet_pton(AF_INET, s, &v4) == 1 { return true }
        var v6 = in6_addr()
        return inet_pton(AF_INET6, s, &v6) == 1
    }

    /// 系统解析（表未命中时的**显式回落**——`lastSource` 会记成 `system`，不静默）
    private func resolveSystem(_ host: String) -> [String] {
        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC
        hints.ai_socktype = SOCK_STREAM
        var res: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &res) == 0, let head = res else { return [] }
        defer { freeaddrinfo(head) }
        var out: [String] = []
        var cur: UnsafeMutablePointer<addrinfo>? = head
        while let p = cur {
            let ai = p.pointee
            var buf = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(ai.ai_addr, ai.ai_addrlen, &buf, socklen_t(buf.count), nil, 0, NI_NUMERICHOST) == 0 {
                let ip = String(cString: buf)
                if !out.contains(ip) { out.append(ip) }
            }
            cur = ai.ai_next
        }
        return out
    }

    /// 非阻塞 connect + poll 超时（8s；有界条件，不是盲等）
    private func connectTo(ip: String, port: UInt16) -> Int32 {
        var v4 = in_addr()
        var v6 = in6_addr()
        let family: Int32
        var addrPtr: (UnsafePointer<sockaddr>, socklen_t)
        var sin = sockaddr_in()
        var sin6 = sockaddr_in6()
        if inet_pton(AF_INET, ip, &v4) == 1 {
            family = AF_INET
            sin.sin_family = sa_family_t(AF_INET)
            sin.sin_port = port.bigEndian
            sin.sin_addr = v4
            addrPtr = withUnsafePointer(to: &sin) {
                ($0.withMemoryRebound(to: sockaddr.self, capacity: 1) { $0 }, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        } else if inet_pton(AF_INET6, ip, &v6) == 1 {
            family = AF_INET6
            sin6.sin6_family = sa_family_t(AF_INET6)
            sin6.sin6_port = port.bigEndian
            sin6.sin6_addr = v6
            addrPtr = withUnsafePointer(to: &sin6) {
                ($0.withMemoryRebound(to: sockaddr.self, capacity: 1) { $0 }, socklen_t(MemoryLayout<sockaddr_in6>.size))
            }
        } else {
            return -1
        }

        let fd = socket(family, SOCK_STREAM, 0)
        guard fd >= 0 else { return -1 }
        let flags = fcntl(fd, F_GETFL, 0)
        _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)

        let rc = connect(fd, addrPtr.0, addrPtr.1)
        if rc == 0 { return fd }
        guard errno == EINPROGRESS else { close(fd); return -1 }

        var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
        let pr = poll(&pfd, 1, 8000)
        guard pr > 0 else { close(fd); return -1 }
        var err: Int32 = 0
        var len = socklen_t(MemoryLayout<Int32>.size)
        guard getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &len) == 0, err == 0 else {
            close(fd); return -1
        }
        return fd
    }

    /// 双向泵（poll 驱动；任一侧 EOF 就半关闭另一侧，直到两边都结束）
    private func relay(_ a: Int32, _ b: Int32) {
        var openA = true
        var openB = true
        var buf = [UInt8](repeating: 0, count: 32768)
        while openA || openB {
            var pfds = [
                pollfd(fd: a, events: Int16(POLLIN), revents: 0),
                pollfd(fd: b, events: Int16(POLLIN), revents: 0),
            ]
            // 60s 空闲超时：防止隧道空转把线程永久占住（URLSession 会自己重建连接）
            let pr = poll(&pfds, 2, 60000)
            if pr <= 0 { break }
            if openA, pfds[0].revents & Int16(POLLIN) != 0 {
                let n = read(a, &buf, buf.count)
                if n > 0 {
                    if !writeAll(b, Data(bytes: buf, count: n)) { break }
                } else {
                    openA = false
                    shutdown(b, Int32(SHUT_WR))
                }
            }
            if openB, pfds[1].revents & Int16(POLLIN) != 0 {
                let n = read(b, &buf, buf.count)
                if n > 0 {
                    if !writeAll(a, Data(bytes: buf, count: n)) { break }
                } else {
                    openB = false
                    shutdown(a, Int32(SHUT_WR))
                }
            }
            if pfds[0].revents & (Int16(POLLERR) | Int16(POLLHUP)) != 0 { openA = false }
            if pfds[1].revents & (Int16(POLLERR) | Int16(POLLHUP)) != 0 { openB = false }
        }
    }

    /// 写满（处理短写）
    @discardableResult
    private func writeAll(_ fd: Int32, _ data: Data) -> Bool {
        var sent = 0
        let bytes = [UInt8](data)
        while sent < bytes.count {
            let n = bytes.withUnsafeBytes { p -> Int in
                let base = p.baseAddress!.advanced(by: sent)
                return write(fd, base, bytes.count - sent)
            }
            if n <= 0 {
                if errno == EINTR { continue }
                return false
            }
            sent += n
        }
        return true
    }
}

/// 进程级注册表：按表内容缓存代理（★一表一实例，避免 session 分裂）。
enum HttpDnsProxies {
    /// ★★★#1180：线格式里的 `httpDns` 是 **name-values**（有序 `[(name, value)]`），
    ///   值 = **逗号分隔的 IP 列表**（与 TS `normalizeHttpDns` 的 `ips.join(',')` 对齐，
    ///   也与 Android/鸿蒙 两端的解析口径一致）。
    ///   ⇒ 这里把线格式形态归一成 `host → [ip...]`，**顺序保留**（它表达优先级）。
    static func normalize(_ nv: InvokeWire.NameValues?) -> [String: [String]] {
        guard let nv, !nv.isEmpty else { return [:] }
        var out: [String: [String]] = [:]
        for (rawHost, rawValue) in nv {
            let host = rawHost.trimmingCharacters(in: .whitespaces).lowercased()
            if host.isEmpty { continue }
            var ips: [String] = []
            for piece in rawValue.split(whereSeparator: { $0 == "," || $0 == " " || $0 == "\t" || $0 == "\n" }) {
                let ip = String(piece).trimmingCharacters(in: .whitespaces)
                if !ip.isEmpty && !ips.contains(ip) { ips.append(ip) }
            }
            if !ips.isEmpty { out[host] = ips }
        }
        return out
    }

    /// 上限：一表一监听端口 + 一 session ⇒ 不设上限会随业务表无限增长
    /// ★超出时**如实报错**（不悄悄共享/驱逐：驱逐会让连接池凭空归零，比报错更难排查）
    static let maxTables = 8

    private static let lock = NSLock()
    private static var proxies: [String: HttpDnsProxy] = [:]

    /// 表的规范化键（顺序无关；IP 顺序**保留**——它表达优先级）
    static func key(for table: [String: [String]]) -> String {
        table.keys.sorted().map { host in
            "\(host.lowercased())=\(table[host]!.joined(separator: ","))"
        }.joined(separator: ";")
    }

    /// 取（或首次创建）该表的代理。超上限返回 nil（调用方须如实报错）。
    static func proxy(for table: [String: [String]]) -> HttpDnsProxy? {
        let k = key(for: table)
        lock.lock(); defer { lock.unlock() }
        if let p = proxies[k] { return p }
        guard proxies.count < maxTables else { return nil }
        var normalized: [String: [String]] = [:]
        for (host, ips) in table {
            let clean = ips.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            if !clean.isEmpty { normalized[host.lowercased()] = clean }
        }
        guard !normalized.isEmpty else { return nil }
        guard let p = HttpDnsProxy(table: normalized) else { return nil }
        proxies[k] = p
        return p
    }

    /// ★#1183：查某个 host 由**该表对应的代理**解析时走的哪一级。
    ///   `nil` = 该表下这个 host 从没被解析过（⇒ 上层不写 `dnsSource`，不填默认值）。
    static func source(forHost host: String, table: [String: [String]]) -> String? {
        let k = key(for: table)
        lock.lock()
        let p = proxies[k]
        lock.unlock()
        return p?.source(forHost: host)
    }

    /// 聚合记账（`http.dnsStats` 回执）。★跨表累加，`lastSource/lastHost` 取最近一次有记录的。
    static func statsSnapshot() -> [String: Any] {
        lock.lock()
        let all = Array(proxies.values)
        lock.unlock()
        var lookups = 0, tableHits = 0, misses = 0, connectErrors = 0
        var lastSource = ""
        var lastHost = ""
        for p in all {
            let s = p.statsSnapshot()
            lookups += (s["lookups"] as? Int) ?? 0
            tableHits += (s["tableHits"] as? Int) ?? 0
            misses += (s["misses"] as? Int) ?? 0
            connectErrors += (s["connectErrors"] as? Int) ?? 0
            if let ls = s["lastSource"] as? String, !ls.isEmpty {
                lastSource = ls
                lastHost = (s["lastHost"] as? String) ?? ""
            }
        }
        return [
            "lookups": lookups,
            "tableHits": tableHits,
            "misses": misses,
            "connectErrors": connectErrors,
            "lastSource": lastSource,
            "lastHost": lastHost,
            "proxies": all.count,
        ]
    }
}
