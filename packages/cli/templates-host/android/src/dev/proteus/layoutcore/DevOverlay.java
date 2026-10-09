package dev.proteus.layoutcore;

// DevOverlay —— dev 变体的**开发可视化层**（决策 #671/#719）：① 右上角持久 "DEV" 角标（**可点**展开底部菜单）
//   ② 热重载瞬时提示（约 1.5s 后自动淡出）③ ★决策 #719：底部调试面板——「渲染状态」提示（有就地编辑时
//   标**非项目代码效果**）+ **重置为项目代码**按钮（对齐 iOS `ProteusDevOverlay`，#704）。
//
// 【为什么在壳（模板）而不是 AAR】这是**开发期给"人"看的 chrome**（非渲染/非内核）——与 tab 栏同类，
//   属项目壳的关注点；且 release 变体 **完全不创建**（`ProteusBuildConfig.DEV=false` ⇒ attach 直接返回）⇒
//   正式包零残留（与"dev 通道编译进来、release 编译掉"同一变体模型）。
//
// 【诚实边界】仅 Android（iOS 对齐见 ProteusDevOverlay.swift · 决策 #704；鸿蒙 dev 通道另立里程碑）。
//   ★已生成的老宿主不会自动获得本文件 + AppActivity 的那行调用 ⇒ 需重生成宿主
//     （rm -rf dist/app/android/host 后 `proteus dev/build --package` 会重新 scaffold）。

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

final class DevOverlay {
    private final Activity act;
    private final FrameLayout root;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private TextView badge;
    private TextView toast;
    /** ★底部调试面板（决策 #719）：tap DEV 角标展开/收起。 */
    private LinearLayout sheet;
    private TextView statusLabel;
    private boolean sheetOn = false;
    /** 是否有**就地编辑**未还原（决定"渲染状态"提示与角标配色）。 */
    private boolean edited = false;
    /** 重置回调（壳注入）：恢复"项目代码的实时效果"。 */
    private Runnable resetAction;
    /** 面板 URL（壳注入，展示用）。 */
    private String panelUrl = "";

    private final Runnable hideToast = new Runnable() {
        @Override public void run() {
            if (toast != null) toast.animate().alpha(0f).setDuration(220)
                    .withEndAction(new Runnable() { @Override public void run() {
                        if (toast != null) toast.setVisibility(View.GONE);
                    } }).start();
        }
    };

    DevOverlay(Activity act, FrameLayout root) {
        this.act = act;
        this.root = root;
    }

    /** ★注入"重置为项目代码"动作（决策 #719，壳调；与面板 `/cmd reset` 同一实现）。 */
    void setResetAction(Runnable r) { this.resetAction = r; }

    /** ★注入面板 URL（决策 #719，展示用）。 */
    void setPanelUrl(String url) { this.panelUrl = url == null ? "" : url; }

