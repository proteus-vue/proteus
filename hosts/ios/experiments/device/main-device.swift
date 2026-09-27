// hosts/ios/experiments/device/main-device.swift —— iOS **真机**版对照实验
//
// 【与模拟器版的差异】（为什么真机必须单独跑）
//   ① **commit 成本结构不同**：模拟器 Render Server 与 App **同进程**；真机是 **IPC 到 backboardd**
//      → H4（layer tree 深度 vs commit 成本）只有在真机上才测得准（模拟器实测深度无影响=无效测量）。
//   ② **无 JIT / 真实 CPU**：模拟器跑在 Mac 的 arm64 上并共享缓存；真机是 A 系列芯片 + JIT-less JSC 约束。
//   ③ **离屏渲染与 GPU**：模拟器用 Mac GPU（Metal 转换），真机 GPU 行为不同 → 离屏渲染只能用真机 Instruments 量。
//   ④ **os_signpost 埋点**：本版加了 signpost，可在 Instruments（Points of Interest / Core Animation）
//      时间轴上直接看到 build/layout/commit 三段，与 `xctrace` 采集对齐。
//
// 【与模拟器版的相同点】测试定义完全一致（4050 元素、view 不设宽高由文字撑开、三段计时、4 次重跑）
//   → 两端数字**可直接对比**，从而把「模拟器结论」升级为「真机结论」或推翻。
//
// 原始来源：hosts/ios/experiments/Experiments/main.swift（模拟器版）
// 运行：bash hosts/ios/experiments/device/run-device.sh <设备UDID>
//
// 【目的】验证 `docs/Proteus_App端高性能渲染落地方案.md` 中押在 iOS 侧的 4 条假设（+1 条补充），
//   把文档 §附 里**未核实的外部数字**换成本机可复跑的自有基线。
//
// 【被测假设】
//   H1  跳过 UIView 直接用 CALayer 更快（UIView 的事件/布局/响应链是纯开销）        —— §6.2
//   H2  AutoLayout CPU 消耗随视图数量（超）线性上升，必须绕开                      —— §6.2 / 坑位#6
//   H3  UILabel 长列表 vs CATextLayer（文档称 30 FPS vs 58 FPS）                  —— §附
//   H4  commit 阶段递归 → layer tree 深度直接决定提交成本（拍平是刚需）            —— §6.2 / 坑位#7
//   H5  （补充）文本度量缓存的实际收益（文档说"可缓存"，未给量级）                 —— §5.3
//
// 【测试定义】严格复刻文档 §9.2：2000 个 view（各带 1 个 text）+ 50 行外层容器 = 4050 元素，
//   view **不设宽高**、尺寸由内部文字撑开 → 必须完整走测量/布局/绘制。
//   计时三段：build（建树）/ layout（度量+定位）/ commit（提交到渲染进程），与文档口径一致。
//
// 【诚实边界（重要）】
//   ① 本实验跑在 **iOS 模拟器**上：Render Server 与 App **同进程**（真机是 IPC 到 backboardd），
//      故 commit 绝对值不具真机代表性；**相对比较（路线间 / 深度间）仍有意义**。
//   ② 模拟器与真机 CPU/GPU 不同，**不得把这里的数字当作真机性能宣称**。
//   ③ 每条路线用同一份结构定义、同一组文本、同一 host，仅改变「节点类型 + 布局方式」。
import UIKit
import os

extension ProcessInfo {
    /// 机型标识（如 iPhone17,1）——报告里带上，保证「同一台机器」可比
    var machineName: String {
        var info = utsname(); uname(&info)
        let m = Mirror(reflecting: info.machine)
        return m.children.reduce(into: "") { acc, e in
            if let v = e.value as? Int8, v != 0 { acc.append(Character(UnicodeScalar(UInt8(v)))) }
        }
    }
}

/// Instruments 埋点（Points of Interest）——与 xctrace 采集对齐
let signpostLog = OSLog(subsystem: "dev.proteus.experiments", category: .pointsOfInterest)
func signpost(_ name: StaticString, _ body: () -> Void) {
    let id = OSSignpostID(log: signpostLog)
    os_signpost(.begin, log: signpostLog, name: name, signpostID: id)
    body()
    os_signpost(.end, log: signpostLog, name: name, signpostID: id)
}

/// ★全局可见容器：所有实验都在**同一个已挂到窗口**的 host 上跑。
///   踩坑记录：初版每个实验各自 `UIView(frame:)` 且**从未加入视图层级**（游离视图）——
///   现象是屏幕全黑 + exp4 出现「越深越快」的反常数据（游离 layer 不产生真实提交）。
///   教训：**commit 类测量必须在已上屏的视图上做**，否则测的是噪声。
var visibleHost: UIView!

