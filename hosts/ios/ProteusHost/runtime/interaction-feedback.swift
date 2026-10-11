// hosts/ios/ProteusHost/runtime/interaction-feedback.swift
// ★★★**交互视觉反馈**（iOS 腿 · runtime 单元）：完整按下态 + 场跟手 + `:active` 触发动画。
//
// 【它是什么（与 Android 同一条设计范式）】编译器把 `:active` / `v-follow={field}` / `::before|::after`
//   折成节点的**扁平字段**（`press*` / `followField*` / `pseudo`）；本类在**宿主原生即时消费**——
//   内核零新增能力（只复用 `hit_test` / `follow_field_bin` / `anim_start|stop|tick`）。
//   ⇒ 按下反馈**不经过 JS**、跟手每帧**一次 FFI**（12B/条）、涟漪走既有内核动画通道。
//
// 【为什么在 runtime（决策 #796 能力归属）】三条能力都是"平台无关的宿主动力"⇒ 归 runtime：
//   任何 iOS 壳（参考宿主 / CLI 生成宿主）装配一次即得，不在壳里各写一份。
//
// 【与 Android `ProteusHostView` 的对应】逐项同语义：
//   · 按下态：DOWN(命中) → 改底色/描边/缩放/发光/z（**同帧**）→ UP 还原；
//   · 级联：`pressTransform.sx/sy` 缩**自身 + 全部后代** ⇒ iOS 用 CALayer 的层级 transform 天然级联（比 canvas 少一步）；
//   · 场跟手：焦点只记不推（MOVE 零 FFI）；**每帧一次** `follow_field_bin` → 写层 scale/rotate；
//   · 抬指回基态（叶回声明值）；换树连带清场态（叶 id 每树重分配）；
//   · 伪元素：伪子由编译器物化为普通节点（`pseudo` 字段）⇒ 渲染无需特殊处理，**只需**按下传播 + 动画挂接。
//
// 【诚实边界】① 按下态与内核动画写**同一层的 transform**——两者同时作用时以后写者为准（Android 走
//   统一 `animTx` 表避免竞争；iOS 直写层 ⇒ 极窄窗口内可能互相覆盖，如实记录不掩盖）；
//   ② `pressOpacity` 编译器已折但宿主暂未消费（与 Android 同口径）。
import Foundation
import QuartzCore
import UIKit

/// 场跟手内核入口（12B/条：id u32 + scale f32 + rotate f32；用 `proteus_rects_free` 释放）
@_silgen_name("proteus_layout_follow_field_bin")
func proteus_layout_follow_field_bin(
    _ handle: UInt64, _ containerId: UInt32, _ focusX: Float, _ focusY: Float,
    _ falloff: Float, _ minScale: Float, _ maxScale: Float, _ maxRotate: Float,
    _ outLen: UnsafeMutablePointer<UInt32>
) -> UnsafeMutablePointer<UInt8>?

@_silgen_name("proteus_layout_set_scale_gain")
func proteus_layout_set_scale_gain(_ handle: UInt64, _ nodeId: UInt32, _ gain: Float) -> UnsafeMutablePointer<CChar>

final class InteractionFeedback {
    /* ── 表（每次 mount/重挂后由 `install` 重建）── */
    struct PressStyle {
        var bg: UIColor?
        var borderColor: UIColor?
        var scaleX: CGFloat
        var scaleY: CGFloat
        var glowColor: UIColor?
        var glowRadius: CGFloat
        var zIndex: CGFloat
    }
    private var pressStyles: [Int: PressStyle] = [:]
    private var pressAnims: [Int: [[String: Any]]] = [:]      // 节点 → 通道数组（`:active{animation}`）
    private var pseudoChildren: [Int: [Int]] = [:]            // 父元素 → 伪子 id（按下传播用）
    private var fieldSpecs: [Int: (falloff: Float, minScale: Float, maxScale: Float, rotate: Float)] = [:]

