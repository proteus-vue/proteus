// hosts/ios/ProteusHost/shell/selfdraw-app.swift
// ★★★hosts 第三刀（2026-10-07）：**应用入口 + 场景分发**从 runtime/selfdraw-scene.swift 迁出。
//
// 【为什么迁】原 selfdraw-scene.swift 是"壳+引擎混装"（check-host-layering 的 RUNTIME_MIXED_FILES 登记）：
//   引擎（SelfDrawView/SelfDrawBridge/FFI）与** App 入口**（SelfDrawViewController + @main delegate）
//   同文件 ⇒ runtime/ 反向引用 shell/dev。本刀拆分：引擎留 runtime/，入口与场景分发归本文件。
//
// 【本文件属 shell（应用入口）】=
//   · SelfDrawViewController（viewDidLoad：建视图 + JSContext + 桥接线 → 场景分发/驱动）
//   · SelfDrawSceneDelegate / @main SelfDrawAppDelegate（窗口装配）
//   · 场景分发与 dev 驱动（driveStress/driveVapor/…）
//
// 【★诚实边界（参考宿主壳 → dev 装置）】本壳**分发到 dev 装置场景**（ShowcaseScene / AppStackScene /
//   HostRuntimeScene）——这是"参考宿主含装置"的固有形态（与鸿蒙壳 import dev 的 superappDrive 同族，
//   见 check-host-layering 的 SHELL_MIXED_FILES 具名登记）。★**最小宿主不含这些分支**（生成模板自持，
//   只走 superapp/渲染路径）。运行时（引擎）侧已不再引用任何 shell/dev 类型。
import Foundation
import UIKit
import JavaScriptCore
import Darwin

/* ────────────────────────── 应用入口 ────────────────────────── */

final class SelfDrawViewController: UIViewController {
    private let bridge = SelfDrawBridge()
    private var jsContext: JSContext?
    /// ★系统状态栏是否隐藏（决策 #594）：读 app-config.json 的 safeArea.statusBar（缺省 false = 显示）。
    private var statusBarHiddenCfg = false
    /// 状态栏可见性覆盖（iOS 由 view controller 决定）——系统据此显隐状态栏。
    override var prefersStatusBarHidden: Bool { return statusBarHiddenCfg }
    /// 读 .app/app-config.json → safeArea.statusBar === 'hide'（缺文件/字段 ⇒ false）。
    static func readStatusBarHidden() -> Bool {
        guard let p = Bundle.main.path(forResource: "app-config", ofType: "json"),
              let d = try? Data(contentsOf: URL(fileURLWithPath: p)),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let sa = o["safeArea"] as? [String: Any] else { return false }
        return (sa["statusBar"] as? String) == "hide"
    }

    /// ★★**白屏诊断读数**（本仓实测：用户观察到"启动白一下"，需可客观归因）
    ///
    /// 【为什么记这三个】启动白屏有三种成因，读数能直接区分：
    ///   ① `interface_style` = Light + `launch_bg` 未设 ⇒ **启动屏是白**（系统背景色）
    ///      ⇒ 用户看到 白→黑→内容（"白闪"）。修法：`UIUserInterfaceStyle=Dark`（本仓已加）
    ///   ② `first_frame_ms` 大 ⇒ 首帧慢（内核初始化/JS 加载），与启动屏无关
    ///   ③ `mount_ms` 大 ⇒ 内容上屏慢（布局/建层），那是"内容白屏"
    /// ★★**进程启动时刻**（用于算 `first_frame_ms`）——取自**内核**，不是内存里的任何"第一次"
    ///
    /// 【原来的装置为什么是坏的（本仓实测）】原实现是
    ///     `static var processStart = CFAbsoluteTimeGetCurrent()`
    ///   Swift 的**静态量是惰性的**：它在**首次访问**时才初始化，而不是进程启动时。
    ///   本档恰好在 `viewDidLoad` 里首次读它 ⇒ `processStart ≈ now` ⇒ **`first_frame_ms` 恒为 0**。
    ///   而 0 是一条**看起来完美的假读数**（会被读成"首帧极快"）——比报错更危险。
    ///   （本条曾被我当"后续项"挂着，实际是"读数恒假"——不该挂。）
    ///
    /// 【正解的两级锚点】
    ///   · ① 进程启动（含 dyld 之前的 exec）：`sysctl(KERN_PROC_PID)` 的 `p_starttime`（**内核给的**）
    ///   · ② 应用可见的第一个点（`didFinishLaunching`）：两者都记，用来**分解**耗时
    ///     （①→② 是启动框架，②→首帧是内核初始化/JS 加载）
    ///   ★诚实边界：`p_starttime` 起点**早于** dyld 加载本镜像，故 `first_frame_ms` 含
    ///     动态链接耗时（那本来也是启动成本的一部分，用户确实在等）；更早的内核 fork 未计。
    static var processStartWall: CFAbsoluteTime = {
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        let rc = sysctl(&mib, 4, &info, &size, nil, 0)
        guard rc == 0 else { return CFAbsoluteTimeGetCurrent() }   // 取不到 ⇒ 退化为"now"（并在读数里标注）
        // ★★**纪元必须换算**（本仓实测：首跑读出 -978307199936ms 这种巨大负值）
        //
        // 【为什么】`p_starttime` 的 `tv_sec` 是 **Unix 纪元**（1970-01-01 起算），
        //   而 `CFAbsoluteTime` 是 **2001-01-01 起算**——两者差 **978307200 秒**。
        //   直接把 Unix 秒当成 CFAbsoluteTime ⇒ 结果偏移 -978307200s（≈ -31 年）。
        //   ★这条极易漏：读数不是"报错"，而是一个**巨大的负数**（若只做减法不检查符号，
        //     甚至可能被读成"极快"）。⇒ 报告里带 `first_frame_source` 就是为这类核对。
        let unixEpochToCFAbsolute = 978_307_200.0
        let tv = info.kp_proc.p_starttime     // ★必须先取出（此前那次编辑把它删掉了）
        return CFAbsoluteTime(tv.tv_sec) - unixEpochToCFAbsolute + CFAbsoluteTime(tv.tv_usec) / 1_000_000.0
    }()
    /// `p_starttime` 是否真的取到了（false ⇒ `first_frame_ms` 不可信，必须显式标注）
    static let processStartValid: Bool = {
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        return sysctl(&mib, 4, &info, &size, nil, 0) == 0
    }()
    /// `didFinishLaunching` 时刻（分解用：①→② 是启动框架耗时）
    static var didLaunchWall: CFAbsoluteTime = 0

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        // ★★★状态栏显示策略（2026-10-08 · 决策 #594）：读 .app/app-config.json 的 `safeArea.statusBar`。
        //   缺省 **显示**（与 Web 手机端 viewport-fit=cover + edge-to-edge 对齐）：内容背景铺到状态栏区、
        //   页根用 --pf-inset-top 让位。`'hide'` = 沉浸式（隐藏状态栏）。
        statusBarHiddenCfg = Self.readStatusBarHidden()

