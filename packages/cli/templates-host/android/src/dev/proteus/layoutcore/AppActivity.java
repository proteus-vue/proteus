// {{appName}} —— Proteus Android 宿主入口（CLI 生成 · 运行期形态）
//
// 【它是什么（用户 2026-10-08「dist 里要有完整宿主项目 + 完整开发流程」）】
//   **完整应用壳**：起 QuickJS → eval `assets/bundle-superapp.js`（项目内容内联其中）→
//   共享运行期装配路由栈/tab/交互 → 把当前屏真画到屏上。与 Web/MP/其它端**同一份 bundle 源**。
//   ★与本仓 `hosts/android/.../shell/SuperappActivity` 的关系：那个是**框架内核测试壳**（多带
//     `--es drive/screen/scroll/tap` 验证钩子）；本壳是**项目壳**（零测试钩子）——两者消费同一份
//     bundle 协议（`__proteusSuperappBootJson/State/Nav/Render/Back`），运行时原语同来自 AAR。
//
// 【两个变体（同一份工程，见 ProteusBuildConfig）】
//   · release（`proteus build --package`）：`DEV=false` ⇒ bundle 读**内嵌 assets**；Manifest 无 INTERNET。
//   · dev（`proteus dev`）：`DEV=true` ⇒ bundle 走 **HTTP dev server**（热刷）；Manifest 带 INTERNET。
//
// 【★同包】runtime AAR 的类在包 `dev.proteus.layoutcore`（与壳同包）⇒ 直接引用，无 import 前缀。
package dev.proteus.layoutcore;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public final class AppActivity extends Activity {

    private static final String TAG = "ProteusHost";

    private android.widget.FrameLayout root;
    private android.widget.FrameLayout contentHost;
    private android.widget.LinearLayout tabBar;
    private VaporRenderHost draw;
    private ScreenHost screenHost;
    private HostCapabilities caps;

    private float density = 1f;
    private int tabBarHeightPx = 0;
    private int physWidthPx = 0, physHeightPx = 0;

    /** Tab 栏数据（boot 后从 superapp 注册表读回——与 Web/MP 同一套 tabNames/tabLabels） */
    private String[] tabNames = new String[0];
    private final java.util.Map<String, String> tabLabels = new java.util.HashMap<>();
    // tab 栏视觉规格（共享 state.tabSpec；基准 = Web App.vue .sa-tabbar + token）
    private int tbOn = 0xFF5B5BD6, tbOff = 0xFF5F6673, tbRec = 0xFFD64545, tbLine = 0xFFDCDFE5, tbSurface = 0xFFFFFFFF;
    private float tbIcon = 19f, tbLabel = 10f;
    private int tbBadgeRadius = 8, tbBadgeFont = 11, tbBadgePadX = 4, tbBadgeOffX = 10, tbBadgeOffY = 2;
    private final java.util.Map<String, String> tbIcons = new java.util.HashMap<>();
    private final java.util.Map<String, String> tbLabels = new java.util.HashMap<>();

    /** dev 变体的热刷线程（DEV=false 时始终 null） */
    private Thread devWatch;

    /** dev 可视化层（DEV 角标 + 热重载提示；release 不创建） */
    private DevOverlay devOverlay;

    /** 当前屏名（供 dev-watch 的 DevTools 心跳上报；UI 线程写、watch 线程读 ⇒ volatile） */
    private volatile String lastScreenName = "";

    /** 设备环境 JSON（采集一次，心跳带上；决策 #674） */
    private volatile String devEnvJson = "{}";
    /** 性能读数 JSON（每次渲染更新：mount/applyOps 耗时 + relayout 计数；决策 #675） */
    private volatile String devPerfJson = "{}";
    /** 事件 trace 出箱（UI 线程抽取 → watch 线程上报；决策 #675） */
    private final java.util.List<String[]> traceOutbox = java.util.Collections.synchronizedList(new java.util.ArrayList<String[]>());
    /** 桥调用日志出箱（决策 #679：JS→原生 invoke → 面板 Network·项目通道） */
    private final java.util.List<String[]> bridgeOutbox = java.util.Collections.synchronizedList(new java.util.ArrayList<String[]>());
    /** 待上报的被点元素 id（命中测试线程写、watch 线程读；决策 #675） */
    private volatile int inspectOutbox = 0;

    /** ★DevTools Console（决策 #673）：待转发给 dev server 的设备日志（UI 线程写、watch 线程 flush）。
     *  含两类：a) 宿主 dev 事件（ready/reload/error，devLog 直接入队）b) JS console.*（UI 泵 eval 抽取入队）。 */
    private final java.util.List<String[]> hostLogQueue = java.util.Collections.synchronizedList(new java.util.ArrayList<String[]>());
    private android.os.Handler logPump;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ★★★dev 变体（2026-10-08 实测根因）：首次拉 bundle 在 **onCreate（主线程）** 执行 HTTP →
        //   Android 抛 `NetworkOnMainThreadException`（被 httpGetText 的 catch 吞掉 ⇒ 静默回落内嵌 assets）。
        //   ⇒ dev 变体放开 StrictMode 线程策略（仅 dev；release 不触及——`if (DEV)` 编译期常量，
        //     但本类在 release 也会加载，故用运行时判断而非编译期剔除）。
        if (ProteusBuildConfig.DEV) {
            android.os.StrictMode.setThreadPolicy(new android.os.StrictMode.ThreadPolicy.Builder()
                    .permitAll().build());
        }

        boolean barHidden = statusBarHidden();
        if (barHidden) {
            getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
        } else {
            getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
            try {
                getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
                getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
                getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(0xFFF4F5F7));
            } catch (Throwable ignored) { }
        }
        if (android.os.Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        android.view.WindowManager.LayoutParams attrs = getWindow().getAttributes();
        attrs.layoutInDisplayCutoutMode =
                android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        getWindow().setAttributes(attrs);

        android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
        density = dm.density;
        physWidthPx = dm.widthPixels;
        physHeightPx = dm.heightPixels;
        // I2-ALLOW: 宿主自绘 chrome（底部 Tab 栏）的像素高度，非内核几何（同 hosts 壳）。
        tabBarHeightPx = Math.round(56f * dm.density);

        root = new android.widget.FrameLayout(this);
        root.setBackgroundColor(0xFF101020);
        setContentView(root);

        if (!QuickJsEngine.isAvailable()) {
            fail("QuickJS 引擎未加载：" + QuickJsEngine.getLoadError());
            return;
        }
        boot();
    }

    // ────────────────────────── 启动 ──────────────────────────

    private void boot() {
        QuickJsEngine.resetEngine();   // 新实例 ⇒ 全新 JS 上下文（与 iOS 每实例新 JSContext 对齐）
        caps = new HostCapabilities(this);
        screenHost = new ScreenHost(root);

        contentHost = new android.widget.FrameLayout(this);
        android.widget.FrameLayout.LayoutParams clp = new android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT);
        clp.bottomMargin = 0;
        contentHost.setLayoutParams(clp);
        contentHost.setBackgroundColor(0xFFF4F5F7);
        contentHost.setVerticalScrollBarEnabled(false);
        contentHost.setHorizontalScrollBarEnabled(false);
        root.addView(contentHost);

        draw = new VaporRenderHost(this, contentHost);
        draw.setLengthScale(density);
        draw.enableContentScrollRange();
        // ★屏切换通路的 env 解析器（决策 #677）：`ScreenHost.mount` 须把 `env:…` 解析成数值再喂内核。
        screenHost.setEnvResolver(draw::resolveEnvInSpec);

        tabBar = new android.widget.LinearLayout(this);
        tabBar.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        tabBar.setBackgroundColor(0xFF1B1B2A);
        android.widget.FrameLayout.LayoutParams tlp = new android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT, tabBarHeightPx);
        tlp.gravity = android.view.Gravity.BOTTOM;
        tabBar.setLayoutParams(tlp);
        root.addView(tabBar);

        String bundle = loadBundleSource();
        if (bundle == null) { fail("无法获取 bundle（release: assets/bundle-superapp.js；dev: dev server）"); return; }
        if (ProteusBuildConfig.DEV) installDevConsole();   // ★装 console 垫片须在 eval bundle 之前 ⇒ 页面顶层 console.* 也被捕获
        QuickJsEngine.EvalResult load = QuickJsEngine.evalWithHost(bundle, buildRuntimeHost());
        if (!load.ok) { fail("bundle eval 失败：" + load.error); return; }
        QuickJsEngine.EvalResult bootRes = QuickJsEngine.eval("__proteusSuperappBootJson()");
        QuickJsEngine.nativeRunPendingJobs();
        if (!bootRes.ok || bootRes.value == null || bootRes.value.indexOf("\"ok\":true") < 0) {
            fail("superapp boot 失败：" + (bootRes.value != null ? bootRes.value : bootRes.error));
            return;
        }
        buildTabBar();
        // ★dev 可视化层（决策 #671）：叠加在内容/tab 之上——DEV 角标（release 不创建）。挂起后短暂提示"dev 模式"。
        devOverlay = new DevOverlay(this, root);
        devOverlay.attach();
        if (ProteusBuildConfig.DEV) { installDevConsole(); startLogPump(); devEnvJson = collectDeviceEnv(); }
        contentHost.post(new Runnable() {
            @Override public void run() {
                renderCurrent(readState());
                Log.i(TAG, "PROTEUS_APP_READY screen=" + currentName(readState()));
                if (ProteusBuildConfig.DEV) {
                    devOverlay.flash("DEV 模式 · 改源码保存即热刷");
                    devLog("info", "app ready · screen=index");
                    pushDevTree();
                    startDevWatch();
                }
            }
        });
    }

    /**
     * ★★★bundle 来源（dev/release 的**唯一分叉点**）——见文件头"两个变体"。
     *   dev：先从 dev server 拉（HTTP，**含重试**——设备启动与 server ready 有时序竞争）；失败回落内嵌 assets。
     *   release：直接读内嵌 assets。
     */
    private String loadBundleSource() {
        if (ProteusBuildConfig.DEV) {
            String base = devServerBase();
            if (base != null) {
                // ★重试（有限次 + 递增间隔；覆盖"App 先于 server ready 启动"的时序竞争）——
                //   首次实测：单次拉取在 server 尚未 listen 时失败 ⇒ 回落内嵌（虽可用但不走热刷）。
                for (int i = 0; i < 5; i++) {
                    String s = httpGetText(base + "/bundle");
                    if (s != null && !s.isEmpty()) {
                        Log.i(TAG, "PROTEUS_DEV_BUNDLE_FROM_SERVER bytes=" + s.length() + " base=" + base + " try=" + i);
                        return s;
                    }
                    try { Thread.sleep(300L * (i + 1)); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
                }
                Log.w(TAG, "PROTEUS_DEV_BUNDLE_FETCH_FAIL base=" + base + "——回落内嵌 assets");
            }
        }
        return readAsset("bundle-superapp.js");
    }

    /** dev server 基址：启动参数 `--es proteusDev <url>` 优先，其次编译期注入的 DEV_URL。 */
    private String devServerBase() {
        try {
            String fromIntent = getIntent() != null ? getIntent().getStringExtra("proteusDev") : null;
            if (fromIntent != null && !fromIntent.isEmpty()) return fromIntent;
        } catch (Throwable ignored) { }
        String fromCfg = ProteusBuildConfig.DEV_URL;
        return (fromCfg == null || fromCfg.isEmpty()) ? null : fromCfg;
    }

    /** 简单 HTTP GET（dev 通道用；仅 DEV 变体走到）。 */
    private static String httpGetText(String url) {
        java.net.HttpURLConnection c = null;
        try {
            java.net.URL u = new java.net.URL(url);
            c = (java.net.HttpURLConnection) u.openConnection();
            c.setConnectTimeout(3000);
            c.setReadTimeout(8000);
            c.setRequestMethod("GET");
            if (c.getResponseCode() / 100 != 2) return null;
            InputStream is = c.getInputStream();
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            is.close();
            return new String(bos.toByteArray(), "UTF-8");
        } catch (Throwable t) {
            return null;
        } finally {
            if (c != null) try { c.disconnect(); } catch (Throwable ignored) { }
        }
    }

    /** POST 纯文本（DevTools 元素树上报；决策 #674——无 JSON 依赖，body 就是 JSON 串）。失败静默。 */
    private static void httpPostText(String url, String body) {
        java.net.HttpURLConnection c = null;
        try {
            java.net.URL u = new java.net.URL(url);
            c = (java.net.HttpURLConnection) u.openConnection();
            c.setConnectTimeout(3000);
            c.setReadTimeout(8000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            byte[] bytes = body.getBytes("UTF-8");
            c.setFixedLengthStreamingMode(bytes.length);
            java.io.OutputStream os = c.getOutputStream();
            os.write(bytes);
            os.flush();
            os.close();
            c.getResponseCode();
        } catch (Throwable ignored) {
        } finally {
            if (c != null) try { c.disconnect(); } catch (Throwable ignored) { }
        }
    }

    /** 当前屏实例化节点树 → POST /tree（面板 Elements）。★须在 UI 线程调（eval 非线程安全）。
     *  ★决策 #675：**并入内核几何**（`draw.readRects()` 的 rects，按 id 合并）⇒ 面板 Elements 看到真实 box；
     *   并把当前屏名一并带上（面板校验"树 ↔ 屏"一致）。dev-server 侧记 lastTree + SSE `tree`。 */
    private void pushDevTree() {
        if (!ProteusBuildConfig.DEV) return;
        final String base = devServerBase();
        if (base == null) return;
        try {
            QuickJsEngine.EvalResult r = QuickJsEngine.eval("__proteusSuperappTree()");
            if (!r.ok || r.value == null || r.value.length() < 20) return;
            JSONObject body = new JSONObject(r.value);
            // 内核几何（真源）：屏幕空间 rects，按内核 id 合并进节点（宿主重映射后 id 与内核一致，见 ScreenHost.mount）
            try {
                JSONObject all = new JSONObject(draw.readRects());
                JSONObject rects = all.optJSONObject("rects");
                if (rects != null) {
                    JSONArray nodes = body.optJSONArray("nodes");
                    for (int i = 0; nodes != null && i < nodes.length(); i++) {
                        JSONObject n = nodes.optJSONObject(i);
                        if (n == null) continue;
                        JSONObject rc = rects.optJSONObject(String.valueOf(n.optInt("id")));
                        if (rc != null) n.put("rect", rc);
                    }
                }
            } catch (Throwable ignored) { /* 无几何 ⇒ 只有结构 */ }
            body.put("screen", lastScreenName);
            final String tree = body.toString();
            final String url = base + "/tree";
            new Thread(new Runnable() { @Override public void run() { httpPostText(url, tree); } }, "proteus-dev-tree").start();
        } catch (Throwable ignored) { }
    }

    /** ★事件 trace（决策 #675）：排空 JS 侧手势 trace（UI 线程 eval）→ GET /trace 逐条上报（watch 线程 / 后台线程）。
     *  ★须 UI 线程读（eval 非线程安全）⇒ 抽取入队，再由后台线程 POST（与设备日志同管线）。 */
    private void pumpDevEvents() {
        if (!ProteusBuildConfig.DEV) return;
        try {
            QuickJsEngine.EvalResult r = QuickJsEngine.eval("__proteusSuperappEvents()");
            if (!r.ok || r.value == null || r.value.length() <= 4) return;
            JSONArray arr = new JSONArray(r.value);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject e = arr.optJSONObject(i);
                if (e == null) continue;
                StringBuilder chain = new StringBuilder();
                JSONArray ch = e.optJSONArray("chain");
                for (int j = 0; ch != null && j < ch.length(); j++) { if (j > 0) chain.append(','); chain.append(ch.optInt(j)); }
                StringBuilder fired = new StringBuilder();
                JSONArray fr = e.optJSONArray("fired");
                for (int j = 0; fr != null && j < fr.length(); j++) { if (j > 0) fired.append(','); fired.append(fr.optInt(j)); }
                {
                    String tid = String.valueOf(e.optInt("id"));
                    // ★页面处理器 source map（决策 #712）：JS 侧 devEvents 已带 `src`（首个 handler 的模板源位置）——
                    //   一并上报（面板 Events 把"点了→跑了哪个 handler"锚回 `page.vue:line:col`）。
                    String src = e.optString("src", "");
                    traceOutbox.add(new String[]{ e.optString("type", ""), tid, chain.toString(), e.optBoolean("handled") ? "1" : "0", fired.toString(), src });
                    // ★被点元素 = 本次手势命中的内核节点 id ⇒ 一并选入内省（决策 #675，点屏幕任一元素 → 高亮该元素）
                    int kid = e.optInt("id");
                    if (kid > 0) inspectOutbox = kid;
                }
            }
        } catch (Throwable ignored) { }
    }

    /** ★被点元素（决策 #675）：宿主命中测试拿到目标内核 id 时入队（touch 线程）→ 后台线程 GET /inspect。 */
    private void queueInspect(int kernelId) {
        if (!ProteusBuildConfig.DEV || kernelId <= 0) return;
        inspectOutbox = kernelId;
    }

    /** 建运行期宿主（唯一入口）。★dev 变体接**桥调用日志**（决策 #679）⇒ 面板 Network·项目通道。 */
    private SuperappRuntimeHost buildRuntimeHost() {
        HostBridge bridge = new HostBridge(caps, screenHost);
        if (ProteusBuildConfig.DEV) {
            bridge.setInvokeLogger((method, ok, ms) ->
                bridgeOutbox.add(new String[]{ method == null ? "?" : method, ok ? "1" : "0", String.valueOf(ms) }));
        }
        return new SuperappRuntimeHost(draw, bridge);
    }

    /** 记一次渲染的性能读数（决策 #675/#676）：渲染耗时 + mount 次数 + 逐帧耗时 + 重排/patch 计数。
     *  ★数据源全为宿主/内核原子上抛（不自造第二份数学）。 */
    private void recordPerf(long renderStartMs) {
        if (!ProteusBuildConfig.DEV) return;
        try {
            JSONObject o = new JSONObject();
            o.put("renderMs", System.currentTimeMillis() - renderStartMs);
            o.put("mountCalls", draw.mountCalls);
            // ★逐帧耗时（ProteusHostView.onDraw 实测，决策 #676）
            if (draw.view() != null) {
                o.put("frameMs", Math.round(draw.view().lastFrameMs() * 100) / 100.0);
                o.put("frameAvgMs", Math.round(draw.view().frameMsAverage() * 100) / 100.0);
                o.put("draws", draw.view().onDrawTotal());
            }
            // ★重排 / patch 计数（内核回执累计，决策 #676）
            o.put("relayout", draw.relayoutTotal);
            o.put("patches", draw.patchAppliedTotal);
            o.put("t", System.currentTimeMillis());
            devPerfJson = o.toString();
        } catch (Throwable ignored) { }
    }

    /** 采集设备环境（决策 #674）——dev 面板展示，便于定位"只有某机型复现"的问题。JSON 串。 */
    private String collectDeviceEnv() {
        JSONObject o = new JSONObject();
        try {
            o.put("platform", "android");
            o.put("model", android.os.Build.MODEL);
            o.put("brand", android.os.Build.BRAND);
            o.put("manufacturer", android.os.Build.MANUFACTURER);
            o.put("androidRelease", android.os.Build.VERSION.RELEASE);
            o.put("sdkInt", android.os.Build.VERSION.SDK_INT);
            o.put("abi", android.os.Build.SUPPORTED_ABIS != null && android.os.Build.SUPPORTED_ABIS.length > 0 ? android.os.Build.SUPPORTED_ABIS[0] : "");
            android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
            o.put("density", dm.density);
            o.put("screen", Math.round(dm.widthPixels / dm.density) + "x" + Math.round(dm.heightPixels / dm.density));  // 逻辑 dp
            o.put("screenPx", dm.widthPixels + "x" + dm.heightPixels);
            o.put("locale", java.util.Locale.getDefault().toString());
            try { o.put("theme", (getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                == android.content.res.Configuration.UI_MODE_NIGHT_YES ? "dark" : "light"); } catch (Throwable ignored) { }
            try { o.put("appVersion", getPackageManager().getPackageInfo(getPackageName(), 0).versionName); } catch (Throwable ignored) { }
            // ★内核/引擎级（决策 #676）：显示内核版本与 JS 引擎标识——"设备环境"深入到内核一级。
            try { o.put("layoutCore", RustLayout.version()); } catch (Throwable ignored) { }
            try { o.put("jsEngine", QuickJsEngine.isAvailable() ? QuickJsEngine.nativeVersion() : "不可用"); } catch (Throwable ignored) { }
            try { o.put("hostBuild", ProteusBuildConfig.DEV ? "dev" : "release"); } catch (Throwable ignored) { }
        } catch (Throwable ignored) { }
        return o.toString();
    }

    /**
     * ★dev 热刷（B2）：轮询 dev server 的 `/version`；变化 ⇒ 重拉 bundle → 重置 JS 上下文 → 重 boot → 重绘。
     *   ★用**有界轮询 + 条件**（非盲等）：每轮 1s，且只在版本号变化时才重建（见 AI 效率规范）。
     */
    private void startDevWatch() {
        final String base = devServerBase();
        if (base == null) { Log.w(TAG, "PROTEUS_DEV_NO_SERVER——跳过热刷"); return; }
        devWatch = new Thread(new Runnable() {
            @Override public void run() {
                String last = httpGetText(base + "/version");
                while (!Thread.currentThread().isInterrupted()) {
                    try { Thread.sleep(1000); } catch (InterruptedException e) { return; }
                    String v = httpGetText(base + "/version");
                    // ★DevTools 心跳（决策 #672）：本线程在 CPU 后台线程 ⇒ 可安全读 volatile lastScreenName，
                    //   每秒把"设备在线 + 当前屏"上报给 dev server 的面板（失败静默，不干扰热刷）。
                    //   ★必须先 ping 再判 continue：否则"版本没变"这条主路径永不 ping ⇒ 面板一直"设备离线"。
                    try {
                        httpGetText(base + "/ping?screen=" + java.net.URLEncoder.encode(lastScreenName, "UTF-8")
                            + "&env=" + java.net.URLEncoder.encode(devEnvJson, "UTF-8")
                            + "&perf=" + java.net.URLEncoder.encode(devPerfJson, "UTF-8"));
                    } catch (Throwable ignored) { /* 心跳尽力而为 */ }
                    flushHostLog(base);   // ★把设备日志推到面板 Console（决策 #673）
                    flushTrace(base);     // ★把事件 trace 推到面板（决策 #675）
                    flushInspect(base);   // ★把被点元素推到面板（决策 #675）
                    flushBridge(base);    // ★把桥调用推到面板 Network·项目通道（决策 #679）
                    // ★面板→设备命令（决策 #701）：轮询 /cmd（one-shot），回 UI 线程执行 highlight/eval
                    final String cmdJson = httpGetText(base + "/cmd");
                    if (cmdJson != null && !cmdJson.isEmpty() && !"{}".equals(cmdJson) && !"null".equals(cmdJson)) {
                        runOnUiThread(new Runnable() { @Override public void run() { applyCommand(cmdJson); } });
                    }
                    if (v == null || v.equals(last)) continue;
                    last = v;
                    final String fresh = httpGetText(base + "/bundle");
                    if (fresh == null || fresh.isEmpty()) continue;
                    final String ver = v.trim();
                    runOnUiThread(new Runnable() {
                        @Override public void run() { hotReload(fresh, ver); }
                    });
                }
            }
        }, "proteus-dev-watch");
        devWatch.setDaemon(true);
        devWatch.start();
        Log.i(TAG, "PROTEUS_DEV_WATCH_START base=" + base);
    }

    /** 用新 bundle 重载应用（保留当前屏名）：重置引擎 → 重建桥 → 重 boot → 导航回原屏 → 重绘。 */
    private void hotReload(String bundle, String ver) {
        try {
            final String wantPage = currentName(readState());
            QuickJsEngine.resetEngine();
            caps = new HostCapabilities(this);
            screenHost = new ScreenHost(root);
            screenHost.setEnvResolver(draw::resolveEnvInSpec);   // ★重建 ScreenHost 后重注入（决策 #677）
            installDevConsole();   // reset 后重装（新上下文）——须在 eval bundle 之前
            QuickJsEngine.EvalResult load = QuickJsEngine.evalWithHost(bundle, buildRuntimeHost());
            if (!load.ok) { Log.w(TAG, "PROTEUS_DEV_RELOAD_EVAL_FAIL " + load.error); return; }
            QuickJsEngine.EvalResult bootRes = QuickJsEngine.eval("__proteusSuperappBootJson()");
            QuickJsEngine.nativeRunPendingJobs();
            if (!bootRes.ok) { Log.w(TAG, "PROTEUS_DEV_RELOAD_BOOT_FAIL " + bootRes.error); return; }
            buildTabBar();
            if (wantPage != null && !wantPage.isEmpty() && !wantPage.equals(currentName(readState()))) {
                QuickJsEngine.eval("__proteusSuperappNav(" + org.json.JSONObject.quote(wantPage) + ")");
                QuickJsEngine.nativeRunPendingJobs();
            }
            renderCurrent(readState());
            Log.i(TAG, "PROTEUS_DEV_RELOADED screen=" + currentName(readState()));
            if (ProteusBuildConfig.DEV) { installDevConsole(); pushDevTree(); devLog("info", "hot reload · v" + (ver != null ? ver : "?")); }
            // ★热重载瞬时提示（决策 #671）：界面本身无"已刷新"信号（尤其只改样式时），显式给一条。
            if (devOverlay != null) {
                String t = android.text.format.DateFormat.format("HH:mm:ss", System.currentTimeMillis()).toString();
                devOverlay.flash("⟳ 已热重载 · v" + (ver != null ? ver : "?") + " · " + t);
            }
        } catch (Throwable t) {
            Log.w(TAG, "PROTEUS_DEV_RELOAD_FAIL " + t.getMessage());
            if (ProteusBuildConfig.DEV) devLog("error", "reload fail: " + t.getMessage());
        }
    }

    // ────────────────────────── DevTools Console（决策 #673） ──────────────────────────

    /** 把 JS 的 console.* 捕获到 `__proteusConsole`（仅 dev 装，release 不装 ⇒ 引擎/包零开销）。 */
    private void installDevConsole() {
        // ★Error 友好（决策 #673 实测：页面 console.error('…', err) 时 JSON.stringify(err)='{}' 丢信息）
        //   ⇒ 先取 stack（或 String(err)），再用 JSON；对象 JSON 化失败则 String。
        QuickJsEngine.eval("(function(){if(globalThis.__proteusConsole)return;var q=globalThis.__proteusConsole=[],"
            + "fmt=function(x){if(typeof x==='string')return x;"
            + "if(x&&typeof x==='object'){if(typeof x.stack==='string'||typeof x.message==='string'){return (x.name||'Error')+(x.message?': '+x.message:'')+(x.stack?'\\n'+x.stack:'')}"
            + "try{var s=JSON.stringify(x);return s===undefined?String(x):s}catch(e){return String(x)}}"
            + "return String(x)};"
            + "mk=function(l){return function(){var a=[].slice.call(arguments).map(fmt).join(' ');q.push(l+'\\u0001'+a);if(q.length>500)q.shift()}};"
            + "var c=globalThis.console||(globalThis.console={});['log','info','warn','error'].forEach(function(l){c[l]=mk(l)});})()");
    }

    /** 宿主 dev 事件入队（UI 线程）——**原生通道**（决策 #679 分流）。 */
    private void devLog(String level, String text) { if (text != null) hostLogQueue.add(new String[]{"native", level, text}); }

    /** ★面板→设备命令执行（决策 #701，UI 线程）：`highlight`（元素高亮）/ `eval`（REPL）。结果经 devLog 回 Console。 */
    private void applyCommand(String json) {
        try {
            org.json.JSONObject o = new org.json.JSONObject(json);
            String type = o.optString("type", "");
            if ("highlight".equals(type)) {
                int id = o.optInt("id", 0);
                if (draw != null) draw.highlightNode(id);
                devLog("info", "highlight #" + id);
            } else if ("eval".equals(type)) {
                String expr = o.optString("expr", "");
                if (!expr.isEmpty()) {
                    QuickJsEngine.EvalResult r = QuickJsEngine.eval(expr);
                    devLog("log", "› " + expr + "\n" + (r != null && r.ok ? String.valueOf(r.value) : ("✗ " + (r != null ? r.error : "无引擎"))));
                }
            }
        } catch (Throwable ignored) { /* 命令尽力而为——不干扰渲染 */ }
    }

    /** 每 400ms 在 UI 线程抽一次 JS console 队列（eval 仅 UI 线程安全），追加到待 flush 队列。 */
    private void startLogPump() {
        if (logPump != null) return;
        logPump = new android.os.Handler(android.os.Looper.getMainLooper());
        logPump.post(new Runnable() {
            @Override public void run() {
                try {
                    QuickJsEngine.EvalResult r = QuickJsEngine.eval(
                        "(function(){var q=globalThis.__proteusConsole;if(!q||!q.length)return '';return q.splice(0,q.length).join('\\u0002')})()");
                    if (r.ok && r.value != null && !r.value.isEmpty()) {
                        for (String line : r.value.split("\u0002")) {
                            int u = line.indexOf('\u0001');
                            // ★channel=project（决策 #679）：这些是**项目 JS 的 console.***（区别于宿主 dev 事件）
                            if (u > 0) hostLogQueue.add(new String[]{"project", line.substring(0, u), line.substring(u + 1)});
                        }
                    }
                } catch (Throwable ignored) { /* 引擎未就绪 ⇒ 下轮再试 */ }
                pumpDevEvents();   // ★同频排空手势 trace（决策 #675）
                syncDevScreen();   // ★同步"运行时当前屏"（决策 #677：导航走 runtime.mountScreen，不经 renderCurrent）
                logPump.postDelayed(this, 400);
            }
        });
    }

    /** ★同步 DevTools 的"当前屏"（决策 #677）：导航（$nav → runtime.mountScreen）**不经 renderCurrent**，
     *   故 `lastScreenName` 会停在旧屏 ⇒ 面板树/当前屏不更新。此处从**运行期真源**读当前屏，变了就刷树+心跳。
     *   ★UI 线程（logPump）调用 ⇒ eval 安全。 */
    private void syncDevScreen() {
        if (!ProteusBuildConfig.DEV) return;
        try {
            QuickJsEngine.EvalResult r = QuickJsEngine.eval("(typeof __proteusSuperappRuntimeCurrent==='function')?__proteusSuperappRuntimeCurrent():''");
            String cur = (r.ok && r.value != null) ? r.value : "";
            if (!cur.isEmpty() && !cur.equals(lastScreenName)) {
                lastScreenName = cur;
                pushDevTree();              // 切屏 ⇒ 面板 Elements 树同步（含新屏 rect）
            }
        } catch (Throwable ignored) { }
    }

    /** watch 线程：把设备日志逐条 GET /log?channel=&level=&text=（失败丢弃不重试——dev 诊断，非关键路径）。 */
    private void flushHostLog(String base) {
        while (!hostLogQueue.isEmpty()) {
            String[] e = hostLogQueue.remove(0);   // e = [channel, level, text]
            String text = e[2];
            if (text.length() > 600) text = text.substring(0, 600) + "…";
            try {
                httpGetText(base + "/log?channel=" + e[0]
                    + "&level=" + java.net.URLEncoder.encode(e[1], "UTF-8")
                    + "&text=" + java.net.URLEncoder.encode(text, "UTF-8"));
            } catch (Throwable t) { break; }
        }
    }

    /** watch 线程：把事件 trace 逐条 GET /trace?type=&id=&chain=&handled=&fired=[&src=]（决策 #675/#712）。 */
    private void flushTrace(String base) {
        while (!traceOutbox.isEmpty()) {
            String[] e = traceOutbox.remove(0);
            try {
                String src = e.length > 5 ? e[5] : "";
                httpGetText(base + "/trace?type=" + java.net.URLEncoder.encode(e[0], "UTF-8")
                    + "&id=" + e[1] + "&chain=" + java.net.URLEncoder.encode(e[2], "UTF-8")
                    + "&handled=" + e[3] + "&fired=" + java.net.URLEncoder.encode(e[4], "UTF-8")
                    + (src.isEmpty() ? "" : "&src=" + java.net.URLEncoder.encode(src, "UTF-8")));
            } catch (Throwable t) { break; }
        }
    }

    /** watch 线程：把桥调用逐条 GET /bridge?method=&ok=&ms=（决策 #679；面板 Network·项目通道）。 */
    private void flushBridge(String base) {
        while (!bridgeOutbox.isEmpty()) {
            String[] e = bridgeOutbox.remove(0);
            try {
                httpGetText(base + "/bridge?method=" + java.net.URLEncoder.encode(e[0], "UTF-8")
                    + "&ok=" + e[1] + "&ms=" + e[2]);
            } catch (Throwable t) { break; }
        }
    }

    /** watch 线程：把"被点元素 id"报给面板（决策 #675）。 */
    private void flushInspect(String base) {
        int id = inspectOutbox;
        if (id <= 0) return;
        inspectOutbox = 0;
        try { httpGetText(base + "/inspect?id=" + id); } catch (Throwable ignored) { }
    }

    // ────────────────────────── Tab 栏 ──────────────────────────

    private void buildTabBar() {
        String st = readState();
        try {
            JSONObject o = new JSONObject(st);
            JSONArray tabs = o.optJSONArray("tabs");
            if (tabs != null) {
                tabNames = new String[tabs.length()];
                for (int i = 0; i < tabs.length(); i++) tabNames[i] = tabs.getString(i);
            }
            JSONObject labels = o.optJSONObject("tabLabels");
            if (labels != null) {
                java.util.Iterator<String> it = labels.keys();
                while (it.hasNext()) { String k = it.next(); tabLabels.put(k, labels.optString(k, k)); }
            }
            JSONObject sp = o.optJSONObject("tabSpec");
            if (sp != null) {
                tbSurface = parseHex(sp.optString("surface", "#ffffff"));
                tbLine = parseHex(sp.optString("line", "#dcdfe5"));
                tbOn = parseHex(sp.optString("brand", "#5b5bd6"));
                tbOff = parseHex(sp.optString("text3", "#5f6673"));
                tbRec = parseHex(sp.optString("badgeBg", "#d64545"));
                tbIcon = (float) sp.optDouble("iconSize", 19);
                tbLabel = (float) sp.optDouble("labelSize", 10);
                JSONObject bd = sp.optJSONObject("badge");
                if (bd != null) {
                    tbBadgeRadius = bd.optInt("radius", 8);
                    tbBadgeFont = bd.optInt("fontSize", 11);
                    tbBadgePadX = bd.optInt("padX", 4);
                    tbBadgeOffY = bd.optInt("offsetY", 2);
                    tbBadgeOffX = bd.optInt("offsetX", 4) + 6;
                }
                JSONObject ic = sp.optJSONObject("icons");
                if (ic != null) { java.util.Iterator<String> it = ic.keys(); while (it.hasNext()) { String k = it.next(); tbIcons.put(k, ic.optString(k, "")); } }
                JSONObject lb = sp.optJSONObject("labels");
                if (lb != null) { java.util.Iterator<String> it = lb.keys(); while (it.hasNext()) { String k = it.next(); tbLabels.put(k, lb.optString(k, "")); } }
            }
        } catch (Exception e) {
            Log.w(TAG, "读 tab 注册表失败：" + e.getMessage());
        }
        tabBar.removeAllViews();
        if (tabNames.length == 0) { tabBar.setVisibility(android.view.View.GONE); return; }
        tabBar.setVisibility(android.view.View.VISIBLE);
        final int onColor = tbOn, offColor = tbOff, recColor = tbRec, lineColor = tbLine;
        tabBar.setBackgroundColor(tbSurface);
        if (root.findViewWithTag("sa-top-line") == null) {
            android.view.View top = new android.view.View(this);
            // I2-ALLOW: 宿主原生 chrome 尺寸（顶分隔线 1dp→px），非内核几何。
            int h1 = Math.max(1, Math.round(density));
            android.widget.FrameLayout.LayoutParams tlp2 = new android.widget.FrameLayout.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT, h1);
            tlp2.gravity = android.view.Gravity.BOTTOM;
            tlp2.bottomMargin = tabBarHeightPx;
            top.setLayoutParams(tlp2);
            top.setBackgroundColor(lineColor);
            top.setTag("sa-top-line");
            root.addView(top);
        }
        String current = currentName(readState());
        for (final String name : tabNames) {
            final boolean on = name.equals(current);
            android.widget.LinearLayout col = new android.widget.LinearLayout(this);
            col.setOrientation(android.widget.LinearLayout.VERTICAL);
            col.setGravity(android.view.Gravity.CENTER);
            col.setTag(name);
            col.setClickable(true);
            android.widget.FrameLayout icWrap = new android.widget.FrameLayout(this);
            // I2-ALLOW: 宿主原生 chrome 尺寸（图标行 44×22dp→px），非内核几何。
            int iw = Math.round(44 * density), ih = Math.round(22 * density);
            icWrap.setLayoutParams(new android.widget.LinearLayout.LayoutParams(iw, ih));
            android.widget.TextView ic = new android.widget.TextView(this);
            ic.setText(tabIcon(name) + "\uFE0E");   // 变体选择符：强制文本呈现（与 Web 线稿一致）
            ic.setTextSize(tbIcon);
            ic.setGravity(android.view.Gravity.CENTER);
            ic.setTextColor(on ? onColor : offColor);
            icWrap.addView(ic, new android.widget.FrameLayout.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT));
            col.addView(icWrap);
            android.widget.TextView lab = new android.widget.TextView(this);
            lab.setText(tabShortLabel(name));
            lab.setTextSize(tbLabel);
            lab.setGravity(android.view.Gravity.CENTER);
            lab.setTextColor(on ? onColor : offColor);
            col.addView(lab);
            col.setLayoutParams(new android.widget.LinearLayout.LayoutParams(
                    0, android.view.ViewGroup.LayoutParams.MATCH_PARENT, 1f));
            col.setOnClickListener(new android.view.View.OnClickListener() {
                @Override public void onClick(android.view.View v) { switchTab(name); }
            });
            tabBar.addView(col);
        }
    }

    private String tabIcon(String name) {
        String v = tbIcons.get(name);
        return (v != null && !v.isEmpty()) ? v : "•";
    }

    private String tabShortLabel(String name) {
        String v = tbLabels.get(name);
        if (v != null && !v.isEmpty()) return v;
        String t = tabLabels.get(name);
        return (t != null && !t.isEmpty()) ? t : name;
    }

    private static int parseHex(String css) {
        try {
            String h = css.startsWith("#") ? css.substring(1) : css;
            if (h.length() == 3) h = "" + h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2) + "ff";
            if (h.length() == 6) h = h + "ff";
            long v = Long.parseLong(h, 16);
            long a = v & 0xFF, rgb = v >>> 8;
            return (int) ((a << 24) | rgb);
        } catch (Exception e) { return 0xFF000000; }
    }

    /** 切 tab（与 Web 的 switchTab / MP 同形）→ 重绘当前屏 → 刷新高亮 */
    private void switchTab(String name) {
        try {
            QuickJsEngine.eval("__proteusSuperappNav(" + JSONObject.quote(name) + ")");
            QuickJsEngine.nativeRunPendingJobs();
        } catch (Throwable t) {
            Log.w(TAG, "switchTab 失败：" + t.getMessage());
        }
        String st = readState();
        renderCurrent(st);
        highlightTab(currentName(st));
    }

    private void highlightTab(String current) {
        final int onColor = tbOn, offColor = tbOff;
        for (int i = 0; i < tabBar.getChildCount(); i++) {
            android.view.View col = tabBar.getChildAt(i);
            boolean on = current.equals(col.getTag());
            int c = on ? onColor : offColor;
            if (col instanceof android.view.ViewGroup) {
                android.view.ViewGroup g = (android.view.ViewGroup) col;
                for (int j = 0; j < g.getChildCount(); j++) {
                    android.view.View ch = g.getChildAt(j);
                    if (ch instanceof android.widget.TextView) ((android.widget.TextView) ch).setTextColor(c);
                    else if (ch instanceof android.view.ViewGroup) {
                        android.view.ViewGroup gg = (android.view.ViewGroup) ch;
                        for (int k = 0; k < gg.getChildCount(); k++) {
                            android.view.View gch = gg.getChildAt(k);
                            if ("sa-badge".equals(gch.getTag())) continue;   // 角标恒语义色，不随选中态变
                            if (gch instanceof android.widget.TextView) ((android.widget.TextView) gch).setTextColor(c);
                        }
                    }
                }
            }
        }
    }

    // ────────────────────────── 返回 ──────────────────────────

    /** 栈深 > 1 ⇒ 走共享 router 返回；入口 tab ⇒ 交系统（退出应用）——与 iOS 右滑 / Web 返回同语义。 */
    @Override
    public void onBackPressed() {
        try {
            int depth = new JSONObject(readState()).optInt("depth", 1);
            if (depth > 1) {
                QuickJsEngine.eval("__proteusSuperappBack()");
                QuickJsEngine.nativeRunPendingJobs();
                renderCurrent(readState());
                highlightTab(currentName(readState()));
                return;
            }
        } catch (Throwable t) {
            Log.w(TAG, "onBackPressed 返回失败：" + t.getMessage());
        }
        super.onBackPressed();
    }

    // ────────────────────────── 渲染 ──────────────────────────

    private String readState() {
        try {
            QuickJsEngine.EvalResult r = QuickJsEngine.eval("__proteusSuperappState()");
            return (r.ok && r.value != null) ? r.value : "{}";
        } catch (Throwable t) { return "{}"; }
    }

    private String currentName(String stateJson) {
        try { return new JSONObject(stateJson).optString("current", ""); }
        catch (Exception e) { return ""; }
    }

    /** 采集内置环境变量（决策 #593）：平台 insets → dp（只用官方 API，缺则降级 0）。 */
    private JSONObject collectEnvVars() {
        JSONObject o = new JSONObject();
        try {
            if (android.os.Build.VERSION.SDK_INT < 20) return o;
            android.view.WindowInsets wi = getWindow().getDecorView().getRootWindowInsets();
            if (wi == null) return o;
            int sb = wi.getInsets(android.view.WindowInsets.Type.statusBars()).top;
            int nav = wi.getInsets(android.view.WindowInsets.Type.navigationBars()).bottom;
            int tap = wi.getInsets(android.view.WindowInsets.Type.tappableElement()).bottom;
            int cutT = 0, cutL = 0, cutR = 0;
            if (android.os.Build.VERSION.SDK_INT >= 28) {
                android.view.DisplayCutout dc = wi.getDisplayCutout();
                if (dc != null) { cutT = dc.getSafeInsetTop(); cutL = dc.getSafeInsetLeft(); cutR = dc.getSafeInsetRight(); }
            }
            double d = density;
            o.put("--pf-inset-top", Math.max(sb, cutT) / d);
            o.put("--pf-inset-bottom", nav / d);
            o.put("--pf-inset-left", cutL / d);
            o.put("--pf-inset-right", cutR / d);
            boolean gesture = tap < nav * 0.6;
            o.put("--pf-status-bar-height", sb / d);
            o.put("--pf-nav-bar-height", (gesture ? 0 : nav) / d);
            o.put("--pf-indicator-height", (gesture ? nav : 0) / d);
            o.put("--pf-nav-bar-total", nav / d);
            o.put("--pf-cutout-top", cutT / d);
            o.put("--pf-cutout-left", cutL / d);
            o.put("--pf-cutout-right", cutR / d);
            o.put("--pf-keyboard-height", 0.0);
            o.put("--pf-hairline", 1.0 / d);
        } catch (Throwable t) { Log.w(TAG, "collectEnvVars 失败：" + t.getMessage()); }
        return o;
    }

    private void renderCurrent(String stateJson) {
        final String page = currentName(stateJson);
        // ★DevTools 心跳用：每次渲染更新"当前屏"（UI 线程写；dev-watch 线程读）
        if (page != null && !page.isEmpty()) lastScreenName = page;
        long t0 = System.currentTimeMillis();
        try {
            int vwPx = contentHost.getWidth() > 0 ? contentHost.getWidth() : physWidthPx;
            int vhPx = contentHost.getHeight() > 0 ? contentHost.getHeight() : physHeightPx;
            JSONObject envObj = collectEnvVars();
            envObj.put("--pf-vw", vwPx / density);
            envObj.put("--pf-vh", vhPx / density);
            draw.setEnvVars(envObj);
            JSONObject args = new JSONObject();
            args.put("name", page);
            args.put("viewport", new JSONObject().put("width", vwPx / density).put("height", vhPx / density));
            QuickJsEngine.EvalResult rr = QuickJsEngine.eval("__proteusSuperappRender(" + JSONObject.quote(args.toString()) + ")");
            if (draw.view() != null) draw.view().invalidate();
            Log.i(TAG, "PROTEUS_RENDER page=" + page + " viewport=" + (vwPx / density) + "x" + (vhPx / density));
            // ★切屏自动刷树（决策 #675 · 修 bug1：此前只有 boot/hotReload 推树 ⇒ 切屏后面板树不更新）
            //   + 性能读数（renderMs/mount/relayout）。★renderCurrent 只在 UI 线程调 ⇒ eval 安全。
            if (ProteusBuildConfig.DEV) { pushDevTree(); recordPerf(t0); }
        } catch (Throwable t) {
            Log.w(TAG, "renderCurrent 失败：" + t.getMessage());
        }
    }

    // ────────────────────────── 杂项 ──────────────────────────

    /** 状态栏是否隐藏（读 app-config.json 的 safeArea.statusBar；缺省 show）。 */
    private boolean statusBarHidden() {
        try {
            String sc = readAsset("app-config.json");
            if (sc == null) return false;
            JSONObject o = new JSONObject(sc);
            JSONObject sa = o.optJSONObject("safeArea");
            return "hide".equals(sa != null ? sa.optString("statusBar", "show") : "show");
        } catch (Throwable t) { return false; }
    }

    private String readAsset(String name) {
        try (InputStream is = getAssets().open(name)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), "UTF-8");
        } catch (Exception e) { return null; }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && android.os.Build.VERSION.SDK_INT >= 30) {
            android.view.WindowInsetsController wic = getWindow().getInsetsController();
            if (wic != null) {
                if (statusBarHidden()) wic.hide(android.view.WindowInsets.Type.statusBars());
                else {
                    wic.show(android.view.WindowInsets.Type.statusBars());
                    wic.setSystemBarsAppearance(android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                            android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
                }
            }
            android.view.WindowInsets wi = getWindow().getDecorView().getRootWindowInsets();
            if (wi != null && tabBar != null) {
                int nav = wi.getInsets(android.view.WindowInsets.Type.navigationBars()).bottom;
                tabBar.setPadding(0, 0, 0, nav);
            }
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (devWatch != null) devWatch.interrupt();
        if (screenHost != null) screenHost.dispose();
        if (caps != null) caps.dispose();
    }

    private void fail(String reason) {
        Log.e(TAG, "PROTEUS_APP_ERROR " + reason);
    }
}