// ───────────────────────── 计时与统计 ─────────────────────────
func now() -> Double { CACurrentMediaTime() * 1000 } // ms
func median(_ xs: [Double]) -> Double { let s = xs.sorted(); return s.isEmpty ? 0 : s[s.count / 2] }
func p(_ v: Double) -> Double { (v * 100).rounded() / 100 }

struct Phase { var build: Double = 0; var layout: Double = 0; var commit: Double = 0
    var total: Double { build + layout + commit } }

// ───────────────────────── 实验素材 ─────────────────────────
// 50 个不同文案（模拟真实列表；重复文案会掩盖度量成本）
let TEXTS: [String] = (0..<50).map { "列表项 \($0) · 内容示例" }
let FONT = UIFont.systemFont(ofSize: 15)
let ATTRS: [NSAttributedString.Key: Any] = [.font: FONT]
let ITEM_PAD: CGFloat = 8, ROW_GAP: CGFloat = 4, ITEM_GAP: CGFloat = 6
let COLS = 40, ROWS = 50   // 40×50 = 2000 items

/// 文本度量（真实框架做法：CoreText 支持的 NSString.size）
func measure(_ s: String) -> CGSize { (s as NSString).size(withAttributes: ATTRS) }

// ───────────────────────── 三段计时骨架 ─────────────────────────
/// 在给定 host 上跑一次「建树 → 布局 → 提交」，返回三段耗时
func runOnce(host: UIView, build: () -> Void, layout: () -> Void) -> Phase {
    // 清空
    host.subviews.forEach { $0.removeFromSuperview() }
    host.layer.sublayers?.forEach { $0.removeFromSuperlayer() }

    var ph = Phase()
    var t0 = now()
    signpost("build") { build() }
    ph.build = now() - t0

    t0 = now()
    signpost("layout") { layout(); host.layoutIfNeeded() }
    ph.layout = now() - t0

    // commit：CATransaction 提交 + **同步 flush**（≈ 指令送达渲染进程）
    //
    // ★踩坑记录（2026-09-29）：初版用 `setCompletionBlock` + `DispatchSemaphore.wait` 测提交，
    //   结果**主线程死锁**——completion block 也需主线程执行，而主线程正阻塞在 wait 上
    //   → 每次卡满超时（表现为「进程活着但永不落盘」，差点误判为实验太慢）。
    //   正解：`CATransaction.flush()` 同步把 layer tree 交给渲染进程，无需等待异步回调。
    t0 = now()
    CATransaction.begin()
    CATransaction.setDisableActions(true)   // 关隐式动画，测纯提交
    host.setNeedsLayout()
    host.layoutIfNeeded()
    host.layer.setNeedsDisplay()
    CATransaction.commit()
    CATransaction.flush()                   // 同步提交（阻塞至渲染进程接收）
    ph.commit = now() - t0
    return ph
}

// ───────────────────────── 路线 A：UIView + AutoLayout ─────────────────────────
/// 贴近「用系统控件 + 约束」的常规写法（文档对打的原生基线）
func buildAutoLayout(host: UIView, cache: Bool = false) {
    var lastRow: UIView? = nil
    for r in 0..<ROWS {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            row.topAnchor.constraint(equalTo: lastRow?.bottomAnchor ?? host.topAnchor, constant: ROW_GAP),
        ])
        var prev: UIView? = nil
        for c in 0..<COLS {
            let item = UIView()
            item.translatesAutoresizingMaskIntoConstraints = false
            item.backgroundColor = .init(white: 0.2, alpha: 1)
            row.addSubview(item)
            let label = UILabel()
            label.translatesAutoresizingMaskIntoConstraints = false
            label.font = FONT
            label.textColor = .white
            label.text = TEXTS[(r * COLS + c) % TEXTS.count]
            item.addSubview(label)
            NSLayoutConstraint.activate([
                // item 尺寸由内部 label 撑开（+ 内边距）——对齐文档「view 不设宽高」
                label.leadingAnchor.constraint(equalTo: item.leadingAnchor, constant: ITEM_PAD),
                label.trailingAnchor.constraint(equalTo: item.trailingAnchor, constant: -ITEM_PAD),
                label.topAnchor.constraint(equalTo: item.topAnchor, constant: ITEM_PAD),
                label.bottomAnchor.constraint(equalTo: item.bottomAnchor, constant: -ITEM_PAD),
                item.topAnchor.constraint(equalTo: row.topAnchor),
                item.bottomAnchor.constraint(equalTo: row.bottomAnchor),
                item.leadingAnchor.constraint(equalTo: prev?.trailingAnchor ?? row.leadingAnchor, constant: prev == nil ? 0 : ITEM_GAP),
            ])
            prev = item
        }
        lastRow = row
    }
    if let lr = lastRow { lr.bottomAnchor.constraint(equalTo: host.bottomAnchor).isActive = true }
}