        // ★★白屏诊断（见 launchDiag 注释）：
        //   · `interface_style`：当前外观模式（浅色 ⇒ 若启动屏背景未设，启动瞬间是**白**）
        //   · `launch_bg`：Info.plist 里 `UILaunchScreen` 是否配了背景色
        //   · `first_frame_ms`：进程启动 → 本方法（首个 UI 帧建立）的耗时
        let style: String
        if #available(iOS 13.0, *) {
            style = traitCollection.userInterfaceStyle == .dark ? "Dark" : "Light"
        } else {
            style = "unknown"
        }
        let launchCfg = (Bundle.main.object(forInfoDictionaryKey: "UILaunchScreen") as? [String: Any]) ?? [:]
        let forcedStyle = (Bundle.main.object(forInfoDictionaryKey: "UIUserInterfaceStyle") as? String) ?? "(未设置)"
        ProteusLaunchDiag.data = [
            "interface_style": style,
            "forced_style": forcedStyle,
            "launch_screen_keys": Array(launchCfg.keys).sorted(),
            // ★首帧耗时（**含有效性与分解**——见 processStartWall 注释）
            "first_frame_ms": round((CFAbsoluteTimeGetCurrent() - Self.processStartWall) * 1000 * 100) / 100,
            "first_frame_source": Self.processStartValid ? "kernel:p_starttime" : "fallback:now(不可信)",
            // 启动框架耗时（p_starttime → didFinishLaunching）；0 = 该点未打（旧路径）
            // I2-ALLOW: 启动耗时报告（毫秒读数，非几何）
            "bootstrap_ms": Self.didLaunchWall > 0
                ? round((Self.didLaunchWall - Self.processStartWall) * 1000 * 100) / 100 : -1,
        ]

        let w = UIScreen.main.bounds.width
        let h = UIScreen.main.bounds.height
        let host = SelfDrawView(frame: CGRect(x: 0, y: 0, width: w, height: h))
        // ★宿主铺满全屏：几何基准 = 屏幕（Vue 侧 viewport 用同一尺寸）
        view.addSubview(host)
        bridge.view = host

        // ── 真实 JavaScriptCore（与 iOS 竖切同一运行时）──
        guard let ctx = JSContext() else {
            NSLog("[proteus] JSContext 创建失败")
            return
        }
        jsContext = ctx
        ctx.setObject(bridge, forKeyedSubscript: "proteusSelfDraw" as NSString)
        // ★★V9：把「触摸 → 命中 → JS 派发」接上（此前这条链**从未接线** ⇒ 自绘场景不能交互）
        //
        // 方向：`SelfDrawView.onGesture`（触摸）→ `bridge.emitGesture`（命中）
        //       → `onDispatchToJS`（本闭包）→ JS 的 `__proteus_dispatch`（适配器 dispatchEvent）
        // ★用闭包而非桥接层直持 ctx：避免「桥 ↔ ctx」循环引用（ctx 强引用桥）
        bridge.view?.onGesture = { [weak bridge] x, y, type in
            bridge?.emitGesture(x: x, y: y, type: type)
        }
        // ★★真手势滚动接线（2026-10-01）：pan 识别器的唯一出口 → 桥的生产通路
        //   （内容偏移 + 内核滚动联动 + 刷层一次完成；JS 不在链路上——与 scrollAnimSync 同实现）。
        bridge.view?.onScrollDrag = { [weak bridge] dx, dy in
            bridge?.scrollDragBy(dx: Double(dx), dy: Double(dy)) ?? "{\"ok\":false,\"error\":\"bridge 已释放\"}"
        }
        bridge.onDispatchToJS = { [weak bridge, weak ctx] target, chain, type, x, y in
            guard let ctx = ctx else { return }
            // ★★A/B（矩阵 #14 续）：若宿主注册了手势回调名（`proteusSelfDraw.onGesture(name)`）
            //   ⇒ 按名调它——签名 `(type, nodeId, chainJson)`（**共享 bundle 的契约**，与 Android
            //   JNI 反向调用 `__proteusVaporGesture` 同语义）。
            //   ★空名/未注册 ⇒ 落回原 `__proteus_dispatch`（V9/V16 等既有用例的路径**不变**）。
            if let name = bridge?.gestureCallbackName, !name.isEmpty {
                let chainJson = "[" + chain.map(String.init).joined(separator: ",") + "]"
                if let fn = ctx.objectForKeyedSubscript(name) {
                    _ = fn.call(withArguments: [type, target, chainJson])
                    return
                }
            }
            guard let fn = ctx.objectForKeyedSubscript("__proteus_dispatch") else { return }
            // ★`call(withArguments:)` 传原生数组（JSContext 自动桥接为 JS Array/Number）
            _ = fn.call(withArguments: [target, chain, type, x, y])
        }

        // 异常可观测（否则 JS 报错静默失败）
        ctx.exceptionHandler = { _, exc in
            NSLog("[proteus] JS 异常: %@", exc?.toString() ?? "?")
        }

        // ★模式：`--bench` 跑逻辑层基准（复杂响应式用例 + 规模扫描），否则跑自绘场景
        //   （`--selfdraw` 是自绘模式的**显式**写法——脚本用它避免落到 Info.plist 的缺省场景）
        let isBench = ProcessInfo.processInfo.arguments.contains("--bench")
        // ★★★六端 SFC 压力夹具（2026-10-02）：走 bench bundle（它含 renderStress 入口——
        //   与 Android 同源的 vapor-stress.json），但不跑用例链：一次挂载 + 截图 + 报告。
        let isStress = ProcessInfo.processInfo.arguments.contains("--stress")
        // ★矩阵 #10：原生组件混用（自绘 + 原生 UIView 共存；与 Android native-host 三件事同族）
        let isNativeMix = ProcessInfo.processInfo.arguments.contains("--native-mix")
        // ★A/B（矩阵 #14 续）：Vapor vs Vue 运行时对照（eval 与 Android 同一份 bundle-vapor.js）
        let isVaporAb = ProcessInfo.processInfo.arguments.contains("--vapor-ab")
        // ★★★Vapor 设备端链（2026-10-03 · 三端对齐）：跑 bundle 的**默认模式**（runShort）——
        //   即 `check-vapor-device.py` 判据 ①–⑫ 所在路径（实例化/增量/交互/门禁轮/表达式能力）。
        //   A/B 模式（--vapor-ab）跑的是 `mode:'ab'`，两者**不同路径**（判据集也不同）。
        let isVapor = ProcessInfo.processInfo.arguments.contains("--vapor")
        // ★★G-39：宿主运行时场景（`--host-runtime`）——独立模式，不进自绘/基准分支
        let isHostRuntime = ProcessInfo.processInfo.arguments.contains("--host-runtime")
        // ★★M5：执行器场景（`--app-stack`）——同上，独立模式
        let isAppStack = ProcessInfo.processInfo.arguments.contains("--app-stack")
        // ★★Morpheus 炫技场（`--showcase`）——整场节目单编舞（开场语 → 演出 → 谢幕语）
        //
        // 【判定规则（"点开即演示"的落地）】显式参数 > Info.plist 缺省场景。
        //   · 脚本跑实验：显式传 `--showcase` / `--bench` / `--selfdraw` / `--host-runtime` / `--app-stack`
        //   · 从桌面点开（无参数）：用 `ProteusDefaultScene`（本仓构建时写 `showcase`）
        //     ⇒ 点图标即演示，**不需要脚本**（用户要求"方便随时点开给团队看"）
        let argv = ProcessInfo.processInfo.arguments
        let explicit = argv.contains { $0.hasPrefix("--") && !$0.hasPrefix("--cases=") }
        let plistScene = (Bundle.main.object(forInfoDictionaryKey: "ProteusDefaultScene") as? String) ?? "showcase"
        let isShowcase = argv.contains("--showcase") || (!explicit && plistScene == "showcase")
        // ★★★批次 44（2026-10-05）：**superapp 真实应用**（桌面图标点开 = superapp 应用，可切 tab）。
        //   与 isShowcase 同一判定规则：显式 `--superapp` 或 Info.plist 缺省场景 = superapp。
        let isSuperapp = argv.contains("--superapp") || (!explicit && plistScene == "superapp")
        // ★★用例过滤（`--cases=S5,V4`）：只跑指定前缀的用例
        //
        // 【为什么需要（效率纪律：定向验证不得跑全量）】bench 有 46 个用例、全套数分钟；
        //   而验证某个改动往往只需 2–4 个用例（如 S5 结构变更）。没有过滤就只能整套跑，
        //   与「全量单测不得无目的重复」同源的浪费。
        //   注入全局量（而非改 bundle）：JS 侧读 `__PROTEUS_CASES__` 自行过滤，两端解耦。
        let caseFilter = ProcessInfo.processInfo.arguments
            .first { $0.hasPrefix("--cases=") }?
            .dropFirst("--cases=".count)
            .split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) } ?? []
        // ★stress 模式：独立报告名 + 独立截图名（不与 bench/selfdraw 产物撞名）
        if isStress {
            SelfDrawBridge.reportFileName = "stress-sfc"
            SelfDrawBridge.snapshotName = "stress-sfc"
            // ★★内容滚动范围钳制（2026-10-02 —— 「示例页可一直上下滚」的 iOS 侧修复）：
            //   内容页语义（装不下才滚，最多滚到内容底）；仅本场景开启 ⇒ 既有 pan/滚动用例零影响。
            SelfDrawBridge.contentScrollRangeEnabled = true
        }
        if isBench {
            // ★★过滤跑写**独立文件**（本仓实测踩到的坑，代价=白等 10 分钟）
            //
            // 【故障链】过滤跑与全量跑写同一个 `logic-bench-report` ⇒ ① 会**覆盖全量基准**
            //   （历史读数不可再生）；② 取报告的脚本若按过滤名去拉，设备上**永远没有那个文件**
            //   ⇒ 拷贝静默失败（`|| true`）⇒ 空等到超时，现象是"App 明明起来了、脚本毫无输出"。
            //   ⇒ 正解：**文件名由同一处（宿主）决定并让两端一致**：
            //     有过滤 → `bench-filtered-<slug>`；无过滤 → `logic-bench-report`。
            if caseFilter.isEmpty {
                SelfDrawBridge.reportFileName = "logic-bench-report"
                SelfDrawBridge.snapshotName = "bench-final"
            } else {
                // slug 规则必须与 run-selfdraw.sh 的 `tr ',' '_'` 一致（两端同一命名规则）
                let slug = caseFilter.joined(separator: "_")
                SelfDrawBridge.reportFileName = "bench-filtered-\(slug)"
                SelfDrawBridge.snapshotName = "bench-filtered-\(slug)"
            }
        }
        // ★矩阵 #10：native-mix 场景的产物名（与 run-selfdraw.sh 的 REPORT_FILE/SNAP_FILE 一致）
        if isNativeMix {
            SelfDrawBridge.reportFileName = "native-mix"
            SelfDrawBridge.snapshotName = "native-mix"
        }
        if isVaporAb {
            SelfDrawBridge.reportFileName = "vapor-ab"
            SelfDrawBridge.snapshotName = "vapor-ab"
        }
        if isVapor {
            // ★三端对齐：报告名与 Android/鸿蒙**同名**（`vapor.json`）——判据脚本按名取件、
            //   三端产物同形（本仓同款坑：名字不一致会让"取报告"静默失败，排查成本高）。
            SelfDrawBridge.reportFileName = "vapor"
            SelfDrawBridge.snapshotName = "vapor"
        }
        // ★stress 也走 bench bundle（它含 renderStress 入口——同一份 vapor-stress.json 产物）
        // ★三端对齐（2026-10-03）：vapor 与 vapor-ab 都吃 **bundle-vapor.js**（含 runShort 与 abRender）
        let bundleName = isShowcase ? "bundle-showcase"
            : (isAppStack ? "bundle-app-stack"
            : (isHostRuntime ? "bundle-host-runtime"
            : (isBench || isStress || isNativeMix ? "bundle-bench"
            : (isVapor || isVaporAb ? "bundle-vapor" : "bundle-selfdraw"))))
        guard let url = Bundle.main.url(forResource: bundleName, withExtension: "js"),
              let src = try? String(contentsOf: url, encoding: .utf8) else {
            NSLog("[proteus] 缺少 %@.js", bundleName)
            return
        }
        // ★★G-39：宿主运行时场景交独立模块驱动（两相 + 生命周期观察者 + 报告），提前返回
        if isHostRuntime {
            NSLog("[proteus] G-39 宿主运行时场景启动")
            HostRuntimeScene.run(ctx: ctx, bundleURL: url)
            return
        }
        // ★★M5：执行器场景交独立模块驱动（主场景 + 两相 + 非阻塞轮询 + 两份报告），提前返回
        if isAppStack {
            NSLog("[proteus] M5 执行器场景启动")
            AppStackScene.run(ctx: ctx, bundleURL: url)
            return
        }
        // ★★Morpheus 炫技场：交独立模块驱动（建树 → 三段编舞 → 帧循环 → 读数 + 截图）
        if isShowcase {
            NSLog("[proteus] Morpheus 炫技场启动")
            ShowcaseScene.run(ctx: ctx, bundleURL: url)
            return
        }
        // ★★★批次 44（2026-10-05）：**superapp 真实应用**（桌面图标点开形态）——常驻可切 tab。
        if isSuperapp {
            NSLog("[proteus] superapp 真实应用启动")
            SuperappScene.run(ctx: ctx, bundleURL: url, bridge: bridge, containerView: host)
            return
        }
        let vp = jsonString(["width": w, "height": h])
        NSLog("[proteus] selfdraw 启动 · viewport=%@", vp)
        ctx.evaluateScript("var __PROTEUS_VIEWPORT__ = \(vp);")
        if !caseFilter.isEmpty {
            let arr = caseFilter.map { "\"\($0)\"" }.joined(separator: ",")
            ctx.evaluateScript("var __PROTEUS_CASES__ = [\(arr)];")
            NSLog("[proteus] 用例过滤：%@", caseFilter.joined(separator: ","))
        }
        ctx.evaluateScript(src, withSourceURL: url)

        // ★★逐相位驱动（本仓实测的关键点）
        //   JSC 的 `evaluateScript` **不排空微任务** —— Promise 回调要等该次调用返回后才执行。
        //   而 Vue 的更新调度正是微任务 ⇒ 若把「mount + 改 ref + 量结果」写在一个脚本里，
        //   重渲染**永远不会发生**（实测 patch=0、节点数不变，看起来像响应式失效）。
        //   正解：每次 evaluateScript 之间**返回主线程**，让微任务排空，再进入下一相位。
        //   下面用 `DispatchQueue.main.async` 串起来——这等价于把 VM 事件循环手工补上。
        if isBench {
            driveBench(ctx: ctx)
        } else if isVaporAb {
            driveVaporAb(ctx: ctx)
        } else if isVapor {
            driveVapor(ctx: ctx)
        } else if isNativeMix {
            driveNativeMix(ctx: ctx)
        } else if isStress {
            // ★★★六端 SFC 压力夹具（2026-10-02）：渲染 examples/pages/consistency-stress.vue 的
            //   编译产物（`vapor-stress.json`）——**一次挂载 + 截图 + 报告落盘**，不跑用例链。
            //   与 Android 侧 `StressSfcActivity` 对称（两端渲染同一份 SFC 的产物的各自管道）。
            driveStress(ctx: ctx)
        } else {
            schedulePhases(ctx: ctx, url: url)
        }
    }

    /// ★★★六端 SFC 压力夹具驱动器（iOS 第三条链的落点）。
    ///
    /// 【链路】`__proteus.renderStress()`（= instantiateTemplate + `proteusSelfDraw.mount`）
    ///   → Rust 内核算几何 → CALayer 自绘 → 截图（`SelfDrawView.snapshot`）→ 报告落盘。
    ///
    /// 【完成信号（零盲等）】报告 + PNG 落盘后（若 `PROTEUS_EXIT_AFTER_REPORT=1`）进程自退
    ///   ⇒ 采集脚本的 `launch --console` **返回即完成**（与既有实验脚本同一机制）。
    private func driveStress(ctx: JSContext) {
        let evalJs = { (expr: String) -> String in ctx.evaluateScript(expr)?.toString() ?? "null" }
        // ★★装置归一（2026-10-02 · 独立审计抓出）：宿主画布底色 = 夹具画布色 #14141c——
        //   与 Android `root.setBackgroundColor(0xFF14141C)` / Web `html,body{background}` 同义。
        //   否则应用画布（375×800）之外的屏幕区域露出宿主黑（402×874 屏 ⇒ 右 27 / 下 74），
        //   在像素对比中成为**大面积假差异**（审计实测确认存在）。
        bridge.view?.backgroundColor = UIColor(red: 0x14 / 255.0, green: 0x14 / 255.0, blue: 0x1C / 255.0, alpha: 1)
        let out = evalJs("__proteus.renderStress()")
        NSLog("[proteus] stress 渲染：%@", String(out.prefix(240)))
        // ★★滚动手势探针（2026-10-02 —— 「示例页可一直上下滚」的 iOS 侧修复证据）：
        //   ① 范围已在**渲染路径**里从内核几何推导（`contentScrollRangeEnabled` ⇒ rects 最大 maxY）；
        //   ② 真实 pan 出口（`driveScrollDrag`——与真手指同一条路径）拖一段；
        //   ③ 报告 `scroll_after_drag`（内容页应恒为 0）作为**机器判据**；
        //   ④ 记录后复位（截图不受探针影响——与 Android `StressSfcActivity` 同款纪律）。
        var scrollProbe: [String: Any] = [:]
        if let v = bridge.view {
            scrollProbe["scroll_range"] = v.verticalRangeSet ? v.verticalRange : -1
            // ★钳制生效的直接证据：未设置范围时 offset 可被拖走（首版实测 120）——
            //   记为哨兵式读数，判据看 `scroll_after_drag`（与 Android 的 `-999` 同约定）。
            let before = Double(v.contentOffset.y)
            scrollProbe["scroll_before_drag"] = before
            // 真实手势出口（`driveScrollDrag` = pan 识别器的唯一出口），模拟「手指上移」6×20pt：
            //   pan 处理器把手指上移（translation.y<0）换算为内容位移 dy=+20 ⇒ 逐步累加。
            for _ in 0..<6 {
                _ = v.driveScrollDrag(dx: 0, dy: 20)
            }
            scrollProbe["scroll_after_drag"] = Double(v.contentOffset.y)
            scrollProbe["drag_drive_count"] = v.scrollDragDriveCount
            // 记录后复位（截图不受探针影响——与 Android `StressSfcActivity` 同款纪律）：
            // 内容页 range=0 时 offset 本就是 0；若钳制失效被拖走，这里归零保证截图干净，
            // 而 `scroll_after_drag` 已如实留证（判据看它，不看复位后的值）。
            _ = v.applyContentOffset(dx: -v.contentOffset.x, dy: -v.contentOffset.y)
            scrollProbe["scroll_reset_ok"] = Double(v.contentOffset.y) == 0
        } else {
            scrollProbe["scroll_range_error"] = "view 未建立"
        }
        // ★截图（宿主自有能力：UIGraphicsImageRenderer 渲染视图层——与 `snapshot(named:)` 同路径）
        let snapPath = bridge.view?.snapshot(named: SelfDrawBridge.snapshotName)
        var report: [String: Any] = [
            "ok": out.contains("\"ok\":true") && snapPath != nil,
            "path": "stress-sfc",
            "snapshot_ok": snapPath != nil,
            "snapshot_name": SelfDrawBridge.snapshotName,
            "js_raw": out,
            "scroll_probe": scrollProbe,
        ]
        // ★★与 selfdraw/bench 报告同形态（2026-10-02）：JS 读数进 `js_report` 子对象 + 顶层
        //   `run_ts`——采集脚本的**内容级新鲜度/构建断言**（check-report-freshness.mjs /
        //   check-report-build-id.mjs）读的就是这两个字段。缺了只能靠"文件存在"弱判据
        //   （本仓实测过的旧报告假绿形态：A/B 两轮其实在同一份旧数据上比）。
        if let d = out.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            report["js_report"] = o
        }
        report["run_ts"] = Date().timeIntervalSince1970
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("\(SelfDrawBridge.reportFileName).json")
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: url)
        }
        NSLog("[proteus] SELFDRAW_REPORT_READY path=%@", url.path)
        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" {
            exit(report["ok"] as? Bool == true ? 0 : 1)
        }
    }

    /// ★★★矩阵 #10：**原生组件混用**（自绘 + 原生 UIView 共存）——iOS 腿。
    ///
    /// 【与 Android `native-host-verify.py` 三件事同族】
    ///   ① **位置由 Rust 核心决定**：原生 UIView 的 frame == 核心几何（`native_hosts` 清单 + rects）
    ///   ② **原生真在渲染**：截图像素采样在原生区取到原生色（#E53935 红）
    ///   ③ **z-order 实测**：与原生 **重叠** 的自绘色块，屏幕上显示哪个
    ///      （iOS：原生 UIView 是 `SelfDrawView` 的**子视图** ⇒ 子视图在 CALayer 树之上 ⇒ 原生在上）
    ///
    /// 【与 Android 的差异（如实）】Android 走 `dispatchDraw` 后加子 View；iOS 走 `addSubview`
    ///   （UIKit 视图层级天然覆盖 CALayer 内容）——**同一语义、不同平台机制**。
    ///
    /// 【链路】① 建树（含 native_host 标记的节点；内核回传 `native_hosts` 清单）
    ///   ② 从**核心真源**读该节点几何 ⇒ 建原生 UIView（红底 + "Native" UILabel）按 frame 落位
    ///   ③ 自绘层同时渲染（含与原生**重叠**的色块——**故意重叠**以验 z-order）
    ///   ④ 像素采样 + 截图 + 报告落盘。
    private func driveNativeMix(ctx: JSContext) {
        let evalJs = { (expr: String) -> String in ctx.evaluateScript(expr)?.toString() ?? "null" }
        // 画布底色与夹具一致（避免大面积假差异——与 driveStress 同纪律）
        bridge.view?.backgroundColor = UIColor(red: 0x14 / 255.0, green: 0x14 / 255.0, blue: 0x1C / 255.0, alpha: 1)
        let out = evalJs("__proteus.renderNativeMix()")
        NSLog("[proteus] native-mix 渲染：%@", String(out.prefix(400)))

        // ── 从 JS 回执读**核心真源几何**（native_hosts 清单 + 该节点 rect + 重叠块 rect）──
        var hostFrame: CGRect = .zero
        var overlapFrame: CGRect = .zero
        var hostNodeId = -1
        var coreRects: [String: Any] = [:]
        if let d = out.data(using: .utf8),
           let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            if let nh = o["native_host_node_id"] as? Int { hostNodeId = nh }
            if let r = o["native_host_rect"] as? [String: Any],
               let x = r["x"] as? Double, let y = r["y"] as? Double,
               let w = r["width"] as? Double, let h = r["height"] as? Double {
                hostFrame = CGRect(x: x, y: y, width: w, height: h)
            }
            if let r = o["overlap_rect"] as? [String: Any],
               let x = r["x"] as? Double, let y = r["y"] as? Double,
               let w = r["width"] as? Double, let h = r["height"] as? Double {
                overlapFrame = CGRect(x: x, y: y, width: w, height: h)
            }
            coreRects = o
        }

        // ── ② 原生 UIView：**按核心几何定位**（不是我们手写坐标）──
        var nativeView: UIView?
        if hostNodeId >= 0 && hostFrame != .zero, let host = bridge.view {
            let v = UIView(frame: hostFrame)
            v.backgroundColor = UIColor(red: 0xE5 / 255.0, green: 0x39 / 255.0, blue: 0x35 / 255.0, alpha: 1)
            let label = UILabel(frame: v.bounds)
            label.text = "UIKit Native"
            label.textColor = .white
            label.font = UIFont.systemFont(ofSize: 12)
            label.textAlignment = .center
            v.addSubview(label)
            host.addSubview(v)
            nativeView = v
        }

        // ── ④ 像素采样（原生区 + 重叠区）+ 截图 + 报告 ──
        var samples: [String: Any] = [:]
        if bridge.view != nil {
            // ★`samplePixels` 在 **bridge** 上（内部持 view + 走"渲染一次读多点"的层渲染路径），
            //   不在 SelfDrawView 上（首版按 view 调 ⇒ 编译错——方法归属要读实现，不猜）。
            //   原生区中心采样（应取到原生红——若被自绘遮挡或未渲染则会不同）
            // ★格式（读实现确认，不猜）：`samplePixels` 吃**裸数组** `[{"x":..,"y":..},...]`
            //   （首版按 `{"points":[...]}` 包一层 ⇒ "points 解析失败（需数组）"）。
            let pts: [[String: Double]] = [
                // ① 原生区中心（应取到原生红 #E53935）
                ["x": Double(hostFrame.midX), "y": Double(hostFrame.midY)],
                // ② 重叠区中心（z-order 判定：原生在上 ⇒ 红）
                ["x": Double(overlapFrame.midX), "y": Double(overlapFrame.midY)],
                // ③ 对照点：重叠块的**左下**（原生只覆盖该区右侧/上方 ⇒ 此处应仍是自绘蓝 #2f6fed）
                ["x": Double(overlapFrame.minX + 4), "y": Double(overlapFrame.maxY - 4)],
            ]
            // ★作用域（编译错抓出）：`jsonStringList` 是 `SelfDrawBridge` 的私有方法，本函数在
            //   `SelfDrawViewController` ⇒ 直接内联序列化（不再加一份跨类可见性）。
            if let pj = try? JSONSerialization.data(withJSONObject: pts),
               let pjStr = String(data: pj, encoding: .utf8) {
                samples["all_points"] = bridge.samplePixels(pjStr)
            }
        }
        // 截图（原生 UIView 在视图层级里 ⇒ UIGraphicsImageRenderer 渲染含子视图）
        let snapPath = bridge.view?.snapshot(named: SelfDrawBridge.snapshotName)
        var report: [String: Any] = [
            "ok": out.contains("\"ok\":true") && nativeView != nil && snapPath != nil,
            "path": "native-mix",
            "host_id": "ios",
            "native_host_node_id": hostNodeId,
            "native_view_frame": [hostFrame.origin.x, hostFrame.origin.y, hostFrame.width, hostFrame.height],
            "overlap_frame": [overlapFrame.origin.x, overlapFrame.origin.y, overlapFrame.width, overlapFrame.height],
            "native_view_added": nativeView != nil,
            "samples": samples,
            "snapshot_ok": snapPath != nil,
            "js_raw": out,
            "core_rects": coreRects,
            "note": "iOS 腿：原生 UIView（UIKit）按**核心几何**定位 + 与自绘重叠色块共存——与 Android native-host 三件事同族"
                + "（① 位置由核心决定 ② 原生真渲染 ③ z-order 实测：iOS 子视图在 CALayer 之上 ⇒ 原生在上）",
        ]
        report["run_ts"] = Date().timeIntervalSince1970
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("\(SelfDrawBridge.reportFileName).json")
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: url)
        }
        NSLog("[proteus] SELFDRAW_REPORT_READY path=%@", url.path)
        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" {
            exit(report["ok"] as? Bool == true ? 0 : 1)
        }
    }


    /// ★★★A/B（矩阵 #14 续）：**Vapor vs Vue 运行时**对照——iOS 腿。
    ///
    /// 【与 Android/鸿蒙的关系】**同一份** `bundle-vapor.js`（零移植）+ **同一份判据**
    ///   （`hosts/android/check-vapor-ab.py`）：JSVM/JSC 都直接 eval 同一份 IIFE。
    ///
    /// 【宿主签名适配（JS 侧 shim——为什么不用改宿主方法）】共享 bundle 调
    ///   `proteusHost.tapAt("<json>")` / `scrollRows("<json>")`（Android 形态），
    ///   而 iOS 宿主是 `tapAt(_ x: Double, _ y: Double)` / `scrollRows(_ dx: Double, _ dy: Double)`
    ///   （V9/V16 既有用例依赖它——**改签名会破既有读数**）。
    ///   ⇒ 在 eval bundle **之前**用 JS 建一个 `proteusHost` 适配对象（shim）：
    ///     逐方法转调 `proteusSelfDraw.*`，**两边零改动**。
    /// ★★★**Vapor 设备端链**（2026-10-03 · 三端对齐）：eval **与 Android/鸿蒙同一份**
    ///   `bundle-vapor.js` → 跑**默认模式**（runShort）→ 报告落盘（与 Android `vapor.json` 同形）。
    ///
    /// 【为什么与 driveVaporAb 并存（不是同一个）】A/B 跑 `mode:'ab'`（Vapor vs Vue 两路对照，
    ///   判据集 = check-vapor-ab.py④⑦）；本模式跑 runShort（**判据 ①–⑫**：实例化/增量/交互/
    ///   事件修饰符/混合文本/once·memo 门禁/表达式能力）——两边覆盖的能力面不同，都要有。
    ///
    /// 【宿主读数怎么来（判据 ④ 要"渲染真的发生了"的宿主侧独立证据）】
    ///   · mount 次数 / 节点数 / 层数：JS 侧 shim **计数并回读**（`__hostMountCalls` 等）；
    ///   · 离屏像素：iOS 侧真实渲染一遍数像素（`paintedPixelProbe`——层上真画了才计数）。
    private func driveVapor(ctx: JSContext) {
        let evalJs = { (expr: String) -> String in ctx.evaluateScript(expr)?.toString() ?? "null" }
        bridge.view?.backgroundColor = UIColor(red: 0x14 / 255.0, green: 0x14 / 255.0, blue: 0x1C / 255.0, alpha: 1)

        guard let bundleURL = Bundle.main.url(forResource: "bundle-vapor", withExtension: "js"),
              let bundleSrc = try? String(contentsOf: bundleURL, encoding: .utf8) else {
            NSLog("[proteus] vapor: 缺 bundle-vapor.js（构建脚本应复制——见 run-selfdraw.sh）")
            return
        }
        guard let artURL = Bundle.main.url(forResource: "vapor-artifacts", withExtension: "json"),
              let artifacts = try? String(contentsOf: artURL, encoding: .utf8) else {
            NSLog("[proteus] vapor: 缺 vapor-artifacts.json")
            return
        }
        // 宿主桥 shim（与 A/B 同一套签名归一）+ **调用计数**（判据 ④ 的宿主读数）
        ctx.evaluateScript("""
        globalThis.__hostMountCalls = 0; globalThis.__hostNodes = 0; globalThis.__hostCmds = 0;
        globalThis.proteusHost = {
          mount: function (s) { var r = proteusSelfDraw.mount(s); __hostMountCalls++;
            try { var o = JSON.parse(r); __hostNodes = (o.node_count || 0); __hostCmds = (o.layer_count || 0); } catch (e) {} return r; },
          applyOps: function (s) { return proteusSelfDraw.applyOps(s); },
          updatePatches: function (s) { return proteusSelfDraw.updatePatches(s); },
          mountVirtual: function (s) { return proteusSelfDraw.mountVirtual(s); },
          readRects: function () { return proteusSelfDraw.readRects(); },
          textPolicy: function (s) { return proteusSelfDraw.textPolicy(s); },
          probeChannels: function (s) { return proteusSelfDraw.probeChannels(s); },
          onGesture: function (n) { return proteusSelfDraw.onGesture(n); },
          tapAt: function (j) { var o = JSON.parse(j); return proteusSelfDraw.tapAt(o.x, o.y); },
          scrollRows: function (j) { var o = JSON.parse(j); return proteusSelfDraw.scrollRows(o.dx, o.dy); },
          // ★★★P3-3（2026-10-03 · 三端同步）：`<Transition>` 的宿主动画入口——
          //   iOS 宿主本就有完整动画能力（animStart + CADisplayLink 帧循环），此前只是没接到 vapor shim。
          //   ★`animStart` 之后**必须启帧循环**（内核只做求值，"每帧推一次"是宿主职责；
          //     与 Android `driveKernelAnimFrames()` 同纪律）。
          animStart: function (j) { var r = proteusSelfDraw.animStart(j); proteusSelfDraw.animStartFrameLoop(); return r; },
          animTick: function (j) { var o = JSON.parse(j); return proteusSelfDraw.animTick(o.dtMs); },
          animStop: function (j) { return proteusSelfDraw.animStop(j); },
          animActive: function () { return proteusSelfDraw.animActive(); }
        };
        """)
        ctx.evaluateScript(bundleSrc, withSourceURL: bundleURL)
        let args = jsonString2([
            "artifacts": artifacts,
            "viewport": ["width": Double(bridge.view?.bounds.width ?? 390),
                         "height": Double(bridge.view?.bounds.height ?? 844)],
            "rows": 8, "updates": 3,
        ])
        ctx.evaluateScript("globalThis.__PROTEUS_VAPOR_ARGS__ = \(jsStringLiteral(args));")
        let out = evalJs("__proteusVaporRun(globalThis.__PROTEUS_VAPOR_ARGS__)")
        NSLog("[proteus] vapor run：%@", String(out.prefix(300)))
        // ★离屏像素自检（宿主侧独立证据——见 paintedPixelProbe 注释）
        let pixels = bridge.paintedPixelProbe()
        var report: [String: Any] = [
            "ok": out.contains("\"ok\":true"),
            "path": "vapor",
            "host_id": "ios",
            "build_id": SelfDrawBridge.reportFileName,
            "host_mount_calls": Int(evalJs("__hostMountCalls")) ?? 0,
            "host_nodes": Int(evalJs("__hostNodes")) ?? 0,
            "host_cmds": Int(evalJs("__hostCmds")) ?? 0,
            "host_painted_samples": pixels.samples,
            "host_painted_colors": pixels.colors,
            "js_raw": out,
            "note": "iOS 腿：与 Android/鸿蒙**同一份** bundle-vapor.js + 同一份判据（零移植）；"
                + "宿主签名差异由 JS 侧 shim 归一；像素读数 = iOS 离屏渲染自检",
        ]
        if let d = out.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            report["js_report"] = o
            report["report"] = o
        }
        report["run_ts"] = Date().timeIntervalSince1970
        if let jr = report["js_report"] as? [String: Any] {
            for (k, v) in jr { if report[k] == nil { report[k] = v } }
        }
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("\(SelfDrawBridge.reportFileName).json")
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: url)
        }
        NSLog("[proteus] SELFDRAW_REPORT_READY path=%@", url.path)
        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" {
            exit(report["ok"] as? Bool == true ? 0 : 1)
        }
    }

    private func driveVaporAb(ctx: JSContext) {
        let evalJs = { (expr: String) -> String in ctx.evaluateScript(expr)?.toString() ?? "null" }
        bridge.view?.backgroundColor = UIColor(red: 0x14 / 255.0, green: 0x14 / 255.0, blue: 0x1C / 255.0, alpha: 1)

        // ── 读共享产物（构建期由 run-selfdraw.sh 从 Android 侧复制——同源零移植）──
        guard let bundleURL = Bundle.main.url(forResource: "bundle-vapor", withExtension: "js"),
              let bundleSrc = try? String(contentsOf: bundleURL, encoding: .utf8) else {
            NSLog("[proteus] vapor-ab: 缺 bundle-vapor.js（构建脚本应复制——见 run-selfdraw.sh）")
            return
        }
        guard let artURL = Bundle.main.url(forResource: "vapor-artifacts", withExtension: "json"),
              let artifacts = try? String(contentsOf: artURL, encoding: .utf8) else {
            NSLog("[proteus] vapor-ab: 缺 vapor-artifacts.json")
            return
        }
        // ── 宿主桥 shim（见方法注释：签名差异在 JS 侧归一）──
        ctx.evaluateScript("""
        globalThis.proteusHost = {
          mount: function (s) { return proteusSelfDraw.mount(s); },
          applyOps: function (s) { return proteusSelfDraw.applyOps(s); },
          updatePatches: function (s) { return proteusSelfDraw.updatePatches(s); },
          mountVirtual: function (s) { return proteusSelfDraw.mountVirtual(s); },
          readRects: function () { return proteusSelfDraw.readRects(); },
          textPolicy: function (s) { return proteusSelfDraw.textPolicy(s); },
          probeChannels: function (s) { return proteusSelfDraw.probeChannels(s); },
          onGesture: function (n) { return proteusSelfDraw.onGesture(n); },
          tapAt: function (j) { var o = JSON.parse(j); return proteusSelfDraw.tapAt(o.x, o.y); },
          scrollRows: function (j) { var o = JSON.parse(j); return proteusSelfDraw.scrollRows(o.dx, o.dy); },
          // ★★★P3-3（2026-10-03 · 三端同步）：`<Transition>` 的宿主动画入口——
          //   iOS 宿主本就有完整动画能力（animStart + CADisplayLink 帧循环），此前只是没接到 vapor shim。
          //   ★`animStart` 之后**必须启帧循环**（内核只做求值，"每帧推一次"是宿主职责；
          //     与 Android `driveKernelAnimFrames()` 同纪律）。
          animStart: function (j) { var r = proteusSelfDraw.animStart(j); proteusSelfDraw.animStartFrameLoop(); return r; },
          animTick: function (j) { var o = JSON.parse(j); return proteusSelfDraw.animTick(o.dtMs); },
          animStop: function (j) { return proteusSelfDraw.animStop(j); },
          animActive: function () { return proteusSelfDraw.animActive(); }
        };
        """)
        let vp = jsonString(["width": Double(bridge.view?.bounds.width ?? 390),
                             "height": Double(bridge.view?.bounds.height ?? 844)])
        // ── eval 共享 bundle + 调 run（mode:'ab'）──
        ctx.evaluateScript(bundleSrc, withSourceURL: bundleURL)
        let args = jsonString2([
            "artifacts": artifacts,
            "viewport": ["width": Double(bridge.view?.bounds.width ?? 390),
                         "height": Double(bridge.view?.bounds.height ?? 844)],
            "rows": 8, "updates": 3, "mode": "ab",
        ])
        // ★参数经 JS 字符串字面量传入（bundle 入口吃 JSON 串——与 Android Java 侧同形；
        //   用 jsStringLiteral 安全转义，避免 artifacts 里的引号破坏 JS 源）
        ctx.evaluateScript("globalThis.__PROTEUS_AB_ARGS__ = \(jsStringLiteral(args));")
        let out = evalJs("__proteusVaporRun(globalThis.__PROTEUS_AB_ARGS__)")
        NSLog("[proteus] vapor-ab run：%@", String(out.prefix(300)))
        // ★A/B 通道读数自检（本仓纪律：测量装置先自测——层探针曾因字符串插值未生效
        //   而输出 `{\(fields)}` 字面量 ⇒ 判据读到的"全空"是**装置坏了**而非层没建）。
        if let v = bridge.view {
            let diag = v.channelProbe("[1,2,3]")
            if !diag.contains("\"radius\"") {
                NSLog("[proteus] vapor-ab ✗ channelProbe 输出异常：%@", String(diag.prefix(200)))
            }
        }

        var report: [String: Any] = [
            "ok": out.contains("\"ok\":true"),
            "path": "vapor-ab",
            "host_id": "ios",
            "build_id": SelfDrawBridge.reportFileName,
            "viewport": vp,
            "js_raw": out,
            "note": "iOS 腿：与 Android/鸿蒙**同一份** bundle-vapor.js + 同一份判据（零移植）；"
                + "宿主签名差异由 JS 侧 shim 归一（tapAt/scrollRows 的 JSON vs 双参形态）",
        ]
        if let d = out.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            report["js_report"] = o
            // ★★A/B 同形（判据读法）：共享判据下钻 `report` 字段（Android/鸿蒙产物同形——
            //   产物的 JS 报告包在 `report` 里）。iOS 首版只写了 `js_report` ⇒ 判据报
            //   "通路未成功：None"（**形状不符会让判据完全读不到数据**——本仓同款坑第 N 次）。
            report["report"] = o
        }
        report["run_ts"] = Date().timeIntervalSince1970
        // ★顶层拍平（判据也可能从顶层读——与 Android/鸿蒙产物同形）
        if let jr = report["js_report"] as? [String: Any] {
            for (k, v) in jr { if report[k] == nil { report[k] = v } }
        }
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("\(SelfDrawBridge.reportFileName).json")
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: url)
        }
        NSLog("[proteus] SELFDRAW_REPORT_READY path=%@", url.path)
        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" {
            exit(report["ok"] as? Bool == true ? 0 : 1)
        }
    }

    /// JS 字符串字面量（安全转义：把 JSON 串包成 JS 源里的字符串——见 driveVaporAb 用法）
    private func jsStringLiteral(_ s: String) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: [s]),
              let arr = String(data: d, encoding: .utf8) else { return "\"\"" }
        // arr 形如 `["..."]` ⇒ 去掉方括号即得 JS 字符串字面量（JSON 转义与 JS 兼容）
        return String(arr.dropFirst().dropLast())
    }

    // ── ★★应用级事件源（K 组 iOS 腿）：两个**真系统回调**转发到 HostLifecycleEvents ──
    //   ★为什么在这里覆写：VC 的这两个方法是系统调用的**唯一入口**（通知中心没有等价通知）。
    //     两者都是"真实来源"——本仓不留"声明了但没来源"的事件（判据按观察者注册 + 真回调验）。

    /// 主题变化（iOS 13+ 外观切换 / 真系统回调）
    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        HostRuntimeScene.handleTraitChange(traitCollection)
    }

    /// 尺寸变化（旋转 / 分屏 / 折叠屏——真系统回调；pt 单位）
    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        HostRuntimeScene.handleTransition(size: size)
    }

    /// ★★逻辑层基准的驱动器：**逐用例**调用 `__proteus.step()`，每次之间让出主线程。
    ///
    /// 为什么这样驱动（同自绘场景的结论）：JSC 的 `evaluateScript` 不排空微任务，
    /// 而 Vue 的更新调度是微任务 ⇒ 一个用例跑完必须返回主线程，响应式才落地。
    /// 故：step → 让出 N 轮 → step …… 直到全部用例完成。
    /// ★★bench 驱动：**只负责泵微任务**，不干预用例推进
    ///
    /// 【为什么这么简单（本仓实测的教训）】初版由宿主逐用例 `step()` 并等 `completed` 增长；
    ///   一旦某个用例异常被吞，`completed` 永不增长 ⇒ 宿主无限等待 ⇒ **JS 空转 88 秒**
    ///   ⇒ 被 iOS 看门狗杀掉（现象：白屏几秒后闪退）。
    ///   ⇒ 现在：JS 侧 `runAll()` 一次性把整条用例链排进微任务；宿主只做**两件事**：
    ///     ① 反复让出主线程（让 JSC 排空微任务队列）② 看 `done()` 标志是否置位
    ///   ★同时加**总时长上限**：到点就收尾报告，绝不无限泵（本仓「等待必须有条件」纪律）。
    /// ★★bench 驱动：**一次一个用例**（本仓实测的关键修复）
    ///
    /// 【为什么不能一次性排完（真机看门狗实证）】曾把整条用例链一次性排进微任务，
    ///   而 JSC 在 `evaluateScript` 返回时会**把队列一次排空** ⇒ 23 个用例（含 4000 项挂载）
    ///   连续跑完、**中间从不回主线程** ⇒ 主线程 88 秒无响应 ⇒ 被 iOS 看门狗杀掉
    ///   （现象：白屏几秒后闪退；`cpu_resource` 日志显示 Total CPU Time 88.2s 全在 JavaScriptCore）。
    ///   ⇒ 正解：**每个用例一次 `step()`**，用例之间让出主线程（runloop 呼吸）。
    ///
    /// 【两个上限（本仓「等待必须有条件」纪律）】
    ///   · 单用例泵动轮数上限（防某个用例卡死）
    ///   · 总时长上限（超时也写报告，绝不无限等）
    private func driveBench(ctx: JSContext) {
        let evalJs = { (expr: String) -> String in ctx.evaluateScript(expr)?.toString() ?? "null" }
        let t0 = CFAbsoluteTimeGetCurrent()
        let totalSecLimit = 300.0
        let perCaseRoundLimit = 3000
        var roundsForCase = 0
        var beforeCompleted = 0

        func num(_ json: String, _ key: String) -> Int {
            guard let r = json.range(of: "\"\(key)\":") else { return 0 }
            let rest = json[r.upperBound...].drop(while: { $0 == " " })
            return Int(rest.prefix(while: { $0.isNumber })) ?? 0
        }

        func nextCase() {
            let elapsed = CFAbsoluteTimeGetCurrent() - t0
            if elapsed > totalSecLimit {
                NSLog("[proteus] bench 总时长超 %.0fs —— 强制收尾（已完成 %d）", totalSecLimit, beforeCompleted)
                _ = evalJs("__proteus.finish()")
                return
            }
            let out = evalJs("__proteus.step()")
            if out.contains("\"done\":true") {
                let fin = evalJs("__proteus.finish()")
                NSLog("[proteus] bench 全部完成（%.1fs）：%@", elapsed, String(fin.prefix(160)))
                return
            }
            roundsForCase = 0
            waitCase()
        }

        /// 等**当前用例**跑完（`completed` 增长），期间让出主线程
        func waitCase() {
            roundsForCase += 1
            let prog = evalJs("__proteus.progress()")
            let completed = num(prog, "completed")
            if completed > beforeCompleted {
                beforeCompleted = completed
                // 每 2 个用例报一次（避免日志爆炸）
                if completed % 2 == 1 {
                    NSLog("[proteus] bench %d/%d（%.1fs，本轮泵 %d）", completed, num(prog, "total"),
                          CFAbsoluteTimeGetCurrent() - t0, roundsForCase)
                }
                DispatchQueue.main.async { nextCase() }
                return
            }
            if roundsForCase > perCaseRoundLimit {
                NSLog("[proteus] bench 用例泵动超限（%d 轮）——跳过并继续", perCaseRoundLimit)
                DispatchQueue.main.async { nextCase() }
                return
            }
            DispatchQueue.main.async { waitCase() }
        }

        nextCase()
    }

    /// 相位驱动的调度器
    ///
    /// 每一步都在**独立的一次** evaluateScript 里执行，且之间让出主线程（微任务排空）。
    /// ★`pump(n)` 用来多轮推进「链式 Promise」（纯 JS 吞吐那一段需要 N 轮）。
    private func schedulePhases(ctx: JSContext, url: URL) {
        let js = { (expr: String) -> String in
            ctx.evaluateScript(expr)?.toString() ?? "null"
        }
        // 相位序列：{JS 表达式, 让出几轮}
        var steps: [(String, Int)] = [
            ("__proteus.mount()", 1),          // ① mount（同步完成）
            ("__proteus.pending()", 1),
            ("__proteus.updateGrow()", 2),     // ② 结构路径（改 ref → 微任务重渲染 → 宿主 update）
            ("__proteus.pending()", 1),
            ("__proteus.updateStyle()", 2),    // ③ 纯样式路径
            ("__proteus.pending()", 1),
            ("__proteus.throughput()", 1),     // ④ 纯 JS 吞吐（40 次链式）
            // ★★RT2（2026-09-30）：动画相位——指令驱动动画的真机验证
            //   （启动 / seek 手势驱动 / tick 时间驱动 / CADisplayLink 帧循环；判据见 check-anim-rt2.py）
            ("__proteus.animProbe()", 2),
            // ★★RT2 复杂动效（弹簧 / 打断接管 / FLIP / rotate+opacity）——判据见 check-anim-rt2.py F 组
            ("__proteus.animComplex()", 2),
            // ★★MA0-RT：平台零参与路径（合成属性判定 + CAKeyframe 提交 + presentation 探针）
            ("__proteus.animPlatform()", 2),
            // ★★MA1：预设驱动的转场（"一句话写动画"端到端 + 编译期校验）
            ("__proteus.animPreset()", 2),
            // ★★MA5：滚动联动（吸顶/视差/渐显——位置→进度在内核；含宿主滚动通路生产形态）
            ("__proteus.animScroll()", 2),
            // ★★MA6：序列编排（多段动画——"先下压再弹回"收敛在一条动画里）
            ("__proteus.animSequence()", 2),
            // ★★共享元素（从源矩形飞到目标再归位；几何在内核 + 宿主层级提升）
            ("__proteus.animShared()", 2),
            // ★★颜色通道（2026-10-01）：一个声明 → 四条内核通道 → 宿主真写层背景色
            ("__proteus.animColor()", 2),
            // ★★自定义贝塞尔（2026-10-01 转正）：回弹过冲 + 拒绝分支（判据 check-anim-rt2.py P9）
            ("__proteus.animBezier()", 2),
            // ★★循环与往复（2026-10-01 · A2）：repeat/yoyo/infinite（判据 check-anim-rt2.py R10）
            ("__proteus.animRepeat()", 2),
            // ★★裁剪形变（2026-10-01 · C1）：clip-path（判据 check-anim-rt2.py V13）
            ("__proteus.animClip()", 2),
            // ★★SVG 描边（2026-10-01 · C2）：strokeProgress 画线（判据 check-anim-rt2.py W14）
            ("__proteus.animStroke()", 2),
            // ★★主线程零唤醒实测（OS 级 CPU 会计 + 阳性对照）：**异步**两段各 600ms
            ("__proteus.animCpuProbe()", 0),
            // ★★RT2 帧率测席（§9 指标）：**异步**——由 CADisplayLink 跑满时长后回调续链
            //   （事件驱动：跑满即继续，不轮询/不 sleep；看门狗只在卡死时兜底）
            ("__proteus.animBench()", 0),
        ]
        // 吞吐链需要多轮推进：每轮让出后读一次 pending
        for _ in 0..<12 { steps.append(("__proteus.pending()", 1)) }
        steps.append(("__proteus.finalize()", 2))     // 收尾第一段（改回稳定状态）
        steps.append(("__proteus.finalize2()", 2))    // 收尾第二段（截图 + 上报）

        func run(_ i: Int) {
            guard i < steps.count else {
                NSLog("[proteus] 全部相位完成")
                return
            }
            let (expr, pump) = steps[i]
            // ★★帧率测席是**异步相位**：它要跑满真实时长（由 CADisplayLink 驱动）⇒ 相位链在此**停车**，
            //   由宿主在测量完成时回调 `animBenchPhaseDone` 续链（**事件驱动**——不是让谁在这儿等）。
            //   ★回调在 `js(expr)` 之前装好：即使测量瞬间结束也不会漏（DisplayLink 回调在下一轮 runloop 才可能触发）。
            if expr.hasPrefix("__proteus.animBench") {
                // ★run 是**局部函数**（不是方法）⇒ 续链闭包直接捕获它（不能用 self?.run）
                bridge.animBenchPhaseDone = {
                    DispatchQueue.main.async { run(i + 1) }
                }
                let benchOut = js(expr)
                NSLog("[proteus] %@ → %@", expr, String(benchOut.prefix(300)))
                return
            }
            // ★★CPU 探针（L 组）也是**异步相位**：两段各 windowMs（默认 600）⇒ 同样停车等回调
            if expr.hasPrefix("__proteus.animCpuProbe") {
                bridge.animCpuProbeDone = {
                    DispatchQueue.main.async { run(i + 1) }
                }
                let cpuOut = js(expr)
                NSLog("[proteus] %@ → %@", expr, String(cpuOut.prefix(300)))
                return
            }
            let out = js(expr)
            // 只记关键读数（避免日志爆炸——本仓「输出控制」纪律）
            if expr.hasPrefix("__proteus.mount") || expr.hasPrefix("__proteus.finalize2") || expr.hasPrefix("__proteus.animProbe") || expr.hasPrefix("__proteus.animComplex") || expr.hasPrefix("__proteus.animPlatform") || expr.hasPrefix("__proteus.animPreset") || expr.hasPrefix("__proteus.animScroll") || expr.hasPrefix("__proteus.animSequence") || expr.hasPrefix("__proteus.animShared") || expr.hasPrefix("__proteus.animColor") || expr.hasPrefix("__proteus.animBezier") || expr.hasPrefix("__proteus.animRepeat") || expr.hasPrefix("__proteus.animClip") || expr.hasPrefix("__proteus.animStroke") || expr.hasPrefix("__proteus.animCpu") {
                NSLog("[proteus] %@ → %@", expr, String(out.prefix(400)))
            }
            // ★让出主线程 pump 轮：每轮一次 runloop 循环 ⇒ 微任务队列被排空
            var remaining = pump
            func next() {
                if remaining > 0 {
                    remaining -= 1
                    DispatchQueue.main.async { next() }
                } else {
                    run(i + 1)
                }
            }
            next()
        }
        run(0)
    }
}

final class SelfDrawSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        w.rootViewController = SelfDrawViewController()
        w.makeKeyAndVisible()
        window = w
    }
}

@main
final class SelfDrawAppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ a: UIApplication, didFinishLaunchingWithOptions o: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // ★ ② 号锚点：应用可见的第一个时刻（用于分解"启动框架 vs 首帧渲染"）
        SelfDrawViewController.didLaunchWall = CFAbsoluteTimeGetCurrent()
        return true
    }
    func application(_ a: UIApplication, configurationForConnecting s: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c = UISceneConfiguration(name: "Default", sessionRole: s.role)
        c.delegateClass = SelfDrawSceneDelegate.self
        return c
    }
}
