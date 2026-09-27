// hosts/ios/ProteusHost/layout-core-bench.swift
// ★★M4 主体：**iOS 端 4050 元素测试**（与 Android §9.2 同规模），验证三件事：
//   ① **Rust 排版核心驱动 CALayer 树**（几何全部来自 `proteus_layout_*`）
//   ② **拍平 vs 不拍平**（方案 §9.4 的 iOS 硬约束 1：layer tree 越扁平越好）
//   ③ **内存 vs 原生**（方案 §9.4 指标：iOS 端内存增量 ≤ 原生 × 1.15）
//
// 【测试定义（与 Android §9.2 严格同规格，否则数据不可比）】
//   2000 个 view（各含 1 个 text）分 50 行 × 40 个，每行外层套 1 个 view → 合计 **4051 节点**。
//
// 【三种形态（本文件的核心对照）】
//   · **拍平**：50 个 row layer，每行把 40 个色块 + 40 段文本绘制进**该 row 自己的 backing store**
//     —— 方案 §12.3「真拍平：绘制到父 layer 已有的 backing store」（本仓实测 129.9ms/17.7MB 双优）
//   · **不拍平**：4051 个 layer（每元素一个）—— 方案 §12.3 的反面
//   · **原生**：UIView + UILabel（对照组；方案 §9.4 的内存基准）
//
// 【内存测量】`task_vm_info.phys_footprint`（iOS 上最接近「真实占用」的口径）
//
// 【运行】bash hosts/ios/run-layout-bench.sh
import UIKit

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

func takeString(_ ptr: UnsafeMutablePointer<CChar>) -> String {
    defer { proteus_layout_free_string(ptr) }
    return String(cString: ptr)
}

/// 当前进程的真实内存占用（MB）——iOS 上 `phys_footprint` 是最贴近「真实占用」的口径
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

/* ────────────────────────── 测试规格（与 §9.2 同） ────────────────────────── */

enum BenchSpec {
    static let rows = 50
    static let cols = 40
    static let itemW: CGFloat = 30
    static let itemH: CGFloat = 18
    static let textSample = "item"

    /// **4051 节点**的布局请求 —— 对齐 §9.2 的「2000 view + 2000 text + 50 row + 1 root」
    ///
    /// ★★规格修正（本仓实测发现）：初版每个 item 只建**一个**节点（用 `isText:true` 标记），
    ///   实际只有 2051 节点 —— 与 §9.2 的 4051 **不符**。
    ///   正解：每个 item 拆成 **view（色块，尺寸由内容撑开）+ text（子节点）** 两个节点，
    ///   这正是 §9.2 原文「每个 view 设背景色，每个 view 内嵌 1 个 text；view 不设宽高，
    ///   尺寸由内部文字撑开」的准确实现。
    /// ★平台文本度量（模拟 CoreText 量出的 "item" 尺寸）——**必须提供**：
    ///   §9.2 要求 item 不设宽高（尺寸由内部文字撑开）→ 无度量则尺寸为 0（本仓实测踩到）。
    ///   真实实现里这是**平台注入**的度量回调（CoreText/StaticLayout），这里用固定值模拟。
    static let textSize = CGSize(width: 24, height: 14)

    static func requestJSON() -> String {
        var s = "{\"viewport\":{\"width\":750,\"height\":2400},\"nodes\":["
        s += "{\"id\":1,\"parentId\":null,\"width\":750.0,\"flexDirection\":\"column\"}"
        var id = 2
        var textIds: [Int] = []
        for _ in 0..<rows {
            s += ",{\"id\":\(id),\"parentId\":1,\"flexDirection\":\"row\",\"gap\":4.0,\"flexShrink\":0.0}"
            let rowId = id
            id += 1
            for _ in 0..<cols {
                // ① view（色块）：**不设宽高** —— 尺寸由内部 text 撑开（§9.2 明确要求）
                let itemId = id
                s += ",{\"id\":\(itemId),\"parentId\":\(rowId),\"flexShrink\":0.0}"
                id += 1
                // ② text 子节点
                s += ",{\"id\":\(id),\"parentId\":\(itemId),\"flexShrink\":0.0,\"isText\":true}"
                textIds.append(id)
                id += 1
            }
        }
        s += "],\"textMeasures\":{"
        var first = true
        for tid in textIds {
            if !first { s += "," }
            first = false
            s += "\"\(tid)\":{\"width\":\(String(format: "%.1f", textSize.width)),\"height\":\(String(format: "%.1f", textSize.height))}"
        }
        s += "}}"
        return s
    }
}

