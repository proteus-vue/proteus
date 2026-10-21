package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/TlsProbe.java
// ★★★决策 #1153：**TLS 证书 pinning** 真机判据——Android 侧。
//
// 【它证明什么（Node 判据证不了的部分）】pinning 只在 **TLS 握手**阶段生效，握手在宿主里发生
//   （`SSLSocketFactory` / `X509TrustManager`）⇒ "证书不对时连接真的被拒"只能真机证。
//
// 【四条判据】① pin 命中（pinOnly）⇒ 成功 ② pin 未命中 ⇒ `fetch.tlsError`
//   ③ 叠加模式真的叠加（pin 对但不开 pinOnly ⇒ 自签被系统信任拒）④ 无 pin ⇒ 自签被拒。
//
// 【装置形态与 PersistProbe / StaleProbe 逐件相同（决策 #1122 起的范式）】
//   bundle-superapp → 调 `__proteusHostAppTlsProbe(baseA, baseB, pinA, pinB)` → 轮询结果 → 落报告。
//
// ★`package` 只在文件第一行（本目录的类都属于 `dev.proteus.layoutcore`）。

public final class TlsProbe {
    private TlsProbe() {}

    public static final String REPORT = "tls-probe.json";
    private static java.util.function.BiConsumer<String, String> reportSinkFn = null;
    public static void setReportSink(java.util.function.BiConsumer<String, String> sink) { reportSinkFn = sink; }
    static void reportSink(String content) {
        if (reportSinkFn != null) { reportSinkFn.accept(REPORT, content); return; }
        android.util.Log.w("proteus", "tls-probe 结果无落盘出口：" + content);
    }

    /** 5 次请求（每次最多 20s，但自签握手失败是**快**失败）⇒ 90s 足够。 */
    private static final long STEP_TIMEOUT_MS = 90000;

    public static String run(android.app.Activity activity, android.view.ViewGroup root) {
        org.json.JSONObject out = new org.json.JSONObject();
        try {
            String baseA = "", baseB = "", pinA = "", pinB = "";
            android.content.Intent it = activity.getIntent();
            if (it != null) {
                // ★★所有参数**以文件为准**（`adb shell` 的引号/逗号/`=` 都会咬参数，实测踩过两次）：
                //   多行续行导致全空、逗号端口列表又一次全空。`--es` 只用来传 `path`。
                baseA = nullToEmpty(it.getStringExtra("base_a"));
                baseB = nullToEmpty(it.getStringExtra("base_b"));
                String pinsJson = readFile(activity, "tls-pins.json");
                out.put("pins_file_ok", pinsJson != null);
                if (pinsJson != null) {
                    try {
                        org.json.JSONObject pins = new org.json.JSONObject(pinsJson);
                        baseA = pins.optString("baseA", baseA);
                        baseB = pins.optString("baseB", baseB);
                        pinA = pins.optString("a", "");
                        pinB = pins.optString("b", "");
                    } catch (Throwable t) {
                        out.put("pins_parse_error", String.valueOf(t));
                    }
                }
            }
            out.put("base_a", baseA);
            out.put("base_b", baseB);
            out.put("engine_available", QuickJsEngine.isAvailable());
            if (!QuickJsEngine.isAvailable()) {
                out.put("ok", false); out.put("error", "引擎未加载");
                reportSink(out.toString()); return out.toString();
            }
            if (baseA.isEmpty() || baseB.isEmpty() || pinA.isEmpty() || pinB.isEmpty()) {
                out.put("ok", false); out.put("error", "缺参数（base_a/base_b/pin_a/pin_b）");
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
                    "typeof __proteusHostAppTlsProbe==='function'"
                    + "?__proteusHostAppTlsProbe(" + org.json.JSONObject.quote(baseA)
                    + "," + org.json.JSONObject.quote(baseB)
                    + "," + org.json.JSONObject.quote(pinA)
                    + "," + org.json.JSONObject.quote(pinB) + "):'no-hook'");
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
                            "String(globalThis.__proteusHostTlsProbeResult || '')");
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
                            baseOut.put("tls_probe", p);
                            baseOut.put("ok", p.optBoolean("ok", false));
                        } else {
                            baseOut.put("ok", false);
                            baseOut.put("error", "探针结果超时（装置不确定，非框架结论）");
                            QuickJsEngine.EvalResult pg = QuickJsEngine.eval(
                                    "String(globalThis.__proteusHostTlsProbeProgress || '')");
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

    private static String nullToEmpty(String s) { return s == null ? "" : s; }

    /** 读**报告目录**下的一个文件（runner 用 `adb push` 放到同一目录）。 */
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
