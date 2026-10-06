package dev.proteus.layoutcore;

import android.content.Context;
import android.graphics.Paint;
import android.view.ViewGroup;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * ★★★S5：**真正消费批次的 Android 渲染宿主**（JS 适配器 → 本类 → Rust 核心 → 自绘）。
 *
 * 【它补的是哪个缺口（S3b 的诚实边界所指）】
 *   S3b 的宿主是"上报"（`proteusHost.post`）——只证明「适配器 → 宿主入口」被调用；
 *   本类把同一批批次**真正消费**：解析 spec → 注入文本度量 → **调 Rust 核心算几何**
 *   → 几何转绘制指令 → 挂到 `ProteusHostView` 自绘。⇒ 端上真的会画。
 *
 * 【分工（与 iOS `selfdraw-scene.swift` 同一张分工表，不自行发明）】
 *   · JS 侧：产出**语义树**（id / parentId / 样式属性 / 文本）——**不含任何几何**；
 *   · 本类：文本度量（平台注入）+ 调核心算几何 + 几何 → 绘制指令；
 *   · Rust 核心：**唯一**产生几何的地方。
 *   ⇒ 本类**不**做布局计算（那会把"一份几何"变成两份实现）。
 *
 * 【与 `MainActivity` 其余通路的关系】
 *   其余通路是"构建期把树冻进 assets / Java 手写请求"；本通路的树**由 JS 现场产出**
 *   （经真实 `createSelfDrawBatchAdapter` + `createNativeBackend`），是端到端最完整的一条。
 *
 * 【★诚实边界】
 *   ① 文本度量用 `Paint`（本类），而绘制用 `ProteusHostView.textPaint`——
 *      **两者必须同参数**，故度量结果同时写回 Cmd 的 `fontSize`（见 `measureTexts` 注释）；
 *   ② `update`（结构变化）语义 = **整树重建**（适配器选定的策略：结构变化整树重发，
 *      与真机既有自绘策略一致）——不是增量 splice；
 *   ③ 不接 Vue：本链路验的是"适配器 → 宿主"，Vue 运行时的端上链路在 iOS 已验
 *      （见 `hosts/ios/bridge/entry-selfdraw.ts`）。
 */
public final class JsRenderHost {

    /* ────────────────────────── 状态 ────────────────────────── */

    private final Context ctx;
    private final ViewGroup root;
    private final float density;

    /** 当前树的 spec 节点（顺序 = JS 产出顺序 = 绘制顺序；结构变更整树替换） */
    private final List<JSONObject> specs = new ArrayList<>();
    /** id → specs 下标（补丁要按 id 找节点） */
    private final Map<Integer, Integer> indexById = new HashMap<>();
    /**
     * ★★当前绘制指令表 + 节点 id → 指令下标（**增量补丁**用）。
     *
     * 【为什么需要（本仓实测的进度瓶颈）】初版补丁路径每帧**全量重建**指令：
     *   `readRects` 重新解析全部 4051 个矩形 + 重建 4000 个 `Cmd` 对象
     *   ⇒ 实测每帧 **31.9ms**（p50）。而改一行文本**只影响一行**。
     *   核心的 `update` 本来就**只回变化集**（`{"rects": {id: …}}`，见 ffi.rs 注释
     *   「整树矩形仍可经 proteus_layout_rects 取（兼容）；此处只给变化集」）
     *   ⇒ 用它做**增量更新**：只替换受影响的那几条指令。
     *   ★这正是"绘制粒度 O(全部) vs O(变化的部分)"那条既有结论在**宿主侧**的重演。
     */
    private final List<ProteusHostView.Cmd> cmds = new ArrayList<>();
    private final Map<Integer, Integer> cmdIndexById = new HashMap<>();
    /** 全量重建时的临时索引（`emitCmds` → 字段，避免第二份副本） */
    private final Map<Integer, Integer> cmdIndexOf = new HashMap<>();

    private ProteusHostView view;

    /** ★★MA0-RT：暴露宿主 View（容器级平台动画的载体——见 ProteusHostView.animatePageComposited） */
    ProteusHostView hostView() { return view; }
    private long handle = 0L;

    /* ────────────────────────── 读数（判据用）────────────────────────── */

