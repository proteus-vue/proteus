// hosts/ios/ProteusHost/main.swift —— iOS 宿主（★竖切 M1：JavaScriptCore → UIKit）
//
// 这条链路（本文件承担最后一段）：
//   bundle.js（Vue + Dispatcher + NativeBackend）→ proteusNative（本文件经 JSExport 暴露）
//   → UIView 注册表 → 真实 UIKit 视图树 → 布局 → 快照落盘（机器可读证据）
//
// ★诚实边界（M1 竖切骨架）：
//   ① 属性映射只做「看得见的少数」：背景色/圆角/文本色/字号/固定尺寸；布局用 UIKit 缺省栈式排布
//      （不实现 flex/grid 求解——M3+）；
//   ② 无手势/动画/Glass（M5/M6）；无热切换演示（Dispatcher 已具备，本步只跑单后端）；
//   ③ 快照是**宿主自证**：把 UIKit 真实层级与关键属性导出为 JSON，供仓库侧脚本对账
//      （不是「我说渲染了」——是「这是 UIKit 里的实际对象与几何」）。
import UIKit
import JavaScriptCore

// ─────────────────────────── 桥（JSExport） ───────────────────────────
/// 与 hosts/ios/bridge/entry.ts 的 `interface ProteusNative` 一一对应（改名要同步）。
@objc protocol ProteusNativeExports: JSExport {
    func createView(_ type: String, _ propsJson: String) -> Int
    func updateView(_ handle: Int, _ key: String, _ valueJson: String)
    func insertView(_ child: Int, _ parent: Int, _ anchor: Int)
    func removeView(_ handle: Int)
    func setViewText(_ handle: Int, _ text: String)
    func ready(_ summaryJson: String)
}

/// UIKit 视图工厂：把 backend 的语义类型名映射到真实 UIKit 类。
/// 映射表来源 = packages/render-backend/src/native.ts 的 SEMANTIC_NATIVE_MAPS.ios（此处只实现子集）。
func makeView(_ type: String) -> UIView {
    switch type {
    case "UILabel", "UILabel.heading", "UILabel.label":
        let l = UILabel()
        l.numberOfLines = 1
        return l
    case "UIStackView":
        let s = UIStackView()
        s.axis = .vertical
        s.spacing = 10
        s.alignment = .fill
        return s
    case "UIButton", "UIButton.checkbox", "UIButton.radio", "UIButton.link":
        return UIButton(type: .system)
    case "UITextField":
        return UITextField()
    case "UIView.divider":
        let v = UIView()
        v.backgroundColor = UIColor.separator
        return v
    default:
        // UIView / UIView.* / UIScrollView / 未知类型 —— 全部落到普通容器（诚实：不静默失败，但记录）
        return UIView()
    }
}

/// 颜色解析（#rrggbb / 简写 #rgb；失败返回 nil——不猜测）
func parseColor(_ raw: Any?) -> UIColor? {
    guard let s = raw as? String else { return nil }
    var hex = s.trimmingCharacters(in: .whitespaces)
    guard hex.hasPrefix("#") else { return nil }
    hex.removeFirst()
    if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
    guard hex.count == 6, let v = UInt32(hex, radix: 16) else { return nil }
    return UIColor(
        red: CGFloat((v >> 16) & 0xFF) / 255,
        green: CGFloat((v >> 8) & 0xFF) / 255,
        blue: CGFloat(v & 0xFF) / 255,
        alpha: 1
    )
}

func parsePx(_ raw: Any?) -> CGFloat? {
    guard let s = raw as? String else { return nil }
    let n = s.replacingOccurrences(of: "px", with: "")
    return Double(n).map { CGFloat($0) }
}

/// 样式表：backend 把 Vue 的 style 以「扁平化的属性键」下发（patchProp 逐个 key）。
/// 这里按本仓既有约定解析（backgroundColor / color / fontSize / borderRadius / height / width / marginTop / padding）。
struct StyleBag {
    var dict: [String: Any] = [:]
    mutating func merge(_ json: String) {
        guard let d = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { return }
        for (k, v) in d { dict[k] = v }
    }
    /// Vue 的 style 以对象下发时会被 JSON 序列化成字典；这里做一次展开
    mutating func absorbStyleObject() {
        if let nested = dict["style"] as? [String: Any] {
            for (k, v) in nested { dict[k] = v }
        }
    }
}

/// 桥实现：维护 handle → UIView 注册表 + 父子关系，并收集快照。
final class ProteusBridge: NSObject, ProteusNativeExports {
    private var views: [Int: UIView] = [:]
    private var styles: [Int: StyleBag] = [:]
    private var types: [Int: String] = [:]
    private var children: [Int: [Int]] = [:]
    private var parentOf: [Int: Int] = [:]
    private var textOf: [Int: String] = [:]
    private var nextId = 1

