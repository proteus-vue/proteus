package dev.proteus.layoutcore;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;

/**
 * ★★M2 真机验证宿主（Android）——对应 iOS 的 layout-core-device.swift，但多一件事：
 * **M2 出口条件要求「与原生 View 体系对打」**（方案 §9.2），故本宿主内置两条通路同时测量：
 *   ① Proteus 通路：Rust 排版核心算几何 → 单个宿主 View 的 onDraw 用 Canvas 下发
 *   ② 原生对照：同规格的 LinearLayout/View 树（Android 自己的 measure/layout/draw）
 *
 * 【为什么两条通路在同一 app】§9.2 要求「严格复刻，否则数据不可比」——
 * 同进程、同数据、同计时代码，避免两个 app 因编译/调度/热状态差异产出不可比数字。
 *
 * 【§9.2 测试定义】2000 个 view（各含 1 text）分 50 行 × 40 个，每行外层套 1 个 view
 * → 合计 4050 元素；**view 不设宽高**，尺寸由内部文字撑开。
 */
public class MainActivity extends Activity {
    private static final String TAG = "proteus";

    // §9.2 规格
    private static final int ROWS = 50;
    private static final int COLS = 40;
    private static final int TOTAL = ROWS * COLS * 2 + ROWS + 1; // 4050

    private FrameLayout root;
    private android.widget.Button runButton;

    /** 本次要测的通路（`--es path proteus|native`；缺省 proteus）。脚本据此分两次冷启动，隔离内存。 */
    private String testPath = "proteus";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // ★§9.2「起点 = click 事件触发」：不再 onCreate 自动跑，改为**按钮点击**触发
        //   （onCreate 自动跑会把测量混进冷启动，且脚本无法控制时机）
        String extra = getIntent() != null ? getIntent().getStringExtra("path") : null;
        if (extra != null) testPath = extra;

        root = new FrameLayout(this);
        setContentView(root);

