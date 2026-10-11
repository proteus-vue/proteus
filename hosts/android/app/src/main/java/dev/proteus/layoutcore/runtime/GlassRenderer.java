package dev.proteus.layoutcore.runtime;

import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.RenderEffect;
import android.graphics.RuntimeShader;
import android.graphics.Shader;
import android.os.Build;

/**
 * ★★★框架自研**液态玻璃材质**着色器（AGSL · 决策 #818）——即使 OS 没有玻璃能力也能自绘近似系统的液态玻璃。
 *
 * <p>【为什么自研（用户目标）】Android 公开 API **没有**容器级背景玻璃（`RenderEffect` 只作用于 View 自身内容，
 * 非"背后像素"）——国产 ROM（华为/小米/OPPO）的"液态玻璃"都是**自研着色器**。本类即框架侧那一份：
 * 用 **AGSL `RuntimeShader`** 把"背后内容"（宿主自绘已画像素 / 录制的 RenderNode 内容）作采样器，
 * 做 **blur + 饱和提彩 + tint + 边缘高光**，产出玻璃面。</p>
 *
 * <p>【接入】宿主 `ProteusHostView.onDraw` 对带 `style.glass` 的节点：把该节点**背后已绘内容**录成
 * 纹理（离屏 Bitmap / `RenderNode`）→ `BitmapShader` → `RuntimeShader.setInputShader("content", …)` →
 * `RenderEffect.createRuntimeShaderEffect(shader, "content")` → 画玻璃面。</p>
 *
 * <p>【版本门】AGSL (`RuntimeShader` / `RenderEffect.createRuntimeShaderEffect`) 需 **API 31+**；
 * 以下版本回退半透明实色（`isAvailable()` 假 ⇒ 调用方走降级）。</p>
 *
 * <p>【无设备可编译验证】本类不触 IO/Context，`javac + android.jar` 即可编译（`check:android-host-compile`）。</p>
 */
public final class GlassRenderer {

    private GlassRenderer() {}

    /** AGSL 是否可用（API 31+）。 */
    public static boolean isAvailable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S; // API 31 = S（AGSL/RuntimeShader 起点）
    }

    /**
     * 玻璃着色器源码（AGSL）。uniform：`content`（背后内容采样器）· `size`（面尺寸 px）·
     * `blur`（模糊半径 px）· `tint`（straight-alpha `vec4`）· `saturation`（提彩增益，1=不变）。
     * 采样 = 9 点盒式模糊（低成本、确定性）；再叠饱和提彩 + tint。
     */
    public static final String GLASS_AGSL =
            "uniform shader content;\n"
            + "uniform float2 size;\n"
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
            + "    return c;\n"
            + "}\n";

    /** 一份玻璃材质参数（由内核 `style.glass` 折出：blur/tint(ARGB)/radius/border/saturation）。 */
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
     * 用"背后内容"位图 + 规格构建玻璃 `RenderEffect`（null = 不可用/失败 ⇒ 调用方降级半透明实色）。
     * 后端内容以 `TileMode.CLAMP` 采样（面边缘外沿用边缘像素——避免黑边）。
     */
    public static RenderEffect buildEffect(Bitmap backdrop, float areaW, float areaH, Spec spec) {
        if (!isAvailable() || backdrop == null || spec == null) return null;
        try {
            RuntimeShader sh = new RuntimeShader(GLASS_AGSL);
            BitmapShader contentShader = new BitmapShader(backdrop, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
            sh.setInputShader("content", contentShader);
            sh.setFloatUniform("size", areaW, areaH);
            sh.setFloatUniform("blur", spec.blur);
            sh.setFloatUniform("saturation", spec.saturation);
            float a = ((spec.tint >>> 24) & 0xFF) / 255f;
            float r = ((spec.tint >> 16) & 0xFF) / 255f;
            float g = ((spec.tint >> 8) & 0xFF) / 255f;
            float b = (spec.tint & 0xFF) / 255f;
            sh.setFloatUniform("tint", r, g, b, a);
            return RenderEffect.createRuntimeShaderEffect(sh, "content");
        } catch (Throwable t) {
            return null; // 着色器编译/构建失败 ⇒ 降级（不崩）
        }
    }
}
