// hosts/ios/ProteusHost/runtime/glass-metal.swift
// ★★★框架自研**液态玻璃材质**（iOS 落地 · 决策 #818/#834）——Metal(MSL) 版。
//
// 【新架构（决策 #834）】**算法真源 = Rust 的 WGSL**（`packages/shader-codegen-rust/src/materials/
//   glass.wgsl`，经 naga 落地 MSL）。本文件**不含任何着色器算法**——源码取自生成物
//   `GeneratedMaterials.glassFragmentMSL/glassVertexMSL`（`node scripts/gen-shaders.mjs` 产出，门禁防漂移）。
//   本文件只做**落地**：`MTLDevice.makeLibrary(source:)` 编译 + 建管线 + 设 uniform + 离屏渲染。
//
// 【为什么直连 Metal（而非 CoreImage）】决策 #834：不依赖系统材质/UIGlassEffect（随版本变）；
//   Metal 是 iOS 的稳定底层，可确定性落地同一份 WGSL ⇒ 版本无关、观感与三端同源。
//
// 【怎么用（宿主）】`SelfDrawView.applyGlassPass` 捕获"无玻璃内容帧"→ 对每个玻璃节点：
//   `GlassMetalRenderer.shared.renderFace(backdrop:nodeRect:scale:spec:)` → 得节点盒尺寸的 CGImage
//   → 作玻璃面层的 `contents`。渲染目标 = 节点盒（origin=0），与 WGSL 契约一致。
//
// 【诚实边界】① 需 GPU（模拟器/真机都有）；编译失败或不可用 ⇒ 返 nil ⇒ 调用方降级（不白屏/黑块）。
//   ② 每帧为每个玻璃节点建一次命令缓冲（真机性能可后续优化为一次批量）。
import Metal
import MetalKit
import CoreGraphics
import UIKit

final class GlassMetalRenderer {

    static let shared = GlassMetalRenderer()

    /// 玻璃/材质参数（由内核 `style.glass` 折出；与 Android `GlassMaterial.Spec` 同源）。
    struct Spec {
        let blur: CGFloat
        let tint: (r: CGFloat, g: CGFloat, b: CGFloat, a: CGFloat)
        let radius: CGFloat
        let saturation: CGFloat
        /// ★★★决策 #900：材质 id（`glass`/`backdropBlur`/`frosted`/`vibrancy`）——宿主按此选管线。
        var material: String = "glass"
        /// ★★★决策 #905：触控交互（对齐 Apple `UIGlassEffect.isInteractive`）——该玻璃响应点按/拖动。
        var interactive: Bool = false
        /// ★★★决策 #906：交互效果形态——0=**上层玻璃表面流动**（默认，Apple）/ 1=内容折射位移。
        var effect: CGFloat = 0
        /// ★★★决策 #952/#966：选中胶囊**叠加层**强度（0=无 / 1=叠半透明中性色）——uniform offset 92，
        ///   与 shader 的 `overlay` 同槽（此前 iOS 写的是 `effect`（恒 0）⇒ #952 与 #966 充气门控在该端**恒不触发**）。
        var overlay: CGFloat = 0
    }

    private let device: MTLDevice?
    private let commandQueue: MTLCommandQueue?
    /// ★★★决策 #910（报告 P2-1 · 结构性缺口）：**背景采样器**。
    ///   【为什么之前是坏形态】MSL 的 `fs_glass` 片元按参数顺序期望 `sampler backdrop_smp [[user(fake0)]]`，
    ///   而本文件此前**从未 `setFragmentSamplerState`** ⇒ sampler 处于**未定义状态**（可能 nearest/clamp-zero），
    ///   与 Android（`FILTER_MODE_LINEAR`）/ 鸿蒙（`VK_FILTER_LINEAR`）**不一致** ⇒ 采样可能出块状/偏色。
    ///   现显式绑定 LINEAR + CLAMP_TO_EDGE（与三端同口径）。
    private let backdropSampler: MTLSamplerState?
    /// ★★★决策 #900：**每材质一条管线**（数据驱动——遍历 `GeneratedMaterials.materials` 建；
    ///   加材质零改本文件）。键 = 材质 id。
    private var pipelines: [String: MTLRenderPipelineState] = [:]
    /// id → uniform 结构名（分派 uniform builder 的判别键：`GlassUniforms` → 玻璃；其余 → 模糊族）。
    private var materialUniformStruct: [String: String] = [:]
    private var loggedCompileFail = false

