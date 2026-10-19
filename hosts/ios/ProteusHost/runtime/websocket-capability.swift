// hosts/ios/ProteusHost/runtime/websocket-capability.swift
// ★★★决策 #1093（2026-10-19）：C27 `useWebSocket` 的 **iOS 宿主实现**（`ws.open` / `ws.send` / `ws.close`）。
//
// 【为什么用 URLSessionWebSocketTask（而不是手写 RFC 6455）】
//   iOS 12+ 提供系统级 WebSocket 客户端，握手/掩码/分片/ping 全由系统处理——没有理由自己再实现一遍
//   （Android 那边手写是因为**平台不提供**且构建不允许引依赖；两端不同实现是**平台事实**，不是不一致）。
//
// 【通道形态（与 Android 完全同形）】
//   · `ws.open` **受理即返** `{ id }`——握手结果推 `__proteusHostWs({id,event:'open'|'error'})`；
//   · `ws.send` / `ws.close` 受理即返；消息与关闭经同一条壳推通道；
//   · ★**所有回推切主线程**（JS 引擎非线程安全，与 keyboard/sensor 同一条纪律）。
//
// 【诚实边界】
//   · `URLSessionWebSocketTask` 在 **wss 失败时**只给 `URLError`，拿不到对端 close code ⇒
//     推 `error` 后再推 `close(1006)`（异常关闭码），**不伪造 1000**。
//   · 分片消息由系统拼接后一次性交付 ⇒ 上层看到的始终是完整消息（与浏览器语义一致）。
//   · 未实现 permessage-deflate 显式协商（系统默认行为）。

import Foundation

/// C27 WebSocket（iOS 宿主腿）。
final class WebSocketCapability: NSObject {

    /// 回推 JS 的通道名（与 `capability-websocket.ts` 的 APP_WS_PUSH_KEY 一致）。
    static let pushKey = "__proteusHostWs"

    /// 壳推出口（由 HostCapabilities 注入——与 sensor/keyboard 同款）。
    var evalJs: ((String) -> String)?

    private let lock = NSLock()
    private var conns: [Int: Conn] = [:]
    private var seq = 0

    /// 诊断读数（判据用）：活跃连接数。
    var activeCount: Int {
        lock.lock(); defer { lock.unlock() }
        return conns.count
    }

    private final class Conn {
        let id: Int
        let task: URLSessionWebSocketTask
        let session: URLSession
        init(id: Int, task: URLSessionWebSocketTask, session: URLSession) {
            self.id = id
            self.task = task
            self.session = session
        }
    }

    // ────────────────────────── 三个宿主方法 ──────────────────────────

    /// `ws.open`：`{ url, protocols? }` → `{ id }`（**受理即返**）
    func open(_ args: [String: Any]) throws -> [String: Any] {
        guard let urlStr = args["url"] as? String, let url = URL(string: urlStr) else {
            throw WsError.unsupported("ws.open 需要合法 url")
        }
        guard let scheme = url.scheme?.lowercased(), scheme == "ws" || scheme == "wss" else {
            throw WsError.invalid("ws.open 只接受 ws:// 或 wss://（收到 \(url.scheme ?? "<nil>")）")
        }
        // ★ws:// → 系统 URLSession 需要 http(s) 的 handshake 变体：URLSessionWebSocketTask
        //   直接吃 ws/wss URL（不需要改写 scheme）。协议头由 URLRequest 传入。
        var req = URLRequest(url: url)
        if let protos = args["protocols"] as? [String], !protos.isEmpty {
            // ★Apple 的 API：`Sec-WebSocket-Protocol` 通过 setValue 传（多个用逗号分隔）
            req.setValue(protos.joined(separator: ", "), forHTTPHeaderField: "Sec-WebSocket-Protocol")
        }
        let session = URLSession(configuration: .default, delegate: nil, delegateQueue: nil)
        let task = session.webSocketTask(with: req)

        lock.lock()
        seq += 1
        let id = seq
        conns[id] = Conn(id: id, task: task, session: session)
        lock.unlock()

        task.resume()
        // ★受理即返：连接结果经推到达（与 Android 的 NET.execute + 推 open 同形）
        receive(id: id, task: task)
        push(["id": id, "event": "open"])
        return ["id": id]
    }

