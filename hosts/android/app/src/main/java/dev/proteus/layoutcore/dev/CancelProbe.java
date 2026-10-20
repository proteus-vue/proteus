package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/CancelProbe.java
// ★★★#1121：**取消通道（S3 回收维度）真机判据**——Android 侧。
//
// 【它证明什么（缺一不算取消可用）】
//   ① JS 侧以 `fetch.aborted` reject（不是成功、不是普通失败）；
//   ② **后续块不再到达**（`chunks_stopped`）——只验 reject 太弱：
//      JS 侧 reject 后若宿主还在推，回调会被已删的 pending 条目丢弃，**看起来"没块了"但传输还在跑**；
//   ③ 宿主 `http.cancel` 记账 `hit=true`——证明**取消真的打到宿主**。
//
// 【装置形态与 SaveProbe/UploadProbe 逐件相同】
public final class CancelProbe {
    private CancelProbe() {}

    public static final String REPORT = "cancel-probe.json";
    private static java.util.function.BiConsumer<String, String> reportSinkFn = null;
    public static void setReportSink(java.util.function.BiConsumer<String, String> sink) { reportSinkFn = sink; }
    static void reportSink(String content) {
        if (reportSinkFn != null) { reportSinkFn.accept(REPORT, content); return; }
        android.util.Log.w("proteus", "cancel-probe 结果无落盘出口：" + content);
    }

    private static final long STEP_TIMEOUT_MS = 10000;

    public static String run(android.app.Activity activity, android.view.ViewGroup root) {
        org.json.JSONObject out = new org.json.JSONObject();
        try {
            String base = "http://127.0.0.1:8788";
            int chunks = 128;
            int size = 16 * 1024;
            int delayMs = 20;
            android.content.Intent it = activity.getIntent();
            if (it != null) {
                String b = it.getStringExtra("base");
                if (b != null && !b.isEmpty()) base = b;
                chunks = it.getIntExtra("chunks", 128);
                size = it.getIntExtra("size", 16 * 1024);
                delayMs = it.getIntExtra("delay_ms", 20);
            }
            out.put("base", base);
            out.put("chunks", chunks);
            out.put("size", size);
            out.put("delay_ms", delayMs);
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
                    "typeof __proteusHostAppCancelProbe==='function'"
                    + "?__proteusHostAppCancelProbe(" + org.json.JSONObject.quote(base)
                    + "," + chunks + "," + size + "," + delayMs + "):'no-hook'");
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
                            "String(globalThis.__proteusHostCancelProbeResult || '')");
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
                            // ★宿主记账：证明取消真的打到宿主
                            HttpCapability.CancelStats cs = HttpCapability.cancelStats();
                            org.json.JSONObject hs = new org.json.JSONObject();
                            hs.put("calls", cs.calls);
                            hs.put("hits", cs.hits);
                            hs.put("misses", cs.misses);
                            baseOut.put("host_cancel_stats", hs);
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

    private static String readAsset(android.app.Activity activity, String name) {
        try (java.io.InputStream is = activity.getAssets().open(name)) {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Throwable t) {
            return null;
        }
    }
}
