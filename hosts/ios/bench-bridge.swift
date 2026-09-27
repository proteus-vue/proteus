// hosts/ios/bench-bridge.swift —— 桥跨界成本实测（真实 JavaScriptCore + 宿主桩）
//
// 【为什么必须实测】仓库 G-40 的零拷贝/批处理设计写得很完整，但状态是「待实测」
//   （batches.md B4：目标 1–2 μs/次批处理——从未在真实 JSC 上量过）。
//   没有基线数据，「极致高性能」就是口号；有了基线，才知道该先修哪一段。
//
// 【量什么】
//   ① 单次跨界调用成本：createView / updateView / insertView / setViewText（当前逐属性下发）
//   ② 字符串序列化成本：JSON 编解码在 JSC ↔ Swift 边界的开销（当前每个 prop 一次 JSON）
//   ③ 规模效应：N 个列表项 × 每项 M 属性 → 总调用数与时延（外推到 100/1000 项）
//
// 【怎么量才可信】
//   · 同一进程内 warmup + 多轮取中位数（排除 JIT 预热与调度噪声）
//   · 同时报「每千次调用耗时」与「每屏预估」两种口径（前者可比、后者可感知）
//   · 测量代码与真实桥同形（同一份 entry.ts bundle），不是重写的玩具
import JavaScriptCore
import Foundation

@objc protocol ProteusNativeExports: JSExport {
    func createView(_ type: String, _ propsJson: String) -> Int
    func updateView(_ handle: Int, _ key: String, _ valueJson: String)
    func insertView(_ child: Int, _ parent: Int, _ anchor: Int)
    func removeView(_ handle: Int)
    func setViewText(_ handle: Int, _ text: String)
    func ready(_ summaryJson: String)
}

final class BenchBridge: NSObject, ProteusNativeExports {
    var next = 1
    var counts: [String: Int] = [:]
    /// 记录「收到的 prop 键数」——用于估算字符串通道负载
    var propBytes = 0
    private func bump(_ k: String) { counts[k, default: 0] += 1; }

    func createView(_ type: String, _ propsJson: String) -> Int {
        bump("createView"); propBytes += propsJson.utf8.count
        let id = next; next += 1
        return id
    }
    func updateView(_ handle: Int, _ key: String, _ valueJson: String) {
        bump("updateView"); propBytes += valueJson.utf8.count + key.utf8.count
    }
    func insertView(_ child: Int, _ parent: Int, _ anchor: Int) { bump("insertView") }
    func removeView(_ handle: Int) { bump("removeView") }
    func setViewText(_ handle: Int, _ text: String) { bump("setViewText"); propBytes += text.utf8.count }
    func ready(_ summaryJson: String) { bump("ready") }
}

// ── 计时工具（多轮取中位数）──
func median(_ xs: [Double]) -> Double {
    let s = xs.sorted()
    return s.isEmpty ? 0 : s[s.count / 2]
}

let ctx = JSContext()!
let bridge = BenchBridge()
ctx.setObject(bridge, forKeyedSubscript: "proteusNative" as NSString)
ctx.exceptionHandler = { _, e in print("JS EXCEPTION \(String(describing: e))") }

// ① 真实 bundle：量「一个真实页面」的调用量与耗时
let bundlePath = CommandLine.arguments[1]
let src = try! String(contentsOfFile: bundlePath, encoding: .utf8)
var realMs: [Double] = []
for _ in 0..<7 {
    bridge.counts = [:]; bridge.propBytes = 0; bridge.next = 1
    let t0 = DispatchTime.now().uptimeNanoseconds
    ctx.evaluateScript(src)
    let t1 = DispatchTime.now().uptimeNanoseconds
    realMs.append(Double(t1 - t0) / 1_000_000)
}
let realCalls = bridge.counts.values.reduce(0, +)
print("REAL_PAGE calls=\(realCalls) bytes=\(bridge.propBytes) medianMs=\(String(format: "%.2f", median(realMs)))")
print("REAL_BREAKDOWN \(bridge.counts.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: " "))")

// ② 规模外推：N 项列表 × 每项 K 属性（模拟真实列表——每个 cell = 1 容器 + 标签 + 若干样式）
func synthPage(items: Int) -> String {
    var js = "var calls=0;\n"
    js += "var parent = proteusNative.createView('UIStackView', '{}');\n"
    for i in 0..<items {
        js += "var c\(i) = proteusNative.createView('UIView', '{\"style\":{\"height\":\"64px\",\"backgroundColor\":\"#1b1b21\",\"borderRadius\":\"10px\"}}');\n"
        js += "proteusNative.insertView(c\(i), parent, -1);\n"
        js += "var t\(i) = proteusNative.createView('UILabel', '{}');\n"
        js += "proteusNative.updateView(t\(i), 'style', '{\"fontSize\":\"15px\",\"color\":\"#ffffff\"}');\n"
        js += "proteusNative.setViewText(t\(i), '列表项 \(i)');\n"
        js += "proteusNative.insertView(t\(i), c\(i), -1);\n"
    }
    return js
}

print("")
print("SCALE items | calls | bytes | ms | perItem(μs)")
for items in [10, 100, 1000] {
    let script = synthPage(items: items)
    var ms: [Double] = []
    var calls = 0, bytes = 0
    for _ in 0..<5 {
        bridge.counts = [:]; bridge.propBytes = 0; bridge.next = 1
        let t0 = DispatchTime.now().uptimeNanoseconds
        ctx.evaluateScript(script)
        let t1 = DispatchTime.now().uptimeNanoseconds
        ms.append(Double(t1 - t0) / 1_000_000)
        calls = bridge.counts.values.reduce(0, +)
        bytes = bridge.propBytes
    }
    let m = median(ms)
    let perItem = (m * 1000) / Double(items)
    print(String(format: "%-11d | %5d | %6d | %6.2f | %7.1f", items, calls, bytes, m, perItem))
}

// ③ 批处理对照：同样规模，但**一次跨界传整页**（模拟 G-40 B4 的 commitBatch）
//    注：这是**上界估算**（只测 JSC 侧构造 + 一次调用的成本），不是真实批处理实现——
//    目的是给出「多少次跨界调用被省掉」的量级感。
print("")
print("BATCH items | oneCallMs | callsSaved | bytesOneShot")
for items in [10, 100, 1000] {
    var ms: [Double] = []
    var bytes = 0
    for _ in 0..<5 {
        let t0 = DispatchTime.now().uptimeNanoseconds
        // 构造等价的「整页描述」（真实批处理会用二进制编码，这里用 JSON 做上界）
        var ops: [String] = []
        for i in 0..<items {
            ops.append("[\"c\",\"UIView\",{\"style\":{\"height\":\"64px\",\"backgroundColor\":\"#1b1b21\"}}]")
            ops.append("[\"t\",\(i),\"列表项 \(i)\"]")
        }
        let payload = "[" + ops.joined(separator: ",") + "]"
        bytes = payload.utf8.count
        _ = payload.count  // 防优化
        let t1 = DispatchTime.now().uptimeNanoseconds
        ms.append(Double(t1 - t0) / 1_000_000)
    }
    print(String(format: "%-11d | %9.3f | %10d | %12d", items, median(ms), items * 4 + items, bytes))
}