    /// `ws.send`：`{ id, data?, binary?, binaryFlag? }` → `{}`（受理即返）
    func send(_ args: [String: Any]) throws -> [String: Any] {
        let id = args["id"] as? Int ?? 0
        guard let c = conn(id: id) else { return ["note": "连接 \(id) 不存在（已关闭？）"] }
        if (args["binaryFlag"] as? Bool) == true, let arr = args["binary"] as? [Int] {
            let data = Data(arr.map { UInt8(truncatingIfNeeded: $0) })
            c.task.send(.data(data)) { [weak self] err in
                if let err = err { self?.push(["id": id, "event": "error", "message": "发送失败：\(err.localizedDescription)"]) }
            }
        } else {
            let text = args["data"] as? String ?? ""
            c.task.send(.string(text)) { [weak self] err in
                if let err = err { self?.push(["id": id, "event": "error", "message": "发送失败：\(err.localizedDescription)"]) }
            }
        }
        return [:]
    }

    /// `ws.close`：`{ id, code?, reason? }` → `{}`（受理即返）
    func close(_ args: [String: Any]) throws -> [String: Any] {
        let id = args["id"] as? Int ?? 0
        guard let c = conn(id: id) else { return ["note": "连接 \(id) 不存在（已关闭？）"] }
        let code = args["code"] as? Int ?? 1000
        let reason = (args["reason"] as? String) ?? ""
        let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure
        c.task.cancel(with: closeCode, reason: reason.data(using: .utf8))
        drop(id: id)
        push(["id": id, "event": "close", "code": code, "reason": reason])
        return [:]
    }

    // ────────────────────────── 读循环 ──────────────────────────

    private func receive(id: Int, task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let msg):
                switch msg {
                case .string(let s):
                    self.push(["id": id, "event": "message", "data": s])
                case .data(let d):
                    self.push(["id": id, "event": "message", "binary": d.map { Int($0) }])
                @unknown default:
                    break
                }
                // ★继续收下一条（系统已处理分片拼接）
                if self.conn(id: id) != nil { self.receive(id: id, task: task) }
            case .failure(let err):
                // ★拿不到对端 close code（系统 API 限制）⇒ 如实推 1006 异常关闭，不伪造 1000
                self.push(["id": id, "event": "error", "message": err.localizedDescription])
                self.drop(id: id)
                self.push(["id": id, "event": "close", "code": 1006, "reason": err.localizedDescription])
            }
        }
    }

    // ────────────────────────── 内部 ──────────────────────────

    private func conn(id: Int) -> Conn? {
        lock.lock(); defer { lock.unlock() }
        return conns[id]
    }

    private func drop(id: Int) {
        lock.lock()
        let c = conns.removeValue(forKey: id)
        lock.unlock()
        c?.session.invalidateAndCancel()
    }

    /// 把一条事件推给 JS（**切主线程**——JS 引擎非线程安全）。
    private func push(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        let expr = "typeof \(Self.pushKey)==='function'?\(Self.pushKey)(\(jsQuote(json))):'no-hook'"
        if Thread.isMainThread {
            _ = evalJs?(expr)
        } else {
            DispatchQueue.main.async { [weak self] in _ = self?.evalJs?(expr) }
        }
    }

    /// JSON 串转成 JS 字符串字面量（转义引号/反斜杠/换行——与 keyboard/sensor 同款）。
    private func jsQuote(_ s: String) -> String {
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
}

/// 本能力的错误（`unsupported` = 本端做不了；`invalid` = 参数非法 ⇒ `failed`）。
enum WsError: Error {
    case unsupported(String)
    case invalid(String)
}
extension WsError {
    var message: String {
        switch self {
        case .unsupported(let m), .invalid(let m): return m
        }
    }
}
