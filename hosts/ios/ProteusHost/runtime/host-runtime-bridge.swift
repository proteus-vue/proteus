// hosts/ios/ProteusHost/runtime/host-runtime-bridge.swift
// ★★★hosts 第三刀（2026-10-07）：**宿主桥（proteusHost）**从 dev/host-runtime-scene.swift 迁入 runtime/。
//
// 【为什么迁】它是**项目无关的运行时聚合器**（把 HostCapabilities + ScreenHost 汇总成一个 `proteusHost`
//   对象，供 JS 侧 memUsage/gc/post/invoke）——却落在 dev/ 里，并被 shell（superapp-scene.swift）与 dev
//   两个场景共用 ⇒ 与鸿蒙 Stage 0 的 `screen.*` 簇同款"运行期形状落在装置层"。迁入 runtime/ 后，
//   runtime 单元自包含，任何宿主（含最小壳）都可直接依赖它。
//
// 【★解耦点】`gc()` 原先读 `HostRuntimeScene.ctxRef`（dev 类型）——现改为**自持** `jsContextRef`
//   （注入方在 setObject 前设置），使本文件不引用任何 shell/dev 类型。
import Foundation
import JavaScriptCore

/// 宿主桥（JS 侧 `proteusHost.memUsage()` / `.gc()` / `.post()` / `.invoke()`）——**条件注入**语义同 Android：
/// JS 侧按 `typeof proteusHost.memUsage === 'function'` 判定内存账本是否可用（缺则诚实标注）
@objc protocol HostRuntimeExports: JSExport {
    func memUsage() -> String
    func gc() -> Void
    func post(_ json: String) -> Void
    /// ★★App 原生能力通道（与 Android 的 `quickjs_jni.c` `js_host_invoke` 同一契约：
    ///   返回 JSON 串；`{"ok":false,"missing":true}` = 诚实降级，桥映射为 `*.unsupported`）
    func invoke(_ method: String, _ argsJson: String) -> String
}

final class HostRuntimeBridge: NSObject, HostRuntimeExports {
    /// ★App 端原生能力（真实 UIKit/Foundation 实现——见 host-capabilities.swift）
    let capabilities = HostCapabilities()
    /// ★★M5 执行器的宿主实现（screen.* 协议——真内核树 + CADisplayLink 帧循环；见 screen-host.swift）
    let screen = ScreenHost()
    /// JSC 全局上下文（供 `gc()` 主动回收；注入方 setObject 前设置——本桥自持，不引用 shell/dev）
    var jsContextRef: JSGlobalContextRef?

    /// ★内存读数（`scope="process"`——JSC 无 per-context API，见 HostRuntimeScene 文件头）
    func memUsage() -> String {
        let mb = physFootprintMB()
        let bytes = mb > 0 ? Int(mb * 1024 * 1024) : 0
        return "{\"ok\":true,\"scope\":\"process\",\"memory_used_size\":\(bytes),\"obj_count\":0}"
    }

    /// ★GC（JSC 公开 API `JSGarbageCollect`——宿主唯一能主动回收的手段）
    func gc() {
        if let ref = jsContextRef {
            JSGarbageCollect(ref)
        }
    }

    /// ★dev post 汇聚端口（决策 #693）：dev 变体注入 sink ⇒ 页面 `console.*`（经 JS 垫片 `proteusHost.post`）
    ///   转成宿主日志上报（面板 Console）。null（release）⇒ 只 NSLog（零额外开销）。
    var postSink: ((String) -> Void)?

    /// 场景不依赖 post（渲染链路在 js-render/selfdraw 场景）；保留以满足探测。
    ///   dev 变体经 `postSink` 把页面 console.* 汇聚给宿主 DevTools 上报（决策 #693）；release 只 NSLog。
    func post(_ json: String) {
        NSLog("[proteus] host-runtime post: %@", json.count > 200 ? String(json.prefix(200)) + "…" : json)
        postSink?(json)
    }

    /// JS 桥 → 原生能力（同步；见 host-capabilities.swift 的契约说明）
    /// ★`screen.*` 归 M5 执行器（真内核树操作 + 帧循环动画）；其余归能力层（与 Android 腿同一分发）
    func invoke(_ method: String, _ argsJson: String) -> String {
        if method.hasPrefix("screen.") {
            return screen.invoke(method, argsJson)
        }
        return capabilities.invoke(method, argsJson)
    }
}