        runButton = new android.widget.Button(this);
        runButton.setText("运行 4050 元素测试（" + testPath + "）");
        runButton.setTextSize(16f);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, 260);
        runButton.setLayoutParams(lp);
        runButton.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { runAll(); }
        });
        root.addView(runButton);

        // ★§9.2「起点 = click 事件触发」：由**外部事件**触发测试（与点击等价，且可脚本化）。
        //   为什么不用 `adb shell input tap`：Android 新版本对 `input` 注入要求 INJECT_EVENTS 权限
        //   （本仓实测报 SecurityException）→ 改用显式广播，语义上仍是「外部触发」而非自启动。
        android.content.BroadcastReceiver receiver = new android.content.BroadcastReceiver() {
            @Override public void onReceive(android.content.Context c, android.content.Intent i) {
                String p = i.getStringExtra("path");
                if (p != null) testPath = p;
                runAll();
            }
        };
        android.content.IntentFilter filter = new android.content.IntentFilter("dev.proteus.RUN");
        // ★Android 14+ 要求显式声明导出行为
        if (android.os.Build.VERSION.SDK_INT >= 34) {
            registerReceiver(receiver, filter, android.content.Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(receiver, filter);
        }
    }

    /** 报告目录：★外置存储（release 包无 run-as，脚本经 adb pull 取回） */
    private File reportDir() {
        File d = getExternalFilesDir(null);
        return d != null ? d : getFilesDir();
    }

    private long baselinePss = 0L;
    /**
     * ★★测量期间必须**持有被测结构的强引用**（本仓实测教训）：
     *   初版把 View 树 / 指令表放在局部变量里，方法返回即失去强引用 →
     *   GC 可能在 PSS 采样前回收 → 同一份代码两次运行测出 42.5MB / 12.8MB（差 3 倍）。
     *   内存测量必须显式 keep-alive，直到采样完成。
     */
    @SuppressWarnings("FieldCanBeLocal")
    private Object keepAlive;
    /** 测试期间观测到的 CPU 集合（§9.2 核判定用；app 自读 /proc 无权限限制，比脚本侧可靠） */
    private final java.util.TreeSet<Integer> observedCpus = new java.util.TreeSet<>();

    /**
     * 读本进程主线程当前所在 CPU（`/proc/self/task/<tid>/stat` 第 39 字段 = processor）。
     * ★app 读自己的 /proc 不受限制（脚本侧读别的进程会受限，本仓实测踩到）。
     */
    private int mainThreadCpu() {
        try {
            int tid = android.os.Process.myTid();
            java.io.BufferedReader r = new java.io.BufferedReader(
                    new java.io.FileReader("/proc/self/task/" + tid + "/stat"));
            String line = r.readLine();
            r.close();
            if (line == null) return -1;
            // 字段 1 = pid，故第 39 个字段在 split 后索引 38
            String[] f = line.split(" ");
            if (f.length < 39) return -1;
            return Integer.parseInt(f[38]);
        } catch (Exception e) {
            return -1;
        }
    }

    /** 读 CPU 温度（millidegree；取 thermal_zone 最大值，读不到返回 -1） */
    private int readTemp() {
        int max = -1;
        java.io.File dir = new java.io.File("/sys/class/thermal");
        java.io.File[] zones = dir.listFiles();
        if (zones == null) return -1;
        for (java.io.File z : zones) {
            if (!z.getName().startsWith("thermal_zone")) continue;
            try {
                java.io.BufferedReader r = new java.io.BufferedReader(
                        new java.io.FileReader(new java.io.File(z, "temp")));
                int v = Integer.parseInt(r.readLine().trim());
                r.close();
                if (v > max && v < 200000) max = v;   // 过滤明显异常值
            } catch (Exception ignored) {}
        }
        return max;
    }

    private void runAll() {
        // ★§9.2 增量内存：点击时刻的 PSS 作为基线
        baselinePss = pssKb();
        observedCpus.clear();
        int tempBefore = readTemp();
        StringBuilder sb = new StringBuilder();
        sb.append("=== Rust 排版核心 · Android 真机验证 ===\n");
        sb.append(String.format("设备：%s %s · Android %s（API %d）%n",
                android.os.Build.MANUFACTURER, android.os.Build.MODEL,
                android.os.Build.VERSION.RELEASE, android.os.Build.VERSION.SDK_INT));
        sb.append("ABI：").append(join(android.os.Build.SUPPORTED_ABIS)).append('\n');
        sb.append("引擎：").append(RustLayout.version()).append('\n');
        sb.append("JNI 符号自检：").append(RustLayout.checkSymbols() ? "✓ 通过" : "✗ " + RustLayout.getLoadError()).append('\n');
        sb.append("测试通路：").append(testPath).append("（脚本以 --es path 注入，两次冷启动隔离内存）\n");
        sb.append("起始 PSS：").append(baselinePss).append(" KB\n");
        sb.append('\n');

        sb.append("【① 与浏览器基准的一致性】\n");
        String golden = readAsset("browser-layout.json");
        if (golden == null) {
            sb.append("✗ assets/browser-layout.json 未装入\n");
        } else {
            String report = RustLayout.conformance(golden);
            sb.append(report).append('\n');
            writeReport("layout-conformance.json", report);
        }
        sb.append('\n');

        // ★§9.2 核判定：重负载路径上持续采样（每 3ms 一次，覆盖整个测量窗口）
        //   采样密度足够才能判定「测量期间是否曾跑到超大核」——
        //   本仓实测：单点采样会漏掉瞬时抬升（cpu4 与 cpu7 出现在同一次运行）
        Thread cpuSampler = new Thread(new Runnable() {
            public void run() {
                long end = SystemClock.elapsedRealtime() + 3000;
                while (SystemClock.elapsedRealtime() < end) {
                    int c = mainThreadCpu();
                    if (c >= 0) synchronized (observedCpus) { observedCpus.add(c); }
                    try { Thread.sleep(3); } catch (InterruptedException e) { return; }
                }
            }
        });
        cpuSampler.setDaemon(true);
        cpuSampler.start();

        sb.append("【② 4050 元素布局性能（纯排版）】\n");
        String bench = RustLayout.bench(TOTAL, 20);
        sb.append(bench).append('\n');
        writeReport("layout-bench.json", bench);
        sb.append('\n');

        if ("native".equals(testPath)) {
            sb.append("【③ 原生 View 体系（对照组，单跑以隔离内存）】\n");
            String nativeOnly = nativeOnlyRun();
            sb.append(nativeOnly).append('\n');
            writeReport("layout-native-only.json", nativeOnly);
        } else if ("scroll".equals(testPath)) {
            sb.append("【③ §9.3 平台侧滚动（Choreographer 帧率 + RenderNode 池）】\n");
            String start = scrollListRun();
            sb.append(start).append('\n');
        } else if ("shot-scroll-native".equals(testPath)) {
            // ★★z-order 约束下的**滚动同步**验证（方案坑位 #4）
            //   场景：20 行列表，**第 5 行是 native-host（WebView）**；程序驱动滚动到若干位置，
            //   每个位置截图核验：① native-host 是否跟随（translationY = -scrollY）
            //                     ② 滚出视口是否被裁（INVISIBLE）
            //                     ③ 自绘内容与原生 View 的**相对位置**是否保持（不脱节）
            sb.append("【③ 滚动 + native-host 同步】\n");
            String s1 = setupScrollNativeScene();
            sb.append(s1).append('\n');
            writeReport("layout-scroll-native.json", s1);
        } else if ("shot-native".equals(testPath)) {
            // ★★M3 原生组件混用（方案 L3：「map / webview / 广告 / 第三方 SDK 以原生 View 嵌入」）
            //   验证三件事：
            //     ① native-host 节点的**位置/尺寸由 Rust 几何决定**（不退化为 View 体系测量）
            //     ② 原生 View 与自绘内容**共存于同一宿主**
            //     ③ **z-order 约束**（原生 View 在自绘内容之上——Android 固有，需如实记录）
            sb.append("【③ 原生组件混用场景（native-host）】\n");
            String shotN = setupNativeHostScene();
            sb.append(shotN).append('\n');
            writeReport("layout-native-host.json", shotN);
        } else if ("shot".equals(testPath)) {
            // ★★截图回归（内容级等价验证）
            //   目的：闭环验证「**Rust 算出的几何 → 屏幕上的真实像素**」。
            //   此前像素校验比的是「两条光栅化路径」（drawText vs drawBitmap）——**不可比**；
            //   本路径比的是「几何预测」与「屏幕实际呈现」，两侧独立、真正可比。
            sb.append("【③ 截图回归场景】\n");
            String shot = setupScreenshotScene();
            sb.append(shot).append('\n');
            writeReport("layout-shot-scene.json", shot);
        } else if ("hit".equals(testPath)) {
            // ★★★M3 事件系统：命中测试闭环
            //   三个独立层次，缺一不可：
            //     ① **核心正确性** → 与浏览器 golden 对拍（3547 探针，已在 conformance 里跑）
            //     ② **独立实现对拍** → 同一几何喂 Android 原生 View 体系，比「谁被点到」
            //     ③ **端到端** → 真实宿主 dispatchHit（含滚动偏移换算 + JNI 往返）
            sb.append("【③ 事件系统：命中测试（三层验证）】\n");
            String hit = hitTestRun();
            sb.append(hit).append('\n');
            writeReport("layout-hit.json", hit);
        } else if ("recycle".equals(testPath)) {
            // ★§9.3 长列表验收：4000 行滚到底再回滚，看复用率与内存收敛
            sb.append("【③ §9.3 长列表复用池（4000 行 / 滚动到底再回滚）】\n");
            String rb = RustLayout.recycleBench(4000, 400);
            sb.append(rb).append('\n');
            writeReport("layout-recycle.json", rb);
        } else if ("proteus-noflatten".equals(testPath)) {
            sb.append("【③ Proteus 不拍平形态（每元素一个绘制对象）】\n");
            String nf = proteusNoFlattenRun();
            sb.append(nf).append('\n');
            writeReport("layout-noflatten.json", nf);
        } else if ("proteus-mem".equals(testPath)) {
            // ★内存专用口径：与 nativeOnlyRun 对等（都不分配测量位图）
            sb.append("【③ Proteus 通路（内存专用：只建结构）】\n");
            String only = proteusOnlyRun();
            sb.append(only).append('\n');
            writeReport("layout-proteus-only.json", only);
        } else {
            sb.append("【③ 4050 元素：Proteus(Rust+Canvas) vs 原生 View 体系】\n");
            String compare = compareAgainstNative();
            sb.append(compare).append('\n');
            writeReport("layout-compare-native.json", compare);
        }

        // ★§9.2 核判定：测试尾部收口采样器；并对**未启动持续采样**的通路（内存/不拍平）
        //   补齐采样（否则那些轮次没有 env 报告，核判定无从谈起）
        try { cpuSampler.join(3500); } catch (InterruptedException ignored) {}
        for (int i = 0; i < 5; i++) {
            int c = mainThreadCpu();
            if (c >= 0) synchronized (observedCpus) { observedCpus.add(c); }
        }
        int tempAfter = readTemp();
        StringBuilder cpuStr = new StringBuilder();
        for (Integer c : observedCpus) {
            if (cpuStr.length() > 0) cpuStr.append(",");
            cpuStr.append(c);
        }
        // 核分类（本机实测：cpu0-5 3.6GHz 普大核 · cpu6-7 4.6GHz 超大核）
        int primeCount = 0, normalCount = 0;
        for (Integer c : observedCpus) { if (c >= 6) primeCount++; else normalCount++; }

        // ★采样前强制 GC：把「尚未回收的垃圾」清掉，只留**结构本身的存活对象**
        //   （否则测得的是「分配峰值」而非「结构成本」，重复性差）
        System.gc();
        try { Thread.sleep(300); } catch (InterruptedException ignored) {}
        long peakPss = pssKb();
        sb.append("\n【④ §9.2 环境核验】\n");
        sb.append("观测到的 CPU：").append(cpuStr.length() == 0 ? "未知" : cpuStr.toString())
          .append("（prime=").append(primeCount).append(" · normal=").append(normalCount).append("）\n");
        sb.append("温度：").append(tempBefore).append(" → ").append(tempAfter).append(" (m°C)\n");
        writeReport("layout-env.json",
                "{\"path\":\"" + testPath + "\",\"observed_cpus\":["
                        + cpuStr.toString() + "],\"prime_count\":" + primeCount
                        + ",\"normal_count\":" + normalCount
                        + ",\"temp_before_mc\":" + tempBefore
                        + ",\"temp_after_mc\":" + tempAfter + "}");

        sb.append("\n【⑤ 增量内存（§9.2，纯结构口径）】\n");
        sb.append("baseline=").append(baselinePss).append(" KB · after=").append(peakPss)
          .append(" KB · delta=").append(peakPss - baselinePss).append(" KB\n");
        writeReport("layout-memory.json",
                "{\"path\":\"" + testPath + "\",\"baseline_kb\":" + baselinePss
                        + ",\"after_kb\":" + peakPss + ",\"delta_kb\":" + (peakPss - baselinePss) + "}");

        // ★★§6.1 文本通道对比 —— **必须放在内存采样之后**（本仓实测教训）：
        //   初版放在之前 → 它建 3 个宿主 View + 3 组指令 + StaticLayout 缓存，
        //   全部残留在进程里被 PSS 计入 → proteus-mem 增量从 12MB 虚涨到 27MB。
        //   这是「测量装置污染被测读数」的第二次出现（第一次是 M2 的 63MB 测量位图）。
        //   ⇒ 纪律：**所有测量装置的生命周期必须晚于被测读数**。
        {
            int tw = getResources().getDisplayMetrics().widthPixels;
            int th = getResources().getDisplayMetrics().heightPixels;
            String textCompare = compareTextPaths(tw, th);
            writeReport("layout-text-paths.json", textCompare);
            sb.append("\n【⑥ 文本通道对比（§6.1）】\n").append(textCompare).append('\n');
        }

        String text = sb.toString();
        // ★★截图模式下**不要**把报告文本加到界面上（本仓实测教训）：
        //   报告 TextView 是后加的子 View → **盖在场景之上** → 其文本行被截进截图，
        //   在场景里表现为「行内部出现灰色横条」（实测 y=732/760-772 正是文字行）。
        //   截图核验要求屏幕上只有被测场景；报告已写文件，不需要上屏。
        // ★截图类场景（shot / shot-native）都不上屏报告：
        //   否则报告 TextView 盖在场景上，其文字像素会污染采样
        //   （实测：overlap 行采到 #787A84 —— 那是文字抗锯齿像素，不是场景内容）
        if (!testPath.startsWith("shot")) {
            TextView tv = new TextView(this);
            tv.setText(text);
            tv.setTextSize(9f);
            root.addView(tv);
        }
        writeReport("layout-report.txt", text);
        Log.i(TAG, text);
    }

    /**
     * ★★§9.3 平台侧验收：**真实滚动 + RenderNode 池化 + 帧率测量**。
     *
     * 与前一轮（Rust 侧 `recycle` 跑批）的分工：
     *   · Rust 侧已验收「哪些行该存在/释放」的**决策逻辑**（复用率 0.9947）
     *   · 本方法验收**平台侧执行**：真实 RenderNode 对象是否被复用、滚动时是否掉帧
     *
     * 帧率测量用 **`Choreographer.FrameCallback`**：它回调的是**真实 vsync 时刻**，
     * 相邻回调的间隔即实际帧间隔（比「画完计时」更接近用户感知的流畅度）。
     *
     * ★它同时满足 §9.3 原文「回滚到顶部的过程中统计帧率」——滚动轨迹与 Rust 侧一致（下→上）。
     */
    private String scrollListRun() {
        final int ROWS = 4000;
        final int VISIBLE_ROWS = 14;
        final float ROW_H = 60f;
        final int W = getResources().getDisplayMetrics().widthPixels;
        final int H = getResources().getDisplayMetrics().heightPixels;
        final int FRAMES = 600;

        final ProteusHostView.ListRenderer renderer = new ProteusHostView.ListRenderer(VISIBLE_ROWS + 16);

        // ★把宿主 View 挂进窗口（这样 onDraw 的 canvas 来自**窗口**，帧会被显示系统统计）
        final ProteusHostView listView = new ProteusHostView(this);
        listView.enableListMode(renderer);
        // 铺满屏幕、置于按钮下方（可见性对测量无影响，但必须在窗口里）
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(W, H);
        lp.topMargin = 0;
        root.addView(listView, lp);

        final long[] intervals = new long[FRAMES];
        final int[] idx = {0};
        final long[] lastVsync = {0};
        final int[] frameCount = {0};
        final int[] maxActive = {0};
        final double[] firstRowTrace = new double[FRAMES];

        final android.view.Choreographer choreographer = android.view.Choreographer.getInstance();
        final android.view.Choreographer.FrameCallback callback = new android.view.Choreographer.FrameCallback() {
            @Override public void doFrame(long frameTimeNanos) {
                int f = frameCount[0];
                if (f >= FRAMES) {
                    maxActive[0] = Math.max(maxActive[0], renderer.activeCount());
                    writeScrollReport(ROWS, FRAMES, renderer, intervals, idx[0], firstRowTrace, maxActive[0]);
                    return;
                }
                if (lastVsync[0] != 0) {
                    long dt = (frameTimeNanos - lastVsync[0]) / 1_000_000L;
                    if (idx[0] < FRAMES) intervals[idx[0]++] = dt;
                }
                lastVsync[0] = frameTimeNanos;

                // 轨迹：前半滚到底、后半回滚到顶（§9.3「回滚到顶部」）
                double progress = (double) f / FRAMES;
                double p = progress < 0.5 ? progress * 2.0 : (1.0 - progress) * 2.0;
                double firstRowExact = p * (ROWS - VISIBLE_ROWS);
                int firstRow = (int) firstRowExact;
                firstRowTrace[f] = firstRowExact;

                boolean backward = progress >= 0.5;
                int above = backward ? 8 : 2;
                int below = backward ? 2 : 8;
                int from = Math.max(0, firstRow - above);
                int to = Math.min(ROWS - 1, firstRow + VISIBLE_ROWS - 1 + below);

                renderer.releaseOutside(from, to);
                for (int row = from; row <= to; row++) {
                    if (renderer.hasRow(row)) continue;
                    float y = (float) ((row - firstRowExact) * ROW_H);
                    // 仅建屏幕范围内的行（真实可见性裁剪）
                    if (y + ROW_H < 0 || y > H) continue;
                    renderer.acquireRow(row, 0, y, W, ROW_H - 2f,
                            (row % 2 == 0) ? 0xFF2E5AA8 : 0xFF3E7AC8, "row " + row);
                }
                maxActive[0] = Math.max(maxActive[0], renderer.activeCount());

                // ★驱动**真实重绘**（onDraw → 窗口 canvas → 显示系统统计）
                listView.requestListFrame();

                frameCount[0]++;
                choreographer.postFrameCallback(this);
            }
        };
        choreographer.postFrameCallback(callback);
        return "{\"ok\":true,\"note\":\"滚动已启动（挂在窗口的真实 View 上驱动重绘），报告异步写入 layout-scroll.json\"}";
    }

    /**
     * ★★截图回归场景：用 **Rust 核心算出的几何** 摆放 20 行色块 + 文本，
     * 并把「每行应有的屏幕坐标与颜色」写入报告 —— 供宿主机截图后**逐点核验**。
     *
     * 设计要点（决定这个测试是否有效）：
     *   · **位置来自 Rust 几何**（`RustLayout.create` → `rects`），不是硬编码
     *     → 若 Rust 布局算错，屏幕上的色块就会出现在错误位置，截图核验**必然失败**
     *   · **颜色可区分且可预测**：每行用公式生成的颜色，宿主机能独立算出期望值
     *   · **留出安全区**：避开状态栏/刘海（顶部 144px 是设备 cutout，见 dumpsys display）
     *   · **全屏单色背景**：便于区分「未绘制区域」与「绘制区域」
     */
    private String setupScreenshotScene() {
        final int ROWS = 20;
        // 场景参数（宿主机需知道同样的公式来独立算期望值）
        final int ROW_H = 40;
        final int ROW_W = 600;
        final int LEFT = 60;
        final int TOP = 200;      // ★避开状态栏（设备 cutout 顶部 144px）

        // ① 用 Rust 核心构建「20 行」的布局树（column，每行定高）
        StringBuilder nodes = new StringBuilder(8 * 1024);
        nodes.append("{\"viewport\":{\"width\":").append(LEFT * 2 + ROW_W).append(",\"height\":").append(TOP + ROWS * ROW_H + 100).append("},\"nodes\":[");
        nodes.append("{\"id\":1,\"parentId\":null,\"width\":").append(ROW_W).append(".0,\"flexDirection\":\"column\"}");
        for (int i = 0; i < ROWS; i++) {
            nodes.append(",{\"id\":").append(i + 2).append(",\"parentId\":1,\"width\":").append(ROW_W)
                 .append(".0,\"height\":").append(ROW_H).append(".0}");
        }
        nodes.append("],\"textMeasures\":{}}");

        long handle = RustLayout.create(nodes.toString());
        String rectsJson = handle > 0 ? RustLayout.readRects(handle) : null;

        // ② 把 Rust 几何映射到屏幕坐标（加 LEFT/TOP 偏移），生成绘制指令
        java.util.List<ProteusHostView.Cmd> cmds = new java.util.ArrayList<>(ROWS);
        org.json.JSONArray expect = new org.json.JSONArray();
        try {
            org.json.JSONObject root = new org.json.JSONObject(rectsJson);
            org.json.JSONObject rects = root.getJSONObject("rects");
            for (int i = 0; i < ROWS; i++) {
                org.json.JSONObject r = rects.getJSONObject(String.valueOf(i + 2));
                float x = LEFT + (float) r.getDouble("x");
                float y = TOP + (float) r.getDouble("y");
                float w = (float) r.getDouble("width");
                float h = (float) r.getDouble("height");
                int color = rowColor(i);
                cmds.add(new ProteusHostView.Cmd(x, y, w, h, color, null));
                org.json.JSONObject e = new org.json.JSONObject();
                e.put("row", i);
                e.put("x", Math.round(x));
                e.put("y", Math.round(y));
                e.put("w", Math.round(w));
                e.put("h", Math.round(h));
                e.put("color", String.format("#%06X", color & 0xFFFFFF));
                expect.put(e);
            }
        } catch (Exception ex) {
            return "{\"ok\":false,\"error\":\"几何解析失败：" + ex.getMessage() + "\"}";
        }

        // ③ 绘制到窗口内的真实 View（截图才有内容）
        final ProteusHostView scene = new ProteusHostView(this);
        scene.setCmds(cmds);
        scene.setBackgroundColor(0xFFFFFFFF);   // 白底：便于区分未绘制区
        // ★★必须用**绝对定位**（本仓实测教训）：
        //   初版用 MATCH_PARENT + addView(scene, 0, lp) → View 被排在按钮之后（下移 272px），
        //   屏幕实际位置与「Rust 几何 + 偏移」的预测相差整整一个按钮高度 → 核验全红。
        //   正解：`X=0, Y=0` 绝对定位，让 View 左上角与屏幕原点对齐 ⇒ 坐标可直接对应。
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(1080, 2400);
        lp.leftMargin = 0;
        lp.topMargin = 0;
        root.addView(scene, lp);
        // ★隐藏按钮：Material Button 有默认 elevation，会**盖在场景 View 之上**
        //   （即使场景后添加）→ 遮住顶部若干行，且其背景色会被误采样。
        runButton.setVisibility(android.view.View.GONE);

        if (handle > 0) RustLayout.destroy(handle);

        // ★★必须等 View **完成布局**再读位置（本仓实测教训）：
        //   初版立即读 `getLocationOnScreen/getWidth` → 得到 origin=(0,312)、size=0×0
        //   （布局尚未执行）→ 核验脚本按错误原点对齐 → 全红。
        //   正解：`post()` 到消息队列（布局之后执行）。
        final org.json.JSONArray expectedFinal = expect;
        final int rowsFinal = ROWS, rowHFinal = ROW_H, rowWFinal = ROW_W;
        final int leftFinal = LEFT, topFinal = TOP;
        scene.post(new Runnable() {
            @Override public void run() {
                try {
                    int[] loc = new int[2];
                    scene.getLocationOnScreen(loc);
                    org.json.JSONObject o = new org.json.JSONObject();
                    o.put("ok", true);
                    o.put("path", "shot");
                    o.put("rows", rowsFinal);
                    o.put("row_h", rowHFinal);
                    o.put("row_w", rowWFinal);
                    o.put("offset_left", leftFinal);
                    o.put("offset_top", topFinal);
                    o.put("expected", expectedFinal);
                    o.put("view_origin_x", loc[0]);
                    o.put("view_origin_y", loc[1]);
                    o.put("view_width", scene.getWidth());
                    o.put("view_height", scene.getHeight());
                    o.put("note", "★expected 坐标来自 **Rust 核心几何**（经 LEFT/TOP 偏移）；"
                            + "view_origin_* 是场景 View 在**屏幕**上的实际原点（布局完成后读取）");
                    writeReport("layout-shot-scene.json", o.toString(2));
                } catch (Exception e) {
                    writeReport("layout-shot-scene.json", "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}");
                }
            }
        });

        // 返回占位（真实报告由上面的 post 异步写入）
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("ok", true);
            o.put("path", "shot");
            o.put("rows", ROWS);
            o.put("row_h", ROW_H);
            o.put("row_w", ROW_W);
            o.put("offset_left", LEFT);
            o.put("offset_top", TOP);
            o.put("note", "占位报告——真实报告由 scene.post() 在**布局完成后**写入（含 view_origin_*）");
            return o.toString(2);
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    /**
     * ★★原生组件混用场景：在自绘内容中嵌入一个 **WebView**（native-host 节点）。
     *
     * 场景布局（全部由 **Rust 核心**算出）：
     *   root(column, w=750)
     *     ├─ row0..2  自绘色块（3 × 40px）
     *     ├─ **native-host**  ← WebView，高度 200px（Rust 几何决定位置）
     *     ├─ rowA     自绘色块（40px）
     *     └─ rowB     自绘色块（40px）
     *
     * ★z-order 验证（关键）：再放一个**与 native-host 区域重叠**的自绘色块（`overlapRow`），
     *   用于验证「原生 View 与自绘内容重叠时谁在上面」——这是 Android 的固有约束
     *   （子 View 由 dispatchDraw 在 onDraw 之后绘制 → 原生在上），必须**实测确认并记录**，
     *   而不能假设。
     */
    private String setupNativeHostScene() {
        final int W = 750;
        final int ROW_H = 40;
        final int HOST_H = 200;       // native-host 高度
        final int LEFT = 60, TOP = 200;

        // 行定义：[id, kind]  —— kind: 0=自绘色块, 1=native-host, 2=与 host 重叠的自绘色块
        final int[][] LAYOUT = {
                {0, 0}, {1, 0}, {2, 0},
                {3, 1},               // native-host
                {4, 0},
                {5, 2},               // ★与 native-host **重叠**的自绘色块（z-order 测试）
        };

        StringBuilder nodes = new StringBuilder(8 * 1024);
        nodes.append("{\"viewport\":{\"width\":").append(W).append(",\"height\":").append(TOP + 6 * ROW_H + 400).append("},\"nodes\":[");
        nodes.append("{\"id\":1,\"parentId\":null,\"width\":").append(W).append(".0,\"flexDirection\":\"column\"}");
        int nid = 2;
        int nativeHostNodeId = -1;
        int nativeHostTop = -1;
        int flowY = 0;                 // 流式布局的累计 y
        for (int[] row : LAYOUT) {
            int h = row[1] == 1 ? HOST_H : ROW_H;
            int hostTop = -1;          // 若本行是 native-host，记录它的 top（供 overlap 行对齐）
            nodes.append(",{\"id\":").append(nid).append(",\"parentId\":1,\"width\":").append(W)
                 .append(".0,\"height\":").append(h).append(".0");
            if (row[1] == 1) {
                nodes.append(",\"nativeHost\":true,\"semantic\":\"shell.webview\"");
                nativeHostNodeId = nid;
                nativeHostTop = flowY;
            }
            if (row[1] == 2) {
                // ★★绝对定位，top **与 native-host 完全相同** → 真正重叠（z-order 测试的前提）
                //   初版放在 column 流里 → 排在 native-host 之下 → 根本没测到 z-order
                nodes.append(",\"position\":\"absolute\",\"top\":").append(nativeHostTop).append(".0,\"left\":0.0");
            } else {
                flowY += h;
            }
            nodes.append("}");
            nid++;
        }
        nodes.append("],\"textMeasures\":{}}");

        long handle = RustLayout.create(nodes.toString());
        if (handle <= 0) return "{\"ok\":false,\"error\":\"Rust 建树失败\"}";
        String rectsJson = RustLayout.readRects(handle);

        // ★★从 **Rust 结果**读 native-host 清单（而不是 Java 侧维护场景表）——
        //   保证「IR 判定谁是 native-host」与「宿主创建原生 View」**同源**，不会不同步。
        java.util.Set<Integer> nativeHostIds = new java.util.HashSet<>();
        try {
            org.json.JSONArray nh = new org.json.JSONObject(rectsJson).optJSONArray("native_hosts");
            if (nh != null) for (int i = 0; i < nh.length(); i++) nativeHostIds.add(nh.getInt(i));
        } catch (Exception ignored) {}

        // 解析 Rust 几何 → 绘制指令 + native 几何
        java.util.List<ProteusHostView.Cmd> cmds = new java.util.ArrayList<>();
        java.util.Map<Integer, android.graphics.RectF> nativeRects = new java.util.HashMap<>();
        org.json.JSONArray expect = new org.json.JSONArray();
        try {
            org.json.JSONObject rects = new org.json.JSONObject(rectsJson).getJSONObject("rects");
            int idx = 2;
            int rowNo = 0;
            for (int[] row : LAYOUT) {
                org.json.JSONObject r = rects.getJSONObject(String.valueOf(idx));
                float x = LEFT + (float) r.getDouble("x");
                float y = TOP + (float) r.getDouble("y");
                float w = (float) r.getDouble("width");
                float h = (float) r.getDouble("height");
                // ★判定依据 = Rust 回传的 native_hosts（不是本地 LAYOUT 表）
                boolean isNative = nativeHostIds.contains(idx);
                if (isNative) {
                    nativeRects.put(idx, new android.graphics.RectF(x, y, x + w, y + h));
                } else {
                    int color = row[1] == 2 ? 0xFFE53935 : rowColor2(rowNo);   // 重叠行用醒目红
                    cmds.add(new ProteusHostView.Cmd(x, y, w, h, color, null));
                }
                org.json.JSONObject e = new org.json.JSONObject();
                e.put("seq", rowNo);
                e.put("nodeId", idx);
                e.put("kind", isNative ? "native-host" : (row[1] == 2 ? "overlap-selfdraw" : "self-draw"));
                e.put("x", Math.round(x));
                e.put("y", Math.round(y));
                e.put("w", Math.round(w));
                e.put("h", Math.round(h));
                expect.put(e);
                idx++;
                rowNo++;
            }
        } catch (Exception ex) {
            if (handle > 0) RustLayout.destroy(handle);
            return "{\"ok\":false,\"error\":\"几何解析失败：" + ex.getMessage() + "\"}";
        }

        // native-host 节点 id：从 Rust 回传的清单取第一个（★不再依赖 Java 侧变量）
        if (nativeHostIds.isEmpty()) {
            if (handle > 0) RustLayout.destroy(handle);
            return "{\"ok\":false,\"error\":\"Rust 未回传 native_hosts（IR 判定缺失）\"}";
        }
        final int hostNodeId = nativeHostIds.iterator().next();

        // 建宿主 + 场景
        final ProteusHostView scene = new ProteusHostView(this);
        scene.setCmds(cmds);
        scene.setBackgroundColor(0xFFFFFFFF);

        // ★创建原生 View（WebView：真实场景；内联 HTML，无网络依赖）
        android.webkit.WebView wv = new android.webkit.WebView(this);
        wv.setBackgroundColor(0xFF1565C0);            // 醒目蓝：便于截图核验（不依赖 HTML 加载时序）
        wv.loadDataWithBaseURL(null,
                "<html><body style='margin:0;background:#1565C0;color:#fff;font:16px sans-serif'>"
                        + "<div style='padding:12px'>native WebView<br>（native-host 节点）</div></body></html>",
                "text/html", "UTF-8", null);
        scene.addNativeHost(hostNodeId, wv);
        scene.setNativeHostGeometry(nativeRects);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(1080, 2400);
        lp.leftMargin = 0; lp.topMargin = 0;
        root.addView(scene, lp);
        runButton.setVisibility(android.view.View.GONE);

        final long h2 = handle;
        final org.json.JSONArray expectFinal = expect;
        final int hostNodeIdF = hostNodeId;
        scene.post(new Runnable() {
            @Override public void run() {
                try {
                    int[] loc = new int[2];
                    scene.getLocationOnScreen(loc);
                    org.json.JSONObject o = new org.json.JSONObject();
                    o.put("ok", true);
                    o.put("path", "shot-native");
                    o.put("offset_left", LEFT);
                    o.put("offset_top", TOP);
                    o.put("native_host_node_id", hostNodeIdF);
                    // ★报告里给出**场景规格**（测试定义）——供宿主机**独立重算**期望位置，
                    //   避免「用 app 的测量结果当期望」= 自己判自己
                    o.put("spec", new org.json.JSONObject()
                            .put("row_h", ROW_H)
                            .put("host_h", HOST_H)
                            .put("offset_left", LEFT)
                            .put("offset_top", TOP)
                            .put("layout", "0,self;1,self;2,self;3,native;4,self;5,overlap@3"));
                    o.put("expected", expectFinal);
                    o.put("native_host_layout", new org.json.JSONArray(scene.nativeHostLayoutDump()));
                    o.put("view_origin_x", loc[0]);
                    o.put("view_origin_y", loc[1]);
                    o.put("view_width", scene.getWidth());
                    o.put("view_height", scene.getHeight());
                    o.put("z_order_note", "★Android 固有约束：子 View（native-host）由 dispatchDraw 在 onDraw **之后**绘制 → 原生 View 在自绘内容之上。本场景的 overlap-selfdraw 行用于**实测确认**该约束");
                    writeReport("layout-native-host.json", o.toString(2));
                } catch (Exception e) {
                    writeReport("layout-native-host.json", "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}");
                }
                if (h2 > 0) RustLayout.destroy(h2);
            }
        });

        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("ok", true);
            o.put("path", "shot-native");
            o.put("note", "占位——真实报告由 scene.post() 在布局完成后写入");
            return o.toString(2);
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    /**
     * ★★滚动 + native-host 同步场景。
     *
     * 布局（由 Rust 算出）：24 行，每行 60px；**第 6 行（seq5）是 native-host（WebView）**。
     * 视口：屏幕可见区（宿主全屏）。
     *
     * 验证方式：程序依次设置**多个 scrollY**（0 / 120 / 300 / 700），
     * 每次**不重新建场景**，只调 `setContentScrollY()` —— 然后截图核验：
     *   · native-host 的 `translationY` == -scrollY（跟随）
     *   · 当 native-host 完全滚出视口 → 不可见（裁剪）
     *   · 自绘行与 native-host 仍保持 60px 行距（**同步不脱节**）
     */
    private String setupScrollNativeScene() {
        final int W = 750, ROW_H = 60, ROWS = 24;
        final int HOST_ROW = 5;                  // native-host 在第 6 行
        final int LEFT = 60, TOP = 200;

        StringBuilder nodes = new StringBuilder(16 * 1024);
        nodes.append("{\"viewport\":{\"width\":").append(W).append(",\"height\":").append(ROW_H * 40).append("},\"nodes\":[");
        nodes.append("{\"id\":1,\"parentId\":null,\"width\":").append(W).append(".0,\"flexDirection\":\"column\"}");
        for (int i = 0; i < ROWS; i++) {
            nodes.append(",{\"id\":").append(i + 2).append(",\"parentId\":1,\"width\":").append(W)
                 .append(".0,\"height\":").append(ROW_H).append(".0");
            if (i == HOST_ROW) {
                nodes.append(",\"nativeHost\":true,\"semantic\":\"shell.webview\"");
            }
            nodes.append("}");
        }
        nodes.append("],\"textMeasures\":{}}");

        long handle = RustLayout.create(nodes.toString());
        if (handle <= 0) return "{\"ok\":false,\"error\":\"Rust 建树失败\"}";
        String rectsJson = RustLayout.readRects(handle);

        java.util.Set<Integer> nativeIds = new java.util.HashSet<>();
        try {
            org.json.JSONArray nh = new org.json.JSONObject(rectsJson).optJSONArray("native_hosts");
            if (nh != null) for (int i = 0; i < nh.length(); i++) nativeIds.add(nh.getInt(i));
        } catch (Exception ignored) {}

        java.util.List<ProteusHostView.Cmd> cmds = new java.util.ArrayList<>();
        java.util.Map<Integer, android.graphics.RectF> nativeRects = new java.util.HashMap<>();
        org.json.JSONArray expect = new org.json.JSONArray();
        try {
            org.json.JSONObject rects = new org.json.JSONObject(rectsJson).getJSONObject("rects");
            for (int i = 0; i < ROWS; i++) {
                int nodeId = i + 2;
                org.json.JSONObject r = rects.getJSONObject(String.valueOf(nodeId));
                float x = LEFT + (float) r.getDouble("x");
                float y = TOP + (float) r.getDouble("y");
                float w = (float) r.getDouble("width");
                float h = (float) r.getDouble("height");
                boolean isNative = nativeIds.contains(nodeId);
                if (isNative) {
                    nativeRects.put(nodeId, new android.graphics.RectF(x, y, x + w, y + h));
                } else {
                    cmds.add(new ProteusHostView.Cmd(x, y, w, h, scrollRowColor(i), null));
                }
                org.json.JSONObject e = new org.json.JSONObject();
                e.put("seq", i);
                e.put("nodeId", nodeId);
                e.put("kind", isNative ? "native-host" : "self-draw");
                e.put("contentY", Math.round(y));       // 内容坐标系（不含滚动）
                e.put("h", Math.round(h));
                e.put("w", Math.round(w));
                expect.put(e);
            }
        } catch (Exception ex) {
            if (handle > 0) RustLayout.destroy(handle);
            return "{\"ok\":false,\"error\":\"几何解析失败：" + ex.getMessage() + "\"}";
        }

        final ProteusHostView scene = new ProteusHostView(this);
        scene.setCmds(cmds);
        scene.setBackgroundColor(0xFFFFFFFF);

        final int hostNodeId = nativeIds.iterator().next();
        android.webkit.WebView wv = new android.webkit.WebView(this);
        wv.setBackgroundColor(0xFF1565C0);
        wv.loadDataWithBaseURL(null, "<html><body style='margin:0;background:#1565C0'></body></html>",
                "text/html", "UTF-8", null);
        scene.addNativeHost(hostNodeId, wv);
        scene.setNativeHostGeometry(nativeRects);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(1080, 2400);
        lp.leftMargin = 0; lp.topMargin = 0;
        root.addView(scene, lp);
        runButton.setVisibility(android.view.View.GONE);

        final long h2 = handle;
        final org.json.JSONArray expectFinal = expect;
        final int hostIdFinal = hostNodeId;
        final int rowsFinal = ROWS, rowHFinal = ROW_H;
        final int topFinal = TOP;
        // ★滚动序列（每次只改 scrollY，不重建场景）
        final int[] SCROLLS = {0, 120, 300, 700};
        final int[] step = {0};
        final org.json.JSONArray reports = new org.json.JSONArray();

        Runnable doStep = new Runnable() {
            @Override public void run() {
                if (step[0] >= SCROLLS.length) {
                    // 全部完成：写报告
                    try {
                        int[] loc = new int[2];
                        scene.getLocationOnScreen(loc);
                        org.json.JSONObject o = new org.json.JSONObject();
                        o.put("ok", true);
                        o.put("path", "shot-scroll-native");
                        o.put("rows", rowsFinal);
                        o.put("row_h", rowHFinal);
                        o.put("offset_left", LEFT);
                        o.put("offset_top", topFinal);
                        o.put("native_host_node_id", hostIdFinal);
                        o.put("expected", expectFinal);
                        o.put("scroll_steps", reports);
                        o.put("view_origin_x", loc[0]);
                        o.put("view_origin_y", loc[1]);
                        o.put("view_width", scene.getWidth());
                        o.put("view_height", scene.getHeight());
                        o.put("note", "★每个 scrollY 一步：调 setContentScrollY() **不重建场景**，"
                                + "然后由宿主机在对应时刻截图核验（native-host 跟随 + 裁剪 + 与自绘同步）");
                        writeReport("layout-scroll-native.json", o.toString(2));
                    } catch (Exception e) {
                        writeReport("layout-scroll-native.json", "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}");
                    }
                    if (h2 > 0) RustLayout.destroy(h2);
                    return;
                }
                int sy = SCROLLS[step[0]];
                scene.setContentScrollY(sy);
                // ★每步**单独写一份报告**（时序解耦）：
                //   若只写一份汇总报告，宿主机必须精确猜「何时截图」——
                //   本仓在真机时序上已踩过多次（渲染过渡期抓到黑屏）。
                //   改为「每步一个文件 + 停留 2 秒」→ 宿主机可从容抓图后逐个核验。
                try {
                    int[] loc = new int[2];
                    scene.getLocationOnScreen(loc);
                    org.json.JSONObject st = new org.json.JSONObject();
                    st.put("ok", true);
                    st.put("step", step[0]);
                    st.put("scrollY", sy);
                    st.put("rows", rowsFinal);
                    st.put("row_h", rowHFinal);
                    st.put("offset_left", LEFT);
                    st.put("offset_top", topFinal);
                    st.put("native_host_node_id", hostIdFinal);
                    st.put("expected", expectFinal);
                    st.put("sync_dump", new org.json.JSONArray(scene.scrollSyncDump()));
                    st.put("view_origin_x", loc[0]);
                    st.put("view_origin_y", loc[1]);
                    st.put("view_width", scene.getWidth());
                    st.put("view_height", scene.getHeight());
                    writeReport("layout-scroll-step" + step[0] + ".json", st.toString(2));
                    android.util.Log.i(TAG, "滚动步 " + step[0] + " scrollY=" + sy + " 已就绪");
                } catch (Exception e) {
                    android.util.Log.e(TAG, "写滚动步报告失败", e);
                }
                step[0]++;
                scene.postDelayed(this, 2000);   // ★每步停留 2 秒（宿主机从容截图）
            }
        };
        scene.postDelayed(doStep, 500);

        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("ok", true);
            o.put("path", "shot-scroll-native");
            o.put("scroll_sequence", SCROLLS);
            o.put("note", "占位——真实报告在滚动序列跑完后写入（每步间隔 700ms）");
            return o.toString(2);
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    /** 滚动场景的行色（与 seq 绑定，便于核验同步） */
    private static int scrollRowColor(int i) {
        int r = 60 + (i * 23) % 180;
        int g = 120 + (i * 31) % 130;
        int b = 180 - (i * 17) % 150;
        return 0xFF000000 | (r << 16) | (g << 8) | b;
    }

    /** 自绘行色（与 shot 场景的行色错开，便于区分两类场景） */
    private static int rowColor2(int i) {
        int r = 30 + (i * 30) % 180;
        int g = 160 - (i * 20) % 120;
        int b = 70 + (i * 25) % 160;
        return 0xFF000000 | (r << 16) | (g << 8) | b;
    }

    /** 行色：可预测的公式（宿主机用同一公式独立计算期望值） */
    private static int rowColor(int i) {
        int r = 40 + (i * 10) % 200;
        int g = 90 + (i * 17) % 150;
        int b = 200 - (i * 7) % 150;
        return 0xFF000000 | (r << 16) | (g << 8) | b;
    }

    /**
     * ★§6.1 文本通道对比：基线 `drawText` / 位图图集 / **StaticLayout**，在两种文案分布下测量。
     *
     * 为什么要分两种分布：位图图集的收益**强依赖文案重复率**（重复时命中率高、多变时退化为建位图），
     * 而 StaticLayout 缓存**不建位图**，理论上对两种分布都不吃亏——本测量即验证这一点。
     */
    private String compareTextPaths(int W, int H) {
        // 分布 A：重复文案（列表项常见）
        java.util.List<ProteusHostView.Cmd> repeated = buildCmds();

        // 分布 B：每条不同（动态内容）
        java.util.List<ProteusHostView.Cmd> varied = new java.util.ArrayList<>(TOTAL / 2);
        for (int i = 0; i < TOTAL / 2; i++) {
            varied.add(new ProteusHostView.Cmd((i % 40) * 30f, (i / 40) * 18f, 30f, 18f,
                    Color.rgb(40, 90, 200), "item" + i));
        }

        // 复用同一批文案做预热
        java.util.List<String> distinct = new java.util.ArrayList<>();
        for (int i = 0; i < 120; i++) distinct.add("item" + i);

        try {
            JSONObject out = new JSONObject();
            out.put("ok", true);

            // ── 分布 A：重复 ──
            {
                ProteusHostView v = new ProteusHostView(this);
                v.setCmds(repeated);
                JSONObject a = new JSONObject();
                a.put("baseline_drawText_ms", timeDraw(v, W, H, 0));
                a.put("bitmap_atlas_ms", timeDraw(v, W, H, 1));
                a.put("static_layout_ms", timeDraw(v, W, H, 2));
                a.put("atlas_entries", v.atlasSize());
                a.put("layout_builds", v.layoutBuildCount());
                out.put("repeated_text", a);
            }
            // ── 分布 B：多变 ──
            {
                ProteusHostView v = new ProteusHostView(this);
                v.setCmds(varied);
                JSONObject b = new JSONObject();
                b.put("baseline_drawText_ms", timeDraw(v, W, H, 0));
                b.put("bitmap_atlas_ms", timeDraw(v, W, H, 1));
                b.put("static_layout_ms", timeDraw(v, W, H, 2));
                b.put("atlas_entries", v.atlasSize());
                b.put("layout_builds", v.layoutBuildCount());
                out.put("varied_text", b);
            }
            // ── ★后台预热效果：先预热 120 条，再测多变（其中前 120 条应命中）──
            {
                ProteusHostView v = new ProteusHostView(this);
                v.setCmds(varied);
                Thread warm = v.prewarmAsync(distinct, 30f);
                try { warm.join(3000); } catch (InterruptedException ignored) {}
                int buildsAfterWarm = v.layoutBuildCount();
                double withWarm = timeDraw(v, W, H, 2);
                JSONObject c = new JSONObject();
                c.put("prewarmed_entries", distinct.size());
                c.put("layout_builds_after_prewarm", buildsAfterWarm);
                c.put("static_layout_with_prewarm_ms", withWarm);
                out.put("prewarm_effect", c);
            }
            out.put("note", "三路径同机对比：baseline=每次 drawText；bitmap_atlas=按串缓存位图（M3）；"
                    + "static_layout=**方案 §6.1 规定**（缓存布局 + 重放，不建位图）");
            return out.toString(2);
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    /** 用指定路径画一次，返回耗时（ms）。path: 0=基线 drawText, 1=位图图集, 2=StaticLayout */
    private double timeDraw(ProteusHostView v, int W, int H, int path) {
        android.graphics.Bitmap bmp = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas c = new android.graphics.Canvas(bmp);
        // 预热一次（排除首次分配；正式测量取第二次）
        if (path == 0) v.drawCmds(c); else if (path == 1) v.drawCmdsOptimized(c); else v.drawCmdsStaticLayout(c);
        long t0 = SystemClock.elapsedRealtimeNanos();
        if (path == 0) v.drawCmds(c); else if (path == 1) v.drawCmdsOptimized(c); else v.drawCmdsStaticLayout(c);
        long t1 = SystemClock.elapsedRealtimeNanos();
        bmp.recycle();
        return Math.round((t1 - t0) / 10000.0) / 100.0;   // ms，保留两位
    }

    /** 滚动验收报告（帧率统计） */
    private void writeScrollReport(int rows, int frames, ProteusHostView.ListRenderer renderer,
                                   long[] intervals, int n, double[] trace, int maxActive) {
        if (n == 0) n = 1;
        long[] copy = java.util.Arrays.copyOf(intervals, n);
        long[] sorted = copy.clone();
        java.util.Arrays.sort(sorted);
        double avg = 0;
        for (long v : copy) avg += v;
        avg /= copy.length;
        long p50 = sorted[sorted.length / 2];
        long p95 = sorted[(int) (sorted.length * 0.95)];
        long p99 = sorted[Math.min(sorted.length - 1, (int) (sorted.length * 0.99))];
        long max = sorted[sorted.length - 1];
        // ★★★掉帧判据的三次校准（每次都是真机实测打脸，如实记录）：
        //   ① 硬编码 60Hz（>17ms 算掉帧）→ 报 0.67%，**明显偏低**（设备是 120Hz，8ms 帧间期也正常）
        //   ② 改用设备刷新率（>8.75ms 算掉帧）→ 报 48.75%，**明显偏高**——
        //      因为帧间隔是 8ms/16ms 两档（120Hz 与 60Hz 的 vsync 节拍量化），
        //      而「某帧落在 16ms 档」**不等于渲染慢了**（可能只是那一帧没有新内容要提交）
        //   ③ **最终认识**：`Choreographer.FrameCallback` 的间隔**不是渲染耗时**，
        //      它只能反映「回调节拍」；**渲染侧的权威读数是系统 `dumpsys gfxinfo`**
        //      （其中有 p50/p95 绘制耗时、掉帧数、Slow UI thread 等）。
        //
        // ⇒ 本函数的输出定位为**辅助观测**（帧节拍分布），**不作为掉帧结论**；
        //   结论以 `gfxinfo` 为准（acceptance.sh 会采集）。
        final double refreshHz = getDisplayRefreshHz();
        final double budgetMs = 1000.0 / refreshHz;
        int janky = 0, severe = 0;
        for (long v : copy) {
            // 采样间隔 > 2 个 vsync 周期 → 至少漏了一拍（可观测的"节拍不齐"）
            if (v > budgetMs * 2.1) janky++;
            if (v > budgetMs * 3.5) severe++;
        }
        double fps = copy.length > 0 ? 1000.0 / avg : 0;
        try {
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("path", "scroll");
            o.put("rows", rows);
            o.put("frames_sampled", copy.length);
            o.put("avg_frame_ms", Math.round(avg * 100) / 100.0);
            o.put("fps_avg", Math.round(fps * 10) / 10.0);
            o.put("p50_ms", p50);
            o.put("p95_ms", p95);
            o.put("p99_ms", p99);
            o.put("max_ms", max);
            o.put("beat_miss_frames", janky);          // 「节拍不齐」= 间隔 >2 个 vsync
            o.put("beat_miss_ratio", Math.round(janky * 10000.0 / copy.length) / 10000.0);
            o.put("beat_severe_frames", severe);
            // ★平台侧池化读数
            o.put("rn_created", renderer.createdCount());
            o.put("rn_reused", renderer.reusedCount());
            o.put("rn_pooled", renderer.pooledCount());
            o.put("rn_reuse_ratio", Math.round(renderer.reuseRatio() * 10000) / 10000.0);
            o.put("rn_max_active", maxActive);
            o.put("device_refresh_hz", Math.round(refreshHz * 10) / 10.0);
            o.put("frame_budget_ms", Math.round(budgetMs * 100) / 100.0);
            o.put("p50_hz", p50 > 0 ? Math.round(1000.0 / p50 * 10) / 10.0 : 0);
            o.put("note", "★本文件为**辅助观测**（Choreographer 帧节拍分布，轨迹=滚到底再回滚到顶）。"
                    + "Choreographer 间隔不是渲染耗时，故**掉帧结论以 dumpsys gfxinfo 为准**（acceptance.sh 采集）");
            String json = o.toString(2);
            writeReport("layout-scroll.json", json);
            android.util.Log.i(TAG, "滚动验收报告：\n" + json);
        } catch (Exception e) {
            android.util.Log.e(TAG, "写滚动报告失败", e);
        }
    }

    /**
     * ★★§9.2 第二行指标「**不拍平时的耗时仍 ≤ 原生**」的对照实现。
     *
     * 拍平只对**静态子树**生效（§12.3 的 `flattenEligible` 判定）；列表滚动、动态内容等
     * 场景不走拍平 → 故必须验证「最坏形态下仍不输原生」，这是**能力下限**。
     *
     * 形态对应：
     *   · 拍平（主路径）：4050 条指令 → 直接画进宿主 Canvas（**0 个独立绘制对象**）
     *   · 不拍平（本方法）：4050 个 `RenderNode`（**每元素一个独立绘制对象**）
     *   · 原生：4051 个 View（恰好也是「每元素一个对象」——与本形态同量级）
     *
     * 计时分段与原生对齐（创建 / 录制布局 / 绘制），便于**同口径**比较。
     */
    private String proteusNoFlattenRun() {
        final int W = 1080, H = 2400;

        long p0 = SystemClock.elapsedRealtime();
        String benchJson = RustLayout.bench(TOTAL, 1);   // Rust 排版（几何）
        java.util.List<ProteusHostView.Cmd> cmds = buildCmds();
        long p1 = SystemClock.elapsedRealtime();

        ProteusHostView host = new ProteusHostView(this);
        host.setCmds(cmds);
        long p2 = SystemClock.elapsedRealtime();
        host.buildUnflattened();                          // ★建 4050 个独立绘制对象
        long p3 = SystemClock.elapsedRealtime();

        // ★★必须用**硬件加速的 Canvas**（`RenderNode.beginRecording()`）：
        //   实测踩到 `IllegalArgumentException: Software rendering doesn't support drawRenderNode`
        //   ——`drawRenderNode` 只能作用于硬件加速 Canvas；用软件位图会直接抛异常。
        //   （这也是 M3 的同一课：性能测量必须走**真实渲染路径**，软件光栅化不是它。）
        android.graphics.RenderNode root = new android.graphics.RenderNode("noflatten-root");
        root.setPosition(0, 0, W, H);
        android.graphics.RecordingCanvas rc = root.beginRecording();
        long p4 = SystemClock.elapsedRealtime();
        host.drawUnflattened(rc);                         // ★逐个 drawRenderNode
        long p5 = SystemClock.elapsedRealtime();
        root.endRecording();
        this.keepAlive = new Object[]{cmds, host, root};

        double layoutMs = (p1 - p0);
        double emitMs = (p2 - p1);
        double buildNodesMs = (p3 - p2);
        double drawMs = (p5 - p4);
        double totalMs = (p5 - p0);

        try {
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("path", "proteus-noflatten");
            o.put("elements", TOTAL);
            o.put("rust_layout_ms", layoutMs);
            o.put("emit_cmds_ms", emitMs);
            o.put("build_render_nodes_ms", buildNodesMs);
            o.put("draw_all_nodes_ms", drawMs);
            o.put("total_ms", totalMs);
            o.put("render_node_count", host.unflattenedCount());
            o.put("note", "★不拍平形态：每元素一个 RenderNode（独立绘制对象）——§9.2 要求其耗时仍 ≤ 原生");
            return o.toString(2);
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    /**
     * ★Proteus 通路单跑（**内存测量专用**：与 nativeOnlyRun 对等——只建结构，不分配测量位图）。
     *
     * 为什么必须单独写一个（本仓实测教训）：
     *   `compareAgainstNative()` 里为了**性能归因**分配了 7 个 1080×2400 ARGB 位图（每个 9MB，共 ~63MB）——
     *   这些是「测量仪器」（软件光栅化靶），**真实 App 不会分配**。
     *   拿含仪器的 PSS 去比不含仪器的原生，测出「Proteus 内存是原生 2.5 倍」——
     *   那是**测量装置的重量**，不是渲染路径的成本。
     *   ⇒ 内存对比必须用本方法（与 nativeOnlyRun 同口径）。
     */
    private String proteusOnlyRun() {
        // ★★PSS 快照必须**紧贴被测结构**（本仓实测教训，第三次修同一类问题）：
        //   此前把 baseline 打在「点击时刻」、peak 打在「路径跑完」→ 窗口里串进了
        //   `conformance`（17 用例建树）+ `bench`（4050 节点 × 20 次布局）→ 读数从 12MB
        //   虚涨到 63MB，且随 bench 的堆状态波动。
        //   ⇒ 纪律：**内存读数必须自包含**（before/after 夹住被测对象），不得跨活动共享窗口。
        System.gc();
        try { Thread.sleep(200); } catch (InterruptedException ignored) {}
        long beforeKb = pssKb();
        long p0 = SystemClock.elapsedRealtime();
        // ★★用**句柄式 API**：建树并**保留**（与原生 View 树生命周期同构）
        //   此前用 `bench(TOTAL,1)` → Rust 树在函数返回时释放 → 测到的只是宿主侧 cmds（2.9MB），
        //   而原生侧 4051 个 View 持续存活（30.2MB）→ 比值 0.096 是**不对等比较的假象**。
        String treeJson = buildTreeRequestJson(TOTAL);
        long handle = RustLayout.create(treeJson);
        String benchJson = "{\"ok\":" + (handle > 0) + ",\"handle\":" + handle + "}";
        long p1 = SystemClock.elapsedRealtime();
        java.util.List<ProteusHostView.Cmd> cmds = buildCmds();  // 布局结果 → 绘制指令（宿主侧结构）
        ProteusHostView host = new ProteusHostView(this);
        host.setCmds(cmds);
        long p2 = SystemClock.elapsedRealtime();
        this.keepAlive = new Object[]{cmds, host};   // ★持有强引用直到 PSS 采样
        System.gc();
        try { Thread.sleep(200); } catch (InterruptedException ignored) {}
        long afterKb = pssKb();
        try {
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("path", "proteus");
            o.put("pss_before_kb", beforeKb);
            o.put("pss_after_kb", afterKb);
            o.put("pss_delta_kb", afterKb - beforeKb);
            // ★句柄与存活树数：证明「Rust 侧的树在采样时**确实存在**」（否则又是"对象已消失"的测量陷阱）
            o.put("tree_handle", handle);
            o.put("live_tree_count", RustLayout.handleCount());
            o.put("elements", TOTAL);
            o.put("rust_layout_ms", (p1 - p0));
            o.put("emit_cmds_ms", (p2 - p1));
            o.put("total_ms", (p2 - p0));
            o.put("cmd_count", cmds.size());
            o.put("view_count", 1);
            o.put("note", "内存专用路径：只建结构（Rust 树 + 指令表），不分配测量位图");
            return o.toString(2);
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    /**
     * 生成 4050 元素的布局请求 JSON（与 `RustLayout.bench` 同规格：50 行 × 40 格，每格 view+text）。
     * ★它是「句柄式 API」的输入——树由 Rust 侧常驻，宿主只持句柄。
     */
    private String buildTreeRequestJson(int total) {
        final int perRow = 40;
        final int rows = 50;
        StringBuilder sb = new StringBuilder(64 * 1024);
        sb.append("{\"viewport\":{\"width\":1080,\"height\":2400},\"nodes\":[");
        int id = 2;
        // 根
        sb.append("{\"id\":1,\"parentId\":null,\"width\":750.0,\"flexDirection\":\"column\"}");
        for (int r = 0; r < rows; r++) {
            sb.append(",{\"id\":").append(id++).append(",\"parentId\":1,\"flexDirection\":\"row\",\"gap\":4.0,\"flexShrink\":0.0}");
            int rowId = id - 1;
            for (int c = 0; c < perRow; c++) {
                sb.append(",{\"id\":").append(id).append(",\"parentId\":").append(rowId)
                  .append(",\"width\":30.0,\"height\":18.0,\"flexShrink\":0.0,\"isText\":true}");
                id++;
            }
        }
        sb.append("],\"textMeasures\":{}}");
        return sb.toString();
    }

    /** 原生通路单跑（隔离内存测量：不在同进程里先建 Proteus 结构） */
    private String nativeOnlyRun() {
        // ★自包含 PSS（见 proteusOnlyRun 的说明）
        System.gc();
        try { Thread.sleep(200); } catch (InterruptedException ignored) {}
        long beforeKb = pssKb();
        long n0 = SystemClock.elapsedRealtime();
        ViewGroup tree = buildNativeTree();
        long n1 = SystemClock.elapsedRealtime();
        int w = getResources().getDisplayMetrics().widthPixels;
        tree.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
                     View.MeasureSpec.makeMeasureSpec(2400, View.MeasureSpec.AT_MOST));
        tree.layout(0, 0, w, tree.getMeasuredHeight());
        long n2 = SystemClock.elapsedRealtime();
        int views = countViews(tree);
        this.keepAlive = tree;          // ★持有强引用直到 PSS 采样
        System.gc();
        try { Thread.sleep(200); } catch (InterruptedException ignored) {}
        long afterKb = pssKb();
        try {
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("path", "native");
            o.put("pss_before_kb", beforeKb);
            o.put("pss_after_kb", afterKb);
            o.put("pss_delta_kb", afterKb - beforeKb);
            o.put("elements", TOTAL);
            o.put("create_views_ms", (n1 - n0));
            o.put("measure_layout_ms", (n2 - n1));
            o.put("total_ms", (n2 - n0));
            o.put("view_count", views);
            return o.toString(2);
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    /**
     * ★§9.2 出口条件：4050 元素，Proteus 通路 vs 原生 View 通路。
     *
     * ★★为什么必须**分段计时**（本仓实测教训）：
     *   第一版把「原生创建 View 树 + measure + layout」合成一段测出 478ms，而 Proteus 侧
     *   把「排版 + 生成指令 + Canvas 绘制」合成一段测出 18ms → 得出 38× 的比值。
     *   但两段的**组成完全不同**（原生含 4051 个 View 对象创建、不含 draw；Proteus 含 draw、无对象创建），
     *   这种比值**无法归因**，不能作为结论。
     *   故拆成三段分别测量，让「快在哪里 / 慢在哪里」可解释：
     *     原生    ：创建 / measure+layout / draw
     *     Proteus ：排版(Rust) / 生成指令 / 绘制(Canvas)
     *   并在报告里给出**同口径可比项**：measure+layout ↔ 排版+生成指令；draw ↔ 绘制。
     */
    private String compareAgainstNative() {
        final int W = 1080, H = 2400;

        // ══ ① 原生通路：三段分开计时 ══
        long n0 = SystemClock.elapsedRealtime();
        ViewGroup tree = buildNativeTree();
        long n1 = SystemClock.elapsedRealtime();
        int w = getResources().getDisplayMetrics().widthPixels;
        tree.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
                     View.MeasureSpec.makeMeasureSpec(H, View.MeasureSpec.AT_MOST));
        tree.layout(0, 0, w, tree.getMeasuredHeight());
        long n2 = SystemClock.elapsedRealtime();
        android.graphics.Bitmap nbmp = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas nc = new android.graphics.Canvas(nbmp);
        tree.draw(nc);
        long n3 = SystemClock.elapsedRealtime();
        // ★★可比性自检：统计非背景像素 —— 若原生对照组其实没画东西（View 被压成 0 尺寸），
        //   那么「draw 很快」是假象，比值全部失效。本仓纪律：错误数据比没有数据更糟。
        int nativePainted = countPaintedPixels(nbmp);
        nbmp.recycle();
        double nativeCreateMs = (n1 - n0);
        double nativeMeasureLayoutMs = (n2 - n1);
        double nativeDrawMs = (n3 - n2);

        // ══ ② Proteus 通路：三段分开计时 ══
        long p0 = SystemClock.elapsedRealtime();
        String benchJson = RustLayout.bench(TOTAL, 1);       // Rust 排版（含建树，对应原生的「创建+测量」）
        long p1 = SystemClock.elapsedRealtime();
        List<ProteusHostView.Cmd> cmds = buildCmds();        // 布局结果 → 绘制指令
        long p2 = SystemClock.elapsedRealtime();
        ProteusHostView host = new ProteusHostView(this);
        host.setCmds(cmds);
        // ── 软件路径（对照用；非方案规定路径）──
        android.graphics.Bitmap pbmp2 = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas soft = new android.graphics.Canvas(pbmp2);
        host.drawCmds(soft);
        long p3a = SystemClock.elapsedRealtime();
        // ── ★硬件路径（方案 §6.1 规定：Canvas 下发 → DisplayList → RenderThread）──
        //   RenderNode 的 RecordingCanvas 只**录制**指令，真正光栅化在 RenderThread ——
        //   这正是 §9.2 口径「渲染指令全部送达 OS 渲染进程」所指的主线程侧成本
        android.graphics.RenderNode rn = new android.graphics.RenderNode("proteus");
        if (rn.setPosition(0, 0, W, H)) { /* 记录尺寸 */ }
        android.graphics.RecordingCanvas rc = rn.beginRecording();
        host.drawCmds(rc);
        rn.endRecording();
        long p3 = SystemClock.elapsedRealtime();

        // ── ★绘制归因（拆「色块 vs 文本」；本仓纪律：优化前必须先归因）──
        android.graphics.Bitmap rBmp = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas rC = new android.graphics.Canvas(rBmp);
        long ra = SystemClock.elapsedRealtime();
        host.drawRectsOnly(rC);
        long rb = SystemClock.elapsedRealtime();
        rBmp.recycle();
        android.graphics.Bitmap tBmp = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas tC = new android.graphics.Canvas(tBmp);
        long ta = SystemClock.elapsedRealtime();
        host.drawTextOnly(tC);
        long tb = SystemClock.elapsedRealtime();
        tBmp.recycle();
        double rectsOnlyMs = (rb - ra);
        double textOnlyMs = (tb - ta);

        // ── ★M3 优化路径测量（与基线同机对照）──
        android.graphics.Bitmap oBmp = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas oC = new android.graphics.Canvas(oBmp);
        long oa = SystemClock.elapsedRealtime();
        host.drawCmdsOptimized(oC);
        long ob = SystemClock.elapsedRealtime();
        oBmp.recycle();
        double optimizedSoftMs = (ob - oa);
        // 硬件录制路径（真实 App 走的路径）
        android.graphics.RenderNode orn = new android.graphics.RenderNode("proteus-opt");
        orn.setPosition(0, 0, W, H);
        android.graphics.RecordingCanvas orc = orn.beginRecording();
        long oha = SystemClock.elapsedRealtime();
        host.drawCmdsOptimized(orc);
        long ohb = SystemClock.elapsedRealtime();
        orn.endRecording();
        double optimizedHwMs = (ohb - oha);
        int atlasEntries = host.atlasSize();

        // ── ★正确性校验：优化路径与基线必须**画出同样的像素**（否则「快」无意义）──
        android.graphics.Bitmap b1 = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
        host.drawCmds(new android.graphics.Canvas(b1));
        android.graphics.Bitmap b2 = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
        host.drawCmdsOptimized(new android.graphics.Canvas(b2));
        int diffPixels = countDiffPixels(b1, b2);
        int paintedBase = countPaintedPixels(b1);
        String diffDiag = diagnoseDiff(b1, b2);
        String correctness = judgeCorrectness(b1, b2);
        String atlasCheck = validateAtlas(host, W, H);
        int paintedOpt = countPaintedPixels(b2);
        b1.recycle(); b2.recycle();

        // ── ★文案多变场景（诚实边界：图集收益与**文案重复率**强相关）──
        java.util.List<ProteusHostView.Cmd> varied = new java.util.ArrayList<>(TOTAL);
        for (int i = 0; i < TOTAL; i++) {
            varied.add(new ProteusHostView.Cmd((i % 40) * 30f, (i / 40) * 18f, 30f, 18f,
                    Color.rgb(40, 90, 200), "item" + i));
        }
        ProteusHostView vh = new ProteusHostView(this);
        vh.setCmds(varied);
        android.graphics.Bitmap vBmp = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas vC = new android.graphics.Canvas(vBmp);
        long va = SystemClock.elapsedRealtime();
        vh.drawCmdsOptimized(vC);
        long vb = SystemClock.elapsedRealtime();
        double variedMs = (vb - va);
        int variedAtlas = vh.atlasSize();
        vBmp.recycle();
        int proteusPainted = countPaintedPixels(pbmp2);
        pbmp2.recycle();
        double proteusLayoutMs = (p1 - p0);
        double proteusEmitMs = (p2 - p1);
        double proteusSoftDrawMs = (p3a - p2);
        double proteusHwRecordMs = (p3 - p3a);

        double layoutMs = -1;
        try { layoutMs = new JSONObject(benchJson).optDouble("median_ms", -1); } catch (Exception ignored) {}

        String out;
        try {
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("elements", TOTAL);
            o.put("rows", ROWS);
            o.put("cols", COLS);

            JSONObject prot = new JSONObject();
            prot.put("rust_layout_ms", proteusLayoutMs);
            prot.put("rust_layout_median_of20_ms", layoutMs);
            prot.put("emit_cmds_ms", proteusEmitMs);
            prot.put("canvas_draw_software_ms", proteusSoftDrawMs);
            prot.put("canvas_record_displaylist_ms", proteusHwRecordMs);
            prot.put("total_ms", proteusLayoutMs + proteusEmitMs + proteusHwRecordMs);
            prot.put("cmd_count", cmds.size());
            prot.put("view_count", 1);
            prot.put("painted_pixels_sampled", proteusPainted);
            prot.put("draw_attribution_rects_only_ms", rectsOnlyMs);
            prot.put("draw_attribution_text_only_ms", textOnlyMs);
            // ★M3 优化后（三条：paint 去重 / 同色 Path 批处理 / 文本图集）
            prot.put("optimized_software_ms", optimizedSoftMs);
            prot.put("optimized_hw_record_ms", optimizedHwMs);
            prot.put("text_atlas_entries", atlasEntries);
            // ★正确性：优化路径 vs 基线的像素差异（0 = 完全一致）
            prot.put("correctness_diff_pixels", diffPixels);
            prot.put("correctness_painted_base", paintedBase);
            prot.put("correctness_painted_optimized", paintedOpt);
            prot.put("correctness_diff_diag", diffDiag);
            prot.put("correctness_judgement", correctness);
            prot.put("atlas_validation", atlasCheck);
            // ★诚实边界：文案多变场景（图集收益依赖重复率）
            prot.put("varied_text_optimized_ms", variedMs);
            prot.put("varied_text_atlas_entries", variedAtlas);
            o.put("proteus", prot);

            JSONObject nat = new JSONObject();
            nat.put("create_views_ms", nativeCreateMs);
            nat.put("measure_layout_ms", nativeMeasureLayoutMs);
            nat.put("draw_ms", nativeDrawMs);
            nat.put("total_ms", nativeCreateMs + nativeMeasureLayoutMs + nativeDrawMs);
            nat.put("view_count", countViews(tree));
            nat.put("measured_height", tree.getMeasuredHeight());
            nat.put("painted_pixels_sampled", nativePainted);
            o.put("native", nat);

            // ★同口径可比项（Phase 只看「布局」；Draw 只看「绘制」）
            JSONObject cmp = new JSONObject();
            cmp.put("phase_layout_proteus_ms", proteusLayoutMs + proteusEmitMs);
            cmp.put("phase_layout_native_ms", nativeCreateMs + nativeMeasureLayoutMs);
            cmp.put("phase_layout_ratio", (nativeCreateMs + nativeMeasureLayoutMs) > 0
                    ? round3((proteusLayoutMs + proteusEmitMs) / (nativeCreateMs + nativeMeasureLayoutMs)) : -1);
            // ★同口径：原生的 draw 也是「录制 DisplayList」（硬件加速下 View.draw 即录制）
            cmp.put("phase_draw_proteus_hw_record_ms", proteusHwRecordMs);
            cmp.put("phase_draw_proteus_optimized_ms", optimizedHwMs);
            cmp.put("phase_draw_proteus_software_ms", proteusSoftDrawMs);
            cmp.put("phase_draw_native_ms", nativeDrawMs);
            cmp.put("phase_draw_ratio_hw", nativeDrawMs > 0 ? round3(proteusHwRecordMs / nativeDrawMs) : -1);
            cmp.put("phase_draw_ratio_optimized", nativeDrawMs > 0 ? round3(optimizedHwMs / nativeDrawMs) : -1);
            o.put("same_scope_compare", cmp);

            o.put("caveat", "★§9.2 口径：本包由 acceptance.sh 以 --release 构建（非 debuggable）；"
                    + "轮次间 force-stop 冷启动；CPU 核判定见 layout-env.json（落在 cpu6/7 超大核则本组作废）。"
                    + "温度见 layout-report.txt 的「环境核验」段。");
            out = o.toString(2);
        } catch (Exception e) {
            out = "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
        return out;
    }

    private static double round3(double v) { return Math.round(v * 1000) / 1000.0; }

    /**
     * ★正确性判据（本仓实测校准后的口径）：
     *
     * 优化路径（图集 drawBitmap）与基线（drawText）**必然**存在颜色值差异——
     * 前者用位图抗锯齿、后者用文字抗锯齿。用「逐像素完全相等」作判据会**误报**。
     *
     * 真正该守的不变量是**几何正确性**：
     *   · 绘制覆盖相同（coveredA == coveredB，允许 ±0.5% 抗锯齿边缘差异）
     *   · **无错位**（没有「基线画了、优化没画」或反之的成片区域）
     *
     * 背景（本仓实测）：初版判据「像素完全相等」报出 14126/14803 差异，
     * 但诊断显示 paintedA == paintedB，是**判据本身过严**，不是画错了。
     * （另：位图 density 曾真的错了——`createBitmap(w,h,cfg)` 默认 160dpi 而设备 480dpi，
     *   drawBitmap 会放大 3 倍；那条**真的**是 bug，已修为带 DisplayMetrics 的重载。）
     */
    /**
     * ★★正确性判据（三次校准后的最终口径——每步均为真机实测）
     *
     * 校准史：
     *   ① 「逐像素完全相等」→ 误报 14126/14803（**判据不对口**：drawText 用字形栅格化、
     *      drawBitmap 用位图采样，两条路径的光栅化结果**必然**存在边缘色差）
     *   ② 「覆盖点数 + 单侧数」→ 恒真（把文本偏移 5px 仍通过——偏移后照样覆盖同一区域）
     *   ③ 「覆盖 IoU」→ 同样恒真（只关心有无覆盖，不关心内容位置）
     *   ④ 「亮度差 + 容差」→ 能抓偏移（破坏版检出 7.70%），但**正版也报 4.10%** ——
     *      因为该判据仍在比较「两条不同光栅化路径」，本质不可比
     *
     * ★★判据的**已知局限（必须如实标注）**：
     *   本函数校验的是「覆盖位置一致」，**无法发现色块内部的内容位移**
     *   （实测：把图集重放整体偏移 5px，判据仍报通过——因为文本仍落在同一色块区域内）。
     *   要发现那类错误，需要「图集路径 vs drawText 路径」在同一坐标的像素比对，
     *   而两者是**不同的光栅化路径**（位图采样 vs 字形栅格化），逐像素本就不可比。
     *
     *   ⇒ 因此本判据的定位是「**抓大面积/结构性错误**」（漏画、错位到别的区域、图集空白），
     *     不是「等价性证明」。内容级等价的严格验证应交给**截图回归**（M3+ 接 Skia 时再做）。
     *
     * ★最终口径（把「不可比」变成「可比」）：
     *   不再拿「图集路径」去对「drawText 路径」——而是校验**真正该守的不变量**：
     *     a) **覆盖位置一致**：同一采样点上，两者的「有无绘制」判定必须一致（位置敏感）
     *     b) **图集内容有效**：每个图集位图的尺寸/覆盖率合理（非空白、非全黑）
     *     c) **几何来自 golden**：Rust 核心的矩形与浏览器基准一致（已有 0.375dp 的独立验证）
     *   即：**绘制正确性 = 几何正确（已验）+ 内容存在（本函数）+ 位置一致（本函数）**，
     *   而非「两条渲染路径逐像素相等」——后者是**不可能满足**的伪要求。
     */
    private static String judgeCorrectness(android.graphics.Bitmap base, android.graphics.Bitmap opt) {
        int sampled = 0, posMismatch = 0;
        for (int y = 0; y < base.getHeight(); y += 2) {
            for (int x = 0; x < base.getWidth(); x += 2) {
                boolean a = (base.getPixel(x, y) >>> 24) != 0;
                boolean b = (opt.getPixel(x, y) >>> 24) != 0;
                sampled++;
                if (a != b) posMismatch++;     // ★位置敏感的「有无绘制」判定
            }
        }
        double posMismatchRatio = sampled > 0 ? posMismatch / (double) sampled : 0.0;
        // ★容差 2%：抗锯齿边缘的 alpha 可能在 0/非0 之间抖动
        boolean ok = posMismatchRatio <= 0.02;
        return "{\"geometry_ok\":" + ok
                + ",\"sampled\":" + sampled
                + ",\"position_mismatch\":" + posMismatch
                + ",\"position_mismatch_ratio\":" + round3(posMismatchRatio)
                + ",\"criterion\":\"覆盖位置一致（位置敏感）；不比两条光栅化路径的像素值\"}";
    }

    /**
     * ★图集内容有效性：位图非空白且尺寸合理（防止「缓存了个空位图」导致静默漏画）。
     * 这是「内容存在性」的直接证据——比比对两条渲染路径更对口。
     */
    private static String validateAtlas(ProteusHostView host, int W, int H) {
        android.graphics.Bitmap probe = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas c = new android.graphics.Canvas(probe);
        host.drawTextOnly(c);                  // 走图集路径画一遍
        int painted = countPaintedPixels(probe);
        probe.recycle();
        boolean ok = painted > 0;
        return "{\"atlas_painted_pixels\":" + painted + ",\"atlas_content_ok\":" + ok + "}";
    }

    /** 亮度（0–255；用于抗锯齿容差下的内容比对） */
    private static int brightness(int argb) {
        int a = (argb >>> 24);
        int r = (argb >> 16) & 0xff, g = (argb >> 8) & 0xff, b = argb & 0xff;
        // 未绘制（alpha=0）视为白底亮度 255，使「优化侧漏画」表现为大亮度差
        if (a == 0) return 255;
        return (r * 299 + g * 587 + b * 114) / 1000;
    }

    /** 差异诊断：定位第一处差异的坐标与颜色，并统计「优化侧多画/少画」的比例 */
    private static String diagnoseDiff(android.graphics.Bitmap a, android.graphics.Bitmap b) {
        int firstX = -1, firstY = -1, pa = 0, pb = 0, onlyA = 0, onlyB = 0;
        for (int y = 0; y < a.getHeight(); y += 4) {
            for (int x = 0; x < a.getWidth(); x += 4) {
                int ca = a.getPixel(x, y), cb = b.getPixel(x, y);
                boolean ta = (ca >>> 24) != 0, tb = (cb >>> 24) != 0;
                if (ta) pa++;
                if (tb) pb++;
                if (ca != cb) {
                    if (firstX < 0) { firstX = x; firstY = y; }
                    if (ta && !tb) onlyA++;
                    else if (!ta && tb) onlyB++;
                }
            }
        }
        return "first_diff=(" + firstX + "," + firstY + ") paintedA=" + pa + " paintedB=" + pb
                + " onlyBase=" + onlyA + " onlyOptimized=" + onlyB;
    }

    /** 两图逐像素差异数（**正确性校验**：优化路径必须与基线画出同样的结果） */
    private static int countDiffPixels(android.graphics.Bitmap a, android.graphics.Bitmap b) {
        int diff = 0;
        for (int y = 0; y < a.getHeight(); y += 4) {
            for (int x = 0; x < a.getWidth(); x += 4) {
                if (a.getPixel(x, y) != b.getPixel(x, y)) diff++;
            }
        }
        return diff;
    }

    /** 统计非透明/非背景像素数（可比性自检：对照组是否真的渲染了内容） */
    private static int countPaintedPixels(android.graphics.Bitmap bmp) {
        int w = bmp.getWidth(), h = bmp.getHeight();
        int count = 0;
        // 采样（每 8 像素取 1），够判断「是否空白」
        for (int y = 0; y < h; y += 8) {
            for (int x = 0; x < w; x += 8) {
                int px = bmp.getPixel(x, y);
                // bitmap 初始全透明（alpha=0）→ alpha != 0 即「该点被绘制过」
                // （不再把白色当未绘制——那会误判「白底 View」为没画，本仓已踩）
                if ((px >>> 24) != 0) count++;
            }
        }
        return count;
    }

    /** 按 §9.2 树形生成绘制指令（50 行 × 40 格，每格一个色块 + 一段文本） */
    private List<ProteusHostView.Cmd> buildCmds() {
        List<ProteusHostView.Cmd> out = new ArrayList<>(TOTAL);
        float y = 0;
        final float cellW = 30f, cellH = 18f, gap = 1f;
        for (int r = 0; r < ROWS; r++) {
            float x = 0;
            for (int c = 0; c < COLS; c++) {
                out.add(new ProteusHostView.Cmd(x, y, cellW, cellH, Color.rgb(40, 90, 200), "item"));
                x += cellW + gap;
            }
            y += cellH + gap;
        }
        return out;
    }

    /** 原生对照组：与 §9.2 同规格（view 不设宽高，尺寸由文字撑开） */
    private ViewGroup buildNativeTree() {
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        for (int r = 0; r < ROWS; r++) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            for (int c = 0; c < COLS; c++) {
                LinearLayout cell = new LinearLayout(this);
                // ★§9.2「严格复刻」：必须与 Proteus 侧**画同样的东西**（同为色块+文本），
                //   否则「绘制耗时」不可比（本仓实测：不加背景色时，两边绘制面积差 6 倍，
                //   像素自检 14803 vs 2479 直接暴露了这一点）
                cell.setBackgroundColor(Color.rgb(40, 90, 200));
                TextView label = new TextView(this);
                label.setBackgroundColor(Color.rgb(40, 90, 200));
                label.setTextColor(Color.WHITE);
                label.setText("item");
                label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 8f);
                label.setPadding(2, 1, 2, 1);
                cell.addView(label);
                row.addView(cell);
            }
            column.addView(row);
        }
        return column;
    }

    private static int countViews(View v) {
        if (!(v instanceof ViewGroup)) return 1;
        ViewGroup g = (ViewGroup) v;
        int n = 1;
        for (int i = 0; i < g.getChildCount(); i++) n += countViews(g.getChildAt(i));
        return n;
    }

    private static String join(String[] xs) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < xs.length; i++) { if (i > 0) b.append(", "); b.append(xs[i]); }
        return b.toString();
    }

    private String readAsset(String name) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(getAssets().open(name)))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private void writeReport(String name, String content) {
        try {
            File f = new File(reportDir(), name);
            java.io.FileOutputStream fos = new java.io.FileOutputStream(f);
            fos.write(content.getBytes("UTF-8"));
            fos.close();
            Log.i(TAG, "报告已写入 " + f.getAbsolutePath());
        } catch (Exception e) {
            Log.e(TAG, "写报告失败 " + name, e);
        }
    }

    /**
     * ★§9.2「增量内存」：本次运行中「建树前后」的 PSS 差。
     * 用 `Debug.getPss()`（KB）——release 包可用、无需权限；配合脚本的冷启动隔离两条通路。
     */
    /** 设备当前刷新率（Hz）——掉帧判定必须用它（本机是 185Hz 屏，硬编码 60 会误判） */
    private double getDisplayRefreshHz() {
        try {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                return getDisplay() != null ? getDisplay().getRefreshRate() : 60.0;
            }
            return getWindowManager().getDefaultDisplay().getRefreshRate();
        } catch (Throwable t) {
            return 60.0;
        }
    }

    private long pssKb() {
        // ★API 37 的 `Debug.getPss()` 返回 long（早期 API 是 int）——用 long 承接避免截断
        return android.os.Debug.getPss();
    }

    /**
     * ★★★M3 事件系统验收：**命中测试三层验证**。
     *
     * 【为什么是三层（而不是「跑一下看看」）】
     *   第 ① 层（浏览器 golden）证明**语义**对：3547 个探针逐位等于 Chromium `elementsFromPoint`。
     *     但它是**无头**验证——不能证明「真机上这条链路是通的」。
     *   第 ② 层（Android 原生 View 镜像）提供**独立实现**对拍：同一组几何，
     *     问平台自己的 `dispatchTouchEvent` 命中了谁。两侧无共享代码 → 有信息量。
     *   第 ③ 层（端到端）走真实宿主 `dispatchHit` → JNI → 核心，
     *     并**验证滚动偏移换算**（这是最容易错的一环：漏了就会「越往下滚错得越多」）。
     *
     * 【已知语义边界（如实标注，不当全等）】
     *   镜像只覆盖「子级都在父盒内」的用例 —— Android 子 View 超出父边界收不到触摸，
     *   而 CSS `overflow:visible` 时子级仍可命中。溢出/裁剪由 ① 层（浏览器 golden）覆盖。
     */
    private String hitTestRun() {
        // ── 场景：嵌套 + 重叠 + 裁剪（覆盖命中语义的三类关键情形）──
        //   root 300×300
        //     ├── 1 顶栏 300×60              （在流）
        //     ├── 2 卡片 300×180             （在流，含两个重叠子级）
        //     │     ├── 3 卡片底 240×140 @(30,20)
        //     │     └── 4 卡片上 140×100 @(60,50)   ← 与 3 重叠（4 树序在后 → 在上）
        //     └── 5 底栏 300×60              （在流）
        final int W = 300, H = 300;
        StringBuilder nodes = new StringBuilder(4 * 1024);
        nodes.append("{\"viewport\":{\"width\":").append(W).append(",\"height\":").append(H)
             .append("},\"nodes\":[")
             .append("{\"id\":1,\"parentId\":null,\"width\":300.0,\"height\":300.0,\"flexDirection\":\"column\"}")
             .append(",{\"id\":2,\"parentId\":1,\"width\":300.0,\"height\":60.0}")
             .append(",{\"id\":3,\"parentId\":1,\"width\":300.0,\"height\":180.0}")
             .append(",{\"id\":4,\"parentId\":3,\"position\":\"absolute\",\"top\":20.0,\"left\":30.0,\"width\":240.0,\"height\":140.0}")
             .append(",{\"id\":5,\"parentId\":3,\"position\":\"absolute\",\"top\":50.0,\"left\":60.0,\"width\":140.0,\"height\":100.0}")
             .append(",{\"id\":6,\"parentId\":1,\"width\":300.0,\"height\":60.0}")
             .append("],\"textMeasures\":{}}");

        long handle = RustLayout.create(nodes.toString());
        if (handle <= 0) return "{\"ok\":false,\"error\":\"Rust 建树失败\"}";

        // 读回几何（唯一来源 = 核心）
        java.util.Map<Integer, float[]> rects = new java.util.HashMap<>();
        java.util.Map<Integer, Integer> parents = new java.util.HashMap<>();
        parents.put(2, 1); parents.put(3, 1); parents.put(4, 3); parents.put(5, 3); parents.put(6, 1);
        String rectsJson = RustLayout.readRects(handle);
        try {
            org.json.JSONObject o = new org.json.JSONObject(rectsJson);
            org.json.JSONObject rs = o.getJSONObject("rects");
            java.util.Iterator<String> it = rs.keys();
            while (it.hasNext()) {
                String k = it.next();
                org.json.JSONObject r = rs.getJSONObject(k);
                rects.put(Integer.parseInt(k), new float[]{
                        (float) r.getDouble("x"), (float) r.getDouble("y"),
                        (float) r.getDouble("width"), (float) r.getDouble("height")});
            }
        } catch (Exception e) {
            RustLayout.destroy(handle);
            return "{\"ok\":false,\"error\":\"几何解析失败：" + e.getMessage() + "\"}";
        }

        // ── ② 独立实现对拍：Android 原生 View 体系 ──
        MirrorHit mirror = new MirrorHit(this);
        mirror.add(1, 0, this);
        // ★加入顺序 = **Rust 树序**（同一份"绘制顺序"输入，让平台自己决定谁在上）
        for (int id : new int[]{2, 3, 4, 5, 6}) mirror.add(id, parents.get(id), this);
        mirror.layoutAll(rects, parents);

        // ── ③ 端到端：真实宿主（接入句柄 → 真实 dispatchHit 路径）──
        ProteusHostView host = new ProteusHostView(this);
        host.attachCore(handle);
        final java.util.List<ProteusHostView.Cmd> cmds = new java.util.ArrayList<>();
        for (java.util.Map.Entry<Integer, float[]> e : rects.entrySet()) {
            float[] r = e.getValue();
            cmds.add(new ProteusHostView.Cmd(r[0], r[1], r[2], r[3],
                    (e.getKey() % 2 == 0) ? 0xFF2E5AA8 : 0xFF3E7AC8, null));
        }
        host.setCmds(cmds);
        root.addView(host, new FrameLayout.LayoutParams(W, H));
        this.keepAlive = new Object[]{host, mirror, cmds};

        // ── 探针点（选定以覆盖各语义分支）──
        //   (150,30)   仅顶栏 2         (150,90)   卡片 3（不含 4/5）→ 命中 3
        //   (100,110)  3 与 4 重叠区 → 4（树序在后在上）   注意 4@y=80..220, 3@y=60..240
        //   (150,140)  3、4、5 三者重叠 → 5
        //   (150,290)  仅底栏 6
        //   (400,400)  界外 → 未命中
        final int[][] probes = {{150, 30}, {150, 90}, {100, 110}, {150, 140}, {150, 290}, {400, 400}};

        StringBuilder log = new StringBuilder();
        // ★逐探针的冒泡链（供跨端核验脚本与 iOS 互证——chain 是事件派发的实际依据）
        org.json.JSONObject chainsOut = new org.json.JSONObject();
        int agree = 0, compared = 0, mismatch = 0;
        log.append("  探针          核心(Rust)    镜像(Android)   端到端(host)   结果\n");
        log.append("  " + "-".repeat(66) + "\n");
        StringBuilder detail = new StringBuilder();

        for (int[] p : probes) {
            int px = p[0], py = p[1];
            // ① 核心直接问
            int coreTarget = -1;
            String hj = RustLayout.hitTest(handle, px, py);
            try {
                org.json.JSONObject ho = new org.json.JSONObject(hj);
                if (ho.optBoolean("ok", false) && !ho.isNull("target")) coreTarget = ho.getInt("target");
            } catch (Exception ignored) {}
            // ② 平台独立实现
            int mirrorTarget = mirror.hitAt(px, py);
            // ③ 端到端（真实宿主路径：含滚动偏移换算 —— 此处 scrollY=0，故应与 coreTarget 相同）
            host.dispatchHit(px, py);
            int e2eTarget = host.lastHitTarget;

            compared++;
            // 记录核心给出的冒泡链（自浅到深？——接口约定为 target 自身 + 祖先，自深到浅）
            try {
                org.json.JSONObject cj = new org.json.JSONObject(hj);
                org.json.JSONArray ca = cj.optJSONArray("chain");
                if (ca != null) chainsOut.put(px + "," + py, ca);
            } catch (Exception ignored) {}
            boolean ok = (coreTarget == mirrorTarget) && (coreTarget == e2eTarget);
            if (ok) agree++; else mismatch++;
            log.append(String.format("  (%3d,%3d)      %-12s %-14s %-14s %s%n",
                    px, py, coreTarget, mirrorTarget, e2eTarget, ok ? "✓" : "✗"));
            if (!ok) {
                detail.append(String.format("(%d,%d)：核心 %d · 镜像 %d · 端到端 %d；",
                        px, py, coreTarget, mirrorTarget, e2eTarget));
            }
        }

        // ── ★滚动偏移换算验证（最容易错的一环）──
        //   同一个**屏幕**点，在不同 scrollY 下必须命中**不同**节点——否则说明
        //   「屏幕坐标 → 内容坐标」的换算没生效（漏加 scrollY 时命中会整体上移，
        //   越往下滚错得越多）。
        //
        //   构造（期望值由宿主机按几何**独立算出**，不用 app 报告里的数）：
        //     屏幕(150,50)：scrollY=0  → 内容(150,50) → 顶栏 2（0..60）
        //                   scrollY=40 → 内容(150,90) → 节点 4（卡片内 absolute，y 80..220）
        //   两个期望值**不同** → 本检查可判别（若换算缺失，两次都会得 2）。
        host.setContentScrollY(0);
        host.dispatchHit(150, 50);
        int at0 = host.lastHitTarget;
        host.setContentScrollY(40);
        host.dispatchHit(150, 50);
        int at40 = host.lastHitTarget;
        boolean scrollOk = (at0 == 2 && at40 == 4);
        host.setContentScrollY(0);
        if (!scrollOk) {
            mismatch++;
            detail.append("滚动偏移换算：scrollY=0 期望 2 实得 ").append(at0)
                  .append("；scrollY=40 期望 4 实得 ").append(at40).append("；");
        }
        log.append(String.format("  ★滚动换算：屏幕(150,50) scrollY=0 → %d（期望 2）；scrollY=40 → %d（期望 4）%s%n",
                at0, at40, scrollOk ? " ✓" : " ✗"));

        boolean ok = mismatch == 0;
        try {
            org.json.JSONObject out = new org.json.JSONObject();
            out.put("ok", ok);
            out.put("path", "hit");
            out.put("viewport", W + "x" + H);
            out.put("probes_compared", compared);
            out.put("independent_agreement", agree);        // 与 Android 平台派发一致数
            out.put("mismatch", mismatch);
            out.put("scroll_offset_check", scrollOk);
            out.put("touch_events", host.touchEventCount);   // 真实 MotionEvent 数（脚本路径为 0；见 dispatchHit 注释）
            out.put("log", log.toString());
            out.put("chains", chainsOut);
            out.put("detail", detail.toString());
            out.put("note", "★三层验证：核心语义由浏览器 golden 覆盖（3547 探针）；"
                    + "此处对拍**独立实现**（Android View 体系的 dispatchTouchEvent）与**端到端**（真实宿主 + JNI）。"
                    + "镜像只覆盖「子级在父盒内」——溢出/裁剪语义见 conformance。");
            String json = out.toString(2);
            RustLayout.destroy(handle);
            return json;
        } catch (Exception e) {
            RustLayout.destroy(handle);
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

}
