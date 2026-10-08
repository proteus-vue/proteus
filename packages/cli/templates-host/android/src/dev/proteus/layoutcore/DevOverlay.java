package dev.proteus.layoutcore;

// DevOverlay —— dev 变体的**开发可视化层**（决策 #671）：① 右上角持久 "DEV" 角标（对齐 Flutter 的 DEBUG 缎带）
//   ② 热重载瞬时提示（"⟳ 已热重载 · vN · 屏名"，约 1.5s 后自动淡出）。
//
// 【为什么在壳（模板）而不是 AAR】这是**开发期给"人"看的 chrome**（非渲染/非内核）——与 tab 栏同类，
//   属项目壳的关注点；且 release 变体 **完全不创建**（`ProteusBuildConfig.DEV=false` ⇒ attach 直接返回）⇒
//   正式包零残留（与"dev 通道编译进来、release 编译掉"同一变体模型）。
//
// 【诚实边界】仅 Android（iOS/鸿蒙 dev 通道尚未接线，见 host-runtime-package-plan.md）。
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
import android.widget.TextView;

final class DevOverlay {
    private final Activity act;
    private final FrameLayout root;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private TextView badge;
    private TextView toast;
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

    /** 仅 dev 变体创建（release 直接返回 ⇒ 零残留）。root 已 setContentView，故本层叠加在最上。 */
    void attach() {
        if (!ProteusBuildConfig.DEV) return;
        final float density = act.getResources().getDisplayMetrics().density;
        int pad = (int) (6 * density);

        // ① 右上角 "DEV" 角标
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
        ui.postDelayed(hideToast, 1500);
    }

    private int statusBarHeight() {
        int id = act.getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? act.getResources().getDimensionPixelSize(id) : (int) (24 * act.getResources().getDisplayMetrics().density);
    }
}
