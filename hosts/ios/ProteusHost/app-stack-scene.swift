// hosts/ios/ProteusHost/app-stack-scene.swift
// ★★M5 执行器场景（iOS 腿）—— `--app-stack` 模式
//
// 【与 Android 腿的关系（同一份 TS、两个壳）】JS 侧是 `hosts/shared/bridge/entry-app-stack.ts`
//   （平台中立；2026-09-30 从 android 目录提到 shared，两壳共用）。本文件是壳：
//   装宿主桥（含 ScreenHost）→ 跑主场景（栈读数）→ 跑执行器两相 → **非阻塞轮询** →
//   写两份报告（`app-stack.json` + `app-stack-executor.json`，与 Android 同名同形）。
//
// 【★为什么必须非阻塞（与 Android 腿同一教训的第三次应用）】
//   执行器的动画完成由**宿主帧循环**（iOS: CADisplayLink）驱动，而帧循环与 JSC 都在主线程
//   ⇒ 场景里**不能**同步等待（`DispatchQueue.main.sync` 或 sleep 会把帧循环饿死 = 死锁）。
//   ⇒ 形态：kick 之后用 `DispatchQueue.main.asyncAfter` 链轮询（每轮让出主线程），
//     有界 10s，到时如实写 `{"pending":true,"timeout":true}`。
//
// 【完成回推链（与 Android 同构）】ScreenHost 的 CADisplayLink 回调里 tick 内核动画，
//   到点 → `ScreenHost.evalJs("__proteusHostScreenAnimDone(token)")` —— JSC 的 evaluateScript
//   返回时会排空微任务 ⇒ JS 侧 `await ePorts.anim.playRouteTransition(...)` 的续体接着跑
//   （下一段导航继续）。这条链是"宿主拥有帧循环"在 iOS 上的解。

import Foundation
import JavaScriptCore
import UIKit

/// M5 执行器场景（`--app-stack` 启动参数进入）
final class AppStackScene: NSObject {
    private static var evalJs: ((String) -> String)?
    private static var reportDir: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

    static func run(ctx: JSContext, bundleURL: URL) {
        evalJs = { expr in ctx.evaluateScript(expr)?.toString() ?? "null" }

        // ① 平台参数（TS 侧读它们自报标识——两壳同契约）
        _ = ctx.evaluateScript("var __PROTEUS_HOST_ID__ = 'ios';")
        _ = ctx.evaluateScript("var __PROTEUS_HOST_FRAME_DRIVER__ = 'CADisplayLink';")

        // ② 宿主桥（含 ScreenHost——屏幕树操作 + 帧循环动画）
        ScreenHost.evalJs = { expr in evalJs?(expr) ?? "null" }
        ctx.setObject(HostRuntimeBridge(), forKeyedSubscript: "proteusHost" as NSString)

        // ③ 加载 bundle（JSC 无模块系统——IIFE 整份 evaluate）
        guard let src = try? String(contentsOf: bundleURL, encoding: .utf8) else {
            NSLog("[proteus] 读 bundle-app-stack.js 失败：%@", bundleURL.path)
            writeJson("app-stack.json", fatal: "bundle 读失败")
            return
        }
        _ = ctx.evaluateScript(src, withSourceURL: bundleURL)

        // ④ 主场景（同步：栈读数 A–D）
        let mainOut = evalJs?("__proteusAppStackRun('{\"depth\":20000,\"fans\":32,\"budget\":1000}')") ?? "null"
        writeRaw("app-stack.json", mainOut)
        NSLog("[proteus] app-stack 主场景完成")

        // ⑤ 执行器两相：kick → **非阻塞轮询**（见文件头）→ 写第二份报告
        _ = evalJs?("__proteusAppStackExecutorKick()")
        pollExecutor(round: 0)
    }

    /// 非阻塞轮询（每轮让出主线程；有界 10s）
    private static func pollExecutor(round: Int) {
        let maxRounds = 625 // ≈10s（16ms/轮）
        guard let eval = evalJs else { return }
        let json = eval("__proteusAppStackExecutorRead()")
        var pending = true
        var merged: [String: Any]? = nil
        if let d = json.data(using: .utf8), let obj = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            // ★只认**显式的** pending:true（Android 腿实测缺陷：无该字段的结果也被当 pending ⇒ 永不收工）
            pending = (obj["pending"] as? Bool) == true
            if !pending {
                var m = obj
                m["e_pump_rounds"] = round
                if let sh = ScreenHost.current {
                    m["e_host_stats"] = sh.stats() // ★宿主记账（判据读它证明"动作真发生"）
                }
                merged = m
            }
        }
        if let m = merged {
            if let d = try? JSONSerialization.data(withJSONObject: m, options: [.prettyPrinted, .sortedKeys]) {
                try? d.write(to: reportDir.appendingPathComponent("app-stack-executor.json"))
            }
            NSLog("[proteus] APP_STACK_REPORT_READY（轮数 %d）", round)
            if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
            return
        }
        if round >= maxRounds {
            let timeout: [String: Any] = ["pending": true, "timeout": true, "rounds": round]
            if let d = try? JSONSerialization.data(withJSONObject: timeout, options: [.prettyPrinted, .sortedKeys]) {
                try? d.write(to: reportDir.appendingPathComponent("app-stack-executor.json"))
            }
            NSLog("[proteus] APP_STACK_REPORT_READY（超时——如实记 timeout）")
            if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.016) { pollExecutor(round: round + 1) }
    }

    // ── 报告 ──

    private static func writeRaw(_ name: String, _ raw: String) {
        try? raw.write(to: reportDir.appendingPathComponent(name), atomically: true, encoding: .utf8)
    }

    private static func writeJson(_ name: String, fatal: String) {
        writeRaw(name, "{\"ok\":false,\"fatal\":\"\(fatal)\"}")
    }
}
