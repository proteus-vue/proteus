// ProteusDevOverlay.swift —— dev 变体的**开发可视化层**（决策 #692/#693/#704 · 对齐 Android DevOverlay/#671）
//   ① 右上角持久 "DEV" 角标（可**点击**展开底部调试面板）
//   ② 热重载瞬时提示（约 1.5s 后淡出）
//   ③ ★决策 #704：底部调试面板——「渲染状态」提示（有就地编辑时标**非项目代码效果**）+ **重置为项目代码**
//
// 【为什么在壳（模板）】这是**开发期给"人"看的 chrome**（非渲染/非内核）——与 tab 栏同类，属项目壳关注点；
//   release 变体**完全不创建**（`ProteusBuildConfig.DEV=false` ⇒ attach 直接返回）⇒ 正式包零残留。
//
// 【诚实边界】仅 iOS + dev 变体；已生成的老宿主经 `syncShellTemplates`（决策 #692）自动补入/刷新本文件。
import UIKit

/// 带内边距的标签（UILabel 原生不支持 padding ⇒ 子类化，重写 `drawText` + `intrinsicContentSize`）。
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

/// dev 可视化层：右上角 DEV 角标（可点）+ 瞬时提示 + 底部调试面板。release（DEV=false）不创建。
final class ProteusDevOverlay {
    private weak var host: UIView?
    private var badge: ProteusPaddedLabel?
    private var toast: ProteusPaddedLabel?
    /// ★底部调试面板（决策 #704）：tap DEV 角标展开/收起。
    private var sheet: UIView?
    private var statusLabel: UILabel?
    private var sheetOn = false
    /// 是否有**就地编辑**未还原（决定"渲染状态"提示与角标配色）。
    private var edited = false

    /// 重置回调（壳注入）：恢复"项目代码的实时效果"。
    var onReset: (() -> Void)?
    /// 面板 URL（壳注入，展示用）。
    var panelUrl: String = ""

    init(host: UIView) { self.host = host }

