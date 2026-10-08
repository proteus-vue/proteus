// {{appName}} —— iOS 宿主入口（Proteus CLI 生成 · 运行期形态）
//
// 【它做什么（与 Android AppActivity / 鸿蒙 Superapp.ets 同形）】把**项目编译产物**经
//   **共享运行期**真上屏：
//     ① 解 bundle 源（release：内嵌 `bundle-superapp.js`；dev：HTTP dev server）
//     ② JSContext 注入运行期桥（`proteusHost` = SuperappRuntimeHost：mount/applyOps/readRects/onGesture）
//     ③ eval bundle → `__proteusSuperappBootJson()`（路由栈装配 + 入口 tab）
//     ④ `__proteusSuperappRender({name,viewport})` → 运行期实例化 → 宿主 mount → CALayer 上屏
//     ⑤ 底部 Tab 栏（有 tab 时；原生 UIButton）+ 点击切页
//   ★本壳**不含项目身份/业务逻辑**（包名/页名从 Info.plist 与产物读）；换项目只换产物 + bundle。
//
// 【dev 变体（`proteus dev --target ios`）】`ProteusBuildConfig.DEV=true` 时：
//   bundle 走 dev server（URLSession + 有限重试）→ 轮询 `/version` → 变更即**重载**
//   （重建 JSContext + 重 eval + 重 boot + 重渲染，保留当前屏）。release 读内嵌资产、无网络。
//
// 【诚实边界】a) 热刷范围 = **页面内容**（JS/样式/路由/tab）——原生插件热插拔属 G-45（另一条线）；
//   b) dev 需签名（本机 provisioning profile）；iOS 动态下发的是**数据 bundle**（非可执行代码），不触商店红线。
import UIKit
import JavaScriptCore

/* ────────────────────────── 宿主驱动（引擎 + 运行期装配） ────────────────────────── */

/// 一个"可重载"的宿主实例：持一枚 JSContext + 桥 + 视图。dev 热刷 = 丢弃旧的、按新 bundle 建新的。
final class ProteusHostDriver {
    let bridge = SelfDrawBridge()
    let view: SelfDrawView
    /// 能力 + screen.* 桥（运行期 `proteusHost.invoke` 的落点）
    private let caps = HostRuntimeBridge()
    private var ctx: JSContext?
    /// 当前屏名（渲染后由 JS 回读；用于重载后保留屏幕）
    private(set) var currentPage = "index"
    /// 底部 Tab 栏状态
    private var tabNames: [String] = []
    private var tabLabels: [String: String] = [:]
    private var tabSpec: [String: Any] = [:]
    private var tabIcons: [String: String] = [:]
    private var tabBar: UIView?

    init(frame: CGRect) {
        view = SelfDrawView(frame: frame)
        view.backgroundColor = .black
        bridge.view = view
        // 触摸 → 命中 → JS 派发（与参考宿主壳同一条链）
        view.onGesture = { [weak self] x, y, type in
            self?.bridge.emitGesture(x: x, y: y, type: type)
        }
        // 真手势滚动接线（`SelfDrawView` 的 pan 识别器唯一出口）
        view.onScrollDrag = { [weak self] dx, dy in
            self?.bridge.scrollDragBy(dx: Double(dx), dy: Double(dy)) ?? "{\"ok\":false,\"error\":\"bridge 已释放\"}"
        }
        // 内容滚动范围钳制（内容页语义 = 装不下才滚、最多滚到内容底；与 Web/Android 一致）
        SelfDrawBridge.contentScrollRangeEnabled = true
    }

