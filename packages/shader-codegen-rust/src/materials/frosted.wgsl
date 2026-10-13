// packages/shader-codegen-rust/src/materials/frosted.wgsl
// ★★★磨砂材质（frosted）——**模糊 + 颗粒噪点**（决策 #900）。
//
// 【它是什么】在 backdropBlur（纯模糊）之上叠一层**程序化颗粒**——模拟物理磨砂玻璃的细砂质感。
//   只模糊 + 颗粒 + tint，**不做边缘折射**（与 backdropBlur 同族）。适合"磨砂面板/毛玻璃卡片"。
//
// 【与 backdropBlur 的关系】同骨架、**同 uniform 布局**（`BlurUniforms`，64B）⇒ 宿主按 uniformStruct
//   分派时**复用同一 builder**（加本材质 = 零改宿主）。差异仅在片元尾部的**颗粒叠层**。
//
// 【接口契约】与 glass/backdropBlur 同（@builtin(position) 减 origin；size_px/tex_scale/tex_bias 同义）。
// 【★改这里 = 改全端】禁止宿主手写（check:shader-capability 会咬）。

@group(0) @binding(0) var backdrop_tex: texture_2d<f32>;
@group(0) @binding(1) var backdrop_smp: sampler;

struct BlurUniforms {
    tint: vec4<f32>,          // 0  着色 RGBA
    size_px: vec2<f32>,       // 16 节点盒尺寸（设备像素）
    origin: vec2<f32>,        // 24 节点盒左上角（设备像素）
    tex_bias: vec2<f32>,      // 32
    tex_scale: vec2<f32>,     // 40
    blur: f32,                // 48 模糊半径（设备像素）
    saturation: f32,          // 52 饱和（1=中性）
    _pad: vec2<f32>,          // 56 对齐到 16 字节（总长 64）
};
@group(0) @binding(2) var<uniform> u: BlurUniforms;

fn sample_backdrop(uv: vec2<f32>) -> vec4<f32> {
    return textureSample(backdrop_tex, backdrop_smp, uv * u.tex_scale + u.tex_bias);
}

/// 伪随机（坐标 → 0..1）——程序化颗粒种子。无循环（AGSL 无 while）。
fn hash21(p: vec2<f32>) -> f32 {
    var q = fract(p * vec2<f32>(123.34, 456.21));
    q = q + vec2<f32>(dot(q, q + 45.32));
    return fract(q.x * q.y);
}

@fragment
fn fs_frosted(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
    let local = frag.xy - u.origin;
    let uv = local / u.size_px;
    // 加权高斯近似（8 方向 × 3 环；与 glass/backdropBlur 同一核——跨端一致）。固定展开，无循环。
    let br = max(u.blur, 0.0);
    let w1 = 0.058; let w2 = 0.030; let w3 = 0.012;
    var acc = sample_backdrop(uv) * 0.20;
    { let d = vec2<f32>(br, 0.0);
      acc += sample_backdrop(uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(uv + d / u.size_px) * w2;
      acc += sample_backdrop(uv + (d * 1.6) / u.size_px) * w3; }
    { let d = vec2<f32>(br * 0.70710678, br * 0.70710678);
      acc += sample_backdrop(uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(uv + d / u.size_px) * w2;
      acc += sample_backdrop(uv + (d * 1.6) / u.size_px) * w3; }
    { let d = vec2<f32>(0.0, br);
      acc += sample_backdrop(uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(uv + d / u.size_px) * w2;
      acc += sample_backdrop(uv + (d * 1.6) / u.size_px) * w3; }
    { let d = vec2<f32>(-br * 0.70710678, br * 0.70710678);
      acc += sample_backdrop(uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(uv + d / u.size_px) * w2;
      acc += sample_backdrop(uv + (d * 1.6) / u.size_px) * w3; }
    { let d = vec2<f32>(-br, 0.0);
      acc += sample_backdrop(uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(uv + d / u.size_px) * w2;
      acc += sample_backdrop(uv + (d * 1.6) / u.size_px) * w3; }
    { let d = vec2<f32>(-br * 0.70710678, -br * 0.70710678);
      acc += sample_backdrop(uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(uv + d / u.size_px) * w2;
      acc += sample_backdrop(uv + (d * 1.6) / u.size_px) * w3; }
    { let d = vec2<f32>(0.0, -br);
      acc += sample_backdrop(uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(uv + d / u.size_px) * w2;
      acc += sample_backdrop(uv + (d * 1.6) / u.size_px) * w3; }
    { let d = vec2<f32>(br * 0.70710678, -br * 0.70710678);
      acc += sample_backdrop(uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(uv + d / u.size_px) * w2;
      acc += sample_backdrop(uv + (d * 1.6) / u.size_px) * w3; }
    var col = acc;
    // 去饱和 + tint（与 glass/backdropBlur 同式）
    let lum = dot(col.rgb, vec3<f32>(0.299, 0.587, 0.114));
    col = vec4<f32>(mix(vec3<f32>(lum), col.rgb, u.saturation), col.a);
    col = vec4<f32>(mix(col.rgb, col.rgb * u.tint.rgb * 2.0, u.tint.a), col.a);
    // ★颗粒噪点：程序化 hash（坐标 → 0..1）→ 以 ±0.04 叠到亮度（磨砂细砂质感）。
    //   固定强度常量（不新增 uniform ⇒ 复用 BlurUniforms 布局、宿主零改）。
    let grain = (hash21(frag.xy) - 0.5) * 0.08;
    col = vec4<f32>(clamp(col.rgb + vec3<f32>(grain), vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
    return col;
}