// ───────────────────────── 路线 B：UIView + 手算 frame ─────────────────────────
/// 框架式做法：自己度量文本、算位置，一次性设 frame（对标文档的 C++ 排版核心）
func buildManualFrames(host: UIView, cache: Bool = false, useCALayer: Bool = false) {
    var textCache: [String: CGSize] = [:]
    // 预度量（模拟编译期/批量度量阶段）
    for t in TEXTS { textCache[t] = cache || true ? measure(t) : measure(t) }

    var y: CGFloat = 0
    for r in 0..<ROWS {
        // 行高 = 最高 item
        var rowH: CGFloat = 0
        var sizes: [CGSize] = []
        sizes.reserveCapacity(COLS)
        for c in 0..<COLS {
            let t = TEXTS[(r * COLS + c) % TEXTS.count]
            let s = textCache[t] ?? measure(t)
            sizes.append(s)
            rowH = max(rowH, s.height + ITEM_PAD * 2)
        }
        if useCALayer {
            let row = CALayer()
            row.frame = CGRect(x: 0, y: y, width: host.bounds.width, height: rowH)
            host.layer.addSublayer(row)
            var x: CGFloat = 0
            for c in 0..<COLS {
                let s = sizes[c]
                let w = s.width + ITEM_PAD * 2
                let item = CALayer()
                item.frame = CGRect(x: x, y: 0, width: w, height: rowH)
                item.backgroundColor = UIColor(white: 0.2, alpha: 1).cgColor
                row.addSublayer(item)
                let txt = CATextLayer()
                txt.contentsScale = UIScreen.main.scale
                txt.frame = CGRect(x: ITEM_PAD, y: ITEM_PAD, width: s.width, height: s.height)
                txt.string = TEXTS[(r * COLS + c) % TEXTS.count]
                txt.font = FONT
                txt.fontSize = FONT.pointSize
                txt.foregroundColor = UIColor.white.cgColor
                txt.isWrapped = false
                txt.alignmentMode = .left
                item.addSublayer(txt)
                x += w + ITEM_GAP
            }
        } else {
            let row = UIView(frame: CGRect(x: 0, y: y, width: host.bounds.width, height: rowH))
            host.addSubview(row)
            var x: CGFloat = 0
            for c in 0..<COLS {
                let s = sizes[c]
                let w = s.width + ITEM_PAD * 2
                let item = UIView(frame: CGRect(x: x, y: 0, width: w, height: rowH))
                item.backgroundColor = UIColor(white: 0.2, alpha: 1)
                row.addSubview(item)
                let label = UILabel(frame: CGRect(x: ITEM_PAD, y: ITEM_PAD, width: s.width, height: s.height))
                label.font = FONT
                label.textColor = .white
                label.text = TEXTS[(r * COLS + c) % TEXTS.count]
                item.addSubview(label)
                x += w + ITEM_GAP
            }
        }
        y += rowH + ROW_GAP
    }
}

// ───────────────────────── 实验 1：三条路线对打（4050 元素）─────────────────────────
func exp1() -> [String: Any] {
    let host = visibleHost!
    var out: [String: Any] = [:]
    let repeats = 5

    // A: UIView + AutoLayout
    var a: [Phase] = []
    for _ in 0..<repeats {
        a.append(runOnce(host: host, build: { buildAutoLayout(host: host) }, layout: { }))
    }
    // B: UIView + 手算 frame
    var b: [Phase] = []
    for _ in 0..<repeats {
        b.append(runOnce(host: host, build: { }, layout: { buildManualFrames(host: host) }))
    }
    // C: CALayer + 手算 frame
    var c: [Phase] = []
    for _ in 0..<repeats {
        c.append(runOnce(host: host, build: { }, layout: { buildManualFrames(host: host, useCALayer: true) }))
    }
    func summarize(_ xs: [Phase]) -> [String: Double] {
        ["build": p(median(xs.map { $0.build })), "layout": p(median(xs.map { $0.layout })),
         "commit": p(median(xs.map { $0.commit })), "total": p(median(xs.map { $0.total }))]
    }
    out["A_uiview_autolayout"] = summarize(a)
    out["B_uiview_manualframe"] = summarize(b)
    out["C_calayer_manualframe"] = summarize(c)
    return out
}

// ───────────────────────── 实验 2：规模曲线（H2 超线性判定）─────────────────────────
func exp2() -> [String: Any] {
    var out: [String: Any] = [:]
    for items in [100, 400, 800, 1600] {
        let cols = 40, rows = max(1, items / cols)
        let host = visibleHost!
        // AutoLayout
        var alMs: [Double] = []
        for _ in 0..<3 {
            let ph = runOnce(host: host, build: { buildAutoLayoutN(host: host, rows: rows, cols: cols) }, layout: { })
            alMs.append(ph.total)
        }
        // 手算
        var mfMs: [Double] = []
        for _ in 0..<3 {
            let ph = runOnce(host: host, build: { }, layout: { buildManualN(host: host, rows: rows, cols: cols) })
            mfMs.append(ph.total)
        }
        out["items_\(rows * cols)"] = ["autoLayout": p(median(alMs)), "manualFrame": p(median(mfMs))]
    }
    return out
}

