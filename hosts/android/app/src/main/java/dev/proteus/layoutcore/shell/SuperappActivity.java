package dev.proteus.layoutcore;
// hosts/android/app/src/main/java/dev/proteus/layoutcore/SuperappActivity.java
// ★★★批次 44（2026-10-05）：**superapp 真实应用 · 桌面启动入口**（Android 腿）。
//
// 【为什么独立 Activity（而不是改 MainActivity）】
//   用户目标：「手机主屏图标点开 App 就能测完整体验」——此前的 launcher（MainActivity）
//   点开是**验收装置**（"运行 4050 测试"按钮页），不是 superapp。
//   ★而 MainActivity 承载着全部既有验收脚本（`am start -n .MainActivity --es path …`）——
//     直接改它会牵动 20+ 个脚本。⇒ 新起一个 Activity 作**桌面图标入口**，MainActivity 原样保留
//     （脚本走显式组件启动，不受 launcher 归属影响）。
//
// 【它做什么（真实应用启动路径，与 Web/MP 同形）】
//   ① QuickJS 注入宿主桥（能力 + ScreenHost 真内核树）→ eval `bundle-superapp.js`
//   ② `__proteusSuperappBootJson()` = `createAppNavigation`（路由栈 + 宿主屏端口 + 真实页面内容）
//      → `createRouter(routes, { adapter })` → 进入入口 tab（与 Web/MP **同一棵路由树**）
//   ③ **把当前屏真画到屏上**：VaporRenderHost 消费编译产物 `app-screen-content.json`
//      （项目路由 → 真实 SFC → 编译器；与 Web/MP/iOS 同源）→ 真内核树 → 自绘
//   ④ 底部 **Tab 栏**（★B · 决策 #800：chrome 唯一实现在 runtime 的 ProteusTabChrome）→ 真触摸切 tab → 重绘
//
// 【★与"视觉合成"（MainActivity.appStackRun 里那段）的区别】
//   那段是**一次性**画 index 页 + 探针读数（装置级）；本 Activity 是**应用级**：
//   常驻、可交互（真触摸切 tab）、随导航重绘。
//
// 【★诚实边界（与 PROJECT_MEMORY 一致）】
//   · 页面内容 = 编译产物里的**静态结构**（结构+样式+文本）——全实时 slot/Vapor 运行时（响应式/
//     事件/v-model 回写）是下一阶段；本 Activity 证明"真实应用壳 + 导航 + 真机渲染 + 真触摸切 tab"。
//   · 仅入口页/四 tab 页；overlay/global 层的自绘 chrome（toast/loading/音乐条）未做（属"App 壳"下一批）。
public class SuperappActivity extends android.app.Activity {

    private static final String TAG = "proteus";

    private android.widget.FrameLayout root;
    private android.widget.FrameLayout contentHost;
    /** ★★★B（决策 #800）：tab 栏 chrome——**唯一实现在 runtime**（ProteusTabChrome）；本壳只装配 + 出口。 */
    private ProteusTabChrome chrome;
    private VaporRenderHost draw;
    private ScreenHost screenHost;
    private HostCapabilities caps;
    /** ★★决策 #1083：录屏/截屏状态（C71）——用户截屏回调要注册在 Activity 上 */
    private CaptureCapability capture;

    /** 平台逻辑尺寸（viewport）——与 StressSfcActivity 同口径（物理/density） */
    private float logicalW = 390f, logicalH = 844f;
    private float density = 1f;
    /** 物理像素原值（`dm.widthPixels` / `heightPixels`）——视口 fallback 用（无损，不做 dp↔px 往返） */
    private int physWidthPx = 0, physHeightPx = 0;

    /** tab 名（drive/报告用——内容/样式/角标全在 runtime chrome，从 state.tabItems 解析） */
    private String[] tabNames = new String[0];

