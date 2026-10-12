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
     * <p>★★★【为什么必须缓存（真机"滚动闪烁"的根因 · 决策 #836）】{@code new RuntimeShader} 会
     * **编译 AGSL**——而旧版**每帧每玻璃节点都新建一次**（真机实测 3 次滑动 = 94 次编译）⇒ 编译未就绪
     * 的那一帧玻璃面画不出 ⇒ **滚动时玻璃闪烁**。着色器**源码是静态的**（生成物常量）⇒ 只为「编译」缓存：
     * 按 **nodeId** 缓存 {@code RuntimeShader}（每个玻璃节点一份，避免同帧多节点互相覆盖 uniform），
     * 每帧只**更新输入纹理 + uniform**（廉价），不再重建。</p>
     *
     * @param nodeId   玻璃节点 id（缓存键——同一节点的着色器跨帧复用）
     * @param backdrop 背景位图（**只覆盖玻璃并集包围盒**，见 #837 优化——不再是整屏）
     * @param ox,oy    节点盒在**画布**内的左上角（设备像素；AGSL `origin` uniform）
     * @param bdX,bdY  `backdrop` 在其覆盖屏幕区域中的左上角（画布坐标）——采样位图须减去它
     * @param w,h      节点盒尺寸（设备像素）
     * @param radius   圆角（设备像素）
     */
    public static Paint buildPaint(int nodeId, Bitmap backdrop, float ox, float oy, float bdX, float bdY, float w, float h, float radius, Spec spec) {
        if (!isAvailable() || backdrop == null || backdrop.isRecycled() || spec == null || w <= 0f || h <= 0f) {
            android.util.Log.w("proteus-glass", "buildPaint early-null: avail=" + isAvailable()
                    + " backdrop=" + (backdrop == null ? "null" : backdrop.getWidth() + "x" + backdrop.getHeight())
                    + " spec=" + (spec == null ? "null" : "ok") + " w=" + w + " h=" + h);
            return null;
        }
        try {
            // ★★★只为「编译」缓存（源码静态）：每节点一份 RuntimeShader，跨帧复用 ⇒ 不再每帧重编（滚动不闪）。
            RuntimeShader sh = SHADER_CACHE.get(nodeId);
            if (sh == null) {
                sh = new RuntimeShader(GeneratedMaterials.GLASS_AGSL);
                SHADER_CACHE.put(nodeId, sh);
                android.util.Log.i("proteus-glass", "buildPaint: 编译 AGSL（一次，节点 " + nodeId + "，真源=WGSL）");
            }
            // 每帧只更新输入纹理 + uniform（廉价）
            sh.setInputShader("backdrop_tex", new BitmapShader(backdrop, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));

            float a = ((spec.tint >>> 24) & 0xFF) / 255f;
            float cr = ((spec.tint >> 16) & 0xFF) / 255f;
            float cg = ((spec.tint >> 8) & 0xFF) / 255f;
            float cb = (spec.tint & 0xFF) / 255f;
            sh.setFloatUniform("tint", cr, cg, cb, a);
            sh.setFloatUniform("size_px", w, h);
            // ★AGSL 采样空间 = 画布像素：tex_scale=盒尺寸、tex_bias=节点左上角（**减去背景位图原点** ⇒
            //   采样落到该位图坐标）。render target 仍是整画布（玻璃画在主画布上），故 `origin` 用画布坐标。
            sh.setFloatUniform("origin", ox, oy);
            sh.setFloatUniform("tex_scale", w, h);
            sh.setFloatUniform("tex_bias", ox - bdX, oy - bdY);
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
            return p;
        } catch (Throwable t) {
            android.util.Log.w("proteus-glass", "buildPaint: AGSL FAIL " + t + " :: " + android.util.Log.getStackTraceString(t));
            return null; // 着色器编译/构建失败 ⇒ 降级（不崩）
        }
    }

    /** 节点 id → 已编译的 AGSL 着色器（源码静态 ⇒ 只编译一次；见 buildPaint 注释）。 */
    private static final java.util.HashMap<Integer, RuntimeShader> SHADER_CACHE = new java.util.HashMap<>();

    /** 清空着色器缓存（重挂载/换场景时调用——旧节点的着色器不再需要）。 */
    public static void clearShaderCache() {
        SHADER_CACHE.clear();
    }
}
