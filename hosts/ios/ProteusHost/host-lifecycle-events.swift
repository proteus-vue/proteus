// hosts/ios/ProteusHost/host-lifecycle-events.swift
// ★★App 端**应用级生命周期事件源**（iOS 腿）：真实系统观察者 → JS 运行时。
//
// 【与 Android 腿的关系】契约与 `HostLifecycleEvents.java` 同构：每条事件经
//   `globalThis.__proteusHostAppEvent(evt, payloadJson)` 转发（JS 侧 `installAppEventSource()` 消费）；
//   同一份三链记账（真回调 attempts → 推送 pushes → JS 收到 seen）并入死前落盘的证据文件。
//
// 【★★诚实分档（iOS 平台能力，逐条取证后的真实边界）】
// | 事件 | iOS 真实来源（本类） | 脚本可驱动性 |
// |---|---|---|
// | `error` | `NSSetUncaughtExceptionHandler`（真未捕获 ObjC 异常捕获） | ★**可驱动**：`--k-crash` 启动参数 → 后台线程 raise 真异常（进程真死） |
// | `memory-warning` | `UIApplication.didReceiveMemoryWarningNotification`（真系统通知） | ★不可脚本驱动：devicectl 无模拟内存警告通道（需真机低内存事件） |
// | `theme-change` | VC `traitCollectionDidChange`（真系统回调） | ★不可脚本驱动：devicectl 无外观切换通道（需人工在设置/控制中心切换外观） |
// | `resize` | VC `viewWillTransition`（真系统回调，旋转/分屏） | ★不可脚本驱动：devicectl 无旋转通道（需人工旋转设备） |
// | `audio-interruption-*` | `AVAudioSession.interruptionNotification`（真 iOS 音频会话语义） | ★不可脚本驱动：需真实来电/其他 App 抢占音频（人工动作） |
// | `unhandled-rejection` / `page-not-found` | ★**iOS 无此概念**（JS 引擎语义 / 框架 router 事实——与 Android 同判） |
//   ⇒ K 组判据对 iOS：`error` 走**三环对齐**（真驱动）；其余四条按"**观察者已注册**"验（诚实标注，
//     **不假装驱动过**——本仓纪律：宣称不得先于实现，验证不得先于能力）。
//
// 【证据链（与 Android 同构、字段可被同一判据读）】死前落盘 `host-app-events.json`：
//   `{ ts, native: {attempts, pushes, lastPayload, history, observers, …}, jsProbe: {…}, crash: {…} }`

import AVFoundation
import Foundation
import UIKit

final class HostLifecycleEvents: NSObject {
    private static let TAG = "proteus-lifecycle"

    /// 单例（★必须：`NSSetUncaughtExceptionHandler` 是 C 函数指针，**不能捕获上下文**）
    static let shared = HostLifecycleEvents()

    /// JS 求值入口（壳注入——`ctx.evaluateScript(...)?.toString()`）
    private var eval: ((String) -> String)?
    /// 证据落盘目录（Documents——脚本经 devicectl copy 取回）
    private var evidenceDir: URL?

    // ── ★K 组记账（真回调 → 壳推送的独立证据；见文件头） ──
    private let lock = NSLock()
    private var attempts: [String: Int] = [:]
    private var pushes: [String: Int] = [:]
    private var lastPayload: [String: String] = [:]
    private var history: [String] = [] // JSON 条目串（evt/payload/ts），上限 64

    /// 注册面记录（哪些观察者已装配——判据据此分档"已注册/未驱动"）
    private var observers: [String: Bool] = [:]
    private var errorHandlerInstalled = false
    private var observersInstalled = false
    private var crashTriggered = false
    /// ★K 探针驱动的记录（实际设置值——判据做载荷内容断言；见 driveKProbes）
    private var drives: [String: String] = [:]
    /// ★★原 handler（**安装时保存**——绝不能运行时用 `NSGetUncaughtExceptionHandler` 查：
    ///   它返回"当前"值，即**我们自己** ⇒ 链式调用变成无限递归。
    ///   实测代价：一次崩溃产生 **1629 次 error 转发**，并把 64 条历史环冲刷干净。
    ///   ★这是"链式保留原 handler"这条纪律在 iOS 上的**特有陷阱**（Android 侧不存在：那里
    ///   装之前先 `getDefaultUncaughtExceptionHandler()` 并捕获进闭包，天然是"装前的值"）。
    private static var prevHandler: (@convention(c) (NSException) -> Void)?
    /// 崩溃处理**重入保护**（防御任何形式的重复进入——同进程只转发一次）
    private static let crashGuard = NSLock()
    private static var crashHandling = false

