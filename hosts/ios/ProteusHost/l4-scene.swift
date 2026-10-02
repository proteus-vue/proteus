// hosts/ios/ProteusHost/l4-scene.swift
// ★★L4 像素观测夹具（iOS 端 · CALayer 自绘）——与小程序两页 / Web 页 / Android 场景**逐项同声明**。
//
// 【它补哪个缺口】L4 此前只有 Web / 小程序三端真截图（`docs/generated/consistency-samples/pixels/`）。
//   本项目要"把一致性标准全部拉齐"到 iOS / Android —— 本文件是 iOS 侧的采集装置：
//   同一组声明（圆角 14 / 阴影 0-3-10 rgba(0,0,0,.7) / 线性渐变 90° / 18 字形）
//   在本端用 **CALayer 树**画出，由报告侧 `anchorNormalize`（锚块定标+定位）归一到同一坐标系。
//
// 【为什么用 CALayer 而不是 UIView】与宿主主链一致（方案 §6.2：跳过 UIView，CALayer 直管）；
//   本场景只验"系统光栅化画出来像不像"，宿主几何链路由其它场景承担。
//
// 【阴影为什么分层逼近（跨端一致优先）】iOS 原生 `shadow*` 是高斯阴影，与 Android（无矩形
//   shadow API，本仓用分层）不同形 ⇒ 两端统一**分层展开圆角矩形 + alpha 平方衰减**（同 glow 式）。
//   这与 Web/小程序侧的 CSS `box-shadow` **有意不同形**——L4 是观测（非门禁），
//   本批如实登记该差异（读数为 evidence，不是"必须一致"）。
//
// 【运行】bash hosts/ios/run-l4-sim.sh [模拟器名]
import UIKit

/* ────────────────────────── 声明（★五端逐字同源，改这里必须五端同步） ────────────────────────── */

enum L4Spec {
    // ★u = 声明单位 → **pt**（UIKit 单位）；@3x 屏由系统放大 ⇒ 80u=80pt=240px，
    //   与 Android（80dp × density3 = 240px）/ Web（80 CSS px @DPR2）物理尺度对齐。
    //   （首版 u=3 是错的：3pt 会变 720px——是 Android 的 3 倍大，锚定归一窗口直接越界。）
    static let u: CGFloat = 1
    static let padTop: CGFloat = 120
    static let padX: CGFloat = 16
    static let bw: CGFloat = 80, bh: CGFloat = 48, gap: CGFloat = 10, r: CGFloat = 14
    static let shadowDY: CGFloat = 3, shadowBlur: CGFloat = 10, shadowAlpha: CGFloat = 0.7
    static let font: CGFloat = 18
    static let bg = UIColor(red: 0x14/255, green: 0x14/255, blue: 0x1C/255, alpha: 1)
    static let cBlock = UIColor(red: 0x2F/255, green: 0x6F/255, blue: 0xED/255, alpha: 1)
    static let cShadowBg = UIColor(red: 0x2A/255, green: 0x3F/255, blue: 0x66/255, alpha: 1)
    static let gradFrom = UIColor(red: 0x7C/255, green: 0x5C/255, blue: 0xFF/255, alpha: 1)
    static let gradTo = UIColor(red: 0xFF/255, green: 0x9A/255, blue: 0x6C/255, alpha: 1)
}

/* ────────────────────────── 宿主：一个 UIView + CALayer 树 ────────────────────────── */

