// platform/ios/ProteusPlatform/ProteusTextAdapter.swift
// ★★**iOS 平台适配层：文本与字体**（HA0.5 从 `hosts/ios/ProteusHost/selfdraw-scene.swift` 抽出）
//
// 【这一层是什么（Host ABI 方案 §0.4.8 的判断标准）】"这段代码换到同平台的另一个 App 里，需要改吗？"
//   · 文本度量（CoreText）—— **不用改** ⇒ **平台适配**（各端各写是**正确设计**，不该抽进 ABI）
//   · 字体角色映射（serif/monospace/… → UIFont）—— 同平台内通用 ⇒ 同属本层
//   ⇒ 因此它属于 `platform/`；而**宿主集成**（Surface/生命周期/输入/调度/能力注册）留在 `hosts/`。
//
// 【为什么拆出来（HA0.5 的实质收益）】**同平台换壳**（Proteus App → 客户 App）时，
//   平台适配层**一行不用改**；拆分前它与宿主集成混在一个文件里 ⇒ 换壳要连带重写。
//
// 【依赖方向（硬性，`scripts/check-platform-layering.mjs` 把它机器化）】
//   platform/* ──→ **禁止**引用 hosts/* 与 Host ABI（平台层不感知宿主契约）
//   本文件只依赖 UIKit / CoreText / Foundation ⇒ 任何 iOS 宿主都能复用它。
//
// 【诚实边界】本文件是**机械抽取**（逐行搬移，零语义改动，只把 `SelfDrawBridge.` 前缀换成
//   `ProteusTextAdapter.`）——由 `check:ios-selfdraw-compile`（真编译）与真机自绘用例（真跑）
//   共同守住"行为未变"。

import UIKit
import CoreText

/// ★文本与字体的平台适配（**唯一实现**：绘制与度量共用同一支字体，避免"度量用 A、绘制用 B"）
final class ProteusTextAdapter {

    /// ★★文本度量缓存：**内容寻址**（键 = 文本 ⊕ 字号），与核心 §5.3 同款原则
    ///
    /// 【为什么必须缓存（真机实测定位）】宿主此前每次更新都对**全部节点**重跑 CoreText：
    ///   3507 节点实测 **28.96ms**——而该次更新只改了一个 margin，**文本一个字都没变**
    ///   ⇒ 100% 是白跑。（这也是「整树操作」在本链路上的最后一处。）
    ///
    /// 【为什么是内容寻址而非按节点缓存】同一文案会在多个节点出现
    ///   （列表里的「说明文字」「分组标题」）⇒ 按内容缓存可直接复用；
    ///   且文本变没变，内容 hash 天然知道，无需额外的失效逻辑。
    ///
    /// 【与核心的关系】核心侧也有度量缓存（同样内容寻址）；两侧独立：
    ///   宿主的缓存省的是**跨界调用**（CoreText），核心的缓存省的是**重复回调**。
    private static var measureCache: [String: CGSize] = [:]

