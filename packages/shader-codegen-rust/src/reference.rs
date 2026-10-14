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
    let sd = sd_round_rect(pc, hs, r);
    let d = (-sd).max(0.0);
    let smin = p.size_px.0.min(p.size_px.1);   // 最短边（= 2×hsmin）
    // ★决策 #907/#910：折射带 = **最短边 1/3**（#910 修正口径：原 `hsmin*0.33 = 0.165·min` 只有 1/6 ⇒ ×2）
    let band = (smin * 0.33).max(6.0);
    let e = (d / band).clamp(0.0, 1.0);

    let eps = (band * 0.3).clamp(1.0, 16.0);
    let gx = sd_round_rect((pc.0 + eps, pc.1), hs, r) - sd_round_rect((pc.0 - eps, pc.1), hs, r);
    let gy = sd_round_rect((pc.0, pc.1 + eps), hs, r) - sd_round_rect((pc.0, pc.1 - eps), hs, r);
    let glen = (gx * gx + gy * gy).sqrt().max(1e-5);
    let n = (gx / glen, gy / glen);

    let ec = e.clamp(0.004, 0.996);
    let u1 = 1.0 - ec;
    let slope = u1 / (1.0 - u1 * u1).max(1e-4).sqrt();
    // ★决策 #910：位移**横贯整带**（prof 外缘1→内缘0），峰值 = 带宽×1.15（≥带宽 ⇒ 真透镜压缩/回折）；
    //   refract_depth 以 band 为基准（宿主默认传 band ⇒ 1.0 中性；非恒等 ⇒ 真旋钮）——与 glass.wgsl 同源。
    let prof = 1.0 - smoothstep(0.0, 1.0, e);
    let strength = (p.refract_depth / band.max(1.0)).clamp(0.2, 2.5);
    let bend = prof * band * 1.15 * strength;
    let sp = (local.0 + n.0 * bend, local.1 + n.1 * bend);

    // uv 折算：纹理尺寸 = size + 2*pad；节点 uv=0 对应纹理 pad/(size+2pad)
    let tex_w = p.size_px.0 + 2.0 * p.pad;
    let tex_h = p.size_px.1 + 2.0 * p.pad;
    let bias = (p.pad / tex_w, p.pad / tex_h);
    let scale = (p.size_px.0 / tex_w, p.size_px.1 / tex_h);
    let to_tex = |local: (f32, f32)| ((local.0 / p.size_px.0) * scale.0 + bias.0,
                                      (local.1 / p.size_px.1) * scale.1 + bias.1);

    // ★决策 #906：零采样（不做模糊）——与 glass.wgsl ③ 同源（内容不糊，只磨砂叠加）
    let mut col = backdrop.sample_map(to_tex(sp));
    let lum = col[0] * 0.299 + col[1] * 0.587 + col[2] * 0.114;
    // ★决策 #875：去饱和 0.30 → 0.12（保留背后颜色；与 glass.wgsl ④ 同源）
    for c in 0..3 { col[c] = col[c] + (lum - col[c]) * 0.12; }
    for c in 0..3 { col[c] = lum + (col[c] - lum) * p.saturation; }
    for c in 0..3 { col[c] = col[c] + (col[c] * p.tint[c] * 2.0 - col[c]) * p.tint[3]; }
    // ★★★决策 #910：**霜白锚点自适应**（修正 #908 方向错误）——与 glass.wgsl ⑤ 同源。
    //    #908 的 `lum*0.58+0.13` 斜率<1 = 压缩对比 ⇒ 永远提不亮（深底反而压暗，与 iOS 相反）。
    //    正确：朝霜白锚点 `FROST_L` 靠拢——暗底大抬升成霜白、亮底轻压仍可见（iOS 真机实测 + WWDC 原文）。
    //    只加**同一 delta**（只改明度、不动色相/饱和 ⇒ 守住 #875）。`FROST_L` = 唯一主旋钮。
    let frost_l = 0.75f32;
    let d_aff = (frost_l - lum) * 0.75;
    for c in 0..3 { col[c] = (col[c] + d_aff).clamp(0.0, 1.0); }

    let cos_i = 1.0 / (1.0 + slope * slope).sqrt();
    let f0 = 0.04f32;
    let fres = f0 + (1.0 - f0) * (1.0 - cos_i).max(0.0).powi(5);
    let llen = (p.light_dir.0 * p.light_dir.0 + p.light_dir.1 * p.light_dir.1).sqrt();
    let ld = (p.light_dir.0 / llen, p.light_dir.1 / llen);
    let facing = (n.0 * ld.0 + n.1 * ld.1).max(0.0);
    let bevel_mask = 1.0 - smoothstep(0.0, 0.35, e);
    // ★决策 #906：兜底边缘高光（恒定细亮边 + 顶光加成）——与 glass.wgsl ⑥ 同源（纯色背景也可见）
    let top_hi = (-n.1).max(0.0);
    let edge_hi = bevel_mask * (0.10 + 0.26 * top_hi + 0.16 * facing);
    // ★★★决策 #910 · **自适应描边极性**（报告 P0-1）：亮底描边**减暗**（轮廓可见）、暗底**加亮**——与 glass.wgsl ⑥ 同源。
    let edge_pol = smoothstep(0.55, 0.85, lum);
    let rim_light = (facing.powi(6) * p.specular + fres * 0.20) * bevel_mask + edge_hi;
    let rim_dark = edge_hi * 0.9;
    let rim = rim_light * (1.0 - edge_pol) - rim_dark * edge_pol;
    for c in 0..3 { col[c] = (col[c] + rim).clamp(0.0, 1.0); }
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
