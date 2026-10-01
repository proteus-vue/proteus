package dev.proteus.layoutcore;

import android.app.Activity;
import android.content.res.Configuration;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;

/**
 * ★★**手卷浏览独立应用**（`dev.proteus.inkscroll`）——「打开即用手指横扫千山万水」
 * （2026-10-01 · 宽卷横移模式；与其它演示壳**同构**，只换节目名）。
 *
 * 【玩法】横向**拖动手指** = 画卷平移（画布 3.2 屏宽——手指 1:1 跟手）：
 *   · 往左拖 → 看右侧景象；抛滑（松手带速度）→ 平台 `OverScroller` 惯性；
 *   · 两端**卷轴固定在视口边缘**（画面从轴下穿过，像真手卷）。
 *   ★与幕序演出（时间驱动）完全不同：本模式**没有自动播放**——画面由手势实时驱动
 *     （内核 `seek_scroll` 换算 + 宿主画布平移，零 JS 参与）。环境动效（月辉/风摆/荡漾）
 *     是无限循环，浏览静态长卷时画面"活着"。
 *
 * 【旋转重挂（2026-10-01）】manifest 的 `configChanges` 吞掉旋转（不重启 Activity），
 *   而树是**按 portrait 视口建的** ⇒ 旋转后画面仍是竖屏几何（拉宽/错位）。
 *   ⇒ 本壳在 `onConfigurationChanged` 里**停旧宿主 + 按新视口重挂**（用户实测横屏体验
 *     差的一部分就是"横过来还是竖屏构图"）。
 */
public final class InkScrollDemoActivity extends Activity {

    /** 当前宿主（旋转重挂时先停它——帧循环唯一驱动，停了就不再有帧回调） */
    private LightsHost host;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF141C26); // 与纸面底色同源（旋转/重挂瞬间不闪白）
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        mountProgram(root);
    }

    private void mountProgram(final FrameLayout root) {
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
            public void run() {
                host = MainActivity.startProgramShow(InkScrollDemoActivity.this, root, "inkScroll", "ink-scroll.json", false);
            }
        }, 200);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // ① 停旧帧循环（`running=false` ⇒ 下一帧自然退出；不写报告——旋转不是"演完"）
        if (host != null) host.markStop();
        // ② 清空 root（旧视图的绘制/手势通路一并移除）→ 按**新视口**重挂
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF141C26);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        android.util.Log.i("proteus", "手卷演示：旋转重挂（新视口 "
                + getResources().getDisplayMetrics().widthPixels + "x"
                + getResources().getDisplayMetrics().heightPixels + "）");
        mountProgram(root);
    }
}