    static func font(size: CGFloat, weight: CGFloat, family: String = "system") -> UIFont {
        let base = systemFont(size: size, weight: weight)
        switch family {
        case "system":
            return base
        case "monospace":
            // ★等宽走专用 API（iOS 13+）：`monospacedSystemFont` 同时保留字重语义
            return UIFont.monospacedSystemFont(ofSize: size, weight: uiFontWeight(weight))
        case "serif":
            if let f = UIFont(name: "Times New Roman", size: size) {
                return adjustWeight(f, weight) ?? f
            }
            return designFont(size: size, weight: weight, design: .serif) ?? base
        case "rounded":
            return designFont(size: size, weight: weight, design: .rounded) ?? base
        case "condensed":
            // ★注意：`SystemDesign` 枚举里**没有** condensed（实测 SDK：只有 default/rounded/
            //   serif/monospaced）⇒ 用 `UIFontDescriptorTraitCondensed` **符号特征**表达
            //   （该常量在 iOS 13+ 可用，与本宿主最低版本相符）。
            //   取不到则**显式回退并计数**（不悄悄用 system 而不留痕迹）
            guard let d = UIFont.systemFont(ofSize: size).fontDescriptor.withSymbolicTraits(.traitCondensed) else {
                fontFamilyFallbackCount += 1
                lastUnknownFontFamily = "condensed@no-face"
                return base
            }
            return UIFont(descriptor: d, size: size)
        default:
            // ★★自定义字体（`custom:<族名>`，2026-09-29）——**先查注册表**
            //   契约见适配器 `CUSTOM_FONT_PREFIX`（与 Android `ProteusHostView` 同值）。
            //   已注册 ⇒ 用注册的字体（叠字重）；未注册 ⇒ **回退 system + 计数**（不静默：
            //   "缺字体资源"与"识别为默认"必须可区分）。
            if family.hasPrefix(ProteusTextAdapter.customFontPrefix) {
                let name = String(family.dropFirst(ProteusTextAdapter.customFontPrefix.count))
                if let f = customFonts[name] {
                    return adjustWeight(f, weight) ?? f
                }
                customFontMisses += 1
                lastMissingCustomFont = name
                return base
            }
            // ★未知角色：**显式回退 + 计数**（不静默）——两端契约不一致时必须可见
            fontFamilyFallbackCount += 1
            lastUnknownFontFamily = family
            return base
        }
    }

    /* ══════════ ★★自定义字体注册通道（@font-face / 打包字体，2026-09-29）══════════ */

    /// 与适配器 `CUSTOM_FONT_PREFIX` **同一常量**（两端不一致 ⇒ 自定义族永远命中不了）
    static let customFontPrefix = "custom:"

    /// 族名 → 字体（注册表）
    private static var customFonts: [String: UIFont] = [:]

    /// 未注册的自定义族名命中次数（>0 ⇒ 宿主缺字体资源，**不是**静默回退）
    private(set) static var customFontMisses = 0
    /// 最近一个未注册的族名（诊断用）
    private(set) static var lastMissingCustomFont = ""

    /// 注册自定义字体。**两种来源**（各对应一类真实用法）：
    ///   1. **打包字体文件**（@font-face 最常见）⇒ 传 `path`（`CGDataProvider` 加载）；
    ///   2. **系统已安装字体**（按 PostScript/族名）⇒ 传 `systemName`（`UIFont(name:)` 查找）
    ///      ——iOS 生态里大量"自定义字体"其实是系统字体按名引用（不需打包文件）。
    ///
    /// 【为什么两者都要（本仓真机实测）】首版只支持 `path`，而 V15 用例列的
    ///   `/System/Library/Fonts/Supplemental/Georgia.ttf` 在 **iOS 上不存在**
    ///   （那是 macOS 的路径）⇒ 注册全失败、判据 FAIL。平台字体布局不同 ⇒ 不能照搬。
    /// - Returns: true = 注册成功；false = 无法解析（调用方应记日志，**不静默**）
    @discardableResult
    static func registerFont(family: String, path: String) -> Bool {
        if !path.isEmpty {
            guard let data = NSData(contentsOfFile: path),
                  let provider = CGDataProvider(data: data),
                  let cg = CGFont(provider) else {
                return false
            }
            // 用 CTFont 从 CGFont 构造（与 cgFont(of:) 同一路子——本仓实测：CGFont(name:) 对
            // 私有字体名会返 nil，走 provider 才是可靠路径）
            guard let ct = CTFontCreateWithGraphicsFont(cg, 16.0, nil, nil) as CTFont? else {
                return false
            }
            customFonts[family] = ct as UIFont
            return true
        }
        return false
    }

    /// 按**系统字体名**注册（`UIFont(name:)` 查找；找不到 ⇒ false，不静默）
    @discardableResult
    static func registerSystemFont(family: String, systemName: String) -> Bool {
        guard let f = UIFont(name: systemName, size: 16) else { return false }
        customFonts[family] = f
        return true
    }

