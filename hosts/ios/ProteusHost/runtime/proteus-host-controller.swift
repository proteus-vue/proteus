// hosts/ios/ProteusHost/runtime/proteus-host-controller.swift
// ★★★hosts 第三刀（2026-10-07）：iOS **运行时驱动**（项目无关）——可依赖单元的"门面"。
//
// 【它解决什么】最小宿主只需：
//     let c = ProteusHostController(frame: view.bounds)
//     view.addSubview(c.contentView)
//     c.mountPage("index", fromScreenContent: <url>, viewport: view.bounds.size)
//   即可把**项目编译产物**（screen-content.json）真上屏 —— 壳里**零项目身份 / 零引擎细节**。
//
// 【为什么是"源集单元"而非独立 SwiftPM 模块】本仓 iOS 宿主是 **swiftc 直出**（无 Xcode 工程 / 无 SPM）；
//   且 runtime 与壳共用大量 `internal` 符号（引擎 API 未 public 化）⇒ 做成**独立模块**会逼 ~千行 public 化。
//   故采与鸿蒙 HAR 同形的**源集单元**：runtime 源文件 + 内核 `.a` 被**消费方编译进同一模块**（零可见性改动）。
//   ★诚实边界：这是**具名降级**（非 SwiftPM 包）——见 hosts/README-LAYERS.md §4。
import Foundation
import UIKit
import JavaScriptCore

/// Proteus iOS 运行时驱动（项目无关）：建自绘视图 + 起 JSContext + 注入桥 + 接手势 + 挂载屏内容。
final class ProteusHostController: NSObject {
    let bridge = SelfDrawBridge()
    let contentView: SelfDrawView
    private(set) var jsContext: JSContext?

    init(frame: CGRect) {
        contentView = SelfDrawView(frame: frame)
        super.init()
        contentView.backgroundColor = .black
        bridge.view = contentView
        // 触摸 → 命中 → JS 派发（与参考宿主壳同一条链；JS 不在滚动/命中链路上）
        contentView.onGesture = { [weak self] x, y, type in
            self?.bridge.emitGesture(x: x, y: y, type: type)
        }
        contentView.onScrollDrag = { [weak self] dx, dy in
            self?.bridge.scrollDragBy(dx: Double(dx), dy: Double(dy)) ?? "{\"ok\":false,\"error\":\"bridge 已释放\"}"
        }
        guard let ctx = JSContext() else { return }
        jsContext = ctx
        ctx.setObject(bridge, forKeyedSubscript: "proteusSelfDraw" as NSString)
        // 宿主桥（proteusHost：memUsage/gc/post/invoke）——runtime 聚合器
        let hostBridge = HostRuntimeBridge()
        hostBridge.jsContextRef = ctx.jsGlobalContextRef
        ctx.setObject(hostBridge, forKeyedSubscript: "proteusHost" as NSString)
        // 手势派发：注册名优先（共享 bundle 契约），否则回落 __proteus_dispatch
        bridge.onDispatchToJS = { [weak self, weak ctx] target, chain, type, x, y in
            guard let self, let ctx else { return }
            if let name = self.bridge.gestureCallbackName, !name.isEmpty {
                let chainJson = "[" + chain.map(String.init).joined(separator: ",") + "]"
                if let fn = ctx.objectForKeyedSubscript(name) {
                    _ = fn.call(withArguments: [type, target, chainJson])
                    return
                }
            }
            guard let fn = ctx.objectForKeyedSubscript("__proteus_dispatch") else { return }
            _ = fn.call(withArguments: [target, chain, type, x, y])
        }
        ctx.exceptionHandler = { _, exc in
            NSLog("[proteus] JS 异常: %@", exc?.toString() ?? "?")
        }
    }

    /// 挂载一个屏内容对象（`{viewport:{width,height}, nodes:[...]}`）→ 内核布局 + 自绘上屏
    @discardableResult
    func mount(_ treeJson: String) -> String {
        bridge.mount(treeJson)
    }

    /// 从**屏内容产物**（项目编译产物 JSON；由壳定位其路径传入——runtime 不认具体文件名）取指定页并挂载
    @discardableResult
    func mountPage(_ page: String, fromScreenContent url: URL, viewport: CGSize) -> String {
        guard let data = try? Data(contentsOf: url),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return "{\"ok\":false,\"error\":\"读 screen-content 失败\"}"
        }
        // 结构：`{ <页名>: { viewport, nodes }, ... }`；缺页时回落顶层 nodes
        let entry = root[page] as? [String: Any]
        let nodes: Any = entry?["nodes"] ?? root["nodes"] ?? []
        let tree: [String: Any] = [
            "viewport": ["width": Double(viewport.width), "height": Double(viewport.height)],
            "nodes": nodes,
        ]
        guard let d = try? JSONSerialization.data(withJSONObject: tree),
              let s = String(data: d, encoding: .utf8) else {
            return "{\"ok\":false,\"error\":\"序列化失败\"}"
        }
        return bridge.mount(s)
    }

}
