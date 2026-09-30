// hosts/ios/ProteusHost/showcase-scene.swift
// ★★Morpheus 炫技场（iOS 宿主壳）—— `--showcase` 模式
//
// 【这一场做什么（与 JS 侧分工）】
//   JS 侧（`hosts/shared/bridge/showcase-program.ts` + `entry-showcase.ts`）负责"编舞"——
//   整场节目单（开场语 → 演出 → 长跑 → 谢幕语）由**声明式编排层**生成真指令；
//   本壳负责"把它跑起来"并**给出机器读数**：建层 → CADisplayLink 驱动每帧 tick →
//   幕边界推进（取下一幕 → 发令）→ **逐幕性能统计** + 内存采样 → 收尾报告 + 截图。
//
// 【★为什么必须有"宿主侧帧循环"（不是 JS 自己 tick）】
//   ① 生产形态就是这样：宿主拥有帧循环（G-39），JS 只交指令；
//   ② 只有让**真实的 vsync** 驱动，帧率/掉帧读数才有意义（JS 用定时器 tick 测的是定时器频率）；
//   ③ 幕边界必须在**帧回调里**推进——动画时间与幕时间用同一个 dt 前进
//     （否则"幕提前切走"会让动画被掐断、终态记账失真）。
//
// 【判据（check-showcase.py 读 showcase.json）】
//   ① 节目单真演完（`acts` 与 `plan` 逐项一致 = acts_complete）
//   ② 逐幕真跑（每幕帧数/指令数）+ 全程帧率/掉帧
//   ③ 逐幕每帧成本（work p50/p95/p99 —— B7 口径）+ FLIP 幕的内核重排读数（单列）
//   ④ 长跑：内存采样（首尾对比——泄漏的机器判据）+ 热状态（热节流的证据）
//   ⑤ 终值探针（真读层）+ 两张截图（漩涡中场面 / 谢幕语收尾）
//
// 【★屏幕常亮（3 分钟演出必须）】`isIdleTimerDisabled = true` —— 灭屏时 app 只渲染个位数帧，
//   读数全废（Android 侧已有同样教训，写进 AGENTS.md；iOS 侧同样适用）。

import Foundation
import JavaScriptCore
import UIKit

final class ShowcaseScene: NSObject {
    private static var evalJs: ((String) -> String)?
    private static var reportDir: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    private static var frameLink: CADisplayLink?

    /* ── 幕状态（幕边界推进；动画时间与幕时间同一个 dt） ── */
    private static var actName = ""
    /// 名义时间跨度（ms；弹簧的实际结束由内核判定——见 finishAct 注释）
    private static var actSpan = 0.0
    /// 幕尾定型（ms；谢幕语 > 0）
    private static var actHold = 0.0
    private static var actElapsed = 0.0
    private static var actFrames = 0
    private static var actWork: [Double] = []
    private static var actVsync: [Double] = []

    /* ── 全程统计 ── */
    private static var totalFrames = 0
    private static var lastTs: CFTimeInterval = 0
    private static var showStartTs: CFTimeInterval = 0
    private static var allWork: [Double] = []
    private static var allVsync: [Double] = []
    /// 逐幕读数（进报告；B7 口径：p50/p95/p99 + 掉帧）
    private static var actsPerf: [[String: Any]] = []
    /// 内存采样（长跑泄漏的机器判据）：幕边界采一次
    private static var memSamples: [[String: Any]] = []
    /// 每幕的"尾等待"（名义时间已到但内核说还有动画在动 ⇒ 这里等了多少 ms）——
    /// **无缝衔接的机器取证**：值 ≈ 0/一帧 = 动画完成即切幕；值很大 = 幕尾有空等
    private static var tailWaits: [[String: Any]] = []
    /// 中途截图（漩涡定格）
    private static var spiralSnap: [String: Any] = [:]
    private static var startThermal = ""
    private static var startMemMB = 0.0

