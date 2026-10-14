// hosts/ios/ProteusHost/runtime/invoke-bytes-bridge.swift
// ★★★宿主**二进制桥**（S2 去 JSON · 决策 #903）—— iOS 腿
//
// 【它做什么】把 iOS JSC 宿主与 JS 侧 `packages/api/src/capability-invoke.ts` 的二进制通道接起来：
//   · 去程：在 JSContext 全局注入 `__proteusHostInvokeBytes(PINV 帧: Uint8Array) -> PRSP 帧: Uint8Array`
//     （JS 侧 `getHostInvokeBytes()` 探测它 ⇒ 走字节腿；未注入 ⇒ 回退 JSON 腿）；
//   · 回程：`pushResolve(PRSP 帧)` ⇒ 调 JS 全局 `__proteusHostResolveBytes(Uint8Array)`
//     （由 JS 侧 `installHostResolveBridge()` 安装；未安装 ⇒ 返回 false，**不静默**）。
//
// 【★为什么走 **JSC C API** 而不是 `JSExport`（本仓实测的坑）】`selfdraw-scene.swift` 已登记
//   「JSExport 对 ArrayBuffer 支持不稳」；且 JSExport 只能传 Objective-C 对象（NSData/NSArray 会
//   变成 JS 对象/数组，**不是** Uint8Array）⇒ 每帧都要在 JS 侧 `Array.from` 一遍，正是本单要消灭的
//   那层开销。JSC 公开 C API 有 `JSObjectGetTypedArrayBytesPtr` / `JSObjectMakeTypedArray`
//   （macOS 10.12 / iOS 10+，本仓 target = iOS 15）⇒ 直接拿**裸指针**读、直接造 Uint8Array 回——
//   与 Android 侧 `JS_GetTypedArrayBuffer` + `JS_NewUint8ArrayCopy` 同形态。
//
// 【★单一宿主实例（与 Android `quickjs_jni.c` 的 `g_host_obj` 同形态）】C 函数指针**不能捕获上下文**
//   ⇒ 回调只能经一个模块级引用找到宿主。进程内只有一个 App 壳 ⇒ `current` 后装者覆盖先装者
//   （若将来一个进程要跑两个壳，这里必须改成句柄表——本行即该边界的登记处）。
//
// 【★诚实边界】
//   ① 回调里**立即拷贝**入参字节：JSC 文档明写 `JSObjectGetTypedArrayBytesPtr` 返回的指针
//      「temporary and not guaranteed to remain valid across JavaScriptCore API calls」⇒ 不许留存裸指针。
//   ② 本桥只做**帧的搬运与分发**；`http.request` 的真实语义在 `http-capability.swift`。
//   ③ 未接字节腿的场景（dev/bench 场景）仍走 JSON 腿——**不谎称全场景已去 JSON**。

import Foundation
import JavaScriptCore

/// 宿主二进制腿（注入 `__proteusHostInvokeBytes` + 回推 `__proteusHostResolveBytes`）
final class InvokeBytesBridge {

    /// 帧分发：去程帧**原始字节** → 回程帧；返回 `nil` = **已受理、结果稍后 `pushResolve` 回推**
    ///   （与 JS 侧 `invokeHostAsyncBytes` 的两条分支对齐：返回帧 = 同步结算；返回空 = 保持挂起）。
    ///   ★传**原始字节**而不是解码后的结构：解码归分发方（与 Android `HostCapabilities.invokeBytes(byte[])`
    ///   同形——桥只搬字节，不解释帧）。
    var handler: (([UInt8]) -> [UInt8]?)?

    /// ★C 回调的**唯一入口**（见文件头「单一宿主实例」）
    private static weak var current: InvokeBytesBridge?

    private weak var ctx: JSContext?
    /// 诊断计数（判据证明"字节腿真的被走过"，而不是只在代码里存在）
    private(set) var invokeCalls = 0
    private(set) var resolvePushes = 0
    private(set) var lastError: String?

    /* ────────────────────────── 安装 / 回推 ────────────────────────── */

    /// 注入 `__proteusHostInvokeBytes`（**幂等**：重复安装覆盖同名全局，语义一致）。
    @discardableResult
    func install(on context: JSContext) -> Bool {
        ctx = context
        InvokeBytesBridge.current = self
        guard let ctxRef = context.jsGlobalContextRef else {
            lastError = "JSContext 无 jsGlobalContextRef（注入失败）"
            return false
        }
        let name = JSStringCreateWithUTF8CString("__proteusHostInvokeBytes")
        defer { JSStringRelease(name) }
        guard let fn = JSObjectMakeFunctionWithCallback(ctxRef, name, InvokeBytesBridge.invokeBytesTrampoline) else {
            lastError = "JSObjectMakeFunctionWithCallback 失败"
            return false
        }
        JSObjectSetProperty(ctxRef, JSContextGetGlobalObject(ctxRef), name, fn, 0, nil)
        return true
    }

    /// 回推一帧（宿主异步完成 → JS）。
    /// 返回 `false` = JS 侧**未安装** `__proteusHostResolveBytes`（老 bundle / 未调
    /// `installHostResolveBridge`）⇒ 调用方应如实记录（**不静默丢弃**）。
    @discardableResult
    func pushResolve(_ bytes: [UInt8]) -> Bool {
        guard let ctx, let ctxRef = ctx.jsGlobalContextRef else { return false }
        let g = ctx.objectForKeyedSubscript("__proteusHostResolveBytes")
        guard let fn = g, !fn.isUndefined, !fn.isNull else {
            lastError = "JS 侧未安装 __proteusHostResolveBytes（回推被丢弃）"
            return false
        }
        guard let arr = Self.makeUint8Array(ctxRef, bytes) else {
            lastError = "构造 Uint8Array 失败（回推被丢弃）"
            return false
        }
        _ = fn.call(withArguments: [JSValue(jsValueRef: arr, in: ctx) as Any])
        resolvePushes += 1
        return true
    }

