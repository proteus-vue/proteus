package dev.proteus.layoutcore;

import android.app.Activity;
import android.os.Bundle;
import android.view.MotionEvent;
import android.widget.FrameLayout;

/**
 * ★★★自研液态玻璃的**独立真机夹具**（决策 #818/#831）：**可手动滚动的模拟页面** + 两块玻璃对比。
 *   · 24 行彩色卡片 = 模拟页面内容；**手指拖拽滚动**（走宿主内置 `setContentScrollY`）；
 *   · 玻璃节点标 **fixed**（滚动时钉在屏上）⇒ 内容在其下滚动、玻璃采样背后内容；
 *   · 底部**圆角胶囊**（pill，r=h/2，类 tab 栏）+ 中部**圆形**（circle，r=min/2）。
 */
public class GlassActivity extends Activity {

    private static final float U = 3f;
    // ★决策 #846：页面底色改为**白色**（用户要求：与鸿蒙夹具同口径，并核验玻璃两侧黑块问题）。
    private static final int BG = 0xFFFFFFFF;

    private boolean glassFullscreenPending = false;
    private ProteusHostView scene;
    private int W, H;
    private float scrollY = 0f;
    private float lastY = 0f;
    private boolean dragging = false;
    private static final int ROW_H = 150, ROW_GAP = 14, ROWS = 24;
    private static final int[] PALETTE = {0xFF3B6FE0, 0xFFE0577B, 0xFF2FB98A, 0xFFE0A93B, 0xFF7B57E0, 0xFF2FA0E0, 0xFFD2694A, 0xFF4AC2B0};
    private float contentH() { return ROWS * (ROW_H + ROW_GAP); }

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
        root.addView(scene, new FrameLayout.LayoutParams(W, H));

        buildCmds();

        // ★手动滚动：手指拖拽 → 宿主内置滚动（玻璃为 fixed 节点，钉在屏上）
        scene.setOnTouchListener(new android.view.View.OnTouchListener() {
            @Override public boolean onTouch(android.view.View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN: dragging = true; lastY = e.getY(); return true;
                    case MotionEvent.ACTION_MOVE:
                        if (dragging) {
                            float dy = e.getY() - lastY; lastY = e.getY();
                            scrollY -= dy;
                            float max = Math.max(0, contentH() - H);
                            if (scrollY < 0) scrollY = 0;
                            if (scrollY > max) scrollY = max;
                            scene.setContentScrollY((int) scrollY);
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL: dragging = false; return true;
                    default: return false;
                }
            }
        });
    }

    /** 建 cmds（只建一次；滚动由宿主 translate，玻璃 fixed）。 */
    private void buildCmds() {
        java.util.List<ProteusHostView.Cmd> cmds = new java.util.ArrayList<>();
        java.util.List<Integer> ids = new java.util.ArrayList<>();
        int nid = 0;

        // 模拟页面内容：24 行卡片（自然坐标，滚动交给宿主）
        for (int i = 0; i < ROWS; i++) {
            float y = i * (ROW_H + ROW_GAP) + 20 * U;
            int col = PALETTE[i % PALETTE.length];
            cmds.add(new ProteusHostView.Cmd(20 * U, y, W - 40 * U, ROW_H, col, "行 " + (i + 1) + " · 模拟页面内容", 15 * U, 0xFFFFFFFF, 18 * U));
            ids.add(nid++);
        }

        // 玻璃 ①：底部圆角胶囊
        float pillW = W - 36 * U, pillH = 116, pillX = 18 * U, pillY = H - pillH - 60 * U, pillR = pillH / 2f;
        cmds.add(new ProteusHostView.Cmd(pillX, pillY, pillW, pillH, 0x00000000, null, 0f, 0, pillR));
        int pillId = nid++; ids.add(pillId);

        // 玻璃 ②：中部圆形
        float circ = 300 * U;
        float circX = (W - circ) / 2f, circY = H * 0.29f - circ / 2f, circR = circ / 2f;
        cmds.add(new ProteusHostView.Cmd(circX, circY, circ, circ, 0x00000000, null, 0f, 0, circR));
        int circId = nid++; ids.add(circId);
        cmds.add(new ProteusHostView.Cmd(circX, circY + circ / 2f - 20 * U, circ, 40 * U, 0, "圆形玻璃", 20 * U, 0xFFFFFFFF, 0f));
        int circTextId = nid++; ids.add(circTextId);

        // ★B4 前景材质验证（决策 #834）：与 iOS 夹具同形——发光块（验分层曲线内核单源）
        //   + 渐变砖（验 CSS 端点式）。放在滚动内容的顶层，随内容滚（玻璃钉住）。
        cmds.add(new ProteusHostView.Cmd(20 * U, 20 * U, 96 * U, 60 * U, 0xFF20B0C0, null, 0f, 0, 12 * U,
                null, new float[]{0xFF66FFCC, 18 * U, 0.9f}, null));
        ids.add(nid++);
        cmds.add(new ProteusHostView.Cmd(130 * U, 20 * U, 120 * U, 60 * U, 0xFF000000, null, 0f, 0, 8 * U,
                new ProteusHostView.GradSpec(1, 45.0f, 0.5f, 0.5f, 1.0f,
                        new int[]{0xFFFF5A3C, 0xFF3C78FF}, new float[]{0.0f, 1.0f}, null, null, null),
                null, null));
        ids.add(nid++);

        int[] idArr = new int[ids.size()];
        for (int i = 0; i < idArr.length; i++) idArr[i] = ids.get(i);
        scene.setCmdNodeIds(idArr);
        scene.setCmds(cmds);

        // ★玻璃节点 = fixed（滚动时钉在屏上；内容在其下滚动）——见 ProteusHostView.fixedAnchorOf
        java.util.Set<Integer> fixed = new java.util.HashSet<>();
        fixed.add(pillId); fixed.add(circId); fixed.add(circTextId);
        scene.setFixedNodes(fixed);

        java.util.Map<Integer, GlassMaterial.Spec> glassMap = new java.util.HashMap<>();
        glassMap.put(pillId, new GlassMaterial.Spec(20f, 0x26FFFFFF, pillR, true, 1.0f));
        glassMap.put(circId, new GlassMaterial.Spec(16f, 0x33FFFFFF, circR, true, 1.0f));
        scene.setGlassNodes(glassMap);
    }
}
