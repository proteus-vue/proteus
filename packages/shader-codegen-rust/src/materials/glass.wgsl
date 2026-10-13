// packages/shader-codegen-rust/src/materials/glass.wgsl
// ★★★液态玻璃材质 —— **框架唯一的算法真源**（决策 #834）。
//
// 【这份 WGSL 是什么】它是「液态玻璃」算法**唯一的一份实现**。各端不再各写一份着色器：
//   由 Rust（naga）把本文件落成 iOS Metal(MSL) 与 Android AGSL（GLSL-ES-3.10 方言）；鸿蒙同源落地。
//   观感 = 依 `GlassSpec`（blur/tint/radius/saturation）+ 本算法。参数由内核 `LStyle.glass` 透传。
//
// 【算法模型（= 决策 #825/#827 的"边缘倒角厚板"）】中心平坦（不折射）、仅最外倒角带折射
//   （沿外法线把边界外内容卷进来）、模糊按离边距离键控（边缘锐/中心糊）、去饱和+磨砂白、Fresnel 高光。
//
// 【接口契约（宿主必须满足）】
//   · **渲染目标 = 节点盒**；片元用 `@builtin(position)` 拿**渲染目标像素坐标** frag.xy，
//     减去 `origin`（节点盒在渲染目标内的左上角）⇒ 盒内像素坐标 local = frag.xy - origin，
//     uv = local / size_px。★这样两端统一：Metal 离屏渲染节点盒（origin=0,0）；AGSL 直接画进主画布
//     （origin=节点在画布中的左上角）——同一份算法、只在 uniform 里换 origin。
//   · 纹理 `backdrop`：节点盒**外扩 padding** 后的背景（供边缘折射采到盒外内容）；
//     `tex_scale`/`tex_bias` 把节点 uv 映射到该纹理 uv：sample_uv = uv * tex_scale + tex_bias。
//   · `size_px`：节点盒在**设备像素**下的尺寸（用于 SDF/模糊的 px 量纲）。
//   · uniform 布局见 src/materials/mod.rs 的 `GlassUniforms`（#[repr(C)]，字节偏移已钉）。
//
// 【★改这里 = 改全端】禁止在任何宿主再手写玻璃着色器（门禁 check:shader-capability 会咬）。

@group(0) @binding(0) var backdrop_tex: texture_2d<f32>;
@group(0) @binding(1) var backdrop_smp: sampler;

struct GlassUniforms {
    tint: vec4<f32>,          // 0  着色 RGBA（内核算好的 #RRGGBBAA 归一）
    size_px: vec2<f32>,       // 16 节点盒尺寸（设备像素）
    origin: vec2<f32>,        // 24 节点盒在渲染目标内的左上角（设备像素；Metal=0，AGSL=c.x/c.y）
    tex_bias: vec2<f32>,      // 32 节点uv→纹理uv 的偏置
    tex_scale: vec2<f32>,     // 40 节点uv→纹理uv 的缩放
    light_dir: vec2<f32>,     // 48 光照方向（归一）
    radius: f32,              // 56 圆角（设备像素）
    blur: f32,                // 60 模糊半径（设备像素）
    refract_depth: f32,       // 64 边缘峰值位移（设备像素）
    specular: f32,            // 68 镜面高光强度
    saturation: f32,          // 72 饱和（1=中性）
    _pad: f32,                // 76 对齐到 16 字节
    // ★★★决策 #905：**触控形变**（对齐 Apple `UIGlassEffect.isInteractive`）——点按/拖动时
    //   玻璃在触点处产生液态流动（局部凸起 + 折射被"推"开 + 触点高光增强），松手回弹。
    touch: vec2<f32>,         // 80 触点在**玻璃盒局部设备像素**（未激活 = (-1e6,-1e6)）
    press: f32,               // 88 按压强度 0..1（host 逐帧 lerp 动画）
    _pad2: f32,               // 92 对齐到 16 字节（结构总长 96）
};
@group(0) @binding(2) var<uniform> u: GlassUniforms;

// 圆角矩形 SDF（真欧氏距离；内部为负）
fn sd_round_rect(p: vec2<f32>, hs: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - hs + vec2<f32>(r, r);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0, 0.0))) - r;
}

// 圆弧倒角映射（Kyant）：x=0 外缘 → 0，x=1 内侧 → 1
fn circle_map(x: f32) -> f32 {
    return 1.0 - sqrt(max(1.0 - x * x, 0.0));
}

