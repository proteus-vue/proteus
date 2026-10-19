// hosts/ios/ProteusHost/runtime/capture-capability.swift
// ★★★决策 #1083（`useScreenCapture` · C71）：录屏/截屏状态（iOS 腿）。
//
// 【iOS 的诚实边界（**先取证再实现**，iOS 26.5 SDK 实测）】
//   · `UIScreen.isCaptured` —— **有**（录屏 / AirPlay / 镜像都会置位）。SDK 标注已 deprecated
//     （建议改用 `UITraitCollection.sceneCaptureState`），但仍可用 ⇒ 本端实现 `recording` 字段。
//   · `UIApplication.userDidTakeScreenshotNotification` —— **有** ⇒ 用户截屏事件。
//   · **全局画中画查询：没有**。`AVPictureInPictureController` 只能查**自己**创建的控制器状态；
//     iOS 也不允许查询别的应用的窗口/PiP 状态。⇒ `pip` 字段**不写**（桥给 unsupported，不伪造 false）。
//
// 【为什么单列一个文件】`host-capabilities.swift` 是能力分发层；本类是独立的平台状态观察者
//   （通知注册 + 状态读取），职责不同。

import Foundation
import UIKit

final class CaptureCapability {
    /// 壳推出口（`{ recording: Bool }` / `{ userCapture: true }` → `__proteusHostCapture`）
    var push: (([String: Any]) -> Void)?

    /// 录屏状态变化的 KVO 观察者（`UIScreen.isCaptured`）
    private var captureObservation: NSKeyValueObservation?
    /// `isCaptured` 在 iOS 11+ 可用；低版本没有 ⇒ 不写 `recording` 字段
    private var recordingSupported: Bool { if #available(iOS 11.0, *) { return true } else { return false } }

    /// 一次取全部状态。
    /// ★**只写本端真能查的字段**——缺字段 = 该能力在本端不可用（桥给 unsupported，不是 false）。
    func state() -> [String: Any] {
        var o: [String: Any] = [:]
        if #available(iOS 11.0, *) {
            o["recording"] = UIScreen.main.isCaptured
        }
        // pip：**不写**（iOS 无全局 PiP 查询——只能查自己创建的 AVPictureInPictureController）
        o["recordingSupported"] = recordingSupported
        o["pipSupported"] = false
        o["userCaptureSupported"] = true
        return o
    }

    /// 装系统通知（用户截屏）+ KVO（录屏状态变化）。幂等。
    func install() {
        // ① 用户截屏
        NotificationCenter.default.addObserver(
            self, selector: #selector(onScreenshot),
            name: UIApplication.userDidTakeScreenshotNotification, object: nil,
        )
        // ② 录屏状态变化：`UIScreen.isCaptured` 支持 KVO
        if #available(iOS 11.0, *) {
            captureObservation = UIScreen.main.observe(\.isCaptured, options: [.new]) { [weak self] _, change in
                guard let v = change.newValue else { return }
                self?.push?(["recording": v])
            }
        }
    }

    /// 卸载（幂等）。
    func uninstall() {
        NotificationCenter.default.removeObserver(self, name: UIApplication.userDidTakeScreenshotNotification, object: nil)
        captureObservation?.invalidate()
        captureObservation = nil
    }

    @objc private func onScreenshot() {
        push?(["userCapture": true])
    }
}
