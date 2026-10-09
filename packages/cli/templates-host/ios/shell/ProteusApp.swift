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

/* ────────────────────────── 品牌色（壳内单一来源） ────────────────────────── */

/// 壳 chrome 用色（**非内核几何**）：内容底 / 品牌色。与 Web token（`--sp-bg #f5f6fa` / `--brand #5b5bd6`）
///   及 Android 壳（`0xFFF4F5F7`）同源——启动占位与内容底色一致 ⇒ 无"黑→内容"突变（决策 #694）。
enum ProteusBrandColor {
    static let pageBackground = UIColor(red: 0xF5/255, green: 0xF6/255, blue: 0xFA/255, alpha: 1)
    static let brand = UIColor(red: 0x5B/255, green: 0x5B/255, blue: 0xD6/255, alpha: 1)
}

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

    // ★dev DevTools 上报缓冲（决策 #693）：页面 console.* → /log；手势 → /trace；渲染后 → /tree。
    //   仅 DEV 变体产生（installDevConsoleShim / 手势回调里判 DEV）；主线程写、dev-watch 线程读（串行队列保护）。
    let reportQueue = DispatchQueue(label: "proteus.dev.report")
    var logOutbox: [[String]] = []       // [channel, level, text]
    var traceOutbox: [[String]] = []     // [gesture, id, chain, handled, fired]
    var lastTreeJson: String?            // 最近一次渲染后的实例化节点树（供 dev-watch 上报 /tree）
    /// ★DevTools 性能读数（决策 #698，对齐 Android `recordPerf`）——面板"渲染耗时/逐帧/重排/PATCH"。
    ///   renderMs = 壳测；frameMs/relayout/patches = 桥/视图的原子上抛（不自造第二份数学）。
    private(set) var lastRenderMs: Double = 0

    /// JS console 垫片：把页面 `console.log/info/warn/error` 捕获进 logOutbox（channel=project）。
    /// ★与 Android `installDevConsole` 同语义：**须在 eval bundle 之前装**（页面顶层 console.* 也被捕获）。
    /// ★★★用 `globalThis`，**不是 `window`**（App 的 JSContext 非浏览器——实测 `Can't find variable: window`
    ///   会当场抛 ReferenceError）；且 JSC 裸上下文**没有 `console`** ⇒ 需先建。
    private func installDevConsoleShim(_ ctx: JSContext) {
        let shim = """
        (function(){
          var g = globalThis;
          if (g.__proteusConsoleShim) return; g.__proteusConsoleShim = true;
          if (!g.console) g.console = {};
          ['log','info','warn','error'].forEach(function(level){
            var orig = (typeof g.console[level] === 'function') ? g.console[level] : function(){};
            g.console[level] = function(){
              try {
                var args = Array.prototype.slice.call(arguments).map(function(a){
                  try { return (typeof a === 'string') ? a : JSON.stringify(a); } catch(e){ return String(a); }
                }).join(' ');
                if (g.proteusHost && g.proteusHost.post) g.proteusHost.post(JSON.stringify({proteusConsole: level, text: args}));
              } catch(e){}
              try { orig.apply(g.console, arguments); } catch(e){}
            };
          });
        })();
        """
        _ = ctx.evaluateScript(shim)
    }

    /// 记录一次手势 trace（供面板 Events）——由 dev 场景在派发后调用（决策 #693）。
    func recordGestureTrace(gesture: String, id: Int, chain: [Int], handled: Bool) {
        guard ProteusBuildConfig.DEV else { return }
        reportQueue.sync {
            traceOutbox.append([gesture, String(id), chain.map(String.init).joined(separator: ","), handled ? "1" : "0", ""])
            if traceOutbox.count > 80 { traceOutbox.removeFirst() }
        }
    }

    /// 当前屏名（面板"当前屏"读数）
    func currentScreenName() -> String {
        guard let ctx = self.ctx else { return currentPage }
        return currentName(ctx)
    }

    /// 当前屏实例化节点树（面板 Elements）——经运行期快照桥
    func snapshotTreeJson() -> String? {
        guard let ctx = self.ctx else { return nil }
        return ctx.evaluateScript("__proteusSuperappTree ? __proteusSuperappTree() : null")?.toString()
    }

    /// ★每 tick 现取的节点树（决策 #698，对齐 Android `pushDevTree`/`syncDevScreen`）。
    ///   【为什么不能复用 `lastTreeJson`】它只在 `renderCurrent` 里更新——而两件事都**绕过** renderCurrent：
    ///     ① 交互更新走 JS `applyOps`（不经壳）；② 点卡片切屏走 JS `runtime.mountScreen`（径直 host.mount，
    ///       不经壳的 navigate）。⇒ 面板树会**停在旧屏**（与 Android #677 同坑）。现取即真源（运行期 currentContent）。
    func liveTreeJson() -> String? {
        let t = snapshotTreeJson()
        lastTreeJson = t
        return t
    }

    /// 取走并清空待上报日志（主线程调用；dev-watch 上报 /log）
    func drainLogs() -> [[String]] {
        var out: [[String]] = []
        reportQueue.sync { out = logOutbox; logOutbox.removeAll() }
        return out
    }

    /// 取走并清空待上报 trace（主线程调用；dev-watch 上报 /trace）
    func drainTraces() -> [[String]] {
        var out: [[String]] = []
        reportQueue.sync { out = traceOutbox; traceOutbox.removeAll() }
        return out
    }

    /// ★dev 原生日志（channel=native）——对齐 Android `devLog`（决策 #698）。    ///   用途：面板 Console 的"原生通道"（app ready / 热重载 / 渲染失败等）。缺了它，
    ///   当项目页没有 `console.log` 时 Console 恒空（Android 靠原生事件撑着，iOS 没有 ⇒ 观感"一直空"）。
    func devLog(_ level: String, _ text: String) {
        guard ProteusBuildConfig.DEV, !text.isEmpty else { return }
        reportQueue.sync {
            logOutbox.append(["native", level, String(text.prefix(600))])
            if logOutbox.count > 200 { logOutbox.removeFirst() }
        }
    }

    /// ★DevTools 性能读数 JSON（决策 #698）——面板"渲染耗时/逐帧/重排计数/PATCH 总数"。
    ///   ★数据源全为壳/桥/视图的原子读数（renderMs 壳测 · frameMs 视图帧循环 · 计数内核回执），不自造第二份。
    func perfJson() -> String {
        var o: [String: Any] = [:]
        // ★亚毫秒精度（决策 #698）：`Int(rounded())` 会把 <0.5ms 主渲染截成 0（面板显示"0 ms"像坏了）；
        //   保留两位小数（与 frameMs 同口径）。
        o["renderMs"] = (lastRenderMs * 100).rounded() / 100
        o["mountCalls"] = bridge.mountCalls
        // ★逐帧耗时 = 最近一次产帧的宿主总耗时（与 Android onDraw 耗时同义；决策 #698）
        o["frameMs"] = (bridge.frameCostMs * 100).rounded() / 100
        o["relayout"] = bridge.relayoutTotal
        o["patches"] = bridge.patchAppliedTotal
        guard let d = try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]) else { return "{}" }
        return String(data: d, encoding: .utf8) ?? "{}"
    }

    /// ★DevTools REPL（决策 #701）：在设备 JSContext 里求值一个表达式，返回结果字符串（主线程调用）。
    func evalExpr(_ expr: String) -> String {
        guard let ctx = self.ctx else { return "（无 JSContext）" }
        let v = ctx.evaluateScript(expr)
        if let exc = ctx.exception { return "✗ " + (exc.toString() ?? "异常") }
        return v?.toString() ?? "undefined"
    }

    init(frame: CGRect) {
        view = SelfDrawView(frame: frame)
        // ★底色 = 内容同族浅色（决策 #694）：`SelfDrawView` 覆盖不到的区域 / 切换期此前露黑底
        //   （观感"突然黑屏"）——改浅色后与 Web/Android（contentHost 0xFFF4F5F7）一致。
        view.backgroundColor = ProteusBrandColor.pageBackground
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
            // ★dev 事件 trace（决策 #693）：面板 Events 的"手势派发链路"读数
            self.recordGestureTrace(gesture: type, id: target, chain: chain, handled: true)
        }
        ctx.exceptionHandler = { _, exc in
            NSLog("[proteus] JS 异常: %@", exc?.toString() ?? "?")
        }
        // ②' ★dev：JS console 垫片（页面 console.* → 面板 Console·项目通道）+ 手势 trace 收集（决策 #693）
        if ProteusBuildConfig.DEV {
            installDevConsoleShim(ctx)
            // 页面 console.*（经 `proteusHost.post`）→ logOutbox → dev-watch 上报 /log（channel=project）
            caps.postSink = { [weak self] json in
                guard let self, let d = json.data(using: .utf8),
                      let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
                      let level = o["proteusConsole"] as? String else { return }
                let text = (o["text"] as? String) ?? ""
                self.reportQueue.sync {
                    self.logOutbox.append(["project", level, String(text.prefix(600))])
                    if self.logOutbox.count > 200 { self.logOutbox.removeFirst() }
                }
            }
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
        //   （"布局后重渲"是确定性事件，非盲等）。★primary:false ⇒ 不覆盖"渲染耗时"读数（决策 #698）。
        DispatchQueue.main.async { [weak self] in self?.renderCurrent(ctx, primary: false) }
        return out
    }

    /// 把当前屏真画到屏上（运行期实例化 → 宿主 mount → CALayer）
    @discardableResult
    func renderCurrent(_ ctx: JSContext? = nil, primary: Bool = true) -> String {
        guard let ctx = ctx ?? self.ctx else { return "{\"ok\":false,\"error\":\"无 JSContext\"}" }
        let t0 = Date()
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
            devLog("error", "render fail · \(page) · \(String(out.prefix(160)))")
        } else {
            NSLog("[proteus] PROTEUS_HOST_RENDER page=%@ ok", page)
        }
        // ★dev：渲染后抓实例化节点树（供面板 Elements；决策 #693）+ 记渲染耗时（决策 #698）
        if ProteusBuildConfig.DEV {
            lastTreeJson = snapshotTreeJson()
            // ★只记**主渲染**（start/navigate）的耗时——安全区的"布局后重渲"（primary:false）是内部校正，
            //   其成本极低（实测 ~0.36ms）；若让它覆盖，面板"渲染耗时"会显示一个与"挂载成本"无关的假小值
            //   （Android 单次 renderCurrent ⇒ 无此问题）。
            if primary { lastRenderMs = Date().timeIntervalSince(t0) * 1000 }
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
    /// 解出 bundle 源（**同步**；dev 单次尝试）——仅供**已在后台队列**的调用（dev 热重载路径）。
    ///   启动路径请用 `loadAsync`（不阻塞主线程）。
    static func load() -> String? {
        if let s = fetchDevOnce(), !s.isEmpty { return s }
        return loadEmbedded()
    }

    /// ★★★启动路径（决策 #694）：**后台**解 bundle 源——不阻塞主线程（此前 dev 首次 HTTP 在主线程
    ///   同步执行 ⇒ 启动黑屏数秒）。完成回调在**主线程**调用；`src == nil` = dev server 与内嵌资产都不可用。
    ///   dev 下做**有界重试**（覆盖"App 先于 server ready"的时序竞争）——用`调度延迟`让出，**非线程盲等**。
    static func loadAsync(attempts: Int = 4, _ done: @escaping (String?) -> Void) {
        guard ProteusBuildConfig.DEV, devServerBase() != nil else {
            let s = loadEmbedded()   // release / 无 dev base：直接内嵌（零延迟，不重试）
            DispatchQueue.main.async { done(s) }
            return
        }
        let queue = DispatchQueue.global(qos: .userInitiated)
        func attempt(_ n: Int) {
            queue.async {
                if let s = fetchDevOnce(), !s.isEmpty {
                    NSLog("[proteus] PROTEUS_DEV_BUNDLE_FROM_SERVER bytes=%d base=%@", s.utf8.count, devServerBase() ?? "")
                    DispatchQueue.main.async { done(s) }
                    return
                }
                if n <= 0 {
                    NSLog("[proteus] PROTEUS_DEV_BUNDLE_FETCH_FAIL 回落内嵌（dev server 不可达）")
                    let s = loadEmbedded()
                    DispatchQueue.main.async { done(s) }
                    return
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { attempt(n - 1) }
            }
        }
        attempt(attempts)
    }

    /// 内嵌 `bundle-superapp.js`（release 唯一来源；dev 的兜底）。
    static func loadEmbedded() -> String? {
        guard let path = Bundle.main.path(forResource: "bundle-superapp", ofType: "js"),
              let src = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
        return src
    }

    /// dev：单次从 dev server 拉 bundle（仅 DEV 变体走到）。
    static func fetchDevOnce() -> String? {
        guard ProteusBuildConfig.DEV, let base = devServerBase() else { return nil }
        return httpGetText(base + "/bundle")
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

    /// 同步 POST JSON（dev 通道用；元素树上报 `/tree`）。URLSession 同步封装。
    static func httpPostJson(_ url: String, body: String) -> String? {
        guard let u = URL(string: url) else { return nil }
        var req = URLRequest(url: u)
        req.httpMethod = "POST"
        req.timeoutInterval = 8
        req.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        req.httpBody = body.data(using: .utf8)
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

/* ────────────────────────── 启动占位层（避免"突然黑屏"） ────────────────────────── */

/// 启动占位层（决策 #694）：内容就绪前遮住 `SelfDrawView` 的黑底，显示**项目背景色 + 应用名 + 转圈**。
///   ★为什么要它：dev 首次拉 bundle 走网络（虽已异步），而 `SelfDrawView` 初始化即黑 ⇒ 直接露黑底观感差。
///   占位底用与内容同族的浅色（`#F5F6FA`，与 Android contentHost 同源）⇒ 启动到首帧是"浅色 → 内容"，
///   而非"黑 → 内容"。首帧渲染完成即移除（release/dev 同路径；release 只是瞬间）。
final class ProteusLaunchPlaceholder: UIView {
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let titleLabel = UILabel()
    private let hintLabel = UILabel()

    init(frame: CGRect, appName: String) {
        super.init(frame: frame)
        backgroundColor = ProteusBrandColor.pageBackground
        titleLabel.text = appName
        titleLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        titleLabel.textColor = UIColor(red: 0x1F/255, green: 0x24/255, blue: 0x30/255, alpha: 1)
        titleLabel.textAlignment = .center
        hintLabel.text = ProteusBuildConfig.DEV ? "正在连接开发服务器…" : "正在启动…"
        hintLabel.font = .systemFont(ofSize: 12)
        hintLabel.textColor = UIColor(red: 0x5F/255, green: 0x66/255, blue: 0x73/255, alpha: 1)
        hintLabel.textAlignment = .center
        spinner.color = ProteusBrandColor.brand
        let stack = UIStackView(arrangedSubviews: [titleLabel, spinner, hintLabel])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        spinner.startAnimating()
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    /// 加载失败：停下转圈、改文案（**保留占位**——不露黑底；用户看到"明确失败"而非黑屏）。
    func fail(_ msg: String) {
        spinner.stopAnimating()
        hintLabel.text = msg
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
    /// dev 热刷：版本轮询 + DevTools 上报（后台队列——不阻塞 UI；JSC 读取回主线程）
    private var versionTimer: DispatchSourceTimer?
    private let devWatchQueue = DispatchQueue(label: "proteus.dev.watch")
    private var lastVersion = ""
    private var devEnvJson = "{}"        // 设备/引擎环境（/ping 上报，面板"设备环境"）
    private var lastSentTree: String = "" // 上次已上报的节点树（变更才 POST /tree）
    /// 起始页名（Info.plist `ProteusHomePage`，缺省 index）——壳不硬编码项目页名
    private var homePage = "index"
    /// 启动占位层（内容就绪前遮黑底；首帧后移除）——决策 #694
    private var placeholder: UIView?
    /// dev 可视化层（DEV 角标 + 热重载提示）——仅 dev 变体创建（决策 #692）
    private var devOverlay: ProteusDevOverlay?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        let vc = UIViewController()
        vc.view.backgroundColor = ProteusBrandColor.pageBackground   // 与占位层/内容同族（决策 #694）
        let d = ProteusHostDriver(frame: UIScreen.main.bounds)
        d.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        d.view.frame = vc.view.bounds
        vc.view.addSubview(d.view)
        driver = d
        // ★★★启动占位（决策 #694）：内容就绪前遮住 `SelfDrawView` 的黑底——避免"突然黑屏"。
        //   App 名/连接态显示在占位层上；首帧渲染完成即移除。启动拉 bundle 在**后台**进行（不阻塞主线程）。
        let ph = ProteusLaunchPlaceholder(
            frame: vc.view.bounds,
            appName: (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String) ?? "Proteus")
        ph.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        vc.view.addSubview(ph)
        placeholder = ph
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
        // ★★★启动不阻塞主线程（决策 #694）：dev 首次拉 bundle 此前在**主线程**同步 HTTP（含 5 次重试的
        //   `Thread.sleep`）⇒ 整个启动窗口主线程被占死 ⇒ 占位层不转、屏幕"黑住一段时间"。
        //   改为**后台**拉取 + 主线程回调；占位层在此期间持续显示（转圈可见）。★同时删除了固定盲等重试。
        BundleSource.loadAsync { [weak self] src in
            guard let self, let d = self.driver else { return }
            guard let src = src else {
                NSLog("[proteus] PROTEUS_HOST_FAIL 无 bundle 源（dev server 与内嵌资产均不可用）")
                (self.placeholder as? ProteusLaunchPlaceholder)?.fail("无法加载应用资源（dev server 不可达）")
                self.writeReport(ok: false, raw: "无 bundle 源")
                return
            }
            self.startDriver(src: src, d: d)
        }
    }

    /// bundle 就绪后的启动：起驱动 → 上报 → 撤占位 → dev 层/watch（决策 #694 拆分）。
    private func startDriver(src: String, d: ProteusHostDriver) {
        let out = d.start(bundleSource: src, embedView: d.view)
        if homePage != "index" { d.navigate(to: homePage) }
        let ok = out.contains("\"ok\":true")
        NSLog("[proteus] PROTEUS_HOST_PAGE_RENDER ok=%@ page=%@", ok ? "true" : "false", d.currentPage)
        writeReport(ok: ok, raw: out)
        // 内容已上屏 ⇒ 撤启动占位（黑底不再可见）
        placeholder?.removeFromSuperview()
        placeholder = nil
        if ProteusBuildConfig.DEV {
            // ★dev 可视化层（决策 #692/#693）：DEV 角标 + 热重载提示——**加在 window 上**（固定悬浮、不被
            //   内容重绘/滚动/切屏覆盖；对齐 Android 加在 Activity root FrameLayout）。release 不创建（零残留）。
            let host = self.window ?? d.view
            let overlay = ProteusDevOverlay(host: host)
            overlay.attach()
            devOverlay = overlay
            startDevWatch()
            d.devLog("info", "app ready · screen=\(d.currentPage)")   // ★原生日志（决策 #698，对齐 Android devLog）
            DispatchQueue.main.async { [weak self] in self?.devOverlay?.flash("DEV 模式 · 改源码保存即热刷") }
        }
        // ★dev 窗口截图（决策 #693，仅 DEV + 显式 env）：把整个 window（含 DEV 角标/提示）渲染到 Documents
        //   ⇒ 供 CLI/脚本 `devicectl copy from` 取回核验视觉（角标内边距等）。非 DEV / 无 env ⇒ 不做。
        if ProteusBuildConfig.DEV, ProcessInfo.processInfo.environment["PROTEUS_DEV_SNAPSHOT"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
                guard let win = self?.window, win.bounds.width > 0 else { return }
                let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = UIScreen.main.scale
                let img = UIGraphicsImageRenderer(bounds: win.bounds, format: fmt).image { _ in
                    win.drawHierarchy(in: win.bounds, afterScreenUpdates: true)
                }
                if let png = img.pngData() {
                    let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                    try? png.write(to: dir.appendingPathComponent("proteus-dev-snapshot.png"))
                    NSLog("[proteus] PROTEUS_DEV_SNAPSHOT_READY")
                }
            }
        }
        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
    }

    // ── dev 热刷 + DevTools 上报（决策 #693，对齐 Android #672-#675）──
    //   ★每 tick **先上报再判版本**（否则"版本没变"这条主路径永不上报 ⇒ 面板恒"设备离线"，Android #672 同坑）。
    //   ★JSC 读取在主线程（JSC 非线程安全），HTTP 发送在后台队列（不阻塞 UI）。

    private func startDevWatch() {
        guard let base = BundleSource.devServerBase() else { return }
        lastVersion = BundleSource.httpGetText(base + "/version") ?? ""
        devEnvJson = Self.collectDeviceEnv()
        let t = DispatchSource.makeTimerSource(queue: devWatchQueue)
        t.schedule(deadline: .now() + 1.5, repeating: 1.5)
        t.setEventHandler { [weak self] in
            guard let self, let d = self.driver else { return }
            // ① JSC 读取（主线程——eval 非线程安全）
            var screen = ""
            var tree: String?
            var perf = "{}"
            var logs: [[String]] = []
            var traces: [[String]] = []
            DispatchQueue.main.sync {
                screen = d.currentScreenName()
                tree = d.liveTreeJson()   // ★现取（决策 #698）：切屏/交互绕过 renderCurrent ⇒ 缓存会停在旧屏
                perf = d.perfJson()       // ★性能读数（决策 #698）
                logs = d.drainLogs()
                traces = d.drainTraces()
            }
            // ② 上报（后台队列）——ping(设备在线+当前屏+环境+性能) / log / tree / trace
            _ = BundleSource.httpGetText(base + "/ping?screen=" + urlEnc(screen) + "&env=" + urlEnc(self.devEnvJson) + "&perf=" + urlEnc(perf))
            for e in logs { _ = BundleSource.httpGetText(base + "/log?channel=" + e[0] + "&level=" + urlEnc(e[1]) + "&text=" + urlEnc(e[2])) }
            if let tree, !tree.isEmpty, tree != self.lastSentTree {
                self.lastSentTree = tree
                _ = BundleSource.httpPostJson(base + "/tree", body: tree)
            }
            for e in traces { _ = BundleSource.httpGetText(base + "/trace?type=" + urlEnc(e[0]) + "&id=" + e[1] + "&chain=" + urlEnc(e[2]) + "&handled=" + e[3] + "&fired=" + urlEnc(e[4])) }
            // ★面板→设备命令（决策 #701）：轮询 /cmd（one-shot），执行 highlight / eval。回主线程改 UI/JS。
            let cmdJson = BundleSource.httpGetText(base + "/cmd") ?? ""
            if !cmdJson.isEmpty, cmdJson != "{}", cmdJson != "null" {
                DispatchQueue.main.async { self.applyCommand(cmdJson, driver: d) }
            }
            // ③ 版本变更 ⇒ 热重载（回主线程重建 JSContext）
            let v = BundleSource.httpGetText(base + "/version") ?? ""
            guard !v.isEmpty, v != self.lastVersion else { return }
            // ★先取 bundle 再记账（决策 #694）：`load()` 现为单次尝试 ⇒ 拉失败时**不要**标记该版本已消费，
            //   留待下一 tick（1.5s）重试；否则一次网络抖动会让该版本**永不重载**。
            guard let src = BundleSource.load() else { return }
            self.lastVersion = v
            DispatchQueue.main.async {
                d.start(bundleSource: src, embedView: d.view)   // 新建 ctx + 重 eval + 重 boot + 重渲
                d.navigate(to: screen)                           // 保留当前屏（与 Android hotReload 同语义）
                NSLog("[proteus] PROTEUS_DEV_RELOADED version=%@ page=%@", v, screen)
                d.devLog("info", "hot reload · v\(v) · \(screen)")   // ★原生日志（决策 #698）
                self.devOverlay?.flash("⟳ 已热重载 · v\(v) · \(screen)")   // 热刷新提示（对齐安卓 #671）
            }
        }
        t.resume()
        versionTimer = t
    }

    private func urlEnc(_ s: String) -> String {
        // ★query 分量编码（决策 #701 修）：`.urlQueryAllowed` **包含** `+ & = # ?` 等 query 分隔符，
        //   而服务端 `URLSearchParams` 把 `+` 解成空格 ⇒ 含 `+`/`&` 的日志/表达式会被改写
        //   （实测：REPL 求值 `1+1` 的**回显文本**变成 `1 1`，虽然求值本身正确）。⇒ 从允许集里剔掉它们。
        var cs = CharacterSet.urlQueryAllowed
        cs.remove(charactersIn: "+&=#?")
        return s.addingPercentEncoding(withAllowedCharacters: cs) ?? ""
    }

    /// ★面板→设备命令执行（决策 #701，主线程调用）：`highlight`（元素高亮）/ `eval`（REPL）。
    ///   结果经 `d.devLog` 回 Console 通道 ⇒ 面板可见（闭环）。
    private func applyCommand(_ json: String, driver d: ProteusHostDriver) {
        guard let data = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        let type = (o["type"] as? String) ?? ""
        switch type {
        case "highlight":
            let id = (o["nodeId"] as? NSNumber)?.intValue ?? 0
            d.bridge.highlightNode(id)
            d.devLog("info", "highlight #\(id)")
        case "eval":
            let expr = (o["expr"] as? String) ?? ""
            if !expr.isEmpty { d.devLog("log", "› \(expr)\n\(d.evalExpr(expr))") }
        case "edit":
            let id = (o["nodeId"] as? NSNumber)?.intValue ?? 0
            let key = (o["key"] as? String) ?? ""
            let value = (o["value"] as? String) ?? ""
            if !key.isEmpty {
                let ok = d.bridge.applyLiveEdit(id: id, key: key, value: value)
                d.devLog(ok ? "info" : "warn", "edit #\(id) \(key)=\(value)\(ok ? "" : "（不支持/无该层）")")
            }
        default:
            break
        }
    }

    /// 设备/引擎环境（面板"设备环境"）——device 型号/系统/屏幕 + 内核·引擎版本。
    private static func collectDeviceEnv() -> String {
        var o: [String: String] = [:]
        let dev = UIDevice.current
        o["platform"] = "iOS"
        o["model"] = dev.model
        o["systemVersion"] = dev.systemVersion
        o["name"] = dev.name
        let s = UIScreen.main
        o["screen"] = "\(Int(s.bounds.width))x\(Int(s.bounds.height))"
        o["screenPx"] = "\(Int(s.bounds.width * s.scale))x\(Int(s.bounds.height * s.scale))"
        o["density"] = String(format: "%.2f", s.scale)
        o["theme"] = "dark"
        o["jsEngine"] = "JavaScriptCore"
        o["hostBuild"] = ProteusBuildConfig.DEV ? "dev" : "release"
        o["layoutCore"] = "proteus-layout-core (rust)"
        guard let d = try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]) else { return "{}" }
        return String(data: d, encoding: .utf8) ?? "{}"
    }

    private func writeReport(ok: Bool, raw: String) {
        let body: [String: Any] = ["host_id": "ios", "ok": ok, "page": driver?.currentPage ?? "", "raw": String(raw.prefix(400))]
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return }
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        try? data.write(to: dir.appendingPathComponent("HOST_REPORT.json"))
        NSLog("[proteus] HOST_REPORT_READY")
    }
}
