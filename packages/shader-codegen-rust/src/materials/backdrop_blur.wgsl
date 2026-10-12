// packages/shader-codegen-rust/src/materials/backdrop_blur.wgsl
// ★★★背板模糊材质（backdropBlur）——**玻璃的基座**（只模糊 + tint，无折射/高光）。
//
// 【它是什么】一块"毛玻璃"：把背后内容按 blur 做高斯近似模糊 + tint 着色 + 轻微去饱和/白蒙；
//   不做边缘折射（那是 glass 的倒角厚板模型）。**glass = backdropBlur + 折射/高光**同一套采样。
//
// 【接口契约】与 glass 同：`@builtin(position)` 取渲染目标像素坐标，减去 `origin` 得盒内坐标；
//   `size_px`/`tex_scale`/`tex_bias` 同义（见 glass.wgsl）。uniform 布局见 src/materials/mod.rs。
//
// 【★改这里 = 改全端】禁止在任何宿主再手写模糊着色器（check:shader-capability 会咬）。

@group(0) @binding(0) var backdrop_tex: texture_2d<f32>;
@group(0) @binding(1) var backdrop_smp: sampler;

struct BlurUniforms {
    tint: vec4<f32>,          // 0  着色 RGBA
    size_px: vec2<f32>,       // 16 节点盒尺寸（设备像素）
    origin: vec2<f32>,        // 24 节点盒左上角（设备像素）
    tex_bias: vec2<f32>,      // 32 节点uv→纹理uv 偏置
    tex_scale: vec2<f32>,     // 40 节点uv→纹理uv 缩放
    blur: f32,                // 48 模糊半径（设备像素）
    saturation: f32,          // 52 饱和（1=中性）
    _pad: vec2<f32>,          // 56 对齐到 16 字节（总长 64）
};
@group(0) @binding(2) var<uniform> u: BlurUniforms;

fn sample_backdrop(uv: vec2<f32>) -> vec4<f32> {
    return textureSample(backdrop_tex, backdrop_smp, uv * u.tex_scale + u.tex_bias);
}

@fragment
fn fs_backdrop_blur(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
    let local = frag.xy - u.origin;
    let uv = local / u.size_px;
    // 加权高斯近似（8 方向 × 3 环；权重和 = 1.0）——与 glass 同一核（跨端一致）
    let br = max(u.blur, 0.0);
    var acc = sample_backdrop(uv) * 0.20;
    let w1 = 0.058; let w2 = 0.030; let w3 = 0.012;
    var k = 0;
    loop {
        if k >= 8 { break; }
        let a = f32(k) * 0.7853981;
        let dir = vec2<f32>(cos(a), sin(a));
        let dpx = dir * br;
        acc += sample_backdrop(uv + (dpx * 0.5) / u.size_px) * w1;
        acc += sample_backdrop(uv + dpx / u.size_px) * w2;
        acc += sample_backdrop(uv + (dpx * 1.6) / u.size_px) * w3;
        k = k + 1;
    }
    var col = acc;
    // 去饱和 + tint（与 glass 同式）
    let lum = dot(col.rgb, vec3<f32>(0.299, 0.587, 0.114));
    col = vec4<f32>(mix(vec3<f32>(lum), col.rgb, u.saturation), col.a);
    col = vec4<f32>(mix(col.rgb, col.rgb * u.tint.rgb * 2.0, u.tint.a), col.a);
    col = vec4<f32>(col.rgb, 1.0);
    return col;
}
