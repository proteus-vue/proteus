// hosts/ios/ProteusHost/runtime/host-tree-diff.swift
// ★★★#1100：**树 diff（增量补丁计算）**——从 `selfdraw-scene.swift` 机械搬迁（行为零变化）。
//
// 【为什么拆出来】`selfdraw-scene.swift` 已 8881 行（远超 1000 行上限的存量棘轮），
//   而 #1100 要在 mount 路径上加相位埋点（必须动那个文件）⇒ 按 `check:file-size` 的纪律
//   「存量只减不增」，先把这个**自包含、零私有状态依赖**的纯函数搬出来，给新增埋点腾出行额。
//
// 【职责单一】只回答一个问题：**「上一帧 → 本帧」哪些布局字段变了**，算成补丁数组。
//   它是 iOS 增量更新（`proteus_layout_update`）的输入；结构与文本变化返回 nil（⇒ 宿主退回全量）。
//   不持有状态、不碰 CALayer、不读内核 —— 所以可以安全地独立成文件。
//
// ★#1100 第二批搬迁（同一次文件大小整备）：`buildFullRequest` + `jsonString/jsonString2/jsonEscape`。
//   它们同样是**纯函数**（入参 → JSON 串），被 `render` / `applyOps` / `splice` 共用；
//   放在这里而不是留在 8000+ 行的场景文件末尾，是同一职责（"请求/回执的序列化"）的聚合。
import Foundation

/* ────────────────────────── 树 diff ────────────────────────── */

/// 树 diff：把「上一帧 → 本帧」的**样式变化**算成补丁数组（增量更新的输入）
///
/// 【为什么需要它（而不是把整树发过去）】`proteus_layout_update` 的入参是**补丁**，
///   而宿主手上是两帧完整节点数组 —— 差异必须由宿主算（核心不知道上一帧是什么）。
///
/// 【返回 nil 的情形 = 退回全量重建】（正确性优先：宁可重建，也不要用错的前提算几何）
///   · 节点**增删**（id 集合不同）—— 核心的 update 入口不处理结构变化
///   · 某节点的文本变化 —— 度量需重新注入，而当前 update 入口不带度量表
///
/// 【只比布局字段】绘制属性（圆角/字号/文字色）**不影响几何** ⇒ 不进补丁，
///   避免用「无关变化」触发重排（这是增量能否真正省下来的关键）。
///   ★`backgroundColor` 的特殊性（2026-10-01）：它**也不进补丁**（底色变化不该触发重排），
///   但**必须进全量请求**（它是内核颜色动画的 `bg_base`——见 `buildFullRequest` 注释）。
///   两条要求不矛盾：补丁管"几何变更"，全量请求管"内核需要的样式事实"。
func diffPatches(from prev: [[String: Any]], to next: [[String: Any]]) -> [[String: Any]]? {
    if prev.isEmpty { return nil }
    if prev.count != next.count { return nil }                 // 结构变化 → 全量
    let prevById = Dictionary(uniqueKeysWithValues: prev.compactMap { n -> (Int, [String: Any])? in
        guard let id = n["id"] as? Int else { return nil }
        return (id, n)
    })
    // ★只比这些**布局字段**（其余字段改了对几何没有影响）
    let layoutKeys = ["width", "height", "flexGrow", "flexShrink", "flexBasis", "gap"]
    var patches: [[String: Any]] = []
    for n in next {
        guard let id = n["id"] as? Int, let p = prevById[id] else { return nil }  // 新节点 → 全量
        // 文本变了 → 度量要重算，当前 update 入口不支持 → 全量
        let pt = p["text"] as? String
        let nt = n["text"] as? String
        if pt != nt { return nil }
        var style: [String: Any] = [:]
        for k in layoutKeys {
            let a = p[k] as? Double
            let b = n[k] as? Double
            if a != b { style[k] = b ?? NSNull() }             // NSNull = 显式置空（回 auto）
        }
        // margin/padding：对象比较（浅比足够——字段固定四边）
        for k in ["margin", "padding"] {
            let a = p[k] as? [String: Double]
            let b = n[k] as? [String: Double]
            if !edgesEqual(a, b) { style[k] = b ?? [:] }
        }
        if !style.isEmpty { patches.append(["id": id, "style": style]) }
    }
    return patches
}

private func edgesEqual(_ a: [String: Double]?, _ b: [String: Double]?) -> Bool {
    let la = a ?? [:], lb = b ?? [:]
    for k in ["top", "right", "bottom", "left"] {
        if (la[k] ?? 0) != (lb[k] ?? 0) { return false }
    }
    return true
}

/* ────────────────────── 全量请求 / JSON 序列化 ────────────────────── */

/// 上一帧全量请求的字节数（诊断：证明增量路径确实没走整树序列化）
private var lastFullRequestBytes = 0

/// 组装**全量**核心请求（只在首帧 / 结构变更时调用——见调用点的成本说明）
func buildFullRequest(nodes: [[String: Any]], textMeasures: [String: [String: Double]], root: [String: Any]) -> String {
    var req: [String: Any] = ["viewport": root["viewport"] as? [String: Any] ?? ["width": 390, "height": 844],
                             "nodes": nodes, "textMeasures": textMeasures]
    if var ns = req["nodes"] as? [[String: Any]] {
        for i in ns.indices {
            // ★★`backgroundColor` / `color` **都不删**（2026-10-01）：两者都已是内核字段
            //   （底色 / 文字色的基色）。与 `render(treeJson:)` 里的同类过滤**同源**——
            //   两处都要放行，否则"首帧全量路径"与"结构变更后的全量路径"行为不同
            //   （一有一无基色 ⇒ 颜色动画时灵时不灵）。
            ns[i].removeValue(forKey: "fontSize")
            ns[i].removeValue(forKey: "borderRadius")
        }
        req["nodes"] = ns
    }
    guard let d = try? JSONSerialization.data(withJSONObject: req),
          let str = String(data: d, encoding: .utf8) else { return "{}" }
    lastFullRequestBytes = str.count
    return str
}

/// 供 `jsonString` 之外的调用点使用（同实现；命名区分以免与既有重载混淆）
func jsonString2(_ o: Any) -> String {
    guard let d = try? JSONSerialization.data(withJSONObject: o),
          let s = String(data: d, encoding: .utf8) else { return "[]" }
    return s
}

func jsonString(_ o: [String: Any]) -> String {
    guard let d = try? JSONSerialization.data(withJSONObject: o),
          let s = String(data: d, encoding: .utf8) else { return "{}" }
    return s
}

func jsonEscape(_ s: String) -> String {
    let escaped = s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
    return "\"\(escaped)\""
}