    /// 注册表规模（验收判据用）
    static var registeredFontCount: Int { customFonts.count }

    /// 清空注册表（测试隔离用——跨用例共享状态必须可归零，本仓纪律 #10）
    static func clearCustomFonts() {
        customFonts.removeAll()
        customFontMisses = 0
        lastMissingCustomFont = ""
    }

    /// CSS 字重 → `UIFont.Weight`（与 `systemFont(size:weight:)` 同口径——单一映射表）
    private static func uiFontWeight(_ weight: CGFloat) -> UIFont.Weight {
        if weight >= 700 { return .bold }
        if weight >= 600 { return .semibold }
        if weight <= 300 { return .light }
        return .regular
    }

    /// 系统字体（按字重档位取变体）——`font(size:weight:family:)` 的 system 分支
    private static func systemFont(size: CGFloat, weight: CGFloat) -> UIFont {
        if weight >= 700 { return UIFont.boldSystemFont(ofSize: size) }
        if weight >= 600 { return UIFont.systemFont(ofSize: size, weight: .semibold) }
        if weight <= 300 { return UIFont.systemFont(ofSize: size, weight: .light) }
        return UIFont.systemFont(ofSize: size)
    }

    /// 用 `UIFontDescriptor` 的**设计族**取字体（serif/rounded/condensed），并尽量叠上字重
    private static func designFont(size: CGFloat, weight: CGFloat, design: UIFontDescriptor.SystemDesign) -> UIFont? {
        guard let d0 = UIFont.systemFont(ofSize: size).fontDescriptor.withDesign(design) else { return nil }
        // ★先把字重叠到设计族的 descriptor 上（trait 会挑同族更粗/更细的一支）；
        //   失败则退回设计族默认字重（**不混用系统族**——那会让"字族生效了"变成假象）
        if let withTrait = d0.withSymbolicTraits(symbolicTraits(weight)) {
            return UIFont(descriptor: withTrait, size: size)
        }
        return UIFont(descriptor: d0, size: size)
    }

    /// 字重 → `UIFontDescriptor.SymbolicTraits`（仅粗/常规/细三档，与 §字重档位同口径）
    private static func symbolicTraits(_ weight: CGFloat) -> UIFontDescriptor.SymbolicTraits {
        var t: UIFontDescriptor.SymbolicTraits = []
        if weight >= 600 { t.insert(.traitBold) }
        else if weight <= 300 { t.insert(.traitLooseLeading) }   // 近似"细"（CJK 无真轻体时的安全选择）
        return t
    }

    /// 给指定字体**叠字重**（如 Times New Roman + bold）；无对应 face 则返回 nil（调用方回退）
    private static func adjustWeight(_ font: UIFont, _ weight: CGFloat) -> UIFont? {
        guard weight >= 600 else { return font }
        guard let d = font.fontDescriptor.withSymbolicTraits(.traitBold) else { return nil }
        return UIFont(descriptor: d, size: font.pointSize)
    }

