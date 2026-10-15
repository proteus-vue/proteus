// packages/shader-codegen-rust/src/reference.rs
// ★★★CPU 参考实现（conformance 金标准 oracle · 决策 #834）——玻璃算法的**逐像素等价基准**。
//
// 【它为什么存在（OS 级一致性的机器判据）】新架构下"算法真源"在 WGSL，各端 GPU 落地。
//   但"落地对不对"不能靠肉眼——需要一个**与 GPU 无关**的参考实现：同一 backdrop + 同一 spec，
//   在 CPU 上按同一算法算出结果像素；设备 GPU 输出与之在容差内相等 ⇒ 落地正确（像素等价门禁）。
//   ★本文件是**算法的第二份实现**——但它不是"各端手写"那种漂移源：① 它只服务测试/门禁，不进产物；
//     ② 它与 WGSL 的等价性由本 crate 的单测锁定（改算法两边一起改，单测会红）。
//
// 【契约】`render(backdrop, w, h, spec) -> Vec<[f32;4]>`：backdrop 为 (w+2p)×(h+2p) 的 RGBA 背景
//   （外扩 pad 像素），返回 h×w 的玻璃结果（行主序，左上原点）。

/// 玻璃材质参数（与 WGSL uniform 对应）。
#[derive(Clone, Copy, Debug)]
pub struct GlassParams {
    pub size_px: (f32, f32),
    pub pad: f32,          // backdrop 外扩像素
    pub radius: f32,
    pub blur: f32,
    pub refract_depth: f32,
    pub specular: f32,
    pub saturation: f32,
    pub tint: [f32; 4],    // r,g,b,a ∈ [0,1]
    pub light_dir: (f32, f32),
    /// ★★★决策 #911：区域背景亮度（0..1）——宿主统计玻璃盒区域均值（浅霜/深霜锚点随它切换）。
    pub bg_lum: f32,
    /// ★#952：选中胶囊叠加层强度（0=无 / 1=叠半透明中性色 light→灰·dark→亮；不动面纱 α）。
    pub overlay: f32,
    /// ★#963：按下强度 0..1（选中胶囊/条的「点亮透镜」亮边；触点 glass.wgsl 同源）。缺省 0。
    pub press: f32,
    /// ★#966：触点在**盒局部设备像素**（未激活 = (-1e6,-1e6)）；与 glass.wgsl `touch` 同源。
    pub touch: (f32, f32),
}

impl Default for GlassParams {
    fn default() -> Self {
        Self {
            size_px: (130.0, 130.0),
            pad: 24.0,
            radius: 65.0,
            blur: 48.0,
            refract_depth: 28.6,
            specular: 0.18,
            saturation: 1.0,
            tint: [1.0, 1.0, 1.0, 0.149],
            light_dir: (-0.35, -0.94),
            bg_lum: 0.0,
            overlay: 0.0,
            press: 0.0,
            touch: (-1.0e6, -1.0e6),
        }
    }
}

// 简单线性采样器（与 GPU bilinear 近似——测试用小步长/整数采样，避免插值差异主导）
struct Backdrop<'a> {
    px: &'a [[f32; 4]],
    w: usize,
    h: usize,
}

impl<'a> Backdrop<'a> {
    fn sample(&self, u: f32, v: f32) -> [f32; 4] {
        // ★半纹素偏移（与 GPU 一致）：归一化 uv 的 texel 中心在 (i+0.5)/N ⇒ 位置 = u*N - 0.5。
        let x = (u * self.w as f32 - 0.5).clamp(0.0, (self.w - 1) as f32);
        let y = (v * self.h as f32 - 0.5).clamp(0.0, (self.h - 1) as f32);
        let xi = x.floor() as usize;
        let yi = y.floor() as usize;
        let xi1 = (xi + 1).min(self.w - 1);
        let yi1 = (yi + 1).min(self.h - 1);
        let fx = x - xi as f32;
        let fy = y - yi as f32;
        let mut out = [0.0f32; 4];
        for c in 0..4 {
            let a = self.px[yi * self.w + xi][c];
            let b = self.px[yi * self.w + xi1][c];
            let d = self.px[yi1 * self.w + xi][c];
            let e = self.px[yi1 * self.w + xi1][c];
            let top = a + (b - a) * fx;
            let bot = d + (e - d) * fx;
            out[c] = top + (bot - top) * fy;
        }
        out
    }
}

