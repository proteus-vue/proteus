// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ProteusTabChrome.java
// ★★★B · 能力归 runtime（决策 #800）：**Android tab 栏 chrome 唯一实现**
//
// 【它解决什么】此前 Android 两个壳（框架参考宿主 `SuperappActivity` + CLI 模板 `AppActivity`）
//   **各写一份** tab 栏：建视图/文案优先级/图标兜底/高亮/角标——与 iOS/鸿蒙共漂移出多套合并口径。
//   本类把该能力收敛为**一份**：壳只给「父容器 + 切屏回调 + 底部安全区」，其余全在此。
//
// 【输入契约 = 生成期最终值（不在宿主合并）】`applyState(stateJson)` 吃 JS 运行期 state：
//   · `tabItems` —— 名字/文案/字形/角标**已由 gen-routes 在生成期合并完**（决策 #800）。
//   · `tabSpec`  —— 视觉规格（TAB_BAR_SPEC：颜色/尺寸/角标几何）。
//   · `current`  —— 高亮项。
//   本类**不做合并/兜底**：没声明 glyph ⇒ 不画图标（不画 "•"——旧漂移形态已禁）。
//
// 【字形两形态】`glyph` = `sym:<name>` ⇒ 本类自带语义映射表（Android 无系统符号集；表 = 唯一来源）；
//   其他 ⇒ 文本字形（+U+FE0E 强制文本呈现，防彩色 emoji）。
package dev.proteus.layoutcore;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public final class ProteusTabChrome {

    private static final String TAG = "ProteusTabChrome";

    /** tab 项终态（来源 = state.tabItems；生成期已合并，宿主零决策）。 */
    public static final class Item {
        public final String name;
        public final String label;
        public final String glyph;   // null ⇒ 不画图标
        public final int badge;      // >0 才画

        public Item(String name, String label, String glyph, int badge) {
            this.name = name;
            this.label = label;
            this.glyph = glyph;
            this.badge = badge;
        }
    }

    /** 壳提供的切屏出口（点 tab → 壳走 `__proteusSuperappNav` + 重渲）。 */
    public interface Listener {
        void onTab(String name);
    }

    private final Context ctx;
    private final android.view.ViewGroup parent;
    private final float density;

    private android.widget.FrameLayout wrapper;      // 自持容器（顶线 + 横排项）
    private android.widget.LinearLayout bar;
    /** 内容区高（dp→px）——安全区变化时重算 wrapper 总高（内容区 + 安全区）。 */
    private int barHeightPx = 0;
    private Listener listener;

    private JSONObject spec = new JSONObject();
    private List<Item> items = new ArrayList<>();
    private String current = "";
    private int bottomInsetPx = 0;
    private String builtFingerprint = "";            // 差异判定：输入没变不重建

    public ProteusTabChrome(Context context, android.view.ViewGroup parent) {
        this.ctx = context;
        this.parent = parent;
        this.density = context.getResources().getDisplayMetrics().density;
    }

    public void setListener(Listener l) { this.listener = l; }

    /** 底部安全区（导航条）——壳从 WindowInsets 转发（窗口属壳，几何归属不变）。
     *  ★★修复（2026-10-11 · 问题1）：安全区是内容区**下方**的纯底色，**不**吃进内容区——
     *   此前 `bar.setPadding(bottom=inset)` 把内容挤进 (56−inset) 区 ⇒ 内容偏上
     *   （实测上 gap 3.7dp / 下 22.7dp，另两端又是别的值）。现只把 wrapper 总高加成
     *   内容区 + 安全区，内容仍在内容区内垂直居中（对齐 Web `.sa-tabbar`）。 */
    public void setBottomInsetPx(int px) {
        this.bottomInsetPx = Math.max(0, px);
        if (wrapper != null && barHeightPx > 0) {
            android.view.ViewGroup.LayoutParams lp = wrapper.getLayoutParams();
            if (lp != null) { lp.height = barHeightPx + bottomInsetPx; wrapper.setLayoutParams(lp); }
        }
    }

    // ────────────────────────── 状态解析（唯一入口） ──────────────────────────

    /** 从 JS state 解析 tab 项终态（tabItems 为生成期最终值；兼容老产物：无 ⇒ 由 tabs+tabLabels 现场折）。 */
    public static List<Item> itemsFromState(JSONObject o) {
        List<Item> out = new ArrayList<>();
        JSONArray arr = o.optJSONArray("tabItems");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject it = arr.optJSONObject(i);
                if (it == null) continue;
                String name = it.optString("name", "");
                if (name.isEmpty()) continue;
                String label = it.optString("label", name);
                String glyph = it.optString("glyph", "");
                int badge = it.optInt("badge", 0);
                out.add(new Item(name, label, glyph.isEmpty() ? null : glyph, badge));
            }
            return out;
        }
        // 老产物回退（同一优先级；行为与 B 之前一致）
        JSONArray tabs = o.optJSONArray("tabs");
        if (tabs != null) {
            JSONObject labels = o.optJSONObject("tabLabels");
            for (int i = 0; i < tabs.length(); i++) {
                String name = tabs.optString(i, "");
                if (name.isEmpty()) continue;
                String label = labels != null ? labels.optString(name, "") : "";
                out.add(new Item(name, label.isEmpty() ? name : label, null, 0));
            }
        }
        return out;
    }

    /** 每次渲染/导航后由壳调用：解析 state → 差异重建/重着色。items 为空 ⇒ 撤栏（无 tab 即无栏）。 */
    public void applyState(String stateJson) {
        try {
            JSONObject o = new JSONObject(stateJson);
            spec = o.optJSONObject("tabSpec") != null ? o.optJSONObject("tabSpec") : new JSONObject();
            items = itemsFromState(o);
            current = o.optString("current", "");
        } catch (Exception e) {
            Log.w(TAG, "applyState 解析失败：" + e.getMessage());
            return;
        }
        if (items.isEmpty()) { remove(); return; }
        String fp = fingerprint();
        if (!fp.equals(builtFingerprint) || wrapper == null) {
            rebuild();
            builtFingerprint = fp;
        }
        restyle();
        if (wrapper != null) parent.bringChildToFront(wrapper);
    }

    /** 撤销栏（无 tab 的应用不显示——与 MP「未声明 tabBar 就无 tabBar」同源）。 */
    public void remove() {
        if (wrapper != null) { parent.removeView(wrapper); wrapper = null; bar = null; builtFingerprint = ""; }
    }

    public boolean isAttached() { return wrapper != null; }

    /** 壳侧只读取证（driveTabs 注入真触摸坐标）：栏容器视图（相对父容器几何——getTop/getWidth 同旧壳语义）。 */
    public android.view.View barView() { return wrapper; }

    /** 第 i 个 tab 项视图（真触摸注入目标；越界/未建 ⇒ null）。 */
    public android.view.View itemView(int i) {
        return (bar != null && i >= 0 && i < bar.getChildCount()) ? bar.getChildAt(i) : null;
    }

    // ────────────────────────── 构建 ──────────────────────────

    private String fingerprint() {
        StringBuilder sb = new StringBuilder(spec.toString());
        for (Item it : items) sb.append('|').append(it.name).append('~').append(it.label).append('~').append(it.glyph).append('~').append(it.badge);
        sb.append('|').append(bottomInsetPx);
        return sb.toString();
    }

    private int dp(float v) { return Math.round(v * density); }

    private String specStr(String key, String fallback) { return spec.optString(key, fallback); }

    private int specColor(String key, int fallback) {
        String v = spec.optString(key, "");
        return v.isEmpty() ? fallback : parseHex(v);
    }

    private double specNum(String key, double fallback) { return spec.optDouble(key, fallback); }

    private double badgeNum(String key, double fallback) {
        JSONObject bd = spec.optJSONObject("badge");
        return bd != null ? bd.optDouble(key, fallback) : fallback;
    }

    /** glyph → 实际绘制字符。`sym:<name>` ⇒ 本表语义映射（唯一来源）；未知 ⇒ null（不画，不静默画点）。 */
    private static String glyphToText(String glyph) {
        if (glyph == null || glyph.isEmpty()) return null;
        if (!glyph.startsWith("sym:")) return glyph;
        String n = glyph.substring(4);
        if ("house".equals(n) || "home".equals(n)) return "⌂";
        if ("message".equals(n) || "envelope".equals(n)) return "✉";
        if ("person".equals(n) || "mine".equals(n)) return "☺";
        return null;
    }

    private void rebuild() {
        if (wrapper != null) { parent.removeView(wrapper); wrapper = null; }
        // 内容区高：优先 contentHeight（= max(height, 内容块高)；字号大时撑高）——问题1/字号可变
        int barH = dp((float) specNum("contentHeight", specNum("height", 52)));
        barHeightPx = barH;
        final int onColor = specColor("brand", 0xFF5B5BD6);
        final int offColor = specColor("text3", 0xFF5F6673);
        final int surface = specColor("surface", 0xFFFFFFFF);
        final int lineColor = specColor("line", 0xFFDCDFE5);
        final int recColor = specColor("badgeBg", 0xFFD64545);

        wrapper = new android.widget.FrameLayout(ctx);
        android.widget.FrameLayout.LayoutParams wlp = new android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT, barH + bottomInsetPx);
        wlp.gravity = android.view.Gravity.BOTTOM;
        wrapper.setLayoutParams(wlp);
        // ★★安全区（inset）也是栏白底——否则内容区移到顶后，下方 inset 区露父容器底色（真机取证：
        //   露 #f5f6f8 灰），Web `.sa-tabbar` 的 padding-bottom 区是同色白底。
        wrapper.setBackgroundColor(surface);

        // 顶边框（Web: border-top 1px --sa-line）——含在 chrome 容器内（自持，不碰父级子视图）
        android.view.View line = new android.view.View(ctx);
        android.widget.FrameLayout.LayoutParams llp = new android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, dp(1f / 3f)));
        llp.gravity = android.view.Gravity.TOP;
        line.setLayoutParams(llp);
        line.setBackgroundColor(lineColor);
        wrapper.addView(line);

        bar = new android.widget.LinearLayout(ctx);
        bar.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        bar.setBackgroundColor(surface);
        android.widget.FrameLayout.LayoutParams blp = new android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT, barH);
        blp.gravity = android.view.Gravity.TOP;   // ★内容区在顶（安全区在下方作底色）
        bar.setLayoutParams(blp);
        wrapper.addView(bar);

        // I2-ALLOW: 宿主原生 chrome 的截面尺寸（图标行 44×22dp、图标偏移 6dp）——非内核几何（同旧壳）。
        final int iconSize = (int) Math.round(specNum("iconSize", 19));
        final int labelSize = (int) Math.round(specNum("labelSize", 10));
        final int badgeFont = (int) Math.round(badgeNum("fontSize", 11));
        final int badgeRadius = dp((float) badgeNum("radius", 8));
        final int badgePadX = dp((float) badgeNum("padX", 4));
        final int badgeOffX = dp((float) badgeNum("offsetX", 4)) + dp(6);
        final int badgeOffY = dp((float) badgeNum("offsetY", 4));

        for (final Item it : items) {
            android.widget.LinearLayout col = new android.widget.LinearLayout(ctx);
            col.setOrientation(android.widget.LinearLayout.VERTICAL);
            col.setGravity(android.view.Gravity.CENTER);
            col.setContentDescription(it.name);
            col.setClickable(true);

            android.widget.FrameLayout icWrap = new android.widget.FrameLayout(ctx);
            // ★★自适应（2026-10-11 · 用户："文字和图标变大，内容区上下间距也要保持一致"）：图标行高
            //   **由字号决定**（WRAP_CONTENT——此前硬编码 22dp，字号变大即裁切且块高不跟随）；
            //   col 仍 setGravity(CENTER) ⇒ 行高变化时上下间距自动保持相等（对齐 Web flex column）。
            icWrap.setLayoutParams(new android.widget.LinearLayout.LayoutParams(dp(44), android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
            String glyphText = glyphToText(it.glyph);
            if (glyphText != null) {
                android.widget.TextView ic = new android.widget.TextView(ctx);
                ic.setText(glyphText + "\uFE0E");   // 变体选择符：强制文本呈现（与 Web 线稿一致）
                ic.setTextSize(iconSize);
                ic.setGravity(android.view.Gravity.CENTER);
                ic.setTextColor(onColor);
                // ★关字体上下留白（默认 true 的 includeFontPadding 会让文字块上下不对称 ⇒ 居中偏差）
                ic.setIncludeFontPadding(false);
                icWrap.addView(ic, new android.widget.FrameLayout.LayoutParams(
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
            }
            if (it.badge > 0) {
                android.widget.TextView badge = new android.widget.TextView(ctx);
                badge.setTag("sa-badge");   // ★标记：restyle 必须**跳过角标**（否则白字被改成灰）
                badge.setText(it.badge > 99 ? "99+" : String.valueOf(it.badge));
                badge.setTextSize(badgeFont);
                badge.setTextColor(0xFFFFFFFF);
                badge.setGravity(android.view.Gravity.CENTER);
                android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
                bg.setColor(recColor);
                bg.setCornerRadius(badgeRadius);
                badge.setBackground(bg);
                badge.setPadding(badgePadX, 0, badgePadX, 0);
                android.widget.FrameLayout.LayoutParams blp2 = new android.widget.FrameLayout.LayoutParams(
                        android.view.ViewGroup.LayoutParams.WRAP_CONTENT, dp(16));
                blp2.gravity = android.view.Gravity.TOP | android.view.Gravity.CENTER_HORIZONTAL;
                blp2.leftMargin = badgeOffX;    // Web: left:50% + margin-left:4px
                blp2.topMargin = -badgeOffY;
                icWrap.addView(badge, blp2);
            }
            col.addView(icWrap);

            android.widget.TextView lab = new android.widget.TextView(ctx);
            lab.setText(it.label);
            lab.setTextSize(labelSize);
            lab.setGravity(android.view.Gravity.CENTER);
            lab.setTextColor(onColor);
            lab.setIncludeFontPadding(false);   // ★去字体上下留白（居中对称——见图标处说明）
            col.addView(lab);
            col.setLayoutParams(new android.widget.LinearLayout.LayoutParams(
                    0, android.view.ViewGroup.LayoutParams.MATCH_PARENT, 1f));
            col.setOnClickListener(new android.view.View.OnClickListener() {
                @Override public void onClick(android.view.View v) {
                    if (listener != null) listener.onTab(it.name);
                }
            });
            bar.addView(col);
        }
        parent.addView(wrapper);   // 后加 ⇒ 在内容之上（与旧壳同序）
    }

    private void restyle() {
        if (bar == null) return;
        final int onColor = specColor("brand", 0xFF5B5BD6);
        final int offColor = specColor("text3", 0xFF5F6673);
        for (int i = 0; i < bar.getChildCount() && i < items.size(); i++) {
            android.view.View col = bar.getChildAt(i);
            int tint = items.get(i).name.equals(current) ? onColor : offColor;
            tintCell(col, tint, 0);
        }
    }

    private void tintCell(android.view.View v, int color, int depth) {
        if ("sa-badge".equals(v.getTag())) return;   // 角标恒语义色
        if (v instanceof android.widget.TextView && depth > 0) {
            ((android.widget.TextView) v).setTextColor(color);
        }
        if (v instanceof android.view.ViewGroup) {
            android.view.ViewGroup g = (android.view.ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) tintCell(g.getChildAt(i), color, depth + 1);
        }
    }

    /** #rgb / #rrggbb / #rrggbbaa → ARGB（缺省黑）。 */
    private static int parseHex(String css) {
        try {
            String h = css.startsWith("#") ? css.substring(1) : css;
            if (h.length() == 3) h = "" + h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2) + "ff";
            if (h.length() == 6) h = h + "ff";
            long v = Long.parseLong(h, 16);
            long a = v & 0xFF, rgb = v >>> 8;
            return (int) ((a << 24) | rgb);
        } catch (Exception e) { return 0xFF000000; }
    }
}
