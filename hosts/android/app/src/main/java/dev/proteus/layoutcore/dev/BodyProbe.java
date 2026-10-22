package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/BodyProbe.java
// ★★★决策 #1160：**POST/PUT 带请求体探针**——补上"整包路径 + 请求体"的用例空白。
//
// 【为什么这条必须存在（独立验证抓出的 P0）】
//   换栈第一版在 `perform()`（整包路径）漏了 `cfg.body` ⇒ **Android 所有带 `data` 的
//   POST/PUT 静默变成空体**：功能全错、零报错、日志干净。
//   而当时四条真机探针（transfer / stream / save / tls / redirect / fetch-limit）
//   **全是 GET 或上传**：
//     · upload 走 `bodyWriter`（体由回调产生，不经 `cfg.body`）
//     · stream / save 各有分支
//     · 其余都是 GET（无体）
//   ⇒ **没有任何一条覆盖"整包路径 + 请求体"**，所以 9 组真机回归全绿而功能已坏。
//
// 【它证明什么（缺一即红）】
//   ① POST 的体**逐字节**到达服务端（服务端回 length / sha / 首末字节）；
//   ② 体**不是空**（空体时 length=0 ⇒ 与期望长度不等 ⇒ 红）——这是 P0 的直接判据；
//   ③ `Content-Type` 按调用方给的落地；
//   ④ GET（无体）仍能成功（若体被错挂到 GET，OkHttp 抛 IllegalArgumentException）；
//   ⑤ PUT 同样带体成功（防"只对 POST 特判"）。
//
// 【为什么结果里带 expected_len】判据是"服务端收到 == JS 期望"，不是"服务端收到 > 0"——
//   后者会把"发了半截"也判绿。
public final class BodyProbe {
    private BodyProbe() {}

    public static final String REPORT = "body-probe.json";
    private static java.util.function.BiConsumer<String, String> reportSinkFn = null;
    public static void setReportSink(java.util.function.BiConsumer<String, String> sink) { reportSinkFn = sink; }
    static void reportSink(String content) {
        if (reportSinkFn != null) { reportSinkFn.accept(REPORT, content); return; }
        android.util.Log.w("proteus", "body-probe 结果无落盘出口：" + content);
    }
    private static final long STEP_TIMEOUT_MS = 60000;

    /** @param base 本地服务基址（`http://127.0.0.1:8788`） */
    public static String run(android.app.Activity activity, android.view.ViewGroup root) {
        org.json.JSONObject out = new org.json.JSONObject();
        try {
            String base = "http://127.0.0.1:8788";
            android.content.Intent it = activity.getIntent();
            if (it != null) {
                String b = it.getStringExtra("base");
                if (b != null && !b.isEmpty()) base = b;
            }
            out.put("base", base);
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
            // ★★与真实壳同一栈（与 TransportProbe/FetchLimitProbe 逐件相同）
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
                    "typeof __proteusHostAppBodyProbe==='function'"
                    + "?__proteusHostAppBodyProbe(" + org.json.JSONObject.quote(base) + "):'no-hook'");
            out.put("probe_kick", kick.ok ? kick.value : ("ERR:" + kick.error));
            if (!kick.ok || !String.valueOf(kick.value).contains("started")) {
                out.put("ok", false);
                out.put("error", "探针未启动（hook 缺失或参数错）");
                reportSink(out.toString());
                return out.toString();
            }

            // ★异步收尾：不在主线程死等（回推要进主线程消息循环）
            final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
            final long deadline = System.currentTimeMillis() + STEP_TIMEOUT_MS;
            final int[] polls = { 0 };
            final org.json.JSONObject baseOut = out;
            final Runnable[] step = new Runnable[1];
            step[0] = new Runnable() {
                @Override public void run() {
                    QuickJsEngine.nativeRunPendingJobs();
                    QuickJsEngine.EvalResult rr = QuickJsEngine.eval(
                            "String(globalThis.__proteusHostBodyProbeResult || '')");
                    String v = rr.ok ? rr.value : null;
                    polls[0]++;
                    final boolean got = v != null && !v.isEmpty() && !"undefined".equals(v) && !"null".equals(v);
                    if (!got && System.currentTimeMillis() < deadline) {
                        h.postDelayed(step[0], 5);
                        return;
                    }
                    try {
                        baseOut.put("probe_rounds", polls[0]);
                        baseOut.put("probe_raw", got ? v : null);
                        if (got) {
                            org.json.JSONObject p = new org.json.JSONObject(v);
                            baseOut.put("probe", p);
                            baseOut.put("ok", p.optBoolean("ok", false));
                        } else {
                            baseOut.put("ok", false);
                            baseOut.put("error", "探针超时（装置不确定，非框架结论）");
                            QuickJsEngine.EvalResult pg = QuickJsEngine.eval(
                                    "String(globalThis.__proteusHostBodyProbeProgress || '')");
                            baseOut.put("probe_progress", pg.ok ? pg.value : ("ERR:" + pg.error));
                        }
                    } catch (Throwable t) {
                        try { baseOut.put("ok", false); baseOut.put("error", "结果解析失败：" + t); } catch (Throwable ignored) { }
                    }
                    reportSink(baseOut.toString());
                }
            };
            h.postDelayed(step[0], 5);
            return out.toString();
        } catch (Throwable t) {
            try { out.put("ok", false); out.put("error", "装置异常：" + t); } catch (Throwable ignored) { }
            reportSink(out.toString());
            return out.toString();
        }
    }

    private static String readAsset(android.app.Activity activity, String name) {
        try (java.io.InputStream in = activity.getAssets().open(name)) {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toString("UTF-8");
        } catch (Exception e) {
            return null;
        }
    }
}
