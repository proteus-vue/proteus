package dev.proteus.layoutcore.runtime;

import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Paint;
import android.graphics.RuntimeShader;
import android.graphics.Shader;
import android.os.Build;

/**
 * ★★★框架自研**液态玻璃材质**着色器（AGSL · 决策 #818）——即使 OS 没有玻璃能力也能自绘近似系统的液态玻璃。
 *
 * <p>【为什么自研（用户目标）】Android 公开 API **没有**容器级背景玻璃（`RenderEffect` 只作用于 View 自身内容，
 * 非"背后像素"）——国产 ROM（华为/小米/OPPO）的"液态玻璃"都是**自研着色器**。本类即框架侧那一份：
 * 用 **AGSL `RuntimeShader`** 把"背后内容"位图作采样器，做 **blur + 饱和提彩 + tint + 边缘高光**。</p>
 *
 * <p>【怎么用（宿主）】`ProteusHostView` 对带 `style.glass` 的节点：先把"背后已绘内容"画进离屏
 * `Bitmap`（`backdrop`）→ {@link #buildPaint} 得到玻璃 `Paint` → `canvas.drawRect(节点盒, paint)`（裁剪到圆角）。
 * 模糊采 `backdrop` 同坐标像素（`BitmapShader` 恒等映射）。</p>
 *
 * <p>【版本门】AGSL 需 **API 31+**；`isAvailable()` 假 ⇒ 调用方回退半透明实色。</p>
 *
 * <p>【无设备可编译】`javac + android.jar` 即可编译（`check:android-host-compile`）。</p>
 */
public final class GlassRenderer {

    private GlassRenderer() {}

    /** AGSL 是否可用（API 31+ = Android 12，`RuntimeShader` 起点）。 */
    public static boolean isAvailable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
    }

    /**
     * 玻璃着色器源码（AGSL）。uniform：`content`（背后内容采样器）· `blur`（模糊半径 px）·
     * `tint`（straight-alpha `vec4`）· `saturation`（提彩增益，1=不变）。
     * 采样 = 9 点盒式模糊（低成本、确定性）；再叠饱和提彩 + tint。
     */
    public static final String GLASS_AGSL =
            "uniform shader content;\n"
            + "uniform float blur;\n"
            + "uniform float4 tint;\n"
            + "uniform float saturation;\n"
            + "half4 main(float2 coord) {\n"
            + "    float s = max(blur, 0.0) * 0.5;\n"
            + "    half4 acc = half4(0.0);\n"
            + "    acc += content.eval(coord + float2(-s, -s));\n"
            + "    acc += content.eval(coord + float2( 0.0, -s));\n"
            + "    acc += content.eval(coord + float2( s, -s));\n"
            + "    acc += content.eval(coord + float2(-s,  0.0));\n"
            + "    acc += content.eval(coord);\n"
            + "    acc += content.eval(coord + float2( s,  0.0));\n"
            + "    acc += content.eval(coord + float2(-s,  s));\n"
            + "    acc += content.eval(coord + float2( 0.0,  s));\n"
            + "    acc += content.eval(coord + float2( s,  s));\n"
            + "    half4 c = acc / 9.0;\n"
            + "    // 饱和提彩（系统玻璃常提彩：saturation>1 增艳）\n"
            + "    half lum = dot(c.rgb, half3(0.299, 0.587, 0.114));\n"
            + "    c.rgb = mix(half3(lum), c.rgb, half(saturation));\n"
            + "    // tint（straight alpha 叠加）\n"
            + "    c.rgb = mix(c.rgb, half3(tint.rgb), half(tint.a));\n"
            + "    c.a = 1.0;\n"
            + "    return c;\n"
            + "}\n";

    /** 一份玻璃材质参数（由内核 `style.glass` 折出）。 */
    public static final class Spec {
        public final float blur;
        /** tint（ARGB int） */
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
     * 用"背后内容"位图 + 规格构建玻璃 `Paint`（null = 不可用/失败 ⇒ 调用方降级半透明实色）。
     * 画布坐标 = 位图坐标（`BitmapShader` 恒等映射）⇒ `content.eval(coord)` 取该像素背后内容。
     */
    public static Paint buildPaint(Bitmap backdrop, Spec spec) {
        if (!isAvailable() || backdrop == null || backdrop.isRecycled() || spec == null) return null;
        try {
            RuntimeShader sh = new RuntimeShader(GLASS_AGSL);
            sh.setInputShader("content", new BitmapShader(backdrop, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
            sh.setFloatUniform("blur", spec.blur);
            sh.setFloatUniform("saturation", spec.saturation);
            float a = ((spec.tint >>> 24) & 0xFF) / 255f;
            float r = ((spec.tint >> 16) & 0xFF) / 255f;
            float g = ((spec.tint >> 8) & 0xFF) / 255f;
            float b = (spec.tint & 0xFF) / 255f;
            sh.setFloatUniform("tint", r, g, b, a);
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            p.setShader(sh);
            // ★关键：RuntimeShader 是「按背景采样」的，**关闭** paint 自身对 BitmapShader 的重复
            return p;
        } catch (Throwable t) {
            return null; // 着色器编译/构建失败 ⇒ 降级（不崩）
        }
    }
}
