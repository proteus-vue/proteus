// ProteusDevOverlay.swift —— dev 变体的**开发可视化层**（决策 #692/#693 · 对齐 Android DevOverlay/#671）
//   ① 右上角持久 "DEV" 角标（固定悬浮在 window 上、不随内容重绘/滚动移动）
//   ② 热重载瞬时提示（约 1.5s 后淡出）
//
// 【为什么在壳（模板）】这是**开发期给"人"看的 chrome**（非渲染/非内核）——与 tab 栏同类，属项目壳关注点；
//   release 变体**完全不创建**（`ProteusBuildConfig.DEV=false` ⇒ attach 直接返回）⇒ 正式包零残留。
//
// 【诚实边界】仅 iOS + dev 变体；已生成的老宿主经 `syncShellTemplates`（决策 #692）自动补入/刷新本文件。
import UIKit

/// 带内边距的标签（UILabel 原生不支持 padding ⇒ 子类化，重写 `drawText` + `intrinsicContentSize`）。
///   ★决策 #693：DEV 角标/热重载提示首版直接给 UILabel 设 `text` ⇒ **文字贴胶囊边缘、无间距**（用户实测）
///   ⇒ 用本类补足内容内边距（对齐 Android `TextView.setPadding`）。
final class ProteusPaddedLabel: UILabel {
    var insets: UIEdgeInsets = .zero
    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.inset(by: insets))
    }
    override var intrinsicContentSize: CGSize {
        let s = super.intrinsicContentSize
        return CGSize(width: s.width + insets.left + insets.right, height: s.height + insets.top + insets.bottom)
    }
    override func sizeThatFits(_ size: CGSize) -> CGSize {
        let s = super.sizeThatFits(size)
        return CGSize(width: s.width + insets.left + insets.right, height: s.height + insets.top + insets.bottom)
    }
}

/// dev 可视化层：右上角 DEV 角标 + 居中瞬时提示（热重载）。release（DEV=false）不创建。
final class ProteusDevOverlay {
    private weak var host: UIView?
    private var badge: ProteusPaddedLabel?
    private var toast: ProteusPaddedLabel?

    init(host: UIView) {
        self.host = host
    }

    /// 仅 dev 变体创建（release 直接返回 ⇒ 零残留）。
    func attach() {
        guard ProteusBuildConfig.DEV, let host = host else { return }
        let dens = UIScreen.main.scale

        // ① 右上角 DEV 角标（内容内边距 = 9 × 4，胶囊圆角，对齐 Android pad=6）
        let badge = ProteusPaddedLabel()
        badge.text = "DEV"
        badge.textColor = .white
        badge.font = .systemFont(ofSize: 11, weight: .bold)
        badge.textAlignment = .center
        badge.insets = UIEdgeInsets(top: 3, left: 9, bottom: 3, right: 9)
        badge.backgroundColor = UIColor(red: 0x2F/255, green: 0x6B/255, blue: 0xFF/255, alpha: 0.8)
        badge.layer.cornerRadius = 11
        badge.layer.masksToBounds = true
        badge.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(badge)

        // ② 热重载瞬时提示（初始隐藏；内容内边距 9×6，深色胶囊，居中在角标下方）
        let toast = ProteusPaddedLabel()
        toast.textColor = .white
        toast.font = .systemFont(ofSize: 13)
        toast.textAlignment = .center
        toast.numberOfLines = 0
        toast.insets = UIEdgeInsets(top: 6, left: 12, bottom: 6, right: 12)
        toast.backgroundColor = UIColor(red: 0x1F/255, green: 0x24/255, blue: 0x30/255, alpha: 0.9)
        toast.layer.cornerRadius = 14
        toast.layer.masksToBounds = true
        toast.alpha = 0
        toast.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(toast)

        let safe = host.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            badge.topAnchor.constraint(equalTo: safe.topAnchor, constant: 6),
            badge.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -10),
            toast.topAnchor.constraint(equalTo: badge.bottomAnchor, constant: 10),
            toast.centerXAnchor.constraint(equalTo: host.centerXAnchor),
            toast.leadingAnchor.constraint(greaterThanOrEqualTo: host.leadingAnchor, constant: 12),
            toast.trailingAnchor.constraint(lessThanOrEqualTo: host.trailingAnchor, constant: -12),
        ])
        self.badge = badge
        self.toast = toast
        _ = dens
    }

    /// 显示一条瞬时提示（约 1.5s 后自动淡出）；非 dev（未 attach）时为空操作。
    ///   ★文字本身不再靠空格撑边距——由 `ProteusPaddedLabel.insets` 提供（用户实测"没间距"的修法）。
    func flash(_ msg: String) {
        guard let toast = toast else { return }
        toast.text = msg
        toast.layer.removeAllAnimations()
        toast.alpha = 1
        host?.bringSubviewToFront(toast)
        if let b = badge { host?.bringSubviewToFront(b) }   // 角标始终在提示之上
        UIView.animate(withDuration: 0.25, delay: 1.5, options: [], animations: { toast.alpha = 0 }, completion: nil)
    }
}
