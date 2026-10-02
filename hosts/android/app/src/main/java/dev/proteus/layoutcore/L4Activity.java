package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/L4Activity.java
// ★★L4 观测夹具（Android 端）——**独立 Activity**（与 LightsDemoActivity / FlipDemoActivity /
//   InkDemoActivity / InkScrollDemoActivity 同一模式：每场景一 Activity，互不干扰）。
//
// 【为什么必须是独立 Activity + Manifest 主题（2026-10-02 实测教训）】
//   用户反馈「怎么看着安卓的整体位置偏下」——真因：MainActivity 有**系统栏（状态栏 144px +
//   ActionBar 168px = 312px）**，而同夹具的 Web/小程序/iOS 端没有应用层 chrome ⇒
//   内容距屏顶 25.8% vs 其它端 ~14%（原始截图对比时肉眼可见）。
//   ① 首版尝试"运行时隐藏系统栏"（setDecorFitsSystemWindows(false) + hide + actionBar.hide()）
//      ⇒ 引入**运行时重排**：视图原点被顶到 −168px（正好一个 ActionBar 高度），过校正到 7.4%，
//      且截图时机与重排完成时刻存在竞态（实测首帧截图仍是旧 chrome 状态）。
//   ② 正解：**Manifest 声明 `Theme.NoTitleBar.Fullscreen`** ⇒ 冷启动即全屏，**零重排 / 零竞态**。
//      （本仓纪律同源：能靠"声明/隔离"消除的副作用，不要靠"运行时调整"去管理。）
//
// 【画什么（与其它四端逐字同声明）】root(#14141c · padding-top 120u · 左 16u) → 圆角块(80×48u
//   · r=14u · #2f6fed) → 阴影块(80×48u · #2a3f66 · 0/3/10u rgba(0,0,0,.7)，分层逼近) →
//   渐变块(80×48u · linear 90° #7c5cff→#ff9a6c) → 字形("字形 Ag 8 中" · 18u · #fff)。
//
// 【完成信号（零盲等）】首帧真的画过（onDrawCount>0）才落报告 l4-scene.json；
//   采集脚本 scripts/shoot-l4-android.sh 以报告文件出现为取屏条件。

import android.app.Activity;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.FrameLayout;

public class L4Activity extends Activity {

    /** 声明单位 → 设备 px（480dpi ⇒ density 3.0；残余由报告侧锚定归一吸收） */
    private static final float U = 3f;
    private static final float PAD_TOP = 120f, PAD_X = 16f;
    private static final float BW = 80f, BH = 48f, GAP = 10f, R = 14f;
    private static final float SHADOW_DY = 3f, SHADOW_BLUR = 10f, SHADOW_ALPHA = 0.7f;
    private static final float FONT = 18f;
    private static final int BG = 0xFF14141C;
    private static final int C_BLOCK = 0xFF2F6FED;
    private static final int C_SHADOW_BG = 0xFF2A3F66;

