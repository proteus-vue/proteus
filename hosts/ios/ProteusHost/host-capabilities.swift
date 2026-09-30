// hosts/ios/ProteusHost/host-capabilities.swift
// ★★App 端原生能力实现（iOS 腿）——**真实 UIKit/Foundation 实现**，不是签名桩。
//
// 【与 Android 腿的关系（本仓纪律：同一语义一处实现，两个壳各自真做）】
//   契约与 `hosts/android/.../HostCapabilities.java` **逐方法对齐**（`invoke(method, argsJson) -> JSON`）：
//     · 成功：`{"ok":true,"data":…}`
//     · 未实现（诚实降级）：`{"ok":false,"reason":"unsupported: …","missing":true}`
//       ——JS 桥（`invokeHost`）据此映射为 `*.unsupported` 能力位（不假装成功）
//     · 失败：`{"ok":false,"reason":"…","missing":false}`
//   ★为什么 iOS 用"返回 missing 标记"而 Android 用抛异常：两者都是**桥已定义的形态**
//     （`invokeHost` 的注释写明两条通道）——各自贴合平台习惯，判据侧同一份（看 ok/missing）。
//
// 【为什么需要它（用户质疑「App 端是真的落地能力实现了吗？不是只有一个壳转发通道？」）】
//   取证确认：iOS 壳此前只有 memUsage/gc/post 三个方法，**没有 invoke 通道** ⇒ J 组判据对 iOS
//   是"待办"。本类补齐 iOS 侧的真实实现；能用真 API 的都用真 API：
//
// | 方法 | iOS 真实来源（本类） |
// |---|---|
// | `host.context` | `Bundle.main` 的 CFBundleShortVersionString（真版本号）+ 能力清单 |
// | `update.check` | `Bundle.main` 版本号 + 诚实说明（App Store 政策禁止应用内自更新） |
// | `window.setSize` | `UIScreen.main.bounds`（真读数）；全屏 App 不可程序化改窗口 ⇒ `applied:false`（如实） |
// | `worker.create/post/terminate` | 每 worker 一个 `DispatchQueue`（真后台线程；post 记录实际线程名） |
// | `idle.request/cancel` | 队列 + **主循环下一轮**执行（真实空闲时机；对应 Android 的帧回调泵） |
// | `preload.assets` | Bundle 资源真实解码（`UIImage(contentsOfFile:)`——让解码表预热） |
// | `extension.load` | ★诚实 unsupported：iOS 禁止动态模块加载（App Store 政策；dlopen 第三方代码拒审） |
// | `mini-program.navigate` | ★诚实 unsupported：iOS 无小程序概念（跨 App 跳转请用 URL Scheme/Universal Links） |
// | `native.calls` | 宿主自报调用记账（判据证明"能力确实经壳执行"） |
// | `webassembly.*` | ★**不实现**——JSC 内建 WebAssembly（实测 `typeof WebAssembly === 'object'`）⇒
//   |                 |   JS 桥 `getWebAssembly()` 回落"引擎内建"路径（真执行，见 J 组 ⑨） |

import Foundation
import UIKit

final class HostCapabilities: NSObject {
    private static let TAG = "proteus-cap"

    /// 宿主调用记账（`native.calls` 读它——判据证明"经壳执行"，与 Android 同构）
    private var callLog: [String] = []
    private let lock = NSLock()

    private var workerSeq = 0
    private var workers: [Int: WorkerSlot] = [:]

    private var idleSeq = 0
    private var idleQueue: [() -> Void] = []

    private struct WorkerSlot {
        let queue: DispatchQueue
        var terminated = false
    }

    // ────────────────────────── 主入口（契约同 Android.invoke） ──────────────────────────

