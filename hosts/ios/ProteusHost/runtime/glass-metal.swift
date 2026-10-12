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
    func renderFace(backdrop: CGImage, nodeRect: CGRect, scale: CGFloat, spec: Spec) -> CGImage? {
        guard let device = device, let queue = commandQueue, let pipeline = fragmentPipeline else { return nil }
        let w = Int((nodeRect.width * scale).rounded())
        let h = Int((nodeRect.height * scale).rounded())
        guard w > 0, h > 0 else { return nil }

        // ① 背景纹理（整屏）。
        guard let backdropTex = makeTexture(from: backdrop, device: device) else { return nil }

        // ② 输出纹理（节点盒）。
        let outDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: w, height: h, mipmapped: false)
        outDesc.usage = [.renderTarget, .shaderRead]
        outDesc.storageMode = .shared   // 便于 CPU 读回
        guard let outTex = device.makeTexture(descriptor: outDesc) else { return nil }

        // ③ uniform（与 Rust `GlassUniforms` 布局逐字段对应；总 80 字节）。
        var u = makeUniforms(nodeRect: nodeRect, scale: scale, backdrop: backdrop, spec: spec)

        // ④ 编码一帧。
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = outTex
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        guard let cb = queue.makeCommandBuffer(), let enc = cb.makeRenderCommandEncoder(descriptor: pass) else { return nil }
        enc.setRenderPipelineState(pipeline)
        enc.setFragmentTexture(backdropTex, index: 0)
        enc.setFragmentBytes(&u, length: MemoryLayout<GlassUniforms>.stride, index: 0)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6)
        enc.endEncoding()
        cb.commit()
        cb.waitUntilCompleted()

        // ⑤ 读回 → CGImage。
        let bytesPerRow = w * 4
        var bytes = [UInt8](repeating: 0, count: bytesPerRow * h)
        outTex.getBytes(&bytes, bytesPerRow: bytesPerRow, from: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0)
        guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { return nil }
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        // bgra8Unorm ⇒ little-endian: BGRA in memory = .byteOrder32Little | .premultipliedFirst
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

    private func makeUniforms(nodeRect: CGRect, scale: CGFloat, backdrop: CGImage, spec: Spec) -> GlassUniforms {
        let w = Float(nodeRect.width * scale)
        let h = Float(nodeRect.height * scale)
        // 背景纹理 = 整屏（像素）；节点 uv → 纹理 uv：bias = 节点左上角(px)/整屏(px)，scale = 盒尺寸/整屏。
        let tw = Float(backdrop.width)
        let th = Float(backdrop.height)
        let bias = SIMD2<Float>(Float(nodeRect.minX * scale) / tw, Float(nodeRect.minY * scale) / th)
        let tscale = SIMD2<Float>(w / tw, h / th)
        return GlassUniforms(
            tint: SIMD4<Float>(Float(spec.tint.r), Float(spec.tint.g), Float(spec.tint.b), Float(spec.tint.a)),
            size_px: SIMD2<Float>(w, h),
            origin: SIMD2<Float>(0, 0),        // 渲染目标 = 节点盒 ⇒ origin=0
            tex_bias: bias,
            tex_scale: tscale,
            light_dir: SIMD2<Float>(-0.35, -0.94),
            radius: Float(spec.radius * scale),
            blur: Float(spec.blur * scale),
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
