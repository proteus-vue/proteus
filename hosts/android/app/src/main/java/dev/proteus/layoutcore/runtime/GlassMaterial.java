package dev.proteus.layoutcore;

import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Paint;
import android.graphics.RuntimeShader;
import android.graphics.Shader;
import android.os.Build;

/**
 * ★★★框架自研**液态玻璃材质**（Android 落地 · 决策 #818/#834）。
 *
 * <p>【新架构（决策 #834）】**算法真源 = Rust 的 WGSL**（`packages/shader-codegen-rust/src/materials/
 * glass.wgsl`，经 naga 落地 AGSL），本类**不再手写任何着色器**——源码来自生成物
 * {@link GeneratedMaterials#GLASS_AGSL}（`node scripts/gen-shaders.mjs` 产出，门禁防漂移）。
 * 本类只做**落地**：编译（RuntimeShader）+ 设 uniform + 交给 {@code ProteusHostView} 的玻璃遍绘制。</p>
 *
 * <p>【模型】"边缘倒角厚板"（决策 #827）：中心平坦（不折射）、仅最外倒角带沿外法线折射、
 * 模糊按离边距离键控、去饱和+磨砂白、Fresnel 高光。观感与三端同源（同一份 WGSL）。</p>
 *
 * <p>【怎么用（宿主）】{@code ProteusHostView} 对带 {@code style.glass} 的节点：把"背后已绘内容"画进
 * 离屏 {@code Bitmap} → {@link #buildPaint} → {@code canvas.drawRect(节点盒, paint)}（裁剪圆角）。
 * 坐标口径：{@code ox/oy} = 节点盒在**渲染目标**（全屏画布）内的左上角（设备像素）；
 * 采样坐标 = 片元画布坐标 + 折射位移（见 WGSL 契约）。</p>
 *
 * <p>【版本门】AGSL 需 **API 31+**（{@code android.graphics.RuntimeShader}）；不可用 ⇒ 调用方回退半透明实色。</p>
 */
public final class GlassMaterial {

    private GlassMaterial() {}

    public static boolean isAvailable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
    }

    /** 玻璃材质参数（由内核 `style.glass` 折出）。 */
    public static final class Spec {
        public final float blur;
        public final int tint;
        public final float radius;
        public final boolean border;
        public final float saturation;

        public Spec(float blur, int tint, float radius, boolean border, float saturation) {
            this.blur = blur;
            this.tint = tint;
            this.radius = radius;
            this.border = border;
            this.saturation = saturation;
        }
    }

    /**
     * 用"背后内容"位图 + 盒 + 规格构建玻璃 {@code Paint}（null = 不可用/失败 ⇒ 调用方降级半透明实色）。
     *
     * @param backdrop 全屏"无玻璃内容帧"（像素坐标 = 画布坐标）
     * @param ox,oy    节点盒在画布内的左上角（设备像素）
     * @param w,h      节点盒尺寸（设备像素）
     * @param radius   圆角（设备像素）
     */
    public static Paint buildPaint(Bitmap backdrop, float ox, float oy, float w, float h, float radius, Spec spec) {
        if (!isAvailable() || backdrop == null || backdrop.isRecycled() || spec == null || w <= 0f || h <= 0f) {
            android.util.Log.w("proteus-glass", "buildPaint early-null: avail=" + isAvailable()
                    + " backdrop=" + (backdrop == null ? "null" : backdrop.getWidth() + "x" + backdrop.getHeight())
                    + " spec=" + (spec == null ? "null" : "ok") + " w=" + w + " h=" + h);
            return null;
        }
        try {
            // ★算法来自 Rust 真源落地（GeneratedMaterials.GLASS_AGSL）——本类不写着色器。
            RuntimeShader sh = new RuntimeShader(GeneratedMaterials.GLASS_AGSL);
            sh.setInputShader("backdrop_tex", new BitmapShader(backdrop, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));

            float a = ((spec.tint >>> 24) & 0xFF) / 255f;
            float cr = ((spec.tint >> 16) & 0xFF) / 255f;
            float cg = ((spec.tint >> 8) & 0xFF) / 255f;
            float cb = (spec.tint & 0xFF) / 255f;
            sh.setFloatUniform("tint", cr, cg, cb, a);
            sh.setFloatUniform("size_px", w, h);
            // ★AGSL 采样空间 = 画布像素（BitmapShader.eval 取位图像素）：tex_scale=盒尺寸、tex_bias=盒左上角
            //   ⇒ sample = (local/size_px)*size_px + origin = 片元画布坐标（+ 折射位移）。见 WGSL 契约注释。
            sh.setFloatUniform("origin", ox, oy);
            sh.setFloatUniform("tex_scale", w, h);
            sh.setFloatUniform("tex_bias", ox, oy);
            sh.setFloatUniform("light_dir", -0.35f, -0.94f);
            sh.setFloatUniform("radius", radius);
            sh.setFloatUniform("blur", spec.blur);
            // ★边缘峰值位移：调研守恒 refractionAmount ≈ 2×倒角带宽；带宽 in-kernel = min(size)*0.22
            sh.setFloatUniform("refract_depth", Math.min(w, h) * 0.22f);
            sh.setFloatUniform("specular", 0.18f);
            sh.setFloatUniform("saturation", spec.saturation);
            sh.setFloatUniform("_pad", 0f);

            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            p.setShader(sh);
            android.util.Log.i("proteus-glass", "buildPaint: 生成 AGSL OK（真源=WGSL）");
            return p;
        } catch (Throwable t) {
            android.util.Log.w("proteus-glass", "buildPaint: AGSL FAIL " + t + " :: " + android.util.Log.getStackTraceString(t));
            return null; // 着色器编译/构建失败 ⇒ 降级（不崩）
        }
    }
}
