// hosts/ios/ProteusHost/screen-host.swift
// ★★M5 执行器的**宿主侧实现（iOS 腿）** —— `screen.*` 协议（与 Android `ScreenHost.java` **同契约**）
//
// 【协议来源】`packages/render-backend/src/screen-executor-host.ts` 的文件头（**唯一事实源**）。
//   两端实现同一份协议 ⇒ 执行器（JS 编排层）零平台分支、判据脚本共用一套读法。
//
// | 请求 | 本类动作（真 API） |
// |---|---|
// | `screen.mount` | 每屏一棵**真实内核树**（`proteus_layout_create`）；返回该树根节点 id |
// | `screen.visible` | 内核 `proteus_layout_update` 的 `display: flex/none` 补丁（布局与命中随之生效） |
// | `screen.destroy` | `proteus_layout_destroy`（真销毁内核树）+ 计数返回 |
// | `screen.anim` | `proteus_layout_anim_start`（内核曲线求值）+ **CADisplayLink 帧循环**推 `anim_tick_bin`，播完回推 token |
//
// 【与 Android 腿的两处平台差异（如实标注，不假装一致）】
//   · 帧循环：iOS 用 **CADisplayLink**（跟随真实 vsync；`.common` 模式保证滚动/手势期间不停）；
//     Android 用 Choreographer（同语义，不同 API）。
//   · 动画按树分发：两端相同（内核会因"节点不在该树"整批拒绝——Android 已实测，本实现同法）。
//
// 【诚实边界】本类证明"内核树真建/真改/真销毁 + 内核动画真启动并被主机帧循环推进"；
//   屏与树的**视觉合成**（多棵内核树叠放渲染）不在本类范围（与 Android 腿同一边界）。

import Foundation
import UIKit

// ★★FFI 补充声明（其余 `proteus_layout_*` 由 selfdraw-scene.swift 声明；
//   `node_rect` 是 2026-10-01「跨页面共享元素的稳态几何回传」新增的读取口——
//   页面栈层在目标页 mount 后取它的节点矩形，作为飞行终点基准）。
@_silgen_name("proteus_layout_node_rect")
func proteus_layout_node_rect(_ handle: UInt64, _ nodeId: UInt32) -> UnsafeMutablePointer<CChar>

final class ScreenHost: NSObject {
    private static let TAG = "proteus-screen"

    /// 最近创建的实例（场景轮询读 stats 用；同一进程通常只有一个宿主桥）
    static weak var current: ScreenHost?

    override init() {
        super.init()
        ScreenHost.current = self
    }

    /** 屏记录：每屏一棵真实内核树（屏 = 树，M5 §0.2） */
    private final class ScreenTree {
        let screenId: String
        let name: String
        var handle: UInt64
        var rootNodeId: Int
        var visible = false
        init(screenId: String, name: String, handle: UInt64, rootNodeId: Int) {
            self.screenId = screenId
            self.name = name
            self.handle = handle
            self.rootNodeId = rootNodeId
        }
    }

    private var screens: [String: ScreenTree] = [:]
    /// ★节点 id → 屏（动画**按树分发**用——与 Android 腿同法；混批会被内核整批拒绝）
    private var nodeToScreen: [Int: ScreenTree] = [:]

    // ── 诊断记账（判据读：证明动作真发生，非壳自述） ──
    private var mountCalls = 0, visibleCalls = 0, destroyCalls = 0, animCalls = 0, animCompleted = 0, animHookMissing = 0
    /// ★跨页面共享元素计数（2026-10-01；判据读它证明"这条链真的走过"）
    private var rectCalls = 0, sharedCalls = 0
    private var callLog: [String] = []

    // ── 帧循环（CADisplayLink；一次只允许一条在飞——与"一次导航 = 一次转场"同构） ──
    private var frameLink: CADisplayLink?

    // MARK: - 主入口（契约同 Android.invoke）

    /// 执行一个 `screen.*` 请求（由宿主桥 `invoke` 转调；返回 JSON 串）。
    /// 未知方法 ⇒ 返回 `{ok:false, missing:true}`（与 HostCapabilities 同一诚实分档）。
    func invoke(_ method: String, _ argsJson: String) -> String {
        callLog.append(method)
        let args = Self.parseJsonObject(argsJson)
        switch method {
        case "screen.mount": return mount(args)
        case "screen.visible": return visible(args)
        case "screen.destroy": return destroy(args)
        case "screen.anim": return anim(args)
        case "screen.rect": return rect(args)
        case "screen.shared": return shared(args)
        case "screen.stats": return ok(stats())
        default: return miss("未实现的 screen 方法：\(method)")
        }
    }