final class L4HostView: UIView {
    private let layerTree = CALayer()
    /// 首帧画过的证据（`onDraw` 等价物——CALayer 路径无 onDraw，用"已提交到屏幕"的合成回调）
    private(set) var framesCommitted = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = L4Spec.bg
        layer.addSublayer(layerTree)
        layerTree.frame = bounds
    }
    required init?(coder: NSCoder) { fatalError("not used") }
    override func layoutSubviews() {
        super.layoutSubviews()
        layerTree.frame = bounds
    }

    /// 建 L4 四元素（位置/尺寸 = 声明 × u，纯本端——本场景不验 Rust 几何）
    func buildL4() {
        let u = L4Spec.u
        let x = L4Spec.padX * u
        var y = L4Spec.padTop * u
        let bw = L4Spec.bw * u, bh = L4Spec.bh * u, gap = L4Spec.gap * u, r = L4Spec.r * u

        CATransaction.begin()
        CATransaction.setDisableActions(true)

        // ① 圆角块
        let radius = CALayer()
        radius.frame = CGRect(x: x, y: y, width: bw, height: bh)
        radius.backgroundColor = L4Spec.cBlock.cgColor
        radius.cornerRadius = r
        layerTree.addSublayer(radius)
        y += bh + gap

        // ② 阴影块：分层展开圆角矩形（与 Android 同式）。
        //
        // ★★alpha 必须按 **over 合成反算**（2026-10-02 实测修复"黑块污染"）：
        //   分层是**实心填充**叠加——近环被全部 N 层覆盖，合成 alpha = 1−Π(1−a_j)，
        //   与单层值天差地别。首版把"目标剖面值"直接当每层 alpha ⇒ 近环合成
        //   1−(1−.7)(1−.486)… ≈ **0.92（近纯黑环）**，且每层一条可见台阶（真机 3x 上肉眼可见"回"字）。
        //   反算：a_k = 1−(1−A_k)/(1−A_{k+1})（A_k = 目标剖面，A_{N+1}=0）
        //   ⇒ 每个环的**合成值精确等于目标剖面**（0.7 起、平方衰减到 0）——数学验证过逐环吻合。
        // ★N=16（原 6）：expand 步进 = blur/N ≈ 1.9px@3x（亚像素级，台阶不可见）。
        let N = 16
        var layerAlphas = [CGFloat](repeating: 0, count: N)
        var nextTarget: CGFloat = 0
        for k in stride(from: N, through: 1, by: -1) {
            let t = CGFloat(k - 1) / CGFloat(N)
            let target = L4Spec.shadowAlpha * (1 - t) * (1 - t)   // A_k
            layerAlphas[k - 1] = 1 - (1 - target) / (1 - nextTarget)
            nextTarget = target
        }
        for k in stride(from: N, through: 1, by: -1) {
            let expand = L4Spec.shadowBlur * CGFloat(k) / CGFloat(N) * u
            let sh = CALayer()
            sh.frame = CGRect(
                x: x - expand, y: y + L4Spec.shadowDY * u - expand,
                width: bw + 2 * expand, height: bh + 2 * expand)
            sh.backgroundColor = UIColor.black.withAlphaComponent(layerAlphas[k - 1]).cgColor
            // ★半径 = **阴影块自身半径（0，直角）** + expand（2026-10-02 实测第二处修复）：
            //   首版误用了变量 `r`（= 圆角块的 14u=42px）⇒ 阴影层带 42+expand 的大圆角，
            //   四角被"咬掉"一块（实测：角点上方 4px 即纯背景，本该有 0.27 alpha 的阴影）——
            //   用户看到的"第二个矩形背景有黑块污染"含此形态。
            //   `0 + expand` 才是**直角矩形的距离场**（Minkowski 和 = 圆角半径 expand，
            //   弧心恰好落在阴影矩形角点 ⇒ 各层同心）。
            sh.cornerRadius = 0 + expand
            layerTree.addSublayer(sh)
        }
        let shadowBody = CALayer()
        shadowBody.frame = CGRect(x: x, y: y, width: bw, height: bh)
        shadowBody.backgroundColor = L4Spec.cShadowBg.cgColor
        layerTree.addSublayer(shadowBody)
        y += bh + gap

        // ③ 渐变块（90° = 左→右；与 TS linearGradientEndpoints 同式：start=(0,0.5) end=(1,0.5)）
        let grad = CAGradientLayer()
        grad.frame = CGRect(x: x, y: y, width: bw, height: bh)
        grad.colors = [L4Spec.gradFrom.cgColor, L4Spec.gradTo.cgColor]
        grad.locations = [0, 1]
        grad.startPoint = CGPoint(x: 0, y: 0.5)
        grad.endPoint = CGPoint(x: 1, y: 0.5)
        layerTree.addSublayer(grad)
        y += bh + gap

        // ④ 字形（CATextLayer——GPU 加速文本通道）
        let glyph = CATextLayer()
        glyph.frame = CGRect(x: x, y: y, width: bw * 2, height: L4Spec.font * u * 1.6)
        glyph.string = "字形 Ag 8 中"
        glyph.fontSize = L4Spec.font * u
        glyph.foregroundColor = UIColor.white.cgColor
        glyph.contentsScale = UIScreen.main.scale   // ★不设会模糊
        glyph.alignmentMode = .left
        layerTree.addSublayer(glyph)

        CATransaction.commit()
    }

    /// 报告（Documents/l4-scene.json；采集脚本以它落盘为"可以取屏"的条件）
    static func reportURL() -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("l4-scene.json")
    }
}

