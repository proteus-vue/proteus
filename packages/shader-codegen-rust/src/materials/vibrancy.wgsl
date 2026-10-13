// packages/shader-codegen-rust/src/materials/vibrancy.wgsl
// ★★★通透材质（vibrancy）——**模糊 + 大幅提饱和**（决策 #900）。
//
// 【它是什么】在 backdropBlur 之上**显著提升背后内容饱和度**——让透过的色彩更"活"（对齐 iOS 的
//   `.systemMaterial` 那类"通透有颜色"的观感）。只模糊 + 提彩 + 极轻 tint，**不做边缘折射**。
//
// 【与 backdropBlur 的关系】同骨架、**同 uniform 布局**（`BlurUniforms`，64B）⇒ 宿主零改。
//   差异仅在片元尾部：**饱和放大 ~2.5×** + tint 影响减弱（让背后颜色主导）。
//
// 【接口契约】与 glass/backdropBlur 同。**★改这里 = 改全端**（check:shader-capability 会咬）。

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

@fragment
fn fs_vibrancy(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
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
    // ★通透：**饱和放大 ~2.5×**（u.saturation 通常 1.0 ⇒ 实际 2.5；更高饱和 = 背后颜色更"活"）。
    let lum = dot(col.rgb, vec3<f32>(0.299, 0.587, 0.114));
    col = vec4<f32>(mix(vec3<f32>(lum), col.rgb, u.saturation * 2.5), col.a);
    // tint 影响减半（让背后颜色主导，材质本身少加色）
    col = vec4<f32>(mix(col.rgb, col.rgb * u.tint.rgb * 2.0, u.tint.a * 0.5), col.a);
    col = vec4<f32>(clamp(col.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
    return col;
}