    /// 仅 dev 变体创建（release 直接返回 ⇒ 零残留）。
    func attach() {
        guard ProteusBuildConfig.DEV, let host = host else { return }

        // ① 右上角 DEV 角标（内容内边距 = 9 × 4，胶囊圆角；可点）
        let badge = ProteusPaddedLabel()
        badge.text = "DEV"
        badge.textColor = .white
        badge.font = .systemFont(ofSize: 11, weight: .bold)
        badge.textAlignment = .center
        badge.insets = UIEdgeInsets(top: 3, left: 9, bottom: 3, right: 9)
        badge.backgroundColor = UIColor(red: 0x2F/255, green: 0x6B/255, blue: 0xFF/255, alpha: 0.8)
        badge.layer.cornerRadius = 11
        badge.layer.masksToBounds = true
        badge.isUserInteractionEnabled = true
        badge.translatesAutoresizingMaskIntoConstraints = false
        badge.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(toggleSheet)))
        host.addSubview(badge)

        // ② 热重载瞬时提示
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
    }

    /// 显示一条瞬时提示（约 1.5s 后自动淡出）；非 dev（未 attach）时为空操作。
    func flash(_ msg: String) {
        guard let toast = toast, let host = host else { return }
        toast.text = msg
        toast.layer.removeAllAnimations()
        toast.alpha = 1
        host.bringSubviewToFront(toast)
        if let b = badge { host.bringSubviewToFront(b) }
        if let s = sheet, sheetOn { host.bringSubviewToFront(s) }
        UIView.animate(withDuration: 0.25, delay: 1.5, options: [], animations: { toast.alpha = 0 }, completion: nil)
    }

    /// ★标注"是否有就地编辑"（决策 #704）——有 ⇒ 角标转琥珀色 + 面板显示"非项目代码效果"。
    func setEdited(_ edited: Bool) {
        self.edited = edited
        guard let badge = badge else { return }
        badge.text = edited ? "DEV ✎" : "DEV"
        badge.backgroundColor = edited
            ? UIColor(red: 0xE0/255, green: 0x8A/255, blue: 0x00/255, alpha: 0.9)   // 琥珀（有未还原的编辑）
            : UIColor(red: 0x2F/255, green: 0x6B/255, blue: 0xFF/255, alpha: 0.8)   // 品牌蓝
        if sheetOn { refreshStatus() }
    }

    private func refreshStatus() {
        statusLabel?.text = edited
            ? "⚠ 渲染状态：含就地编辑 — 非项目代码效果"
            : "渲染状态：项目代码（实时）"
        statusLabel?.textColor = edited ? UIColor(red: 0xFF/255, green: 0xC2/255, blue: 0x4D/255, alpha: 1) : .white
    }

    @objc private func toggleSheet() {
        sheetOn ? hideSheet() : showSheet()
    }

    private func showSheet() {
        guard let host = host else { return }
        if sheet == nil { buildSheet(in: host) }
        guard let s = sheet else { return }
        sheetOn = true
        refreshStatus()
        host.bringSubviewToFront(s)
        s.isHidden = false
        s.transform = CGAffineTransform(translationX: 0, y: s.bounds.height)
        UIView.animate(withDuration: 0.22) { s.transform = .identity }
        if let b = badge { host.bringSubviewToFront(b) }
    }

    private func hideSheet() {
        guard let s = sheet, let host = host else { return }
        sheetOn = false
        UIView.animate(withDuration: 0.2, animations: { s.transform = CGAffineTransform(translationX: 0, y: s.bounds.height) },
                       completion: { _ in s.isHidden = true })
        if let b = badge { host.bringSubviewToFront(b) }
        _ = host
    }

    /// 底部调试面板：状态行 + 「重置为项目代码」+ 面板 URL 提示。
    private func buildSheet(in host: UIView) {
        let s = UIView()
        s.backgroundColor = UIColor(red: 0x15/255, green: 0x18/255, blue: 0x20/255, alpha: 0.98)
        s.layer.cornerRadius = 16
        s.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        s.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(s)

        let grab = UIView()
        grab.backgroundColor = UIColor(white: 1, alpha: 0.2)
        grab.layer.cornerRadius = 2
        grab.translatesAutoresizingMaskIntoConstraints = false
        s.addSubview(grab)

        let title = UILabel()
        title.text = "DevTools"
        title.textColor = .white
        title.font = .systemFont(ofSize: 14, weight: .bold)
        title.translatesAutoresizingMaskIntoConstraints = false
        s.addSubview(title)

        let status = UILabel()
        status.font = .systemFont(ofSize: 12)
        status.numberOfLines = 0
        status.translatesAutoresizingMaskIntoConstraints = false
        s.addSubview(status)
        statusLabel = status

        let reset = UIButton(type: .system)
        reset.setTitle("重置为项目代码", for: .normal)
        reset.setTitleColor(.white, for: .normal)
        reset.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
        reset.backgroundColor = UIColor(red: 0x2F/255, green: 0x6B/255, blue: 0xFF/255, alpha: 1)
        reset.layer.cornerRadius = 10
        reset.translatesAutoresizingMaskIntoConstraints = false
        reset.addTarget(self, action: #selector(didTapReset), for: .touchUpInside)
        s.addSubview(reset)

        let url = UILabel()
        url.font = .systemFont(ofSize: 11)
        url.textColor = UIColor(white: 1, alpha: 0.5)
        url.numberOfLines = 0
        url.text = panelUrl.isEmpty ? "面板：浏览器打开 dev server 地址" : "面板：\(panelUrl)（浏览器打开·元素高亮/就地编辑/REPL）"
        url.translatesAutoresizingMaskIntoConstraints = false
        s.addSubview(url)

        let safe = host.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            s.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            s.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            s.bottomAnchor.constraint(equalTo: host.bottomAnchor),
            grab.topAnchor.constraint(equalTo: s.topAnchor, constant: 8),
            grab.centerXAnchor.constraint(equalTo: s.centerXAnchor),
            grab.widthAnchor.constraint(equalToConstant: 36),
            grab.heightAnchor.constraint(equalToConstant: 4),
            title.topAnchor.constraint(equalTo: grab.bottomAnchor, constant: 12),
            title.leadingAnchor.constraint(equalTo: s.leadingAnchor, constant: 18),
            status.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8),
            status.leadingAnchor.constraint(equalTo: s.leadingAnchor, constant: 18),
            status.trailingAnchor.constraint(equalTo: s.trailingAnchor, constant: -18),
            reset.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 14),
            reset.leadingAnchor.constraint(equalTo: s.leadingAnchor, constant: 18),
            reset.trailingAnchor.constraint(equalTo: s.trailingAnchor, constant: -18),
            reset.heightAnchor.constraint(equalToConstant: 44),
            url.topAnchor.constraint(equalTo: reset.bottomAnchor, constant: 12),
            url.leadingAnchor.constraint(equalTo: s.leadingAnchor, constant: 18),
            url.trailingAnchor.constraint(equalTo: s.trailingAnchor, constant: -18),
            url.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -16),
        ])
        s.isHidden = true
        sheet = s
    }

    @objc private func didTapReset() {
        onReset?()
        hideSheet()
    }
}
