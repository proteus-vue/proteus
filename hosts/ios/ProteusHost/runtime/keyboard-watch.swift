// hosts/ios/ProteusHost/runtime/keyboard-watch.swift
// ★★★C14 键盘监听（iOS 唯一实现）—— 2026-10-19 · 决策 #1069
//
// 【它解决什么】三端此前都只装了 JS 侧接收通道（`capability-app-device.ts` 里的
//   `__proteusHostKeyboard`），**没有一端真的推** ⇒ `useKeyboard()` 的高度恒为 0，
//   而官网因"桥方法存在"把它判成了 ✅（对外谎报可用）。
//   本文件是 iOS 腿的**推送源**：系统键盘通知 → 共享读数 + JS 推送 + 触发重渲。
//
// 【为什么单列一个类（不放在 superapp-scene.swift）】
//   ① `selfdraw-scene.swift` 是 8800+ 行的存量棘轮文件（只减不增）——读数必须由它读；
//      把状态放在本类，巨型文件侧只留**一行转发**（`KeyboardWatch.heightPt`）。
//   ② env 表（`envVarTable`）与键盘通知必须读**同一份**读数，否则 CSS 让位与 JS 读数分叉
//      （本仓已有多起"同一事实两个来源"的事故）。
//
// 【取值口径】`UIKeyboardFrameEndUserInfoKey` 是**屏幕坐标**下的键盘矩形；减去底部安全区
//   （Home Indicator）才是"页面要额外让位的高度"——与 Web `visualViewport` 的缩少量同义。
//   ★不做这个减法 ⇒ 全面屏上高度被高估约 34pt（页面多让一截，底部露白）。
// 【单位】pt（与其余 `--pf-*` 同单位；与 CSS px 同义）。
// 【诚实边界】监听装在场景层（持有 JSContext 与容器视图）；无容器的场景（纯探针）不装 ⇒
//   高度恒 0（如实，不推假值）。

import Foundation
import UIKit

enum KeyboardWatch {
    /// 最近一次键盘让位高度（pt；0 = 收起）。`envVarTable` 与 JS 推送共用这一份。
    private(set) static var heightPt: Double = 0

    /// 是否已装（幂等——场景可能被多次进入）
    private static var installed = false

    /// JS 求值出口（场景注入：`ctx.evaluateScript`）。仅用于推送键盘状态。
    static var evalJs: ((String) -> String)?

    /// 触发重渲的出口（场景注入：env 变了必须重跑一次渲染，否则 token 停在旧值）。
    static var requestRender: (() -> Void)?

    /// 底部安全区来源（场景注入：容器视图）。缺省 0 ⇒ 不减（纯探针场景）。
    static var safeBottom: (() -> Double)?

    /**
     * 装系统键盘通知（幂等）。
     * @param eval 场景的 JS 求值函数（`__proteusHostKeyboard` 推送用）
     * @param render 重渲出口（`--pf-keyboard-height` 生效用）
     * @param safeBottom 底部安全区读数（键盘高度扣减用）
     */
    static func install(
        eval: @escaping (String) -> String,
        render: @escaping () -> Void,
        safeBottom: @escaping () -> Double,
    ) {
        evalJs = eval
        requestRender = render
        self.safeBottom = safeBottom
        guard !installed else { return }
        installed = true
        let nc = NotificationCenter.default
        let onFrame: (Notification) -> Void = { note in
            guard let f = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue else { return }
            let kb = f.cgRectValue
            // ★屏幕坐标 → 页面让位高度；减去底部安全区（该区域键盘本就覆盖）
            push(max(0, kb.height - (Self.safeBottom?() ?? 0)))
        }
        let onHide: (Notification) -> Void = { _ in push(0) }
        nc.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main, using: onFrame)
        nc.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main, using: onFrame)
        nc.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main, using: onHide)
        NSLog("[proteus] keyboard-watch installed（UIKeyboard 通知 → __proteusHostKeyboard）")
    }

    /// 推一次键盘状态：写共享读数 + eval JS + 重渲（`--pf-keyboard-height` 生效）。
    /// 【为什么"只在变化时"动作】`keyboardWillChangeFrame` 在动画期间会成串触发；
    ///   每次都重渲会与键盘动画抢帧（且把日志刷爆）。
    private static func push(_ h: Double) {
        if abs(h - heightPt) < 0.5 { return }
        heightPt = h
        let visible = h > 0
        let ack = evalJs?(
            "typeof __proteusHostKeyboard === 'function' ? __proteusHostKeyboard({height:\(h),visible:\(visible)}) : 'no-hook'",
        ) ?? "no-eval"
        NSLog("[proteus] keyboard-push pt=%.1f ack=%@", h, ack)
        requestRender?()
    }
}
