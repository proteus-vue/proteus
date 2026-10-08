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
        QuickJsEngine.EvalResult load = QuickJsEngine.evalWithHost(bundle, new SuperappRuntimeHost(draw, new HostBridge(caps, screenHost)));
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
        contentHost.post(new Runnable() {
            @Override public void run() {
                renderCurrent(readState());
                Log.i(TAG, "PROTEUS_APP_READY screen=" + currentName(readState()));
                if (ProteusBuildConfig.DEV) {
                    devOverlay.flash("DEV 模式 · 改源码保存即热刷");
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
            QuickJsEngine.EvalResult load = QuickJsEngine.evalWithHost(bundle, new SuperappRuntimeHost(draw, new HostBridge(caps, screenHost)));
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
            // ★热重载瞬时提示（决策 #671）：界面本身无"已刷新"信号（尤其只改样式时），显式给一条。
            if (devOverlay != null) {
                String t = android.text.format.DateFormat.format("HH:mm:ss", System.currentTimeMillis()).toString();
                devOverlay.flash("⟳ 已热重载 · v" + (ver != null ? ver : "?") + " · " + t);
            }
        } catch (Throwable t) {
            Log.w(TAG, "PROTEUS_DEV_RELOAD_FAIL " + t.getMessage());
        }
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