    /* ── 按下态状态 ── */
    private(set) var pressedNodeId = -1
    private var pressBackup: [Int: (bg: UIColor?, borderColor: UIColor?, z: CGFloat, hadGlow: Bool)] = [:]
    private var pressedAnimTargets: [Int] = []
    private var pressAnimInfinite = false
    private var pressDownNs: UInt64 = 0
    private var lastPressGain: Float = 1

    /* ── 场跟手状态 ── */
    private var fieldFocus: [Int: CGPoint] = [:]              // containerId → 焦点（内容坐标）
    private var fieldPtrContainer: [Int: Int] = [:]           // pointerId → containerId
    private var fieldTouched: Set<Int> = []                   // 被场改写的叶 id（抬指要复位）
    private var fieldDirty = false

    /* ── 记数（机器判据：证明"通路真的走过"——本仓纪律）── */
    private(set) var pressApplyCount = 0
    private(set) var fieldTicks = 0
    private(set) var fieldNodesTouched = 0
    private(set) var pressAnimStarts = 0
    private(set) var pressAnimStops = 0
    private(set) var lastFieldIds: [Int] = []

    /** 弱引用的视图（写层的唯一出口在本类内部完成，经 view 的 internal 接口）。 */
    private weak var view: SelfDrawView?

    func attach(view: SelfDrawView) { self.view = view }

    // ══════════════ ① 收集（mount 后调一次）══════════════

    /// 从实例化节点数组收集三类表（与 Android `collectPressStyles/collectFollowFields/collectPseudoChildren` 同语义）。
    func install(nodes: [[String: Any]], view: SelfDrawView) {
        self.view = view
        pressStyles.removeAll(keepingCapacity: true)
        pressAnims.removeAll(keepingCapacity: true)
        pseudoChildren.removeAll(keepingCapacity: true)
        fieldSpecs.removeAll(keepingCapacity: true)
        // ★换树连带清运行时态（叶 id 每树重分配——旧 id 会指向新树别的节点；与 Android resetFieldRuntime 同因）
        clearPress()
        fieldFocus.removeAll(keepingCapacity: true)
        fieldPtrContainer.removeAll(keepingCapacity: true)
        fieldTouched.removeAll(keepingCapacity: true)

        for n in nodes {
            guard let id = n["id"] as? Int else { continue }
            // ① 按下态：五个字段任一存在即收集（与编译器折出的键一一对应）
            var ps = PressStyle(bg: nil, borderColor: nil, scaleX: 1, scaleY: 1, glowColor: nil, glowRadius: 0, zIndex: 0)
            var has = false
            if let s = n["pressBackgroundColor"] as? String, let c = parseHexColor(s) { ps.bg = c; has = true }
            if let s = n["pressBorderColor"] as? String, let c = parseHexColor(s) { ps.borderColor = c; has = true }
            if let t = n["pressTransform"] as? [String: Any] {
                // ★与静态 transform 同构（txPx/tyPx/txPct/tyPct/sx/sy/rotate）；按下态只用 sx/sy（凹陷）
                ps.scaleX = CGFloat((t["sx"] as? Double) ?? 1)
                ps.scaleY = CGFloat((t["sy"] as? Double) ?? 1)
                if ps.scaleX != 1 || ps.scaleY != 1 { has = true }
            }
            if let sh = n["pressBoxShadow"] as? [String: Any] {
                if let s = sh["color"] as? String, let c = parseHexColor(s) { ps.glowColor = c }
                ps.glowRadius = CGFloat((sh["blur"] as? Double) ?? 0)
                if ps.glowColor != nil && ps.glowRadius > 0 { has = true }
            }
            if let z = n["pressZIndex"] as? Double, z > 0 { ps.zIndex = CGFloat(z); has = true }
            if has { pressStyles[id] = ps }
            // ② `:active{animation}` 通道（涟漪等）
            if let ch = n["pressAnimation"] as? [[String: Any]], !ch.isEmpty { pressAnims[id] = ch }
            // ③ 伪子归组（伪元素物化为普通节点，parentId 指原元素）
            if let pe = n["pseudo"] as? String, !pe.isEmpty, let pid = n["parentId"] as? Int {
                pseudoChildren[pid, default: []].append(id)
            }
            // ④ 场容器（v-follow={field:…}）
            if n["followField"] != nil {
                fieldSpecs[id] = (falloff: Float((n["followFieldFalloff"] as? Double) ?? 300),
                                  minScale: Float((n["followFieldMinScale"] as? Double) ?? 0.3),
                                  maxScale: Float((n["followFieldMaxScale"] as? Double) ?? 1.0),
                                  rotate: Float((n["followFieldRotate"] as? Double) ?? 30))
            }
        }
    }