func buildAutoLayoutN(host: UIView, rows: Int, cols: Int) {
    var lastRow: UIView? = nil
    for r in 0..<rows {
        let row = UIView(); row.translatesAutoresizingMaskIntoConstraints = false; host.addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            row.topAnchor.constraint(equalTo: lastRow?.bottomAnchor ?? host.topAnchor, constant: ROW_GAP),
        ])
        var prev: UIView? = nil
        for c in 0..<cols {
            let item = UIView(); item.translatesAutoresizingMaskIntoConstraints = false
            item.backgroundColor = .init(white: 0.2, alpha: 1); row.addSubview(item)
            let label = UILabel(); label.translatesAutoresizingMaskIntoConstraints = false
            label.font = FONT; label.textColor = .white; label.text = TEXTS[(r * cols + c) % TEXTS.count]
            item.addSubview(label)
            NSLayoutConstraint.activate([
                label.leadingAnchor.constraint(equalTo: item.leadingAnchor, constant: ITEM_PAD),
                label.trailingAnchor.constraint(equalTo: item.trailingAnchor, constant: -ITEM_PAD),
                label.topAnchor.constraint(equalTo: item.topAnchor, constant: ITEM_PAD),
                label.bottomAnchor.constraint(equalTo: item.bottomAnchor, constant: -ITEM_PAD),
                item.topAnchor.constraint(equalTo: row.topAnchor),
                item.bottomAnchor.constraint(equalTo: row.bottomAnchor),
                item.leadingAnchor.constraint(equalTo: prev?.trailingAnchor ?? row.leadingAnchor, constant: prev == nil ? 0 : ITEM_GAP),
            ])
            prev = item
        }
        lastRow = row
    }
    if let lr = lastRow { lr.bottomAnchor.constraint(equalTo: host.bottomAnchor).isActive = true }
}

func buildManualN(host: UIView, rows: Int, cols: Int) {
    var cache: [String: CGSize] = [:]
    for t in TEXTS { cache[t] = measure(t) }
    var y: CGFloat = 0
    for r in 0..<rows {
        var rowH: CGFloat = 0
        var sizes: [CGSize] = []
        for c in 0..<cols {
            let s = cache[TEXTS[(r * cols + c) % TEXTS.count]]!
            sizes.append(s); rowH = max(rowH, s.height + ITEM_PAD * 2)
        }
        let row = UIView(frame: CGRect(x: 0, y: y, width: host.bounds.width, height: rowH))
        host.addSubview(row)
        var x: CGFloat = 0
        for c in 0..<cols {
            let s = sizes[c]; let w = s.width + ITEM_PAD * 2
            let item = UIView(frame: CGRect(x: x, y: 0, width: w, height: rowH))
            item.backgroundColor = UIColor(white: 0.2, alpha: 1); row.addSubview(item)
            let label = UILabel(frame: CGRect(x: ITEM_PAD, y: ITEM_PAD, width: s.width, height: s.height))
            label.font = FONT; label.textColor = .white; label.text = TEXTS[(r * cols + c) % TEXTS.count]
            item.addSubview(label)
            x += w + ITEM_GAP
        }
        y += rowH + ROW_GAP
    }
}

// ───────────────────────── 实验 3：文本通道 UILabel vs CATextLayer（H3）─────────────
func exp3() -> [String: Any] {
    let host = visibleHost!
    let n = 1000
    var out: [String: Any] = [:]
    // UILabel
    var ui: [Double] = []
    for _ in 0..<5 {
        let ph = runOnce(host: host, build: { }, layout: {
            for i in 0..<n {
                let t = TEXTS[i % TEXTS.count]; let s = measure(t)
                let l = UILabel(frame: CGRect(x: CGFloat(i % 40) * 90, y: CGFloat(i / 40) * 20, width: s.width, height: s.height))
                l.font = FONT; l.textColor = .white; l.text = t
                host.addSubview(l)
            }
        })
        ui.append(ph.total)
    }
    // CATextLayer
    var ca: [Double] = []
    for _ in 0..<5 {
        let ph = runOnce(host: host, build: { }, layout: {
            for i in 0..<n {
                let t = TEXTS[i % TEXTS.count]; let s = measure(t)
                let l = CATextLayer()
                l.contentsScale = UIScreen.main.scale
                l.frame = CGRect(x: CGFloat(i % 40) * 90, y: CGFloat(i / 40) * 20, width: s.width, height: s.height)
                l.string = t; l.font = FONT; l.fontSize = FONT.pointSize
                l.foregroundColor = UIColor.white.cgColor; l.isWrapped = false
                host.layer.addSublayer(l)
            }
        })
        ca.append(ph.total)
    }
    out["UILabel_\(n)"] = p(median(ui))
    out["CATextLayer_\(n)"] = p(median(ca))
    return out
}

