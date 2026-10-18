// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/TextDecorationPainter.java
// ★★★text-decoration 三兄弟项（2026-10-18 · 批 B F3）：**装饰线手绘**（颜色 / 线型 / 线宽）。
//
// 【为什么必须手绘（不是"想自己画"）】Android 原生只有
//   `Paint.setUnderlineText` / `setStrikeThruText` —— 它们是**布尔开关**：
//   · 颜色恒为**文字色**（CSS `text-decoration-color` 无法表达）
//   · 线型恒为**单实线**（`text-decoration-style: dotted/dashed/double` 无法表达）
//   · 线宽由**字体**决定（`text-decoration-thickness` 无法表达）
//   ⇒ CSS 的这三条属性在原生通道上**全部无法落地** ⇒ 只能自绘。
//
// 【为什么独立成文件】它是纯绘制算法（无 View 状态、无生命周期），与宿主集成正交；
//   留在 `ProteusHostView`（已 5600+ 行）会把巨型文件推高，违反"源文件不越 1000 行 + 存量只减不增"。
//   ⇒ 抽成无状态工具类：只依赖 `Canvas` / `Paint` / `TextPaint`（任何 Android 宿主都能复用）。
//
// 【线位与 Web 对齐】
//   · underline：**基线下方**（偏移取 `Paint.getUnderlinePosition()` 的绝对值 —— 与原生同向同距）
//   · line-through：基线向上约 **0.3em**（x-height 中位，与浏览器观感一致）
//
// 【线型（与 CSS `text-decoration-style` 全集对应）】
//   · solid  实线
//   · double 双线（各占 1/3 线宽，中间留 1/3）
//   · dotted 圆点（点径 = 线宽，步距 2×线宽）
//   · dashed 虚线段（段长 3×线宽，间隔 2×线宽）
//   · wavy   正弦波（振幅 = 线宽，周期 4×线宽；用 Path 折线近似，与 Web 的 wavy 同量级）
//
// 【零行为变化】未声明颜色/线型/线宽时（`color==0 && style==0 && thickness<=0`），宿主仍走原生
//   `setUnderlineText`（更快、字形贴合更好）——本类只接管"有自定义声明"的情形。

package dev.proteus.layoutcore;   // ★本目录（runtime/）的文件统一用父包名——与 ProteusHostView 等 20 个同类一致

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.text.TextPaint;

final class TextDecorationPainter {

    /** 线型编码（与宿主 `Cmd.decoStyle` 同口径：0=solid / 1=double / 2=dotted / 3=dashed / 4=wavy） */
    static final int STYLE_SOLID = 0;
    static final int STYLE_DOUBLE = 1;
    static final int STYLE_DOTTED = 2;
    static final int STYLE_DASHED = 3;
    static final int STYLE_WAVY = 4;

    /** 填充笔（solid/double/dotted/dashed 用矩形/圆点） */
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    /** 描边笔（wavy 用 Path 折线） */
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    /** wavy 的折线路径（复用，避免每帧分配） */
    private final Path wave = new Path();

    private TextDecorationPainter() {}

    /** 实例（每 View 一个；本类无状态，可复用于多 View） */
    static TextDecorationPainter create() {
        return new TextDecorationPainter();
    }

    /**
     * 画一条装饰线。
     *
     * @param canvas    目标画布
     * @param textPaint 已配置好字号/字族的文本笔（取度量与默认线宽/线位；本方法**不改它的状态**）
     * @param text      被装饰的文本（决定线的长度）
     * @param tx        绘制基准 x（与该文本 `drawText` 的 x 同值）
     * @param baseY     基线 y
     * @param align     TextAlign：0=left / 1=center / 2=right（与宿主 Cmd.textAlign 同口径）
     * @param lineKind  1=underline / 2=line-through
     * @param style     线型（STYLE_*）
     * @param colorArgb 颜色（0 = 跟随文字色）
     * @param thicknessPx 线宽（<=0 = 字体默认线宽）
     */
    void draw(Canvas canvas, TextPaint textPaint, String text, float tx, float baseY, int align,
              int lineKind, int style, int colorArgb, float thicknessPx) {
        if (canvas == null || textPaint == null || text == null || text.isEmpty()) return;
        final float w = textPaint.measureText(text);
        if (w <= 0f) return;
        final float x0 = align == 1 ? tx - w * 0.5f : align == 2 ? tx - w : tx;
        final float x1 = x0 + w;
        // ★线宽：显式 > 字体默认（`getUnderlineThickness` 在 Paint 上，不在 FontMetrics 里）
        final float defTh = textPaint.getUnderlineThickness();
        final float th = thicknessPx > 0f ? thicknessPx : Math.max(1f, defTh > 0f ? defTh : 1f);
        final int col = colorArgb != 0 ? colorArgb : textPaint.getColor();
        // ★线位：underline 在基线下方（取绝对值——Android 的 underlinePosition 是负值）
        final float yUnder = baseY + Math.abs(textPaint.getUnderlinePosition());
        // line-through 在基线向上约 0.3em（x-height 中位）
        final float yStrike = baseY - textPaint.getTextSize() * 0.3f;
        final float y = lineKind == 2 ? yStrike : yUnder;

        switch (style) {
            case STYLE_DOUBLE: {
                final float dth = Math.max(1f, th / 3f);
                fill.setStyle(Paint.Style.FILL);
                fill.setColor(col);
                canvas.drawRect(x0, y - th * 0.5f, x1, y - th * 0.5f + dth, fill);
                canvas.drawRect(x0, y + th * 0.5f - dth, x1, y + th * 0.5f, fill);
                return;
            }
            case STYLE_DOTTED: {
                final float r = Math.max(0.5f, th * 0.5f);
                final float step = Math.max(1f, th * 2f);
                fill.setStyle(Paint.Style.FILL);
                fill.setColor(col);
                for (float x = x0 + r; x <= x1; x += step) canvas.drawCircle(x, y, r, fill);
                return;
            }
            case STYLE_DASHED: {
                final float seg = Math.max(2f, th * 3f);
                final float gap = Math.max(2f, th * 2f);
                fill.setStyle(Paint.Style.FILL);
                fill.setColor(col);
                for (float x = x0; x < x1; x += seg + gap) {
                    canvas.drawRect(x, y - th * 0.5f, Math.min(x + seg, x1), y + th * 0.5f, fill);
                }
                return;
            }
            case STYLE_WAVY: {
                final float amp = Math.max(0.7f, th * 0.5f);
                final float period = Math.max(4f, th * 4f);
                wave.reset();
                wave.moveTo(x0, y);
                for (float x = x0; x <= x1; x += 0.5f) {
                    final double phase = ((x - x0) / period) * 2 * Math.PI;
                    wave.lineTo(x, y + (float) Math.sin(phase) * amp);
                }
                stroke.setStyle(Paint.Style.STROKE);
                stroke.setStrokeWidth(Math.max(0.7f, th * 0.7f));
                stroke.setColor(col);
                stroke.setStrokeCap(Paint.Cap.ROUND);
                stroke.setStrokeJoin(Paint.Join.ROUND);
                canvas.drawPath(wave, stroke);
                return;
            }
            case STYLE_SOLID:
            default: {
                fill.setStyle(Paint.Style.FILL);
                fill.setColor(col);
                canvas.drawRect(x0, y - th * 0.5f, x1, y + th * 0.5f, fill);
            }
        }
    }
}
