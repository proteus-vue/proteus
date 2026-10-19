// packages/cli/templates-host/ios/shell/JsTaskSampler.swift
// ★★★决策 #1098（2026-10-19）：**P0 长任务观测**（线程治理第一批，纯观测、零行为改动）——iOS 腿。
//
// 【与 Android `JsTaskSampler.java` 同口径】
//   · 阈值 50ms、环形缓冲 64 条、读数 JSON 字段名完全一致（`total/long/maxMs/avgMs/recent/recentP95Ms`）
//     ——否则两端面板读数无法对比（与「三端同构」纪律一致）。
//
// 【★埋点位置的选择（与 Android 略有不同，原因如实说明）】
//   Android 的 JS 执行**唯一入口**是 `QuickJsEngine.eval`（nativeEval 只被它调）⇒ 埋一处覆盖全部。
//   iOS 的 `JSContext.evaluateScript` 是**系统 API**，无法从内部埋点 ⇒ 只能包一层
//   `JsTaskSampler.eval(ctx, source)`，并把壳里的调用点改为走它。
//   ★这条差异本身就是证据：**"统一入口"是平台给的，不是设计能保证的**——
//     iOS 侧如果将来有人直接调 `evaluateScript`，采样就会漏（故注释里登记该边界）。

import Foundation
import JavaScriptCore

enum JsTaskSampler {

    /// 长任务阈值（与 Android 同值）
    static let longTaskMs: Int64 = 50
    /// 环形缓冲容量（固定——观测装置自己不能成为内存问题）
    private static let ringCapacity = 64

    private struct Sample { let label: String; let ms: Int64 }

    private static var enabled = false
    private static var ring: [Sample] = []
    private static var total: Int64 = 0
    private static var longCount: Int64 = 0
    private static var maxMs: Int64 = 0
    private static var totalMs: Int64 = 0
    private static let lock = NSLock()

    static func setEnabled(_ on: Bool) {
        lock.lock(); enabled = on; lock.unlock()
    }

    /// 计时的 eval（**壳里的 JS 调用应走这里**，而不是直接 `ctx.evaluateScript`）。
    @discardableResult
    static func eval(_ ctx: JSContext, _ source: String) -> JSValue? {
        lock.lock()
        let on = enabled
        lock.unlock()
        if !on { return ctx.evaluateScript(source) }
        let t0 = DispatchTime.now().uptimeNanoseconds
        let v = ctx.evaluateScript(source)
        let ms = Int64((DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000)
        record(label: labelOf(source), ms: ms)
        return v
    }

    static func labelOf(_ source: String) -> String {
        let trimmed = source.drop(while: { $0.isWhitespace })
        var head = ""
        for ch in trimmed {
            if ch.isLetter || ch.isNumber || ch == "_" || ch == "$" { head.append(ch) } else { break }
        }
        if head.isEmpty { head = String(trimmed.prefix(40)) }
        return "eval:" + String(head.prefix(40))
    }

    static func record(label: String, ms: Int64) {
        lock.lock()
        total += 1
        totalMs += ms
        if ms > maxMs { maxMs = ms }
        if ms >= longTaskMs {
            longCount += 1
            ring.append(Sample(label: label, ms: ms))
            if ring.count > ringCapacity { ring.removeFirst(ring.count - ringCapacity) }
            NSLog("[proteus-perf] long task %lldms · %@", ms, label)
        }
        lock.unlock()
    }

    /// 读数（JSON 串；字段名与 Android 完全一致）
    static func statsJson() -> String {
        lock.lock()
        let snapshot = ring
        let t = total, l = longCount, mx = maxMs, tm = totalMs
        let on = enabled
        lock.unlock()

        let recent = snapshot.suffix(16).map { ["label": $0.label, "ms": $0.ms] as [String: Any] }
        let sorted = snapshot.map { $0.ms }.sorted()
        let p95: Int64 = sorted.isEmpty ? 0 : sorted[max(0, Int(ceil(Double(sorted.count) * 0.95)) - 1)]
        let obj: [String: Any] = [
            "enabled": on,
            "thresholdMs": longTaskMs,
            "total": t,
            "long": l,
            "maxMs": mx,
            "avgMs": t == 0 ? 0 : Double(tm) / Double(t),
            "recent": recent,
            "recentP95Ms": p95,
            "recentCount": sorted.count,
        ]
        guard let d = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: d, encoding: .utf8) else { return "{}" }
        return s
    }

    static func reset() {
        lock.lock()
        ring.removeAll()
        total = 0; longCount = 0; maxMs = 0; totalMs = 0
        lock.unlock()
    }
}