// ───────────────────────── 实验 4：layer tree 深度对 commit 的影响（H4）────────────
func exp4() -> [String: Any] {
    var out: [String: Any] = [:]
    let totalNodes = 2000
    func buildChain(host: UIView, depth: Int) {
        // 2000 个节点：浅 = 1 层 2000 个平铺；深 = 20 条深度 100 的链
        if depth <= 1 {
            for i in 0..<totalNodes {
                let v = UIView(frame: CGRect(x: CGFloat(i % 100), y: CGFloat(i / 100) * 8, width: 4, height: 6))
                v.backgroundColor = UIColor(white: 0.3, alpha: 1)
                host.addSubview(v)
            }
        } else {
            let chains = totalNodes / depth
            for c in 0..<chains {
                var parent = host
                for d in 0..<depth {
                    let v = UIView(frame: CGRect(x: 0, y: 0, width: 4, height: 6))
                    v.backgroundColor = UIColor(white: 0.3, alpha: 1)
                    parent.addSubview(v)
                    parent = v
                    if d == 0 && c % 100 == 0 { /* noop */ }
                }
            }
        }
    }
    for depth in [1, 10, 50, 100] {
        let host = visibleHost!
        var ms: [Double] = []
        for _ in 0..<5 {
            let ph = runOnce(host: host, build: { }, layout: { buildChain(host: host, depth: depth) })
            ms.append(ph.commit)
        }
        out["depth_\(depth)_commit"] = p(median(ms))
    }
    return out
}

// ───────────────────────── 实验 5：文本度量缓存收益（H5）────────────────────────
func exp5() -> [String: Any] {
    let distinct = 50, total = 2000
    var out: [String: Any] = [:]
    // 无缓存
    var noCache: [Double] = []
    for _ in 0..<5 {
        let t0 = now()
        for i in 0..<total { _ = measure(TEXTS[i % distinct]) }
        noCache.append(now() - t0)
    }
    // 有缓存（命中）
    var cache: [String: CGSize] = [:]
    var withCache: [Double] = []
    for _ in 0..<5 {
        cache.removeAll(keepingCapacity: true)
        let t0 = now()
        for i in 0..<total {
            let t = TEXTS[i % distinct]
            if let s = cache[t] { _ = s } else { cache[t] = measure(t) }
        }
        withCache.append(now() - t0)
    }
    out["noCache_\(total)"] = p(median(noCache))
    out["withCache_\(total)"] = p(median(withCache))
    out["speedup"] = p(median(noCache) / max(0.001, median(withCache)))
    return out
}

// ───────────────────────── 实验 6：commit 成本的真正决定因素（H4 补测）─────────────────────────
//
// 【为什么补测】原 exp4 固定「总数 2000、只变深度」→ 测不出深度影响，
//   但这**无法区分**两种假设：成本由「深度」决定 vs 由「节点总数」决定。
//   本实验做**二维对照**（总数 × 深度），才能判定：
//     · 若同深度下总数↑成本↑、同总数下深度↑成本不变 → **成本由总数决定**（H4 伪）
//     · 若同总数下深度↑成本↑ → **成本由深度决定**（H4 真）
func exp6() -> [String: Any] {
    var out: [String: Any] = [:]
    func build(host: UIView, total: Int, depth: Int) {
        let chains = max(1, total / max(1, depth))
        if depth <= 1 {
            for i in 0..<total {
                let v = UIView(frame: CGRect(x: CGFloat(i % 100), y: CGFloat(i / 100) * 8, width: 4, height: 6))
                v.backgroundColor = UIColor(white: 0.3, alpha: 1)
                host.addSubview(v)
            }
        } else {
            for _ in 0..<chains {
                var parent = host
                for _ in 0..<depth {
                    let v = UIView(frame: CGRect(x: 0, y: 0, width: 4, height: 6))
                    v.backgroundColor = UIColor(white: 0.3, alpha: 1)
                    parent.addSubview(v)
                    parent = v
                }
            }
        }
    }
    // 二维：总数 {500, 2000, 5000} × 深度 {1, 20}
    for total in [500, 2000, 5000] {
        for depth in [1, 20] {
            let host = visibleHost!
            var ms: [Double] = []
            for _ in 0..<5 {
                let ph = runOnce(host: host, build: { }, layout: { build(host: host, total: total, depth: depth) })
                ms.append(ph.commit)
            }
            out["total\(total)_depth\(depth)_commit"] = p(median(ms))
        }
    }
    return out
}

