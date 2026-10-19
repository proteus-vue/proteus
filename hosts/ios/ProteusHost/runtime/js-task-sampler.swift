// hosts/ios/ProteusHost/runtime/js-task-sampler.swift
// ★★★决策 #1098（2026-10-19）：**P0 长任务观测**（线程治理第一批，纯观测、零行为改动）——iOS 验收宿主腿。
//
// 【为什么验收宿主也要有一份（不是重复实现）】
//   #1098 首版只埋进 CLI 宿主模板（`packages/cli/templates-host/ios/shell/`），而本仓的**真机证据**
//   全部来自 `hosts/ios`（`run-selfdraw.sh --superapp`）。没有这份，iOS 侧就永远拿不到 P0 基线——
//   「模板里有、被测宿主没有」= 只有实现没有证据（#1094 的「做完了但没接上」同族）。
//   ★与模板**同口径**：阈值 50ms、环形 64、9 个 JSON 字段名逐项一致（两侧读数才能对比）。
//
// 【埋点位置的差异（平台给的，不是设计选择）】
//   `JSContext.evaluateScript` 是系统 API ⇒ 无法内部埋点，只能包一层 `JsTaskSampler.eval(ctx, src)`。
//   本文件的**所有** `ctx.evaluateScript` 都必须走它；残留裸调用 = 采样漏（模板侧有静态判据守着）。

import Foundation
import JavaScriptCore

enum JsTaskSampler {
    static let longTaskMs: Int64 = 50
    private static let ringCapacity = 64

    private struct Sample { let label: String; let ms: Int64 }

    private static var enabled = false
    private static var ring: [Sample] = []
    private static var total: Int64 = 0
    private static var longCount: Int64 = 0
    private static var maxMs: Int64 = 0
    private static var totalMs: Int64 = 0
    private static let lock = NSLock()

    static func setEnabled(_ on: Bool) { lock.lock(); enabled = on; lock.unlock() }

    /// 计时的 eval（壳里所有 JS 调用走这里）。
    @discardableResult
    static func eval(_ ctx: JSContext, _ source: String) -> JSValue? {
        lock.lock(); let on = enabled; lock.unlock()
        if !on { return ctx.evaluateScript(source) }
        let t0 = DispatchTime.now().uptimeNanoseconds
        let v = ctx.evaluateScript(source)
        let ms = Int64((DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000)
        record(label: labelOf(source), ms: ms)
        return v
    }

    /// 带 sourceURL 的重载（bundle 装载用；JSC 用它标注堆栈来源）。
    @discardableResult
    static func eval(_ ctx: JSContext, _ source: String, withSourceURL url: URL) -> JSValue? {
        lock.lock(); let on = enabled; lock.unlock()
        if !on { return ctx.evaluateScript(source, withSourceURL: url) }
        let t0 = DispatchTime.now().uptimeNanoseconds
        let v = ctx.evaluateScript(source, withSourceURL: url)
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
        total += 1; totalMs += ms
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
            "enabled": on, "thresholdMs": longTaskMs, "total": t, "long": l,
            "maxMs": mx, "avgMs": t == 0 ? 0 : Double(tm) / Double(t),
            "recent": recent, "recentP95Ms": p95, "recentCount": sorted.count,
        ]
        guard let d = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: d, encoding: .utf8) else { return "{}" }
        return s
    }

    static func reset() {
        lock.lock(); ring.removeAll()
        total = 0; longCount = 0; maxMs = 0; totalMs = 0
        lock.unlock()
    }
}
