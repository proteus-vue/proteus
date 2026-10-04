// hosts/ios/ProteusHost/app-stack-scene.swift
// ★★M5 执行器场景（iOS 腿）—— `--app-stack` 模式
//
// 【与 Android 腿的关系（同一份 TS、两个壳）】JS 侧是 `hosts/shared/bridge/entry-app-stack.ts`
//   （平台中立；2026-09-30 从 android 目录提到 shared，两壳共用）。本文件是壳：
//   装宿主桥（含 ScreenHost）→ 跑主场景（栈读数）→ 跑执行器两相 → **非阻塞轮询** →
//   写两份报告（`app-stack.json` + `app-stack-executor.json`，与 Android 同名同形）。
//
// 【★为什么必须非阻塞（与 Android 腿同一教训的第三次应用）】
//   执行器的动画完成由**宿主帧循环**（iOS: CADisplayLink）驱动，而帧循环与 JSC 都在主线程
//   ⇒ 场景里**不能**同步等待（`DispatchQueue.main.sync` 或 sleep 会把帧循环饿死 = 死锁）。
//   ⇒ 形态：kick 之后用 `DispatchQueue.main.asyncAfter` 链轮询（每轮让出主线程），
//     有界 10s，到时如实写 `{"pending":true,"timeout":true}`。
//
// 【完成回推链（与 Android 同构）】ScreenHost 的 CADisplayLink 回调里 tick 内核动画，
//   到点 → `ScreenHost.evalJs("__proteusHostScreenAnimDone(token)")` —— JSC 的 evaluateScript
//   返回时会排空微任务 ⇒ JS 侧 `await ePorts.anim.playRouteTransition(...)` 的续体接着跑
//   （下一段导航继续）。这条链是"宿主拥有帧循环"在 iOS 上的解。

import Foundation
import JavaScriptCore
import UIKit

/// M5 执行器场景（`--app-stack` 启动参数进入）
final class AppStackScene: NSObject {
    private static var evalJs: ((String) -> String)?
    private static var reportDir: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

