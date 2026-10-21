package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/StaleProbe.java
// ★★★决策 #1150：**RFC 5861 两条扩展指令**（`stale-while-revalidate` / `stale-if-error`）
//   的真机判据——Android 侧。
//
// 【它证明什么（Node 层判据证明不了的部分）】
//   `tests/fetch-stale.test.ts` 跑在 undici 上，验的是"框架层语义"。真机上多一层风险：
//   App 引擎**没有 `setTimeout`、没有全局 `fetch`** ⇒ SWR 的**后台校验**能否真的发出去
//   只能实测。若发不出去，SWR 就退化成"永远返回旧值"——那比不做更糟（数据永不更新）。
//
// 【判据（都以服务端记账为准）】
//   ① SWR：窗口内第二次 `status=stale/staleReason=swr` + **立即返回**（不等后台）
//      + 服务端随后收到**一次条件校验** + 新值进缓存（第三次拿到更新的代）；
//   ② SWR 窗口=0 ⇒ 不得返回 stale；
//   ③ SIE：源站 503 ⇒ 用旧值兜底（`staleReason=stale-if-error`），业务看不到错误；
//   ④ Age 头存在（RFC 9111 §5.1 MUST）。
//
// 【装置形态与 CacheProbe / UseFetchProbe 逐件相同（决策 #1122 起的范式）】
//   bundle-superapp → 调 `__proteusHostAppStaleProbe(base)` → 轮询结果变量 → 落报告。
//
// ★`package` 只在文件第一行（本目录的类都属于 `dev.proteus.layoutcore`；
//   物理目录带 /dev/ 不影响包声明，但重复声明是语法错误）。

public final class StaleProbe {
    private StaleProbe() {}

    public static final String REPORT = "stale-probe.json";
    private static java.util.function.BiConsumer<String, String> reportSinkFn = null;
    public static void setReportSink(java.util.function.BiConsumer<String, String> sink) { reportSinkFn = sink; }
    static void reportSink(String content) {
        if (reportSinkFn != null) { reportSinkFn.accept(REPORT, content); return; }
        android.util.Log.w("proteus", "stale-probe 结果无落盘出口：" + content);
    }

    /**
     * 探针内含"等后台校验落地"的轮询（≤5s）+ **约 13 次串行 HTTP 往返**
     * （SWR 3 次 + 记账 3 次 + swr-zero 2 次 + SIE 4 次 + 故障开关 3 次）。
     * ★首版给了 30s，实测**不够**（真机实测：到"第三次请求完成"就用完了 ⇒ 判据全空、
     *   看起来像"框架全坏"，实际是**装置预算太紧**）。⇒ 给 120s（远大于正常 ~30s 完成时间）。
     */
    private static final long STEP_TIMEOUT_MS = 120000;

    public static String run(android.app.Activity activity, android.view.ViewGroup root) {
        org.json.JSONObject out = new org.json.JSONObject();
        try {
            String base = "http://127.0.0.1:8804";
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
                    "typeof __proteusHostAppStaleProbe==='function'"
                    + "?__proteusHostAppStaleProbe(" + org.json.JSONObject.quote(base) + "):'no-hook'");
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
                            "String(globalThis.__proteusHostStaleProbeResult || '')");
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
                            baseOut.put("stale_probe", p);
                            baseOut.put("ok", p.optBoolean("ok", false));
                        } else {
                            baseOut.put("ok", false);
                            baseOut.put("error", "探针结果超时（装置不确定，非框架结论）");
                            // ★★★进度埋点（超时也带回现场）：停在哪个 step、当时的附加读数。
                            //   本轮首跑"服务端零请求 + 无任何读数"只能靠猜 ⇒ 加这条才能归因。
                            QuickJsEngine.EvalResult pg = QuickJsEngine.eval(
                                    "String(globalThis.__proteusHostStaleProbeProgress || '')");
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
