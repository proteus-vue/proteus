// hosts/ios/ProteusHost/runtime/superapp-runtime-host.swift
// ★★★B1（宿主关注点分离）：**App 壳统一运行期**的宿主桥（`proteusHost`）——iOS 腿，项目无关。
//
// 【它做什么】作为 JSC 宿主对象（`ctx.setObject(host, "proteusHost")`），把 JS 侧运行期
//   （`@proteus-vue/render-backend` 的 `createSuperappRuntime`）需要的**四个平台原语**
//   暴露给 JS：`mount` / `applyOps` / `readRects` / `onGesture`（+ 能力 `invoke`/`memUsage`/`gc`）。
//   ⇒ 交互/响应式/导航**全在共享 JS 层**；iOS 宿主只提供原语（与 Android `SuperappRuntimeHost` 同形）。
//
// 【与 HostRuntimeBridge 的关系】`HostRuntimeBridge` 只服务"屏内容通路"（`screen.*` 走 `ScreenHost`）。
//   统一运行期不用 `screen.*`——直接 mount（运行期实例化的节点）→ 手势（SelfDrawBridge 命中）→ JS 派发 →
//   applyOps（二进制指令）。本类把这些转给 `SelfDrawBridge`（渲染）+ `HostRuntimeBridge`（能力）。
//
// 【为什么单列（分层）】「运行期宿主桥」是**引擎/运行期的一部分**，归 runtime；不绑项目身份。
import Foundation
import JavaScriptCore

/// 宿主运行时原语（JS 侧 `proteusHost.*`）
@objc protocol SuperappRuntimeExports: JSExport {
    /// 建树 + 上屏（运行期实例化后的 `{viewport,nodes}`）
    func mount(_ treeJson: String) -> String
    /// 应用二进制指令流（`number[]` JSON）——增量
    func applyOps(_ opsBytesJson: String) -> String
    /// 读内核几何（诊断）
    func readRects() -> String
    /// 注册手势反向回调名（native 层**截获**：`SelfDrawView.emitGesture` 命中后调该 JS 全局函数）
    func onGesture(_ cbName: String)
    /// ★每屏滚动进度记忆（用户：「返回应保留滚动，前进才重置」——系统 App 语义；contentOffset 是视图状态）
    func getScroll() -> Double
    func setScroll(_ offset: Double)
    /// 能力通道（与 HostRuntimeBridge 同契约）
    func invoke(_ method: String, _ argsJson: String) -> String
    func memUsage() -> String
    func gc() -> Void
    func post(_ json: String) -> Void
}

final class SuperappRuntimeHost: NSObject, SuperappRuntimeExports {
    private let draw: SelfDrawBridge
    private let caps: HostRuntimeBridge
    /// 手势反向回调名（JS 侧注册）
    private var gestureCb: String?
    /// JSC 上下文（注册手势回调名后，宿主用它反向调 JS）
    var jsContext: JSContext?

    init(draw: SelfDrawBridge, caps: HostRuntimeBridge) {
        self.draw = draw
        self.caps = caps
    }

    /* ── 运行期四原语 ── */

    func mount(_ treeJson: String) -> String { draw.mount(treeJson) }
    func applyOps(_ opsBytesJson: String) -> String { draw.applyOps(opsBytesJson) }
    func readRects() -> String { draw.readRects() }
    func onGesture(_ cbName: String) { gestureCb = cbName }
    /// ★每屏滚动进度记忆（用户：「返回应保留滚动，前进才重置」——系统 App 语义）。
    func getScroll() -> Double { Double(draw.view?.contentOffset.y ?? 0) }
    func setScroll(_ offset: Double) {
        guard let v = draw.view else { return }
        // 经 applyContentOffset 的相对位移把 contentOffset.y 设到目标（该方法是 iOS 侧唯一写入口）
        v.applyContentOffset(dx: 0, dy: CGFloat(offset) - v.contentOffset.y)
    }

    /* ── 能力 / 引擎（转 HostRuntimeBridge）── */
    func invoke(_ method: String, _ argsJson: String) -> String { caps.invoke(method, argsJson) }
    func memUsage() -> String { caps.memUsage() }
    func gc() { caps.gc() }
    func post(_ json: String) { caps.post(json) }

    /// ★由 SelfDrawView.emitGesture（实现侧）调：命中节点 + 冒泡链 → 反向调 JS 注册的回调。
    ///   在**主线程**的 UI 回调里调 JSC（非 eval 重入场景）——与 Android 的 native 反向通道同语义。
    ///   ★返回 JS 派发结果 JSON（含 `firedHandlers`/`src`——决策 #712 页面处理器 source map，供壳上报 /trace）。
    @discardableResult
    func dispatchGestureToJS(type: String, target: Int, chain: [Int]) -> String? {
        guard let cb = gestureCb, let ctx = jsContext else { return nil }
        let chainJson = "[" + chain.map(String.init).joined(separator: ",") + "]"
        let expr = "\(cb)(\(jsQuote(type)),\(target),\(jsQuote(chainJson)))"
        return ctx.evaluateScript(expr)?.toString()
    }
}

/// JS 字符串转义（双引号包裹；仅需处理引号与反斜杠）
private func jsQuote(_ s: String) -> String {
    let esc = s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
    return "\"\(esc)\""
}