    /** 仅 dev 变体创建（release 直接返回 ⇒ 零残留）。root 已 setContentView，故本层叠加在最上。 */
    void attach() {
        if (!ProteusBuildConfig.DEV) return;
        final float density = act.getResources().getDisplayMetrics().density;
        int pad = (int) (6 * density);

        // ① 右上角 "DEV" 角标（可点 ⇒ 展开底部调试面板）
        badge = new TextView(act);
        badge.setText("DEV");
        badge.setTextColor(Color.WHITE);
        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        badge.setTypeface(badge.getTypeface(), android.graphics.Typeface.BOLD);
        badge.setLetterSpacing(0.08f);
        badge.setPadding(pad + pad / 2, pad / 2, pad + pad / 2, pad / 2);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xCC2F6BFF);              // 半透明品牌蓝
        bg.setCornerRadius(40 * density);     // 胶囊
        badge.setBackground(bg);
        badge.setElevation(6 * density);
        badge.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { toggleSheet(); }
        });
        FrameLayout.LayoutParams blp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        blp.gravity = Gravity.TOP | Gravity.END;
        blp.topMargin = statusBarHeight() + (int) (6 * density);
        blp.rightMargin = (int) (10 * density);
        root.addView(badge, blp);

        // ② 热重载瞬时提示（初始隐藏；flash() 时显示 + 1.5s 后淡出）
        toast = new TextView(act);
        toast.setTextColor(Color.WHITE);
        toast.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        toast.setPadding(pad + pad / 2, pad, pad + pad / 2, pad);
        GradientDrawable tbg = new GradientDrawable();
        tbg.setColor(0xE61F2430);             // 深色胶囊
        tbg.setCornerRadius(24 * density);
        toast.setBackground(tbg);
        toast.setElevation(8 * density);
        toast.setVisibility(View.GONE);
        FrameLayout.LayoutParams tlp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        tlp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        tlp.topMargin = statusBarHeight() + (int) (40 * density);  // 在 DEV 角标下方
        root.addView(toast, tlp);
    }

    /** 显示一条瞬时提示（约 1.5s 后自动淡出）；非 dev（未 attach）时为空操作。 */
    void flash(String msg) {
        if (toast == null) return;
        ui.removeCallbacks(hideToast);
        toast.setText(msg);
        toast.setAlpha(1f);
        toast.setVisibility(View.VISIBLE);
        toast.bringToFront();
        if (badge != null) badge.bringToFront();   // 角标始终在提示之上
        if (sheet != null && sheetOn) sheet.bringToFront();
        ui.postDelayed(hideToast, 1500);
    }

    /** ★标注"是否有就地编辑"（决策 #719）——有 ⇒ 角标转琥珀 + 面板显示"非项目代码效果"。 */
    void setEdited(boolean edited) {
        this.edited = edited;
        if (badge == null) return;
        badge.setText(edited ? "DEV ✎" : "DEV");
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(edited ? 0xE6E08A00 : 0xCC2F6BFF);   // 琥珀（有未还原编辑） / 品牌蓝
        bg.setCornerRadius(40 * act.getResources().getDisplayMetrics().density);
        badge.setBackground(bg);
        if (sheetOn) refreshStatus();
    }

    private void refreshStatus() {
        if (statusLabel == null) return;
        statusLabel.setText(edited ? "⚠ 渲染状态：含就地编辑 — 非项目代码效果" : "渲染状态：项目代码（实时）");
        statusLabel.setTextColor(edited ? 0xFFFFC24D : Color.WHITE);
    }

    private void toggleSheet() { if (sheetOn) hideSheet(); else showSheet(); }

    private void showSheet() {
        final float density = act.getResources().getDisplayMetrics().density;
        if (sheet == null) buildSheet(density);
        if (sheet == null) return;
        sheetOn = true;
        refreshStatus();
        sheet.setVisibility(View.VISIBLE);
        sheet.bringToFront();
        if (badge != null) badge.bringToFront();
        // ★首帧尚未 layout ⇒ getHeight()=0；post 到 layout 之后再滑入（否则动画是空操作）
        sheet.setTranslationY(sheet.getHeight() > 0 ? sheet.getHeight() : 600 * density);
        sheet.post(new Runnable() { @Override public void run() {
            if (sheet != null && sheetOn) sheet.animate().translationY(0f).setDuration(220).start();
        } });
    }

    private void hideSheet() {
        if (sheet == null) return;
        sheetOn = false;
        float h = sheet.getHeight() > 0 ? sheet.getHeight() : 600 * act.getResources().getDisplayMetrics().density;
        sheet.animate().translationY(h).setDuration(200)
                .withEndAction(new Runnable() { @Override public void run() {
                    if (sheet != null) sheet.setVisibility(View.GONE);
                } }).start();
        if (badge != null) badge.bringToFront();
    }

    /** 底部调试面板：状态行 + 「重置为项目代码」+ 面板 URL 提示（对齐 iOS `buildSheet`）。
     *   ★逐像素规格（决策 #734）：sheet 圆角 **16 仅上两角** + `grab` 把手（36×4 r2 白20% top8）——
     *   此前 sheet **无圆角**、无把手（与 iOS 不一致，用户抓出）。 */
    private void buildSheet(float density) {
        int pad = (int) (18 * density);
        LinearLayout s = new LinearLayout(act);
        s.setOrientation(LinearLayout.VERTICAL);
        // sheet 圆角（仅上两角 16dp；下两角 0）——对齐 iOS `maskedCorners=[MinXMinY,MaxXMinY]`
        GradientDrawable sbg = new GradientDrawable();
        sbg.setColor(0xFA151820);   // 对齐 iOS sheet 底色 `#151820` α0.98
        float r16 = 16 * density;
        sbg.setCornerRadii(new float[]{ r16, r16, r16, r16, 0, 0, 0, 0 });
        s.setBackground(sbg);
        s.setPadding(pad, 0, pad, pad);
        s.setElevation(12 * density);

        // grab 把手（对齐 iOS：36×4、圆角2、白 20%、top 8、水平居中）
        View grab = new View(act);
        GradientDrawable gbg = new GradientDrawable();
        gbg.setColor(0x33FFFFFF);
        gbg.setCornerRadius(2 * density);
        grab.setBackground(gbg);
        LinearLayout.LayoutParams glp = new LinearLayout.LayoutParams((int) (36 * density), (int) (4 * density));
        glp.gravity = Gravity.CENTER_HORIZONTAL;
        glp.topMargin = (int) (8 * density);
        s.addView(grab, glp);

        TextView title = new TextView(act);
        title.setText("DevTools");
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        tlp.topMargin = (int) (12 * density);   // title top = grab 底 + 12（对齐 iOS）
        s.addView(title, tlp);

        statusLabel = new TextView(act);
        statusLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        slp.topMargin = (int) (8 * density);
        s.addView(statusLabel, slp);

        TextView reset = new TextView(act);
        reset.setText("重置为项目代码");
        reset.setTextColor(Color.WHITE);
        reset.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        reset.setTypeface(reset.getTypeface(), android.graphics.Typeface.BOLD);
        reset.setGravity(Gravity.CENTER);
        GradientDrawable rbg = new GradientDrawable();
        rbg.setColor(0xFF2F6BFF);
        rbg.setCornerRadius(10 * density);
        reset.setBackground(rbg);
        reset.setPadding(0, (int) (12 * density), 0, (int) (12 * density));
        reset.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (resetAction != null) resetAction.run();
                hideSheet();
            }
        });
        LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        rlp.topMargin = (int) (14 * density);
        s.addView(reset, rlp);

        TextView url = new TextView(act);
        url.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        url.setTextColor(0x80FFFFFF);
        url.setText(panelUrl == null || panelUrl.isEmpty()
                ? "面板：浏览器打开 dev server 地址"
                : "面板：" + panelUrl + "（浏览器打开·元素高亮/就地编辑/REPL）");
        LinearLayout.LayoutParams ulp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        ulp.topMargin = (int) (12 * density);
        s.addView(url, ulp);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        lp.gravity = Gravity.BOTTOM;
        s.setVisibility(View.GONE);
        root.addView(s, lp);
        sheet = s;
    }

    private int statusBarHeight() {
        int id = act.getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? act.getResources().getDimensionPixelSize(id) : (int) (24 * act.getResources().getDisplayMetrics().density);
    }
}
