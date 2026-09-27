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

        String text = sb.toString();
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextSize(9f);
        root.addView(tv);
        writeReport("layout-report.txt", text);
        Log.i(TAG, text);
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
        long p0 = SystemClock.elapsedRealtime();
        String benchJson = RustLayout.bench(TOTAL, 1);       // 建树 + 排版（Rust 侧全部结构）
        long p1 = SystemClock.elapsedRealtime();
        java.util.List<ProteusHostView.Cmd> cmds = buildCmds();  // 布局结果 → 绘制指令（宿主侧结构）
        ProteusHostView host = new ProteusHostView(this);
        host.setCmds(cmds);
        long p2 = SystemClock.elapsedRealtime();
        this.keepAlive = new Object[]{cmds, host};   // ★持有强引用直到 PSS 采样
        try {
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("path", "proteus");
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

    /** 原生通路单跑（隔离内存测量：不在同进程里先建 Proteus 结构） */
    private String nativeOnlyRun() {
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
        try {
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("path", "native");
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
    private long pssKb() {
        // ★API 37 的 `Debug.getPss()` 返回 long（早期 API 是 int）——用 long 承接避免截断
        return android.os.Debug.getPss();
    }
}
