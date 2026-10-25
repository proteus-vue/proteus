// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/MultilineTextPainter.java
// ★★★多行文本绘制（2026-10-25 真机取证修复）：**逐行 drawText，不用 `StaticLayout.draw(canvas)`**。
//
// 【为什么（真机实证，不是推断）】字体验收页 I 区的多行文本在 Android 上整条空白，而同一屏的
//   单行文本全部正常。逐层取证：① Cmd 参数正确（`multiLine=true`、盒 1044×132）；② `StaticLayout`
//   排出了正确的 2 行且 `getLineWidth(0)` 有值；③ `textPaint` 颜色 `ff1a1c22`、alpha 255；④ 裁剪是全屏。
//   ⇒ 把同一次绘制的 `layout.draw(canvas)` 换成「逐行 `canvas.drawText`」后**文字立刻可见**。
//   ⇒ 根因：`StaticLayout.draw()` 在本仓的**显示列表（Picture）录制 + 硬件 canvas** 路径下不产生字形。
//   ★这不是本轮 CSS 能力引入的（去掉三项声明后同样空白），是既有缺陷，由新案例照出。
//
// 【语义保持】断行 / 对齐 / 行高 / 行内截断**全部仍取自 StaticLayout**（它只负责排版），
//   本类只把"画"这一步换成 canvas.drawText —— 与既有单行快路径同一手法。
package dev.proteus.layoutcore.runtime;

import android.graphics.Canvas;
import android.text.Layout;
import android.text.TextPaint;

public final class MultilineTextPainter {
    private MultilineTextPainter() {}

    /**
     * 逐行绘制已排版好的 `StaticLayout`。
     * @param canvas 目标画布（已 translate 到文本原点）
     * @param layout 排版结果（StaticLayout；断行/对齐/行高都来自它）
     * @param text   原始文本（`layout` 与之同源）
     * @param paint  与排版同一支 paint（否则字形度量会与断行不一致）
     */
    public static void drawLines(Canvas canvas, Layout layout, CharSequence text, TextPaint paint) {
        for (int i = 0, n = layout.getLineCount(); i < n; i++) {
            canvas.drawText(text, layout.getLineStart(i), layout.getLineEnd(i),
                    layout.getLineLeft(i), layout.getLineBaseline(i), paint);
        }
    }
}