    static func run(ctx: JSContext, bundleURL: URL) {
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

        // ③ ★屏幕常亮：整场演出 3 分钟，灭屏会让帧数掉到个位数（读数全废）
        UIApplication.shared.isIdleTimerDisabled = true

        // ④ 视口注入（JS 侧建树要按屏幕尺寸算瓦片宽）
        let w = UIScreen.main.bounds.width
        let h = UIScreen.main.bounds.height
        _ = ctx.evaluateScript("var __PROTEUS_VIEWPORT__ = {\"width\":\(w),\"height\":\(h)};")

        guard let src = try? String(contentsOf: bundleURL, encoding: .utf8) else {
            NSLog("[proteus] 读 bundle-showcase.js 失败：%@", bundleURL.path)
            writeRaw("showcase.json", "{\"ok\":false,\"error\":\"bundle 读失败\"}")
            exit9IfRequested()
            return
        }
        _ = ctx.evaluateScript(src, withSourceURL: bundleURL)

        // ⑤ 建树（同步）。长跑（压力测量）**默认不跑**（用户要求"不用为了时长一直重复"）；
        //    需要泄漏/热节流压力测量时用环境变量开启：PROTEUS_SHOWCASE_SOAK_MS=300000
        let soakMs = ProcessInfo.processInfo.environment["PROTEUS_SHOWCASE_SOAK_MS"].flatMap { Int($0) } ?? 0
        // ★cols=20 ⇒ 瓦片 15pt；800 片 = 20×40 网格
        let runOut = evalJs?("__proteusShowcaseRun('{\"tiles\":800,\"cols\":20,\"soakMs\":\(soakMs)}')") ?? "null"
        NSLog("[proteus] showcase run → %@", String(runOut.prefix(240)))
        if !runOut.contains("\"ok\":true") {
            writeRaw("showcase.json", "{\"ok\":false,\"error\":\"建树失败\",\"detail\":\(jsonString(runOut))}")
            exit9IfRequested()
            return
        }

        // ⑥ 启动帧循环 + 第一幕
        totalFrames = 0
        lastTs = 0
        allWork = []
        allVsync = []
        actsPerf = []
        memSamples = []
        spiralSnap = [:]
        startThermal = thermalStateName()
        startMemMB = round1(physFootprintMB())
        showStartTs = CACurrentMediaTime()
        _ = evalJs?("__proteusShowcaseFrameLoop('on')")

        let link = CADisplayLink(target: self, selector: #selector(onFrame(_:)))
        link.add(to: .main, forMode: .common) // .common：滚动/手势期间不掐停
        frameLink = link
        // 第一幕取用（失败 ⇒ 走失败路径，不留挂起进程）
        if !advance() { return }
        NSLog("[proteus] showcase 启动：800 瓦片 · %@", String((runOut.prefix(200))))
    }

    /// 幕边界推进：取下一幕 → 发令。返回 false = 场景结束或失败（已处理收尾）
    @discardableResult
    private static func advance() -> Bool {
        let out = evalJs?("__proteusShowcaseNext()") ?? "null"
        guard let d = out.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else {
            fail("取幕回执无法解析：\(out.prefix(200))")
            return false
        }
        if o["ok"] as? Bool != true {
            fail("取幕失败：\(o["error"] ?? o["detail"] ?? out.prefix(200))")
            return false
        }
        if o["done"] as? Bool == true {
            finish()
            return false
        }
        actName = o["name"] as? String ?? "?"
        actSpan = (o["spanMs"] as? Double) ?? 0
        actHold = (o["holdMs"] as? Double) ?? 0
        actElapsed = 0
        actFrames = 0
        actWork = []
        actVsync = []
        return true
    }

    @objc private static func onFrame(_ link: CADisplayLink) {
        let now = link.timestamp
        let dtMs = lastTs == 0 ? 0 : (now - lastTs) * 1000
        lastTs = now
        totalFrames += 1
        if actFrames > 0 { actVsync.append(dtMs) }
        allVsync.append(dtMs)
        actFrames += 1

        // ★被测工作：每帧一次 tick（内核求值 + 写层）——计时只包这一段
        let t0 = CACurrentMediaTime()
        _ = evalJs?("__proteusShowcaseTick(\(dtMs))")
        let work = (CACurrentMediaTime() - t0) * 1000
        actWork.append(work)
        allWork.append(work)

        actElapsed += dtMs
        // ★幕边界判据 = ① 名义时间（span + 定型）到 ② **内核报"没有动画在动"**
        //
        // 【为什么必须问内核（2026-09-30 真机取证）】弹簧的结束时刻由**物理**决定
        //   （`settle_eps` 内静止才结束），名义 `durMs` 只是采样窗口 ⇒ 只按时间切会
        //   留下"动画早已静止、幕却还在等"的**可见停顿**（用户原话：「每一幕结束等会儿开始下一幕」）。
        //   内核 tick 只回"变化记录"，静止项不在里面 ⇒ 时长只能由内核回答（`animActiveCount`）。
        guard actElapsed >= actSpan + actHold else { return }
        let activeOut = evalJs?("__proteusShowcaseActive()") ?? "null"
        let active = parseActiveCount(activeOut)
        if active > 0 {
            // 安全上限（防止某条动画永不结束——如 Progress 驱动；3s 后强制切幕并留证）
            guard actElapsed < actSpan + actHold + 3000 else {
                tailWaits.append(["act": actName, "forced": true, "active": active])
                finishAct()
                advance()
                return
            }
            return
        }
        // 幕边界：先记账（本幕读数 + 内存采样 + 尾等待），再取下一幕
        finishAct()
        advance()
    }

    private static func parseActiveCount(_ raw: String) -> Int {
        guard let d = raw.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return 0 }
        return (o["active"] as? Int) ?? 0
    }

