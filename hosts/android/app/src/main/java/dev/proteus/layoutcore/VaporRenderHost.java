package dev.proteus.layoutcore;

import android.content.Context;
import android.view.ViewGroup;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * ★★★**Vapor 渲染宿主**（2026-10-01）——「真实 SFC 编译产物 → 设备端实例化 → 自研渲染体系」的宿主侧。
 *
 * 【它补的缺口】Android 侧此前跑的是**构建期预实例化的静态树**（`JsRenderHost` +
 *   `entry-batch.ts` 注释明写「不接 Vue」）。本类是那条真链路的宿主端：
 *     设备端 JS（`bundle-vapor.js`）：实例化 + 订阅驱动 → 产出节点树与**二进制指令**
 *     → 本类：注入文本度量 → Rust 核心建树/重排 → 生成绘制指令 → `ProteusHostView` 上屏
 *   ⇒ 与 `JsRenderHost` 的分工：那个面向"JS 手拼语义树"（S5 阶段），本类面向
 *     "**编译器产物驱动**"（V4/Vapor 阶段）。两者共用同一套 `RustLayout` / `ProteusHostView`。
 *
 * 【与 iOS `selfdraw-scene.swift` 的对应】那边是同一分工的 iOS 实现：JSExport 注入
 *   `mount` / `applyOps` / `readRects` 三个入口。本类是 Android 的同名三入口。
 *
 * 【★两个入口的语义（与 iOS 逐条一致）】
 *   · `mount(treeJson)`：`{viewport, nodes}` → 度量 → 核心建树 → 指令 → 上屏（首帧）；
 *   · `applyOps(opsJson)`：**二进制指令流**（`number[]` JSON 数组，JNI 侧转 byte[]）
 *     → `RustLayout.applyOps` → **只回变化集** → 增量更新指令 → 上屏。
 *     ★为什么二进制（本仓实测）：JSON 补丁每帧要文本解析（实测占布局耗时 95%+）；
 *       二进制是顺序读 + 定长字段。iOS 侧同一条（`applyOps`）。
 *   · `readRects()`：**从内核真源读**几何（判据用——不是从我们发下去的参数复述）。
 *
 * 【宿主形态（为什么直接用 ProteusHostView 而不是另立一套）】
 *   `ProteusHostView` 已经是「自绘宿主 + 原生组件混用」的落地件（M3：native-host 跟随 +
 *   滚动同步 + 裁剪），且已接裁剪/描边/渐变/发光/遮罩等全部绘制通道。
 *   ⇒ 本类复用它的 `setCmds` / `invalidate`，零重复实现（本仓纪律：一处实现）。
 */
final class VaporRenderHost {

    private final Context ctx;
    private final ViewGroup root;

    /** 当前树 spec（顺序 = JS 产出顺序 = 绘制顺序） */
    private final List<JSONObject> specs = new ArrayList<>();
    private final Map<Integer, Integer> indexById = new HashMap<>();
    /** 绘制指令与 id → 指令下标（增量补丁用；与 JsRenderHost 同款） */
    private final List<ProteusHostView.Cmd> cmds = new ArrayList<>();
    private final Map<Integer, Integer> cmdIndexById = new HashMap<>();

    private ProteusHostView view;
    private long handle = 0L;

    /* ────────────────────────── 读数（判据用）────────────────────────── */

    int mountCalls = 0;
    int applyCalls = 0;
    int lastNodeCount = -1;
    int lastTextCount = -1;
    int lastCmdCount = -1;
    double lastLayoutMs = -1;
    double lastMeasureMs = -1;
    int lastPaintedSamples = -1;
    int lastPaintedColors = -1;
    /** 最近一次 `applyOps` 的读数（判据直接从回执读，这里留痕便于 logcat 诊断） */
    int lastApplied = -1;
    int lastChangedNodes = -1;
    /** ★★文本同步（2026-10-01 修复上一批的漏消费）：内核回 `text_updates`，宿主必须落到绘制真源 */
    int textSyncedTotal = 0;
    /** 最近一次文本更新的探针（`{id,text}` JSON——判据据此断言"新文本真的到了宿主"） */
    String lastTextProbe = null;

    /* ── ★★虚拟化状态（长列表：整树在内核、宿主只物化可见区）────────────────── */

    /** 行描述（来自设备端实例化的 `virtual.rows`） */
    private int[][] vrowIds = null;
    private int[] vrowRoots = null;
    /** 行根的内容坐标 y（算可见区用）——来自内核 rects（几何真源） */
    private int[] rowTops = null;
    private int rowPitch = 0;
    private int vViewportH = 2400;
    private int vScrollY = 0;
    private long recycleHandle = 0L;
    /** id → 内核矩形（mount 时全量读一次；物化行时用） */
    private final Map<Integer, JSONObject> vRects = new HashMap<>();
    /** 不属任何行的节点（容器/标题）——全量物化（与 iOS「静态部分全量物化」同一条纪律） */
    private final List<NodeCmd> staticCmds = new ArrayList<>();
    /** 行 → 已物化指令（release 时整行丢弃） */
    private final Map<Integer, List<NodeCmd>> rowCmds = new HashMap<>();
    /** 当前存活（可见 + 预载）的行（升序——组装时按节点序输出） */
    private final java.util.TreeSet<Integer> liveRows = new java.util.TreeSet<>();
    /** 读数：物化过的行数 / 已释放行数 / 行-帧累计（复用率分母） */
    private int builtTotal = 0;
    private int releasedRowsTotal = 0;
    private int rowFramesTotal = 0;
    /** 顶部签名（mount 时采；`capture` 帧对比——"滚动真的动了 / 回顶恒等"的像素证据） */
    private int[] sigTop = null;

    /* ── ★★交互闭环（2026-10-01）：事件 → 回调 → 改数据 → 订阅触发 → 指令 → 内核 ── */

    /** 命中回调（JS 侧注册：`proteusHost.onGesture` 的转发目标）——由 JNI 桥注入 */
    interface GestureSink {
        /**
         * @param type     语义手势（tap / longpress）
         * @param targetId 命中节点
         * @param chain    冒泡链（**target 自身 + 全部祖先**，自深到浅）——2026-10-02 起随回调下发；
         *                 此前这里只转发 target ⇒ 冒泡链在这最后一环被丢弃（祖先 handler 永不触发）
         */
        void onGesture(String type, int targetId, int[] chain);
    }
    private GestureSink gestureSink;
    /** 读数：累计分发的语义手势数（判据"事件真的到了宿主"的机器证据） */
    int gestureDispatched = 0;
    /** 最近一次手势（探针：`{type,target,chain}`——判据读它确认"点在了哪个节点上 + 冒泡链"） */
    String lastGestureProbe = null;

    void setGestureSink(GestureSink sink) {
        this.gestureSink = sink;
        if (view != null) attachGestureListener();
    }

    /**
     * ★★把手势接到**命中链**上：`ProteusHostView.onTouchEvent` 已在 DOWN 时刻用内核
     *   `hitTest` 定下目标节点与冒泡链（`gestureTarget` / `gestureChain`）⇒ 这里只消费
     *   语义手势 + 目标 id + 链，转发给 JS 侧执行 handler。**宿主不做任何"哪个节点响应了"的
     *   判断**（那是内核的活）。
     */
    private void attachGestureListener() {
        if (view == null) return;
        view.setGestureListener(new ProteusHostView.GestureListener() {
            @Override
            public void onGesture(String type, int targetId, int[] chain, float x, float y, android.os.Bundle extra) {
                if (!"tap".equals(type) && !"longpress".equals(type)) return;
                gestureDispatched++;
                // ★探针带上冒泡链（判据核对"链真的过宿主"——不是只信 JS 侧自报）
                StringBuilder cb = new StringBuilder("[");
                if (chain != null) {
                    for (int i = 0; i < chain.length; i++) {
                        if (i > 0) cb.append(',');
                        cb.append(chain[i]);
                    }
                }
                cb.append(']');
                lastGestureProbe = "{\"type\":" + JSONObject.quote(type) + ",\"target\":" + targetId
                        + ",\"chain\":" + cb + "}";
                if (gestureSink != null) gestureSink.onGesture(type, targetId, chain);
            }
        });
    }

    /** 一条指令 + 它的节点序与节点 id（组装时按节点序排序 ⇒ 绘制顺序 = 树序，与既有一致） */
    private static final class NodeCmd {
        final int nodeIdx;
        final int nodeId;
        final ProteusHostView.Cmd cmd;
        NodeCmd(int nodeIdx, int nodeId, ProteusHostView.Cmd cmd) {
            this.nodeIdx = nodeIdx;
            this.nodeId = nodeId;
            this.cmd = cmd;
        }
    }

    VaporRenderHost(Context ctx, ViewGroup root) {
        this.ctx = ctx;
        this.root = root;
    }

    ProteusHostView view() { return view; }

    /** ★诊断：读某节点的内核几何（真源）——判 layout 问题用 */
    String nodeRectJson(int nodeId) { return handle > 0 ? RustLayout.nodeRect(handle, nodeId) : "{}"; }

