package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/RedirectProbe.java
// ★★★#1134：**重定向拦截**的真机判据——Android 侧。
//
// 【它证明什么（缺一不算"重定向可拦"）】
//   ① `redirect:'manual'` ⇒ `status=302` + 有 `Location`（**没有跳到终点**）；
//   ② `onRedirect` 两跳链 ⇒ 回调 **2 次**，`from/to/status` 可读；
//   ③ `stop` ⇒ `fetch.redirectStopped`，且回调**只被调 1 次**（没有继续跳）；
//   ④ 环 + `maxRedirects=2` ⇒ `fetch.tooManyRedirects`；
//   ⑤ ★**跨域剥离凭据**：302 到另一 origin ⇒ 终点服务端 `/__seen` 里 `auth` 为**空**。
//      ★这一条是核心：只在客户端看"没带 Authorization"不够——**服务端真收到了什么**才是事实。
//
// 【装置形态与 UseFetchProbe / CancelProbe 逐件相同（决策 #1122 起的范式）】
//   bundle-superapp → 调 `__proteusHostAppRedirectProbe(base, crossBase, max)` → 轮询结果变量。
//
// ★`package` 只在文件第一行（本类与 UseFetchProbe 同属 `dev.proteus.layoutcore`，
//   即使物理目录带 /dev/ ——Java 的包声明不以目录为准，但重复声明是语法错误）。

public final class RedirectProbe {
    private RedirectProbe() {}

    public static final String REPORT = "redirect-probe.json";
    private static java.util.function.BiConsumer<String, String> reportSinkFn = null;
    public static void setReportSink(java.util.function.BiConsumer<String, String> sink) { reportSinkFn = sink; }
    static void reportSink(String content) {
        if (reportSinkFn != null) { reportSinkFn.accept(REPORT, content); return; }
        android.util.Log.w("proteus", "redirect-probe 结果无落盘出口：" + content);
    }

    private static final long STEP_TIMEOUT_MS = 15000;

    public static String run(android.app.Activity activity, android.view.ViewGroup root) {
        org.json.JSONObject out = new org.json.JSONObject();
        try {
            String base = "http://127.0.0.1:8801";
            String crossBase = "http://127.0.0.1:8802";
            int maxRedirects = 2;
            android.content.Intent it = activity.getIntent();
            if (it != null) {
                String b = it.getStringExtra("base");
                if (b != null && !b.isEmpty()) base = b;
                String x = it.getStringExtra("cross_base");
                if (x != null && !x.isEmpty()) crossBase = x;
                maxRedirects = it.getIntExtra("max_redirects", 2);
            }
            out.put("base", base);
            out.put("cross_base", crossBase);
            out.put("max_redirects", maxRedirects);
            out.put("engine_available", QuickJsEngine.isAvailable());
            if (!QuickJsEngine.isAvailable()) {
                out.put("ok", false); out.put("error", "引擎未加载");
                reportSink(out.toString()); return out.toString();
            }

            String bundle = readAsset(activity, "bundle-superapp.js");
            if (bundle == null) {
                out.put("ok", false); out.put("error", "缺 assets/bundle-superapp.js");
                reportSink(out.toString()); return out.toString();
            }

            android.util.DisplayMetrics dm = activity.getResources().getDisplayMetrics();
            VaporRenderHost draw = new VaporRenderHost(activity, root);
            draw.setLengthScale(dm.density);
            org.json.JSONObject envObj = EnvVars.collect(activity, dm.density);
            envObj.put("--pf-vw", dm.widthPixels / dm.density);
            envObj.put("--pf-vh", dm.heightPixels / dm.density);
            draw.setEnvVars(envObj);
            HostCapabilities caps = new HostCapabilities(activity);
            ScreenHost screenHost = new ScreenHost(root);
            HostBridge bridge = new HostBridge(caps, screenHost);
            SuperappRuntimeHost rtHost = new SuperappRuntimeHost(draw, bridge);
            QuickJsEngine.eval("globalThis.__PROTEUS_HOST_ID__ = 'android';"
                    + "globalThis.__PROTEUS_HOST_FRAME_DRIVER__ = 'Choreographer';");
            QuickJsEngine.EvalResult load = QuickJsEngine.evalWithHost(bundle, rtHost);
            if (!load.ok) {
                out.put("ok", false); out.put("error", "bundle eval 失败：" + load.error);
                reportSink(out.toString()); return out.toString();
            }
            QuickJsEngine.EvalResult boot = QuickJsEngine.eval("__proteusSuperappBootJson()");
            out.put("boot_ok", boot.ok);
            QuickJsEngine.nativeRunPendingJobs();

            QuickJsEngine.EvalResult kick = QuickJsEngine.eval(
                    "typeof __proteusHostAppRedirectProbe==='function'"
                    + "?__proteusHostAppRedirectProbe(" + org.json.JSONObject.quote(base)
                    + "," + org.json.JSONObject.quote(crossBase)
                    + "," + maxRedirects + "):'no-hook'");
            out.put("probe_kick", kick.ok ? kick.value : ("ERR:" + kick.error));
            if (!kick.ok || !String.valueOf(kick.value).contains("started")) {
                out.put("ok", false);
                out.put("error", "探针未启动（hook 缺失或参数错）");
                reportSink(out.toString());
                return out.toString();
            }

            final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
            final long deadline = System.currentTimeMillis() + STEP_TIMEOUT_MS * 12;
            final int[] rounds = { 0 };
            final org.json.JSONObject baseOut = out;
            final Runnable[] step = new Runnable[1];
            step[0] = new Runnable() {
                @Override public void run() {
                    QuickJsEngine.nativeRunPendingJobs();
                    QuickJsEngine.EvalResult rr = QuickJsEngine.eval(
                            "String(globalThis.__proteusHostRedirectProbeResult || '')");
                    String v = rr.ok ? rr.value : null;
                    rounds[0]++;
                    final boolean got = v != null && !v.isEmpty() && !"undefined".equals(v) && !"null".equals(v);
                    if (!got && System.currentTimeMillis() < deadline) {
                        h.postDelayed(step[0], 5);
                        return;
                    }
                    try {
                        baseOut.put("probe_rounds", rounds[0]);
                        baseOut.put("probe_raw", got ? v : null);
                        if (got) {
                            org.json.JSONObject p = new org.json.JSONObject(v);
                            baseOut.put("probe", p);
                            baseOut.put("ok", p.optBoolean("ok", false));
                        } else {
                            baseOut.put("ok", false);
                            baseOut.put("error", "探针结果超时（装置不确定，非框架结论）");
                        }
                    } catch (Throwable t) {
                        try { baseOut.put("ok", false); baseOut.put("error", "结果解析失败：" + t); } catch (Throwable ignored) { }
                    }
                    reportSink(baseOut.toString());
                }
            };
            h.post(step[0]);
            return out.toString();
        } catch (Throwable t) {
            try { out.put("ok", false); out.put("error", "装置异常：" + t); } catch (Throwable ignored) { }
            reportSink(out.toString());
            return out.toString();
        }
    }

    private static String readAsset(android.content.Context ctx, String name) {
        try (java.io.InputStream is = ctx.getAssets().open(name)) {
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
            return new String(bo.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Throwable t) {
            return null;
        }
    }
}
