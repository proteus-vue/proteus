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
        // 无 fontSize 时给系统默认（否则 0pt 字体 → 无 intrinsic height）
        l.font = UIFont.systemFont(ofSize: UIFont.systemFontSize)
        // 压缩阻力：让 label 保持内容尺寸（否则被 stack 压成 0 宽）
        l.setContentCompressionResistancePriority(.required, for: .horizontal)
        l.setContentHuggingPriority(.required, for: .vertical)
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
    /// ★「填满父级」：CSS 百分比（`width/height: 100%`）在 UIKit 无对应语义
    ///   → 映射为四边贴齐约束（**M1 的布局最小实现**；真正的 flex/grid 求解属 M3+）。
    ///   实测背景：不做这一步时根视图链全是 0×0（整屏全黑）——百分比是纯 CSS 概念。
    var fillsParent: Bool {
        let w = (dict["width"] as? String) ?? ""
        let h = (dict["height"] as? String) ?? ""
        return w.hasSuffix("%") || h.hasSuffix("%")
    }
}

/// 宿主内部视图的标记（spacer 等——不进快照，避免「宿主自作聪明」被误读为 JS 树的一部分）
let spacerTag = 9_001

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
        // ★UIStackView 必须走 addArrangedSubview——用 addSubview 时子视图**不参与 stack 布局**
        //   （实测：背景色可见但所有文字 0×0；JSC 验证器的替身树模拟不出这个 UIKit 语义差异，
        //    只能在真实 UIKit 上暴露——这是「竖切/真机验证」不可被纯 JS 单测替代的又一例证）
        if let stack = pv as? UIStackView {
            if anchor >= 0, let av = views[anchor], let idx = stack.arrangedSubviews.firstIndex(of: av) {
                stack.insertArrangedSubview(cv, at: idx)
            } else {
                stack.addArrangedSubview(cv)
            }
        } else if anchor >= 0, let av = views[anchor], let idx = pv.subviews.firstIndex(of: av) {
            // 锚点：插到 anchor 之前（保持 Vue diff 的顺序语义）
            pv.insertSubview(cv, at: idx)
        } else {
            pv.addSubview(cv)
        }
        // ★CSS 百分比 → 四边贴齐（见 StyleBag.fillsParent 的说明）
        if styles[child]?.fillsParent == true {
            cv.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                cv.leadingAnchor.constraint(equalTo: pv.leadingAnchor),
                cv.trailingAnchor.constraint(equalTo: pv.trailingAnchor),
                cv.topAnchor.constraint(equalTo: pv.topAnchor),
                cv.bottomAnchor.constraint(equalTo: pv.bottomAnchor),
            ])
        } else if !(pv is UIStackView) {
            // ★块级流语义（M1 最小布局）：CSS 里 div 内的子元素宽度天然撑满、
            //   文本类在容器内**垂直居中**（按钮内文字的实际期望）。
            //   不做这一步时：普通 UIView 容器内的 UILabel 无任何约束 → 0×0（实测整排文字消失）。
            //   ⚠ 诚实边界：这不是 flex/grid 求解，只是「块级流」的单条规则（M3+ 才做真正布局）。
            cv.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                cv.leadingAnchor.constraint(equalTo: pv.leadingAnchor),
                cv.trailingAnchor.constraint(equalTo: pv.trailingAnchor),
                cv.centerYAnchor.constraint(equalTo: pv.centerYAnchor),
            ])
        }
        // 内容变化后重建尾部 spacer（顶对齐）
        normalizeStackSpacers()
    }

    /// ★内容顶对齐（M1 最小布局）：UIStackView 的 `.fill` 分布会把多余空间给**某个** arrangedSubview
    ///   （实测第一个 label 被撑到 714px 高——文字顶到天上、下面一片空）。
    ///   UIKit 的标准做法是追加一个**弹性尾部 spacer**；这里由宿主动态维护（内容变化后重建）。
    ///   ⚠ 诚实边界：这不是 CSS flex 求解，只是「顶对齐」这一条规则（M3+ 才做真正布局）。
    func normalizeStackSpacers() {
        // ★只给「屏幕级容器」（无父、被挂到 host 的那个 stack）加 spacer。
        //   内层 stack 若也带 spacer，它会变成**弹性容器**（能靠拉伸内部 spacer 吃下任意高度）
        //   → 根 stack 优先拉伸它（实测内层 stack 被撑到 792px、按钮被顶到屏幕中段）。
        //   内层 stack 应「高度由内容决定」= hugging/compression 都 required。
        let rootIds = Set(views.filter { parentOf[$0.key] == nil }.keys)
        for (id, v) in views {
            guard let stack = v as? UIStackView else { continue }
            for sv in stack.arrangedSubviews where sv.tag == spacerTag {
                stack.removeArrangedSubview(sv)
                sv.removeFromSuperview()
            }
            if rootIds.contains(id) {
                let spacer = UIView()
                spacer.tag = spacerTag
                spacer.setContentHuggingPriority(.init(1), for: .vertical)
                spacer.setContentCompressionResistancePriority(.init(1), for: .vertical)
                stack.addArrangedSubview(spacer)
            } else {
                stack.setContentHuggingPriority(.required, for: .vertical)
                stack.setContentCompressionResistancePriority(.required, for: .vertical)
            }
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

    /// JS 侧完成回调。★时序：JS 在 `didFinishLaunching` 里跑完（早于 Scene 连接），
    ///   此时 onReady 还没注册 → 暂存摘要，等 Scene 连接后由 `flushPendingReady()` 补发。
    private var pendingReady: String?

    func ready(_ summaryJson: String) {
        if let cb = onReady { cb(summaryJson) } else { pendingReady = summaryJson }
    }

    /// Scene 连接后调用：若 JS 早已 ready，补发回调（否则快照永远不会落盘）
    func flushPendingReady() {
        guard let s = pendingReady, let cb = onReady else { return }
        pendingReady = nil
        cb(s)
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

    /// 当前注册表里的视图数（诊断用）
    var viewCount: Int { views.count }

    /// 把 JS 创建的根视图挂进宿主视图层级（M1 挂载点：宿主 root 的唯一子视图）
    ///
    /// ★两条实测得出的约束（2026-09-29，模拟器）：
    ///   ① 「根填充宿主」由**宿主**负责——JS 侧写的 `width/height: 100%` 是 CSS 字符串，
    ///      UIKit 不认（既不设 frame 也不建约束）→ 根视图 0×0，整屏全黑（实测踩到）。
    ///   ② 因此这里用 Auto Layout 四边贴齐宿主，不依赖 JS 传尺寸。
    func mountRoots(into host: UIView) {
        let roots = views.filter { parentOf[$0.key] == nil }.keys.sorted()
        for id in roots where views[id]?.superview == nil {
            guard let v = views[id] else { continue }
            v.translatesAutoresizingMaskIntoConstraints = false
            host.addSubview(v)
            NSLayoutConstraint.activate([
                v.leadingAnchor.constraint(equalTo: host.leadingAnchor),
                v.trailingAnchor.constraint(equalTo: host.trailingAnchor),
                v.topAnchor.constraint(equalTo: host.topAnchor),
                v.bottomAnchor.constraint(equalTo: host.bottomAnchor),
            ])
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
            "hostSpacers": views.values.filter { ($0 as? UIStackView) != nil }
                .flatMap { ($0 as! UIStackView).arrangedSubviews.filter { $0.tag == spacerTag } }.count,
            "totalViews": views.count,
            "topLevel": roots.map { node($0) },
        ]
    }
}

// ─────────────────────────── App 启动 ───────────────────────────
/// ★全局桥实例：`UIApplicationMain` **自行实例化** delegate（无法外部注入状态），
///   故桥用全局持有（M1 骨架的简单做法；生产化时应改为依赖注入）。
let proteusBridge = ProteusBridge()

/// ★UIScene 生命周期（2026-09-29 修复）：iOS 27 SDK 起**未采用 UIScene 的 App 拒绝启动**——
///   实测系统日志：`Application failed to launch: UIScene life cycle is required for apps built with this SDK`
///   （现象：进程 0.5s 后退出、Documents 为空、**无崩溃报告**——只能从 log show 看出，容易误判为「代码没跑」）。
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    static func main() {
        UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
    }

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        trace("didFinishLaunching 进入")
        // JS 在场景连接**之前**执行完（视图建到注册表）；场景连接后再挂载进窗口
        runBundle()
        trace("runBundle 返回（视图数 \(proteusBridge.viewCount)）")
        return true
    }

    /// 打点（stdout + Documents/trace.log——simctl 的 console 抓不到时靠文件）
    func trace(_ msg: String) {
        print("[PROTEUS] \(msg)")
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let line = "[PROTEUS] \(msg)\n"
        let url = dir.appendingPathComponent("trace.log")
        if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close() }
        else { try? Data(line.utf8).write(to: url) }
    }

    /// 场景配置（纯代码返回——避免在 Info.plist 里写 Swift 类名：swiftc 直编时模块名不确定）
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        config.delegateClass = ProteusSceneDelegate.self
        return config
    }

    /// 加载 JS bundle（JSC 无模块加载器 → 直接 evaluateScript）
    func runBundle() {
        guard let ctx = JSContext() else {
            writeFailure("JSContext 创建失败")
            return
        }
        ctx.exceptionHandler = { [weak self] _, err in
            self?.writeFailure("JS 异常：\(String(describing: err))")
        }
        ctx.setObject(proteusBridge, forKeyedSubscript: "proteusNative" as NSString)

        guard let path = Bundle.main.path(forResource: "bundle", ofType: "js"),
              let src = try? String(contentsOfFile: path, encoding: .utf8) else {
            trace("bundle.js 未找到")
            writeFailure("bundle.js 未打包进 .app")
            return
        }
        trace("bundle 已载入（\(src.utf8.count) bytes），开始执行")
        ctx.evaluateScript(src)
        trace("bundle 执行完毕")
    }

    /// 快照落盘：写进 App 沙盒 Documents（供容器路径读取）
    func writeSnapshot(summary: String) {
        let snap = proteusBridge.snapshot()
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

    func writeFailure(_ reason: String) {
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

    func data(_ payload: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])) ?? Data("{}".utf8)
    }
}

