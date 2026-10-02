package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/StressSfcActivity.java
// ★★★六端 SFC 压力夹具（Android 端）——**渲染 examples/pages/consistency-stress.vue 编译产物**。
//
// 【与 L4Activity 的本质差别（本文件存在的理由）】
//   L4Activity 画的是**手写 Cmd**（四元素手写声明）；本 Activity 画的是
//   **SFC 编译产物**：`vapor-stress-artifacts.json`（LayoutTemplate + 订阅表 + 数据快照）
//   → QuickJS 实例化 → 语义节点树 → Rust 内核算几何 → 自绘。
//   ⇒ 与 Web/MP 端（Proteus 编译器跑同一个 .vue 文件）**同源**：
//      "一份 SFC 源码，六端渲染"第一次成立。
//
// 【为什么独立 Activity】L4 的模式已证明：Manifest 声明全屏主题 + FLAG_FULLSCREEN +
//   setDecorFitsSystemWindows(false) + layoutInDisplayCutoutMode + 获焦后隐藏 = 零系统栏取景。
//   本 Activity 复用同一套（含"取景判据 view_origin 必须是 0,0"）。
//
// 【链路（与 MainActivity.vaporRun 同一条，不重写）】
//   ① QuickJS eval bundle-vapor.js（定义 __proteusVaporRun）
//   ② 组装 args：artifacts（stress 产物）+ viewport（**逻辑单位 375×800**——
//      与 SFC 一致；内核按此算几何、宿主按 density 放大绘制）
//   ③ `__proteusVaporRun(args)` → 宿主 VaporRenderHost.mount（Rust 建树 + 指令 + 上屏）
//   ④ 首帧画过（onDrawCount>0）后落报告 stress-scene.json（采集脚本以它为取屏条件）
//
// 【★单位口径（本 Activity 的核心决策，实测依据）】
//   SFC 用**逻辑 px**（375×800，六端屏幕都放得下）。Android 内核也收逻辑 px
//   （viewport=375×800），而 ProteusHostView 画布是**物理像素**（1200×2608）
//   ⇒ 需要 **3× 放大**（density=3）。做法：宿主注入的**文本度量按 density 放大**
//   （文字物理尺寸）+ 视图 `setScale` 放大绘制（几何物理尺寸）。
//   ★诚实边界：这条缩放是"逻辑单位 → 物理像素"的**唯一换算点**（本仓卡 I2 的精神：
//     换算只在一处发生）；若不做，内容是 1/3 大小（能看但非"同尺寸对照"）。

import android.app.Activity;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.FrameLayout;

public class StressSfcActivity extends Activity {

