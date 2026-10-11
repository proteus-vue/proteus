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
import QuartzCore

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
    /// ★★★"跳变驱动动画"宿主动画入口（与 Android `SuperappRuntimeHost.animStart` 同形）：
    ///   `v-animate` / `<Transition>` 触发 ⇒ 运行期把 `{anims:[{nodeId,kind,from,to,durMs,curve}]}`
    ///   交本方法 ⇒ 转发内核动画通道（`SelfDrawBridge.animStart`）+ **启动 CADisplayLink 帧循环**
    ///   （内核只求值，"每帧推一次"是宿主职责——`animStartFrameLoop`）。
    ///   ★条件可见性：JS 侧仅在**本方法存在**时把 `animStart` 挂给运行期（缺省 ⇒ 运行期如实记 note）。
    func animStart(_ animsJson: String) -> String
    /// ★★★**推进一帧**（动画桥的**必需配套**，与 Android 同形——两端口成对存在，缺一即静默不播）。
    ///   iOS 的帧循环由 `animStartFrameLoop`（CADisplayLink → `animTick`）自驱，本方法供 JS 显式单步/探针。
    func animTick(_ dtMsJson: String) -> String
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

    func mount(_ treeJson: String) -> String {
        let r = draw.mount(treeJson)
        // ★★★v-pump：挂载成功后**异步**抽该屏泵频率（起/停周期驱动）。
        //   【为什么异步】mount 由 JS→native 调用进来（运行期正处在 eval 栈上）；在栈内再 eval
        //   `__proteusHostAppPumpHz()` 是**嵌套 eval 重入**——排到下一 runloop 再读，零重入
        //   （此时 JS 侧 cur 已落定，读到的就是本屏泵表）。
        DispatchQueue.main.async { [weak self] in self?.pullPumps() }
        return r
    }
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

    /* ══════════ ★★★"跳变驱动动画"（与 Android SuperappRuntimeHost 同形）══════════
     * 【它做什么】`v-animate` / `<Transition>` 触发 ⇒ 运行期经 `animStart` 交内核动画通道；
     *   iOS 侧本就有完整动画能力（`SelfDrawBridge.animStart` + CADisplayLink 帧循环）——
     *   缺的只是**JSC 桥上的两个端口**（此前未暴露 ⇒ JS 侧探测为 undefined ⇒ 动画静默不播；
     *   与装置桥 `selfdraw-app.swift` 的 vapor shim 同款接线，见其注释）。
     * 【为什么 animTick 也要暴露】JS 侧按**两端口成对存在**判定"宿主支持动画"（与 Android JNI
     *   条件注入的判据对齐——缺一即不接线，本仓在装置桥踩过"只加 animStart 不注入"的坑）。 */
    private var animStartCalls = 0
    private var animStartedTotal = 0

    func animStart(_ animsJson: String) -> String {
        let r = draw.animStart(animsJson)
        // ★`animStart` 之后**必须启帧循环**（内核只做求值，"每帧推一次"是宿主职责）
        _ = draw.animStartFrameLoop()
        animStartCalls += 1
        if let d = r.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            animStartedTotal += (o["started"] as? NSNumber)?.intValue ?? 0
        }
        NSLog("[proteus] SUPERAPP_ANIM_START calls=%d %@", animStartCalls, String(r.prefix(200)))
        return r
    }

    func animTick(_ dtMsJson: String) -> String {
        // 入参两种形态都认（JSON 数字串或 `{"dtMs":16.7}`）——与鸿蒙 `VaporAnimTickCb` 同款
        var dt = 16.7
        let t = dtMsJson.trimmingCharacters(in: .whitespacesAndNewlines)
        if let v = Double(t) { dt = v }
        else if let d = t.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
                let v = (o["dtMs"] as? NSNumber)?.doubleValue { dt = v }
        return draw.animTick(dt)
    }

    /* ══════════ ★★★v-pump 周期驱动（通用原语，与 Android Choreographer 帧回调同职责）══════════
     * 【做什么】运行期挂载每屏后报**泵频率**（只有 hz，没有数据）；本类起一个 **CADisplayLink**
     *   帧循环，按"最小间隔"到期才 eval `__proteusHostAppPump({dtMs})`（**不是每帧一次**——省跨界）；
     *   JS 回 `{fired,pumps}`，`pumps==0` ⇒ 当前屏无泵 ⇒ 自停（等下次 mount 再起）。
     * 【为什么独立 CADisplayLink（不复用 view.onFrame）】`view.onFrame` 是**内核动画帧循环**的
     *   专用通道（`animStartFrameLoop` 写它）——泵驱动与其并列、互不覆盖（与 Android 上
     *   Choreographer 与动画驱动各管一条同语义）。
     * 【诚实边界】泵驱动走**数据通路**（applyOps 增量）；**手势路径仍零 JS**（不受影响）。 */
    private var pumpLink: CADisplayLink?
    private var pumpProxy: WeakPumpTarget?
    private var pumpIntervalMs = 0.0      // 最小泵间隔（ms）；0 = 无泵（循环不跑）
    private var pumpLastTs: CFTimeInterval = 0
    private var pumpCalls = 0
    private var pumpFireTicks = 0
    private var pumpLastFired = 0
    private var pumpLastPumps = 0
    private var pumpLastDtMs = 0.0

    /// ★宿主每次挂载后调（内部走 `pullPumps`）：读 JS 侧 `__proteusHostAppPumpHz()`（中性别名，
    ///   与鸿蒙 runtime 同契约；旧 bundle 无别名 ⇒ 回落 superapp 名）。
    func pullPumps() {
        guard let ctx = jsContext else { return }
        let hzJson = ctx.evaluateScript(
            "typeof __proteusHostAppPumpHz === 'function' ? __proteusHostAppPumpHz() : (typeof __proteusSuperappPumpHz === 'function' ? __proteusSuperappPumpHz() : '[]')"
        )?.toString() ?? "[]"
        setPumps(hzJson)
    }

    /// 传该屏泵的频率列表（`[]`/空 ⇒ 停泵循环）；取**最大 hz** ⇒ 最小间隔起帧循环。
    func setPumps(_ hzListJson: String) {
        var maxHz = 0.0
        if let d = hzListJson.data(using: .utf8), let arr = (try? JSONSerialization.jsonObject(with: d)) as? [Any] {
            for v in arr {
                if let n = v as? NSNumber, n.doubleValue > 0, n.doubleValue > maxHz { maxHz = n.doubleValue }
            }
        }
        pumpIntervalMs = maxHz > 0 ? 1000.0 / maxHz : 0
        if pumpIntervalMs > 0 {
            pumpLastTs = 0
            startPumpLoop()
        } else {
            stopPumpLoop()
        }
    }

    private func startPumpLoop() {
        guard pumpLink == nil else { return }
        // ★弱代理：CADisplayLink 强引用 target ⇒ 直接用 self 会形成 host↔link 循环（reload 后僵尸循环）
        let proxy = WeakPumpTarget(self)
        let link = CADisplayLink(target: proxy, selector: #selector(WeakPumpTarget.onFrame(_:)))
        link.add(to: .main, forMode: .common)   // .common：滚动/手势期间也继续（泵不能被拖拽掐停）
        pumpProxy = proxy
        pumpLink = link
    }

    private func stopPumpLoop() {
        pumpLink?.invalidate()
        pumpLink = nil
        pumpProxy = nil
    }

    deinit { stopPumpLoop() }

    fileprivate func onPumpFrame(_ link: CADisplayLink) {
        guard pumpIntervalMs > 0, let ctx = jsContext else { stopPumpLoop(); return }
        let now = link.timestamp
        let dtMs = pumpLastTs == 0 ? pumpIntervalMs : (now - pumpLastTs) * 1000.0
        if dtMs < pumpIntervalMs { return }   // 未到最小间隔 ⇒ 本帧不解 JS（省跨界；link 会再来）
        pumpLastTs = now
        pumpCalls += 1
        pumpLastDtMs = dtMs
        let tick = "{\"dtMs\":\(dtMs)}"
        let out = ctx.evaluateScript(
            "typeof __proteusHostAppPump === 'function' ? __proteusHostAppPump(\(jsQuote(tick))) : (typeof __proteusSuperappPump === 'function' ? __proteusSuperappPump(\(jsQuote(tick))) : '')"
        )?.toString() ?? ""
        if let d = out.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            let fired = (o["fired"] as? NSNumber)?.intValue ?? 0
            let pumps = (o["pumps"] as? NSNumber)?.intValue ?? 0
            if fired > 0 { pumpFireTicks += 1 }
            pumpLastFired = fired
            pumpLastPumps = pumps
            if pumpCalls <= 3 || pumpCalls % 30 == 0 {
                NSLog("[proteus] SUPERAPP_PUMP tick=%d fired=%d pumps=%d dtMs=%.1f", pumpCalls, fired, pumps, dtMs)
            }
            if pumps == 0 {
                NSLog("[proteus] SUPERAPP_PUMP_STOP ticks=%d fire_ticks=%d", pumpCalls, pumpFireTicks)
                stopPumpLoop()
            }
        }
    }

    /// ★判据读数（native 直读——scene/报告用；不经 JS）。
    func pumpStats() -> [String: Any] {
        ["running": pumpLink != nil, "interval_ms": pumpIntervalMs, "calls": pumpCalls,
         "fire_ticks": pumpFireTicks, "last_fired": pumpLastFired, "pumps": pumpLastPumps,
         "last_dt_ms": pumpLastDtMs, "anim_start_calls": animStartCalls, "anim_started_total": animStartedTotal]
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

/// ★泵帧回调的**弱代理**：`CADisplayLink` 会强引用 target——经它间接转调，避免 host↔link 循环。
private final class WeakPumpTarget: NSObject {
    weak var host: SuperappRuntimeHost?
    init(_ host: SuperappRuntimeHost) { self.host = host }
    @objc func onFrame(_ link: CADisplayLink) { host?.onPumpFrame(link) }
}
