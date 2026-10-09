package dev.proteus.layoutcore;

// LaunchPlaceholder —— 启动占位层（决策 #724 · **对齐 iOS `ProteusLaunchPlaceholder` #694**）：
//   内容就绪前遮住 `contentHost`（其底色浅、但首帧前是空的）与窗口黑底，显示**项目背景色 + App 名 + 转圈 + 状态文案**。
//
// 【为什么需要（用户实测「安卓启动打开是黑屏一下，iOS 有加载提示」）】dev 首次拉 bundle 走网络；而
//   `contentHost` 在首帧渲染前无内容（窗口默认底色可能是黑）⇒ 直接露"黑屏一下"观感差。占位层底用与内容
//   同族的浅色（`#F5F6FA`，与 iOS/安卓 contentHost 同源）⇒ 启动到首帧是"浅色 → 内容"，而非"黑 → 内容"。
//
// 【与 iOS 的一致性】App 名 / 转圈色（品牌 `#5B5BD6`）/ 文案（dev 显示"正在连接开发服务器…"、release"正在启动…"）
//   / 失败态（停转圈 + 改文案，**保留占位不露黑底**）逐项对齐 iOS。

import android.app.Activity;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

final class LaunchPlaceholder {
    /** 与内容同族的页面底色（对齐 iOS `ProteusBrandColor.pageBackground`）。 */
    static final int PAGE_BACKGROUND = 0xFFF5F6FA;
    /** 品牌色（对齐 iOS `ProteusBrandColor.brand`）。 */
    static final int BRAND = 0xFF5B5BD6;

    private final LinearLayout box;
    private final ProgressBar spinner;
    private final TextView hint;

    LaunchPlaceholder(Activity act, String appName, boolean dev) {
        final float d = act.getResources().getDisplayMetrics().density;

        LinearLayout col = new LinearLayout(act);
        col.setOrientation(LinearLayout.VERTICAL);
        // ★★**整块内容居中**（对齐 iOS `ProteusLaunchPlaceholder` 的 centerX/centerY 约束）——
        //   此前只 `CENTER_HORIZONTAL` ⇒ 内容贴顶（用户实测"能放屏幕中间吗"）。`CENTER` = 水平+垂直居中。
        col.setGravity(Gravity.CENTER);
        col.setBackgroundColor(PAGE_BACKGROUND);

        TextView title = new TextView(act);
        title.setText(appName == null || appName.isEmpty() ? "Proteus" : appName);
        title.setTextColor(0xFF1F2430);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        col.addView(title);

        spinner = new ProgressBar(act);
        int sz = (int) (32 * d);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(sz, sz);
        sp.topMargin = (int) (12 * d);
        col.addView(spinner, sp);
        // ★把转圈染成品牌色（原生 ProgressBar 默认随主题色，非品牌蓝）
        try { spinner.getIndeterminateDrawable().setTint(BRAND); } catch (Throwable ignored) { }

        hint = new TextView(act);
        hint.setText(dev ? "正在连接开发服务器…" : "正在启动…");
        hint.setTextColor(0xFF5F6673);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        hint.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        hp.topMargin = (int) (12 * d);
        col.addView(hint, hp);

        box = col;
    }

    /** 挂到某个容器（铺满；置于最上层）。 */
    void attach(FrameLayout parent) {
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
        parent.addView(box, lp);
        box.bringToFront();
    }

    /** 内容已上屏 ⇒ 撤占位（黑底/白底不再可见）。 */
    void remove() {
        View parent = (View) box.getParent();
        if (parent instanceof android.view.ViewGroup) ((android.view.ViewGroup) parent).removeView(box);
    }

    /** 加载失败：停转圈 + 改文案（**保留占位**——不露黑底；用户看到"明确失败"而非黑屏）。对齐 iOS `fail`。 */
    void fail(String msg) {
        spinner.setVisibility(View.GONE);
        hint.setText(msg);
        hint.setTextColor(0xFFC0392B);
    }
}
