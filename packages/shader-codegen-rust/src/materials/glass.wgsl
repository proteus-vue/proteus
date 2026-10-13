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
    let hsmin = min(hs.x, hs.y);
    // ★★★决策 #907：折射带 ≈ **条高 1/3**（0.22→0.33，对齐 Apple 实测：倒角带约占条高 1/3）。
    let band = max(hsmin * 0.33, 6.0);
    let e = clamp(d / band, 0.0, 1.0);   // 0=最外缘, 1=内侧（带内）

    // ① 外法线（SDF 梯度；宽 eps 防药丸中轴裂缝）
    let eps = clamp(band * 0.3, 1.0, 16.0);
    let g = vec2<f32>(
        sd_round_rect(p + vec2<f32>(eps, 0.0), hs, r) - sd_round_rect(p - vec2<f32>(eps, 0.0), hs, r),
        sd_round_rect(p + vec2<f32>(0.0, eps), hs, r) - sd_round_rect(p - vec2<f32>(0.0, eps), hs, r));
    let n = g / max(length(g), 1e-5);

    // ② 位移场（透镜弯曲）：**位移横贯整个边缘带**（峰值在外缘、向中心平滑归零，中心平坦）。
    //   ★#907 关键修正：旧式 `bend *= smoothstep(1.0, 0.75, e)`（内缘淡出）把位移**只留在带的外侧一小段**
    //     ⇒ 可见位移仅 ~4px（"液态感消失"的真凶）。Apple 的位移横贯整带（带内到处可见压缩漩涡）。
    //   ⇒ 改用 `prof = 1 - smoothstep(0,1,e)`（带外缘 1 → 带内缘 0，S 形平滑覆盖**整带**，两端 C1）。
    //     位移峰值 = 带宽 × 0.45（与带同尺度 ⇒ 自洽，不再依赖宿主传入的 refract_depth 数值）。
    let ec = clamp(e, 0.004, 0.996);
    let u1 = 1.0 - ec;
    let slope = u1 / sqrt(max(1.0 - u1 * u1, 1e-4));
    let prof = 1.0 - smoothstep(0.0, 1.0, e);   // 横贯整带（外缘 1 → 内缘 0）
    // 峰值位移 = 带宽 × 0.45（自洽：与带同尺度，对齐 Apple「位移横贯整带」）。
    // ★`u.refract_depth` 保留为**强度系数**（宿主传 ≈1 时中性；此处归一化到与带同尺度，向后兼容旧宿主像素值）。
    let strength = clamp(u.refract_depth / max(hsmin * 0.44, 1.0), 0.5, 2.0);
    var bend = prof * band * 0.45 * strength;
    // ★★★决策 #905：**触控形变流动**——触点周围局部凸起（Gaussian 钟），按压力把背后内容沿"离触点方向"推开；
    //   `press==0` ⇒ 该项为 0（退化到既有折射，像素等价）。
    let tR = max(hsmin * 0.9, 8.0);
    let td = local - u.touch;
    let tg = exp(-(dot(td, td)) / (2.0 * tR * tR)) * u.press;   // 0..1 触点钟形（含按压强度）
    let push = max(hsmin * 0.28, 6.0) * tg;                     // 触点处峰位移（px）
    let sp = local + n * bend + normalize(td + vec2<f32>(1e-4, 1e-4)) * push;
    let sp_uv = sp / u.size_px;

    // ③ 模糊按 e 键控（边缘锐、中心糊）；核最大半径 = blur*e*0.55
    // ★决策 #906：**零采样**——不做任何模糊（对齐用户对 iOS 的理解：内容不糊，只磨砂叠加）。
    var acc = sample_backdrop(sp_uv);
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
    // ★★★决策 #907：**自适应霜**（对齐 iOS——玻璃取背景色：深背景→偏深玻璃、亮背景→偏亮玻璃；
    //   **非恒定白霜**。此前 #906 改恒定白 ⇒ 深背景上像贴了张白纸，真机对照 iOS 后纠正）。
    let glass_tint = mix(vec3<f32>(0.18, 0.20, 0.26),   // 暗背景：偏深玻璃（不发白）
                         vec3<f32>(0.97, 0.98, 1.0),    // 亮背景：偏亮（微奶白）
                         adapt);
    col = vec4<f32>(mix(col.rgb, glass_tint, 0.30 + u.tint.a * 0.25), col.a);

    // ⑥ 光照：Fresnel + 法线·光源（双瓣）＋ ★★★决策 #906 **兜底可见性**（对齐 iOS：**纯色/空白背景上玻璃仍可见**）
    //   【缺口】此前玻璃完全依赖"背景内容的折射"⇒ 背景是纯色/空白灰时**玻璃几乎消失**（真机实测，用户点名）。
    //   iOS 兜底 = ① **恒定发丝高光边**（不依赖背景，勾勒轮廓）② 顶边更亮（顶光）③ 整体略亮于背景。
    let cos_i = inverseSqrt(1.0 + slope * slope);
    let f0 = 0.04;
    let fres = f0 + (1.0 - f0) * pow(max(1.0 - cos_i, 0.0), 5.0);
    let facing = max(dot(n, normalize(u.light_dir)), 0.0);
    let bevel_mask = 1.0 - smoothstep(0.0, 0.35, e);   // 亮带仅在外缘
    // 边缘高光：细亮边（各向 0.10）+ 顶光加成（法线朝上侧更亮，对齐 iOS 顶缘高光）
    let top_hi = max(-n.y, 0.0);                        // 上缘（n.y≈-1）
    let edge_hi = bevel_mask * (0.10 + 0.26 * top_hi + 0.16 * facing);
    let rim = (pow(facing, 6.0) * u.specular + fres * 0.20) * bevel_mask + edge_hi + tg * 0.30;   // ★#905：触点点亮
    col = vec4<f32>(min(col.rgb + vec3<f32>(rim), vec3<f32>(1.0)), 1.0);
    return col;
}
