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
// ★mach_absolute_time（高分辨率单调时钟）——测量用，见 SelfDrawBridge.nowUs()
import Darwin

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

/// ★★结构变更（插入/摘除子树）——「增删行」的增量路径（此前只能重发整棵树）
@_silgen_name("proteus_layout_splice")
func proteus_layout_splice(_ handle: UInt64, _ spliceJson: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>

/// ★★**命中测试**（核心算：target + 冒泡链 chain）——触摸派发的依据
@_silgen_name("proteus_layout_hit_test")
func proteus_layout_hit_test(_ handle: UInt64, _ x: Float, _ y: Float) -> UnsafeMutablePointer<CChar>

/// ★★注入/更新文本度量（宿主度量后推入；不触发重排）
@_silgen_name("proteus_layout_set_text_measures")
func proteus_layout_set_text_measures(_ handle: UInt64, _ measuresJson: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
/// ★Vapor IR V3：二进制指令流入口（字节指针 + 长度）
@_silgen_name("proteus_layout_apply_ops")
func proteus_layout_apply_ops(_ handle: UInt64, _ ptr: UnsafePointer<UInt8>, _ len: UInt32) -> UnsafeMutablePointer<CChar>
/// ★Vapor IR V4：**不带 rects 的 apply**（二进制通道场景——省掉 JSON 序列化与宿主解析）
@_silgen_name("proteus_layout_apply_ops_norects")
func proteus_layout_apply_ops_norects(_ handle: UInt64, _ ptr: UnsafePointer<UInt8>, _ len: UInt32) -> UnsafeMutablePointer<CChar>
/// ★Vapor IR V4：变化集二进制返回（整流矩形）
@_silgen_name("proteus_layout_rects_bin")
func proteus_layout_rects_bin(_ handle: UInt64, _ outLen: UnsafeMutablePointer<UInt32>) -> UnsafeMutablePointer<UInt8>
/// 释放上面返回值
@_silgen_name("proteus_rects_free")
func proteus_rects_free(_ ptr: UnsafeMutablePointer<UInt8>, _ len: UInt32)

func takeCString(_ ptr: UnsafeMutablePointer<CChar>) -> String {
    defer { proteus_layout_free_string(ptr) }
    return String(cString: ptr)
}

/// 当前进程的**实际内存占用**（MB）
///
/// ★用 `phys_footprint`：这是 iOS 上最贴近「真实占用」的口径（含 dirty + compressed），
///   也是系统 OOM 杀进程时看的那个数。加压测试要给出「内存天花板」，不能用估算值。
func physFootprintMB() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
    }
    guard kr == KERN_SUCCESS else { return -1 }
    return Double(info.phys_footprint) / 1024.0 / 1024.0
}

/* ────────────────────────── JS ↔ 宿主 协议 ────────────────────────── */

@objc protocol SelfDrawExports: JSExport {
    /// 首次挂载：渲染树 JSON → 建 Rust 树 + CALayer 树；返回耗时分解
    func mount(_ treeJson: String) -> String
    /// 更新（Vue diff 后重发整树——★**保留给结构变化**用：增删节点时必须整树）
    func update(_ treeJson: String) -> String
    /// ★★**增量更新**：只发改动过的节点的样式补丁（跨边界字节数从 280KB 降到几十字节）
    func updatePatches(_ patchesJson: String) -> String
    /// ★★**绘制补丁**（颜色/圆角/字重/字号/透明度）——**几何之外的第二条通道**
    ///
    /// 入参：`[{"id":N,"paint":{...}}]`（`paint` 是**完整快照**，缺省键为 `null` ⇒ 清除）。
    /// 与 `updatePatches`（布局，经核心重排）**互不干涉**：本入口**不碰核心**。
    func paintPatches(_ patchesJson: String) -> String
    /// ★★**结构变更（增删行）**：`{removes:[id], inserts:[{parentId,nodes:[...]}], textMeasures:{}}`
    ///
    /// 【为什么必须有（本仓实测的功能缺口）】此前增删行只能**重发整棵树**
    ///   （真机 S5：500→600 项 230ms，几乎全是搬运成本）。本入口把「结构变了什么」
    ///   直接交给核心（`proteus_layout_splice`），宿主只增删对应层的子树。
    ///   ★只支持**追加**（核心侧架构限制：中间插入会显式拒绝并提示重发整棵树——
    ///     本仓纪律「宁可拒绝不可静默错序」）。
    func splice(_ spliceJson: String) -> String
    /// ★★**Vapor IR V3：二进制指令流入口**（V1 编码 → Rust 解码 → 应用 → 多范围增量重排）
    ///
    /// 【为什么另开一个入口而不是复用 updatePatches】
    ///   · `updatePatches` 收 **JSON**（每帧跨边界要文本解析——本仓实测占布局耗时 95%+）
    ///   · 本入口收 **二进制指令流**（顺序读 + 定长字段，免解析）
    ///   两条路径并存：JSON 保持兼容，二进制给 Vapor 用。
    ///   入参 `opsJson` 是**字节数组的 JSON 表示**（JSExport 对 ArrayBuffer 支持不稳，
    ///   而指令流本就极小——实测单节点更新 45 字节，base64/数组序列化成本可忽略）。
    func applyOps(_ opsBytesJson: String) -> String
    /// ★★**高分辨率单调时钟**（微秒，十进制字符串）——供 JS 侧做可靠计时
    ///
    /// 【为什么必须由宿主提供（本仓实测的第六个测量装置缺陷）】
    ///   JSC 的 `Date.now()` 是**粗粒度缓存时钟**：真机实测**连续 512 次读一次都不前进**
    ///   ⇒ 用它测出的 "p50 = 0ms / p95 = 1ms" 全是**分辨率假象**，不是成本。
    ///   桌面 JSC 有 `performance.now()`，**真机 JSC 没有**（实测 `typeof performance === 'undefined'`）。
    ///   ⇒ 唯一可靠的路径：宿主用 `mach_absolute_time`（**单调**，不受墙钟调整影响）计时，
    ///     以字符串返回微秒值（字符串而非 Double：避免 JS Number 的 53 位精度在
    ///     大时间戳上损失亚微秒分辨率）。
    func nowUs() -> String
    /// ★V4：滚动视图（dx/dy 像素）——触发 layoutSubviews → 补刷已滚入的待更新层
    ///
    /// 【为什么放在**容器视图**上而不是滚动视图上】本自绘层树不用 UIScrollView
    ///   （滚动由 native-host 跟随 + 根层 bounds 平移表达）⇒ 用 bounds.origin 平移即可触发
    ///   `layoutSubviews`，与真实滚动同一条代码路径。
    func scrollBy(_ dx: Double, _ dy: Double) -> String
    /// ★V4：待补刷统计（诊断 + 滚动用例的判据）
    func pendingStats() -> String
    /// ★★V5：**批量像素采样**（渲染一次读多点）——像素级验证的判据
    ///
    /// 【为什么需要（本仓反复标注的缺口）】此前所有验证都停在"**几何**算对了"
    ///   （rect/坐标/不变式），而"**屏幕上真的画对了**"从未验证。
    ///   延迟补刷（只更可见层）的正确性尤其需要它：几何对 ≠ 屏幕对。
    ///
    /// 入参：`[{"x":10,"y":100}, ...]`（屏幕坐标，逻辑点）
    /// 出参：`{"ok":true,"pixels":["#RRGGBB", ...]}`（与入参同序）
    func samplePixels(_ json: String) -> String
    /// ★★V9：**注入一次 tap**（走与真实触摸**同一条链**：`emitGesture` → 核心命中 → JS 派发）
    ///
    /// 【为什么需要它（诚实边界）】`touchesBegan/Ended` 是 UIKit 的 UI 事件，**JS 无法伪造**
    ///   ⇒ 若只靠真实触摸，设备用例无法自动验证（需人手点）。
    ///   本入口**绕过 UITouch**但**复用 `emitGesture`** ⇒ 覆盖「命中 → 派发」这两环；
    ///   唯一未覆盖的是「UITouch → 内容坐标换算」（那部分靠 `touchesEnded` 的 tap 时序判定，
    ///   需人手或 XCUITest 覆盖）。
    /// - Parameters: x/y 为**内容坐标**（与核心 rects 同口径）
    func tapAt(_ x: Double, _ y: Double) -> String
    /// ★V9：手势统计（命中/未命中/错误——证明"触摸真的走到了核心"）
    func gestureStatsJson() -> String
    /// ★★V4 A/B 开关：'v4'（默认：二进制返回 + 只更可见层）| 'v3'（旧路径：JSON 返回 + 全部层）
    ///
    /// 【为什么要有它（诚实对照）】优化前后若用**不同的基准树**测，比较无意义
    ///   （本仓实测：类B 基准树因缺 flexShrink 而"没有几何变化"，旧读数与优化后不可比）。
    ///   ⇒ 提供运行时开关，**同一棵树、同一用例**里分别测两条路径。
    func setOptMode(_ mode: String) -> String
    /// 截图落盘（验证「屏幕上真的画出来了」）
    func snapshot(_ name: String) -> String
    /// JS 侧自报读数（Vue mount / update 耗时 + patch 次数）
    func report(_ json: String)
    /// 链路完成（宿主据此落盘报告）
    func done(_ summaryJson: String)
}

/* ────────────────────────── 宿主（自绘） ────────────────────────── */