    private init() {
        device = MTLCreateSystemDefaultDevice()
        commandQueue = device?.makeCommandQueue()
        // ★★★决策 #910（报告 P2-1）：显式建 LINEAR + CLAMP_TO_EDGE 采样器（与 Android/鸿蒙同口径）。
        let sd = MTLSamplerDescriptor()
        sd.minFilter = .linear
        sd.magFilter = .linear
        sd.mipFilter = .notMipmapped
        sd.sAddressMode = .clampToEdge
        sd.tAddressMode = .clampToEdge
        backdropSampler = device?.makeSamplerState(descriptor: sd)
        buildPipelines()
    }

    var isAvailable: Bool { !pipelines.isEmpty }

    /// ★★★决策 #900：**按材质字典 **逐项**建管线**（数据驱动）——遍历 `GeneratedMaterials.materials`，
    ///   每个材质编译其 MSL（顶点 `vs_quad` + 片元 entry）成一条 `MTLRenderPipelineState`。
    ///   ⇒ 加材质（改 WGSL + `gen-shaders`）后本文件**零改**（`frosted`/`vibrancy` 自动获得管线）。
    private func buildPipelines() {
        guard let device = device else {
            NSLog("[proteus-glass] 无 Metal 设备——材质走降级")
            return
        }
        for (id, src) in GeneratedMaterials.materials {
            do {
                let lib = try device.makeLibrary(source: src.frag, options: nil)
                let vlib = try device.makeLibrary(source: src.vert, options: nil)
                guard let vfn = vlib.makeFunction(name: "vs_quad"), let ffn = lib.makeFunction(name: src.entry) else {
                    NSLog("[proteus-glass] 材质 %@ MSL 入口未找到（vs_quad/%@）——跳过", id, src.entry)
                    continue
                }
                let desc = MTLRenderPipelineDescriptor()
                desc.vertexFunction = vfn
                desc.fragmentFunction = ffn
                desc.colorAttachments[0].pixelFormat = .bgra8Unorm
                pipelines[id] = try device.makeRenderPipelineState(descriptor: desc)
                materialUniformStruct[id] = src.uniformStruct
            } catch {
                if !loggedCompileFail {
                    loggedCompileFail = true
                    NSLog("[proteus-glass] 材质 %@ MSL 编译/建管线失败——该材质降级：%@", id, String(describing: error))
                }
            }
        }
        NSLog("[proteus-glass] Metal 管线就绪（真源=WGSL）· 材质 %d 个：%@", pipelines.count, pipelines.keys.sorted().joined(separator: ","))
    }

    /// 渲染一块玻璃面（节点盒尺寸的 CGImage）。
    ///
    /// - Parameters:
    ///   - backdrop: 整屏"无玻璃内容帧"（像素坐标，左上原点）
    ///   - nodeRect: 节点在**屏幕**上的矩形（点）
    ///   - scale: 屏幕缩放
    ///   - spec: 玻璃规格（点单位）
    /// - Returns: 节点盒尺寸（像素）的玻璃图；失败返 nil ⇒ 调用方降级。
    func renderFace(backdrop: CGImage, nodeRect: CGRect, scale: CGFloat, spec: Spec,
                    cropOrigin: CGPoint = .zero, texPxPerPoint: CGFloat? = nil) -> CGImage? {
        return renderFaces(backdrop: backdrop, requests: [(nodeRect, spec)], scale: scale,
                           cropOrigin: cropOrigin, texPxPerPoint: texPxPerPoint).first ?? nil
    }

