// hosts/ios/experiments/device/layout-core-device.swift
// ★★真机验证宿主：把 **Rust 排版核心**（`packages/layout-core-rust`）送上 iPhone 实机跑两件事
//
//   ① **一致性**：用 `proteus_layout_conformance(golden)` 让**真机**重算并用浏览器基准比对
//      —— 判据（浏览器 golden）跟着核心一起上机，于是「真机算的与浏览器一致」是设备上量出来的事实
//   ② **性能**：`proteus_layout_bench(node_count, iters)` —— 4050 元素的真机耗时
//
// 【为什么单独一个宿主（而不是并进 main-device.swift）】
//   既有 H1–H4 实验回答的是「UIKit/CALayer 路线怎么选」；本宿主回答的是
//   「**自研核心在真机上是否正确、够快**」——两个问题，两份报告，避免一个脚本里两套结论互相污染。
//
// 【运行】bash hosts/ios/experiments/device/run-layout-core.sh
import UIKit

// ────────────────────────── C ABI 声明（与 packages/layout-core-rust/src/ffi.rs 对应） ──────────────────────────

@_silgen_name("proteus_layout_version")
func proteus_layout_version() -> UnsafeMutablePointer<CChar>

@_silgen_name("proteus_layout_conformance")
func proteus_layout_conformance(_ goldenJson: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>

@_silgen_name("proteus_layout_bench")
func proteus_layout_bench(_ nodeCount: UInt32, _ iterations: UInt32) -> UnsafeMutablePointer<CChar>

@_silgen_name("proteus_layout_free_string")
func proteus_layout_free_string(_ ptr: UnsafeMutablePointer<CChar>)

// ────────────────────────── 工具 ──────────────────────────

func takeString(_ ptr: UnsafeMutablePointer<CChar>) -> String {
    defer { proteus_layout_free_string(ptr) }
    return String(cString: ptr)
}

func writeReport(_ name: String, _ json: String) {
    let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let url = dir.appendingPathComponent(name)
    try? json.write(to: url, atomically: true, encoding: .utf8)
    NSLog("[proteus] 报告已写入 %@", url.path)
}

/// 读随 app bundle 一起装进去的 golden（由 run 脚本拷贝）
func loadGolden() -> String? {
    guard let path = Bundle.main.path(forResource: "browser-layout", ofType: "json") else {
        return nil
    }
    return try? String(contentsOfFile: path, encoding: .utf8)
}

// ────────────────────────── 宿主 App ──────────────────────────

final class ViewController: UIViewController {
    private let label = UILabel()
    private var reportText = "启动中…"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        label.numberOfLines = 0
        label.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            label.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
        ])

        // ★同步跑完（实验宿主，不需要交互）：viewDidAppear 之后立即执行，结果写入 Documents
        DispatchQueue.main.async { [weak self] in
            self?.runAll()
        }
    }

    private func runAll() {
        var lines: [String] = []
        lines.append("=== Rust 排版核心 · 真机验证 ===")
        lines.append("引擎：\(takeString(proteus_layout_version()))")
        lines.append("设备：\(UIDevice.current.model) · \(UIDevice.current.systemName) \(UIDevice.current.systemVersion)")

        // ① 一致性（用浏览器 golden）
        if let golden = loadGolden() {
            let report = takeString(proteus_layout_conformance(golden))
            writeReport("layout-conformance.json", report)
            lines.append("")
            lines.append("【① 与浏览器基准的一致性】")
            lines.append(report)
        } else {
            let msg = "{\"ok\":false,\"error\":\"browser-layout.json 未随 bundle 装入\"}"
            writeReport("layout-conformance.json", msg)
            lines.append("")
            lines.append("【① 一致性】✗ \(msg)")
        }

        // ② 性能（4050 元素，贴近 M2 出口条件的规模）
        let bench = takeString(proteus_layout_bench(4050, 20))
        writeReport("layout-bench.json", bench)
        lines.append("")
        lines.append("【② 4050 元素布局性能】")
        lines.append(bench)

        reportText = lines.joined(separator: "\n")
        label.text = reportText
        NSLog("[proteus] 完整报告：\n%@", reportText)
    }
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = ViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
