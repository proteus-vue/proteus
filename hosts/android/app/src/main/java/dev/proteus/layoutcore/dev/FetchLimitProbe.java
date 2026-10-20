package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/FetchLimitProbe.java
// ★★★决策 #1115（C26 useFetch 规模闸 · Android 腿）：**响应体上限的真机判据**。
//
// 【它证明什么（缺一即红）】请求一个 64 MiB 响应（两倍于两端 32 MiB 上限），必须拿到
//   `code === 'fetch.tooLarge'`。三种失败形态都要能被识别：
//     · 请求**成功返回** ⇒ 上限根本没生效（最危险：以为有闸，其实无界）
//     · 拿到 `fetch.failed` ⇒ 错误码没到位（业务无法区分"重试有用"与"太大重试无用"）
//     · 探针自身超时/无结果 ⇒ 装置问题（**不当作框架失败**，报告里如实区分）
//   ★并且**两道闸各测一次**：
//     · `chunked=0`（带 content-length）⇒ 走**预判**闸：一块都不该读
//     · `chunked=1`（不声明长度、分块写）⇒ 走**累计**闸：读够 32 MiB 才拒，且必须真中止
//     只测一个有洞——未知/谎报长度时预判失效，那正是流式响应最常见的形态。
//
// 【为什么必须真机】单测（`tests/fetch-body-limit.test.ts`）复刻的是**算法**；
//   真机验的是「宿主真的把上限接进了读取路径」——两者之间的差距，本仓已踩过多次
//   （"有实现没接上"：决策 #1074/#1094 同族）。

import android.app.Activity;
import android.view.ViewGroup;

import org.json.JSONObject;

public final class FetchLimitProbe {
    private FetchLimitProbe() {}

    public static final String REPORT = "fetch-limit-probe.json";
    /** 报告落盘出口（异步收尾——真实结果由最后一步写盘，与 TransferProbe 同款）。 */
    private static java.util.function.BiConsumer<String, String> reportSinkFn = null;
    public static void setReportSink(java.util.function.BiConsumer<String, String> sink) { reportSinkFn = sink; }
    static void reportSink(String content) {
        if (reportSinkFn != null) { reportSinkFn.accept(REPORT, content); return; }
        android.util.Log.w("proteus", "fetch-limit-probe 结果无落盘出口：" + content);
    }
    private static final long STEP_TIMEOUT_MS = 10000;

    /**
     * @param base 本地服务基址（`http://<ip>:8788`）
     * @param sizeMiB 请求的响应体大小（默认 64 = 两倍上限）
     */
    public static String run(Activity activity, ViewGroup root) {
        JSONObject out = new JSONObject();
        try {
            String base = "http://127.0.0.1:8788";
            int sizeMiB = 64;
            android.content.Intent it = activity.getIntent();
            if (it != null) {
                String b = it.getStringExtra("base");
                if (b != null && !b.isEmpty()) base = b;
                sizeMiB = it.getIntExtra("size_mib", 64);
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
            // ★★与真实壳同一栈（与 TransferProbe/WebSocketProbe 逐件相同）——
            //   探针必须**自己把 bundle 载入并 boot**：本类的 entry 与 app 是分开的进程路径，
            //   不加载就 `eval` 到空引擎 ⇒ 全局探针函数不存在（实测报 `no-hook`）。
            android.util.DisplayMetrics dm = activity.getResources().getDisplayMetrics();
            VaporRenderHost draw = new VaporRenderHost(activity, root);
            draw.setLengthScale(dm.density);
            JSONObject envObj = EnvVars.collect(activity, dm.density);
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

            // 调 JS 探针（同步入口回占位；结果由 JS 填进 __proteusHostFetchLimitProbeResult）
            QuickJsEngine.EvalResult kick = QuickJsEngine.eval(
                    "typeof __proteusHostAppFetchLimitProbe==='function'"
                    + "?__proteusHostAppFetchLimitProbe(" + JSONObject.quote(base) + "," + sizeMiB + "):'no-hook'");
            out.put("probe_kick", kick.ok ? kick.value : ("ERR:" + kick.error));
            if (!kick.ok || !String.valueOf(kick.value).contains("started")) {
                out.put("ok", false);
                out.put("error", "探针未启动（hook 缺失或参数错）");
                reportSink(out.toString());
                return out.toString();
            }

            // ★异步收尾：不在主线程死等（回推要进主线程消息循环——TransferProbe 已踩过）
            final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
            final long deadline = System.currentTimeMillis() + STEP_TIMEOUT_MS * 6;
            final int[] rounds = { 0 };
            final Runnable[] step = new Runnable[1];
            final JSONObject baseOut = out;
            step[0] = new Runnable() {
                @Override public void run() {
                    QuickJsEngine.nativeRunPendingJobs();
                    QuickJsEngine.EvalResult rr = QuickJsEngine.eval(
                            "String(globalThis.__proteusHostFetchLimitProbeResult || '')");
                    String v = rr.ok ? rr.value : null;
                    rounds[0]++;
                    final boolean got = v != null && !v.isEmpty() && !"undefined".equals(v) && !"null".equals(v);
                    if (!got && System.currentTimeMillis() < deadline) {
                        h.postDelayed(step[0], 5);   // 排到队列尾（让回推先跑）
                        return;
                    }
                    try {
                        baseOut.put("probe_rounds", rounds[0]);
                        baseOut.put("probe_raw", got ? v : null);
                        if (got) {
                            JSONObject p = new JSONObject(v);
                            baseOut.put("probe", p);
                            baseOut.put("ok", p.optBoolean("ok", false));
                        } else {
                            // ★超时 = **装置不确定**，不当作"框架失败"（如实区分）
                            baseOut.put("ok", false);
                            baseOut.put("error", "探针超时：未在 " + (STEP_TIMEOUT_MS * 6 / 1000) + "s 内拿到结果");
                        }
                    } catch (Exception e) {
                        try { baseOut.put("ok", false); baseOut.put("error", "报告组装失败：" + e); } catch (Exception ignored) { }
                    }
                    reportSink(baseOut.toString());
                }
            };
            h.postDelayed(step[0], 5);
            return out.toString();
        } catch (Exception e) {
            try { out.put("ok", false); out.put("error", String.valueOf(e)); } catch (Exception ignored) { }
            reportSink(out.toString());
            return out.toString();
        }
    }

    private static String readAsset(Activity activity, String name) {
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