// 按节点uv 采样背景（经 tex_scale/tex_bias 映射到纹理uv）
fn sample_backdrop(uv: vec2<f32>) -> vec4<f32> {
    return textureSample(backdrop_tex, backdrop_smp, uv * u.tex_scale + u.tex_bias);
}

@fragment
fn fs_glass(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
    let local = frag.xy - u.origin;      // 盒内像素坐标（origin = 节点盒左上角）
    let hs = u.size_px * 0.5;
    let p = local - hs;
    let r = min(u.radius, min(hs.x, hs.y));
    let sd = sd_round_rect(p, hs, r);
    let d = max(-sd, 0.0);               // 离边深度（内部为正）
    let band = max(min(hs.x, hs.y) * 0.22, 6.0);
    let e = clamp(d / band, 0.0, 1.0);   // 0=最外缘, 1=内侧

    // ① 外法线（SDF 梯度；宽 eps 防药丸中轴裂缝）
    let eps = clamp(band * 0.3, 1.0, 16.0);
    let g = vec2<f32>(
        sd_round_rect(p + vec2<f32>(eps, 0.0), hs, r) - sd_round_rect(p - vec2<f32>(eps, 0.0), hs, r),
        sd_round_rect(p + vec2<f32>(0.0, eps), hs, r) - sd_round_rect(p - vec2<f32>(0.0, eps), hs, r));
    let n = g / max(length(g), 1e-5);

    // ② 倒角斜率（圆弧 h=sqrt(1-(1-e)^2)）→ 位移量（圆心映射 × 峰值；中心 e→1 ⇒ 0）
    let ec = clamp(e, 0.004, 0.996);
    let u1 = 1.0 - ec;
    let slope = u1 / sqrt(max(1.0 - u1 * u1, 1e-4));
    var bend = circle_map(1.0 - ec) * u.refract_depth;
    bend = bend * smoothstep(1.0, 0.75, e);      // 内缘 C1 淡出（防环痕）
    // ★★★决策 #905：**触控形变流动**——触点周围局部凸起（Gaussian 钟），把背后内容沿
    //   "离触点方向"推开（液态被按压的观感）；`press==0` 时 g*press=0 ⇒ 完全退化到既有折射（像素等价）。
    //   R = 盒最小半边的 0.9（触点影响半径），位移量 ∝ refract_depth（与折射同一量纲）。
    let hsmin = min(hs.x, hs.y);
    let tR = max(hsmin * 0.9, 8.0);
    let td = local - u.touch;
    let tg = exp(-(dot(td, td)) / (2.0 * tR * tR)) * u.press;   // 0..1 触点钟形（含按压强度）
    let push = max(hsmin * 0.28, 6.0) * tg;                     // 触点处峰位移（px）
    let sp = local + n * bend + normalize(td + vec2<f32>(1e-4, 1e-4)) * push;
    let sp_uv = sp / u.size_px;

    // ③ 模糊按 e 键控（边缘锐、中心糊）；核最大半径 = blur*e*0.55
    let br = max(u.blur, 0.0) * e * 0.55;
    // 加权高斯近似：中心 1 抽 + 8 方向 × 3 环（权重和 = 1.0）。
    // ★★★**固定 8 次必须展开（不用循环）**：naga 会把 WGSL 循环出成 GLSL `while(true){…}`，
    //   而 **AGSL 不支持 `while`**（只支持 `for`）⇒ 循环会让 Android AGSL 编译失败、玻璃降级。
    //   展开是固定核的标准做法（零分支、各端一致；land/agsl.rs 有"输出不得含 while"的断言）。
    let w1 = 0.058; let w2 = 0.030; let w3 = 0.012;
    var acc = sample_backdrop(sp_uv) * 0.20;
    // 每方向一次（dir 按 k×π/8 预计算为常量；dpx = dir × br）
    { let d = vec2<f32>(br, 0.0);
      acc += sample_backdrop(sp_uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(sp_uv + d / u.size_px) * w2;
      acc += sample_backdrop(sp_uv + (d * 1.6) / u.size_px) * w3; }
    { let d = vec2<f32>(br * 0.70710678, br * 0.70710678);
      acc += sample_backdrop(sp_uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(sp_uv + d / u.size_px) * w2;
      acc += sample_backdrop(sp_uv + (d * 1.6) / u.size_px) * w3; }
    { let d = vec2<f32>(0.0, br);
      acc += sample_backdrop(sp_uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(sp_uv + d / u.size_px) * w2;
      acc += sample_backdrop(sp_uv + (d * 1.6) / u.size_px) * w3; }
    { let d = vec2<f32>(-br * 0.70710678, br * 0.70710678);
      acc += sample_backdrop(sp_uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(sp_uv + d / u.size_px) * w2;
      acc += sample_backdrop(sp_uv + (d * 1.6) / u.size_px) * w3; }
    { let d = vec2<f32>(-br, 0.0);
      acc += sample_backdrop(sp_uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(sp_uv + d / u.size_px) * w2;
      acc += sample_backdrop(sp_uv + (d * 1.6) / u.size_px) * w3; }
    { let d = vec2<f32>(-br * 0.70710678, -br * 0.70710678);
      acc += sample_backdrop(sp_uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(sp_uv + d / u.size_px) * w2;
      acc += sample_backdrop(sp_uv + (d * 1.6) / u.size_px) * w3; }
    { let d = vec2<f32>(0.0, -br);
      acc += sample_backdrop(sp_uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(sp_uv + d / u.size_px) * w2;
      acc += sample_backdrop(sp_uv + (d * 1.6) / u.size_px) * w3; }
    { let d = vec2<f32>(br * 0.70710678, -br * 0.70710678);
      acc += sample_backdrop(sp_uv + (d * 0.5) / u.size_px) * w1;
      acc += sample_backdrop(sp_uv + d / u.size_px) * w2;
      acc += sample_backdrop(sp_uv + (d * 1.6) / u.size_px) * w3; }
    var col = acc;

    // ④ 去饱和（**轻微**：保留背后颜色——对齐 Apple「玻璃取其正后方之色」）+ 饱和旋钮
    //   ★决策 #875：0.30 → 0.12。此前固定 30% 去饱和把背后颜色冲淡成"灰玻璃"，与 Apple 语义相悖。
    let lum = dot(col.rgb, vec3<f32>(0.299, 0.587, 0.114));
    col = vec4<f32>(mix(col.rgb, vec3<f32>(lum), 0.12), col.a);
    col = vec4<f32>(mix(vec3<f32>(lum), col.rgb, u.saturation), col.a);

    // ⑤ tint（作者语义着色，可选）+ ★★**明暗自适应**（决策 #875 · 对齐 Apple Liquid Glass）
    //   【为什么改】Apple：Liquid Glass **无固有颜色**，色取自正后方内容，并**随背景在浅/深之间自适应**。
    //   此前是 `mix(col, vec3(0.99,0.995,1.0), 0.28+tint.a*0.25)`——**恒定掺白**（固有颜色），
    //   在暗背景下发灰白、不符语义。现改为按**背景亮度 lum** 自适应：亮背景→微奶白、暗背景→压深。
    //   ★lum 此处 = 模糊后背景的亮度（正后方内容的代表色），正是"响应背景"的判据。
    col = vec4<f32>(mix(col.rgb, col.rgb * u.tint.rgb * 2.0, u.tint.a), col.a);
    let adapt = smoothstep(0.35, 0.70, lum);            // 0=暗背景 → 1=亮背景
    let glass_tint = mix(vec3<f32>(0.12, 0.13, 0.16),   // 暗背景：压深（近中性深，不发灰白）
                         vec3<f32>(0.99, 0.995, 1.0),    // 亮背景：微奶白（保留原奶白观感）
                         adapt);
    col = vec4<f32>(mix(col.rgb, glass_tint, 0.20 + u.tint.a * 0.25), col.a);

    // ⑥ 光照：Fresnel + 法线·光源（双瓣）；四周对称（无顶部加权）
    let cos_i = inverseSqrt(1.0 + slope * slope);
    let f0 = 0.04;
    let fres = f0 + (1.0 - f0) * pow(max(1.0 - cos_i, 0.0), 5.0);
    let facing = max(dot(n, normalize(u.light_dir)), 0.0);
    let bevel_mask = 1.0 - smoothstep(0.0, 0.35, e);   // 亮带仅在外缘
    let rim = (pow(facing, 6.0) * u.specular + fres * 0.12) * bevel_mask + tg * 0.30;   // ★#905：触点点亮（tg 已含 press）
    col = vec4<f32>(min(col.rgb + vec3<f32>(rim), vec3<f32>(1.0)), 1.0);
    return col;
}