/// bench 完成标志（由 JS 链尾的 `done()` 置位；宿主据此收尾）
enum BenchDone { static var flag = false }

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
    /// 节点 id → 层深度（建层时预计算，供增量更新的父序排序 O(1) 查询）
    private var depthById: [Int: Int] = [:]
    /// 节点 id → 父 id（增量更新时判断父子关系用）
    private var parentById: [Int: Int] = [:]
    /// 节点 id → **子 id 列表**（结构变更的层维护用）
    ///
    /// 【为什么需要（结构增量的必要簿记）】`layer.sublayers` 虽是现成的，但结构变更时：
    ///   ① 摘除要按**节点 id** 递归清理各字典（`layersById`/`depthById`/…）——
    ///      直接从 CALayer 反查 id 需要反查表，绕一圈且易漏；
    ///   ② 插入落点需要知道"父的当前子列表"以判定末尾位置。
    ///   ⇒ 与 `layersById` 同处维护一份 **id 级的子列表**（O(1) 增删）。
    ///   ⚠ 纪律：**本表与 CALayer 树必须同步更新**（两者是同一事实的两份视图，
    ///     分叉 ⇒ 层树与 id 簿记不一致 ⇒ 后续所有增量操作都在错的基础上做）。
    private var childrenById: [Int: [Int]] = [:]
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
        childrenById.removeAll(keepingCapacity: true)
        builtFrames.removeAll(keepingCapacity: true)
        builtParents.removeAll(keepingCapacity: true)
        // ★建新树 ⇒ 滚动偏移归零（见 resetContentOffset 的说明：视图状态会跨用例泄漏）
        resetContentOffset()
        CATransaction.commit()
    }

    /// 建层：按 style 造一个层（文本 ⇒ CATextLayer；否则 CALayer）
    ///
    /// 【为什么抽成方法（本仓纪律：同一语义一处实现）】全量重建（`buildLayers`）与
    ///   **结构增量**（`insertLayers`）都要造层——两份实现必然分叉 ⇒
    ///   新插入的行会与全量树**外观不一致**（静默错，且只有像素比对能发现）。
    private func makeLayer(style: [String: Any]) -> CALayer {
        let text = style["text"] as? String
        let fontSize = style["fontSize"] as? CGFloat
        if let text = text, !text.isEmpty {
            // 文本叶子 → CATextLayer（GPU 加速；不创建 UIView，也不自栅格化）
            let tl = CATextLayer()
            tl.string = text
            let fs = fontSize ?? 14
            let fw = (style["fontWeight"] as? CGFloat) ?? 400
            // ★字体由统一构造器给出（与度量同源——见 `font(size:weight:)` 注释）
            let ufont = SelfDrawBridge.font(size: fs, weight: fw)
            tl.font = CGFont(ufont.fontName as CFString)
            tl.fontSize = fs
            tl.foregroundColor = (style["color"] as? String).flatMap(parseHexColor)?.cgColor ?? UIColor.white.cgColor
            tl.alignmentMode = .left
            tl.truncationMode = .end
            // ★contentsScale 必须显式设置：否则 Retina 上文本模糊（CATextLayer 不继承自动缩放）
            tl.contentsScale = UIScreen.main.scale
            tl.isWrapped = false
            return tl
        }
        let layer = CALayer()
        if let bg = (style["backgroundColor"] as? String).flatMap(parseHexColor) {
            layer.backgroundColor = bg.cgColor
        }
        if let r = style["borderRadius"] as? CGFloat, r > 0 {
            layer.cornerRadius = r
            layer.masksToBounds = true
        }
        return layer
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
            let layer = makeLayer(style: item.style)
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
            if let pid = item.parentId {
                childrenById[pid, default: []].append(item.id)
            }
            if let pid = item.parentId, let parent = byId[pid] {
                parent.addSublayer(layer)
            } else {
                self.layer.addSublayer(layer)
            }
            byId[item.id] = layer
            layerNodes.append(layer)
            rectsByNodeId[item.id] = item.rect
            metaByNodeId[item.id] = item.style
            // ★建树时**顺带算深度**（本仓实测的性能修复）：`depthOf` 每次沿父链上溯 O(深度)，
            //   而排序要 O(n log n) 次比较 ⇒ 4003 节点实测 sort 段 **19.38ms**（占 layers 段 88%）。
            //   建层时父必已建好 ⇒ 直接 parent 深度 +1，O(1)。
            depthById[item.id] = item.parentId.flatMap { depthById[$0] }.map { $0 + 1 } ?? 0
        }
        builtLayerCount = layerNodes.count
        // ★V4：建层后清延迟更新簿记（新树 ⇒ 旧簿记失效）
        pendingOffscreen.removeAll(keepingCapacity: true)
        CATransaction.commit()
    }

    /* ────────────────────────── ★V7：结构变更的层维护 ────────────────────────── */

    /// ★★**摘除子树**（递归清理层与全部 id 簿记）
    ///
    /// 【为什么必须递归清理（本仓纪律：不留下"半死"状态）】层树与簿记表是**同一事实的两份视图**
    ///   （见 `childrenById` 注释）。若只 `removeFromSuperlayer` 而不清表：
    ///   ① 后续更新会命中"存在但已不可见"的层（几何改了却看不见 ⇒ 静默错）；
    ///   ② `pendingOffscreen` 里的旧账会在滚动时把孤层刷回来；
    ///   ③ `layerNodes.count` 成为虚数（内存读数与层数读数失真）。
    ///   ⇒ 一次性把该子树在**所有**表里清干净。
    func removeLayersSubtree(rootId: Int) {
        // ★父 id **先取**：下面的循环会把它从表里清掉（顺序错了就摘不出父子链）
        let pid0 = builtParents[rootId] ?? parentById[rootId] ?? -1
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var stack = [rootId]
        var removedLayers = 0
        var removedObjects = Set<ObjectIdentifier>()
        while let id = stack.popLast() {
            for c in childrenById[id] ?? [] { stack.append(c) }
            if let l = layersById[id] {
                l.removeFromSuperlayer()
                removedObjects.insert(ObjectIdentifier(l))
                removedLayers += 1
            }
            layersById.removeValue(forKey: id)
            depthById.removeValue(forKey: id)
            parentById.removeValue(forKey: id)
            childrenById.removeValue(forKey: id)
            builtFrames.removeValue(forKey: id)
            builtParents.removeValue(forKey: id)
            rectsByNodeId.removeValue(forKey: id)
            metaByNodeId.removeValue(forKey: id)
            absOriginByNodeId.removeValue(forKey: id)
            pendingOffscreen.removeValue(forKey: id)   // ★旧账一并作废
        }
        // ★从父的子列表里摘掉（否则父的 childrenById 永远指着死 id）
        if pid0 >= 0, var sibs = childrenById[pid0] {
            sibs.removeAll { $0 == rootId }
            childrenById[pid0] = sibs
        }
        // ★layerNodes 是清空/计数用的扁平列表——必须同步（否则 clearLayers 漏摘、计数失真）
        layerNodes.removeAll { removedObjects.contains(ObjectIdentifier($0)) }
        builtLayerCount = layerNodes.count
        lastSpliceRemoved += removedLayers
        CATransaction.commit()
    }

    /// ★★**插入子树**（按 `(parentId, index=末尾)` 落点建层；节点**父在前**）
    ///
    /// 【输入从哪来】splice 响应里的 `inserts` 明细（JS 侧 `takeSplice()` 产出）——
    ///   含新节点的**完整样式**（tag/style/text），与全量树的规格同源（`fillSpec` 单实现）。
    ///
    /// 【为什么不在这里设 frame】新节点的几何在**同一批**的 rects 里返回；
    ///   由调用方随后走 `updateLayersIncremental`（按父链深度排序 ⇒ 父原点先算好）统一设帧。
    ///   在此设帧会用到**尚未更新**的父原点（顺序错误 ⇒ 几何错，本仓已踩过坐标系双重偏移）。
    func insertLayers(_ inserts: [[String: Any]]) -> Int {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var created = 0
        lastInsertedIds.removeAll(keepingCapacity: true)
        for ins in inserts {
            guard let parentId = ins["parentId"] as? Int,
                  let nodes = ins["nodes"] as? [[String: Any]] else { continue }
            // ★★**插入位置**（2026-09-28：splice 支持中间插入）
            //
            // 【为什么必须有】CALayer 的 `addSublayer` **恒为追加**（层序 = 绘制顺序）
            //   ⇒ 中间插入若不按 index 放，**层序与核心的 children 序不一致**
            //   ⇒ 后续 z-order/重叠绘制与命中测试都会与核心不符（且几何断言发现不了）。
            //   做法：把块根按 index 依次 `insertSublayer(at:)`，并把 id 插进 `childrenById`
            //   的同一位置（两份表示保持一致——本仓纪律）。
            let insertAt = (ins["index"] as? Int) ?? -1
            // ★块根的落点位（逐块递增：同一块里若有多棵子树，它们**依次**插在 index 之后）
            var rootSlot = insertAt
            for n in nodes {
                guard let id = n["id"] as? Int else { continue }
                // 该节点在块内的父（缺省/非块内 ⇒ 落点父）
                let rawPid = n["parentId"] as? Int
                let isBlockRoot = !(rawPid != nil && layersById[rawPid!] != nil)
                let pid = isBlockRoot ? parentId : rawPid!
                let parentLayer: CALayer = layersById[pid] ?? self.layer
                let style = spliceStyleOf(n)
                let layer = makeLayer(style: style)
                if isBlockRoot && rootSlot >= 0 {
                    // ★★块根按 `index` 插（层序 = 绘制顺序 = 核心 children 序）
                    //
                    // 【为什么不能一律 append（本仓实测）】`addSublayer` 恒为追加
                    //   ⇒ 中间插入会让**层序与核心的 children 序不一致** ⇒ 重叠绘制/z-order
                    //     与命中测试与核心不符（几何断言发现不了，属静默错显示）。
                    //   ⇒ 用 `insertSublayer(at:)` 按落点插，并把 id 插进 `childrenById` 同位（两份表示一致）。
                    let sibs = childrenById[pid] ?? []
                    let at = min(max(rootSlot, 0), sibs.count)
                    let before: CALayer? = at < sibs.count ? layersById[sibs[at]] : nil
                    if let b = before {
                        parentLayer.insertSublayer(layer, below: b)
                    } else {
                        parentLayer.addSublayer(layer)
                    }
                    childrenById[pid, default: []].insert(id, at: at)
                    rootSlot += 1
                } else {
                    parentLayer.addSublayer(layer)
                    childrenById[pid, default: []].append(id)
                }
                layersById[id] = layer
                parentById[id] = pid
                depthById[id] = (depthById[pid] ?? 0) + 1
                metaByNodeId[id] = style
                layerNodes.append(layer)
                lastInsertedIds.append(id)
                created += 1
            }
        }
        builtLayerCount = layerNodes.count
        lastSpliceInserted += created
        CATransaction.commit()
        return created
    }

    /// 从 splice 的节点描述符里取**绘制字段**（与全量路径 `render` 的取法同款：
    /// 只认 backgroundColor/color/text/fontSize/borderRadius，其余不进层）
    private func spliceStyleOf(_ n: [String: Any]) -> [String: Any] {
        var style: [String: Any] = [:]
        for k in ["backgroundColor", "color", "text"] {
            if let v = n[k] as? String { style[k] = v }
        }
        if let fs = n["fontSize"] as? Double { style["fontSize"] = CGFloat(fs) }
        if let fw = n["fontWeight"] as? Double { style["fontWeight"] = CGFloat(fw) }   // ★字重（见 font(size:weight:) 注释）
        if let br = n["borderRadius"] as? Double { style["borderRadius"] = CGFloat(br) }
        return style
    }

    /// ★★最近一次 splice 的层维护读数（诊断 + 判据："层真的被增删了"）
    private(set) var lastSpliceRemoved = 0
    private(set) var lastSpliceInserted = 0
    /// ★最近一次 splice 插入的节点 id（供"插入文本的度量是否真的生效"自检）
    private(set) var lastInsertedIds: [Int] = []
    func resetSpliceCounters() { lastSpliceRemoved = 0; lastSpliceInserted = 0; lastInsertedIds.removeAll() }

    /// ★★**插入文本的度量自检**（设备侧不变量）
    ///
    /// 【为什么必须有（本仓实测的静默错几何缺陷）】核心的重排引擎曾用 `NullTextMeasurer`
    ///   ⇒ 范围内文本被塌成 0 高（**首帧正确、更新后错**，静态用例发现不了）。
    ///   修法（度量表随句柄持久化 + splice 带 textMeasures）已在 Rust 单测覆盖，
    ///   但**宿主这条注入路径**（`fontSize ?? 14` 就地度量 → 塞进请求）此前**无任何判据**。
    ///
    /// 【★首版自检写错了（本仓实测的测量装置缺陷，被自检自身暴露）】首版只看 `layer.frame.height`：
    ///   而插入的行在**列表末尾（视口外）** ⇒ 200 个文本层全部走"延后记账"
    ///   （`visibleOnly=true` 下不可见层不设 frame）⇒ frame 仍是默认 0
    ///   ⇒ 报"200/200 零高"——**是测量口径的假象，不是度量失败**（差点误导我）。
    ///   ⇒ 正解：几何来源是**二者之一**——① 已应用 ⇒ `layer.frame`；
    ///     ② 未应用（视口外延后）⇒ `pendingOffscreen` 的记账 rect。
    ///     两者都没有 = 该节点**不在核心变化集里**（这才是真缺陷）⇒ 单列 `missing`。
    /// - Returns: (文本层数, 已知几何里高≈0 的条数, 无任何几何的条数)
    func insertedTextZeroHeight() -> (text: Int, zero: Int, missing: Int) {
        var text = 0
        var zero = 0
        var missing = 0
        for id in lastInsertedIds {
            guard let style = metaByNodeId[id],
                  let t = style["text"] as? String, !t.isEmpty else { continue }
            text += 1
            if let q = pendingOffscreen[id] {
                if q.height < 0.5 { zero += 1 }
            } else if let l = layersById[id] {
                if l.frame.height < 0.5 { zero += 1 }
            } else {
                missing += 1
            }
        }
        return (text, zero, missing)
    }

    /* ────────────────────────── ★V4：可见区判定 + 延迟更新簿记 ────────────────────────── */

    /// 内容滚动偏移（= 根层被移动了多少；滚动 = 移动内容，**视口固定**）
    ///
    /// 【★本仓实测的模型错误（滚动用例 FAIL 暴露的）】首版把「可见区」写成 `self.bounds`
    ///   并让 `scrollBy` 去平移 `self.bounds` —— 但层的坐标是**内容坐标**（绝对），
    ///   平移 bounds 会让「视口」和「内容」一起移动 ⇒ **永远判不出"滚入"** ⇒ 补刷恒为 0。
    ///   ⇒ 正确模型：**视口固定在屏幕 `[0,0,W,H]`**，滚动 = 移动**内容**（根层位置偏移）。
    ///   判可见性 = 「内容坐标 r」与「屏幕窗口 + 偏移」相交判定。
    private(set) var contentOffset = CGPoint.zero

    /// ★★重置滚动偏移（**建新树时必须调用**——本仓实测的测试间状态泄漏）
    ///
    /// 【故障链】`contentOffset` 是**视图属性**而非树属性 ⇒ 上一个用例滚动后，
    ///   下一个用例 `mount` 新树时偏移**仍在** ⇒ 采样/可见性判定都基于错误的视口位置。
    ///   实测症状：像素用例 mount 后采样点颜色全不对（因为屏幕显示的是「已上移 1200px」的内容），
    ///   而**几何断言全对** ⇒ 极易误判成"渲染 bug"。
    ///   ⇒ 纪律：**跨用例共享的视图状态，必须在新树建立时显式归零**。
    func resetContentOffset() {
        contentOffset = .zero
        self.layer.sublayerTransform = CATransform3DIdentity
    }

    /// 屏幕固定视口（可见区判定的基准）
    var visibleBounds: CGRect { CGRect(origin: .zero, size: self.bounds.size) }

    /// 应用滚动偏移：移动内容（根层的 sublayerTransform 平移），并记录偏移量
    ///
    /// - Returns: 新的内容偏移
    @discardableResult
    func applyContentOffset(dx: CGFloat, dy: CGFloat) -> CGPoint {
        contentOffset.x += dx
        contentOffset.y += dy
        // ★用 sublayerTransform 平移（不动各层 frame ⇒ 不破坏「内容坐标」语义）
        var t = CATransform3DIdentity
        t.m41 = -contentOffset.x
        t.m42 = -contentOffset.y
        self.layer.sublayerTransform = t
        return contentOffset
    }

    /// 视口外的待更新层（id → 目标绝对 rect）——滚入视野前必须刷上
    ///
    /// 【为什么不直接丢弃（正确性红线）】CALayer.frame 是**持久状态**：若因为「当前不可见」
    ///   就不更新，滚动到该位置时会显示**旧几何**（错位）。⇒ 必须**记账**，
    ///   在滚入视野前补刷（见 `flushPendingIfVisible`）。
    private var pendingOffscreen: [Int: CGRect] = [:]

    /// 本次更新里「因不可见被延迟」的层数（诊断；同时是正确性的可观测点）
    private(set) var lastDeferredCount = 0
    /// 本次更新里「补刷」的层数
    private(set) var lastFlushedCount = 0
    /// 当前待补刷（视口外延后）的层数
    var pendingCount: Int { pendingOffscreen.count }
    /// 本次更新里「因节点转为可见而作废的旧账」数（>0 说明确实发生过这条故障链的修复）
    private(set) var lastStalePendingCleared = 0
    /// 不变量自检：可见节点与待补刷表的重叠数（**必须恒为 0**）
    private(set) var lastPendingVisibleOverlap = 0

    /// ★★滚动/几何变化钩子：视图 bounds 变化时补刷「已滚入视野」的待更新层
    ///
    /// 【为什么必须有（正确性红线）】`updateLayersIncremental` 会把**不可见**层的更新
    ///   记进 `pendingOffscreen` 延后处理（见其注释）。若没有这个钩子，滚动后那些层
    ///   仍显示**旧几何**（错位）。⇒ 必须在此补刷。
    ///
    /// 【为什么放 layoutSubviews（而不是加 UIScrollView 代理）】本视图的自绘层树
    ///   **不依赖 UIScrollView**（滚动由 native-host 跟随 + 本视图 bounds 平移表达），
    ///   故 `layoutSubviews` 就是「可见区变了」的统一入口——一处实现覆盖全部触发源。
    override func layoutSubviews() {
        super.layoutSubviews()
        // ★只在有待更新项时才动（热路径：每次 layout 都遍历一遍会白花）
        if !pendingOffscreen.isEmpty {
            flushPendingIfVisible()
        }
    }

    /// 判断矩形是否与可见区相交（含少量余量：预取一屏，避免滚动时才补刷）
    private func intersectsVisible(_ r: CGRect) -> Bool {
        // ★把**内容坐标**矩形换算到**屏幕坐标**（减去内容偏移），再与固定视口相交判定
        let onScreen = r.offsetBy(dx: -contentOffset.x, dy: -contentOffset.y)
        // ★预取**半屏**（首版用了「上下各一屏」= 三屏高 ⇒ 803 节点的树几乎全算可见）
        //   ⇒ 优化形同失效，且滚动用例没有待补刷项可验证。半屏兼顾「滚动不抖」与「真剔除」。
        let vb = visibleBounds.insetBy(dx: 0, dy: -visibleBounds.height / 2)
        return vb.intersects(onScreen)
    }

    /// ★补刷：把当前已可见的待更新层应用掉（滚动前后调用）
    @discardableResult
    func flushPendingIfVisible() -> Int {
        guard !pendingOffscreen.isEmpty else { return 0 }
        var flushed = 0
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        let ready = pendingOffscreen.filter { intersectsVisible($0.value) }
        // ★★必须**按父链深度升序**补刷（本仓实测的隐患）
        //   `applyOneLayer` 用 `absOriginByNodeId[父]` 换算父相对坐标——若子先于父被刷，
        //   用的就是父的**旧原点** ⇒ frame 错位。
        //   字典遍历顺序不确定 ⇒ 必须显式排序（与 `updateLayersIncremental` 同一条纪律）。
        var depthCache: [Int: Int] = [:]
        for id in ready.keys where depthCache[id] == nil {
            depthCache[id] = depthOf(id)
        }
        for (id, abs) in ready.sorted(by: { (depthCache[$0.key] ?? 0) < (depthCache[$1.key] ?? 0) }) {
            pendingOffscreen.removeValue(forKey: id)
            applyOneLayer(id: id, abs: abs)
            flushed += 1
        }
        lastFlushedCount = flushed
        return flushed
    }

    /// ★★把**文本更新**落到层上（CATextLayer.string）
    ///
    /// 【为什么必须有（本仓实测的静默错显示缺陷）】增量路径此前只改 frame，
    ///   而文本内容在 `CATextLayer.string` 上 ⇒ 改文案后**核心几何已变、屏幕文字还是旧的**
    ///   （几何断言全绿，只有肉眼能发现）。Rust 侧现已回报 `text_updates`（见 ApplyOutcome）。
    func applyTextUpdates(_ updates: [String: Any]) -> Int {
        var applied = 0
        for (k, v) in updates {
            guard let id = Int(k), let text = v as? String, let layer = layersById[id] else { continue }
            if let tl = layer as? CATextLayer {
                tl.string = text
                applied += 1
            }
            // 更新 meta（层 dump / 诊断读它）
            if var m = metaByNodeId[id] {
                m["text"] = text
                metaByNodeId[id] = m
            }
        }
        return applied
    }

    /// 应用单个层的 frame（供即时更新与补刷共用——★同一语义一处实现）
    private func applyOneLayer(id: Int, abs: CGRect) {
        guard let layer = layersById[id] else { return }
        let pid = parentById[id] ?? -1
        let parentOrigin = pid >= 0 ? (absOriginByNodeId[pid] ?? .zero) : .zero
        absOriginByNodeId[id] = abs.origin
        let f = CGRect(x: abs.minX - parentOrigin.x, y: abs.minY - parentOrigin.y,
                       width: abs.width, height: abs.height)
        layer.frame = f
        builtFrames[id] = f
        rectsByNodeId[id] = abs
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
    /// 最近一次层更新的**三段分解**（V4 下半：定位 `layers` 段残余）
    ///
    /// 【为什么必须拆（本仓实测）】原先只报一个 `layers_ms`，把三件不同的事混在一起：
    ///   · 排序/可见性过滤（纯 Swift 计算）
    ///   · `layer.frame = ...` 逐层赋值（含 CA 内部簿记）
    ///   · `CATransaction.commit()` —— **隐式布局与提交**（含 GPU 侧准备，异步部分不可测）
    ///   4003 个子层改 frame 时，第三段往往才是大头——不拆就永远查不到。
    private(set) var lastLayerTiming: [String: Double] = [:]

    func updateLayersIncremental(
        changed: [(id: Int, abs: CGRect)],
        /// ★V4：是否**只更新可见层**（不可见的记账延后）。false = 旧行为（全部更新），用于 A/B
        visibleOnly: Bool = true
    ) -> Int {
        lastLayerTiming = [:]
        guard !changed.isEmpty else { return 0 }
        // 逐节点检查是否都有对应的已有层；缺任何一个 ⇒ 退回全量（正确性优先）
        for c in changed where layersById[c.id] == nil { return -1 }

        // ★★V4：**只更新可见层的 frame**，不可见的记账延后（V3 类B 的第二优化项）
        //
        // 【为什么能省（V3 真机读数）】类B 场景 `layers` 段 **13.34ms / 4003 层**；
        //   而视口 844px ÷ 行高 56px ≈ **15 行可见**（共 1000 行）⇒ 绝大多数层不在屏上。
        //   layer.frame 的赋值成本与「是否可见」无关（CA 仍要处理），故按可见性分流能直接砍掉大头。
        //
        // 【正确性红线】不可见的**不能丢**（frame 是持久状态，滚入时会显示旧几何）
        //   ⇒ 记进 `pendingOffscreen`，由 `flushPendingIfVisible()` 在滚入前补刷。
        //   ⚠ 本里程碑**尚无滚动钩子**：调用方需在滚动时自行调用补刷（诚实边界，见文档）。
        let visible: [(id: Int, abs: CGRect)]
        let offscreen: [(id: Int, abs: CGRect)]
        // 父链深度升序（保证用到父的**已更新**原点）——两个集合各自排
        // ★★按父链深度升序（保证用到父的**已更新**原点）——但**先建一次深度表**
        //
        // 【为什么（本仓实测的回退）】首版直接 `sorted { depthOf($0.id) < depthOf($1.id) }`：
        //   `depthOf` 每次都沿父链上溯 O(深度) ⇒ 4003 节点排序变成 O(n·深度·log n)
        //   ⇒ 实测类A（只动 **1 个**节点）`layers` 段从 0.09ms **涨到 5.99ms**——
        //   优化反而制造了新热点。⇒ 先 O(n) 建表，排序只查表。
        let tSortStart = CFAbsoluteTimeGetCurrent()
        // ★★先**过滤**（O(n)、只需可见性判定）再**排序**（只排留下的）
        //
        // 【本仓实测的第三处顺序错误】首版是「先排序全部 4003，再过滤出可见的 ~180」
        //   ⇒ 白花 O(n log n) 次比较 + O(n) 次深度查询 ⇒ `sort` 段 **18.4ms**，
        //   而真正要排序的只有约 180 个（O(k log k) 可忽略）。
        //   ⇒ 顺序反过来：过滤不需要深度信息，排序才需要。
        var vis: [(id: Int, abs: CGRect)] = []
        var off: [(id: Int, abs: CGRect)] = []
        if visibleOnly {
            vis.reserveCapacity(changed.count / 8)
            for c in changed {
                if intersectsVisible(c.abs) { vis.append(c) } else { off.append(c) }
            }
        } else {
            vis = changed
        }
        let sortedVisible = vis.sorted { depthOf($0.id) < depthOf($1.id) }
        let sortedOff = visibleOnly ? off : []
        visible = sortedVisible
        offscreen = sortedOff

        let tSortDone = CFAbsoluteTimeGetCurrent()
        lastLayerTiming["sort_ms"] = (tSortDone - tSortStart) * 1000

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var updated = 0
        var staleCleared = 0
        for c in visible {
            // ★★必须先清**该节点的待补刷旧账**（本仓实测的静默错几何缺陷）
            //
            // 【故障链】① 更新1：节点不可见 ⇒ 记账 `pendingOffscreen[X] = rect1`
            //          ② 更新2：用户已滚动、节点变可见 ⇒ 立即应用 rect2（正确）
            //             但旧账未清 ⇒ ③ 再滚动时 `flushPendingIfVisible` 用 **rect1 覆盖回退**！
            //   ⇒ 格子**回到旧位置**，且只在滚动后可见 ⇒ 静态用例完全发现不了。
            // ⇒ 纪律：**「立即应用」与「延后记账」对同一节点互斥**——应用即作废旧账。
            if pendingOffscreen.removeValue(forKey: c.id) != nil {
                staleCleared += 1
            }
            applyOneLayer(id: c.id, abs: c.abs)
            updated += 1
        }
        lastStalePendingCleared = staleCleared
        // ★不变量自检：**已应用的可见节点不得仍在待补刷表里**（重叠 = 会出现旧几何回退）
        //   正常应恒为 0；非 0 即说明「应用」与「记账」的互斥被破坏（静默错几何的前兆）。
        var overlap = 0
        for c in visible where pendingOffscreen[c.id] != nil {
            overlap += 1
        }
        lastPendingVisibleOverlap = overlap
        let tFramesDone = CFAbsoluteTimeGetCurrent()
        lastLayerTiming["frames_ms"] = (tFramesDone - tSortDone) * 1000
        for c in offscreen {
            pendingOffscreen[c.id] = c.abs // ★记账（不是丢弃）
        }
        let tBookDone = CFAbsoluteTimeGetCurrent()
        // ★提交单独计时（含隐式布局 + 提交；GPU 异步部分不计入——宿主同步路径到此为止）
        CATransaction.commit()
        lastLayerTiming["commit_ms"] = (CFAbsoluteTimeGetCurrent() - tBookDone) * 1000
        lastLayerTiming["total_ms"] = (CFAbsoluteTimeGetCurrent() - tSortStart) * 1000
        lastLayerTiming["count"] = Double(updated)
        lastDeferredCount = offscreen.count
        return updated
    }

    /* ────────────────────────── ★V9：触摸 → 命中 → 派发 ────────────────────────── */

    /// 触摸回调（由桥接层注入：把「内容坐标 + 语义类型」交给桥接层）
    ///
    /// 【为什么用回调而不是直接持有 JSContext / 核心句柄（本仓设计）】`SelfDrawView` 是纯 UI 层：
    ///   不应知道 JS 的存在、也不该持有排版核心句柄（否则 UI / 运行时 / 核心三层耦合）。
    ///   ⇒ 视图只负责「把触摸转成内容坐标 + 限定时序（tap 判定）」；
    ///     命中测试（核心）与 JS 派发（桥接层）都在上层完成。
    var onGesture: ((Double, Double, String) -> Void)?

    /// 最近一次触摸的起点（用于判定 tap / longpress 与提供坐标）
    private var touchStart: (x: Double, y: Double, t: CFAbsoluteTime)?

    /// 触摸结束到派发的**最大位移**（超过则不算 tap——与 gesture 层的 threshold 同口径）
    private let tapSlop: Double = 10.0
    /// tap 的最长时长（超过则可能是长按；当前只区分 tap，长按留待 gesture 层）
    private let tapMaxDuration: Double = 0.5

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = touches.first else { return }
        let p = t.location(in: self)
        touchStart = (Double(p.x), Double(p.y), CFAbsoluteTimeGetCurrent())
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        defer { touchStart = nil }
        guard let t = touches.first, let start = touchStart else { return }
        let p = t.location(in: self)
        let dx = Double(p.x) - start.x
        let dy = Double(p.y) - start.y
        let dist = (dx * dx + dy * dy).squareRoot()
        let dt = CFAbsoluteTimeGetCurrent() - start.t
        // ★只在「短时 + 小位移」时算 tap（与 gesture 层 threshold 同口径）
        //   ⇒ 拖动/长按不会误报成 tap（误报会让"滑动列表"触发"点击行"）
        guard dist <= tapSlop, dt <= tapMaxDuration else { return }
        // ★用**绝对内容坐标**（核心的 rects 是内容坐标；self.bounds 是视口）
        //   ⇒ 加上滚动偏移（内容被移了，但核心坐标不动）
        let ax = Double(p.x) + Double(contentOffset.x)
        let ay = Double(p.y) + Double(contentOffset.y)
        emitGesture(x: ax, y: ay, type: "tap")
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        touchStart = nil
    }

    /// 发一次语义手势（内容坐标）——桥接层在此回调里做**核心命中测试 + JS 派发**
    func emitGesture(x: Double, y: Double, type: String) {
        onGesture?(x, y, type)
    }

    /// 节点在层树中的深度（沿 `parentById` 上溯；带防环保护）
    /// 节点深度（★建层时预计算，见 buildLayers；查表 O(1)）
    ///
    /// 【为什么不再沿父链上溯（本仓实测）】上溯版在「4003 个节点排序」时被调用 O(n log n) 次，
    ///   实测 `sort` 段 **19.38ms**，而 `frames` 段只有 0.46ms
    ///   ——瓶颈根本不在 CA 提交，而在这个自制的上溯循环。
    ///   建层时父必已建好 ⇒ 递推即可（`depthById` 由 buildLayers 填充）。
    private func depthOf(_ id: Int) -> Int {
        depthById[id] ?? 0
    }

    /// 取某节点建层时记录的 **fontSize**（文本补丁的度量要用它——与全量渲染同源）
    func fontSizeOf(id: Int) -> Double? {
        if let fs = metaByNodeId[id]?["fontSize"] as? CGFloat { return Double(fs) }
        if let fs = metaByNodeId[id]?["fontSize"] as? Double { return fs }
        return nil
    }

    /// 取某节点建层时记录的 **fontWeight**（文本度量要用它——与绘制同源）
    func fontWeightOf(id: Int) -> Double? {
        if let fw = metaByNodeId[id]?["fontWeight"] as? CGFloat { return Double(fw) }
        if let fw = metaByNodeId[id]?["fontWeight"] as? Double { return fw }
        return nil
    }

    /// ★★**层序对账**（⚠ **设计有误，仅作诊断读数——勿当判据**，见下）
    ///
    /// 【为什么要做它】像素判据**证明不了层序**——把 `insertLayers` 退化为"恒追加"后
    ///   它仍全绿（行不重叠 ⇒ 层序差异在屏幕上不可见）。而层序错是**真错**
    ///   （重叠/半透明/z-order/命中测试都会与核心不符）。
    ///
    /// 【★为什么当前实现比不了（本仓实测的自我纠错）】两侧的"子序"**来源不同源**：
    ///   · 核心 `child_order` = 内部 `children` 字段的顺序
    ///   · 宿主 `childrenById` = 按**每个节点的 parentId 归类**得到的（全量建层路径如此填充）
    ///   当上游给的 `parentId` 与核心的 `children` 结构不一致时（实测差异@51：
    ///   宿主在该位是**圆点**、核心是**行根**），两边天然对不上——
    ///   **这是"两份表示本来就不等价"，不是"层序错了"**。
    ///   ⇒ 正解（未做）：宿主应**以核心的 `child_order` 为准**重建 `childrenById`
    ///     （单一事实来源），而不是自行从 parentId 归类。属后续工作。
    ///   ⇒ 当前：本函数的结果只作**诊断读数**落盘，**不得**用于 PASS/FAIL 断言。
    ///
    /// - Parameter coreChildren: 核心返回的 `{parentId: [childId, ...]}` 映射
    /// - Returns: `(checked, mismatches)`——mismatches 非空即层序与核心不符
    /// ★★**以核心的 `child_order` 为准**，重建 `childrenById` 并重排 CALayer 子层
    ///
    /// 【为什么必须有（本仓实测的设计纠正）】此前 `childrenById` 是宿主**自行**按每个节点的
    ///   `parentId` 归类出来的（见 `buildLayers`），而**层序**（= 绘制顺序）应以核心的
    ///   `children` 为准——两者是**同一事实的两份表示**，自行推导就会分叉
    ///   （实测：对账报 `首个差异@51: 宿主 6 vs 核心 5260`）。
    ///   ⇒ 正解：**核心说什么就是什么**——按 `child_order` 重建簿记 + 重排层。
    ///
    /// 【重排手法】`addSublayer` 对**已在层的子层**是**移到末尾**（subarrays[0] 先绘制=底层）
    ///   ⇒ 按核心顺序**依次** `addSublayer` 即得目标顺序（无需 remove 再 add）。
    ///   ★前提：核心给的 `kids` 是该父的**全部**子节点（Core 侧如此产出）。
    ///
    /// - Returns: `(applied, missing)`——missing 非空即"核心提到了但宿主没有该层"（层树缺节点）
    func applyChildOrder(_ coreChildren: [String: [Int]]) -> (applied: Int, missing: [String]) {
        var applied = 0
        var missing: [String] = []
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (pidStr, kids) in coreChildren {
            guard let pid = Int(pidStr) else { continue }
            let absent = kids.filter { layersById[$0] == nil }
            if !absent.isEmpty {
                // ★不静默：核心提到了、宿主没有 ⇒ 层树缺节点（必须可观测——否则后续所有
                //   顺序/几何操作都在不完整的基础上做）
                missing.append("parent \(pid): 缺 \(Array(absent.prefix(4)))")
                continue
            }
            let parentLayer: CALayer = layersById[pid] ?? self.layer
            childrenById[pid] = kids
            for k in kids {
                if let l = layersById[k] { parentLayer.addSublayer(l) }
            }
            applied += 1
        }
        CATransaction.commit()
        return (applied, missing)
    }

    /// ★★**应用绘制补丁**（颜色 / 圆角 / 字号 / 字重 / 透明度）——**几何之外的第二条通道**
    ///
    /// 【为什么单独一条通道（本仓实测的功能缺口）】`takePatches()` 只发布**布局**字段
    ///   （要经核心重排）；绘制属性与几何无关 ⇒ 直接改层即可，**绕核心是纯粹的多余**
    ///   （核心不认识 paint 字段，送过去只会白跑一轮）。
    ///
    /// 【形态】`{id: {paint...}}`；键值为 `null` ⇒ **清除**（如移除 borderRadius ⇒ 归零）
    ///   ⇒ 这与"只发改动键"不同：宿主无需维护旧值，逻辑平凡。
    ///
    /// - Returns: 实际应用的层数（诊断读数：证明 paint 通道真的生效）
    func applyPaintPatches(_ patches: [[String: Any]]) -> Int {
        var applied = 0
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for p in patches {
            guard let id = p["id"] as? Int, let paint = p["paint"] as? [String: Any] else { continue }
            guard let layer = layersById[id] else { continue }
            // ① 背景色（CALayer）
            if let bgAny = paint["backgroundColor"] {
                layer.backgroundColor = (bgAny as? String).flatMap(parseHexColor)?.cgColor
            }
            // ② 文本层专有：string / 字号 / 字重 / 前景色
            if let tl = layer as? CATextLayer {
                if let colorAny = paint["color"] {
                    tl.foregroundColor = (colorAny as? String).flatMap(parseHexColor)?.cgColor
                        ?? UIColor.white.cgColor
                }
                let fs = (paint["fontSize"] as? CGFloat) ?? tl.fontSize
                let fw = (paint["fontWeight"] as? CGFloat) ?? 400
                if paint["fontSize"] != nil || paint["fontWeight"] != nil {
                    let ufont = SelfDrawBridge.font(size: fs, weight: fw)
                    // ★字体变了 ⇒ 必须同时更新 `font` 与 `fontSize`（CATextLayer 两者独立）
                    tl.font = CGFont(ufont.fontName as CFString)
                    tl.fontSize = fs
                }
            }
            // ③ 圆角（null ⇒ 归零）
            if let brAny = paint["borderRadius"] {
                let r = (brAny as? CGFloat) ?? 0
                layer.cornerRadius = r
                layer.masksToBounds = r > 0
            }
            // ④ 透明度
            if let opAny = paint["opacity"] {
                let op = (opAny as? CGFloat) ?? 1
                layer.opacity = Float(op)
            }
            // ⑤ 更新 meta（后续度量/诊断读它——保持"层 = meta"一致）
            var m = metaByNodeId[id] ?? [:]
            for (k, v) in paint where !(v is NSNull) { m[k] = v }
            for (k, v) in paint where v is NSNull { m.removeValue(forKey: k) }
            metaByNodeId[id] = m
            applied += 1
        }
        CATransaction.commit()
        return applied
    }

    /// ★★**层序对账（对真实层序）**：把「CALayer 子层顺序」与「核心的 children 顺序」比较
    ///
    /// 【为什么对"真实层序"而不是对 `childrenById`（本仓实测的判据强度教训）】若拿
    ///   `childrenById`（宿主自己的簿记）去比，`applyChildOrder` 刚按核心写过它 ⇒ **必然相等**
    ///   ⇒ 判据恒绿、毫无信息量。而对**真实 `sublayers`** 比较才验证了
    ///   "层树真的按核心顺序排好了"——这正是 z-order/重叠绘制/命中测试所依赖的那份事实。
    func reconcileChildOrderLegacy(coreChildren: [String: [Int]]) -> (checked: Int, mismatches: [String]) {
        // 层身份 → 节点 id 的反查表（用对象身份，避免依赖 layersById 的遍历顺序）
        var idByLayer: [ObjectIdentifier: Int] = [:]
        for (i, l) in layersById { idByLayer[ObjectIdentifier(l)] = i }
        var checked = 0
        var mismatches: [String] = []
        var mismatch_detail: [String] = []
        for (pidStr, coreKids) in coreChildren {
            guard let pid = Int(pidStr) else { continue }
            // ★真实层序（本判据的核心：不是宿主自报的簿记）
            let parentLayer: CALayer = layersById[pid] ?? self.layer
            let mine: [Int] = (parentLayer.sublayers ?? []).compactMap { idByLayer[ObjectIdentifier($0)] }
            checked += 1
            if mine != coreKids {
                // ★诊断必须够**定位**（本仓实测：只打印前 6 项时"看起来完全一样"，
                //   而差异在后面 ⇒ 打印**首个差异位置 + 两侧该位置的值**
                // ★完整对照（只对**前几个**动过的父做，避免报告爆炸）
                if let d = coreChildren["__debug_ids"]  { _ = d }
                let head = min(8, max(mine.count, coreKids.count))
                mismatch_detail.append("parent \(pid) 前\(head)项：宿主 \(Array(mine.prefix(head))) 核心 \(Array(coreKids.prefix(head)))")
                let n = min(mine.count, coreKids.count)
                var firstDiff = -1
                for i in 0..<n where mine[i] != coreKids[i] { firstDiff = i; break }
                let hint: String
                if firstDiff >= 0 {
                    hint = "首个差异@\(firstDiff): 宿主 \(mine[firstDiff]) vs 核心 \(coreKids[firstDiff])"
                } else {
                    hint = "前缀相同但长度不同: 宿主 \(mine.count) vs 核心 \(coreKids.count)"
                }
                mismatches.append("parent \(pid): \(hint)")
            }
        }
        // 细节并入 mismatches（报告只带一个数组）
        return (checked, mismatches + mismatch_detail)
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
    /// ★★上一次更新提交的几何快照（id → "x,y,w,h"）——用于**自检「几何真的变了吗」**
    ///
    /// 【为什么必须自检（本仓实测的第八个测量装置缺陷）】类B 基准树少了 `flexShrink: 0`，
    ///   1001 行被 flexbox 压缩到内容高度 ⇒ 「改行高 56→80」**根本没产生几何变化**，
    ///   但用例仍报了 47.9ms 的漂亮数字（全量重排 + 全量传输 + 全量层更新，
    ///   全都作用在一棵"没有变化"的树上）。⇒ 计时**必须配变化量自检**，否则又在测空气。
    private var lastGeom: [Int: String] = [:]
    /// 最近一次更新里几何**真的变了**的节点数（自检读数）
    private(set) var lastGeomChanged = 0
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
    /// ★★**字体构造（唯一实现）**——绘制（CATextLayer）与度量必须用**同一支字体**
    ///
    /// 【为什么必须同源（本仓实测）】若绘制用粗体、度量用常规体 ⇒ 文本**显示**与实际
    ///   **占位**不符（字被裁或留白），且几何断言全绿（几何是按度量算的）。
    ///   本仓已有同族教训（坐标口径、层序）：**同一事实只认一个来源**。
    ///   ★放在 `SelfDrawBridge`（而非 View）：**度量在这里**（`measureText`）——
    ///     字体构造与度量同处一类，`makeLayer` 经 `SelfDrawBridge.font` 取同一支字体。
    ///
    /// - Parameter weight: CSS 口径字重（400 = normal，700 = bold）
    static func font(size: CGFloat, weight: CGFloat) -> UIFont {
        if weight >= 700 { return UIFont.boldSystemFont(ofSize: size) }
        if weight >= 600 { return UIFont.systemFont(ofSize: size, weight: .semibold) }
        if weight <= 300 { return UIFont.systemFont(ofSize: size, weight: .light) }
        return UIFont.systemFont(ofSize: size)
    }

    static func measureText(_ text: String, fontSize: CGFloat, fontWeight: CGFloat = 400) -> CGSize {
        if text.isEmpty { return .zero }
        // ★缓存键必须含**字重**（本仓实测的同一类缺陷：键不含某维度 ⇒ 不同字体共用度量 ⇒ 静默错几何）
        let key = "\(fontSize)\u{1}\(fontWeight)\u{1}\(text)"
        if let hit = measureCache[key] { measureCacheHits += 1; return hit }
        measureCacheMisses += 1
        let font = SelfDrawBridge.font(size: fontSize, weight: fontWeight)
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
    /// 进程内存峰值（MB）——加压测试的「内存天花板」读数
    static var memPeakMB: Double = 0
    static var reportFileName = "selfdraw-report"
    static var snapshotName = "selfdraw-final"

    deinit {
        if handle != 0 { _ = proteus_layout_destroy(handle) }
    }

    func mount(_ treeJson: String) -> String {
        // ★每次 mount 重置内存峰值：加压是**逐档递增**的，峰值必须按档记，
        //   否则高档位的数字里混着低档位的占用，无法判断"哪一档越线"
        SelfDrawBridge.memPeakMB = physFootprintMB()
        // ★重置几何快照（新树 ⇒ 旧快照无意义；否则首帧会把全部节点算成"刚变化"）
        lastGeom.removeAll(keepingCapacity: true)
        lastGeomChanged = 0
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

        // ── ★★文本补丁：**先度量再注入**（本仓实测的闭环缺口）──
        //
        // 【为什么必须在这里做（真机 S4 的根因链）】文本尺寸只能由宿主度量，而核心的
        //   `TableTextMeasurer` 是**按 nodeId 查表**（内容不同 ⇒ 表里的旧尺寸就是错的）。
        //   ⇒ 补丁里带 `text` 时必须：① 用该节点的 fontSize 重新度量 ② `set_text_measures`
        //     注入 ③ 再发补丁 ⇒ 核心才会用**新文本的新尺寸**重排。
        //   ★漏掉任何一步的症状：核心几何按旧尺寸算（字被裁/留白），而**没有任何报错**。
        var measures: [String: [String: Double]] = [:]
        if let d = patchesJson.data(using: .utf8),
           let arr = (try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]] {
            for p in arr {
                // ★形状：`{id, style:{text}}`（与适配器产出、Rust StylePatch **三处同形状**）
                //   本仓实测：首版在此找顶层 `text` ⇒ 度量**一条都没注入** ⇒ 核心按旧尺寸算几何
                //   （字变长了盒子没变 ⇒ 字被裁），而 applied 照数 300 —— 又一处静默形状分叉。
                guard let id = p["id"] as? Int,
                      let style = p["style"] as? [String: Any],
                      let text = style["text"] as? String else { continue }
                // fontSize / fontWeight 取宿主建层时留下的 meta（与全量渲染同源，不猜默认值）
                let fs = (view.fontSizeOf(id: id)).map { CGFloat($0) } ?? 14
                let fw = (view.fontWeightOf(id: id)).map { CGFloat($0) } ?? 400
                let sz = SelfDrawBridge.measureText(text, fontSize: fs, fontWeight: fw)
                measures["\(id)"] = ["width": Double(sz.width), "height": Double(sz.height)]
            }
        }
        if !measures.isEmpty {
            let mj = jsonString2(measures)
            _ = mj.withCString { takeCString(proteus_layout_set_text_measures(handle, $0)) }
        }

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
            let m0 = physFootprintMB()
            SelfDrawBridge.memPeakMB = max(SelfDrawBridge.memPeakMB, m0)
            return jsonString(["ok": true, "path": "updatePatches", "incremental": true,
                               "patch_count": 0, "relayout_count": 0, "changed_rects": 0,
                               "updated_layers": 0, "mem_mb": round(m0 * 10) / 10,
                               "mem_peak_mb": round(SelfDrawBridge.memPeakMB * 10) / 10,
                               "update_ms": round(updateMs * 100) / 100])
        }

        var changed: [(id: Int, abs: CGRect)] = []
        if let rm = o?["rects"] as? [String: [String: Double]] {
            for (k, r) in rm {
                guard let nid = Int(k) else { continue }
                changed.append((id: nid, abs: CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0,
                                                    width: r["width"] ?? 0, height: r["height"] ?? 0)))
            }
        }
        // ★★文本落层（与 applyOps 同一条路：`text_updates` → CATextLayer.string）
        //   见 applyTextUpdates 注释（不落层 = 屏幕文字停留旧值，几何断言发现不了）
        let textUpdates = (o?["text_updates"] as? [String: Any]) ?? [:]
        let textApplied = textUpdates.isEmpty ? 0 : view.applyTextUpdates(textUpdates)

        let tL = CFAbsoluteTimeGetCurrent()
        // ★遗留路径（S2/V0/J 用例走这条）**保持全量更新**：它的语义已进历史读数，
        //   若在此启用「只更可见层」会静默改变那些基线（本仓纪律：改变已发布读数必须显式）。
        //   Vapor 新路径（applyOps）才用 visibleOnly——见其实现。
        let updated = view.updateLayersIncremental(changed: changed, visibleOnly: false)
        let layersMs = (CFAbsoluteTimeGetCurrent() - tL) * 1000
        if updated < 0 {
            return "{\"ok\":false,\"error\":\"变化集与本地层不匹配（需全量重建）\"}"
        }
        let totalMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        let mem = physFootprintMB()
        SelfDrawBridge.memPeakMB = max(SelfDrawBridge.memPeakMB, mem)
        lastTiming = ["measure_ms": 0, "layout_ms": (updateMs * 100).rounded() / 100,
                      "build_layers_ms": (layersMs * 100).rounded() / 100,
                      "host_total_ms": (totalMs * 100).rounded() / 100]
        return jsonString(["ok": true, "path": "updatePatches", "incremental": true,
                           "in_bytes": patchesJson.count,
                           "patch_count": applied, "relayout_count": relayout,
                           "text_updates": textUpdates.count,
                           "text_layers_applied": textApplied,
                           "measures_injected": measures.count,
                           // ★核心分段（本仓纪律：relayout 是文本补丁的主成本，必须可直读——
                           //   否则"优化有没有生效"只能靠推理，而推理在本仓已坑过多次）
                           "relayout_ms": round((((o?["_timing"] as? [String: Any])?["engine_and_relayout_ms"] as? Double) ?? 0) * 100) / 100,
                           // ★引擎内部相位（判定是否真走持久树；键名与 Rust 侧一致）
                           "engine_phases": (o?["_timing"] as? [String: Any])?["phases"] as? [String: Any] ?? [:],
                           // ★度量回调读数（判定"整树重排 19ms 是否花在度量上"的唯一途径）
                           "measure_calls": (o?["measure_calls"] as? Int) ?? 0,
                           "measure_hits": (o?["measure_hits"] as? Int) ?? 0,
                           "engine_diag": (o?["_timing"] as? [String: Any])?["engine_diag"] ?? [:],
                           // ★**整块透传**核心分段（不再逐个字段搬运——本仓实测已漏 3 次）
                           "_timing": o?["_timing"] as? [String: Any] ?? [:],
                           "idmap_ms": round((((o?["_timing"] as? [String: Any])?["idmap_ms"] as? Double) ?? 0) * 100) / 100,
                           "collect_ms": round((((o?["_timing"] as? [String: Any])?["collect_changed_ms"] as? Double) ?? 0) * 100) / 100,
                           "changed_rects": changed.count, "updated_layers": updated,
                           "update_ms": round(updateMs * 100) / 100,
                           "layers_ms": round(layersMs * 100) / 100,
                           // ★三段分解（sort/frames/commit）——定位 layers 残余的唯一依据
                           "host_total_ms": round(totalMs * 100) / 100])
    }

    /// 见协议声明（`paintPatches`）：**不经核心**，直接改层
    func paintPatches(_ patchesJson: String) -> String {
        guard let view = view else { return "{\"ok\":false,\"error\":\"无视图\"}" }
        guard let d = patchesJson.data(using: .utf8),
              let arr = (try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]] else {
            return "{\"ok\":false,\"error\":\"paintPatches 解析失败（需数组）\"}"
        }
        let t0 = CFAbsoluteTimeGetCurrent()
        let applied = view.applyPaintPatches(arr)
        let ms = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        return jsonString(["ok": true, "path": "paintPatches", "incremental": true,
                           "in_bytes": patchesJson.count, "paint_patches": arr.count,
                           "paint_layers_applied": applied,
                           "paint_ms": round(ms * 100) / 100])
    }

    /// ★★**结构变更（增删行）**：把 splice 明细交给核心 + **宿主层树增量增删**
    ///
    /// 【与 updatePatches 的关系】同一条层更新通道（`updateLayersIncremental`），
    ///   差别在**先**增删层子树（核心的响应里给了变化集，新节点的几何就在其中）。
    ///   顺序敏感：① 摘除（先把"死"的层拿掉）→ ② 插入（建出"活"的层）→ ③ 统一设帧
    ///   （按父链深度排序 ⇒ 新节点的父原点一定是**更新过的**；
    ///    若在 ② 里直接设帧，用的是**旧**父原点 ⇒ 几何错，本仓已踩过坐标系双重偏移）。
    ///
    /// 【返回值】`{ ok, removed, inserted, relayout_count, changed_rects, updated_layers, ... }`
    ///   —— `inserted_layers`/`removed_layers` 是**宿主侧实际增删的层数**（与核心的
    ///   removed/inserted 对账：两者不等即"层树与树结构分叉"，必须可观测）。
    func splice(_ spliceJson: String) -> String {
        guard let view = view, handle != 0 else {
            return "{\"ok\":false,\"error\":\"未建树或未接入核心\"}"
        }
        let t0 = CFAbsoluteTimeGetCurrent()

        // ── ⓪ ★宿主度量新插入的文本（文本尺寸只能由宿主算：CoreText / StaticLayout）──
        //
        // 【为什么必须在这里做（本仓实测的静默错几何）】插入的行**必然含文本**，
        //   而文本尺寸不在 style 里——它是 `textMeasures` 表（建树时注入）。新节点不在
        //   任何表里 ⇒ 若不带度量，核心要么按 0 高（修复前：文字消失）、要么按旧表（几何偏）。
        //   ⇒ 本方法把 `inserts[].nodes` 里的文本**就地度量**，并塞进请求的 `textMeasures`。
        //   ★度量规则与全量路径 `render` **逐字一致**（`fontSize ?? 14`）——
        //     两份规则分叉 ⇒ 增量插入的行与全量重建的行**尺寸不同**（且只差在不显眼处）。
        var req = (try? JSONSerialization.jsonObject(with: Data(spliceJson.utf8))) as? [String: Any] ?? [:]
        var measures: [String: [String: Double]] = [:]
        if let inserts = req["inserts"] as? [[String: Any]] {
            for ins in inserts {
                guard let nodes = ins["nodes"] as? [[String: Any]] else { continue }
                for n in nodes {
                    guard let text = n["text"] as? String, !text.isEmpty, let id = n["id"] as? Int else { continue }
                    let fontSize = (n["fontSize"] as? Double).map { CGFloat($0) } ?? 14
                    let fw = (n["fontWeight"] as? Double).map { CGFloat($0) } ?? 400
                    let sz = SelfDrawBridge.measureText(text, fontSize: fontSize, fontWeight: fw)
                    measures["\(id)"] = ["width": Double(sz.width), "height": Double(sz.height)]
                }
            }
        }
        if !measures.isEmpty { req["textMeasures"] = measures }
        let effectiveJson: String = measures.isEmpty
            ? spliceJson
            : (jsonString2(req) as String)

        let out = effectiveJson.withCString { takeCString(proteus_layout_splice(handle, $0)) }
        let spliceMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        guard out.contains("\"ok\":true") else {
            return "{\"ok\":false,\"error\":\"splice 失败\",\"raw\":\(jsonEscape(String(out.prefix(300))))}"
        }
        let o = (try? JSONSerialization.jsonObject(with: Data(out.utf8))) as? [String: Any]
        let removed = (o?["removed"] as? Int) ?? 0
        let inserted = (o?["inserted"] as? Int) ?? 0
        let relayout = (o?["relayout_count"] as? Int) ?? 0

        // ★请求明细（removes/inserts）——宿主层维护的依据（核心只看几何，不看层）
        let reqObj = (try? JSONSerialization.jsonObject(with: Data(spliceJson.utf8))) as? [String: Any]
        let reqRemoves = (reqObj?["removes"] as? [Int]) ?? []
        let reqInserts = (reqObj?["inserts"] as? [[String: Any]]) ?? []

        // ① 摘除层子树
        view.resetSpliceCounters()
        for rid in reqRemoves { view.removeLayersSubtree(rootId: rid) }
        // ② 插入新层（几何由 ③ 统一设）
        let insertedLayers = view.insertLayers(reqInserts)

        // ③ 变化集 → 统一设帧（含新节点；按父链深度排序在 updateLayersIncremental 内）
        var changed: [(id: Int, abs: CGRect)] = []
        if let rm = o?["rects"] as? [String: [String: Double]] {
            for (k, r) in rm {
                guard let nid = Int(k) else { continue }
                changed.append((id: nid, abs: CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0,
                                                    width: r["width"] ?? 0, height: r["height"] ?? 0)))
            }
        }
        // ★★**以核心为准收口层序**（见 applyChildOrder 注释：自行推导会分叉）
        let coreChildren = (o?["child_order"] as? [String: [Int]]) ?? [:]
        let co = view.applyChildOrder(coreChildren)
        // ★对**真实层序**对账（不是对宿主自报的簿记——后者刚被写过，必然相等 = 空判据）
        let recon = view.reconcileChildOrderLegacy(coreChildren: coreChildren)

        let tL = CFAbsoluteTimeGetCurrent()
        let updated = view.updateLayersIncremental(changed: changed, visibleOnly: SelfDrawBridge.optMode == "v4")
        let layersMs = (CFAbsoluteTimeGetCurrent() - tL) * 1000
        if updated < 0 {
            // ★层树与树结构分叉 ⇒ 必须重发整树（调用方据 full_required 走全量）
            return "{\"ok\":false,\"full_required\":true,\"error\":\"变化集与本地层不匹配（需全量重建）\"}"
        }
        let totalMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        let mem = physFootprintMB()
        SelfDrawBridge.memPeakMB = max(SelfDrawBridge.memPeakMB, mem)
        let t = (o?["timing"] as? [String: Any]) ?? [:]
        // ★插入文本的度量自检（见 insertedTextZeroHeight 的说明）——**设备侧判据**
        let tx = view.insertedTextZeroHeight()
        lastTiming = ["measure_ms": 0, "layout_ms": (spliceMs * 100).rounded() / 100,
                      "build_layers_ms": (layersMs * 100).rounded() / 100,
                      "host_total_ms": (totalMs * 100).rounded() / 100]
        return jsonString(["ok": true, "path": "splice", "incremental": true,
                           "in_bytes": spliceJson.count,
                           "removed": removed, "inserted": inserted,
                           "removed_layers": view.lastSpliceRemoved,
                           "inserted_layers": insertedLayers,
                           // ★内存回收读数（孤点压实：`[前, 后]` / 当前孤点数 / 节点总数）
                           "compacted": o?["compacted"] ?? NSNull(),
                           "orphans": o?["orphans"] ?? 0,
                           "core_node_count": o?["node_count"] ?? 0,
                           "child_order_applied": co.applied,
                           "child_order_missing": co.missing,
                           "child_order_checked": recon.checked,
                           "child_order_mismatches": recon.mismatches,
                           "inserted_text_layers": tx.text,
                           "inserted_text_zero_height": tx.zero,
                           "inserted_text_missing_geom": tx.missing,
                           "relayout_count": relayout,
                           "changed_rects": changed.count, "updated_layers": updated,
                           "splice_ms": round(spliceMs * 100) / 100,
                           "relayout_ms": round(((t["relayout_ms"] as? Double) ?? 0) * 100) / 100,
                           "layers_ms": round(layersMs * 100) / 100,
                           "layer_count": view.builtLayerCount,
                           "mem_mb": round(mem * 10) / 10,
                           "mem_peak_mb": round(SelfDrawBridge.memPeakMB * 10) / 10,
                           "host_total_ms": round(totalMs * 100) / 100])
    }

    /* ────────────────────────── ★V9：命中测试 → JS 派发 ────────────────────────── */

    /// ★★**触摸 → 命中（核心）→ 派发（JS）** 的唯一落点
    ///
    /// 【分工（本仓分层设计）】
    ///   · `SelfDrawView`：触摸 → **内容坐标** + tap 时序判定（不碰核心/JS）
    ///   · **本方法**：调核心 `proteus_layout_hit_test` 拿 `target` + **冒泡链 `chain`**
    ///   · JS 适配器 `dispatchEvent`：沿 chain 派发（DOM 冒泡语义，见其注释）
    ///
    /// 【为什么命中在核心而不是宿主自己算】本仓已有教训（层序/坐标系）：**同一事实只认一个来源**。
    ///   几何与可见性都在核心（含 `display:none`、overflow 裁剪）⇒ 宿主自己按 rectangle 叠层
    ///   判断必然与核心分歧（且分歧只在特定布局下暴露）。
    ///
    /// 【为什么把 chain 原样传下去】DOM 语义要求沿祖先链冒泡；核心已算好（含"子级溢出父盒"的
    ///   特例，见 hit.rs 模块头）⇒ 宿主与 JS 都**不该自己推**。
    func emitGesture(x: Double, y: Double, type: String) {
        guard handle != 0 else { return }
        let out = takeCString(proteus_layout_hit_test(handle, Float(x), Float(y)))
        guard let d = out.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              (o["ok"] as? Bool) == true else {
            gestureStats["hit_errors"] = (gestureStats["hit_errors"] as? Int ?? 0) + 1
            return
        }
        gestureStats["hits"] = (gestureStats["hits"] as? Int ?? 0) + 1
        // 未命中：只记账（不派发——没有 target 就没有 event.target）
        guard let target = o["target"] as? Int else {
            gestureStats["misses"] = (gestureStats["misses"] as? Int ?? 0) + 1
            return
        }
        let chain = (o["chain"] as? [Int]) ?? [target]
        // ★记录本次命中的 target/链长（诊断：见 tapAt 注释）
        gestureStats["last_target"] = target
        gestureStats["last_chain_len"] = chain.count
        // ★交给 JS（经 JSContext 从控制器注入；桥接层不直接持有 ctx，避免循环引用）
        onDispatchToJS?(target, chain, type, x, y)
    }

    /// JS 派发回调（由控制器注入：调 `__proteus_dispatch`）
    var onDispatchToJS: ((Int, [Int], String, Double, Double) -> Void)?

    /// 手势统计（诊断：命中/未命中/错误——证明"触摸真的走到了核心"）
    private(set) var gestureStats: [String: Int] = [:]

    /// 见协议声明（`tapAt`）
    func tapAt(_ x: Double, _ y: Double) -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未建树\"}" }
        emitGesture(x: x, y: y, type: "tap")
        // ★回传**本次命中的 target/chain**（诊断必需——本仓实测：没有它就无法定位
        //   "宿主命中但 JS 没收到"是命中错节点、还是派发链断了）
        let lastTarget = gestureStats["last_target"] ?? -1
        let lastChain = gestureStats["last_chain_len"] ?? 0
        return jsonString(["ok": true, "x": x, "y": y, "target": lastTarget,
                           "chain_len": lastChain, "stats": gestureStats])
    }

    /// 见协议声明（`gestureStatsJson`）
    func gestureStatsJson() -> String {
        jsonString(["ok": true, "stats": gestureStats])
    }

    /// ★高分辨率单调时钟（微秒）。用 mach_absolute_time + timebase 换算——
    ///   比 `CFAbsoluteTimeGetCurrent` 更适合**测量**（不受系统时间调整影响）。
    private static let timebase: mach_timebase_info_data_t = {
        var tb = mach_timebase_info_data_t()
        mach_timebase_info(&tb)
        return tb
    }()

    func scrollBy(_ dx: Double, _ dy: Double) -> String {
        guard let view = view else { return "{\"ok\":false,\"error\":\"无视图\"}" }
        // ★滚动 = 移动**内容**（视口固定）：根层的 sublayerTransform/position 平移 + 记账偏移
        //   （不用 UIScrollView——本自绘层树由 native-host 跟随，滚动是根层偏移）
        let off = view.applyContentOffset(dx: CGFloat(dx), dy: CGFloat(dy))
        // 显式触发补刷（确定性：测试里不依赖 UIKit 的回调时机）
        view.setNeedsLayout()
        view.layoutSubviews()
        return "{\"ok\":true,\"flushed\":\(view.lastFlushedCount),\"offsetY\":\(Double(off.y))}"
    }

    /// ★★V5：批量像素采样（渲染一次 → 读 N 个点）
    ///
    /// 【为什么"渲染一次读多点"】逐点调用会各渲染一次（每次 `layer.render` 都不便宜）；
    ///   采样点通常十几个 ⇒ 一次渲染 + 多次读取，成本降一个量级。
    func samplePixels(_ json: String) -> String {
        guard let view = view else { return "{\"ok\":false,\"error\":\"无视图\"}" }
        guard let data = json.data(using: .utf8),
              let pts = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Double]] else {
            return "{\"ok\":false,\"error\":\"points 解析失败（需数组）\"}"
        }
        let size = view.bounds.size
        guard size.width > 0, size.height > 0 else {
            return "{\"ok\":false,\"error\":\"视图尺寸为 0\"}"
        }
        // ★渲染一次（与 snapshot 同款：layer.render —— UIKit 的 snapshotView 不含 CALayer 子层）
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1 // ★scale=1 ⇒ 1 点 = 1 像素，采样坐标与逻辑点一一对应（免去换算）
        let renderer = UIGraphicsImageRenderer(size: size, format: fmt)
        let img = renderer.image { ctx in
            view.layer.render(in: ctx.cgContext)
        }
        guard let cg = img.cgImage else { return "{\"ok\":false,\"error\":\"无 CGImage\"}" }
        guard let provider = cg.dataProvider, let cfData = provider.data else {
            return "{\"ok\":false,\"error\":\"无像素数据\"}"
        }
        let ptr = CFDataGetBytePtr(cfData)!
        let bpr = cg.bytesPerRow
        let bpp = cg.bitsPerPixel / 8
        let w = cg.width
        let h = cg.height
        var out: [String] = []
        for p in pts {
            let x = Int(p["x"] ?? 0)
            let y = Int(p["y"] ?? 0)
            guard x >= 0, y >= 0, x < w, y < h else {
                out.append("out-of-bounds")
                continue
            }
            let off = y * bpr + x * bpp
            // ★★字节序：实测为 **RGBA**（不是我在注释里先验假设的 BGRA）
            //
            // 【怎么确定的（值得记）】用三块**纯色标定**（纯红/纯绿/纯蓝）采样后比对：
            //   · 期望（第 1 块）纯红 `#FF0000` ⇒ 实得 `#0000FF`
            //   · 第 2 块纯绿 `#00FF00` ⇒ 实得 `#00FF00` ✓
            //   ⇒ **红蓝互换** ⇒ 本机 CGImage 是 RGBA 布局。
            //   ★如果只按"文档常见值"猜（我首版就猜了 BGRA），会得到一个**看起来合理但错**的读数
            //     ——正是本仓反复吃亏的"先验假设 vs 实测"。
            let r = ptr[off], g = ptr[off + 1], b = ptr[off + 2]
            out.append(String(format: "#%02X%02X%02X", r, g, b))
        }
        let payload: [String: Any] = ["ok": true, "pixels": out, "size": ["w": Double(w), "h": Double(h)]]
        return jsonString(payload)
    }

    func pendingStats() -> String {
        guard let view = view else { return "{\"ok\":false}" }
        return "{\"ok\":true,\"pending\":\(view.pendingCount),\"last_flushed\":\(view.lastFlushedCount),\"last_deferred\":\(view.lastDeferredCount)}"
    }

    /// V4 优化开关（默认开；A/B 时置 'v3'）
    static var optMode = "v4"

    func setOptMode(_ mode: String) -> String {
        SelfDrawBridge.optMode = (mode == "v3") ? "v3" : "v4"
        return "{\"ok\":true,\"mode\":\"\(SelfDrawBridge.optMode)\"}"
    }

    func nowUs() -> String {
        let tb = Self.timebase
        let ticks = mach_absolute_time()
        // 纳秒 = ticks * numer / denom；微秒 = 纳秒 / 1000
        let nanos = Double(ticks) * Double(tb.numer) / Double(tb.denom)
        let micros = nanos / 1000.0
        // %.3f：微秒级分辨率留小数点后 3 位（纳秒级尾数），实测可达
        return String(format: "%.3f", micros)
    }

    /// ★Vapor IR V3：应用二进制指令流（字节数组 JSON → Rust 侧解码 + 应用 + 多范围重排）
    ///
    /// 【诚实边界】本方法**只做通道**：几何由 Rust 的 `proteus_layout_apply_ops` 算，
    ///   layer 更新复用既有的 `updateLayersIncremental`（与 updatePatches 同一条路径）。
    ///   V3 交付的是「二进制指令流能驱动真机几何」这条**通路**，不改既有绘制逻辑。
    func applyOps(_ opsBytesJson: String) -> String {
        guard let view = view, handle != 0 else {
            return "{\"ok\":false,\"error\":\"未建树或未接入核心\"}"
        }
        let t0 = CFAbsoluteTimeGetCurrent()
        // 字节数组 JSON → [UInt8]（如 "[2,0,0,0,1,0,...]"）
        guard let data = opsBytesJson.data(using: .utf8),
              let arr = (try? JSONSerialization.jsonObject(with: data)) as? [Int] else {
            return "{\"ok\":false,\"error\":\"opsBytes 解析失败（需字节数组 JSON）\"}"
        }
        var bytes = [UInt8](repeating: 0, count: arr.count)
        for (i, v) in arr.enumerated() where v >= 0 && v <= 255 { bytes[i] = UInt8(v) }

        // ★v4 模式走 **norects** 入口：矩形已由二进制通道取，JSON 里不再冗余携带
        //   （本仓实测：4003 条的序列化 ~10ms + 宿主解析 ~19ms 全是白付）
        let useV4ForOut = (SelfDrawBridge.optMode == "v4")
        let out: String = bytes.withUnsafeBufferPointer { buf in
            guard let base = buf.baseAddress else { return "{\"ok\":false,\"error\":\"空指令流\"}" }
            if useV4ForOut {
                return takeCString(proteus_layout_apply_ops_norects(handle, base, UInt32(buf.count)))
            }
            return takeCString(proteus_layout_apply_ops(handle, base, UInt32(buf.count)))
        }
        let applyMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        guard out.contains("\"ok\":true") else {
            return "{\"ok\":false,\"error\":\"applyOps 失败\",\"raw\":\(jsonEscape(String(out.prefix(300))))}"
        }
        let tParse0 = CFAbsoluteTimeGetCurrent()
        let o = (try? JSONSerialization.jsonObject(with: Data(out.utf8))) as? [String: Any]
        let applied = (o?["applied"] as? Int) ?? 0
        let relayout = (o?["relayout_count"] as? Int) ?? 0
        let scopes = (o?["scopes"] as? [Int]) ?? []
        let unsupported = (o?["unsupported"] as? [[String: Any]]) ?? []

        // ★矩形解析单独计时（本题材实测：类B 场景 4003 条矩形，JSON 解析 **19.35ms**——最大单项）
        let rectsParseMs = (CFAbsoluteTimeGetCurrent() - tParse0) * 1000

        // ★★V4：变化集走**二进制**（不再解析 JSON 的 rects 字段）
        //
        // 【为什么（V3 真机读数）】类B 分解：rects_parse 19.35ms · apply 15.43ms · layers 13.34ms
        //   ⇒ 返回通道的 JSON 解析是最大单项。格式见 `rects_bin.rs`（16B 头 + 20B/条，全小端）。
        //   体积对照：4003 条 222KB(JSON) → 80KB(本格式)，且解码是顺序读。
        let tBin0 = CFAbsoluteTimeGetCurrent()
        var outLen: UInt32 = 0
        var changed: [(id: Int, abs: CGRect)] = []
        let useV4 = (SelfDrawBridge.optMode == "v4")
        if !useV4, let rm = o?["rects"] as? [String: [String: Double]] {
            // 'v3' 模式：走 JSON 矩形（与优化前一致；用于 A/B 对照）
            for (k, r) in rm {
                guard let nid = Int(k) else { continue }
                changed.append((id: nid, abs: CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0,
                                                    width: r["width"] ?? 0, height: r["height"] ?? 0)))
            }
        }
        let binPtr: UnsafeMutablePointer<UInt8>? = useV4 ? proteus_layout_rects_bin(handle, &outLen) : nil
        // ★判据用 outLen（Rust 侧失败时把它置 0）+ 指针存在性
        if let bp = binPtr, outLen >= 16 {
            let buf = UnsafeBufferPointer(start: bp, count: Int(outLen))
            // 顺序读：magic(4) version(4) count(4) reserved(4) 之后是 count × (id u32 + 4 × f32)
            let u32at: (Int) -> UInt32 = { o in
                UInt32(buf[o]) | (UInt32(buf[o + 1]) << 8) | (UInt32(buf[o + 2]) << 16) | (UInt32(buf[o + 3]) << 24)
            }
            let f32at: (Int) -> Float = { o in Float(bitPattern: u32at(o)) }
            let count = Int(u32at(8))
            if count > 0 && 16 + count * 20 <= Int(outLen) {
                changed.reserveCapacity(count)
                for i in 0..<count {
                    let o = 16 + i * 20
                    changed.append((id: Int(u32at(o)),
                                    abs: CGRect(x: CGFloat(f32at(o + 4)), y: CGFloat(f32at(o + 8)),
                                                width: CGFloat(f32at(o + 12)), height: CGFloat(f32at(o + 16)))))
                }
            }
            proteus_rects_free(bp, outLen)
        }
        let rectsBinMs = (CFAbsoluteTimeGetCurrent() - tBin0) * 1000

        // ★★文本更新落层（见 applyTextUpdates 注释）
        let textUpdates = (o?["text_updates"] as? [String: Any]) ?? [:]
        let textApplied = textUpdates.isEmpty ? 0 : view.applyTextUpdates(textUpdates)

        // ★★几何变化量自检：与上一帧快照比对，统计**真的移动/改尺寸**的节点数
        //
        // 【判据意义】若这个数为 0，说明本次"更新"对几何无影响
        //   ⇒ 此时报告的耗时**不能**用来论证"重排有多快"（可能全在搬运空变化）
        var geomChanged = 0
        for c in changed {
          let sig = "\(c.abs.origin.x),\(c.abs.origin.y),\(c.abs.size.width),\(c.abs.size.height)"
          if lastGeom[c.id] != sig { geomChanged += 1 }
          lastGeom[c.id] = sig
        }
        lastGeomChanged = geomChanged
        let updated = view.updateLayersIncremental(changed: changed, visibleOnly: useV4)
        let layerTiming = view.lastLayerTiming
        let layersMs = layerTiming["total_ms"] ?? 0
        let totalMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        let mem = physFootprintMB()
        SelfDrawBridge.memPeakMB = max(SelfDrawBridge.memPeakMB, mem)
        lastTiming = ["measure_ms": 0, "layout_ms": (applyMs * 100).rounded() / 100,
                      "build_layers_ms": (layersMs * 100).rounded() / 100,
                      "host_total_ms": (totalMs * 100).rounded() / 100]
        return jsonString(["ok": true, "path": "applyOps", "incremental": true,
                           "in_bytes": bytes.count,
                           "patch_count": applied, "relayout_count": relayout,
                           "scopes": scopes, "changed_rects": changed.count, "updated_layers": updated,
                           "unsupported_count": unsupported.count,
                           "text_updates": textUpdates.count,
                           "text_layers_applied": textApplied,
                           "apply_ms": round(applyMs * 100) / 100,
                           // ★Rust 侧分段（本仓实测：总账 72ms 里约 40ms 曾"去向不明"——
                           //   因为 apply_ms 只覆盖「指令应用」，**不含重排**（relayout_ms 在 timing 里没被浮出）
                           "relayout_ms": round((((o?["timing"] as? [String: Any])?["relayout_ms"] as? Double) ?? 0) * 100) / 100,
                           "collect_ms": round((((o?["timing"] as? [String: Any])?["collect_ms"] as? Double) ?? 0) * 100) / 100,
                           "rects_parse_ms": round(rectsParseMs * 100) / 100,
                           "rects_bin_ms": round(rectsBinMs * 100) / 100,
                           "opt_mode": SelfDrawBridge.optMode,
                           // ★layers 三段分解（V4 下半：定位残余的唯一依据）
                           "layers_sort_ms": round((layerTiming["sort_ms"] ?? 0) * 100) / 100,
                           "layers_frames_ms": round((layerTiming["frames_ms"] ?? 0) * 100) / 100,
                           "layers_commit_ms": round((layerTiming["commit_ms"] ?? 0) * 100) / 100,
                           "geom_changed": geomChanged,
                           "geom_total": changed.count,
                           "deferred": view.lastDeferredCount,
                           "flushed": view.lastFlushedCount,
                           "stale_cleared": view.lastStalePendingCleared,
                           "pending_visible_overlap": view.lastPendingVisibleOverlap,
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
            let fw = (n["fontWeight"] as? Double).map { CGFloat($0) } ?? 400
            let sz = SelfDrawBridge.measureText(text, fontSize: fontSize, fontWeight: fw)
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
        let memStart = physFootprintMB()
        // ★峰值随行就市更新（increment 场景下内存不回落，峰值才有意义）
        SelfDrawBridge.memPeakMB = max(SelfDrawBridge.memPeakMB, memStart)
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
                // ★遗留路径（整树 diff 的 update()）同样保持全量更新——理由见 updatePatches
                let updatedLayers = view.updateLayersIncremental(changed: changed, visibleOnly: false)
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
                        "mem_mb": round(physFootprintMB() * 10) / 10,
                        "mem_peak_mb": round(SelfDrawBridge.memPeakMB * 10) / 10,
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
            if let fw = n["fontWeight"] as? Double { style["fontWeight"] = CGFloat(fw) }
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
            // ★度量读数（跨节点复用的判据：同文案应只真实度量少数次）
            "measure_cache_hits": SelfDrawBridge.measureCacheHits,
            "measure_cache_misses": SelfDrawBridge.measureCacheMisses,
            "mem_mb": round(physFootprintMB() * 10) / 10,
            "mem_peak_mb": round(SelfDrawBridge.memPeakMB * 10) / 10,
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
        BenchDone.flag = true
        var out: [String: Any] = [:]
        out["engine"] = takeCString(proteus_layout_version())
        out["js_report"] = jsReport
        out["host_timing_last"] = lastTiming
        out["host_node_count"] = lastNodeCount
        out["tree_hash"] = lastTreeHash
        out["layer_count"] = view?.builtLayerCount ?? -1
        // ★白屏诊断（见 SelfDrawViewController.launchDiag 注释）
        out["launch_diag"] = SelfDrawViewController.launchDiag
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

    /// ★★**白屏诊断读数**（本仓实测：用户观察到"启动白一下"，需可客观归因）
    ///
    /// 【为什么记这三个】启动白屏有三种成因，读数能直接区分：
    ///   ① `interface_style` = Light + `launch_bg` 未设 ⇒ **启动屏是白**（系统背景色）
    ///      ⇒ 用户看到 白→黑→内容（"白闪"）。修法：`UIUserInterfaceStyle=Dark`（本仓已加）
    ///   ② `first_frame_ms` 大 ⇒ 首帧慢（内核初始化/JS 加载），与启动屏无关
    ///   ③ `mount_ms` 大 ⇒ 内容上屏慢（布局/建层），那是"内容白屏"
    static var launchDiag: [String: Any] = [:]
    /// 进程启动时刻（用于算到首帧/挂载的耗时）
    static var processStart: CFAbsoluteTime = CFAbsoluteTimeGetCurrent()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        // ★★白屏诊断（见 launchDiag 注释）：
        //   · `interface_style`：当前外观模式（浅色 ⇒ 若启动屏背景未设，启动瞬间是**白**）
        //   · `launch_bg`：Info.plist 里 `UILaunchScreen` 是否配了背景色
        //   · `first_frame_ms`：进程启动 → 本方法（首个 UI 帧建立）的耗时
        let style: String
        if #available(iOS 13.0, *) {
            style = traitCollection.userInterfaceStyle == .dark ? "Dark" : "Light"
        } else {
            style = "unknown"
        }
        let launchCfg = (Bundle.main.object(forInfoDictionaryKey: "UILaunchScreen") as? [String: Any]) ?? [:]
        let forcedStyle = (Bundle.main.object(forInfoDictionaryKey: "UIUserInterfaceStyle") as? String) ?? "(未设置)"
        Self.launchDiag = [
            "interface_style": style,
            "forced_style": forcedStyle,
            "launch_screen_keys": Array(launchCfg.keys).sorted(),
            "first_frame_ms": round((CFAbsoluteTimeGetCurrent() - Self.processStart) * 1000 * 100) / 100,
        ]

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
        // ★★V9：把「触摸 → 命中 → JS 派发」接上（此前这条链**从未接线** ⇒ 自绘场景不能交互）
        //
        // 方向：`SelfDrawView.onGesture`（触摸）→ `bridge.emitGesture`（命中）
        //       → `onDispatchToJS`（本闭包）→ JS 的 `__proteus_dispatch`（适配器 dispatchEvent）
        // ★用闭包而非桥接层直持 ctx：避免「桥 ↔ ctx」循环引用（ctx 强引用桥）
        bridge.view?.onGesture = { [weak bridge] x, y, type in
            bridge?.emitGesture(x: x, y: y, type: type)
        }
        bridge.onDispatchToJS = { [weak ctx] target, chain, type, x, y in
            guard let ctx = ctx else { return }
            guard let fn = ctx.objectForKeyedSubscript("__proteus_dispatch") else { return }
            // ★`call(withArguments:)` 传原生数组（JSContext 自动桥接为 JS Array/Number）
            _ = fn.call(withArguments: [target, chain, type, x, y])
        }

        // 异常可观测（否则 JS 报错静默失败）
        ctx.exceptionHandler = { _, exc in
            NSLog("[proteus] JS 异常: %@", exc?.toString() ?? "?")
        }

        // ★模式：`--bench` 跑逻辑层基准（复杂响应式用例 + 规模扫描），否则跑自绘场景
        let isBench = ProcessInfo.processInfo.arguments.contains("--bench")
        // ★★用例过滤（`--cases=S5,V4`）：只跑指定前缀的用例
        //
        // 【为什么需要（效率纪律：定向验证不得跑全量）】bench 有 46 个用例、全套数分钟；
        //   而验证某个改动往往只需 2–4 个用例（如 S5 结构变更）。没有过滤就只能整套跑，
        //   与「全量单测不得无目的重复」同源的浪费。
        //   注入全局量（而非改 bundle）：JS 侧读 `__PROTEUS_CASES__` 自行过滤，两端解耦。
        let caseFilter = ProcessInfo.processInfo.arguments
            .first { $0.hasPrefix("--cases=") }?
            .dropFirst("--cases=".count)
            .split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) } ?? []
        if isBench {
            // ★★过滤跑写**独立文件**（本仓实测踩到的坑，代价=白等 10 分钟）
            //
            // 【故障链】过滤跑与全量跑写同一个 `logic-bench-report` ⇒ ① 会**覆盖全量基准**
            //   （历史读数不可再生）；② 取报告的脚本若按过滤名去拉，设备上**永远没有那个文件**
            //   ⇒ 拷贝静默失败（`|| true`）⇒ 空等到超时，现象是"App 明明起来了、脚本毫无输出"。
            //   ⇒ 正解：**文件名由同一处（宿主）决定并让两端一致**：
            //     有过滤 → `bench-filtered-<slug>`；无过滤 → `logic-bench-report`。
            if caseFilter.isEmpty {
                SelfDrawBridge.reportFileName = "logic-bench-report"
                SelfDrawBridge.snapshotName = "bench-final"
            } else {
                // slug 规则必须与 run-selfdraw.sh 的 `tr ',' '_'` 一致（两端同一命名规则）
                let slug = caseFilter.joined(separator: "_")
                SelfDrawBridge.reportFileName = "bench-filtered-\(slug)"
                SelfDrawBridge.snapshotName = "bench-filtered-\(slug)"
            }
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
        if !caseFilter.isEmpty {
            let arr = caseFilter.map { "\"\($0)\"" }.joined(separator: ",")
            ctx.evaluateScript("var __PROTEUS_CASES__ = [\(arr)];")
            NSLog("[proteus] 用例过滤：%@", caseFilter.joined(separator: ","))
        }
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
    /// ★★bench 驱动：**只负责泵微任务**，不干预用例推进
    ///
    /// 【为什么这么简单（本仓实测的教训）】初版由宿主逐用例 `step()` 并等 `completed` 增长；
    ///   一旦某个用例异常被吞，`completed` 永不增长 ⇒ 宿主无限等待 ⇒ **JS 空转 88 秒**
    ///   ⇒ 被 iOS 看门狗杀掉（现象：白屏几秒后闪退）。
    ///   ⇒ 现在：JS 侧 `runAll()` 一次性把整条用例链排进微任务；宿主只做**两件事**：
    ///     ① 反复让出主线程（让 JSC 排空微任务队列）② 看 `done()` 标志是否置位
    ///   ★同时加**总时长上限**：到点就收尾报告，绝不无限泵（本仓「等待必须有条件」纪律）。
    /// ★★bench 驱动：**一次一个用例**（本仓实测的关键修复）
    ///
    /// 【为什么不能一次性排完（真机看门狗实证）】曾把整条用例链一次性排进微任务，
    ///   而 JSC 在 `evaluateScript` 返回时会**把队列一次排空** ⇒ 23 个用例（含 4000 项挂载）
    ///   连续跑完、**中间从不回主线程** ⇒ 主线程 88 秒无响应 ⇒ 被 iOS 看门狗杀掉
    ///   （现象：白屏几秒后闪退；`cpu_resource` 日志显示 Total CPU Time 88.2s 全在 JavaScriptCore）。
    ///   ⇒ 正解：**每个用例一次 `step()`**，用例之间让出主线程（runloop 呼吸）。
    ///
    /// 【两个上限（本仓「等待必须有条件」纪律）】
    ///   · 单用例泵动轮数上限（防某个用例卡死）
    ///   · 总时长上限（超时也写报告，绝不无限等）
    private func driveBench(ctx: JSContext) {
        let evalJs = { (expr: String) -> String in ctx.evaluateScript(expr)?.toString() ?? "null" }
        let t0 = CFAbsoluteTimeGetCurrent()
        let totalSecLimit = 300.0
        let perCaseRoundLimit = 3000
        var roundsForCase = 0
        var beforeCompleted = 0

        func num(_ json: String, _ key: String) -> Int {
            guard let r = json.range(of: "\"\(key)\":") else { return 0 }
            let rest = json[r.upperBound...].drop(while: { $0 == " " })
            return Int(rest.prefix(while: { $0.isNumber })) ?? 0
        }

        func nextCase() {
            let elapsed = CFAbsoluteTimeGetCurrent() - t0
            if elapsed > totalSecLimit {
                NSLog("[proteus] bench 总时长超 %.0fs —— 强制收尾（已完成 %d）", totalSecLimit, beforeCompleted)
                _ = evalJs("__proteus.finish()")
                return
            }
            let out = evalJs("__proteus.step()")
            if out.contains("\"done\":true") {
                let fin = evalJs("__proteus.finish()")
                NSLog("[proteus] bench 全部完成（%.1fs）：%@", elapsed, String(fin.prefix(160)))
                return
            }
            roundsForCase = 0
            waitCase()
        }

        /// 等**当前用例**跑完（`completed` 增长），期间让出主线程
        func waitCase() {
            roundsForCase += 1
            let prog = evalJs("__proteus.progress()")
            let completed = num(prog, "completed")
            if completed > beforeCompleted {
                beforeCompleted = completed
                // 每 2 个用例报一次（避免日志爆炸）
                if completed % 2 == 1 {
                    NSLog("[proteus] bench %d/%d（%.1fs，本轮泵 %d）", completed, num(prog, "total"),
                          CFAbsoluteTimeGetCurrent() - t0, roundsForCase)
                }
                DispatchQueue.main.async { nextCase() }
                return
            }
            if roundsForCase > perCaseRoundLimit {
                NSLog("[proteus] bench 用例泵动超限（%d 轮）——跳过并继续", perCaseRoundLimit)
                DispatchQueue.main.async { nextCase() }
                return
            }
            DispatchQueue.main.async { waitCase() }
        }

        nextCase()
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
