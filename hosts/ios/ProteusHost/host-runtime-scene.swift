// hosts/ios/ProteusHost/host-runtime-scene.swift
// ★★G-39（iOS 腿）：宿主运行时真机场景——JavaScriptCore 单线程宿主壳
//
// 【与 Android 腿的关系（同一份 TS、两个壳——本仓纪律：同一语义一处实现）】
//   JS 侧是 `hosts/shared/bridge/entry-host-runtime.ts`（平台中立：读 `__PROTEUS_HOST_ID__`
//   与 `__PROTEUS_HOST_FRAME_DRIVER__` 自报标识）；本文件与 Android 的
//   `MainActivity.appHostRun()` + `quickjs_jni.c` 是**两个壳**：都做三件事——
//     ① 注入平台参数与宿主桥（内存/GC）；② 驱动两相（run → 让出主线程 → finish）；
//     ③ 转发真实系统生命周期事件进 JS 运行时。
//
// 【iOS 与 Android 的两处**平台差异**（都在报告里显式标注，不假装一致）】
//   · **内存口径 `scope="process"`**：JSC **无公开 per-context 内存 API**（本轮取证：
//     JavaScriptCore 公开头只暴露 `JSGarbageCollect`，无内存用量）⇒ 用 `phys_footprint`
//     （iOS 标准口径，本仓既有 `physFootprintMB()`）。对比 Android 的 `scope="engine"`
//     （QuickJS `JS_ComputeMemoryUsage`——引擎真实 JS 堆）。判据按 scope 分档。
//   · **微任务排空时机**：JSC 的 `evaluateScript` 返回时把微任务队列**一次排空**
//     （本仓已记录的实测事实）⇒ 两相之间要**让出主线程**（`DispatchQueue.main.async`），
//     这正是"事件循环由宿主驱动"在 JSC 上的形态。
//
// 【★生命周期转发的真实性（与 Android 的 onPause/onResume 对齐）】
//   监听 `UIApplication.willResignActiveNotification` / `didBecomeActiveNotification`
//   —— 真机由**启动另一个 App**（设置）与**重新激活本 App** 触发（`devicectl` 可脚本化，
//   本轮已实测：两次 launch 之后 PID 不变 ⇒ 是同进程的前后台往返，不是重启）。
//   ⇒ 证据力等同 Android 的 Activity 覆写：壳把系统生命周期**交给 runtime**，不是 JS 自己调。

import Foundation
import JavaScriptCore
import UIKit

/// 宿主桥（JS 侧 `proteusHost.memUsage()` / `.gc()` / `.post()`）——**条件注入**语义同 Android：
/// JS 侧按 `typeof proteusHost.memUsage === 'function'` 判定内存账本是否可用（缺则诚实标注）
@objc protocol HostRuntimeExports: JSExport {
    func memUsage() -> String
    func gc() -> Void
    func post(_ json: String) -> Void
}

final class HostRuntimeBridge: NSObject, HostRuntimeExports {
    /// ★内存读数（`scope="process"`——JSC 无 per-context API，见文件头）
    func memUsage() -> String {
        let mb = physFootprintMB()
        let bytes = mb > 0 ? Int(mb * 1024 * 1024) : 0
        return "{\"ok\":true,\"scope\":\"process\",\"memory_used_size\":\(bytes),\"obj_count\":0}"
    }

    /// ★GC（JSC 公开 API `JSGarbageCollect`——宿主唯一能主动回收的手段）
    func gc() {
        if let ref = HostRuntimeScene.ctxRef {
            JSGarbageCollect(ref)
        }
    }

    /// 场景不依赖 post（渲染链路在 js-render/selfdraw 场景）；保留以满足探测
    func post(_ json: String) {
        NSLog("[proteus] host-runtime post: %@", json.count > 200 ? String(json.prefix(200)) + "…" : json)
    }
}

/// G-39 宿主运行时场景（`--host-runtime` 启动参数进入）
final class HostRuntimeScene: NSObject {
    static var ctxRef: JSGlobalContextRef?
    private static var evalJs: ((String) -> String)?
    private static var mainPhase1: [String: Any] = [:]
    private static var mainPhase2: [String: Any] = [:]
    private static var runTs = 0
    private static var observersInstalled = false

