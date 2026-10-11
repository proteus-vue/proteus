package dev.proteus.layoutcore;

import android.app.Activity;
import android.os.Bundle;
import android.widget.FrameLayout;

/**
 * ★★★自研液态玻璃的**独立真机夹具**（决策 #818 P2 验收）：手写几条 Cmd 当"背后内容"（彩色块），
 *   再用一块带 `glass` 规格的节点量玻璃面 —— 宿主 `ProteusHostView` 会捕获"无玻璃面"的内容帧，
 *   用 AGSL( RuntimeShader ) 采样做 blur+tint，画玻璃面。`adb screencap` 看"内容透过玻璃模糊"即通过。
 *
 * <p>独立 Activity（非 superapp 全流程）——绕开 superapp 启动/截图复杂度，最小成本验 AGSL 玻璃面。
 *   全屏模式复刻 L4Activity（同类问题一处一种解法）。</p>
 */
public class GlassActivity extends Activity {

    private static final float U = 3f; // 声明单位 → 设备 px（本机 density 3.0）
    private static final int BG = 0xFF101018;

    private boolean glassFullscreenPending = false;

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
        final int W = sz.x, H = sz.y;

        java.util.List<ProteusHostView.Cmd> cmds = new java.util.ArrayList<>();
        java.util.List<Integer> ids = new java.util.ArrayList<>();
        int nid = 0;

        // ── ① "背后内容"：满屏彩色块（供玻璃模糊）──
        int[] palette = {0xFF3B6FE0, 0xFFE0577B, 0xFF2FB98A, 0xFFE0A93B, 0xFF7B57E0, 0xFF2FA0E0};
        final float cellW = W / 3f, cellH = H / 5f;
        for (int r = 0; r < 5; r++) {
            for (int c = 0; c < 3; c++) {
                cmds.add(new ProteusHostView.Cmd(c * cellW, r * cellH, cellW, cellH,
                        palette[(r * 3 + c) % palette.length], null, 0f, 0, 0f));
                ids.add(nid++);
            }
        }
        // 中央一行白字（透明底——`0x00000000`；文字用白色 0xFFFFFFFF）
        cmds.add(new ProteusHostView.Cmd(24 * U, H / 2f - 40 * U, W - 48 * U, 40 * U, 0x00000000,
                "玻璃背后的内容 CONTENT BEHIND GLASS", 22 * U, 0xFFFFFFFF, 0f));
        ids.add(nid++);

        // ── ② 玻璃面：一块带 glass 规格的节点（悬浮在内容之上）──
        final int glassId = nid++;
        cmds.add(new ProteusHostView.Cmd(32 * U, H / 3f, W - 64 * U, H / 4f, 0x00000000, null, 0f, 0, 24 * U));
        ids.add(glassId);
        // 玻璃面内的白字（画在玻璃之上——玻璃在其下）
        cmds.add(new ProteusHostView.Cmd(32 * U, H / 3f, W - 64 * U, 40 * U, 0, "自研液态玻璃 · AGSL", 26 * U, 0xFFFFFFFF, 0f));
        ids.add(nid++);

        final ProteusHostView scene = new ProteusHostView(this);
        int[] idArr = new int[ids.size()];
        for (int i = 0; i < idArr.length; i++) idArr[i] = ids.get(i);
        scene.setCmdNodeIds(idArr);
        scene.setCmds(cmds);
        // ★玻璃规格（= 内核 GlassSpec 同形）：blur 24 / tint #ffffff26 / radius 24 / border / saturation 1.8
        java.util.Map<Integer, GlassMaterial.Spec> glassMap = new java.util.HashMap<>();
        glassMap.put(glassId, new GlassMaterial.Spec(24f, 0x26FFFFFF, 24f, true, 1.8f));
        scene.setGlassNodes(glassMap);
        scene.setBackgroundColor(BG);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(W, H);
        root.addView(scene, lp);
    }
}
