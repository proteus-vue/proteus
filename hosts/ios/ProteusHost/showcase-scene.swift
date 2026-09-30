// hosts/ios/ProteusHost/showcase-scene.swift
// ★★Morpheus 炫技场（iOS 宿主壳）—— `--showcase` 模式
//
// 【这一场做什么（与 JS 侧分工）】
//   JS 侧（`hosts/shared/bridge/entry-showcase.ts`）负责"编舞"——把三段运动的**真指令**算出来
//   （800 条 spring / FLIP 补间 / 螺旋三属性），并给出瓦片树的几何请求；
//   本壳负责"跑起来"：建层 → **CADisplayLink 驱动每帧 tick** → 段间切换 → 收尾读数 + 截图。
//
// 【★为什么必须有"宿主侧帧循环"（不是 JS 自己 tick）】
//   ① 生产形态就是这样：宿主拥有帧循环（G-39），JS 只交指令；
//   ② 只有让**真实的 vsync** 驱动，帧率/掉帧读数才有意义（JS 用定时器 tick 测的是定时器频率）；
//   ③ 段间切换（A→B→C）也必须由帧回调里推进——JS 侧没有"等 N 毫秒"的能力（无 setTimeout 语义保证）。
//
// 【判据（check-showcase.py 读 showcase.json）】
//   ① 三段都真跑（每段 anims>0 且帧数增长）
//   ② 帧率达标（fps ≥ 55）+ 掉帧率低（≤ 2%）
//   ③ 每帧成本（work p95）≤ 一帧预算的一半（8ms）
//   ④ 真执行证据：终值探针（弹簧终值=0 / FLIP 归位 / 螺旋参数生效）+ 截图非空
//   ⑤ ★对照组（诚实）：纯 JS 逐帧路径在同规模下的成本（见 JS 侧 `showcaseCpuControl`）——
//      用于回答"内核路径到底省了多少"

import Foundation
import JavaScriptCore
import UIKit

final class ShowcaseScene: NSObject {
    private static var ctxRef: JSGlobalContextRef?
    private static var evalJs: ((String) -> String)?
    private static var reportDir: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    private static var frameLink: CADisplayLink?
    private static var phaseIndex = 0
    private static var phaseElapsed = 0.0
    private static var totalFrames = 0
    private static var workMs: [Double] = []
    private static var vsyncMs: [Double] = []
    private static var lastTs: CFTimeInterval = 0
    private static var segStartTs: CFTimeInterval = 0
    /// 段序列（与 JS 侧的段名一一对应：A 波浪 / B FLIP 重排 / C 螺旋）
    private static let PHASES = ["wave", "flip", "spiral"]
    /// 每段时长（ms）——★给足余量：本体 900ms + 弹簧自然静止/stagger 尾巴（实测弹簧 ~1s + 波浪
    ///   delay 最多 240ms ⇒ 1600ms 才不被切成半途）。段切早了会看到"动画被掐断"。
    private static var phaseMs = 1600.0

    static func run(ctx: JSContext, bundleURL: URL) {
        ctxRef = ctx.jsGlobalContextRef
        evalJs = { expr in ctx.evaluateScript(expr)?.toString() ?? "null" }

        // ① 平台参数（与其它场景同契约）
        _ = ctx.evaluateScript("var __PROTEUS_HOST_ID__ = 'ios';")
        _ = ctx.evaluateScript("var __PROTEUS_HOST_FRAME_DRIVER__ = 'CADisplayLink';")

        // ② ★★宿主桥**不要另建**：`SelfDrawViewController.viewDidLoad` 已把**绑好 view 的**
        //    `SelfDrawBridge` 设为 `proteusSelfDraw`（本场景直接用那个实例）。
        //   【为什么这条是致命坑（2026-09-30 真机实测）】新 `SelfDrawBridge()` 的 `view` 为 nil
        //   ⇒ `mount()` 直接返回 `{ok:false}`（"view 未设置"）⇒ **黑屏**且报告只写失败路径。
        //   只改快照名（静态量，与该实例共享）。
        SelfDrawBridge.snapshotName = "showcase-final"

        // ③ 视口注入（JS 侧建树要按屏幕尺寸算瓦片宽）
        let w = UIScreen.main.bounds.width
        let h = UIScreen.main.bounds.height
        _ = ctx.evaluateScript("var __PROTEUS_VIEWPORT__ = {\"width\":\(w),\"height\":\(h)};")

        guard let src = try? String(contentsOf: bundleURL, encoding: .utf8) else {
            NSLog("[proteus] 读 bundle-showcase.js 失败：%@", bundleURL.path)
            writeRaw("showcase.json", "{\"ok\":false,\"error\":\"bundle 读失败\"}")
            return
        }
        _ = ctx.evaluateScript(src, withSourceURL: bundleURL)

        // ④ 建树（同步）
        // ★cols=20 ⇒ 瓦片 ~15pt（肉眼可辨的"块"而非噪点）；800 片 = 20×40 网格
        let runOut = evalJs?("__proteusShowcaseRun('{\"tiles\":800,\"cols\":20,\"segmentMs\":900,\"staggerMs\":4}')") ?? "null"
        NSLog("[proteus] showcase run → %@", String(runOut.prefix(200)))
        if !runOut.contains("\"ok\":true") {
            writeRaw("showcase.json", "{\"ok\":false,\"error\":\"建树失败\",\"detail\":\(jsonString(runOut))}")
            // ★失败也要走**自退**（否则黑屏挂起、脚本侧等不到退出——真机实测教训）
            if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(9) }
            return
        }