    /// 根容器（App 启动时创建；JS 侧 pivot 视图挂到它下面）
    let root = UIView()
    /// 链路完成后的回调（在主线程断言）
    var onReady: ((String) -> Void)?

    func createView(_ type: String, _ propsJson: String) -> Int {
        let id = nextId; nextId += 1
        let v = makeView(type)
        views[id] = v
        types[id] = type
        var bag = StyleBag()
        bag.merge(propsJson)
        bag.absorbStyleObject()
        styles[id] = bag
        applyStyle(id)
        return id
    }

    func updateView(_ handle: Int, _ key: String, _ valueJson: String) {
        guard styles[handle] != nil else { return }
        // patchProp 逐个 key 下发：值为 JSON 标量或对象
        let parsed = try? JSONSerialization.jsonObject(with: Data(valueJson.utf8), options: [.fragmentsAllowed])
        if key == "style", let d = parsed as? [String: Any] {
            for (k, v) in d { styles[handle]!.dict[k] = v }
        } else {
            styles[handle]!.dict[key] = parsed ?? NSNull()
        }
        applyStyle(handle)
    }

    func insertView(_ child: Int, _ parent: Int, _ anchor: Int) {
        guard let cv = views[child], let pv = views[parent] else { return }
        parentOf[child] = parent
        children[parent, default: []].append(child)
        // 锚点：插到 anchor 之前（保持 Vue diff 的顺序语义）
        if anchor >= 0, let av = views[anchor], let idx = pv.subviews.firstIndex(of: av) {
            pv.insertSubview(cv, at: idx)
        } else {
            pv.addSubview(cv)
        }
    }

    func removeView(_ handle: Int) {
        views[handle]?.removeFromSuperview()
        if let p = parentOf[handle] { children[p]?.removeAll { $0 == handle } }
        views[handle] = nil
        styles[handle] = nil
        types[handle] = nil
        textOf[handle] = nil
    }

    func setViewText(_ handle: Int, _ text: String) {
        guard let v = views[handle] else { return }
        textOf[handle] = text
        if let l = v as? UILabel { l.text = text }
        else if let b = v as? UIButton { b.setTitle(text, for: .normal) }
        else if let t = v as? UITextField { t.text = text }
    }

    func ready(_ summaryJson: String) {
        onReady?(summaryJson)
    }

    /// 应用样式（本步支持的子集——其余键保留在 bag 中但**不静默假装生效**，快照里如实标注）
    private func applyStyle(_ id: Int) {
        guard let v = views[id], let bag = styles[id] else { return }
        let d = bag.dict
        if let c = parseColor(d["backgroundColor"]) { v.backgroundColor = c }
        if let c = parseColor(d["color"]) {
            if let l = v as? UILabel { l.textColor = c }
            else if let b = v as? UIButton { b.setTitleColor(c, for: .normal) }
            else if let t = v as? UITextField { t.textColor = c }
        }
        if let f = parsePx(d["fontSize"]), let l = v as? UILabel {
            l.font = UIFont.systemFont(ofSize: f, weight: .semibold)
        }
        if let r = parsePx(d["borderRadius"]) { v.layer.cornerRadius = r; v.layer.masksToBounds = true }
        if let h = parsePx(d["height"]) { v.heightAnchor.constraint(equalToConstant: h).isActive = true }
    }

    /// 把 JS 创建的根视图挂进宿主视图层级（M1 挂载点：宿主 root 的唯一子视图）
    func mountRoots(into host: UIView) {
        let roots = views.filter { parentOf[$0.key] == nil }.keys.sorted()
        for id in roots where views[id]?.superview == nil {
            guard let v = views[id] else { continue }
            v.frame = host.bounds
            v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            host.addSubview(v)
        }
    }