/* ────────────────────────── 场景视图 ────────────────────────── */

final class BenchView: UIView {
    private let contentLayer = CALayer()
    private var allLayers: [CALayer] = []
    /// 每行的绘制清单（拍平模式用：row layer 的 delegate 据此绘制该行内容）
    // ★`internal`（非 private）：CALayerDelegate 扩展需要访问（同文件同模块）
    var flatRowItems: [[CGFloat]] = []
    private(set) var layerCount = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .white
        layer.addSublayer(contentLayer)
        contentLayer.frame = bounds
    }
    required init?(coder: NSCoder) { fatalError() }
    override func layoutSubviews() {
        super.layoutSubviews()
        contentLayer.frame = bounds
    }

    func clearScene() {
        contentLayer.sublayers?.forEach { $0.removeFromSuperlayer() }
        allLayers.removeAll()
        layerCount = 0
    }

    /// ★拍平：每 row 一个 layer，**把该行的 40 个色块 + 40 段文本绘制进它自己的 backing store**
    ///   （方案 §12.3「真拍平」；这也是本仓实测算出的双优形态）
    func buildFlattened(rects: [String: [String: Double]]) -> Int {
        let rowH = Double(BenchSpec.itemH)
        // ★按 Rust 几何准备每行的绘制清单（item 的**行内相对**矩形）
        //   节点 id 分配：root=1, row=(2 + r*(1+cols)), item=(row+1 .. row+cols)
        //   ★与 Android 侧 `buildTreeRequestJson` 的 id 分配一致
        flatRowItems = []
        for r in 0..<BenchSpec.rows {
            // ★id 分配（与 requestJSON 一致）：每行 = 1 row + 40×(1 view + 1 text) = 81 个节点
            let rowNodeId = 2 + r * (1 + BenchSpec.cols * 2)
            var items: [CGFloat] = []
            for c in 0..<BenchSpec.cols {
                let itemId = rowNodeId + 1 + c * 2      // 每个 item 的 view 节点
                if let ir = rects[String(itemId)], let rr = rects[String(rowNodeId)] {
                    // ★存**行内相对**坐标（layer 坐标系 = layer 自身）
                    items.append(contentsOf: [
                        CGFloat((ir["x"] ?? 0) - (rr["x"] ?? 0)),
                        CGFloat((ir["y"] ?? 0) - (rr["y"] ?? 0)),
                        CGFloat(ir["width"] ?? 0),
                        CGFloat(ir["height"] ?? 0),
                    ])
                }
            }
            flatRowItems.append(items)
        }
        for r in 0..<BenchSpec.rows {
            let row = CALayer()
            row.frame = CGRect(x: 0, y: Double(r) * (rowH + 2), width: Double(bounds.width), height: rowH)
            // ★把「本行的绘制清单」挂在 layer 上（delegate 绘制时取用）
            //   这就是拍平的实质：**40 个色块 + 40 段文本合成到这一个 layer 的 backing store**
            row.setValue(r, forKey: "rowIndex")
            row.delegate = self
            row.setNeedsDisplay()
            contentLayer.addSublayer(row)
            allLayers.append(row)
        }
        layerCount = allLayers.count
        return layerCount
    }

    /// 不拍平：每个元素一个 layer（§12.3 的反面）
    func buildUnflattened(rects: [String: [String: Double]]) -> Int {
        // ★不拍平形态：对**每个有尺寸的节点**建一个 layer（4051 个）
        //   （初版按旧的 id 分配查 rects → 全部落空 → layers=None）
        for (_, r) in rects {
            let x = CGFloat(r["x"] ?? 0), y = CGFloat(r["y"] ?? 0)
            let w = CGFloat(r["width"] ?? 0), h = CGFloat(r["height"] ?? 0)
            guard w > 0, h > 0 else { continue }
            let l = CALayer()
            l.frame = CGRect(x: x, y: y, width: w, height: h)
            l.backgroundColor = UIColor(red: 0.16, green: 0.35, blue: 0.66, alpha: 1).cgColor
            contentLayer.addSublayer(l)
            allLayers.append(l)
        }
        layerCount = allLayers.count
        return layerCount
    }

    /// 强制渲染完成（`render(in:)` 会把 layer 树画进 bitmap → 触发所有 backing store 分配）
    func forceRender() {
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1.0
        fmt.opaque = true
        let r = UIGraphicsImageRenderer(bounds: bounds, format: fmt)
        _ = r.image { ctx in self.layer.render(in: ctx.cgContext) }
    }
}

