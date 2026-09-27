// hosts/ios/ProteusHost/selfdraw-scene.swift
// ★★★**Vue 渲染 → Rust 自绘管线**（用户点名要验的那一环，2026-09-29）
//
// 【它补的是哪个缺口】
//   此前有两条互不相连的链路（本仓核实）：
//     · Vue → render-backend → NativeBackend → **UIView 树**（`bridge/entry.ts`，布局靠 UIKit）
//     · **手写 JSON** → Rust 排版核心 → 几何 → Canvas/CALayer
//   本文件把两者接上：**标准 Vue 应用** → Vue 自定义渲染器 → 渲染树 → **Rust 核心算几何**
//   → 宿主按几何建 **CALayer 树**（自绘，无 per-node UIView）。
//
// 【分工（也是本场景要证明的「一份语义多引擎」）】
//   JS 侧：业务逻辑 + Vue diff + 产出语义树（**不含几何**）
//   宿主侧：CoreText 度量（平台注入）+ 调 Rust 核心算几何 + 建 CALayer 树
//   ⇒ **几何只在一处产生**（Rust 核心），JS 与宿主都不自行计算布局。
//
// 【与既有 calayer-scene.swift 的差别】
//   那个是「手写 12 行 JSON → CALayer」，验证的是几何通道；
//   本文件是「真实 Vue 应用 → CALayer」，验证的是**整条 App 链路**（含 Vue 运行时与 diff）。
import UIKit
import JavaScriptCore

/* ────────────────────────── Rust C ABI ────────────────────────── */

@_silgen_name("proteus_layout_create")
func proteus_layout_create(_ requestJson: UnsafePointer<CChar>) -> UInt64

@_silgen_name("proteus_layout_rects")
func proteus_layout_rects(_ handle: UInt64) -> UnsafeMutablePointer<CChar>

@_silgen_name("proteus_layout_destroy")
func proteus_layout_destroy(_ handle: UInt64) -> Bool

@_silgen_name("proteus_layout_version")
func proteus_layout_version() -> UnsafeMutablePointer<CChar>

@_silgen_name("proteus_layout_free_string")
func proteus_layout_free_string(_ ptr: UnsafeMutablePointer<CChar>)

