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

    /// 玻璃材质参数（由内核 `style.glass` 折出；与 Android `GlassMaterial.Spec` 同源）。
    struct Spec {
        let blur: CGFloat
        let tint: (r: CGFloat, g: CGFloat, b: CGFloat, a: CGFloat)
        let radius: CGFloat
        let saturation: CGFloat
    }

    private let device: MTLDevice?
    private let commandQueue: MTLCommandQueue?
    private var fragmentPipeline: MTLRenderPipelineState?
    private var loggedCompileFail = false

    private init() {
        device = MTLCreateSystemDefaultDevice()
        commandQueue = device?.makeCommandQueue()
        buildPipeline()
    }

    var isAvailable: Bool { fragmentPipeline != nil }

    /// 编译生成物 MSL（顶点 + 片元）并建管线。
    private func buildPipeline() {
        guard let device = device else {
            NSLog("[proteus-glass] 无 Metal 设备——玻璃走降级")
            return
        }
        do {
            // ★算法来自 Rust 真源落地（GeneratedMaterials.*MSL）——本文件不写着色器。
            let lib = try device.makeLibrary(source: GeneratedMaterials.glassFragmentMSL, options: nil)
            let vlib = try device.makeLibrary(source: GeneratedMaterials.glassVertexMSL, options: nil)
            let vfn = vlib.makeFunction(name: "vs_quad")
            let ffn = lib.makeFunction(name: "fs_glass")
            guard let vfn = vfn, let ffn = ffn else {
                NSLog("[proteus-glass] MSL 入口未找到（vs_quad/fs_glass）——玻璃走降级")
                return
            }
            let desc = MTLRenderPipelineDescriptor()
            desc.vertexFunction = vfn
            desc.fragmentFunction = ffn
            desc.colorAttachments[0].pixelFormat = .bgra8Unorm
            fragmentPipeline = try device.makeRenderPipelineState(descriptor: desc)
            NSLog("[proteus-glass] Metal 管线就绪（真源=WGSL）")
        } catch {
            if !loggedCompileFail {
                loggedCompileFail = true
                NSLog("[proteus-glass] MSL 编译/建管线失败——玻璃走降级：%@", String(describing: error))
            }
        }
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
                     scale: CGFloat, cropOrigin: CGPoint, texPxPerPoint: CGFloat? = nil) -> [CGImage?] {
        let n = requests.count
        guard n > 0 else { return [] }
        let texPx = texPxPerPoint ?? scale
        guard let device = device, let queue = commandQueue, let pipeline = fragmentPipeline else {
            return Array(repeating: nil, count: n)
        }
        // ① 背景纹理（★上传一次，N 块玻璃共用）
        guard let backdropTex = makeTexture(from: backdrop, device: device) else {
            return Array(repeating: nil, count: n)
        }
        var outTexs = [MTLTexture?](repeating: nil, count: n)
        // ② 一条命令缓冲，逐块编码（各自输出纹理；顶点/片元管线同一）
        //   ★I2-ALLOW: 输出**纹理**像素尺寸（位图必须整数像素，非几何吸附；玻璃采样缓冲与内核几何无关）
        guard let cb = queue.makeCommandBuffer() else { return Array(repeating: nil, count: n) }
        for (i, req) in requests.enumerated() {
            let w = Int((req.nodeRect.width * scale).rounded())
            let h = Int((req.nodeRect.height * scale).rounded())
            guard w > 0, h > 0 else { continue }
            let outDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: w, height: h, mipmapped: false)
            outDesc.usage = [.renderTarget, .shaderRead]
            outDesc.storageMode = .shared   // 便于 CPU 读回
            guard let outTex = device.makeTexture(descriptor: outDesc) else { continue }
            var u = makeUniforms(nodeRect: req.nodeRect, outScale: scale, texPxPerPoint: texPx,
                                 backdrop: backdrop, spec: req.spec, cropOrigin: cropOrigin)
            let pass = MTLRenderPassDescriptor()
            pass.colorAttachments[0].texture = outTex
            pass.colorAttachments[0].loadAction = .clear
            pass.colorAttachments[0].storeAction = .store
            pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
            guard let enc = cb.makeRenderCommandEncoder(descriptor: pass) else { continue }
            enc.setRenderPipelineState(pipeline)
            enc.setFragmentTexture(backdropTex, index: 0)
            enc.setFragmentBytes(&u, length: MemoryLayout<GlassUniforms>.stride, index: 0)
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
        var _pad: Float              // 76
    }

    private func makeUniforms(nodeRect: CGRect, outScale: CGFloat, texPxPerPoint: CGFloat,
                              backdrop: CGImage, spec: Spec, cropOrigin: CGPoint) -> GlassUniforms {
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
            refract_depth: min(w, h) * 0.22,   // 与 Android 同守恒
            specular: 0.18,
            saturation: Float(spec.saturation),
            _pad: 0
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