// ───────────────────────── 滚动基准助手（exp7 用）─────────────────────────
/// 用 CADisplayLink 驱动滚动并记录**每一帧的实际间隔**，从而算出真实 FPS 与丢帧。
///
/// 【为什么不用 UIView.animate + 事后统计】那只能拿到「总耗时」，拿不到帧间隔分布；
///   而 H3 关心的正是「滚动过程中是否掉帧」（文档称 UILabel 30 FPS vs CATextLayer 58 FPS）。
///   CADisplayLink 每帧回调一次 → 相邻回调的时间差即该帧的真实渲染间隔。
final class ScrollBench: NSObject {
    private var link: CADisplayLink?
    private var last: CFTimeInterval = 0
    private var start: CFTimeInterval = 0
    private var offsetPerSec: CGFloat = 0
    private var view: UIScrollView?
    private(set) var frameMs: [Double] = []
    private(set) var done = false
    var duration: Double = 2.0

    func start(_ scroll: UIScrollView, distance: CGFloat, duration: Double = 2.0) {
        self.view = scroll; self.duration = duration
        offsetPerSec = distance / CGFloat(duration)
        frameMs.removeAll(keepingCapacity: true)
        done = false; last = 0
        start = CACurrentMediaTime()
        let l = CADisplayLink(target: self, selector: #selector(tick))
        l.add(to: .main, forMode: .common)
        link = l
    }

    @objc private func tick() {
        let now = CACurrentMediaTime()
        if last > 0 { frameMs.append((now - last) * 1000) }
        last = now
        let elapsed = now - start
        if let v = view {
            v.contentOffset = CGPoint(x: 0, y: CGFloat(elapsed) * offsetPerSec)
        }
        if elapsed >= duration {
            link?.invalidate(); link = nil; done = true
        }
    }

    /// 统计：平均 FPS、P95 帧时间、丢帧率（>1.5×16.7ms 视为掉帧）
    func stats() -> [String: Double] {
        let f = frameMs.filter { $0 > 0 }.sorted()
        guard !f.isEmpty else { return ["fps": 0, "p95ms": 0, "dropRate": 0, "frames": 0] }
        let avg = f.reduce(0, +) / Double(f.count)
        let p95 = f[Int(Double(f.count) * 0.95)]
        let drops = f.filter { $0 > 16.7 * 1.5 }.count
        return [
            "fps": (1000 / avg * 10).rounded() / 10,
            "p95ms": (p95 * 100).rounded() / 100,
            "dropRate": (Double(drops) / Double(f.count) * 1000).rounded() / 10,
            "frames": Double(f.count),
        ]
    }
}

/// 常驻内存（MB）——方案 §9.2 要求报「增量内存」，这是量它的入口
func residentMB() -> Double {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<integer_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) { ptr -> kern_return_t in
        ptr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { ip in
            task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), ip, &count)
        }
    }
    return kr == KERN_SUCCESS ? Double(info.resident_size) / 1_048_576 : -1
}

