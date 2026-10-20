// hosts/ios/ProteusHost/shell/superapp-scene.swift
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
// 【★B1（2026-10-09）】页面内容已改为 **统一运行期**实例化（`createScreenRuntime`：实例化 + 订阅 +
//   手势派发 + `$nav` 导航——见 `packages/render-backend/src/screen-runtime.ts`），交互/导航走共享层。
//   本场景证明"真实应用壳 + 运行期渲染 + 导航（含右滑返回）+ 切 tab"。

import Foundation
import JavaScriptCore
import UIKit

/// ★★★B1（用户：「测试不能右滑返回」）：**边缘右滑返回**（iOS 标准返回手势）的目标-动作桥。
///   `UIScreenEdgePanGestureRecognizer` 需要 `NSObject` target（不能用闭包）⇒ 本类承接收手，
///   在 `.ended` 且右滑足够位移时触发 `onBack`。
private final class SwipeBackTarget: NSObject {
    let onBack: () -> Void
    init(_ onBack: @escaping () -> Void) { self.onBack = onBack }
    @objc func handle(_ g: UIScreenEdgePanGestureRecognizer) {
        if g.state == .ended {
            let dx = g.translation(in: g.view).x
            if dx > 60 { onBack() }   // 右滑 ≥60pt ⇒ 返回
        }
    }
}

final class SuperappScene: NSObject {
    private static var evalJs: ((String) -> String)?
    private static var reportDir: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    /** ★保留右滑返回手势 target（weak 语义 ⇒ 必须强引用，否则被回收后手势不触发）。 */
    private static var swipeBackTarget: SwipeBackTarget?

    private static weak var bridgeRef: SelfDrawBridge?
    /// ★★★v-pump/动画判据（本批）：宿主持有运行时桥 ⇒ 报告里直读泵/动画计数（native 真源，不经 JS）。
    private static weak var rtHostRef: SuperappRuntimeHost?
    /// JSON 字符串字面量（转义引号/反斜杠/换行）——供以 JS 表达式传参用。
    static func jsQuote(_ s: String) -> String {
        var out = "\""
        for ch in s.unicodeScalars {
            switch ch {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if ch.value < 0x20 { out += String(format: "\\u%04x", ch.value) }
                else { out.unicodeScalars.append(ch) }
            }
        }
        return out + "\""
    }

    private static var container: UIView?
    private static var tabNames: [String] = []
    // ★★★B · 能力归 runtime（决策 #800）：**tab 栏 chrome 唯一实现在 runtime**——本壳只喂 state、
    //   提供切屏出口（tabNames 仅剩 drive/报告用途；内容/样式/角标全由 chrome 从 state 解析）。
    private static var chrome = ProteusTabChrome()
    /** ★★★逐屏截图：全部屏名（boot 回包 / registry.screens 的键——验收项目无 tab 时用）。 */
    private static var allScreenNames: [String] = []
    private static var switchLog: [[String: Any]] = []
    private static var driveLog: [[String: Any]] = []
    /// ★B1 判据（2026-10-07）：`--tap=x,y` 注入模式（走注入链后落报告自退，不走 drive 时间链）
    private static var tapMode = false