    /**
     * 首帧建树：`{viewport:{width,height}, nodes:[…]}`。
     *
     * 顺序与 `JsRenderHost.render` **逐条相同**（度量 → 请求 → create → 指令）：
     * 该顺序是本仓实测钉住的——度量必须随建树请求进核心（否则文本按零尺寸算 ⇒ 屏幕上没字）。
     */
    public String mount(String treeJson) {
        mountCalls++;
        JSONObject out = new JSONObject();
        try {
            JSONObject tree = new JSONObject(treeJson);
            // ★★物理化=唯一换算点（viewport + 全部 nodes 一次改写到物理单位；见 physicalizeTree 注释）
            physicalizeTree(tree);
            JSONArray nodes = tree.optJSONArray("nodes");
            if (nodes == null || nodes.length() == 0) return err(out, "批次里没有节点").toString();
            JSONObject vp = tree.optJSONObject("viewport");
            float vw = vp != null ? (float) vp.optDouble("width", 1080) : 1080f;
            float vh = vp != null ? (float) vp.optDouble("height", 2400) : 2400f;

            ensureView();

            // ① 结构变更 = 整树重建（旧句柄先释放）
            if (handle != 0L) {
                RustLayout.destroy(handle);
                handle = 0L;
            }
            // ★★**清空按 id 键的每树状态**（2026-10-01 A/B 判据实测抓出的真缺陷）：
            //   id 每棵树重新分配，旧表的裁剪/描边/变换原会被新树"同 id 节点"继承
            //   ⇒ 幽灵裁剪 / 幽灵描边（详见 `ProteusHostView.resetPerTreeState` 注释）。
            if (view != null) view.resetPerTreeState();
            // ★★全端对齐批（2026-10-05 · white-space 五端对齐）：记下本树 viewport（第二遍测量重建树用）
            lastVw = vw; lastVh = vh;
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

            // ② 文本度量（★顺序不可反——见 JsRenderHost.render 的同款注释）
            long tm = System.nanoTime();
            JSONObject measures = buildMeasures();
            double measureMs = (System.nanoTime() - tm) / 1e6;

            // ③ 建树请求（几何键白名单——绘制属性不进核心）
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
            // ★★全端对齐批（2026-10-05 · white-space 五端对齐）：**第二遍测量**——
            //   wrap 类（normal/pre-wrap/pre-line）文本在**解析后的盒宽**下折行 ⇒ 高度=多行高。
            //   首遍（buildMeasures）只有单行度量 ⇒ 文本盒高偏小、容器不随内容增高（与 Web 不一致）。
            //   流程：首遍 create → readRects 得盒宽 → 按盒宽重测 wrap 文本 → 有变化则 destroy + 重建。
            //   ★诚实边界：`pre`（保留空白且**不**折行）在本渲染器按 wrap 近似（受盒宽折行）；
            //     该值在验收语料未使用——列为已知近似，后续按需精化。
            {
                byte[] tmp = applyWrapRemeasure(vw, vh);
                if (tmp != null) handle = RustLayout.create(new String(tmp, java.nio.charset.StandardCharsets.UTF_8));
                if (handle <= 0) return err(out, "核心重建树失败（handle=0）").toString();
            }
            // ★★**把句柄接给视图**（2026-10-01 交互闭环实测抓出）：
            //   视图的命中测试（`dispatchHit`）走 `RustLayout.hitTest(coreHandle, …)`——
            //   而 **`coreHandle` 是视图自持的字段**，只有 `attachCore(handle)` 才会设上。
            //   本类此前从未调用 ⇒ `coreHandle=0` ⇒ **命中恒返回 -1** ⇒ 点哪儿都没反应。
            //   ★症状极具迷惑性：手势识别正常上报（logcat 有 tap）、`cmds`/`id 表` 也都对，
            //     唯独"目标节点"恒空——查了三轮才定位到"少了这根线"。
            //   ★句柄每次重建都变（destroy→create）⇒ 每次建树后都要重新接。
            view.attachCore(handle);

            // ④ 节点级绘制状态统一注入（一次遍历；C2 描边/C1 裁剪/原点）→ 几何 → 指令 → 上屏
            injectAllNodeState();
            long te = System.nanoTime();
            emitAll();
            double emitMs = (System.nanoTime() - te) / 1e6;
            // ★批次 42（动效 · 对齐 Web）：**CSS animation**（编译期折叠）——挂载后启动
            //   （复用既有 animStart：内核 kernelAnimStart + Choreographer 帧循环）
            cssAnimNodes = startStaticAnimations();

            lastNodeCount = specs.size();
            lastTextCount = textCount;
            lastLayoutMs = layoutMs;
            lastMeasureMs = measureMs;
            lastPaintedSamples = sample(0);
            lastPaintedColors = sample(1);

            // ★★内容滚动范围（2026-10-02 —— 用户实测「安卓示例页面可以一直上下滚动」的修复）：
            //   内容高 = **内核几何**的最大下沿（`RustLayout.readRects` 的 y+height 最大值——
            //   不是宿主自己算的布局数学）；范围 = max(0, 内容高 − 视口高) ⇒ 设给视图后
            //   `scrollDragBy` 钳到 [0, range]（装得下 ⇒ 0 ⇒ 不可滚；超出 ⇒ 滚到内容底为止，
            //   与 Web 页面语义一致）。
            //   ★★**显式开启**（`enableContentScrollRange`，仅 SFC 压力场景调用）：
            //     既有 kernel-anim 等**探针/动画用例依赖"无界拖拽"**（M6b 押 scrollY>0 的
            //     大位移）——默认钳制会静默改变它们的读数（历史教训：改默认行为=改既有判据）。
            //     未开启 ⇒ verticalRangeSet 仍为 false ⇒ 与改前逐位一致。
            if (contentScrollRangeEnabled) applyContentScrollRange(vh, out);

            out.put("ok", true);
            out.put("nodes", specs.size());
            out.put("text_nodes", textCount);
            out.put("cmds", lastCmdCount);
            out.put("layout_ms", round3(layoutMs));
            out.put("measure_ms", round3(measureMs));
            out.put("emit_cmds_ms", round3(emitMs));
            out.put("painted_samples", lastPaintedSamples);
            out.put("painted_colors", lastPaintedColors);
            out.put("css_anim_nodes", cssAnimNodes);
            out.put("viewport", vw + "x" + vh);
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /**
     * ★★**内容滚动范围**（2026-10-02 修「安卓示例页面可以一直上下滚动」）：
     *
     * 【语义（与 Web 页面一致）】内容装得下视口 ⇒ 不可滚（range = 0）；
     *   内容超出 ⇒ 最多滚到内容底（range = 内容高 − 视口高）。
     *
     * 【★范围必须从内核几何推导，宿主不算第二份布局数学】内容高 = `RustLayout.readRects`
     *   回传的全部节点矩形里 **y + height 的最大值**（内核已吸附的物理像素值）；
     *   宿主只做 max 与减法——与 `visibleRange()` 的纪律同源（几何真值只在核内算）。
     *
     * 【失败不静默】readRects 失败/异常 ⇒ 报告里带 `scroll_range_error`（判据可判红），
     *   此时视图保持"未设置范围"（= 不钳制）——不伪装成已修好。
     */
    private boolean contentScrollRangeEnabled = false;

    /** 显式开启内容滚动范围钳制（仅内容页场景调用；探针/动画用例保持无界） */
    void enableContentScrollRange() { contentScrollRangeEnabled = true; }

    private void applyContentScrollRange(float vh, JSONObject out) {
        try {
            if (view == null || handle == 0L) return;
            JSONObject all = new JSONObject(RustLayout.readRects(handle));
            if (!all.optBoolean("ok", false)) {
                out.put("scroll_range_error", "readRects 失败：" + all.optString("error", "?"));
                return;
            }
            JSONObject rects = all.optJSONObject("rects");
            float maxBottom = 0f;
            if (rects != null) {
                java.util.Iterator<String> it = rects.keys();
                while (it.hasNext()) {
                    JSONObject r = rects.optJSONObject(it.next());
                    if (r == null) continue;
                    float bottom = (float) (r.optDouble("y", 0) + r.optDouble("height", 0));
                    if (bottom > maxBottom) maxBottom = bottom;
                }
            }
            // I2-ALLOW: 滚动**交互约束**取整（像素级钳制上限——不进绘制指令流、非几何换算；
            //   绘制几何仍走内核吸附值）
            int range = Math.max(0, Math.round(maxBottom - vh));
            view.setVerticalScrollRange(range);
            // I2-ALLOW: 报告读数（content_height / scroll_range 为机器判据的可读字段）
            out.put("content_height", Math.round(maxBottom));
            out.put("scroll_range", range);
        } catch (Exception e) {
            // 不静默：报出（判据可据此判红）；视图保持"不钳制"状态
            try { out.put("scroll_range_error", e.getClass().getSimpleName() + ": " + e.getMessage()); } catch (Exception ignored) { /* 报告字段写失败时保持原样 */ }
        }
    }

    /**
     * **二进制指令流**（订阅驱动更新的唯一入口）：`number[]`（0..255）→ byte[] → 内核。
     *
     * @param opsJson `[137,1,0,0,…]` 形态（QuickJS 无 ArrayBuffer 直传，走数组——与 iOS 侧
     *                的 JSON 数组约定同形，见 hosts/ios 的 `applyOps`）
     */
    public String applyOps(String opsJson) {
        applyCalls++;
        JSONObject out = new JSONObject();
        try {
            if (handle == 0L) return err(out, "尚未 mount（无树可改）").toString();
            JSONArray arr = new JSONArray(opsJson);
            byte[] bytes = new byte[arr.length()];
            for (int i = 0; i < arr.length(); i++) bytes[i] = (byte) (arr.optInt(i) & 0xFF);

            long tl = System.nanoTime();
            String upd = RustLayout.applyOps(handle, bytes);
            double layoutMs = (System.nanoTime() - tl) / 1e6;

            JSONObject uo = new JSONObject(upd);
            if (!uo.optBoolean("ok")) {
                out.put("ok", false);
                out.put("error", uo.optString("error", "applyOps 失败"));
                return out.toString();
            }
            // ★内核**只回变化集**（`rects: {id: {x,y,w,h}}`）——正是增量更新指令的依据
            JSONObject changed = uo.optJSONObject("rects");
            lastApplied = uo.optInt("applied", -1);
            lastChangedNodes = changed != null ? changed.length() : 0;

            // ★★**文本同步**（2026-10-01 修上一批的漏消费）：内核回执里带
            //   `text_updates: {id: 新文本}`——上一批没消费 ⇒ **文字改了但屏幕上还是旧字**
            //   （iOS 宿主的 applyOps 消费了它，见 selfdraw-scene.swift「文本落层」；
            //    两端分叉，Android 补上。本仓纪律：内核给了变更明细就必须落到绘制真源。）
            java.util.List<Integer> textChangedIds = new java.util.ArrayList<>();
            JSONObject tu = uo.optJSONObject("text_updates");
            if (tu != null && tu.length() > 0) {
                for (java.util.Iterator<String> it = tu.keys(); it.hasNext(); ) {
                    String k = it.next();
                    int id = Integer.parseInt(k);
                    String t = tu.optString(k, null);
                    Integer idx = indexById.get(id);
                    if (idx == null || t == null) continue;
                    specs.get(idx).put("text", t);
                    textChangedIds.add(id);
                    textSyncedTotal++;
                    lastTextProbe = "{\"id\":" + id + ",\"text\":" + JSONObject.quote(t) + "}";
                }
            }

            // 文本可能变了 ⇒ 需重度量（订阅更新里文本与宽度都可能动）
            double measureMs = remeasureChanged();
            long te = System.nanoTime();
            patchedCmdsFor(changed);
            // 文本变更也要落到指令（文本改了但**几何没动**时不在 changed 矩形集里——
            // 不补这一步，"文本同步了却仍画旧字"）
            for (int id : textChangedIds) {
                Integer at = cmdIndexById.get(id);
                Integer idx = indexById.get(id);
                if (at == null || idx == null) continue;
                cmds.set(at, mkCmd(specs.get(idx), cmds.get(at)));
            }
            if (!textChangedIds.isEmpty()) pushToView();
            double emitMs = (System.nanoTime() - te) / 1e6;

            out.put("ok", true);
            out.put("applied", lastApplied);
            out.put("changed", lastChangedNodes);
            out.put("text_synced", textChangedIds.size());
            out.put("text_synced_total", textSyncedTotal);
            if (lastTextProbe != null) out.put("text_probe", new JSONObject(lastTextProbe));
            // ★字段名对着内核回执核过（内核回的是 `relayout_count`——首版读 `relayout` ⇒ 恒 -1，
            //   读数静默失效。本仓纪律：判据/读数取数要对实现核一遍。）
            out.put("relayout", uo.optInt("relayout_count", -1));
            // ★★内核拒收明细必须**透传**（取证纪律：取证盲区会把"指令被拒"伪装成"指令生效"）
            //   内核 `unsupported` = 逐条指令的拒收原因（keyId 越界 / 节点不在树上 / LIST_UPDATE 需映射…）。
            //   宿主此前不读它 ⇒ 判据只能看到 applied/changed 数字，看不到"这条根本没执行"。
            JSONArray unsupported = uo.optJSONArray("unsupported");
            if (unsupported != null && unsupported.length() > 0) {
                out.put("unsupported", unsupported);
            }
            out.put("layout_ms", round3(layoutMs));
            out.put("measure_ms", round3(measureMs));
            out.put("emit_cmds_ms", round3(emitMs));
            if (changed != null) out.put("rects", changed);
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /** `updatePatches` 调用次数（判据读它确认 B 路补丁真的过了宿主——不是只看 JS 侧自报） */
    int updatePatchCalls = 0;

    /**
     * ★★★**样式/文本增量补丁**（2026-10-01 · 更新路径 A/B）：**Vue 运行时路（B）的宿主入口**。
     *
     * 【它补的缺口】A 路（Vapor）的更新走二进制指令流（`applyOps`）；B 路（Vue 运行时）的
     *   适配器产出 `[{id, style}]` 形态的**样式补丁**（`takePatches()`）——此前宿主没有这个端口
     *   ⇒ B 路的更新**发不出来**（`entry-vapor.ts` 头注如实写着"属后续批次"）。本方法是那条链的落点。
     *
     * 【与 applyOps 的分工（同一个内核入口，两种形态）】
     *   · `applyOps`：**二进制**指令流（A 路；订阅表的紧凑编码——顺序读 + 定长字段）；
     *   · `updatePatches`：**JSON 补丁**（B 路；适配器直出）→ `RustLayout.update`（形状 `{id, style}`）。
     *   二者最终都落到"核心重排 → 只回变化集 → 增量更新绘制指令"，**同一条下游**（一处实现）。
     *
     * 【与 iOS `selfdraw-scene.updatePatches` 逐条对齐（本仓纪律：两端同构）】
     *   · 文本补丁要先**重度量再注入**（`{id, style:{text}}`——文本在 style 内，与 Rust `StylePatch`
     *     三处同形状）：核心的度量器按 nodeId 查快照，漏掉这步 ⇒ 按旧尺寸算几何（字被裁），
     *     **且没有任何报错**（iOS 侧实测过同款静默形状分叉）。
     *   · 返回读数与 iOS 同名同义：`applied` / `relayout_count` / `changed_rects` / `text_layers_applied`。
     */
    public String updatePatches(String patchesJson) {
        updatePatchCalls++;
        long t0 = System.nanoTime();
        JSONObject out = new JSONObject();
        try {
            if (handle == 0L) return err(out, "尚未 mount（补丁无树可改）").toString();
            JSONArray patches = new JSONArray(patchesJson);
            if (patches.length() == 0) {
                out.put("ok", true);
                out.put("applied", 0);
                out.put("changed_rects", 0);
                return out.toString();
            }
            JSONArray corePatches = new JSONArray();
            int applied = 0;
            /** 改过文本的 id（重度量 + 文本落层两处都要） */
            java.util.List<Integer> textIds = new java.util.ArrayList<>();
            /** ★改过绘制键的 id（纯绘制补丁要**重建指令**——见下方 ④ 的注释） */
            java.util.LinkedHashSet<Integer> paintChangedIds = new java.util.LinkedHashSet<>();
            int paintOnly = 0;
            for (int i = 0; i < patches.length(); i++) {
                JSONObject p = patches.getJSONObject(i);
                int id = p.getInt("id");
                JSONObject style = p.optJSONObject("style");
                if (style == null) continue;
                // ★物理化（与 mount 同一换算纪律：补丁里的长度同样是**逻辑单位**）
                physicalizeSpec(style);
                Integer idx = indexById.get(id);
                if (idx == null) continue;
                JSONObject spec = specs.get(idx);
                // ① 合并进 spec：几何键 + 文本进核心补丁；绘制键只留 spec（绘制用，核心不认）
                JSONObject coreStyle = new JSONObject();
                boolean hasGeometryKey = false;
                for (java.util.Iterator<String> it = style.keys(); it.hasNext(); ) {
                    String k = it.next();
                    Object v = style.get(k);
                    spec.put(k, v);
                    if ("text".equals(k)) {
                        coreStyle.put(k, v);
                        textIds.add(id);
                        hasGeometryKey = true;
                    } else if (LAYOUT_KEYS.contains(k)) {
                        coreStyle.put(k, v);
                        hasGeometryKey = true;
                    }
                }
                if (hasGeometryKey) {
                    JSONObject cp = new JSONObject();
                    cp.put("id", id);
                    cp.put("style", coreStyle);
                    corePatches.put(cp);
                    applied++;
                } else {
                    paintChangedIds.add(id);
                    paintOnly++;
                }
            }
            // ② 文本先重度量（顺序不可反：核心的度量器是快照——见 iOS updatePatches 同款注释）
            double measureMs = remeasureChanged();
            // ③ 核心增量重排（只发改动节点——不重发整树）。无几何键 ⇒ 不必进核心（如只改颜色）
            double layoutMs = 0;
            JSONObject changed = null;
            int relayout = -1;
            if (corePatches.length() > 0) {
                long tl = System.nanoTime();
                String upd = RustLayout.update(handle, corePatches.toString());
                layoutMs = (System.nanoTime() - tl) / 1e6;
                JSONObject uo = new JSONObject(upd);
                if (!uo.optBoolean("ok")) {
                    out.put("ok", false);
                    out.put("error", uo.optString("error", "update 失败"));
                    return out.toString();
                }
                changed = uo.optJSONObject("rects");
                relayout = uo.optInt("relayout_count", -1);
                lastApplied = uo.optInt("applied", -1);
                lastChangedNodes = changed != null ? changed.length() : 0;
                // ★★内核拒收明细透传（同 applyOps：取证盲区会把"补丁被拒"伪装成"补丁生效"）
                JSONArray unsupported2 = uo.optJSONArray("unsupported");
                if (unsupported2 != null && unsupported2.length() > 0) {
                    out.put("unsupported", unsupported2);
                }
                // ★文本落层（与 applyOps 同一条路；不落层 = 屏幕文字停留旧值——iOS 侧实测）
                JSONObject tu = uo.optJSONObject("text_updates");
                if (tu != null && tu.length() > 0) {
                    for (java.util.Iterator<String> it = tu.keys(); it.hasNext(); ) {
                        String k = it.next();
                        String t = tu.optString(k, null);
                        Integer ix = indexById.get(Integer.parseInt(k));
                        if (ix == null || t == null) continue;
                        specs.get(ix).put("text", t);
                        textSyncedTotal++;
                        lastTextProbe = "{\"id\":" + k + ",\"text\":" + JSONObject.quote(t) + "}";
                    }
                }
            }
            // ④ 增量更新绘制指令：几何变化集 + 文本变更（文本改了但几何没动 ⇒ 不在变化集里）
            long te = System.nanoTime();
            patchedCmdsFor(changed);
            int textApplied = 0;
            for (int id : textIds) {
                Integer at = cmdIndexById.get(id);
                Integer idx2 = indexById.get(id);
                if (at == null || idx2 == null) continue;
                cmds.set(at, mkCmd(specs.get(idx2), cmds.get(at)));
                textApplied++;
            }
            /* ★★★**纯绘制补丁的指令重建**（2026-10-03 · `:style` 对象展开批次实测抓出的真缺陷）：
             *   此前纯绘制补丁（改颜色/字号等、无几何键）只 `pushToView()` —— 而它推的是**旧 cmds**
             *   （spec 已更新、指令没重建）⇒ **颜色永远不变**（`RustLayout.update` 都没被调）。
             *   ⇒ 正解：纯绘制补丁也走 `mkCmd` 重建（与文本变更同一条路）。
             *   【为什么带 rects 用全量版本】prev 版本（`mkCmd(spec, prev)`）**不带绘制通道**
             *     （半径/渐变/发光/遮罩）——对带通道的节点会把通道洗掉（本仓实测过同类形态）。
             *     故有矩形时用全量版本（`mkCmd(spec, rects)`），无矩形才退回 prev 版本。 */
            if (paintOnly > 0 && corePatches.length() == 0) {
                JSONObject rects = new JSONObject(RustLayout.readRects(handle)).optJSONObject("rects");
                boolean rebuilt = false;
                for (int id : paintChangedIds) {
                    Integer at = cmdIndexById.get(id);
                    Integer idx2 = indexById.get(id);
                    if (at == null || idx2 == null) continue;
                    JSONObject r = rects != null ? rects.optJSONObject(String.valueOf(id)) : null;
                    if (r != null) cmds.set(at, mkCmd(specs.get(idx2), r));
                    else cmds.set(at, mkCmd(specs.get(idx2), cmds.get(at)));
                    rebuilt = true;
                }
                if (rebuilt) pushToView();
            } else if (textApplied > 0) pushToView();
            double emitMs = (System.nanoTime() - te) / 1e6;
            double totalMs = (System.nanoTime() - t0) / 1e6;
            out.put("ok", true);
            out.put("applied", applied);
            out.put("relayout", relayout);
            out.put("changed_rects", lastChangedNodes);
            out.put("measure_ms", round3(measureMs));
            out.put("layout_ms", round3(layoutMs));
            out.put("emit_cmds_ms", round3(emitMs));
            out.put("total_ms", round3(totalMs));
            out.put("text_layers_applied", textApplied);
            out.put("text_synced_total", textSyncedTotal);
            if (lastTextProbe != null) out.put("text_probe", new JSONObject(lastTextProbe));
            if (changed != null) out.put("rects", changed);
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /**
     * ★★**绘制通道探针**（判据用）：逐通道报"宿主真源里建出来了没"——
     * 不读我们发下去的参数（那是复述），读**宿主侧实际持有的状态**：
     *   · `grad`：`Cmd.gradient` 的 `kind:stops`（`drawCmds` 用的就是它）
     *   · `glow`：`Cmd.glow` 的 `层数:首层alpha`（分层同心描边）
     *   · `mask`：`Cmd.mask[0]`（0 = 无 / 1 = linear / 2 = radial）
     *   · `radius`：`Cmd.radius`（>0 = 走 drawRoundRect）
     *   · `clip`：`ProteusHostView.clipKindOf`（>0 = 画布裁剪形状就绪）
     *   · `stroke`：宿主 `nodeSvgStroke` 表里的路径总弧长（>0 = 描边层建出来了）
     */
    public String probeChannels(String idsJson) {
        JSONObject out = new JSONObject();
        try {
            JSONArray ids = new JSONArray(idsJson);
            JSONArray arr = new JSONArray();
            for (int i = 0; i < ids.length(); i++) {
                int id = ids.optInt(i);
                JSONObject o = new JSONObject();
                o.put("id", id);
                Integer at = cmdIndexById.get(id);
                if (at != null && at < cmds.size()) {
                    ProteusHostView.Cmd c = cmds.get(at);
                    o.put("radius", c.radius);
                    o.put("grad", c.gradient != null ? c.gradient.kind + ":" + c.gradient.colors.length : "");
                    if (c.glow != null) {
                        o.put("glow", (int) c.glow[1] + ":" + round3(c.glow[2]));
                    }
                    o.put("mask", c.mask != null ? (int) c.mask[0] : 0);
                }
                if (view != null) {
                    o.put("clip", view.clipKindOfPublic(id));
                    float len = view.svgStrokeLength(id);
                    if (len > 0) o.put("stroke_len", round3(len));
                }
                arr.put(o);
            }
            out.put("ok", true);
            out.put("channels", arr);
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /** ★★交互探针（判据用）：手势真的到了宿主吗 / 点在了哪个节点上 */
    public String probeGesture() {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("dispatched", gestureDispatched);
            o.put("last", lastGestureProbe != null ? new JSONObject(lastGestureProbe) : JSONObject.NULL);
        } catch (Throwable ignored) {
        }
        return o.toString();
    }

    /**
     * ★★**进程内注入一次 tap**（判据用；与 M6b / 长卷同一先例）——
     * 真机 `adb shell tap` 需 INJECT_EVENTS 权限（**静默失败**，本仓已实测多次），
     * 故由宿主自己 `dispatchTouchEvent` 注入真 MotionEvent：走完整 `GestureDetector` →
     * `hitTest` → 语义手势 → 回调链，与真实触摸**同一条代码路径**。
     *
     * ★★**时间戳逐次前推 1 秒**（2026-10-02 实测抓出的注入缺陷；**不是 sleep**——零等待）：
     *   `GestureDetector` 把「上一次 UP 后 300ms 内的 DOWN」判为**双击**，那时
     *   `onSingleTapUp` **不触发**。而判据注入是同步连发（A 相位 tap 后 B 相位 tap
     *   间隔 ≪ 300ms）⇒ 第二次 tap 被吞（真机实测：B 相位没有任何手势记录，
     *   而判据读到的 `last` 是 A 相位的**陈旧探针**——双重陷阱：事件没触发 + 读数不像缺失）。
     *   修复：事件时间戳是**纯属性**，把每次注入的 down/up 时间戳较上次**前推 1 秒**
     *   （`age = 1000ms × seq`）⇒ 相邻注入的 down−prev.up 间隔恒为 ~960ms > 300ms，
     *   **任何实现版本**都不会判成双击（含无 `DOUBLE_TAP_MIN_TIME` 下界检查的旧实现）；
     *   tap 判定只看 down→up 差值（40ms）不受影响。
     *   ★方向为什么选**前推**而不是回推：回推产生负的 down−up 差，旧实现缺下界检查时
     *     仍会落进双击分支（正值 >300ms 才在两版实现下都安全）。
     *   ★为什么不 sleep 隔开：盲等是红线，且会让判据注入付出真实墙钟代价。
     */
    private int tapInjectSeq = 0;
    public String tapAt(String argsJson) {
        JSONObject out = new JSONObject();
        try {
            if (view == null) return err(out, "视图未建").toString();
            JSONObject a = new JSONObject(argsJson);
            final float x = (float) a.optDouble("x", 0);
            final float y = (float) a.optDouble("y", 0);
            // ★事件时间戳前推（见方法注释）：seq 递增，down/up 相对真实时钟逐次更晚 1 秒
            long age = 1000L * tapInjectSeq;
            tapInjectSeq++;
            long t0 = android.os.SystemClock.uptimeMillis() + age;
            int before = gestureDispatched;
            android.view.MotionEvent down = android.view.MotionEvent.obtain(t0, t0,
                    android.view.MotionEvent.ACTION_DOWN, x, y, 0);
            view.dispatchTouchEvent(down);
            down.recycle();
            android.view.MotionEvent up = android.view.MotionEvent.obtain(t0, t0 + 40,
                    android.view.MotionEvent.ACTION_UP, x, y, 0);
            view.dispatchTouchEvent(up);
            up.recycle();
            out.put("ok", true);
            out.put("x", x);
            out.put("y", y);
            out.put("dispatched", gestureDispatched);
            // ★★本次注入**真的触发了几次手势**（防"陈旧探针被读成新读数"——本仓实测过：
            //   B 相位 tap 没触发手势，而判据把 A 相位的 last 读成 B 的 hit；有本字段即可判定）
            out.put("gestures_fired", gestureDispatched - before);
            out.put("last", lastGestureProbe != null ? new JSONObject(lastGestureProbe) : JSONObject.NULL);
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /**
     * ★★★**宿主动画入口**（P3-3 · `<Transition>` 桥接，2026-10-03）：
     *   `{anims:[{nodeId,kind,from,to,durMs,curve}]}` → 内核 `proteus_layout_anim_start`
     *   → **启帧循环**（`ProteusHostView.kernelAnimTick` 由 Choreographer 驱动、逐帧 tick
     *   并把采样写进绘制层——与 MA0-RT/MA5 同一套内核动画机器）。
     *
     * 【为什么"启动后还要自己 tick"】内核只做**求值**（给定 dt 给出该帧的通道值）；
     *   "每帧推一次"是**宿主帧循环**的职责（Android Choreographer / iOS CADisplayLink /
     *   鸿蒙帧回调）——与几何同纪律：JS 只产语义，平台负责驱动。
     *   `ProteusHostView.driveKernelAnimFrames(...)` 已实现该循环（MA0-RT 在用）⇒ 直接复用。
     */
    /** ★批次 42：上一棵树里带 CSS animation 的节点数（读数） */
    public int cssAnimNodes = 0;

    /**
     * ★批次 42（动效 · 对齐 Web）：**启动静态 CSS 动画**（编译期折叠的 `animation` → 逐通道 keyframe 规格）。
     *   读 specs 里各节点的 `animation`（`[{kind, from, keyframes:[{to,durMs,curve}]}]`）→ 组 `anim_start` 报文 →
     *   调既有 `animStart`（内核 + 帧循环）。返回启动动画的节点数（0 = 无）。
     */
    private int startStaticAnimations() {
        if (view == null) return 0;
        try {
            JSONArray anims = new JSONArray();
            int nodes = 0;
            for (JSONObject spec : specs) {
                JSONArray chans = spec.optJSONArray("animation");
                if (chans == null) continue;
                int id = spec.optInt("id", -1);
                if (id < 0) continue;
                boolean any = false;
                for (int i = 0; i < chans.length(); i++) {
                    JSONObject ch = chans.optJSONObject(i);
                    if (ch == null) continue;
                    JSONArray kf = ch.optJSONArray("keyframes");
                    if (kf == null || kf.length() == 0) continue;
                    double total = 0;
                    double lastTo = ch.optDouble("from", 0);
                    for (int k = 0; k < kf.length(); k++) {
                        JSONObject seg = kf.optJSONObject(k);
                        if (seg == null) continue;
                        total += seg.optDouble("durMs", 0);
                        lastTo = seg.optDouble("to", lastTo);
                    }
                    JSONObject one = new JSONObject();
                    one.put("nodeId", id);
                    one.put("kind", ch.optInt("kind"));
                    one.put("from", ch.optDouble("from"));
                    one.put("to", lastTo);
                    one.put("durMs", total);
                    one.put("keyframes", kf);
                    anims.put(one);
                    any = true;
                }
                if (any) nodes++;
            }
            if (anims.length() == 0) return 0;
            JSONObject req = new JSONObject();
            req.put("anims", anims);
            animStart(req.toString());
            return nodes;
        } catch (Throwable t) {
            return 0;
        }
    }

    public String animStart(String animsJson) {
        JSONObject out = new JSONObject();
        try {
            if (view == null) return err(out, "视图未建（先 mount）").toString();
            String res = view.kernelAnimStart(animsJson);
            // 复用既有帧循环（与 MA0-RT 的驱动同一条路：内核 tick → 采样 → 写层）
            view.driveKernelAnimFrames();
            JSONObject rr = new JSONObject(res);
            if (!rr.optBoolean("ok")) {
                out.put("ok", false);
                out.put("error", rr.optString("error", "内核 animStart 失败"));
                return out.toString();
            }
            out.put("ok", true);
            out.put("started", rr.optInt("started", -1));
            animStartCalls++;
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /** animStart 被调用次数（判据读它证明"过渡真的交给了宿主"） */
    public int animStartCalls = 0;

    /**
     * ★★**推进一帧**（动画桥的必需配套方法，2026-10-03）：
     *   JNI 侧**按方法对条件注入**——`animStart` 与 `animTick` **同时存在**才暴露给 JS
     *   （见 `quickjs_jni.c` 的注入判据）。`VaporRenderHost` 首版只加了 `animStart`
     *   ⇒ **未注入** ⇒ JS 侧 `typeof proteusHost.animStart` 为 undefined ⇒ 过渡静默不播
     *   （判据 ⑬ 当场红并**精确报出**"宿主未实现 animStart"——本仓实测）。
     *
     * @param dtMsJson 帧间隔（JSON 数字串，如 `"16.7"`；缺省 16.7 即 60fps）
     * @return `{"ok":true,"active":N}`（N = 内核仍在推进的动画条数）
     */
    public String animTick(String dtMsJson) {
        JSONObject out = new JSONObject();
        try {
            if (view == null) return err(out, "视图未建").toString();
            float dt = 16.7f;
            try { dt = Float.parseFloat(dtMsJson == null ? "16.7" : dtMsJson.trim()); } catch (Throwable ignored) { /* 用缺省 */ }
            view.kernelAnimTick(dt);
            out.put("ok", true);
            out.put("active", -1);
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /** 停动画（对齐 JNI 方法表；`animStop` 亦为条件注入项之一） */
    public String animStop(String json) {
        JSONObject out = new JSONObject();
        try {
            if (view != null) view.kernelTickStop();
            out.put("ok", true);
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /** 仍在推进的动画条数（判据：> 0 = 还没播完） */
    public String animActive() {
        JSONObject out = new JSONObject();
        try {
            if (handle == 0L) return err(out, "尚未 mount").toString();
            String a = RustLayout.animActive(handle);
            JSONObject ao = new JSONObject(a);
            out.put("ok", ao.optBoolean("ok", false));
            out.put("active", ao.optInt("active", -1));
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /** 几何真源（判据用）：直接读内核（`{"ok":true,"rects":{id:{x,y,width,height}}}`） */
    public String readRects() {
        if (handle == 0L) return "{\"ok\":false,\"error\":\"尚未 mount\"}";
        try {
            return RustLayout.readRects(handle);
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + t.getMessage() + "\"}";
        }
    }

    /* ══════════════════ ★★虚拟化（长列表：整树在内核、宿主只物化可见区）══════════════════ */

    /**
     * ★★★**虚拟化挂载**：`{viewport, nodes, rows}` → 全树进内核（几何正确）→ **只物化可见区**。
     *
     * 【与 iOS `mountVirtual` 同一分工（本仓纪律：两端同构）】
     *   · 核心给**决策**（`proteus_recycle_update` 回 acquire/release 行号），宿主只执行**动作**；
     *   · 不在任何行里的节点（容器/标题）**全量物化**——否则行会挂到根上（层序错）；
     *   · 行几何**不动**（内容坐标）：滚动 = `setContentScrollY`（画布平移），
     *     ⇒ 只有**进出视野的行**需要物化/丢弃，已物化的行零重算。
     *
     * @param treeJson `{viewport:{width,height}, nodes:[…], rows:[{index,key,root,ids:[…]}]}`
     *                 （`rows` 来自设备端实例化的 `instantiateTemplate(...).virtual.rows`）
     */
    public String mountVirtual(String treeJson) {
        mountCalls++;
        JSONObject out = new JSONObject();
        try {
            JSONObject tree = new JSONObject(treeJson);
            JSONArray nodes = tree.optJSONArray("nodes");
            JSONArray rowsRaw = tree.optJSONArray("rows");
            if (nodes == null || nodes.length() == 0) return err(out, "批次里没有节点").toString();
            if (rowsRaw == null || rowsRaw.length() == 0) return err(out, "rows 为空（虚拟化无意义）").toString();
            // ★物理化（与 mount 同一入口纪律——见 physicalizeTree）
            physicalizeTree(tree);
            JSONObject vp = tree.optJSONObject("viewport");
            final float vw = vp != null ? (float) vp.optDouble("width", 1080) : 1080f;
            final float vh = vp != null ? (float) vp.optDouble("height", 2400) : 2400f;

            ensureView();

            // ① specs（与全量 mount 同一条路——几何口径必须完全一致）
            if (handle != 0L) {
                RustLayout.destroy(handle);
                handle = 0L;
            }
            if (recycleHandle != 0L) {
                RustLayout.recycleDestroy(recycleHandle);
                recycleHandle = 0L;
            }
            // ★★同 mount：按 id 键的每树状态必须清空（见 `resetPerTreeState` 注释）
            if (view != null) view.resetPerTreeState();
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

            // ② 度量 → ③ 建树（★顺序不可反——见 mount 的同款注释）
            long tm = System.nanoTime();
            JSONObject measures = buildMeasures();
            double measureMs = (System.nanoTime() - tm) / 1e6;
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
            view.attachCore(handle);   // ★句柄每次重建都变 ⇒ 每次都要接（见 mount 的同款注释）

            // ④ 几何全量读一次（物化行时要用；与可见性无关）
            JSONObject rectsAll = new JSONObject(RustLayout.readRects(handle)).getJSONObject("rects");
            vRects.clear();
            for (java.util.Iterator<String> it = rectsAll.keys(); it.hasNext(); ) {
                String k = it.next();
                vRects.put(Integer.parseInt(k), rectsAll.getJSONObject(k));
            }

            // ⑤ 行描述 + 行距（行根 y 来自**内核几何真源**）
            final int nRows = rowsRaw.length();
            vrowIds = new int[nRows][];
            vrowRoots = new int[nRows];
            final java.util.Set<Integer> rowNodeIds = new java.util.HashSet<>();
            for (int i = 0; i < nRows; i++) {
                JSONObject r = rowsRaw.getJSONObject(i);
                vrowRoots[i] = r.optInt("root", -1);
                JSONArray ids = r.optJSONArray("ids");
                int[] arr = new int[ids != null ? ids.length() : 0];
                for (int j = 0; j < arr.length; j++) {
                    arr[j] = ids.optInt(j);
                    rowNodeIds.add(arr[j]);
                }
                vrowIds[i] = arr;
            }
            // I2-ALLOW: 滚动索引数学（行顶 y 来自内核回执，转成宿主可见区索引数组——
            //   不参与绘制、不写回内核；绘制几何一律走内核指令流）
            rowTops = new int[nRows];
            for (int i = 0; i < nRows; i++) {
                JSONObject rr = vRects.get(vrowRoots[i]);
                rowTops[i] = rr != null ? (int) Math.round(rr.optDouble("y")) : 0;
            }
            rowPitch = nRows >= 2 ? Math.max(1, rowTops[1] - rowTops[0]) : 100;
            vViewportH = (int) vh;
            vScrollY = 0;

            // ⑥ 复用池句柄（核心给决策、宿主执行动作）
            recycleHandle = RustLayout.recycleCreate(nRows, 0, 0);
            if (recycleHandle == 0L) return err(out, "recycleCreate 失败").toString();

            // ⑦ 节点级绘制状态统一注入（一次遍历——**不随行物化重复**）
            injectAllNodeState();
            //    静态部分（不属任何行的节点）全量物化——否则行会挂到根上（层序错）
            staticCmds.clear();
            for (int i = 0; i < specs.size(); i++) {
                int id = specs.get(i).getInt("id");
                if (rowNodeIds.contains(id)) continue;
                JSONObject rc = vRects.get(id);
                if (rc == null) continue; // 无盒（display:none）——不产生指令
                staticCmds.add(new NodeCmd(i, specs.get(i).getInt("id"), mkCmd(specs.get(i), rc)));
            }

            // ⑧ 首帧：可见区 → 核心决策 → 物化（含预载区）
            rowCmds.clear();
            liveRows.clear();
            builtTotal = 0;
            releasedRowsTotal = 0;
            rowFramesTotal = 0;
            int[] rng = visibleRange();
            JSONObject uo = new JSONObject(RustLayout.recycleUpdate(recycleHandle, rng[0], rng[1]));
            int acq = applyRecycle(uo);
            assembleAndPush();
            rowFramesTotal += liveRows.size();
            view.setContentScrollY(0);
            sigTop = view.renderSignature();

            out.put("ok", true);
            out.put("node_count", specs.size());
            out.put("row_count", nRows);
            out.put("row_pitch", rowPitch);
            out.put("cmds_live", lastCmdCount);
            out.put("rows_live", liveRows.size());
            out.put("acquired_first", acq);
            out.put("built_total", builtTotal);
            out.put("layout_ms", round3(layoutMs));
            out.put("measure_ms", round3(measureMs));
            out.put("painted_samples", sample(0));
            out.put("sig_top_len", sigTop != null ? sigTop.length : 0);
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /**
     * **滚动一帧**（虚拟化）：`{dy, capture}` → 更新可见区 → 核心决策 → 物化/释放 → 重绘。
     *
     * 【为什么"行几何不动、只换行"成立】行内容坐标固定（内核算的），滚动是
     *   `setContentScrollY` 的画布平移 ⇒ 已物化的行**零重算**，只有进出视野的行做物化/丢弃
     *   ——这正是"滚动时不触发堆分配"的落点（判据用 built_total 有界来验它）。
     *
     * @param argsJson `{"dy":100}` 或 `{"dy":0,"capture":true}`（capture = 采像素签名对比顶部）
     */
    public String scrollRows(String argsJson) {
        JSONObject out = new JSONObject();
        try {
            if (recycleHandle == 0L || vrowIds == null) return err(out, "未做虚拟化挂载").toString();
            JSONObject a = new JSONObject(argsJson);
            // I2-ALLOW: 滚动**输入参数**解析（调用方给的像素增量，非"内核几何→平台 API"换算；
            //   几何输出仍由内核统一吸附）
            final int dy = (int) Math.round(a.optDouble("dy", 0));
            final boolean capture = a.optBoolean("capture", false);

            final int contentH = rowTops[vrowRoots.length - 1] + rowPitch;
            final int maxScroll = Math.max(0, contentH - vViewportH);
            final int before = vScrollY;
            vScrollY = Math.max(0, Math.min(maxScroll, vScrollY + dy));

            // ① 可见区（行根 y 来自内核真源）→ ② 核心决策
            int[] rng = visibleRange();
            JSONObject uo = new JSONObject(RustLayout.recycleUpdate(recycleHandle, rng[0], rng[1]));
            // ③ 执行动作（**先 release 再 acquire**——本仓纪律，见 RustLayout 注释）
            final int acq = applyRecycle(uo);
            // ④ 组装（按节点序 → 绘制顺序 = 树序）+ 画布平移
            assembleAndPush();
            view.setContentScrollY(vScrollY);
            rowFramesTotal += liveRows.size();

            out.put("ok", true);
            out.put("scroll_y", vScrollY);
            out.put("moved", vScrollY != before);
            out.put("first_visible", rng[0]);
            out.put("last_visible", rng[1]);
            out.put("acquired", acq);
            out.put("released", releasedRowsTotal >= 0 ? lastReleasedN : -1);
            out.put("live_rows", liveRows.size());
            out.put("cmds_live", lastCmdCount);
            out.put("built_total", builtTotal);
            out.put("released_total", releasedRowsTotal);
            out.put("row_frames_total", rowFramesTotal);
            if (capture && sigTop != null) {
                out.put("sig_diff_pct", sigDiffPct(sigTop, view.renderSignature()));
            }
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /** 最近一帧释放的行数（读数） */
    private int lastReleasedN = 0;

    /** 可见行区间（由**内核几何**推：行根 y 与行距——宿主不做第二份布局数学） */
    private int[] visibleRange() {
        final int n = vrowRoots.length;
        if (n == 0) return new int[]{0, 0};
        final int y0 = rowTops[0];
        // I2-ALLOW: 可见**区间索引**（行号，非几何换算——向下取整是索引语义；
        //   几何真值仍走内核指令流）
        int first = (int) Math.floor((double) (vScrollY - y0) / rowPitch);
        first = Math.max(0, Math.min(n - 1, first));
        // I2-ALLOW: 同上——可见区间末尾行号（索引语义）
        int last = (int) Math.floor((double) (vScrollY + vViewportH - y0) / rowPitch);
        last = Math.max(first, Math.min(n - 1, last));
        return new int[]{first, last};
    }

    /** 执行核心的 acquire/release 决策（**先 release 再 acquire**） */
    private int applyRecycle(JSONObject uo) throws Exception {
        int relN = 0;
        JSONArray rel = uo.optJSONArray("release");
        if (rel != null) {
            for (int i = 0; i < rel.length(); i++) {
                int r = rel.optInt(i);
                rowCmds.remove(r);
                liveRows.remove(r);
                releasedRowsTotal++;
                relN++;
            }
        }
        int acqN = 0;
        JSONArray acq = uo.optJSONArray("acquire");
        if (acq != null) {
            for (int i = 0; i < acq.length(); i++) {
                int r = acq.optInt(i);
                materializeRow(r);
                liveRows.add(r);
                acqN++;
            }
        }
        lastReleasedN = relN;
        return acqN;
    }

    /** 物化一行（该行全部节点 → 指令；行几何来自内核 rects） */
    private void materializeRow(int r) throws Exception {
        List<NodeCmd> list = new ArrayList<>();
        for (int id : vrowIds[r]) {
            Integer idx = indexById.get(id);
            if (idx == null) continue;
            JSONObject rc = vRects.get(id);
            if (rc == null) continue;
            list.add(new NodeCmd(idx, id, mkCmd(specs.get(idx), rc)));
        }
        rowCmds.put(r, list);
        builtTotal++;
    }

    /** 组装存活指令（静态 + 存活行，按**节点序**排序 ⇒ 绘制顺序 = 树序）+ 上屏 */
    private void assembleAndPush() {
        List<NodeCmd> all = new ArrayList<>(staticCmds.size() + liveRows.size() * 2);
        all.addAll(staticCmds);
        for (int r : liveRows) {
            List<NodeCmd> c = rowCmds.get(r);
            if (c != null) all.addAll(c);
        }
        all.sort((a, b) -> Integer.compare(a.nodeIdx, b.nodeIdx));
        List<ProteusHostView.Cmd> outCmds = new ArrayList<>(all.size());
        cmds.clear();
        cmdIdsOf.clear();
        for (NodeCmd nc : all) {
            outCmds.add(nc.cmd);
            cmds.add(nc.cmd);
            cmdIdsOf.add(nc.nodeId);
        }
        lastCmdCount = cmds.size();
        pushToView();
    }

    /** 两份签名的差异百分比（0..100；capture 帧用） */
    // I2-ALLOW: 统计与报告（差异百分比读数——不是几何）
    private static double sigDiffPct(int[] a, int[] b) {
        final int n = Math.min(a.length, b.length);
        if (n == 0) return -1;
        int diff = 0;
        for (int i = 0; i < n; i++) if (a[i] != b[i]) diff++;
        // I2-ALLOW: 统计与报告（差异百分比读数——人类可读的一位小数，不是几何）
        return Math.round(1000.0 * diff / n) / 10.0;
    }

    /* ────────────────────────── 内部：度量 / 核心键 / 指令 ────────────────────────── */

    /**
     * 几何相关键白名单（与 `JsRenderHost.LAYOUT_KEYS` 同源；**纯绘制属性不进核心**）。
     *
     * ★★**内核必需的"静态基态声明"也要带**（2026-10-01 实测抓出的缺口）：
     *   `clipPath`（裁剪形状 = 裁剪动画的基态）与 `svgPath`（路径本体 = 描边/变形的基态）
     *   是**内核要解析**的声明——不在白名单 ⇒ 请求树不带 ⇒ 内核 `svg_nodes` 回空 ⇒
     *   **描边层建不出来（静默）**。这正是 `LightsHost.CORE_KEYS` 早就注释过的同款教训
     *   （"不在白名单 ⇒ 内核拒绝且静默"），本通路首版又踩了一次。
     *   ★而 `fillGradient` / `glow` / `mask` / `borderRadius` 等**纯绘制**属性不进内核
     *     （内核不认也不该认——它们只影响绘制）。
     */
    private static final java.util.Set<String> LAYOUT_KEYS = new java.util.HashSet<>(java.util.Arrays.asList(
            "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
            "margin", "padding", "flexDirection", "flexWrap", "justifyContent", "alignItems", "alignContent", "alignSelf",
            "flexGrow", "flexShrink", "flexBasis", "gap", "rowGap", "columnGap", "display", "position", "top", "left", "right", "bottom",
            "gridTemplateColumns", "gridTemplateRows", "aspectRatio", "pointerEvents", "fontFamily",
            "widthRatio", "heightRatio", "marginAuto", "minWidthPct", "maxWidthPct", "minHeightPct", "maxHeightPct", "overflow",
            // ★静态基态声明（内核要解析）：裁剪形状 + 路径本体（+ 描边色/宽随 svgPath 一起进）
            "clipPath", "svgPath", "svgPathTo", "perspective"));

    /* ══════════════ 物理化（逻辑单位 → 物理像素的**唯一换算点**） ══════════════
     *
     * 【单位模型（依《Proteus_单位系统与舍入规范》§1/§3）】
     *   统一公式：**物理像素 = 设计单位 × 密度**（文本再 × 字体缩放——校验场景按 §6.3 锁定为 1.0）。
     *   各端宿主 API 期望的输入单位不同（规范 §1.2）：Android Canvas = px（**物理**）·
     *   iOS CALayer = point（逻辑）· Web = CSS px（逻辑）· MP = 逻辑 px。
     *   ⇒ **只有 Android 这一端需要显式换算**（iOS/Web/MP 由平台自身按 scale 缩放）；
     *     不换算的实测后果：锚块 80px（其它端 130~240px）、内容只占屏 22%（其它端 91~96%）。
     *
     * 【★为什么是"入口一次换算"而不是"用到处补"（本轮两版失败换来的教训）】
     *   第一版在 JS 侧改模板 style ⇒ 漏**动态绑定**（`:width="item.w"` 走求值器不经模板字典）：
     *     chip 高缩放对了（96=32×3）而宽没缩放（40）。
     *   第二版改成 `coreNodes()` 局部缩放 ⇒ 只覆盖**布局标量**，漏**绘制侧长度**
     *     （borderRadius / fontSize（绘制读取处）/ glow.radius / strokeWidth）：
     *     chip 圆角变方、蓝点由圆变方、字"度量 3× 而绘制 1×"两边打架——用户当场目视抓出。
     *   ⇒ 正解：**换算只做一次，在树的唯一入口**，把 spec 全部改写为物理单位后落表；
     *     之后**所有消费者**（内核输入 coreNodes / 绘制 mkCmd / 文本度量 buildMeasures /
     *     命中测试 / 报告）读到的**天然全是物理值**——不存在"半物理化"的中间态。
     *
     * 【与规范的对齐（逐条）】
     *   · §2.4「宿主层仅做单位换算，且为一次乘法，不含任何 round/floor/ceil」——本处仅 `× scale`，
     *     **零舍入**；吸附（snap）仍在内核导出边界（物理空间）完成；
     *   · §6.3「一致性校验必须锁定字体缩放配置」——`StressSfcActivity` 未传 fontScale ⇒ 锁 1.0；
     *   · §12「非整数 DPR 下 snap 后不得为 0」——吸附在内核（本类不参与，见 I2 卡）。
     *
     * 【覆盖范围（唯一清单；新增长度字段必须登记）】见 LEN_SCALARS / 边缘对象 / glow.radius。
     * 【诚实边界（本批不做，需内核侧密度=规范 U0）】
     *   · `applyOps` 的**二进制指令流**：值在 JS 侧编码、内核侧解码 ⇒ 宿主无法介入换算
     *     （本批场景不用该路径；登记为 U0 的前置证据）；
     *   · `svgPath.d` 的坐标与 strokeWidth：由**内核解析**（字符串内嵌数值）⇒ 同理需 U0。
     */
    private float lengthScale = 1f;
    /** 设置长度缩放（缺省 1 = 既有场景零行为变化） */
    void setLengthScale(float s) { if (s > 0) lengthScale = s; }

    /**
     * 标量长度字段白名单（**唯一清单**）。
     * ★比例/枚举/分数**不得入内**：flexGrow/flexShrink（比例）· widthRatio/heightRatio（比例）·
     *   opacity（0..1）· clipPath.params（盒分数）· mask.{angle,cx,cy,r,softness}（单位空间）·
     *   transformOrigin（0..1）· gradient stops[].offset（0..1）/ angle（度）。
     * ★扁平四边键也登记（`:margin-top="x"` 这类绑定的落表形态）——有则缩、无则跳，零副作用。
     */
    private static final String[] LEN_SCALARS = {
        "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
        "top", "left", "right", "bottom", "gap", "flexBasis",
        "fontSize", "letterSpacing", "borderRadius", "borderWidth", "perspective",
        "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
        "marginTop", "marginRight", "marginBottom", "marginLeft",
        "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    };

    /** 物理化一个 spec/样式对象（原地改写；同时被 mount/updatePatches 复用——同一清单一处实现） */
    private void physicalizeSpec(JSONObject spec) throws Exception {
        if (lengthScale == 1f || spec == null) return;
        for (String k : LEN_SCALARS) {
            if (!spec.has(k) || spec.isNull(k)) continue;
            Object v = spec.get(k);
            if (v instanceof Number) spec.put(k, ((Number) v).doubleValue() * lengthScale);
        }
        // 四边对象（margin/padding：{top,right,bottom,left}）
        for (String k : new String[]{"margin", "padding"}) {
            JSONObject e = spec.optJSONObject(k);
            if (e == null) continue;
            for (String side : new String[]{"top", "right", "bottom", "left"}) {
                if (e.has(side) && e.get(side) instanceof Number) e.put(side, e.getDouble(side) * lengthScale);
            }
        }
        // 嵌套绘制对象里的长度：glow.radius（alpha 是比例，不缩放）
        JSONObject glow = spec.optJSONObject("glow");
        if (glow != null && glow.has("radius") && glow.get("radius") instanceof Number) {
            glow.put("radius", glow.getDouble("radius") * lengthScale);
        }
        // ★批次 39：静态变换（transform）的 **px 位移**按密度缩放（txPct/tyPct 是盒比例、scale/rotate 无量纲——不动）
        JSONObject tf = spec.optJSONObject("transform");
        if (tf != null) {
            for (String k : new String[]{"txPx", "tyPx"}) {
                if (tf.has(k) && tf.get(k) instanceof Number) tf.put(k, tf.getDouble(k) * lengthScale);
            }
        }
        // ★批次 10：盒阴影长度（dx/dy/blur/spread 是长度，缩放；color 不动）
        JSONObject shadow = spec.optJSONObject("boxShadow");
        if (shadow != null) {
            for (String k : new String[]{"dx", "dy", "blur", "spread"}) {
                if (shadow.has(k) && shadow.get(k) instanceof Number) shadow.put(k, shadow.getDouble(k) * lengthScale);
            }
        }
    }

    /** 物理化整棵树（viewport + 全部 nodes）——mount / mountVirtual 的入口各调一次 */
    private void physicalizeTree(JSONObject tree) throws Exception {
        if (lengthScale == 1f) return;
        JSONObject vp = tree.optJSONObject("viewport");
        if (vp != null) {
            if (vp.has("width") && vp.get("width") instanceof Number) vp.put("width", vp.getDouble("width") * lengthScale);
            if (vp.has("height") && vp.get("height") instanceof Number) vp.put("height", vp.getDouble("height") * lengthScale);
        }
        JSONArray nodes = tree.optJSONArray("nodes");
        if (nodes != null) {
            for (int i = 0; i < nodes.length(); i++) physicalizeSpec(nodes.optJSONObject(i));
        }
    }

    /** 节点 → 核心请求（只带几何键；`text` 单独带，供核心记入文本叶） */
    private JSONArray coreNodes() throws Exception {
        JSONArray arr = new JSONArray();
        for (JSONObject spec : specs) {
            JSONObject c = new JSONObject();
            c.put("id", spec.getInt("id"));
            if (spec.has("parentId") && !spec.isNull("parentId")) c.put("parentId", spec.getInt("parentId"));
            // ★读 spec 原值——spec 已在**入口物理化**（physicalizeTree：scale=1 时为恒等），
            //   此处**不再缩放**（避免双倍缩放；见 physicalizeTree 的"两版失败教训"）
            for (String k : LAYOUT_KEYS) {
                if (spec.has(k) && !spec.isNull(k)) c.put(k, spec.get(k));
            }
            String t = spec.optString("text", null);
            if (t != null && !t.isEmpty()) {
                c.put("text", t);
                c.put("isText", true);
            }
            arr.put(c);
        }
        return arr;
    }

    /** ★★全端对齐批：本树 viewport（第二遍测量重建树用） */
    private float lastVw = 1080f, lastVh = 2400f;

    /**
     * ★★全端对齐批（2026-10-05）：**wrap 文本的第二遍测量**（按解析盒宽折行）。
     *   返回**新请求体的 UTF-8 字节**（有 wrap 文本且尺寸变化时）；无需重建 ⇒ null。
     */
    private byte[] applyWrapRemeasure(float vw, float vh) throws Exception {
        if (handle == 0L) return null;
        org.json.JSONObject rectsAll = new org.json.JSONObject(RustLayout.readRects(handle));
        org.json.JSONObject rects = rectsAll.optJSONObject("rects");
        if (rects == null) return null;
        JSONObject measures = buildMeasures();   // 首遍表（单行）
        boolean changed = false;
        for (JSONObject spec : specs) {
            String t = spec.optString("text", null);
            if (t == null || t.isEmpty()) continue;
            String ws = spec.optString("whiteSpace", null);
            // ★★第三轮复评：缺省 = normal（可折行）——与 mkCmd 同判据（一处语义两处消费，必须同步）
            boolean wrapMode = !("nowrap".equals(ws) || "pre".equals(ws));
            if (!wrapMode) continue;
            org.json.JSONObject r = rects.optJSONObject(String.valueOf(spec.getInt("id")));
            if (r == null) continue;
            float boxW = (float) r.optDouble("width");
            if (boxW <= 1f) continue;
            float fs = (float) spec.optDouble("fontSize", 14);
            android.text.TextPaint tp = new android.text.TextPaint();
            tp.setTextSize(fs);
            int mw = (int) spec.optDouble("fontWeight", 400);
            tp.setTypeface(ProteusHostView.typefaceOf(spec.optString("fontFamily", null), mw, null));
            float ls = (float) spec.optDouble("letterSpacing", 0);
            if (ls != 0f && fs > 0f) tp.setLetterSpacing(ls / fs);
            android.text.StaticLayout sl = android.text.StaticLayout.Builder
                    .obtain(t, 0, t.length(), tp, Math.max(1, (int) Math.ceil(boxW)))
                    .setIncludePad(false)
                    .build();
            int lines = sl.getLineCount();
            if (lines <= 1) continue;   // 单行 ⇒ 与首遍等价（零操作）
            float lh = lineHeightPxOf(spec, fs);
            float h = lh > 0f ? lines * lh : sl.getHeight();
            float w = 0f;
            for (int i = 0; i < lines; i++) w = Math.max(w, sl.getLineWidth(i));
            JSONObject sz = new JSONObject();
            sz.put("width", Math.ceil(Math.min(boxW, w + 0.5f)));
            sz.put("height", Math.ceil(h));
            measures.put(String.valueOf(spec.getInt("id")), sz);
            changed = true;
        }
        if (!changed) return null;
        JSONObject request = new JSONObject();
        request.put("viewport", new JSONObject().put("width", vw).put("height", vh));
        request.put("nodes", coreNodes());
        request.put("textMeasures", measures);
        return request.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    /**
     * 文本度量（宿主注入——内核不自研文本）。
     *
     * ★★2026-10-02 实测修复两处与既有通路的**口径不一致**（六端 SFC 压测抓出）：
     *   ① 高度：首版用 `fs × 1.4` **启发式近似**，而 `JsRenderHost` 用**真实字体度量**
     *      `ceil(descent − ascent)`——同一份文本两宿主给出不同高度（实测 18pt 文本：
     *      近似 25.3 逻辑 vs 真实 ≈21）⇒ 标题盒高差 4.3px 把后续行整体下推
     *      （实测：Android 行盒 top=155 vs Web/iOS/MP=151）。
     *   ② 宽度：首版多加了 `+2`（`JsRenderHost` 没有）——同款冗余。
     *   修法：与 `JsRenderHost.measureTexts` **逐字对齐**（本仓纪律：同一语义一处实现——
     *   此前注释写着"同口径"而实际不同，是**注释与实现不一致**的典型）。
     *   ★与 iOS（CoreText 自然度量）和 Web（浏览器自然行盒）由此对齐到同一口径。
     */
    private JSONObject buildMeasures() throws Exception {
        JSONObject m = new JSONObject();
        for (JSONObject spec : specs) {
            String t = spec.optString("text", null);
            if (t == null || t.isEmpty()) continue;
            // ★字号**不在这里缩放**：spec 已在入口物理化（physicalizeTree）⇒ 此处即物理字号
            //   （首版在这里乘了一次，同时 mkCmd 的绘制侧未乘 ⇒ "度量 3×、绘制 1×"两边打架）
            float fs = (float) spec.optDouble("fontSize", 14);
            android.text.TextPaint tp = new android.text.TextPaint();
            tp.setTextSize(fs);
            // ★批次 3：度量与绘制**同源**（bold 字形更宽 —— 度量不带字重会与绘制不一致，本仓已踩过
            //   "度量用一支字体/绘制用另一支"的坑）。缺省 400 = normal ⇒ 既有路径零变化。
            int mw = (int) spec.optDouble("fontWeight", 400);
            // ★批次 36：字体角色（font-family → role）+ 字重（度量与绘制同源）
            tp.setTypeface(ProteusHostView.typefaceOf(spec.optString("fontFamily", null), mw, null));
            // ★批次 20：字距（px ⇒ em；与绘制同源，否则度量窄、绘制宽）
            float ls = (float) spec.optDouble("letterSpacing", 0);
            if (ls != 0f && fs > 0f) tp.setLetterSpacing(ls / fs);
            float w = tp.measureText(t);
            android.graphics.Paint.FontMetrics fm = tp.getFontMetrics();
            float glyphH = fm.descent - fm.ascent;   // ★真实字体度量（原 fs×1.4 近似已删）
            // ★批次 13（line-height）：行盒高 = 行高（倍数×fs 或绝对 px）；缺省 = 字形度量高
            float lh = lineHeightPxOf(spec, fs);
            float h = lh > 0 ? lh : glyphH;
            JSONObject sz = new JSONObject();
            // I2-ALLOW: 文本**测量**结果的取整（测量子系统，非几何换算——度量值交给内核后
            //   由内核统一 `snap` 吸附；平台层对**几何**零舍入，与 JsRenderHost 同款）
            sz.put("width", Math.ceil(w));
            sz.put("height", Math.ceil(h));
            m.put(String.valueOf(spec.getInt("id")), sz);
        }
        return m;
    }

    /**
     * ★批次 13：`line-height` token → **行盒高 px**（0 = 未声明，用字形度量高）。
     *   无单位倍数（`1.6`）⇒ `1.6 × fontSize`；绝对（`24px`）⇒ 24。
     */
    static float lineHeightPxOf(JSONObject spec, float fontSizePx) {
        String lh = spec.optString("lineHeight", null);
        if (lh == null || lh.isEmpty()) return 0f;
        try {
            if (lh.endsWith("px")) return Float.parseFloat(lh.substring(0, lh.length() - 2));
            return Float.parseFloat(lh) * fontSizePx;   // 无单位倍数
        } catch (NumberFormatException e) {
            return 0f;
        }
    }

    /** 变化节点的文本重度量（文本更新 ⇒ 需注入新度量再重排；先度量后重排的纪律不变） */
    private double remeasureChanged() throws Exception {
        // 简化实现：整表重算（文本节点数量级小；正确性优先——与 JsRenderHost 的 remeasure 同语义）
        long t0 = System.nanoTime();
        JSONObject measures = buildMeasures();
        RustLayout.setTextMeasures(handle, measures.toString());
        return (System.nanoTime() - t0) / 1e6;
    }

    /**
     * 建一条绘制指令（**不可变 Cmd**：字段 final，只能整条替换——见 ProteusHostView.Cmd 的构造链）。
     *
     * 最小绘制集：矩形 + 底色 + 文本（+ 字号/文字色）。半径/渐变/发光/遮罩留待后续批次
     * （那些通道的宿主实现已在 `ProteusHostView.drawCmds` 里就绪，本入口先打通"编译产物驱动"
     * 这条链的骨架——诚实边界写在这里，不假装已覆盖全部绘制通道）。
     */
    private ProteusHostView.Cmd mkCmd(JSONObject spec, JSONObject r) throws Exception {
        float x = (float) r.optDouble("x");
        float y = (float) r.optDouble("y");
        float w = (float) r.optDouble("width");
        float h = (float) r.optDouble("height");
        // ★批次 25（CSS 兼容对齐 · 以 Web 为基准）：`visibility:hidden` ⇒ **仍占位、不绘制**。
        //   编译器**已按继承**把 hidden 传播到全部后代（除非显式 visible 覆盖）⇒ 此处只需看本节点自身。
        //   返回一个「什么都不画」的 Cmd（color=0 / 无文本 / 无边框阴影）。
        if ("hidden".equals(spec.optString("visibility", null))) {
            return new ProteusHostView.Cmd(x, y, w, h, 0, null, 0f, 0, 0f);
        }
        String bg = spec.optString("backgroundColor", null);
        int color = bg != null ? parseColor(bg) : 0;

        // ★★**静态绘制的注入**（2026-10-01 · 绘制通道补齐）：裁剪与 SVG 描边是**宿主节点表**
        //   上的状态（`drawCmds` 按节点 id 查表），不是 `Cmd` 字段 ⇒ 这里注入一次。
        //   与 `LightsHost.emitCmds` 同一做法（同一语义一处实现：那边是节目通路、这边是 Vapor 通路）。
        final int id = spec.getInt("id");
        if (view != null) {
            // ★逐节点只注入**廉价**的节点级状态（读本地 spec，零跨边界调用）；
            //   SVG 描边要查内核（`svgNodes`）——那是**挂载后统一注入一次**（见 injectAllNodeState：
            //   逐节点调用会让每节点付一次 JSON 解析，1000 行虚拟化直接垮）
            injectClipPath(id, spec);
            injectTransformOrigin(id, spec);
            injectRadiusCorners(id, spec);
            injectFontRole(id, spec);
        }

        // ★★**Cmd 上的绘制通道**（与 LightsHost 的构造逐项对齐）：
        //   radius（圆角）/ gradient（渐变）/ glow（发光）/ mask（软遮罩）
        // ★批次 18（CSS 兼容对齐 · 以 Web 为基准）：`border-radius` 百分比 ⇒ radius = pct × min(w,h)
        //   （正方盒 = 内切圆，与 Web `border-radius:50%` 一致；比例字段不乘密度，w/h 已是物理 px）。
        float radius = (float) spec.optDouble("borderRadius", 0);
        final double radiusPct = spec.optDouble("borderRadiusPct", 0);
        if (radiusPct > 0) radius = (float) (radiusPct * Math.min(w, h));
        final ProteusHostView.GradSpec grad = parseGrad(spec.optJSONObject("fillGradient"));
        final float[] glowSpec = parseGlow(spec.optJSONObject("glow"));
        final float[] maskSpec = parseMask(spec.optJSONObject("mask"));
        // ★批次 5：uniform 边框（宽度 + 颜色；颜色缺省 0 ⇒ 不画边框）
        final float bw = (float) spec.optDouble("borderWidth", 0);
        String bcStr = spec.optString("borderColor", null);
        final int bc = bcStr != null ? parseColor(bcStr) : 0;
        // ★批次 10：盒阴影（结构化 {dx,dy,blur,spread,color} → float[]）
        final float[] shadowSpec = parseBoxShadow(spec.optJSONObject("boxShadow"));

        String t = spec.optString("text", null);
        if (t != null && !t.isEmpty()) {
            float fs = (float) spec.optDouble("fontSize", 14);
            String tc = spec.optString("color", null);
            int textColor = tc != null ? parseColor(tc) : 0xFFFFFFFF;
            // ★批次 3：字重（`font-weight` 折叠值；缺省 400 = normal）
            int fw = (int) spec.optDouble("fontWeight", 400);
            // ★批次 16（CSS 兼容对齐 · 以 Web 为基准）：`text-overflow: ellipsis` —— **单行**溢出以 … 截断。
            //   ★在 mkCmd（挂载/更新各一次）算好并替换文本 ⇒ **绘制路径零额外开销**（与 StaticLayout
            //     缓存同理）；`clip`/未声明 ⇒ 原样（既有零行为变化）。Web 语义：本仓文本无自动换行。
            // ★★全端对齐批（2026-10-05 · white-space 五端对齐）：读换行模式——
            //   wrap 类（normal/pre-wrap/pre-line/pre）⇒ 折行绘制；nowrap ⇒ 单行（省略号或裁切）。
            final String wsRaw = spec.optString("whiteSpace", null);
            // ★★第三轮复评修复（2026-10-05）：**缺省 = CSS `normal`（可折行）**——
            //   此前"缺省=单行"让未声明 white-space 的文本不折行（复评抓出：副标题尾部
            //   「寻址」在 App 端被裁而 Web 折 2 行）。CSS 缺省即 normal；只有显式
            //   `nowrap`/`pre` 才是单行。
            final boolean wsWrap = !("nowrap".equals(wsRaw) || "pre".equals(wsRaw));
            if (!wsWrap && "ellipsis".equals(spec.optString("textOverflow", null)) && w > 1f) {
                android.text.TextPaint etp = new android.text.TextPaint(); // 度量与绘制同源（字号 + 字重）
                etp.setTextSize(fs);
                etp.setTypeface(ProteusHostView.typefaceOf(null, fw, null));
                // ★★全端对齐批（2026-10-05）：**仅在真溢出时**截断——短文本（盒宽 == 文本宽，
                //   如「短标题」）此前被 `w - 2` 的固定余量误判为溢出 ⇒ 恒截成「短...」
                //   （独立视觉验收抓出的 Android blocker）。判据用完整文宽 > 盒宽 + 0.5 容差。
                final float fullW = etp.measureText(t);
                if (fullW > w + 0.5f) {
                    t = android.text.TextUtils.ellipsize(t, etp, Math.max(1f, w - 2f),
                            android.text.TextUtils.TruncateAt.END).toString();
                }
            }
            // ★批次 4：文本水平对齐（text-align → 0/1/2）
            int ta = alignOf(spec.optString("textAlign", null));
            // ★批次 13：行高（px；0 = 缺省）
            float lh = lineHeightPxOf(spec, fs);
            // ★批次 20：字距（px）
            float ls = (float) spec.optDouble("letterSpacing", 0);
            // ★批次 35：文本装饰（0=none/1=underline/2=line-through）
            String td = spec.optString("textDecoration", null);
            int decor = "underline".equals(td) ? 1 : "line-through".equals(td) ? 2 : 0;
            // ★★全端对齐批：绘制模式标记——multiLine=wrap 且该盒宽确需多行；clipText=nowrap 溢出裁切。
            boolean multiLine = false;
            if (wsWrap && !t.isEmpty() && w > 1f) {
                android.text.TextPaint wtp = new android.text.TextPaint();
                wtp.setTextSize(fs);
                wtp.setTypeface(ProteusHostView.typefaceOf(spec.optString("fontFamily", null), fw, null));
                if (ls != 0f && fs > 0f) wtp.setLetterSpacing(ls / fs);
                android.text.StaticLayout wsl = android.text.StaticLayout.Builder
                        .obtain(t, 0, t.length(), wtp, Math.max(1, (int) Math.ceil(w)))
                        .setIncludePad(false)
                        .build();
                multiLine = wsl.getLineCount() > 1;
            }
            final boolean clipText = !wsWrap && w > 1f
                    && "hidden".equals(spec.optString("overflow", null))
                    && !("ellipsis".equals(spec.optString("textOverflow", null)));
            return new ProteusHostView.Cmd(x, y, w, h, color, t, fs, textColor, radius, grad, glowSpec, maskSpec, fw, ta, bw, bc, shadowSpec, lh, ls, decor, wsWrap ? 0 : 1, multiLine, clipText);
        }
        return new ProteusHostView.Cmd(x, y, w, h, color, null, 0f, 0, radius, grad, glowSpec, maskSpec, 400, 0, bw, bc, shadowSpec);
    }

    /** ★批次 4：`text-align` 字符串 → 码（0=left / 1=center / 2=right；未知 ⇒ 0） */
    private static int alignOf(String a) {
        if (a == null) return 0;
        if (a.equals("center")) return 1;
        if (a.equals("right")) return 2;
        return 0;
    }

    /**
     * ★★**挂载后统一注入节点级绘制状态**（C2 描边 / C1 裁剪 / 变换原点）——**一次遍历、一次查内核**。
     *
     * 【为什么不能在 `mkCmd` 里逐节点做】`svgNodes()` 是一次**全表 JSON 解析**（内核侧遍历 +
     *   序列化）；逐节点调用 ⇒ N 次解析（1000 行虚拟化每帧物化都要付）⇒ 直接垮。
     *   ⇒ 与 `LightsHost.injectSvgStrokes` 同一做法：挂载/重建后**统一注入一次**，
     *     行的物化/释放只动指令（`Cmd`），不重复做节点级注入。
     */
    private void injectAllNodeState() throws Exception {
        if (view == null) return;
        // ① SVG 描边：内核一次性回带全表（`{paths: {id: {segs, strokeColor, strokeWidth, progressBase}}}`）
        try {
            org.json.JSONObject o = new org.json.JSONObject(RustLayout.svgNodes(handle));
            org.json.JSONObject paths = o.optJSONObject("paths");
            if (paths != null) {
                for (int i = 0; i < specs.size(); i++) {
                    JSONObject spec = specs.get(i);
                    if (spec.opt("svgPath") == null) continue;
                    int id = spec.getInt("id");
                    org.json.JSONObject info = paths.optJSONObject(String.valueOf(id));
                    if (info == null) continue;
                    JSONArray segs = info.optJSONArray("segs");
                    if (segs == null) continue;
                    long packed = (long) info.optDouble("strokeColor", 4294967295.0);
                    int col = packed >= 0 && packed < 4294967295L ? (int) packed : 0xFFFFFFFF;
                    float sw = (float) info.optDouble("strokeWidth", 2);
                    float pb = (float) info.optDouble("progressBase", 0);
                    view.setNodeSvgStroke(id, segs, col, sw, pb);
                }
            }
        } catch (Throwable ex) {
            android.util.Log.w("proteus", "Vapor SVG 描边建层失败（不阻断）：" + ex);
        }
        // ② 裁剪形状 / 变换原点（读本地 spec，零跨边界调用）
        for (int i = 0; i < specs.size(); i++) {
            JSONObject spec = specs.get(i);
            int id = spec.getInt("id");
            injectClipPath(id, spec);
            injectTransformOrigin(id, spec);
            injectTransform(id, spec);
            injectRadiusCorners(id, spec);
            injectFontRole(id, spec);
        }
    }

    /** ★★裁剪形状注入（C1）：`clipPath: {kind, params}` → 宿主节点表（静态声明也必须渲染） */
    private void injectClipPath(int id, JSONObject spec) {
        JSONObject cpo = spec.optJSONObject("clipPath");
        if (cpo == null) return;
        String k = cpo.optString("kind", "");
        JSONArray pa = cpo.optJSONArray("params");
        final int kind = "inset".equals(k) ? 1 : "circle".equals(k) ? 2 : "polygon".equals(k) ? 3 : 0;
        if (kind == 0 || pa == null) return;
        float[] ps = new float[pa.length()];
        for (int i = 0; i < pa.length(); i++) ps[i] = (float) pa.optDouble(i, 0);
        view.setNodeClipPath(id, kind, ps);
    }

    /** ★★变换原点注入（盒分数；缺省不注入 = 中心——既有行为零变化） */
    private void injectTransformOrigin(int id, JSONObject spec) {
        JSONObject torig = spec.optJSONObject("transformOrigin");
        if (torig == null) return;
        view.setNodeTransformOrigin(id,
                (float) torig.optDouble("x", 0.5), (float) torig.optDouble("y", 0.5));
    }

    /**
     * ★批次 39：**静态变换注入**（编译期 CSS `transform`）——写进宿主"静态变换表"（与动画同格式）。
     *   px 位移直接用（已随 spec physicalize）；**盒比例**位移（txPct/tyPct）随表下发，由 drawCmds 按盒尺寸换算。
     *   缩放取等比（sx===sy —— 编译器已拒绝非等比）。无 transform ⇒ 不注入（零行为变化）。
     */
    private void injectTransform(int id, JSONObject spec) {
        if (view == null) return;
        JSONObject t = spec.optJSONObject("transform");
        if (t == null) return;
        view.setNodeTransform(id,
                (float) t.optDouble("txPx", 0),
                (float) t.optDouble("tyPx", 0),
                (float) t.optDouble("sx", 1),
                (float) t.optDouble("rotate", 0),
                (float) t.optDouble("txPct", 0),
                (float) t.optDouble("tyPct", 0));
    }

    /** ★批次 34：逐角圆角掩码注入（`borderRadiusCorners` 对象 → bit0=TL/1=TR/2=BR/3=BL；全 true ⇒ 不注入） */
    private void injectRadiusCorners(int id, JSONObject spec) {
        org.json.JSONObject rc = spec.optJSONObject("borderRadiusCorners");
        if (rc == null) return;
        int mask = 0;
        if (rc.optBoolean("topLeft", false)) mask |= 1;
        if (rc.optBoolean("topRight", false)) mask |= 2;
        if (rc.optBoolean("bottomRight", false)) mask |= 4;
        if (rc.optBoolean("bottomLeft", false)) mask |= 8;
        view.setNodeRadiusCorners(id, mask);
    }

    /** ★批次 36：字体角色注入（`fontFamily` → 宿主节点表；绘制/度量按角色设 typeface） */
    private void injectFontRole(int id, JSONObject spec) {
        if (view == null) return;
        view.setNodeFontRole(id, spec.optString("fontFamily", null));
    }

    /** 渐变声明 → `GradSpec`（`GradSpec.parse` 对非法返回 null ⇒ 退回纯色——与 LightsHost 同口径） */
    private ProteusHostView.GradSpec parseGrad(JSONObject g) {
        return ProteusHostView.GradSpec.parse(g);
    }

    /** 发光声明 → `[color, radius, alpha]`（坏色 ⇒ null，不静默画错色） */
    private float[] parseGlow(JSONObject glo) {
        if (glo == null) return null;
        String gcolS = glo.optString("color", "");
        if (!(gcolS.startsWith("#") && gcolS.length() == 7)) return null;
        try {
            int gcol = (int) (0xFF000000L | Long.parseLong(gcolS.substring(1), 16));
            return new float[]{gcol, (float) glo.optDouble("radius", 0), (float) glo.optDouble("alpha", 0.5)};
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    /** ★批次 10：盒阴影声明 → `[dx, dy, blur, spread, color(ARGB)]`（无 ⇒ null；缺色 ⇒ null） */
    private float[] parseBoxShadow(JSONObject bs) {
        if (bs == null) return null;
        String colS = bs.optString("color", "");
        int col = colS.startsWith("#") ? parseColor(colS) : 0;
        if (col == 0) return null;
        return new float[]{
                (float) bs.optDouble("dx", 0),
                (float) bs.optDouble("dy", 0),
                (float) bs.optDouble("blur", 0),
                (float) bs.optDouble("spread", 0),
                (float) col,                    // 兼容旧消费方（丢低位；新绘制走 [5]/[6] 无损版）
                // ★★★批次 48：阴影色 32 位无损传递（float 尾数 24 位会丢低位 ⇒ 颜色偏移，见 Cmd 注释）
                (float) ((col >>> 16) & 0xFFFF),
                (float) (col & 0xFFFF)};
    }

    /** 从 `Cmd.boxShadow` 取回无损阴影色（`[5]`=高16 / `[6]`=低16；旧形态回退 `[4]`） */
    static int shadowColorOf(float[] bs) {
        if (bs.length >= 7) return ((int) bs[5] << 16) | (int) bs[6];
        return (int) bs[4];
    }

    /** 遮罩声明 → `[kind, angle, cx, cy, r, softness, progress]`（与 LightsHost 同口径） */
    private float[] parseMask(JSONObject mo) {
        if (mo == null) return null;
        String mkindS = mo.optString("kind", "");
        int mkind = "linear".equals(mkindS) ? 1 : "radial".equals(mkindS) ? 2 : 0;
        if (mkind == 0) return null;
        return new float[]{
                mkind,
                (float) mo.optDouble("angle", 180),
                (float) mo.optDouble("cx", 0.5),
                (float) mo.optDouble("cy", 0.5),
                (float) mo.optDouble("r", 0.75),
                (float) mo.optDouble("softness", 0.25),
                (float) mo.optDouble("progress", 1.0)};
    }

    /** 同 `mkCmd(spec, rect)`，但**几何沿用既有指令**（文本改了、几何没动的情形——见 applyOps） */
    private ProteusHostView.Cmd mkCmd(JSONObject spec, ProteusHostView.Cmd prev) throws Exception {
        String bg = spec.optString("backgroundColor", null);
        final int color = bg != null ? parseColor(bg) : prev.color;
        String t = spec.optString("text", null);
        if (t != null && !t.isEmpty()) {
            final float fs = (float) spec.optDouble("fontSize", 14);
            String tc = spec.optString("color", null);
            final int textColor = tc != null ? parseColor(tc) : prev.textColor;
            final int fw = (int) spec.optDouble("fontWeight", prev.fontWeight);
            final int ta = spec.has("textAlign") ? alignOf(spec.optString("textAlign", null)) : prev.textAlign;
            final float bw = spec.has("borderWidth") ? (float) spec.optDouble("borderWidth", prev.borderWidth) : prev.borderWidth;
            final int bc = spec.has("borderColor") ? parseColor(spec.optString("borderColor", null)) : prev.borderColor;
            final float[] sh = spec.has("boxShadow") ? parseBoxShadow(spec.optJSONObject("boxShadow")) : prev.boxShadow;
            final float lh = lineHeightPxOf(spec, fs);
            return new ProteusHostView.Cmd(prev.x, prev.y, prev.w, prev.h, color, t, fs, textColor, prev.radius, prev.gradient, prev.glow, prev.mask, fw, ta, bw, bc, sh, lh);
        }
        return new ProteusHostView.Cmd(prev.x, prev.y, prev.w, prev.h, color, prev.text, prev.fontSize, prev.textColor, prev.radius, prev.gradient, prev.glow, prev.mask, prev.fontWeight, prev.textAlign, prev.borderWidth, prev.borderColor, prev.boxShadow);
    }

    /** 全量：几何 → 指令（矩形 + 文本 + 底色） */
    private void emitAll() throws Exception {
        JSONObject rects = new JSONObject(RustLayout.readRects(handle)).getJSONObject("rects");
        cmds.clear();
        cmdIdsOf.clear();
        cmdIndexById.clear();
        for (int i = 0; i < specs.size(); i++) {
            JSONObject spec = specs.get(i);
            int id = spec.getInt("id");
            JSONObject r = rects.optJSONObject(String.valueOf(id));
            if (r == null) continue; // 无盒（display:none）——不产生指令（本仓实测的语义）
            cmdIndexById.put(id, cmds.size());
            cmds.add(mkCmd(spec, r));
            cmdIdsOf.add(id);
        }
        lastCmdCount = cmds.size();
        pushToView();
    }

    /** 增量：只重建变化集里的**那几条指令**（Cmd 不可变 ⇒ 整条替换） */
    private void patchedCmdsFor(JSONObject changed) throws Exception {
        if (changed == null || changed.length() == 0) return;
        int replaced = 0;
        for (java.util.Iterator<String> it = changed.keys(); it.hasNext(); ) {
            String k = it.next();
            int id = Integer.parseInt(k);
            Integer at = cmdIndexById.get(id);
            Integer idx = indexById.get(id);
            if (at == null || idx == null) continue;
            cmds.set(at, mkCmd(specs.get(idx), changed.getJSONObject(k)));
            replaced++;
        }
        if (replaced == 0) return;
        lastCmdCount = cmds.size();
        pushToView();
    }

    /**
     * 上屏：指令 + **并行节点 id 表**。
     *
     * ★★**为什么 id 表必须设**（2026-10-01 交互闭环实测抓出）：`ProteusHostView` 的命中测试
     *   走 `dispatchHit` → 内核 `hitTest`（它按**节点树**算）+ `cmdNodeIds`（把命中节点映回
     *   指令）。只设 `cmds` 不设 id 表 ⇒ 命中链断 ⇒ `gestureTarget = -1` ⇒ **点哪儿都没反应**。
     *   ★症状极具迷惑性：手势识别**正常上报**（logcat 有 `tap`），只是目标恒为 -1。
     */
    private void pushToView() {
        pushToView(null);
    }

    private void pushToView(int[] ids) {
        if (view == null) return;
        view.setCmds(cmds);
        if (ids != null) {
            view.setCmdNodeIds(ids);
        } else if (cmdIdsOf != null && cmdIdsOf.size() == cmds.size()) {
            // 组装时记录了并行 id 表（虚拟化路径 / 全量路径都记）
            int[] a = new int[cmdIdsOf.size()];
            for (int i = 0; i < a.length; i++) a[i] = cmdIdsOf.get(i);
            view.setCmdNodeIds(a);
        }
        view.invalidate();
    }

    /** 与 `cmds` **逐条并行**的节点 id（每次重建指令时一起重建——顺序即绘制顺序） */
    private final List<Integer> cmdIdsOf = new ArrayList<>();

    private void ensureView() {
        if (view != null) return;
        view = new ProteusHostView(ctx);
        // ★交互闭环：视图建好即接手势（setGestureSink 可能先于 ensureView 发生）
        attachGestureListener();
        android.widget.FrameLayout.LayoutParams lp = new android.widget.FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        view.setLayoutParams(lp);
        root.addView(view);
    }

    /** 离屏像素自检（`dim`：0 = 采样点数 / 1 = 不同颜色数——与既有通路同口径） */
    private int sample(int dim) {
        if (view == null) return -1;
        try {
            int vw = view.getWidth() > 0 ? view.getWidth() : 1080;
            int vh = view.getHeight() > 0 ? view.getHeight() : 2400;
            android.graphics.Bitmap bmp = android.graphics.Bitmap.createBitmap(vw, vh, android.graphics.Bitmap.Config.ARGB_8888);
            view.draw(new android.graphics.Canvas(bmp));
            int painted = 0;
            java.util.HashSet<Integer> colors = new java.util.HashSet<>();
            for (int y = 0; y < vh; y += 12) {
                for (int x = 0; x < vw; x += 12) {
                    int px = bmp.getPixel(x, y);
                    if ((px >>> 24) != 0) {
                        painted++;
                        if (colors.size() < 4096) colors.add(px);
                    }
                }
            }
            bmp.recycle();
            return dim == 0 ? painted : colors.size();
        } catch (Throwable t) {
            return -1;
        }
    }

    /** CSS 颜色 → ARGB（六位/八位；失败回退不透明黑） */
    private static int parseColor(String s) {
        try {
            String h = s.startsWith("#") ? s.substring(1) : s;
            if (h.length() == 6) return (int) (0xFF000000L | Long.parseLong(h, 16));
            if (h.length() == 8) {
                long v = Long.parseLong(h, 16);
                return (int) (((v & 0xFF) << 24) | (v >>> 8)); // #RRGGBBAA → AARRGGBB
            }
        } catch (Throwable ignored) {
        }
        return 0xFF000000;
    }

    private static String err(JSONObject o, String msg) {
        try {
            o.put("ok", false);
            o.put("error", msg);
        } catch (Throwable ignored) {
        }
        return o.toString();
    }

    private static double round3(double v) {
        return Math.round(v * 1000.0) / 1000.0;
    }
}
