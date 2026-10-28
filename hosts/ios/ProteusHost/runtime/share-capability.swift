// hosts/ios/ProteusHost/runtime/share-capability.swift
// ★★★#1336 App 能力 C22：`share` —— 系统分享面板（iOS 侧）。
//
// 【为什么需要】`useShare` 要的 `bridge.share(options)` 在 App 端一直没有宿主方法
//   ⇒ Hook 层直接抛 TypeError（连 unsupported 都读不到）。iOS 本来就有
//   `UIActivityViewController` ⇒ 属"有平台能力、没接线"。
//
// 【★语义边界】
//   `UIActivityViewController` **只拉起系统分享面板并预填内容**；
//   返回 `{presented:true}` = **面板已交给系统**，不是"已分享到某处"——选哪个目标由用户决定。
//   ★对齐 **Web Share API**（`navigator.share({title,text,url})`），**不是**分享到某个具体 IM。
//
// 【★★输入校验（安全基线：分享会把内容交给**别的 App / 扩展**）】
//   ① 至少一项内容（title/text/url 全空 ⇒ 报错，不拉起空面板）；
//   ② 长度上限：文本 8 KiB / 标题 256 / URL 2 KiB，与 JS 层同值；
//   ③ **URL scheme 只允许 http/https**：`file:` / `javascript:` / 自定义 scheme 一旦流出，
//      等于把本机私有路径或可执行语义递给任意接收方。非法**报错不清洗**。
//   ★JS 层已校验一遍，这里是第二道（业务可直接调 `__proteusHostInvoke` 绕过 JS）。
//
// 【诚实边界】
//   · **iPad 必须给 popover 锚点**：`UIActivityViewController` 在 iPad 上以 popover 呈现，
//     不设 `sourceView`/`sourceRect` 会**运行时崩溃**（`NSGenericException`）——
//     这是一个只在 iPad 上出现、模拟器/iPhone 都测不到的真坑，所以这里主动兜住。
//   · 面板是异步呈现的：本方法在 `present` 调用后即返回（受理语义），不等用户选择。
//   · 用户取消/完成都不会回推（没有回调通道）⇒ 宿主不谎称"分享成功"。

import UIKit

enum ShareCapability {

    /// 与 JS 层同值（`capability-app-share.ts`）——改一处要改四处
    static let maxText = 8192
    static let maxTitle = 256
    static let maxUrl = 2048

    /// URL 白名单：只允许 http/https（见文件头 ③）。空串视为"没有 url"。
    static func isAllowedUrl(_ u: String) -> Bool {
        if u.isEmpty { return true }
        if u.count > maxUrl { return false }
        guard let parsed = URL(string: u), let scheme = parsed.scheme else { return false }
        let s = scheme.lowercased()
        return s == "http" || s == "https"
    }

    /// 取当前最上层的 view controller（分享面板必须挂在它上面）。
    private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        guard var top = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
            return nil
        }
        while let presented = top.presentedViewController {
            top = presented
        }
        return top
    }

    /// `share`：`{ title?, text?, url? }` → `{ presented: true }`
    static func share(_ args: [String: Any]) throws -> [String: Any] {
        // ★#1336 真机剖出：宿主层此前不 trim 标题，而 JS 层会 trim ⇒ 直调宿主传 `"   "`
        //   被判"有内容"而受理（拉起空面板）。口径与 JS 一致：标题 trim，正文不 trim。
        let title = ((args["title"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let text = (args["text"] as? String) ?? ""
        let url = (args["url"] as? String) ?? ""

        if title.count > maxTitle {
            throw WsError.invalid("share: title 过长（\(title.count) > \(maxTitle)）")
        }
        if text.count > maxText {
            throw WsError.invalid("share: text 过长（\(text.count) > \(maxText)）")
        }
        guard isAllowedUrl(url) else {
            // ★不回显原始 URL（可能带 token，且会进日志）
            throw WsError.invalid("share: url 非法（只允许 http/https 且 ≤ \(maxUrl) 字符）")
        }
        if title.isEmpty && text.isEmpty && url.isEmpty {
            throw WsError.invalid("share: 内容为空（title/text/url 至少给一项）")
        }

        // ★items 用原生类型：`UIActivityViewController` 只认 String/URL/UIImage 等，
        //   把 url 当 String 传会被某些扩展忽略 ⇒ 显式转 URL。
        var items: [Any] = []
        if !text.isEmpty { items.append(text) }
        if !url.isEmpty, let u = URL(string: url) { items.append(u) }
        if items.isEmpty, !title.isEmpty { items.append(title) }

        guard let host = topViewController() else {
            throw WsError.unsupported("share") // 无可用窗口（扩展/后台）⇒ 如实 unsupported
        }

        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if !title.isEmpty { vc.setValue(title, forKey: "subject") }

        // ★★★iPad popover 锚点（见文件头「诚实边界」第一条）：
        //   不设会在 iPad 上运行时崩 `NSGenericException`（"UIPopoverPresentationController
        //   should have a non-nil sourceView or barButtonItem"）。用宿主视图中心兜底。
        if let pop = vc.popoverPresentationController {
            pop.sourceView = host.view
            let b = host.view.bounds
            pop.sourceRect = CGRect(x: b.midX, y: b.midY, width: 0, height: 0)
            pop.permittedArrowDirections = []
        }

        host.present(vc, animated: true, completion: nil)

        return ["presented": true]
    }
}