    // ══════════════ ② 触摸（由 SelfDrawView 的钩子调）══════════════

    /// ★该节点是否有按下态（供壳沿冒泡链找"第一个带按下态的祖先"——命中常落在伪子/内层）。
    func hasPressStyle(nodeId: Int) -> Bool { pressStyles[nodeId] != nil }

    /// ★按下态表的键（判据"自动定位可按下节点"用——不猜坐标）。
    func pressStyleIds() -> [Int] { pressStyles.keys.sorted() }

    /// ★场容器表的键（判据"自动定位"用）。
    func fieldSpecIds() -> [Int] { fieldSpecs.keys.sorted() }

    /// DOWN：命中节点（内核 hitTest 已给 target+chain）⇒ 同帧按下态 + 焦点记录。
    func down(x: Double, y: Double, target: Int, chain: [Int], handle: UInt64) {
        pressDownNs = DispatchTime.now().uptimeNanoseconds
        lastPressGain = 1
        // ① 按下态：命中 target 自身
        if target >= 0 { applyPressAt(nodeId: target, handle: handle) }
        // ② 场焦点：冒泡链里**第一个**场容器（与 Android fieldContainerInChain 同语义）
        for id in chain {
            if fieldSpecs[id] != nil {
                fieldPtrContainer[0] = id
                fieldFocus[id] = CGPoint(x: x, y: y)   // ★传入即**内容坐标**（见 down 调用方的换算）
                fieldDirty = true
                break
            }
        }
    }

    /// MOVE：只更新焦点 + 标脏（**零 FFI**——推帧在 `tick` 里一次完成；与 Android applyFieldFocus 同）。
    func move(x: Double, y: Double) {
        guard let cid = fieldPtrContainer[0] else { return }
        fieldFocus[cid] = CGPoint(x: x, y: y)
        fieldDirty = true
    }

    /// UP / CANCEL：还原按下态 + 停按下动画 + 场叶回基态。
    func up(handle: UInt64) {
        stopPressAnims(handle: handle)
        clearPress()
        // 场：全部指针解绑（iOS 单指为主；多指场景见 Android 的 endFieldPointer 语义）
        fieldPtrContainer.removeAll(keepingCapacity: true)
        fieldFocus.removeAll(keepingCapacity: true)
        resetFieldLeaves()
        fieldDirty = false
    }

    // ══════════════ ③ 每帧（由 SelfDrawView 的 field 帧循环调）══════════════