    /// ★★★决策 #863：**批量渲染**多块玻璃面——**共用一份 backdrop 纹理 + 一条命令缓冲 + 一次 fence 等待**。
    ///   【为什么（性能）】此前每块玻璃各上传一次 backdrop 纹理 + 各建命令缓冲 + 各自 `waitUntilCompleted`
    ///   ⇒ N 倍冗余上传 + N 次 GPU 同步。两处都是滚动每帧的开销（真机实测 work_p50 ~16ms）。
    ///   【不改变算法】着色器/uniform 逐字段与单块路径同（同一 `makeUniforms`）。
    ///   - texPxPerPoint: 背景纹理的**每点像素数**（缺省 = `scale`）。可低于 `scale`（半分辨率背景）——
    ///     玻璃被模糊/折射，背景采样不必全分辨率 ⇒ 省捕获栅格化与纹理上传。
    /// - Returns: 与 `requests` **等长**的数组（失败项为 nil ⇒ 调用方降级）。
    func renderFaces(backdrop: CGImage, requests: [(nodeRect: CGRect, spec: Spec)],
                     scale: CGFloat, cropOrigin: CGPoint, texPxPerPoint: CGFloat? = nil,
                     touchPress: [(t: CGPoint, press: CGFloat)]? = nil) -> [CGImage?] {
        let n = requests.count
        guard n > 0 else { return [] }
        let texPx = texPxPerPoint ?? scale
        guard let device = device, let queue = commandQueue, !pipelines.isEmpty else {
            return Array(repeating: nil, count: n)
        }
        // ① 背景纹理（★上传一次，N 块玻璃共用）
        guard let backdropTex = makeTexture(from: backdrop, device: device) else {
            return Array(repeating: nil, count: n)
        }
        var outTexs = [MTLTexture?](repeating: nil, count: n)
        // ② 一条命令缓冲，逐块编码（各自输出纹理；**按材质选管线**）
        //   ★I2-ALLOW: 输出**纹理**像素尺寸（位图必须整数像素，非几何吸附；玻璃采样缓冲与内核几何无关）
        guard let cb = queue.makeCommandBuffer() else { return Array(repeating: nil, count: n) }
        for (i, req) in requests.enumerated() {
            let w = Int((req.nodeRect.width * scale).rounded())
            let h = Int((req.nodeRect.height * scale).rounded())
            guard w > 0, h > 0 else { continue }
            // ★★★决策 #900：按材质 id 选管线（未知 ⇒ 回落 glass）；uniform 按 uniformStruct 分派。
            let mid = pipelines[req.spec.material] != nil ? req.spec.material : "glass"
            guard let pipeline = pipelines[mid] else { continue }
            let isGlass = (materialUniformStruct[mid] ?? "GlassUniforms") == "GlassUniforms"
            let outDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: w, height: h, mipmapped: false)
            outDesc.usage = [.renderTarget, .shaderRead]
            outDesc.storageMode = .shared   // 便于 CPU 读回
            guard let outTex = device.makeTexture(descriptor: outDesc) else { continue }
            let pass = MTLRenderPassDescriptor()
            pass.colorAttachments[0].texture = outTex
            pass.colorAttachments[0].loadAction = .clear
            pass.colorAttachments[0].storeAction = .store
            pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
            guard let enc = cb.makeRenderCommandEncoder(descriptor: pass) else { continue }
            enc.setRenderPipelineState(pipeline)
            enc.setFragmentTexture(backdropTex, index: 0)
            // ★★★决策 #910（报告 P2-1）：绑定背景采样器（此前缺失 ⇒ 未定义状态）。所有材质（玻璃 + 模糊族）都采样背景。
            if let smp = backdropSampler { enc.setFragmentSamplerState(smp, index: 0) }
            if isGlass {
                let tp = (touchPress != nil && i < touchPress!.count) ? touchPress![i] : nil
                var u = makeUniforms(nodeRect: req.nodeRect, outScale: scale, texPxPerPoint: texPx,
                                     backdrop: backdrop, spec: req.spec, cropOrigin: cropOrigin,
                                     touch: tp?.t, press: tp?.press ?? 0)
                enc.setFragmentBytes(&u, length: MemoryLayout<GlassUniforms>.stride, index: 0)
            } else {
                var u = makeBlurUniforms(nodeRect: req.nodeRect, outScale: scale, texPxPerPoint: texPx,
                                         backdrop: backdrop, spec: req.spec, cropOrigin: cropOrigin)
                enc.setFragmentBytes(&u, length: MemoryLayout<BlurUniforms>.stride, index: 0)
            }
            enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6)
            enc.endEncoding()
            outTexs[i] = outTex
        }
        // ③ ★一次提交 + 一次等待（替代每玻璃一次同步）
        cb.commit()
        cb.waitUntilCompleted()
        // ④ 逐块读回 → CGImage
        return outTexs.map { $0.flatMap { self.makeImage(from: $0) } }
    }

    /// 输出纹理 → CGImage（bgra8Unorm ⇒ premultipliedFirst | byteOrder32Little）。
    private func makeImage(from outTex: MTLTexture) -> CGImage? {
        let w = outTex.width, h = outTex.height
        let bytesPerRow = w * 4
        var bytes = [UInt8](repeating: 0, count: bytesPerRow * h)
        outTex.getBytes(&bytes, bytesPerRow: bytesPerRow, from: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0)
        guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { return nil }
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bmpInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        return CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: bytesPerRow,
                       space: colorSpace, bitmapInfo: bmpInfo, provider: provider, decode: nil,
                       shouldInterpolate: false, intent: .defaultIntent)
    }

    // ── 内部 ──

    /// Swift 侧的 uniform 结构（与 WGSL `GlassUniforms` **逐字段同布局**；std430/16 字节对齐）。
    private struct GlassUniforms {
        var tint: SIMD4<Float>       // 0
        var size_px: SIMD2<Float>    // 16
        var origin: SIMD2<Float>     // 24
        var tex_bias: SIMD2<Float>   // 32
        var tex_scale: SIMD2<Float>  // 40
        var light_dir: SIMD2<Float>  // 48
        var radius: Float            // 56
        var blur: Float              // 60
        var refract_depth: Float     // 64
        var specular: Float          // 68
        var saturation: Float        // 72
        /// ★★★决策 #911：区域背景亮度（0..1；原 `_pad` 闲置槽语义化复用）——浅霜/深霜锚点随它切换。
        var bg_lum: Float            // 76
        // ★★★决策 #905/#906：触控交互（touch 盒局部 px / press 0..1 / effect 0=表面流动 1=内容位移）
        var touch: SIMD2<Float>      // 80
        var press: Float             // 88
        var overlay: Float           // 92 ★#966：shader 读作 `overlay`（选中胶囊叠加层 / 充气门控）
        /// ★★★决策 #1004：**内层/预模糊模式**（0/1 锐背板 · 2 外层预模糊 · 3 内层复合帧；见 glass.wgsl struct）。
        ///   本端当前无离屏复合路径（#979 仅 Android）⇒ 渲染的玻璃均为"外层"语义 ⇒ 传 0（锐背板口径，
        ///   与 iOS `regionLum`/背板捕获链一致）；待 iOS 接离屏复合时改传 2/3。
        var nest: Float              // 96
    }

    /// ★★★决策 #911：玻璃盒区域**平均背景亮度**（0..1）——供 shader 区域级霜锚点（浅霜/深霜）。
    ///   做法：把整幅 backdrop **降采样到 ≤48px** 的小缓冲（一次绘制），再按比例取节点盒覆盖区域求均值。
    ///   ★为何不直取子矩形：CoreGraphics 位图原点在左下，子矩形偏移易错；整图小缩放后按比例取样更稳且同样廉价。
    ///   越界/失败 ⇒ 0（视作深底 ⇒ 锚点高 ⇒ 翻白霜——比"不变"更接近 iOS，且不崩）。
    private func regionLum(backdrop: CGImage, bx: Float, by: Float, bw: Float, bh: Float) -> Float {
        let iw = backdrop.width, ih = backdrop.height
        guard iw > 0, ih > 0 else { return 0 }
        let down = 48
        let sw = min(down, iw), sh = min(down, ih)
        let bpr = sw * 4
        var buf = [UInt8](repeating: 0, count: bpr * sh)
        let cs = CGColorSpaceCreateDeviceRGB()
        let info = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        guard let ctx = CGContext(data: &buf, width: sw, height: sh, bitsPerComponent: 8, bytesPerRow: bpr,
                                  space: cs, bitmapInfo: info) else { return 0 }
        ctx.interpolationQuality = .low
        ctx.draw(backdrop, in: CGRect(x: 0, y: 0, width: sw, height: sh))
        // 节点盒（backdrop 像素坐标）→ 小缓冲坐标（顶左原点；CGContext 位图内存首行=顶行）
        let sx = Float(sw) / Float(iw), sy = Float(sh) / Float(ih)
        // I2-ALLOW: **位图采样区域的像素边界**（非布局几何——背景位图必须整数像素，几何仍走内核吸附值）
        let x0 = max(0, Int(bx * sx)), y0 = max(0, Int(by * sy))
        let x1 = min(sw, Int(ceil((bx + bw) * sx))), y1 = min(sh, Int(ceil((by + bh) * sy)))
        guard x1 > x0, y1 > y0 else { return 0 }
        var sum = 0.0; var n = 0
        for y in y0..<y1 {
            for x in x0..<x1 {
                let o = y * bpr + x * 4
                // premultipliedFirst | byteOrder32Little ⇒ 内存序 B,G,R,A
                sum += (0.114 * Double(buf[o]) + 0.587 * Double(buf[o + 1]) + 0.299 * Double(buf[o + 2])) / 255.0
                n += 1
            }
        }
        return n > 0 ? Float(sum / Double(n)) : 0
    }

    private func makeUniforms(nodeRect: CGRect, outScale: CGFloat, texPxPerPoint: CGFloat,
                              backdrop: CGImage, spec: Spec, cropOrigin: CGPoint,
                              touch: CGPoint?, press: CGFloat) -> GlassUniforms {
        let w = Float(nodeRect.width * outScale)
        let h = Float(nodeRect.height * outScale)
        // 背景纹理 = **cropRect 区域**（决策 #863：非整屏，且可按更低分辨率捕获）；节点 uv → 纹理 uv：
        //   bias = (节点左上 − crop 原点)(纹理px)/纹理宽；scale = 盒尺寸(纹理px)/纹理宽。
        //   ★输出(节点盒)与背景纹理**分辨率解耦**（`texPxPerPoint` ≠ `outScale`）——玻璃被模糊/折射，
        //   背景可按半分辨率采样而不损观感，同时省下捕获栅格化与纹理上传的像素量。
        let tw = Float(backdrop.width)
        let th = Float(backdrop.height)
        let relX = Float((nodeRect.minX - cropOrigin.x) * texPxPerPoint)
        let relY = Float((nodeRect.minY - cropOrigin.y) * texPxPerPoint)
        let bias = SIMD2<Float>(relX / tw, relY / th)
        let tscale = SIMD2<Float>(Float(nodeRect.width * texPxPerPoint) / tw, Float(nodeRect.height * texPxPerPoint) / th)
        // ★★★决策 #911：区域级霜锚点——玻璃盒（含 crop 视角）区域的平均背景亮度。
        let regionL = regionLum(backdrop: backdrop, bx: relX, by: relY,
                                bw: Float(nodeRect.width * texPxPerPoint), bh: Float(nodeRect.height * texPxPerPoint))
        return GlassUniforms(
            tint: SIMD4<Float>(Float(spec.tint.r), Float(spec.tint.g), Float(spec.tint.b), Float(spec.tint.a)),
            size_px: SIMD2<Float>(w, h),
            origin: SIMD2<Float>(0, 0),        // 渲染目标 = 节点盒 ⇒ origin=0
            tex_bias: bias,
            tex_scale: tscale,
            light_dir: SIMD2<Float>(-0.35, -0.94),
            // ★★★决策 #890（G0-B · 端到端）：`radius`/`blur` 都是 **CSS 逻辑 px**（IR 透传，见 `@proteus-vue/glass`
            //   的 `resolveGlass → {blurPx,radiusPx}`，不乘密度；Web 端 `radiusPx → borderRadius:12px` 即逻辑 px）。
            //   本开关的 **输出纹理是半分辨率**（`outScale = scale/2`）⇒ `size_px = nodeRect.width * outScale`
            //   也在半分辨率像素空间 ⇒ 与 `size_px` 同尺度的 `radius`/`blur` **都必须 × outScale**（= 逻辑 × scale/2）。
            //   ★**修正 #864 的单位推断**：其把 `blur` 当"物理 px"直传，实为**逻辑 px**（其夹具 `blur:16` 是 pt/逻辑），
            //     直传 ⇒ 相对半分辨率 `size_px` 偏小 ⇒ iOS 模糊比 Android/鸿蒙偏轻（真机应见"更清脆"而非更糊）；
            //     此处改回 `× outScale` 与 `radius` 同轴，三端同守恒（物理 blur = 逻辑 × 密度）。
            radius: Float(spec.radius * outScale),
            blur: Float(spec.blur * outScale),
            refract_depth: min(w, h) * 0.33,   // ★#910：以 band(=0.33·min) 为基准（与 Android 同守恒）
            // ★★★决策 #908：镜面高光 0.18 → 0.35（**三端同值**：Android GlassMaterial / 鸿蒙 proteus_render
            //   同步）——顶光高光 + 内缘亮线是玻璃"材质身份"的主来源；WGSL 里该项乘 `bevel_mask`（仅外缘带）。
            specular: 0.35,
            saturation: Float(spec.saturation),
            // ★★★决策 #911：区域背景亮度（原 `_pad` 闲置槽语义化复用；零布局变更）——浅霜/深霜锚点随它切换。
            bg_lum: regionL,
            // ★★★决策 #905：触控形变——touch 传入为**盒局部逻辑点**，× outScale 折到半分辨率像素空间
            //   （与 size_px/radius/blur 同轴）；未激活 = (-1e6,-1e6)（着色器钟形因子≈0）。
            touch: SIMD2<Float>(touch.map { Float($0.x * outScale) } ?? -1e6,
                                touch.map { Float($0.y * outScale) } ?? -1e6),
            press: Float(press),
            overlay: Float(spec.overlay),
            nest: 0   // ★#1004：iOS 无离屏复合路径（全为外层语义）⇒ 锐背板口径（见 struct 注释）
        )
    }

    /// ★★★决策 #900：模糊族材质 uniform（`backdropBlur` 等；与 WGSL `BlurUniforms` 逐字段同布局，64B）。
    ///   无折射/高光/圆角（那些是玻璃倒角厚板模型专有）——只有 tint + 盒 + 采样变换 + blur + saturation。
    private struct BlurUniforms {
        var tint: SIMD4<Float>       // 0
        var size_px: SIMD2<Float>    // 16
        var origin: SIMD2<Float>     // 24
        var tex_bias: SIMD2<Float>   // 32
        var tex_scale: SIMD2<Float>  // 40
        var blur: Float              // 48
        var saturation: Float        // 52
        var _pad: SIMD2<Float>       // 56（补到 64）
    }

    private func makeBlurUniforms(nodeRect: CGRect, outScale: CGFloat, texPxPerPoint: CGFloat,
                                  backdrop: CGImage, spec: Spec, cropOrigin: CGPoint) -> BlurUniforms {
        let w = Float(nodeRect.width * outScale)
        let h = Float(nodeRect.height * outScale)
        let tw = Float(backdrop.width)
        let th = Float(backdrop.height)
        let relX = Float((nodeRect.minX - cropOrigin.x) * texPxPerPoint)
        let relY = Float((nodeRect.minY - cropOrigin.y) * texPxPerPoint)
        let bias = SIMD2<Float>(relX / tw, relY / th)
        let tscale = SIMD2<Float>(Float(nodeRect.width * texPxPerPoint) / tw, Float(nodeRect.height * texPxPerPoint) / th)
        return BlurUniforms(
            tint: SIMD4<Float>(Float(spec.tint.r), Float(spec.tint.g), Float(spec.tint.b), Float(spec.tint.a)),
            size_px: SIMD2<Float>(w, h),
            origin: SIMD2<Float>(0, 0),
            tex_bias: bias,
            tex_scale: tscale,
            blur: Float(spec.blur * outScale),   // 与玻璃同守恒（模糊族只消费 blur，非 refract）
            saturation: Float(spec.saturation),
            _pad: SIMD2<Float>(0, 0)
        )
    }

    private func makeTexture(from image: CGImage, device: MTLDevice) -> MTLTexture? {
        let w = image.width, h = image.height
        let bytesPerRow = w * 4
        var bytes = [UInt8](repeating: 0, count: bytesPerRow * h)
        let cs = CGColorSpaceCreateDeviceRGB()
        let info = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        guard let ctx = CGContext(data: &bytes, width: w, height: h, bitsPerComponent: 8, bytesPerRow: bytesPerRow,
                                  space: cs, bitmapInfo: info) else { return nil }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        let desc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: w, height: h, mipmapped: false)
        desc.usage = [.shaderRead]
        desc.storageMode = .shared
        guard let tex = device.makeTexture(descriptor: desc) else { return nil }
        tex.replace(region: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0, withBytes: bytes, bytesPerRow: bytesPerRow)
        return tex
    }
}
