// hosts/ios/ProteusHost/dev/calayer-scene.swift
// ★★M4 起点：**iOS CALayer 路线** —— 用 Rust 排版核心驱动 CALayer 树（方案 §6.2 规格）。
//
// 【方案 §6.2 的规格逐条落实】
//   · 宿主：**一个宿主 UIView**，内部直接管理 CALayer 树                  → LayerHostView
//   · 节点：**跳过 UIView**，直接用 CALayer（UIView 承担事件/布局/Responder Chain，是纯开销）
//   · 布局：使用**排版核心**（Rust），绕开 AutoLayout（其 CPU 消耗随视图数量指数上升）
//   · 文本：`CATextLayer`（GPU 加速）——本场景只画色块 + 一条文本，先验证几何通道
//   · 提交：CALayer 树 → Render Server
//
// 【为什么这个场景与 Android 的 shot 场景**同规格**】
//   两端用同一套场景定义（12 行、行高 40、同一个颜色公式）+ **同一个核验脚本**
//   → 「iOS CALayer 路线」与「Android Canvas 路线」的几何正确性可直接对比。
//
// 【运行】bash hosts/ios/run-calayer-scene.sh
import UIKit

/* ────────────────────────── Rust 核心的 C ABI（与 ffi.rs 对应） ────────────────────────── */

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

/* ────────────────────────── 场景定义（★与 Android shot 场景同规格） ────────────────────────── */

enum SceneSpec {
    static let rows = 12
    static let rowH = 40
    static let rowW = 600
    static let left = 60
    static let top = 200

    /// ★行色公式：必须与 Android 侧一致（也是核验脚本独立重算的那条）
    static func rowColor(_ i: Int) -> UInt32 {
        let r = UInt32(40 + (i * 10) % 200)
        let g = UInt32(90 + (i * 17) % 150)
        let b = UInt32(200 - (i * 7) % 150)
        return 0xFF000000 | (r << 16) | (g << 8) | b
    }

    /// 构建布局请求 JSON（12 行 column，每行定高）
    static func requestJSON() -> String {
        var nodes = "{\"id\":1,\"parentId\":null,\"width\":\(rowW).0,\"flexDirection\":\"column\"}"
        for i in 0..<rows {
            nodes += ",{\"id\":\(i + 2),\"parentId\":1,\"width\":\(rowW).0,\"height\":\(rowH).0}"
        }
        return "{\"viewport\":{\"width\":1080,\"height\":2400},\"nodes\":[\(nodes)],\"textMeasures\":{}}"
    }
}

/* ────────────────────────── 宿主：一个 UIView + CALayer 树 ────────────────────────── */

final class LayerHostView: UIView {
    /// 所有节点 layer（方案 §6.2：跳过 UIView，直接用 CALayer）
    private var nodeLayers: [CALayer] = []
    private var textLayer: CATextLayer?