    /// 每帧一次：按压力增益 + 场跟手 FFI（12B/条解码 → 写层 scale/rotate）。
    func tick(handle: UInt64) {
        guard let v = view else { return }
        // ① 按压力增益（按住越久波越大；只在有按下动画目标时下发，变化 <0.01 跳过——省 FFI）
        if !pressedAnimTargets.isEmpty && handle != 0 && pressDownNs != 0 {
            let holdMs = Float(Double(DispatchTime.now().uptimeNanoseconds - pressDownNs) / 1e6)
            let t = min(1, holdMs / 700)                       // 700ms 到顶（与 Android PRESS_GAIN_RAMP_MS 同）
            let gain = 1 + t * (2.2 - 1)                       // 1 → 2.2（与 Android PRESS_GAIN_MAX 同）
            if abs(gain - lastPressGain) >= 0.01 {
                lastPressGain = gain
                for id in pressedAnimTargets {
                    _ = String(cString: proteus_layout_set_scale_gain(handle, UInt32(id), gain))
                }
            }
        }
        // ② 场跟手：每帧一次 FFI（仅在有焦点且脏时；不脏 ⇒ 不推——与 Android fieldDirty 同）
        guard handle != 0, !fieldFocus.isEmpty else { fieldDirty = false; return }
        fieldDirty = false
        fieldTicks += 1
        var touchedNow: [Int] = []
        for (cid, focus) in fieldFocus {
            guard let spec = fieldSpecs[cid] else { continue }
            var outLen: UInt32 = 0
            guard let ptr = proteus_layout_follow_field_bin(
                handle, UInt32(cid), Float(focus.x), Float(focus.y),
                spec.falloff, spec.minScale, spec.maxScale, spec.rotate, &outLen), outLen > 0 else { continue }
            defer { proteus_rects_free(ptr, outLen) }
            let stride = 12
            let n = Int(outLen) / stride
            let buf = UnsafeRawBufferPointer(start: ptr, count: Int(outLen))
            for i in 0..<n {
                let base = i * stride
                let id = buf.loadUnaligned(fromByteOffset: base, as: UInt32.self)
                let sc = buf.loadUnaligned(fromByteOffset: base + 4, as: Float.self)
                let rot = buf.loadUnaligned(fromByteOffset: base + 8, as: Float.self)
                v.applyFieldVisual(nodeId: Int(id), scale: CGFloat(sc), rotate: CGFloat(rot))
                touchedNow.append(Int(id))
                fieldTouched.insert(Int(id))
            }
        }
        if !touchedNow.isEmpty { fieldNodesTouched += touchedNow.count; lastFieldIds = touchedNow }
        if !fieldDirty { /* 本帧推完 */ }
    }

    /// 场叶回基态（抬指）：逐个清 override ⇒ 层回声明值（与 Android `resetFieldLeaves` 同语义）。
    private func resetFieldLeaves() {
        guard let v = view else { return }
        for id in fieldTouched { v.clearFieldVisual(nodeId: id) }
        fieldTouched.removeAll(keepingCapacity: true)
    }

    // ══════════════ ④ 按下态应用 / 还原 ══════════════

    private func applyPressAt(nodeId: Int, handle: UInt64) {
        guard let v = view else { return }
        var acted = false
        if let ps = pressStyles[nodeId] {
            pressedNodeId = nodeId
            v.applyPressAppearance(nodeId: nodeId, bg: ps.bg, borderColor: ps.borderColor,
                                   scaleX: ps.scaleX, scaleY: ps.scaleY,
                                   glowColor: ps.glowColor, glowRadius: ps.glowRadius, zIndex: ps.zIndex)
            pressApplyCount += 1
            acted = true
        }
        // ★按下传播到伪子（`:active::after{animation}` 折在**伪子**节点的 pressAnimation 上——
        //   与 Android applyPressAt 的 pressedAnimTargets 同款）：自身 + 伪子，合并成**一次** anim_start。
        var targets: [Int] = []
        if pressAnims[nodeId] != nil { targets.append(nodeId) }
        for pid in pseudoChildren[nodeId] ?? [] where pressAnims[pid] != nil { targets.append(pid) }
        if !targets.isEmpty {
            pressedAnimTargets = targets
            startPressAnims(handle: handle)
            acted = true
        }
        if !acted { pressedNodeId = -1 }
    }

    /// 还原按下态（UP/CANCEL/换树）。
    private func clearPress() {
        if pressedNodeId >= 0 { view?.clearPressAppearance(nodeId: pressedNodeId) }
        // 仍挂着 backup 的（含级联改过的）一并还原
        for (id, _) in pressBackup { if id != pressedNodeId { view?.clearPressAppearance(nodeId: id) } }
        pressedNodeId = -1
        pressBackup.removeAll(keepingCapacity: true)
        pressedAnimTargets.removeAll(keepingCapacity: true)
        pressDownNs = 0
    }