    /// 入口：由 `runSelfdraw` 在自动场景（桌面点开 / --superapp）时调用。
    static func run(ctx: JSContext, bundleURL: URL, bridge: SelfDrawBridge, containerView: UIView) {
        JsTaskSampler.setEnabled(true)   // ★#1098 P0 长任务观测（验收宿主：恒采）
        evalJs = { expr in JsTaskSampler.eval(ctx, expr)?.toString() ?? "null" }
        bridgeRef = bridge
        container = containerView

        // ① 平台参数（TS 侧自报标识——三端同契约）
        _ = JsTaskSampler.eval(ctx, "var __PROTEUS_HOST_ID__ = 'ios';")
        _ = JsTaskSampler.eval(ctx, "var __PROTEUS_HOST_FRAME_DRIVER__ = 'CADisplayLink';")
        // ★★★批次 48（用户：iOS 页面内容能一直拖着来回动）：**开启内容滚动范围钳制**——
        //   内容页语义 = 装不下才滚、最多滚到内容底（与 Web 一致）。此前只有 stress 场景开了它，
        //   superapp 没开 ⇒ `applyContentOffset` 无界拖拽（iOS 特有，Android 已 enable）。范围由
        //   渲染路径从内核 rects 的 maxBottom − 视口高推导（见 selfdraw-scene 的 rects 块）。
        SelfDrawBridge.contentScrollRangeEnabled = true
        // ② 宿主桥（screen.* + 能力）——与 AppStackScene 同一份
        let hostBridge = HostRuntimeBridge()
        // ★★★决策 #1081：元素几何源接线（`useElement` 的宿主腿）——能力层只分档，几何来自渲染宿主。
        hostBridge.capabilities.elementRectProvider = { [weak bridge] args in bridge?.elementRect(args) ?? "{\"ok\":false,\"reason\":\"桥已释放\"}" }
        hostBridge.jsContextRef = ctx.jsGlobalContextRef
        // ★★★B1：壳走**统一运行期**——proteusHost = SuperappRuntimeHost（mount/applyOps/readRects/onGesture
        //   原语，交互/响应式/导航全在共享 JS 层）；旧静态屏内容改由 JS 侧 __proteusSuperappRender 实例化。
        let rtHost = SuperappRuntimeHost(draw: bridge, caps: hostBridge)
        rtHost.jsContext = ctx
        rtHostRef = rtHost
        ctx.setObject(rtHost, forKeyedSubscript: "proteusHost" as NSString)
        // ★★★S2「去 JSON」（决策 #903）：注入 `__proteusHostInvokeBytes`（JSC C API）——
        //   JS 侧 `getHostInvokeBytes()` 探测到它 ⇒ App 能力派发/回推走**二进制帧**（免 JSON 文本）。
        //   ★装在这里（`setObject` 之后、bundle 执行之前）：JS 侧是**调用时**探测，但早装可让首屏
        //     首个 `useFetch` 就走字节腿（避免"首请求回落 JSON"的静默不一致）。
        rtHost.installInvokeBytes(on: ctx)
        // ★★★决策 #1083：装录屏/截屏推送（用户截屏 / 录屏状态变化 → __proteusHostCapture）
        rtHost.installCapturePush(on: ctx)
        rtHost.installWsPush(on: ctx)   // ★#1093 WebSocket 事件推送
        // ★★★C14 键盘（决策 #1069）：装系统键盘通知 → 推 JS `__proteusHostKeyboard` + 刷新 env
        //   【为什么在这里装】本场景持有 JSContext（evalJs）与容器视图；且键盘是**每次弹收**都要推的
        //   持续事件，只能由壳装（JS 侧没有 UIKit 通知）。
        installKeyboardWatch()
        // ★手势命中链 → JS 运行期（SelfDrawBridge 命中后反向调 JS 注册的 `__proteusRuntimeGesture`）。
        bridge.onDispatchToJS = { target, chain, type, _, _ in
            rtHost.dispatchGestureToJS(type: type, target: target, chain: chain)
        }
        // ★★★批 A⑤（2026-10-08 · 决策 #656）：**接线 onScrollDrag**——`SelfDrawView` 装的真 UIPanGestureRecognizer
        //   的唯一出口；superapp 场景**此前未接** ⇒ 真触摸拖拽无反应（长页无法滚动）+ `driveScrollDrag` 空转（offset 恒 0）。
        //   与 selfdraw-app.swift / proteus-host-controller.swift 同款接线（同一 bridge 方法 `scrollDragBy`）。
        bridge.view?.onScrollDrag = { [weak bridge] dx, dy in
            let r = bridge?.scrollDragBy(dx: Double(dx), dy: Double(dy)) ?? "{\"ok\":false,\"error\":\"bridge 已释放\"}"
            // ★#1086：滚动 ⇒ 交叉观察重评估（排下一 runloop，非盲等）
            DispatchQueue.main.async {
                _ = evalJs?("typeof __proteusSuperappIntersectionTick==='function'?__proteusSuperappIntersectionTick():0")
            }
            return r
        }
        // ③ proteusSelfDraw 由 SelfDrawViewController 注入（本场景复用同一 bridge）

        // ④ 载入 superapp bundle（同目录 bundle-superapp.js）
        let saURL = bundleURL.deletingLastPathComponent().appendingPathComponent("bundle-superapp.js")
        guard let saSrc = try? String(contentsOf: saURL, encoding: .utf8) else {
            NSLog("[proteus] 缺少 bundle-superapp.js（%s）", saURL.path)
            writeReport(["ok": false, "error": "bundle-superapp.js 未打包进 .app"])
            return
        }
        _ = JsTaskSampler.eval(ctx, saSrc, withSourceURL: saURL)

        // ⑤ boot — 路由栈装配 + 进入入口 tab（同步返回首屏读数）
        let boot = evalJs?("__proteusSuperappBootJson()") ?? "null"
        NSLog("[proteus] superapp boot：%@", String(boot.prefix(200)))
        readTabRegistry()
        // ⑥ 上屏入口页 + 建 Tab 栏
        renderCurrent()
        setupTabChrome()
        // ★★★安全区修复（用户抓出 iOS 首页未避开状态栏）：`run` 在**布局前**同步调用 ⇒ 此刻
        //   `view.safeAreaInsets` 尚未就绪 ⇒ `--pf-inset-top`=0 ⇒ 内容压状态栏。
        //   ⇒ 下一 runloop（布局完成后）**重渲一次**（与 Android `contentHost.post` 同义；非盲等——
        //     是"布局后重渲"这一确定性事件）。
        DispatchQueue.main.async { renderCurrent() }
        // ★★★右滑返回（用户：「测试不能右滑返回」）：边缘右滑 → `__proteusSuperappBack()` → 重绘。
        //   （iOS 标准 `UIScreenEdgePanGestureRecognizer`；与系统返回手势同语义。）
        let backTarget = SwipeBackTarget { goBack() }
        SuperappScene.swipeBackTarget = backTarget
        let edgePan = UIScreenEdgePanGestureRecognizer(target: backTarget, action: #selector(SwipeBackTarget.handle(_:)))
        edgePan.edges = .left
        containerView.addGestureRecognizer(edgePan)

        // ⑦ 分步 asyncAfter 链（JSC 微任务需主 runloop 轮转才排空——同步连续 eval 会让路由/执行器
        //    的 await 续体停住，见 AppStackScene 同款踩坑）。drive 模式逐 tab 切换 + 重绘 + 落证据。
        let drive = ProcessInfo.processInfo.arguments.contains("--drive")
        // ★★★逐屏截图装置（2026-10-05 · 拆页后每页需独立截图与 Web 基准可比）：
        //   drive 模式遍历**全部屏**（不只 tab——验收项目无 tab）→ 每屏截图落 Documents/shot-<name>.png。
        //   屏列表来自 bundle 状态（`__proteusSuperappState().tabs` 或 registry.screens 的键）；
        //   无 tab 时用 superapp 启动时的全部屏名（由 boot 回包 screens 提供，见 readTabRegistry 扩展）。
        let driveScreens: [String] = tabNames.isEmpty ? allScreenNames : tabNames
        let steps: [(Double, () -> Void)] = drive
            ? (0..<driveScreens.count).map { i in
                (0.15 * Double(i + 1), { driveToScreen(driveScreens[i], index: i, total: driveScreens.count) })
              }
            : []
        // ★★★修（2026-10-05 · 逐屏截图）：按 **driveScreens**（全部屏）计时——
        //   首版用 `tabNames.count`：验收项目无 tab ⇒ 恒 1×0.15s ⇒ **报告在其余屏截图前落盘**。
        let finishAt = 0.15 * Double((driveScreens.isEmpty ? 1 : driveScreens.count) + 1)
        // ★★★B1 交互判据（2026-10-07）：`--tap=x,y`（内容坐标，vp）——注入一次合成 tap，走**与真触摸
        //   同一条链**（SelfDrawBridge.tapAt → 内核 hitTest → onDispatchToJS → JS 共享运行期 dispatchGesture
        //   → $nav 动作 → router.push/mountScreen）→ 重绘 → 落报告 → 自退。与 Android `--es tap` 同语义，
        //   使三端交互判据对称（Android `--es tap` / 鸿蒙 `uinput` / iOS 本入口）。
        if let ta = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--tap=") }) {
            Self.tapMode = true
            let body = String(ta.dropFirst("--tap=".count))
            let parts = body.split(separator: ",")
            // ★决策 #937：可选**前置** screen/scroll —— 先导航到目标屏 + 注入滚动，再 tap。
            //   用于验证"滚动后命中 fixed"（与 Android `--es screen`+`--es scroll`+`--es tap` 组合同语义）。
            let preScreen = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--screen=") })
                .map { String($0.dropFirst("--screen=".count)) }
            let preScroll = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--scroll=") })
                .flatMap { Double($0.dropFirst("--scroll=".count)) }
            if parts.count == 2, let x = Double(parts[0]), let y = Double(parts[1]) {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    if let sn = preScreen { _ = evalJs?("__proteusSuperappNav(\(jsonQuote(sn)))"); renderCurrent() }
                    let doTap: () -> Void = {
                        let out = bridgeRef?.tapAt(x, y) ?? "{}"
                        NSLog("[proteus] SUPERAPP_TAP inject x=%f y=%f => %@", x, y, String(out.prefix(220)))
                        // 下一 runloop：路由/处理器续体排空 → 重渲 → 落报告 → 自退（与 drive 同款完成信号）
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                            renderCurrent()
                            takeSnapshot()
                            switchLog.append(["tap": "inject", "scroll": preScroll as Any, "current": currentName(), "ok": true, "via": "tap-inject"])
                            writeReport(reportBody())
                            NSLog("[proteus] SUPERAPP_TAP_REPORT_READY current=%@", currentName())
                            if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
                        }
                    }
                    // 滚动异步生效 ⇒ 落 offset 后再 tap（否则读到 0）
                    if let dy = preScroll, dy != 0 {
                        if let vw = bridgeRef?.view { _ = vw.driveScrollDrag(dx: 0, dy: CGFloat(dy)) }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { doTap() }
                    } else {
                        doTap()
                    }
                }
            } else {
                NSLog("[proteus] SUPERAPP_TAP_ARG_INVALID %@", ta)
            }
        }
        // ★★★批 A⑤（2026-10-08 · 决策 #656）：`--screen=<name>` + `--scroll=<dy>`（vp）——导航到指定屏、
        //   注入一次**内容滚动**（`driveScrollDrag`）→ 截图 → 落报告 → 自退。用于 fixed/sticky 的**滚动锚定**证据
        //   （fixed 徽标滚动后屏幕位置不变 / sticky 条吸附）。与 Android `--es screen`/`--es scroll` 同语义。
        if let scArg = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--scroll=") }),
           let snArg = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--screen=") }),
           !ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("--tap=") }) {
            Self.tapMode = true
            let sName = String(snArg.dropFirst("--screen=".count))
            let dy = Double(String(scArg.dropFirst("--scroll=".count))) ?? 0
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                _ = evalJs?("__proteusSuperappNav(\(jsonQuote(sName)))")
                DispatchQueue.main.async {
                    renderCurrent()   // 新树 ⇒ offset 归零
                    // ★#1103 取证：**同进程内多次玻璃遍**——用来区分"某子段每遍都付"还是"进程首次付一次"。
                    //   #1102 的半径扫描每档只跑一遍玻璃遍，所以「radius=0 时 build 仍 4.58ms」
                    //   既可读成"每遍固定成本"也可读成"首次预热"，两者处置完全不同。
                    //   ⇒ 由 `PROTEUS_GLASS_SAMPLES`（默认 1 = 生产/既有行为）控制拖拽次数，
                    //     正负交替来回拖（避免一路拖到边界后 offset 不再变 ⇒ 不再触发玻璃遍）。
                    //   ★每次之间隔一个 runloop（`onScrollDrag` 异步生效——本文件已记过这个坑）。
                    let samples = max(1, Int(ProcessInfo.processInfo.environment["PROTEUS_GLASS_SAMPLES"] ?? "1") ?? 1)
                    func dragStep(_ i: Int) {
                        guard let vw = bridgeRef?.view else { return }
                        if i >= samples {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                                let offY = Double(bridgeRef?.view?.contentOffset.y ?? 0)
                                takeSnapshot()   // 画当前（已滚动）状态
                                switchLog.append(["scroll": sName, "dy": dy, "offset": offY, "current": currentName(), "ok": true, "via": "scroll-inject"])
                                writeReport(reportBody())
                                NSLog("[proteus] SUPERAPP_SCROLL_REPORT_READY page=%@ dy=%f offset=%f", sName, dy, offY)
                                if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
                            }
                            return
                        }
                        // 偶数步向下拖、奇数步向上拖（来回 ⇒ 每步都真的产生 offset 变化 ⇒ 每步都过玻璃遍）
                        let step = (i % 2 == 0) ? dy : -dy
                        _ = vw.driveScrollDrag(dx: 0, dy: CGFloat(step))
                        DispatchQueue.main.async { dragStep(i + 1) }
                    }
                    dragStep(0)
                }
            }
        }
        // ★★★v-pump / 跳变驱动动画判据（本批）：`--pump=<page>[,<ms>]`——导航到指定屏，让**泵周期驱动**
        //   跑一段（默认 1500ms），读宿主 native 计数（pump.calls/fire_ticks + anim_start_calls）→
        //   截图 + 落报告 + 自退。与 Android 的「L3 数字场持续跳变」判据同口径：
        //   ★判"动画在播"看**内核受理**（anim_start_calls / started），不看截屏像素（#793 判据纪律）。
        // ★★★Dactyl 专项（本批）：`--press=x,y`（内容坐标 vp）——注入 down→(hold)→up 真触摸序列，
        //   读交互反馈探针（按下态/场/动画计数）→ 报告 + 自退。★走 feedTouchSequence（与真触摸同分流器）。
        if let pa = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--press=") }) {
            Self.tapMode = true
            let body = String(pa.dropFirst("--press=".count))
            let parts = body.split(separator: ",")
            if parts.count >= 1 && parts[0] == "auto" {
                // ★自动定位（不猜坐标：按内核 rect 中心命中——本轮判据踩过"写死坐标落到容器"）
                let holdMs = parts.count >= 2 ? (Double(parts[1]) ?? 400) : 400
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    let r = bridgeRef?.pressAuto(holdMs: holdMs) ?? "{}"
                    NSLog("[proteus] SUPERAPP_PRESS_AUTO %@", r)
                    DispatchQueue.main.asyncAfter(deadline: .now() + holdMs / 1000.0) {
                        _ = bridgeRef?.driveTouchUp()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                            takeSnapshot()
                            switchLog.append(["press": "auto", "held_ms": holdMs, "current": currentName(), "ok": true, "via": "press-inject"])
                            writeReport(reportBody())
                            NSLog("[proteus] SUPERAPP_PRESS_REPORT_READY %@", evalJs?("proteusSelfDraw.interactionProbe()") ?? "null")
                            if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
                        }
                    }
                }
            } else if parts.count >= 2, let x = Double(parts[0]), let y = Double(parts[1]) {
                let heldMs = parts.count >= 3 ? (Double(parts[2]) ?? 400) : 400
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    // ★注入三段（与真触摸同一钩子链）：down 立即应用按下态 → 保持 → up 还原
                    _ = bridgeRef?.view?.driveTouchDown(x: x, y: y)
                    DispatchQueue.main.asyncAfter(deadline: .now() + heldMs / 1000.0) { _ = bridgeRef?.view?.driveTouchUp() }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        takeSnapshot()
                        switchLog.append(["press": body, "held_ms": heldMs, "current": currentName(), "ok": true, "via": "press-inject"])
                        writeReport(reportBody())
                        NSLog("[proteus] SUPERAPP_PRESS_REPORT_READY %@", evalJs?("proteusSelfDraw.interactionProbe()") ?? "null")
                        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
                    }
                }
            } else {
                NSLog("[proteus] SUPERAPP_PRESS_ARG_INVALID %@", pa)
            }
        }
        // ★★★（决策 #797 修）`--pan=auto[,screen]`：走 **pan 接管路径**（真机拖拽的真实分工：
        //   取消 touches → pan 每步续喂）——判据必须走这条路，driveTouch* 直调钩子是假绿。
        if let pn = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--pan=") }) {
            Self.tapMode = true
            let body = String(pn.dropFirst("--pan=".count))
            let parts = body.split(separator: ",")
            let navTo = parts.count >= 2 ? String(parts[1]) : ""
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                if !navTo.isEmpty {
                    _ = evalJs?("__proteusSuperappNav(\(jsonQuote(navTo)))")
                    DispatchQueue.main.async { renderCurrent() }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                    // ★异步分步（每步 50ms ⇒ 帧循环真的推 ~25 帧；同步循环里一帧都跑不了——已实测）
                    bridgeRef?.panFieldDragAsync(dx: 90, dy: 60, steps: 8, stepMs: 50) {
                        NSLog("[proteus] SUPERAPP_PAN_DRAG done")
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                        takeSnapshot()
                        switchLog.append(["pan": "auto", "screen": navTo, "current": currentName(), "ok": true, "via": "pan-inject"])
                        writeReport(reportBody())
                        NSLog("[proteus] SUPERAPP_PAN_REPORT_READY %@", evalJs?("proteusSelfDraw.interactionProbe()") ?? "null")
                        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
                    }
                }
            }
        }
        // ★★`--field=x,y,dx,dy`：按下 → 拖拽（MOVE 多次）→ 读场探针（证明每帧一次 FFI 真的推了）→ 抬指自退。
        if let fa = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--field=") }) {
            Self.tapMode = true
            let body = String(fa.dropFirst("--field=".count))
            let parts = body.split(separator: ",")
            if parts.count >= 1 && parts[0] == "auto" {
                // ★可带屏名：`--field=auto,l2`（先导航到该屏再注入——场在 L2 上，不在入口屏）
                let navTo = parts.count >= 2 ? String(parts[1]) : ""
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    if !navTo.isEmpty {
                        _ = evalJs?("__proteusSuperappNav(\(jsonQuote(navTo)))")
                        DispatchQueue.main.async { renderCurrent() }
                    }
                    // ★自动定位场容器（按内核 rect 中心——不猜坐标）
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                        let r = bridgeRef?.fieldAuto() ?? "{}"
                        NSLog("[proteus] SUPERAPP_FIELD_AUTO %@", r)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                            takeSnapshot()
                            switchLog.append(["field": "auto", "screen": navTo, "current": currentName(), "ok": true, "via": "field-inject"])
                            writeReport(reportBody())
                            NSLog("[proteus] SUPERAPP_FIELD_REPORT_READY %@", evalJs?("proteusSelfDraw.interactionProbe()") ?? "null")
                            if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
                        }
                    }
                }
            } else if parts.count >= 4, let x = Double(parts[0]), let y = Double(parts[1]),
               let dx = Double(parts[2]), let dy = Double(parts[3]) {
                let steps = parts.count >= 5 ? (Int(parts[4]) ?? 8) : 8
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    guard let v = bridgeRef?.view else { return }
                    // down（内容坐标）→ 逐段 MOVE（每段间隔一拍，让帧循环推几次）
                    _ = v.driveTouchDown(x: x, y: y)
                    var i = 0
                    func step() {
                        i += 1
                        let t = Double(i) / Double(steps)
                        v.driveTouchMove(x: x + dx * t, y: y + dy * t)
                        if i < steps {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { step() }
                        } else {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                takeSnapshot()
                                switchLog.append(["field": body, "steps": steps, "current": currentName(), "ok": true, "via": "field-inject"])
                                writeReport(reportBody())
                                NSLog("[proteus] SUPERAPP_FIELD_REPORT_READY %@", evalJs?("proteusSelfDraw.interactionProbe()") ?? "null")
                                if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
                            }
                        }
                    }
                    step()
                }
            }
        }
        if let pa = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--pump=") }) {
            Self.tapMode = true
            let body = String(pa.dropFirst("--pump=".count))
            let parts = body.split(separator: ",")
            let pName = parts.isEmpty ? "index" : String(parts[0])
            let holdMs = parts.count >= 2 ? (Double(parts[1]) ?? 1500) : 1500
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                _ = evalJs?("__proteusSuperappNav(\(jsonQuote(pName)))")
                DispatchQueue.main.async {
                    renderCurrent()   // 挂载（→ 泵驱动随 mount 起）
                    // 让泵跑 `holdMs`（确定性事件：定时读取，不是轮询）→ 读数 + 截图 + 报告 + 自退
                    DispatchQueue.main.asyncAfter(deadline: .now() + holdMs / 1000.0) {
                        takeSnapshot()
                        switchLog.append(["pump": pName, "hold_ms": holdMs, "current": currentName(), "ok": true, "via": "pump-probe"])
                        writeReport(reportBody())
                        let stats = rtHostRef?.pumpStats() ?? [:]
                        NSLog("[proteus] SUPERAPP_PUMP_REPORT_READY page=%@ %@", pName, String(describing: stats))
                        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
                    }
                }
            }
        }
        // ★★★决策 #1115：C26 响应体上限探针（`--fetch-limit-probe=<base>[,sizeMiB]`）。
        //   【为什么必须异步收尾、不能像 ws 探针那样在主线程循环】
        //     `http.request` 的回推是 `DispatchQueue.main.async`（见 http-capability.swift）——
        //     `reportBody()` 若在主线程里 `while + usleep` 等结果，回推永远排不上 ⇒ **死锁**
        //     （Android `TransferProbe` 已因同一坑改过一次，见其注释）。
        //   ⇒ 本分支：发起探针后**返回占位**，用 `asyncAfter` 链（确定性事件，不是盲等）
        //     周期性读结果，拿到就落报告并自退。★有界：deadline 60s，超时如实报"装置超时"。
        if let fpArg = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--fetch-limit-probe=") }) {
            Self.tapMode = true
            let body = String(fpArg.dropFirst("--fetch-limit-probe=".count))
            let parts = body.split(separator: ",").map(String.init)
            let base = parts.first ?? ""
            let sizeMiB = parts.count >= 2 ? (Double(parts[1]) ?? 64) : 64
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                _ = evalJs?("__proteusHostAppFetchLimitProbe(\(jsonQuote(base)),\(sizeMiB))")
                let deadline = Date().addingTimeInterval(60)
                var rounds = 0
                var lastRaw = ""
                // ★用递归 asyncAfter 而不是主线程循环：每轮让主 runloop 转起来，回推才能送达
                func poll() {
                    rounds += 1
                    let raw = evalJs?("String(globalThis.__proteusHostFetchLimitProbeResult || '')") ?? ""
                    if raw.isEmpty || raw == "null" || raw == "undefined" {
                        if Date() < deadline {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { poll() }
                            return
                        }
                    } else {
                        lastRaw = raw
                    }
                    var o = reportBody()
                    o["fetch_limit_base"] = base
                    o["fetch_limit_size_mib"] = sizeMiB
                    o["fetch_limit_probe_rounds"] = rounds
                    o["fetch_limit_probe"] = lastRaw.isEmpty ? "null" : lastRaw
                    if let d = lastRaw.data(using: .utf8),
                       let po = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
                        o["fetch_limit_ok"] = (po["ok"] as? Bool) ?? false
                    } else {
                        o["fetch_limit_ok"] = false
                        if lastRaw.isEmpty { o["fetch_limit_error"] = "探针超时（60s 内无结果）" }
                    }
                    takeSnapshot()
                    switchLog.append(["fetch_limit": base, "size_mib": sizeMiB, "rounds": rounds, "ok": o["fetch_limit_ok"] ?? false, "via": "fetch-limit-probe"])
                    writeReport(o)
                    NSLog("[proteus] SUPERAPP_FETCH_LIMIT_REPORT_READY ok=%@ rounds=%d", String(describing: o["fetch_limit_ok"] ?? false), rounds)
                    if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { poll() }
            }
        }
        // ★★★#1118：流式通道探针（S3）——`--stream-probe=<base>[,chunks,size,delayMs,slowMs]`
        if let spArg = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--stream-probe=") }) {
            Self.tapMode = true
            let body = String(spArg.dropFirst("--stream-probe=".count))
            let parts = body.split(separator: ",").map(String.init)
            let base = parts.first ?? ""
            let chunks = parts.count >= 2 ? (Int(parts[1]) ?? 256) : 256
            let size = parts.count >= 3 ? (Int(parts[2]) ?? 16384) : 16384
            let delayMs = parts.count >= 4 ? (Int(parts[3]) ?? 3) : 3
            let slowMs = parts.count >= 5 ? (Int(parts[4]) ?? 5) : 5
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                _ = evalJs?("__proteusHostAppStreamProbe(\(jsonQuote(base)),\(chunks),\(size),\(delayMs),\(slowMs))")
                let deadline = Date().addingTimeInterval(120)
                var rounds = 0
                var lastRaw = ""
                // ★与 fetch-limit 探针同款：递归 asyncAfter（主线程循环会饿死回推）
                func poll() {
                    rounds += 1
                    let raw = evalJs?("String(globalThis.__proteusHostStreamProbeResult || '')") ?? ""
                    if raw.isEmpty || raw == "null" || raw == "undefined" {
                        if Date() < deadline {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { poll() }
                            return
                        }
                    } else {
                        lastRaw = raw
                    }
                    var o = reportBody()
                    o["stream_base"] = base
                    o["stream_chunks"] = chunks
                    o["stream_probe_rounds"] = rounds
                    o["stream_probe"] = lastRaw.isEmpty ? "null" : lastRaw
                    o["host_stream_stats"] = BodyLimitDelegate.lastStatsSnapshot()
                    if let d = lastRaw.data(using: .utf8),
                       let po = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
                        o["stream_ok"] = (po["ok"] as? Bool) ?? false
                    } else {
                        o["stream_ok"] = false
                        if lastRaw.isEmpty { o["stream_error"] = "探针超时（120s 内无结果）" }
                    }
                    takeSnapshot()
                    switchLog.append(["stream": base, "chunks": chunks, "rounds": rounds, "ok": o["stream_ok"] ?? false, "via": "stream-probe"])
                    writeReport(o)
                    NSLog("[proteus] SUPERAPP_STREAM_REPORT_READY ok=%@ rounds=%d", String(describing: o["stream_ok"] ?? false), rounds)
                    if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { poll() }
            }
        }
        // ★★★#1118（位置修正）：本判断必须放在**所有探针分支之后**——
        //   此前它在 fetch-limit / stream-probe 分支之前 ⇒ 那两个分支设的 `tapMode = true` **赶不上**，
        //   `--drive` 的 steps 会抢先 `finish()` 并 `exit(0)` ⇒ 探针根本没跑就退出（实测：报告里无探针字段）。
        //   ★这是"分支顺序"型的静默失效：探针分支看着在、实际永远来不及生效。
        if !Self.tapMode {
            for (delay, step) in steps { DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: step) }
            DispatchQueue.main.asyncAfter(deadline: .now() + max(finishAt, 0.2)) { finish() }
        }
        NSLog("[proteus] SUPERAPP_LAUNCHER_READY")
    }

    // ── 状态读取 ──

    private static func readTabRegistry() {
        guard let st = evalJs?("__proteusSuperappState()"),
              let d = st.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
        tabNames = (o["tabs"] as? [String]) ?? []
        // ★★★B（决策 #800）：tab 渲染数据（tabItems/tabSpec/current）由 runtime 的 ProteusTabChrome
        //   从 state 解析并渲染——壳不再持有任何 tab 内容/样式字段（合并已在生成期完成）。
        // ★★★逐屏截图：全部屏名（boot 回包 `screens`——验收项目无 tab 时用）
        if let scr = o["screens"] as? [String], !scr.isEmpty {
            Self.allScreenNames = scr
        }
    }

    private static func currentName() -> String {
        guard let st = evalJs?("__proteusSuperappState()"),
              let d = st.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return "" }
        return (o["current"] as? String) ?? ""
    }

    // ── 上屏 ──

    /// 把**当前屏内容**真画到屏上（编译产物 app-screen-content.json → CALayer 层）。
    // ────────────────────────── ★★★C14 键盘（决策 #1069） ──────────────────────────

    /// 键盘推送是否已装（幂等——run 可能被多次调用）。实现见 `KeyboardWatch`（runtime 单元）。
    private static var keyboardWatched = false

    /// 装键盘监听：把本场景的 JSContext / 重渲出口 / 底部安全区交给 runtime 的 `KeyboardWatch`。
    /// 【为什么是"注入三个出口"而不是在这里实现】`selfdraw-scene.swift` 是 8800+ 行的存量棘轮文件
    ///   （只减不增）；而键盘读数必须与 env 表同源 ⇒ 状态放 runtime、巨型文件只读一行。
    private static func installKeyboardWatch() {
        if keyboardWatched { return }
        keyboardWatched = true
        KeyboardWatch.install(
            eval: { expr in evalJs?(expr) ?? "no-eval" },
            render: { renderCurrent() },
            safeBottom: { Double(container?.safeAreaInsets.bottom ?? 0) },
        )
    }

    private static func renderCurrent() {
        let page = currentName()
        guard let path = Bundle.main.path(forResource: "app-screen-content", ofType: "json"),
              let scData = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let scAll = (try? JSONSerialization.jsonObject(with: scData)) as? [String: Any] else {
            NSLog("[proteus] 缺 app-screen-content.json——无法上屏")
            return
        }
        let usePage = scAll[page] != nil ? page : (scAll["index"] != nil ? "index" : (scAll.keys.first ?? "index"))
        // ★★★B1：内容由 JS **共享运行期**实例化（交互/响应式/导航）；宿主只提供 mount/applyOps 原语。
        //   （app-screen-content.json 仍读入做屏名合法性校验 + 降级兜底。）
        guard scAll[usePage] != nil else { return }
        let vp = UIScreen.main.bounds
        // 用 JSON 序列化 args 并安全转义为 JS 字符串字面量（避免手拼引号）
        let args: [String: Any] = ["name": usePage, "viewport": ["width": Double(vp.width), "height": Double(vp.height)]]
        guard let ad = try? JSONSerialization.data(withJSONObject: args),
              let argsStr = String(data: ad, encoding: .utf8),
              let qd = try? JSONSerialization.data(withJSONObject: [argsStr], options: [.fragmentsAllowed]),
              let qArr = String(data: qd, encoding: .utf8) else { return }
        let argLiteral = String(qArr.dropFirst().dropLast())   // 去掉外层 [ ]
        let out = evalJs?("__proteusSuperappRender(\(argLiteral))") ?? "{\"ok\":false}"
        // ★★渲染失败必须**醒目且完整**（2026-10-08 · 用户抓出「iOS/鸿蒙背景页导航后仍是首页」）：
        //   宿主 mount 失败时 runtime 回 `{"ok":false,…,"hostReply":"…"}`——成功只记首段（日志不爆炸），
        //   失败记**完整回执**（含宿主原话：内核建树失败原因），使"屏幕没换"当场可归因（此前被静默丢弃）。
        var renderOut = out
        if out.contains("\"ok\":false") {
            NSLog("[proteus] SUPERAPP_RENDER_FAIL page=%@ runtime=%@", usePage, out)
        } else {
            renderOut = String(out.prefix(160))
        }
        NSLog("[proteus] SUPERAPP_RENDER page=%@ runtime=%@", usePage, renderOut)
        // ★重绘后刷新 tab 栏（chrome 内部 bringToFront——自绘每次重建层树，可能压住它）
        refreshChrome()
    }

    // ── Tab 栏（真实 UIButton · iOS 原生 chrome） ──

    /// ★★样式取自 **Web 真值**（App.vue `.sa-tabbar` + global.css token）：surface #ffffff · 顶边框 #dcdfe5 ·
    ///   选中 brand #5b5bd6 · 未选中 text-3 #5f6673 · 角标 rec #d64545（16 高、圆角 8）。
    ///   ★★**加到 `container.superview`**（不是 container）：自绘层都加在 SelfDrawView.layer 上，任何
    ///     后续重绘（切 tab → renderCurrent → buildLayers）都会把新层加到最上 ⇒ 会盖住加在 container 上的
    ///     tab 栏（实测：iOS 截图完全无 tab 栏）。加到 superview ⇒ 层级永远在自绘层之上。
    private static func tabBarParent() -> UIView? { container?.superview ?? container }

    /// ★★★B（决策 #800）：tab 栏 = runtime `ProteusTabChrome`（**唯一实现**）——本壳只做两件事：
    ///   ① 提供父视图（`container.superview`——自绘层之上）；② 提供切屏出口（onTap → switchTab）。
    private static func setupTabChrome() {
        guard let parent = tabBarParent() else { return }
        chrome.onTap = { name in switchTab(name, via: "user-tap") }
        chrome.attach(in: parent)
        refreshChrome()
    }

    /// 从 JS state 取运行期数据 → chrome 渲染（解析/合并/兜底全在 runtime；本壳零 tab 逻辑）。
    private static func refreshChrome() {
        guard let st = evalJs?("__proteusSuperappState()"),
              let d = st.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
        chrome.applyState(o)
    }

    // ── drive（验证脚本用：host 驱动切 tab） ──

    /** ★★★逐屏截图：导航到指定屏 → 渲染 → 截图（落 Documents/shot-<name>.png）。 */
    private static func driveToScreen(_ name: String, index: Int, total: Int) {
        _ = evalJs?("__proteusSuperappNav(\(jsonQuote(name)))")
        DispatchQueue.main.async {
            let cur = currentName()
            renderCurrent()
            refreshChrome()
            switchLog.append(["tap": name, "current": cur, "ok": cur == name, "via": "drive"])
            // 末屏（或每屏）截图——snapshotName 由调用方按屏名设置
            SelfDrawBridge.snapshotName = "shot-\(name)"
            takeSnapshot()
            SelfDrawBridge.snapshotName = "superapp"   // 复位（末态兼容旧消费方）
        }
    }

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
            refreshChrome()
            switchLog.append(["tap": name, "current": cur, "ok": cur == name, "via": via])
        }
    }

    /// ★★★B1：**返回上一屏**（右滑返回手势入口）——`__proteusSuperappBack()`（共享 router.back）→ 重绘。
    private static func goBack() {
        _ = evalJs?("__proteusSuperappBack()")
        DispatchQueue.main.async {
            renderCurrent()
            refreshChrome()
            switchLog.append(["tap": "back", "current": currentName(), "ok": true, "via": "swipe-back"])
        }
    }

    private static func jsonQuote(_ s: String) -> String {
        "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }

    // ── 收工 / 报告 ──

    private static func finish() {
        // ★真正画一帧再截图（常驻/drive 都要——视觉验收的证据；此前 iOS 缺视觉证据，只跑逻辑）
        takeSnapshot()
        if ProcessInfo.processInfo.arguments.contains("--drive") {
            writeReport(reportBody())
            NSLog("[proteus] SUPERAPP_LAUNCHER_REPORT_READY")
            if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
        } else {
            NSLog("[proteus] SUPERAPP_LAUNCHER_PERSISTENT（常驻——桌面点开形态）")
        }
    }

    /// 把**整个窗口**渲染成 PNG 落 Documents（含自绘内容 + 原生 Tab 栏）——真机视觉证据。
    private static func takeSnapshot() {
        guard let win = container?.window ?? container else { return }
        let bounds = win.bounds
        guard bounds.width > 0, bounds.height > 0 else { return }
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = UIScreen.main.scale
        let img = UIGraphicsImageRenderer(bounds: bounds, format: fmt).image { _ in
            win.drawHierarchy(in: bounds, afterScreenUpdates: true)
        }
        if let png = img.pngData() {
            // ★★★逐屏截图（2026-10-05 · 拆页后每页独立留证）：文件名取 `SelfDrawBridge.snapshotName`
            //   （driveToScreen 逐屏设为 `shot-<name>`；缺省 superapp——兼容既有消费方）。
            let nm = SelfDrawBridge.snapshotName.isEmpty ? "superapp" : SelfDrawBridge.snapshotName
            try? png.write(to: reportDir.appendingPathComponent("\(nm).png"))
            NSLog("[proteus] SUPERAPP_SNAPSHOT %@ %dx%d", nm, Int(bounds.width), Int(bounds.height))
        }
    }

    /// ★★★批次 48：**滚动钳制探针**——大幅拖拽后读 contentOffset，证明不会无限滚动。
    ///   内容页语义 = 装不下才滚、最多滚到内容底（与 Web 一致）。返回读数进报告（机器判据）。
    private static func scrollProbe() -> [String: Any] {
        guard let v = bridgeRef?.view else { return ["error": "view 未建立"] }
        var out: [String: Any] = ["range": v.verticalRange, "range_set": v.verticalRangeSet]
        // 1) 向上拖很多（内容应下滚，若装得下则恒 0；装不下则钳到 range）
        _ = v.driveScrollDrag(dx: 0, dy: -100000)   // 手指上移 100000 → 内容上滚
        out["after_drag_up_100k"] = Double(v.contentOffset.y)
        // 2) 向下拖很多（应回钳到 0，不得为负）
        _ = v.driveScrollDrag(dx: 0, dy: 100000)
        out["after_drag_down_100k"] = Double(v.contentOffset.y)
        // 3) ★横拖（用户实测「能一直拖着来回动」——横轴此前从不钳制）：应恒 0
        _ = v.driveScrollDrag(dx: -100000, dy: 0)
        out["after_drag_left_100k_x"] = Double(v.contentOffset.x)
        _ = v.driveScrollDrag(dx: 100000, dy: 0)
        out["after_drag_right_100k_x"] = Double(v.contentOffset.x)
        out["ok"] = (out["after_drag_up_100k"] as? Double ?? -1) >= 0
            && (out["after_drag_up_100k"] as? Double ?? 1e9) <= Double(v.verticalRange)
            && (out["after_drag_down_100k"] as? Double) == 0
            && (out["after_drag_left_100k_x"] as? Double) == 0
            && (out["after_drag_right_100k_x"] as? Double) == 0
        return out
    }

    private static func reportBody() -> [String: Any] {
        var o: [String: Any] = ["ok": true, "host_id": "ios", "tabs": tabNames, "switch_log": switchLog,
                                "scroll_probe": scrollProbe(),
                                "run_ts": Date().timeIntervalSince1970]
        // ★★★v-pump / 跳变驱动动画（本批·判据）：泵驱动与动画受理的 **native 计数**（真源，不经 JS）——
        //   `calls`/`fire_ticks` > 0 证明周期驱动真的在跑且真的写进了数据源；`anim_start_calls` 证明
        //   `v-animate`/`<Transition>` 走到了宿主动画入口（同 #793 判据纪律：看内核受理，不看截屏像素）。
        if let rt = rtHostRef { o["pump"] = rt.pumpStats() }
        // ★★★#1100（承接 #1099）：mount 相位归因——**字段名与 Android `SuperappActivity` 逐项对齐**，
        //   否则两端读数不可比（#1098 已立过这条纪律：两端 9 个字段名逐项一致）。
        //   iOS 特有项（`mount_rects_ms` / `mount_sample_ms`）如实另列：
        //     · `rects` = 读取+解析内核全量几何（Android 只在开滚动范围时读）；
        //     · `sample` = **恒 -1**（iOS 的像素自检在 mount 之外，mount 内无采样 ⇒ 不伪造 0）。
        //   -1 = 本路径未发生（增量路径无 wrap / 未开滚动范围）。
        if let rt = rtHostRef {
            o["mount_host_ms"] = rt.lastMountMs
            o["apply_ops_host_ms"] = rt.lastApplyOpsMs
            let ph = rt.mountPhaseStats()
            o["mount_measure_ms"] = ph["measure_ms"] ?? -1
            o["mount_layout_ms"] = ph["layout_ms"] ?? -1
            o["mount_wrap_ms"] = ph["wrap_ms"] ?? -1
            o["mount_emit_ms"] = ph["emit_ms"] ?? -1
            o["mount_scroll_ms"] = ph["scroll_ms"] ?? -1
            o["mount_rects_ms"] = ph["rects_ms"] ?? -1
            o["mount_sample_ms"] = ph["sample_ms"] ?? -1
            // ★#1100 第二层：emit（建层）内部三段——真机首轮实测 emit=85.6ms/93ms，必须拆开才知道砍哪段
            o["mount_flat_ms"] = ph["flat_ms"] ?? -1
            o["mount_layers_ms"] = ph["layers_ms"] ?? -1
            o["mount_post_ms"] = ph["post_ms"] ?? -1
            // ★#1100 第三层：post 的四个子项（sticky 落位 / CSS 动画 / SVG 描边 / 玻璃遍）
            o["mount_pin_ms"] = ph["pin_ms"] ?? -1
            o["mount_anim_ms"] = ph["anim_ms"] ?? -1
            o["mount_svg_ms"] = ph["svg_ms"] ?? -1
            o["mount_glass_ms"] = ph["glass_ms"] ?? -1
            // ★#1100：逐次 mount 的相位历史（首屏 93ms vs 热态 33ms —— 只报末次会把切屏成本低估 3 倍）
            o["mount_history"] = rt.mountPhaseHistory()
            // ★#1101：玻璃遍子相位（hide/raster/blur/metal/install + 捕获像素数 + 玻璃块数）
            o["glass_phase"] = rt.glassPhaseStats()
            // ★#1103：逐次玻璃遍读数（同进程内多条）——区分"每遍都付"vs"首次预热"
            o["glass_history"] = rt.glassPassHistory()
            // ★#1104：交互路径玻璃成本（每 vsync 重渲）——**只在取证开关下跑**：
            //   探针本身会推进若干帧并触发多次玻璃遍，若每次组装报告都跑，会污染正常读数
            //   （"测量动作改变被测对象"——本仓已因同类问题踩过）。
            if ProcessInfo.processInfo.environment["PROTEUS_GLASS_INTERACT"] == "1" {
                o["glass_interaction"] = rt.glassInteractionProbe(frames: 12)
            }
        }
        // ★#1098：P0 长任务读数（字段名与 Android/perf 面板一致）
        if let jd = JsTaskSampler.statsJson().data(using: .utf8),
           let js = (try? JSONSerialization.jsonObject(with: jd)) as? [String: Any] {
            o["jsTasks"] = js
        }
        // ★★★Dactyl 专项（本批）：三条交互反馈能力的**原生计数**（按下态/场跟手/伪元素动画）——
        //   判据读它证明"通路真的走过"（与 Android pressProbe/fieldProbe 同口径，不看截屏像素）。
        if let ip = evalJs?("proteusSelfDraw.interactionProbe()") { o["interaction_probe"] = ip }
        // ★★★Dactyl D0：触摸延迟采样探针 + 全量导出（量具从 Documents 取 dactyl-samples.json）
        if let sp = evalJs?("proteusSelfDraw.dactylSampleProbe()") { o["dactyl_samples"] = sp }
        // ★★★显影器数据出口（决策 #797 · 通用能力）：触摸轨迹（应用侧画"幽灵拖尾"）
        if let tr = evalJs?("proteusSelfDraw.dactylTouchTrailJson()") {
            o["dactyl_trail"] = tr
            if let d = tr.data(using: .utf8) { try? d.write(to: reportDir.appendingPathComponent("dactyl-trail.json")) }
        }
        if let dm = evalJs?("proteusSelfDraw.dactylMetricsJson()") {
            o["dactyl_metrics"] = dm
            // 落盘（量具/取回脚本读 Documents/dactyl-samples.json——与 Android filesDir 同款）
            if let d = dm.data(using: .utf8) {
                try? d.write(to: reportDir.appendingPathComponent("dactyl-samples.json"))
            }
        }
        if let st = evalJs?("__proteusSuperappState()"),
           let d = st.data(using: .utf8),
           let so = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            o["state"] = so
            o["rendered_page"] = so["current"] ?? ""
        }
        o["host_stats"] = (evalJs?("proteusHost.invoke('screen.stats', '{}')") ?? "null")
        // ★★★决策 #1081：元素查询（静态 id → nodeId → 内核矩形）——三端同一份探针
        o["element_registry"] = evalJs?("__proteusHostAppElementRegistry()") ?? "null"
        o["element_probe"] = evalJs?("__proteusHostAppElementRect('{}')") ?? "null"
        o["element_not_found"] = evalJs?("__proteusHostAppElementRect('{\"selector\":\"#no-such-element-xyz\"}')") ?? "null"
        // ★#1082：`.sa-item` 现在**受支持**（静态 class 已进产物）⇒ 应命中；伪类应 unsupported
        o["element_class_selector"] = evalJs?("__proteusHostAppElementRect('{\"selector\":\".sa-item\"}')") ?? "null"
        o["element_compound_selector"] = evalJs?("__proteusHostAppElementRect('{\"selector\":\"view.sa-item\"}')") ?? "null"
        // ★★★决策 #1083：录屏/截屏能力探针（iOS：有 isCaptured、无全局 PiP、有截屏通知）
        _ = evalJs?("__proteusHostAppCapture()")
        o["capture_probe"] = evalJs?("String(globalThis.__proteusCaptureProbeResult ?? 'null')") ?? "null"
        // ★★★决策 #1086：交叉观察真机判据（与 Android `ElementProbe` 同口径）
        o["isect_register"] = evalJs?(
            "(function(){var g=globalThis;var h=g.__proteusHostAppIntersection;"
            + "if(typeof h!=='function')return 'no-hook';"
            + "g.__ISECT_HITS=[];"
            + "return h('{\"selector\":\"#mine-row-dark\",\"thresholds\":[0,0.5,1]}',"
            + " function(r){g.__ISECT_HITS.push(Math.round(r.intersectionRatio*100));});})()") ?? "null"
        o["isect_initial"] = evalJs?("JSON.stringify(globalThis.__ISECT_HITS||[])") ?? "[]"
        o["isect_initial_hits"] = evalJs?("String((globalThis.__ISECT_HITS||[]).length)") ?? "0"
        // ★主动再评估一次（模拟滚动后的 tick；生产由宿主自动调）→ 记录滚动后回调
        o["isect_retick"] = evalJs?("String(typeof __proteusSuperappIntersectionTick==='function'?__proteusSuperappIntersectionTick():-1)") ?? "-1"
        o["isect_after"] = evalJs?("JSON.stringify(globalThis.__ISECT_HITS||[])") ?? "[]"
        o["isect_after_hits"] = evalJs?("String((globalThis.__ISECT_HITS||[]).length)") ?? "0"
        // ★同位几何探针：证明"此刻几何腿可取"（否则"没回调"无法归因）
        o["isect_rect_probe"] = evalJs?("__proteusHostAppElementRect('{\"selector\":\"#mine-row-dark\"}')") ?? "null"
        // ★判据：至少一次初始回调（链路通的最低证据）
        o["isect_ok"] = ((o["isect_initial_hits"] as? String).flatMap(Int.init) ?? 0) >= 1
        o["element_pseudo_selector"] = evalJs?("__proteusHostAppElementRect('{\"selector\":\"view:hover\"}')") ?? "null"
        // ★★★决策 #1095：C29/C30 App 腿上/下载——**iOS 判据只验派发通路，不等响应**。
        //
        // 【★为什么不等（决策 #1065 已经写过同一个教训，本轮第二次踩）】
        //   `reportBody()` 是「建树 → 同步读读数 → 落盘」的**单相位**结构；
        //   真实网络回推要等宿主主循环转起来才送达。在里面 await 一次 http 响应
        //   会把整条上报链卡死（实测 5408 轮、服务端已回 4096B、JS 结果为零）。
        //   ⇒ 与该决策的结论一致：**判据要放在能观测到该事实的地方**。
        //     iOS 这里只判「派发通路通不通」，完整往返由 **Android 真机探针**覆盖（已全绿）。
        //
        // 【本轮在 iOS 上已经用**同步**腿取到的证据】
        //   `fs_sync` = { write:{size:3}, read:{bytes:[7,8,9]}, same:true, remove:true }
        //   ⇒ 宿主 fs 三方法 + JS 桥**完全正常**（不依赖异步/HTTP）。
        if let tUrl = ProcessInfo.processInfo.environment["PROTEUS_TRANSFER_PROBE_URL"], !tUrl.isEmpty {
            o["transfer_url"] = tUrl
            // ★同步证一轮 fs 往返（与上面 diag 同形，但结果进正式字段）
            let fsProbe = evalJs?(
                "(function(){var R={};try{"
                + "var w=JSON.parse(proteusHost.invoke('fs.writeBytes',JSON.stringify({path:'probe/t.bin',bytes:[1,2,3,255]})));"
                + "var r=JSON.parse(proteusHost.invoke('fs.readBytes',JSON.stringify({path:'probe/t.bin'})));"
                + "var same=!!(r&&r.ok&&r.data&&r.data.bytes&&r.data.bytes.length===4"
                + "&&r.data.bytes[0]===1&&r.data.bytes[1]===2&&r.data.bytes[2]===3&&r.data.bytes[3]===255);"
                + "JSON.parse(proteusHost.invoke('fs.remove',JSON.stringify({path:'probe/t.bin'})));"
                + "R.writeOk=!!(w&&w.ok);R.readOk=!!(r&&r.ok);R.same=same;"
                + "}catch(e){R.throw=String(e&&e.message?e.message:e)}return JSON.stringify(R)})()") ?? "null"
            o["transfer_fs"] = fsProbe
            var fsOk = false
            if let fd = fsProbe.data(using: .utf8),
               let fo = (try? JSONSerialization.jsonObject(with: fd)) as? [String: Any] {
                fsOk = (fo["writeOk"] as? Bool) == true && (fo["readOk"] as? Bool) == true && (fo["same"] as? Bool) == true
            }
            o["transfer_fs_ok"] = fsOk
            // ★派发通路：发起调用，**不等待**（结果由后续批次/Android 探针覆盖）
            let kick = evalJs?("__proteusHostAppTransferProbe(" + Self.jsQuote(tUrl) + ")") ?? "null"
            o["transfer_dispatch"] = kick
            o["transfer_dispatch_ok"] = kick.contains("queued")
            o["transfer_ok"] = fsOk && kick.contains("queued")
            o["transfer_note"] = "iOS 判据 = 宿主 fs 往返（同步）+ 派发通路；完整 4096B 往返由 Android 真机探针覆盖"
        } else {
            o["transfer_probe"] = "skipped (PROTEUS_TRANSFER_PROBE_URL 未设置)"
            o["transfer_ok"] = false
        }

        // ★★★决策 #1093：C27 WebSocket 端到端（与 Android WebSocketProbe 同口径）。
        //   探针 URL 由**环境变量**注入（iOS 真机无 adb reverse ⇒ 必须走局域网 IP）；
        //   未注入则跳过（如实标 skipped，不冒充通过）。
        if let wsUrl = ProcessInfo.processInfo.environment["PROTEUS_WS_PROBE_URL"], !wsUrl.isEmpty {
            o["ws_url"] = wsUrl
            _ = evalJs?("__proteusHostAppWsProbe(" + Self.jsQuote(wsUrl) + ")")
            var rounds = 0
            var lastPhase = ""
            let deadline = Date().addingTimeInterval(60)
            while Date() < deadline {
                // ★泵：Promise 回调与推送分发都要主线程跑 JS——先就地消费推送，再驱动状态机
                _ = rtHostRef?.drainWsPending()
                let dv = evalJs?("typeof __proteusHostAppWsProbeDrive==='function'?__proteusHostAppWsProbeDrive():'{}'") ?? "{}"
                rounds += 1
                if let d = dv.data(using: .utf8),
                   let dj = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
                    lastPhase = (dj["phase"] as? String) ?? "?"
                    if (dj["done"] as? Bool) == true { break }
                }
                usleep(10_000)   // 10ms（有界轮询；deadline 60s）
            }
            o["ws_probe_rounds"] = rounds
            o["ws_probe_last_phase"] = lastPhase
            o["ws_probe"] = evalJs?("String(globalThis.__proteusHostWsProbeResult || 'null')") ?? "null"
            if let pj = o["ws_probe"] as? String, let pd = pj.data(using: .utf8),
               let po = (try? JSONSerialization.jsonObject(with: pd)) as? [String: Any] {
                o["ws_ok"] = (po["ok"] as? Bool) ?? false
            } else {
                o["ws_ok"] = false
            }
        } else {
            o["ws_probe"] = "skipped (PROTEUS_WS_PROBE_URL 未设置)"
            o["ws_ok"] = false
        }
        // 独立交叉核对（内核 readRects 里同一 nodeId 的矩形）
        if let pj = o["element_probe"] as? String, let pd = pj.data(using: .utf8),
           let po = (try? JSONSerialization.jsonObject(with: pd)) as? [String: Any],
           let nid = po["nodeId"] as? Int,
           let rj = evalJs?("proteusSelfDraw.readRects()"), let rd = rj.data(using: .utf8),
           let ro = (try? JSONSerialization.jsonObject(with: rd)) as? [String: Any],
           let rects = ro["rects"] as? [String: Any], let kr = rects[String(nid)] as? [String: Any] {
            o["kernel_rect"] = kr
            let kx = (kr["x"] as? Double) ?? 0, ky = (kr["y"] as? Double) ?? 0
            let kw = (kr["width"] as? Double) ?? 0, kh = (kr["height"] as? Double) ?? 0
            let sx = (po["scrollY"] as? Double) ?? 0
            o["cross_check_ok"] = abs(kx - ((po["left"] as? Double) ?? -1e9)) < 0.51
                && abs(ky - (((po["top"] as? Double) ?? -1e9) + sx)) < 0.51
                && abs(kw - ((po["width"] as? Double) ?? -1e9)) < 0.51
                && abs(kh - ((po["height"] as? Double) ?? -1e9)) < 0.51
        } else {
            o["cross_check_ok"] = false
        }
        return o
    }

    private static func writeReport(_ body: [String: Any]) {
        if let d = try? JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted, .sortedKeys]) {
            try? d.write(to: reportDir.appendingPathComponent("superapp.json"))
        }
    }
}
