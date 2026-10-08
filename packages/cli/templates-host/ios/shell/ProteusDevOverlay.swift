// ProteusDevOverlay.swift —— dev 变体的**开发可视化层**（决策 #692 · 对齐 Android DevOverlay/#671）
//   ① 右上角持久 "DEV" 角标（对齐 Flutter 的 DEBUG 缎带）② 热重载瞬时提示（约 1.5s 后淡出）。
//
// 【为什么在壳（模板）】这是**开发期给"人"看的 chrome**（非渲染/非内核）——与 tab 栏同类，属项目壳关注点；
//   release 变体**完全不创建**（`ProteusBuildConfig.DEV=false` ⇒ attach 直接返回）⇒ 正式包零残留。
//
// 【诚实边界】仅 iOS + dev 变体；已生成的老宿主需重生成（`rm -rf dist/app/ios/host` 后 `proteus dev`）。
import UIKit

/// dev 可视化层：右上角 DEV 角标 + 居中瞬时提示（热重载）。release（DEV=false）不创建。
final class ProteusDevOverlay {
    private weak var host: UIView?
    private var badge: UILabel?
    private var toast: UILabel?

    init(host: UIView) {
        self.host = host
    }

    /// 仅 dev 变体创建（release 直接返回 ⇒ 零残留）。
    func attach() {
        guard ProteusBuildConfig.DEV, let host = host else { return }
        // ① 右上角 DEV 角标
        let badge = UILabel()
        badge.text = "DEV"
        badge.textColor = .white
        badge.font = .systemFont(ofSize: 11, weight: .bold)
        badge.textAlignment = .center
        badge.backgroundColor = UIColor(red: 0x2F/255, green: 0x6B/255, blue: 0xFF/255, alpha: 0.8)
        badge.layer.cornerRadius = 9
        badge.layer.masksToBounds = true
        badge.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(badge)
        // ② 热重载瞬时提示（初始隐藏）
        let toast = UILabel()
        toast.textColor = .white
        toast.font = .systemFont(ofSize: 13)
        toast.textAlignment = .center
        toast.numberOfLines = 0
        toast.backgroundColor = UIColor(red: 0x1F/255, green: 0x24/255, blue: 0x30/255, alpha: 0.9)
        toast.layer.cornerRadius = 12
        toast.layer.masksToBounds = true
        toast.alpha = 0
        toast.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(toast)
        // 约束：角标贴右上（安全区内），提示居中在角标下方
        let safe = host.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            badge.topAnchor.constraint(equalTo: safe.topAnchor, constant: 6),
            badge.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -10),
            badge.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
            badge.heightAnchor.constraint(equalToConstant: 18),
            toast.topAnchor.constraint(equalTo: badge.bottomAnchor, constant: 10),
            toast.centerXAnchor.constraint(equalTo: host.centerXAnchor),
            toast.widthAnchor.constraint(lessThanOrEqualTo: host.widthAnchor, multiplier: 0.9),
        ])
        self.badge = badge
        self.toast = toast
    }

    /// 显示一条瞬时提示（约 1.5s 后自动淡出）；非 dev（未 attach）时为空操作。
    func flash(_ msg: String) {
        guard let toast = toast else { return }
        toast.text = "  " + msg + "  "
        toast.layer.removeAllAnimations()
        toast.alpha = 1
        host?.bringSubviewToFront(toast)
        if let b = badge { host?.bringSubviewToFront(b) }   // 角标始终在提示之上
        UIView.animate(withDuration: 0.25, delay: 1.5, options: [], animations: { toast.alpha = 0 }, completion: nil)
    }
}
