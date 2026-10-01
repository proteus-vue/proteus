package dev.proteus.layoutcore;

import android.app.Activity;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;

/**
 * ★★**手卷探索独立应用**（`dev.proteus.inkscroll`）——「打开即用手指拖动展开手卷」
 * （2026-10-01 · 长卷探索模式；与其它演示壳**同构**，只换节目名）。
 *
 * 【玩法】横向**拖动手指** = 卷筒滚动展开手卷：
 *   · 往左拖 → 卷筒右→左滚，墨幕被卷开，左半边景象随之显现/落笔；
 *   · 往右拖 → 卷回去。
 *   ★与幕序演出（时间驱动）完全不同：本模式**没有自动播放**——画面完全由手势的
 *     实时位置驱动（内核 `seek_scroll` 换算，零 JS 参与）。
 */
public final class InkScrollDemoActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF141C26); // 与幕布底色同值
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        final FrameLayout rootRef = root;
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
            public void run() {
                MainActivity.startProgramShow(InkScrollDemoActivity.this, rootRef, "inkScroll", "ink-scroll.json", false);
            }
        }, 200);
    }
}