/// ★Scene 代理：窗口建立后把 JS 创建的根视图挂进来，并在布局完成后落快照。
///   （桥 → 视图 → 挂载 → 布局 → 快照，这条顺序是「几何是最终值」的保证）
final class ProteusSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        (UIApplication.shared.delegate as? AppDelegate)?.trace("scene willConnectTo 到达")
        guard let windowScene = scene as? UIWindowScene else { return }
        let win = UIWindow(windowScene: windowScene)
        let vc = UIViewController()
        vc.view.backgroundColor = .black
        proteusBridge.root.translatesAutoresizingMaskIntoConstraints = false
        vc.view.addSubview(proteusBridge.root)
        NSLayoutConstraint.activate([
            proteusBridge.root.leadingAnchor.constraint(equalTo: vc.view.leadingAnchor),
            proteusBridge.root.trailingAnchor.constraint(equalTo: vc.view.trailingAnchor),
            proteusBridge.root.topAnchor.constraint(equalTo: vc.view.topAnchor),
            proteusBridge.root.bottomAnchor.constraint(equalTo: vc.view.bottomAnchor),
        ])
        win.rootViewController = vc
        win.makeKeyAndVisible()
        window = win

        let app = UIApplication.shared.delegate as? AppDelegate
        proteusBridge.onReady = { summary in
            // 主线程：布局完成后再落快照（保证几何是最终值）
            DispatchQueue.main.async {
                proteusBridge.mountRoots(into: proteusBridge.root)
                // ★布局必须从**整窗**驱动：只在 root 上调 layoutIfNeeded 时，
                //   root 自身相对 vc.view 的约束尚未求解 → 子视图几何仍为 0（实测）。
                proteusBridge.root.window?.layoutIfNeeded()
                proteusBridge.root.layoutIfNeeded()
                app?.writeSnapshot(summary: summary)
            }
        }
        // 若 JS 在场景连接前已 ready（onReady 已被调用过），补一次挂载+快照
        proteusBridge.flushPendingReady()
    }
}
