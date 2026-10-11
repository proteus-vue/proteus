package dev.proteus.layoutcore;

import android.app.Activity;
import android.os.Bundle;
import android.widget.FrameLayout;

/**
 * ★★★自研液态玻璃的**独立真机夹具**（决策 #818 P2 验收 · #831 滚动/胶囊）：
 *   · **模拟页面内容**（可滚动的一列卡片）——用来观察"内容滑过玻璃"的观感；
 *   · **两种玻璃对比**：① 底部**圆角胶囊**（pill，radius=h/2，类 tab 栏）；② 中部**圆形**（circle，radius=min/2）；
 *   · 每帧让内容缓慢上滚 → 玻璃下的内容随之变化（背后内容经模糊/边缘折射）。
 *
 * <p>独立 Activity（非 superapp 全流程）——绕开 superapp 启动/截图复杂度，最小成本验 AGSL 玻璃。
 *   全屏模式复刻 L4Activity（同类问题一处一种解法）。</p>
 */
public class GlassActivity extends Activity {

    private static final float U = 3f;
    private static final int BG = 0xFF0E0E14;

    private boolean glassFullscreenPending = false;
    private ProteusHostView scene;
    private int W, H;
    /** 滚动偏移（每帧递增，让内容滑过玻璃） */
    private float scrollOff = 0f;
    private static final int ROW_H = 150;
    private static final int ROW_GAP = 14;
    private static final int ROWS = 24;
    private static final int[] PALETTE = {0xFF3B6FE0, 0xFFE0577B, 0xFF2FB98A, 0xFFE0A93B, 0xFF7B57E0, 0xFF2FA0E0, 0xFFD2694A, 0xFF4AC2B0};

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            scrollOff += 2.2f;
            float cycle = ROWS * (ROW_H + ROW_GAP);
            if (scrollOff > cycle) scrollOff -= cycle;
            render();
            scene.postInvalidateOnAnimation();
            scene.postOnAnimation(this);
        }
    };

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && glassFullscreenPending && android.os.Build.VERSION.SDK_INT >= 30) {
            glassFullscreenPending = false;
            android.view.WindowInsetsController wic = getWindow().getInsetsController();
            if (wic != null) {
                wic.hide(android.view.WindowInsets.Type.statusBars());
                wic.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN,
                android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (android.os.Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        android.view.WindowManager.LayoutParams a0 = getWindow().getAttributes();
        a0.layoutInDisplayCutoutMode =
                android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        getWindow().setAttributes(a0);
        glassFullscreenPending = true;

        FrameLayout root = new FrameLayout(this);
        setContentView(root);
        root.setBackgroundColor(BG);

        android.graphics.Point sz = new android.graphics.Point();
        getWindowManager().getDefaultDisplay().getRealSize(sz);
        W = sz.x; H = sz.y;

        scene = new ProteusHostView(this);
        scene.setBackgroundColor(BG);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(W, H);
        root.addView(scene, lp);

        render();
        scene.postOnAnimation(tick);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (scene != null) scene.removeCallbacks(tick);
    }

    /** 重建 cmds：滚动内容 + 固定的两块玻璃（胶囊 pill + 圆形 circle）。 */
    private void render() {
        java.util.List<ProteusHostView.Cmd> cmds = new java.util.ArrayList<>();
        java.util.List<Integer> ids = new java.util.ArrayList<>();
        int nid = 0;

        // ── 模拟页面内容：一列卡片（随 scrollOff 上滚）──
        int contentH = ROWS * (ROW_H + ROW_GAP);
        for (int i = 0; i < ROWS; i++) {
            float y = i * (ROW_H + ROW_GAP) - scrollOff;
            // 循环：滚出顶部后从底部接上（无缝长列表观感）
            if (y < -ROW_H) y += contentH;
            if (y > H + ROW_H) continue;
            float x = 20 * U, w = W - 40 * U, h = ROW_H;
            int col = PALETTE[i % PALETTE.length];
            cmds.add(new ProteusHostView.Cmd(x, y, w, h, col, "行 " + (i + 1) + " · 模拟页面内容", 15 * U, 0xFFFFFFFF, 18 * U));
            ids.add(nid++);
        }

        // ── 玻璃 ①：底部**圆角胶囊 pill**（radius = h/2，类 tab 栏）──
        float pillX = 18 * U, pillW = W - 36 * U, pillH = 116, pillY = H - pillH - 60 * U, pillR = pillH / 2f;
        cmds.add(new ProteusHostView.Cmd(pillX, pillY, pillW, pillH, 0x00000000, null, 0f, 0, pillR));
        int pillId = nid++; ids.add(pillId);

        // ── 玻璃 ②：中部**圆形**（radius = min/2）──
        float circ = 300 * U, circX = (W - circ) / 2f, circY = H * 0.30f - circ / 2f, circR = circ / 2f;
        cmds.add(new ProteusHostView.Cmd(circX, circY, circ, circ, 0x00000000, null, 0f, 0, circR));
        int circId = nid++; ids.add(circId);

        // ── 圆形玻璃内的文字（在玻璃之上，证明玻璃在文字下）──
        cmds.add(new ProteusHostView.Cmd(circX, circY + circ / 2f - 20 * U, circ, 40 * U, 0, "圆形玻璃", 20 * U, 0xFFFFFFFF, 0f));
        ids.add(nid++);

        int[] idArr = new int[ids.size()];
        for (int i = 0; i < idArr.length; i++) idArr[i] = ids.get(i);
        scene.setCmdNodeIds(idArr);
        scene.setCmds(cmds);

        java.util.Map<Integer, GlassMaterial.Spec> glassMap = new java.util.HashMap<>();
        // 胶囊（类 tab 栏）：blur 20 / tint #ffffff26 / border / sat 1.0
        glassMap.put(pillId, new GlassMaterial.Spec(20f, 0x26FFFFFF, pillR, true, 1.0f));
        // 圆形：blur 16 / 稍厚
        glassMap.put(circId, new GlassMaterial.Spec(16f, 0x33FFFFFF, circR, true, 1.0f));
        scene.setGlassNodes(glassMap);
    }
}