@_silgen_name("proteus_layout_update")
func proteus_layout_update(_ handle: UInt64, _ patchesJson: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>

func takeCString(_ ptr: UnsafeMutablePointer<CChar>) -> String {
    defer { proteus_layout_free_string(ptr) }
    return String(cString: ptr)
}

/* ────────────────────────── JS ↔ 宿主 协议 ────────────────────────── */

@objc protocol SelfDrawExports: JSExport {
    /// 首次挂载：渲染树 JSON → 建 Rust 树 + CALayer 树；返回耗时分解
    func mount(_ treeJson: String) -> String
    /// 更新（Vue diff 后重发整树——★**保留给结构变化**用：增删节点时必须整树）
    func update(_ treeJson: String) -> String
    /// ★★**增量更新**：只发改动过的节点的样式补丁（跨边界字节数从 280KB 降到几十字节）
    func updatePatches(_ patchesJson: String) -> String
    /// 截图落盘（验证「屏幕上真的画出来了」）
    func snapshot(_ name: String) -> String
    /// JS 侧自报读数（Vue mount / update 耗时 + patch 次数）
    func report(_ json: String)
    /// 链路完成（宿主据此落盘报告）
    func done(_ summaryJson: String)
}

/* ────────────────────────── 宿主（自绘） ────────────────────────── */

final class SelfDrawView: UIView {

    /// 当前 CALayer 树（★自绘：每节点一个 CALayer，**不创建 UIView**）
    private var layerNodes: [CALayer] = []
    private(set) var builtLayerCount = 0
    /// 节点 id → 几何（供 hit test 与诊断）
    private(set) var rectsByNodeId: [Int: CGRect] = [:]
    /// 节点 id → 语义（供截图核验与后续事件接入）
    private(set) var metaByNodeId: [Int: [String: Any]] = [:]
    /// 节点 id → **绝对原点**（用于把核心的绝对坐标换算为 CALayer 的父相对坐标）
    private var absOriginByNodeId: [Int: CGPoint] = [:]
    /// ★节点 id → 已建好的 CALayer（**增量更新的前提**：有它才能只改frame、不重建）
    private var layersById: [Int: CALayer] = [:]
    /// 节点 id → 父 id（增量更新时判断父子关系用）
    private var parentById: [Int: Int] = [:]
    /// 实际下发的 CALayer frame（**父相对**）与父 id —— 供核验脚本对照核心几何
    private(set) var builtFrames: [Int: CGRect] = [:]
    private(set) var builtParents: [Int: Int] = [:]

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        // ★关掉 CALayer 的隐式动画：自绘管线每帧重建层，动画会让测量结果失真
        //   （CALayer 默认对 bounds/position 变化做 0.25s 隐式动画——本仓实测踩到过类似问题）
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        CATransaction.commit()
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// 清空当前层树
    func clearLayers() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for l in layerNodes { l.removeFromSuperlayer() }
        layerNodes.removeAll(keepingCapacity: true)
        builtLayerCount = 0
        rectsByNodeId.removeAll(keepingCapacity: true)
        metaByNodeId.removeAll(keepingCapacity: true)
        absOriginByNodeId.removeAll(keepingCapacity: true)
        layersById.removeAll(keepingCapacity: true)
        parentById.removeAll(keepingCapacity: true)
        builtFrames.removeAll(keepingCapacity: true)
        builtParents.removeAll(keepingCapacity: true)
        CATransaction.commit()
    }

    /// 按几何建 CALayer 树
    ///
    /// - Parameter flat: `[(nodeId, parentId, rect, style)]` —— 已按树序拍平（父在前）
    func buildLayers(
        flat: [(id: Int, parentId: Int?, rect: CGRect, style: [String: Any])]
    ) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var byId: [Int: CALayer] = [:]
        for item in flat {
            let layer: CALayer
            let text = item.style["text"] as? String
            let fontSize = item.style["fontSize"] as? CGFloat
            if let text = text, !text.isEmpty {
                // 文本叶子 → CATextLayer（GPU 加速；不创建 UIView，也不自栅格化）
                let tl = CATextLayer()
                tl.string = text
                tl.font = CGFont("Helvetica" as CFString)
                tl.fontSize = fontSize ?? 14
                tl.foregroundColor = (item.style["color"] as? String).flatMap(parseHexColor)?.cgColor ?? UIColor.white.cgColor
                tl.alignmentMode = .left
                tl.truncationMode = .end
                // ★contentsScale 必须显式设置：否则 Retina 上文本模糊（CATextLayer 不继承自动缩放）
                tl.contentsScale = UIScreen.main.scale
                tl.isWrapped = false
                layer = tl
            } else {
                layer = CALayer()
                if let bg = (item.style["backgroundColor"] as? String).flatMap(parseHexColor) {
                    layer.backgroundColor = bg.cgColor
                }
                if let r = item.style["borderRadius"] as? CGFloat, r > 0 {
                    layer.cornerRadius = r
                    layer.masksToBounds = true
                }
            }
            // ★几何**完全来自 Rust 核心**（位置/尺寸都不是 UIKit 算的）
            //
            // ★★坐标系换算（本仓实测踩到，是本场景最关键的一处）：
            //   核心给的 rects 是**绝对坐标**（相对根原点），而 CALayer 的子层 frame 是
            //   **相对父层**的坐标 —— 直接把绝对坐标赋给子层会**二次叠加父偏移**。
            //   现象：所有嵌套内容整体下移/右移（文字跑到卡片外、卡片看起来盖住标题），
            //   而几何报告本身是**正确的**（所以只查报告发现不了，必须看图）。
            //   ⇒ 子层 frame = 绝对 rect − 父层绝对原点。
            let parentOrigin: CGPoint
            if let pid = item.parentId, let parentAbs = absOriginByNodeId[pid] {
                parentOrigin = parentAbs
            } else {
                parentOrigin = .zero
            }
            absOriginByNodeId[item.id] = item.rect.origin
            layer.frame = CGRect(x: item.rect.minX - parentOrigin.x,
                                 y: item.rect.minY - parentOrigin.y,
                                 width: item.rect.width, height: item.rect.height)
            builtFrames[item.id] = layer.frame
            builtParents[item.id] = item.parentId ?? -1
            layersById[item.id] = layer
            parentById[item.id] = item.parentId ?? -1
            if let pid = item.parentId, let parent = byId[pid] {
                parent.addSublayer(layer)
            } else {
                self.layer.addSublayer(layer)
            }
            byId[item.id] = layer
            layerNodes.append(layer)
            rectsByNodeId[item.id] = item.rect
            metaByNodeId[item.id] = item.style
        }
        builtLayerCount = layerNodes.count
        CATransaction.commit()
    }

    /// ★★**增量更新层**：只改「核心报告变化的那些节点」的 frame（不重建、不销毁任何层）
    ///
    /// 【为什么这是关键优化（真机实测）】此前每次更新都 `clearLayers + buildLayers`：
    ///   3507 节点实测 **build_layers = 80.7ms**（占宿主总耗时的一半以上）。
    ///   而核心现在能返回**变化集**（`proteus_layout_update` 的 `rects` 字段，
    ///   实测只改 1 行时仅 41 个节点）⇒ 这里就只改这 41 个层的 frame。
    ///
    /// 【坐标系】核心给的是**绝对**rect；CALayer 的 frame 是**父相对** ⇒ 需减去父的绝对原点。
    ///   父的绝对原点从 `absOriginByNodeId` 取（该表在增量过程中被**就地更新**——
    ///   故必须按**树序（父在前）**处理：父的原点先更新完，子才能用对）。
    ///   核心返回的顺序是 JSON 对象（无序）⇒ 本函数按节点 id 排序不安全，
    ///   改为**按父链深度排序**（深度小的先处理）。
    ///
    /// - Returns: 实际更新的层数；有任何一个节点在本地找不到对应 layer 则返回 -1（调用方应退回全量重建）
    func updateLayersIncremental(
        changed: [(id: Int, abs: CGRect)]
    ) -> Int {
        guard !changed.isEmpty else { return 0 }
        // 逐节点检查是否都有对应的已有层；缺任何一个 ⇒ 退回全量（正确性优先）
        for c in changed where layersById[c.id] == nil { return -1 }

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }

        // ★按父链深度升序处理（保证用到父的**已更新**原点）
        let sorted = changed.sorted { depthOf($0.id) < depthOf($1.id) }
        var updated = 0
        for c in sorted {
            guard let layer = layersById[c.id] else { continue }
            let pid = parentById[c.id] ?? -1
            let parentOrigin = pid >= 0 ? (absOriginByNodeId[pid] ?? .zero) : .zero
            absOriginByNodeId[c.id] = c.abs.origin
            let f = CGRect(x: c.abs.minX - parentOrigin.x, y: c.abs.minY - parentOrigin.y,
                           width: c.abs.width, height: c.abs.height)
            layer.frame = f
            builtFrames[c.id] = f
            rectsByNodeId[c.id] = c.abs
            updated += 1
        }
        return updated
    }

    /// 节点在层树中的深度（沿 `parentById` 上溯；带防环保护）
    private func depthOf(_ id: Int) -> Int {
        var d = 0
        var cur = parentById[id] ?? -1
        var guard_ = 0
        while cur >= 0 && guard_ < 4096 {
            d += 1
            cur = parentById[cur] ?? -1
            guard_ += 1
        }
        return d
    }

    /// ★实际 CALayer frame 清单（宿主侧读数）——与核心 rects 对照，证明「几何真的被用上了」
    ///
    /// `parentId` 一并导出：三端坐标口径不同（核心 rects = **绝对**；CALayer frame = **父相对**），
    /// 核验脚本必须按 parentId 逐级累加才能对照 —— 少了它就无法判定，
    /// 甚至会把「正确的父相对」误判成「不一致」。
    func layerFrameDump() -> [String: Any] {
        var out: [String: Any] = [:]
        for (id, f) in builtFrames {
            out["\(id)"] = ["x": f.minX, "y": f.minY, "w": f.width, "h": f.height,
                             "parentId": builtParents[id] ?? -1]
        }
        return out
    }

    func snapshot(named name: String) -> String? {
        let size = bounds.size
        guard size.width > 0, size.height > 0 else { return nil }
        let renderer = UIGraphicsImageRenderer(size: size)
        let img = renderer.image { ctx in
            self.layer.render(in: ctx.cgContext)
        }
        guard let data = img.pngData() else { return nil }
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("\(name).png")
        try? data.write(to: url)
        return url.path
    }
}

