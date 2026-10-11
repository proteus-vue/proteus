package dev.proteus.layoutcore;

import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Paint;
import android.graphics.RuntimeShader;
import android.graphics.Shader;
import android.os.Build;

/**
 * ★★★框架自研**液态玻璃材质**着色器（AGSL · 决策 #818/#827）——即使 OS 没有玻璃能力也能自绘近似系统的液态玻璃。
 *
 * <p>【模型（决策 #827 调研：iOS Liquid Glass = "边缘带倒角的厚板"）】玻璃表面是**高度场**：**中心平坦**
 * （法线正对视线、`dh/ds=0` ⇒ **不折射**），**只在最外一圈倒角带（bevel band）**法线偏离视线 ⇒ **只有边缘折射**
 * （把玻璃**边界之外**的内容沿**外法线**压卷进来 = 厚玻璃/凸透镜）。**模糊按离边距离键控**（边缘锐、中心糊）。</p>
 *
 * <p>【怎么用（宿主）】`ProteusHostView` 对带 `style.glass` 的节点：把"背后已绘内容"画进离屏 `Bitmap` →
 * {@link #buildPaint} → `canvas.drawRect(节点盒, paint)`（裁剪圆角）。★采样坐标 = 画布坐标 ⇒ 背后位图须
 * **覆盖节点边界之外**（全屏 backdrop 天然满足）。</p>
 *
 * <p>【版本门】AGSL 需 **API 31+**；不可用 ⇒ 调用方回退半透明实色。</p>
 */
public final class GlassMaterial {

    private GlassMaterial() {}

