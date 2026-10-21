package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/TransportProbe.java
// ★★★决策 #1155：**传输层事实取证**——HTTP/2 与连接复用**是否已经在工作**。
//
// 【为什么这个探针先于"引 OkHttp"存在】
//   矩阵 P1 写着「HTTP/2 + 连接池：需 Android 引入 OkHttp（APK +Δ）」。
//   而 **Android 的 `HttpURLConnection` 底层就是 OkHttp**（AOSP 4.4+ 的 `com.android.okhttp`）
//   ⇒ 这两项能力**可能早就在工作**，缺的只是"我们看不见"（没有可观测字段）。
//   ⇒ **先实测，再决定要不要为了一个已经工作的能力把 APK 涨 1MB**。
//
// 【判据以服务端记账为准】客户端说"我复用了连接"不算；服务端数过几次 TCP 握手才算。
//
// 【装置】参数经**文件**传（`base` 含 `:`、`pin` 是 base64 含 `=`/`+`/`/`——
//   经 `adb shell` 会掉字符，#1154 实测踩过：收到的 pin 末尾多出一个 `)`）。
public final class TransportProbe {
    private TransportProbe() {}

    public static final String REPORT = "transport-probe.json";
    private static final String ARGS_FILE = "transport-probe-args.json";
    private static java.util.function.BiConsumer<String, String> reportSinkFn = null;
    public static void setReportSink(java.util.function.BiConsumer<String, String> sink) { reportSinkFn = sink; }
    static void reportSink(String content) {
        if (reportSinkFn != null) { reportSinkFn.accept(REPORT, content); return; }
        android.util.Log.w("proteus", "transport-probe 结果无落盘出口：" + content);
    }

    private static final long STEP_TIMEOUT_MS = 90000;

    public static String run(android.app.Activity activity, android.view.ViewGroup root) {
        org.json.JSONObject out = new org.json.JSONObject();
        try {
            String raw = readFile(activity, ARGS_FILE);
            out.put("args_file_ok", raw != null);
            if (raw == null) {
                out.put("ok", false); out.put("error", "缺参数文件 " + ARGS_FILE);
                reportSink(out.toString()); return out.toString();
            }
            org.json.JSONObject args = new org.json.JSONObject(raw);
            String base = args.optString("base", "");
            String pin = args.optString("pin", "");
            // ★#1155：明文对照端口（连接复用基线）——判断"不复用"是不是 pinning 引入的
            String plainBase = args.optString("plainBase", "");
            int rounds = args.optInt("rounds", 3);
            out.put("base", base);
            out.put("plain_base", plainBase);
            out.put("rounds", rounds);
            if (base.isEmpty() || pin.isEmpty()) {
                out.put("ok", false); out.put("error", "参数不全（base/pin）");
                reportSink(out.toString()); return out.toString();
            }
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
                    "typeof __proteusHostAppTransportProbe==='function'"
                    + "?__proteusHostAppTransportProbe(" + org.json.JSONObject.quote(base)
                    + "," + org.json.JSONObject.quote(pin)
                    + "," + rounds + "," + org.json.JSONObject.quote(plainBase) + "):'no-hook'");
            out.put("probe_kick", kick.ok ? kick.value : ("ERR:" + kick.error));
            if (!kick.ok || !String.valueOf(kick.value).contains("started")) {
                out.put("ok", false);
                out.put("error", "探针未启动（hook 缺失或参数错）");
                reportSink(out.toString());
                return out.toString();
            }

            final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
            final long deadline = System.currentTimeMillis() + STEP_TIMEOUT_MS;
            final int[] polls = { 0 };
            final org.json.JSONObject baseOut = out;
            final Runnable[] step = new Runnable[1];
            step[0] = new Runnable() {
                @Override public void run() {
                    QuickJsEngine.nativeRunPendingJobs();
                    QuickJsEngine.EvalResult rr = QuickJsEngine.eval(
                            "String(globalThis.__proteusHostTransportProbeResult || '')");
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
                            baseOut.put("transport_probe", p);
                            baseOut.put("ok", p.optBoolean("ok", false));
                        } else {
                            baseOut.put("ok", false);
                            baseOut.put("error", "探针结果超时（装置不确定，非框架结论）");
                            QuickJsEngine.EvalResult pg = QuickJsEngine.eval(
                                    "String(globalThis.__proteusHostTransportProbeProgress || '')");
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

    /** 读报告目录下的参数/结果文件（runner 用 `adb push` 放进去）。 */
    private static String readFile(android.content.Context ctx, String name) {
        try {
            java.io.File f = new java.io.File(ctx.getExternalFilesDir(null), name);
            if (!f.exists()) return null;
            byte[] buf = new byte[(int) f.length()];
            try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
                int off = 0;
                while (off < buf.length) {
                    int n = in.read(buf, off, buf.length - off);
                    if (n <= 0) break;
                    off += n;
                }
            }
            return new String(buf, java.nio.charset.StandardCharsets.UTF_8);
        } catch (Throwable t) {
            return null;
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