fn sd_round_rect(p: (f32, f32), hs: (f32, f32), r: f32) -> f32 {
    let qx = p.0.abs() - hs.0 + r;
    let qy = p.1.abs() - hs.1 + r;
    let mx = qx.max(qy).min(0.0);
    let ox = qx.max(0.0);
    let oy = qy.max(0.0);
    mx + (ox * ox + oy * oy).sqrt() - r
}

fn circle_map(x: f32) -> f32 {
    1.0 - (1.0 - x * x).max(0.0).sqrt()
}

fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// 单像素玻璃计算（与 glass.wgsl 的 fs_glass 逐步对应）。
fn shade(backdrop: &Backdrop, local: (f32, f32), p: &GlassParams) -> [f32; 4] {
    let hs = (p.size_px.0 * 0.5, p.size_px.1 * 0.5);
    let pc = (local.0 - hs.0, local.1 - hs.1);
    let r = p.radius.min(hs.0.min(hs.1));
    let hsmin = hs.0.min(hs.1);
    // ★#971：SDF 恒为（当前盒的）圆角矩形——形状变化全在宿主盒几何，shader 不做轮廓形变。
    let sd = sd_round_rect(pc, hs, r);
    let d = (-sd).max(0.0);
    let smin = p.size_px.0.min(p.size_px.1);   // 最短边（= 2×hsmin）
    // ★决策 #907/#910：折射带 = **最短边 1/3**（#910 修正口径：原 `hsmin*0.33 = 0.165·min` 只有 1/6 ⇒ ×2）
    let band = (smin * 0.28).max(6.0);   // ★#995：0.20→0.28（窄强圈 + prof 中腹基线）
    let e = (d / band).clamp(0.0, 1.0);

    let eps = (band * 0.3).clamp(1.0, 16.0);
    // ★#968：法线取**原轮廓**梯度（充气不改法线 ⇒ 内容不挤压）。
    let gx = sd_round_rect((pc.0 + eps, pc.1), hs, r) - sd_round_rect((pc.0 - eps, pc.1), hs, r);
    let gy = sd_round_rect((pc.0, pc.1 + eps), hs, r) - sd_round_rect((pc.0, pc.1 - eps), hs, r);
    let glen = (gx * gx + gy * gy).sqrt().max(1e-5);
    let n = (gx / glen, gy / glen);

    let ec = e.clamp(0.004, 0.996);
    let u1 = 1.0 - ec;
    let slope = u1 / (1.0 - u1 * u1).max(1e-4).sqrt();
    // ★决策 #910/#912/#914：位移横贯整带；幅度系数 **0.15**（#914 定稿——消"y 轴拉伸"，对齐 iOS"平面变化"
    //   式轻弯折；机制 = 法线方向向外采样，单调不折叠）。refract_depth 以 band 为基准（1.0 中性）。
    let prof = 1.0 - smoothstep(0.0, 1.0, e);   // ★#997：去中腹基线（中腹=1:1 文字不动）
    let strength = (p.refract_depth / band.max(1.0)).clamp(0.2, 1.1);
    let bend = prof * band * 0.30 * strength;   // ★#994：0.30
    // ★#905/#966：触控形变——触点处把内容沿"离触点方向"推挤（Gaussian 钟）。
    //   ★只给选中项（overlay）；press=0 或 touch 未激活 ⇒ push≈0（退化到既有折射）。
    let t_r = (hs.0.min(hs.1) * 0.9).max(8.0);
    let tdx = local.0 - p.touch.0;
    let tdy = local.1 - p.touch.1;
    let tg = (-(tdx * tdx + tdy * tdy) / (2.0 * t_r * t_r)).exp() * p.press.clamp(0.0, 1.0) * p.overlay.clamp(0.0, 1.0);
    // ★#968：无触控内容位移（push=0）——按下只改剪影 + 亮环，内容零位移。
    let sp = (local.0 + n.0 * bend, local.1 + n.1 * bend);   // ★#997：向外采样=边缘反射

    // uv 折算：纹理尺寸 = size + 2*pad；节点 uv=0 对应纹理 pad/(size+2pad)
    let tex_w = p.size_px.0 + 2.0 * p.pad;
    let tex_h = p.size_px.1 + 2.0 * p.pad;
    let bias = (p.pad / tex_w, p.pad / tex_h);
    let scale = (p.size_px.0 / tex_w, p.size_px.1 / tex_h);
    let to_tex = |local: (f32, f32)| ((local.0 / p.size_px.0) * scale.0 + bias.0,
                                      (local.1 / p.size_px.1) * scale.1 + bias.1);

    // ★★★决策 #976：按下透镜「内部放大」（凸模式放大镜）——与 glass.wgsl 同源（门控 pr_ov ⇒ 静止/条等价）。
    let pr_ov = p.press.clamp(0.0, 1.0) * p.overlay.clamp(0.0, 1.0);
    let ctr = hs;
    let zoom = 1.0 + pr_ov * 0.08;   // ★#981：0.16→0.08
    let sp_l = (ctr.0 + (sp.0 - ctr.0) / zoom, ctr.1 + (sp.1 - ctr.1) / zoom);
    // ★★★决策 #978：按下透镜「自低通」（凸透镜的柔）——与 glass.wgsl 同源（5-tap 十字，br2=0 等价）。
    let br2 = band * 0.03 * pr_ov;   // ★#981：0.05→0.03
    let s5 = |px: f32, py: f32| backdrop.sample_map(to_tex((px, py)));
    let mut col = [0.0f32; 4];
    for c in 0..4 {
        col[c] = s5(sp_l.0, sp_l.1)[c] * 0.36
            + s5(sp_l.0 + br2, sp_l.1)[c] * 0.16
            + s5(sp_l.0 - br2, sp_l.1)[c] * 0.16
            + s5(sp_l.0, sp_l.1 + br2)[c] * 0.16
            + s5(sp_l.0, sp_l.1 - br2)[c] * 0.16;
    }
    // ★★★决策 #972/#976：按下透镜的「边缘色散」（RGB 沿法线差异化偏移）——与 glass.wgsl 同源（无条件采样，disp=0 等价）。
    let disp = pr_ov * (1.0 - e) * (band * 0.30).min(6.0);
    let a_r = backdrop.sample_map(to_tex((sp_l.0 + n.0 * disp, sp_l.1 + n.1 * disp)));
    let a_b = backdrop.sample_map(to_tex((sp_l.0 - n.0 * disp, sp_l.1 - n.1 * disp)));
    col[0] = a_r[0];
    col[2] = a_b[2];
    let raw = col;   // ★#925：原始采样色（供霜色 12% 色温）
    let lum = col[0] * 0.299 + col[1] * 0.587 + col[2] * 0.114;
    // ★决策 #875：去饱和 0.30 → 0.12（保留背后颜色；与 glass.wgsl ④ 同源）
    for c in 0..3 { col[c] = col[c] + (lum - col[c]) * 0.12; }
    for c in 0..3 { col[c] = lum + (col[c] - lum) * p.saturation; }
    // ★★★决策 #913：**霜层（surface veil）**——修正 #910/#911 的机制错误（对内容做亮度平移 ≠ 表面霜）。
    //   `mix(内容色, 霜色, α)`：整面朝霜色靠拢（降对比 ⇒ 乳白/灰纱）。霜色与厚度随区域背景**翻转**
    // ★★★决策 #931：**面纱（veil）**——修正 #926「加法亮度位移保对比 ⇒ 读作透明」。
    //   iOS 真实模型（两张不同背景联立）：`glass = mix(bg, 0.80, 0.28)` ⇒ 对比度 0.72×（磨砂）。
    //   ★#925：附 12% 背景色温（只取色度偏移）。与 glass.wgsl ⑤ 同源。
    // ★★★决策 #949：α 随背景明暗**翻转**（阈值重映射，非线性）——与 glass.wgsl ⑤ 同源。
    // ★★★决策 #984（订正 #943/#949/#977）：**面纱 α 恒定、霜色分档**（详见 glass.wgsl 同源注释）。
    //   旧模型(V=255 恒白 + α 随 bg) 用 4 点反解出浅底 α=−0.13（自相矛盾）；新模型 α=0.467 · 暗霜140/亮霜236，4 点零残差。
    let veil_t = smoothstep(0.42f32, 0.62f32, p.bg_lum);
    let veil_v = 0.55f32 + (1.0f32 - 0.55f32) * veil_t;   // ★#988：亮端纯白
    let pr_ov = p.press.clamp(0.0, 1.0) * p.overlay.clamp(0.0, 1.0);
    // ★★★决策 #987（B）：α 随背景变——浅端 0.88（内容压到不可见）/ 深端 0.467（#984 四点拟合）。
    // ★#996：恢复 B——浅底 α 0.85（对比度门控）
    let veil_a0 = 0.467f32 + (0.85f32 - 0.467f32) * veil_t;
    let veil_a = veil_a0 + (veil_a0 * 0.06f32 - veil_a0) * pr_ov;
    let raw_lum = raw[0]*0.299 + raw[1]*0.587 + raw[2]*0.114;
    for c in 0..3 {
        let vc = (veil_v + (raw[c] - raw_lum) * 0.12).clamp(0.0, 1.0);
        col[c] = col[c] + (vc - col[c]) * veil_a;
    }
    // ★#952：选中胶囊叠加层（**不动 α**，叠半透明中性色：deep→0.88 亮 / 浅底→0.40 灰）。
    if p.overlay > 0.001f32 {
        let ov_l = 0.52f32 + (0.62f32 - 0.52f32) * veil_t;   // ★#958 两端收拢
        let ov_a = p.overlay.clamp(0.0, 1.0) * 0.30f32 * (1.0f32 - p.press.clamp(0.0, 1.0));   // ★#964 按下淡出灰叠加
        for c in 0..3 { col[c] = col[c] + (ov_l - col[c]) * ov_a; }
    }
    // ★★★决策 #944：tint 移到面纱之后（与 glass.wgsl 同源——作者 tint 作用于最终玻璃面，暗 tint 才不被面纱洗白）。
    for c in 0..3 { col[c] = col[c] + (col[c] * p.tint[c] * 2.0 - col[c]) * p.tint[3]; }

    let cos_i = 1.0 / (1.0 + slope * slope).sqrt();
    let f0 = 0.04f32;
    let fres = f0 + (1.0 - f0) * (1.0 - cos_i).max(0.0).powi(5);
    let llen = (p.light_dir.0 * p.light_dir.0 + p.light_dir.1 * p.light_dir.1).sqrt();
    let ld = (p.light_dir.0 / llen, p.light_dir.1 / llen);
    let facing = (n.0 * ld.0 + n.1 * ld.1).max(0.0);
    let bevel_mask = 1.0 - smoothstep(0.0, 0.04, e);   // ★#980：0.10→0.04（窄锐边线）
    // ★决策 #906：兜底边缘高光（恒定细亮边 + 顶光加成）——与 glass.wgsl ⑥ 同源（纯色背景也可见）
    let top_hi = (-n.1).max(0.0);
    let edge_hi = bevel_mask * (0.12 + 0.06 * top_hi + 0.08 * facing);   // ★#980：提亮
    // ★★★决策 #910 · **自适应描边极性**（报告 P0-1）：亮底描边**减暗**（轮廓可见）、暗底**加亮**——与 glass.wgsl ⑥ 同源。
    // ★#915：删 edge_pol（iOS 边缘恒亮，不随背景翻转）——与 glass.wgsl ⑥ 同源。
    // ★#953：边缘高光按 overlay 门控（overlay=1 ⇒ 无边缘高光 = 干净卡片）
    // ★#956 撤回：iOS 选中胶囊实测无高亮边（#953 原判正确）
    let edge_amp = 1.0f32 - p.overlay.clamp(0.0, 1.0);
    // ★#963：按下点亮透镜（press>0 的玻璃加镜面亮边）
    // ★#967：按下亮环——沿充气轮廓的亮边（与 glass.wgsl 同源；压在暗底也读得出）。
    let pv_rim = p.press.clamp(0.0, 1.0) * p.overlay.clamp(0.0, 1.0);
    let rim_w = (p.size_px.0.min(p.size_px.1) * 0.018).max(1.8);   // ★#976：0.06→0.018（窄锐亮脊）
    let press_rim = (1.0 - smoothstep(0.0, rim_w, sd.abs())) * pv_rim * 0.85;   // ★#976：0.55→0.85
    let rim = ((facing.powi(6) * p.specular * 0.22 + fres * 0.06) * bevel_mask + edge_hi) * edge_amp + press_rim + tg * 0.07;   // ★#954/#963/#966
    for c in 0..3 { col[c] = (col[c] + rim).clamp(0.0, 1.0); }
    // ★#966：剪影由宿主几何（inflatedPillPath）给出——见 glass.wgsl（本设备忽略 shader 返回 alpha）。
    col[3] = 1.0;
    col
}