    public int mountCalls = 0;
    public int updateCalls = 0;
    public int patchCalls = 0;
    int postCount = 0;
    public int lastNodeCount = 0;
    public int lastTextCount = 0;
    public int lastCmdCount = 0;
    public int lastPaintedSamples = -1;
    /** 离屏重放里出现过的**不同颜色数**（见 `samplePainted` 第二维读数的说明） */
    public int lastPaintedColors = -1;
    public double lastSampleMs = 0;
    public double lastLayoutMs = 0;
    public double lastEmitMs = 0;
    public double lastMeasureMs = 0;
    public double lastTotalMs = 0;
    public String lastError = null;
    /** 最近一次 mount/update 的树种（"结构与约定"判据：两条路径应当一致） */
    public String lastTreeShape = null;
    /** 真实帧读数（宿主 View 的 `onDraw` 次数——"屏幕真的画了"的证据，见 ProteusHostView） */
    public int onDrawCount() { return view == null ? -1 : view.onDrawCount(); }

    /**
     * ★★**宿主侧逐帧耗时**（卡 C2 的判据「宿主侧耗时仍为 1ms 量级」）。
     *
     * 【为什么单列一份】`lastTotalMs` 只记"最后一次"——那可能落在预热帧上。
     *   1ms 量级的判据需要**分布**（p50/p95/max），否则单点读数无法区分
     *   "稳定 1ms" 与 "偶尔 40ms + 其余 0.1ms"。⇒ 记录每次宿主调用的耗时，出分布。
     */
    private final java.util.List<Double> hostCallMs = new java.util.ArrayList<>();

    /** 清空逐帧读数（新一轮测量前调用） */
    void resetFrameTiming() { hostCallMs.clear(); }

    /**
     * 宿主侧**逐帧**耗时分布（毫秒，p50/p95/max）；空数组 = 未测。
     *
     * ★★为什么**排除前 2 个样本**（本仓实测踩到）：样本表的前两项是**一次性相位成本**
     *   （① `mount` 全流程：度量+建树+全量指令；② 首次补丁），它们的量级（10² ms）
     *   与逐帧成本（10⁻¹ ms）差两个数量级 ⇒ 混在一起时 `max` **恒为首帧**、p95 也被抬。
     *   而卡 C2 判据问的是"**每帧**宿主侧开销"，故分布只在稳态帧上算；
     *   两个相位样本单独经 `phaseSampleMs()` 报出（**不隐藏数据，只是分开表述**）。
     */
    private static final int PHASE_SAMPLES = 2;

    public double[] frameTimingPercentiles() {
        if (hostCallMs.size() <= PHASE_SAMPLES) return new double[0];
        java.util.List<Double> xs = new java.util.ArrayList<>(hostCallMs.subList(PHASE_SAMPLES, hostCallMs.size()));
        java.util.Collections.sort(xs);
        return new double[]{
                xs.get(xs.size() / 2),
                xs.get(Math.min(xs.size() - 1, xs.size() * 95 / 100)),   // 整数下标算术（非几何舍入）
                xs.get(xs.size() - 1),
        };
    }

    /** 稳态帧样本数（判据：太少则分布无意义——报告里带出来，避免"用 3 个样本谈 p95"） */
    public int frameSampleCount() { return Math.max(0, hostCallMs.size() - PHASE_SAMPLES); }

    /** 一次性相位样本（[mount, 首次补丁]；未测时长度 < 2）——见 `frameTimingPercentiles` 的说明 */
    public double[] phaseSampleMs() {
        int n = Math.min(PHASE_SAMPLES, hostCallMs.size());
        double[] out = new double[n];
        for (int i = 0; i < n; i++) out[i] = hostCallMs.get(i);
        return out;
    }

    public JsRenderHost(Context ctx, ViewGroup root, float density) {
        this.ctx = ctx;
        this.root = root;
        this.density = density > 0 ? density : 1f;
    }

    /** 当前宿主 View（截图/像素核验用；未 mount 时为 null） */
    ProteusHostView view() { return view; }

    /** 供 JS 侧上报之用（`proteusHost.post`）——本类**不以它作为消费证据**，只计数 */
    @SuppressWarnings("unused")
    public void post(String json) {
        postCount++;
    }

    /* ══════════════════ 三个宿主入口（JS ↔ 本类 的跨边界） ══════════════════ */

    /**
     * 首帧建树：`{viewport:{width,height}, nodes:[spec]}`
     *
     * ★spec 的形状由 `selfdraw-batch.ts` 的 `specs()` 产出：`{id, parentId, ...归一化 props, text?}`
     *   ——**不含几何**（几何由本类经核心算出）。
     */
    public String mount(String treeJson) {
        mountCalls++;
        return render(treeJson, true);
    }

    /** 结构变化：整树重发（见类注释边界②） */
    public String update(String treeJson) {
        updateCalls++;
        return render(treeJson, false);
    }