    public static boolean isAvailable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
    }

    /**
     * 液态玻璃 AGSL（模型见类注释）。uniform：`content`·`rectOrigin`/`size`/`radius`（玻璃盒）· `blur` ·
     * `tint`(vec4) · `saturation` · `refractDepthPx`（边缘峰值位移 px）· `specular` · `contrast` · `lightDir`。
     */
    public static final String GLASS_AGSL =
            "uniform shader content;\n"
            + "uniform float2 rectOrigin;\n"
            + "uniform float2 size;\n"
            + "uniform float radius;\n"
            + "uniform float blur;\n"
            + "uniform float4 tint;\n"
            + "uniform float saturation;\n"
            + "uniform float refractDepthPx;\n"
            + "uniform float specular;\n"
            + "uniform float contrast;\n"
            + "uniform float2 lightDir;\n"
            // 圆角矩形 SDF（真欧氏距离；内部为负）
            + "float sdRoundRect(float2 p, float2 hs, float r) {\n"
            + "    float2 q = abs(p) - hs + r;\n"
            + "    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;\n"
            + "}\n"
            // 圆弧倒角映射（Kyant）：e=0 外缘 → 0，e=1 内侧 → 1（斜率边缘最陡、内侧为 0）
            + "float circleMap(float x) { return 1.0 - sqrt(max(1.0 - x * x, 0.0)); }\n"
            + "half4 main(float2 coord) {\n"
            + "    float2 hs = size * 0.5;\n"
            + "    float2 p = (coord - rectOrigin) - hs;\n"
            + "    float r = min(radius, min(hs.x, hs.y));\n"
            + "    float sd = sdRoundRect(p, hs, r);\n"
            + "    float d = max(-sd, 0.0);\n"                                     // 离边深度
            + "    float band = max(min(hs.x, hs.y) * 0.22, 6.0);\n"              // 倒角带宽（px）
            + "    float e = clamp(d / band, 0.0, 1.0);\n"                        // 0=边, 1=内
            // ① 外法线 n（SDF 梯度；宽 eps 防药丸中轴裂缝）
            + "    float eps = clamp(band * 0.3, 1.0, 16.0);\n"
            + "    float2 g = float2(sdRoundRect(p + float2(eps, 0.0), hs, r) - sdRoundRect(p - float2(eps, 0.0), hs, r),\n"
            + "                       sdRoundRect(p + float2(0.0, eps), hs, r) - sdRoundRect(p - float2(0.0, eps), hs, r));\n"
            + "    float2 n = g / max(length(g), 1e-5);\n"
            // ② 倒角斜率（圆弧 h=sqrt(1-(1-e)^2)）→ 位移量（圆心映射 × 峰值；中心 e→1 ⇒ 0）
            + "    float ec = clamp(e, 0.004, 0.996); float u1 = 1.0 - ec;\n"
            + "    float slope = u1 / sqrt(max(1.0 - u1 * u1, 1e-4));\n"
            + "    float bend = circleMap(1.0 - ec) * refractDepthPx;\n"
            + "    bend *= smoothstep(1.0, 0.75, e);\n"                          // 内缘 C1 淡出（防环痕）
            + "    float2 sp = coord + n * bend;\n"                              // ★向外采样（卷边界外内容进边缘）
            // ③ 模糊**按 e 键控**（边缘锐、中心糊）——★核最大半径 = blur（此前 3×blur≈84px ⇒ 内容全糊没）
            + "    float br = max(blur, 0.0) * e * 0.55;\n"
            + "    half4 acc = content.eval(sp) * 0.20;\n"
            + "    float w1 = 0.058, w2 = 0.030, w3 = 0.012;\n"                   // 中心0.20 + 8向×(w1+w2+w3)=0.80：总权重 = 1.0
            + "    for (int k = 0; k < 8; k++) {\n"
            + "        float a = float(k) * 0.7853981;\n"
            + "        float2 dir = float2(cos(a), sin(a));\n"
            + "        acc += content.eval(sp + dir * (br * 0.5)) * w1;\n"
            + "        acc += content.eval(sp + dir * br) * w2;\n"
            + "        acc += content.eval(sp + dir * (br * 1.6)) * w3;\n"
            + "    }\n"
            + "    half4 col = acc;\n"
            // ④ 去饱和（frost 冲淡色彩）+ 提彩 + 微对比
            + "    half lum = dot(col.rgb, half3(0.299, 0.587, 0.114));\n"
            + "    col.rgb = mix(col.rgb, half3(lum), half(0.30));\n"
            + "    col.rgb = mix(half3(lum), col.rgb, half(saturation));\n"
            + "    col.rgb = (col.rgb - 0.5) * half(contrast) + 0.5;\n"
            // ⑤ tint + 少量磨砂白（★iOS 内容仍**可辨认**——frost 只轻提亮不透死）
            + "    col.rgb = mix(col.rgb, col.rgb * half3(tint.rgb) * 2.0, half(tint.a));\n"
            + "    col.rgb = mix(col.rgb, half3(0.99, 0.995, 1.0), half(0.16 + tint.a * 0.2));\n"
            // ⑥ 光照：Fresnel + 法线·光源（双瓣）；**四周对称**（无顶部加权）
            + "    float cosI = inversesqrt(1.0 + slope * slope);\n"
            + "    float f0 = (1.5 - 1.0) / (1.5 + 1.0); f0 *= f0;\n"
            + "    float fres = f0 + (1.0 - f0) * pow(max(1.0 - cosI, 0.0), 5.0);\n"
            + "    float facing = max(dot(n, normalize(lightDir)), 0.0);\n"
            + "    float bevelMask = 1.0 - smoothstep(0.0, 0.35, e);\n"           // 亮带仅在外缘
            + "    float rim = (pow(facing, 6.0) * specular + fres * 0.12) * bevelMask;\n"
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
    public static Paint buildPaint(Bitmap backdrop, float ox, float oy, float w, float h, float radius, Spec spec) {
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
            sh.setFloatUniform("radius", radius);
            sh.setFloatUniform("blur", spec.blur);
            sh.setFloatUniform("saturation", spec.saturation);
            // ★边缘峰值位移：调研守恒 refractionAmount ≈ 2×倒角带宽；带宽 in-shader = min(size)*0.11
            //   ⇒ 深度 = min(size)*0.22（此前多乘一个 2 ⇒ 位移过大、糊成一片）
            sh.setFloatUniform("refractDepthPx", Math.min(w, h) * 0.22f);
            sh.setFloatUniform("specular", 0.18f);        // 边缘高光（subtle，顶部加权）
            sh.setFloatUniform("contrast", 1.0f);         // 中性
            sh.setFloatUniform("lightDir", -0.35f, -0.94f); // 光来自上偏左
            float a = ((spec.tint >>> 24) & 0xFF) / 255f;
            float cr = ((spec.tint >> 16) & 0xFF) / 255f;
            float cg = ((spec.tint >> 8) & 0xFF) / 255f;
            float cb = (spec.tint & 0xFF) / 255f;
            sh.setFloatUniform("tint", cr, cg, cb, a);
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            p.setShader(sh);
            android.util.Log.i("proteus-glass", "buildPaint: AGSL OK");
            return p;
        } catch (Throwable t) {
            android.util.Log.w("proteus-glass", "buildPaint: AGSL FAIL " + t + " :: " + android.util.Log.getStackTraceString(t));
            return null; // 着色器编译/构建失败 ⇒ 降级（不崩）
        }
    }
}
