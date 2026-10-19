// hosts/ios/ProteusHost/runtime/local-service-capability.swift
// ★★★决策 #1097（2026-10-19）：C78 局域网服务发现（mDNS）的 **iOS 宿主实现**
//   （`localService.start` / `localService.stop`）。
//
// 【为什么用 NWBrowser】`Network.framework` 的 `NWBrowser` 是系统 Bonjour/mDNS 客户端，
//   无需第三方依赖；iOS 14+ 首次使用会弹「本地网络」权限（系统自动，无需 Info.plist 键）。
//
// 【与 Android 的形态差异（如实登记）】
//   · Android `NsdManager` 需要**二次 resolve** 才拿到 ip/port；`NWBrowser` 的 `NWBrowser.Result`
//     自带 `endpoint`（`.service` 形态，含 name/type/domain），**地址仍需一次 `NWConnection` 或
//     `NetService` 解析**。本实现用 `NetService`（Bonjour 高层封装）解析——比手搓 NWConnection 简单。
//   · `serviceType` 形如 `"_http._tcp"`；`NWBrowser.Descriptor.bonjour` 要求**带尾点**
//     （`"_http._tcp."`）⇒ 本实现自动补尾点（★这是平台格式要求，不是改写调用方语义）。
//
// 【诚实边界】
//   · 只做 discovery，不做 advertise（契约无该项）
//   · 解析失败 ⇒ 推 `resolveFail`（与 wx 的 onLocalServiceResolveFail 对齐）

import Foundation
import Network

enum LocalServiceCapability {

    /// 壳推出口（由 SuperappRuntimeHost 注入）。
    static var pusher: (( [String: Any]) -> Void)?

    private static var browser: NWBrowser?
    private static var currentType: String?
    /// serviceName → NetService（解析中，防提前释放）
    private static var resolving: [String: NetService] = [:]
    private static let lock = NSLock()

    /// `localService.start`：`{ serviceType }` → `{}`（受理即返，服务经壳推到达）
    static func start(_ args: [String: Any]) throws -> [String: Any] {
        let raw = (args["serviceType"] as? String) ?? ""
        guard !raw.isEmpty else {
            throw WsError.invalid("localService.start 需要 serviceType（如 \"_http._tcp\"）")
        }
        // ★NWBrowser 要求带尾点（平台格式），调用方语义不变
        let type = raw.hasSuffix(".") ? raw : raw + "."
        lock.lock()
        let already = browser != nil && currentType == raw
        lock.unlock()
        if already { return [:] }
        _ = try? stop([:])   // 换类型先停旧的（幂等）

        let params = NWParameters.tcp
        params.includePeerToPeer = true
        let b = NWBrowser(for: .bonjour(type: type, domain: nil), using: params)
        b.stateUpdateHandler = { state in
            switch state {
            case .failed(let err):
                push(["event": "resolveFail", "error": "browser 失败：\(err)"])
            case .ready:
                push(["event": "started"])
            case .cancelled:
                push(["event": "stop"])
            default:
                break
            }
        }
        b.browseResultsChangedHandler = { _, changes in
            for change in changes {
                switch change {
                case .added(let result):
                    resolveAndPush(result)
                case .removed(let result):
                    push(["event": "lost", "service": serviceInfo(from: result, ip: nil, port: nil)])
                default:
                    break
                }
            }
        }
        b.start(queue: .global(qos: .utility))
        lock.lock()
        browser = b
        currentType = raw
        lock.unlock()
        return [:]
    }

    /// `localService.stop`：`{}` → `{}`（幂等）
    static func stop(_ args: [String: Any]) throws -> [String: Any] {
        lock.lock()
        let b = browser
        browser = nil
        currentType = nil
        let pending = resolving
        resolving.removeAll()
        lock.unlock()
        b?.cancel()
        for (_, svc) in pending { svc.stop() }
        return [:]
    }

    /// 从 NWBrowser.Result 提服务名/类型。
    private static func serviceInfo(from result: NWBrowser.Result, ip: String?, port: Int?) -> [String: Any] {
        var name = ""
        var type = ""
        if case let .service(svcName, svcType, _, _) = result.endpoint {
            name = svcName
            type = svcType.hasSuffix(".") ? String(svcType.dropLast()) : svcType   // ★去尾点（与 wx 形态对齐）
        }
        var o: [String: Any] = ["serviceName": name, "serviceType": type]
        if let ip = ip { o["ip"] = ip }
        if let port = port, port > 0 { o["port"] = port }
        return o
    }

    /// 解析 endpoint → ip/port（用 NetService，异步），成功后推 found。
    private static func resolveAndPush(_ result: NWBrowser.Result) {
        guard case let .service(name, type, domain, _) = result.endpoint else { return }
        let svc = NetService(domain: domain, type: type, name: name)
        svc.delegate = ResolveDelegate.shared
        lock.lock()
        resolving[name] = svc
        lock.unlock()
        svc.resolve(withTimeout: 5)
        _ = result
    }

    /// NetService 解析回调（单例 delegate）。
    final class ResolveDelegate: NSObject, NetServiceDelegate {
        static let shared = ResolveDelegate()
        func netServiceDidResolveAddress(_ sender: NetService) {
            let ip = sender.addresses?.compactMap { data -> String? in
                var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                let r = data.withUnsafeBytes { ptr -> Int32 in
                    guard let sa = ptr.baseAddress?.assumingMemoryBound(to: sockaddr.self) else { return -1 }
                    return getnameinfo(sa, socklen_t(data.count), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
                }
                return r == 0 ? String(cString: host) : nil
            }.first
            var o: [String: Any] = [
                "serviceName": sender.name,
                "serviceType": sender.type.hasSuffix(".") ? String(sender.type.dropLast()) : sender.type,
            ]
            if let ip = ip { o["ip"] = ip }
            if sender.port > 0 { o["port"] = sender.port }
            push(["event": "found", "service": o])
            lock.lock(); resolving.removeValue(forKey: sender.name); lock.unlock()
        }
        func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
            push(["event": "resolveFail",
                  "service": ["serviceName": sender.name,
                              "serviceType": sender.type.hasSuffix(".") ? String(sender.type.dropLast()) : sender.type],
                  "error": "resolve 失败：\(errorDict)"])
            lock.lock(); resolving.removeValue(forKey: sender.name); lock.unlock()
        }
    }

    private static func push(_ payload: [String: Any]) {
        pusher?(payload)
    }
}