/* ────────────────────────── 宿主 App（@main + SceneDelegate；与 calayer-scene 同骨架） ────────────────────────── */

final class L4ViewController: UIViewController {
    private var host: L4HostView!
    private var committedOnce = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = L4Spec.bg
        host = L4HostView(frame: view.bounds)
        host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host)
        host.buildL4()
    }

    /// ★首帧真的提交到屏幕后才写报告（CALayer 路径的对应物 = `CATransaction` 完成回调）
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !committedOnce else { return }
        committedOnce = true
        CATransaction.begin()
        CATransaction.setCompletionBlock { [weak self] in
            guard let self else { return }
            // ★★真机取屏必须**在 App 内渲染自存**（本批新增）：`devicectl` 没有截图能力
            //   （run-calayer-scene.sh 头注已记），而模拟器用的 `simctl io screenshot` 不适用。
            //   渲染走 `layer.render(in:)`——CoreAnimation 的同一条光栅化路径（本仓已验证模式：
            //   selfdraw-scene.swift 的 `snapshot(named:)`），与屏幕上显示的内容逐像素同源。
            let shotOK = self.savePng()
            self.writeReport(shotOK: shotOK)
            // ★事件驱动收尾：与既有实验脚本同一机制（App 主动上报；脚本侧 launch 返回即完成）
            if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" {
                exit(0)
            }
        }
        CATransaction.commit()
    }

    /// 把当前视图（CALayer 树）渲染为 PNG 存入 Documents——供真机采集脚本经 devicectl 取回。
    ///
    /// 【模式与 selfdraw-scene.swift 的 `snapshot(named:)` 一致】`UIGraphicsImageRenderer`
    /// 给的是**已翻转**的上下文（自建 CGContext 不翻转会上下颠倒——本仓实测过的坑），
    /// 此处直接用系统 renderer ⇒ 无翻转问题；PNG 编码由 `pngData()` 完成（标准 RGBA）。
    /// @returns 是否成功（失败写进报告——**不静默**）
    private func savePng() -> Bool {
        let size = view.bounds.size
        guard size.width > 0, size.height > 0 else { return false }
        let renderer = UIGraphicsImageRenderer(size: size)
        let img = renderer.image { ctx in
            view.layer.render(in: ctx.cgContext)
        }
        guard let data = img.pngData() else { return false }
        let url = L4HostView.reportURL().deletingLastPathComponent().appendingPathComponent("l4-scene.png")
        do {
            try data.write(to: url)
            return true
        } catch {
            return false
        }
    }

    private func writeReport(shotOK: Bool) {
        let b = view.bounds
        let report: [String: Any] = [
            "ok": true,
            "path": "l4-scene",
            "screen": [Int(b.width.rounded()), Int(b.height.rounded())],
            "scale": UIScreen.main.scale,
            "unit": L4Spec.u,
            "shot": shotOK ? "l4-scene.png" : "FAILED",
            "block": [
                "x": Int((L4Spec.padX * L4Spec.u).rounded()),
                "y": Int((L4Spec.padTop * L4Spec.u).rounded()),
                "w": Int((L4Spec.bw * L4Spec.u).rounded()),
                "h": Int((L4Spec.bh * L4Spec.u).rounded()),
            ],
            "elements": [
                "radius(border-radius 14u)",
                "shadow(0/3/10u rgba(0,0,0,0.7) · 分层=跨端一致策略，与 Web CSS box-shadow 有意不同形)",
                "gradient(linear 90° #7c5cff→#ff9a6c)",
                "glyph(18u #fff)",
            ],
            "note": "L4 观测夹具（iOS · CALayer 自绘）；模拟器截屏走 run-l4-sim.sh，真机走 run-l4-device.sh（App 内渲染自存 + devicectl 取回）",
        ]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted]) {
            try? data.write(to: L4HostView.reportURL())
        }
    }
}

final class L4SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let win = UIWindow(windowScene: windowScene)
        win.rootViewController = L4ViewController()
        win.makeKeyAndVisible()
        window = win
    }
}

@main
final class L4AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        return true
    }
    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        config.delegateClass = L4SceneDelegate.self
        return config
    }
}
