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
            // ★真实玻璃投射（决策 #823）：玻璃面 = **有起伏的曲面**——中心平、边缘倒角。
            //   高度场 h：圆角矩形 SDF 的 smoothstep（中心 h=1、边缘 h→0）。
            + "float glassH(float2 u) {\n"
            + "    float2 dE = min(u, 1.0 - u);\n"
            + "    return smoothstep(0.0, 0.05, min(dE.x, dE.y));\n"
            + "}\n"
            + "half4 main(float2 coord) {\n"
            + "    float2 uv = (coord - rectOrigin) / size;\n"
            + "    float2 dE = min(uv, 1.0 - uv);\n"
            + "    float edge = min(dE.x, dE.y);\n"
            // ① 表面法线（高度场梯度）→ 按法线**折射**采样背景（中心平 ⇒ 不弯；边缘倒角 ⇒ 强弯；无跳变）
            + "    float e = 0.006;\n"
            + "    float gx = glassH(uv + float2(e, 0.0)) - glassH(uv - float2(e, 0.0));\n"
            + "    float gy = glassH(uv + float2(0.0, e)) - glassH(uv - float2(0.0, e));\n"
            + "    float2 disp = float2(gx, gy) * refractAmt;\n"
            + "    float2 c = rectOrigin + (uv - disp) * size;\n"
            + "    // ② 加权高斯核（多环 + 权重；总权重归一 ⇒ 亮度不变，比等权盒式平滑，消条痕）\n"
            + "    float r = max(blur, 0.0) * 0.5;\n"
            + "    half4 acc = content.eval(c) * 0.12;\n"
            + "    float w1 = 0.06, w2 = 0.035, w3 = 0.015;\n"
            + "    for (int k = 0; k < 8; k++) {\n"
            + "        float a = float(k) * 0.7853981;\n"                       // 45 度步进
            + "        float2 dir = float2(cos(a), sin(a));\n"
            + "        acc += content.eval(c + dir * r) * w1;\n"
            + "        acc += content.eval(c + dir * (r * 2.0)) * w2;\n"
            + "        acc += content.eval(c + dir * (r * 3.0)) * w3;\n"
            + "    }\n"
            + "    half4 col = acc;\n"
            + "    // ③ 磨砂去饱和（★iOS 背后色彩被明显冲淡）+ 提彩 + 微对比\n"
            + "    half lum = dot(col.rgb, half3(0.299, 0.587, 0.114));\n"
            + "    col.rgb = mix(col.rgb, half3(lum), half(0.50));\n"                  // 去饱和（frost 冲淡色彩）
            + "    col.rgb = mix(half3(lum), col.rgb, half(saturation));\n"
            + "    col.rgb = (col.rgb - 0.5) * half(contrast) + 0.5;\n"
            + "    // ④ tint（逐通道）+ **磨砂白 frost**（★iOS 玻璃是奶白磨砂、不是清玻璃——按用户实测）\n"
            + "    col.rgb = mix(col.rgb, col.rgb * half3(tint.rgb) * 2.0, half(tint.a));\n"
            + "    col.rgb = mix(col.rgb, half3(0.99, 0.995, 1.0), half(0.30 + tint.a * 0.6));\n"
            + "    // ⑤ 边缘：内阴影（subtle darken）+ 镜面高光带（贴边亮，向内柔衰减）——对齐系统的柔和厚边\n"
            + "    float band = 1.0 - smoothstep(0.0, 0.05, edge);\n"
            + "    col.rgb *= (1.0 - band * 0.05);\n"
            + "    float rim = band * specular * (0.35 + 0.65 * (1.0 - uv.y));\n"
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
            sh.setFloatUniform("refractAmt", 0.14f);  // 窄带内折射强度（带仅 5% 极窄 ⇒ 中心不折射、只边缘弯）
            sh.setFloatUniform("specular", 0.10f);    // 镜面高光边（subtle）
            sh.setFloatUniform("contrast", 1.0f);     // 中性（iOS 不加强对比）
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