    /// ★★`UIFont` → `CGFont`（`CATextLayer.font` 需要它）——**必须走 CTFont，不能直接 CGFont(name)**
    ///
    /// 【为什么（本仓实测的真缺陷，被 V13 抓到）】系统私有字体名**以点开头**
    ///   （`.SFUI-Regular` / `.SFMono-Regular`）——`CGFont(name)` 对它们**返回 nil**，
    ///   而 `CATextLayer.font = nil` ⇒ 该层**回退默认字体**。
    ///   现象：**度量用等宽、绘制用默认体**（本仓 V13 实测 `monospace` 行 `font_name` 为空）
    ///   ⇒ 正是本仓反复吃过的"度量与绘制分叉"（字被裁或留白，而几何断言全绿）。
    ///   ⇒ 正解：`CTFont` 能解析这些名字（`CTFontCreateWithFontDescriptor` 更稳），
    ///     再经 `CTFontCopyGraphicsFont` 取真正的 `CGFont`。
    static func cgFont(of font: UIFont) -> CGFont? {
        // ① 先试直接按名构造（公开字体名走这条，最直接）
        if let cg = CGFont(font.fontName as CFString) { return cg }
        // ② 私有名/别名 ⇒ 经 CTFont 解析（descriptor 路径对系统字体最可靠）
        let ct = CTFontCreateWithFontDescriptor(font.fontDescriptor as CTFontDescriptor, font.pointSize, nil)
        // ★`CTFontCopyGraphicsFont` 在 Swift 里返回**非可选** `CGFont`（它保证有图形字体；
        //   失败路径是 CTFont 本身拿不到——已由上面 descriptor 构造保证）
        return CTFontCopyGraphicsFont(ct, nil)
        // ③ 仍失败 ⇒ **计数**（不静默：绘制字体会与度量分叉，必须可观测）
        cgFontFallbackCount += 1
        lastCGFontFailure = font.fontName
        return nil
    }

    /// `CGFont` 解析失败次数与最后失败的名字（诊断：非零即"度量/绘制分叉"的前兆）
    private(set) static var cgFontFallbackCount = 0
    private(set) static var lastCGFontFailure = ""
    static func resetFontFamilyStats() {
        fontFamilyFallbackCount = 0
        lastUnknownFontFamily = ""
        cgFontFallbackCount = 0
        lastCGFontFailure = ""
    }

    /// 字体族回退计数（诊断：证明"未知角色"这条路径真的被走到过 / 为 0 证明契约一致）
    private(set) static var fontFamilyFallbackCount = 0
    private(set) static var lastUnknownFontFamily = ""

    static func measureText(_ text: String, fontSize: CGFloat, fontWeight: CGFloat = 400,
                            fontFamily: String = "system", lineHeight: String? = nil, letterSpacing: CGFloat = 0) -> CGSize {
        if text.isEmpty { return .zero }
        // ★缓存键必须含**字重与字族**（本仓实测的同一类缺陷：键不含某维度 ⇒ 不同字体共用度量 ⇒ 静默错几何）
        //   ★三层维度与适配器 `fontSignature` 的输入**逐项对应**（新增维度必须两边同时加）
        //   ★批次 13：键含 `lineHeight`（影响行盒高）
        let key = "\(fontSize)\u{1}\(fontWeight)\u{1}\(fontFamily)\u{1}\(lineHeight ?? "")\u{1}\(letterSpacing)\u{1}\(text)"
        if let hit = measureCache[key] { measureCacheHits += 1; return hit }
        measureCacheMisses += 1
        let font = ProteusTextAdapter.font(size: fontSize, weight: fontWeight, family: fontFamily)
        var attrs: [NSAttributedString.Key: Any] = [.font: font]
        // ★批次 20（CSS 兼容对齐 · 以 Web 为基准）：字距（kern）影响文本宽度 ⇒ 必须进度量
        if letterSpacing != 0 { attrs[.kern] = letterSpacing as NSNumber }
        let size = (text as NSString).size(withAttributes: attrs)
        // ★批次 13（line-height）：声明行高 ⇒ **行盒高** = 行高（无单位倍数×fontSize / 绝对 px），
        //   覆盖字形度量高（字形由 CATextLayer 顶对齐绘制——三端一致，见宿主注释）
        var height = size.height
        if let lh = lineHeight, let h = ProteusTextAdapter.lineHeightPx(lh, fontSize: fontSize) {
            height = h
        }
        // ★向上取整到整点：真机实测文本宽度常带小数（如 47.33pt），
        //   而宿主按整点布置 CALayer 更稳定；同时避免「同一文本两次测量差 0.001」导致布局抖动
        // I2-ALLOW: 文本**测量**结果的取整（测量子系统，非几何换算——度量值由内核消费后
        //   再经 `snap` 统一吸附；平台层对**几何**（层 frame）零舍入，见 check:host-rounding）
        let rounded = CGSize(width: ceil(size.width), height: ceil(height))
        measureCache[key] = rounded
        return rounded
    }