    /**
     * 样式/文本增量：`[{id, style:{…}}]`（**不重发整树**）。
     *
     * 【为什么文本也走本入口】与真机既有约定一致（`selfdraw-scene.swift` 的 patch 解析：
     *   `style.text` 时重度量并注入）——文本变更在这条协议里是**样式的一个键**。
     */
    public String updatePatches(String patchesJson) {
        // ★★为什么只有**第一次**补丁跑离屏像素自检（本仓实测踩到）
        //
        // 自检要建 1080×2400 位图 + 采样 1.5 万个点 ⇒ 实测 **40ms+**，比产品路径本身贵一个量级。
        // 而它的语义是"**画出来了没**"的判据——**每个相位验一次就够**，不需要每帧验。
        // 初版每帧都跑 ⇒ 逐帧读数 p50 = **43.9ms**，那几乎全是**仪器开销**
        // （本仓纪律：**测量装置不得污染被测读数**，此处是第三次踩到同族）。
        boolean withSample = patchSamplesDone == 0;
        if (withSample) patchSamplesDone++;
        return updatePatches(patchesJson, withSample);
    }

    /** 已跑过像素自检的补丁次数（见 `updatePatches` 的说明：自检每相位一次即可） */
    private int patchSamplesDone = 0;

    /**
     * @param withSample 是否跑离屏像素自检（★稳态逐帧传 false——见 emitCmds 的说明）
     */
    public String updatePatches(String patchesJson, boolean withSample) {
        patchCalls++;
        long t0 = System.nanoTime();
        JSONObject out = new JSONObject();
        try {
            if (handle == 0L) return err(out, "尚未 mount（补丁无树可改）").toString();
            JSONArray patches = new JSONArray(patchesJson);
            JSONArray corePatches = new JSONArray();
            List<Integer> remeasure = new ArrayList<>();
            /** 本批次**所有**被改的 id（含只改绘制属性的）——增量指令更新用 */
            List<Integer> patchedIds = new ArrayList<>();
            int applied = 0;
            for (int i = 0; i < patches.length(); i++) {
                JSONObject p = patches.getJSONObject(i);
                int id = p.getInt("id");
                JSONObject style = p.optJSONObject("style");
                if (style == null) continue;
                Integer at = indexById.get(id);
                if (at == null) continue;
                patchedIds.add(id);
                JSONObject spec = specs.get(at);
                // ① 合并进 spec（★几何无关的绘制属性也留在 spec 里：重绘要用）
                JSONObject coreStyle = new JSONObject();
                java.util.Iterator<String> keys = style.keys();
                boolean needsMeasure = false;
                boolean hasGeometryKey = false;
                while (keys.hasNext()) {
                    String k = keys.next();
                    Object v = style.get(k);
                    if ("text".equals(k)) {
                        spec.put("text", v);
                        coreStyle.put("text", v);
                        needsMeasure = true;
                        hasGeometryKey = true;
                    } else if (LAYOUT_KEYS.contains(k)) {
                        spec.put(k, v);
                        coreStyle.put(k, v);
                        hasGeometryKey = true;
                    } else {
                        // 绘制属性（backgroundColor/color/…）：核心不认，只留 spec（重绘用）
                        spec.put(k, v);
                    }
                }
                if (needsMeasure) remeasure.add(id);
                if (hasGeometryKey) {
                    JSONObject cp = new JSONObject();
                    cp.put("id", id);
                    cp.put("style", coreStyle);
                    corePatches.put(cp);
                    applied++;
                }
            }

            // ② 度量先注入（★顺序不可反：核心的度量器是快照 ⇒ 先给尺寸再重排）
            double measureMs = measureTexts(remeasure);
            // ③ 核心增量重排（只发改动节点的补丁——不重发整树）
            //   ★它的返回值**只含变化集**（`{"rects": {id: {x,y,w,h}}}`）——正好用于增量指令更新
            double layoutMs = 0;
            JSONObject changedRects = null;
            if (corePatches.length() > 0) {
                long tl = System.nanoTime();
                String upd = RustLayout.update(handle, corePatches.toString());
                layoutMs = (System.nanoTime() - tl) / 1e6;
                try {
                    JSONObject uo = new JSONObject(upd);
                    if (uo.optBoolean("ok")) changedRects = uo.optJSONObject("rects");
                } catch (Exception ignored) { /* 解析失败 ⇒ changedRects 保持 null ⇒ 退化为整表更新 */ }
            }
            // ④ **增量**更新指令（只动受影响的那几条——见 `cmds` 字段的说明）
            double emitMs = patchCmdsFor(patchedIds, changedRects, withSample);

            out.put("ok", true);
            out.put("patched", applied);
            out.put("measure_ms", measureMs);
            out.put("layout_ms", layoutMs);
            out.put("emit_cmds_ms", emitMs);
            double totalMs = (System.nanoTime() - t0) / 1e6;
            hostCallMs.add(totalMs);
            out.put("total_ms", totalMs);
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /* ══════════════════ 渲染主体（mount / update 共用） ══════════════════ */

    private String render(String treeJson, boolean isMount) {
        long t0 = System.nanoTime();
        JSONObject out = new JSONObject();
        try {
            JSONObject tree = new JSONObject(treeJson);
            JSONArray nodes = tree.optJSONArray("nodes");
            if (nodes == null || nodes.length() == 0) return err(out, "批次里没有节点").toString();
            JSONObject vp = tree.optJSONObject("viewport");
            float vw = vp != null ? (float) vp.optDouble("width", 1080) : 1080f;
            float vh = vp != null ? (float) vp.optDouble("height", 2400) : 2400f;

            // ① 结构变更 = 整树重建（见类注释边界②）——旧句柄必须先释放（否则泄漏句柄与 taffy 树）
            if (handle != 0L) {
                RustLayout.destroy(handle);
                handle = 0L;
            }
            specs.clear();
            indexById.clear();
            int textCount = 0;
            for (int i = 0; i < nodes.length(); i++) {
                JSONObject n = nodes.getJSONObject(i);
                specs.add(n);
                indexById.put(n.getInt("id"), i);
                String t = n.optString("text", null);
                if (t != null && !t.isEmpty()) textCount++;
            }
            lastTextCount = textCount;

            // ② 文本度量**先算**（与 iOS `selfdraw-scene` 同一顺序：度量 → 建树请求里带上）
            //
            // ★★顺序为什么不能反（本仓实测踩到）：度量必须**随建树请求**进核心。
            //   初版是"先 create（`textMeasures:{}`）→ 再 setTextMeasures 注入"——
            //   而 `setTextMeasures` **只换度量表、不重排**（它同步的是引擎里的度量器快照）
            //   ⇒ 文本节点的几何仍按"零尺寸"算出来 ⇒ 屏幕上没有字（实测 painted 只有 3 个采样点）。
            //   ⇒ 正确顺序：度量 → 请求（含 textMeasures）→ create。
            long tMeasure = System.nanoTime();
            JSONObject measures = buildMeasures(null);
            double measureMs = (System.nanoTime() - tMeasure) / 1e6;

            // ③ 建树请求（几何相关键白名单——绘制属性不进核心：核心不认也不该认）
            JSONObject request = new JSONObject();
            JSONObject viewport = new JSONObject();
            viewport.put("width", vw);
            viewport.put("height", vh);
            request.put("viewport", viewport);
            request.put("nodes", coreNodes());
            request.put("textMeasures", measures);
            long tc = System.nanoTime();
            handle = RustLayout.create(request.toString());
            double layoutMs = (System.nanoTime() - tc) / 1e6;
            if (handle <= 0) return err(out, "核心建树失败（handle=0）").toString();

            // ④ 几何 → 指令 → 上屏
            double emitMs = emitCmds();

            out.put("ok", true);
            out.put("nodes", specs.size());
            out.put("text_nodes", textCount);
            out.put("cmds", lastCmdCount);
            out.put("layout_ms", round3(layoutMs));
            out.put("measure_ms", round3(measureMs));
            out.put("emit_cmds_ms", round3(emitMs));
            double totalMs = (System.nanoTime() - t0) / 1e6;
            // ★逐帧耗时样本（卡 C2 的「宿主侧 1ms 量级」判据需要**分布**，不是单点）
            hostCallMs.add(totalMs);
            out.put("total_ms", round3(totalMs));
            out.put("painted_samples", lastPaintedSamples);
            out.put("viewport", vw + "x" + vh);
            out.put("path", isMount ? "mount" : "update");
            lastTreeShape = specs.size() + "/" + textCount + "/" + hostViewCount();
            out.put("tree_shape", lastTreeShape);
            lastNodeCount = specs.size();
            lastLayoutMs = layoutMs;
            lastMeasureMs = measureMs;
            lastEmitMs = emitMs;
            lastTotalMs = (System.nanoTime() - t0) / 1e6;
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /** 几何相关键（★白名单而非黑名单：核心新增字段时不会静默把绘制属性传进去） */
    private static final java.util.Set<String> LAYOUT_KEYS = new java.util.HashSet<>(java.util.Arrays.asList(
            "width", "height", "widthRatio", "heightRatio", "minWidth", "maxWidth", "minHeight", "maxHeight",
            "margin", "padding", "flexDirection", "justifyContent", "alignItems", "alignSelf",
            "flexGrow", "flexShrink", "flexBasis", "gap", "display", "position", "top", "left",
            "overflow", "isText", "textStyleKey", "nativeHost", "semantic"));

    /** spec → 核心节点表（只带 LAYOUT_KEYS；`text` 单独判定——空串不算文本节点） */
    private JSONArray coreNodes() throws Exception {
        JSONArray arr = new JSONArray();
        for (JSONObject spec : specs) {
            JSONObject n = new JSONObject();
            n.put("id", spec.getInt("id"));
            if (spec.has("parentId") && !spec.isNull("parentId")) n.put("parentId", spec.getInt("parentId"));
            for (String k : LAYOUT_KEYS) {
                if (spec.has(k) && !spec.isNull(k)) n.put(k, spec.get(k));
            }
            String t = spec.optString("text", null);
            if (t != null && !t.isEmpty()) {
                n.put("text", t);
                // ★字号进 `textStyleKey`：核心用它区分"同文案不同字号"（否则度量缓存会错误命中）
                // I2-ALLOW: **非几何**——把 fontSize 编码成整数缓存键（×100 定点表示），
                //   不是坐标/尺寸换算（几何一律由内核产出并经 snap 吸附，平台层零舍入）
                n.put("textStyleKey", (int) Math.round(spec.optDouble("fontSize", DEFAULT_FONT_UNITS) * 100));
            }
            arr.put(n);
        }
        return arr;
    }

    /** 缺省字号（**布局单位**，与 spec 同单位——见 `buildMeasures` 的约定说明） */
    private static final double DEFAULT_FONT_UNITS = 14.0;

    /**
     * 度量文本 → `textMeasures` JSON（id 字符串键）。
     *
     * 【★★度量与绘制必须同源（本仓 iOS 的实测教训）】iOS 因"度量用一支字体、绘制用另一支"
     *   踩过（字被裁而报告全绿）⇒ 本方法把度量用的字号**写回 spec**，
     *   `emitCmds` 再用同一个值填 `Cmd.fontSize`（绘制）⇒ 三者（度量/核心/绘制）同源。
     *
     * 【单位约定（★写进报告，避免读的人误解）】`fontSize` 按**布局单位**解释（与 spec 的
     *   width/height 同单位，即 fixture 的 1080 宽坐标系下的值）。
     *   本仓 4050 对照通路用的是"设计单位 × 密度"（8sp → 24px），**两条通路单位不同**，
     *   不可直接比字号——本类不改动对照通路，只把自己的约定如实上报（`font_units=layout`）。
     *
     * @param onlyIds 只测这些 id（补丁路径）；null = 全量
     */
    private JSONObject buildMeasures(List<Integer> onlyIds) throws Exception {
        JSONObject measures = new JSONObject();
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        for (JSONObject spec : specs) {
            int id = spec.getInt("id");
            String text = spec.optString("text", null);
            if (text == null || text.isEmpty()) continue;
            if (onlyIds != null && !onlyIds.contains(id)) continue;
            double fs = spec.optDouble("fontSize", DEFAULT_FONT_UNITS);
            paint.setTextSize((float) fs);
            // I2-ALLOW: 文本**测量**结果的取整（测量子系统，非几何换算——度量值交给内核后
            //   由内核统一 `snap` 吸附；平台层对**几何**零舍入，与 iOS `measureText` 同款）
            int w = (int) Math.ceil(paint.measureText(text));
            Paint.FontMetrics fm = paint.getFontMetrics();
            int h = (int) Math.ceil(fm.descent - fm.ascent);
            JSONObject size = new JSONObject();
            size.put("width", w);
            size.put("height", h);
            measures.put(String.valueOf(id), size);
            // ★字号写回 spec：绘制（Cmd.fontSize）与核心里的一致（同源）
            spec.put("fontSize", fs);
        }
        return measures;
    }

    /**
     * 度量注入（**补丁路径**——建树路径改为把度量随请求一起给，见 `render`）。
     *
     * ★★顺序语义（本仓实测踩到的静默错几何）：`setTextMeasures` **只换度量表 + 同步引擎快照，
     *   _不_重排**。⇒ 它必须在"核心重排"**之前**调用（本类 `updatePatches` 已按此顺序），
     *   且**不能**用作建树后的补救（那时几何已按零尺寸算完）。
     */
    private double measureTexts(List<Integer> onlyIds) throws Exception {
        long t0 = System.nanoTime();
        JSONObject measures = buildMeasures(onlyIds);
        if (measures.length() > 0) {
            RustLayout.setTextMeasures(handle, measures.toString());
        }
        return (System.nanoTime() - t0) / 1e6;
    }

    /** 全量几何 → 绘制指令（★几何只来自核心：本方法不含任何布局计算）*/
    private double emitCmds() throws Exception { return emitCmds(true); }

    /**
     * @param withSample 是否跑像素自检（★稳态逐帧传 false——见 `hostCallMs` 的说明）
     */
    private double emitCmds(boolean withSample) throws Exception {
        long t0 = System.nanoTime();
        JSONObject rects = new JSONObject(RustLayout.readRects(handle)).getJSONObject("rects");
        List<ProteusHostView.Cmd> cmds = new ArrayList<>(specs.size());
        cmdIndexOf.clear();
        for (JSONObject spec : specs) {
            int id = spec.getInt("id");
            JSONObject r = rects.optJSONObject(String.valueOf(id));
            if (r == null) continue;   // 未参与布局（display:none）
            // ★与增量路径**共用** buildCmdOf（同一份"该不该画"的判定——避免两条路径漂移）
            ProteusHostView.Cmd c = buildCmdOf(spec, r);
            if (c == null) continue;   // 无色无文本 ⇒ 无绘制内容（不产空指令）
            cmdIndexOf.put(id, cmds.size());
            cmds.add(c);
        }
        lastCmdCount = cmds.size();
        // ★存入增量更新用的表（供后续补丁只改受影响项）
        this.cmds.clear();
        this.cmds.addAll(cmds);
        this.cmdIds.clear();
        for (JSONObject spec : specs) {
            int id = spec.getInt("id");
            Integer at = cmdIndexOf.get(id);
            if (at != null) this.cmdIds.add(id);
        }
        this.cmdIndexById.clear();
        this.cmdIndexById.putAll(cmdIndexOf);
        if (view == null) {
            view = new ProteusHostView(ctx);
            // ★与既有场景同款：绝对定位（X=0,Y=0 ⇒ 屏幕坐标 = 几何坐标，截图核验可直接对位）
            android.widget.FrameLayout.LayoutParams lp = new android.widget.FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            lp.leftMargin = 0;
            lp.topMargin = 0;
            view.setLayoutParams(lp);
            root.addView(view);
        }
        view.setCmds(cmds);
        view.invalidate();
        // ★像素自检**单独计时**（它要建 1080×2400 位图 + 采样 1.5 万点，
        //   混进 emit 会污染"几何→指令"这一段的可读性——读数名要与含义一致）
        // ★★稳态逐帧**跳过它**（本仓纪律：测量装置不得污染被测读数）——
        //   实测教训：逐帧 200 帧的宿主耗时 p50 曾达 **43.9ms**，而那几乎全是被这个
        //   离屏位图 + 1.5 万次 getPixel 撑起来的**仪器开销**，不是产品路径成本。
        //   自检在 mount / 补丁相位各跑一次已足够（那是"画出来了没"的判据）。
        if (!withSample) return (System.nanoTime() - t0) / 1e6;
        long t1 = System.nanoTime();
        int[] sampled = samplePainted(cmds);
        lastPaintedSamples = sampled[0];
        lastPaintedColors = sampled[1];
        lastSampleMs = (System.nanoTime() - t1) / 1e6;
        return (System.nanoTime() - t0) / 1e6 - lastSampleMs;
    }

    /**
     * ★★**增量**更新指令表：只替换受影响的那几条（补丁路径的性能落点）。
     *
     * 【为什么必须有（本仓实测的瓶颈）】全量重建每帧要重解析 4051 个矩形 + 建 4000 个 Cmd
     *   ⇒ 改一行文本的宿主耗时 p50 曾达 **31.9ms**（一帧预算 16.7ms 的 1.9 倍）。
     *   而"改一行"在几何上只影响那一行（以及它的祖先链）——`changedRects` 正是核心给出的**变化集**。
     *   ⇒ 只对变化集里的 id 重建指令；其余原样保留。
     *
     * 【退化路径】`changedRects == null`（解析失败/无变化）⇒ 退回全量重建。
     *   ★宁可慢，不可错：几何与指令不一致会画错，而慢只是性能问题。
     *
     * @param patchedIds 本批次被改的 id（含只改绘制属性、几何未变的）
     */
    private double patchCmdsFor(List<Integer> patchedIds, JSONObject changedRects, boolean withSample) throws Exception {
        long t0 = System.nanoTime();
        if (changedRects == null) {
            // 退化：全量重建（含像素自检开关的传递）
            double ms = emitCmds(withSample);
            return (System.nanoTime() - t0) / 1e6;
        }
        int touched = 0;
        for (Integer id : patchedIds) {
            Integer at = indexById.get(id);
            if (at == null) continue;
            JSONObject spec = specs.get(at);
            Integer cAt = cmdIndexById.get(id);
            // 几何：优先取变化集；没变则沿用旧指令的矩形（保持原值 ⇒ 不漂移）
            JSONObject r = changedRects.optJSONObject(String.valueOf(id));
            if (r == null) {
                // 几何未变（只改绘制属性）⇒ 复用旧矩形
                if (cAt == null) continue;
                ProteusHostView.Cmd old = cmds.get(cAt);
                r = new JSONObject().put("x", old.x).put("y", old.y)
                        .put("width", old.w).put("height", old.h);
            }
            ProteusHostView.Cmd nc = buildCmdOf(spec, r);
            if (nc == null) {
                // 该节点已无绘制内容 ⇒ 摘掉（位置语义：从两张表一起移除并重建索引）
                if (cAt != null) { cmds.remove((int) cAt); cmdIds.remove((int) cAt); rebuildCmdIndex(); }
                continue;
            }
            if (cAt == null) {
                cmds.add(nc);
                cmdIds.add(id);
                cmdIndexById.put(id, cmds.size() - 1);
            } else {
                cmds.set(cAt, nc);
            }
            touched++;
        }
        lastCmdCount = cmds.size();
        view.setCmds(new ArrayList<>(cmds));
        view.invalidate();
        if (withSample) {
            long t1 = System.nanoTime();
            int[] sampled = samplePainted(cmds);
            lastPaintedSamples = sampled[0];
            lastPaintedColors = sampled[1];
            lastSampleMs = (System.nanoTime() - t1) / 1e6;
            return (System.nanoTime() - t0) / 1e6 - lastSampleMs;
        }
        lastTouchedCmds = touched;
        return (System.nanoTime() - t0) / 1e6;
    }

    /** 最近一次增量更新动了几条指令（判据：应远小于总指令数） */
    int lastTouchedCmds = -1;

    /**
     * 指令表的**节点 id 顺序**（与 `cmds` 一一对应）——移除/追加时用它重建 id→下标。
     *
     * 【为什么用一张并行表而不是给 `Cmd` 加 id 字段】`Cmd` 是**绘制指令**（宿主消费的形状，
     *   与 iOS/Android 既有场景共用）；给它塞 node id 会把"宿主协议"和"本宿主的簿记"耦合。
     *   ⇒ 簿记留在本类（并行表），`Cmd` 保持纯净。
     */
    private final List<Integer> cmdIds = new ArrayList<>();

    /** 移除/追加后重建 id→下标（O(n)；只在"节点失去/获得绘制内容"时发生，罕见） */
    private void rebuildCmdIndex() {
        cmdIndexById.clear();
        for (int i = 0; i < cmdIds.size(); i++) cmdIndexById.put(cmdIds.get(i), i);
    }

    /** 单条指令构造（★全量与增量**共用一份**——避免两条路径的判定规则漂移） */
    private ProteusHostView.Cmd buildCmdOf(JSONObject spec, JSONObject r) throws Exception {
        String bg = spec.optString("backgroundColor", null);
        String text = spec.optString("text", null);
        boolean isText = text != null && !text.isEmpty();
        int color = bg == null || bg.isEmpty() ? 0 : HostJson.parseHex(bg);
        if (!isText && color == 0) return null;   // 无色无文本 ⇒ 无绘制内容
        float fs = isText ? (float) spec.optDouble("fontSize", DEFAULT_FONT_UNITS) : 0f;
        ProteusHostView.Cmd c = new ProteusHostView.Cmd(
                (float) r.getDouble("x"), (float) r.getDouble("y"),
                (float) r.getDouble("width"), (float) r.getDouble("height"),
                color, isText ? text : null, fs);
        // ★★★text 内间距批（2026-10-09 · 与 VaporRenderHost 同语义）：文本绘制内缩 = 盒内 padding。
        //   与 Vapor 通路同一份"内容盒"口径（避免两条 host 通路漂移——同语义一处实现的纪律）。
        JSONObject pad = spec.optJSONObject("padding");
        if (isText && pad != null) {
            c.padL = (float) pad.optDouble("left", 0);
            c.padT = (float) pad.optDouble("top", 0);
            c.padR = (float) pad.optDouble("right", 0);
            c.padB = (float) pad.optDouble("bottom", 0);
        }
        return c;
    }

    /**
     * 像素自检（**画了什么**的机器判据）：离屏走**视图的真实绘制分发**，统计非透明采样点与颜色数。
     *
     * 【为什么必须有】"指令数 > 0"不证明画得出来（颜色全透明 / 尺寸全 0 时指令数照样 > 0）。
     *   本仓纪律：**判据要落在结果上**，不落在"我发出了指令"上。
     *
     * 【★★为什么必须走 `view.draw(canvas)` 而不是 `view.drawCmds(canvas)`（本仓实测踩到）】
     *   `drawCmds` **绕过 `View.draw()` 的分发**——而 `ViewGroup` 默认置 `WILL_NOT_DRAW`
     *   ⇒ 真实路径下 `onDraw` 根本不会被调用（屏幕上什么都看不到），
     *   而直接调 `drawCmds` 的离屏检查**照样全绿**。
     *   实测：同一棵树 `drawCmds` 出 3640 个采样点，设备截图**整屏背景色**、`onDrawCount()==0`。
     *   ⇒ 本检查改走真实分发（顺带覆盖 `setWillNotDraw(false)` 是否生效——
     *     没有它 `onDrawCount` 会是 0，本检查立刻暴露）。
     *
     * 【为什么还要数"不同颜色"】只数非透明点无法区分"整屏一个色"与"格子各有色"——
     *   4050 场景里曾出现"只有 3 个采样点"的形态（文本塌成 0 尺寸）：
     *   单看"非透明 > 0"会放过它。⇒ 颜色多样性是"内容真的画出来了"的第二维读数。
     *
     * @return int[2] = {非透明采样点, 不同颜色数}；异常时 {-1, -1}
     */
    private int[] samplePainted(List<ProteusHostView.Cmd> cmds) {
        if (cmds.isEmpty()) return new int[]{0, 0};
        int W = 1080, H = 2400;
        android.graphics.Bitmap bmp = null;
        try {
            bmp = android.graphics.Bitmap.createBitmap(W, H, android.graphics.Bitmap.Config.ARGB_8888);
            // ★真实分发（见上）：背景 + onDraw + 子 View，与窗口里的路径同一套判定
            view.measure(android.view.View.MeasureSpec.makeMeasureSpec(W, android.view.View.MeasureSpec.EXACTLY),
                    android.view.View.MeasureSpec.makeMeasureSpec(H, android.view.View.MeasureSpec.EXACTLY));
            view.layout(0, 0, W, H);
            view.draw(new android.graphics.Canvas(bmp));
            int painted = 0;
            java.util.HashSet<Integer> colors = new java.util.HashSet<>();
            for (int y = 0; y < H; y += 16) {
                for (int x = 0; x < W; x += 16) {
                    int px = bmp.getPixel(x, y);
                    if ((px >>> 24) != 0) {
                        painted++;
                        colors.add(px);
                    }
                }
            }
            return new int[]{painted, colors.size()};
        } catch (Throwable t) {
            return new int[]{-1, -1};
        } finally {
            if (bmp != null) bmp.recycle();
        }
    }

    /**
     * root 里当前的 **ProteusHostView 数量**（本链路的核心结构读数）。
     *
     * 【为什么数"宿主 View"而不是"子 View 数"】子 View 数含按钮等非场景 View，
     *   读数随环境漂移；而本链路的结构主张是「**无 per-node View**」——
     *   无论树有多少节点，宿主 View 恒为 **1 个**。⇒ 判据直接落在这个量上。
     */
    private int hostViewCount() {
        if (root == null) return -1;
        int n = 0;
        for (int i = 0; i < root.getChildCount(); i++) {
            if (root.getChildAt(i) instanceof ProteusHostView) n++;
        }
        return n;
    }

    private JSONObject err(JSONObject out, String msg) {
        lastError = msg;
        try {
            out.put("ok", false);
            out.put("error", msg);
        } catch (Exception ignored) { /* JSONObject.put 不会失败 */ }
        return out;
    }

    private static double round3(double v) { return Math.round(v * 1000.0) / 1000.0; }
}