    /// 场景主入口（由 `SelfDrawViewController.viewDidLoad` 调用）
    static func run(ctx: JSContext, bundleURL: URL) {
        ctxRef = ctx.jsGlobalContextRef
        runTs = Int(Date().timeIntervalSince1970)
        evalJs = { expr in ctx.evaluateScript(expr)?.toString() ?? "null" }

        // ① 平台参数（TS 侧读它们自报标识——与 Android 壳同契约）
        _ = ctx.evaluateScript("var __PROTEUS_HOST_ID__ = 'ios';")
        _ = ctx.evaluateScript("var __PROTEUS_HOST_FRAME_DRIVER__ = 'CADisplayLink';")

        // ② 宿主桥（条件注入的判定在 JS 侧：typeof memUsage === 'function'）
        ctx.setObject(HostRuntimeBridge(), forKeyedSubscript: "proteusHost" as NSString)

        // ③ 加载 bundle（JSC 无模块系统——IIFE 整份 evaluate）
        guard let src = try? String(contentsOf: bundleURL, encoding: .utf8) else {
            NSLog("[proteus] 读 bundle-host-runtime.js 失败：%@", bundleURL.path)
            writeMainReport(fatal: "bundle 读失败")
            return
        }
        _ = ctx.evaluateScript(src, withSourceURL: bundleURL)

        // ④ 两相驱动（JSC：evaluateScript 返回时排空微任务 ⇒ 相间让出主线程）
        let p1 = evalJson("__proteusHostRun()")
        mainPhase1 = p1
        DispatchQueue.main.async {
            // ★这一跳就是"宿主驱动事件循环"：JSC 在控制权回到宿主后把微任务队列排空，
            //   Promise 续体在此刻执行 ⇒ 下一相才读得到结果（缺这一跳 ⇒ 续体永不执行）。
            let p2 = evalJson("__proteusHostFinish()")
            mainPhase2 = p2
            writeMainReport()
            installLifecycleObservers()
            NSLog("[proteus] HOST_RUNTIME_PHASE_DONE async_resolved=%@",
                  String(describing: p2["async_resolved"] ?? "?"))
        }
    }

    // ── 生命周期（真实系统事件 → JS 运行时） ──

    private static func installLifecycleObservers() {
        guard !observersInstalled else { return }
        observersInstalled = true
        let nc = NotificationCenter.default
        nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in
            forward("pause")
        }
        nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            forward("resume")
        }
        NSLog("[proteus] G-39 生命周期观察者已装（willResignActive → pause / didBecomeActive → resume）")
    }

    private static func forward(_ evt: String) {
        guard let eval = evalJs else { return }
        let n = eval("typeof __proteusHostShellLifecycle === 'function' ? String(__proteusHostShellLifecycle('\(evt)')) : 'no-hook'")
        guard n != "no-hook" else { return }
        NSLog("[proteus] G-39 壳转发 \(evt) → JS 侧（次数 \(n)）")
        let q = eval("typeof __proteusHostShellQuery === 'function' ? __proteusHostShellQuery() : '{\"hook_loaded\":false}'")
        writeJsonFile("host-shell.json", raw: q)
        writeMainReport() // 主报告随 shell 计数更新
        // ★完成条件（与 Android 脚本同构）：**至少一次 pause 且一次 resume 都被应用**
        if let d = parseJson(q) {
            let sa = (d["suspend_applied"] as? NSNumber)?.intValue ?? 0
            let ra = (d["resume_applied"] as? NSNumber)?.intValue ?? 0
            if sa >= 1 && ra >= 1 {
                NSLog("[proteus] HOST_RUNTIME_REPORT_READY path=%@", reportURL("host-runtime.json").path)
                if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" {
                    exit(0)
                }
            }
        }
    }

    // ── 报告 ──

    private static func reportURL(_ name: String) -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent(name)
    }

    private static func evalJson(_ expr: String) -> [String: Any] {
        guard let eval = evalJs else { return [:] }
        return parseJson(eval(expr)) ?? [:]
    }

    private static func parseJson(_ s: String) -> [String: Any]? {
        guard let data = s.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private static func writeJsonFile(_ name: String, raw: String) {
        try? raw.write(to: reportURL(name), atomically: true, encoding: .utf8)
    }

    /// 主报告：phase1 ∪ phase2 ∪ 壳转发计数 ∪ 新鲜度（run_ts/build_id——脚本按此断言"本轮新报告"）
    private static func writeMainReport(fatal: String? = nil) {
        var out: [String: Any] = [
            "host_id": "ios",
            "platform": "ios",
            "run_ts": runTs,
            // ★build_id 来自 **bundle**（inject-build-id 编译期注入，经 __proteusHostRun 报告上带）
            //   ——与 entry-bench/entry-selfdraw 同一机制（不用运行时环境变量：那是第二种形态）
            "build_id": mainPhase1["build_id"] as? String ?? "unknown",
            "engine_available": true,
            "bundle_load_ok": fatal == nil,
            "run_ok": !mainPhase1.isEmpty,
            "finish_ok": !mainPhase2.isEmpty,
        ]
        if let f = fatal { out["error"] = f }
        for (k, v) in mainPhase1 { out[k] = v }
        for (k, v) in mainPhase2 { out[k] = v }
        // ok 语义与 Android 一致：phase1 ok && 续体已解析
        out["ok"] = (mainPhase1["ok"] as? Bool ?? false) && (mainPhase2["async_resolved"] as? Bool ?? false)
        if let d = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]) {
            try? d.write(to: reportURL("host-runtime.json"))
        }
    }
}