    private static func finishAct() {
        let vs = actVsync
        let nominal = pct(vs, 0.5)
        let dropped = nominal > 0 ? vs.filter { $0 > nominal * 1.5 }.count : 0
        // ★掉帧率的分母用**本幕帧数**（不是 vsync 数组长度——首帧无 dt）
        let denom = max(actFrames, 1)
        actsPerf.append([
            "name": actName,
            "frames": actFrames,
            "span_ms": round1(actSpan),
            "hold_ms": round1(actHold),
            "act_ms": round1(actElapsed),
            "fps": vs.reduce(0, +) > 0 ? round1(Double(actFrames) * 1000.0 / vs.reduce(0, +)) : 0,
            "work_p50_ms": round3(pct(actWork, 0.5)),
            "work_p95_ms": round3(pct(actWork, 0.95)),
            "work_p99_ms": round3(pct(actWork, 0.99)),
            "work_max_ms": round3(actWork.max() ?? 0),
            "dropped": dropped,
            "dropped_ratio": round4(Double(dropped) / Double(denom)),
            // ★尾等待（ms）：名义时间到 → 内核报告静止的真实等待。≈0 = 无缝
            "tail_wait_ms": round1(max(0, actElapsed - (actSpan + actHold))),
        ])
        memSamples.append([
            "act": actName,
            "n": memSamples.count + 1,
            "elapsed_ms": round1((CACurrentMediaTime() - showStartTs) * 1000),
            "mem_mb": round1(physFootprintMB()),
        ])
        // ★漩涡定格截图（中场面——产品页/判据都用得上）。
        //   ★截图命名权在**宿主静态量** `SelfDrawBridge.snapshotName`（见其注释）⇒
        //   临时改名为 -spiral 拍一张再改回 -final（否则中途这张会被收尾那张覆盖）。
        //   ★失败不致命：报告里如实记 raw（判据对中场面截图是"有更好"而非硬条件）。
        if actName == "spiral" {
            let prev = SelfDrawBridge.snapshotName
            SelfDrawBridge.snapshotName = "showcase-spiral"
            spiralSnap = parseJSON(evalJs?("__proteusShowcaseSnap('showcase-spiral')") ?? "null")
            SelfDrawBridge.snapshotName = prev
        }
    }

    /// 非自退模式（从桌面点开 = 演示模式）：演完 → 停留 → 重播（"随时点开给团队看"）
    private static var demoLoop = true

