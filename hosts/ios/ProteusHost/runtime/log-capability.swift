// hosts/ios/ProteusHost/runtime/log-capability.swift
// ★★★#1225 App 能力批 1 第 2 项：`log` —— 三端日志通路的宿主实现（iOS 侧）。
//
// 【语义对齐 Android 的 LogCapability】`{level: log|warn|error, message, data?}` →
//   `os_log`（`Logger`）+ 控制台。级别非法 / 缺 message ⇒ 返错（**不静默记空日志**）。
//
// 【为什么单独成文件】`host-capabilities.swift` 的分派体已贴棘轮基线 ⇒ 能力实现落独立文件，
//   分派处只加一个 case（决策 #870 三层范式）。
import Foundation
import os.log

enum LogCapability {
    private static let logger = Logger(subsystem: "dev.proteus.host", category: "proteus-log")

    /// 写一条日志；返回 `{written, level, bytes}`（bytes 供判据核对"真的到了宿主"）。
    /// - Throws: `LogCapabilityError`（level 非法 / 缺 message）——由分派层映射成 `ok:false`
    static func write(_ args: [String: Any]) throws -> [String: Any] {
        let level = (args["level"] as? String) ?? "log"
        guard let message = args["message"] as? String else {
            throw LogCapabilityError.invalid("log: 缺少 message")
        }
        var line = message
        if let data = args["data"], !(data is NSNull) {
            if let s = data as? String { line += " " + s }
            else if JSONSerialization.isValidJSONObject(data),
                    let d = try? JSONSerialization.data(withJSONObject: data),
                    let s = String(data: d, encoding: .utf8) { line += " " + s }
            else { line += " " + String(describing: data) }
        }
        switch level {
        case "log", "info":   logger.info("\(line, privacy: .public)")
        case "warn":  logger.warning("\(line, privacy: .public)")
        case "error": logger.error("\(line, privacy: .public)")
        default: throw LogCapabilityError.invalid("log: 未知 level「\(level)」（仅 log / info / warn / error）")
        }
        return ["written": true, "level": level, "bytes": line.count]
    }

    enum LogCapabilityError: Error, CustomStringConvertible {
        case invalid(String)
        var description: String {
            switch self { case .invalid(let m): return m }
        }
    }
}
