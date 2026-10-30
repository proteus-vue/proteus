package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/PerfProbe.java
// ★★★#1404 请求层**真机并发吞吐**判据（Android 侧）—— 与 iOS `hosts/ios/run-perf-probe.sh` 同一份口径。
//
// 【它回答什么】
//   已有真机证据只回答"**单个**请求的稳定往返多快"（ttfb 个位数 ms）。
//   而采购方问的是"**每秒能扛多少**" —— 那是**并发**下的吞吐，不是单请求延迟的倒数：
//   连接池复用、事件循环调度、QuickJS 的 Promise 微任务都在并发下才暴露 ⇒ 必须实测。
//
// 【★为什么必须是 Java 探针类，而不是 `capprobe js:<表达式>`】
//   实测取证（`capprobe` 分支注释里已写明）：`js:` 是**裸 eval**，`__proteusHostInvoke`
//   等全局在裸上下文里不存在（ReferenceError）——那些全局是 bundle 装进 JS 上下文后才有的。
//   本类与 `UseFetchProbe` 同形态：先把 `bundle-superapp.js` eval 进去（`evalWithHost` 注入宿主桥），
//   再调 bundle 暴露的全局 `__proteusHostAppPerfProbe(base, concurrency, total)`。
//
// 【★收口机制（主动上报 + 有界驱动，不是空等）】探针是异步的（内部 `void run()`），结果回填到
//   `globalThis.__proteusHostPerfProbeResult`。本类在主线程上循环**主动驱动 JS 运行时**
//   （`nativeRunPendingJobs` 跑微任务；`postDelayed(…,5)` 让 Looper 有机会处理宿主回推的
//   异步结果）直到该全局非空，再落盘 report。
//   ★如实说明：这**是**一个 5ms 步进的循环——但它不是"等外部条件自己变好"，
//     而是"每次迭代都在推进被测运行时"（QuickJS 单线程，不推它，Promise 永远不会结算）；
//     形态与 `UseFetchProbe` 逐件相同。循环有**确定上界**（DEADLINE_MS），
//     到界即报"装置不确定"而不是当通过。
//
// 【诚实边界】
//   ① 只走 `useFetch` 门面，**不经过** `createRequestClient` 治理层（配额/限速/审计）
//      ⇒ 量到的是"传输 + 门面"的吞吐；治理层开销另由 `scripts/bench-request.mjs` 量（低于噪声底）。
//   ② 服务端是**单进程 node**（`transfer-echo-server.mjs`），可能先成为瓶颈。
//   ③ 局域网 ≠ 公网。
public final class PerfProbe {
    private PerfProbe() {}

    public static final String REPORT = "perf-probe.json";
    private static java.util.function.BiConsumer<String, String> reportSinkFn = null;
    public static void setReportSink(java.util.function.BiConsumer<String, String> sink) { reportSinkFn = sink; }
    static void reportSink(String content) {
        if (reportSinkFn != null) { reportSinkFn.accept(REPORT, content); return; }
        android.util.Log.w("proteus", "perf-probe 结果无落盘出口：" + content);
    }

    /** 上界：一次 200 请求 iOS 实测 ~0.35s；给 60s 是"装置不确定"与"框架慢"的分界 */
    private static final long DEADLINE_MS = 60000;

    public static String run(android.app.Activity activity, android.view.ViewGroup root) {
        org.json.JSONObject out = new org.json.JSONObject();
        try {
            String base = "http://127.0.0.1:8977";
            int conc = 8;
            int total = 200;
            android.content.Intent it = activity.getIntent();
            if (it != null) {
                String b = it.getStringExtra("base");
                if (b != null && !b.isEmpty()) base = b;
                conc = it.getIntExtra("conc", 8);
                total = it.getIntExtra("total", 200);
            }
            out.put("base", base);
            out.put("concurrency", conc);
            out.put("total", total);
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

            // ★与 UseFetchProbe 逐件相同的装配（少一件桥就不通）
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
                    "typeof __proteusHostAppPerfProbe==='function'"
                    + "?__proteusHostAppPerfProbe(" + org.json.JSONObject.quote(base)
                    + "," + conc + "," + total + "):'no-hook'");
            out.put("probe_kick", kick.ok ? kick.value : ("ERR:" + kick.error));
            if (!kick.ok || !String.valueOf(kick.value).contains("started")) {
                out.put("ok", false);
                out.put("error", "探针未启动（hook 缺失或参数错）");
                reportSink(out.toString());
                return out.toString();
            }

            final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
            final long deadline = System.currentTimeMillis() + DEADLINE_MS;
            final int[] rounds = { 0 };
            final org.json.JSONObject baseOut = out;
            final Runnable[] step = new Runnable[1];
            step[0] = new Runnable() {
                @Override public void run() {
                    // ★驱微任务 + 推进定时器（`nativeRunPendingJobs` 只跑微任务；setTimeout 链要另推）
                    QuickJsEngine.nativeRunPendingJobs();
                    QuickJsEngine.EvalResult rr = QuickJsEngine.eval(
                            "String(globalThis.__proteusHostPerfProbeResult || '')");
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
