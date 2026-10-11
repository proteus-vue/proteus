package dev.proteus.layoutcore;

import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Paint;
import android.graphics.RuntimeShader;
import android.graphics.Shader;
import android.os.Build;

/**
 * ★★★框架自研**液态玻璃材质**着色器（AGSL · 决策 #818/#821）——即使 OS 没有玻璃能力也能自绘近似系统的液态玻璃。
 *
 * <p>【液态玻璃 vs 磨砂玻璃（用户 2026-10-11 指出"远远不是液态玻璃"）】磨砂 = 模糊 + 白罩（本类 v1 的问题）；
 * 液态玻璃的**核心是光学**：① **边缘折射**（凸透镜——玻璃边缘把背后内容压/扩，产生"厚玻璃"感）；
 * ② **镜面高光边**（rim）；③ 透亮不泛白（少白罩、高饱和 + 微对比）。本类 v2 补齐这三点。</p>
 *
 * <p>【怎么用（宿主）】`ProteusHostView` 对带 `style.glass` 的节点：把"背后已绘内容"画进离屏 `Bitmap` →
 * {@link #buildPaint} → `canvas.drawRect(节点盒, paint)`（裁剪圆角）。采样源 = 背后内容帧。</p>
 *
 * <p>【版本门】AGSL 需 **API 31+**；不可用 ⇒ 调用方回退半透明实色。</p>
 */
public final class GlassMaterial {

    private GlassMaterial() {}