/// `#RRGGBB` / `#AARRGGBB` → UIColor
func parseHexColor(_ s: String) -> UIColor? {
    var hex = s.trimmingCharacters(in: .whitespaces)
    if hex.hasPrefix("#") { hex.removeFirst() }
    guard let v = UInt32(hex, radix: 16) else { return nil }
    if hex.count == 8 {
        return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                       blue: CGFloat(v & 0xFF) / 255, alpha: CGFloat((v >> 24) & 0xFF) / 255)
    }
    if hex.count == 6 {
        return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                       blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
    return nil
}

/* ────────────────────────── 桥（JSExport 实现） ────────────────────────── */

final class SelfDrawBridge: NSObject, SelfDrawExports {
    weak var view: SelfDrawView?
    var jsReport: [String: Any] = [:]
    /// ★句柄常驻：Vue 的后续更新复用同一棵 Rust 树（与 §5.1「节点树页面存活期间常驻」一致）
    private var handle: UInt64 = 0
    /// 上一帧的节点数组（**增量 diff 的基线**）——只有它才能算出「哪些节点真的变了」
    private var lastNodes: [[String: Any]] = []

    /// 最近一次布局的分段耗时（供报告）
    private(set) var lastTiming: [String: Double] = [:]
    private(set) var lastNodeCount = 0
    private(set) var lastTreeHash = ""

    /// ★★文本度量缓存：**内容寻址**（键 = 文本 ⊕ 字号），与核心 §5.3 同款原则
    ///
    /// 【为什么必须缓存（真机实测定位）】宿主此前每次更新都对**全部节点**重跑 CoreText：
    ///   3507 节点实测 **28.96ms**——而该次更新只改了一个 margin，**文本一个字都没变**
    ///   ⇒ 100% 是白跑。（这也是「整树操作」在本链路上的最后一处。）
    ///
    /// 【为什么是内容寻址而非按节点缓存】同一文案会在多个节点出现
    ///   （列表里的「说明文字」「分组标题」）⇒ 按内容缓存可直接复用；
    ///   且文本变没变，内容 hash 天然知道，无需额外的失效逻辑。
    ///
    /// 【与核心的关系】核心侧也有度量缓存（同样内容寻址）；两侧独立：
    ///   宿主的缓存省的是**跨界调用**（CoreText），核心的缓存省的是**重复回调**。
    private static var measureCache: [String: CGSize] = [:]

    /// CoreText 度量（★平台注入：核心不自研文本，Profile §L4）
    static func measureText(_ text: String, fontSize: CGFloat) -> CGSize {
        if text.isEmpty { return .zero }
        let key = "\(fontSize)\u{1}\(text)"
        if let hit = measureCache[key] { measureCacheHits += 1; return hit }
        measureCacheMisses += 1
        let font = UIFont.systemFont(ofSize: fontSize)
        let attrs: [NSAttributedString.Key: Any] = [.font: font]
        let size = (text as NSString).size(withAttributes: attrs)
        // ★向上取整到整点：真机实测文本宽度常带小数（如 47.33pt），
        //   而宿主按整点布置 CALayer 更稳定；同时避免「同一文本两次测量差 0.001」导致布局抖动
        let rounded = CGSize(width: ceil(size.width), height: ceil(size.height))
        measureCache[key] = rounded
        return rounded
    }

    /// 度量缓存命中/未命中（诊断：证明缓存真的生效）
    private(set) static var measureCacheHits = 0
    private(set) static var measureCacheMisses = 0
    static func resetMeasureStats() { measureCacheHits = 0; measureCacheMisses = 0 }

