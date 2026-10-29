// hosts/ios/ProteusHost/runtime/document-preview-capability.swift
// ★★★#1384 App 能力 C84：`document.open` —— 文档预览（iOS 侧）。
//
// 【为什么需要】C84 的 MP（`wx.openDocument`）/ Web（`window.open`）两腿在 NC1 就有，
//   App 端一直缺宿主方法 ⇒ `useOpenDocument` 恒 `document.open.unsupported`。
//   iOS 本来就有 `QLPreviewController`（QuickLook 系统预览器）⇒ 属"有平台能力、没接线"。
//
// 【★为什么用 QLPreviewController 而不是 `UIApplication.open(fileURL)`】
//   ① `UIApplication.open` 传 `file://` 给**别的 App** 要求 `UIFileSharingEnabled` /
//      `LSSupportsOpeningDocumentsInPlace` 之类的 Info.plist 声明，且授权语义按 App 而异——
//      多数情况下对方读不到（与本仓 Android 侧 `FileUriExposedException` **同族问题**）；
//   ② `QLPreviewController` 是**本进程内**的系统预览器：文件始终在本 App 沙箱里被读，
//      不经过跨进程授权 ⇒ 没有"授权面"，也不需要任何 Info.plist 声明。
//   ⇒ 这也是"预览"这件事在 iOS 上的标准做法（`wx.openDocument` 的 iOS 实现同理）。
//
// 【★语义边界】`present` 只**拉起预览器**；返回 `{presented:true}` = 已交给系统，
//   不是"用户看完了"。`QLPreviewControllerDelegate` 有 `didDismiss` 回调，但**本方法不等它**
//   （方法签名 `Promise<void>` 是"受理"语义，与 Android/鸿蒙/Web/MP 对齐）——
//   若将来要"预览关闭后回调"，那是**另一个能力**（事件通道），不得在这里偷改语义。
//
// 【★★路径纪律（与 `fs.*` 同一条 deny-by-default）】
//   只接受 **Documents 下的相对路径**（拒绝对路径与 `..`）。★复用
//   `FileTransferCapability` 的同一套拒绝规则——但那里 `resolve` 是 private，
//   ⇒ 这里用**同一份规则**逐条重写（三行），并在判据里对比两边的拒绝用例**同结果**。
//   ★不把 `resolve` 改成 internal 的原因：那会让 `fs.*` 的沙箱实现面变大（任何本模块文件
//     都能拿到沙箱 URL），而"沙箱解析只有一个消费者"是当前的安全姿态。
//
// 【诚实边界】
//   · 单文件上限 64 MiB（与 `fs.readBytes` / Android / 鸿蒙**同值**）。
//   · 扩展名白名单与 JS 层同一集（pdf/doc/docx/xls/xlsx/ppt/pptx/txt）——不猜、不降级。
//   · 模拟器有 QuickLook，行为与真机一致（不像拨号盘那样"模拟器缺能力"）。
//   · ★必须在**主线程** present：能力通道的 `invoke` 是在 JS 线程同步调用的，
//     而 UIKit 的 present 只能在主线程 ⇒ 这里 `DispatchQueue.main.async` 派发。
//     ★但**校验必须同步做**（否则非法输入会变成"异步静默失败"，判据读不到错误码）。

import QuickLook
import UIKit

enum DocumentPreviewCapability {

    /// 单文件上限 64 MiB（与 `capability-app-document.ts` / Android / 鸿蒙 **同值**）
    static let maxBytes: Int64 = 64 * 1024 * 1024

    /// 扩展名 → MIME（白名单，与 JS 层 `DOC_OPEN_MIME` 同一集，改一处要改四处）
    static func mimeFor(_ ext: String) -> String? {
        switch ext {
        case "pdf":  return "application/pdf"
        case "doc":  return "application/msword"
        case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        case "xls":  return "application/vnd.ms-excel"
        case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        case "ppt":  return "application/vnd.ms-powerpoint"
        case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        case "txt":  return "text/plain"
        default:     return nil
        }
    }

    /// 小写扩展名（不含点）；没有则返回 ""。
    static func extensionOf(_ name: String) -> String {
        guard let dot = name.lastIndex(of: ".") else { return "" }
        if dot == name.startIndex { return "" }                       // ".bashrc" 这类
        let after = name.index(after: dot)
        if after == name.endIndex { return "" }                       // "a." 这类
        return String(name[after...]).lowercased()
    }

    /// 文件名（最后一个 `/` 之后）。
    static func baseName(_ path: String) -> String {
        guard let i = path.lastIndex(of: "/") else { return path }
        return String(path[path.index(after: i)...])
    }