    /// 用 **Rust 几何** 建立 layer 树
    func buildFromRustGeometry() -> (ok: Bool, report: String) {
        // ① 调 Rust 核心建树
        let handle = SceneSpec.requestJSON().withCString { proteus_layout_create($0) }
        guard handle > 0 else {
            return (false, "{\"ok\":false,\"error\":\"proteus_layout_create 失败\"}")
        }
        defer { _ = proteus_layout_destroy(handle) }

        let rectsJson = takeString(proteus_layout_rects(handle))

        // ② 解析几何
        guard let data = rectsJson.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rects = root["rects"] as? [String: [String: Double]] else {
            return (false, "{\"ok\":false,\"error\":\"rects 解析失败\"}")
        }

        // ③ 建立 CALayer 树（**位置/尺寸完全由 Rust 几何决定**）
        var expected: [[String: Any]] = []
        for i in 0..<SceneSpec.rows {
            guard let r = rects[String(i + 2)] else { continue }
            let x = CGFloat(SceneSpec.left) + CGFloat(r["x"] ?? 0)
            let y = CGFloat(SceneSpec.top) + CGFloat(r["y"] ?? 0)
            let w = CGFloat(r["width"] ?? 0)
            let h = CGFloat(r["height"] ?? 0)

            let layer = CALayer()
            layer.frame = CGRect(x: x, y: y, width: w, height: h)
            layer.backgroundColor = Self.cgColor(SceneSpec.rowColor(i))
            // 方案 §6.2 硬约束 2：避免 cornerRadius+masksToBounds+shadow 同层（离屏渲染）
            layer.masksToBounds = false
            layer.shadowOpacity = 0

            layerTree.addSublayer(layer)
            nodeLayers.append(layer)

            expected.append([
                "row": i,
                // I2-ALLOW: 核验**期望值报告**（层几何用未取整的 CGFloat；报告取整便于整数比对）
                "x": Int(x.rounded()), "y": Int(y.rounded()),
                "w": Int(w.rounded()), "h": Int(h.rounded()),
                "color": String(format: "#%06X", SceneSpec.rowColor(i) & 0xFFFFFF),
            ])
        }

        // ④ 文本（方案 §6.2：CATextLayer，GPU 加速）——验证文本通道与几何共存
        let tl = CATextLayer()
        tl.frame = CGRect(x: CGFloat(SceneSpec.left), y: CGFloat(SceneSpec.top) + CGFloat(SceneSpec.rows * SceneSpec.rowH) + 20,
                          width: 400, height: 30)
        tl.string = "CALayer 路线 · Rust 几何驱动"
        tl.fontSize = 16
        tl.foregroundColor = UIColor.black.cgColor
        tl.alignmentMode = .left
        tl.contentsScale = UIScreen.main.scale      // ★不设会模糊
        layerTree.addSublayer(tl)
        textLayer = tl

        // ⑤ 报告（供宿主机核验；格式与 Android 侧一致 → 同一个核验脚本可用）
        let frameInScreen = convert(bounds, to: nil)
        let originInWindow = window?.convert(frameInScreen.origin, to: nil) ?? frameInScreen.origin
        let report: [String: Any] = [
            "ok": true,
            "path": "calayer-scene",
            "rows": SceneSpec.rows,
            "row_h": SceneSpec.rowH,
            "row_w": SceneSpec.rowW,
            "offset_left": SceneSpec.left,
            "offset_top": SceneSpec.top,
            "expected": expected,
            // ★坐标对齐：layer 的 frame 是**相对宿主 layer**的 → 核验需加宿主在屏幕上的原点
            // I2-ALLOW: 以下四项为**核验报告**（视图/窗口几何读数，供 Python 核验脚本比对）
            "view_origin_x": Int(originInWindow.x.rounded()),
            "view_origin_y": Int(originInWindow.y.rounded()),
            "view_width": Int(bounds.width.rounded()),
            "view_height": Int(bounds.height.rounded()),
            "engine": takeString(proteus_layout_version()),
            "node_layers": nodeLayers.count,
            "note": "★M4 CALayer 路线：宿主 UIView + CALayer 树（跳过 UIView），几何由 Rust 核心驱动；"
                  + "场景规格与 Android shot 同规格 → 同一个核验脚本可对拍",
        ]
        let reportData = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted])
        return (true, String(data: reportData ?? Data(), encoding: .utf8) ?? "{}")
    }

    /// 宿主自有的 layer 树（方案 §6.2：宿主内部直接管理 CALayer 树）
    private let layerTree = CALayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .white
        // ★宿主 layer 直接承载子 layer（不建中间 UIView）
        layer.addSublayer(layerTree)
        layerTree.frame = bounds
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        layerTree.frame = bounds
    }

    static func cgColor(_ argb: UInt32) -> CGColor {
        let a = CGFloat((argb >> 24) & 0xFF) / 255.0
        let r = CGFloat((argb >> 16) & 0xFF) / 255.0
        let g = CGFloat((argb >> 8) & 0xFF) / 255.0
        let b = CGFloat(argb & 0xFF) / 255.0
        return UIColor(red: r, green: g, blue: b, alpha: a).cgColor
    }

    /// 报告路径（Documents；宿主机经 devicectl 取回）
    static func reportURL() -> URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("calayer-scene.json")
    }
}

/* ────────────────────────── 宿主 App ────────────────────────── */

final class SceneViewController: UIViewController {
    private var host: LayerHostView!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        host = LayerHostView(frame: view.bounds)
        host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // ★布局完成后再建场景（否则 bounds 为 0，layer 位置无从判断）
        host.layoutIfNeeded()
        let (ok, report) = host.buildFromRustGeometry()
        try? report.write(to: LayerHostView.reportURL(), atomically: true, encoding: .utf8)
        NSLog("[proteus] calayer-scene ok=%d 报告=%s", ok ? 1 : 0, LayerHostView.reportURL().path)

        // ★自截图（app 内渲染到 PNG）——不依赖外部截图工具，且**走真实 layer 渲染路径**
        //   （`UIGraphicsImageRenderer` 会把 layer 树渲染进 bitmap；
        //     用 `layer.render(in:)` 而非 snapshotView，保证包含 CALayer 子层）
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            let fmt = UIGraphicsImageRendererFormat()
            fmt.scale = 1.0                       // ★scale=1：让像素坐标与 point 坐标 1:1（便于核验）
            fmt.opaque = true
            let renderer = UIGraphicsImageRenderer(bounds: self.host.bounds, format: fmt)
            let image = renderer.image { ctx in
                self.host.layer.render(in: ctx.cgContext)
            }
            if let png = image.pngData() {
                let url = LayerHostView.reportURL().deletingLastPathComponent().appendingPathComponent("calayer-scene.png")
                try? png.write(to: url)
                NSLog("[proteus] 截图已写入 %s", url.path)
            }
        }
    }
}

/// ★★iOS 27 SDK **强制要求 UIScene 生命周期**（本仓实测踩到：不用 Scene 时应用 0.5s 后退出，
/// Documents 为空、无崩溃报告——只能从 `log show` 看到 "UIScene life cycle is required"）。
/// 故必须：`@main` + `configurationForConnecting` + SceneDelegate。
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let win = UIWindow(windowScene: windowScene)
        win.rootViewController = SceneViewController()
        win.makeKeyAndVisible()
        window = win
    }
}

@main
final class SceneAppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