    private func startPressAnims(handle: UInt64) {
        guard handle != 0, !pressedAnimTargets.isEmpty else { return }
        // 收集通道（与 Android collectAnimEntries 同口径：末段 to 为终值；ΣdurMs 为时长；-1 = infinite）
        var anims: [[String: Any]] = []
        for id in pressedAnimTargets {
            guard let chans = pressAnims[id] else { continue }
            for ch in chans {
                guard let o = Self.animEntry(nodeId: id, channel: ch) else { continue }
                anims.append(o)
                let it = (ch["iterations"] as? Double) ?? 1
                if it < 0 { pressAnimInfinite = true }
            }
        }
        guard !anims.isEmpty else { return }
        guard let d = try? JSONSerialization.data(withJSONObject: ["anims": anims]),
              let j = String(data: d, encoding: .utf8) else { return }
        _ = j.withCString { takeCString(proteus_layout_anim_start(handle, $0)) }
        pressAnimStarts += 1
        // ★启动帧循环（与 Android driveKernelAnimFrames 同职责；iOS 的帧循环只做"每帧 tick"）
        view?.startFieldFrameLoop()
    }

    private func stopPressAnims(handle: UInt64) {
        guard handle != 0, !pressedAnimTargets.isEmpty else { return }
        let ids = pressedAnimTargets.map { String($0) }.joined(separator: ",")
        let j = "{\"nodeIds\":[\(ids)]}"
        _ = j.withCString { takeCString(proteus_layout_anim_stop(handle, $0)) }
        pressAnimStops += 1
        pressAnimInfinite = false
    }

    /// 单条通道 → 内核 anims 条目（与 Android `collectAnimEntries` 同形）。
    ///   kind 码：0=translateX(px) / 1=translateY(px) / 2=scale / 3=rotate / 4=opacity。
    private static func animEntry(nodeId: Int, channel: [String: Any]) -> [String: Any]? {
        guard let segs = channel["keyframes"] as? [[String: Any]], !segs.isEmpty else { return nil }
        var total = 0.0
        var lastTo = Double((channel["from"] as? Double) ?? 0)
        var kf: [[String: Any]] = []
        for s in segs {
            let dur = (s["durMs"] as? Double) ?? 0
            let to = (s["to"] as? Double) ?? 0
            total += dur
            lastTo = to
            var o: [String: Any] = ["to": to, "durMs": dur]
            if let c = s["curve"] as? Double { o["curve"] = c }
            kf.append(o)
        }
        var out: [String: Any] = [
            "nodeId": nodeId,
            "kind": (channel["kind"] as? Double) ?? 0,
            "from": (channel["from"] as? Double) ?? 0,
            "to": lastTo,
            "durMs": total > 0 ? total : 300,
            "keyframes": kf,
        ]
        if let d = channel["delayMs"] as? Double, d > 0 { out["delayMs"] = d }
        if let it = channel["iterations"] as? Double, it != 1 { out["repeat"] = it }
        return out
    }

    // ══════════════ ⑤ 探针（判据读数）══════════════

    /// ★诊断：按下态表的样本键 + 命中目标（定位"表键 vs 命中 id"的空间一致性）
    var diagIds: String {
        let keys = pressStyles.keys.sorted().prefix(6).map { String($0) }.joined(separator: ",")
        return "{\"press_ids\":[" + keys + "],\"last_target\":" + String(lastDiagTarget) + "}"
    }
    private(set) var lastDiagTarget = -1
    func noteTarget(_ t: Int) { lastDiagTarget = t }

    var probeJson: String {
        let ids = lastFieldIds.map { String($0) }.joined(separator: ",")
        return "{\"press_styles\":\(pressStyles.count),\"press_applied\":\(pressApplyCount),"
            + "\"press_anim_starts\":\(pressAnimStarts),\"press_anim_stops\":\(pressAnimStops),"
            + "\"field_specs\":\(fieldSpecs.count),\"field_ticks\":\(fieldTicks),"
            + "\"field_nodes_touched\":\(fieldNodesTouched),\"field_touched_now\":\(fieldTouched.count),"
            + "\"pseudo_parents\":\(pseudoChildren.count),\"last_field_ids\":[\(ids)]}"
    }
}
