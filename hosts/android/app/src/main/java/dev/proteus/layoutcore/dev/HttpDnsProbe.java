package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/HttpDnsProbe.java
// ★★★#1169：**HTTPDNS 端到端真机判据**（Android + iOS 共用同一份 JS 探针）。
//
// 【它证明什么（三件，缺一不可）】
//   ① **基线成功**：同域名、不传 `httpDns` ⇒ 请求成功（证明网络本身通）；
//   ② **表生效**：传 `httpDns: { host: ['203.0.113.1'] }`（TEST-NET-3 不可达）⇒ 请求**必失败**；
//      若仍成功 ⇒ 宿主忽略了表（假绿）；
//   ③ **不静默忽略**：iOS 无自定义 DNS 钩子 ⇒ 传了表必须拿到 `fetch.unsupported`
//      （而不是"成功但走了系统 DNS"——那是假数据，比缺数据更糟）。
//
// 【★为什么必须真机】单测只能验"帧里有 tag 14"；"宿主真的按表解析"只能在设备上验。
//   与 #1169 的鸿蒙探针同一手法（不可达 IP ⇒ 失败 = 因果证据）。
public final class HttpDnsProbe {
    private HttpDnsProbe() {}

    public static final String REPORT = "httpdns-probe.json";
    private static java.util.function.BiConsumer<String, String> reportSinkFn = null;
    public static void setReportSink(java.util.function.BiConsumer<String, String> sink) { reportSinkFn = sink; }
    /**
     * ★★★#1183：脚本经 **广播** 传入的真实可达 IP。
     * <p>★为什么要静态字段：探针实际由 `am broadcast` 触发，而广播**不更新 Activity 的 Intent**
     *   ⇒ 在探针里 `getIntent().getStringExtra(...)` 恒为 null（真机实测踩过）。
     */
    private static volatile String pendingReachableIp = "";
    public static void noteReachableIp(String ip) { pendingReachableIp = ip == null ? "" : ip.trim(); }
    static void reportSink(String content) {
        if (reportSinkFn != null) { reportSinkFn.accept(REPORT, content); return; }
        android.util.Log.w("proteus", "httpdns-probe 结果无落盘出口：" + content);
    }
    private static final long STEP_TIMEOUT_MS = 90000;

    /**
     * @param base 本地服务基址（如 `http://192.168.1.124:9410`）
     * @param host 服务端的**域名**（用于 httpDns 表的键；必须是 URL 里的 host）
     */
    public static String run(android.app.Activity activity, android.view.ViewGroup root) {
        org.json.JSONObject out = new org.json.JSONObject();
        try {
            // ★#1169：base **留空** ⇒ JS 探针用 `https://<host>/`（真实域名才走 DNS；IP 字面量不查 DNS）
            String base = "";
            String host = "example.com";
            android.content.Intent it = activity.getIntent();
            if (it != null) {
                String b = it.getStringExtra("base");
                if (b != null && !b.isEmpty()) base = b;
                String h = it.getStringExtra("host");
                if (h != null && !h.isEmpty()) host = h;
            }
            out.put("base", base);
            out.put("host", host);
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

            /**
             * ★★★#1183：**该 host 的真实可达 IP**，用于"命中表且成功"那一轮。
             * <p>★为什么优先取 intent 传入的 `reachableIp`：本方法跑在**主线程**上，
             *   `InetAddress.getAllByName` 会抛 `NetworkOnMainThreadException`——
             *   而它被 `catch (Throwable)` 吞掉 ⇒ 静默得到空串（真机实测踩过：
             *   `reachable_ip:""` 但设备 `ping example.com` 明明能解析）。
             *   遂改为：**探针脚本侧解析后经 intent 传入**；本机兜底仅在非主线程时才用。
             */
            String reachableIp = "";
            {
                android.content.Intent it2 = activity.getIntent();
                if (it2 != null) {
                    String ri = it2.getStringExtra("reachableIp");
                    if (ri != null && !ri.isEmpty()) reachableIp = ri.trim();
                }
                // ★广播路径：`am broadcast` 不会更新 Activity 的 Intent ⇒ 优先用静态字段
                if (reachableIp.isEmpty() && !pendingReachableIp.isEmpty()) reachableIp = pendingReachableIp;
            }
            if (reachableIp.isEmpty() && android.os.Looper.myLooper() != android.os.Looper.getMainLooper()) {
                try {
                    for (java.net.InetAddress a : java.net.InetAddress.getAllByName(host)) {
                        if (a instanceof java.net.Inet4Address) { reachableIp = a.getHostAddress(); break; }
                    }
                } catch (Throwable ignored) { /* 解析不到 ⇒ 跳过该轮（如实跳过，不假装验过） */ }
            }
            out.put("reachable_ip", reachableIp);
            QuickJsEngine.EvalResult kick = QuickJsEngine.eval(
                    "typeof __proteusHostAppHttpDnsProbe==='function'"
                    + "?__proteusHostAppHttpDnsProbe(" + org.json.JSONObject.quote(base)
                    + "," + org.json.JSONObject.quote(host)
                    + "," + org.json.JSONObject.quote(reachableIp) + "):'no-hook'");
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
                            "String(globalThis.__proteusHostHttpDnsProbeResult || '')");
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
                            baseOut.put("probe", p);
                            baseOut.put("ok", p.optBoolean("ok", false));
                        } else {
                            baseOut.put("ok", false);
                            baseOut.put("error", "探针超时（装置不确定，非框架结论）");
                            QuickJsEngine.EvalResult pg = QuickJsEngine.eval(
                                    "String(globalThis.__proteusHostHttpDnsProbeProgress || '')");
                            baseOut.put("probe_progress", pg.ok ? pg.value : ("ERR:" + pg.error));
                        }
                    } catch (Throwable t) {
                        try { baseOut.put("ok", false); baseOut.put("error", "结果解析失败：" + t); } catch (Throwable ignored) { }
                    }
                    reportSink(baseOut.toString());
                }
            };
            h.postDelayed(step[0], 5);
            return out.toString();
        } catch (Throwable t) {
            try { out.put("ok", false); out.put("error", "装置异常：" + t); } catch (Throwable ignored) { }
            reportSink(out.toString());
            return out.toString();
        }
    }

    private static String readAsset(android.app.Activity activity, String name) {
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