    public static boolean isAvailable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
    }

    /**
     * 液态玻璃 AGSL。uniform：`content`（背后内容）· `rectOrigin`/`size`（玻璃面盒）· `blur` ·
     * `tint`(vec4) · `saturation` · `refractAmt`（边缘折射强度 0..1）· `specular`（高光边强度）· `contrast`。
     * 采样 = 13 点环形模糊 + 边缘凸透镜折射 + 饱和/对比 + 镜面 rim。
     */
    public static final String GLASS_AGSL =
            "uniform shader content;\n"
            + "uniform float2 rectOrigin;\n"
            + "uniform float2 size;\n"
            + "uniform float blur;\n"
            + "uniform float4 tint;\n"
            + "uniform float saturation;\n"
            + "uniform float refractAmt;\n"
            + "uniform float specular;\n"
            + "uniform float contrast;\n"
            + "half4 main(float2 coord) {\n"
            + "    float2 uv = (coord - rectOrigin) / size;\n"
            + "    float2 dE = min(uv, 1.0 - uv);\n"
            + "    // ① 边缘折射：**柔和全局透镜**（边缘向中心轻微收缩——连续无跳变 ⇒ 无条纹/水波）\n"
            + "    float band = 1.0 - smoothstep(0.0, 0.20, min(dE.x, dE.y));\n"       // 1=贴边, 0=内（宽过渡=柔）
            + "    float lens = band * refractAmt;\n"
            + "    float2 c = rectOrigin + ((uv - 0.5) * (1.0 - lens * 0.09) + 0.5) * size;\n"
            + "    // ② 环形模糊（13 点）——半径 ~blur，frosted 而不发白\n"
            + "    float r = max(blur, 0.0) * 0.75;\n"
            + "    half4 acc = content.eval(c);\n"
            + "    acc += content.eval(c + float2(r, 0.0));\n"
            + "    acc += content.eval(c + float2(-r, 0.0));\n"
            + "    acc += content.eval(c + float2(0.0, r));\n"
            + "    acc += content.eval(c + float2(0.0, -r));\n"
            + "    float d = r * 0.7071;\n"
            + "    acc += content.eval(c + float2(d, d));\n"
            + "    acc += content.eval(c + float2(-d, d));\n"
            + "    acc += content.eval(c + float2(d, -d));\n"
            + "    acc += content.eval(c + float2(-d, -d));\n"
            + "    float r2 = r * 0.5;\n"
            + "    acc += content.eval(c + float2(r2, r2));\n"
            + "    acc += content.eval(c + float2(-r2, r2));\n"
            + "    acc += content.eval(c + float2(r2, -r2));\n"
            + "    acc += content.eval(c + float2(-r2, -r2));\n"
            + "    half4 col = acc / 13.0;\n"
            + "    // ③ 饱和提彩 + 微对比\n"
            + "    half lum = dot(col.rgb, half3(0.299, 0.587, 0.114));\n"
            + "    col.rgb = mix(half3(lum), col.rgb, half(saturation));\n"
            + "    col.rgb = (col.rgb - 0.5) * half(contrast) + 0.5;\n"
            + "    // ④ tint（逐通道，少量——液态玻璃透亮不泛白）\n"
            + "    col.rgb = mix(col.rgb, col.rgb * half3(tint.rgb) * 2.0, half(tint.a));\n"
            + "    // ⑤ 边缘：内阴影（subtle darken）+ 镜面高光带（贴边亮，向内柔衰减）——对齐系统的柔和厚边\n"
            + "    col.rgb *= (1.0 - band * 0.05);\n"
            + "    float rim = band * specular * (0.35 + 0.65 * (1.0 - uv.y));\n"        // 顶部更亮
            + "    col.rgb = min(col.rgb + half3(rim), half3(1.0));\n"
            + "    col.a = 1.0;\n"
            + "    return col;\n"
            + "}\n";

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
     * 用"背后内容"位图 + 盒 + 规格构建玻璃 `Paint`（null = 不可用/失败 ⇒ 调用方降级半透明实色）。
     * 画布坐标 = 位图坐标（`BitmapShader` 恒等映射）⇒ `content.eval(coord)` 取该像素背后内容。
     */
    public static Paint buildPaint(Bitmap backdrop, float ox, float oy, float w, float h, Spec spec) {
        if (!isAvailable() || backdrop == null || backdrop.isRecycled() || spec == null || w <= 0f || h <= 0f) {
            android.util.Log.w("proteus-glass", "buildPaint early-null: avail=" + isAvailable()
                    + " backdrop=" + (backdrop == null ? "null" : backdrop.getWidth() + "x" + backdrop.getHeight())
                    + " spec=" + (spec == null ? "null" : "ok") + " w=" + w + " h=" + h);
            return null;
        }
        try {
            RuntimeShader sh = new RuntimeShader(GLASS_AGSL);
            sh.setInputShader("content", new BitmapShader(backdrop, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
            sh.setFloatUniform("rectOrigin", ox, oy);
            sh.setFloatUniform("size", w, h);
            sh.setFloatUniform("blur", spec.blur);
            sh.setFloatUniform("saturation", spec.saturation);
            sh.setFloatUniform("refractAmt", 1.0f);   // 边缘折射带强度（幅度内含 ×0.08 px 级）
            sh.setFloatUniform("specular", 0.16f); // 镜面高光边
            sh.setFloatUniform("contrast", 1.06f); // 微对比（更"透亮"）
            float a = ((spec.tint >>> 24) & 0xFF) / 255f;
            float r = ((spec.tint >> 16) & 0xFF) / 255f;
            float g = ((spec.tint >> 8) & 0xFF) / 255f;
            float b = (spec.tint & 0xFF) / 255f;
            sh.setFloatUniform("tint", r, g, b, a);
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            p.setShader(sh);
            android.util.Log.i("proteus-glass", "buildPaint: AGSL OK");
            return p;
        } catch (Throwable t) {
            // ★诚实：不吞异常——把真因打出来（此前吞掉 ⇒ 误以为"AGSL 成功"，实为一直降级）
            android.util.Log.w("proteus-glass", "buildPaint: AGSL FAIL " + t + " :: " + android.util.Log.getStackTraceString(t));
            return null; // 着色器编译/构建失败 ⇒ 降级（不崩）
        }
    }
}
