package dev.proteus.layoutcore;

import android.app.Activity;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;

/**
 * ★★**墨绘·山水卷独立应用**（`dev.proteus.ink`）——「点开就一直演」的分享版
 * （2026-10-01 · 第四个节目；与灯光秀/翻折剧场演示壳**同构**，只换节目名与报告名）。
 *
 * 【与其他壳的关系】`MainActivity` = 测试壳（广播触发 + 报告）；`LightsDemoActivity` /
 *   `FlipDemoActivity` / 本类 = 演示壳（全屏 + 循环）。四者共用同一份 `LightsHost` 节目驱动——
 *   差别只在 `programKind` / `reportFile` / `loop` 三个参数（见 `MainActivity.startProgramShow`）。
 */
public final class InkDemoActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF141C26); // 与 JS 树的幕布底色同值（卷轴外的留白）
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        final FrameLayout rootRef = root;
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
            public void run() { MainActivity.startProgramShow(InkDemoActivity.this, rootRef, "ink", "ink.json", true); }
        }, 200);
    }
}