    private VaporRenderHost host;
    private FrameLayout root;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ★全屏取景（与 L4Activity 同款五件套——每一件都是实测必需，见 L4Activity 的注释）
        getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN,
                             android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        }
        android.view.WindowManager.LayoutParams attrs0 = getWindow().getAttributes();
        attrs0.layoutInDisplayCutoutMode =
                android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        getWindow().setAttributes(attrs0);

        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF14141C);
        setContentView(root);

        if (!QuickJsEngine.isAvailable()) {
            MainActivity.writeReportStatic(this, "stress-scene.json",
                    "{\"ok\":false,\"error\":\"QuickJS 引擎未加载：" + QuickJsEngine.getLoadError() + "\"}");
            return;
        }

        host = new VaporRenderHost(this, root);
        // ★★内容滚动范围钳制（2026-10-02 —— 「安卓示例页面可以一直上下滚动」修复）：
        //   内容页语义 = 装不下才滚、最多滚到内容底（与 Web 页面一致）；
        //   范围由内核几何推导（VaporRenderHost.applyContentScrollRange——宿主不算布局数学）。
        //   ★只在本内容页开启：kernel-anim 等既有探针/动画用例保持"无界拖拽"（零行为变化）。
        host.enableContentScrollRange();
        // ★★★长度缩放 = density（2026-10-02 实测修复）：SFC 的 px 是**逻辑单位**（Web CSS px /
        //   iOS pt / MP 逻辑 px 同义），而本宿主按**物理像素**绘制 ⇒ ×density 才与其它端同尺寸。
        //   首版缺此步：锚块 80px（其它端 130~240px）、内容只占屏 22%（用户目视直接看出）。
        //   ★设在 mount 之前——coreNodes()/viewport 都会用它（覆盖静态 + 动态绑定全部路径）。
        host.setLengthScale(getResources().getDisplayMetrics().density);

        // ① bundle（QuickJS 直接 eval；与 MainActivity.vapor 通路同一份产物）
        String bundle = readAsset("bundle-vapor.js");
        if (bundle == null) {
            MainActivity.writeReportStatic(this, "stress-scene.json",
                    "{\"ok\":false,\"error\":\"缺 assets/bundle-vapor.js\"}");
            return;
        }
        QuickJsEngine.EvalResult load = QuickJsEngine.evalWithHost(bundle, host);
        if (!load.ok) {
            MainActivity.writeReportStatic(this, "stress-scene.json",
                    "{\"ok\":false,\"error\":\"bundle eval 失败：" + load.error + "\"}");
            return;
        }

        // ② 编译产物（**来自共享 SFC 源**——见 gen-vapor-fixture.mjs 的 OUT_STRESS）
        String artifacts = readAsset("vapor-stress-artifacts.json");
        if (artifacts == null) {
            MainActivity.writeReportStatic(this, "stress-scene.json",
                    "{\"ok\":false,\"error\":\"缺 assets/vapor-stress-artifacts.json（构建时应由 gen-vapor-fixture.mjs 产出）\"}");
            return;
        }

        // ③ 参数：viewport = **真实屏幕的逻辑尺寸**（本机 1200×2608 物理 @3 ⇒ 400×869.3 逻辑）
        org.json.JSONObject args = new org.json.JSONObject();
        try {
            args.put("artifacts", artifacts);
            args.put("mode", "stress");
            // ★★viewport = 真实屏幕的逻辑尺寸（2026-10-02 流式改造）：夹具根是 `width: 100%`
            //   ⇒ 百分比基准 = 内核视口。此前写死 375×800（SFC 旧定宽时代的"设计宽"）——
            //   流式内容会被算成 375 宽（右留白 = 屏宽 − 375 − 16），随屏宽漂移的问题原样保留。
            //   改为 physical/density：本机 400×869.33 逻辑 ⇒ 与 Web（390 CSS px）/
            //   iOS（402pt）/ MP（~390 逻辑）同口径——viewport 表达"屏幕有多少逻辑单位"。
            //   ★scale 仍是 density：宿主按物理像素绘制，physicalizeTree 会把 viewport
            //     与全部长度一次乘到物理单位（唯一换算点，见 VaporRenderHost 注释）。
            android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
            args.put("viewport", new org.json.JSONObject()
                    .put("width", dm.widthPixels / dm.density)
                    .put("height", dm.heightPixels / dm.density));
            args.put("scale", dm.density);
        } catch (Exception e) {
            MainActivity.writeReportStatic(this, "stress-scene.json",
                    "{\"ok\":false,\"error\":\"args 组装失败：" + e.getMessage() + "\"}");
            return;
        }

        long t0 = System.nanoTime();
        QuickJsEngine.EvalResult run = QuickJsEngine.eval(
                "__proteusVaporRun(" + org.json.JSONObject.quote(args.toString()) + ")");
        final long runMs = (System.nanoTime() - t0) / 1000000;

        try {
            org.json.JSONObject out = new org.json.JSONObject();
            out.put("ok", run.ok);
            out.put("run_ms", runMs);
            out.put("path", "stress-sfc");
            if (run.ok) {
                out.put("js", new org.json.JSONObject(run.value));
            } else {
                out.put("error", "入口调用失败：" + run.error);
            }
            // ★完成信号：**首帧真的画过**才落报告（帧驱动条件等待——采集脚本以它取屏）
            final String report = out.toString();
            final ProteusHostView view = host.view();
            if (view == null) {
                MainActivity.writeReportStatic(this, "stress-scene.json",
                        "{\"ok\":false,\"error\":\"宿主视图未建立（mount 未执行？）\"}");
                return;
            }
            final Runnable afterDraw = new Runnable() {
                private int rounds = 0;
                @Override public void run() {
                    rounds++;
                    if (view.onDrawCount() <= 0 && rounds < 300) {
                        view.postOnAnimation(this);
                        return;
                    }
                    try {
                        int[] loc = new int[2];
                        view.getLocationOnScreen(loc);
                        org.json.JSONObject o = new org.json.JSONObject();
                        o.put("ok", view.onDrawCount() > 0);
                        o.put("on_draw", view.onDrawCount());
                        o.put("view_origin", new org.json.JSONArray(new int[]{loc[0], loc[1]}));
                        // ★★滚动手势探针（2026-10-02 —— 「安卓示例页面可以一直上下滚动」修复的机器判据）：
                        //   注入**真实 MotionEvent 序列**（DOWN + 3×MOVE 上拖 + UP）走 GestureDetector
                        //   → 生产通路 `scrollDragBy`（与 kernel-anim M6b 同法——真实触摸层，不用合成替身）。
                        //   内容装得下（scroll_range=0）⇒ 拖拽后 scrollY 必须**恒为 0**（页面不可滚）。
                        //   本字段是判据的可读证据：`scroll_after_drag` 与 `scroll_range`。
                        final int scrollBefore = view.getContentScrollY();
                        final long tProbe = android.os.SystemClock.uptimeMillis();
                        android.view.MotionEvent down = android.view.MotionEvent.obtain(
                                tProbe, tProbe, android.view.MotionEvent.ACTION_DOWN, 600f, 800f, 0);
                        view.dispatchTouchEvent(down);
                        down.recycle();
                        final float[] moves = {740f, 690f, 640f};  // 手指上移（content 应下滚，若可滚）
                        for (int i = 0; i < moves.length; i++) {
                            android.view.MotionEvent mv = android.view.MotionEvent.obtain(
                                    tProbe, tProbe + (i + 1) * 20L, android.view.MotionEvent.ACTION_MOVE, 600f, moves[i], 0);
                            view.dispatchTouchEvent(mv);
                            mv.recycle();
                        }
                        android.view.MotionEvent up = android.view.MotionEvent.obtain(
                                tProbe, tProbe + 90L, android.view.MotionEvent.ACTION_UP, 600f, 640f, 0);
                        view.dispatchTouchEvent(up);
                        up.recycle();
                        o.put("scroll_range", view.verticalScrollRange());
                        o.put("scroll_before_drag", scrollBefore);
                        o.put("scroll_after_drag", view.getContentScrollY());
                        o.put("drag_drive_count", view.scrollDragDriveCount);
                        // ★★探针后**复位**（2026-10-02）：探针要如实记录"拖拽后滚动值"（判据证据），
                        //   但采集脚本紧接着会截屏做一致性比较——若修复失效、内容真的被滚走，
                        //   截图会拍到滚走的画面（污染一致性数据）。⇒ 记录完立即归零，
                        //   判据看 `scroll_after_drag` 判红/绿，截图看的是未滚动状态（两者互不污染）。
                        view.setContentScrollY(0);
                        o.put("scroll_reset_ok", view.getContentScrollY() == 0);
                        // 拖拽后视口还没画新帧 ⇒ 再等一帧让探针的位移（若无）反映到画面（确定性）
                        view.invalidate();
                        o.put("payload", new org.json.JSONObject(report));
                        MainActivity.writeReportStatic(StressSfcActivity.this, "stress-scene.json", o.toString(2));
                    } catch (Exception e) {
                        MainActivity.writeReportStatic(StressSfcActivity.this, "stress-scene.json",
                                "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}");
                    }
                }
            };
            view.postOnAnimation(afterDraw);
        } catch (Exception e) {
            MainActivity.writeReportStatic(this, "stress-scene.json",
                    "{\"ok\":false,\"error\":\"报告组装失败：" + e.getMessage() + "\"}");
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && android.os.Build.VERSION.SDK_INT >= 30) {
            android.view.WindowInsetsController wic = getWindow().getInsetsController();
            if (wic != null) wic.hide(android.view.WindowInsets.Type.statusBars());
        }
    }

    private String readAsset(String name) {
        try (java.io.InputStream is = getAssets().open(name)) {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), "UTF-8");
        } catch (Exception e) {
            return null;
        }
    }
}