    /** drive 模式证据：每次 tab 切换后的当前屏 */
    private final org.json.JSONArray switchLog = new org.json.JSONArray();

    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // ★★★状态栏/edge-to-edge 策略（2026-10-08 · 决策 #594）：app-config `safeArea.statusBar`（缺省 **show**）。
        //   与 Web 手机端 viewport-fit=cover + edge-to-edge 对齐：内容铺满全屏（含状态栏区），状态栏**透明**
        //   （页面背景透上来），页面自身用 --pf-inset-top/bottom 让位。`hide` = 沉浸式（旧行为：FLAG_FULLSCREEN）。
        //   ★此前无条件 FLAG_FULLSCREEN ⇒ 状态栏恒隐藏；现改为按配置（且透明使状态栏区显示页面背景）。
        boolean barHidden0 = statusBarHidden();
        if (barHidden0) {
            getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
        } else {
            getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
            // 状态栏/导航栏透明：内容（页面背景）透上来，与 Web edge-to-edge 同观感（pre-35 需显式设色）
            try {
                getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
                getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
                // window background = page light bg (round-corner screen shows window bg)
                getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(0xFFF4F5F7));
            } catch (Throwable ignored) { }
        }
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        }
        // ★★★C14 键盘（决策 #1069）：IME insets 监听 → 推 JS 的 `__proteusHostKeyboard`。
        //   【为什么必须真监听】此前三端都只装了 JS 侧接收通道（`capability-app-device.ts`），
        //   **没有一端真的推**——`useKeyboard()` 的高度恒为 0（文档却按"桥方法存在"判了 ✅）。
        //   本监听把系统 IME 高度（dp）推给 JS，并同步环境变量 `--pf-keyboard-height`（让 CSS 可让位）。
        //   ★edge-to-edge（decorFitsSystemWindows=false）下 IME 不会自动缩窗 ⇒ 用 insets 的 ime() 读数；
        //     API < 30 拿不到 ime() ⇒ **不注册**（诚实：该机型键盘高度不可知，而不是推假 0）。
        installKeyboardInsets();

        android.view.WindowManager.LayoutParams attrs0 = getWindow().getAttributes();
        attrs0.layoutInDisplayCutoutMode =
                android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        getWindow().setAttributes(attrs0);

        android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
        density = dm.density;
        logicalW = dm.widthPixels / dm.density;
        logicalH = dm.heightPixels / dm.density;
        physWidthPx = dm.widthPixels;
        physHeightPx = dm.heightPixels;

        root = new android.widget.FrameLayout(this);
        root.setBackgroundColor(0xFF101020);   // superapp 深色底（与 Web .sa-theme-bg 深色同族）
        setContentView(root);

        if (!QuickJsEngine.isAvailable()) {
            fail("QuickJS 引擎未加载：" + QuickJsEngine.getLoadError());
            return;
        }
        boot();
    }

    // ────────────────────────── 启动 ──────────────────────────

    /** ★#1098：保留运行期宿主引用——P0 归因读它的 mount/applyOps 宿主侧耗时。 */
    private SuperappRuntimeHost rtHost;

    private void boot() {
        // ★★★每次新 Activity 启动前**重置引擎上下文**（用户 2026-10-08「安卓有时点开直接空白，杀后台重开正常」）：
        //   本桥 JS 上下文是**进程级 static**，旧 Activity 的脏全局态（路由/当前屏）会污染新实例的 boot ⇒ 空白。
        //   重置后 boot 在**全新上下文**里 eval bundle —— 与 iOS 的"每实例新 JSContext"对齐。
        QuickJsEngine.resetEngine();
        JsTaskSampler.setEnabled(true);   // ★#1098：P0 长任务观测（真机基线从这条真实应用路径取）
        // ① 建宿主桥（能力 + 屏树）——屏树供 superapp 路由语义（screen.mount/stats/rect…）
        caps = new HostCapabilities(this);
        screenHost = new ScreenHost(root);

        // ② 内容绘制宿主（真内核树 → 自绘）——屏内容上屏用
        contentHost = new android.widget.FrameLayout(this);
        android.widget.FrameLayout.LayoutParams clp = new android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT);
        // 给底部 Tab 栏留位（内容不被 chrome 压住）
        // ★★★内容区 = **全屏**（不缩 tab 栏）——与 Web 一致：Web 的 Tab 栏是 overlay（浮在页面之上、
        //   fixed 不占流），页面的让位靠**页面自身下内边距**（`.proteus-mount-layer--page` padding-bottom:120）；
        //   此前内容区缩到"屏高−tab 栏" ⇒ 视口高度少 56dp ⇒ 依赖 bottom 定位的元素（客服球）整体偏高
        //   （独立验收：fab 球底距 tab 栏为 Web 的 1.6 倍）。现在视口 = 全屏，fab 与 Web 逐像素同。
        clp.bottomMargin = 0;
        contentHost.setLayoutParams(clp);
        // ★★★页面底色 = 灰底（与 Web 一致）：root 是深色 #101020（启动瞬间/异常时的底），
        //   而页面内容是**浅色主题**——若不给 contentHost 上浅色底，切 tab 重绘的间隙/未覆盖区
        //   会露出 root 的深色（独立验收实测：tab 栏上方出现一整条 #10101f 深色块）。
        contentHost.setBackgroundColor(0xFFF4F5F7);
        // ★禁用滚动条（独立验收抓出左缘灰色圆角竖条 = 本视图的 scrollbar；Web 无此物）
        contentHost.setVerticalScrollBarEnabled(false);
        contentHost.setHorizontalScrollBarEnabled(false);
        root.addView(contentHost);

        draw = new VaporRenderHost(this, contentHost);
        draw.setPaintSampling(false);   // ★#1098 P0：切屏热路径上关掉诊断像素采样（实测占 mount 62%，应用路径无人读）
        draw.setLengthScale(density);          // 逻辑单位 → 物理像素（唯一换算点，与 StressSfc 同）
        // ★★★决策 #1081：元素几何源接线（`useElement` 的宿主腿）——能力层只分档，几何来自渲染宿主。
        //   ★实现单列在 `runtime/ElementRectProbe`（VaporRenderHost 是存量巨型文件，只减不增）。
        caps.setElementRectProvider(args -> ElementRectProbe.rect(
                draw, density, draw.view() != null ? draw.view().getContentScrollY() : 0, args));
        // ★★决策 #1083：录屏/截屏状态——壳推 `__proteusHostCapture`（截屏发生 / 录屏状态变化）
        capture = new CaptureCapability(this, p -> QuickJsEngine.eval(
                "__proteusHostCapture(" + org.json.JSONObject.quote(p.toString()) + ")"));
        capture.installUserCapture();   // API 34+ 才有；失败静默（桥按 unsupported 分档）
        caps.setCaptureProvider(() -> {
            try { return capture.state().toString(); }
            catch (Throwable t) { return "{\"error\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}"; }
        });
        draw.enableContentScrollRange();       // 内容装不下才滚（与 Web 页面语义一致）
        screenHost.setEnvResolver(draw::resolveEnvInSpec);   // ★屏切换通路的 env 解析（决策 #677）

        // ③ Tab 栏（★B · 决策 #800：chrome **唯一实现在 runtime**——本壳只装配 + 切屏出口）
        chrome = new ProteusTabChrome(this, root);
        chrome.setListener(new ProteusTabChrome.Listener() {
            @Override public void onTab(String name) { switchTab(name); }
        });

        // ④ 载入 superapp bundle + 启动（路由栈 + 宿主真建树 → 进入入口 tab）
        String bundle = readAsset("bundle-superapp.js");
        if (bundle == null) { fail("缺 assets/bundle-superapp.js（先跑 node hosts/android/bridge/build-batch.mjs）"); return; }
        // ★★★B1：壳走**统一运行期**——宿主桥用 SuperappRuntimeHost（暴露 mount/applyOps/onGesture 原语给
        //   JS 共享运行期）；旧静态屏内容改由 JS 侧 __proteusSuperappRender 实例化。
        rtHost = new SuperappRuntimeHost(draw, new HostBridge(caps, screenHost));
        QuickJsEngine.EvalResult load = QuickJsEngine.evalWithHost(bundle, rtHost);
        if (!load.ok) { fail("bundle eval 失败：" + load.error); return; }
        QuickJsEngine.EvalResult boot = QuickJsEngine.eval("__proteusSuperappBootJson()");
        QuickJsEngine.nativeRunPendingJobs();   // 泵 await 续体（路由异步）
        if (!boot.ok || boot.value == null || boot.value.indexOf("\"ok\":true") < 0) {
            fail("superapp boot 失败：" + (boot.value != null ? boot.value : boot.error));
            return;
        }
        // 注册表 → Tab 栏（runtime chrome 渲染）
        refreshChrome();
        // ⑤ 把**当前屏**真画到屏上——★**布局完成后再渲**（视口要用实测视图尺寸；见 renderCurrent 注释）
        contentHost.post(new Runnable() {
            @Override public void run() {
                // ★★★逐页截图装置（2026-10-05 · 拆页后每页需独立截图与 Web 基准可比）：
                //   `--es screen <name>` ⇒ 启动后**导航到该屏**（验收跑器逐页调用 + 截图）。
                String wantScreen = getIntent() != null ? getIntent().getStringExtra("screen") : null;
                if (wantScreen != null && !wantScreen.isEmpty() && !wantScreen.equals(currentName(readState()))) {
                    switchTab(wantScreen);   // 内部 = __proteusSuperappNav(name) + 重绘 + 高亮（通用导航）
                    android.util.Log.i(TAG, "SUPERAPP_SCREEN_NAV screen=" + wantScreen);
                }
                renderCurrent(readState());
                // ★判据（任务 A）：`--es glassdbg 1` ⇒ 逐帧 dump 复合层 + 几何（供逐点对照脚本）
                if (getIntent() != null && "1".equals(getIntent().getStringExtra("glassdbg")) && draw.view() != null) {
                    draw.view().glassDebug = true;
                }
                // ★★★#1225 通用能力直通探针：`--es capprobe "<method>|<json>"` ⇒ 调宿主能力并把回执打 logcat
                //   （与鸿蒙 `--cap-method` 同语义；真机验任何宿主方法都用它，不是一次性脚手架）
                String capProbe = getIntent() != null ? getIntent().getStringExtra("capprobe") : null;
                if (capProbe != null && capProbe.contains("|")) {
                    String[] cp = capProbe.split("\\|", 2);
                    String cpArgs = cp[1].isEmpty() ? "{}" : cp[1];
                    // ★与 capability-invoke.ts 同一判据：两条腿都试（通用全局 → JNI 主通道）
                    String cpJs = "(function(){var a=" + org.json.JSONObject.quote(cpArgs) + ",m=" + org.json.JSONObject.quote(cp[0]) + ";" +
                            "try{if(typeof __proteusHostInvoke==='function')return String(__proteusHostInvoke(m,a));}catch(e){}" +
                            "try{if(typeof proteusHost!=='undefined'&&proteusHost&&typeof proteusHost.invoke==='function')return String(proteusHost.invoke(m,a));}catch(e){return 'ERR:'+e}" +
                            "return 'no-hook';})()";
                    QuickJsEngine.EvalResult cr = QuickJsEngine.eval(cpJs);
                    android.util.Log.i("ProteusCapProbe", "CAP_RECEIPT method=" + cp[0] + " args=" + cpArgs +
                            " -> " + (cr != null && cr.value != null ? cr.value : "<null>"));
                }
                // ★决策 #983 可回归诊断：`--es alphaprobe 1` ⇒ RuntimeShader alpha 是否生效（离屏探针，自判 PASS/FAIL）
                if (getIntent() != null && "1".equals(getIntent().getStringExtra("alphaprobe"))) {
                    dev.proteus.layoutcore.GlassAlphaProbe.runAsync();
                }
                android.util.Log.i(TAG, "SUPERAPP_LAUNCHER_READY screen=" + currentName(readState()));
                // ★判据用：`--es scroll "dx,dy"`（物理像素）——**先滚动**（验证"滚动后导航"的跨屏偏移重置）。
                String scroll = getIntent() != null ? getIntent().getStringExtra("scroll") : null;
                if (scroll != null && scroll.contains(",") && draw.view() != null) {
                    String[] sd = scroll.split(",");
                    draw.view().scrollDragBy(Float.parseFloat(sd[0].trim()), Float.parseFloat(sd[1].trim()));
                    android.util.Log.i(TAG, "SUPERAPP_SCROLL_TEST " + scroll + " → scrollY=" + draw.view().getContentScrollY());
                }
                // ★★★B1 判据用：`--es tap "x,y"`（**物理像素**）——注入合成 tap 走
                //   hitTest → 手势 sink → JS 共享运行期派发（与真触摸同一条链）。
                String tap = getIntent() != null ? getIntent().getStringExtra("tap") : null;
                android.util.Log.i(TAG, "SUPERAPP_TAP_EXTRA=" + tap);
                if (tap != null && tap.contains(",")) {
                    String[] xy = tap.split(",");
                    String json = "{\"x\":" + xy[0].trim() + ",\"y\":" + xy[1].trim() + "}";
                    QuickJsEngine.EvalResult tr = QuickJsEngine.eval("proteusHost.tapAt(" + org.json.JSONObject.quote(json) + ")");
                    QuickJsEngine.nativeRunPendingJobs();   // 泵微任务（$nav → router.push 的续体）
                    android.util.Log.i(TAG, "SUPERAPP_TAP " + json + " => " + (tr != null ? tr.value : "?")
                            + " cur=" + currentName(readState())
                            + " scrollY=" + (draw.view() != null ? draw.view().getContentScrollY() : -1));
                    QuickJsEngine.EvalResult dbg = QuickJsEngine.eval("__proteusSuperappDebug()");
                    android.util.Log.i(TAG, "SUPERAPP_DEBUG " + (dbg != null ? dbg.value : "?"));
                }
                // ★★B1 判据用：`--es back 1` —— 渲染后触发一次 `onBackPressed`（路由返回；验证返回链）。
                if ("1".equals(getIntent() != null ? getIntent().getStringExtra("back") : null)) {
                    contentHost.post(new Runnable() {
                        @Override public void run() {
                            onBackPressed();
                            android.util.Log.i(TAG, "SUPERAPP_BACK_TEST cur=" + currentName(readState()));
                        }
                    });
                }
                // ⑥ drive 模式（验证脚本用）：用**真 MotionEvent** 逐个点 Tab → 重绘 → 落证据
                if ("1".equals(getIntent() != null ? getIntent().getStringExtra("drive") : null)) {
                    contentHost.post(new Runnable() {
                        @Override public void run() { driveTabs(0); }
                    });
                }
                // ★★★导航丝滑演示（用户 2026-10-08）：`--es navdemo 1`——快速往返导航（router 完整编译路线）
                if ("1".equals(getIntent() != null ? getIntent().getStringExtra("navdemo") : null)) {
                    // 1.2s 预热：让 index 先上屏（录屏从"已就绪的 index"开始，避免录到启动瞬间）
                    root.postDelayed(new Runnable() {
                        @Override public void run() { driveNavDemo(0); }
                    }, 1200);
                }
            }
        });
    }

    // ────────────────────────── Tab 栏 ──────────────────────────

    /** ★★★B（决策 #800）：把 state 交给 runtime chrome 渲染（本壳零 tab 逻辑）+ 同步 tabNames（drive/报告用）。 */
    private void refreshChrome() {
        String st = readState();
        try {
            org.json.JSONArray tabs = new org.json.JSONObject(st).optJSONArray("tabs");
            if (tabs != null) {
                tabNames = new String[tabs.length()];
                for (int i = 0; i < tabs.length(); i++) tabNames[i] = tabs.getString(i);
            }
        } catch (Exception e) {
            android.util.Log.w(TAG, "读 tabNames 失败：" + e.getMessage());
        }
        if (chrome != null) chrome.applyState(st);
    }

    /** 切 tab（与 Web 的 `wx.switchTab` / MP 同形）→ 重绘当前屏 → 刷新高亮 */
    private void switchTab(String name) {
        try {
            QuickJsEngine.eval("__proteusSuperappNav(" + org.json.JSONObject.quote(name) + ")");
            QuickJsEngine.nativeRunPendingJobs();
        } catch (Throwable t) {
            android.util.Log.w(TAG, "switchTab 失败：" + t.getMessage());
        }
        String st = readState();
        renderCurrent(st);
        refreshChrome();
    }

    // ────────────────────────── 返回（系统返回键 / 边缘滑返） ──────────────────────────

    /**
     * ★★★B1（用户：「二级页面右滑左滑直接退出应用回桌面」）：**系统返回 → 路由返回**。
     *   Android 的返回（实体键 / 手势导航的左·右边缘滑）都会触发 `onBackPressed`；
     *   此前未重写 ⇒ 默认 finish() ⇒ 二级页面一滑就退出回桌面（用户抓出）。
     *   ⇒ 栈深 > 1（二级页及以上）时走**共享 router 返回**（`__proteusSuperappBack()`）+ 重绘；
     *     栈深 = 1（入口 tab）时交系统默认（退出应用）——与 iOS 右滑返回 / Web 浏览器返回同语义。
     */
    @Override
    public void onBackPressed() {
        try {
            int depth = new org.json.JSONObject(readState()).optInt("depth", 1);
            if (depth > 1) {
                QuickJsEngine.eval("__proteusSuperappBack()");
                QuickJsEngine.nativeRunPendingJobs();   // 泵微任务（router.back 的 await 续体）
                renderCurrent(readState());
                refreshChrome();
                android.util.Log.i(TAG, "SUPERAPP_BACK depth=" + depth + " → " + currentName(readState())
                        + " scrollY=" + (draw.view() != null ? draw.view().getContentScrollY() : -1));
                return;
            }
        } catch (Throwable t) {
            android.util.Log.w(TAG, "onBackPressed 返回失败：" + t.getMessage());
        }
        super.onBackPressed();   // 入口页 ⇒ 交系统（退出应用）
    }

    // ────────────────────────── 渲染 ──────────────────────────

    /** 读 JS 侧运行时状态（JSON 串） */
    private String readState() {
        try {
            QuickJsEngine.EvalResult r = QuickJsEngine.eval("__proteusSuperappState()");
            return (r.ok && r.value != null) ? r.value : "{}";
        } catch (Throwable t) { return "{}"; }
    }

    private String currentName(String stateJson) {
        try { return new org.json.JSONObject(stateJson).optString("current", ""); }
        catch (Exception e) { return ""; }
    }

    /** 把**当前屏内容**真画到屏上（编译产物 app-screen-content.json → 内核树 → 自绘） */
    /**
     * ★★★宿主采集内置环境变量（2026-10-08 · 决策 #593）：平台 insets → 归一为 **dp**（逻辑像素）。
     * 只用官方 API（`WindowInsets`，API 20+；`displayCutout()` API 28+）——**不用**厂商私有 API。
     * ★稳定值取 `*IgnoringVisibility`（沉浸式隐藏系统栏时主 inset 会变 0 ⇒ 布局跳动，见文档坑 P5）。
     * ★厂商私有 API 一律不采用（决策 #593 / 文档 §2.3）；缺 insets 的机型降级 0（不静默错值）。
     */
    // ────────────────────────── ★★★C14 键盘（决策 #1069） ──────────────────────────

    /** 最近一次 IME 高度（dp；0 = 收起）——镜像 `KeyboardWatcher.lastHeightDp`（单一真源在那个类） */
    private volatile float keyboardHeightDp = 0f;
    /** 键盘监听是否已装（幂等；API<30 拿不到 ime() ⇒ 保持 false，如实上报不可知） */
    private volatile boolean keyboardWatched = false;

    /**
     * 装 IME 监听（**唯一实现已抽到 `KeyboardWatcher`**——决策 #1075：原先只在本 Activity 里，
     * 导致 host-runtime 场景完全没有推送）。
     */
    private void installKeyboardInsets() {
        keyboardWatched = KeyboardWatcher.install(this, density, dp -> {
            keyboardHeightDp = dp;
            KeyboardWatcher.pushToJs();
            // 环境变量同步（CSS `--pf-keyboard-height` 让位；复用既有渲染路径）
            renderCurrent(readState());
        });
    }

    /** ★决策 #1081：内置环境变量采集的唯一实现在 `runtime/EnvVars`（壳与真机判据共用）。 */
    private org.json.JSONObject collectEnvVars() { return EnvVars.collect(this, density); }

    private void renderCurrent(String stateJson) {
        final String page = currentName(stateJson);
        try {
            // ★★★B1（统一运行期）：视口 = **实测视图尺寸**（全屏 edge-to-edge；见下方 fallback 说明）。
            //   fallback 用 `dm` 像素原值（无损）且**不减 tab 栏**（Tab 栏是 overlay 不占流；页根自身下内边距让位）。
            int vwPx = contentHost.getWidth() > 0 ? contentHost.getWidth() : physWidthPx;
            int vhPx = contentHost.getHeight() > 0 ? contentHost.getHeight() : physHeightPx;
            // ★内置环境变量（决策 #593/#595）：每次渲染刷新；--pf-vw/--pf-vh = 视口逻辑尺寸
            org.json.JSONObject envObj = collectEnvVars();
            envObj.put("--pf-vw", vwPx / density);
            envObj.put("--pf-vh", vhPx / density);
            draw.setEnvVars(envObj);
            // ★★★B1：内容由 JS **共享运行期**实例化（交互/响应式/导航）；宿主只提供 mount/applyOps 原语。
            org.json.JSONObject args = new org.json.JSONObject();
            args.put("name", page);
            args.put("viewport", new org.json.JSONObject()
                    .put("width", vwPx / density).put("height", vhPx / density));
            QuickJsEngine.EvalResult rr = QuickJsEngine.eval(
                    "__proteusSuperappRender(" + org.json.JSONObject.quote(args.toString()) + ")");
            if (draw.view() != null) draw.view().invalidate();
            android.util.Log.i(TAG, "SUPERAPP_RENDER page=" + page
                    + " viewport=" + (vwPx / density) + "x" + (vhPx / density)
                    + " runtime=" + (rr != null && rr.value != null ? rr.value : "?"));
        } catch (Throwable t) {
            android.util.Log.w(TAG, "renderCurrent 失败：" + t.getMessage());
        }
    }

    // ────────────────────────── drive（自动真触摸验证） ──────────────────────────

    /**
     * 用**真 MotionEvent** 逐个点 Tab（`root.dispatchTouchEvent` → 平台触摸栈 → TextView 点击），
     * 每步后重绘并记账 —— 证据写 `superapp-launcher.json`（判据读 `switch_log`）。
     * ★与「真触摸」既有先例同法（进程内真 MotionEvent，无需 INJECT_EVENTS）。
     */
    private void driveTabs(final int idx) {
        if (idx >= tabNames.length) {
            // ★★★报告**等最后一帧画完**再写（本仓实测的证据竞态）：写报告与截屏都在脚本侧紧接着做，
            //   若此时末屏的绘制帧还没上（`postOnAnimation` 已排队但未执行）⇒ 截到**上一屏**的旧帧，
            //   报告却说 current=mine（独立视觉验收抓出"证据自相矛盾：图是首页、JSON 说 mine"）。
            root.postOnAnimation(new Runnable() {
                @Override public void run() { writeLauncherReport("drive"); }
            });
            return;
        }
        final String name = tabNames[idx];
        // 按第 idx 个 Tab 的**实际布局几何**注入真实 DOWN/UP（坐标相对 root——tab.getTop/Width 即
        //   root 坐标系；★不能用 displayMetrics.heightPixels 推：全屏/系统栏时序下 root 高度可能不同 ⇒ 打空）
        final android.view.View barV = chrome != null ? chrome.barView() : null;
        final android.view.View tv = chrome != null ? chrome.itemView(idx) : null;
        float bx = barV != null ? barV.getLeft() : 0f;
        float by = barV != null ? barV.getTop() : 0f;
        float bw = barV != null ? barV.getWidth() : 0f;
        float bh = barV != null ? barV.getHeight() : 0f;
        float cx = bx + bw * (idx + 0.5f) / Math.max(1, tabNames.length);
        float cy = by + bh / 2f;
        android.util.Log.i(TAG, "driveTabs tap=" + name + " at (" + cx + "," + cy + ") barTop=" + by
                + " barH=" + bh + " barW=" + bw);
        long t = android.os.SystemClock.uptimeMillis() + 1000L * (idx + 1);
        // ① 首选：向 **root** 派发真 MotionEvent 序列（DOWN→UP，走整棵视图树命中 → 平台触摸栈）。
        final boolean consumed = tapSequence(root, t, cx, cy);
        // ★结论**下一帧**再读：TextView 的 onClick 在 UP 之后按 handler 消息派发（同帧内读不到）——
        //   首版同帧读 ⇒ 真触摸被判"打空"而误走兜底（实测）。
        final float cxF = cx, cyF = cy;
        root.postOnAnimation(new Runnable() {
            @Override public void run() {
                String cur = currentName(readState());
                String via = name.equals(cur) ? "motion-root" : "";
                // ② 次选：向 **tab 子视图**直派（局部坐标）——仍是真实点击通路（dispatchTouchEvent → onTouchEvent → performClick）。
                if (via.isEmpty() && tv != null) {
                    tapSequence(tv, android.os.SystemClock.uptimeMillis() + 100L, cxF - tv.getLeft(), cyF - tv.getTop());
                    cur = currentName(readState());
                    if (name.equals(cur)) via = "motion-child";
                }
                // ③ 兜底：performClick（路径如实记账——不掩盖"真触摸打空"）。
                //   ★本机 `adb shell input tap` 被 INJECT_EVENTS 拦（本仓既有实测）⇒ 合成 MotionEvent 是唯一"真触摸"形态。
                if (via.isEmpty() && tv != null) { tv.performClick(); cur = currentName(readState()); via = "performClick"; }
                if (via.isEmpty()) via = "none";
                try {
                    org.json.JSONObject row = new org.json.JSONObject();
                    row.put("tap", name); row.put("current", cur); row.put("ok", name.equals(cur));
                    row.put("via", via); row.put("motion_consumed", consumed);
                    switchLog.put(row);
                } catch (Exception e) { /* 记账失败不阻断 */ }
                // 下一帧点下一个（让重绘/微任务继续排空）
                root.postOnAnimation(new Runnable() {
                    @Override public void run() { driveTabs(idx + 1); }
                });
            }
        });
    }

    // ────────────────────────── 导航丝滑演示（用户 2026-10-08） ──────────────────────────

    /** index 页可点导航行的**物理 y 中心**（与截图坐标系一致：内容视图全屏、origin 0,0）。 */
    private static final int[] NAV_DEMO_ROWS = {
        605, 761, 917, 1073, 1229, 1385, 1541, 1697, 1853, 2009, 2165, 2321, 2477,
    };
    private int navDemoPass = 0;

    /**
     * ★★★导航丝滑演示（用户 2026-10-08「录一段快速切换页面的短视频，导航走 router 完整编译路线」）：
     *   `--es navdemo 1` —— **快速往返导航**（index ↔ 各特性页，多趟循环）。
     *   每次往返都走**真实链路**：
     *     前进：合成 tap → 内核 `hitTest` → 共享运行期派发 → `$nav('目标')` → `router.push`；
     *     返回：`onBackPressed()` → `__proteusSuperappBack()` → `router.back`。
     *   ⇒ **不是静态截图/预渲染**，而是完整编译路由 + 真内核建树 + 真上屏，高速连发以展示切换性能。
     *   （本机 `adb shell input tap` 被 INJECT_EVENTS 拦，故用进程内 `proteusHost.tapAt`——与真触摸同一条
     *     gesture→hitTest→dispatch 链，仅免去 OS 触摸屏层。）
     */
    private void driveNavDemo(final int k) {
        if (k >= NAV_DEMO_ROWS.length) {
            navDemoPass++;
            if (navDemoPass < 2) { driveNavDemo(0); return; }   // 两趟 ≈ 15s（够一段演示）
            android.util.Log.i(TAG, "SUPERAPP_NAVDEMO_DONE passes=" + navDemoPass + " cur=" + currentName(readState()));
            return;
        }
        final int y = NAV_DEMO_ROWS[k];
        final String json = "{\"x\":600,\"y\":" + y + "}";
        QuickJsEngine.eval("proteusHost.tapAt(" + org.json.JSONObject.quote(json) + ")");
        QuickJsEngine.nativeRunPendingJobs();
        android.util.Log.i(TAG, "SUPERAPP_NAVDEMO push y=" + y + " cur=" + currentName(readState()));
        root.postDelayed(new Runnable() {
            @Override public void run() {
                // 仅当已离开 index 才返回（否则 onBackPressed 会 finish 掉应用）
                if (!"index".equals(currentName(readState()))) {
                    onBackPressed();
                    android.util.Log.i(TAG, "SUPERAPP_NAVDEMO back cur=" + currentName(readState()));
                } else {
                    android.util.Log.w(TAG, "SUPERAPP_NAVDEMO MISS y=" + y + "（tap 未命中，跳过返回）");
                }
                root.postDelayed(new Runnable() {
                    @Override public void run() { driveNavDemo(k + 1); }
                }, 260);
            }
        }, 340);
    }

    /** 向 `target` 派发一次真 MotionEvent 序列（DOWN → MOVE → UP）；返回 DOWN 是否被消费。 */
    private static boolean tapSequence(android.view.View target, long t, float x, float y) {
        android.view.MotionEvent down = android.view.MotionEvent.obtain(
                t, t, android.view.MotionEvent.ACTION_DOWN, x, y, 0);
        boolean consumed = target.dispatchTouchEvent(down); down.recycle();
        android.view.MotionEvent move = android.view.MotionEvent.obtain(
                t, t + 20, android.view.MotionEvent.ACTION_MOVE, x + 0.5f, y + 0.5f, 0);
        target.dispatchTouchEvent(move); move.recycle();
        android.view.MotionEvent up = android.view.MotionEvent.obtain(
                t, t + 40, android.view.MotionEvent.ACTION_UP, x + 0.5f, y + 0.5f, 0);
        target.dispatchTouchEvent(up); up.recycle();
        return consumed;
    }

    // ────────────────────────── 报告 ──────────────────────────

    private void writeLauncherReport(String mode) {
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("ok", true);
            o.put("mode", mode);
            o.put("host_id", "android");
            o.put("state", new org.json.JSONObject(readState()));
            o.put("tabs", new org.json.JSONArray(tabNames));
            o.put("switch_log", switchLog);
            o.put("rendered_page", currentName(readState()));
            // ★#1098：P0 长任务读数（与 iOS/Android heartbeat 同字段名 jsTasks）
            try { o.put("jsTasks", new org.json.JSONObject(QuickJsEngine.perfStats())); } catch (Throwable jt) { }
            // ★#1098 P0 归因：同一段 JS eval 里「JS 实例化」vs「宿主建树/出指令」各占多少
            if (rtHost != null) { o.put("mount_host_ms", rtHost.lastMountMs); o.put("apply_ops_host_ms", rtHost.lastApplyOpsMs); }
            // ★#1098 P0：宿主 mount 的内部三相位（度量 / 内核建树 / 出指令）——决定 P1 还是 P2
            if (draw != null) { o.put("mount_measure_ms", draw.lastMeasureMs); o.put("mount_layout_ms", draw.lastLayoutMs); o.put("mount_emit_ms", draw.lastEmitMs); o.put("mount_sample_ms", draw.lastSampleMs); o.put("mount_wrap_ms", draw.lastWrapMs); o.put("mount_scroll_ms", draw.lastScrollMs); }
            if (draw != null && draw.view() != null) {
                o.put("on_draw", draw.view().onDrawCount());
            }
            try {
                o.put("host_stats", new org.json.JSONObject(
                        screenHost != null ? screenHost.invoke("screen.stats", new org.json.JSONObject()) : "{}"));
            } catch (Throwable t) { o.put("host_stats_error", String.valueOf(t)); }
            // ★★★批次 45：视觉证据（把整窗真画到 PNG——App 壳上屏的机器可读证据）。
            try {
                android.graphics.Bitmap bmp = android.graphics.Bitmap.createBitmap(
                        root.getWidth() > 0 ? root.getWidth() : 1080,
                        root.getHeight() > 0 ? root.getHeight() : 2400,
                        android.graphics.Bitmap.Config.ARGB_8888);
                root.draw(new android.graphics.Canvas(bmp));
                java.io.File dir = getExternalFilesDir(null);
                if (dir == null) dir = getFilesDir();
                java.io.File png = new java.io.File(dir, "superapp-launcher.png");
                java.io.FileOutputStream pf = new java.io.FileOutputStream(png);
                bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, pf);
                pf.close(); bmp.recycle();
                o.put("png", png.getName());
            } catch (Throwable pe) { o.put("png_error", pe.getClass().getSimpleName()); }
            HostJson.writeReport(this, "superapp-launcher.json", o.toString(2));
            android.util.Log.i(TAG, "SUPERAPP_LAUNCHER_REPORT_READY");
        } catch (Exception e) {
            fail("报告组装失败：" + e.getMessage());
        }
    }

    private void fail(String reason) {
        android.util.Log.e(TAG, "SUPERAPP_LAUNCHER_ERROR " + reason);
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("ok", false); o.put("error", reason);
            HostJson.writeReport(this, "superapp-launcher.json", o.toString(2));
        } catch (Exception ignored) { /* JSONObject 不会失败 */ }
        // ★仍打 READY 标记（脚本据此收工——失败也要有终态，不静默挂起）
        android.util.Log.i(TAG, "SUPERAPP_LAUNCHER_REPORT_READY");
    }

    /**
     * ★★★系统状态栏是否隐藏（2026-10-08 · 决策 #594）：读 assets/app-config.json 的 `safeArea.statusBar`。
     *   缺文件/字段 ⇒ **false（显示）** = 框架默认（与 Web 手机端对齐）。`'hide'` ⇒ true。
     */
    private boolean statusBarHidden() {
        try {
            String sc = readAsset("app-config.json");
            if (sc == null) return false;
            org.json.JSONObject o = new org.json.JSONObject(sc);
            return "hide".equals(o.optJSONObject("safeArea") != null ? o.optJSONObject("safeArea").optString("statusBar", "show") : "show");
        } catch (Throwable t) { return false; }
    }

    private String readAsset(String name) {
        try (java.io.InputStream is = getAssets().open(name)) {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), "UTF-8");
        } catch (Exception e) { return null; }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && android.os.Build.VERSION.SDK_INT >= 30) {
            android.view.WindowInsetsController wic = getWindow().getInsetsController();
            // ★★★状态栏显示策略（2026-10-08 · 决策 #594）：app-config `safeArea.statusBar`（缺省 **show** ——
            //   与 Web 手机端 viewport-fit=cover + edge-to-edge 对齐：状态栏显示、内容铺到状态栏区、
            //   页根用 --pf-inset-top 让位）。`hide` = 沉浸式全屏。
            if (wic != null) {
                if (statusBarHidden()) {
                    wic.hide(android.view.WindowInsets.Type.statusBars());
                } else {
                    wic.show(android.view.WindowInsets.Type.statusBars());
                    // 浅色页面 ⇒ 状态栏图标用**深色**（WCAG/可读）；仅 API 30+（本宿主已≥30 分支）。
                    wic.setSystemBarsAppearance(android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                            android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
                }
            }
            // ★底部 Tab 栏让开**系统导航条**（全屏 edge-to-edge ⇒ 手势条会压住 tab 文字）：取导航栏 inset，
            //   交给 runtime chrome 加底部内边距（内容上移）。
            android.view.WindowInsets wi = getWindow().getDecorView().getRootWindowInsets();
            if (wi != null && chrome != null) {
                int nav = wi.getInsets(android.view.WindowInsets.Type.navigationBars()).bottom;
                chrome.setBottomInsetPx(nav);
            }
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (screenHost != null) screenHost.dispose();
        if (caps != null) caps.dispose();
    }
}
