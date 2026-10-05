// hosts/ios/ProteusHost/superapp-scene.swift
// ★★★批次 44（2026-10-05）：**superapp 真实应用 · 桌面启动场景**（iOS 腿）。
//
// 【为什么新增本场景（而不是改 AppStackScene）】
//   用户目标：「手机主屏图标点开 App 就能测完整体验」。此前 iOS 从桌面点开 = `showcase`（炫技场）；
//   而 superapp 的启动逻辑此前只做在 **AppStackScene（`--app-stack` 装置场景）** 里——
//   一次性跑探针 + 静态合成，跑完自退，**不是应用入口**。
//   本场景把 superapp 装配成**常驻应用**：boot → 上屏入口页 → 底部 Tab 栏（可点）→ 常驻。
//
// 【与 AppStackScene 的关系】同一套链（proteusHost 注入 → bundle-superapp → createAppNavigation +
//   createRouter），但**去装置化**：不跑 A–D 压测 / executor 两相 / 探针，只做"应用在跑"。
//
// 【链路（与 Android SuperappActivity、Web/MP 同形）】
//   ① QuickJS/JSC 注入 `proteusHost`（screen.* 真内核树）→ 复用 AppStackScene 的 HostRuntimeBridge
//   ② eval `bundle-superapp.js` → `__proteusSuperappBootJson()`（路由栈 + 宿主真建树 → 进入入口 tab）
//   ③ `proteusSelfDraw.mount({viewport, nodes})` 把入口页内容**真画到屏上**（CALayer）
//   ④ 底部 Tab 栏（真实 UIButton——iOS 的原生 chrome，MP 由原生 tabBar 提供，同语义）
//   ⑤ drive（验证脚本用）：host 驱动切 tab → 重绘 → 落 `superapp.json` 证据
//
// 【诚实边界（与 PROJECT_MEMORY 一致）】页面内容 = 编译产物静态结构（结构/样式/文本）；
//   全实时 slot/Vapor 运行时（响应式/事件回写）是下一阶段。本场景证明"真实应用壳 + 导航 + 真机渲染 + 切 tab"。

import Foundation
import JavaScriptCore
import UIKit

final class SuperappScene: NSObject {
    private static var evalJs: ((String) -> String)?
    private static var reportDir: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

    private static weak var bridgeRef: SelfDrawBridge?
    private static var container: UIView?
    private static var tabNames: [String] = []
    private static var tabLabels: [String: String] = [:]
    private static var switchLog: [[String: Any]] = []
    private static var driveLog: [[String: Any]] = []

