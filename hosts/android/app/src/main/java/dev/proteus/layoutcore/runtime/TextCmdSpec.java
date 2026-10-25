// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/TextCmdSpec.java
// ★★★文本绘制参数装配（2026-10-25 · 批 B F3 收尾时从 `VaporRenderHost.mkCmd` 抽出）
//
// 【为什么抽出来】`VaporRenderHost`（3069 行）已超 1000 行棘轮（决策 #872「存量只减不增」）。
//   本轮加三项文本能力时它必然增长 ⇒ 按决策 #870 的三层范式（契约 ← 平台实现 ← 宿主调用），
//   把「文本绘制参数从 spec 装配到 Cmd」整段搬到这里，宿主只留一行调用
//   ——既腾出棘轮空间，也把这块**纯装配逻辑**从 3000 行宿主里隔离出来（可单测）。
//
// 【职责边界】只做「spec 键 → Cmd 字段」的搬运与封闭集判定；颜色解析仍留宿主（`parseColor` 是
//   宿主的既有单一实现，不复制第二份）；不碰几何、不碰绘制。
package dev.proteus.layoutcore;

import org.json.JSONObject;

public final class TextCmdSpec {
    private TextCmdSpec() {}

    /**
     * 装配**绘制尾参数**：装饰三兄弟（style/thickness）+ 批 B F3 三项（词距/断词溢出/首行缩进）。
     * <p>装饰色由调用方先解析（宿主的 `parseColor` 是唯一实现）。</p>
     * @param c   目标指令（字段非 final ⇒ 构造后赋值）
     * @param spec 节点样式（已物理化：长度已 ×density）
     */
    public static void applyPaintTails(ProteusHostView.Cmd c, JSONObject spec) {
        // ── text-decoration 三兄弟（0/0/0 = 未声明 ⇒ 原生实线 + 文字色 + 字体默认线宽）──
        String ds = spec.optString("textDecorationStyle", null);
        c.decoStyle = "double".equals(ds) ? 1 : "dotted".equals(ds) ? 2 : "dashed".equals(ds) ? 3 : "wavy".equals(ds) ? 4 : 0;
        double dt = spec.optDouble("textDecorationThickness", 0);
        if (dt > 0) c.decoThicknessPx = (float) dt;
        // ── 批 B F3 三项（都是 CSS **继承**属性 ⇒ 编译器已折进本节点 computed style，宿主只读）──
        c.wordSpacingPx = (float) spec.optDouble("wordSpacing", 0);
        c.overflowWrap = spec.optString("overflowWrap", null);
        c.textIndentPx = (float) spec.optDouble("textIndent", 0);
    }
}
