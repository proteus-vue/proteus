// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/TextIndentSpans.java
// ★★★批 B F3 收尾（2026-10-25）：`text-indent` 的 Android 表达（**唯一实现**）。
//
// 【为什么单独成文件】`ProteusHostView`（5631 行）与 `ProteusTextPlatform`（度量侧）都已接近/超过
//   1000 行棘轮上限（决策 #872「存量只减不增」）⇒ 新增能力必须落到**新文件**，不能在旧文件里继续长
//   （决策 #870 的三层拆分范式：契约 ← 平台实现 ← 宿主调用）。
//
// 【语义（Web 真值）】`text-indent` 只作用于**首行**：首行按 `first` 缩进、后续行按 `rest` 缩进。
//   本仓只有"首行缩进"语义 ⇒ `rest = 0`（后续行不缩）。
//
// 【一处实现、两处调用】绘制侧（`ProteusHostView.drawTextMultiline`）与度量侧
//   （`ProteusTextPlatform.measureWrapped`）**都必须调本方法**——两处各自包 span 会让
//   「折行点」与「绘制」分叉（本仓已因"量"与"画"不同源踩过 line-height/word-break 的坑）。
package dev.proteus.layoutcore.runtime;

import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.LeadingMarginSpan;

public final class TextIndentSpans {
    private TextIndentSpans() {}

    /**
     * 把 `text` 包成带首行缩进的 CharSequence；`indentPx == 0`（或空文本）⇒ **原样返回**（零行为变化）。
     * @param text      绘制/度量用的原始文本
     * @param indentPx  首行缩进（物理 px；负值 = 悬挂缩进，`LeadingMarginSpan` 支持负值）
     */
    public static CharSequence withFirstLineIndent(CharSequence text, float indentPx) {
        if (indentPx == 0f || text == null || text.length() == 0) return text;
        SpannableString ss = new SpannableString(text);
        ss.setSpan(new LeadingMarginSpan.Standard(Math.round(indentPx), 0),
                0, text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return ss;
    }
}
