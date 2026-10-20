package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/StreamProbe.java
// ★★★#1118：**流式通道（S3）真机判据**——Android 侧。
//
// 【它证明什么】走**真实桥**（`createAppNativeCapabilities` → `invokeHostStream`）请求
//   `/stream`（慢速分块），并逐字节校验：块数 / 总字节 / 内容序列 / seq 连续性 / 块间最大间隔。
//   ★只统计"成功了"是不够的——块数对但内容错位在"只数块"的判据下完全看不出来
//     （与 #1105「逐点差异测不出织纹」同族：判据能力边界 = 结论可信边界）。
//
// 【装置形态与 FetchLimitProbe **逐件相同**（照抄，避免再次踩"no-hook"三连）】
//   ① 必须自己载入 bundle 并 boot（空引擎 ⇒ 全局探针不存在 ⇒ no-hook）；
//   ② 探针函数必须挂在 globalThis（`__proteusHostAppStreamProbe`）；
//   ③ 参数走 `am start --es/--ei`（广播 extra 进不了启动 intent）；
//   ④ 异步收尾用 `Handler.postDelayed` 递归（主线程死等会饿死回推）。
//
// 【★为什么还要读宿主的背压读数】
//   JS 侧只能看到"块到达间隔"；"宿主读线程是否真的被队列满阻塞过"只有宿主知道。
//   ⇒ 报告里带 `host_stream_stats`（`chunks` / `maxQueued` / `backpressureWaits` / `backpressureMs`），
//     判据据此区分「真背压」与「队列从未满（回环太快，没测到）」——后者不能算通过。
public final class StreamProbe {
    private StreamProbe() {}

    public static final String REPORT = "stream-probe.json";
    private static java.util.function.BiConsumer<String, String> reportSinkFn = null;
    public static void setReportSink(java.util.function.BiConsumer<String, String> sink) { reportSinkFn = sink; }
    static void reportSink(String content) {
        if (reportSinkFn != null) { reportSinkFn.accept(REPORT, content); return; }
        android.util.Log.w("proteus", "stream-probe 结果无落盘出口：" + content);
    }

    /** 单步超时（多轮 × 6 = 总预算，与 FetchLimitProbe 同值）。 */
    private static final long STEP_TIMEOUT_MS = 10000;

    public static String run(android.app.Activity activity, android.view.ViewGroup root) {
        org.json.JSONObject out = new org.json.JSONObject();
        try {
            String base = "http://127.0.0.1:8788";
            int chunks = 64;
            int size = 16 * 1024;
            int delayMs = 0;
            int slowMs = 0;
            android.content.Intent it = activity.getIntent();
            if (it != null) {
                String b = it.getStringExtra("base");
                if (b != null && !b.isEmpty()) base = b;
                chunks = it.getIntExtra("chunks", 64);
                size = it.getIntExtra("size", 16 * 1024);
                delayMs = it.getIntExtra("delay_ms", 0);
                slowMs = it.getIntExtra("slow_ms", 0);
            }
            out.put("base", base);
            out.put("chunks", chunks);
            out.put("size", size);
            out.put("delay_ms", delayMs);
            out.put("slow_ms", slowMs);
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
                    "typeof __proteusHostAppStreamProbe==='function'"
                    + "?__proteusHostAppStreamProbe(" + org.json.JSONObject.quote(base)
                    + "," + chunks + "," + size + "," + delayMs + "," + slowMs + "):'no-hook'");
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
                            "String(globalThis.__proteusHostStreamProbeResult || '')");
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
                            // ★宿主记账：证明"读线程真的被队列满阻塞过"（真背压 vs 没测到）
                            HttpCapability.StreamStats st = HttpCapability.lastStreamStats();
                            org.json.JSONObject hs = new org.json.JSONObject();
                            hs.put("chunks", st.chunks);
                            hs.put("bytes", st.bytes);
                            hs.put("max_queued", st.maxQueued);
                            hs.put("backpressure_waits", st.backpressureWaits);
                            hs.put("backpressure_ms", st.backpressureMs);
                            hs.put("completed", st.completed);
                            hs.put("error", st.error);
                            baseOut.put("host_stream_stats", hs);
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
