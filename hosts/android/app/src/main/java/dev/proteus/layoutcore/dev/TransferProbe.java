package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/TransferProbe.java
// ★★★决策 #1095（C29/C30 上传/下载 · Android 腿）：**端到端真机判据**。
//
// 【它证明什么（缺一即红）】
//   ① `fs.writeBytes` 真把字节写进沙箱（下载落盘）；
//   ② `fs.readBytes` 真能读回同样的字节（上传前的读文件）；
//   ③ **上传/下载往返逐字节正确**——服务端回 `{bytes,first,last,sum}`，探针断言
//      `bytes=4096 · first=0 · last=255`（服务端按 `i % 256` 生成内容）；
//   ④ 沙箱**拒绝**绝对路径与 `..`（安全边界，与 G-49 deny-by-default 同纪律）；
//   ⑤ `fs.remove` 幂等（删两次都成功）。
//
// 【为什么必须真机】单测验的是桥的组包与参数契约（`capability-app-transfer.test.ts`）；
//   真机验的是**宿主文件系统 + 真 HTTP 往返**（沙箱路径、multipart 被服务端正确解析）。

import android.app.Activity;
import android.view.ViewGroup;

import org.json.JSONObject;

public final class TransferProbe {
    private TransferProbe() {}

    public static final String REPORT = "transfer-probe.json";
    /** ★#1095：报告落盘出口（探针**异步收尾**——真实结果由最后一步写盘）。 */
    private static java.util.function.BiConsumer<String, String> reportSinkFn = null;
    public static void setReportSink(java.util.function.BiConsumer<String, String> sink) { reportSinkFn = sink; }
    static void reportSink(String content) {
        if (reportSinkFn != null) { reportSinkFn.accept(REPORT, content); return; }
        android.util.Log.w("proteus", "transfer-probe 结果无落盘出口：" + content);
    }
    private static final long STEP_TIMEOUT_MS = 10000;

