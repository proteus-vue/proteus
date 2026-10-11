// tab-chrome.swift —— ★★★B · 能力归 runtime（决策 #800）：**iOS tab 栏 chrome 唯一实现**
//
// 【它解决什么】此前 iOS 两个壳（框架参考宿主 `superapp-scene.swift` + CLI 模板 `ProteusApp.swift`）
//   **各写一份** tab 栏：建视图 / 文案优先级 / 图标兜底 / 高亮 / 角标——且与 Android/鸿蒙共漂移出
//   **三套合并口径**（2026-10-11 取证：模板=项目真值优先、参考=规格优先、"首页"压过项目标题；图标
//   兜底 • / ☺ / 人形符号三形态）。本文件把 iOS 侧的该能力收敛为**一份**：壳只提供「宿主视图 +
//   切屏回调」，其余全在此。
//
// 【输入契约 = 生成期最终值（不在宿主合并）】`applyState(_:)` 吃 JS 运行期 state：
//   · `tabItems`  —— 名字/文案/字形/角标 **已由 gen-routes 在生成期合并完**（决策 #800）：
//                    `router.tabBar.list[].text > 页面 meta.title > 路由名`；`glyph` 只在声明处。
//   · `tabSpec`   —— 视觉规格（TAB_BAR_SPEC：颜色/尺寸/角标几何）。
//   · `current`   —— 高亮项。
//   本单元**不做合并/兜底**：没声明 glyph ⇒ 不画图标（画 "•" 是旧漂移形态，已禁）。
//
// 【字形两形态】`glyph` 为 `sym:<name>` ⇒ SF Symbols（系统单色矢量，与鸿蒙 SymbolGlyph 同族）；
//   其他 ⇒ 文本字形（加 U+FE0E 变体选择符强制文本呈现——否则 ☺/✉ 渲染成彩色 emoji）。
//
// 【层级】栏加在 `parent.superview`（自绘层每次重绘会把新层加到最上 ⇒ 加在 container 上会被盖住——
//   实测教训）；`applyState` 每次都 bringToFront（与旧壳同因）。
import UIKit

final class ProteusTabChrome {

    /// tab 项终态（来源 = state.tabItems；生成期已合并，宿主零决策）。
    struct Item: Equatable {
        let name: String
        let label: String
        let glyph: String?
        let badge: Int
    }

    /// 壳提供的切屏出口（点 tab → 由壳走 `__proteusSuperappNav` + 重渲）。
    var onTap: ((String) -> Void)?

    private weak var host: UIView?
    private(set) var bar: UIView?
    private var spec: [String: Any] = [:]
    private var items: [Item] = []
    private var current: String = ""
    /// 上次建栏用的输入（差异判定：避免每帧重建子视图）。
    private var builtItems: [Item]? = nil
    private var builtSpec: NSDictionary? = nil
    /// 上次建栏时的父宽——★布局前首建（bounds 零宽）会把格子/标签/图标**以零宽定过位**，
    ///   layoutBar 只修正栏与格子外框、修不回格内子视图 ⇒ 宽度变化必须**整栏重建**（真机截图取证）。
    private var builtWidth: CGFloat = -1

    // ────────────────────────── 状态解析（唯一入口） ──────────────────────────

