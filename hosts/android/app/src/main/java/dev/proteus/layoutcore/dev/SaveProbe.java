package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/SaveProbe.java
// ★★★#1119：**download 流式落盘（S3）真机判据**——Android 侧。
//
// 【它证明什么（缺一不算 S3）】
//   ① 落盘成功且**字节数正确**（不是"调用成功"就算）；
//   ② **JS 侧不碰字节**：`responseType:'path'` 回来的 `data` 是路径字符串，
//      不是 Uint8Array / number[]——这是"内存与文件大小解耦"的**结构证据**；
//   ③ **宿主记账**：`peak_chunk_bytes` 应 ≈ 16 KiB（单块缓冲），
//      与文件总大小**无关**；`chunks` 随文件增大而增多，但内存不增。
//      ★这是本判据的核心：没有这个读数，"看起来成功"与"其实整包驻留"无法区分。
//   ④ **内容正确**：JS 侧读回文件抽样比对（服务端序列 buf[i] = i % 256）。
//
// 【为什么用 8 MiB 而不是 4 KiB】4 KiB 在任何实现下都不会 OOM，
//   测不出"整包驻留 vs 边收边写"的差别（#1105「逐点差异测不出织纹」同族）。
//
// 【装置形态与 StreamProbe/FetchLimitProbe 逐件相同（照抄，避免再踩 no-hook 三连）】
//   ① 必须自己载入 bundle 并 boot；② 探针函数必须挂 globalThis；
//   ③ 参数走 `am start --es/--ei`；④ 异步收尾用 `Handler.postDelayed` 递归。
public final class SaveProbe {
    private SaveProbe() {}

    public static final String REPORT = "save-probe.json";
    private static java.util.function.BiConsumer<String, String> reportSinkFn = null;
    public static void setReportSink(java.util.function.BiConsumer<String, String> sink) { reportSinkFn = sink; }
    static void reportSink(String content) {
        if (reportSinkFn != null) { reportSinkFn.accept(REPORT, content); return; }
        android.util.Log.w("proteus", "save-probe 结果无落盘出口：" + content);
    }

    private static final long STEP_TIMEOUT_MS = 10000;

    public static String run(android.app.Activity activity, android.view.ViewGroup root) {
        org.json.JSONObject out = new org.json.JSONObject();
        try {
            String base = "http://127.0.0.1:8788";
            int sizeMiB = 8;
            android.content.Intent it = activity.getIntent();
            if (it != null) {
                String b = it.getStringExtra("base");
                if (b != null && !b.isEmpty()) base = b;
                sizeMiB = it.getIntExtra("size_mib", 8);
            }
            out.put("base", base);
            out.put("size_mib", sizeMiB);
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
                    "typeof __proteusHostAppSaveProbe==='function'"
                    + "?__proteusHostAppSaveProbe(" + org.json.JSONObject.quote(base) + "," + sizeMiB + "):'no-hook'");
            out.put("probe_kick", kick.ok ? kick.value : ("ERR:" + kick.error));
            if (!kick.ok || !String.valueOf(kick.value).contains("started")) {
                out.put("ok", false);
                out.put("error", "探针未启动（hook 缺失或参数错）");
                reportSink(out.toString());
                return out.toString();
            }

            final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
            final long deadline = System.currentTimeMillis() + STEP_TIMEOUT_MS * 30;
            final int[] rounds = { 0 };
            final org.json.JSONObject baseOut = out;
            final Runnable[] step = new Runnable[1];
            step[0] = new Runnable() {
                @Override public void run() {
                    QuickJsEngine.nativeRunPendingJobs();
                    QuickJsEngine.EvalResult rr = QuickJsEngine.eval(
                            "String(globalThis.__proteusHostSaveProbeResult || '')");
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
                            // ★宿主记账：证明"内存只与块大小相关"（peak_chunk_bytes ≈ 16 KiB）
                            SaveStats st = HttpCapability.lastSaveStats();
                            org.json.JSONObject hs = new org.json.JSONObject();
                            hs.put("bytes", st.bytes);
                            hs.put("chunks", st.chunks);
                            hs.put("peak_chunk_bytes", st.peakChunkBytes);
                            hs.put("completed", st.completed);
                            hs.put("path", st.path);
                            hs.put("error", st.error);
                            baseOut.put("host_save_stats", hs);
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
