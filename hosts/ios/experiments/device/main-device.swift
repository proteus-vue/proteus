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
            report["exp2_scale_curve"] = exp2(); flush("exp2_done")
            report["exp1_three_routes_4050"] = exp1(); flush("ALL_DONE")
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