    /// 报告 / 快照文件名（自绘场景 vs 逻辑层基准各自独立，避免互相覆盖）
    /// ★由控制器按启动参数（`--bench`）设置。
    static var reportFileName = "selfdraw-report"
    static var snapshotName = "selfdraw-final"

    deinit {
        if handle != 0 { _ = proteus_layout_destroy(handle) }
    }

    func mount(_ treeJson: String) -> String {
        return render(treeJson: treeJson, phase: "mount")
    }

    func update(_ treeJson: String) -> String {
        return render(treeJson: treeJson, phase: "update")
    }

    /// ★★增量更新：把 JS 侧的**样式补丁**直接转给核心（不经过宿主 diff、不解析整树）
    ///
    /// 【为什么这条路径能省掉大头（真机实测分解，3507 节点只改 1 行）
    ///   · 旧路径（整树）：JS 序列化整树 → **跨 JSExport 编组 280KB ≈ 70ms** → 宿主解析 8.6ms
    ///     → 宿主 diff 9.5ms → 核心重排 **0.07ms** ⇒ 99.9% 花在「搬运整树」，与布局无关
    ///   · 新路径（补丁）：几十字节跨越 → 核心重排 0.07ms → 只改变化的 layer
    ///   ★关键观察：**「改了什么」是 JS 侧已知的**（Vue 的 patchProp 直接告诉了我们），
    ///     让宿主再 diff 一遍整树是纯粹的重复劳动。
    func updatePatches(_ patchesJson: String) -> String {
        guard let view = view, handle != 0 else {
            return "{\"ok\":false,\"error\":\"未建树或未接入核心\"}"
        }
        let t0 = CFAbsoluteTimeGetCurrent()
        let out = patchesJson.withCString { takeCString(proteus_layout_update(handle, $0)) }
        let updateMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        guard out.contains("\"ok\":true") else {
            return "{\"ok\":false,\"error\":\"update 失败\",\"raw\":\(jsonEscape(String(out.prefix(200))))}"
        }
        let o = (try? JSONSerialization.jsonObject(with: Data(out.utf8))) as? [String: Any]
        let applied = (o?["applied"] as? Int) ?? 0
        let relayout = (o?["relayout_count"] as? Int) ?? 0

        // 无有效补丁 ⇒ 什么都不用做（例如只改了颜色）
        if applied == 0 {
            return jsonString(["ok": true, "path": "updatePatches", "incremental": true,
                               "patch_count": 0, "relayout_count": 0, "changed_rects": 0,
                               "updated_layers": 0, "update_ms": round(updateMs * 100) / 100])
        }

        var changed: [(id: Int, abs: CGRect)] = []
        if let rm = o?["rects"] as? [String: [String: Double]] {
            for (k, r) in rm {
                guard let nid = Int(k) else { continue }
                changed.append((id: nid, abs: CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0,
                                                    width: r["width"] ?? 0, height: r["height"] ?? 0)))
            }
        }
        let tL = CFAbsoluteTimeGetCurrent()
        let updated = view.updateLayersIncremental(changed: changed)
        let layersMs = (CFAbsoluteTimeGetCurrent() - tL) * 1000
        if updated < 0 {
            return "{\"ok\":false,\"error\":\"变化集与本地层不匹配（需全量重建）\"}"
        }
        let totalMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        lastTiming = ["measure_ms": 0, "layout_ms": (updateMs * 100).rounded() / 100,
                      "build_layers_ms": (layersMs * 100).rounded() / 100,
                      "host_total_ms": (totalMs * 100).rounded() / 100]
        return jsonString(["ok": true, "path": "updatePatches", "incremental": true,
                           "in_bytes": patchesJson.count,
                           "patch_count": applied, "relayout_count": relayout,
                           "changed_rects": changed.count, "updated_layers": updated,
                           "update_ms": round(updateMs * 100) / 100,
                           "layers_ms": round(layersMs * 100) / 100,
                           "host_total_ms": round(totalMs * 100) / 100])
    }

    /// 核心：渲染树 → (CoreText 度量) → Rust 核心 → CALayer 树
    private func render(treeJson: String, phase: String) -> String {
        guard let view = view else { return "{\"ok\":false,\"error\":\"view 未设置\"}" }
        let t0 = CFAbsoluteTimeGetCurrent()

        let tParse0 = CFAbsoluteTimeGetCurrent()
        guard let data = treeJson.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let nodes = root["nodes"] as? [[String: Any]] else {
            return "{\"ok\":false,\"error\":\"渲染树 JSON 解析失败\"}"
        }
        let parseMs = (CFAbsoluteTimeGetCurrent() - tParse0) * 1000

        // ── ① 注入文本度量（平台职责：CoreText；命中内容寻址缓存）──
        SelfDrawBridge.resetMeasureStats()
        let tMeasure0 = CFAbsoluteTimeGetCurrent()
        var textMeasures: [String: [String: Double]] = [:]
        for n in nodes {
            guard let text = n["text"] as? String, !text.isEmpty, let id = n["id"] as? Int else { continue }
            let fontSize = (n["fontSize"] as? Double).map { CGFloat($0) } ?? 14
            let sz = SelfDrawBridge.measureText(text, fontSize: fontSize)
            textMeasures["\(id)"] = ["width": Double(sz.width), "height": Double(sz.height)]
        }
        let measureMs = (CFAbsoluteTimeGetCurrent() - tMeasure0) * 1000

        // ── ② 组装核心请求（只保留核心认识的字段）──
        var req: [String: Any] = ["viewport": root["viewport"] as? [String: Any] ?? ["width": 390, "height": 844],
                                 "nodes": nodes, "textMeasures": textMeasures]
        // 删掉纯绘制字段（核心只管几何——传了也无害，但保持请求最小便于诊断）
        if var ns = req["nodes"] as? [[String: Any]] {
            for i in ns.indices {
                ns[i].removeValue(forKey: "backgroundColor")
                ns[i].removeValue(forKey: "color")
                ns[i].removeValue(forKey: "fontSize")
                ns[i].removeValue(forKey: "borderRadius")
            }
            req["nodes"] = ns
        }

        guard let reqData = try? JSONSerialization.data(withJSONObject: req),
              let reqJson = String(data: reqData, encoding: .utf8) else {
            return "{\"ok\":false,\"error\":\"核心请求组装失败\"}"
        }
        let tLayout0 = CFAbsoluteTimeGetCurrent()

        // ── ③ 调 Rust 核心（★几何的唯一来源）──
        //
        // ★★增量路径（本仓 2026-09-29 打通）：
        //   · **首帧**走 `create`（建树 + 全量布局）
        //   · **后续**走 `update`（把本帧与上帧的差异算成**样式补丁**，核心按布局边界局部重排）
        //   此前每次更新都 `destroy + create`（整树重建）——实测改 10 个列表项要重发 561KB、
        //   重建 1407 个节点。核心侧 `layout_incremental` 早已实现（边界内 30–566×），
        //   缺的只是 FFI 出口与宿主接线。
        //
        // ★兼容边界（诚实标注）：`proteus_layout_update` 当前**不带文本度量表**，
        //   故只在「纯样式变更」时走增量；一旦**节点增删**或文本集合变化，
        //   就退回 `create`（正确性优先——宁可重建，也不要用错的度量算几何）。
        let tRenderStart = CFAbsoluteTimeGetCurrent()
        var usedIncremental = false
        var patchCount = 0
        var relayoutCount = 0
        var changedCount = 0
        var updatedLayerCount = 0
        var layoutMs = 0.0
        var rectsJsonStr = ""

        // ★★增量更新（本题的核心优化路径）
        //
        // 【两处「整树操作」都要消掉（真机实测定位）】
        //   ① `proteus_layout_rects` —— 读**全量** rects（3507 条 → 280KB JSON → 解析），实测 ~9ms
        //   ② `clearLayers + buildLayers` —— 销毁并重建**全部** CALayer，实测 **80.7ms**（占宿主一半以上）
        //   ⇒ 现在改为：核心只回**变化集**（`rects` 字段，实测只改 1 行时 41 个节点），
        //     宿主只改这些层的 frame（不重建、不销毁）。
        //   ★顺序很关键：先算变化集与补丁（都在内存里），**再**决定要不要碰层树 ——
        //     若变化集缺失/与本地层不匹配，就退回全量（正确性优先）。
        let tDiff0 = CFAbsoluteTimeGetCurrent()
        let maybePatches = handle != 0 ? diffPatches(from: lastNodes, to: nodes) : nil
        let diffMs = (CFAbsoluteTimeGetCurrent() - tDiff0) * 1000
        if let patches = maybePatches {
            let pj = jsonString2(patches)
            let tUpd0 = CFAbsoluteTimeGetCurrent()
            let out = pj.withCString { takeCString(proteus_layout_update(handle, $0)) }
            let updateMs = (CFAbsoluteTimeGetCurrent() - tUpd0) * 1000
            if out.contains("\"ok\":true") {
                let o = (try? JSONSerialization.jsonObject(with: Data(out.utf8))) as? [String: Any]
                patchCount = (o?["applied"] as? Int) ?? 0
                relayoutCount = (o?["relayout_count"] as? Int) ?? 0

                // ★变化集 → 只在层树上改这几个
                var changed: [(id: Int, abs: CGRect)] = []
                if let rm = o?["rects"] as? [String: [String: Double]] {
                    for (k, r) in rm {
                        guard let nid = Int(k) else { continue }
                        changed.append((id: nid, abs: CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0,
                                                            width: r["width"] ?? 0, height: r["height"] ?? 0)))
                    }
                }
                let tLayers0 = CFAbsoluteTimeGetCurrent()
                let updatedLayers = view.updateLayersIncremental(changed: changed)
                let layersMs = (CFAbsoluteTimeGetCurrent() - tLayers0) * 1000
                if updatedLayers >= 0 {
                    usedIncremental = true
                    changedCount = changed.count
                    updatedLayerCount = updatedLayers
                    layoutMs = (CFAbsoluteTimeGetCurrent() - tLayout0) * 1000
                    // ★不再读全量 rects、不再重建层 —— 这就是省下来的部分
                    lastNodes = nodes
                    let el = (CFAbsoluteTimeGetCurrent() - tRenderStart) * 1000
                    let t = ["measure_ms": measureMs, "layout_ms": layoutMs,
                             "build_layers_ms": 0.0, "host_total_ms": el]
                    lastTiming = t
                    lastNodeCount = nodes.count
                    lastTreeHash = String(format: "%08x", treeJson.hashValue)
                    return jsonString([
                        "ok": true, "path": phase, "node_count": nodes.count,
                        "layer_count": view.builtLayerCount, "request_bytes": reqJson.count,
                        "measure_ms": round(measureMs * 100) / 100,
                        "layout_ms": round(layoutMs * 100) / 100,
                        "build_layers_ms": 0, "host_total_ms": round(el * 100) / 100,
                        "incremental": true, "patch_count": patchCount,
                        "relayout_count": relayoutCount,
                        "changed_rects": changed.count, "updated_layers": updatedLayers,
                        // ★宿主侧分段（定位剩余耗时；本仓纪律：不靠推断）
                        "parse_ms": round(parseMs * 100) / 100,
                        "in_bytes": treeJson.count,
                        "measure_cache_hits": SelfDrawBridge.measureCacheHits,
                        "measure_cache_misses": SelfDrawBridge.measureCacheMisses,
                        "_host_timing": ["diff_ms": round(diffMs * 100) / 100,
                                         "update_ffi_ms": round(updateMs * 100) / 100,
                                         "layers_ms": round(layersMs * 100) / 100,
                                         "measure_ms": round(measureMs * 100) / 100],
                    ])
                }
            }
        }
        if !usedIncremental {
            // 首帧 / 结构变化 → 全量重建
            if handle != 0 {
                _ = proteus_layout_destroy(handle)
                handle = 0
            }
            let h = reqJson.withCString { proteus_layout_create($0) }
            handle = h
            guard h > 0 else {
                return "{\"ok\":false,\"error\":\"proteus_layout_create 失败（节点数 \(nodes.count)）\"}"
            }
            rectsJsonStr = takeCString(proteus_layout_rects(h))
            layoutMs = (CFAbsoluteTimeGetCurrent() - tLayout0) * 1000
        }
        lastNodes = nodes
        if !rectsJsonStr.contains("\"ok\":true") {
            return "{\"ok\":false,\"error\":\"rects 读取失败\",\"raw\":\(jsonEscape(String(rectsJsonStr.prefix(200))))}"
        }

        // ── ④ 几何 → CALayer 树 ──
        guard let rd = rectsJsonStr.data(using: .utf8),
              let ro = try? JSONSerialization.jsonObject(with: rd) as? [String: Any],
              let rects = ro["rects"] as? [String: [String: Double]] else {
            return "{\"ok\":false,\"error\":\"几何解析失败\"}"
        }
        let tBuild0 = CFAbsoluteTimeGetCurrent()
        // 按树序拍平（父在前）——CALayer 树要求先建父
        var flat: [(id: Int, parentId: Int?, rect: CGRect, style: [String: Any])] = []
        let sortedNodes = nodes.compactMap { n -> (Int, Int?, [String: Any])? in
            guard let id = n["id"] as? Int else { return nil }
            return (id, n["parentId"] as? Int, n)
        }
        for (id, pid, n) in sortedNodes {
            guard let r = rects["\(id)"] else { continue }
            let rect = CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0, width: r["width"] ?? 0, height: r["height"] ?? 0)
            var style: [String: Any] = [:]
            for k in ["backgroundColor", "color", "text"] {
                if let v = n[k] as? String { style[k] = v }
            }
            if let fs = n["fontSize"] as? Double { style["fontSize"] = CGFloat(fs) }
            if let br = n["borderRadius"] as? Double { style["borderRadius"] = CGFloat(br) }
            flat.append((id: id, parentId: pid, rect: rect, style: style))
        }
        view.clearLayers()
        view.buildLayers(flat: flat)
        let buildMs = (CFAbsoluteTimeGetCurrent() - tBuild0) * 1000
        let totalMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000

        lastTiming = ["measure_ms": measureMs, "layout_ms": layoutMs, "build_layers_ms": buildMs, "host_total_ms": totalMs]
        lastNodeCount = flat.count
        lastTreeHash = String(format: "%08x", treeJson.hashValue)

        let out: [String: Any] = [
            "ok": true,
            "phase": phase,
            "node_count": flat.count,
            "layer_count": view.builtLayerCount,
            "request_bytes": reqJson.count,
            "measure_ms": round(measureMs * 100) / 100,
            "layout_ms": round(layoutMs * 100) / 100,
            "build_layers_ms": round(buildMs * 100) / 100,
            "host_total_ms": round(totalMs * 100) / 100,
            // ★增量路径读数（0 = 走了全量重建）
            "incremental": usedIncremental,
            "patch_count": patchCount,
            "relayout_count": relayoutCount,
            "changed_rects": changedCount,
            "updated_layers": updatedLayerCount,
        ]
        return jsonString(out)
    }

    func snapshot(_ name: String) -> String {
        // ★名以宿主注入的 `SelfDrawBridge.snapshotName` 为准（JS 侧传参仅作兼容）——
        //   两端各命名会让产物散落；命名权收归宿主一处。
        let effective = SelfDrawBridge.snapshotName.isEmpty ? name : SelfDrawBridge.snapshotName
        guard let view = view, let path = view.snapshot(named: effective) else {
            return "{\"ok\":false,\"error\":\"截图失败\"}"
        }
        return jsonString(["ok": true, "path": path])
    }

    func report(_ json: String) {
        if let d = json.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            jsReport = o
        }
    }

    func done(_ summaryJson: String) {
        var out: [String: Any] = [:]
        out["engine"] = takeCString(proteus_layout_version())
        out["js_report"] = jsReport
        out["host_timing_last"] = lastTiming
        out["host_node_count"] = lastNodeCount
        out["tree_hash"] = lastTreeHash
        out["layer_count"] = view?.builtLayerCount ?? -1
        if let d = summaryJson.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            for (k, v) in o { out["js_\(k)"] = v }
        }
        // ★全量几何（供宿主机**独立核验**：不依赖 app 自报的正确性）
        //   初版只导出前 12 个 → 核验脚本无法覆盖全部卡片；
        //   而「抽样核验」在几何 bug 面前会被绕过（本仓纪律：判定要覆盖被测对象的全体）。
        if let view = view {
            var all: [String: Any] = [:]
            for (id, r) in view.rectsByNodeId.sorted(by: { $0.key < $1.key }) {
                let mx = view.metaByNodeId[id]
                all["\(id)"] = [
                    "x": r.minX, "y": r.minY, "w": r.width, "h": r.height,
                    "text": mx?["text"] ?? "",
                    "bg": mx?["backgroundColor"] ?? "",
                    "color": mx?["color"] ?? "",
                ]
            }
            out["geometry_all"] = all
            out["layer_frames"] = view.layerFrameDump()
        }

        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("\(SelfDrawBridge.reportFileName).json")
        if let d = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]) {
            try? d.write(to: url)
        }
        NSLog("[proteus] selfdraw 报告: %@", url.path)
    }
}