    public static String run(Activity activity, ViewGroup root) {
        JSONObject out = new JSONObject();
        try {
            String base = "http://127.0.0.1:8788";
            android.content.Intent it = activity.getIntent();
            if (it != null) {
                String u = it.getStringExtra("transferUrl");
                if (u != null && !u.isEmpty()) base = u;
            }
            out.put("base", base);
            out.put("engine_available", QuickJsEngine.isAvailable());
            if (!QuickJsEngine.isAvailable()) return out.put("ok", false).put("error", "引擎未加载").toString(2);

            String bundle = readAsset(activity, "bundle-superapp.js");
            if (bundle == null) return out.put("ok", false).put("error", "缺 assets/bundle-superapp.js").toString(2);

            // 与真实壳同一栈（与 WebSocketProbe 逐件相同）
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
            if (!load.ok) return out.put("ok", false).put("error", "bundle eval 失败：" + load.error).toString(2);
            QuickJsEngine.EvalResult boot = QuickJsEngine.eval("__proteusSuperappBootJson()");
            out.put("boot_ok", boot.ok);
            QuickJsEngine.nativeRunPendingJobs();
            double vw = dm.widthPixels / dm.density, vh = dm.heightPixels / dm.density;
            String renderArgs = new JSONObject().put("name", "index")
                    .put("viewport", new JSONObject().put("width", vw).put("height", vh))
                    .put("remount", true).toString();
            QuickJsEngine.EvalResult render = QuickJsEngine.eval("__proteusSuperappRender(" + JSONObject.quote(renderArgs) + ")");
            out.put("render_ok", render.ok);
            QuickJsEngine.nativeRunPendingJobs();

            // ── ① 安全边界：绝对路径与 '..' 必须被拒 ──
            out.put("abs_path_rejected", rejectProbe(activity, "/etc/passwd"));
            out.put("dotdot_rejected", rejectProbe(activity, "../escape.txt"));

            // ── ② 端到端探针（JS 侧泵驱动）──
            // ★★★#1095 真机抓出的**结构性死锁**（与 ws 同族但更隐蔽）：
            //   `http.request` 的异步回推是**切主线程**调 `QuickJsEngine.resolveHostBytes`；
            //   而"在主线程写 while + sleep 的泵循环"会让主线程**永远不进消息循环**
            //   ⇒ 回推 Runnable 排不上 ⇒ Promise 永不 settle（实测：服务端已回 4096B，探针零结果）。
            //   ★`post + latch.await` 也救不了（自己等自己）。
            //   ⇒ 正解：**不用 while 循环**，改成把"推进"本身 post 进主线程队列——
            //     让主线程在**正常消息循环**里既跑回推、又跑我们的推进步。
            QuickJsEngine.EvalResult kick = QuickJsEngine.eval(
                    "typeof __proteusHostAppTransferProbe==='function'"
                    + "?__proteusHostAppTransferProbe(" + JSONObject.quote(base) + "):'no-hook'");
            out.put("probe_kick", kick.ok ? kick.value : ("ERR:" + kick.error));

            // ★★★#1095：**异步收尾**——不在主线程等待。
            //   本方法返回占位报告；真实结果由最后一次 step 落盘（writeReport）。
            //   ★为什么必须这样：http.request 的回推切主线程，任何"主线程等待"都会饿死它。
            final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
            final long deadline = System.currentTimeMillis() + STEP_TIMEOUT_MS * 12;
            final int[] rounds = { 0 };
            final Runnable[] step = new Runnable[1];
            final JSONObject base_out = out;
            step[0] = new Runnable() {
                @Override public void run() {
                    WebSocketCapability.drainPendingPushes();
                    QuickJsEngine.nativeRunPendingJobs();
                    QuickJsEngine.EvalResult rr = QuickJsEngine.eval(
                            "String(globalThis.__proteusHostTransferProbeResult || '')");
                    String v = rr.ok ? rr.value : null;
                    rounds[0]++;
                    final boolean got = v != null && !v.isEmpty() && !"undefined".equals(v) && !"null".equals(v);
                    if (!got && System.currentTimeMillis() < deadline) {
                        h.postDelayed(step[0], 5);   // 排到队列尾（让回推先跑）
                        return;
                    }
                    // ★收尾：写最终报告（覆盖占位）
                    try {
                        base_out.put("probe_rounds", rounds[0]);
                        base_out.put("probe_raw", got ? v : null);
                        if (got) {
                            JSONObject p = tryParse(v);
                            base_out.put("probe", p == null ? v : p);
                            base_out.put("ok", p != null && p.optBoolean("ok", false)
                                    && base_out.optBoolean("abs_path_rejected", false)
                                    && base_out.optBoolean("dotdot_rejected", false));
                        } else {
                            base_out.put("ok", false).put("error", "探针结果未出现（deadline）");
                        }
                        TransferProbe.reportSink(base_out.toString());
                    } catch (Throwable t) {
                        android.util.Log.e("proteus", "transfer-probe 收尾失败", t);
                    }
                }
            };
            h.post(step[0]);
            out.put("probe_rounds", -1);   // ★占位：真实值在收尾报告里
            out.put("probe_async", true);
        } catch (Throwable t) {
            try {
                out.put("ok", false).put("error", "探针异常：" + t + "（" + android.util.Log.getStackTraceString(t) + "）");
            } catch (Exception ignored) { }
        }
        return out.toString();
    }

    /** 起一次 fs.writeBytes，期望被拒（返回 true = 确实被拒）。 */
    private static boolean rejectProbe(Activity activity, String path) {
        try {
            JSONObject args = new JSONObject().put("path", path).put("bytes", new org.json.JSONArray());
            FileTransferCapability.writeBytes(activity, args);
            return false;   // 没抛 ⇒ 没拒绝（安全边界失效）
        } catch (Throwable t) {
            return true;
        }
    }

    private static JSONObject tryParse(String s) {
        try { return new JSONObject(s); } catch (Exception e) { return null; }
    }

    private static String readAsset(Activity activity, String name) {
        try (java.io.InputStream in = activity.getAssets().open(name)) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) {
            return null;
        }
    }
}
