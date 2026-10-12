// hosts/ios/ProteusHost/dev/glass-scene.swift
// ★★★玻璃真机夹具（iOS 腿 · 决策 #833）——`--glass` 模式
//
// 【与 Android 腿的关系（同一能力两壳）】Android 用 `dev/GlassActivity`（手写 Cmd + AGSL 玻璃遍）；
//   本文件用 iOS 自绘链路（手写渲染树 → Rust 内核算几何 → CALayer 树 → CoreImage 玻璃遍）。
//   两者同模型（边缘倒角厚板），产物同形（截图 + 报告），便于跨端并排。
//
// 【验什么】① 玻璃材质**真出图**（`glass_faces>0`，非降级跳过）；② 内容可见（磨砂但可辨）；
//   ③ 滚动时**玻璃钉住、内容滑过**（决策 #831/#832 的核心观感——夹具做成可滚页面）。
//
// 【运行】bash hosts/ios/run-selfdraw.sh --glass（真机；模拟器见 run-selfdraw-sim.sh 帮助）
import Foundation
import JavaScriptCore
import UIKit

/// 玻璃夹具场景（`--glass` 启动参数进入）
final class GlassScene: NSObject {

    /// N 行彩色内容（与 Android `GlassActivity` 同量级——足够长以"滑过玻璃"）。
    private static let rowCount = 24
    private static let rowH = 96
    private static let rowColors = ["#e0483c", "#3cc86a", "#3c78e0", "#e0c83c", "#b448c8",
                                    "#38c0c0", "#e07830", "#7850d0"]

    static func run(ctx: JSContext, view: UIView?) {
        // ① 手写渲染树：root(flex column) → rows(内容) + 两块 fixed 玻璃（钉在屏上）
        let tree = buildTree()
        guard let td = try? JSONSerialization.data(withJSONObject: tree),
              let treeJson = String(data: td, encoding: .utf8) else {
            writeReport(["ok": false, "fatal": "渲染树序列化失败"])
            return
        }
        ctx.setObject(treeJson as NSString, forKeyedSubscript: "__glassTree" as NSString)

        // ② 挂载（内核算几何 → 建 CALayer 树 → 玻璃遍）
        let mountOut = ctx.evaluateScript("proteusSelfDraw.mount(__glassTree)")?.toString() ?? "null"
        var report: [String: Any] = ["ok": true, "tree_bytes": treeJson.count,
                                     "host_id": "ios", "run_ts": Int(Date().timeIntervalSince1970)]
        if let d = mountOut.data(using: .utf8), let m = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            for k in ["glass_nodes", "glass_faces", "node_count", "layer_count", "host_total_ms"] {
                if let v = m[k] { report[k] = v }
            }
            report["mount_ok"] = (m["ok"] as? Bool) ?? false
        } else {
            report["mount_raw"] = mountOut
        }

        // ③ 截图 A：滚动前（应见玻璃面 + 内容透出）
        let beforePath = snapshot(ctx, "glass-ios")
        report["snapshot_before"] = beforePath.isEmpty ? "" : (beforePath as NSString).lastPathComponent

        // ④ 滚动一步（夹具"内容滑过玻璃"——玻璃应钉住不动，采样内容刷新）
        let scrollOut = ctx.evaluateScript("proteusSelfDraw.scrollAnimSync('{\"dx\":0,\"dy\":220}')")?.toString() ?? "null"
        report["scroll_raw"] = scrollOut

        // ⑤ 截图 B：滚动后（玻璃位置应不变、背后内容换行）
        let afterPath = snapshot(ctx, "glass-ios-scrolled")
        report["snapshot_after"] = afterPath.isEmpty ? "" : (afterPath as NSString).lastPathComponent

        writeReport(report)
        NSLog("[proteus] GLASS_REPORT_READY faces=%@ nodes=%@",
              String(describing: report["glass_faces"] ?? "?"), String(describing: report["glass_nodes"] ?? "?"))
        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
    }

    // ── 渲染树（手写，与 Android GlassActivity 同布局意图）──

    private static func buildTree() -> [String: Any] {
        var nodes: [[String: Any]] = []
        // 根：纵向铺满
        nodes.append(["id": 0, "parentId": NSNull(), "semantic": "app-root", "display": "flex",
                      "flexDirection": "column", "alignItems": "stretch", "position": "relative",
                      "widthRatio": 1, "heightRatio": 1, "backgroundColor": "#101018"])
        // 内容容器（纵向，固定行高叠成长页）
        nodes.append(["id": 1, "parentId": 0, "display": "flex", "flexDirection": "column",
                      "widthRatio": 1, "backgroundColor": "#101018"])
        var id = 2
        for i in 0..<rowCount {
            let color = rowColors[i % rowColors.count]
            // 行盒（高度 rowH）
            nodes.append(["id": id, "parentId": 1, "height": rowH, "widthRatio": 1,
                          "backgroundColor": color, "display": "flex", "flexDirection": "column",
                          "justifyContent": "center", "padding": ["left": 20, "right": 20]])
            let rowId = id; id += 1
            // 行内文本（内容可辨判据：滚动时文字滑过玻璃）
            nodes.append(["id": id, "parentId": rowId, "text": "Row \(i + 1) 内容行滑过玻璃", "fontSize": 22,
                          "color": "#ffffff", "fontWeight": 700])
            id += 1
        }
        // 玻璃节点（★ position:fixed ⇒ 钉在屏上；滚动时内容滑过）
        // ① 胶囊 pill（类 tab 栏）：底部
        nodes.append(["id": id, "parentId": 0, "position": "fixed", "left": 24, "top": 620,
                      "width": 342, "height": 84, "borderRadius": 42,
                      "glass": ["blur": 20, "tint": "#ffffff26", "radius": 42, "border": true,
                                "saturation": 1.0, "level": "L2"]])
        id += 1
        // ② 圆形 circle：中上（圆曲率均匀，折射"卷边"最明显——决策 #831 教训）
        nodes.append(["id": id, "parentId": 0, "position": "fixed", "left": 130, "top": 200,
                      "width": 130, "height": 130, "borderRadius": 65,
                      "glass": ["blur": 16, "tint": "#ffffff26", "radius": 65, "border": true,
                                "saturation": 1.0, "level": "L2"]])
        return ["viewport": ["width": 390, "height": 844], "nodes": nodes]
    }

    // ── 产物 ──

    private static func snapshot(_ ctx: JSContext, _ name: String) -> String {
        // ★桥的 `snapshot` 以宿主注入的 `SelfDrawBridge.snapshotName` 为准 ⇒ 每张前改它
        //   （否则两次都写成同一个 selfdraw-final.png，第二张覆盖第一张）。
        SelfDrawBridge.snapshotName = name
        let r = ctx.evaluateScript("proteusSelfDraw.snapshot('\(name)')")?.toString() ?? "null"
        guard let d = r.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              (o["ok"] as? Bool) == true else { return "" }
        return (o["path"] as? String) ?? ""
    }

    private static func writeReport(_ obj: [String: Any]) {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        if let d = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]) {
            try? d.write(to: dir.appendingPathComponent("glass-ios.json"))
        }
    }
}