    /// 从 JS state 解析 tab 项终态（tabItems 为生成期最终值；兼容老产物：无 tabItems ⇒ 由 tabs+tabLabels 现场折）。
    static func itemsFromState(_ state: [String: Any]) -> [Item] {
        if let arr = state["tabItems"] as? [[String: Any]] {
            return arr.compactMap { o in
                guard let name = o["name"] as? String else { return nil }
                let label = (o["label"] as? String) ?? name
                let glyph = (o["glyph"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                let badge = (o["badge"] as? NSNumber)?.intValue ?? 0
                return Item(name: name, label: label, glyph: glyph, badge: badge)
            }
        }
        // 老产物回退（同一优先级；行为与 B 之前一致）
        let tabs = (state["tabs"] as? [String]) ?? []
        let labels = (state["tabLabels"] as? [String: String]) ?? [:]
        return tabs.map { Item(name: $0, label: labels[$0].flatMap { $0.isEmpty ? nil : $0 } ?? $0, glyph: nil, badge: 0) }
    }

    static func specFromState(_ state: [String: Any]) -> [String: Any] {
        (state["tabSpec"] as? [String: Any]) ?? [:]
    }

    // ────────────────────────── 壳接口 ──────────────────────────

    /// 把栏挂到 `parent`（建议传 `container.superview`——见头注层级说明）。幂等：重复调不重建。
    func attach(in parent: UIView) {
        if host !== parent { host = parent }
        rebuildIfNeeded()
    }

    /// 每次渲染/导航后由壳调用：解析 state → 差异重建/重着色 + 置顶。items 为空 ⇒ 撤栏（无 tab 即无栏）。
    func applyState(_ state: [String: Any]) {
        spec = Self.specFromState(state)
        items = Self.itemsFromState(state)
        current = (state["current"] as? String) ?? ""
        rebuildIfNeeded()
        restyle()
        layoutBar()
        if let b = bar { host?.bringSubviewToFront(b) }
    }

    func remove() {
        bar?.removeFromSuperview()
        bar = nil
        builtItems = nil
        builtSpec = nil
        builtWidth = -1
    }

    // ────────────────────────── 构建 ──────────────────────────

    private func rebuildIfNeeded() {
        guard let parent = host else { return }
        if items.isEmpty {
            remove()
            return
        }
        let specDict = spec as NSDictionary
        let width = parent.bounds.width
        let same = (builtItems == items) && (builtSpec?.isEqual(specDict) ?? false) && bar != nil
            && abs(width - builtWidth) < 0.5
        if same { return }
        bar?.removeFromSuperview()
        bar = build(in: parent)
        builtItems = items
        builtSpec = specDict
        builtWidth = width
    }

    private func build(in parent: UIView) -> UIView {
        let h = CGFloat((spec["height"] as? NSNumber)?.doubleValue ?? 56)
        let w = parent.bounds.width
        let bar = UIView(frame: CGRect(x: 0, y: parent.bounds.height - h, width: w, height: h))
        bar.backgroundColor = specColor("surface", 0xFFFFFF)
        // 顶边框（Web: border-top 1px --sa-line）
        let line = UIView(frame: CGRect(x: 0, y: 0, width: w, height: 1.0 / UIScreen.main.scale))
        line.backgroundColor = specColor("line", 0xDCDFE5)
        bar.addSubview(line)
        for (i, item) in items.enumerated() {
            let bw = w / CGFloat(max(1, items.count))
            let cell = UIView(frame: CGRect(x: bw * CGFloat(i), y: 0, width: bw, height: h))
            cell.tag = 771000 + i
            cell.accessibilityIdentifier = item.name
            // 图标（可无——没声明 glyph 就不画）
            if let glyphView = makeGlyphView(item: item, width: bw) {
                glyphView.tag = 771003
                cell.addSubview(glyphView)
            }
            // 文案
            let tx = UILabel(frame: CGRect(x: 0, y: 30, width: bw, height: 14))
            tx.tag = 771004
            tx.text = item.label
            tx.font = UIFont.systemFont(ofSize: CGFloat((spec["labelSize"] as? NSNumber)?.doubleValue ?? 10))
            tx.textAlignment = .center
            cell.addSubview(tx)
            // 角标（声明了 badge>0 才画；规格几何取自 tabSpec.badge）
            if item.badge > 0 {
                let bd = UILabel(frame: CGRect(x: bw / 2 + 4, y: 4, width: 16, height: 16))
                bd.tag = 771005
                bd.text = item.badge > 99 ? "99+" : "\(item.badge)"
                bd.font = UIFont.systemFont(ofSize: CGFloat(badgeSpecNum("fontSize", 11)), weight: .semibold)
                bd.textColor = .white
                bd.textAlignment = .center
                bd.backgroundColor = specColor("badgeBg", 0xD64545)
                bd.layer.cornerRadius = CGFloat(badgeSpecNum("radius", 8))
                bd.layer.masksToBounds = true
                cell.addSubview(bd)
            }
            let tap = UITapGestureRecognizer(target: self, action: #selector(onItemTap(_:)))
            cell.addGestureRecognizer(tap)
            cell.isUserInteractionEnabled = true
            bar.addSubview(cell)
        }
        parent.addSubview(bar)
        return bar
    }

    /// 字形视图：`sym:<name>` ⇒ SF Symbols；其他 ⇒ 文本字形（U+FE0E）；nil ⇒ 不画。
    private func makeGlyphView(item: Item, width bw: CGFloat) -> UIView? {
        guard let glyph = item.glyph, !glyph.isEmpty else { return nil }
        let size = CGFloat((spec["iconSize"] as? NSNumber)?.doubleValue ?? 19)
        let frame = CGRect(x: 0, y: 6, width: bw, height: 22)
        if glyph.hasPrefix("sym:") {
            let sysName = String(glyph.dropFirst(4))
            if let img = UIImage(systemName: sysName) {
                let iv = UIImageView(image: img)
                iv.frame = frame
                iv.contentMode = .center
                iv.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: size)
                return iv
            }
            // 系统符号名无效 ⇒ 不画（不静默画点——旧漂移形态已禁）
            return nil
        }
        let ic = UILabel(frame: frame)
        ic.text = glyph + "\u{FE0E}"   // 变体选择符：强制文本呈现（防彩色 emoji）
        ic.font = UIFont.systemFont(ofSize: size)
        ic.textAlignment = .center
        return ic
    }

    // ────────────────────────── 着色 / 布局 ──────────────────────────

    private func restyle() {
        guard let bar = bar else { return }
        let on = specColor("brand", 0x5B5BD6)
        let off = specColor("text3", 0x5F6673)
        for (i, item) in items.enumerated() {
            guard let cell = bar.viewWithTag(771000 + i) else { continue }
            let tint = (item.name == current) ? on : off
            if let ic = cell.viewWithTag(771003) {
                if let iv = ic as? UIImageView { iv.tintColor = tint }
                if let lb = ic as? UILabel { lb.textColor = tint }
            }
            (cell.viewWithTag(771004) as? UILabel)?.textColor = tint
        }
    }

    /// 尺寸校正（父视图 bounds 变化后——如布局/安全区就绪的二次渲染）。
    private func layoutBar() {
        guard let bar = bar, let parent = host else { return }
        let h = CGFloat((spec["height"] as? NSNumber)?.doubleValue ?? 56)
        let w = parent.bounds.width
        if bar.frame.width != w || bar.frame.height != h || bar.frame.origin.y != parent.bounds.height - h {
            bar.frame = CGRect(x: 0, y: parent.bounds.height - h, width: w, height: h)
            let bw = w / CGFloat(max(1, items.count))
            for (i, _) in items.enumerated() {
                bar.viewWithTag(771000 + i)?.frame = CGRect(x: bw * CGFloat(i), y: 0, width: bw, height: h)
            }
        }
    }

    @objc private func onItemTap(_ g: UITapGestureRecognizer) {
        guard let cell = g.view else { return }
        let idx = cell.tag - 771000
        guard idx >= 0, idx < items.count else { return }
        onTap?(items[idx].name)
    }

    // ────────────────────────── 规格读取（#rrggbb → UIColor） ──────────────────────────

    private func specColor(_ key: String, _ fallback: UInt32) -> UIColor {
        if let hex = spec[key] as? String, let c = Self.colorFromHex(hex) { return c }
        return UIColor(red: CGFloat((fallback >> 16) & 0xFF) / 255.0,
                       green: CGFloat((fallback >> 8) & 0xFF) / 255.0,
                       blue: CGFloat(fallback & 0xFF) / 255.0, alpha: 1)
    }

    private func badgeSpecNum(_ key: String, _ fallback: Double) -> Double {
        guard let bd = spec["badge"] as? [String: Any] else { return fallback }
        return (bd[key] as? NSNumber)?.doubleValue ?? fallback
    }

    static func colorFromHex(_ css: String) -> UIColor? {
        var h = css.hasPrefix("#") ? String(css.dropFirst()) : css
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255.0,
                       green: CGFloat((v >> 8) & 0xFF) / 255.0,
                       blue: CGFloat(v & 0xFF) / 255.0, alpha: 1)
    }
}
