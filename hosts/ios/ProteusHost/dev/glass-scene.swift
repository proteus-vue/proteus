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
//   ★决策 #873：`--glass-demo` = **常驻可拖拽演示**（对齐 Android `GlassActivity` / 鸿蒙 `glass-demo`）
//   ——挂载后常驻，手指拖拽滚动看玻璃动态折射；区别于 `--glass`（截图即自退的夹具）。
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

    static func run(ctx: JSContext, view: UIView?, bridge: SelfDrawBridge, bench: Bool, demo: Bool = false) {
        // ★决策 #862：基准模式开**内容滚动范围钳制**（与 Android/Harmony 夹具同口径；内容页"装不下才滚"）
        //   ——mount 前设，否则滚动无界、内容被滚出屏（截图黑屏）。
        // ★决策 #873：**演示模式（`--glass-demo`）**同样开钳制——对齐 Android `GlassActivity` / 鸿蒙
        //   `glass-demo`：常驻 + **手指拖拽滚动**（宿主的 `UIPanGestureRecognizer` 已装在视图上），
        //   玻璃为 fixed 节点钉在屏上、内容在其下滑过。此前 `--glass` 只截图即自退（夹具），
        //   三端"同形"里 iOS 缺的正是这个可上手的演示形态。
        if bench || demo { SelfDrawBridge.contentScrollRangeEnabled = true }
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

        // ★★★决策 #873：**演示模式（`--glass-demo`）**——挂载后**常驻**，不截图、不自退。
        //   对齐 Android `GlassActivity`（可手动拖拽滚动）/ 鸿蒙 `glass-demo`：用户可在设备上
        //   手指拖拽内容、观察玻璃（fixed 节点）随内容滑过的动态折射（真 UIPanGestureRecognizer，
        //   见 selfdraw-scene.swift init 的手势接线）。
        if demo {
            NSLog("[proteus] 玻璃演示已挂载（常驻·手指拖拽滚动）GLASS_DEMO_READY mount_ok=%@",
                  String(describing: report["mount_ok"] ?? "?"))
            return
        }

        // ★★★决策 #862：**性能基线模式**（`--glass-bench`）——挂载后跑程序化滚动基准（异步，CADisplayLink 驱动）。
        //   与 Android `GlassActivity --ez bench` / 鸿蒙 `glass-bench` 同口径（真 vsync 间隔）。
        if bench {
            bridge.glassBenchPhaseDone = {
                DispatchQueue.main.async {
                    let benchJson = bridge.glassBenchResults()
                    if let bd = benchJson.data(using: .utf8),
                       let bo = (try? JSONSerialization.jsonObject(with: bd)) as? [String: Any] {
                        report["bench"] = bo
                    }
                    report["snapshot_after"] = snapshot(ctx, "glass-ios-bench")
                    writeReport(report)
                    NSLog("[proteus] GLASS_BENCH_READY %@", benchJson)
                    if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
                }
            }
            _ = bridge.glassBenchStart("{\"frames\":160,\"step\":6}")
            return
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
            //   ★★★决策 #873 修：**必须 `flexShrink: 0`**——否则列向 flex 容器（node 1）空间不足时，
            //   24 行会被内核**收缩到塞进视口**（默认 flex-shrink=1）⇒ 内容高 ≈ 视口高 ⇒ 滚动范围≈0
            //   ⇒ 开了钳制后"页面无法滚动"（用户实测）。Android `GlassActivity` 用**绝对 y 定位**
            //   （非 flex）故无此问题；此处对齐其"每行固定高、内容可溢出"语义。
            nodes.append(["id": id, "parentId": 1, "height": rowH, "widthRatio": 1, "flexShrink": 0,
                          "backgroundColor": color, "display": "flex", "flexDirection": "column",
                          "justifyContent": "center", "padding": ["left": 20, "right": 20]])
            let rowId = id; id += 1
            // 行内文本（内容可辨判据：滚动时文字滑过玻璃）
            nodes.append(["id": id, "parentId": rowId, "text": "Row \(i + 1) 内容行滑过玻璃", "fontSize": 22,
                          "color": "#ffffff", "fontWeight": 700])
            id += 1
        }
        // 玻璃节点（★ position:fixed ⇒ 钉在屏上；滚动时内容滑过）
        // ★★★决策 #864：**物理尺寸对齐 Android 夹具**（同形原则）——此前 iOS 圆 130pt(=390px)、
        //   胶囊 84pt 高，比 Android（圆 900px、胶囊 116px）小 2.3 倍 ⇒ 相对模糊偏大 ⇒ 25 抽摊太开
        //   ⇒ 文字重影。对齐后模糊核相对盒子与 Android 同（blur 现为**物理 px**，见 glass-metal.swift）。
        // ① 胶囊 pill（类 tab 栏）：底部（= Android pillH 116px→39pt、宽 W−36*3px→354pt）
        nodes.append(["id": id, "parentId": 0, "position": "fixed", "left": 18, "top": 770,
                      "width": 354, "height": 39, "borderRadius": 20,
                      "glass": ["blur": 20, "tint": "#ffffff26", "radius": 20, "border": true,
                                "saturation": 1.0, "level": "L2"]])
        id += 1
        // ② 圆形 circle：中上（= Android circ 300*U=900px→300pt、blur 16）
        nodes.append(["id": id, "parentId": 0, "position": "fixed", "left": 45, "top": 95,
                      "width": 300, "height": 300, "borderRadius": 150,
                      "glass": ["blur": 16, "tint": "#ffffff26", "radius": 150, "border": true,
                                "saturation": 1.0, "level": "L2"]])
        id += 1
        // ★B4 前景材质验证（决策 #834）：gradient / glow / mask 各一块（固定位，验内核单源渲染）
        // ① 渐变砖（45° 线性——验 CSS 端点式；固定左上）
        nodes.append(["id": id, "parentId": 0, "position": "fixed", "left": 16, "top": 96,
                      "width": 120, "height": 80, "borderRadius": 8,
                      "fillGradient": ["kind": "linear", "angle": 45.0,
                                       "stops": [["offset": 0.0, "color": "#ff5a3c"],
                                                 ["offset": 1.0, "color": "#3c78ff"]]]])
        id += 1
        // ② 发光块（glow——验分层曲线；固定右上）
        nodes.append(["id": id, "parentId": 0, "position": "fixed", "left": 270, "top": 96,
                      "width": 96, "height": 60, "borderRadius": 12, "backgroundColor": "#20b0c0",
                      "glow": ["color": "#66ffcc", "radius": 18.0, "alpha": 0.9]])
        id += 1
        // ③ 软边遮罩块（mask——验揭示色标单源；固定中部偏下）
        nodes.append(["id": id, "parentId": 0, "position": "fixed", "left": 200, "top": 380,
                      "width": 150, "height": 90, "backgroundColor": "#c83c78",
                      "mask": ["kind": "linear", "angle": 90.0, "softness": 0.5, "progress": 0.5]])
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
