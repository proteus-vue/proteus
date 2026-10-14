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
    // ★★★决策 #911：**区域背景亮度**（0..1）——宿主统计玻璃盒（含 pad）区域的**平均亮度**。
    //   【为什么需要（对齐 iOS `.regular`）】iOS「each layer continuously adapts based on what's behind it」/
    //   「flip from light to dark based on the background」⇒ 玻璃的**明暗基调随整块背景切换**（浅霜/深霜），
    //   而非只与"该像素正后方"有关（那是 #908/#910 的逐像素形态，缺"区域"这一级）。
    //   ★**零布局变更**：本槽原为 `_pad`（闲置对齐填充，三端都设 0）⇒ 直接语义化复用，结构仍 96B。
    bg_lum: f32,              // 76 区域背景亮度（0..1；宿主统计；缺省 0 = 视作深底）
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
    let smin = min(u.size_px.x, u.size_px.y);   // 最短**边**（= 2×hsmin）
    // ★★★决策 #907/#910：折射带 ≈ **最短边 1/3**（= 条高 1/3）。
    //   ★#910 修正口径（报告 G3）：原 `hsmin*0.33 = 0.165·min` 实为**最短边的 1/6**（注释称"1/3"、
    //   代码只有一半 ⇒ 带宽被砍半 ⇒ 真机"折射区比 iOS 少很多"）。改 `0.33·min` ⇒ 带宽 **×2**，与注释/iOS 实测一致。
    let band = max(smin * 0.30, 6.0);
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
    // ★★★决策 #910/#912/#914 · 位移峰值系数 `EDGE_REFRACT`（**方向已冻结，只调幅度**）
    //   【#914 用户真机】「iOS 的折射只有**平面变化**，我们的明显**文字有 y 轴拉伸**」——取证（oracle 细线探针）：
    //     位移机制（沿外法线向外采样 ⇒ 边缘带内容被压缩/弯折）**方向正确**；问题是**幅度**：`0.55·band`
    //     = 0.55×67 物理px ≈ **37px ≈ 半个字高** ⇒ 整带沿法线大幅平移 ⇒ 读作"竖向拉伸"（内容被非均匀挤压）。
    //   ⇒ 幅度降到 **0.15·band**（≈10 物理px ≈ 3 逻辑px）：线间距接近均匀（仅边缘轻微弯折，对齐 iOS"平面变化"）。
    //   ★这是**定稿方向**（不再漂移）：机制=法线方向向外采样（单调、不折叠）+ 小幅度（平面式轻弯折）。
    //   A 分解：`EDGE_REFRACT`（幅度）· `strength`（宿主 refract_depth 旋钮，1.0 中性）。
    let EDGE_REFRACT = 0.10;   // ★#916 定稿：位移极小（滚动拖影的数学根因是高幅度位移）
    let strength = clamp(u.refract_depth / max(band, 1.0), 0.2, 1.1);
    var bend = prof * band * EDGE_REFRACT * strength;
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
    //   ★tint（作者语义着色，可选）作用于采样色（守 #875「无固有颜色」——tint 是作者显式指定的例外）。
    col = vec4<f32>(mix(col.rgb, col.rgb * u.tint.rgb * 2.0, u.tint.a), col.a);

    // ⑤ ★★★决策 #913：**霜层（surface veil）**——修正 #910/#911 的**机制错误**。
    //   【用户原话】「深霜浅霜不是对玻璃下面的内容吧？是对玻璃**表面**做的处理吧？我们的玻璃表面没任何处理，
    //     非常通透，没有 iOS 那种整体浅霜/暗霜」——**判断正确**。
    //   【为何改机制】#910/#911 用 `col += (FROST_L − lum)·k`：这是对**玻璃下内容**的**亮度平移**（保对比 ⇒
    //     读作"透明玻璃 + 亮度偏置"），**不是**霜层。真 iOS 是**表面霜/纱**：`mix(内容色, 霜色, α)`——
    //     整面朝一个霜色靠拢（**降对比** ⇒ 乳白/灰纱的"整体霜"感）。
    //   【方向 = 翻转（对齐 HIG "flip from light to dark based on the background"）】两张 iOS 真机实测：
    //     深底(L79) ⇒ 玻璃 L215（**厚·亮霜**）；浅底(L254) ⇒ 玻璃 L229（**薄·暗霜**，略暗于背景）。⇒ 霜色与
    //     厚度都随区域背景 `u.bg_lum` **翻转**（不是"提亮 vs 不变"）。
    let frost_t = smoothstep(0.30, 0.90, u.bg_lum);
    let frost_col = mix(vec3<f32>(0.93), vec3<f32>(0.62), frost_t);   // 深底→亮霜 / 亮底→暗霜
    let frost_a = mix(0.85, 0.40, frost_t);                          // 深底厚 / 亮底薄
    col = vec4<f32>(mix(col.rgb, frost_col, frost_a), col.a);

    // ⑥ 光照：Fresnel + 法线·光源（双瓣）＋ ★★★决策 #906 **兜底可见性**（对齐 iOS：**纯色/空白背景上玻璃仍可见**）
    //   【缺口】此前玻璃完全依赖"背景内容的折射"⇒ 背景是纯色/空白灰时**玻璃几乎消失**（真机实测，用户点名）。
    //   iOS 兜底 = ① **恒定发丝高光边**（不依赖背景，勾勒轮廓）② 顶边更亮（顶光）③ 整体略亮于背景。
    let cos_i = inverseSqrt(1.0 + slope * slope);
    let f0 = 0.04;
    let fres = f0 + (1.0 - f0) * pow(max(1.0 - cos_i, 0.0), 5.0);
    let facing = max(dot(n, normalize(u.light_dir)), 0.0);
    let bevel_mask = 1.0 - smoothstep(0.0, 0.10, e);   // ★#915：0.35→0.10（细亮线，对齐 iOS ~2px；旧值=23px 宽渐变="厚玻璃感"）
    // 边缘高光：细亮边（各向 0.10）+ 顶光加成（法线朝上侧更亮，对齐 iOS 顶缘高光）
    let top_hi = max(-n.y, 0.0);                        // 上缘（n.y≈-1）
    let edge_hi = bevel_mask * (0.10 + 0.26 * top_hi + 0.16 * facing);
    // ★★★决策 #915 · **删除 `edge_pol`（"自适应描边极性"）**——用户实测「边缘随背景发亮发暗，不对」。
    //   取证：iOS 边缘是 **specular 高光（恒亮）**，**不随背景翻转**。旧 `edge_pol`（#910 引入）让亮底边缘**减暗**
    //   ⇒ 既非 iOS，又让"文字经过边缘变亮"（宽带时更糟）。⇒ 缘带收窄到 0.10 后**恒定加亮**（恢复 iOS 语义）。
    let rim = (pow(facing, 6.0) * u.specular + fres * 0.20) * bevel_mask + edge_hi + tg * 0.30;   // ★#905：触点点亮
    col = vec4<f32>(clamp(col.rgb + vec3<f32>(rim), vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
    return col;
}
