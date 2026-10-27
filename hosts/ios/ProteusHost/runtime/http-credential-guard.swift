// hosts/ios/ProteusHost/runtime/http-credential-guard.swift
// ★★★#1257 安全基线：**跨 origin 重定向必须剥掉凭据头**（iOS 落地）。
//
// 【它防什么（实测出来的漏洞，不是理论风险）】
//   本仓 iOS 宿主在 `HttpCapability.makeRequest` 里把平台 Cookie 存储的会话 cookie
//   **手工塞进 `Cookie` 头**（`cookieHeader(for:)`）。而 `URLSession` 跟随重定向时，
//   会把**上一跳的请求头**带进新请求 —— 包括我们手工设的那个 Cookie ⇒ 302 到第三方域就白给。
//
//   ★与 Android 同型：那边实测 OkHttp 3.14.9 的 `followUpRequest()` 只
//     `removeHeader("Authorization")`，**对 Cookie 完全不管**（正常用法下 cookie 该由
//     `CookieJar` 按 domain/path 匹配 —— "手写头"绕过了那层）。
//     iOS 的 Cookie 由 `HTTPCookieStorage` 按域隔离，但我们这条同样是**手写头** ⇒ 同样绕过。
//
// 【与 TS 侧的关系（三层防线，不是冗余）】
//   ① JS 管线（`capability-fetch-pipeline.ts`）：带凭据的请求强制 `redirectManual` ⇒ 逐跳剥；
//   ② **本文件**：`willPerformHTTPRedirection` 里每一跳再校验一次 origin（宿主层兜底）；
//   ③ 把剥离清单收敛到 `credentialHeaders` 一处，与 TS 侧 `CREDENTIAL_HEADERS` 同一集合。
//   ★为什么两处都要：JS 那层可能被"宿主不认 redirectManual"或旧包绕过；宿主这层是最后一道。
//
// 【诚实边界】
//   · 本文件只处理**跟随途中**的剥离；`redirectManual`（不跟随）路径由 JS 逐跳处理。
//   · 纯 Foundation API ⇒ 可在 macOS 上 `swiftc -typecheck`（`check:ios-selfdraw-compile` 覆盖）。

import Foundation

/// 凭据类请求头（与 TS `CREDENTIAL_HEADERS` **同一集合**；改一处要改两处）。
///
/// ★为什么不放 `HttpCapability` 里：那个文件已顶 1000 行上限（#1257 加剥离逻辑时越线），
///   按职责拆出来——"凭据跨域策略"本身就是一个独立语义单元。
enum HttpCredentialGuard {
    static let credentialHeaders = ["Cookie", "Cookie2", "Authorization", "Proxy-Authorization"]

    /// origin = `scheme://host:port`（端口归一：http 缺省 80 / https 缺省 443）。
    ///
    /// ★scheme 参与比较 ⇒ `https → http` 同主机降级也会被判为跨源（必须剥：否则凭据走明文）。
    static func origin(of url: URL?) -> String? {
        guard let url, let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return nil }
        let port: Int
        if let p = url.port {
            port = p
        } else if scheme == "https" {
            port = 443
        } else if scheme == "http" {
            port = 80
        } else {
            return nil
        }
        return "\(scheme)://\(host):\(port)"
    }

    /// 目标 origin 是否与原始一致。**取不到 origin 一律判"不同源"**（fail-closed）。
    static func sameOrigin(_ original: String?, _ target: URL?) -> Bool {
        guard let original, !original.isEmpty, let to = origin(of: target) else { return false }
        return original == to
    }

    /// 若本次跳转跨 origin，返回**剥掉凭据头**的新请求；同源则原样返回。
    ///
    /// - Parameters:
    ///   - request: URLSession 给出的下一跳请求（系统已带上上一跳的头）
    ///   - originalUrl: **首跳** URL（`task.originalRequest?.url`）
    static func sanitize(_ request: URLRequest, originalUrl: URL?) -> URLRequest {
        guard !sameOrigin(origin(of: originalUrl), request.url) else { return request }
        var out = request
        for h in credentialHeaders {
            out.setValue(nil, forHTTPHeaderField: h)
        }
        return out
    }
}