    /// 执行原生方法并返回 JSON 串。**同步**（与 G-39 的 JNI trampoline 同契约：壳内同步完成）。
    func invoke(_ method: String, _ argsJson: String) -> String {
        lock.lock()
        callLog.append(method) // ★真实宿主记账（在分派**前**记录——未实现的方法也记账，与 Android 一致）
        lock.unlock()

        let args = Self.parseJsonObject(argsJson)
        switch method {
        case "host.context":
            return ok(hostContext())
        case "update.check":
            return ok(updateCheck())
        case "update.apply":
            return ok(["applied": false]) // ★不假装：无待应用更新
        case "window.setSize":
            return ok(windowSetSize(args))
        case "worker.create":
            return ok(workerCreate(args))
        case "worker.post":
            return workerPost(args)
        case "worker.terminate":
            return ok(workerTerminate(args))
        case "idle.request":
            return ok(idleRequest(args))
        case "idle.cancel":
            return ok(idleCancel())
        case "preload.assets":
            return ok(preloadAssets(args))
        case "extension.load":
            // ★诚实 unsupported：iOS 禁止动态模块加载（App Store 政策）——与 JS 桥的 extension.unsupported 对应
            return miss("extension.load: iOS 禁止动态模块加载（App Store 政策；dlopen 第三方代码会被拒审）")
        case "mini-program.navigate":
            return miss("mini-program.navigate: iOS 无小程序概念（跨 App 跳转请用 URL Scheme / Universal Links）")
        case "native.calls":
            // ★形态与 Android 一致：返回**裸 JSON 数组**（诊断通道，非 {ok,data} 包装）
            return Self.jsonString(callLog)
        default:
            return miss("未实现的原生方法：\(method)")
        }
    }

    // ────────────────────────── C48 宿主上下文 ──────────────────────────

    private func hostContext() -> [String: Any] {
        [
            "provider": "ios",
            "version": Self.appVersion(),
            "capabilities": ["update", "window", "worker", "idle", "preload"],
        ]
    }

    // ────────────────────────── C51 热更新 ──────────────────────────

    /// ★诚实边界：iOS **没有**应用内静默更新（App Store 政策禁止自更新）。
    ///   本方法做真实可做的部分：读当前 CFBundleShortVersionString + 声明"是否需要用户去商店更新"。
    private func updateCheck() -> [String: Any] {
        [
            "hasUpdate": false, // ★不谎报：无远端清单可比对 ⇒ 恒 false（接服务端版本比对后应替换本实现）
            "currentVersion": Self.appVersion(),
            "note": "iOS 无应用内静默更新（App Store 政策）；接服务端版本比对后应替换本实现",
        ]
    }

    // ────────────────────────── C74 窗口 ──────────────────────────

    /// C74 窗口尺寸。★诚实：**全屏 iPhone App 不可程序化改窗口尺寸**
    ///   （iPad 分屏由系统驱动）⇒ 如实 `applied:false` + 报告真实屏幕读数（不假装成功）。
    private func windowSetSize(_ args: [String: Any]) -> [String: Any] {
        let w = (args["width"] as? NSNumber)?.intValue ?? 0
        let h = (args["height"] as? NSNumber)?.intValue ?? 0
        let screen = UIScreen.main.bounds.size
        let scale = UIScreen.main.scale
        return [
            "requested": ["w": w, "h": h],
            "applied": false,
            "decorSize": [Int(screen.width * scale), Int(screen.height * scale)],
            "note": "iOS 全屏 App 不可程序化改窗口（iPad 分屏由系统驱动）——如实 applied=false",
        ]
    }

    // ────────────────────────── C53 Worker（真后台线程） ──────────────────────────

    private func workerCreate(_ args: [String: Any]) -> [String: Any] {
        workerSeq += 1
        let id = workerSeq
        let label = "proteus.worker.\(id)"
        workers[id] = WorkerSlot(queue: DispatchQueue(label: label, qos: .userInitiated))
        NSLog("[\(Self.TAG)] worker.create #\(id) script=\(args["scriptPath"] as? String ?? "")（真实后台队列）")
        return ["id": id, "thread": label]
    }

    /// ★★真实线程语义：消息投到后台队列执行（**不在主线程**）——这是与"假排队"的分界。
    ///   记录实际执行的线程名，供判据证明"确实跑在别的线程"（与 Android 的 ranOnThread 同构）。
    private func workerPost(_ args: [String: Any]) -> String {
        let id = (args["workerId"] as? NSNumber)?.intValue ?? 0
        guard let slot = workers[id] else { return fail("worker.post: 未知 worker #\(id)") }
        if slot.terminated { return fail("worker.post: worker #\(id) 已终止") }
        let msg = Self.stringify(args["msg"])
        let sem = DispatchSemaphore(value: 0)
        var ranOn = "(未执行)"
        var onMain = true
        slot.queue.async {
            ranOn = Thread.isMainThread ? "main（异常！）" : "gcd:proteus.worker.\(id)"
            onMain = Thread.isMainThread
            sem.signal()
        }
        // 等到任务真的跑过（最多 500ms；通常 <1ms）——与 Android 的 300ms 条件等待同构
        _ = sem.wait(timeout: .now() + 0.5)
        return ok([
            "posted": true,
            "ranOnThread": ranOn,
            "mainThread": onMain,
            "payload": msg,
        ])
    }