// ───────────────────────── 实验 7：滚动 FPS（H3 的真机实证）─────────────────────────
//
// 【文档主张】「UILabel + **NSAttributedString** 长列表约 30 FPS，CATextLayer 约 58 FPS」（§附，未核实）。
//   ★注意文档原文写的是 **attributed**（富文本）——纯字符串的 UILabel 很轻，测不出差异。
//     故本实验设三组：UILabel(纯串) / **UILabel(attributed)** / CATextLayer，
//     第三组才是文档的实际场景。
// 【怎么量】CADisplayLink 驱动**真实滚动**，记录每帧间隔 → 平均 FPS / P95 帧时间 / 丢帧率。
//   滚动距离与时长固定，唯一变量 = 文本节点类型。
func exp7() -> [String: Any] {
    var out: [String: Any] = [:]
    let rows = 300, cols = 4, rowH: CGFloat = 44
    let attr: [NSAttributedString.Key: Any] = [
        .font: FONT,
        .foregroundColor: UIColor.white,
        .kern: 0.2,
    ]
    // kind: 0=UILabel 纯串 · 1=UILabel attributed · 2=CATextLayer
    //       3=UILabel heavy（attributed + 圆角 + 阴影，贴近真实列表 cell）· 4=CATextLayer heavy
    for (name, kind) in [("UILabel_plain", 0), ("UILabel_attributed", 1), ("CATextLayer", 2),
                          ("UILabel_heavy", 3), ("CATextLayer_heavy", 4)] {
        let host = visibleHost!
        host.subviews.forEach { $0.removeFromSuperview() }
        host.layer.sublayers?.forEach { $0.removeFromSuperlayer() }

        let scroll = UIScrollView(frame: host.bounds)
        scroll.backgroundColor = .black
        host.addSubview(scroll)
        var cache: [String: CGSize] = [:]
        for t in TEXTS {
            cache[t] = (kind == 1 || kind == 3) ? (t as NSString).size(withAttributes: attr) : measure(t)
        }

        var y: CGFloat = 0
        for r in 0..<rows {
            let rowFrame = CGRect(x: 0, y: y, width: host.bounds.width, height: rowH)
            if kind == 2 || kind == 4 {
                let row = CALayer(); row.frame = rowFrame
                if kind == 4 {
                    // heavy：圆角 + 阴影（真实 cell 常见，会触发离屏或额外合成）
                    row.backgroundColor = UIColor(white: 0.12, alpha: 1).cgColor
                    row.cornerRadius = 10
                    row.shadowOpacity = 0.25
                    row.shadowRadius = 3
                    row.shadowOffset = CGSize(width: 0, height: 1)
                }
                scroll.layer.addSublayer(row)
                for c in 0..<cols {
                    let t = TEXTS[(r * cols + c) % TEXTS.count]
                    let sz = cache[t]!
                    let l = CATextLayer()
                    l.contentsScale = UIScreen.main.scale
                    l.frame = CGRect(x: 8 + CGFloat(c) * (host.bounds.width / CGFloat(cols)),
                                     y: 12, width: sz.width, height: sz.height)
                    l.string = t; l.font = FONT; l.fontSize = FONT.pointSize
                    l.foregroundColor = UIColor.white.cgColor; l.isWrapped = false
                    row.addSublayer(l)
                }
            } else {
                let row = UIView(frame: rowFrame)
                row.backgroundColor = UIColor(white: 0.12, alpha: 1)
                if kind == 3 {
                    row.layer.cornerRadius = 10
                    row.layer.shadowOpacity = 0.25
                    row.layer.shadowRadius = 3
                    row.layer.shadowOffset = CGSize(width: 0, height: 1)
                }
                scroll.addSubview(row)
                for c in 0..<cols {
                    let t = TEXTS[(r * cols + c) % TEXTS.count]
                    let sz = cache[t]!
                    let l = UILabel(frame: CGRect(x: 8 + CGFloat(c) * (host.bounds.width / CGFloat(cols)),
                                                  y: 12, width: sz.width, height: sz.height))
                    if kind == 1 || kind == 3 {
                        l.attributedText = NSAttributedString(string: t, attributes: attr)
                    } else {
                        l.font = FONT; l.textColor = .white; l.text = t
                    }
                    row.addSubview(l)
                }
            }
            y += rowH
        }
        scroll.contentSize = CGSize(width: host.bounds.width, height: y)

        // CADisplayLink 需要 run loop 驱动：嵌套 run loop 泵帧（实验环境可接受）
        let bench = ScrollBench()
        bench.start(scroll, distance: y - host.bounds.height, duration: 2.5)
        let deadline = Date().addingTimeInterval(10)
        while !bench.done && Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
        }
        out[name] = bench.stats()
    }
    visibleHost!.subviews.forEach { $0.removeFromSuperview() }
    visibleHost!.layer.sublayers?.forEach { $0.removeFromSuperlayer() }
    return out
}

// ───────────────────────── 实验 8：增量内存（方案 §9.2 验收项）─────────────────────────
//
// 【文档 §9.2】要求「增量内存 ≤ 原生」——本实验量三条路线各自构建 4050 元素后的常驻内存增量。
//
// ★测量协议（初版不可靠，已修）：初版只测一次、且基线被前面实验污染（残留 subview + 未回收内存），
//   得到「CALayer 比 AutoLayout 多 29%」这种反直觉结果。现改为：
//     ① 每条路线**独立测 3 轮**，每轮之间 `autoreleasepool` + 短暂 run loop 让内存回收；
//     ② 基线取「清理后稳定值」而非首次读数；
//     ③ **报告每轮而非只报中位**——内存测量方差大，隐藏方差等于隐藏不确定性。
func exp8() -> [String: Any] {
    var out: [String: Any] = [:]
    let host = visibleHost!

    /// 清空 + 泵 run loop 让 ARC/图层释放（同步等待回收）
    func cleanAndSettle() {
        host.subviews.forEach { $0.removeFromSuperview() }
        host.layer.sublayers?.forEach { $0.removeFromSuperlayer() }
        for _ in 0..<5 {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
    }

    cleanAndSettle()
    let base = residentMB()
    out["baseline_mb"] = (base * 10).rounded() / 10

    func measure(_ build: () -> Void) -> [Double] {
        var rows: [Double] = []
        for _ in 0..<3 {
            cleanAndSettle()
            let before = residentMB()
            build()
            // ★强制走一遍布局+提交：CALayer 的 backing store 与 UIView 的约束求解都是**延迟**的，
            //   不渲染就量 → 内存增量偏低（实测初版 CALayer 报 0 MB，明显不真实）。
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            host.setNeedsLayout(); host.layoutIfNeeded()
            CATransaction.commit()
            CATransaction.flush()
            for _ in 0..<3 { RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.03)) }
            let after = residentMB()
            rows.append(((after - before) * 10).rounded() / 10)
            cleanAndSettle()
        }
        return rows
    }

    out["autoLayout_runs_mb"] = measure { buildAutoLayout(host: host) }
    out["manualFrame_runs_mb"] = measure { buildManualFrames(host: host) }
    out["calayer_runs_mb"] = measure { buildManualFrames(host: host, useCALayer: true) }
    cleanAndSettle()
    return out
}

