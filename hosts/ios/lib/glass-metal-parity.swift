// hosts/ios/lib/glass-metal-parity.swift
// ★★★玻璃像素等价门禁 · Metal 侧（决策 #834 · B6）
//
// 读 `$work/spec.json`（backdrop + params + out），用**生成物 MSL**（glass.frag.metal / glass.vert.metal）
// 建管线、离屏渲染一块玻璃面，写 `$work/gpu.json`（与 Rust oracle 同格式）。
//
// 用法：xcrun -sdk macosx swift glass-metal-parity.swift <workDir>
import Foundation
import Metal
import CoreGraphics

let args = CommandLine.arguments
guard args.count >= 2 else { FileHandle.standardError.write("用法：... <workDir>\n".data(using: .utf8)!); exit(2) }
let work = args[1]

func readJSON(_ p: String) -> [String: Any] {
    guard let d = FileManager.default.contents(atPath: p), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else {
        FileHandle.standardError.write("读 JSON 失败：\(p)\n".data(using: .utf8)!); exit(3)
    }
    return o
}
let spec = readJSON("\(work)/spec.json")
let bd = spec["backdrop"] as! [String: Any]
let bw = bd["width"] as! Int, bh = bd["height"] as! Int
let brgba = (bd["rgba"] as! [NSNumber]).map { UInt8(truncating: $0) }
let p = spec["params"] as! [String: Any]
func fv(_ a: [String: Any], _ k: String, _ d: Float) -> Float { (a[k] as? NSNumber)?.floatValue ?? d }
func fa(_ v: Any?) -> [Float] { (v as? [NSNumber])?.map { $0.floatValue } ?? [] }
let sizePx = fa(p["size_px"]); let tint = fa(p["tint"]); let light = fa(p["light_dir"])
let pad = fv(p, "pad", 24), radius = fv(p, "radius", 0), blur = fv(p, "blur", 0)
let refract = fv(p, "refract_depth", 0), specular = fv(p, "specular", 0.18), sat = fv(p, "saturation", 1)
let bgLum = fv(p, "bg_lum", 0)   // ★#911：区域背景亮度（浅霜/深霜锚点）
let outSpec = spec["out"] as! [String: Any]
let ow = outSpec["width"] as! Int, oh = outSpec["height"] as! Int

guard let device = MTLCreateSystemDefaultDevice() else { FileHandle.standardError.write("no metal device\n".data(using: .utf8)!); exit(4) }
let fragSrc = try! String(contentsOfFile: "\(work)/glass.frag.metal", encoding: .utf8)
let vertSrc = try! String(contentsOfFile: "\(work)/glass.vert.metal", encoding: .utf8)
let flib = try! device.makeLibrary(source: fragSrc, options: nil)
let vlib = try! device.makeLibrary(source: vertSrc, options: nil)
let vfn = vlib.makeFunction(name: "vs_quad")!
let ffn = flib.makeFunction(name: "fs_glass")!
let desc = MTLRenderPipelineDescriptor()
desc.vertexFunction = vfn; desc.fragmentFunction = ffn
desc.colorAttachments[0].pixelFormat = .bgra8Unorm
let pipeline = try! device.makeRenderPipelineState(descriptor: desc)
let queue = device.makeCommandQueue()!

// backdrop 纹理（bgra8Unorm；输入是 rgbA 行主序）
var bdBytes = [UInt8](repeating: 0, count: bw * bh * 4)
for i in 0..<(bw * bh) { bdBytes[i*4+0] = brgba[i*4+2]; bdBytes[i*4+1] = brgba[i*4+1]; bdBytes[i*4+2] = brgba[i*4+0]; bdBytes[i*4+3] = brgba[i*4+3] } // RGBA→BGRA
let bdDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: bw, height: bh, mipmapped: false)
bdDesc.usage = [.shaderRead]; bdDesc.storageMode = .shared
let bdTex = device.makeTexture(descriptor: bdDesc)!
bdTex.replace(region: MTLRegionMake2D(0,0,bw,bh), mipmapLevel: 0, withBytes: bdBytes, bytesPerRow: bw*4)

let oDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: ow, height: oh, mipmapped: false)
oDesc.usage = [.renderTarget, .shaderRead]; oDesc.storageMode = .shared
let oTex = device.makeTexture(descriptor: oDesc)!

// uniform（与 WGSL GlassUniforms 逐字段同布局）
struct U {
    var tint: SIMD4<Float>; var size_px: SIMD2<Float>; var origin: SIMD2<Float>
    var tex_bias: SIMD2<Float>; var tex_scale: SIMD2<Float>; var light_dir: SIMD2<Float>
    var radius: Float; var blur: Float; var refract_depth: Float; var specular: Float; var saturation: Float; var bg_lum: Float
}
let tw = Float(bw), th = Float(bh)
var u = U(
    tint: SIMD4<Float>(tint.count>0 ? tint[0] : 1, tint.count>1 ? tint[1] : 1, tint.count>2 ? tint[2] : 1, tint.count>3 ? tint[3] : 0),
    size_px: SIMD2<Float>(sizePx.count>0 ? sizePx[0] : Float(ow), sizePx.count>1 ? sizePx[1] : Float(oh)),
    origin: SIMD2<Float>(0, 0),
    tex_bias: SIMD2<Float>(Float(pad) / tw, Float(pad) / th),
    tex_scale: SIMD2<Float>(Float(ow) / tw, Float(oh) / th),
    light_dir: SIMD2<Float>(light.count>0 ? light[0] : -0.35, light.count>1 ? light[1] : -0.94),
    radius: radius, blur: blur, refract_depth: refract, specular: specular, saturation: sat, bg_lum: bgLum)

let pass = MTLRenderPassDescriptor()
pass.colorAttachments[0].texture = oTex
pass.colorAttachments[0].loadAction = .clear
pass.colorAttachments[0].storeAction = .store
pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
let cb = queue.makeCommandBuffer()!
let enc = cb.makeRenderCommandEncoder(descriptor: pass)!
enc.setRenderPipelineState(pipeline)
enc.setFragmentTexture(bdTex, index: 0)
// ★★★决策 #910（报告 P2-1）：显式绑定采样器——此前未绑 ⇒ MSL 的 `sampler` 处于未定义状态，
//   与 Rust oracle 的线性采样只**碰巧**接近；显式 LINEAR+CLAMP 才是三端同口径（也让它与真机一致）。
let sd = MTLSamplerDescriptor()
sd.minFilter = .linear; sd.magFilter = .linear; sd.mipFilter = .notMipmapped
sd.sAddressMode = .clampToEdge; sd.tAddressMode = .clampToEdge
enc.setFragmentSamplerState(device.makeSamplerState(descriptor: sd)!, index: 0)
enc.setFragmentBytes(&u, length: MemoryLayout<U>.stride, index: 0)
enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6)
enc.endEncoding(); cb.commit(); cb.waitUntilCompleted()

var bytes = [UInt8](repeating: 0, count: ow*oh*4)
oTex.getBytes(&bytes, bytesPerRow: ow*4, from: MTLRegionMake2D(0,0,ow,oh), mipmapLevel: 0)
// BGRA→RGBA
var rgba = [Int](repeating: 0, count: ow*oh*4)
for i in 0..<(ow*oh) { rgba[i*4+0] = Int(bytes[i*4+2]); rgba[i*4+1] = Int(bytes[i*4+1]); rgba[i*4+2] = Int(bytes[i*4+0]); rgba[i*4+3] = Int(bytes[i*4+3]) }
let out: [String: Any] = ["width": ow, "height": oh, "rgba": rgba]
let data = try! JSONSerialization.data(withJSONObject: out, options: [])
try! data.write(to: URL(fileURLWithPath: "\(work)/gpu.json"))
FileHandle.standardOutput.write("  Metal 渲染完成：\(ow)x\(oh)\n".data(using: .utf8)!)