impl Backdrop<'_> {
    fn sample_map(&self, t: (f32, f32)) -> [f32; 4] {
        self.sample(t.0, t.1)
    }
}

/// 渲染一整块玻璃（h×w，行主序，左上原点）。
pub fn render(backdrop_px: &[[f32; 4]], tex_w: usize, tex_h: usize, out_w: usize, out_h: usize, p: &GlassParams) -> Vec<[f32; 4]> {
    let bd = Backdrop { px: backdrop_px, w: tex_w, h: tex_h };
    let mut out = Vec::with_capacity(out_w * out_h);
    for y in 0..out_h {
        for x in 0..out_w {
            // 像素中心
            out.push(shade(&bd, (x as f32 + 0.5, y as f32 + 0.5), p));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 参考实现自检：合成 backdrop（左半红/右半蓝），玻璃中心应为两色混合、外缘不崩。
    #[test]
    fn reference_smoke() {
        // 纹理：size 130 + 2*pad 24 = 178
        let (w, h) = (178usize, 178usize);
        let mut bd = vec![[0.0f32; 4]; w * h];
        for y in 0..h {
            for x in 0..w {
                let (r, b) = if x < w / 2 { (1.0, 0.0) } else { (0.0, 1.0) };
                bd[y * w + x] = [r, 0.0, b, 1.0];
            }
        }
        let p = GlassParams::default();
        let out = render(&bd, w, h, 130, 130, &p);
        assert_eq!(out.len(), 130 * 130);
        // 中心像素应混合了红与蓝（两通道都非零）
        let c = out[65 * 130 + 65];
        assert!(c[0] > 0.05 && c[2] > 0.05, "中心应为混合色，实得 {:?}", c);
        // 所有像素 alpha=1、值域合法
        for px in &out {
            assert_eq!(px[3], 1.0);
            for c in px { assert!(*c >= -0.001 && *c <= 1.001, "值越界 {:?}", px); }
        }
    }
}