    /// 上次主题/尺寸（变化判定——与 Android 的 lastUiMode/lastWidthDp 同构）
    private var lastStyleRaw = -1
    private var lastSize: CGSize = .zero
    /// 音频中断进行中（配对语义：begin/end 交替才派发——与 Android audioInterrupted 对应）
    private var audioInterrupted = false

    private override init() { super.init() }

    // ────────────────────────── 装配 ──────────────────────────

    /// 装配全部观察者（幂等——场景注入 eval 后调用一次）
    func configure(eval: @escaping (String) -> String, evidenceDir: URL) {
        self.eval = eval
        self.evidenceDir = evidenceDir
        guard !observersInstalled else { return }
        observersInstalled = true

        if #available(iOS 13.0, *) {
            lastStyleRaw = Int(UIScreen.main.traitCollection.userInterfaceStyle.rawValue)
        }
        lastSize = UIScreen.main.bounds.size

        // ① 内存警告（真系统通知）
        NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main
        ) { [weak self] _ in
            // iOS 无分级（与 Android 的 TRIM_MEMORY_* 不同）⇒ level 固定 2（约定档）+ 如实来源
            self?.forwardToJs("memory-warning", "{\"level\":2,\"source\":\"didReceiveMemoryWarning\"}")
        }
        observers["memory"] = true

        // ② 音频会话中断（真 iOS 语义：AVAudioSession.interruptionNotification）
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in
            guard let num = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber,
                  let type = AVAudioSession.InterruptionType(rawValue: num.uintValue) else { return }
            self?.markAudioInterruption(begin: type == .began)
        }
        observers["audio"] = true

        // ③ 主题 / 尺寸（VC 系统回调转发——见 selfdraw-scene.swift 的两个覆写）
        observers["theme"] = true
        observers["resize"] = true

        // ④ 全局未捕获异常（真钩子；链式保留原 handler）
        installErrorHandler()

        NSLog("[\(Self.TAG)] iOS 应用事件源装配完成：memory/theme/resize/audio 已注册 + error 钩子已装")
    }

    /// 场景记录：`--k-crash` 时在生命周期往返完成后触发真未捕获异常
    func requestCrashOnRoundTrip() {
        crashTriggered = true
    }

    var wantsCrash: Bool { crashTriggered }

    // ────────────────────────── ★K 探针驱动（iOS 可驱动面） ──────────────────────────
    //
    // 【为什么是"应用内驱动"（与 Android 的 adb 外部驱动不同——诚实说明）】
    //   iOS 设备侧**没有外部事件注入通道**（devicectl 无内存警告/外观/旋转命令；对比 Android 的
    //   `am send-trim-memory` / `cmd uimode` / `wm user-rotation`）⇒ 能做的驱动是**走真实 UIKit 路径**：
    //     · theme-change：改 `window.overrideUserInterfaceStyle` ⇒ UIKit **真的**改 trait →
    //       VC 的 `traitCollectionDidChange` 真回调（与用户切外观**同一条链**）。
    //     · memory-warning：post `UIApplication.didReceiveMemoryWarningNotification` ⇒
    //       观察者走**真 NotificationCenter 派发**（UIKit 在内存压力时也 post 这条通知——
    //       通知本身是公开契约；"UIKit 何时 post"不是本项目代码，属平台行为）。
    //   · resize / audio：无任何可驱动通道（需真旋转/真来电）⇒ 只验"观察者已注册"，不假装驱动。
    //   ⇒ 证据文件里带 `drives` 字段（本方法实际设置的值）——判据按它做载荷内容断言。
    func driveKProbes() {
        // ① theme：两步（保证必然发生一次真实 trait 变化，且终态 = dark）——与 Android 的
        //   `uimode night no → yes` 同构；第二个设置排到下一轮主循环（防 trait 更新被合并）
        applyStyle(.light)
        DispatchQueue.main.async { [weak self] in
            self?.applyStyle(.dark)
            // ② memory：真通知路径（见上）
            NotificationCenter.default.post(
                name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
            NSLog("[\(Self.TAG)] K 探针已驱动：theme(light→dark) + memory(通知)")
        }
    }

    private func applyStyle(_ style: UIUserInterfaceStyle) {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let win = scene.windows.first else {
            NSLog("[\(Self.TAG)] 找不到窗口——theme 探针无法驱动")
            return
        }
        win.overrideUserInterfaceStyle = style
        lock.lock()
        drives["theme"] = style == .dark ? "dark" : "light" // ★判据按它核对载荷内容
        lock.unlock()
    }

    // ────────────────────────── 系统回调入口（真来源） ──────────────────────────

    /// 主题变化（`SelfDrawViewController.traitCollectionDidChange` 转发进来）
    func handleTraitChange(styleRaw: Int) {
        guard styleRaw != lastStyleRaw, styleRaw != UIUserInterfaceStyle.unspecified.rawValue else { return }
        lastStyleRaw = styleRaw
        let theme = styleRaw == UIUserInterfaceStyle.dark.rawValue ? "dark" : "light"
        NSLog("[\(Self.TAG)] 配置变化：主题 → \(theme)")
        forwardToJs("theme-change", "{\"theme\":\"\(theme)\"}")
    }

    /// 尺寸变化（`SelfDrawViewController.viewWillTransition` 转发进来）——单位 pt（≈ Android dp）
    func handleTransition(size: CGSize) {
        guard size != lastSize, size.width > 0, size.height > 0 else { return }
        lastSize = size
        let w = Int(size.width.rounded())
        let h = Int(size.height.rounded())
        NSLog("[\(Self.TAG)] 配置变化：尺寸 → \(w)x\(h)pt")
        forwardToJs("resize", "{\"windowWidth\":\(w),\"windowHeight\":\(h)}")
    }

    /// 音频中断（配对语义与 Android 一致：begin/end 交替才派发）
    func markAudioInterruption(begin: Bool) {
        if begin && !audioInterrupted {
            audioInterrupted = true
            NSLog("[\(Self.TAG)] 音频中断开始（AVAudioSession interruption began）")
            forwardToJs("audio-interruption-begin", "null")
        } else if !begin && audioInterrupted {
            audioInterrupted = false
            NSLog("[\(Self.TAG)] 音频中断结束（AVAudioSession interruption ended）")
            forwardToJs("audio-interruption-end", "null")
        }
    }

    // ────────────────────────── 全局错误（真钩子） ──────────────────────────

    /// ★安装未捕获异常钩子（对应 `App.onError`）。链式保留原 handler（不吞别人的崩溃上报）。
    /// ★★崩溃时：把 JS 转发与证据落盘**切到主线程**（JSC 上下文是主线程持有的），
    ///   最多等 3 秒（主线程不可用 ⇒ 无法落盘：判据因证据缺失而红，诚实不静默）。
    /// ★★必须**全程用显式类型名**（`HostLifecycleEvents.…`）而不能用 `Self.…`：
    ///   `NSSetUncaughtExceptionHandler` 收的是 **C 函数指针**，Swift 禁止其闭包捕获动态 Self
    ///   （实测编译错：`a C function pointer cannot be formed from a closure that captures dynamic Self type`）。
    private func installErrorHandler() {
        guard !errorHandlerInstalled else { return }
        errorHandlerInstalled = true
        // ★★安装时**保存原 handler**（见 prevHandler 注释：运行时查 = 拿到自己 = 无限递归）
        HostLifecycleEvents.prevHandler = NSGetUncaughtExceptionHandler()
        NSSetUncaughtExceptionHandler { exception in
            // ★重入保护：同进程只做一次转发/落盘（其余进入直接放行到原 handler）
            HostLifecycleEvents.crashGuard.lock()
            let firstEntry = !HostLifecycleEvents.crashHandling
            if firstEntry { HostLifecycleEvents.crashHandling = true }
            HostLifecycleEvents.crashGuard.unlock()
            if firstEntry {
                let name = exception.name.rawValue
                let reason = exception.reason ?? "(无 reason)"
                let msg = "\(name): \(reason)"
                let threadName = Thread.current.name ?? "(未命名线程)"
                NSLog("[%@] uncaught %@: %@", HostLifecycleEvents.TAG, threadName, msg)
                var ack = "main-unavailable"
                let sem = DispatchSemaphore(value: 0)
                DispatchQueue.main.async {
                    ack = HostLifecycleEvents.shared.forwardToJs("error", "{\"error\":\(HostLifecycleEvents.jsonString(msg))}")
                    HostLifecycleEvents.shared.writeEvidence(note: "ios-uncaught", thread: threadName, errMsg: msg, jsAck: ack)
                    sem.signal()
                }
                _ = sem.wait(timeout: .now() + 3)
            }
            // 链式调用**安装时保存的**原 handler（随后进程按未捕获异常默认行为终止）
            if let prev = HostLifecycleEvents.prevHandler {
                prev(exception)
            }
        }
    }

    /// ★真未捕获异常（**后台线程** raise——不经主线程 RunLoop 捕获）：K 组 error 链的真驱动。
    ///   ★为什么用 NSException 而不是 Swift `fatalError`：后者是**信号**（SIGILL），
    ///     不经过 `NSSetUncaughtExceptionHandler`——而 App.onError 对应的正是 ObjC 异常钩子。
    func triggerTestCrash() {
        let t = Thread {
            NSException(name: .genericException, reason: "proteus-test-crash", userInfo: nil).raise()
        }
        t.name = "proteus-test-crash"
        t.start()
    }

    // ────────────────────────── 转发通道 ──────────────────────────

    /// 转发到 JS（`__proteusHostAppEvent`）并记账；返回**回执**（'ok'/'no-hook'/'unknown-event:…'/…）。
    /// ★必须主线程（JSC 上下文主线程持有）——非主线程调用时切主线程（500ms 超时，避死锁）。
    @discardableResult
    func forwardToJs(_ evt: String, _ payloadJson: String) -> String {
        if !Thread.isMainThread {
            var ack = "main-timeout"
            let sem = DispatchSemaphore(value: 0)
            DispatchQueue.main.async {
                ack = HostLifecycleEvents.shared.forwardToJs(evt, payloadJson)
                sem.signal()
            }
            _ = sem.wait(timeout: .now() + 0.5)
            return ack
        }
        lock.lock()
        attempts[evt, default: 0] += 1
        lastPayload[evt] = payloadJson
        let entry = "{\"evt\":\(Self.jsonString(evt)),\"payload\":\(payloadJson),\"ts\":\(Int(Date().timeIntervalSince1970 * 1000))}"
        history.append(entry)
        while history.count > 64 { history.removeFirst() }
        lock.unlock()
        NSLog("[\(Self.TAG)] attempt \(evt)")

        guard let eval else { return "no-eval" }
        let ack = eval("typeof __proteusHostAppEvent === 'function' ? String(__proteusHostAppEvent(\(Self.jsonString(evt)), \(payloadJson))) : 'no-hook'")
        if ack != "no-hook", !ack.hasPrefix("unknown-event"), !ack.hasPrefix("error"), ack != "bad-event" {
            lock.lock()
            pushes[evt, default: 0] += 1
            let n = pushes[evt] ?? 0
            lock.unlock()
            NSLog("[\(Self.TAG)] push-ok \(evt) #\(n)")
        } else {
            NSLog("[\(Self.TAG)] push-skip \(evt) ack=\(ack)")
        }
        return ack
    }

    // ────────────────────────── 证据落盘 ──────────────────────────

    /// 死前落盘：`{ ts, native: {...}, jsProbe: {...}, crash: {...} }`（未捕获异常处理器内调用）
    func writeEvidence(note: String, thread: String, errMsg: String, jsAck: String) {
        guard let dir = evidenceDir else { return }
        var probe: Any = NSNull()
        if let raw = eval?("JSON.stringify(globalThis.__proteusAppEventProbe || null)"),
           !raw.isEmpty, raw != "null",
           let data = raw.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) {
            probe = obj
        }
        let evidence: [String: Any] = [
            "ts": Int(Date().timeIntervalSince1970 * 1000),
            "native": stats(),
            "jsProbe": probe,
            "crash": ["note": note, "thread": thread, "error": errMsg, "jsAck": jsAck],
        ]
        let url = dir.appendingPathComponent("host-app-events.json")
        if let data = try? JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys]) {
            do {
                try data.write(to: url)
                NSLog("[\(Self.TAG)] K 证据已写入 \(url.path)")
            } catch {
                NSLog("[\(Self.TAG)] K 证据写入失败：\(error.localizedDescription)")
            }
        }
    }

    /// 记账快照（供证据文件；与 Android 的 stats() 同构）
    func stats() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        var lastParsed: [String: Any] = [:]
        for (k, raw) in lastPayload {
            if raw == "null" { lastParsed[k] = NSNull(); continue }
            if let d = raw.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) {
                lastParsed[k] = o
            } else {
                lastParsed[k] = raw
            }
        }
        let historyParsed: [Any] = history.compactMap { s in
            guard let d = s.data(using: .utf8) else { return nil }
            return try? JSONSerialization.jsonObject(with: d)
        }
        return [
            "attempts": attempts,
            "pushes": pushes,
            "lastPayload": lastParsed,
            "history": historyParsed,
            "observers": observers,
            "drives": drives,
            "errorHandlerInstalled": errorHandlerInstalled,
            // ★与 Android 的 stats() 字段对齐（同一判据读法；iOS 的"接收器"= 音频通知观察者）
            "audioReceiverRegistered": observers["audio"] == true,
        ]
    }

    private static func jsonString(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [s]),
              var out = String(data: data, encoding: .utf8) else { return "\"\"" }
        out.removeFirst() // '['
        out.removeLast()  // ']'
        return out
    }
}