    /// 用给定 bundle 源**新建上下文并启动**（重载即再调一次——旧 ctx 由 ARC 回收）。
    @discardableResult
    func start(bundleSource: String, embedView: UIView) -> String {
        guard let ctx = JSContext() else { return "{\"ok\":false,\"error\":\"JSContext 创建失败\"}" }
        self.ctx = ctx
        // ① 平台标识（TS 侧自报——三端同契约）
        _ = ctx.evaluateScript("var __PROTEUS_HOST_ID__ = 'ios';")
        _ = ctx.evaluateScript("var __PROTEUS_HOST_FRAME_DRIVER__ = 'CADisplayLink';")
        // ② 运行期桥（mount/applyOps/readRects/onGesture + invoke/memUsage/gc/post）
        caps.jsContextRef = ctx.jsGlobalContextRef
        let rtHost = SuperappRuntimeHost(draw: bridge, caps: caps)
        rtHost.jsContext = ctx
        ctx.setObject(rtHost, forKeyedSubscript: "proteusHost" as NSString)
        // 手势命中链 → JS 运行期（SelfDrawBridge 命中后反向调 JS 注册的回调）
        // 签名 = (target:Int, chain:[Int], type:String, x:Double, y:Double)
        bridge.onDispatchToJS = { target, chain, type, _, _ in
            rtHost.dispatchGestureToJS(type: type, target: target, chain: chain)
        }
        ctx.exceptionHandler = { _, exc in
            NSLog("[proteus] JS 异常: %@", exc?.toString() ?? "?")
        }
        // ③ eval bundle + boot（路由栈装配 + 入口 tab）
        _ = ctx.evaluateScript(bundleSource)
        let boot = ctx.evaluateScript("__proteusSuperappBootJson()")?.toString() ?? "null"
        if !boot.contains("\"ok\":true") {
            NSLog("[proteus] PROTEUS_HOST_BOOT_FAIL %@", String(boot.prefix(240)))
            return "{\"ok\":false,\"error\":\"boot 失败\",\"raw\":\(jsonEscape(String(boot.prefix(240))))}"
        }
        readTabRegistry(ctx)
        // ④ 上屏当前屏 + 建 tab 栏
        let out = renderCurrent(ctx)
        buildTabBar(in: embedView)
        // ★安全区：`start` 在布局前同步调用 ⇒ `view.safeAreaInsets` 尚未就绪 ⇒ 下一 runloop 重渲一次
        //   （"布局后重渲"是确定性事件，非盲等）
        DispatchQueue.main.async { [weak self] in self?.renderCurrent(ctx) }
        return out
    }

    /// 把当前屏真画到屏上（运行期实例化 → 宿主 mount → CALayer）
    @discardableResult
    func renderCurrent(_ ctx: JSContext? = nil) -> String {
        guard let ctx = ctx ?? self.ctx else { return "{\"ok\":false,\"error\":\"无 JSContext\"}" }
        let page = currentName(ctx)
        currentPage = page
        let vp = view.bounds.size.width > 0 ? view.bounds.size : UIScreen.main.bounds.size
        let args: [String: Any] = ["name": page, "viewport": ["width": Double(vp.width), "height": Double(vp.height)]]
        guard let ad = try? JSONSerialization.data(withJSONObject: args),
              let argsStr = String(data: ad, encoding: .utf8) else { return "{\"ok\":false}" }
        let argsLit = jsonEscape(argsStr)   // JSON 字符串字面量（带引号）
        let out = ctx.evaluateScript("__proteusSuperappRender(\(argsLit))")?.toString() ?? "{\"ok\":false}"
        if out.contains("\"ok\":false") {
            NSLog("[proteus] PROTEUS_HOST_RENDER_FAIL page=%@ %@", page, out)
        } else {
            NSLog("[proteus] PROTEUS_HOST_RENDER page=%@ ok", page)
        }
        return out
    }

    /// 导航到指定屏（dev 重载后保留屏幕 / tab 点击）
    func navigate(to name: String) {
        guard let ctx else { return }
        _ = ctx.evaluateScript("__proteusSuperappNav(\(jsonEscape(name)))")
        DispatchQueue.main.async { [weak self] in
            _ = self?.renderCurrent(ctx)
            self?.highlightTab()
        }
    }

    /// 返回上一屏（运行期 router.back）
    func goBack() {
        guard let ctx else { return }
        _ = ctx.evaluateScript("__proteusSuperappBack()")
        DispatchQueue.main.async { [weak self] in
            _ = self?.renderCurrent(ctx)
            self?.highlightTab()
        }
    }

    // ── 状态读取 ──