    static func run(ctx: JSContext, bundleURL: URL) {
        evalJs = { expr in ctx.evaluateScript(expr)?.toString() ?? "null" }

        // ① 平台参数（TS 侧读它们自报标识——两壳同契约）
        _ = ctx.evaluateScript("var __PROTEUS_HOST_ID__ = 'ios';")
        _ = ctx.evaluateScript("var __PROTEUS_HOST_FRAME_DRIVER__ = 'CADisplayLink';")

        // ② 宿主桥（含 ScreenHost——屏幕树操作 + 帧循环动画）
        ScreenHost.evalJs = { expr in evalJs?(expr) ?? "null" }
        ctx.setObject(HostRuntimeBridge(), forKeyedSubscript: "proteusHost" as NSString)

        // ③ 加载 bundle（JSC 无模块系统——IIFE 整份 evaluate）
        guard let src = try? String(contentsOf: bundleURL, encoding: .utf8) else {
            NSLog("[proteus] 读 bundle-app-stack.js 失败：%@", bundleURL.path)
            writeJson("app-stack.json", fatal: "bundle 读失败")
            return
        }
        _ = ctx.evaluateScript(src, withSourceURL: bundleURL)

        // ④ 主场景（同步：栈读数 A–D）
        let mainOut = evalJs?("__proteusAppStackRun('{\"depth\":20000,\"fans\":32,\"budget\":1000}')") ?? "null"
        // ★★★（2026-10-02 · 项目驱动落地）第二入口：**从项目路由配置跑 App 导航**（非夹具）
        //   与 A–D 的分界：那些用合成屏池（压测装置）；本入口读
        //   `examples/router/auto-routes.ts`（全端统一导航产物：gen-routes 从 pages/**/*.vue + router.pages 产出）
        //   ⇒ "项目配置 → App 屏注册表 → 导航语义"这条**产品路径**在 JSC 侧同样可跑。
        //   读数以 `p_` 前缀并入主报告（与 Android 腿**同名同形**——同一份判据脚本读）。
        var merged: [String: Any] = [:]
        if let d = mainOut.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            merged = o
        }
        let projOut = evalJs?("__proteusAppProjectRun('{\"steps\":3}')") ?? "null"
        if let pd = projOut.data(using: .utf8), let po = (try? JSONSerialization.jsonObject(with: pd)) as? [String: Any] {
            for (k, v) in po { merged["p_\(k)"] = v }
            // ★★两端字段名统一（本仓实测踩到：iOS 产出 `p_ok` 而判据读 `p_run_ok` ⇒ 误报"旧 bundle"）：
            //   入口返回的 `ok` 在 Android 侧被宿主单独放进 `p_run_ok`，iOS 侧经前缀变成 `p_ok`
            //   ⇒ 这里显式补别名，两端同名同形（判据一份脚本读两端）。
            merged["p_run_ok"] = po["ok"] ?? false
        } else {
            merged["p_error"] = "项目驱动入口调用失败（返回值不可解析）"
        }
        if let d = try? JSONSerialization.data(withJSONObject: merged, options: [.prettyPrinted, .sortedKeys]) {
            try? d.write(to: reportDir.appendingPathComponent("app-stack.json"))
        } else {
            writeRaw("app-stack.json", mainOut)
        }
        NSLog("[proteus] app-stack 主场景完成（含项目驱动 p_* 读数）")
        // ★★★App 三端对齐 · 视觉合成（2026-10-04）：**把 App 屏内容真画到屏上**。
        //   selfdraw 桥（proteusSelfDraw，绑好 view）在同一 JSContext ⇒ 直接 eval 取 entry 页内容 +
        //   proteusSelfDraw.mount 建树（真 CALayer）+ snapshot 落 PNG ⇒ 真机"真画屏"证据。
        _ = ctx.evaluateScript("var __PROTEUS_VIEWPORT__ = {\"width\": \(UIScreen.main.bounds.width), \"height\": \(UIScreen.main.bounds.height)};")
        var composite: [String: Any] = ["ok": false]
        if let path = Bundle.main.path(forResource: "app-screen-content", ofType: "json"),
           let scData = try? Data(contentsOf: URL(fileURLWithPath: path)),
           let scAll = (try? JSONSerialization.jsonObject(with: scData)) as? [String: Any] {
            let page = scAll["index"] != nil ? "index" : (scAll.keys.first ?? "index")
            if let sc = scAll[page] as? [String: Any], let nodes = sc["nodes"] as? [[String: Any]] {
                let tree: [String: Any] = ["viewport": ["width": 390, "height": 844], "nodes": nodes]
                if let td = try? JSONSerialization.data(withJSONObject: tree),
                   let treeJson = String(data: td, encoding: .utf8) {
                    // 经 JS 调 proteusSelfDraw.mount（JSExport 对象在 JSContext 里）
                    ctx.setObject(treeJson as NSString, forKeyedSubscript: "__appScreenTree" as NSString)
                    let mountOut = evalJs?("proteusSelfDraw.mount(__appScreenTree)") ?? "null"
                    var mo: [String: Any] = [:]
                    if let md = mountOut.data(using: .utf8), let m = (try? JSONSerialization.jsonObject(with: md)) as? [String: Any] { mo = m }
                    SelfDrawBridge.snapshotName = "app-screen-composite"
                    let shot = evalJs?("proteusSelfDraw.snapshot('app-screen-composite')") ?? "null"
                    let shotOk = !shot.contains("null") && !shot.isEmpty
                    var imgPath = shot.trimmingCharacters(in: .whitespacesAndNewlines)
                    if imgPath.hasPrefix("\"") { imgPath = String(imgPath.dropFirst().dropLast()) }
                    // ★批次 39：静态变换节点数（编译期 CSS transform）——每端独立读数（与 Android/鸿蒙同口径）
                    let tfCount = nodes.filter { ($0["transform"] as? [String: Any]) != nil }.count
                    composite = ["ok": (mo["ok"] as? Bool) ?? false, "page": page, "content_nodes": nodes.count,
                                 "layer_count": mo["layer_count"] ?? -1, "transformed_nodes": tfCount,
                                 "snapshot": shotOk, "snapshot_path": imgPath]
                    // ★★★交互上屏 · 真实触摸（2026-10-04）：宿主喂入**真触摸序列**（down→held→up），
                    //   走 `SelfDrawView.classifyAndEmit`（与 `touchesEnded` 同一分流器，按真实时长判型）
                    //   ——不再是 `tapAt` 那样直接声明类型、绕过时序。与 Android 真 MotionEvent、鸿蒙
                    //   `uitest uiInput` 同族；三端由**真事件序列**驱动交互（非装置内直调命中）。
                    var hitCount = 0
                    var firstTarget = -1
                    var tapsFired = 0
                    for k in 1...20 {
                        let py: Double = 844.0 * (Double(k) / 22.0)
                        // held 60ms ≤ tapMaxDuration(0.5s) ⇒ 分流器按**真实时长**判 tap
                        let r = evalJs?("proteusSelfDraw.simulateTouch(117.0, \(py), 60)") ?? "null"
                        if let rd = r.data(using: .utf8), let ro = (try? JSONSerialization.jsonObject(with: rd)) as? [String: Any] {
                            if let t = ro["target"] as? Int, t >= 0 { hitCount += 1; if firstTarget < 0 { firstTarget = t } }
                            if let gf = ro["gestures_fired"] as? Int, gf > 0 { tapsFired += 1 }
                        }
                    }
                    composite["hit_points_hit"] = hitCount
                    composite["hit_first_target"] = firstTarget
                    composite["real_touch"] = true
                    composite["taps_recognized"] = tapsFired
                }
            }
        }
        if let cd = try? JSONSerialization.data(withJSONObject: composite, options: [.prettyPrinted, .sortedKeys]) {
            try? cd.write(to: reportDir.appendingPathComponent("app-screen-composite.json"))
        }
        NSLog("[proteus] 视觉合成：%@", (try? String(data: JSONSerialization.data(withJSONObject: composite), encoding: .utf8)) ?? "?")