    // MARK: - screen.rect（★跨页面共享元素的稳态几何回传，2026-10-01）

    /// 单节点绝对矩形（内核算——与 FLIP 同一套收集/吸附）。
    /// 入参 `{screenId, nodeId}`；出参 `{ok, x, y, width, height}`。
    private func rect(_ args: [String: Any]) -> String {
        guard let screenId = args["screenId"] as? String else { return fail("screen.rect: 缺 screenId") }
        guard let nodeId = args["nodeId"] as? Int else { return fail("screen.rect: 缺 nodeId") }
        guard let st = screens[screenId] else { return fail("screen.rect: 未知屏 \(screenId)（未 mount？）") }
        let ptr = proteus_layout_node_rect(st.handle, UInt32(nodeId))
        let outStr = String(cString: ptr)
        proteus_layout_free_string(ptr)
        rectCalls += 1
        // 内核回 `{ok:true,x,y,width,height}`（失败回 `{ok:false,error}`）——**原样透传**，
        // 布局语义（含"不在树上/display:none"的报错）不在宿主层复述。
        guard let od = outStr.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: od)) as? [String: Any] else {
            return fail("screen.rect: 内核回执非 JSON：\(outStr.prefix(120))")
        }
        return ok(o)
    }

    // MARK: - screen.shared（★跨页面共享元素，2026-10-01）

    /// 跨页面共享元素：`{targetScreenId, targetNodeId, sourceRect{x,y,w,h}, durMs, curve, fadeIn, token}`
    ///   → 内核 `shared_element` 算出几何 + 写首帧 ⇒ 宿主帧循环推进（与 `screen.anim` 同一条完成链）。
    ///
    /// 【与同树共享元素的差别】源几何**由调用方（页面栈层）注入**——跨页面的稳态起点只有它知道
    ///   （内核只认识"当前树"，另一棵树的矩形要宿主给）。这正是内核 FFI 里 `sourceRect` 分支的用途。
    private func shared(_ args: [String: Any]) -> String {
        guard let screenId = args["targetScreenId"] as? String else { return fail("screen.shared: 缺 targetScreenId") }
        guard let nodeId = args["targetNodeId"] as? Int else { return fail("screen.shared: 缺 targetNodeId") }
        guard let st = screens[screenId] else { return fail("screen.shared: 未知屏 \(screenId)（未 mount？）") }
        guard let sr = args["sourceRect"] as? [String: Any] else { return fail("screen.shared: 缺 sourceRect") }
        let durMs = (args["durMs"] as? Double) ?? 400
        let curve = (args["curve"] as? Int) ?? 1
        let fadeIn = (args["fadeIn"] as? Bool) ?? true
        let token = (args["token"] as? String) ?? ""
        let body: [String: Any] = [
            "targetId": nodeId,
            "sourceRect": ["x": sr["x"] ?? 0, "y": sr["y"] ?? 0, "w": sr["w"] ?? 0, "h": sr["h"] ?? 0],
            "durMs": durMs, "curve": curve, "fadeIn": fadeIn,
        ]
        guard let d = try? JSONSerialization.data(withJSONObject: body),
              let j = String(data: d, encoding: .utf8) else { return fail("screen.shared: 请求序列化失败") }
        let out = j.withCString { proteus_layout_shared_element(st.handle, $0) }
        let outStr = String(cString: out)
        proteus_layout_free_string(out)
        guard let od = outStr.data(using: .utf8),
              let ro = (try? JSONSerialization.jsonObject(with: od)) as? [String: Any],
              (ro["ok"] as? Bool) == true else {
            return fail("screen.shared: 内核拒绝：\(outStr.prefix(160))")
        }
        sharedCalls += 1
        // 帧循环推进（与 screen.anim **同一条**完成链——token 回推 __proteusHostScreenAnimDone）
        let t0 = CACurrentMediaTime()
        startFrameLoop(targets: [st], t0: t0, budgetS: durMs / 1000.0 + 0.1, token: token)
        return ok(["started": 1, "fromRect": ro["fromRect"] ?? [:], "toRect": ro["toRect"] ?? [:]])
    }

    // MARK: - screen.mount

    private func mount(_ args: [String: Any]) -> String {
        guard let screenId = args["screenId"] as? String else { return fail("screen.mount: 缺 screenId") }
        let name = (args["name"] as? String) ?? screenId
        let rebuild = (args["rebuild"] as? Bool) ?? false
        // 幂等：同 screenId 重复 mount（rebuild）⇒ 先销毁旧树（真释放，不泄漏）
        if let old = screens[screenId] {
            if old.handle != 0 { _ = proteus_layout_destroy(old.handle) }
            nodeToScreen = nodeToScreen.filter { $0.value !== old }
            screens.removeValue(forKey: screenId)
        }
        // 装置屏树：根 + 3 个子（真实业务里是 Vue 渲染产物；此处用几何合理的占位子树——
        // 与 Android 腿同一边界，见文件头）
        let rootId = 100 + screens.count * 10
        let nodes: [[String: Any]] = [
            node(rootId, nil, 0, 0, 1080, 2400, nil),
            node(rootId + 1, rootId, 0, 0, 1080, 200, 0x3355AA),
            node(rootId + 2, rootId, 0, 200, 1080, 200, 0xAA5533),
            node(rootId + 3, rootId, 0, 400, 1080, 200, 0x33AA55),
        ]
        let req: [String: Any] = ["viewport": ["width": 1080, "height": 2400], "nodes": nodes]
        guard let reqData = try? JSONSerialization.data(withJSONObject: req),
              let reqJson = String(data: reqData, encoding: .utf8) else {
            return fail("screen.mount: 请求序列化失败")
        }
        let handle = reqJson.withCString { proteus_layout_create($0) }
        if handle == 0 { return fail("screen.mount: proteus_layout_create 失败（屏 \(screenId)）") }
        let st = ScreenTree(screenId: screenId, name: name, handle: handle, rootNodeId: rootId)
        screens[screenId] = st
        for i in 0..<4 { nodeToScreen[rootId + i] = st }
        mountCalls += 1
        return ok([
            "rootNodeId": rootId,
            "nodes": 4,
            "rebuild": rebuild,
            "handle": Int(handle),
        ])
    }

    private func node(_ id: Int, _ parentId: Int?, _ x: Double, _ y: Double, _ w: Double, _ h: Double, _ color: Int?) -> [String: Any] {
        var n: [String: Any] = ["id": id]
        if let p = parentId { n["parentId"] = p }
        // ★★顶层几何字段（2026-10-01 修复，与 Android 腿同批）：内核 `create` 的节点 DTO
        //   （`ffi.rs::NodeDto`，serde camelCase）读的是**顶层** width/height/left/top + position——
        //   本方法**原先把它们包在 `style` 里**（那是 `update` 的 patch 格式），create 侧会
        //   静默忽略 ⇒ 全屏树 0×0（实测："跨页面共享元素：目标节点无可测尺寸（0×0）"）。
        //   ★同源纪律：装置代码的字段形态也要对着**内核真实契约**核（本次取证 = NodeDto 定义）。
        n["position"] = (x != 0 || y != 0) ? "absolute" : "relative"
        if x != 0 { n["left"] = x }
        if y != 0 { n["top"] = y }
        n["width"] = w
        n["height"] = h
        if let c = color { n["bg"] = c }
        return n
    }

    // MARK: - screen.visible

    private func visible(_ args: [String: Any]) -> String {
        guard let screenId = args["screenId"] as? String else { return fail("screen.visible: 缺 screenId") }
        let isVisible = (args["visible"] as? Bool) ?? true
        guard let st = screens[screenId] else {
            return fail("screen.visible: 未知屏 \(screenId)（未 mount？）")
        }
        let patches: [[String: Any]] = [[
            "id": st.rootNodeId,
            "style": ["display": isVisible ? "flex" : "none"],
        ]]
        guard let pd = try? JSONSerialization.data(withJSONObject: patches),
              let pj = String(data: pd, encoding: .utf8) else { return fail("screen.visible: patch 序列化失败") }
        let out = pj.withCString { proteus_layout_update(st.handle, $0) }
        let outStr = String(cString: out)
        proteus_layout_free_string(out)
        guard let od = outStr.data(using: .utf8),
              let ro = (try? JSONSerialization.jsonObject(with: od)) as? [String: Any],
              (ro["ok"] as? Bool) == true else {
            return fail("screen.visible: 内核 update 失败：\(outStr.prefix(160))")
        }
        st.visible = isVisible
        visibleCalls += 1
        // ★真实生效读数：该屏树的几何矩形数（0 ⇒ 内核确实按 display:none 跳过布局）
        var rects = 0
        let rectsPtr = proteus_layout_rects(st.handle)
        let rectsStr = String(cString: rectsPtr)
        proteus_layout_free_string(rectsPtr)
        if let rd = rectsStr.data(using: .utf8),
           let rj = (try? JSONSerialization.jsonObject(with: rd)) as? [String: Any],
           let rectsObj = rj["rects"] as? [String: Any] {
            rects = rectsObj.count
        }
        return ok([
            "visible": isVisible,
            "rects": rects,
            "relayout": (ro["relayout_count"] as? Int) ?? -1,
        ])
    }

    // MARK: - screen.destroy

    private func destroy(_ args: [String: Any]) -> String {
        guard let screenId = args["screenId"] as? String else { return fail("screen.destroy: 缺 screenId") }
        guard let st = screens.removeValue(forKey: screenId) else {
            return ok(["removed": 0, "note": "屏不存在（重复销毁？）——如实记 0，不假装"])
        }
        nodeToScreen = nodeToScreen.filter { $0.value !== st }
        let destroyed = st.handle != 0 && proteus_layout_destroy(st.handle)
        destroyCalls += 1
        return ok(["removed": destroyed ? 4 : 0, "destroyed": destroyed])
    }

    // MARK: - screen.anim

    private func anim(_ args: [String: Any]) -> String {
        let anims = (args["anims"] as? [[String: Any]]) ?? []
        let token = (args["token"] as? String) ?? ""
        let durationMs = max(0, (args["durationMs"] as? Double) ?? 300)
        if anims.isEmpty {
            return ok(["started": 0, "immediate": true])
        }
        // ★按树分发（同 Android 腿：混批会被内核整批拒绝）
        var perTree: [ObjectIdentifier: (ScreenTree, [[String: Any]])] = [:]
        var unmatched = 0
        for a in anims {
            guard let nid = a["nodeId"] as? Int, let owner = nodeToScreen[nid] else { unmatched += 1; continue }
            let key = ObjectIdentifier(owner)
            if perTree[key] == nil { perTree[key] = (owner, []) }
            perTree[key]!.1.append(a)
        }
        if unmatched > 0 {
            NSLog("[\(Self.TAG)] screen.anim: %d 条动画的目标节点不在在册屏树（已跳过）", unmatched)
        }
        var started = 0
        var targets: [ScreenTree] = []
        for (_, pair) in perTree {
            let (st, list) = pair
            guard let d = try? JSONSerialization.data(withJSONObject: ["anims": list]),
                  let j = String(data: d, encoding: .utf8) else { continue }
            let out = j.withCString { proteus_layout_anim_start(st.handle, $0) }
            let outStr = String(cString: out)
            proteus_layout_free_string(out)
            if let od = outStr.data(using: .utf8),
               let ro = (try? JSONSerialization.jsonObject(with: od)) as? [String: Any],
               (ro["ok"] as? Bool) == true {
                let n = (ro["started"] as? Int) ?? 0
                started += n
                if n > 0 { targets.append(st) }
            }
        }
        if started == 0 {
            return ok(["started": 0, "immediate": true, "note": "内核未受理任何动画（如实）"])
        }
        animCalls += 1
        // ② CADisplayLink 帧循环推进（真实 vsync；`.common` 模式不被滚动/手势掐停）+ 到点回推
        let t0 = CACurrentMediaTime()
        let budgetS = durationMs / 1000.0 + 0.1
        startFrameLoop(targets: targets, t0: t0, budgetS: budgetS, token: token)
        return ok(["started": started])
    }

    private func startFrameLoop(targets: [ScreenTree], t0: CFTimeInterval, budgetS: Double, token: String) {
        frameLink?.invalidate()
        // 状态经属性传递（一次只允许一条在飞——与"一次导航 = 一次转场"同构）
        frameTargets = targets
        frameT0 = t0
        frameBudget = budgetS
        frameToken = token
        frameLast = CACurrentMediaTime()
        let link = CADisplayLink(target: self, selector: #selector(onFrame(_:)))
        link.add(to: .main, forMode: .common) // ★.common：滚动/手势期间不停（与既有帧循环同法）
        frameLink = link
    }

    private var frameTargets: [ScreenTree] = []
    private var frameT0: CFTimeInterval = 0
    private var frameBudget: Double = 0
    private var frameToken = ""
    private var frameLast: CFTimeInterval = 0

    @objc private func onFrame(_ link: CADisplayLink) {
        let now = CACurrentMediaTime()
        let dtMs = frameLast == 0 ? 16 : Float((now - frameLast) * 1000)
        frameLast = now
        for st in frameTargets where st.handle != 0 {
            var outLen: UInt32 = 0
            if let ptr = proteus_layout_anim_tick_bin(st.handle, dtMs, &outLen) {
                // ★返回值必须释放（本仓实测教训：漏 free ⇒ 每帧泄漏一块——16B×N/帧）
                proteus_rects_free(ptr, outLen)
            }
        }
        if now - frameT0 >= frameBudget {
            link.invalidate()
            frameLink = nil
            completeAnim(token: frameToken)
        }
    }

    /// 动画完成：回推 token（钩子缺失则记数，不静默）
    private func completeAnim(token: String) {
        let expr = "typeof __proteusHostScreenAnimDone === 'function' ? String(__proteusHostScreenAnimDone(\(Self.jsonString(token)), '{}')) : 'no-hook'"
        guard let eval = Self.evalJs else { return }
        let ack = eval(expr)
        if ack != "no-hook" {
            animCompleted += 1
            NSLog("[\(Self.TAG)] screen.anim 完成回推 token=%@（累计 %d）", token, animCompleted)
        } else {
            animHookMissing += 1
            NSLog("[\(Self.TAG)] screen.anim 完成但 JS 钩子缺失（token=%@）——记数不静默", token)
        }
    }

    /// JS 求值入口（场景注入——与 HostLifecycleEvents 同法）
    static var evalJs: ((String) -> String)?

    // MARK: - 诊断

    func stats() -> [String: Any] {
        var screensOut: [[String: Any]] = []
        for (_, st) in screens {
            screensOut.append(["screenId": st.screenId, "visible": st.visible, "rootNodeId": st.rootNodeId])
        }
        let from = max(0, callLog.count - 32)
        return [
            "mount_calls": mountCalls,
            "visible_calls": visibleCalls,
            "destroy_calls": destroyCalls,
            "anim_calls": animCalls,
            "anim_completed": animCompleted,
            "anim_hook_missing": animHookMissing,
            "rect_calls": rectCalls,
            "shared_calls": sharedCalls,
            "live_screens": screens.count,
            "calls": Array(callLog[from...]),
            "screens": screensOut,
        ]
    }

    /// 释放全部屏树（场景退出时调——框架代管资源）
    func dispose() {
        frameLink?.invalidate()
        frameLink = nil
        for (_, st) in screens where st.handle != 0 {
            _ = proteus_layout_destroy(st.handle)
        }
        screens.removeAll()
        nodeToScreen.removeAll()
    }

    // MARK: - 工具

    private static func parseJsonObject(_ s: String?) -> [String: Any] {
        guard let s, !s.isEmpty, s != "null", let d = s.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return [:] }
        return o
    }

    private static func jsonString(_ s: String) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: [s]),
              var out = String(data: d, encoding: .utf8) else { return "\"\"" }
        out.removeFirst(); out.removeLast()
        return out
    }

    private func ok(_ data: Any) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: ["ok": true, "data": data]),
              let s = String(data: d, encoding: .utf8) else { return "{\"ok\":false,\"reason\":\"json 序列化失败\",\"missing\":false}" }
        return s
    }

    private func fail(_ reason: String) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: ["ok": false, "reason": reason, "missing": false]),
              let s = String(data: d, encoding: .utf8) else { return "{\"ok\":false}" }
        return s
    }

    private func miss(_ reason: String) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: ["ok": false, "reason": "unsupported: \(reason)", "missing": true]),
              let s = String(data: d, encoding: .utf8) else { return "{\"ok\":false,\"missing\":true}" }
        return s
    }
}
