package dev.proteus.layoutcore;

import android.app.Activity;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;

/**
 * ★★**灯光秀独立应用**（`dev.proteus.lights`）——「点开就一直演」的分享版（2026-10-01）。
 *
 * 【与 `MainActivity` 的关系（同一份引擎、两套壳，不复制实现）】
 *   · `MainActivity`：**测试壳**（路径分发 + 广播触发 + 报告落盘，给判据用）；
 *   · 本类：**演示壳**——启动即全屏开演**循环**，只留一个隐藏的"触碰重开"手势。
 *   两者都调**同一份** `LightsHost`（节目驱动 + Choreographer 帧循环），差异只在：
 *   循环模式（`setLoopMode(true)`）、不进报告、保持屏幕常亮、隐藏状态栏。
 *
 * 【为什么独立 APK 能共用同一份 dex/.so】源码里对 `R`（资源类）**零引用**
 *   （全代码 grep 验证过）⇒ 换个 Manifest + 启动 Activity 即可打成第二个包，
 *   无需第二份构建链（见 hosts/android/build-and-run.sh 的 `--lights` 分支）。
 *
 * 【诚实边界】演示壳不做任何计量/判据（那是测试壳的事）；出问题看 logcat。
 */
public final class LightsDemoActivity extends Activity {

    private LightsHost host;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // ① 全屏沉浸：灯光秀要"整屏是舞台"（状态栏/导航栏都藏掉）
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        ViewGroup.LayoutParams full = new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF05060A); // 与 JS 树的舞台底色同值（开演前也不刺眼）
        root.setLayoutParams(full);
        setContentView(root);

        // ② 起演（重活让出主线程：与测试壳同一条时序纪律）
        final FrameLayout rootRef = root;
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
            public void run() {
                startShow(rootRef);
            }
        }, 200);
    }

    private void startShow(FrameLayout root) {
        try {
            if (!QuickJsEngine.isAvailable()) {
                android.util.Log.e("proteus", "灯光秀独立应用：QuickJS 未加载（" + QuickJsEngine.getLoadError() + "）");
                return;
            }
            String bundle;
            try (java.io.InputStream is = getAssets().open("bundle-lights.js")) {
                java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
                bundle = new String(bos.toByteArray(), "UTF-8");
            }
            final float density = getResources().getDisplayMetrics().density;
            host = new LightsHost(this, root, density);
            host.setLoopMode(true); // ★"点开就一直演"
            QuickJsEngine.EvalResult load = QuickJsEngine.evalWithHost(bundle, host);
            if (!load.ok) {
                android.util.Log.e("proteus", "灯光秀独立应用：bundle 加载失败 " + load.error);
                return;
            }
            android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
            org.json.JSONObject args = new org.json.JSONObject();
            args.put("tiles", 800);
            args.put("cols", 20);
            args.put("viewport", new org.json.JSONObject()
                    .put("width", dm.widthPixels).put("height", dm.heightPixels));
            QuickJsEngine.EvalResult run = QuickJsEngine.eval(
                    "__proteusLightsRun(" + org.json.JSONObject.quote(args.toString()) + ")");
            if (!run.ok) {
                android.util.Log.e("proteus", "灯光秀独立应用：入口失败 " + run.error);
                return;
            }
            android.util.Log.i("proteus", "灯光秀独立应用开演（循环模式）");
            host.startShow();
        } catch (Throwable t) {
            android.util.Log.e("proteus", "灯光秀独立应用启动失败", t);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        // 演示壳：退到后台就停演（不烧电）；回前台由 onResume 重演（幂等：running 判断在 host 内）
    }
}