/// ★★拍平模式的绘制：在 **row layer 自己的 backing store** 里画该行的 40 个色块 + 40 段文本。
///
/// 这就是方案 §12.3 的「**真拍平**」：
///   · 不创建 40 个独立 sublayer，而是把内容绘制进**父 layer 已有的** backing store
///   · 本仓 iOS 实验实测：此形态 **129.9ms / 17.7MB**，耗时与内存同时最优
// ★不加 `: CALayerDelegate`——`UIView` 已内建该一致性（加了会报 redundant conformance）
extension BenchView {
    // ★必须 `override`：`UIView` 已实现 `drawLayer:inContext:`（CALayerDelegate 回调）
    override func draw(_ layer: CALayer, in ctx: CGContext) {
        // ★只从 layer 取「哪一行」；绘制清单从**宿主实例**读——
        //   若用 setValue 把清单挂到每个 row 上，KVC 会为每个 row 桥接一份数组副本
        //   （50 份 × 50×160×8B ≈ 3.2MB）→ **测量仪器的重量会污染内存读数**
        guard let idx = layer.value(forKey: "rowIndex") as? Int else { return }
        let list = idx < flatRowItems.count ? flatRowItems[idx] : []
        let attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 10),
            .foregroundColor: UIColor.white,
        ]
        // ★清单是**平铺**的 [x,y,w,h, x,y,w,h, ...]（每 4 个一组）——避免嵌套数组的桥接开销
        var i = 0
        ctx.setFillColor(UIColor(red: 0.16, green: 0.35, blue: 0.66, alpha: 1).cgColor)
        while i + 3 < list.count {
            ctx.fill(CGRect(x: list[i], y: list[i + 1], width: list[i + 2], height: list[i + 3]))
            i += 4
        }
        UIGraphicsPushContext(ctx)
        i = 0
        while i + 3 < list.count {
            (BenchSpec.textSample as NSString).draw(
                at: CGPoint(x: list[i] + 2, y: list[i + 1] + 2), withAttributes: attrs)
            i += 4
        }
        UIGraphicsPopContext()
    }
}

/* ────────────────────────── 宿主 ────────────────────────── */