    /// 判据读数（native 直读——报告/诊断用；不经 JS）
    func stats() -> [String: Any] {
        ["installed": ctx != nil, "invoke_calls": invokeCalls, "resolve_pushes": resolvePushes,
         "last_error": lastError ?? ""]
    }

    /* ────────────────────────── C 回调（无捕获） ────────────────────────── */

    /// 去程回调：`(Uint8Array) -> Uint8Array | undefined`
    /// ★声明为 `static let`（而不是实例存储属性）：类存储属性的初始化器**不许引用协变 `Self`**
    ///   （编译器实测：`covariant 'Self' type cannot be referenced from a stored property initializer`）；
    ///   静态 let 是惰性全局常量，且本闭包**零捕获**（只引用静态成员）⇒ 可作 C 函数指针。
    static let invokeBytesTrampoline: JSObjectCallAsFunctionCallback = { ctxRef, _, _, argc, argv, exception in
        guard let ctxRef else { return nil }
        guard let bridge = InvokeBytesBridge.current else {
            return InvokeBytesBridge.raise(ctxRef, exception, "宿主二进制桥未安装（__proteusHostInvokeBytes 不应存在）")
        }
        guard argc >= 1, let argv, let arg0 = argv[0] else {
            return InvokeBytesBridge.raise(ctxRef, exception, "invokeBytes 需要 1 个 Uint8Array 参数")
        }
        // ★入参必须是 TypedArray（不是 Array/ArrayBuffer）——判据与 Android 侧同口径：
        //   不是 Uint8Array 就**抛 JS 异常**（静默返回 undefined 会让 JS 侧误以为"已受理等回推"）
        guard let raw = JSObjectGetTypedArrayBytesPtr(ctxRef, arg0, nil) else {
            return InvokeBytesBridge.raise(ctxRef, exception, "invokeBytes 入参不是 TypedArray（期望 Uint8Array 的 PINV 帧）")
        }
        let byteLength = JSObjectGetTypedArrayByteLength(ctxRef, arg0, nil)
        guard byteLength > 0 else {
            return InvokeBytesBridge.raise(ctxRef, exception, "invokeBytes 收到空帧（PINV 帧至少 20 字节 header）")
        }
        // ★立即拷贝（JSC 文档：该指针是临时的、不保证跨 API 调用有效）
        let frame = Array(UnsafeBufferPointer(start: raw.assumingMemoryBound(to: UInt8.self), count: byteLength))

        bridge.invokeCalls += 1
        guard let handler = bridge.handler else {
            bridge.lastError = "未接 handler（桥已装但没挂分发）"
            return JSValueMakeUndefined(ctxRef)   // = 已受理但无回执（JS 侧保持挂起，不会误结算）
        }
        guard let reply = handler(frame) else {
            return JSValueMakeUndefined(ctxRef)   // 与 Android 的"空返回 = 已受理等回推"同语义
        }
        return InvokeBytesBridge.makeUint8Array(ctxRef, reply)
    }

    /* ────────────────────────── C 侧工具 ────────────────────────── */

    /// 造一个 Uint8Array 并**拷入**字节（与 Android `JS_NewUint8ArrayCopy` 同义）。
    /// ★用 `JSObjectMakeTypedArray` + 写回（而非 NoCopy）——避免 JSC 持有 Swift 数组生命周期
    ///   （NoCopy 需要 deallocator 回调，跨语言所有权更易错，而本通道的收益在**大 body**，
    ///   一次 memcpy 相对 JSON 的 3~4× 膨胀与两次编解码可忽略）。
    static func makeUint8Array(_ ctxRef: JSContextRef, _ bytes: [UInt8]) -> JSValueRef? {
        // ★0 长度也走同一条路（`JSObjectMakeTypedArray` 支持 0 长度）——空载荷 = 0 长度 Uint8Array，
        //   JS 侧按长度判"已受理"（与 Android 侧同语义）
        guard let obj = JSObjectMakeTypedArray(ctxRef, kJSTypedArrayTypeUint8Array, bytes.count, nil) else { return nil }
        if !bytes.isEmpty, let dst = JSObjectGetTypedArrayBytesPtr(ctxRef, obj, nil) {
            bytes.withUnsafeBytes { src in
                if let base = src.baseAddress { dst.copyMemory(from: base, byteCount: bytes.count) }
            }
        }
        return obj
    }

    /// 抛一个 JS 异常（字符串消息）并返回 `nil`——回调里**不许吞掉**错误（吞掉 = JS 侧误判）。
    static func raise(_ ctxRef: JSContextRef, _ exception: UnsafeMutablePointer<JSValueRef?>?, _ message: String) -> JSValueRef? {
        guard let exception else { return JSValueMakeUndefined(ctxRef) }
        let jsStr = JSStringCreateWithUTF8CString(message)
        exception.pointee = JSValueMakeString(ctxRef, jsStr)
        JSStringRelease(jsStr)
        return nil
    }
}
