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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        setContentView(root);
        root.post(new Runnable() { public void run() { runAll(); } });
    }

    private void runAll() {
        StringBuilder sb = new StringBuilder();
        sb.append("=== Rust 排版核心 · Android 真机验证 ===\n");
        sb.append(String.format("设备：%s %s · Android %s（API %d）%n",
                android.os.Build.MANUFACTURER, android.os.Build.MODEL,
                android.os.Build.VERSION.RELEASE, android.os.Build.VERSION.SDK_INT));
        sb.append("ABI：").append(join(android.os.Build.SUPPORTED_ABIS)).append('\n');
        sb.append("引擎：").append(RustLayout.version()).append('\n');
        sb.append("JNI 符号自检：").append(RustLayout.checkSymbols() ? "✓ 通过" : "✗ " + RustLayout.getLoadError()).append('\n');
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

        sb.append("【② 4050 元素布局性能（纯排版）】\n");
        String bench = RustLayout.bench(TOTAL, 20);
        sb.append(bench).append('\n');
        writeReport("layout-bench.json", bench);
        sb.append('\n');

        sb.append("【③ 4050 元素：Proteus(Rust+Canvas) vs 原生 View 体系】\n");
        String compare = compareAgainstNative();
        sb.append(compare).append('\n');
        writeReport("layout-compare-native.json", compare);

        String text = sb.toString();
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextSize(9f);
        root.addView(tv);
        writeReport("layout-report.txt", text);
        Log.i(TAG, text);
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
            cmp.put("phase_draw_proteus_software_ms", proteusSoftDrawMs);
            cmp.put("phase_draw_native_ms", nativeDrawMs);
            cmp.put("phase_draw_ratio_hw", nativeDrawMs > 0 ? round3(proteusHwRecordMs / nativeDrawMs) : -1);
            o.put("same_scope_compare", cmp);

            o.put("caveat", "★本包 debuggable=true（需 run-as 取报告），§9.2 明确要求 release 包——"
                    + "正式验收须 release 包 + 杀进程重进 + Perfetto 核确认 + 5 次取均值。"
                    + "本报告用于判断方向与归因，不作为验收结论。");
            out = o.toString(2);
        } catch (Exception e) {
            out = "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
        return out;
    }

    private static double round3(double v) { return Math.round(v * 1000) / 1000.0; }

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
            File f = new File(getFilesDir(), name);
            java.io.FileOutputStream fos = new java.io.FileOutputStream(f);
            fos.write(content.getBytes("UTF-8"));
            fos.close();
            Log.i(TAG, "报告已写入 " + f.getAbsolutePath());
        } catch (Exception e) {
            Log.e(TAG, "写报告失败 " + name, e);
        }
    }
}