    private static func restartForDemo() {
        // ★演示模式的**机器证据**："点开给团队看"时整场会重演——本行被打印过 = 循环真发生
        NSLog("[proteus] SHOWCASE_DEMO_RESTART（演示模式：整场重演一轮）")
        // 停动画 + 清视觉值（回到基线）+ 重建节目单（上一轮幕索引已耗尽）
        _ = evalJs?("__proteusShowcaseRestart()")
        // 统计重置（新一轮；报告在自退模式下才写，demo 模式不落盘）
        totalFrames = 0
        lastTs = 0
        allWork = []
        allVsync = []
        actsPerf = []
        memSamples = []
        spiralSnap = [:]
        showStartTs = CACurrentMediaTime()
        // ★帧循环也要重启（finish 的 demo 分支把它停了——不停会让 act 推进逻辑空转）
        _ = evalJs?("__proteusShowcaseFrameLoop('on')")
        let link = CADisplayLink(target: self, selector: #selector(onFrame(_:)))
        link.add(to: .main, forMode: .common)
        frameLink = link
        if !advance() { return }
    }

    private static func finish() {
        // ★自退模式（脚本跑）⇒ 照旧收尾退出；演示模式（无该环境变量）⇒ 循环重播
        let selfExit = ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1"
        if demoLoop && !selfExit {
            // ★必须先停帧循环：否则 onFrame 的"幕推进"会在 finish 返回后继续触发（每帧重复 finish）
            frameLink?.invalidate()
            frameLink = nil
            _ = evalJs?("__proteusShowcaseFrameLoop('off')")
            // 谢幕语是"聚成 800 TILES"——停一拍让观众看清，然后从基线重演
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { restartForDemo() }
            return
        }
        frameLink?.invalidate()
        frameLink = nil
        _ = evalJs?("__proteusShowcaseFrameLoop('off')")

        // ★全程读数（与 animBench 同一算法：中位数/百分位/掉帧率）
        let nominal = pct(allVsync, 0.5)
        let dropped = nominal > 0 ? allVsync.filter { $0 > nominal * 1.5 }.count : 0
        let totalVsync = allVsync.reduce(0, +)
        let fps = totalVsync > 0 ? Double(max(totalFrames - 1, 0)) * 1000.0 / totalVsync : 0
        let perf: [String: Any] = [
            "frames": totalFrames,
            "fps": round1(fps),
            "vsync_p50_ms": round3(nominal),
            "work_p50_ms": round3(pct(allWork, 0.5)),
            "work_p95_ms": round3(pct(allWork, 0.95)),
            "work_p99_ms": round3(pct(allWork, 0.99)),
            "work_max_ms": round3(allWork.max() ?? 0),
            "dropped": dropped,
            "dropped_ratio": allVsync.isEmpty ? 0 : round4(Double(dropped) / Double(allVsync.count)),
            "elapsed_ms": round1(totalVsync),
        ]
        // 长跑内存（首尾窗口对比——泄漏的机器判据；中位数抗单点抖动）
        let soakMem = memGrowth()
        let host: [String: Any] = [
            "device": [
                "model": deviceModel(),
                "screen_max_fps": UIScreen.main.maximumFramesPerSecond,
                "os": ProcessInfo.processInfo.operatingSystemVersionString,
            ],
            "thermal": ["start": startThermal, "end": thermalStateName()],
            "mem_start_mb": startMemMB,
            "mem_end_mb": round1(physFootprintMB()),
            "mem_samples": memSamples,
            "soak_mem": soakMem,
            "acts_perf": actsPerf,
            "tail_waits": tailWaits,
            "spiral_snapshot": spiralSnap,
        ]

        let fin = evalJs?("__proteusShowcaseFinalize()") ?? "null"
        var merged: [String: Any] = [:]
        if let d = fin.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            merged = o
        } else {
            merged = ["ok": false, "parse_error": String(fin.prefix(200))]
        }
        merged["host_perf"] = perf
        for (k, v) in host { merged[k] = v }
        // ★本轮报告写出时刻（Unix 秒）——脚本侧「报告确系本轮写出」的内容级新鲜度判据
        //   （缺它 ⇒ check-report-freshness 直接 exit 3：判据根本没机会跑。2026-09-30 实测踩到）
        merged["run_ts"] = Date().timeIntervalSince1970
        // ★平台自报（模拟器 vs 真机）——模拟器的帧率数字不作真机证据（本仓纪律）
        #if targetEnvironment(simulator)
        merged["platform"] = "ios-sim"
        #else
        merged["platform"] = "ios"
        #endif
        if let d = try? JSONSerialization.data(withJSONObject: merged, options: [.prettyPrinted, .sortedKeys]) {
            try? d.write(to: reportDir.appendingPathComponent("showcase.json"))
        }
        NSLog("[proteus] SHOWCASE_REPORT_READY fps=%@ work_p95=%@ dropped=%@ frames=%@",
              "\(perf["fps"] ?? "?")", "\(perf["work_p95_ms"] ?? "?")", "\(perf["dropped"] ?? "?")", "\(perf["frames"] ?? "?")")
        exit9IfRequested(exitCode: 0)
    }