    /// 入口：由 `runSelfdraw` 在自动场景（桌面点开 / --superapp）时调用。
    static func run(ctx: JSContext, bundleURL: URL, bridge: SelfDrawBridge, containerView: UIView) {
        evalJs = { expr in ctx.evaluateScript(expr)?.toString() ?? "null" }
        bridgeRef = bridge
        container = containerView

        // ① 平台参数（TS 侧自报标识——三端同契约）
        _ = ctx.evaluateScript("var __PROTEUS_HOST_ID__ = 'ios';")
        _ = ctx.evaluateScript("var __PROTEUS_HOST_FRAME_DRIVER__ = 'CADisplayLink';")
        // ② 宿主桥（screen.* + 能力）——与 AppStackScene 同一份
        ctx.setObject(HostRuntimeBridge(), forKeyedSubscript: "proteusHost" as NSString)
        // ③ proteusSelfDraw 由 SelfDrawViewController 注入（本场景复用同一 bridge）

        // ④ 载入 superapp bundle（同目录 bundle-superapp.js）
        let saURL = bundleURL.deletingLastPathComponent().appendingPathComponent("bundle-superapp.js")
        guard let saSrc = try? String(contentsOf: saURL, encoding: .utf8) else {
            NSLog("[proteus] 缺少 bundle-superapp.js（%s）", saURL.path)
            writeReport(["ok": false, "error": "bundle-superapp.js 未打包进 .app"])
            return
        }
        _ = ctx.evaluateScript(saSrc, withSourceURL: saURL)

        // ⑤ boot — 路由栈装配 + 进入入口 tab（同步返回首屏读数）
        let boot = evalJs?("__proteusSuperappBootJson()") ?? "null"
        NSLog("[proteus] superapp boot：%@", String(boot.prefix(200)))
        readTabRegistry()
        // ⑥ 上屏入口页 + 建 Tab 栏
        renderCurrent()
        buildTabBar()

        // ⑦ 分步 asyncAfter 链（JSC 微任务需主 runloop 轮转才排空——同步连续 eval 会让路由/执行器
        //    的 await 续体停住，见 AppStackScene 同款踩坑）。drive 模式逐 tab 切换 + 重绘 + 落证据。
        let drive = ProcessInfo.processInfo.arguments.contains("--drive")
        let steps: [(Double, () -> Void)] = drive
            ? (0..<tabNames.count).map { i in
                (0.15 * Double(i + 1), { driveTab(index: i) })
              }
            : []
        let finishAt = 0.15 * Double(tabNames.count + 1)
        for (delay, step) in steps { DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: step) }
        DispatchQueue.main.asyncAfter(deadline: .now() + max(finishAt, 0.2)) { finish() }
        NSLog("[proteus] SUPERAPP_LAUNCHER_READY")
    }

    // ── 状态读取 ──

    private static func readTabRegistry() {
        guard let st = evalJs?("__proteusSuperappState()"),
              let d = st.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
        tabNames = (o["tabs"] as? [String]) ?? []
        tabLabels = (o["tabLabels"] as? [String: String]) ?? [:]
    }

    private static func currentName() -> String {
        guard let st = evalJs?("__proteusSuperappState()"),
              let d = st.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return "" }
        return (o["current"] as? String) ?? ""
    }

    // ── 上屏 ──

    /// 把**当前屏内容**真画到屏上（编译产物 app-screen-content.json → CALayer 层）。
    private static func renderCurrent() {
        let page = currentName()
        guard let path = Bundle.main.path(forResource: "app-screen-content", ofType: "json"),
              let scData = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let scAll = (try? JSONSerialization.jsonObject(with: scData)) as? [String: Any] else {
            NSLog("[proteus] 缺 app-screen-content.json——无法上屏")
            return
        }
        let usePage = scAll[page] != nil ? page : (scAll["index"] != nil ? "index" : (scAll.keys.first ?? "index"))
        guard let sc = scAll[usePage] as? [String: Any], let nodes = sc["nodes"] as? [[String: Any]] else { return }
        let vp = UIScreen.main.bounds
        let tree: [String: Any] = ["viewport": ["width": Double(vp.width), "height": Double(vp.height)], "nodes": nodes]
        guard let td = try? JSONSerialization.data(withJSONObject: tree),
              let treeJson = String(data: td, encoding: .utf8) else { return }
        let out = bridgeRef?.mount(treeJson) ?? "{\"ok\":false}"
        NSLog("[proteus] SUPERAPP_RENDER page=%@ nodes=%d → %@", usePage, nodes.count, String(out.prefix(160)))
    }

    // ── Tab 栏（真实 UIButton · iOS 原生 chrome） ──

    private static func buildTabBar() {
        guard let container = container else { return }
        let h: CGFloat = 56
        let w = container.bounds.width
        let barY = container.bounds.height - h
        let bar = UIView(frame: CGRect(x: 0, y: barY, width: w, height: h))
        bar.backgroundColor = UIColor(red: 0x1B/255.0, green: 0x1B/255.0, blue: 0x2A/255.0, alpha: 1)
        bar.tag = 771001
        let current = currentName()
        let unread = imUnreadValue()
        for (i, name) in tabNames.enumerated() {
            let bw = w / CGFloat(max(1, tabNames.count))
            let btn = UIButton(type: .system)
            btn.frame = CGRect(x: bw * CGFloat(i), y: 0, width: bw, height: h)
            // ★图标 + 短标签（与 Web/Android 底部 Tab 栏同形：⌂ 首页 / ✉ 消息 / ☺ 我的）
            btn.setTitle("\(tabIcon(name)) \(tabShortLabel(name))", for: .normal)
            btn.setTitleColor(current == name ? UIColor(red: 0x4C/255.0, green: 0x8D/255.0, blue: 0xFF/255.0, alpha: 1) : UIColor(red: 0x8A/255.0, green: 0x8A/255.0, blue: 0x9A/255.0, alpha: 1), for: .normal)
            btn.titleLabel?.font = UIFont.systemFont(ofSize: 13)
            btn.accessibilityIdentifier = name
            btn.addTarget(self, action: #selector(onTabTap(_:)), for: .touchUpInside)
            // IM 角标（messages 且 unread>0）：红色小圆
            if name == "messages" && unread > 0 {
                let badge = UILabel(frame: CGRect(x: bw * CGFloat(i) + bw / 2 + 8, y: 6, width: 16, height: 16))
                badge.text = unread > 99 ? "99+" : "\(unread)"
                badge.font = UIFont.systemFont(ofSize: 9)
                badge.textColor = .white
                badge.textAlignment = .center
                badge.backgroundColor = UIColor(red: 0xF5/255.0, green: 0x22/255.0, blue: 0x2D/255.0, alpha: 1)
                badge.layer.cornerRadius = 8
                badge.layer.masksToBounds = true
                bar.addSubview(badge)
            }
            bar.addSubview(btn)
        }
        container.addSubview(bar)
    }

    private static func tabIcon(_ name: String) -> String {
        name == "index" ? "⌂" : name == "messages" ? "✉" : name == "mine" ? "☺" : "•"
    }
    private static func tabShortLabel(_ name: String) -> String {
        name == "index" ? "首页" : name == "messages" ? "消息" : name == "mine" ? "我的" : name
    }
    /** IM 未读角标初值（与 App.vue 壳同源；后续接实时运行时改由状态驱动） */
    private static func imUnreadValue() -> Int { 3 }

    @objc private static func onTabTap(_ sender: UIButton) {
        guard let name = sender.accessibilityIdentifier else { return }
        switchTab(name, via: "user-tap")
    }

    // ── drive（验证脚本用：host 驱动切 tab） ──

    private static func driveTab(index: Int) {
        guard index < tabNames.count else { return }
        let name = tabNames[index]
        switchTab(name, via: "drive")
    }

    private static func switchTab(_ name: String, via: String) {
        _ = evalJs?("__proteusSuperappNav(\(jsonQuote(name)))")
        // 让微任务（路由/执行器 await）排空——下一次 runloop
        DispatchQueue.main.async {
            let cur = currentName()
            renderCurrent()
            highlightTab(cur)
            switchLog.append(["tap": name, "current": cur, "ok": cur == name, "via": via])
        }
    }

    private static func highlightTab(_ current: String) {
        guard let bar = container?.viewWithTag(771001) else { return }
        for sub in bar.subviews {
            guard let btn = sub as? UIButton, let id = btn.accessibilityIdentifier else { continue }
            btn.setTitleColor(id == current ? UIColor(red: 0x4C/255.0, green: 0x8D/255.0, blue: 0xFF/255.0, alpha: 1) : UIColor(red: 0x8A/255.0, green: 0x8A/255.0, blue: 0x9A/255.0, alpha: 1), for: .normal)
        }
    }

    private static func jsonQuote(_ s: String) -> String {
        "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }

    // ── 收工 / 报告 ──

    private static func finish() {
        if ProcessInfo.processInfo.arguments.contains("--drive") {
            writeReport(reportBody())
            NSLog("[proteus] SUPERAPP_LAUNCHER_REPORT_READY")
            if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
        } else {
            NSLog("[proteus] SUPERAPP_LAUNCHER_PERSISTENT（常驻——桌面点开形态）")
        }
    }

    private static func reportBody() -> [String: Any] {
        var o: [String: Any] = ["ok": true, "host_id": "ios", "tabs": tabNames, "switch_log": switchLog,
                                "run_ts": Date().timeIntervalSince1970]
        if let st = evalJs?("__proteusSuperappState()"),
           let d = st.data(using: .utf8),
           let so = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            o["state"] = so
            o["rendered_page"] = so["current"] ?? ""
        }
        o["host_stats"] = (evalJs?("proteusHost.invoke('screen.stats', '{}')") ?? "null")
        return o
    }

    private static func writeReport(_ body: [String: Any]) {
        if let d = try? JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted, .sortedKeys]) {
            try? d.write(to: reportDir.appendingPathComponent("superapp.json"))
        }
    }
}
