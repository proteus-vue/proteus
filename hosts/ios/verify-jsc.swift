// hosts/ios/verify-jsc.swift —— JS 侧验证器（真实 JavaScriptCore 宿主桩）
//
// 【它是什么】一个**宿主替身**：注册与 iOS 宿主同名的 JSExport 桥（proteusNative），
//   在 macOS 上用 JavaScriptCore 执行同一份 iOS bundle，并把三层事实打到 stdout：
//     · CALL …        —— 桥调用序列（证「视图操作同步发生」）
//     · SUMMARY=…     —— JS 侧自报（backendId / traceCount）
//     · SNAPSHOT_…    —— 宿主侧最终视图树（证「JS 语义树 → 宿主对象树」逐节点对得上）
//
// 【为什么不是「直接跑 iOS 模拟器」】模拟器 runtime 是几个 GB 的可选项，且 GUI 证据无法进 CI。
//   本验证器与 iOS 宿主**共用同一份 bundle、同一个桥契约**，差异仅在视图对象（HostView vs UIView）——
//   即：链路正确性在这里证明，UIView 的最终外观在模拟器里人工确认（两者互补，缺一不可）。
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

/// 宿主视图替身（字段与 iOS 宿主 UIKit 版承载的属性一一对应）
final class HostView {
    let id: Int
    let type: String
    var children: [HostView] = []
    weak var parent: HostView?
    var text: String?
    var backgroundColor: String?
    var textColor: String?
    var fontSize: Double?
    var cornerRadius: Double?
    var height: Double?
    init(id: Int, type: String) { self.id = id; self.type = type }
}

func parseColor(_ raw: Any?) -> String? {
    guard let s = raw as? String, s.hasPrefix("#") else { return nil }
    var hex = String(s.dropFirst())
    if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
    guard hex.count == 6, UInt32(hex, radix: 16) != nil else { return nil }
    return "#" + hex.uppercased()
}
func parsePx(_ raw: Any?) -> Double? {
    guard let s = raw as? String else { return nil }
    return Double(s.replacingOccurrences(of: "px", with: ""))
}

final class Bridge: NSObject, ProteusNativeExports {
    private var views: [Int: HostView] = [:]
    private var bags: [Int: [String: Any]] = [:]
    private var nextId = 1
    var summary = "{}"

    func createView(_ type: String, _ propsJson: String) -> Int {
        let id = nextId; nextId += 1
        let v = HostView(id: id, type: type)
        views[id] = v
        var bag = (try? JSONSerialization.jsonObject(with: Data(propsJson.utf8)) as? [String: Any]) ?? [:]
        if let nested = bag["style"] as? [String: Any] { for (k, val) in nested { bag[k] = val } }
        bags[id] = bag
        apply(id)
        print("CALL createView #\(id) \(type)")
        return id
    }
    func updateView(_ handle: Int, _ key: String, _ valueJson: String) {
        let parsed = try? JSONSerialization.jsonObject(with: Data(valueJson.utf8), options: [.fragmentsAllowed])
        if key == "style", let d = parsed as? [String: Any] { for (k, v) in d { bags[handle]?[k] = v } }
        else { bags[handle]?[key] = parsed ?? NSNull() }
        apply(handle)
        print("CALL updateView #\(handle) \(key)")
    }
    func insertView(_ child: Int, _ parent: Int, _ anchor: Int) {
        guard let c = views[child], let p = views[parent] else { return }
        c.parent = p
        if anchor >= 0, let a = views[anchor], let idx = p.children.firstIndex(where: { $0 === a }) {
            p.children.insert(c, at: idx)
        } else { p.children.append(c) }
        print("CALL insertView child=#\(child) parent=#\(parent)")
    }
    func removeView(_ handle: Int) {
        if let p = views[handle]?.parent { p.children.removeAll { $0.id == handle } }
        views[handle] = nil; bags[handle] = nil
        print("CALL removeView #\(handle)")
    }
    func setViewText(_ handle: Int, _ text: String) {
        views[handle]?.text = text
        print("CALL setViewText #\(handle)")
    }
    func ready(_ summaryJson: String) { summary = summaryJson; print("CALL ready") }

    private func apply(_ id: Int) {
        guard let v = views[id], let d = bags[id] else { return }
        if let c = parseColor(d["backgroundColor"]) { v.backgroundColor = c }
        if let c = parseColor(d["color"]) { v.textColor = c }
        if let f = parsePx(d["fontSize"]) { v.fontSize = f }
        if let r = parsePx(d["borderRadius"]) { v.cornerRadius = r }
        if let h = parsePx(d["height"]) { v.height = h }
    }

    func snapshot() -> [String: Any] {
        func node(_ v: HostView) -> [String: Any] {
            var o: [String: Any] = ["id": v.id, "type": v.type, "children": v.children.map { node($0) }]
            if let t = v.text { o["text"] = t }
            if let c = v.backgroundColor { o["backgroundColor"] = c }
            if let c = v.textColor { o["textColor"] = c }
            if let f = v.fontSize { o["fontSize"] = f }
            if let r = v.cornerRadius { o["cornerRadius"] = r }
            if let h = v.height { o["height"] = h }
            return o
        }
        // ★根 = 无父节点的视图（JS 侧创建的根容器）
        let roots = views.values.filter { $0.parent == nil }.sorted { $0.id < $1.id }
        return ["totalViews": views.count, "topLevel": roots.map { node($0) }]
    }
}

let bundlePath = CommandLine.arguments[1]
let src = try! String(contentsOfFile: bundlePath, encoding: .utf8)
let ctx = JSContext()!
let bridge = Bridge()
ctx.setObject(bridge, forKeyedSubscript: "proteusNative" as NSString)
ctx.exceptionHandler = { _, e in print("JS EXCEPTION \(String(describing: e))") }
ctx.evaluateScript(src)
print("SUMMARY=\(bridge.summary)")
if let data = try? JSONSerialization.data(withJSONObject: bridge.snapshot(), options: [.prettyPrinted, .sortedKeys]),
   let s = String(data: data, encoding: .utf8) {
    print("SNAPSHOT_BEGIN")
    print(s)
    print("SNAPSHOT_END")
}