    private func workerTerminate(_ args: [String: Any]) -> [String: Any] {
        let id = (args["workerId"] as? NSNumber)?.intValue ?? 0
        let existed = workers.removeValue(forKey: id) != nil
        return ["terminated": existed]
    }

    // ────────────────────────── C73 空闲回调 ──────────────────────────

    /// ★真实空闲语义：**不在调用时刻执行**，排队到**主循环下一轮**（`DispatchQueue.main.async`
    ///   —— iOS 的"主线程空下来"时机；对应 Android 的 Choreographer 帧回调泵）——与 G-39
    ///   「帧调度权归宿主」一致。返回 id 供 cancel。
    private func idleRequest(_ args: [String: Any]) -> [String: Any] {
        idleSeq += 1
        let id = idleSeq
        idleQueue.append { NSLog("[\(Self.TAG)] idle task #\(id) 在主循环空闲时机执行") }
        let queued = idleQueue.count
        DispatchQueue.main.async { [weak self] in
            _ = self?.pumpIdle()
        }
        return ["id": id, "queued": queued]
    }

    private func idleCancel() -> [String: Any] {
        // 与 Android 同近似：按"清空队首"取消（如实记录剩余）
        if !idleQueue.isEmpty { idleQueue.removeFirst() }
        return ["remaining": idleQueue.count]
    }

    /// 主循环空闲泵（真实执行排队任务）——由 idleRequest 调度的 main.async 触发
    @discardableResult
    func pumpIdle() -> Int {
        var n = 0
        while !idleQueue.isEmpty {
            let task = idleQueue.removeFirst()
            task()
            n += 1
        }
        return n
    }

    // ────────────────────────── C67 预加载 ──────────────────────────

    /// C67 预加载（**真实动作**）：Bundle 资源真实解码（`UIImage(contentsOfFile:)`——
    ///   让系统解码表/页面预热）；与 Android 的 BitmapFactory 解码同构。
    private func preloadAssets(_ args: [String: Any]) -> [String: Any] {
        var warmed = 0
        if let list = args["data"] as? [Any] {
            for item in list {
                let path = Self.stringify(item).replacingOccurrences(of: "^/", with: "", options: .regularExpression)
                if path.isEmpty { continue }
                if let url = Bundle.main.url(forResource: path, withExtension: nil),
                   let img = UIImage(contentsOfFile: url.path) {
                    warmed += 1
                    _ = img.size // 触发解码路径（真实代价已付）
                    NSLog("[\(Self.TAG)] preload 预热 \(path)（\(Int(img.size.width))x\(Int(img.size.height))）")
                }
            }
        }
        return ["warmed": warmed, "total": warmed]
    }

    // ────────────────────────── 工具 ──────────────────────────

    private static func appVersion() -> String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "unknown"
    }

    private static func parseJsonObject(_ s: String?) -> [String: Any] {
        guard let s, !s.isEmpty, s != "null", let data = s.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        return obj
    }

    private static func stringify(_ v: Any?) -> String {
        guard let v else { return "null" }
        if let s = v as? String { return s }
        return String(describing: v)
    }

    private static func jsonString(_ obj: Any) -> String {
        if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
           let s = String(data: data, encoding: .utf8) {
            return s
        }
        return "{\"ok\":false,\"reason\":\"json 序列化失败\",\"missing\":false}"
    }

    private func ok(_ data: Any?) -> String {
        Self.jsonString(["ok": true, "data": data ?? NSNull()])
    }

    /// 诚实降级（桥映射为 `*.unsupported`）
    private func miss(_ reason: String) -> String {
        Self.jsonString(["ok": false, "reason": "unsupported: \(reason)", "missing": true])
    }

    /// 真失败（桥映射为 `*.failed`）
    private func fail(_ reason: String) -> String {
        Self.jsonString(["ok": false, "reason": reason, "missing": false])
    }
}