        // ⑤ 启动帧循环 + 第一段
        phaseIndex = 0
        phaseElapsed = 0
        totalFrames = 0
        workMs = []
        vsyncMs = []
        lastTs = 0
        _ = evalJs?("__proteusShowcaseFrameLoop('on')")
        _ = evalJs?("__proteusShowcaseSegment('\(PHASES[0])')")
        segStartTs = CACurrentMediaTime()

        let link = CADisplayLink(target: self, selector: #selector(onFrame(_:)))
        link.add(to: .main, forMode: .common) // .common：滚动/手势期间不掐停
        frameLink = link
        NSLog("[proteus] showcase 启动：800 瓦片 · 三段编舞（%@）", PHASES.joined(separator: " → "))
    }

    @objc private static func onFrame(_ link: CADisplayLink) {
        let now = link.timestamp
        let dtMs = lastTs == 0 ? 0 : (now - lastTs) * 1000
        lastTs = now
        if totalFrames > 0 { vsyncMs.append(dtMs) }
        totalFrames += 1

        // ★被测工作：每帧一次 tick（内核求值 + 写层）——计时只包这一段
        let t0 = CACurrentMediaTime()
        _ = evalJs?("__proteusShowcaseTick(\(dtMs))")
        workMs.append((CACurrentMediaTime() - t0) * 1000)

        phaseElapsed += dtMs
        guard phaseElapsed >= phaseMs else { return }

        // 段切换（帧回调里推进——不用定时器/睡眠）
        phaseIndex += 1
        phaseElapsed = 0
        if phaseIndex < PHASES.count {
            _ = evalJs?("__proteusShowcaseSegment('\(PHASES[phaseIndex])')")
            segStartTs = CACurrentMediaTime()
            NSLog("[proteus] showcase 进入第 %d 段：%@", phaseIndex + 1, PHASES[phaseIndex])
            return
        }
        finish()
    }

    private static func finish() {
        frameLink?.invalidate()
        frameLink = nil
        _ = evalJs?("__proteusShowcaseFrameLoop('off')")

        // ★每帧读数（与 animBench 同一算法：中位数/百分位/掉帧率）
        func pct(_ arr: [Double], _ p: Double) -> Double {
            guard !arr.isEmpty else { return 0 }
            let s = arr.sorted()
            if s.count == 1 { return s[0] }
            let pos = p * Double(s.count - 1)
            let lo = Int(pos.rounded(.down))
            let hi = min(lo + 1, s.count - 1)
            let f = pos - Double(lo)
            return s[lo] * (1 - f) + s[hi] * f
        }
        let nominal = pct(vsyncMs, 0.5)
        let dropped = nominal > 0 ? vsyncMs.filter { $0 > nominal * 1.5 }.count : 0
        let totalVsync = vsyncMs.reduce(0, +)
        let fps = totalVsync > 0 ? Double(max(totalFrames - 1, 0)) * 1000.0 / totalVsync : 0
        let perf: [String: Any] = [
            "frames": totalFrames,
            "fps": (fps * 100).rounded() / 100,
            "vsync_p50_ms": (nominal * 1000).rounded() / 1000,
            "work_p50_ms": (pct(workMs, 0.5) * 1000).rounded() / 1000,
            "work_p95_ms": (pct(workMs, 0.95) * 1000).rounded() / 1000,
            "work_max_ms": ((workMs.max() ?? 0) * 1000).rounded() / 1000,
            "dropped": dropped,
            "dropped_ratio": vsyncMs.isEmpty ? 0 : (Double(dropped) / Double(vsyncMs.count) * 10000).rounded() / 10000,
            "elapsed_ms": (totalVsync * 100).rounded() / 100,
        ]
        // 把宿主读数并进报告（JS 侧 finalize 会写 report()，这里补 perf 后重写文件）
        let fin = evalJs?("__proteusShowcaseFinalize()") ?? "null"
        var merged: [String: Any] = [:]
        if let d = fin.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            merged = o
        } else {
            merged = ["ok": false, "parse_error": String(fin.prefix(200))]
        }
        merged["host_perf"] = perf
        // ★平台自报（模拟器 vs 真机）——**模拟器的帧率数字不作真机证据**（本仓纪律：
        //   "模拟器可证接线正确，性能须真机复测"）。判据据此分档并在报告里显示。
        #if targetEnvironment(simulator)
        merged["platform"] = "ios-sim"
        #else
        merged["platform"] = "ios"
        #endif
        // ★build_id 由 JS 侧报告带来（编译期注入进 entry-showcase.ts——与其它入口同机制）
        if let d = try? JSONSerialization.data(withJSONObject: merged, options: [.prettyPrinted, .sortedKeys]) {
            try? d.write(to: reportDir.appendingPathComponent("showcase.json"))
        }
        NSLog("[proteus] SHOWCASE_REPORT_READY fps=%@ work_p95=%@ dropped=%@ frames=%@",
              "\(perf["fps"] ?? "?")", "\(perf["work_p95_ms"] ?? "?")", "\(perf["dropped"] ?? "?")", "\(perf["frames"] ?? "?")")
        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
    }

    private static func writeRaw(_ name: String, _ raw: String) {
        try? raw.write(to: reportDir.appendingPathComponent(name), atomically: true, encoding: .utf8)
    }
    private static func jsonString(_ s: String) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: [s]), var out = String(data: d, encoding: .utf8) else { return "\"\"" }
        out.removeFirst(); out.removeLast()
        return out
    }
}