    private func superappState(_ ctx: JSContext) -> [String: Any] {
        guard let s = ctx.evaluateScript("__proteusSuperappState()")?.toString(),
              let d = s.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return [:] }
        return o
    }

    private func currentName(_ ctx: JSContext) -> String {
        (superappState(ctx)["current"] as? String) ?? currentPage
    }

    private func readTabRegistry(_ ctx: JSContext) {
        let o = superappState(ctx)
        tabNames = (o["tabs"] as? [String]) ?? []
        tabLabels = (o["tabLabels"] as? [String: String]) ?? [:]
        if let sp = o["tabSpec"] as? [String: Any] {
            tabSpec = sp
            tabIcons = (sp["icons"] as? [String: String]) ?? [:]
            if let l = sp["labels"] as? [String: String] { tabLabels = l }
        }
    }

    // ── Tab 栏（原生 UIButton；无 tab 不建 —— 与 Web/MP「未声明 tabBar 即无 tabBar」同源）──

    private func buildTabBar(in host: UIView) {
        tabBar?.removeFromSuperview()
        tabBar = nil
        guard !tabNames.isEmpty else { return }
        let h = CGFloat((tabSpec["height"] as? NSNumber)?.doubleValue ?? 56)
        let w = host.bounds.width
        let bar = UIView(frame: CGRect(x: 0, y: host.bounds.height - h, width: w, height: h))
        bar.backgroundColor = specColor("surface", 0xFFFFFF)
        bar.tag = 771001
        let line = UIView(frame: CGRect(x: 0, y: 0, width: w, height: 1.0 / UIScreen.main.scale))
        line.backgroundColor = specColor("line", 0xDCDFE5)
        bar.addSubview(line)
        for (i, name) in tabNames.enumerated() {
            let bw = w / CGFloat(max(1, tabNames.count))
            let item = UIButton(frame: CGRect(x: bw * CGFloat(i), y: 0, width: bw, height: h))
            item.tag = 771000 + i
            item.accessibilityIdentifier = name
            item.addTarget(self, action: #selector(onTabTap(_:)), for: .touchUpInside)
            bar.addSubview(item)
        }
        host.addSubview(bar)
        tabBar = bar
        highlightTab()
    }

    @objc private func onTabTap(_ sender: UIButton) {
        guard let name = sender.accessibilityIdentifier else { return }
        navigate(to: name)
    }

    /// 逐 tab 上下色（选中品牌色 / 未选中灰）；字形与文案用 UILabel 叠在按钮上。
    private func highlightTab() {
        guard let bar = tabBar, let ctx else { return }
        let cur = currentName(ctx)
        let on = specColor("brand", 0x5B5BD6)
        let off = specColor("text3", 0x5F6673)
        for (i, name) in tabNames.enumerated() {
            guard let item = bar.viewWithTag(771000 + i) else { continue }
            item.subviews.forEach { $0.removeFromSuperview() }
            let bw = item.bounds.width
            let tint = (name == cur) ? on : off
            let ic = UILabel(frame: CGRect(x: 0, y: 6, width: bw, height: 22))
            ic.text = (tabIcons[name].flatMap { $0.isEmpty ? nil : $0 } ?? "•") + "\u{FE0E}"
            ic.font = UIFont.systemFont(ofSize: CGFloat((tabSpec["iconSize"] as? NSNumber)?.doubleValue ?? 19))
            ic.textColor = tint
            ic.textAlignment = .center
            item.addSubview(ic)
            let tx = UILabel(frame: CGRect(x: 0, y: 29, width: bw, height: 14))
            tx.text = tabLabels[name] ?? name
            tx.font = UIFont.systemFont(ofSize: CGFloat((tabSpec["labelSize"] as? NSNumber)?.doubleValue ?? 10))
            tx.textColor = tint
            tx.textAlignment = .center
            item.addSubview(tx)
        }
    }

    private func specColor(_ key: String, _ fallback: UInt32) -> UIColor {
        if let hex = tabSpec[key] as? String, let c = parseHexColor(hex) { return c }
        return UIColor(red: CGFloat((fallback >> 16) & 0xFF) / 255.0,
                       green: CGFloat((fallback >> 8) & 0xFF) / 255.0,
                       blue: CGFloat(fallback & 0xFF) / 255.0, alpha: 1)
    }
}

/* ────────────────────────── bundle 源（dev/release 的唯一分叉点） ────────────────────────── */

enum BundleSource {
    /// 解出 bundle 源：DEV ⇒ HTTP dev server（有限重试）；否则读内嵌 `bundle-superapp.js`。
    static func load() -> String? {
        if ProteusBuildConfig.DEV, let base = devServerBase() {
            for i in 0..<5 {
                if let s = httpGetText(base + "/bundle"), !s.isEmpty {
                    NSLog("[proteus] PROTEUS_DEV_BUNDLE_FROM_SERVER bytes=%d base=%@ try=%d", s.utf8.count, base, i)
                    return s
                }
                Thread.sleep(forTimeInterval: 0.3 * Double(i + 1))   // 覆盖"App 先于 server ready"的时序竞争
            }
            NSLog("[proteus] PROTEUS_DEV_BUNDLE_FETCH_FAIL base=%@ 回落内嵌", base)
        }
        guard let path = Bundle.main.path(forResource: "bundle-superapp", ofType: "js"),
              let src = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
        return src
    }

    /// dev server 基址：启动参数 `--proteusDev <url>` 优先，其次编译期注入的 DEV_URL。
    static func devServerBase() -> String? {
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "--proteusDev"), i + 1 < args.count, !args[i + 1].isEmpty { return args[i + 1] }
        return ProteusBuildConfig.DEV_URL.isEmpty ? nil : ProteusBuildConfig.DEV_URL
    }

    /// 同步 GET（dev 通道用；仅 DEV 变体走到）。URLSession 同步封装（semaphore 有界等待）。
    static func httpGetText(_ url: String) -> String? {
        guard let u = URL(string: url) else { return nil }
        var req = URLRequest(url: u)
        req.timeoutInterval = 8
        var out: String?
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { data, _, _ in
            if let d = data, !d.isEmpty { out = String(data: d, encoding: .utf8) }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 10)
        return out
    }
}

