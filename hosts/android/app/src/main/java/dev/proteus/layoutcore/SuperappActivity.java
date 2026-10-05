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
//   ④ 底部 **Tab 栏**（宿主原生 chrome——MP 端由原生 tabBar 提供，同语义）→ 真触摸切 tab → 重绘
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
    private android.widget.LinearLayout tabBar;
    private VaporRenderHost draw;
    private ScreenHost screenHost;
    private HostCapabilities caps;

    /** 平台逻辑尺寸（viewport）——与 StressSfcActivity 同口径（物理/density） */
    private float logicalW = 390f, logicalH = 844f;
    private float density = 1f;
    private int tabBarHeightPx = 0;

    /** Tab 栏数据（boot 后从 superapp 注册表读回——与 Web/MP 同一套 tabNames/tabLabels） */
    private String[] tabNames = new String[0];
    private java.util.Map<String, String> tabLabels = new java.util.HashMap<>();

    /** drive 模式证据：每次 tab 切换后的当前屏 */
    private final org.json.JSONArray switchLog = new org.json.JSONArray();

    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 全屏取景（与 L4/StressSfc 同款：Manifest 无需主题，运行时全屏零重建）
        getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN,
                android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        }
        android.view.WindowManager.LayoutParams attrs0 = getWindow().getAttributes();
        attrs0.layoutInDisplayCutoutMode =
                android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        getWindow().setAttributes(attrs0);

        android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
        density = dm.density;
        logicalW = dm.widthPixels / dm.density;
        logicalH = dm.heightPixels / dm.density;
        // I2-ALLOW: 宿主自绘 chrome（底部 Tab 栏）的**像素高度**，非内核几何——不流经排版核心，
        //   与状态栏/工具栏同类；仅用于本 Activity 自建的 chrome 视图排布。
        tabBarHeightPx = Math.round(56f * dm.density);

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

    private void boot() {
        // ① 建宿主桥（能力 + 屏树）——屏树供 superapp 路由语义（screen.mount/stats/rect…）
        caps = new HostCapabilities(this);
        screenHost = new ScreenHost(root);

        // ② 内容绘制宿主（真内核树 → 自绘）——屏内容上屏用
        contentHost = new android.widget.FrameLayout(this);
        android.widget.FrameLayout.LayoutParams clp = new android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT);
        // 给底部 Tab 栏留位（内容不被 chrome 压住）
        clp.bottomMargin = tabBarHeightPx;
        contentHost.setLayoutParams(clp);
        root.addView(contentHost);

        draw = new VaporRenderHost(this, contentHost);
        draw.setLengthScale(density);          // 逻辑单位 → 物理像素（唯一换算点，与 StressSfc 同）
        draw.enableContentScrollRange();       // 内容装不下才滚（与 Web 页面语义一致）

        // ③ Tab 栏（原生 chrome——MP 由原生 tabBar 提供；先占位，boot 后填文案）
        tabBar = new android.widget.LinearLayout(this);
        tabBar.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        tabBar.setBackgroundColor(0xFF1B1B2A);
        android.widget.FrameLayout.LayoutParams tlp = new android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT, tabBarHeightPx);
        tlp.gravity = android.view.Gravity.BOTTOM;
        tabBar.setLayoutParams(tlp);
        root.addView(tabBar);                  // 后加 ⇒ 在内容之上

        // ④ 载入 superapp bundle + 启动（路由栈 + 宿主真建树 → 进入入口 tab）
        String bundle = readAsset("bundle-superapp.js");
        if (bundle == null) { fail("缺 assets/bundle-superapp.js（先跑 node hosts/android/bridge/build-batch.mjs）"); return; }
        QuickJsEngine.EvalResult load = QuickJsEngine.evalWithHost(bundle, new MainActivity.HostBridge(caps, screenHost));
        if (!load.ok) { fail("bundle eval 失败：" + load.error); return; }
        QuickJsEngine.EvalResult boot = QuickJsEngine.eval("__proteusSuperappBootJson()");
        QuickJsEngine.nativeRunPendingJobs();   // 泵 await 续体（路由异步）
        if (!boot.ok || boot.value == null || boot.value.indexOf("\"ok\":true") < 0) {
            fail("superapp boot 失败：" + (boot.value != null ? boot.value : boot.error));
            return;
        }
        // 注册表 → Tab 栏
        buildTabBar();
        // ⑤ 把**当前屏**真画到屏上
        renderCurrent(readState());
        android.util.Log.i(TAG, "SUPERAPP_LAUNCHER_READY screen=" + currentName(readState()));

        // ⑥ drive 模式（验证脚本用）：用**真 MotionEvent** 逐个点 Tab → 重绘 → 落证据
        if ("1".equals(getIntent() != null ? getIntent().getStringExtra("drive") : null)) {
            contentHost.post(new Runnable() {
                @Override public void run() { driveTabs(0); }
            });
        }
    }

    // ────────────────────────── Tab 栏 ──────────────────────────

    private void buildTabBar() {
        String st = readState();
        try {
            org.json.JSONObject o = new org.json.JSONObject(st);
            org.json.JSONArray tabs = o.optJSONArray("tabs");
            if (tabs != null) {
                tabNames = new String[tabs.length()];
                for (int i = 0; i < tabs.length(); i++) tabNames[i] = tabs.getString(i);
            }
            org.json.JSONObject labels = o.optJSONObject("tabLabels");
            if (labels != null) {
                java.util.Iterator<String> it = labels.keys();
                while (it.hasNext()) { String k = it.next(); tabLabels.put(k, labels.optString(k, k)); }
            }
        } catch (Exception e) {
            android.util.Log.w(TAG, "读 tab 注册表失败：" + e.getMessage());
        }
        tabBar.removeAllViews();
        String current = currentName(readState());
        int unread = readImUnread();
        final int onColor = 0xFF4C8DFF, offColor = 0xFF8A8A9A;
        for (final String name : tabNames) {
            boolean on = name.equals(current);
            // 每项 = 竖向 [ 图标（FrameLayout，可叠角标） + 短标签 ]——与 Web 底部 Tab 栏同形
            // （⌂ 首页 / ✉ 消息 / ☺ 我的；tab 文案用短名，不用页面 title）。
            android.widget.LinearLayout col = new android.widget.LinearLayout(this);
            col.setOrientation(android.widget.LinearLayout.VERTICAL);
            col.setGravity(android.view.Gravity.CENTER);
            col.setTag(name);
            col.setClickable(true);
            // 图标区（FrameLayout 以便右上角叠 IM 角标）
            android.widget.FrameLayout iconWrap = new android.widget.FrameLayout(this);
            int iw = Math.round(40 * density), ih = Math.round(28 * density);
            iconWrap.setLayoutParams(new android.widget.LinearLayout.LayoutParams(iw, ih));
            android.widget.TextView ic = new android.widget.TextView(this);
            ic.setText(tabIcon(name));
            ic.setTextSize(20f);
            ic.setGravity(android.view.Gravity.CENTER);
            ic.setTextColor(on ? onColor : offColor);
            iconWrap.addView(ic, new android.widget.FrameLayout.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT));
            if ("messages".equals(name) && unread > 0) {
                android.widget.TextView badge = new android.widget.TextView(this);
                badge.setText(unread > 99 ? "99+" : String.valueOf(unread));
                badge.setTextSize(9f);
                badge.setTextColor(0xFFFFFFFF);
                badge.setGravity(android.view.Gravity.CENTER);
                badge.setBackgroundColor(0xFFF5222D);
                int bw = Math.round(16 * density);
                android.widget.FrameLayout.LayoutParams bpl = new android.widget.FrameLayout.LayoutParams(bw, bw);
                bpl.gravity = android.view.Gravity.TOP | android.view.Gravity.END;
                bpl.topMargin = 0; bpl.rightMargin = Math.round(4 * density);
                iconWrap.addView(badge, bpl);
            }
            col.addView(iconWrap);
            android.widget.TextView lab = new android.widget.TextView(this);
            lab.setText(tabShortLabel(name));
            lab.setTextSize(11f);
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

    private static String tabIcon(String name) {
        return "index".equals(name) ? "⌂" : "messages".equals(name) ? "✉" : "mine".equals(name) ? "☺" : "•";
    }

    private static String tabShortLabel(String name) {
        return "index".equals(name) ? "首页" : "messages".equals(name) ? "消息" : "mine".equals(name) ? "我的"
                : name;
    }

    /** 读 IM 未读角标（App 壳 overlay 的 IM 角标初值——从屏内容节点里的角标数字取；失败 0） */
    private int readImUnread() {
        return 3;   // 与 App.vue 壳初值 imUnread 一致（Web 同）；后续接实时运行时改由状态驱动
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
        highlightTab(currentName(st));
    }

    private void highlightTab(String current) {
        for (int i = 0; i < tabBar.getChildCount(); i++) {
            android.view.View v = tabBar.getChildAt(i);
            if (v instanceof android.widget.TextView) {
                boolean on = current.equals(v.getTag());
                ((android.widget.TextView) v).setTextColor(on ? 0xFF4C8DFF : 0xFF8A8A9A);
            }
        }
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
    private void renderCurrent(String stateJson) {
        String page = currentName(stateJson);
        try {
            String sc = readAsset("app-screen-content.json");
            if (sc == null) { android.util.Log.w(TAG, "缺 app-screen-content.json——无法上屏"); return; }
            org.json.JSONObject all = new org.json.JSONObject(sc);
            if (!all.has(page)) page = all.has("index") ? "index" : all.keys().next();
            org.json.JSONArray nodes = all.getJSONObject(page).getJSONArray("nodes");
            org.json.JSONObject tree = new org.json.JSONObject();
            // viewport 高 = **内容区**（屏高 − 底部 Tab 栏）——App 壳按此布局（绝对层填满内容区），
            //   与宿主 tab 栏各占其位（不重叠、不裁切）
            float contentH = logicalH - tabBarHeightPx / density;
            tree.put("viewport", new org.json.JSONObject().put("width", logicalW).put("height", contentH));
            tree.put("nodes", nodes);
            draw.mount(tree.toString());
            if (draw.view() != null) draw.view().invalidate();
            android.util.Log.i(TAG, "SUPERAPP_RENDER page=" + page + " nodes=" + nodes.length());
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
            writeLauncherReport("drive");
            return;
        }
        final String name = tabNames[idx];
        // 按第 idx 个 Tab 的**实际布局几何**注入真实 DOWN/UP（坐标相对 root——tab.getTop/Width 即
        //   root 坐标系；★不能用 displayMetrics.heightPixels 推：全屏/系统栏时序下 root 高度可能不同 ⇒ 打空）
        final android.view.View tv = tabBar.getChildAt(idx);
        float cx = tabBar.getWidth() * (idx + 0.5f) / Math.max(1, tabNames.length);
        float cy = tabBar.getTop() + tabBar.getHeight() / 2f;
        android.util.Log.i(TAG, "driveTabs tap=" + name + " at (" + cx + "," + cy + ") barTop=" + tabBar.getTop()
                + " barH=" + tabBar.getHeight() + " barW=" + tabBar.getWidth());
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
            MainActivity.writeReportStatic(this, "superapp-launcher.json", o.toString(2));
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
            MainActivity.writeReportStatic(this, "superapp-launcher.json", o.toString(2));
        } catch (Exception ignored) { /* JSONObject 不会失败 */ }
        // ★仍打 READY 标记（脚本据此收工——失败也要有终态，不静默挂起）
        android.util.Log.i(TAG, "SUPERAPP_LAUNCHER_REPORT_READY");
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
            if (wic != null) wic.hide(android.view.WindowInsets.Type.statusBars());
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (screenHost != null) screenHost.dispose();
        if (caps != null) caps.dispose();
    }
}
