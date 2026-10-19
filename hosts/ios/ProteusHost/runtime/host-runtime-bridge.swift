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
    /// ★★★S2「去 JSON」（决策 #903 / #1064）：能力通道的**二进制腿**——与 shell 的 SuperappRuntimeHost 同一形态。
    ///   ★为什么 host-runtime 场景也要装：本场景是**真机 useFetch 判据**的落点；不装 ⇒ JS 侧探测不到
    ///     `invokeBytes` ⇒ 静默回落 JSON 腿（真机实测抓出：`invokeWire === "json"`）。
    ///   「桥在代码里」≠「场景真的装了」——这正是 iOS 腿此前漏接的那一类。
    private let bytesBridge = InvokeBytesBridge()

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

    /// ★能力通道字节腿的**通用分发**（2026-10-19 全能力通道去 JSON）：帧 body = JSON 字节 ⇒
    ///   复用 {@link invoke} 的完整分流（`screen.*` + 能力族）⇒ 回 `PRSP` 帧。
    /// 【为什么不直接调 `capabilities.invokeGenericBytes`】那会绕过 `screen.*` 的 M5 执行器分流；
    ///   本方法让字节腿与 JSON 腿**走同一入口**，端能力语义只有一份。
    func invokeGenericBytes(_ f: InvokeWire.InvokeFrame) -> [UInt8] {
        let argsJson = f.body.isEmpty ? "{}" : (String(bytes: f.body, encoding: .utf8) ?? "{}")
        let out = invoke(f.method, argsJson)
        var rf = InvokeWire.ResolveFrame.makeOK(f.reqId)
        rf.body = Array(out.utf8)
        return (try? InvokeWire.encodeResolve(rf)) ?? []
    }

    // ────────────────────────── ★S2「去 JSON」：能力二进制腿 ──────────────────────────

    /// 注入 `__proteusHostInvokeBytes`（JSC C API；JSExport 传不了 `Uint8Array`）。
    /// ★装配位置 = 场景在 `ctx.setObject(hostBridge, "proteusHost")` **之后**调本方法；
    ///   JS 侧是**调用时**探测 ⇒ 顺序无关，但与 setObject 相邻更易审。
    @discardableResult
    func installInvokeBytes(on ctx: JSContext) -> Bool {
        bytesBridge.handler = { [weak self] frame in self?.dispatchInvokeBytes(frame) }
        let ok = bytesBridge.install(on: ctx)
        if ok {
            NSLog("[proteus] host-runtime 已注入 invokeBytes ⇒ App 能力走**二进制帧**（S2 去 JSON · #903/#1064）")
        } else {
            NSLog("[proteus] ✗ host-runtime 二进制腿安装失败：%@", (bytesBridge.stats()["last_error"] as? String) ?? "?")
        }
        return ok
    }

    /// 分发去程帧（与 SuperappRuntimeHost.dispatchInvokeBytes / Android HostCapabilities.invokeBytes 同一分发）。
    /// 返回 `nil` = 已受理、结果稍后 `pushResolve` 回推；返回帧 = 当场结算。
    /// ★2026-10-19 扩面：`http.request` 之外的能力也走字节腿（通用分发 → `capabilities.invokeGenericBytes`）。
    private func dispatchInvokeBytes(_ frame: [UInt8]) -> [UInt8]? {
        do {
            let f = try InvokeWire.decodeInvoke(frame)
            if f.method == "http.request" {
                return try HttpCapability.handle(f) { [weak self] reply in
                    if self?.bytesBridge.pushResolve(reply) == false {
                        NSLog("[proteus] ✗ 二进制回推被丢弃（JS 侧未安装 __proteusHostResolveBytes）")
                    }
                }
            }
            return invokeGenericBytes(f)
        } catch {
            return try? InvokeWire.encodeResolve(.makeErr("", "二进制帧处理失败：\(error)"))
        }
    }

    /// 字节腿读数（判据用；不经 JS ⇒ 证明桥真的被走过）
    func invokeBytesStats() -> [String: Any] { bytesBridge.stats() }
}