/* ────────────────────────── 应用入口 + 场景 ────────────────────────── */

@main
final class ProteusAppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        NSLog("[proteus] {{appName}} didFinishLaunching")
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c = UISceneConfiguration(name: "Default", sessionRole: session.role)
        c.delegateClass = ProteusSceneDelegate.self
        return c
    }
}

final class ProteusSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var driver: ProteusHostDriver?
    /// dev 热刷：版本轮询定时器（条件轮询——仅常驻期跑，版本变更才重载）
    private var versionTimer: Timer?
    private var lastVersion = ""
    /// 起始页名（Info.plist `ProteusHomePage`，缺省 index）——壳不硬编码项目页名
    private var homePage = "index"
    /// dev 可视化层（DEV 角标 + 热重载提示）——仅 dev 变体创建（决策 #692）
    private var devOverlay: ProteusDevOverlay?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        let vc = UIViewController()
        vc.view.backgroundColor = .black
        let d = ProteusHostDriver(frame: UIScreen.main.bounds)
        d.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        d.view.frame = vc.view.bounds
        vc.view.addSubview(d.view)
        driver = d
        w.rootViewController = vc
        w.makeKeyAndVisible()
        window = w
        homePage = (Bundle.main.object(forInfoDictionaryKey: "ProteusHomePage") as? String) ?? "index"
        // 布局完成后启动（safeAreaInsets 就绪；非盲等——是"布局完成"这一确定事件）
        DispatchQueue.main.async { [weak self] in self?.boot() }
        // ★机器判据：宿主已启动（供零 sleep 的条件等待）
        NSLog("[proteus] PROTEUS_HOST_READY")
    }

    private func boot() {
        guard let d = driver else { return }
        guard let src = BundleSource.load() else {
            NSLog("[proteus] PROTEUS_HOST_FAIL 无 bundle 源（dev server 与内嵌资产均不可用）")
            writeReport(ok: false, raw: "无 bundle 源")
            return
        }
        let out = d.start(bundleSource: src, embedView: d.view)
        if homePage != "index" { d.navigate(to: homePage) }
        let ok = out.contains("\"ok\":true")
        NSLog("[proteus] PROTEUS_HOST_PAGE_RENDER ok=%@ page=%@", ok ? "true" : "false", d.currentPage)
        writeReport(ok: ok, raw: out)
        if ProteusBuildConfig.DEV {
            // ★dev 可视化层（决策 #692）：DEV 角标 + 热重载提示——release 不创建（零残留）
            let overlay = ProteusDevOverlay(host: d.view)
            overlay.attach()
            devOverlay = overlay
            startDevWatch()
            DispatchQueue.main.async { [weak self] in self?.devOverlay?.flash("DEV 模式 · 改源码保存即热刷") }
        }
        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
    }

    // ── dev 热刷：轮询 dev server `/version`，变更即重载（保留当前屏）──

    private func startDevWatch() {
        guard let base = BundleSource.devServerBase() else { return }
        lastVersion = BundleSource.httpGetText(base + "/version") ?? ""
        versionTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            guard let self, let d = self.driver else { return }
            let v = BundleSource.httpGetText(base + "/version") ?? ""
            guard !v.isEmpty, v != self.lastVersion else { return }
            self.lastVersion = v
            guard let src = BundleSource.load() else { return }
            let keepPage = d.currentPage
            d.start(bundleSource: src, embedView: d.view)   // 新建 ctx + 重 eval + 重 boot + 重渲
            d.navigate(to: keepPage)                         // 保留当前屏（与 Android hotReload 同语义）
            NSLog("[proteus] PROTEUS_DEV_RELOADED version=%@ page=%@", v, keepPage)
            self.devOverlay?.flash("⟳ 已热重载 · v\(v) · \(keepPage)")   // ★热刷新提示（决策 #692，对齐安卓 #671）
        }
    }

    private func writeReport(ok: Bool, raw: String) {
        let body: [String: Any] = ["host_id": "ios", "ok": ok, "page": driver?.currentPage ?? "", "raw": String(raw.prefix(400))]
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return }
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        try? data.write(to: dir.appendingPathComponent("HOST_REPORT.json"))
        NSLog("[proteus] HOST_REPORT_READY")
    }
}
