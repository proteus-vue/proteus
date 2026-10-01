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
        void onGesture(String type, int targetId);
    }
    private GestureSink gestureSink;
    /** 读数：累计分发的语义手势数（判据"事件真的到了宿主"的机器证据） */
    int gestureDispatched = 0;
    /** 最近一次手势（探针：`{type,target}`——判据读它确认"点在了哪个节点上"） */
    String lastGestureProbe = null;

    void setGestureSink(GestureSink sink) {
        this.gestureSink = sink;
        if (view != null) attachGestureListener();
    }

    /**
     * ★★把手势接到**命中链**上：`ProteusHostView.onTouchEvent` 已在 DOWN 时刻用内核
     *   `hitTest` 定下目标节点（`gestureTarget`）⇒ 这里只消费语义手势 + 目标 id，
     *   转发给 JS 侧执行 handler。**宿主不做任何"哪个节点响应了"的判断**（那是内核的活）。
     */
    private void attachGestureListener() {
        if (view == null) return;
        view.setGestureListener(new ProteusHostView.GestureListener() {
            @Override
            public void onGesture(String type, int targetId, int[] chain, float x, float y, android.os.Bundle extra) {
                if (!"tap".equals(type) && !"longpress".equals(type)) return;
                gestureDispatched++;
                lastGestureProbe = "{\"type\":" + JSONObject.quote(type) + ",\"target\":" + targetId + "}";
                if (gestureSink != null) gestureSink.onGesture(type, targetId);
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

            lastNodeCount = specs.size();
            lastTextCount = textCount;
            lastLayoutMs = layoutMs;
            lastMeasureMs = measureMs;
            lastPaintedSamples = sample(0);
            lastPaintedColors = sample(1);

            out.put("ok", true);
            out.put("nodes", specs.size());
            out.put("text_nodes", textCount);
            out.put("cmds", lastCmdCount);
            out.put("layout_ms", round3(layoutMs));
            out.put("measure_ms", round3(measureMs));
            out.put("emit_cmds_ms", round3(emitMs));
            out.put("painted_samples", lastPaintedSamples);
            out.put("painted_colors", lastPaintedColors);
            out.put("viewport", vw + "x" + vh);
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
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
            int paintOnly = 0;
            for (int i = 0; i < patches.length(); i++) {
                JSONObject p = patches.getJSONObject(i);
                int id = p.getInt("id");
                JSONObject style = p.optJSONObject("style");
                if (style == null) continue;
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
            if (textApplied > 0) pushToView();
            else if (paintOnly > 0 && corePatches.length() == 0) pushToView(); // 纯绘制补丁也要重绘
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
     * 真机 `adb shell input tap` 需 INJECT_EVENTS 权限（**静默失败**，本仓已实测多次），
     * 故由宿主自己 `dispatchTouchEvent` 注入真 MotionEvent：走完整 `GestureDetector` →
     * `hitTest` → 语义手势 → 回调链，与真实触摸**同一条代码路径**。
     */
    public String tapAt(String argsJson) {
        JSONObject out = new JSONObject();
        try {
            if (view == null) return err(out, "视图未建").toString();
            JSONObject a = new JSONObject(argsJson);
            final float x = (float) a.optDouble("x", 0);
            final float y = (float) a.optDouble("y", 0);
            long t0 = android.os.SystemClock.uptimeMillis();
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
            out.put("last", lastGestureProbe != null ? new JSONObject(lastGestureProbe) : JSONObject.NULL);
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
        int first = (int) Math.floor((double) (vScrollY - y0) / rowPitch);
        first = Math.max(0, Math.min(n - 1, first));
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
    private static double sigDiffPct(int[] a, int[] b) {
        final int n = Math.min(a.length, b.length);
        if (n == 0) return -1;
        int diff = 0;
        for (int i = 0; i < n; i++) if (a[i] != b[i]) diff++;
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
            "margin", "padding", "flexDirection", "justifyContent", "alignItems", "alignSelf",
            "flexGrow", "flexShrink", "flexBasis", "gap", "display", "position", "top", "left",
            "widthRatio", "heightRatio", "overflow",
            // ★静态基态声明（内核要解析）：裁剪形状 + 路径本体（+ 描边色/宽随 svgPath 一起进）
            "clipPath", "svgPath", "svgPathTo", "perspective"));

    /** 节点 → 核心请求（只带几何键；`text` 单独带，供核心记入文本叶） */
    private JSONArray coreNodes() throws Exception {
        JSONArray arr = new JSONArray();
        for (JSONObject spec : specs) {
            JSONObject c = new JSONObject();
            c.put("id", spec.getInt("id"));
            if (spec.has("parentId") && !spec.isNull("parentId")) c.put("parentId", spec.getInt("parentId"));
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

    /** 文本度量（宿主注入——内核不自研文本；与 JsRenderHost 同口径：StaticLayout） */
    private JSONObject buildMeasures() throws Exception {
        JSONObject m = new JSONObject();
        for (JSONObject spec : specs) {
            String t = spec.optString("text", null);
            if (t == null || t.isEmpty()) continue;
            float fs = (float) spec.optDouble("fontSize", 14);
            android.text.TextPaint tp = new android.text.TextPaint();
            tp.setTextSize(fs);
            float w = tp.measureText(t);
            float h = fs * 1.4f; // 行高近似（与既有通路同口径）
            JSONObject sz = new JSONObject();
            sz.put("width", Math.ceil(w) + 2);
            sz.put("height", Math.ceil(h));
            m.put(String.valueOf(spec.getInt("id")), sz);
        }
        return m;
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
        }

        // ★★**Cmd 上的绘制通道**（与 LightsHost 的构造逐项对齐）：
        //   radius（圆角）/ gradient（渐变）/ glow（发光）/ mask（软遮罩）
        final float radius = (float) spec.optDouble("borderRadius", 0);
        final ProteusHostView.GradSpec grad = parseGrad(spec.optJSONObject("fillGradient"));
        final float[] glowSpec = parseGlow(spec.optJSONObject("glow"));
        final float[] maskSpec = parseMask(spec.optJSONObject("mask"));

        String t = spec.optString("text", null);
        if (t != null && !t.isEmpty()) {
            float fs = (float) spec.optDouble("fontSize", 14);
            String tc = spec.optString("color", null);
            int textColor = tc != null ? parseColor(tc) : 0xFFFFFFFF;
            return new ProteusHostView.Cmd(x, y, w, h, color, t, fs, textColor, radius, grad, glowSpec, maskSpec);
        }
        return new ProteusHostView.Cmd(x, y, w, h, color, null, 0f, 0, radius, grad, glowSpec, maskSpec);
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
            return new ProteusHostView.Cmd(prev.x, prev.y, prev.w, prev.h, color, t, fs, textColor);
        }
        return new ProteusHostView.Cmd(prev.x, prev.y, prev.w, prev.h, color, prev.text, prev.fontSize, prev.textColor);
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
