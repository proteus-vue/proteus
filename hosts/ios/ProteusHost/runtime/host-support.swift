// hosts/ios/ProteusHost/runtime/host-support.swift
// ★★★#1101：宿主**顶层基础设施**——从 `selfdraw-scene.swift` 机械搬迁（零行为变化）。
//
// 【为什么拆】`selfdraw-scene.swift` 受 `check:file-size` 棘轮钉住（存量只减不增），
//   而 #1101 要在玻璃遍里加子相位埋点。这里搬出的都是**顶层声明**（不是 `SelfDrawView` 的成员）：
//     · `takeCString`           —— C 字符串 → Swift String（配套 host-abi 的 free）
//     · `physFootprintMB`       —— 进程真实内存占用（OOM 判据的口径）
//     · `BenchDone` / `SvgDiag` / `ProteusLaunchDiag` —— 文件级诊断计数器
//     · `ProteusTextLayer`      —— 遵守 line-height 的 CoreText 文本层
//   它们**不依赖 `SelfDrawView` 的任何私有状态** ⇒ 搬迁不需要改访问级别，风险为零。
import UIKit
import CoreText
import Darwin

/// C 字符串 → Swift String（读后**立即释放**内核分配的串——所有权在这里闭环）
func takeCString(_ ptr: UnsafeMutablePointer<CChar>) -> String {
    defer { proteus_layout_free_string(ptr) }
    return String(cString: ptr)
}

/// 当前进程的**实际内存占用**（MB）
///
/// ★用 `phys_footprint`：这是 iOS 上最贴近「真实占用」的口径（含 dirty + compressed），
///   也是系统 OOM 杀进程时看的那个数。加压测试要给出「内存天花板」，不能用估算值。
func physFootprintMB() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
    }
    guard kr == KERN_SUCCESS else { return -1 }
    return Double(info.phys_footprint) / 1024.0 / 1024.0
}

/// bench 完成标志（由 JS 链尾的 `done()` 置位；宿主据此收尾）
enum BenchDone { static var flag = false }

/// ★★C2 诊断计数（文件级全局——见 `SelfDrawView` 里"为什么不用类内 static"的注释）
enum SvgDiag {
    static var attachStats = 0
    static var skipNoId = 0
    static var skipNoLayer = 0
    static var skipNoSegs = 0
    static var built = 0
}

/// 启动白屏诊断读数（**runtime 自持**）——壳在 viewDidLoad 填充，发动机在 bench 报告里读出。
/// ★第三刀解耦：原先它挂在壳的视图控制器上，导致 runtime 反向引用 shell；现移入 runtime 自持。
enum ProteusLaunchDiag {
    static var data: [String: Any] = [:]
}

/// ★★★行高修复（2026-10-08 · 用户抓出「iOS 行高比其他端矮」）：CATextLayer 对**多行文本**完全忽略段落
///   的 `minimumLineHeight/maximumLineHeight`（实测：显式 `\n`、CTParagraphStyle 都不行，恒用字体自然行高）
///   ⇒ 声明 `line-height` 的多行文本行距偏小（与 Web/Android/鸿蒙不一致）。
///   修：声明行高的多行文本改用本子类——`draw(in:)` 用 CoreText `CTFrameDraw` 渲染（**遵守** NSPS 行高，
///   本机实测 pitch 精确 = 声明值）；其余情形仍走 CATextLayer 原生路径（零行为变化）。
final class ProteusTextLayer: CATextLayer {
    /// true ⇒ 用 CoreText 绘制（`string` 须为 NSAttributedString）；false ⇒ 原生 CATextLayer 绘制。
    var useCoreText = false
    var obliqueShear: CGFloat = 0   // ★#1057 合成斜切（`.obliqueness` 是 AppKit、`withMatrix` 被 CGFont 丢）

    override func draw(in ctx: CGContext) {
        guard useCoreText, let attributed = string as? NSAttributedString else { super.draw(in: ctx); return }
        let framesetter = CTFramesetterCreateWithAttributedString(attributed)
        let path = CGPath(rect: CGRect(origin: .zero, size: bounds.size), transform: nil)
        let frame = CTFramesetterCreateFrame(framesetter, CFRangeMake(0, 0), path, nil)
        ctx.saveGState()
        ctx.textMatrix = .identity
        // ★★CALayer 的 `draw(in:)` 上下文是 **y 向下**（CA 坐标系）⇒ CoreText（y 向上）必须翻转，
        //   否则文本上下颠倒（真机实测：A/B/C 三段全镜像——独立 CGContext 上恰好相反，不能照搬）。
        ctx.translateBy(x: 0, y: bounds.height)
        ctx.scaleBy(x: 1, y: -1)
        if obliqueShear != 0 { ctx.concatenate(CGAffineTransform(a: 1, b: 0, c: obliqueShear, d: 1, tx: 0, ty: 0)) }   // ★#1057 合成斜切
        CTFrameDraw(frame, ctx)
        ctx.restoreGState()
    }
}