        // ⑤ 执行器两相：kick → **非阻塞轮询**（见文件头）→ 写第二份报告
        _ = evalJs?("__proteusAppStackExecutorKick()")
        pollExecutor(round: 0)
    }

    /// 非阻塞轮询（每轮让出主线程；有界 10s）
    private static func pollExecutor(round: Int) {
        let maxRounds = 625 // ≈10s（16ms/轮）
        guard let eval = evalJs else { return }
        let json = eval("__proteusAppStackExecutorRead()")
        var pending = true
        var merged: [String: Any]? = nil
        if let d = json.data(using: .utf8), let obj = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            // ★只认**显式的** pending:true（Android 腿实测缺陷：无该字段的结果也被当 pending ⇒ 永不收工）
            pending = (obj["pending"] as? Bool) == true
            if !pending {
                var m = obj
                m["e_pump_rounds"] = round
                if let sh = ScreenHost.current {
                    m["e_host_stats"] = sh.stats() // ★宿主记账（判据读它证明"动作真发生"）
                }
                merged = m
            }
        }
        if let m = merged {
            if let d = try? JSONSerialization.data(withJSONObject: m, options: [.prettyPrinted, .sortedKeys]) {
                try? d.write(to: reportDir.appendingPathComponent("app-stack-executor.json"))
            }
            NSLog("[proteus] APP_STACK_REPORT_READY（轮数 %d）", round)
            if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
            return
        }
        if round >= maxRounds {
            let timeout: [String: Any] = ["pending": true, "timeout": true, "rounds": round]
            if let d = try? JSONSerialization.data(withJSONObject: timeout, options: [.prettyPrinted, .sortedKeys]) {
                try? d.write(to: reportDir.appendingPathComponent("app-stack-executor.json"))
            }
            NSLog("[proteus] APP_STACK_REPORT_READY（超时——如实记 timeout）")
            if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.016) { pollExecutor(round: round + 1) }
    }

    // ── 报告 ──

    private static func writeRaw(_ name: String, _ raw: String) {
        try? raw.write(to: reportDir.appendingPathComponent(name), atomically: true, encoding: .utf8)
    }

    private static func writeJson(_ name: String, fatal: String) {
        writeRaw(name, "{\"ok\":false,\"fatal\":\"\(fatal)\"}")
    }
}
