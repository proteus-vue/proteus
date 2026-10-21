package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/PersistProbe.java
// ★★★决策 #1151：**HTTP 缓存持久层（L2）**真机判据——Android 侧（**两阶段跨进程**）。
//
// 【为什么必须是两次进程启动（这是本探针唯一的存在理由）】
//   `tests/fetch-cache-persist.test.ts` 用"新 store 实例"模拟重启，证明代码路径对。
//   但真机上还有一件 Node 判据**根本证不了**的事：
//     宿主真的把缓存条目写到沙箱盘上了吗？下一**次进程**真的读得回来吗？
//   （App 端链路：JS → `invokeHostAsync('fs.writeBytes')` → `FileTransferCapability` → 沙箱文件）
//   ⇒ `phase=write` 跑一次并落盘，进程退出；`phase=read` **重新启动**再跑 ⇒ 必须命中。
//   ★硬证据在**服务端记账**：第二次如果真发了请求，`hits` 会 +1（runner 侧断言）。
//
// 【装置形态与 CacheProbe / StaleProbe 逐件相同（决策 #1122 起的范式）】
//   bundle-superapp → 调 `__proteusHostAppPersistProbe(base, phase)` → 轮询结果变量 → 落报告。
//
// ★`package` 只在文件第一行（本目录的类都属于 `dev.proteus.layoutcore`）。

public final class PersistProbe {
    private PersistProbe() {}

    public static final String REPORT = "persist-probe.json";
    private static java.util.function.BiConsumer<String, String> reportSinkFn = null;
    public static void setReportSink(java.util.function.BiConsumer<String, String> sink) { reportSinkFn = sink; }
    static void reportSink(String content) {
        if (reportSinkFn != null) { reportSinkFn.accept(REPORT, content); return; }
        android.util.Log.w("proteus", "persist-probe 结果无落盘出口：" + content);
    }

    /** 单阶段只做一次请求 + 一次 flush，给 60s 足够（App 端 fs 落盘要一次宿主往返）。 */
    private static final long STEP_TIMEOUT_MS = 60000;

    public static String run(android.app.Activity activity, android.view.ViewGroup root) {
        org.json.JSONObject out = new org.json.JSONObject();
        try {
            String base = "http://127.0.0.1:8805";
            String phase = "write";
            android.content.Intent it = activity.getIntent();
            if (it != null) {
                String b = it.getStringExtra("base");
                if (b != null && !b.isEmpty()) base = b;
                String p = it.getStringExtra("phase");
                if (p != null && !p.isEmpty()) phase = p;
            }
            out.put("base", base);
            out.put("intent_phase", phase);
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
                    "typeof __proteusHostAppPersistProbe==='function'"
                    + "?__proteusHostAppPersistProbe(" + org.json.JSONObject.quote(base)
                    + "," + org.json.JSONObject.quote(phase) + "):'no-hook'");
            out.put("probe_kick", kick.ok ? kick.value : ("ERR:" + kick.error));
            if (!kick.ok || !String.valueOf(kick.value).contains("started")) {
                out.put("ok", false);
                out.put("error", "探针未启动（hook 缺失或参数错）");
                reportSink(out.toString());
                return out.toString();
            }

            final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
            final long deadline = System.currentTimeMillis() + STEP_TIMEOUT_MS;
            final int[] rounds = { 0 };
            final org.json.JSONObject baseOut = out;
            final Runnable[] step = new Runnable[1];
            step[0] = new Runnable() {
                @Override public void run() {
                    QuickJsEngine.nativeRunPendingJobs();
                    QuickJsEngine.EvalResult rr = QuickJsEngine.eval(
                            "String(globalThis.__proteusHostPersistProbeResult || '')");
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
                            baseOut.put("persist_probe", p);
                            baseOut.put("ok", p.optBoolean("ok", false));
                        } else {
                            baseOut.put("ok", false);
                            baseOut.put("error", "探针结果超时（装置不确定，非框架结论）");
                            QuickJsEngine.EvalResult pg = QuickJsEngine.eval(
                                    "String(globalThis.__proteusHostPersistProbeProgress || '')");
                            baseOut.put("probe_progress", pg.ok ? pg.value : ("ERR:" + pg.error));
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
            java.io.ByteArrayOutputStream acc = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = is.read(buf)) > 0) acc.write(buf, 0, n);
            return new String(acc.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Throwable t) {
            return null;
        }
    }
}
