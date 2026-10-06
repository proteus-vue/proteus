package dev.proteus.layoutcore;

import android.app.Activity;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;

/**
 * ★★**翻牌剧场独立应用**（`dev.proteus.flip`）——「点开就一直演」的分享版
 * （2026-10-01 · 第三个节目；与灯光秀演示壳**同构**，只换节目名与报告名）。
 *
 * 【与其他两个壳的关系】`MainActivity` = 测试壳（广播触发 + 报告）；`LightsDemoActivity` /
 *   本类 = 演示壳（全屏 + 循环）。三者共用同一份 `LightsHost` 节目驱动——
 *   差别只在 `programKind` / `reportName` / `loop` 三个参数（见 `MainActivity.lightsRun`）。
 */
public final class FlipDemoActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF05060A); // 与 JS 树的舞台底色同值
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        final FrameLayout rootRef = root;
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
            public void run() { MainActivity.startProgramShow(FlipDemoActivity.this, rootRef, "flip", "flip.json", true); }
        }, 200);
    }
}