// ───────────────────────── App 启动：跑全部实验并落盘 ─────────────────────────
final class ExpSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let win = UIWindow(windowScene: ws)
        let vc = UIViewController(); vc.view.backgroundColor = .black
        win.rootViewController = vc; win.makeKeyAndVisible(); window = win

        let host = UIView(frame: vc.view.bounds)
        host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        vc.view.addSubview(host)          // ★挂进层级（否则 commit 无意义）
        visibleHost = host

        // 实验在首帧后跑（确保 window 已连接、有真实布局环境）
        // ★分批 + 每步落盘：AutoLayout 4050 元素可能耗时数十秒，一次性写盘会「看起来卡死」
        //   （实测第一次跑 180s 超时、Documents 为空、进程仍在——故改为增量落盘 + 进度打点）
        DispatchQueue.main.async {
            let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]

            // ★进程隔离模式（PROTEUS_EXP_ONLY=mem_A|mem_B|mem_C）：
            //   内存测量**必须在干净进程里做单点测量**——进程内多轮测量会被前一实验的残留
            //   与系统内存压力污染（实测同一变体三轮 48→157→166 MB 累积、另有 -0.7/86 MB 离群）。
            //   用法见 device/measure-memory.sh（每次启动只测一个变体，重复 N 次取中位）。
            if let only = ProcessInfo.processInfo.environment["PROTEUS_EXP_ONLY"], only.hasPrefix("mem_") {
                let variant = String(only.dropFirst(4))
                let host = visibleHost!
                host.subviews.forEach { $0.removeFromSuperview() }
                host.layer.sublayers?.forEach { $0.removeFromSuperlayer() }
                for _ in 0..<5 { RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05)) }

                let before = residentMB()
                switch variant {
                case "A": buildAutoLayout(host: host)
                case "B": buildManualFrames(host: host)
                case "C": buildManualFrames(host: host, useCALayer: true)
                default: break
                }
                // 强制布局 + 提交（backing store / 约束求解都是延迟的）
                CATransaction.begin()
                CATransaction.setDisableActions(true)
                host.setNeedsLayout(); host.layoutIfNeeded()
                CATransaction.commit(); CATransaction.flush()
                for _ in 0..<5 { RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.03)) }
                let after = residentMB()

                let payload: [String: Any] = [
                    "exp8_isolated": [
                        "variant": variant,
                        "before_mb": (before * 10).rounded() / 10,
                        "after_mb": (after * 10).rounded() / 10,
                        "delta_mb": ((after - before) * 10).rounded() / 10,
                    ],
                    "meta": [
                        "device": "Physical Device", "model": ProcessInfo.processInfo.machineName,
                        "systemVersion": UIDevice.current.systemVersion,
                        "progress": "ALL_DONE", "mode": "isolated-memory",
                    ],
                ]
                if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) {
                    try? data.write(to: dir.appendingPathComponent("experiments.json"))
                    print("[PROTEUS_EXP] ALL_DONE")
                }
                // 测完即退出（隔离模式：单点测量，不参与后续实验）
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { exit(0) }
                return
            }

            var report: [String: Any] = [:]
            let t0 = CACurrentMediaTime()
            func flush(_ tag: String) {
                report["meta"] = [
                    "device": ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] != nil
                        ? "iOS Simulator" : "Physical Device",
                    "screen": "\(Int(UIScreen.main.bounds.width))x\(Int(UIScreen.main.bounds.height))",
                    "scale": UIScreen.main.scale,
                    "model": ProcessInfo.processInfo.machineName,
                    "systemVersion": UIDevice.current.systemVersion,
                    "definition": "\(ROWS)x\(COLS) items = \(ROWS*COLS) views + \(ROWS*COLS) texts + \(ROWS) rows",
                    "elapsedSec": p(CACurrentMediaTime() - t0),
                    "progress": tag,
                ]
                if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
                    try? data.write(to: dir.appendingPathComponent("experiments.json"))
                }
                print("[PROTEUS_EXP] \(tag)")
            }
            flush("start")
            report["exp5_measure_cache"] = exp5(); flush("exp5_done")
            report["exp3_text_channel"] = exp3(); flush("exp3_done")
            report["exp4_layer_depth"] = exp4(); flush("exp4_done")
            report["exp6_commit_cost_driver"] = exp6(); flush("exp6_done")
            report["exp2_scale_curve"] = exp2(); flush("exp2_done")
            report["exp1_three_routes_4050"] = exp1(); flush("exp1_done")
            report["exp7_scroll_fps"] = exp7(); flush("exp7_done")
            report["exp8_memory"] = exp8(); flush("ALL_DONE")
        }
    }
}

@main
final class ExpAppDelegate: UIResponder, UIApplicationDelegate {
    static func main() {
        UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(ExpAppDelegate.self))
    }
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        true
    }
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
        c.delegateClass = ExpSceneDelegate.self
        return c
    }
}