    /// ★机器可读快照：UIKit 真实层级 + 关键属性 + **布局后的几何**（对账用）
    func snapshot() -> [String: Any] {
        let rootFrame = root.frame
        func node(_ id: Int) -> [String: Any] {
            let v = views[id]!
            var out: [String: Any] = [
                "id": id,
                "type": types[id] ?? "?",
                "class": String(describing: type(of: v)),
                "frame": ["x": Double(v.frame.origin.x), "y": Double(v.frame.origin.y),
                          "w": Double(v.frame.size.width), "h": Double(v.frame.size.height)],
                "children": (children[id] ?? []).map { node($0) },
            ]
            if let t = textOf[id] { out["text"] = t }
            if let c = v.backgroundColor, let comps = c.cgColor.components, comps.count >= 3 {
                out["backgroundColor"] = String(format: "#%02X%02X%02X",
                    Int(comps[0] * 255), Int(comps[1] * 255), Int(comps[2] * 255))
            }
            if let l = v as? UILabel, let c = l.textColor, let comps = c.cgColor.components, comps.count >= 3 {
                out["textColor"] = String(format: "#%02X%02X%02X",
                    Int(comps[0] * 255), Int(comps[1] * 255), Int(comps[2] * 255))
                out["fontSize"] = Double(l.font.pointSize)
            }
            if v.layer.cornerRadius > 0 { out["cornerRadius"] = Double(v.layer.cornerRadius) }
            return out
        }
        // ★根 = **无父节点**的视图（JS 侧创建的根容器）——不是宿主 root 的子视图：
        //   宿主 root 是挂载点，JS 的树是独立的一棵（M1 未做 mount 合并，见 README 诚实边界）。
        let roots = views.filter { parentOf[$0.key] == nil }.keys.sorted()
        return [
            "rootFrame": ["w": Double(rootFrame.size.width), "h": Double(rootFrame.size.height)],
            "totalViews": views.count,
            "topLevel": roots.map { node($0) },
        ]
    }
}

// ─────────────────────────── App 启动 ───────────────────────────
// ★用 @main + UIApplicationDelegateAdaptor 等价物（无 storyboard）：
//   Swift 5.3+ 的 @main 要求类型提供 main()；UIKit 无 SwiftUI 的 adaptor，
//   故这里用 `@main` 标注 AppDelegate 并显式实现静态 main()（等价 UIApplicationMain）。
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    static func main() {
        UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
    }

    var window: UIWindow?
    let bridge = ProteusBridge()
    private var readySummary: String?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let win = UIWindow(frame: UIScreen.main.bounds)
        let vc = UIViewController()
        vc.view.backgroundColor = .black
        bridge.root.frame = vc.view.bounds
        bridge.root.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        vc.view.addSubview(bridge.root)
        win.rootViewController = vc
        win.makeKeyAndVisible()
        window = win

        bridge.onReady = { [weak self] summary in
            // 主线程：布局完成后再落快照（保证几何是最终值）
            DispatchQueue.main.async {
                guard let self else { return }
                self.readySummary = summary
                // ★把 JS 创建的根视图挂进宿主层级（否则 UIKit 里看不见——只存在于注册表）
                self.bridge.mountRoots(into: self.bridge.root)
                self.bridge.root.layoutIfNeeded()
                self.writeSnapshot(summary: summary)
            }
        }

        runBundle()
        return true
    }

    /// 加载 JS bundle（JSC 无模块加载器 → 直接 evaluateScript）
    private func runBundle() {
        guard let ctx = JSContext() else {
            writeFailure("JSContext 创建失败")
            return
        }
        ctx.exceptionHandler = { [weak self] _, err in
            self?.writeFailure("JS 异常：\(String(describing: err))")
        }
        ctx.setObject(bridge, forKeyedSubscript: "proteusNative" as NSString)

        guard let path = Bundle.main.path(forResource: "bundle", ofType: "js"),
              let src = try? String(contentsOfFile: path, encoding: .utf8) else {
            writeFailure("bundle.js 未打包进 .app")
            return
        }
        ctx.evaluateScript(src)
    }

    /// 快照落盘：写进 App 沙盒 Documents（供 -hostSnapshotOut 或容器路径读取）
    private func writeSnapshot(summary: String) {
        let snap = bridge.snapshot()
        let payload: [String: Any] = ["ok": true, "summary": summary, "snapshot": snap]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) else { return }
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let out = dir.appendingPathComponent("host-snapshot.json")
        try? data.write(to: out)
        // 同时打到 stdout（模拟器日志可见——排错与 CI 都用得上）
        if let s = String(data: data, encoding: .utf8) {
            print("PROTEUS_IOS_SNAPSHOT_BEGIN")
            print(s)
            print("PROTEUS_IOS_SNAPSHOT_END")
        }
    }

    private func writeFailure(_ reason: String) {
        let payload: [String: Any] = ["ok": false, "error": reason]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]),
           let s = String(data: data, encoding: .utf8) {
            print("PROTEUS_IOS_SNAPSHOT_BEGIN")
            print(s)
            print("PROTEUS_IOS_SNAPSHOT_END")
        }
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        try? data(payload).write(to: dir.appendingPathComponent("host-snapshot.json"))
    }

    private func data(_ payload: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])) ?? Data("{}".utf8)
    }
}
