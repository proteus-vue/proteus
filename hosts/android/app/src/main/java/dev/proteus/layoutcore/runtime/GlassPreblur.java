// hosts/android/app/src/main/java/dev/proteus/layoutcore/GlassPreblur.java
package dev.proteus.layoutcore;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;

/**
 * ★★★决策 #1015：玻璃采样源的**宿主预模糊**（backdrop 低通 · 消「内容发脏」的折叠带混叠网纹）。
 *
 * <p>【为什么需要（用户 2026-10-16「内容还是不够清晰…映射感觉有点儿脏」）】折射位移在贴现边一带把
 * 内容压缩 2–4×（s′(0)≈3.6，见 #998 剖面）⇒ 锐利高频的周期跌破 shader 采样格（25-tap 格距
 * bsig·0.7071≈1.93px）⇒ **菱形网纹/摩尔纹**。★离线分治实证：oracle（reference.rs 与 WGSL 同源）
 * 用锐利合成背板**复现**同款网纹（foldHP=0.78），宿主先低通到 σ≈2.0px 后网纹消失（foldHP=0.26）
 * 且 4px 细笔画对比保留（19→17/255）——已含「预模糊 + 模糊下限 0.45」对照：**下限放宽若无预模糊
 * 反而更糟**（C 组 foldHP=0.94，字形碎成斑块；D 组=0.29 成形）⇒ 低通必须发生在**位移采样之前**。</p>
 *
 * <p>【为什么是宿主侧（对齐 iOS 架构）】iOS 的条面同样先经「大半径模糊」再被折射采样
 * （CABackdropLayer），抗混叠压力不在采样核。σ≥3.5 的深链曾杀字形（#1005）——本链 σ≈2.0px
 * 落在「网格消失、字形可读」窗口内（PIL 全管线 σ 扫描 2.0/2.5 档均通过）。</p>
 *
 * <p>【实现口径】全分辨率 → **半程双线性降采样**（抗锯齿低通）→ **3×3 盒式均值**（σ_half≈0.82 ⇒
 * 全分辨率等效 σ≈2.0px）→ **×2 双线性升采样**回目标尺寸。两级缩放走 Canvas FILTER_BITMAP，
 * 盒式走可分离 3-tap 整数均值（边缘 clamp 防暗边）——与离线仿真「/2+盒r1+×2」逐形对应。</p>
 *
 * <p>【诚实边界】只处理背板（玻璃采样源，玻璃**外**内容不受影响）；缓冲按目标尺寸逐帧复用。
 * 若未来 DIV 自适应（大盒 /2），本链输入取 (bw,bh)、输出 (sw,sh) 的泛化口径仍然成立。</p>
 */
final class GlassPreblur {

    /** /2 级缓冲（缓存复用）。 */
    private Bitmap half;
    private int[] pix;
    private int[] tmp;

    /**
     * @param full  全分辨率背板（bw×bh；由 {@code captureGlassBackdrop} 填充）
     * @param dst   输出（sw×sh；即 {@code glassBackdrop}，shader 采样源）
     */
    void apply(Bitmap full, int bw, int bh, Bitmap dst, int sw, int sh, Paint filtp) {
        final int hw = Math.max(1, sw / 2);
        final int hh = Math.max(1, sh / 2);
        if (half == null || half.getWidth() != hw || half.getHeight() != hh) {
            if (half != null) half.recycle();
            half = Bitmap.createBitmap(hw, hh, Bitmap.Config.ARGB_8888);
            pix = new int[hw * hh];
            tmp = new int[hw * hh];
        }
        // ① /2 双线性降采样（源 = 全分辨率背板）
        new Canvas(half).drawBitmap(full, new Rect(0, 0, bw, bh), new Rect(0, 0, hw, hh), filtp);
        // ② 3×3 盒式（可分离）：横 pass → tmp，纵 pass 就地写回 pix
        half.getPixels(pix, 0, hw, 0, 0, hw, hh);
        for (int y = 0; y < hh; y++) {
            final int row = y * hw;
            for (int x = 0; x < hw; x++) {
                tmp[row + x] = avg3(pix[row + Math.max(0, x - 1)], pix[row + x], pix[row + Math.min(hw - 1, x + 1)]);
            }
        }
        for (int x = 0; x < hw; x++) {
            for (int y = 0; y < hh; y++) {
                pix[y * hw + x] = avg3(tmp[Math.max(0, y - 1) * hw + x], tmp[y * hw + x], tmp[Math.min(hh - 1, y + 1) * hw + x]);
            }
        }
        half.setPixels(pix, 0, hw, 0, 0, hw, hh);
        // ③ ×2 双线性升采样（→ shader 采样源 glassBackdrop）
        new Canvas(dst).drawBitmap(half, new Rect(0, 0, hw, hh), new Rect(0, 0, sw, sh), filtp);
    }

    /** 三像素 ARGB 逐通道均值（含 alpha——背板恒不透明，均值保持 255）。 */
    private static int avg3(int a, int b, int c) {
        final int r = (((a >> 16) & 0xff) + ((b >> 16) & 0xff) + ((c >> 16) & 0xff)) / 3;
        final int g = (((a >> 8) & 0xff) + ((b >> 8) & 0xff) + ((c >> 8) & 0xff)) / 3;
        final int bl = ((a & 0xff) + (b & 0xff) + (c & 0xff)) / 3;
        final int al = (((a >>> 24) + (b >>> 24) + (c >>> 24)) / 3) << 24;
        return al | (r << 16) | (g << 8) | bl;
    }
}
