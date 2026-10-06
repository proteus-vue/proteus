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
    private static var container: UIView?
    private static var tabNames: [String] = []
    /** ★★★逐屏截图：全部屏名（boot 回包 / registry.screens 的键——验收项目无 tab 时用）。 */
    private static var allScreenNames: [String] = []
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
        // ★★★批次 48（用户：iOS 页面内容能一直拖着来回动）：**开启内容滚动范围钳制**——
        //   内容页语义 = 装不下才滚、最多滚到内容底（与 Web 一致）。此前只有 stress 场景开了它，
        //   superapp 没开 ⇒ `applyContentOffset` 无界拖拽（iOS 特有，Android 已 enable）。范围由
        //   渲染路径从内核 rects 的 maxBottom − 视口高推导（见 selfdraw-scene 的 rects 块）。
        SelfDrawBridge.contentScrollRangeEnabled = true
        // ② 宿主桥（screen.* + 能力）——与 AppStackScene 同一份
        let hostBridge = HostRuntimeBridge()
        hostBridge.jsContextRef = ctx.jsGlobalContextRef
        // ★★★B1：壳走**统一运行期**——proteusHost = SuperappRuntimeHost（mount/applyOps/readRects/onGesture
        //   原语，交互/响应式/导航全在共享 JS 层）；旧静态屏内容改由 JS 侧 __proteusSuperappRender 实例化。
        let rtHost = SuperappRuntimeHost(draw: bridge, caps: hostBridge)
        rtHost.jsContext = ctx
        ctx.setObject(rtHost, forKeyedSubscript: "proteusHost" as NSString)
        // ★手势命中链 → JS 运行期（SelfDrawBridge 命中后反向调 JS 注册的 `__proteusRuntimeGesture`）。
        bridge.onDispatchToJS = { target, chain, type, _, _ in
            rtHost.dispatchGestureToJS(type: type, target: target, chain: chain)
        }
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
        NSLog("[proteus] SUPERAPP_RENDER page=%@ runtime=%@", usePage, String(out.prefix(160)))
        // ★重绘后把 tab 栏提到最上层（自绘每次重建层树，可能压住它——见 buildTabBar 层级注释）
        if let p = tabBarParent(), let bar = p.viewWithTag(771001) { p.bringSubviewToFront(bar) }
    }

    // ── Tab 栏（真实 UIButton · iOS 原生 chrome） ──

    /// ★★样式取自 **Web 真值**（App.vue `.sa-tabbar` + global.css token）：surface #ffffff · 顶边框 #dcdfe5 ·
    ///   选中 brand #5b5bd6 · 未选中 text-3 #5f6673 · 角标 rec #d64545（16 高、圆角 8）。
    ///   ★★**加到 `container.superview`**（不是 container）：自绘层都加在 SelfDrawView.layer 上，任何
    ///     后续重绘（切 tab → renderCurrent → buildLayers）都会把新层加到最上 ⇒ 会盖住加在 container 上的
    ///     tab 栏（实测：iOS 截图完全无 tab 栏）。加到 superview ⇒ 层级永远在自绘层之上。
    private static func tabBarParent() -> UIView? { container?.superview ?? container }

    private static func buildTabBar() {
        guard let parent = tabBarParent() else { return }
        // ★★全端对齐批（2026-10-05 · css-conformance 视觉验收抓出）：**无 tab 的应用不建 tab 栏**——
        //   此前无条件建 52pt 白底条 ⇒ 验收项目（tabs=[]）底部出现一条与 Web 基准不符的白带
        //   （"页面未铺满"的真相）。空 tab 语义 = 无 tabBar（与 MP 端"未声明 tabBar 就无 tabBar"同源）。
        guard !tabNames.isEmpty else { return }
        let h: CGFloat = 52
        let w = parent.bounds.width
        let barY = parent.bounds.height - h
        let bar = UIView(frame: CGRect(x: 0, y: barY, width: w, height: h))
        bar.backgroundColor = UIColor(red: 0xFF/255.0, green: 0xFF/255.0, blue: 0xFF/255.0, alpha: 1)
        bar.tag = 771001
        // 顶边框（Web: border-top 1px --sa-line）
        let line = UIView(frame: CGRect(x: 0, y: 0, width: w, height: 1.0 / UIScreen.main.scale))
        line.backgroundColor = UIColor(red: 0xDC/255.0, green: 0xDF/255.0, blue: 0xE5/255.0, alpha: 1)
        bar.addSubview(line)
        let current = currentName()
        let unread = imUnreadValue()
        for (i, name) in tabNames.enumerated() {
            let bw = w / CGFloat(max(1, tabNames.count))
            let item = UIView(frame: CGRect(x: bw * CGFloat(i), y: 0, width: bw, height: h))
            item.tag = 771000 + i
            let on = (current == name)
            let tint = on ? UIColor(red: 0x5B/255.0, green: 0x5B/255.0, blue: 0xD6/255.0, alpha: 1)
                          : UIColor(red: 0x5F/255.0, green: 0x66/255.0, blue: 0x73/255.0, alpha: 1)
            // 图标（19px，文本呈现——加 U+FE0E 变体选择符，避免渲染成彩色 emoji）
            let ic = UILabel(frame: CGRect(x: 0, y: 8, width: bw, height: 22))
            ic.text = tabIcon(name) + "\u{FE0E}"
            ic.font = UIFont.systemFont(ofSize: 19)
            ic.textColor = tint
            ic.textAlignment = .center
            item.addSubview(ic)
            // 文字（10px）
            let tx = UILabel(frame: CGRect(x: 0, y: 30, width: bw, height: 14))
            tx.text = tabShortLabel(name)
            tx.font = UIFont.systemFont(ofSize: 10)
            tx.textColor = tint
            tx.textAlignment = .center
            item.addSubview(tx)
            // IM 角标（Web: rec #d64545，min-width 16、高 16、圆角 8、白字 11）
            if name == "messages" && unread > 0 {
                let badge = UILabel(frame: CGRect(x: bw / 2 + 4, y: 4, width: 16, height: 16))
                badge.text = unread > 99 ? "99+" : "\(unread)"
                badge.font = UIFont.systemFont(ofSize: 11, weight: .semibold)
                badge.textColor = .white
                badge.textAlignment = .center
                badge.backgroundColor = UIColor(red: 0xD6/255.0, green: 0x45/255.0, blue: 0x45/255.0, alpha: 1)
                badge.layer.cornerRadius = 8
                badge.layer.masksToBounds = true
                item.addSubview(badge)
            }
            let tap = UITapGestureRecognizer(target: self, action: #selector(onTabItemTap(_:)))
            item.addGestureRecognizer(tap)
            item.isUserInteractionEnabled = true
            bar.addSubview(item)
        }
        parent.addSubview(bar)
    }

    @objc private static func onTabItemTap(_ g: UITapGestureRecognizer) {
        guard let item = g.view else { return }
        let idx = item.tag - 771000
        guard idx >= 0, idx < tabNames.count else { return }
        switchTab(tabNames[idx], via: "user-tap")
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

    /** ★★★逐屏截图：导航到指定屏 → 渲染 → 截图（落 Documents/shot-<name>.png）。 */
    private static func driveToScreen(_ name: String, index: Int, total: Int) {
        _ = evalJs?("__proteusSuperappNav(\(jsonQuote(name)))")
        DispatchQueue.main.async {
            let cur = currentName()
            renderCurrent()
            highlightTab(cur)
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
            highlightTab(cur)
            switchLog.append(["tap": name, "current": cur, "ok": cur == name, "via": via])
        }
    }

    /// ★★★B1：**返回上一屏**（右滑返回手势入口）——`__proteusSuperappBack()`（共享 router.back）→ 重绘。
    private static func goBack() {
        _ = evalJs?("__proteusSuperappBack()")
        DispatchQueue.main.async {
            renderCurrent()
            highlightTab(currentName())
            switchLog.append(["tap": "back", "current": currentName(), "ok": true, "via": "swipe-back"])
        }
    }

    private static func highlightTab(_ current: String) {
        guard let bar = tabBarParent()?.viewWithTag(771001) else { return }
        let onC = UIColor(red: 0x5B/255.0, green: 0x5B/255.0, blue: 0xD6/255.0, alpha: 1)
        let offC = UIColor(red: 0x5F/255.0, green: 0x66/255.0, blue: 0x73/255.0, alpha: 1)
        for (i, name) in tabNames.enumerated() {
            guard let item = bar.viewWithTag(771000 + i) else { continue }
            let c = (name == current) ? onC : offC
            for sub in item.subviews {
                if let l = sub as? UILabel, sub.tag != 771002 { l.textColor = c }
            }
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