    /// ★★全端对齐批（2026-10-05 · white-space 五端对齐）：**按盒宽折行测量**（wrap 模式专用）。
    ///   与 Web 语义对齐：折行后高度 = 行数 × lineHeight（声明行高时）；未声明 ⇒ CoreText 自然高。
    ///   盒宽来自内核解析后的盒（调用方传入）——宿主不自己推布局（纪律：几何唯一来源 = 内核）。
    static func measureTextWrapped(_ text: String, fontSize: CGFloat, fontWeight: CGFloat = 400,
                                    fontFamily: String = "system", lineWidth: CGFloat,
                                    lineHeight: String? = nil, letterSpacing: CGFloat = 0, wordBreak: String? = nil) -> CGSize {
        if text.isEmpty || lineWidth <= 0 { return .zero }
        // 缓存键含 lineWidth（同文本不同盒宽折行结果不同；前缀 W 与单行键空间区分）
        // ★★★word-break 项（2026-10-06）：键含 wordBreak（不同断词策略折行结果不同）
        let key = "W\u{1}\(fontSize)\u{1}\(fontWeight)\u{1}\(fontFamily)\u{1}\(lineWidth)\u{1}\(lineHeight ?? "")\u{1}\(letterSpacing)\u{1}\(wordBreak ?? "")\u{1}\(text)"
        if let hit = measureCache[key] { measureCacheHits += 1; return hit }
        measureCacheMisses += 1
        let font = ProteusTextAdapter.font(size: fontSize, weight: fontWeight, family: fontFamily)
        var attrs: [NSAttributedString.Key: Any] = [.font: font]
        if letterSpacing != 0 { attrs[.kern] = letterSpacing as NSNumber }
        // ★★★word-break 项（2026-10-06）：断词策略 → 段落 lineBreakMode（与绘制 textLayerString 同源）。
        //   break-all ⇒ byCharWrapping（任意字符断）；其余 ⇒ byWordWrapping。测量须与绘制同策略，否则折行数不一致。
        if let wb = wordBreak {
            let ps = NSMutableParagraphStyle()
            ps.lineBreakMode = wb == "break-all" ? .byCharWrapping : .byWordWrapping
            attrs[.paragraphStyle] = ps
        }
        let rect = (text as NSString).boundingRect(
            with: CGSize(width: lineWidth, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: attrs, context: nil)
        var height = rect.height
        if let lh = lineHeight, let h = ProteusTextAdapter.lineHeightPx(lh, fontSize: fontSize), h > 0 {
            // 行数 = 自然折行高 / 自然行高（UIFont.lineHeight）；行盒高 = 行数 × 声明行高
            let natural = max(1, font.lineHeight)
            let lines = max(1, Int((rect.height / natural).rounded()))
            height = CGFloat(lines) * h
        }
        // I2-ALLOW: 文本**测量**结果的取整（测量子系统——与单行 measureText 同口径）
        let rounded = CGSize(width: ceil(rect.width), height: ceil(height))
        measureCache[key] = rounded
        return rounded
    }

    /// ★批次 13：`line-height` token → 行盒高 px（无单位倍数×fontSize / 绝对 px；解析失败 ⇒ nil）
    static func lineHeightPx(_ token: String, fontSize: CGFloat) -> CGFloat? {
        if token.hasSuffix("px") {
            return CGFloat(Double(token.dropLast(2)) ?? 0)
        }
        if let mult = Double(token) { return CGFloat(mult) * fontSize }
        return nil
    }

    /// 度量缓存命中/未命中（诊断：证明缓存真的生效）
    private(set) static var measureCacheHits = 0
    private(set) static var measureCacheMisses = 0
    static func resetMeasureStats() { measureCacheHits = 0; measureCacheMisses = 0 }
}