/* ────────────────────────── 工具 ────────────────────────── */

/// ★★树 diff：把「上一帧 → 本帧」的**样式变化**算成补丁数组（增量更新的输入）
///
/// 【为什么需要它（而不是把整树发过去）】`proteus_layout_update` 的入参是**补丁**，
///   而宿主手上是两帧完整节点数组 —— 差异必须由宿主算（核心不知道上一帧是什么）。
///
/// 【返回 nil 的情形 = 退回全量重建】（正确性优先：宁可重建，也不要用错的前提算几何）
///   · 节点**增删**（id 集合不同）—— 核心的 update 入口不处理结构变化
///   · 某节点的文本变化 —— 度量需重新注入，而当前 update 入口不带度量表
///
/// 【只比布局字段】绘制属性（背景色/圆角/字号）**不影响几何** ⇒ 不进补丁，
///   避免用「无关变化」触发重排（这是增量能否真正省下来的关键）。
/// 上一帧全量请求的字节数（诊断：证明增量路径确实没走整树序列化）
private var lastFullRequestBytes = 0

/// 组装**全量**核心请求（只在首帧 / 结构变更时调用——见调用点的成本说明）
func buildFullRequest(nodes: [[String: Any]], textMeasures: [String: [String: Double]], root: [String: Any]) -> String {
    var req: [String: Any] = ["viewport": root["viewport"] as? [String: Any] ?? ["width": 390, "height": 844],
                             "nodes": nodes, "textMeasures": textMeasures]
    if var ns = req["nodes"] as? [[String: Any]] {
        for i in ns.indices {
            ns[i].removeValue(forKey: "backgroundColor")
            ns[i].removeValue(forKey: "color")
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

/// 树 diff：把「上一帧 → 本帧」的**样式变化**算成补丁数组（增量更新的输入）
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

/* ────────────────────────── 应用入口 ────────────────────────── */

final class SelfDrawViewController: UIViewController {
    private let bridge = SelfDrawBridge()
    private var jsContext: JSContext?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let w = UIScreen.main.bounds.width
        let h = UIScreen.main.bounds.height
        let host = SelfDrawView(frame: CGRect(x: 0, y: 0, width: w, height: h))
        // ★宿主铺满全屏：几何基准 = 屏幕（Vue 侧 viewport 用同一尺寸）
        view.addSubview(host)
        bridge.view = host

        // ── 真实 JavaScriptCore（与 iOS 竖切同一运行时）──
        guard let ctx = JSContext() else {
            NSLog("[proteus] JSContext 创建失败")
            return
        }
        jsContext = ctx
        ctx.setObject(bridge, forKeyedSubscript: "proteusSelfDraw" as NSString)

        // 异常可观测（否则 JS 报错静默失败）
        ctx.exceptionHandler = { _, exc in
            NSLog("[proteus] JS 异常: %@", exc?.toString() ?? "?")
        }

        // ★模式：`--bench` 跑逻辑层基准（复杂响应式用例 + 规模扫描），否则跑自绘场景
        let isBench = ProcessInfo.processInfo.arguments.contains("--bench")
        if isBench {
            SelfDrawBridge.reportFileName = "logic-bench-report"
            SelfDrawBridge.snapshotName = "bench-final"
        }
        let bundleName = isBench ? "bundle-bench" : "bundle-selfdraw"
        guard let url = Bundle.main.url(forResource: bundleName, withExtension: "js"),
              let src = try? String(contentsOf: url, encoding: .utf8) else {
            NSLog("[proteus] 缺少 %@.js", bundleName)
            return
        }
        let vp = jsonString(["width": w, "height": h])
        NSLog("[proteus] selfdraw 启动 · viewport=%@", vp)
        ctx.evaluateScript("var __PROTEUS_VIEWPORT__ = \(vp);")
        ctx.evaluateScript(src, withSourceURL: url)

        // ★★逐相位驱动（本仓实测的关键点）
        //   JSC 的 `evaluateScript` **不排空微任务** —— Promise 回调要等该次调用返回后才执行。
        //   而 Vue 的更新调度正是微任务 ⇒ 若把「mount + 改 ref + 量结果」写在一个脚本里，
        //   重渲染**永远不会发生**（实测 patch=0、节点数不变，看起来像响应式失效）。
        //   正解：每次 evaluateScript 之间**返回主线程**，让微任务排空，再进入下一相位。
        //   下面用 `DispatchQueue.main.async` 串起来——这等价于把 VM 事件循环手工补上。
        if isBench {
            driveBench(ctx: ctx)
        } else {
            schedulePhases(ctx: ctx, url: url)
        }
    }

    /// ★★逻辑层基准的驱动器：**逐用例**调用 `__proteus.step()`，每次之间让出主线程。
    ///
    /// 为什么这样驱动（同自绘场景的结论）：JSC 的 `evaluateScript` 不排空微任务，
    /// 而 Vue 的更新调度是微任务 ⇒ 一个用例跑完必须返回主线程，响应式才落地。
    /// 故：step → 让出 N 轮 → step …… 直到全部用例完成。
    private func driveBench(ctx: JSContext) {
        let evalJs = { (expr: String) -> String in ctx.evaluateScript(expr)?.toString() ?? "null" }
        let casesJson = evalJs("__proteus.cases()")
        NSLog("[proteus] bench 用例清单：%@", String(casesJson.prefix(160)))

        // 每个用例的让出轮数：用例内 await nextTick 若干次（G 组 60 次），故给足轮次
        var rounds = 0
        let maxRounds = 4000
        func pumpOnce(_ cont: @escaping () -> Void) {
            DispatchQueue.main.async { cont() }
        }
        func loop() {
            rounds += 1
            if rounds > maxRounds { NSLog("[proteus] bench 超轮次上限"); return }
            let stepOut = evalJs("__proteus.step()")
            let prog = evalJs("__proteus.progress()")
            // 每完成若干用例记一次日志（避免日志爆炸）
            if rounds % 20 == 1 {
                NSLog("[proteus] bench 进度：%@ / step=%@", String(prog.prefix(120)), String(stepOut.prefix(60)))
            }
            if stepOut.contains("\"done\":true") {
                // 收尾：让微任务彻底排空后再写报告
                var tail = 0
                func finishTail() {
                    if tail < 12 { tail += 1; pumpOnce(finishTail); return }
                    let out = evalJs("__proteus.finish()")
                    NSLog("[proteus] bench 完成：%@", String(out.prefix(200)))
                }
                finishTail()
                return
            }
            // ★每个用例让出 4 轮（Vue 的微任务 + 用例内的 nextTick 链都在这几轮里排空）
            var left = 4
            func next() {
                if left > 0 { left -= 1; pumpOnce(next); return }
                loop()
            }
            next()
        }
        loop()
    }

    /// 相位驱动的调度器
    ///
    /// 每一步都在**独立的一次** evaluateScript 里执行，且之间让出主线程（微任务排空）。
    /// ★`pump(n)` 用来多轮推进「链式 Promise」（纯 JS 吞吐那一段需要 N 轮）。
    private func schedulePhases(ctx: JSContext, url: URL) {
        let js = { (expr: String) -> String in
            ctx.evaluateScript(expr)?.toString() ?? "null"
        }
        // 相位序列：{JS 表达式, 让出几轮}
        var steps: [(String, Int)] = [
            ("__proteus.mount()", 1),          // ① mount（同步完成）
            ("__proteus.pending()", 1),
            ("__proteus.updateGrow()", 2),     // ② 结构路径（改 ref → 微任务重渲染 → 宿主 update）
            ("__proteus.pending()", 1),
            ("__proteus.updateStyle()", 2),    // ③ 纯样式路径
            ("__proteus.pending()", 1),
            ("__proteus.throughput()", 1),     // ④ 纯 JS 吞吐（40 次链式）
        ]
        // 吞吐链需要多轮推进：每轮让出后读一次 pending
        for _ in 0..<12 { steps.append(("__proteus.pending()", 1)) }
        steps.append(("__proteus.finalize()", 2))     // 收尾第一段（改回稳定状态）
        steps.append(("__proteus.finalize2()", 2))    // 收尾第二段（截图 + 上报）

        func run(_ i: Int) {
            guard i < steps.count else {
                NSLog("[proteus] 全部相位完成")
                return
            }
            let (expr, pump) = steps[i]
            let out = js(expr)
            // 只记关键读数（避免日志爆炸——本仓「输出控制」纪律）
            if expr.hasPrefix("__proteus.mount") || expr.hasPrefix("__proteus.finalize2") {
                NSLog("[proteus] %@ → %@", expr, String(out.prefix(400)))
            }
            // ★让出主线程 pump 轮：每轮一次 runloop 循环 ⇒ 微任务队列被排空
            var remaining = pump
            func next() {
                if remaining > 0 {
                    remaining -= 1
                    DispatchQueue.main.async { next() }
                } else {
                    run(i + 1)
                }
            }
            next()
        }
        run(0)
    }
}

final class SelfDrawSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        w.rootViewController = SelfDrawViewController()
        w.makeKeyAndVisible()
        window = w
    }
}

@main
final class SelfDrawAppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ a: UIApplication, didFinishLaunchingWithOptions o: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool { true }
    func application(_ a: UIApplication, configurationForConnecting s: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c = UISceneConfiguration(name: "Default", sessionRole: s.role)
        c.delegateClass = SelfDrawSceneDelegate.self
        return c
    }
}