    /// 长跑窗口的内存增长（MB）：前 5 个采样 vs 后 5 个采样的中位数差
    private static func memGrowth() -> [String: Any] {
        // 只看长跑幕（soak-*）；不足 10 个采样 ⇒ 记 null（判据据此跳过而非误判）
        let soak = memSamples.filter { ($0["act"] as? String)?.hasPrefix("soak") == true }
        guard soak.count >= 10 else { return ["samples": soak.count, "growth_mb": NSNull()] }
        let vals = soak.compactMap { $0["mem_mb"] as? Double }
        let head = Array(vals.prefix(5))
        let tail = Array(vals.suffix(5))
        let growth = med(tail) - med(head)
        return [
            "samples": soak.count,
            "head_mb": round1(med(head)),
            "tail_mb": round1(med(tail)),
            "growth_mb": round1(growth),
        ]
    }

    /* ── 读数工具（与 animBench 同一算法） ── */

    private static func pct(_ arr: [Double], _ p: Double) -> Double {
        guard !arr.isEmpty else { return 0 }
        let s = arr.sorted()
        if s.count == 1 { return s[0] }
        let pos = p * Double(s.count - 1)
        let lo = Int(pos.rounded(.down))
        let hi = min(lo + 1, s.count - 1)
        let f = pos - Double(lo)
        return s[lo] * (1 - f) + s[hi] * f
    }
    private static func med(_ arr: [Double]) -> Double { pct(arr, 0.5) }
    private static func round1(_ v: Double) -> Double { (v * 10).rounded() / 10 }
    private static func round3(_ v: Double) -> Double { (v * 1000).rounded() / 1000 }
    private static func round4(_ v: Double) -> Double { (v * 10000).rounded() / 10000 }

    private static func deviceModel() -> String {
        var sysinfo = utsname()
        uname(&sysinfo)
        let mirror = Mirror(reflecting: sysinfo.machine)
        return mirror.children.reduce(into: "") { acc, el in
            if let v = el.value as? Int8, v != 0 { acc.append(Character(UnicodeScalar(UInt8(v)))) }
        }
    }
    private static func thermalStateName() -> String {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "unknown"
        }
    }

    private static func fail(_ msg: String) {
        frameLink?.invalidate()
        frameLink = nil
        writeRaw("showcase.json", "{\"ok\":false,\"error\":\(jsonString(msg))}")
        // ★演示模式（点开即看）失败 ⇒ 不留黑屏挂起：停一拍后整场重来（自愈）
        if demoLoop && ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] != "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { restartForDemo() }
            return
        }
        exit9IfRequested(exitCode: 9)
    }
    private static func exit9IfRequested(exitCode: Int32 = 9) {
        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(exitCode) }
    }
    private static func writeRaw(_ name: String, _ raw: String) {
        try? raw.write(to: reportDir.appendingPathComponent(name), atomically: true, encoding: .utf8)
    }
    private static func jsonString(_ s: String) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: [s]), var out = String(data: d, encoding: .utf8) else { return "\"\"" }
        out.removeFirst(); out.removeLast()
        return out
    }
    private static func parseJSON(_ raw: String) -> [String: Any] {
        guard let d = raw.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else {
            return ["ok": false, "raw": String(raw.prefix(120))]
        }
        return o
    }
}
