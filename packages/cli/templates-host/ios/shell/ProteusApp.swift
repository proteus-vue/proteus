// {{appName}} —— 最小宿主入口（Proteus 生成）
//
// 【它做什么】把 **Proteus 编译产物**（`app-screen-content.json`：项目路由 → 真实 SFC → 编译器 → 屏内容）
//   经 **runtime 单元**（`runtime/ProteusHostController`）真上屏。壳只做三件事：
//     ① 装配窗口；② 起 ProteusHostController；③ 取产物页挂载。
//   ★本壳**不含项目身份/业务逻辑**（起始页名从 Info.plist `ProteusHomePage` 读，默认 index）；
//     换一个项目只需替换 `app-screen-content.json`。与 Android ScreenHost / 鸿蒙 MainPage 同形。
//
// 【依赖（同模块编译的源集单元）】runtime/*.swift + platform/ProteusTextAdapter.swift + 内核 .a
//   ——由 CLI `create host ios` 随本工程一并生成，`build --package` 时与内核一起 `swiftc` 进本可执行文件。
import UIKit

@main
final class ProteusAppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        NSLog("[proteus] {{appName}} didFinishLaunching")
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c = UISceneConfiguration(name: "Default", sessionRole: session.role)
        c.delegateClass = ProteusSceneDelegate.self
        return c
    }
}

final class ProteusSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        w.rootViewController = ProteusHomeViewController()
        w.makeKeyAndVisible()
        window = w
        // ★机器判据：宿主已启动（供零 sleep 的条件等待）
        NSLog("[proteus] PROTEUS_HOST_READY")
    }
}

/// 最小宿主页：起 runtime 控制器 → 挂载编译产物首页。
final class ProteusHomeViewController: UIViewController {
    private var controller: ProteusHostController?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let c = ProteusHostController(frame: view.bounds)
        c.contentView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(c.contentView)
        controller = c
        // 起始页名来自 Info.plist（缺省 index）——壳不硬编码项目页名
        let page = (Bundle.main.object(forInfoDictionaryKey: "ProteusHomePage") as? String) ?? "index"
        // 壳负责定位**项目编译产物**（runtime 不认具体文件名；换项目只换此资源）
        var out = "{\"ok\":false,\"error\":\"缺 app-screen-content.json\"}"
        if let url = Bundle.main.url(forResource: "app-screen-content", withExtension: "json") {
            out = c.mountPage(page, fromScreenContent: url, viewport: view.bounds.size)
        }
        let ok = out.contains("\"ok\":true")
        NSLog("[proteus] HOST_PAGE_RENDER page=%@ ok=%@ result=%@", page, ok ? "true" : "false", String(out.prefix(160)))
        // ★零 sleep 完成信号（与参考宿主同机制）：报告落盘后进程自退 ⇒
        //   devicectl launch --console **阻塞到退出** ⇒ 返回即完成（无轮询/无 sleep/无超时）。
        //   不带该环境变量则常驻（给人看的桌面点开形态）。
        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" {
            _ = c.contentView.snapshot(named: "host-report")
            writeReport(page: page, ok: ok, raw: out)
            exit(0)
        }
    }

    /// 落盘报告（供 CLI/脚本断言；Documents/HOST_REPORT.json）
    private func writeReport(page: String, ok: Bool, raw: String) {
        let body: [String: Any] = ["host_id": "ios", "page": page, "ok": ok, "raw": raw]
        guard let d = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return }
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("HOST_REPORT.json")
        try? d.write(to: url)
        NSLog("[proteus] HOST_REPORT_READY %@", url.path)
    }
}