    /// 沙箱根（Documents）——★与 `FileTransferCapability.root` **同一条**（同一个 API、同一个目录）。
    static var root: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    /// 取当前最上层 view controller（预览器必须挂在它上面）。
    /// ★该逻辑与 `share-capability.swift::topViewController` 同形；两份各自私有——
    ///   抽公共工具会让"哪一层在呈现"的语义跨能力耦合（分享与预览的呈现优先级不同）。
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

    /// `document.open`：`{ path, mimeType?, title? }` → `{ presented: true, mimeType }`
    static func open(_ args: [String: Any]) throws -> [String: Any] {
        let path = ((args["path"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if path.isEmpty {
            throw WsError.invalid("document.open 需要 { path }")
        }
        // ── 沙箱校验（与 FileTransferCapability.resolve 同一套规则，见文件头「路径纪律」）──
        guard !path.hasPrefix("/") else {
            throw WsError.invalid("document.open: 只接受沙箱相对路径（收到绝对路径）")
        }
        for seg in path.split(separator: "/") where seg == ".." {
            throw WsError.invalid("document.open: 路径不得含 \"..\"（拒绝目录穿越）")
        }

        let name = baseName(path)
        guard !name.isEmpty else {
            throw WsError.invalid("document.open: 路径缺少文件名")
        }
        let ext = extensionOf(name)
        guard let mime = mimeFor(ext) else {
            throw WsError.invalid("document.open: 不支持 .\(ext)（支持：pdf/doc/docx/xls/xlsx/ppt/pptx/txt）")
        }

        let url = root.appendingPathComponent(path)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else {
            // ★不回显绝对路径（只回业务给的相对路径）
            throw WsError.invalid("document.open: 沙箱内没有该文件（\(path)）")
        }
        guard !isDir.boolValue else {
            throw WsError.invalid("document.open: 目标是目录不是文件（\(path)）")
        }
        // ★`attributesOfItem` 返回 `[FileAttributeKey: Any]`，`.size` 是 `Any` ⇒ 必须显式下探成 Int64
        //   （写成 `try? …[.size] as? Int64` 会得到 `Int64??`，比较时永远走 `?? 0` 分支 —— 实测踩过）
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let size: Int64 = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
        guard size <= maxBytes else {
            throw WsError.invalid("document.open: 文件过大（\(size)B > \(maxBytes)B）")
        }

        guard let host = topViewController() else {
            throw WsError.unsupported("document.open")   // 无可用窗口（扩展/后台）
        }

        // ★★★必须在主线程 present（能力通道的 invoke 在 JS 线程同步调用）。
        //   校验已在上方同步完成 ⇒ 走到这里必然合法，异步部分只负责"呈现"。
        let title = baseName(path)
        DispatchQueue.main.async {
            let ql = QLPreviewController()
            let item = PreviewItem(url: url, title: title)
            ql.dataSource = SingleItemDataSource(item: item)
            // ★dataSource 是 weak 引用 ⇒ 必须有人强持有，否则呈现瞬间被回收（黑屏/崩溃）。
            //   挂在 previewHosts 里，`didDismiss` 时移除（见 PreviewHost.dismiss）。
            PreviewHost.shared.present(ql, from: host)
        }

        return ["presented": true, "mimeType": mime]
    }
}

/// 单个预览项（`QLPreviewItem` 要求 `url` 非 nil）。
final class PreviewItem: NSObject, QLPreviewItem {
    let previewItemURL: URL?
    let previewItemTitle: String?
    init(url: URL, title: String) {
        self.previewItemURL = url
        self.previewItemTitle = title
    }
}

/// 单元素 dataSource（本能力一次只预览一个文件）。
final class SingleItemDataSource: NSObject, QLPreviewControllerDataSource {
    private let item: PreviewItem
    init(item: PreviewItem) { self.item = item }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { item }
}

/// 预览器宿主：强持有 dataSource + 自己（两者都是 weak 引用），`didDismiss` 时释放。
///
/// 【为什么必须单独一个类（不是"多写一层"）】
///   `QLPreviewController.dataSource` 是 **weak**，`UIViewController.presentedViewController`
///   在 dismiss 后清空 ⇒ 若只把 dataSource 写在局部变量里，呈现的瞬间就被回收，
///   表现是**空白预览器**（没有崩溃、没有日志，极难归因）。
final class PreviewHost: NSObject, QLPreviewControllerDelegate {
    static let shared = PreviewHost()
    /// 在飞的预览器（presentedVC + 它的 dataSource）。dismiss 后清理。
    private var live: [(QLPreviewController, QLPreviewControllerDataSource)] = []

    func present(_ vc: QLPreviewController, from host: UIViewController) {
        vc.delegate = self
        guard let ds = vc.dataSource else { return }
        live.append((vc, ds))
        host.present(vc, animated: true, completion: nil)
    }

    func previewControllerDidDismiss(_ controller: QLPreviewController) {
        live.removeAll { $0.0 === controller }
    }
}