final class BenchViewController: UIViewController {
    private var host: BenchView!
    private var report: [String: Any] = [:]

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        host = BenchView(frame: view.bounds)
        host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        host.layoutIfNeeded()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.runBench() }
    }

    private func runBench() {
        var out: [String: Any] = [:]
        out["engine"] = takeString(proteus_layout_version())
        out["elements"] = BenchSpec.rows * BenchSpec.cols * 2 + BenchSpec.rows + 1

        // ── 基线内存（建场景前）──
        let baseMB = physFootprintMB()

        // ── ① Rust 布局（4051 节点）──
        let json = BenchSpec.requestJSON()
        out["request_json_bytes"] = json.count
        // ★细分计时：create 内部含「serde 解析 + 建 taffy 树 + 首次布局」三段
        //   （M0 计划已指出：生产应为**二进制扁平化**而非 JSON —— 这里量化 JSON 的代价）
        let t0 = CFAbsoluteTimeGetCurrent()
        let handle = json.withCString { proteus_layout_create($0) }
        let tCreate = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        // 再读一次 rects（纯遍历，不含解析）→ 差值即「解析+建树」占比
        let tR0 = CFAbsoluteTimeGetCurrent()
        let rectsJson2 = takeString(proteus_layout_rects(handle))
        let tRects = (CFAbsoluteTimeGetCurrent() - tR0) * 1000
        _ = rectsJson2
        let tLayout = tCreate
        out["create_total_ms"] = (tCreate * 100).rounded() / 100
        out["read_rects_ms"] = (tRects * 100).rounded() / 100
        guard handle > 0 else {
            out["ok"] = false
            out["error"] = "proteus_layout_create 失败（bytes=\(json.count)）"
            out["json_head"] = String(json.prefix(300))
            // ★二分诊断：按行数递增找出失败阈值（定位是「规模问题」还是「某个字段问题」）
            var bisect: [[String: Any]] = []
            for rows in [50, 60, 70, 80, 100] {
                var t = "{\"viewport\":{\"width\":750,\"height\":2400},\"nodes\":["
                t += "{\"id\":1,\"parentId\":null,\"width\":750.0,\"flexDirection\":\"column\"}"
                var nid = 2
                for _ in 0..<rows {
                    t += ",{\"id\":\(nid),\"parentId\":1,\"flexDirection\":\"row\",\"gap\":4.0,\"flexShrink\":0.0}"
                    let rowId = nid; nid += 1
                    for _ in 0..<BenchSpec.cols {
                        t += ",{\"id\":\(nid),\"parentId\":\(rowId),\"width\":30.0,\"height\":18.0,\"flexShrink\":0.0,\"isText\":true}"
                        nid += 1
                    }
                }
                t += "],\"textMeasures\":{}}"
                let h = t.withCString { proteus_layout_create($0) }
                bisect.append(["rows": rows, "nodes": nid - 1, "bytes": t.count, "handle": h])
                if h > 0 { _ = proteus_layout_destroy(h) }
            }
            out["bisect"] = bisect
            writeReport(out)
            return
        }
        let rectsJson = takeString(proteus_layout_rects(handle))
        out["rust_layout_ms"] = (tLayout * 100).rounded() / 100
        // ★诚实标注：此耗时含 **349KB JSON 的 serde 解析**（生产应为二进制扁平化，见 M0 计划）；
        //   且本次请求里 item **不设宽高**（§9.2 要求「尺寸由内部文字撑开」）→
        //   每个 item 都要走内容测量，与 Android 侧「item 定宽高」的基准**口径不同**。
        out["rust_layout_note"] = "含 serde 解析 349KB JSON + 4051 节点的内容测量（item 不设宽高）" 

        var rects: [String: [String: Double]] = [:]
        if let d = rectsJson.data(using: .utf8),
           let root = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let r = root["rects"] as? [String: [String: Double]] {
            rects = r
        }
        out["rect_count"] = rects.count
        _ = proteus_layout_destroy(handle)

        // ── ② 拍平形态 ──
        host.clearScene()
        let t1 = CFAbsoluteTimeGetCurrent()
        let flatLayers = host.buildFlattened(rects: rects)
        let tBuildFlat = (CFAbsoluteTimeGetCurrent() - t1) * 1000
        let t2 = CFAbsoluteTimeGetCurrent()
        host.forceRender()
        let tDrawFlat = (CFAbsoluteTimeGetCurrent() - t2) * 1000
        let memFlat = physFootprintMB()
        out["flattened"] = [
            "layers": flatLayers,
            "build_ms": (tBuildFlat * 100).rounded() / 100,
            "draw_ms": (tDrawFlat * 100).rounded() / 100,
            "footprint_mb": (memFlat * 10).rounded() / 10,
            "delta_mb": ((memFlat - baseMB) * 10).rounded() / 10,
        ]

        // ── ③ 不拍平形态 ──
        host.clearScene()
        let t3 = CFAbsoluteTimeGetCurrent()
        let unflatLayers = host.buildUnflattened(rects: rects)
        let tBuildUnflat = (CFAbsoluteTimeGetCurrent() - t3) * 1000
        let t4 = CFAbsoluteTimeGetCurrent()
        host.forceRender()
        let tDrawUnflat = (CFAbsoluteTimeGetCurrent() - t4) * 1000
        let memUnflat = physFootprintMB()
        out["unflattened"] = [
            "layers": unflatLayers,
            "build_ms": (tBuildUnflat * 100).rounded() / 100,
            "draw_ms": (tDrawUnflat * 100).rounded() / 100,
            "footprint_mb": (memUnflat * 10).rounded() / 10,
            "delta_mb": ((memUnflat - baseMB) * 10).rounded() / 10,
        ]

        // ── ④ 原生对照（UIView + UILabel，同规格）──
        host.clearScene()
        let t5 = CFAbsoluteTimeGetCurrent()
        let nativeRoot = UIView(frame: CGRect(x: 0, y: 0, width: host.bounds.width, height: 2400))
        var y: CGFloat = 0
        for _ in 0..<BenchSpec.rows {
            let rowView = UIView(frame: CGRect(x: 0, y: y, width: host.bounds.width, height: BenchSpec.itemH))
            var x: CGFloat = 0
            for _ in 0..<BenchSpec.cols {
                let cell = UIView(frame: CGRect(x: x, y: 0, width: BenchSpec.itemW, height: BenchSpec.itemH))
                cell.backgroundColor = UIColor(red: 0.16, green: 0.35, blue: 0.66, alpha: 1)
                let label = UILabel(frame: cell.bounds)
                label.text = BenchSpec.textSample
                label.font = UIFont.systemFont(ofSize: 10)
                label.textColor = .white
                cell.addSubview(label)
                rowView.addSubview(cell)
                x += BenchSpec.itemW
            }
            nativeRoot.addSubview(rowView)
            y += BenchSpec.itemH + 2
        }
        host.addSubview(nativeRoot)
        let tBuildNative = (CFAbsoluteTimeGetCurrent() - t5) * 1000
        let t6 = CFAbsoluteTimeGetCurrent()
        nativeRoot.layoutIfNeeded()
        let tLayoutNative = (CFAbsoluteTimeGetCurrent() - t6) * 1000
        let memNative = physFootprintMB()
        out["native_uikit"] = [
            "views": BenchSpec.rows * BenchSpec.cols * 2 + BenchSpec.rows,
            "build_ms": (tBuildNative * 100).rounded() / 100,
            "layout_ms": (tLayoutNative * 100).rounded() / 100,
            "footprint_mb": (memNative * 10).rounded() / 10,
            "delta_mb": ((memNative - baseMB) * 10).rounded() / 10,
        ]
        nativeRoot.removeFromSuperview()

        // ── ⑤ 结论（方案 §9.4 指标：内存增量 ≤ 原生 × 1.15）──
        let nativeDelta = memNative - baseMB
        let flatDelta = memFlat - baseMB
        let unflatDelta = memUnflat - baseMB
        var verdict: [String: Any] = [:]
        if nativeDelta > 0 {
            verdict["flat_vs_native_ratio"] = ((flatDelta / nativeDelta) * 1000).rounded() / 1000
            verdict["unflat_vs_native_ratio"] = ((unflatDelta / nativeDelta) * 1000).rounded() / 1000
            verdict["target"] = "≤ 1.15（方案 §9.4）"
            verdict["flat_pass"] = (flatDelta / nativeDelta) <= 1.15
            verdict["unflat_pass"] = (unflatDelta / nativeDelta) <= 1.15
        }
        out["verdict"] = verdict
        out["ok"] = true
        out["note"] = "★几何全部来自 Rust 核心；三种形态同进程顺序测量（base 为建场景前的 footprint）；"
            + "request JSON 通道含 serde 解析成本（生产应为二进制扁平化，见 M0 计划）"

        writeReport(out)

        // 屏幕上显示关键数字（便于截图核对）
        let label = UILabel(frame: CGRect(x: 16, y: 80, width: host.bounds.width - 32, height: 300))
        label.numberOfLines = 0
        label.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        label.text = """
        iOS CALayer 路线 · 4050 元素
        Rust 布局: \(out["rust_layout_ms"] ?? "?") ms
        拍平(\(flatLayers) layer): 建 \((out["flattened"] as? [String: Any])?["build_ms"] ?? "?")ms \
        绘 \((out["flattened"] as? [String: Any])?["draw_ms"] ?? "?")ms \
        内存 +\((out["flattened"] as? [String: Any])?["delta_mb"] ?? "?")MB
        不拍平(\(unflatLayers) layer): 内存 +\(((out["unflattened"] as? [String: Any])?["delta_mb"]) ?? "?")MB
        原生 UILabel: 内存 +\((verdict["flat_vs_native_ratio"] != nil) ? ((out["native_uikit"] as? [String: Any])?["delta_mb"] ?? "?") : "?")MB
        拍平/原生 = \(verdict["flat_vs_native_ratio"] ?? "?")（目标 ≤1.15）
        """
        view.addSubview(label)
    }

    private func writeReport(_ out: [String: Any]) {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("layout-core-bench.json")
        if let d = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]) {
            try? d.write(to: url)
        }
        NSLog("[proteus] bench 报告: %@", url.path)
    }
}

final class BenchSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        w.rootViewController = BenchViewController()
        w.makeKeyAndVisible()
        window = w
    }
}

@main
final class BenchAppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ a: UIApplication,
                     didFinishLaunchingWithOptions o: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool { true }
    func application(_ a: UIApplication, configurationForConnecting s: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c = UISceneConfiguration(name: "Default", sessionRole: s.role)
        c.delegateClass = BenchSceneDelegate.self
        return c
    }
}
