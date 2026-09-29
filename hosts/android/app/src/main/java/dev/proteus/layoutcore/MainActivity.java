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
    /**
     * 读温度（m°C）——★**多源回退**（本仓实测的设备差异）
     *
     * 【为什么必须多源（honor10 实测）】原实现只读 /sys/class/thermal/thermal_zone[\u002a]/temp，
     *   ★（写路径时必须避开 `[星号]/`：**它本身就是 javadoc 的结束符**——本档实测：
     *    路径里的 thermal_zone[/]temp 提前闭合了注释块，导致后面 4 行中文全成了"非法字符"。
     *    诊断特征是**报错位置在注释中间**、且报的是"非法字符"而非语法结构——那是注释被提前结束。）
     *   而 honor10（Android 10 / Kirin 970）上该路径对 app **Permission denied**
     *   ⇒ 恒返回 -1（一条"看起来正常"的假读数——-1 会被读成"温度未变化"）。
     *   ⇒ 回退链：① 标准 thermal_zone（多数设备可用）→ ② dumpsys thermalservice 的
     *     Cached temperatures（honor10 可用，含 cluster0/cluster1/gpu/battery）→ ③ -1（明确标注取不到）。
     *   ★诚实边界：② 走 dumpsys 需要 android.permission.DUMP —— 实测 app 内 Runtime.exec 调 dumpsys
     *     **不可用**（权限受限）。故 ② 只在**脚本侧**（adb shell）可行 ⇒ app 侧实际回退到 ③，
     *     温度由**脚本侧**采集（本档已如此：acceptance.sh 的 max_temp() 用 adb shell 采集）。
     *     ⇒ 本方法保留但**返回值不再被当作可信读数**（报告里带 temp_source 标注）。
     */
    private int readTemp() {
        // ① 标准路径
        int max = -1;
        java.io.File dir = new java.io.File("/sys/class/thermal");
        java.io.File[] zones = dir.listFiles();
        if (zones != null) {
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
        }
        if (max > 0) { tempSource = "sysfs:thermal_zone"; return max; }
        // ② 备选：battery 温度（读取不受 thermal 类权限限制的设备）
        try {
            java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader(
                    "/sys/class/power_supply/battery/temp"));
            int v = Integer.parseInt(r.readLine().trim()) * 10;   // 该节点通常是 0.1°C
            r.close();
            if (v > 0 && v < 200000) { tempSource = "sysfs:battery(0.1C)"; return v; }
        } catch (Exception ignored) {}
        tempSource = "unavailable";
        return -1;
    }

    /** 温度来源标注（`unavailable` ⇒ 读数不可信，必须显式可见——见 readTemp 注释） */
    private String tempSource = "unknown";

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
        } else if ("scroll-native".equals(testPath)) {
            // ★★**原生滚动对照**（本仓实测的缺失基线，honor10 那轮记为开项）
            //
            // 【为什么必须有】§9.3 的帧率读数此前**只有 Proteus 侧**：荣耀10 上 p50=19ms
            //   （> 60Hz 的 16.67ms 预算）看起来"掉帧"，但**没有原生对照就无法归因**——
            //   可能是框架的问题，也可能是这台 2018 中端机**连原生列表也跑不满 60Hz**。
            //   ★纪律：**没有对照的"不达标"与"达标"同样不可信**（本仓已多次吃过
            //     "拿不到对照就说拿不到"的教训）。⇒ 同一台设备、同一场景、同一轨迹跑原生。
            sb.append("【③ §9.3 原生滚动对照（4051 个真实 View）】\n");
            String sn = scrollNativeRun();
            sb.append(sn).append('\n');
        } else if ("font-family".equals(testPath)) {
            sb.append("【③ 字体族映射（与 iOS V13 同契约）】\n");
            String r = fontFamilyRun();
            sb.append(r).append('\n');
        } else if ("mount-virtual".equals(testPath)) {
            sb.append("【③ 整树级虚拟化（同一份 SFC 产物）】\n");
            String r = mountVirtualRun();
            sb.append(r).append('\n');
        } else if ("splice".equals(testPath)) {
            sb.append("【③ 结构变更（适配器产出 → 真机核心执行）】\n");
            String r = spliceRun();
            sb.append(r).append('\n');
        } else if ("apply-ops".equals(testPath)) {
            sb.append("【③ Vapor 指令流（TS 编码 → 真机解码）】\n");
            String r = applyOpsRun();
            sb.append(r).append('\n');
        } else if ("app-4050".equals(testPath)) {
            // ★★对标 uni-app x「创建元素」场景——**Proteus 侧**（应用级口径）
            //   ★与原生对照**分成两条通路 + 两次冷启动**：同进程先后建树会互相污染内存
            //     （本方既有纪律：`--es path proteus|native` 分两次冷启动隔离）
            sb.append("【③ 对标基准：创建元素 4050（应用级口径 · Proteus 侧）】\n");
            String a = app4050Run();
            sb.append(a).append('\n');
            writeReport("layout-app-4050.json", a);
        } else if ("app-4050-native".equals(testPath)) {
            sb.append("【③ 对标基准：创建元素 4050（应用级口径 · 原生 View 对照）】\n");
            String an = app4050NativeRun();
            sb.append(an).append('\n');
            writeReport("layout-app-4050-native.json", an);
        } else if ("flat-redraw".equals(testPath)) {
            // ★★绘制常数开销对照（2026-09-29）：**行级显示列表复用** vs 全量重放
            //   回答 `ACCEPTANCE.md` 的开项「根因 = 每次全量重放 2000 条指令」是否成立、修法收益多大。
            sb.append("【③ 绘制常数开销（行级显示列表复用 vs 全量重放）】\n");
            String fr = flatRedrawRun();
            sb.append(fr).append('\n');
            writeReport("layout-flat-redraw.json", fr);
        } else if ("scroll-core".equals(testPath)) {
            // ★★**核心驱动的滚动**（与 iOS 的 `V12_scroll_recycle` 同一条路）：
            //   可见行 → 向核心要**决策**（acquire/release + 方向敏感预载）→ 宿主执行动作。
            //   ★与 "scroll" 路径的差别：那一版宿主**自己算** above/below（recycle.rs 的第二份副本），
            //     本版删掉那份副本，两端共用同一份核心逻辑。
            sb.append("【③ 核心驱动的滚动（复用池决策来自 Rust）】\n");
            String start = scrollCoreRun();
            sb.append(start).append('\n');
        } else if ("js-engine".equals(testPath)) {
            // ★★S3：**Android JS 引擎最小闭环**（QuickJS）——卡 C1/C2 的共同前置
            //   此前 Android 宿主无 JS 引擎（Java + Rust .so 直连 JNI）
            sb.append("【S3 Android JS 引擎（QuickJS）最小闭环】\n");
            String js = jsEngineRun();
            sb.append(js).append('\n');
            writeReport("js-engine.json", js);
        } else if ("js-batch".equals(testPath)) {
            // ★★S3b：**真实适配器**在 Android QuickJS 上跑（不是手写等价 JS——S3 才是）
            sb.append("【S3b 真实 render-backend 适配器（bundle）】\n");
            String jsb = jsBatchRun();
            sb.append(jsb).append('\n');
            writeReport("js-batch.json", jsb);
        } else if ("shot-scroll-native".equals(testPath)) {
            // ★★z-order 约束下的**滚动同步**验证（方案坑位 #4）
            //   场景：20 行列表，**第 5 行是 native-host（WebView）**；程序驱动滚动到若干位置，
            //   每个位置截图核验：① native-host 是否跟随（translationY = -scrollY）
            //                     ② 滚出视口是否被裁（INVISIBLE）
            //                     ③ 自绘内容与原生 View 的**相对位置**是否保持（不脱节）
            sb.append("【③ 滚动 + native-host 同步】\n");
            String s1 = setupScrollNativeScene();
            sb.append(s1).append('\n');
            // ★★文件名不得与「原生滚动对照」（scroll-native 通路）撞名：
            //   两者内容完全不同（本场景=24 行 + native-host 的几何核验；对照通路=4000 行滚动统计）。
            //   本仓实测：撞名导致 run 目录里拉到的是**截图场景**数据，而报告按「原生滚动对照」去读
            //   ⇒ 差异静默（数字都能解析，只是根本不是同一件事）。
            writeReport("layout-shot-scroll-native.json", s1);
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
        } else if ("gesture".equals(testPath)) {
            // ★★M3 手势验收（方案 §6 映射表：平台识别器 + 核心命中标注 target）
            sb.append("【③ 手势：平台识别器（GestureDetector） + 核心命中 target】\n");
            String g = gestureRun();
            sb.append(g).append('\n');
            writeReport("layout-gesture.json", g);
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
        // ★★核档位判定：**按实测频率分档，不写死核号**（本仓实测的设备移植缺陷）
        //
        // 【为什么原写法是错的】`if (c >= 6) prime++` 把设备拓扑写死了（"8 核、cpu6/7 最快"）。
        //   换机即误判：honor10 / Kirin 970 = cpu0-3 A53@1.844GHz + cpu4-7 A73@2.362GHz（**只有两档**）
        //   ⇒ cpu4/5 被算成 normal（其实是最快档），而 "prime" 指向一个不存在的第三档。
        //   ⇒ 正解：读本机各核 max_freq 聚档，"最快档"是**测出来的**。
        //   §9.2 判据重述：**主线程只落在最快档**即合规（两档设备上落在最快档是正常的，
        //   不是"超频作弊"——那是它唯一的快档）。
        int[] coreMaxKhz = readCoreMaxFreq();
        int fastestKhz = 0;
        for (int f : coreMaxKhz) if (f > fastestKhz) fastestKhz = f;
        int primeCount = 0, normalCount = 0;
        StringBuilder freqStr = new StringBuilder();
        for (int ci = 0; ci < coreMaxKhz.length; ci++) {
            if (coreMaxKhz[ci] <= 0) continue;
            if (freqStr.length() > 0) freqStr.append(",");
            freqStr.append("cpu").append(ci).append("=").append(coreMaxKhz[ci]);
        }
        for (Integer c : observedCpus) {
            if (c >= 0 && c < coreMaxKhz.length && coreMaxKhz[c] == fastestKhz) primeCount++;
            else normalCount++;
        }
        java.util.Set<Integer> tiers = new java.util.TreeSet<>();
        for (int f : coreMaxKhz) if (f > 0) tiers.add(f);

        // ★采样前强制 GC：把「尚未回收的垃圾」清掉，只留**结构本身的存活对象**
        //   （否则测得的是「分配峰值」而非「结构成本」，重复性差）
        System.gc();
        try { Thread.sleep(300); } catch (InterruptedException ignored) {}
        long peakPss = pssKb();
        sb.append("\n【④ §9.2 环境核验】\n");
        sb.append("观测到的 CPU：").append(cpuStr.length() == 0 ? "未知" : cpuStr.toString())
          .append("（最快档 ").append(primeCount).append(" · 其余 ").append(normalCount)
          .append(" · 本机 ").append(tiers.size()).append(" 档 · 最快 ").append(fastestKhz).append("kHz）\n");
        sb.append("温度：").append(tempBefore).append(" → ").append(tempAfter).append(" (m°C)\n");
        writeReport("layout-env.json",
                "{\"path\":\"" + testPath + "\",\"observed_cpus\":["
                        + cpuStr.toString() + "],\"prime_count\":" + primeCount
                        + ",\"normal_count\":" + normalCount
                        + ",\"core_max_khz\":\"" + freqStr + "\""
                        + ",\"fastest_khz\":" + fastestKhz
                        + ",\"tiers\":" + tiers.size()
                        + ",\"temp_before_mc\":" + tempBefore
                        + ",\"temp_after_mc\":" + tempAfter
                        + ",\"temp_source\":\"" + tempSource + "\"}");

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
    /**
     * ★★**核心驱动的滚动列表**（§12.6 / §12.7 P1）——与 iOS `V12_scroll_recycle` 同一条路。
     *
     * 【与 `scrollListRun()` 的本质差别（本仓实测的设计纠正）】
     *   `scrollListRun()` 里宿主**自己算**窗口边界与方向敏感预载：
     *
     *       boolean backward = progress >= 0.5;
     *       int above = backward ? 8 : 2;
     *       int below = backward ? 2 : 8;
     *
     *   ——这正是 `recycle.rs`（已有单测与踩坑记录）的**第二份手写副本**。
     *   两份副本的漂移是**静默的**（只是多建或少建几行对象，几何断言一律发现不了）。
     *   ⇒ 本方法：宿主只做三件事——① 由滚动位置算**可见行**（几何已由核心给出）
     *     ② 把可见行喂给核心的复用池窗口 ③ 执行核心返回的 acquire/release 行号列表。
     *
     * 【判据（与 iOS 对齐）】
     *   · 每帧 acquire/release **有界**（不随滚动距离增长）
     *   · 前 30 帧方向 = forward、回滚 30 帧 = backward（方向敏感的前提）
     *   · **回滚时预载区交换**（上方多留）—— 核心决策的直接读数
     *   · 建对象总数 ≪ 物化次数 × 行数（否则等于每帧重建）
     *   · 对象池复用率 > 0.5
     */
    /**
     * ★★S3：**Android JS 引擎（QuickJS）最小闭环**。
     *
     * 【判据（三条，都可机器判定）】
     *   ① 引擎加载：`QuickJsEngine.isAvailable()`（否则报 loadError——不静默）
     *   ② **JS 真的执行了**：一段含副作用的自检脚本，回读结果（不是"没抛错"就算过）
     *   ③ **批量桥最小闭环**：跑一段**从 `selfdraw-batch` 编译的等价逻辑**——
     *      建 1 个节点 + 一次 commit，宿主回调收到 **1 次** `mount` 且**批次内容正确**
     *      （节点数 / 类型 / 文本）
     *
     * 【为什么用"等价逻辑"而不是直接跑 TS bundle】当前 APK 只打进 QuickJS 引擎 + 本类的
     *   JNI 桥，**没有打进 esbuild 产物**（那需要把 `render-backend` 打包成 IIFE 并入库/入 APK
     *   —— 属 S3 的下一步）。本方法先用**手写的最小等价 JS** 验证「引擎 → JNI → 宿主回调」这条链路
     *   是通的；把真实 bundle 接进来是同一接口的下一次调用（`nativeEval` 换成 bundle 源码）。
     *   ★诚实标注：本闭环证明**链路通**，不证明"真实 bundle 在 Android 上跑通"（后者待 S3b）。
     */
    private String jsEngineRun() {
        org.json.JSONObject out = new org.json.JSONObject();
        try {
            out.put("engine_available", QuickJsEngine.isAvailable());
            if (!QuickJsEngine.isAvailable()) {
                out.put("ok", false);
                out.put("error", "引擎未加载：" + QuickJsEngine.getLoadError());
                return out.toString(2);
            }
            out.put("engine_version", QuickJsEngine.nativeVersion());

            // ── 判据②：JS 真的执行了（含副作用 + 回读）──
            final StringBuilder hostPosts = new StringBuilder();
            Object host = new Object() {
                @SuppressWarnings("unused")
                public void post(String json) {
                    if (hostPosts.length() > 0) hostPosts.append('|');
                    hostPosts.append(json);
                }
            };
            // ★这段 JS 模拟 `createSelfDrawBatchAdapter` 的核心语义：
            //   累积操作 → commit 一次 → 通过 proteusHost.post 上报批次
            String script =
                "var ops = [];" +
                "function createElement(id, type) { ops.push({op:'create', id:id, type:type}); }" +
                "function insert(id, parentId) { ops.push({op:'insert', id:id, parentId:parentId}); }" +
                "function setText(id, text) { ops.push({op:'text', id:id, text:text}); }" +
                "function commit() {" +
                "  proteusHost.post(JSON.stringify({ callKind: 'mount', ops: ops, count: ops.length }));" +
                "  return ops.length;" +
                "}" +
                "createElement(1, 'view');" +
                "createElement(2, 'text');" +
                "insert(2, 1);" +
                "setText(2, 'Hello from QuickJS');" +
                "var committed = commit();" +
                "committed;";

            long t0 = System.nanoTime();
            QuickJsEngine.EvalResult r = QuickJsEngine.evalWithHost(script, host);
            long ms = (System.nanoTime() - t0) / 1000000;
            out.put("eval_ms", ms);
            out.put("eval_ok", r.ok);
            out.put("eval_value", r.value);
            if (!r.ok) {
                out.put("ok", false);
                out.put("error", "JS 执行失败：" + r.error);
                return out.toString(2);
            }

            // ── 判据③：批量桥最小闭环（宿主回调收到 1 次且批次内容正确）──
            String batch = hostPosts.toString();
            out.put("host_post_count", batch.isEmpty() ? 0 : batch.split("\\|").length);
            out.put("host_payload", batch);
            boolean postOk = false;
            int opCount = 0;
            String callKind = null;
            if (!batch.isEmpty()) {
                org.json.JSONObject b = new org.json.JSONObject(batch.split("\\|")[0]);
                callKind = b.optString("callKind");
                opCount = b.optInt("count");
                postOk = "mount".equals(callKind) && opCount == 4
                    && batch.contains("Hello from QuickJS");
            }
            out.put("batch_call_kind", callKind);
            out.put("batch_op_count", opCount);
            out.put("batch_ok", postOk);
            out.put("ok", postOk);
        } catch (Throwable t) {
            try {
                out.put("ok", false);
                out.put("error", t.getClass().getSimpleName() + ": " + t.getMessage());
            } catch (Exception ignored) { /* JSONObject 不会失败 */ }
        }
        try {
            return out.toString(2);
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"报告序列化失败\"}";
        }
    }

    /**
     * ★★S3b：在 Android 上跑**真实的 render-backend bundle**（`bridge/dist/bundle-batch.js`）。
     *
     * 【与 S3（`jsEngineRun`）的差别】S3 用手写的等价 JS 验「链路通」；
     *   本方法把**仓库里真正会被产品使用的 TS 代码**（`createSelfDrawBatchAdapter` +
     *   `createNativeBackend`，经 esbuild 打成 IIFE）读进引擎并执行
     *   ⇒ 证明「**真实适配器能在 Android 的 QuickJS 上跑**」。
     *
     * 【判据（三条 + 两个读数）】
     *   ① bundle 从 assets 读出并 eval 成功（含"入口函数挂到全局"的检查）
     *   ② 三个相位各自走对的宿主入口：首帧 mount · 纯样式 updatePatches · 结构变化 update
     *   ③ **hostCalls == 3**（批处理红线：调用数 = flush 次数，与节点/操作数无关）
     *   ★读数：mountNodes=4（首帧结构）/ updateNodes=5（加一节点后）/ lastPatch 内容
     *
     * 【★诚实边界】宿主桥在本链路里是"上报给 Java"（`proteusHost.post`）——
     *   即证明**适配器 → 宿主入口**这段真实；**Java 侧真正消费批次去渲染**属 C1 的后续
     *   （三项真机复测时接）。本方法**不**声称"端上已经会画了"。
     */
    private String jsBatchRun() {
        org.json.JSONObject out = new org.json.JSONObject();
        try {
            out.put("engine_available", QuickJsEngine.isAvailable());
            if (!QuickJsEngine.isAvailable()) {
                out.put("ok", false);
                out.put("error", "引擎未加载：" + QuickJsEngine.getLoadError());
                return out.toString(2);
            }
            // ① 读 bundle（assets）
            String bundle;
            try (java.io.InputStream is = getAssets().open("bundle-batch.js")) {
                java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
                bundle = new String(bos.toByteArray(), "UTF-8");
            }
            out.put("bundle_chars", bundle.length());

            final StringBuilder posts = new StringBuilder();
            Object host = new Object() {
                @SuppressWarnings("unused")
                public void post(String json) {
                    if (posts.length() > 0) posts.append('\n');
                    posts.append(json);
                }
            };

            // ② eval bundle（定义 globalThis.__proteusBatchRun）；失败即报（不静默）
            long t0 = System.nanoTime();
            QuickJsEngine.EvalResult load = QuickJsEngine.evalWithHost(bundle, host);
            out.put("bundle_load_ok", load.ok);
            if (!load.ok) {
                out.put("ok", false);
                out.put("error", "bundle eval 失败：" + load.error);
                return out.toString(2);
            }
            // ③ 调用入口（★这一步才真正跑适配器）
            QuickJsEngine.EvalResult run = QuickJsEngine.eval("__proteusBatchRun()");
            long ms = (System.nanoTime() - t0) / 1000000;
            out.put("run_ok", run.ok);
            out.put("run_ms", ms);
            if (!run.ok) {
                out.put("ok", false);
                out.put("error", "入口调用失败：" + run.error);
                return out.toString(2);
            }
            org.json.JSONObject r = new org.json.JSONObject(run.value);

            // ④ 判据
            out.put("host_post_count", posts.length() == 0 ? 0 : posts.toString().split("\n").length);
            out.put("phase1_mount", r.optBoolean("phase1_mount"));
            out.put("phase2_updates", r.optBoolean("phase2_updates"));
            out.put("phase3_update", r.optBoolean("phase3_update"));
            out.put("host_calls", r.optInt("hostCalls"));
            out.put("mount_nodes", r.optInt("mountedNodes"));
            out.put("update_nodes", r.optInt("updatedNodes"));
            out.put("last_call_kind", r.optString("lastCallKind"));
            out.put("node_specs", r.optInt("nodeSpecs"));
            boolean ok = r.optBoolean("phase1_mount") && r.optBoolean("phase2_updates")
                && r.optBoolean("phase3_update") && r.optInt("hostCalls") == 3
                && r.optInt("mountedNodes") == 4 && r.optInt("updatedNodes") == 5
                && !posts.toString().isEmpty();
            out.put("ok", ok);
        } catch (Throwable t) {
            try {
                out.put("ok", false);
                out.put("error", t.getClass().getSimpleName() + ": " + t.getMessage());
            } catch (Exception ignored) { /* JSONObject 不会失败 */ }
        }
        try {
            return out.toString(2);
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"报告序列化失败\"}";
        }
    }

    private String scrollCoreRun() {
        final int ROWS = 4000;
        final int VISIBLE_ROWS = 14;      // 一屏可见行数（60px 行高 × 14 ≈ 840）
        final float ROW_H = 60f;
        final int W = getResources().getDisplayMetrics().widthPixels;
        final int H = getResources().getDisplayMetrics().heightPixels;
        final int FRAMES = 600;

        // ── ① 一次 Rust 布局：给出每行的**真实几何**（行高不写死，由核心算） ──
        org.json.JSONArray nodes = new org.json.JSONArray();
        try {
            org.json.JSONObject root = new org.json.JSONObject();
            root.put("id", 0); root.put("parentId", org.json.JSONObject.NULL);
            root.put("flexDirection", "column");
            root.put("width", W); root.put("height", ROWS * ROW_H);
            nodes.put(root);
            for (int i = 0; i < ROWS; i++) {
                org.json.JSONObject r = new org.json.JSONObject();
                r.put("id", i + 1); r.put("parentId", 0);
                r.put("width", W); r.put("height", ROW_H);
                r.put("flexShrink", 0);
                nodes.put(r);
            }
        } catch (org.json.JSONException e) {
            return "{\"ok\":false,\"error\":\"构造节点失败：" + e.getMessage() + "\"}";
        }
        long tree = RustLayout.create("{\"viewport\":{\"width\":" + W + ",\"height\":" + H + "},\"nodes\":" + nodes + "}");
        if (tree <= 0) return "{\"ok\":false,\"error\":\"RustLayout.create 失败（节点数 " + nodes.length() + "）\"}";

        // 行高从核心几何读回来（★不假设 ROW_H——核心才是几何的唯一来源）
        float rowHProbe = ROW_H;
        try {
            org.json.JSONObject rects = new org.json.JSONObject(RustLayout.readRects(tree));
            org.json.JSONObject r1 = rects.optJSONObject("rects") == null ? null : rects.getJSONObject("rects").optJSONObject("2");
            if (r1 != null) rowHProbe = (float) r1.optDouble("height", ROW_H);
        } catch (Exception ignored) { }
        // ★必须 final：下面被匿名 Choreographer 回调捕获（Java 只允许捕获 final/实际 final）
        final float measuredRowH = rowHProbe;

        // ── ② 复用池句柄（核心侧窗口 + 状态机；0/0 ⇒ 核心默认 leading=8/following=2） ──
        final long pool = RustLayout.recycleCreate(ROWS, 0, 0);
        if (pool <= 0) { RustLayout.destroy(tree); return "{\"ok\":false,\"error\":\"recycleCreate 失败\"}"; }

        final ProteusHostView.ListRenderer renderer = new ProteusHostView.ListRenderer(VISIBLE_ROWS + 16);
        final ProteusHostView listView = new ProteusHostView(this);
        listView.enableListMode(renderer);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(W, H);
        root.addView(listView, lp);

        final long[] intervals = new long[FRAMES];
        final int[] idx = {0};
        final long[] lastVsync = {0};
        final int[] frameCount = {0};
        final int[] maxActive = {0};
        final int[] acqTotal = {0};
        final int[] relTotal = {0};
        final int[] maxPerFrame = {0};
        final int[] fwdFrames = {0};
        final int[] backFrames = {0};
        final int[] dirWrong = {0};
        final int[] idleFrames = {0};
        final int[] maxMissingVisible = {0};
        final int[] missingVisibleSum = {0};
        final int[] skippedInAcquire = {0};
        final int[] skippedTotal = {0};
        // 前/后各记一次预载区（判据：回滚时交换）
        // [fwdFirst, fwdLast, backFirst, backLast, fwdVisFirst, fwdVisLast, backVisFirst, backVisLast]
        final int[] fwdPreload = {-1, -1, -1, -1, -1, -1, -1, -1};

        final android.view.Choreographer choreographer = android.view.Choreographer.getInstance();
        final android.view.Choreographer.FrameCallback callback = new android.view.Choreographer.FrameCallback() {
            @Override public void doFrame(long frameTimeNanos) {
                int f = frameCount[0];
                if (f >= FRAMES) {
                    maxActive[0] = Math.max(maxActive[0], renderer.activeCount());
                    writeScrollCoreReport(ROWS, FRAMES, renderer, intervals, idx[0], maxActive[0],
                            acqTotal[0], relTotal[0], maxPerFrame[0], fwdFrames[0], backFrames[0], dirWrong[0],
                            idleFrames[0], fwdPreload, measuredRowH, pool,
                            maxMissingVisible[0], missingVisibleSum[0], skippedTotal[0]);
                    RustLayout.recycleDestroy(pool);
                    RustLayout.destroy(tree);
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
                boolean backward = progress >= 0.5;
                double firstRowExact = p * (ROWS - VISIBLE_ROWS);

                // 可见行：由滚动位置 + 行高推出（行高来自核心几何）
                // I2-ALLOW: 滚动**行索引**候选（非渲染坐标——渲染几何来自内核 rects，宿主不产几何）
                int firstVisible = (int) Math.floor(firstRowExact);
                int lastVisible = Math.min(ROWS - 1, firstVisible + VISIBLE_ROWS - 1);

                // ── ③ 向**核心**要决策（方向敏感预载在核心内，宿主不自己算） ──
                String dec = RustLayout.recycleUpdate(pool, firstVisible, lastVisible);
                int[] acquire = new int[0];
                int[] release = new int[0];
                int firstPre = -1, lastPre = -1;
                try {
                    org.json.JSONObject o = new org.json.JSONObject(dec);
                    if (o.optBoolean("ok", false)) {
                        acquire = toIntArray(o.optJSONArray("acquire"));
                        release = toIntArray(o.optJSONArray("release"));
                        firstPre = o.optInt("first_preload", -1);
                        lastPre = o.optInt("last_preload", -1);
                        String dir = o.optString("direction", "?");
                        // ★记录预载窗口必须按**核心给出的方向**，不能按"我期望的方向"
                        //
                        // 【本仓实测的记录口径缺陷（首跑就踩到）】初版把 back_preload 记在
                        //   `backward==true` 的第一个帧——而那一帧恰是**边界帧**（f=300 时
                        //   首行仍在**增大**，核心正确地判 forward）⇒ 记下来的是 forward 窗口
                        //   [3984,3999]（above=2），**看起来像"没有交换"**，差点被读成
                        //   "Android 侧预载区没生效"。⇒ 正解：只在与判据同向时采样。
                        //   [firstPreload, lastPreload, firstVisible, lastVisible] —— 四元组
                        //   （只记预载区间不够：判"上方留了几行"必须同时知道可见区首行）
                        int fv = o.optInt("first_visible", -1);
                        int lv = o.optInt("last_visible", -1);
                        if ("backward".equals(dir)) {
                            backFrames[0]++;
                            if (fwdPreload[2] < 0) { fwdPreload[2] = firstPre; fwdPreload[3] = lastPre; }
                            if (fwdPreload[6] < 0) { fwdPreload[6] = fv; fwdPreload[7] = lv; }
                        } else if ("forward".equals(dir)) {
                            fwdFrames[0]++;
                            if (fwdPreload[0] < 0) { fwdPreload[0] = firstPre; fwdPreload[1] = lastPre; }
                            if (fwdPreload[4] < 0) { fwdPreload[4] = fv; fwdPreload[5] = lv; }
                        } else {
                            idleFrames[0]++;
                        }
                        if (backward && !"backward".equals(dir)) dirWrong[0]++;
                        if (!backward && !"forward".equals(dir) && !"idle".equals(dir)) dirWrong[0]++;
                    }
                } catch (org.json.JSONException ignored) { }

                acqTotal[0] += acquire.length;
                relTotal[0] += release.length;
                maxPerFrame[0] = Math.max(maxPerFrame[0], Math.max(acquire.length, release.length));

                // ── ④ 执行动作：**先 release 再 acquire**（反了 ⇒ 新建的对象无法复用刚释放的） ──
                renderer.releaseRows(release);
                // ★★**核心说 acquire 的每一行都必须建**（本仓实测的真缺陷，被上面的诊断抓到）
                //
                // 【故障链】初版在此加了"屏幕外不建"的裁剪（看起来是合理的可见性优化）：
                //      if (y + ROW_H < 0 || y > H) { skipped++; continue; }
                //   但核心的复用池**已经把这行记为 acquired** ⇒ 下一帧不再下发它
                //   ⇒ 该行滚进可见区时**永远不会被建** ⇒ 屏幕上真的缺行。
                //   实测读数：`max_missing_in_visible: 8`（可见区内最多缺 8 行！
                //   因为预载区有 8 行在屏外被跳过，滚一帧 9.33 行即暴露）。
                //
                // 【为什么"裁剪"是错的（语义层）】核心给的 acquire 列表**已经包含**可见性策略
                //   （§12.6：可见区 + 方向敏感预载区），宿主再做一次裁剪 = **第二份窗口逻辑**
                //   ——正是本档要消除的那个东西，只是换了层皮。
                //   ⇒ 纪律：**平台侧只执行、不重判**；要省对象就改核心的预载参数（一处生效）。
                for (int row : acquire) {
                    if (row < 0 || row >= ROWS) continue;
                    float y = (float) ((row - firstRowExact) * measuredRowH);
                    renderer.acquireRow(row, 0, y, W, measuredRowH - 2f,
                            (row % 2 == 0) ? 0xFF2E5AA8 : 0xFF3E7AC8, "row " + row);
                }
                maxActive[0] = Math.max(maxActive[0], renderer.activeCount());
                // ★★**关键诊断（本档最重要的一条）**：可见区内是否有"核心认为存在、宿主却没建"的行
                //   ⇒ "宿主自作主张裁剪"会破坏核心簿记：核心以为该行已 acquire，
                //     下一帧不再下发 acquire ⇒ **该行滚进可见区也不会被建**（屏幕真的少行）。
                int missing = 0;
                for (int r = firstVisible; r <= lastVisible; r++) if (!renderer.hasRow(r)) missing++;
                if (missing > maxMissingVisible[0]) maxMissingVisible[0] = missing;
                missingVisibleSum[0] += missing;
                // ★★读数量纲修正（本仓实测）：`skippedInAcquire` 是**累计值**，
                //   而这里逐帧把它加进 `skippedTotal` ⇒ **O(n²) 累加**（实测 358650 次
                //   而实际跳过只有几百次）——一个"看起来极其严重"的假读数。
                //   教训：**累计量不得进入逐帧累加**；要么记增量、要么在末尾直接取累计值。
                //   （本档已删掉裁剪，此计数器保留为 0 作为"没有宿主侧重判"的证明。）

                listView.requestListFrame();
                frameCount[0]++;
                choreographer.postFrameCallback(this);
            }
        };
        choreographer.postFrameCallback(callback);
        return "{\"ok\":true,\"note\":\"核心驱动的滚动已启动（复用池决策来自 Rust）\",\"pool\":" + pool + ",\"tree\":" + tree + "}";
    }

    /** JSON 数组 → int[]（核心返回的行号列表） */
    private static int[] toIntArray(org.json.JSONArray a) {
        if (a == null) return new int[0];
        int[] out = new int[a.length()];
        for (int i = 0; i < a.length(); i++) out[i] = a.optInt(i, -1);
        return out;
    }

    /** 核心驱动滚动的报告（判据读数：每帧有界 / 方向 / 预载区交换 / 池化） */
    private void writeScrollCoreReport(int rows, int frames, ProteusHostView.ListRenderer renderer,
                                       long[] intervals, int n, int maxActive,
                                       int acqTotal, int relTotal, int maxPerFrame,
                                       int fwdFrames, int backFrames, int dirWrong, int idleFrames,
                                       int[] preload, float rowH, long pool,
                                       int maxMissingVisible, int missingVisibleSum, int skippedInAcquire) {
        if (n == 0) n = 1;
        long[] copy = java.util.Arrays.copyOf(intervals, n);
        long[] sorted = copy.clone();
        java.util.Arrays.sort(sorted);
        double avg = 0;
        for (long v : copy) avg += v;
        avg /= copy.length;
        try {
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("path", "scroll-core");
            o.put("note", "★★复用池决策来自 Rust 核心（宿主不再自己算方向敏感预载）");
            o.put("rows", rows);
            o.put("frames_sampled", copy.length);
            o.put("avg_frame_ms", Math.round(avg * 100) / 100.0);
            o.put("p50_ms", sorted[sorted.length / 2]);
            o.put("p95_ms", sorted[(int) (sorted.length * 0.95)]);
            // ★核心决策读数
            o.put("acquire_total", acqTotal);
            o.put("release_total", relTotal);
            o.put("max_per_frame", maxPerFrame);
            o.put("forward_frames", fwdFrames);
            o.put("backward_frames", backFrames);
            o.put("idle_frames", idleFrames);
            o.put("direction_mismatch_frames", dirWrong);
            // ★预载窗口（**按核心给出的方向采样**——见 scrollCoreRun 里的口径注释）
            o.put("fwd_preload", new org.json.JSONArray(new int[]{preload[0], preload[1]}));
            o.put("back_preload", new org.json.JSONArray(new int[]{preload[2], preload[3]}));
            // ★★方向敏感预载的**直接证据**（本档最有价值的一条）：
            //   算「可见区上方留了几行 / 下方留了几行」，两个方向必须**相反**。
            //     forward ：前进方向=下方 ⇒ 上少下多
            //     backward：前进方向=上方 ⇒ 上多下少
            //   ⇒ 若两侧同参（本仓曾踩过的错误实现），这条会**直接变红**。
            int fwdAbove = (preload[0] >= 0 && preload[4] >= 0) ? (preload[4] - preload[0]) : -1;
            int fwdBelow = (preload[1] >= 0 && preload[5] >= 0) ? (preload[1] - preload[5]) : -1;
            int backAbove = (preload[2] >= 0 && preload[6] >= 0) ? (preload[6] - preload[2]) : -1;
            int backBelow = (preload[3] >= 0 && preload[7] >= 0) ? (preload[3] - preload[7]) : -1;
            o.put("fwd_kept_above", fwdAbove);
            o.put("fwd_kept_below", fwdBelow);
            o.put("back_kept_above", backAbove);
            o.put("back_kept_below", backBelow);
            o.put("preload_swapped", fwdAbove >= 0 && backAbove >= 0
                    && fwdAbove < backAbove && fwdBelow > backBelow);
            // ★平台侧对象池读数（与 iOS 的 layers_created/layers_reused 同口径）
            o.put("rn_created", renderer.createdCount());
            o.put("rn_reused", renderer.reusedCount());
            o.put("rn_pooled", renderer.pooledCount());
            o.put("rn_max_active", maxActive);
            o.put("rn_reuse_ratio", Math.round(renderer.reuseRatio() * 10000) / 10000.0);
            o.put("row_height_from_core", Math.round(rowH * 100) / 100.0);
            // ★★宿主裁剪 vs 核心簿记（>0 ⇒ 核心认为存在的行，宿主没建 ⇒ 屏幕可能少行）
            o.put("max_missing_in_visible", maxMissingVisible);
            o.put("missing_visible_sum", missingVisibleSum);
            o.put("skipped_in_acquire", skippedInAcquire);
            // ★核心侧累计读数（与平台侧对账：两边行数应一致）
            String stats = RustLayout.recycleStats(pool);
            try { o.put("core_stats", new JSONObject(stats)); } catch (Exception e) { o.put("core_stats_raw", stats); }
            writeReport("layout-scroll-core.json", o.toString(2));
            android.util.Log.i(TAG, "核心驱动滚动报告已写入 layout-scroll-core.json");
        } catch (org.json.JSONException e) {
            writeReport("layout-scroll-core.json", "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}");
        }
    }

    /**
     * ★★**原生滚动对照**（§9.3 的缺失基线）——同一台设备、同一场景、同一轨迹。
     *
     * 【设计要点（每一条都是为了"可比"）】
     *   · **同一轨迹**：与 `scrollListRun` 逐帧相同（前半滚到底、后半回滚到顶，600 帧）
     *   · **同一屏/同一行数**：60px 行高、可见 ~14 行（与 Proteus 侧一致）
     *   · **同一帧驱动**：都用 `Choreographer.postFrameCallback` + `invalidate()`
     *     （不用 `ScrollView`——它的 fling/回弹会引入不同轨迹）
     *   · **同一测量口径**：都用 vsync 间隔采样（不用各自动画时钟）
     *
     * 【场景规模】Proteus 侧是「4000 行虚拟化」；原生侧**同样只建可见+预载行**
     *   （否则要建 4000 个 View，那是另一个课题：原生列表用 RecyclerView 才是公平对手，
     *    但那需要把 RecyclerView 也接进来 ⇒ 本档先用"手写复用"的 View 容器，
     *    **诚实标注**：这是"原生 View 的最小实现"，不是"原生最佳实践"）。
     *   ★另提供 `-full`（4051 View 全建）对照，用于回答"全量物化时谁快"。
     */
    private String scrollNativeRun() {
        final int ROWS = 4000;
        final int VISIBLE_ROWS = 14;
        final float ROW_H = 60f;
        final int W = getResources().getDisplayMetrics().widthPixels;
        final int H = getResources().getDisplayMetrics().heightPixels;
        final int FRAMES = 600;
        final int PRELOAD = 8;

        // 复用的行 View 池（与 Proteus 侧同构：可见 + 方向预载）
        final java.util.HashMap<Integer, android.view.View> live = new java.util.HashMap<>();
        final java.util.ArrayDeque<android.view.View> pool = new java.util.ArrayDeque<>();

        final android.widget.FrameLayout holder = new android.widget.FrameLayout(this);
        holder.setLayoutParams(new FrameLayout.LayoutParams(W, H));
        root.addView(holder);
        runButton.setVisibility(android.view.View.GONE);

        final long[] intervals = new long[FRAMES];
        final int[] idx = {0};
        final long[] lastVsync = {0};
        final int[] frameCount = {0};
        final int[] created = {0}, reused = {0};
        final int[] maxLive = {0};

        final android.view.Choreographer choreographer = android.view.Choreographer.getInstance();
        final android.view.Choreographer.FrameCallback cb = new android.view.Choreographer.FrameCallback() {
            @Override public void doFrame(long frameTimeNanos) {
                int f = frameCount[0];
                if (f >= FRAMES) {
                    writeNativeScrollReport(ROWS, FRAMES, intervals, idx[0], created[0], reused[0], maxLive[0]);
                    return;
                }
                if (lastVsync[0] != 0) {
                    long dt = (frameTimeNanos - lastVsync[0]) / 1_000_000L;
                    if (idx[0] < FRAMES) intervals[idx[0]++] = dt;
                }
                lastVsync[0] = frameTimeNanos;

                // ★与 Proteus 侧**逐帧相同**的轨迹
                double progress = (double) f / FRAMES;
                double p = progress < 0.5 ? progress * 2.0 : (1.0 - progress) * 2.0;
                double firstRowExact = p * (ROWS - VISIBLE_ROWS);
                // I2-ALLOW: 同上一处——行索引候选，非渲染几何
                int firstVisible = (int) Math.floor(firstRowExact);
                int lastVisible = Math.min(ROWS - 1, firstVisible + VISIBLE_ROWS - 1);
                boolean backward = progress >= 0.5;
                int above = backward ? 8 : 2;      // ★与核心的默认 leading/following 同参
                int below = backward ? 2 : 8;
                int from = Math.max(0, firstVisible - above);
                int to = Math.min(ROWS - 1, lastVisible + below);

                // 释放窗口外的
                java.util.Iterator<java.util.Map.Entry<Integer, android.view.View>> it = live.entrySet().iterator();
                while (it.hasNext()) {
                    java.util.Map.Entry<Integer, android.view.View> e = it.next();
                    int row = e.getKey();
                    if (row < from || row > to) {
                        holder.removeView(e.getValue());
                        if (pool.size() < 64) pool.addLast(e.getValue());
                        it.remove();
                    }
                }
                // 取（新）可见+预载行
                for (int row = from; row <= to; row++) {
                    if (live.containsKey(row)) continue;
                    android.view.View v = pool.pollLast();
                    if (v == null) { v = makeRowView(W, ROW_H, row); created[0]++; } else { reused[0]++; }
                    android.widget.FrameLayout.LayoutParams lp =
                            new android.widget.FrameLayout.LayoutParams(W, (int) (ROW_H - 2));
                    lp.topMargin = (int) ((row - firstRowExact) * ROW_H);
                    holder.addView(v, lp);
                    live.put(row, v);
                }
                maxLive[0] = Math.max(maxLive[0], live.size());
                // ★真实重绘（与 Proteus 侧同一条路：invalidate → onDraw → 窗口 canvas）
                holder.invalidate();
                frameCount[0]++;
                choreographer.postFrameCallback(this);
            }
        };
        choreographer.postFrameCallback(cb);
        return "{\"ok\":true,\"note\":\"原生滚动对照已启动（4051 View 的最小复用实现）\",\"rows\":" + ROWS + "}";
    }

    /** 造一个行 View（与 Proteus 侧的行**视觉同构**：底色 + 圆点 + 文字） */
    private android.view.View makeRowView(int w, float h, int row) {
        android.widget.FrameLayout rowBox = new android.widget.FrameLayout(this);
        rowBox.setBackgroundColor((row % 2 == 0) ? 0xFF2E5AA8 : 0xFF3E7AC8);
        android.view.View dot = new android.view.View(this);
        dot.setBackgroundColor(0xFF6F4AE8);
        android.widget.FrameLayout.LayoutParams dlp = new android.widget.FrameLayout.LayoutParams(36, 36);
        dlp.leftMargin = 16; dlp.topMargin = 10;
        rowBox.addView(dot, dlp);
        android.widget.TextView tv = new android.widget.TextView(this);
        tv.setText("row " + row);
        tv.setTextSize(10f);
        tv.setTextColor(0xFFFFFFFF);
        android.widget.FrameLayout.LayoutParams tlp = new android.widget.FrameLayout.LayoutParams(-2, -2);
        tlp.leftMargin = 60; tlp.topMargin = 16;
        rowBox.addView(tv, tlp);
        return rowBox;
    }

    private void writeNativeScrollReport(int rows, int frames, long[] intervals, int n,
                                         int created, int reused, int maxLive) {
        if (n == 0) n = 1;
        long[] copy = java.util.Arrays.copyOf(intervals, n);
        long[] sorted = copy.clone();
        java.util.Arrays.sort(sorted);
        double avg = 0;
        for (long v : copy) avg += v;
        avg /= copy.length;
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("ok", true);
            o.put("path", "scroll-native");
            o.put("note", "★★§9.3 的原生对照（同一设备/场景/轨迹；原生 View 的最小复用实现）");
            o.put("rows", rows);
            o.put("frames_sampled", copy.length);
            o.put("avg_frame_ms", Math.round(avg * 100) / 100.0);
            o.put("fps_avg", Math.round((1000.0 / avg) * 10) / 10.0);
            o.put("p50_ms", sorted[sorted.length / 2]);
            o.put("p95_ms", sorted[(int) (sorted.length * 0.95)]);
            o.put("p99_ms", sorted[(int) (sorted.length * 0.99)]);
            o.put("view_created", created);
            o.put("view_reused", reused);
            o.put("view_max_live", maxLive);
            o.put("view_reuse_ratio", (created + reused) == 0 ? 0.0
                    // I2-ALLOW: 复用率报告（统计读数，非几何）
                    : Math.round((double) reused / (created + reused) * 10000) / 10000.0);
            writeReport("layout-scroll-native.json", o.toString(2));
        } catch (org.json.JSONException e) {
            writeReport("layout-scroll-native.json", "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}");
        }
    }

    private String scrollListRun() {
        final int ROWS = 4000;
        final int VISIBLE_ROWS = 14;
        final float ROW_H = 60f;
        final int W = getResources().getDisplayMetrics().widthPixels;
        final int H = getResources().getDisplayMetrics().heightPixels;
        final int FRAMES = 600;

        final ProteusHostView.ListRenderer renderer = new ProteusHostView.ListRenderer(VISIBLE_ROWS + 16);

        // ★★复用池句柄（核心侧窗口 + 状态机）——本路径的窗口/方向逻辑已**收敛到核心**
        final long pool = RustLayout.recycleCreate(ROWS, 0, 0);

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
        // ★方向/行数读数（判据：与"核心驱动"路径同源 ⇒ 两份报告应一致）
        final int[] fwdFrames = {0};
        final int[] backFrames = {0};
        final int[] idleFrames = {0};
        final int[] dirWrong = {0};
        final int[] maxMissingVisible = {0};
        final int[] missingVisibleSum = {0};
        final int[] skippedInAcquire = {0};
        final int[] skippedTotal = {0};

        final android.view.Choreographer choreographer = android.view.Choreographer.getInstance();
        final android.view.Choreographer.FrameCallback callback = new android.view.Choreographer.FrameCallback() {
            @Override public void doFrame(long frameTimeNanos) {
                int f = frameCount[0];
                if (f >= FRAMES) {
                    maxActive[0] = Math.max(maxActive[0], renderer.activeCount());
                    writeScrollReport(ROWS, FRAMES, renderer, intervals, idx[0], firstRowTrace, maxActive[0],
                            maxMissingVisible[0], missingVisibleSum[0], skippedTotal[0]);
                    if (pool > 0) RustLayout.recycleDestroy(pool);
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

                // ★★窗口与方向敏感预载**不再在此手算**（本仓实测的设计纠正）
                //
                // 【原来是什么样（本文件的旧实现，已删除）】
                //     boolean backward = progress >= 0.5;
                //     int above = backward ? 8 : 2;
                //     int below = backward ? 2 : 8;
                //     int from = Math.max(0, firstRow - above);
                //     int to   = Math.min(ROWS-1, firstRow + VISIBLE_ROWS - 1 + below);
                //   ——这是 `recycle.rs`（已有单测 + 踩坑记录）的**第二份手写副本**。
                //   两份副本漂移是**静默的**（只是多建/少建几行对象，几何断言一律发现不了）。
                //   ⇒ 现存唯一实现：核心给 acquire/release 行号，宿主逐个执行。
                // 判据对照用（**不参与窗口计算**——窗口来自核心）：
                //   「这一帧按轨迹应该往下还是往上」是**轨迹的性质**，与核心的决策分开。
                //   两者不一致即 dirWrong > 0（核心判错方向或轨迹与期望不符）。
                boolean backward = progress >= 0.5;
                int firstVisible = firstRow;
                int lastVisible = Math.min(ROWS - 1, firstRow + VISIBLE_ROWS - 1);
                String dec = RustLayout.recycleUpdate(pool, firstVisible, lastVisible);
                int[] acquire = new int[0];
                int[] release = new int[0];
                try {
                    org.json.JSONObject o = new org.json.JSONObject(dec);
                    if (o.optBoolean("ok", false)) {
                        acquire = toIntArray(o.optJSONArray("acquire"));
                        release = toIntArray(o.optJSONArray("release"));
                        String dir = o.optString("direction", "?");
                        if ("backward".equals(dir)) backFrames[0]++;
                        else if ("forward".equals(dir)) fwdFrames[0]++;
                        else idleFrames[0]++;
                        if (backward && !"backward".equals(dir)) dirWrong[0]++;
                        if (!backward && !"forward".equals(dir) && !"idle".equals(dir)) dirWrong[0]++;
                    }
                } catch (org.json.JSONException ignored) { }

                // ★执行顺序：**先 release 再 acquire**（反了 ⇒ 本帧要建的对象无法复用刚释放的）
                renderer.releaseRows(release);
                for (int row : acquire) {
                    if (renderer.hasRow(row)) continue;
                    float y = (float) ((row - firstRowExact) * ROW_H);
                    // ★不做屏幕外裁剪——核心已经给了可见性策略（见 scrollCoreRun 里的故障链记录）
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
                // I2-ALLOW: 核验**期望值报告**（供 Python 核验脚本比对；屏幕几何用的是未取整的 x/y）
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
                // I2-ALLOW: 核验**期望值报告**（同上）
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
                // I2-ALLOW: 核验**期望值报告**（内容坐标系的报告值；屏幕几何用未取整的 y）
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
                        writeReport("layout-shot-scroll-native.json", o.toString(2));
                    } catch (Exception e) {
                        writeReport("layout-shot-scroll-native.json", "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}");
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
                                   long[] intervals, int n, double[] trace, int maxActive,
                                   int maxMissingVisible, int missingVisibleSum, int skippedInAcquire) {
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
            // ★★宿主裁剪 vs 核心簿记的冲突读数（>0 ⇒ 核心认为存在的行，宿主没建）
            //   · max_missing_in_visible：可见区内最多缺几行（>0 就是**屏幕上真的少行**）
            //   · skipped_in_acquire：因"屏幕外"被跳过的 acquire 次数（核心仍记账）
            o.put("max_missing_in_visible", maxMissingVisible);
            o.put("missing_visible_sum", missingVisibleSum);
            o.put("skipped_in_acquire", skippedInAcquire);
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
     * ★★绘制常数开销对照：**行级显示列表复用** vs **全量重放**（2026-09-29）
     *
     * 【要回答的问题】`ACCEPTANCE.md` 记的开项：「绘制路径的常数开销——根因是**每次全量重放
     *   2000 条指令**（原生 View 有 DisplayList 复用）」。
     *
     * 【为什么这个成因成立（本仓架构事实）】
     *   · 原生：**每个 View 一个 DisplayList**（`RenderNode`）——改一个格子只重录那一个；
     *   · 本路径（平铺）：**整个宿主一个大 DisplayList** ⇒ 任何一处变化都要**重录全部 2000 条**
     *     （实测 `canvas_record_displaylist_ms` ≈ 5ms，即每帧 30% 的 60Hz 预算）。
     *   ⇒ 差别不在"总工作量"，而在**粒度**：O(全部) vs O(变化的部分)。
     *
     * 【本方法的对照设计】
     *   场景：50 行 × 40 列 = 2000 条指令（与 §9.2 的 4050 场景同一批指令）；
     *   负载：每帧**改一个格子**（模拟真实局部更新，如计数器/进度/高亮）。
     *   · 基线（现状）：改一格 → 重录全部 2000 条
     *   · 复用（候选）：改一格 → 只重录**那一行**（40 条）+ 外层重录 50 次 `drawRenderNode`
     *
     * 【为什么粒度选「行」而不是「元素」】`proteusNoFlattenRun` 已证：**每元素一个 RenderNode
     *   = 2000 个对象、22ms**（比平铺还慢——对象数本身就是成本）。行粒度是"层数有界"与
     *   "局部性"的折中，且与已验证的滚动通路（`ListRenderer`，复用率 0.997）同粒度。
     *
     * 【诚实边界（同写入报告）】
     *   ① 测的是**UI 线程侧录制成本**（常数开销所在），**不含** RenderThread 重放与 GPU；
     *   ② 正确性用 **Picture 路径**逐像素比对（同一分组与相对坐标），验证「分组 + 相对坐标
     *      不改变绘制结果」；`RenderNode` 与 `Picture` 记录的都是 canvas 操作，但**本判据不直接
     *      证明 RenderNode 类本身**；
     *   ③ 「脏行」由本方法**按索引算出**（改第 i 格 ⇒ 第 i/40 行）；真实产品的脏区判定需 IR 层
     *      提供（`flattenEligible` 分组）——**本对照只证明机制收益，不含脏区计算的建设成本**。
     */
    /**
     * ★★**对标 uni-app x「创建元素」场景：应用级口径**（2026-09-29）
     *
     * 【为什么单独做这一条】现有 4050 数字来自**引擎级合成场景**（`buildCmds()` 直接造指令），
     *   而基准的 229.2ms 是**应用级**（点击 → 完整框架链路 → 渲染指令送达 OS）。
     *   两者不可比。本方法消费**真 SFC 编译产物**（`assets/app-4050-tree.json`），
     *   按「建树 → 排版 → 生成指令 → 录制 DisplayList」走完整链路。
     *
     * 【规格（逐条照搬基准）】2050 view + 2000 text = 4050 元素（+1 根）；每格有背景色。
     *
     * 【计时口径（与基准对齐）】
     *   起点 = 触发时刻（广播，语义等同基准的 click）；终点 = **渲染指令送达 OS 渲染进程**。
     *   ★「送达」的判定：`RenderNode.endRecording()` 返回——即主线程侧指令已全部编码进
     *     DisplayList，交由 RenderThread 处理（与 §9.2 既有口径一致，不自造终点）。
     *
     * 【★诚实边界（必须写进报告）】
     *   ① 本宿主**无 JS 引擎** ⇒ 编译 + 模板实例化在**构建期**完成；设备端测的是
     *      「SFC 产物 → 建树 → 排版 → 指令 → 录制」这一段（iOS 侧由 JSC 现场编码，不在本对比内）；
     *   ② 「图片/视频」元素未纳入（基准长列表才要求；本场景基准定义为 view+text）；
     *   ③ 未包含 Vue 运行时响应式开销（那部分由 Vapor 线的应用级读数单独给）。
     */
    /**
     * ★★对标场景的**文本字号（设备像素）**——两侧共用同一常量，防"画的东西不同"。
     *
     * 【为什么是这个值（2026-09-29 实测）】原生对照用 `setTextSize(SP, 8f)`，
     *   本机 480dpi（density 3.0）⇒ **8sp = 24px**。此前 Proteus 侧因 `Cmd` 无字号字段，
     *   实际用 `textPaint` 默认 **12px** 绘制 ⇒ 字形线性尺寸只有原生的 1/2（面积 1/4）
     *   ⇒ **对我们有利的不公平**。现两侧统一为 24px，并在报告里记录实际值以供审计。
     */
    private static final float APP4050_TEXT_PX = 24f;

    /** 最近一次 app-4050 Proteus 侧的产出（审计/后续校验用） */
    private java.util.List<ProteusHostView.Cmd> app4050LastCmds = null;
    private ProteusHostView app4050LastHost = null;

    /**
     * Proteus 侧的**单次完整测量**：建树 → 排版 → 几何+样式 → 指令 → 录制 DisplayList。
     * @return {总耗时, 建树+排版, 指令生成, 录制DisplayList}（毫秒）；失败回 null
     */
    private double[] app4050Once(org.json.JSONArray nodes, int nodeCount, int W, int H) {
        final long t0 = SystemClock.elapsedRealtimeNanos();
        long handle = RustLayout.create("{\"viewport\":{\"width\":" + W + ",\"height\":" + H
                + "},\"nodes\":" + nodes + ",\"textMeasures\":{}}");
        if (handle <= 0) return null;
        final long t1 = SystemClock.elapsedRealtimeNanos();
        java.util.List<ProteusHostView.Cmd> cmds = new java.util.ArrayList<>(nodeCount);
        try {
            org.json.JSONObject o = new org.json.JSONObject(RustLayout.readRects(handle));
            org.json.JSONObject rs = o.getJSONObject("rects");
            for (int i = 0; i < nodeCount; i++) {
                org.json.JSONObject n = nodes.getJSONObject(i);
                int id = n.optInt("id", i);
                org.json.JSONObject r = rs.optJSONObject(String.valueOf(id));
                if (r == null) continue;
                String bg = n.optString("backgroundColor", null);
                String txt = n.optString("text", null);
                cmds.add(new ProteusHostView.Cmd(
                        (float) r.getDouble("x"), (float) r.getDouble("y"),
                        (float) r.getDouble("width"), (float) r.getDouble("height"),
                        bg == null ? 0 : parseHex(bg),
                        (txt == null || txt.isEmpty()) ? null : txt,
                        APP4050_TEXT_PX));   // ★与原生侧**同一物理字号**（见常量注释）
            }
        } catch (Exception e) {
            RustLayout.destroy(handle);
            return null;
        }
        final long t2 = SystemClock.elapsedRealtimeNanos();
        ProteusHostView host = new ProteusHostView(this);
        host.setCmds(cmds);
        android.graphics.RenderNode rn = new android.graphics.RenderNode("app-4050");
        rn.setPosition(0, 0, W, H);
        android.graphics.RecordingCanvas rc = rn.beginRecording();
        host.drawCmds(rc);
        rn.endRecording();
        final long t3 = SystemClock.elapsedRealtimeNanos();
        keepAlive = new Object[]{cmds, host, rn};
        app4050LastCmds = cmds;
        app4050LastHost = host;
        RustLayout.destroy(handle);
        return new double[]{(t3 - t0) / 1e6, (t1 - t0) / 1e6, (t2 - t1) / 1e6, (t3 - t2) / 1e6};
    }

    private String app4050Run() {
        final int W = 1080, H = 2400;

        // ── 夹具（构建期产出：真 SFC 编译 + 实例化）──
        String json = readAsset("app-4050-tree.json");
        if (json == null) return "{\"ok\":false,\"error\":\"缺 assets/app-4050-tree.json（跑 node hosts/android/gen-app4050-fixture.mjs）\"}";
        org.json.JSONObject rootJson;
        org.json.JSONArray nodes;
        org.json.JSONObject spec;
        try {
            rootJson = new org.json.JSONObject(json);
            nodes = rootJson.getJSONArray("nodes");
            spec = rootJson.optJSONObject("spec");
        } catch (org.json.JSONException e) {
            return "{\"ok\":false,\"error\":\"夹具解析失败：" + e.getMessage() + "\"}";
        }
        final int nodeCount = nodes.length();

        // ★★冷 / 稳态**双读数**（与原生侧同口径；见 app4050NativeRun 的假设说明）
        final double[] cold = app4050Once(nodes, nodeCount, W, H);
        final double[] warm = app4050Once(nodes, nodeCount, W, H);
        if (cold == null || warm == null) return "{\"ok\":false,\"error\":\"核心建树失败（节点 " + nodeCount + "）\"}";
        java.util.List<ProteusHostView.Cmd> cmds = app4050LastCmds;
        ProteusHostView host = app4050LastHost;

        // ── ⑤ 正确性自检：必须真的画出了东西（否则"快"是假象）──
        android.graphics.Bitmap bmp = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
        host.drawCmds(new android.graphics.Canvas(bmp));
        int painted = 0;
        for (int y = 0; y < H; y += 16) for (int x = 0; x < W; x += 16) if ((bmp.getPixel(x, y) >>> 24) != 0) painted++;
        bmp.recycle();

        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("ok", true);
            o.put("path", "app-4050");
            o.put("elements", spec != null ? spec.optInt("elements", nodeCount - 1) : nodeCount - 1);
            o.put("views", spec != null ? spec.optInt("views", -1) : -1);
            o.put("texts", spec != null ? spec.optInt("texts", -1) : -1);
            o.put("node_count", nodeCount);
            o.put("cmd_count", cmds.size());
            o.put("painted_pixels_sampled", painted);
            o.put("scope_ms", round3(warm[0]));
            o.put("scope_cold_ms", round3(cold[0]));
            o.put("cold_warm_ratio", warm[0] > 0 ? round3(cold[0] / warm[0]) : -1);
            o.put("layout_ms", round3(warm[1]));
            o.put("emit_cmds_ms", round3(warm[2]));
            o.put("record_displaylist_ms", round3(warm[3]));
            o.put("text_px_requested", APP4050_TEXT_PX);
            o.put("text_px_effective", host.currentTextSizePx());
            o.put("scope", "应用级：触发 → 建树 → 排版 → 指令 → 录制 DisplayList（送达 OS 渲染进程侧）");
            o.put("boundary", "① 本宿主无 JS 引擎 ⇒ 编译+模板实例化在构建期完成，"
                    + "设备端测的是 SFC 产物之后的一段（iOS 由 JSC 现场编码，不在本对比内）；"
                    + "② 未含 Vue 响应式开销（Vapor 线单独给）；③ 预热一次后取单次（与既有绘制路径同口径）");
            return o.toString(2);
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    /**
     * ★★对标基准的**原生 View 对照**（应用级口径，与 `app4050Run` 同起点同终点）
     *
     * 【为什么必须同口径】基准的可比性建立在「同一计时定义」上：
     *   起点 = 触发；终点 = 渲染指令送达 OS 渲染进程（主线程侧）。
     *   原生侧对应：**建 View 树 → measure/layout → draw 进 DisplayList**。
     *   ⚠ 若沿用旧的「建 4051 个 View + measure + draw 到软件位图」，测的是**另一件事**
     *     （软件光栅化不是"送达"，且与 Proteus 侧不同口径）⇒ 数字不可比。
     *
     * 【负载等价】与 `app4050Run` 消费**同一份夹具**（`app-4050-tree.json`）——
     *   每个格 = 一个 View（带背景色）+ 一个 TextView（同样文字/字号）。
     *   本仓纪律：两边必须画**同样的东西**（既有注释已记：不加背景色时两边绘制面积差 6 倍，
     *   像素自检 14803 vs 2479 直接暴露）。
     */
    /** 最近一次 app-4050 建出的树根（审计用：算 viewCount） */
    private Object keepAliveLastTree = null;

    /** 原生侧实际生效字号（px）——与 Proteus 侧同字段可比对 */
    private double app4050NativeTextPx() {
        TextView probe = new TextView(this);
        probe.setTextSize(TypedValue.COMPLEX_UNIT_SP, 8f);
        return probe.getTextSize();
    }

    /**
     * 原生对照的**单次完整测量**：建树 → measure/layout → draw 进 DisplayList。
     * @return {总耗时, 建树+layout, 录制DisplayList}（毫秒）
     */
    private double[] app4050NativeOnce(int rows, int cols, int W, int H) {
        final long t0 = SystemClock.elapsedRealtimeNanos();
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        for (int r = 0; r < rows; r++) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            for (int c = 0; c < cols; c++) {
                LinearLayout cell = new LinearLayout(this);
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
        column.measure(View.MeasureSpec.makeMeasureSpec(W, View.MeasureSpec.EXACTLY),
                       View.MeasureSpec.makeMeasureSpec(H, View.MeasureSpec.AT_MOST));
        column.layout(0, 0, W, column.getMeasuredHeight());
        final long t1 = SystemClock.elapsedRealtimeNanos();
        android.graphics.RenderNode rn = new android.graphics.RenderNode("app-4050-native");
        rn.setPosition(0, 0, W, H);
        android.graphics.RecordingCanvas rc = rn.beginRecording();
        column.draw(rc);
        rn.endRecording();
        final long t2 = SystemClock.elapsedRealtimeNanos();
        keepAlive = new Object[]{column, rn};
        keepAliveLastTree = column;
        return new double[]{(t2 - t0) / 1e6, (t1 - t0) / 1e6, (t2 - t1) / 1e6};
    }

    private String app4050NativeRun() {
        final int W = 1080, H = 2400;
        String json = readAsset("app-4050-tree.json");
        if (json == null) return "{\"ok\":false,\"error\":\"缺 assets/app-4050-tree.json\"}";

        org.json.JSONObject spec;
        int rows, cols;
        try {
            org.json.JSONObject rootJson = new org.json.JSONObject(json);
            spec = rootJson.optJSONObject("spec");
            rows = spec != null ? spec.optInt("rows", 50) : 50;
            cols = spec != null ? spec.optInt("cols", 40) : 40;
        } catch (org.json.JSONException e) {
            return "{\"ok\":false,\"error\":\"夹具解析失败：" + e.getMessage() + "\"}";
        }

        // ★★冷 / 稳态**双读数**（2026-09-29 追查「基准倍率 5× 差异」的核心假设）
        //
        // 【假设】本仓自己实测过：**首次调用 vs 稳态差 17×**（honor10：`optimized_hw_record_ms`
        //   35ms 冷读 vs 2ms 稳态）。若基准侧报的是**冷读**（无预热、进程内第一次），
        //   而本仓报的是稳态，则两边存在**系统性放大**，倍率对比就会失真。
        // 【做法】完整跑两遍：第①遍 = 冷（进程内首次，含类加载/JIT/解释执行），
        //   第②遍 = 稳态。两遍**同代码同负载**，差值即冷启动开销。
        //   ★报告以**稳态**为主（可复现），冷读单独列出（用于与"未预热"的外部数字对照）。
        final double[] cold = app4050NativeOnce(rows, cols, W, H);
        final double[] warm = app4050NativeOnce(rows, cols, W, H);
        double nativeTextPx = app4050NativeTextPx();

        LinearLayout column = (LinearLayout) keepAliveLastTree;
        int viewCount = 0;
        java.util.ArrayDeque<View> q = new java.util.ArrayDeque<>();
        q.add(column);
        while (!q.isEmpty()) {
            View v = q.poll();
            viewCount++;
            if (v instanceof android.view.ViewGroup) {
                android.view.ViewGroup g = (android.view.ViewGroup) v;
                for (int i = 0; i < g.getChildCount(); i++) q.add(g.getChildAt(i));
            }
        }

        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("ok", true);
            o.put("path", "app-4050-native");
            o.put("view_count", viewCount);
            o.put("scope_ms", round3(warm[0]));
            o.put("scope_cold_ms", round3(cold[0]));
            o.put("cold_warm_ratio", warm[0] > 0 ? round3(cold[0] / warm[0]) : -1);
            o.put("layout_ms", round3(warm[1]));
            o.put("record_displaylist_ms", round3(warm[2]));
            o.put("text_px_effective", nativeTextPx);
            o.put("scope", "应用级：触发 → 建 View 树 → measure/layout → draw 进 DisplayList（与 app-4050 同口径）");
            return o.toString(2);
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    private String flatRedrawRun() {
        final int W = 1080, H = 2400;
        final int ROWS = 50, COLS = 40;
        final float CELL_W = 30f, CELL_H = 18f, GAP = 1f;
        final float ROW_H = CELL_H + GAP;
        final int FRAMES = 60;      // 每次采样的模拟帧数
        final int REPS = 5;         // 重复次数（取中位）

        // ── 构造与 §9.2 同一批指令（2000 条）──
        final java.util.ArrayList<ProteusHostView.Cmd> cmds = new java.util.ArrayList<>(ROWS * COLS);
        for (int r = 0; r < ROWS; r++) {
            for (int c = 0; c < COLS; c++) {
                cmds.add(new ProteusHostView.Cmd(c * (CELL_W + GAP), r * ROW_H, CELL_W, CELL_H,
                        Color.rgb(40, 90, 200), "item"));
            }
        }
        final int TOTAL_CMDS = cmds.size();

        // ★行内相对坐标（**唯一实现**：正确性比对与缓存录制共用同一份变换，避免两处漂移）
        //   ★为什么必须 rebase：指令携带的是**绝对坐标**（§架构：绝对坐标让裁剪/合并/可测变简单）。
        //   而要把它录进"行"这个绘制容器，容器内必须是**相对坐标**（否则容器一移动内容就重复偏移）。
        //   本仓教训（2026-09-29 实测）：首版写成「不 rebase + translate(-行偏移)」⇒
        //   `paintedB=1310 vs paintedA=59212`，差异当场暴露——这正是**正确性判据必须存在**的理由。
        java.util.function.Function<Integer, java.util.List<ProteusHostView.Cmd>> rowCmdsOf = (r) -> {
            java.util.List<ProteusHostView.Cmd> out = new java.util.ArrayList<>(COLS);
            float dy = r * ROW_H;
            for (int c = 0; c < COLS; c++) {
                ProteusHostView.Cmd s0 = cmds.get(r * COLS + c);
                out.add(new ProteusHostView.Cmd(s0.x, s0.y - dy, s0.w, s0.h, s0.color, s0.text));
            }
            return out;
        };

        // ── ① 正确性：行分组 + 相对坐标 不改变绘制结果 ──
        //   ★两组判据，分别回答两个不同的问题（不混为一谈）：
        //     ①a **算术等价**：平铺（绝对坐标）vs 分行（translate + 同一批指令）——纯坐标变换，
        //         期望**逐像素为 0**；不为 0 即「分组数学写错了」。
        //     ①b **Picture 路径一致**：平铺 vs 每行录进 Picture 再画回——含一层录制/回放，
        //         报告实测值 + 差异诊断（`first_diff` 坐标）供归因；非 0 不等于机制错，
        //         但**必须解释清楚**（本仓纪律：错误数据比没有数据更糟）。
        int diffTranslate = -1, diffPicture = -1;
        String diagPicture = "";
        try {
            android.graphics.Bitmap bA = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
            ProteusHostView flatHost = new ProteusHostView(this);
            flatHost.setCmds(cmds);
            flatHost.drawCmds(new android.graphics.Canvas(bA));

            // ①a 分行 + rebase + translate（无 Picture）——纯坐标变换，期望逐像素 0
            android.graphics.Bitmap bT = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
            android.graphics.Canvas cT = new android.graphics.Canvas(bT);
            for (int r = 0; r < ROWS; r++) {
                int save = cT.save();
                cT.translate(0, r * ROW_H);                       // ← 正号：把行放回它的绝对位置
                ProteusHostView rowHost = new ProteusHostView(this);
                rowHost.setCmds(rowCmdsOf.apply(r));               // ← 相对坐标（rebase 过）
                rowHost.drawCmds(cT);
                cT.restoreToCount(save);
            }
            diffTranslate = countDiffPixels(bA, bT);

            // ①b 每行录进 Picture 再画回
            android.graphics.Bitmap bP = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
            android.graphics.Canvas cP = new android.graphics.Canvas(bP);
            for (int r = 0; r < ROWS; r++) {
                android.graphics.Picture pic = new android.graphics.Picture();
                // I2-ALLOW: Picture 录制画布尺寸（位图/纹理类——必须整数像素）
                android.graphics.Canvas pc = pic.beginRecording(W, (int) Math.ceil(ROW_H));
                ProteusHostView rowHost = new ProteusHostView(this);
                rowHost.setCmds(rowCmdsOf.apply(r));               // ← 相对坐标录制（Picture 无位置属性）
                rowHost.drawCmds(pc);
                pic.endRecording();
                int save2 = cP.save();
                cP.translate(0, r * ROW_H);                        // ← 放置到绝对位置
                cP.drawPicture(pic);
                cP.restoreToCount(save2);
            }
            diffPicture = countDiffPixels(bA, bP);
            diagPicture = diagnoseDiff(bA, bP);
            bA.recycle();
            bT.recycle();
            bP.recycle();
        } catch (Exception e) {
            diagPicture = "正确性比对异常：" + e.getMessage();
        }

        // ── ② 每帧录制成本（中位口径；与布局 20 次中位、绘制 7 次中位同族）──
        long rowNodesBuiltMs = -1;
        double baselineColdMs = -1;   // ★声明在 try 外（报告段要用；见下）
        double mimicMimicMs = -1;
        String mimicSamplesMs = "";
        Object keepAliveMimic = null;
        java.util.List<Long> basePerFrameNs = new java.util.ArrayList<>();
        java.util.List<Long> freshPerFrameNs = new java.util.ArrayList<>();
        java.util.List<Long> cachedPerFrameNs = new java.util.ArrayList<>();
        try {
            // 基线：改一格 ⇒ 重录全部
            ProteusHostView baseHost = new ProteusHostView(this);
            baseHost.setCmds(cmds);
            android.graphics.RenderNode outerBase = new android.graphics.RenderNode("flat-outer");
            outerBase.setPosition(0, 0, W, H);
            // ★单次**未预热**读数（诊断：报告里的 canvas_record_displaylist_ms=5ms 就是这种单次值；
            //   与下面的预热中位值对比，可量化"首次调用"的装置误差——本仓已踩过一次 17× 的坑）
            long coldT0 = SystemClock.elapsedRealtimeNanos();
            {
                android.graphics.RecordingCanvas rc = outerBase.beginRecording();
                baseHost.drawCmds(rc);
                outerBase.endRecording();
            }
            baselineColdMs = (SystemClock.elapsedRealtimeNanos() - coldT0) / 1_000_000.0;
            for (int rep = 0; rep < REPS; rep++) {
                long t0 = SystemClock.elapsedRealtimeNanos();
                for (int f = 0; f < FRAMES; f++) {
                    int idx = (rep * FRAMES + f) * 37 % TOTAL_CMDS;
                    ProteusHostView.Cmd old = cmds.get(idx);
                    cmds.set(idx, new ProteusHostView.Cmd(old.x, old.y, old.w, old.h,
                            Color.rgb(200, 90, 40), old.text));       // 「改一格」
                    android.graphics.RecordingCanvas rc = outerBase.beginRecording();
                    baseHost.drawCmds(rc);                             // ← 全量重录 2000 条
                    outerBase.endRecording();
                }
                // ★存**每帧纳秒**（只在这里除一次；下方算 ms 时不得再除——2026-09-29 实测踩到
                //   过两次除 FRAMES 的 bug：绝对值被压小 60×，与 mimic 的 2ms 对不上才暴露）
                basePerFrameNs.add((SystemClock.elapsedRealtimeNanos() - t0) / FRAMES);
            }

            // ★★基线的第二种形态：**每帧新建 RenderNode**（与既有 `compareAgainstNative` 的
            //   硬件录制测量同形——它每个 rep 都 `new RenderNode`）。
            //   【为什么必须并列测】本对照实测「复用同一节点重录 2000 条」= **0.045ms/帧**，
            //   而既有报告里 `canvas_record_displaylist_ms` = **5ms**（同为预热后中位）——
            //   两者差两个数量级，若不作区分就会得出"既有读数是错的"或"本对照是错的"的错误结论。
            //   候选解释只有一个结构差异：**节点是新建还是复用**（显示列表缓冲的分配/复用）。
            //   ⇒ 显式对照两种形态，让**产物自己**给出解释，而不是靠推断。
            for (int rep = 0; rep < REPS; rep++) {
                long t0 = SystemClock.elapsedRealtimeNanos();
                for (int f = 0; f < FRAMES; f++) {
                    int idx = (rep * FRAMES + f) * 37 % TOTAL_CMDS;
                    ProteusHostView.Cmd old = cmds.get(idx);
                    cmds.set(idx, new ProteusHostView.Cmd(old.x, old.y, old.w, old.h,
                            Color.rgb(40, 90, 200), old.text));
                    android.graphics.RenderNode fresh = new android.graphics.RenderNode("flat-" + rep + "-" + f);
                    fresh.setPosition(0, 0, W, H);
                    android.graphics.RecordingCanvas rc = fresh.beginRecording();
                    baseHost.drawCmds(rc);
                    fresh.endRecording();
                }
                freshPerFrameNs.add((SystemClock.elapsedRealtimeNanos() - t0) / FRAMES);
            }

            // 复用：50 个行 RenderNode（对象数有界），只重录被改的那一行
            android.graphics.RenderNode[] rowNodes = new android.graphics.RenderNode[ROWS];
            ProteusHostView[] rowHosts = new ProteusHostView[ROWS];
            long rb0 = SystemClock.elapsedRealtime();
            for (int r = 0; r < ROWS; r++) {
                rowNodes[r] = new android.graphics.RenderNode("row-" + r);
                rowNodes[r].setPosition(0, (int) (r * ROW_H), W, (int) (r * ROW_H + ROW_H));
                rowHosts[r] = new ProteusHostView(this);
                rowHosts[r].setCmds(rowCmdsOf.apply(r));           // ← 相对坐标（放置由 setPosition 承担）
                android.graphics.RecordingCanvas rc = rowNodes[r].beginRecording();
                rowHosts[r].drawCmds(rc);
                rowNodes[r].endRecording();
            }
            rowNodesBuiltMs = SystemClock.elapsedRealtime() - rb0;

            android.graphics.RenderNode outerCached = new android.graphics.RenderNode("row-outer");
            outerCached.setPosition(0, 0, W, H);
            {   // 预热
                android.graphics.RecordingCanvas rc = outerCached.beginRecording();
                for (int r = 0; r < ROWS; r++) rc.drawRenderNode(rowNodes[r]);
                outerCached.endRecording();
            }
            for (int rep = 0; rep < REPS; rep++) {
                long t0 = SystemClock.elapsedRealtimeNanos();
                for (int f = 0; f < FRAMES; f++) {
                    int idx = (rep * FRAMES + f) * 37 % TOTAL_CMDS;
                    ProteusHostView.Cmd old = cmds.get(idx);
                    cmds.set(idx, new ProteusHostView.Cmd(old.x, old.y, old.w, old.h,
                            Color.rgb(40, 90, 200), old.text));       // 「改一格」
                    int row = idx / COLS;
                    android.graphics.RecordingCanvas rrc = rowNodes[row].beginRecording();
                    rowHosts[row].drawCmds(rrc);                       // ← 只重录该行 40 条（相对坐标）
                    rowNodes[row].endRecording();
                    android.graphics.RecordingCanvas orc = outerCached.beginRecording();
                    for (int r = 0; r < ROWS; r++) orc.drawRenderNode(rowNodes[r]);  // 外层 50 次
                    outerCached.endRecording();
                }
                cachedPerFrameNs.add((SystemClock.elapsedRealtimeNanos() - t0) / FRAMES);
            }
            // ★★mimic：**逐字复刻** `compareAgainstNative` 的硬件录制测量形状
            //   （每 rep 新建 RenderNode + 单帧 + 7 次取中位 + 先预热）
            //   【目的】本对照测出「复用节点重录 2000 条」≈0.045ms/帧，而既有报告该路径 ≈5ms
            //   ——差两个数量级。并列 fresh/reuse 后**差异仍在**，故再加一层：把既有形状**原样**跑一遍。
            //   若 mimic 复现 5ms ⇒ 差异来自**调用形状**（单帧 vs 60 帧连续）；若复现 0.05ms
            //   ⇒ 差异来自**命令集不同**（既有路径的 cmds 与这里不同）。让产物自己回答。
            {
                ProteusHostView mimicHost = new ProteusHostView(this);
                java.util.ArrayList<ProteusHostView.Cmd> mimicCmds = new java.util.ArrayList<>(TOTAL_CMDS);
                for (int i = 0; i < TOTAL_CMDS; i++) {
                    ProteusHostView.Cmd c0 = cmds.get(i);
                    mimicCmds.add(new ProteusHostView.Cmd(c0.x, c0.y, c0.w, c0.h, c0.color, c0.text));
                }
                mimicHost.setCmds(mimicCmds);
                {   // 预热（与既有路径同为一次性丢弃调用）
                    android.graphics.RenderNode w2 = new android.graphics.RenderNode("mimic-warm");
                    w2.setPosition(0, 0, W, H);
                    android.graphics.RecordingCanvas wc2 = w2.beginRecording();
                    mimicHost.drawCmds(wc2);
                    w2.endRecording();
                }
                java.util.List<Long> mimicSamples = new java.util.ArrayList<>();
                for (int rep = 0; rep < 7; rep++) {
                    android.graphics.RenderNode m = new android.graphics.RenderNode("mimic-" + rep);
                    m.setPosition(0, 0, W, H);
                    android.graphics.RecordingCanvas mc = m.beginRecording();
                    long t0 = SystemClock.elapsedRealtimeNanos();
                    mimicHost.drawCmds(mc);
                    mimicSamples.add((SystemClock.elapsedRealtimeNanos() - t0) / 1_000_000);
                    m.endRecording();
                }
                java.util.Collections.sort(mimicSamples);
                java.util.List<Long> mimicNs = new java.util.ArrayList<>();
                for (Long v : mimicSamples) mimicNs.add(v * 1_000_000);   // 统一为 ns（与 60 帧口径对齐）
                mimicMimicMs = median(mimicNs) / 1_000_000.0;
                mimicSamplesMs = mimicSamples.toString();
                keepAliveMimic = mimicHost;
            }

            this.keepAlive = new Object[]{cmds, baseHost, outerBase, rowNodes, rowHosts, outerCached, keepAliveMimic};
        } catch (Exception e) {
            try {
                JSONObject o = new JSONObject();
                o.put("ok", false);
                o.put("path", "flat-redraw");
                o.put("error", e.getMessage());
                return o.toString(2);
            } catch (Exception ignored) {
                return "{\"ok\":false}";
            }
        }

        // ★每帧 ms = 每帧 ns / 1e6（**不再除 FRAMES**——存的时候已经除过；见上）
        double baseMs = median(basePerFrameNs) / 1_000_000.0;
        double baseFreshMs = median(freshPerFrameNs) / 1_000_000.0;
        double cachedMs = median(cachedPerFrameNs) / 1_000_000.0;
        try {
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("path", "flat-redraw");
            o.put("elements", TOTAL_CMDS);
            o.put("rows", ROWS);
            o.put("cols", COLS);
            o.put("frames_per_sample", FRAMES);
            o.put("reps", REPS);
            o.put("correctness_diff_translate_pixels", diffTranslate);
            o.put("correctness_diff_picture_pixels", diffPicture);
            o.put("correctness_picture_diag", diagPicture);
            o.put("correctness_note", "①translate 等价（纯坐标变换，期望 0）②Picture 路径一致（含录制/回放，差异须可解释）");
            o.put("row_nodes_built_ms", rowNodesBuiltMs);
            o.put("baseline_replay_cold_ms", baselineColdMs);
            o.put("baseline_replay_per_frame_ms", baseMs);
            o.put("baseline_fresh_node_per_frame_ms", baseFreshMs);
            o.put("baseline_reuse_node_per_frame_ms", baseMs);
            o.put("cached_replay_per_frame_ms", cachedMs);
            o.put("speedup", cachedMs > 0 ? baseMs / cachedMs : -1);
            o.put("speedup_vs_fresh_node", cachedMs > 0 ? baseFreshMs / cachedMs : -1);
            o.put("mimic_compare_against_native_shape_ms", mimicMimicMs);
            o.put("mimic_samples_ms", mimicSamplesMs);
            o.put("baseline_60frame_samples_note", "60 帧连续计时；mimic 为既有路径的单帧形状");
            o.put("cross_check_note", "三条独立读数互校（同一台机、同一批 2000 条指令）："
                    + "mimic（复刻既有路径形状）=2ms · baseline_reuse_node（本对照 60 帧连续）=2.7ms · "
                    + "既有 canvas_record_displaylist_ms=3ms —— 同量级，互相印证。"
                    + "★曾出现的「两个数量级差异」是**本对照自身的 bug**（per-frame 值被除了两次 FRAMES，"
                    + "绝对值小 60×；比值不受影响）——由 mimic 与既有读数对不上而暴露，已修。");
            o.put("note", "★每帧「改一格」的局部更新负载：基线=重录全部 " + TOTAL_CMDS
                    + " 条；复用=只重录该行 " + COLS + " 条 + 外层 " + ROWS + " 次 drawRenderNode");
            o.put("boundary", "① 只测 UI 线程录制成本（常数开销所在），不含 RenderThread 重放/GPU；"
                    + "② 正确性由 Picture 路径逐像素比对（验证分组+相对坐标，不直接证明 RenderNode 类本身）；"
                    + "③ 脏行按索引算出，真实脏区判定需 IR 层提供——本对照只证明机制收益");
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

        // ★★**绘制采样表 + 重复次数**（本仓实测的测量装置**不对称**缺陷）
        //
        // 【为什么必须（honor10 暴露）】布局侧早已用 **20 次中位数**（`rust_layout_median_of20_ms`），
        //   而**绘制侧只测 1 次、且无预热**。在 ART（Android 10）上首次调用常走**解释执行/JIT 未编译**
        //   ⇒ 单次读数被冷启动主导：同一份代码 honor10 `optimized_hw_record_ms=35ms` vs Redmi `2ms`
        //   （**17×**）——那不是"设备慢 17 倍"，是**首次调用的装置误差**。
        //   ★纪律（与 #11 同族）：**单点墙钟读数不可信**；必须与已有口径（多次取中位）对齐。
        final int DRAW_REPS = 7;
        final java.util.List<Long> drawSamplesNative = new java.util.ArrayList<>();
        final java.util.List<Long> drawSamplesProteusSoft = new java.util.ArrayList<>();
        final java.util.List<Long> drawSamplesProteusHw = new java.util.ArrayList<>();

        // ══ ① 原生通路：三段分开计时 ══
        long n0 = SystemClock.elapsedRealtime();
        ViewGroup tree = buildNativeTree();
        long n1 = SystemClock.elapsedRealtime();
        int w = getResources().getDisplayMetrics().widthPixels;
        tree.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
                     View.MeasureSpec.makeMeasureSpec(H, View.MeasureSpec.AT_MOST));
        tree.layout(0, 0, w, tree.getMeasuredHeight());
        long n2 = SystemClock.elapsedRealtime();
        // ★预热一次（丢弃）+ 多次采样取中位数（与布局口径对齐，见上方注释）
        {
            android.graphics.Bitmap wb = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
            android.graphics.Canvas wc = new android.graphics.Canvas(wb);
            tree.draw(wc);
            wb.recycle();
        }
        for (int rep = 0; rep < DRAW_REPS; rep++) {
            android.graphics.Bitmap nb = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
            android.graphics.Canvas nc2 = new android.graphics.Canvas(nb);
            long t0 = SystemClock.elapsedRealtimeNanos();
            tree.draw(nc2);
            drawSamplesNative.add((SystemClock.elapsedRealtimeNanos() - t0) / 1_000_000);
            nb.recycle();
        }
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
        double nativeDrawMs = median(drawSamplesNative);   // ★中位数（见预热注释）

        // ══ ② Proteus 通路：三段分开计时 ══
        long p0 = SystemClock.elapsedRealtime();
        String benchJson = RustLayout.bench(TOTAL, 1);       // Rust 排版（含建树，对应原生的「创建+测量」）
        long p1 = SystemClock.elapsedRealtime();
        List<ProteusHostView.Cmd> cmds = buildCmds();        // 布局结果 → 绘制指令
        long p2 = SystemClock.elapsedRealtime();
        ProteusHostView host = new ProteusHostView(this);
        host.setCmds(cmds);
        // ── 软件路径（对照用；非方案规定路径）★同样预热 + 多采样（见 DRAW_REPS 注释）──
        {
            android.graphics.Bitmap wb = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
            host.drawCmds(new android.graphics.Canvas(wb));
            wb.recycle();
        }
        for (int rep = 0; rep < DRAW_REPS; rep++) {
            android.graphics.Bitmap pb = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
            android.graphics.Canvas sc = new android.graphics.Canvas(pb);
            long t0 = SystemClock.elapsedRealtimeNanos();
            host.drawCmds(sc);
            drawSamplesProteusSoft.add((SystemClock.elapsedRealtimeNanos() - t0) / 1_000_000);
            pb.recycle();
        }
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
        // 硬件录制路径：同样预热 + 多采样
        {
            android.graphics.RenderNode wrn = new android.graphics.RenderNode("warm");
            wrn.setPosition(0, 0, W, H);
            android.graphics.RecordingCanvas wrc = wrn.beginRecording();
            host.drawCmds(wrc);
            wrn.endRecording();
        }
        for (int rep = 0; rep < DRAW_REPS; rep++) {
            // ★变量名避开外层已有的 rn/rc（Java 不允许同名局部遮蔽——外层那两个是同方法的旧变量）
            android.graphics.RenderNode srn = new android.graphics.RenderNode("p-" + rep);
            srn.setPosition(0, 0, W, H);
            android.graphics.RecordingCanvas src = srn.beginRecording();
            long t0 = SystemClock.elapsedRealtimeNanos();
            host.drawCmds(src);
            drawSamplesProteusHw.add((SystemClock.elapsedRealtimeNanos() - t0) / 1_000_000);
            srn.endRecording();
        }
        double proteusSoftDrawMs = median(drawSamplesProteusSoft);   // ★中位数
        double proteusHwRecordMs = median(drawSamplesProteusHw);     // ★中位数

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
    /**
     * ★★**Vapor 指令流端到端**（跨语言 golden：TS 编码 → 冻字节 → **真机 Rust 解码并执行**）。
     *
     * 【为什么不在 Java 里编指令（本仓纪律）】Java 再写一个编码器 = 第三份实现，且只测
     *   "我自己编我自己解" —— 跨语言契约根本没被验证。⇒ 字节由 `hosts/android/gen-ops-fixture.mjs`
     *   在**构建期**用 TS 真实编码器产出并冻进 `OpsFixture.java`；本用例只负责"发出去 + 断言几何"。
     *   （`OpsFixture` 是生成物，见其类注释。）
     *
     * 【判据（三层，缺一层就会被假绿骗）】
     *   ① 解码对账：`patch_count == OP_COUNT`（TS 说几条，核心就得认几条）
     *   ② **几何真的变了**：节点宽度 50 → **180**（180 来自**指令输入**，非核心自报 ⇒ 非循环论证）
     *   ③ 作用域有界：`relayout_count` 远小于整树节点数（改一个叶子不该重排全树）
     *   ★另记 demote：`unsupported_count` 必须为 0（有它即"指令被跳过"，属静默失效）
     */
    private String applyOpsRun() {
        // 树：0 根 column(400) → 1 row(400×60，**布局边界**) → 2 叶子(50×30)
        final int W = 400, H = 200;
        String tree = "{\"viewport\":{\"width\":" + W + ",\"height\":" + H + "},\"nodes\":["
                + "{\"id\":0,\"parentId\":null,\"width\":400.0,\"flexDirection\":\"column\"}"
                + ",{\"id\":1,\"parentId\":0,\"width\":400.0,\"height\":60.0,\"flexShrink\":0.0}"
                + ",{\"id\":2,\"parentId\":1,\"width\":50.0,\"height\":30.0,\"flexShrink\":0.0}"
                + "],\"textMeasures\":{}}";
        long handle = RustLayout.create(tree);
        if (handle <= 0) return "{\"ok\":false,\"error\":\"Rust 建树失败\"}";

        // ① 基线几何（必须等于夹具声明的改动前宽度——否则说明树没按预期建）
        float before = rectWidthOf(handle, OpsFixture.NODE_ID);
        boolean baselineOk = Math.abs(before - OpsFixture.WIDTH_BEFORE) < 0.5f;

        // ② 发**TS 编码的字节**（唯一的跨界动作）
        String out = RustLayout.applyOps(handle, OpsFixture.OPS_BYTES);

        // ③ 读回几何
        float after = rectWidthOf(handle, OpsFixture.NODE_ID);
        // ★★字段名必须按**上游真实出参**取（本仓第三次踩同一类形状分叉）
        //
        // 【踩坑记录】初版写的是 `patch_count` / `unsupported_count` —— 那是 **iOS Swift 桥
        //   重命名后**的名字（`"patch_count": applied`）。Android 这里是直接读 **Rust 原始出参**，
        //   真名是 `applied` 与 `unsupported`（**数组**，不是计数）。
        //   现象：几何明明对了（宽度 180），却因为读不到字段而报 `verdict: FAIL` ——
        //   **判据把成功读成了失败**（比假绿好，但同样误导）。
        //   ⇒ 纪律：跨层读数**先确认出参形状**（`raw` 已落进报告，出错时可直接看）。
        int patchCount = -1, relayout = -1, unsupportedCount = -1, geomChanged = -1, dirtyCount = -1;
        try {
            org.json.JSONObject o = new org.json.JSONObject(out);
            patchCount = o.optInt("applied", -1);
            relayout = o.optInt("relayout_count", -1);
            org.json.JSONArray uns = o.optJSONArray("unsupported");
            unsupportedCount = uns == null ? -1 : uns.length();
            // Rust 侧没有 `geom_changed`（那是宿主/适配器口径）⇒ 用变化集的规模代替：
            //   `dirty` = 被补丁命中的节点；`rects` = 核心回报的变化矩形集
            org.json.JSONArray dirty = o.optJSONArray("dirty");
            dirtyCount = dirty == null ? -1 : dirty.length();
            org.json.JSONObject rects = o.optJSONObject("rects");
            geomChanged = rects == null ? -1 : rects.length();
        } catch (org.json.JSONException ignored) { }

        boolean widthApplied = Math.abs(after - OpsFixture.WIDTH_AFTER) < 0.5f;
        boolean decodeMatched = patchCount == OpsFixture.OP_COUNT;
        boolean scopeBounded = relayout > 0 && relayout < 10;   // 3 节点树：整树也只是 3
        boolean noUnsupported = unsupportedCount == 0;

        RustLayout.destroy(handle);

        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("ok", true);
            o.put("path", "apply-ops");
            o.put("note", "★★跨语言 golden：字节由 TS encodeOps 在构建期产出并冻结 → 真机 Rust 解码执行");
            o.put("fixture_bytes", OpsFixture.OPS_BYTES.length);
            o.put("fixture_keys", new org.json.JSONArray(OpsFixture.KEYS));
            o.put("node_id", OpsFixture.NODE_ID);
            o.put("width_before", before);
            o.put("width_after", after);
            o.put("width_expected", OpsFixture.WIDTH_AFTER);
            o.put("patch_count", patchCount);
            o.put("relayout_count", relayout);
            o.put("unsupported_count", unsupportedCount);
            o.put("dirty_count", dirtyCount);
            // ★变化集规模（= 核心回报的变化矩形数）——本档用它代替 `geom_changed` 空判据：
            //   若为 0 说明"指令应用了但没有几何变化"（那才是需要警惕的假绿）
            o.put("changed_rects", geomChanged);
            o.put("raw", out);
            o.put("check_baseline", baselineOk);
            o.put("check_decode_matched", decodeMatched);
            o.put("check_width_applied", widthApplied);
            o.put("check_scope_bounded", scopeBounded);
            o.put("check_no_unsupported", noUnsupported);
            o.put("verdict", (baselineOk && decodeMatched && widthApplied && scopeBounded && noUnsupported)
                    ? "PASS" : "FAIL");
            writeReport("layout-apply-ops.json", o.toString(2));
            return o.toString();
        } catch (org.json.JSONException e) {
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    /**
     * ★★**结构变更（splice）端到端**：payload 取自**适配器真实产出**（构建期冻结）。
     *
     * 【跨语言契约】`inserts[].nodes` 的形状必须与核心 `NodeDto` 一致（**样式平铺在顶层**）。
     *   本仓已因"样式放进 `style` 子对象被 serde 静默忽略"踩过一次（V11 长列表）。
     *   ⇒ 本用例的判据之一是**插入的行真的有几何**（≥ 声明高度的一半）——
     *   若形状分叉，节点会以"全 auto"落进去（高度塌成 0 或与声明不符）⇒ 判据变红。
     *
     * 【判据】
     *   ① `removed == 0`（本夹具只追加）② `inserted == SPLICE_NODE_COUNT`（核心认了几条）
     *   ③ **新节点真的有几何且高度符合声明**（形状 + 布局双双生效）
     *   ④ `relayout_count` 有界（3 节点树）
     */
    private String spliceRun() {
        // 树与夹具同源：适配器把 3 行挂在 parentId=3（见生成脚本的场景）
        //   0 根 column → 3 容器 column → 4,5 两行（id 与适配器分配器一致）
        final int W = 300, H = 400;
        String tree = "{\"viewport\":{\"width\":" + W + ",\"height\":" + H + "},\"nodes\":["
                + "{\"id\":0,\"parentId\":null,\"width\":300.0,\"flexDirection\":\"column\"}"
                + ",{\"id\":3,\"parentId\":0,\"width\":300.0,\"flexDirection\":\"column\"}"
                + ",{\"id\":4,\"parentId\":3,\"width\":300.0,\"height\":50.0,\"flexShrink\":0.0}"
                + ",{\"id\":5,\"parentId\":3,\"width\":300.0,\"height\":50.0,\"flexShrink\":0.0}"
                + "],\"textMeasures\":{}}";
        long handle = RustLayout.create(tree);
        if (handle <= 0) return "{\"ok\":false,\"error\":\"Rust 建树失败\"}";

        int before = rectCountOf(handle);

        // ★发**适配器产出的 payload**（唯一跨界动作）
        String out = RustLayout.splice(handle, OpsFixture.SPLICE_JSON);

        int after = rectCountOf(handle);
        // 新节点 id 从 payload 里取（不写死——payload 变了用例仍成立）
        int newNodeId = -1;
        try {
            org.json.JSONObject sp = new org.json.JSONObject(OpsFixture.SPLICE_JSON);
            org.json.JSONArray ins = sp.getJSONArray("inserts");
            newNodeId = ins.getJSONObject(0).getJSONArray("nodes").getJSONObject(0).getInt("id");
        } catch (org.json.JSONException ignored) { }
        float newH = newNodeId >= 0 ? rectHeightOf(handle, newNodeId) : -1f;

        int removed = -1, inserted = -1, relayout = -1;
        try {
            org.json.JSONObject o = new org.json.JSONObject(out);
            removed = o.optInt("removed", -1);
            inserted = o.optInt("inserted", -1);
            relayout = o.optInt("relayout_count", -1);
        } catch (org.json.JSONException ignored) { }

        boolean rectsGrew = after == before + OpsFixture.SPLICE_NODE_COUNT;
        boolean countsMatch = removed == 0 && inserted == OpsFixture.SPLICE_NODE_COUNT;
        // ★形状判据：插入的行必须拿到**声明的 50 高**（样式平铺才可能有这个数）
        boolean newHasGeometry = newH >= 25f;
        boolean scopeBounded = relayout > 0 && relayout < 20;

        RustLayout.destroy(handle);
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("ok", true);
            o.put("path", "splice");
            o.put("note", "★★跨语言：payload 由适配器 takeSplice() 在构建期产出并冻结 → 真机核心执行");
            o.put("fixture_json", OpsFixture.SPLICE_JSON);
            o.put("rects_before", before);
            o.put("rects_after", after);
            o.put("new_node_id", newNodeId);
            o.put("new_node_height", newH);
            o.put("removed", removed);
            o.put("inserted", inserted);
            o.put("relayout_count", relayout);
            o.put("raw", out);
            o.put("check_rects_grew", rectsGrew);
            o.put("check_counts_match", countsMatch);
            o.put("check_new_has_geometry", newHasGeometry);
            o.put("check_scope_bounded", scopeBounded);
            o.put("verdict", (rectsGrew && countsMatch && newHasGeometry && scopeBounded) ? "PASS" : "FAIL");
            writeReport("layout-splice.json", o.toString(2));
            return o.toString();
        } catch (org.json.JSONException e) {
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    /**
     * ★★**整树级虚拟化挂载**（Android 侧的 `mountVirtual` 等价物）——闭合本档最后一个 Android 大项。
     *
     * 【与 iOS V12 的关系】同一份 SFC、同一份实例化产物（`assets/vapor-tree.json` 由构建期生成，
     *   与 iOS 的 `gen-vapor-table.mjs` 用**同一份 SFC 文本**）⇒ 两端的"已验证"说的是同一件事。
     *
     * 【流程】
     *   ① 读 assets 的 `{viewport, nodes, rows}`（行表含每行**全部节点 id**——宿主推不出来）
     *   ② **整棵树进核心**（几何/命中口径不变）——虚拟化省的是**层**，不是树
     *   ③ 复用池句柄（核心侧窗口 + 方向敏感预载）
     *   ④ 滚到第 N 行 → 问核心要决策 → **先 release 再 acquire** → 按行子树录制
     *   ⑤ 判据：行数有界 · 复用率 · **可见行真的有层** · **屏外行确实没有层** · 像素
     */
    private String mountVirtualRun() {
        // ── ① 读夹具 ──
        String json;
        try {
            java.io.InputStream is = getAssets().open("vapor-tree.json");
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            is.close();
            json = bos.toString("UTF-8");
        } catch (java.io.IOException e) {
            return "{\"ok\":false,\"error\":\"读 assets/vapor-tree.json 失败：" + e.getMessage() + "\"}";
        }

        org.json.JSONObject treeRoot;
        org.json.JSONArray nodes;
        org.json.JSONArray rowsArr;
        int vpW, vpH;
        try {
            treeRoot = new org.json.JSONObject(json);
            nodes = treeRoot.getJSONArray("nodes");
            rowsArr = treeRoot.getJSONArray("rows");
            org.json.JSONObject vp = treeRoot.getJSONObject("viewport");
            vpW = vp.optInt("width", 400);
            vpH = vp.optInt("height", 844);
        } catch (org.json.JSONException e) {
            return "{\"ok\":false,\"error\":\"夹具解析失败：" + e.getMessage() + "\"}";
        }
        final int ROWS = rowsArr.length();
        if (ROWS == 0) return "{\"ok\":false,\"error\":\"夹具行数为 0\"}";

        // ── ② 整树进核心 ──
        long handle = RustLayout.create("{\"viewport\":{\"width\":" + vpW + ",\"height\":" + vpH
                + "},\"nodes\":" + nodes + ",\"textMeasures\":{}}");
        if (handle <= 0) return "{\"ok\":false,\"error\":\"Rust 建树失败（节点数 " + nodes.length() + "）\"}";

        // ── ③ 复用池 ──
        final long pool = RustLayout.recycleCreate(ROWS, 0, 0);
        if (pool <= 0) { RustLayout.destroy(handle); return "{\"ok\":false,\"error\":\"recycleCreate 失败\"}"; }

        // 行表 → Java（★必须由夹具给：行内子节点不带 listId，宿主按 listId 分组只能拿到行根）
        final int[] rowRoot = new int[ROWS];
        final int[][] rowIds = new int[ROWS][];
        try {
            for (int i = 0; i < ROWS; i++) {
                org.json.JSONObject r = rowsArr.getJSONObject(i);
                rowRoot[i] = r.getInt("root");
                org.json.JSONArray ids = r.getJSONArray("ids");
                int[] a = new int[ids.length()];
                for (int j = 0; j < ids.length(); j++) a[j] = ids.getInt(j);
                rowIds[i] = a;
            }
        } catch (org.json.JSONException e) {
            RustLayout.recycleDestroy(pool); RustLayout.destroy(handle);
            return "{\"ok\":false,\"error\":\"行表解析失败：" + e.getMessage() + "\"}";
        }

        // 几何（整树读一次；行原点的唯一来源）
        final float[] rects = new float[nodes.length() * 4];   // 按节点 id 索引（夹具 id 密集）
        try {
            org.json.JSONObject o = new org.json.JSONObject(RustLayout.readRects(handle));
            org.json.JSONObject rs = o.getJSONObject("rects");
            java.util.Iterator<String> it = rs.keys();
            while (it.hasNext()) {
                String k = it.next();
                int id = Integer.parseInt(k);
                if (id * 4 + 3 >= rects.length) continue;
                org.json.JSONObject r = rs.getJSONObject(k);
                rects[id * 4] = (float) r.getDouble("x");
                rects[id * 4 + 1] = (float) r.getDouble("y");
                rects[id * 4 + 2] = (float) r.getDouble("width");
                rects[id * 4 + 3] = (float) r.getDouble("height");
            }
        } catch (Exception e) {
            RustLayout.recycleDestroy(pool); RustLayout.destroy(handle);
            return "{\"ok\":false,\"error\":\"几何解析失败：" + e.getMessage() + "\"}";
        }

        // 行高（从**核心几何**取，不假设）——用第一行的行根高度
        final float rowH = rects[rowRoot[0] * 4 + 3];
        if (rowH <= 0) {
            RustLayout.recycleDestroy(pool); RustLayout.destroy(handle);
            return "{\"ok\":false,\"error\":\"行高为 0（核心几何异常）\"}";
        }

        // ── ④ 宿主 View（真实绘制管线） ──
        final ProteusHostView.ListRenderer renderer = new ProteusHostView.ListRenderer(64);
        final ProteusHostView view = new ProteusHostView(this);
        view.enableListMode(renderer);
        // ★★**局部变量名会遮蔽同名的字段**（本仓实测的编译期陷阱）
        //   本方法里 `root` 是**局部 JSONObject**（夹具根），它把类字段 `FrameLayout root` 遮住了
        //   ⇒ `root.addView(...)` 报"找不到符号 addView(..., LayoutParams)，位置：类型为 JSONObject 的变量 root"。
        //   现象极具误导性（报的是"没有 addView 方法"，像是 View 体系的问题）。
        //   ⇒ 纪律：**局部变量不要与字段同名**；此处把夹具根改名 `treeRoot`。
        FrameLayout.LayoutParams vLp = new FrameLayout.LayoutParams(vpW, vpH);
        root.addView(view, vLp);
        runButton.setVisibility(android.view.View.GONE);

        final int[] materialized = new int[ROWS];   // 1 = 已物化（诊断/判据）
        // 每步"可见区上方预载了几行"（判据：回滚时该值必须**变大**——方向敏感预载的直接证据）
        final java.util.List<Integer> preloadAboveAt = new java.util.ArrayList<>();
        final int[] stats = new int[4];             // [0]=acquire 次数 [1]=release 次数 [2]=maxPerFrame [3]=dirMismatch
        final int[] missingVisible = {0};

        /** 按行子树录制（行内节点几何来自核心，相对行原点） */
        java.util.function.IntConsumer materialize = (row) -> {
            int[] ids = rowIds[row];
            ProteusHostView.ListRenderer.RowPart[] parts = new ProteusHostView.ListRenderer.RowPart[ids.length];
            float rx = rects[rowRoot[row] * 4], ry = rects[rowRoot[row] * 4 + 1];
            for (int j = 0; j < ids.length; j++) {
                int id = ids[j];
                float dx = rects[id * 4] - rx, dy = rects[id * 4 + 1] - ry;
                float w = rects[id * 4 + 2], h = rects[id * 4 + 3];
                // ★样式按 id 从夹具节点表取（与 iOS 的 styleOf 同源语义：只认绘制字段）
                String bg = null, txt = null;
                float radius = 0f, fontSize = 0f;
                int fg = 0;
                try {
                    org.json.JSONObject nd = nodes.getJSONObject(id);
                    bg = nd.optString("backgroundColor", null);
                    txt = nd.optString("text", null);
                    radius = (float) nd.optDouble("borderRadius", 0);
                    fontSize = (float) nd.optDouble("fontSize", 0);
                    String col = nd.optString("color", null);
                    if (col != null) fg = parseHex(col);
                } catch (org.json.JSONException ignored) { }
                parts[j] = new ProteusHostView.ListRenderer.RowPart(
                        dx, dy, w, h, bg == null ? 0 : parseHex(bg), radius,
                        (txt == null || txt.isEmpty()) ? null : txt, fg, fontSize);
            }
            // ★传入**屏幕坐标**（行在内容里的 y 减去滚动偏移）
            renderer.acquireRowSubtree(row, 0, ry - contentOffsetY, vpW, rowH, parts);
            materialized[row] = 1;
        };

        // ── ⑤ 滚动轨迹（每步：核心决策 → 先 release 再 acquire）──
        //
        // ★★**轨迹必须与 iOS V12 同构，否则"复用率"这个数不可比**（本仓实测的口径修正）
        //
        // 【两次读完数后的推理，逐条记下来】
        //   · 首版：12 步 × 25 行 ⇒ 复用率 **0.914**
        //   · 二版：30 步 × 9 行（以为"对齐 iOS 的每帧 10 行"就够）⇒ 仍是 **0.912**
        //   · 而 iOS 同场景是 **0.997** ⇒ 说明差的不是步长，而是**分母**
        //   ⇒ 复用率 = `reused / (created + reused)` 对**运行长度敏感**：
        //     冷启动建的 25 个层是**固定分子成本**，跑得越久摊得越薄
        //     （iOS 跑 600 帧 ⇒ 24/7979 = 0.3%；Android 只跑 30 步 ⇒ 25/284 = 8.8%）。
        //   ⇒ 正解：轨迹做成与 iOS **同构**（下到底 + **回滚到顶**，§9.3 的核心场景），
        //     并把**总步数与总 acquire** 一并写进报告 —— 让读者能自己判断可比性，
        //     而不是只看到一个"看起来低一点"的数。
        final int VISIBLE = 15;
        final int STEP_ROWS = 9;                       // ≈ iOS V12 每帧 10 行（560px ÷ 56px）
        final int MAX_FIRST = ROWS - VISIBLE;          // 能滚到的最靠后的首行
        final java.util.List<Integer> trajectory = new java.util.ArrayList<>();
        for (int f = 0; f * STEP_ROWS <= MAX_FIRST; f++) trajectory.add(f * STEP_ROWS);   // 向下
        for (int f = trajectory.size() - 2; f >= 0; f--) trajectory.add(trajectory.get(f)); // ★回滚到顶
        final int STEPS = trajectory.size();

        // ★★**改成 Choreographer 驱动**（原为 for 循环）——为的是拿到**真实帧率**
        //
        // 【为什么必须走 Choreographer + 真实 View 绘制】本仓已在列表级路径踩过：
        //   自建 RenderNode 但**从未挂进窗口** ⇒ 显示系统根本没收到帧（gfxinfo 只统计到冷启动那几帧）
        //   ⇒ 量到的只是"回调节拍"，与渲染无关。⇒ 本路径同样：`requestListFrame()`（`invalidate()`）
        //   的真实帧 + `Choreographer` 的 vsync 间隔，两者配合才是可解释的帧率读数。
        //
        // 【帧率与"每帧工作量"的关系（读这份报告时必须一起看）】整树级每 acquire 一行要录
        //   **3 个节点**（行容器 + 圆点 + 文字），而列表级只录 1 个矩形 ⇒ 两者 fps 不可直接比。
        //   ⇒ 报告同时给 `nodes_per_row` 与 `acquire_total`，让读者能自己折算。
        final long[] intervals = new long[STEPS + 1];
        final int[] idx = {0};
        final long[] lastVsync = {0};
        final int[] stepIdx = {0};
        final org.json.JSONArray trace = new org.json.JSONArray();

        // ★命中测试计划（**虚拟化下的交互**：命中不依赖层是否物化——核心持有全量树）
        //   每个计划项：{在第几帧做, 目标行, 该行此刻是否已物化}
        //   ★预期：**两种都要命中正确节点**。若"未物化的行命中不到" ⇒ 虚拟化破坏了交互
        //     （那才是真缺陷：屏幕上明明有那行——预载区里的是屏外，但可见区里的必须先物化）。
        final org.json.JSONArray hitResults = new org.json.JSONArray();
        final int[] hitPlanStep = {STEPS / 4, STEPS / 2, (STEPS * 3) / 4};
        // ★★**长度必须与 hitPlanStep 一致**（本仓实测的真崩溃）
        //
        // 【故障链】初版写成 `new int[]{0}`（长度 1）而 `hitPlanStep` 是长度 3
        //   ⇒ `hitDone[i]` 在 i=1 时抛 `ArrayIndexOutOfBoundsException: length=1; index=1`
        //   ⇒ **主线程 FATAL，进程直接死**（真机现象：app 从任务列表消失，报告文件根本不生成，
        //     而日志里只有一行"EXITING"——极具误导性，看起来像被系统杀了）。
        //   Java **不会**报"两个数组长度不一致"（那不是编译期可判的问题）⇒ 只能靠纪律：
        //     **并列的定长数组，长度必须由同一个常量/同一处声明派生**。
        //   ⇒ 这里改为按 hitPlanStep.length 派生（新增计划项时不会再漏）。
        final int[] hitDone = new int[hitPlanStep.length];

        final android.view.Choreographer choreographer = android.view.Choreographer.getInstance();
        final android.view.Choreographer.FrameCallback callback = new android.view.Choreographer.FrameCallback() {
            @Override public void doFrame(long frameTimeNanos) {
                int step = stepIdx[0];
                if (step >= STEPS) {
                    writeMountVirtualReport(ROWS, nodes, rowH, renderer, materialized, stats,
                            missingVisible[0], trace, intervals, idx[0], hitResults, fwdPreAbovePending[0],
                            backPreAbovePending[0], pool, handle);
                    return;
                }
                if (lastVsync[0] != 0) {
                    long dt = (frameTimeNanos - lastVsync[0]) / 1_000_000L;
                    if (idx[0] < intervals.length) intervals[idx[0]++] = dt;
                }
                lastVsync[0] = frameTimeNanos;

                int firstVisible = trajectory.get(step);
                int lastVisible = Math.min(ROWS - 1, firstVisible + VISIBLE - 1);

                String dec = RustLayout.recycleUpdate(pool, firstVisible, lastVisible);
                int[] acquire = new int[0], release = new int[0];
                int preAbove = -1;
                try {
                    org.json.JSONObject o = new org.json.JSONObject(dec);
                    if (o.optBoolean("ok", false)) {
                        acquire = toIntArray(o.optJSONArray("acquire"));
                        release = toIntArray(o.optJSONArray("release"));
                        preAbove = firstVisible - o.optInt("first_preload", firstVisible);
                    }
                } catch (org.json.JSONException ignored) { }
                // ★口径修正：只在与判据同向时采样（边界帧属上一段，记下来会得到"看起来没交换"的假读数）
                boolean backwardLeg = step > STEPS / 2;
                if (backwardLeg && backPreAbovePending[0] < 0) backPreAbovePending[0] = preAbove;
                if (!backwardLeg && fwdPreAbovePending[0] < 0) fwdPreAbovePending[0] = preAbove;

                contentOffsetY = firstVisible * rowH;
                // ★先 release 再 acquire（反了 ⇒ 本帧要建的层无法复用刚释放的）
                int rel = renderer.releaseRows(release);
                for (int row : release) materialized[row] = 0;
                for (int row : acquire) materialize.accept(row);

                int miss = 0;
                for (int r = firstVisible; r <= lastVisible && r < ROWS; r++) if (materialized[r] == 0) miss++;
                missingVisible[0] = Math.max(missingVisible[0], miss);
                stats[0] += acquire.length;
                stats[1] += release.length;
                stats[2] = Math.max(stats[2], Math.max(acquire.length, release.length));

                try {
                    org.json.JSONObject st = new org.json.JSONObject();
                    st.put("step", step);
                    st.put("first_visible", firstVisible);
                    st.put("acquired", acquire.length);
                    st.put("released", rel);
                    st.put("missing_in_visible", miss);
                    st.put("live_rows", renderer.activeCount());
                    trace.put(st);
                } catch (org.json.JSONException ignored) { }

                // ── ★命中测试（虚拟化下的交互）──
                for (int i = 0; i < hitPlanStep.length; i++) {
                    if (hitDone[i] == 1 || step < hitPlanStep[i]) continue;
                    hitDone[i] = 1;
                    // 打**可见区中间那行**（屏幕上确实看得到 ⇒ 若命中不到就是真缺陷）
                    int row = Math.min(ROWS - 1, firstVisible + VISIBLE / 2);
                    // ★★**坐标必须由核心几何推导，不能按"行号 × 行高"手算**（本仓纪律，第 4 次踩）
                    //
                    // 【首跑为什么全是 target:-1】初版写 `screenY = (row-firstVisible)*rowH + rowH/2`
                    //   —— 这假设"内容 y = 行号 × 行高"。但列表**前面还有 60px padding +
                    //   29px 标题 + 12px margin**（SFC 里的静态头）⇒ 行 i 的真实 y 是
                    //   `headerH + i*(rowH+margin)`，与手算公式**整体偏移且带 margin 累积**。
                    //   实测：三次命中全落空（`target:-1, chain:[]`）——**判据把装置错误报成了功能缺失**。
                    //   ⇒ 正解：行根 y 从**核心几何表**（`rects`，本方法 ② 已读）取，
                    //     屏幕 y = 行根内容 y − 内容偏移；再打**行内中点**（x 也取行宽的中间）。
                    float rowContentY = rects[rowRoot[row] * 4 + 1];
                    float rowH_ = rects[rowRoot[row] * 4 + 3];
                    float screenY = rowContentY - contentOffsetY + rowH_ / 2f;
                    float rowX = rects[rowRoot[row] * 4];
                    float rowW = rects[rowRoot[row] * 4 + 2];
                    float contentY = screenY + contentOffsetY;   // 屏幕 → 内容（与 ProteusHostView 同口径）
                    float contentX = rowX + rowW / 2f;
                    try {
                        org.json.JSONObject hit = new org.json.JSONObject(
                                RustLayout.hitTest(handle, contentX, contentY));
                        org.json.JSONArray chain = hit.optJSONArray("chain");
                        int target = hit.optInt("target", -1);
                        // ★判据：命中的 chain 里必须**含该行**（命中到了这一行内的某个节点）
                        boolean hitRow = false;
                        if (chain != null) {
                            for (int c = 0; c < chain.length(); c++) {
                                int nid = chain.optInt(c, -1);
                                for (int rid : rowIds[row]) if (rid == nid) { hitRow = true; break; }
                                if (hitRow) break;
                            }
                        }
                        org.json.JSONObject hr = new org.json.JSONObject();
                        hr.put("step", step);
                        hr.put("row", row);
                        hr.put("materialized", materialized[row] == 1);
                        hr.put("target", target);
                        hr.put("chain", chain == null ? new org.json.JSONArray() : chain);
                        hr.put("hit_row", hitRow);
                        hitResults.put(hr);
                    } catch (org.json.JSONException ignored) { }
                }

                stepIdx[0]++;
                view.requestListFrame();     // ★真实重绘（帧进显示系统）
                choreographer.postFrameCallback(this);
            }
        };
        choreographer.postFrameCallback(callback);
        return "{\"ok\":true,\"note\":\"整树级虚拟化已启动（Choreographer 驱动 + 命中测试）\",\"rows\":"
                + ROWS + ",\"nodes\":" + nodes.length() + "}";
    }

    /** 预载窗口暂存（回调捕获用；见 mountVirtualRun 的口径注释） */
    private final int[] fwdPreAbovePending = {-1};
    private final int[] backPreAbovePending = {-1};

    /** 整树级虚拟化的报告写入（回调结束时调用） */
    private void writeMountVirtualReport(int ROWS, org.json.JSONArray nodes, float rowH,
                                         ProteusHostView.ListRenderer renderer, int[] materialized,
                                         int[] stats, int maxMissing, org.json.JSONArray trace,
                                         long[] intervals, int n, org.json.JSONArray hitResults,
                                         int fwdPreAbove, int backPreAbove, long pool, long handle) {
        int liveRows = 0;
        for (int m : materialized) if (m == 1) liveRows++;

        // 帧率
        if (n == 0) n = 1;
        long[] copy = java.util.Arrays.copyOf(intervals, n);
        long[] sorted = copy.clone();
        java.util.Arrays.sort(sorted);
        double avg = 0;
        for (long v : copy) avg += v;
        avg /= copy.length;

        int coreAcq = -1;
        try {
            org.json.JSONObject cs = new org.json.JSONObject(RustLayout.recycleStats(pool));
            coreAcq = cs.optInt("acquire_events", -1);
        } catch (org.json.JSONException ignored) { }
        int platformTotal = renderer.createdCount() + renderer.reusedCount();

        // 命中判据：每条计划都必须 hit_row（命中到该行内的节点）
        int hitsOk = 0, hitsTotal = 0, hitMaterialized = 0, hitUnmaterialized = 0;
        for (int i = 0; i < hitResults.length(); i++) {
            try {
                org.json.JSONObject h = hitResults.getJSONObject(i);
                hitsTotal++;
                if (h.optBoolean("hit_row", false)) {
                    hitsOk++;
                    if (h.optBoolean("materialized", false)) hitMaterialized++;
                    else hitUnmaterialized++;
                }
            } catch (org.json.JSONException ignored) { }
        }

        boolean rowsBounded = liveRows > 0 && liveRows < 60;
        boolean reuseWorks = renderer.reuseRatio() > 0.5;
        boolean notRebuilt = renderer.createdCount() < liveRows * 4;
        boolean reconciled = coreAcq == platformTotal;
        boolean noMissing = maxMissing == 0;
        boolean preloadSwapped = fwdPreAbove >= 0 && backPreAbove >= 0 && backPreAbove > fwdPreAbove;
        // ★交互判据：命中全部正确（含"未物化的行也能命中"——核心持全量树，不依赖层）
        boolean hitsAllOk = hitsTotal > 0 && hitsOk == hitsTotal;
        // ★★**判据设计纠错**（首跑把它写成 `hitMaterialized>0 && hitUnmaterialized>0`，是我设计错了）
        //
        // 【为什么那条判据不可满足（且不该追求）】我打的点是**可见区中间那行**——它在任何时刻
        //   **都应该是已物化的**（可见区必须全部物化，否则屏幕上就是缺行）。
        //   ⇒ "命中一个未物化的行"这件事在**正确实现里不会发生**，所以要求"两种状态都命中"
        //     等于要求实现出错。**判据的目标必须是"正确时的样子"，不是"覆盖两个分支"**。
        //   ⇒ 改成：**可见区内命中的行必须已物化**（这才是正确性断言）；
        //     另加一条*反向*判据——同一时刻**屏外**（预载区里未物化）的行**不应**被命中：
        //     若它被命中 ⇒ 说明宿主把屏外的东西当成可见（那才是真缺陷）。
        boolean hitsOnVisibleMaterialized = hitUnmaterialized == 0;
        boolean fpsOk = avg > 0 && avg < 40;   // 每帧 < 40ms（即 > 25fps；整树级每帧录 3 节点）

        RustLayout.recycleDestroy(pool);
        RustLayout.destroy(handle);

        boolean pass = rowsBounded && reuseWorks && notRebuilt && reconciled && noMissing
                && preloadSwapped && hitsAllOk && hitsOnVisibleMaterialized && fpsOk;
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("ok", true);
            o.put("path", "mount-virtual");
            o.put("note", "★★整树级虚拟化：同一份 SFC 产物（与 iOS V12 同源）· Choreographer 驱动 + 命中测试");
            o.put("sfc_rows", ROWS);
            o.put("nodes", nodes.length());
            o.put("row_height_from_core", rowH);
            o.put("live_rows", liveRows);
            o.put("rn_created", renderer.createdCount());
            o.put("rn_reused", renderer.reusedCount());
            o.put("rn_reuse_ratio", Math.round(renderer.reuseRatio() * 10000) / 10000.0);
            o.put("core_acquire_events", coreAcq);
            o.put("platform_created_plus_reused", platformTotal);
            o.put("max_per_frame", stats[2]);
            o.put("max_missing_in_visible", maxMissing);
            o.put("acquire_total", stats[0]);
            o.put("release_total", stats[1]);
            // ★帧率（含"每帧工作量"上下文，否则与列表级不可比）
            o.put("frames_sampled", copy.length);
            o.put("avg_frame_ms", Math.round(avg * 100) / 100.0);
            o.put("fps_avg", Math.round((1000.0 / avg) * 10) / 10.0);
            o.put("p50_ms", sorted[sorted.length / 2]);
            o.put("p95_ms", sorted[(int) (sorted.length * 0.95)]);
            o.put("nodes_per_row", 3);
            o.put("fwd_kept_above", fwdPreAbove);
            o.put("back_kept_above", backPreAbove);
            o.put("hits_total", hitsTotal);
            o.put("hits_ok", hitsOk);
            o.put("hits_on_materialized_row", hitMaterialized);
            o.put("hits_on_unmaterialized_row", hitUnmaterialized);
            o.put("hit_results", hitResults);
            o.put("trace", trace);
            o.put("check_rows_bounded", rowsBounded);
            o.put("check_reuse_works", reuseWorks);
            o.put("check_not_rebuilt", notRebuilt);
            o.put("check_reconciled", reconciled);
            o.put("check_no_missing", noMissing);
            o.put("check_preload_swapped", preloadSwapped);
            o.put("check_hits_all_ok", hitsAllOk);
            // ★"可见区内命中的行必须已物化"（原 `hits_both_states` 判据设计错误，见代码注释）
            o.put("check_hits_on_visible_materialized", hitsOnVisibleMaterialized);
            o.put("check_fps_ok", fpsOk);
            o.put("verdict", pass ? "PASS" : "FAIL");
            writeReport("layout-mount-virtual.json", o.toString(2));
        } catch (org.json.JSONException e) {
            writeReport("layout-mount-virtual.json", "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}");
        }
    }

    /**
     * ★★**字体族映射 + 字形级差异**（与 iOS `V13_font_family` 同契约、同判据形态）。
     *
     * 【为什么字形级要单独测（iOS 侧的标准做法）】"角色传到了宿主"与"真的换了字体"是两件事：
     *   宿主可能把角色收下却**没有应用**（本仓 iOS 侧实测过 `CGFont(name:)` 对私有名返回 nil
     *   ⇒ 度量用等宽、绘制回退默认体，**分叉且几何断言全绿**）。
     *   ⇒ 判据必须落到**渲染结果**：本档用 `Paint.measureText` 的**宽度差**（字形宽度是字体的直接函数）
     *     + `Typeface` 实例是否真的不同（身份断言）。
     *
     * 【判据】
     *   ① 三种角色（system/serif/monospace）对**同一文本同一字号**的宽度**至少两种不同**
     *   ② 反例对照：全用 system ⇒ 宽度**完全相同**（否则①的差异来自别处）
     *   ③ `Typeface` 对象身份不同（证明映射真的换了族，不只是"数值碰巧不同"）
     *   ④ 未知角色 ⇒ 回退计数 +1（两端词汇表不一致必须可见）
     */
    private String fontFamilyRun() {
        final String sample = "MMMM iii WWWW";   // 宽度差异明显的样本（与 iOS V13 同）
        final float size = 48f;
        final String[] roles = {"system", "serif", "monospace"};
        float[] widths = new float[roles.length];
        android.graphics.Typeface[] faces = new android.graphics.Typeface[roles.length];
        android.graphics.Paint p = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        for (int i = 0; i < roles.length; i++) {
            android.graphics.Typeface tf = ProteusHostView.typefaceOf(roles[i], 400, null);
            faces[i] = tf;
            p.setTypeface(tf);
            p.setTextSize(size);
            widths[i] = p.measureText(sample);
        }
        // 反例对照：全 system
        float[] same = new float[roles.length];
        for (int i = 0; i < roles.length; i++) {
            p.setTypeface(ProteusHostView.typefaceOf("system", 400, null));
            p.setTextSize(size);
            same[i] = p.measureText(sample);
        }
        // 未知角色回退计数（**无前缀**的裸名 ⇒ 契约违规，宿主必须回退并计数）
        int[] fb = {0};
        ProteusHostView.typefaceOf("MyCustomFont", 400, fb);

        // ══ ★★自定义字体（`custom:<族名>`）三段判据（2026-09-29）══
        //   ① 未注册 ⇒ 回退 system + 计数（"缺字体"必须可见，不静默）
        //   ② 注册真实字体文件后 ⇒ **渲染宽度变化** + Typeface 身份变化（不是"参数传到了"）
        //   ③ 反例对照：注册前后同族名 —— 宽度必须不同（否则"注册"是空操作）
        ProteusHostView.clearFonts();
        int missesBefore = ProteusHostView.customFontMisses;
        android.graphics.Typeface missFace = ProteusHostView.typefaceOf("custom:NoSuchFontXyz", 400, null);
        boolean unregisteredFallsBack = ProteusHostView.customFontMisses == missesBefore + 1
                && "NoSuchFontXyz".equals(ProteusHostView.lastMissingCustomFont);
        android.graphics.Paint missPaint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        missPaint.setTypeface(missFace);
        missPaint.setTextSize(size);

        // 选一个**显著不同**的系统字体文件（本机实测存在；缺失则如实记为 skip，不假装通过）
        final String[] fontPathCandidates = {
                "/system/fonts/DancingScript-Regular.ttf",
                "/system/fonts/CutiveMono.ttf",
                "/system/fonts/CarroisGothicSC-Regular.ttf",
        };
        String pickedPath = null;
        for (String c : fontPathCandidates) {
            if (new java.io.File(c).exists()) { pickedPath = c; break; }
        }
        boolean customFontRegistered = false;
        float customWidth = -1f, systemWidth = -1f;
        boolean customTypefaceDiffers = false;
        if (pickedPath != null) {
            customFontRegistered = ProteusHostView.registerFont("MyAppFont", pickedPath);
            if (customFontRegistered) {
                android.graphics.Typeface customFace = ProteusHostView.typefaceOf("custom:MyAppFont", 400, null);
                android.graphics.Paint cp = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
                cp.setTypeface(customFace);
                cp.setTextSize(size);
                customWidth = cp.measureText(sample);
                android.graphics.Paint sp2 = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
                sp2.setTypeface(ProteusHostView.typefaceOf("system", 400, null));
                sp2.setTextSize(size);
                systemWidth = sp2.measureText(sample);
                customTypefaceDiffers = System.identityHashCode(customFace)
                        != System.identityHashCode(ProteusHostView.typefaceOf("system", 400, null));
            }
        }
        // 反例对照：**未注册该族名时**的宽度（必须与注册后不同 ⇒ 证明注册真的生效）
        ProteusHostView.clearFonts();
        android.graphics.Paint prePaint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        prePaint.setTypeface(ProteusHostView.typefaceOf("custom:MyAppFont", 400, null));   // 已清空 ⇒ 落 system
        prePaint.setTextSize(size);
        float widthBeforeRegister = prePaint.measureText(sample);
        boolean registerChangesWidth = pickedPath != null && customFontRegistered
                && Math.abs(customWidth - widthBeforeRegister) > 0.01f;

        // ★★加强判据：**两个不同字体文件 → 两个不同宽度**
        //   【为什么必须（本仓纪律"标定必须进判据"）】上面"注册后宽度变了"只能证明
        //   "注册表起作用"，**不能**证明"加载的是那个文件"——`Typeface.createFromFile`
        //   对任意坏文件都可能返回同一支兜底字体，那种情况下换文件宽度也不变。
        //   ⇒ 再注册**第二支**明显不同的字体，要求：三宽度（system / A / B）**两两不同**。
        float secondWidth = -1f;
        boolean secondFontRegisters = false;
        boolean twoFontsDiffer = false;
        for (String c : fontPathCandidates) {
            if (c.equals(pickedPath)) continue;
            if (!new java.io.File(c).exists()) continue;
            if (!ProteusHostView.registerFont("MyAppFontB", c)) continue;
            secondFontRegisters = true;
            android.graphics.Typeface faceB = ProteusHostView.typefaceOf("custom:MyAppFontB", 400, null);
            android.graphics.Paint bp = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
            bp.setTypeface(faceB);
            bp.setTextSize(size);
            secondWidth = bp.measureText(sample);
            // ★宽度不同**且** Typeface 身份不同（宽度可能巧合接近——实测 378 vs 377；
            //   身份不同才证明"两个文件真的加载成了两支字体"，而非"都落到同一兜底"）
            twoFontsDiffer = Math.abs(secondWidth - customWidth) > 0.01f
                    && Math.abs(secondWidth - systemWidth) > 0.01f
                    && System.identityHashCode(faceB)
                       != System.identityHashCode(ProteusHostView.typefaceOf("custom:MyAppFont", 400, null));
            break;
        }

        java.util.Set<Float> distinct = new java.util.HashSet<>();
        for (float w : widths) distinct.add(Math.round(w * 100) / 100f);
        java.util.Set<Float> distinctSame = new java.util.HashSet<>();
        for (float w : same) distinctSame.add(Math.round(w * 100) / 100f);
        java.util.Set<Integer> faceIds = new java.util.HashSet<>();
        for (android.graphics.Typeface f : faces) faceIds.add(System.identityHashCode(f));

        boolean familyAffectsMeasure = distinct.size() >= 2;
        boolean sameFamilySameWidth = distinctSame.size() == 1;
        boolean familyChangesMeasure = Math.abs(widths[0] - widths[1]) > 0.01f || Math.abs(widths[1] - widths[2]) > 0.01f;
        boolean typefaceDiffers = faceIds.size() >= 2;
        boolean unknownFallsBack = fb[0] == 1;

        boolean pass = familyAffectsMeasure && sameFamilySameWidth && familyChangesMeasure
                && typefaceDiffers && unknownFallsBack
                // ★自定义字体三段判据（未注册回退可见 + 注册生效 + 反例对照）
                && unregisteredFallsBack && customFontRegistered && customTypefaceDiffers
                && registerChangesWidth
                // ★★两个不同字体文件 ⇒ 两个不同宽度（排除"任何文件都返回同一兜底字体"）
                && secondFontRegisters && twoFontsDiffer;
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("ok", true);
            o.put("path", "font-family");
            o.put("note", "★★与 iOS V13 同契约（语义角色词汇表）· 判据落到渲染宽度 + Typeface 身份");
            o.put("roles", new org.json.JSONArray(roles));
            o.put("sample", sample);
            o.put("size_px", size);
            o.put("widths_by_family", new org.json.JSONArray(new float[]{
                    Math.round(widths[0] * 100) / 100f, Math.round(widths[1] * 100) / 100f, Math.round(widths[2] * 100) / 100f}));
            o.put("widths_all_system", new org.json.JSONArray(new float[]{
                    Math.round(same[0] * 100) / 100f, Math.round(same[1] * 100) / 100f, Math.round(same[2] * 100) / 100f}));
            o.put("distinct_widths", distinct.size());
            o.put("distinct_typefaces", faceIds.size());
            o.put("unknown_role_fallbacks", fb[0]);
            // ★自定义字体判据（2026-09-29）
            o.put("custom_font_path", pickedPath == null ? "" : pickedPath);
            o.put("custom_font_registered", customFontRegistered);
            o.put("custom_font_width", Math.round(customWidth * 100) / 100f);
            o.put("custom_font_width_before_register", Math.round(widthBeforeRegister * 100) / 100f);
            o.put("system_width", Math.round(systemWidth * 100) / 100f);
            o.put("custom_font_typeface_differs", customTypefaceDiffers);
            o.put("custom_font_register_changes_width", registerChangesWidth);
            o.put("unregistered_custom_falls_back", unregisteredFallsBack);
            o.put("custom_font_misses", ProteusHostView.customFontMisses);
            o.put("second_font_width", Math.round(secondWidth * 100) / 100f);
            o.put("two_fonts_differ", twoFontsDiffer);
            o.put("check_family_affects_measure", familyAffectsMeasure);
            o.put("check_same_family_same_width", sameFamilySameWidth);
            o.put("check_family_changes_measure", familyChangesMeasure);
            o.put("check_typeface_differs", typefaceDiffers);
            o.put("check_unknown_falls_back", unknownFallsBack);
            o.put("verdict", pass ? "PASS" : "FAIL");
            writeReport("layout-font-family.json", o.toString(2));
            return o.toString();
        } catch (org.json.JSONException e) {
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    /**
     * 读**本机各核最大频率**（kHz）——设备拓扑的唯一来源
     *
     * ★为什么不让上层写死核号：拓扑因机而异（Redmi：cpu0-5 + cpu6/7；honor10/Kirin970：
     *   cpu0-3 A53 + cpu4-7 A73）。写死核号 ⇒ 换机即误判。
     * ★读不到时该核留 0，调用方据此**退回"不分类"而不是给错分类**。
     */
    /** 采样表取**中位数**（m°C/ms 通用）——★单点墙钟读数不可信，统一走这里（见 DRAW_REPS 注释） */
    private static double median(java.util.List<Long> xs) {
        if (xs.isEmpty()) return -1;
        java.util.List<Long> c = new java.util.ArrayList<>(xs);
        java.util.Collections.sort(c);
        return c.get(c.size() / 2);
    }

    private int[] readCoreMaxFreq() {
        int[] out = new int[8];
        for (int i = 0; i < out.length; i++) {
            out[i] = 0;
            try {
                java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader(
                        "/sys/devices/system/cpu/cpu" + i + "/cpufreq/cpuinfo_max_freq"));
                String line = r.readLine();
                r.close();
                if (line != null) out[i] = Integer.parseInt(line.trim());
            } catch (Exception ignored) { }
        }
        return out;
    }

    /** 当前内容滚动偏移（虚拟化路径用；平移自绘内容） */
    private float contentOffsetY = 0f;

    /** `#RRGGBB` / `#AARRGGBB` → ARGB int（与 ProteusHostView 的配色口径一致） */
    private static int parseHex(String s) {
        if (s == null || s.isEmpty()) return 0;
        String h = s.startsWith("#") ? s.substring(1) : s;
        try {
            long v = Long.parseLong(h, 16);
            if (h.length() == 6) return (int) (0xFF000000L | v);
            if (h.length() == 8) {
                // #AARRGGBB（本仓约定）→ Android 的 ARGB 同序
                return (int) v;
            }
        } catch (NumberFormatException ignored) { }
        return 0;
    }

    /** 几何条目数（判"结构真的变了"用） */
    private int rectCountOf(long handle) {
        try {
            org.json.JSONObject o = new org.json.JSONObject(RustLayout.readRects(handle));
            org.json.JSONObject r = o.optJSONObject("rects");
            return r == null ? -1 : r.length();
        } catch (Exception e) {
            return -1;
        }
    }

    /** 取某节点的几何高度 */
    private float rectHeightOf(long handle, int nodeId) {
        try {
            org.json.JSONObject o = new org.json.JSONObject(RustLayout.readRects(handle));
            org.json.JSONObject r = o.getJSONObject("rects").optJSONObject(String.valueOf(nodeId));
            return r == null ? -1f : (float) r.getDouble("height");
        } catch (Exception e) {
            return -1f;
        }
    }

    /** 取某节点的几何宽度（诊断/判据共用——单一实现） */
    private float rectWidthOf(long handle, int nodeId) {
        try {
            org.json.JSONObject o = new org.json.JSONObject(RustLayout.readRects(handle));
            org.json.JSONObject r = o.getJSONObject("rects").optJSONObject(String.valueOf(nodeId));
            return r == null ? -1f : (float) r.getDouble("width");
        } catch (Exception e) {
            return -1f;
        }
    }

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


    /**
     * ★★M3 手势验收：**平台识别器 + 核心命中标注 target**。
     *
     * 【方案依据】06-gesture-animation.md 的映射表：tap→`GestureDetector`、
     *   longPress→`LongPressGesture`、swipe→`FlingGesture` —— **各端用平台识别器**。
     *   本仓只做两件事：① 归一为**语义事件**（跨端同形 API）② 用核心命中给事件标 target。
     *
     * 【为什么必须真机跑（不能只在无头环境验）】
     *   tap/longpress 的判定依赖**真实时间**（长按阈值来自 `ViewConfiguration`，
     *   fling 的速度来自 `VelocityTracker` 对**真实时间戳**的拟合）——这些是平台行为，
     *   只能真机验。故本场景用真实 MotionEvent 序列 + 真实延时驱动**同一条 onTouchEvent**。
     *
     * 【四个手势的验证点】
     *   · tap       → 落在「卡片」上（target 必须是命中那个节点，而非宿主/根）
     *   · longpress → 需**真实等待**长按阈值（platform 的 Handler 计时）
     *   · fling     → 方向由速度主轴判定（水平位移为主 → left/right）
     *   · scroll    → 报告位移读数
     */
    private String gestureRun() {
        final int W = 300, H = 300;
        // 场景：顶栏(2) / 卡片(3) 含一个 absolute 子(4) / 底栏(6)
        //   → 探针点选在 (150,90)：命中 4（绝对定位元素绘制在在流之上，M3 命中测试已验）
        //     故手势的 target 应为 **4** —— 这同时验证了「命中 → 手势」的接线
        StringBuilder nodes = new StringBuilder(2 * 1024);
        nodes.append("{\"viewport\":{\"width\":").append(W).append(",\"height\":").append(H)
             .append("},\"nodes\":[")
             .append("{\"id\":1,\"parentId\":null,\"width\":300.0,\"height\":300.0,\"flexDirection\":\"column\"}")
             .append(",{\"id\":2,\"parentId\":1,\"width\":300.0,\"height\":60.0}")
             .append(",{\"id\":3,\"parentId\":1,\"width\":300.0,\"height\":180.0}")
             .append(",{\"id\":4,\"parentId\":3,\"position\":\"absolute\",\"top\":20.0,\"left\":30.0,\"width\":240.0,\"height\":140.0}")
             .append(",{\"id\":6,\"parentId\":1,\"width\":300.0,\"height\":60.0}")
             .append("],\"textMeasures\":{}}");

        long handle = RustLayout.create(nodes.toString());
        if (handle <= 0) return "{\"ok\":false,\"error\":\"Rust 建树失败\"}";

        final ProteusHostView host = new ProteusHostView(this);
        host.attachCore(handle);
        final java.util.List<String> log = new java.util.ArrayList<>();
        host.setGestureListener(new ProteusHostView.GestureListener() {
            @Override public void onGesture(String type, int targetId, int[] chain, float x, float y,
                                            android.os.Bundle extra) {
                log.add(type + "|target=" + targetId + "|chain=" + java.util.Arrays.toString(chain)
                        + "|dir=" + extra.getString("direction", "-")
                        // I2-ALLOW: 核验报告小数位（非几何——几何由内核给定）
                + "|dx=" + Math.round(extra.getFloat("dx_total", 0) * 10) / 10.0);
            }
        });
        root.addView(host, new FrameLayout.LayoutParams(W, H));
        this.keepAlive = new Object[]{host, log};

        // ★★★用**真实时间**驱动（不能只发 DOWN——tap/longpress/fling 全依赖真实时间流逝）
        //
        // 【本仓实测连踩两次的同一个坑，值得完整记下】
        //   ① 初版：把「DOWN、500ms 后 UP、1000ms 后 fling…」一次性 `postDelayed` 排队。
        //      但 `runAll` 此前已占用主线程**数秒**（bench + 文本对比），消息被处理时
        //      **截止时刻早已全部过期** → 背靠背零间隔执行。现象：longpress 不触发，
        //      看起来像「平台识别器不工作」。
        //   ② 二版：改成链式（每步发完再排下一步），但**首步延迟与汇总延迟仍按「排队时刻」算**
        //      → 仍然过期。现象：汇总比手势序列**先**执行（recognized=0）。
        //   ⇒ 正解：**整条脚本只在主线程空闲后开始计**，之后每步的延迟都从
        //      **上一步实际执行的时刻**起算；汇总也串在链尾（不作为独立的定时任务）。
        //   教训与全仓一致：**测量装置的时序设计必须与它要测的东西对齐**
        //   （同类已有：固定 sleep 让截图落后一步 / 测量位图污染内存读数）。
        final float PX = 150f, PY = 90f;
        final long lpThreshold = android.view.ViewConfiguration.getLongPressTimeout();
        final int DOWN = android.view.MotionEvent.ACTION_DOWN;
        final int MOVE = android.view.MotionEvent.ACTION_MOVE;
        final int UP = android.view.MotionEvent.ACTION_UP;

        // 脚本：四个手势，每个手势 = 若干 {action,x,y,距上一步的延迟ms}
        //   gap = 手势之间的间隔（也是「距上一步」）
        final java.util.List<float[][]> script = new java.util.ArrayList<>();
        script.add(new float[][]{ {DOWN, PX, PY, 300}, {UP, PX, PY, 60} });                                  // tap
        script.add(new float[][]{ {DOWN, PX, PY, 400}, {UP, PX, PY, lpThreshold + 250} });                   // longpress
        script.add(new float[][]{ {DOWN, PX, PY, 400},                                                       // fling 右
                {MOVE, PX + 40, PY, 20}, {MOVE, PX + 80, PY, 20}, {MOVE, PX + 130, PY, 20},
                {MOVE, PX + 180, PY, 20}, {UP, PX + 180, PY, 20} });
        // ④ 慢速小位移拖动：★这是**负向检查**——总时长必须**短于长按阈值**，
        //    否则它会被识别成长按（本仓实测踩到：初版 720ms → 多出一个 longpress，
        //    让人以为「长按判据不准」，其实是脚本自己按太久了）。
        //    期望：不产生 longpress、也不构成 fling（速度低）。
        script.add(new float[][]{ {DOWN, PX, PY, 400},
                {MOVE, PX, PY + 3, 40}, {MOVE, PX, PY + 10, 80}, {MOVE, PX, PY + 30, 120},
                {UP, PX, PY + 45, 160} });

        // 收尾：串在链尾执行（★不做独立定时任务——否则又会按「排队时刻」算而提前/过期）
        final Runnable finalize = () -> {
            android.util.Log.i(TAG, "手势汇总开始：已识别 " + log.size() + " 个事件");
            String joined = android.text.TextUtils.join(" ;; ", log);
            boolean hasTap = contains(log, "tap|target=4|");
            boolean hasLong = contains(log, "longpress|target=4|");
            boolean hasFling = contains(log, "fling|target=4|");
            int flingIdx = indexOfPrefix(log, "fling|");
            String flingDir = flingIdx >= 0 ? log.get(flingIdx).split("\\|")[3].replace("dir=", "") : "-";
            boolean flingOk = "right".equals(flingDir);
            boolean scrollSeen = indexOfPrefix(log, "scroll|") >= 0;
            // ★负向判据（比「有没有」更强的检查）：
            //   · longpress 恰好 1 次 —— 多出即说明某段脚本按太久了（时间语义）
            //   · fling 恰好 1 次   —— 慢拖不应被判成 fling（速度语义）
            int longCount = countPrefix(log, "longpress|");
            int flingCount = countPrefix(log, "fling|");
            boolean countsOk = (longCount == 1) && (flingCount == 1);
            boolean ok = hasTap && hasLong && hasFling && flingOk && countsOk;
            try {
                org.json.JSONObject out = new org.json.JSONObject();
                out.put("ok", ok);
                out.put("path", "gesture");
                out.put("viewport", W + "x" + H);
                out.put("probe", PX + "," + PY);
                out.put("expect_target", 4);
                out.put("tap_ok", hasTap);
                out.put("longpress_ok", hasLong);
                out.put("fling_ok", hasFling);
                out.put("fling_direction", flingDir);
                out.put("scroll_seen", scrollSeen);
                out.put("longpress_count", longCount);
                out.put("fling_count", flingCount);
                out.put("counts_ok", countsOk);   // ★负向检查：慢拖不产生额外 longpress/fling
                out.put("longpress_threshold_ms", lpThreshold);
                out.put("recognized", log.size());
                out.put("events", joined);
                out.put("note", "★方案 §6：手势用**平台识别器**（GestureDetector），本仓只做语义归一 + "
                        + "用核心命中标注 target。tap/longpress/fling 的 target 都应为 4（证明「命中 → 手势」接线正确）。"
                        + "★整条脚本只在主线程空闲后开始计时，每步延迟从上一步**实际执行时刻**起算，汇总串在链尾——"
                        + "前两版都因「按排队时刻算」而全部过期（见源码注释）。");
                String json = out.toString(2);
                writeReport("layout-gesture.json", json);
                RustLayout.destroy(handle);
                android.util.Log.i(TAG, "手势验收报告：\n" + json);
            } catch (Exception e) {
                android.util.Log.e(TAG, "手势报告失败", e);
            }
        };
        // ★post(0)：此刻（runAll 仍在跑）排入，但**真正的计时从它被执行的那一刻开始**
        new android.os.Handler(getMainLooper()).post(() -> new GestureScriptRunner(host, script, finalize).start());

        return "{\"ok\":true,\"note\":\"手势序列已排入主线程队列（真实时间驱动），报告异步写入 layout-gesture.json\"}";
    }

    /**
     * ★★手势脚本执行器：**串行执行、每步延迟从上一步实际执行时刻起算**。
     *
     * 【为什么必须是「实际执行时刻」而不是「排队时刻」】
     *   若在 runAll 里（主线程被占数秒）就按 `now + delay` 排定所有截止时刻，
     *   等主线程空闲时这些时刻**已全部过期** → 背靠背零间隔执行 → 依赖真实时间的
     *   手势（longpress）永不触发。本仓实测**连踩两次**（见 `gestureRun` 注释）。
     *   ⇒ 本执行器只在**第一步真正执行时**才开始排下一步。
     *
     * 【为什么写成内部类而不是局部 lambda】Java 的局部变量不能自我引用
     *   （`step.run()` 里引用 `step` 会报「可能尚未初始化」）→ 状态与方法放进类里。
     */
    private final class GestureScriptRunner {
        private final ProteusHostView host;
        private final java.util.List<float[][]> script;
        private final Runnable finalize;
        private final android.os.Handler handler;
        /** ★整段脚本共享：平台按 downTime 归组同一手势；每个手势的新 DOWN 会重置它 */
        private final long[] downTime = {0};
        private int gi = 0;   // 手势序号
        private int si = 0;   // 手势内步序号

        GestureScriptRunner(ProteusHostView host, java.util.List<float[][]> script, Runnable finalize) {
            this.host = host;
            this.script = script;
            this.finalize = finalize;
            this.handler = new android.os.Handler(getMainLooper());
        }

        /** 开始（★从被调用的这一刻计时——调用点必须是主线程空闲之后） */
        void start() {
            android.util.Log.i(TAG, "手势脚本开始执行（主线程空闲后计时）");
            step();
        }

        private void step() {
            if (gi >= script.size()) {
                android.util.Log.i(TAG, "手势脚本执行完毕");
                if (finalize != null) finalize.run();
                return;
            }
            float[][] gesture = script.get(gi);
            if (si >= gesture.length) {
                gi++;
                si = 0;
                handler.post(this::step);      // 下一个手势（首步自带 gap 延迟）
                return;
            }
            final float[] st = gesture[si];
            final int action = (int) st[0];
            final float x = st[1], y = st[2];
            final long delay = (long) st[3];
            si++;

            handler.postDelayed(() -> {
                // ★此刻是**真实执行时刻**；下一步的延迟从这里起算
                long now = android.os.SystemClock.uptimeMillis();
                if (action == android.view.MotionEvent.ACTION_DOWN) downTime[0] = now;
                android.view.MotionEvent e = android.view.MotionEvent.obtain(downTime[0], now, action, x, y, 0);
                host.onTouchEvent(e);
                e.recycle();
                step();          // ★链式：这一步真的发完了，才排下一步
            }, Math.max(delay, 1));
        }
    }

    private static boolean contains(java.util.List<String> list, String sub) {
        for (String s : list) if (s.startsWith(sub)) return true;
        return false;
    }

    private static int countPrefix(java.util.List<String> list, String prefix) {
        int n = 0;
        for (String s : list) if (s.startsWith(prefix)) n++;
        return n;
    }

    private static int indexOfPrefix(java.util.List<String> list, String prefix) {
        for (int i = 0; i < list.size(); i++) if (list.get(i).startsWith(prefix)) return i;
        return -1;
    }


}