    /** 待隐藏系统栏（窗口 attach 后才能取 insetsController——onCreate 里取会 NPE） */
    private boolean l4FullscreenPending = false;

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && l4FullscreenPending && android.os.Build.VERSION.SDK_INT >= 30) {
            l4FullscreenPending = false;
            android.view.WindowInsetsController wic = getWindow().getInsetsController();
            if (wic != null) {
                wic.hide(android.view.WindowInsets.Type.statusBars());
                // ★行为立即生效（不带动画）——避免截图落在过渡中间态（前次竞态的教训）
                wic.setSystemBarsBehavior(
                        android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ★★沉浸式全屏（实测第三课，定稿）：用 **FLAG_FULLSCREEN**——与本仓既有四个场景
        //   Activity（LightsDemo / FlipDemo / InkDemo / InkScrollDemo）**同一个已验证模式**。
        //
        // 【为什么不是 InsetsController（实测第二课的崩溃）】`getWindow().getInsetsController()`
        //   在 **onCreate** 阶段返回 null ⇒ PhoneWindow.getInsetsController NPE ⇒ 启动即崩
        //   （Android 的时序约束：窗口尚未 attach）。既有四个场景全用 FLAG_FULLSCREEN——
        //   说明"沉浸式"在本仓的正确形态就是它（同一问题一处只有一种解法）。
        //
        // 【为什么不用主 App 的运行时广播回调（实测第一课）】窗口已显示后再改 insets 触发
        //   重新布局 ⇒ 截图与重排竞态（实测拍到过校正中间态 7.4%）。
        //   L4Activity 冷启动 + onCreate 设 flags = 首帧 layout 前生效，零竞态。
        getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN,
                             android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
        // ★★还需 `setDecorFitsSystemWindows(false)`（实测第四课，取景判据机器抓出）：
        //   FLAG_FULLSCREEN 只隐了状态栏的**绘制**，content 原点仍在状态栏之下
        //   （实测 `view_origin = 0,144` —— 144px 就是这块占位）。关闭 decor-fits 让内容
        //   延伸到系统栏区域 ⇒ 原点回 (0,0)。
        //   ★不碰 InsetsController（onCreate 阶段为 null，会 NPE 崩——见上一课注释）。
        //   API 30+ 用此方法；旧版本靠 FLAG_FULLSCREEN 已足够（本仓设备 API 37）。
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        }
        // ★刘海/挖孔（本机为挖孔屏——实测 `view_origin` 仍停在 144px 时补上）：
        //   不延伸进 cutout 区时，系统按"安全区"给窗口留白。SHORT_EDGES = 短边（顶部）可延伸。
        android.view.WindowManager.LayoutParams attrs0 = getWindow().getAttributes();
        attrs0.layoutInDisplayCutoutMode =
                android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        getWindow().setAttributes(attrs0);
        // ★兜底一遍 **INSETS 隐藏**（在窗口获得焦点后取 controller——那时才非 null；
        //   onCreate 里取会 NPE，这是实测第二课）。decorFits(false) + 隐藏 = 内容真正铺到 0。
        l4FullscreenPending = true;

        // ★取景断言的可观测面：`getLocationOnScreen` 在首帧后应给 (0,0)；
        //   postOnAnimation 里读取并写进报告（采集脚本据此判红——不靠肉眼看截图）。
        FrameLayout root = new FrameLayout(this);
        setContentView(root);

        java.util.List<ProteusHostView.Cmd> cmds = new java.util.ArrayList<>();
        final float x = PAD_X * U;
        float y = PAD_TOP * U;
        final float bw = BW * U, bh = BH * U, gap = GAP * U, r = R * U;

        // ① 圆角块
        cmds.add(new ProteusHostView.Cmd(x, y, bw, bh, C_BLOCK, null, 0f, 0, r));
        y += bh + gap;
        // ② 阴影块：分层展开圆角矩形（与 iOS 同式）。
        //
        // ★★alpha 必须按 **over 合成反算**（2026-10-02 与 iOS 同步修复"黑块污染"）：
        //   分层是**实心填充**叠加——近环被全部 N 层覆盖，合成 alpha = 1−Π(1−a_j)。
        //   首版把"目标剖面值"直接当每层 alpha ⇒ 近环合成 ≈ 0.92（近纯黑环）+ 每层可见台阶
        //   （iOS 真机 3x 上肉眼可见"回"字污染）。
        //   反算：a_k = 1−(1−A_k)/(1−A_{k+1})（A_k = 目标剖面，A_{N+1}=0）
        //   ⇒ 每个环的合成值精确等于目标剖面（0.7 起、平方衰减到 0）。
        // ★N=16（原 6）：expand 步进 ≈ 1.9px@3x（亚像素级，台阶不可见）。
        final int N = 16;
        final float[] layerAlphas = new float[N];
        float nextTarget = 0f;
        for (int k = N; k >= 1; k--) {
            float t = (k - 1f) / N;
            float target = SHADOW_ALPHA * (1 - t) * (1 - t);      // A_k
            layerAlphas[k - 1] = 1f - (1f - target) / (1f - nextTarget);
            nextTarget = target;
        }
        for (int k = N; k >= 1; k--) {
            float expand = SHADOW_BLUR * k / N * U;
            int c = ((int) (layerAlphas[k - 1] * 255f + 0.5f) << 24);   // 纯黑 + 反算 alpha
            // ★半径 = **阴影块自身半径（0，直角）** + expand（与 iOS 同步的第二处修复）：
            //   首版误用变量 `r`（= 圆角块的 14u=42px）⇒ 阴影层带大圆角、四角被"咬掉"。
            //   `0 + expand` 才是直角矩形的距离场（Minkowski 和）。
            cmds.add(new ProteusHostView.Cmd(
                    x - expand, y + SHADOW_DY * U - expand,
                    bw + 2 * expand, bh + 2 * expand,
                    c, null, 0f, 0, expand));
        }
        cmds.add(new ProteusHostView.Cmd(x, y, bw, bh, C_SHADOW_BG, null, 0f, 0, 0f));
        y += bh + gap;
        // ③ 渐变块（90° = 左→右；与 TS linearGradientEndpoints / iOS 同式）
        //   ★基色必须不透明（宿主先 setColor 再挂 shader；color=0 ⇒ alpha=0 使 shader 被乘零
        //     ——首版实测抓出的场景缺陷）
        ProteusHostView.GradSpec grad = new ProteusHostView.GradSpec(
                1, 90f, 0.5f, 0.5f, 1f,
                new int[]{0xFF7C5CFF, 0xFFFF9A6C}, new float[]{0f, 1f});
        cmds.add(new ProteusHostView.Cmd(x, y, bw, bh, 0xFF000000, null, 0f, 0, 0f, grad));
        y += bh + gap;
        // ④ 字形（白 18u；color=0 透明——宿主对每条 Cmd 先铺底色矩形，文本节点不铺）
        cmds.add(new ProteusHostView.Cmd(x, y, bw * 2, FONT * U * 1.6f, 0, "字形 Ag 8 中", FONT * U, 0xFFFFFFFF, 0f));

        final ProteusHostView scene = new ProteusHostView(this);
        scene.setCmds(cmds);
        scene.setBackgroundColor(BG);
        // ★全屏窗口（Manifest 主题已保证）：尺寸取**真实屏幕**；绝对定位（同 shot 场景教训）
        android.graphics.Point sz = new android.graphics.Point();
        getWindowManager().getDefaultDisplay().getRealSize(sz);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(sz.x, sz.y);
        lp.leftMargin = 0;
        lp.topMargin = 0;
        root.addView(scene, lp);

        // ★帧驱动条件等待（零盲等）：首帧真的画过才落报告；采集脚本以报告落盘为取屏条件
        final Runnable afterDraw = new Runnable() {
            @Override public void run() {
                if (scene.onDrawCount() <= 0) {
                    scene.postOnAnimation(this);
                    return;
                }
                try {
                    // ★取景判据（机器可判）：内容 View 在屏幕上的原点必须是 (0,0)——
                    //   这是"无系统栏占位、与其它四端取景对齐"的直接证据（不靠肉眼看截图）。
                    int[] loc = new int[2];
                    scene.getLocationOnScreen(loc);
                    org.json.JSONObject o = new org.json.JSONObject();
                    o.put("ok", true);
                    o.put("path", "l4");
                    o.put("on_draw", scene.onDrawCount());
                    o.put("unit", U);
                    o.put("density", getResources().getDisplayMetrics().density);
                    o.put("screen", new org.json.JSONArray(new int[]{sz.x, sz.y}));
                    o.put("view_origin", new org.json.JSONArray(new int[]{loc[0], loc[1]}));
                    // I2-ALLOW: 报告字段取整（写进 l4-scene.json 供跨端核对的读数——
                    //   几何真值走内核指令流；此处的 block 坐标仅为人/脚本读取的报告口径）
                    o.put("block", new org.json.JSONArray(new int[]{
                            Math.round(x), Math.round(PAD_TOP * U), Math.round(bw), Math.round(bh)}));
                    o.put("chrome", "none（Theme.NoTitleBar.Fullscreen + onCreate 沉浸式——取景与其它四端对齐）");
                    o.put("note", "L4 观测夹具（Android 独立 Activity）：四元素同声明；分层阴影=跨端一致策略");
                    MainActivity.writeReportStatic(L4Activity.this, "l4-scene.json", o.toString(2));
                } catch (Exception e) {
                    MainActivity.writeReportStatic(L4Activity.this, "l4-scene.json",
                            "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}");
                }
            }
        };
        scene.postOnAnimation(afterDraw);
    }
}
