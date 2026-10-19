package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/JsTaskSampler.java
// ★★★决策 #1098（2026-10-19）：**P0 长任务观测**（线程治理第一批，纯观测、零行为改动）。
//
// 【为什么先做观测（调研文档 §6 P0 的落地）】
//   调研结论是「不自研线程引擎，先补执行原语」。而原语怎么切、切多细，取决于**真实的长任务分布**
//   ——现在只能猜。本类只做采样，**不改变任何执行行为**（不排队、不让出、不取消）。
//
// 【采什么（对齐调研文档 §6 P0 三件）】
//   ① 单次同步段 >50ms ⇒ 记一条 `{label, ms}`（谁占了主线程）；
//   ② 环形缓冲（最近 64 条）+ 总数 / 最大值 / P50 / P95（不无界增长）；
//   ③ 分母：总调用次数（回答"长任务占比"而不是"有几次长任务"）。
//
// 【★为什么埋点位置是 `QuickJsEngine.eval`（而不是逐个调用点）】
//   生产宿主有十几处 `eval` 调用（boot/render/tree/events/profile/nav/…）。
//   逐个埋点必然漏（新调用点不会记得加）——与 #1096「抽取器覆盖面必须跟实际形态走」同一教训。
//   ⇒ 唯一入口埋一次，**所有** JS 同步段都被计时。
//
// 【诚实边界】
//   · 只测**同步段**：`eval` 内部如果发起异步任务（Promise/job），那部分时间不在本读数内。
//     异步工作由宿主泵的 `nativeRunPendingJobs` 消费，本轮不单独计时（后续批次可加）。
//   · 采样本身有开销（`System.nanoTime()` 两次 + 条件判断）——微秒级，不影响判读。
//   · 只在 **dev 构建**启用（`ProteusBuildConfig.DEV`）；release 下 `enabled=false`，零开销。

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class JsTaskSampler {

    private static final String TAG = "proteus-perf";

    /** 长任务阈值（对齐调研文档 §8 验收建议：单任务 <50ms）。 */
    public static final long LONG_TASK_MS = 50;

    /** 环形缓冲容量（固定——**不无界增长**：观测装置自己不能成为内存问题）。 */
    private static final int RING = 64;

    private static volatile boolean enabled = false;
    private static final ArrayDeque<Sample> ring = new ArrayDeque<>(RING);
    private static long total = 0;
    private static long longCount = 0;
    private static long maxMs = 0;
    private static long totalMs = 0;

    private JsTaskSampler() { }

    /** 一条采样。 */
    static final class Sample {
        final String label;
        final long ms;
        Sample(String label, long ms) { this.label = label; this.ms = ms; }
    }

    /** 启用/停用（dev 构建启用）。 */
    public static void setEnabled(boolean on) { enabled = on; }
    public static boolean isEnabled() { return enabled; }

    /**
     * 记一次同步段耗时。
     * @param label 调用标签（如 \`eval:__proteusSuperappBootJson\`）
     * @param startNs \`System.nanoTime()\` 的起点
     */
    public static void record(String label, long startNs) {
        if (!enabled) return;
        long ms = (System.nanoTime() - startNs) / 1_000_000L;
        synchronized (JsTaskSampler.class) {
            total++;
            totalMs += ms;
            if (ms > maxMs) maxMs = ms;
            if (ms >= LONG_TASK_MS) {
                longCount++;
                ring.addLast(new Sample(label, ms));
                while (ring.size() > RING) ring.removeFirst();
                // ★长任务当场落日志（真机排查时不用等报告拉取）
                Log.i(TAG, "long task " + ms + "ms · " + label);
            }
        }
    }

    /** 从 eval 源码里提一个短标签（取第一个标识符或 前 40 字符）。 */
    public static String labelOf(String source) {
        if (source == null || source.isEmpty()) return "eval:?";
        int i = 0;
        while (i < source.length() && Character.isWhitespace(source.charAt(i))) i++;
        int j = i;
        while (j < source.length() && (Character.isLetterOrDigit(source.charAt(j)) || source.charAt(j) == '_' || source.charAt(j) == '$')) j++;
        String head = j > i ? source.substring(i, j) : source.substring(i, Math.min(source.length(), i + 40));
        return "eval:" + (head.length() > 40 ? head.substring(0, 40) : head);
    }

    /** 读数（JSON 串；判据/面板读它）。 */
    public static String statsJson() {
        JSONObject o = new JSONObject();
        synchronized (JsTaskSampler.class) {
            try {
                o.put("enabled", enabled);
                o.put("thresholdMs", LONG_TASK_MS);
                o.put("total", total);
                o.put("long", longCount);
                o.put("maxMs", maxMs);
                o.put("avgMs", total == 0 ? 0 : (double) totalMs / total);
                JSONArray arr = new JSONArray();
                // 最近的长任务（按发生顺序；取最近 16 条即可判读）
                List<Sample> list = new ArrayList<>(ring);
                int from = Math.max(0, list.size() - 16);
                for (int i = from; i < list.size(); i++) {
                    JSONObject s = new JSONObject();
                    s.put("label", list.get(i).label);
                    s.put("ms", list.get(i).ms);
                    arr.put(s);
                }
                o.put("recent", arr);
                // P95（基于环形缓冲——如实标注是"最近样本"的分位，不是全量）
                List<Long> msList = new ArrayList<>();
                for (Sample s : list) msList.add(s.ms);
                Collections.sort(msList);
                o.put("recentP95Ms", msList.isEmpty() ? 0 : msList.get(Math.min(msList.size() - 1, (int) Math.ceil(msList.size() * 0.95) - 1)));
                o.put("recentCount", msList.size());
            } catch (Throwable t) {
                try { o.put("error", String.valueOf(t)); } catch (Throwable ignored) { }
            }
        }
        return o.toString();
    }

    /** 清空（判据起始基线用）。 */
    public static void reset() {
        synchronized (JsTaskSampler.class) {
            ring.clear();
            total = 0;
            longCount = 0;
            maxMs = 0;
            totalMs = 0;
        }
    }
}
