package dev.proteus.layoutcore;

import android.content.Context;
import android.graphics.RectF;
import android.view.ViewGroup;
import dev.proteus.platform.ProteusTextPlatform;

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
public final class VaporRenderHost {

    private final Context ctx;
    private final ViewGroup root;

    /** 当前树 spec（顺序 = JS 产出顺序 = 绘制顺序） */
    private final List<JSONObject> specs = new ArrayList<>();
    /** ★★★批 A（决策 #653）：`position:fixed` 的节点 id 集（从 spec 收集，注入视图做滚动反向补偿）。 */
    private final java.util.Set<Integer> fixedIdsOf = new java.util.HashSet<>();
    /** ★批 A③（决策 #655）：sticky 节点吸附阈值（id → top，dp）。 */
    private final java.util.Map<Integer, Float> stickyTopsOf = new java.util.HashMap<>();
    private final Map<Integer, Integer> indexById = new HashMap<>();
    /** 绘制指令与 id → 指令下标（增量补丁用；与 JsRenderHost 同款） */
    private final List<ProteusHostView.Cmd> cmds = new ArrayList<>();
    private final Map<Integer, Integer> cmdIndexById = new HashMap<>();

    private ProteusHostView view;
    private long handle = 0L;
    /**
     * ★★★最近一次 `mount` 的**原始** tree JSON（逻辑单位，**未 physicalize**）——就地编辑（决策 #722）用。
     *   【为什么要留原始串】就地编辑 = **改树 + 全量重挂**（与 iOS `lastNodes` + `render(force:true)` **同语义**）。
     *   ★为什么不用 `updatePatches`（增量）：内核 `PatchStyle` 只认**字段子集**（width/height/flexGrow/
     *     padding/margin/display…），而 `flexDirection`/`justifyContent`/`alignItems`/`position`/`top`/… **不在其中**
     *     —— `#[serde(default)]` 会**静默忽略**（不报错）⇒ "改了 flex 方向布局不动"（用户实测）。
     *     全量重建走 `create`（`NodeDto` 字段完整）⇒ **任意字段**都生效（对齐 iOS）。
     */
    private String lastTreeJson = "";

    /* ────────────────────────── 读数（判据用）────────────────────────── */

    public int mountCalls = 0;
    public int applyCalls = 0;
    public int lastNodeCount = -1;
    public int lastTextCount = -1;
    public int lastCmdCount = -1;
    public double lastLayoutMs = -1;
    public double lastMeasureMs = -1;
    public int lastPaintedSamples = -1;
    public int lastPaintedColors = -1;
    /** 最近一次 `applyOps` 的读数（判据直接从回执读，这里留痕便于 logcat 诊断） */
    public int lastApplied = -1;
    public int lastChangedNodes = -1;
    /** ★DevTools 累计（决策 #676）：patch 应用总数 / 内核重排总数（跨所有 applyOps）——面板"重排计数"。 */
    public int patchAppliedTotal = 0;
    public int relayoutTotal = 0;
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

    /* ── ★★★B4-T2b（2026-10-10）：原生输入控件（`<input>`/`<textarea>`）──
     *
     * 【要证明什么】`v-model` 的**回写**半边端上真生效：宿主为可编辑节点建**原生 EditText**（复用
     *   native-host 机制——几何来自内核），编辑值经 TextWatcher → `inputSink` → JS `dispatchInputValue`
     *   ⇒ 数据变 ⇒ 下行文本随之更新（无宿主控件则 input 事件无源）。
     */
    interface InputSink { void onInput(int nodeId, String value); }
    private InputSink inputSink;
    /** 输入节点 id → EditText（树重建随之重建） */
    private final java.util.Map<Integer, android.widget.EditText> inputControls = new java.util.HashMap<>();
    /** 探针读数：累计输入事件（判据"输入真的到了宿主"的机器证据） */
    int inputEvents = 0;

    void setInputSink(InputSink sink) { this.inputSink = sink; }

    /**
     * ★B4-T2b：按 `tag==input/textarea` 的节点建原生 EditText（复用 native-host 机制）。
     *   · 下行：EditText 初值 = spec.text（值→控件）；
     *   · 上行：TextWatcher.afterTextChanged → `inputSink.onInput(id, text)`（编辑→源）。
     *   ★几何来自内核 `readRects`（nativeRects = 内容坐标，与绘制指令同口径）。
     */
    private void syncInputControls() {
        if (view == null || handle == 0L) return;
        try {
            // 清旧控件（树重建 ⇒ 控件重建；从视图与 map 都移除，不残留）
            for (java.util.Map.Entry<Integer, android.widget.EditText> oldE : inputControls.entrySet()) {
                try { view.removeNativeHost(oldE.getKey()); } catch (Throwable ignored) {}
            }
            inputControls.clear();
            JSONObject rects = new JSONObject(RustLayout.readRects(handle)).optJSONObject("rects");
            if (rects == null) return;
            java.util.Map<Integer, RectF> geo = new java.util.HashMap<>();
            for (JSONObject spec : specs) {
                String tag = spec.optString("tag", "");
                if (!"input".equals(tag) && !"textarea".equals(tag)) continue;
                int id = spec.getInt("id");
                JSONObject r = rects.optJSONObject(String.valueOf(id));
                if (r == null) continue;
                final android.widget.EditText et = new android.widget.EditText(ctx);
                et.setText(spec.optString("text", ""));
                et.setSingleLine(!"textarea".equals(tag));
                // 值→控件（下行）后设 Watcher：避免初值触发回写
                final int fid = id;
                et.addTextChangedListener(new android.text.TextWatcher() {
                    public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
                    public void onTextChanged(CharSequence s, int a, int b, int c) {}
                    public void afterTextChanged(android.text.Editable s) {
                        inputEvents++;
                        if (inputSink != null) inputSink.onInput(fid, s.toString());
                    }
                });
                inputControls.put(id, et);
                view.addNativeHost(id, et);
                float x = (float) r.optDouble("x"), y = (float) r.optDouble("y");
                float w = (float) r.optDouble("width"), h = (float) r.optDouble("height");
                geo.put(id, new RectF(x, y, x + w, y + h));
            }
            if (!geo.isEmpty()) view.setNativeHostGeometry(geo);
        } catch (Throwable t) {
            // 非静默：失败也留下读数（判据可核）
            android.util.Log.w("proteus", "syncInputControls 失败：" + t.getMessage());
        }
    }

    /**
     * ★B4-T2b 探针：为**首个**输入控件注入文本（走 TextWatcher ⇒ inputSink ⇒ JS 回写）。
     *   返回 `{"ok":true,"nodeId":N}`（-1 = 无输入控件）。仅供判据/真机驱动，非生产路径。
     */
    public String inputProbeSetText(String text) {
        for (java.util.Map.Entry<Integer, android.widget.EditText> e : inputControls.entrySet()) {
            e.getValue().setText(text);
            // inputEvents = TextWatcher 触发次数（≥1 ⇒ 控件是"活的"、编辑真的产生输入事件）
            return "{\"ok\":true,\"nodeId\":" + e.getKey() + ",\"inputEvents\":" + inputEvents + "}";
        }
        return "{\"ok\":false,\"error\":\"无输入控件\"}";
    }

    /** ★B4-T2b 探针：当前输入控件数（判据核"可编辑节点真的建了控件"）。 */
    public String inputControlCount() { return "{\"ok\":true,\"count\":" + inputControls.size() + "}"; }

    /** ★S1.1 探针（QuickJS 绑本方法）：读视图按下态读数 `{pressed,applied,press_nodes}`。 */
    public String pressProbe() {
        return view != null ? view.pressProbe() : "{\"pressed\":-1,\"applied\":-1,\"press_nodes\":-1}";
    }

    /** ★S3-T1 探针（QuickJS 绑本方法）：读视图跟手读数 `{follow_nodes,moves,applied}`。 */
    public String followProbe() {
        return view != null ? view.followProbe() : "{\"follow_nodes\":-1,\"moves\":-1,\"applied\":-1}";
    }

    /** ★S3-T1 探针（QuickJS 绑本方法）：读指定节点的**变换真源**（宿主 `animTx`）——跟手几何核。 */
    public String animTxProbe(String idsJson) {
        return view != null ? view.animTxProbe(idsJson) : "{\"ok\":false,\"error\":\"视图未建\"}";
    }

    /**
     * ★★★S1.1 按下态样式（2026-10-10 · 输入延迟专项 #767 · `15-dactyl-demo.md` §4.2）：
     *   从 specs 收集 `:active` 折出的 `press*` 字段——`pressBackgroundColor`（底色）·
     *   `pressTransform`（sx/sy → **凹陷**）· `pressBorderColor`（描边）· `pressBoxShadow`（**边缘发光**）。
     *   ★只读 paint 通道（内核不消费）——DOWN 时由视图**原生立即**应用（零 JS 跨界）。
     */
    private java.util.Map<Integer, ProteusHostView.PressStyle> collectPressStyles() {
        java.util.Map<Integer, ProteusHostView.PressStyle> m = new java.util.HashMap<>();
        for (JSONObject spec : specs) {
            if (!spec.has("pressBackgroundColor") && !spec.has("pressTransform")
                    && !spec.has("pressBorderColor") && !spec.has("pressBoxShadow")) continue;
            int id = spec.optInt("id", -1);
            if (id < 0) continue;
            ProteusHostView.PressStyle ps = new ProteusHostView.PressStyle();
            if (spec.has("pressBackgroundColor")) ps.bg = parseColor(spec.optString("pressBackgroundColor", null));
            if (spec.has("pressBorderColor")) ps.borderColor = parseColor(spec.optString("pressBorderColor", null));
            JSONObject ptx = spec.optJSONObject("pressTransform");
            if (ptx != null) { ps.sx = (float) ptx.optDouble("sx", 1.0); ps.sy = (float) ptx.optDouble("sy", 1.0); }
            JSONObject psh = spec.optJSONObject("pressBoxShadow");
            if (psh != null && psh.has("color")) {
                ps.glowColor = parseColor(psh.optString("color", null));
                ps.glowRadius = (float) psh.optDouble("blur", 0.0);
            }
            m.put(id, ps);
        }
        return m;
    }

    /**
     * ★★★S3（2026-10-10 · 输入延迟专项 #767）：从 specs 收集**跟手规格**
     *   （编译器把 `v-follow` 折成节点上的 `follow*` 扁平字段）。
     *   ★返回 `id → [axis, gain, clampMin, clampMax, springStiffness, springDamping, springMass, snapThreshold, snapTarget]`；
     *     宿主 MOVE 时**直接喂内核**（`RustLayout.layoutFollow`）/ UP 时 `layoutFollowRelease`——
     *     换算/夹取/吸附判定/弹簧全在内核、**零 JS 跨界**（S3 判据 `js_involved_gestures_ratio == 0`）。
     */
    private java.util.Map<Integer, float[]> collectFollow() {
        java.util.Map<Integer, float[]> m = new java.util.HashMap<>();
        for (JSONObject spec : specs) {
            if (!spec.has("followAxis")) continue;
            int id = spec.optInt("id", -1);
            if (id < 0) continue;
            m.put(id, new float[]{
                    spec.optInt("followAxis", 1),
                    (float) spec.optDouble("followGain", 1.0),
                    // 无 clamp ⇒ 大开区间（= 不夹取，与 T1 行为一致）
                    (float) spec.optDouble("followClampMin", -1e9),
                    (float) spec.optDouble("followClampMax", 1e9),
                    // 无 spring ⇒ 缺省临界阻尼（stiffness/damping/mass 与内核 SpringParams 同参化）
                    (float) spec.optDouble("followSpringStiffness", 300.0),
                    (float) spec.optDouble("followSpringDamping", 30.0),
                    (float) spec.optDouble("followSpringMass", 1.0),
                    // 无 snap ⇒ threshold=0（永不吸附 ⇒ 松手恒回弹归零）
                    (float) spec.optDouble("followSnapThreshold", 0.0),
                    (float) spec.optDouble("followSnapTarget", 0.0),
            });
        }
        return m;
    }

    /**
     * ★★★Dactyl L2·场跟手（§4.3）：从 specs 收集 `v-follow={field:{…}}` 容器的**场参数**
     *   （falloff / minScale / maxScale / rotate）——焦点 → 一片尖峰的高度/朝向场（内核 `follow_field`）。
     */
    private java.util.Map<Integer, float[]> collectFollowFields() {
        java.util.Map<Integer, float[]> m = new java.util.HashMap<>();
        for (JSONObject spec : specs) {
            if (!spec.has("followField")) continue;
            int id = spec.optInt("id", -1);
            if (id < 0) continue;
            m.put(id, new float[]{
                    id,
                    (float) spec.optDouble("followFieldFalloff", 300.0),
                    (float) spec.optDouble("followFieldMinScale", 0.3),
                    (float) spec.optDouble("followFieldMaxScale", 1.0),
                    (float) spec.optDouble("followFieldRotate", 30.0),
            });
        }
        return m;
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
                // ★★手势发生 ⇒ 收起元素高亮（决策 #714）：与 iOS `emitGesture` 同语义——
                //   点空白/点动作/滚动都收起（高亮是"面板→设备"方向的证据；下次面板选节点会再下发）。
                highlightNode(0);
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

    public VaporRenderHost(Context ctx, ViewGroup root) {
        this.ctx = ctx;
        this.root = root;
    }

    public ProteusHostView view() { return view; }

    /** ★DevTools 元素高亮（决策 #701 安卓腿）：读该节点内核矩形（内容坐标）⇒ 视图转屏幕坐标画描边；id<=0 清除。 */
    public void highlightNode(int id) {
        if (view == null) return;
        if (id <= 0 || handle == 0L) { view.setDevHighlight(null); return; }
        try {
            org.json.JSONObject r = new org.json.JSONObject(nodeRectJson(id));
            if (!r.optBoolean("ok", false)) { view.setDevHighlight(null); return; }
            float x = (float) r.optDouble("x", 0), y = (float) r.optDouble("y", 0);
            float w = (float) r.optDouble("width", 0), h = (float) r.optDouble("height", 0);
            view.setDevHighlightFromContent(new RectF(x, y, x + w, y + h));
        } catch (Throwable t) {
            view.setDevHighlight(null);
        }
    }

    /** ★诊断：读某节点的内核几何（真源）——判 layout 问题用 */
    String nodeRectJson(int nodeId) { return handle > 0 ? RustLayout.nodeRect(handle, nodeId) : "{}"; }

    /**
     * ★★★**就地编辑**（DevTools · 决策 #722，**对齐 iOS #706/#719**）——改宿主保存的**原始节点树**某字段
     *   ⇒ **全量重挂**（`mount`）。
     *
     * 【为什么走全量重挂而不是 `updatePatches`（增量）】内核增量通路的 `PatchStyle` 只认**字段子集**
     *   （width/height/flexGrow/flexShrink/flexBasis/gap/padding/margin/display/text/…），而
     *   `flexDirection`/`flexWrap`/`justifyContent`/`alignItems`/`alignSelf`/`position`/`top`/`left`/… **不在其中**
     *   —— `#[serde(default)]` **静默忽略**（不报错）⇒ "改了 flex 方向布局不动"（用户实测）。
     *   ⇒ 统一到"改树 + 全量重建"（`create` 的 `NodeDto` 字段完整 ⇒ **任意字段**生效），与 iOS 同语义。
     *   【值强转】`coerceLiveEdit`（字段类型校验：颜色 hex / padding·margin / 枚举封闭集 / 数字或原串）。
     *   【禁改】`id`/`parentId`/`rect`/`tag`/`semantic`（结构/语义身份）。
     * @return `{ok, error?}` JSON
     */
    public String applyLiveEdit(int id, String key, String value) {
        JSONObject out = new JSONObject();
        try {
            if (lastTreeJson == null || lastTreeJson.isEmpty()) return err(out, "尚无挂载树（无从编辑）").toString();
            if (id <= 0 || key == null || key.isEmpty()) return err(out, "非法参数（id/key）").toString();
            if (key.equals("id") || key.equals("parentId") || key.equals("rect") || key.equals("tag") || key.equals("semantic"))
                return err(out, "不可编辑字段：" + key).toString();
            JSONObject tree = new JSONObject(lastTreeJson);
            JSONArray nodes = tree.optJSONArray("nodes");
            if (nodes == null) return err(out, "树无 nodes").toString();
            JSONObject target = null;
            for (int i = 0; i < nodes.length(); i++) {
                JSONObject n = nodes.optJSONObject(i);
                if (n != null && n.optInt("id", -1) == id) { target = n; break; }
            }
            if (target == null) return err(out, "无该节点：#" + id).toString();
            Object coerced = coerceLiveEdit(key, value);
            if (coerced == null) return err(out, "非法值：" + key + "=" + value).toString();
            target.put(key, coerced);
            // ★改树 ⇒ 全量重挂（mount 内部会 physicalize + 重建 → 内核按新样式**重新布局**+重建层）
            String re = mount(tree.toString());
            JSONObject r = new JSONObject(re);
            out.put("ok", r.optBoolean("ok", false));
            if (!r.optBoolean("ok", false)) out.put("error", r.optString("error", "重挂失败"));
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /** ★就地编辑**值强转/校验**（决策 #722，镜像 iOS `coerceLiveEdit`）：颜色按 hex；padding/margin
     *   单值⇒四边同值 / JSON 对象；枚举按**内核封闭集**；其余能解析为数字则数字，否则原串。
     *   ★返回 null = 拒绝（非法值**不静默**改）。 */
    private static Object coerceLiveEdit(String key, String value) {
        if ("backgroundColor".equals(key) || "borderColor".equals(key) || "color".equals(key)) {
            return (value != null && value.matches("#[0-9a-fA-F]{3,8}")) ? value : null;
        }
        if ("padding".equals(key) || "margin".equals(key)) {
            try {
                double d = Double.parseDouble(value);
                JSONObject e = new JSONObject();
                e.put("top", d); e.put("right", d); e.put("bottom", d); e.put("left", d);
                return e;
            } catch (Throwable ignored) { }
            try {
                JSONObject o = new JSONObject(value);
                boolean any = false;
                for (String s : new String[]{"top", "right", "bottom", "left"}) if (o.has(s)) any = true;
                return any ? o : null;
            } catch (Throwable ignored) { return null; }
        }
        if ("display".equals(key)) return ("flex".equals(value) || "none".equals(value) || "grid".equals(value)) ? value : null;
        if ("position".equals(key)) return (java.util.Arrays.asList("static", "relative", "absolute", "fixed", "sticky").contains(value)) ? value : null;
        if ("overflow".equals(key) || "overflowX".equals(key) || "overflowY".equals(key)) {
            return (java.util.Arrays.asList("visible", "hidden", "scroll", "auto").contains(value)) ? value : null;
        }
        if ("flexDirection".equals(key)) {
            return (java.util.Arrays.asList("row", "column", "row-reverse", "column-reverse").contains(value)) ? value : null;
        }
        if ("flexWrap".equals(key)) {
            return (java.util.Arrays.asList("nowrap", "wrap", "wrap-reverse").contains(value)) ? value : null;
        }
        // 默认：能解析为数字 ⇒ 数字（尺寸/弹性/字号/圆角/透明/偏移…）；否则按字符串原样收（文本/字体族/对齐…）
        try { return Double.valueOf(value); } catch (Throwable ignored) { return value; }
    }

    /**
     * 首帧建树：`{viewport:{width,height}, nodes:[…]}`。
     *
     * 顺序与 `JsRenderHost.render` **逐条相同**（度量 → 请求 → create → 指令）：
     * 该顺序是本仓实测钉住的——度量必须随建树请求进核心（否则文本按零尺寸算 ⇒ 屏幕上没字）。
     */
    public String mount(String treeJson) {
        mountCalls++;
        // ★★重建 ⇒ 收起旧高亮（决策 #714）：高亮框不随树重建消失，切屏后会挂在旧 rect 上。
        highlightNode(0);
        // ★★保存**原始** tree 串（逻辑单位）——就地编辑（决策 #722）用它重建；★必须在 physicalize **之前**
        //   （physicalize 是就地改 parse 出来的 tree，不动这个串；之后编辑基于逻辑单位改写再重新 mount）。
        lastTreeJson = treeJson;
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
            // ★B4-T2b：为可编辑节点建原生输入控件（复用 native-host 机制；几何来自内核）
            syncInputControls();
            // ★S1.1（#767 / §4.2）：把"按下态节点 → 样式（底色+凹陷+描边+发光）"注入视图
            if (view != null) view.setPressStyles(collectPressStyles());
            // ★S3-T1（#767）：把"跟手节点 → (axis,gain)"注入视图（`v-follow` 折出的 followAxis/followGain）
            if (view != null) view.setFollowSpecs(collectFollow());
            // ★Dactyl L2（#780）：场跟手参数（`v-follow={field:…}` 容器）
            if (view != null) view.setFollowFields(collectFollowFields());
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
    public void enableContentScrollRange() { contentScrollRangeEnabled = true; }

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
            // ★★★页面滚动锁定（2026-10-08 用户点名「overflow-y:hidden 长页面是否真能锁滚」）：
            //   页根声明 `overflow-y: hidden` ⇒ **整页不滚**（range=0）。此前只按内容高算 range
            //   ⇒ 声明了 hidden 的长页面照样能滚（真机实测：bg-position 根加 overflow-y:hidden 仍 range=20）。
            //   App 的「页面滚动」= 整树滚动 ⇒ 页根 overflow 即页面滚动开关。
            final String rootOvf = specs.isEmpty() ? null : specs.get(0).optString("overflowY", null);
            final boolean scrollLocked = "hidden".equals(rootOvf);
            if (scrollLocked) range = 0;
            view.setVerticalScrollRange(range);
            // I2-ALLOW: 报告读数（content_height / scroll_range 为机器判据的可读字段）
            out.put("content_height", Math.round(maxBottom));
            out.put("scroll_range", range);
            if (scrollLocked) out.put("scroll_locked", true);
        } catch (Exception e) {
            // 不静默：报出（判据可据此判红）；视图保持"不钳制"状态
            try { out.put("scroll_range_error", e.getClass().getSimpleName() + ": " + e.getMessage()); } catch (Exception ignored) { /* 报告字段写失败时保持原样 */ }
        }
    }

    /**
     * **二进制指令流**（订阅驱动更新的唯一入口）：`number[]`（0..255）→ byte[] → 内核。
     *
     * @param opsJson `[137,1,0,0,…]` 形态（**旧通道**：QuickJS 无 ArrayBuffer 直传时走数组——
     *                ★S2「去 JSON」（#769）：**新通道为 {@link #applyOpsBytes(byte[])}**，直接传字节数组，
     *                免掉「number[] 文本 → JSONArray 解析 → 逐元素装箱」。本方法保留作回退（宿主未接
     *                新通道 / 老产物）。
     */
    public String applyOps(String opsJson) {
        applyCalls++;
        JSONObject out = new JSONObject();
        try {
            if (handle == 0L) return err(out, "尚未 mount（无树可改）").toString();
            JSONArray arr = new JSONArray(opsJson);
            byte[] bytes = new byte[arr.length()];
            for (int i = 0; i < arr.length(); i++) bytes[i] = (byte) (arr.optInt(i) & 0xFF);
            return applyOpsCore(bytes, out);
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /**
     * ★★★**S2「去 JSON」新通道**（2026-10-10 · #769）：指令字节**直接**传入（JS `Uint8Array` → JNI `byte[]`），
     *   不经 `number[]` 文本 + `JSONArray` 解析 + 逐元素 `Integer` 装箱。
     *   —— 这是"跨边界一律 JSON"（方案 B2）在 **per-frame 更新通道**上的第一刀。
     */
    public String applyOpsBytes(byte[] bytes) {
        applyCalls++;
        bytesOpsCalls++;
        JSONObject out = new JSONObject();
        try {
            if (handle == 0L) return err(out, "尚未 mount（无树可改）").toString();
            return applyOpsCore(bytes, out);
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /** ★S2「去 JSON」探针：走**字节直传**通道的次数（判据 ㉜ 核"字节直传真的生效"，宿主真源）。 */
    public int bytesOpsCalls = 0;

    /** 指令字节 → 内核 · 回执解析 · 文本落层 · 重绘（`applyOps` / `applyOpsBytes` 共用体）。 */
    private String applyOpsCore(byte[] bytes, JSONObject out) {
        try {
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

            // ★★★B-T2：**文本策略变更**（white-space/word-break/line-clamp 经 SET_STYLE_STR）——
            //   从内核**回读**（单一来源）并写回 spec，随后 remeasureChanged 会按新策略重度量。
            java.util.List<Integer> policyIds = new java.util.ArrayList<>();
            org.json.JSONArray tpu = uo.optJSONArray("text_policy_updates");
            if (tpu != null && tpu.length() > 0) {
                StringBuilder ids = new StringBuilder("[");
                for (int i = 0; i < tpu.length(); i++) {
                    int id = tpu.optInt(i);
                    Integer idx = indexById.get(id);
                    if (idx == null) continue;
                    if (ids.length() > 1) ids.append(',');
                    ids.append(id);
                    policyIds.add(id);
                }
                ids.append(']');
                if (!policyIds.isEmpty()) {
                    try {
                        JSONObject pol = new JSONObject(RustLayout.textPolicy(handle, ids.toString()));
                        JSONObject map = pol.optJSONObject("policy");
                        if (map != null) {
                            for (int i = 0; i < policyIds.size(); i++) {
                                JSONObject p = map.optJSONObject(String.valueOf(policyIds.get(i)));
                                if (p == null) continue;
                                JSONObject spec = specs.get(indexById.get(policyIds.get(i)));
                                if (p.has("whiteSpace")) spec.put("whiteSpace", p.optString("whiteSpace"));
                                if (p.has("wordBreak")) spec.put("wordBreak", p.optString("wordBreak"));
                                if (p.has("lineClamp")) spec.put("lineClamp", p.optString("lineClamp"));
                            }
                        }
                    } catch (Exception ignore) { /* 回读失败不静默：下面仍按旧策略重度量，读数可核 */ }
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
            // ★B-T2：策略变更也要重画指令（折行模式/截断变 ⇒ 绘制参数变，几何可能没动）
            for (int id : policyIds) {
                Integer at = cmdIndexById.get(id);
                Integer idx = indexById.get(id);
                if (at == null || idx == null) continue;
                cmds.set(at, mkCmd(specs.get(idx), cmds.get(at)));
            }
            if (!textChangedIds.isEmpty() || !policyIds.isEmpty()) pushToView();
            double emitMs = (System.nanoTime() - te) / 1e6;

            out.put("ok", true);
            out.put("applied", lastApplied);
            out.put("changed", lastChangedNodes);
            out.put("text_synced", textChangedIds.size());
            out.put("text_synced_total", textSyncedTotal);
            out.put("text_policy_synced", policyIds.size());
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
    public int updatePatchCalls = 0;

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
                // ★DevTools 累计（决策 #676）：patch / 重排总数（面板"重排计数"）
                if (lastApplied > 0) patchAppliedTotal += lastApplied;
                if (relayout > 0) relayoutTotal += relayout;
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
     * ★★★**S3 拖拽注入**（2026-10-10 · 输入延迟专项 #767 · 判据 ㉞/㉟）：模拟一次真实拖拽
     *   （DOWN → N×MOVE →[UP]→[settle]），用**真 MotionEvent** 走 `onTouchEvent` 全链路——
     *   与真实手指同一条代码路径（含 S1.5 无缓冲分发 / 命中 / S3 跟手 / S3 松手）。
     *
     * 【要证明什么】MOVE 期间跟手**只走内核**（`RustLayout.layoutFollow`），**一次 JS 都不调**；
     *   UP 时松手**只走内核**（`layoutFollowRelease`，回弹/吸附判定在内核）——读数即可核。
     *
     * 【时间戳逐次前推】（同 `tapAt` 的纪律）：事件时间戳是纯属性，前推避免被 `GestureDetector`
     *   判成双击/多击——**零等待**（不是 sleep）。
     * @param argsJson `{x, y, dx, dy, steps, release?, settleFrames?}`——
     *   `release`（默认 true）= 末尾发 UP（触发松手）；`settleFrames`（默认 0）= 松手后**确定性步进**
     *   若干帧（每帧 `kernelAnimTick(16.7ms)`，到"内核无活跃动画"即停，**有限次**，非盲等）⇒ 读弹簧落点。
     */
    public String dragAt(String argsJson) {
        JSONObject out = new JSONObject();
        try {
            if (view == null) return err(out, "视图未建").toString();
            JSONObject a = new JSONObject(argsJson);
            final float x0 = (float) a.optDouble("x", 0);
            final float y0 = (float) a.optDouble("y", 0);
            final float dxTotal = (float) a.optDouble("dx", 0);
            final float dyTotal = (float) a.optDouble("dy", 0);
            final int steps = Math.max(1, a.optInt("steps", 6));
            final boolean release = a.optBoolean("release", true);
            final int settleFrames = Math.max(0, a.optInt("settleFrames", 0));
            final int beforeGestures = gestureDispatched;
            view.resetFollowCounters();
            long age = 1000L * tapInjectSeq;
            tapInjectSeq++;
            final long t0 = android.os.SystemClock.uptimeMillis() + age;
            android.view.MotionEvent down = android.view.MotionEvent.obtain(t0, t0,
                    android.view.MotionEvent.ACTION_DOWN, x0, y0, 0);
            view.dispatchTouchEvent(down);
            down.recycle();
            // MOVE 序列：位移**等分**（真实手指采样形态；每步一个真 MotionEvent）
            for (int i = 1; i <= steps; i++) {
                final float t = (float) i / steps;
                final float mx = x0 + dxTotal * t;
                final float my = y0 + dyTotal * t;
                android.view.MotionEvent mv = android.view.MotionEvent.obtain(t0, t0 + i * 8,
                        android.view.MotionEvent.ACTION_MOVE, mx, my, 0);
                view.dispatchTouchEvent(mv);
                mv.recycle();
            }
            if (release) {
                android.view.MotionEvent up = android.view.MotionEvent.obtain(t0, t0 + (steps + 1) * 8,
                        android.view.MotionEvent.ACTION_UP, x0 + dxTotal, y0 + dyTotal, 0);
                view.dispatchTouchEvent(up);
                up.recycle();
            }
            // ★松手后**确定性步进**（有限次）：推进内核弹簧（回弹/吸附）到收敛——
            //   到"内核无活跃动画"即提前停（有界，不是盲等；与 <Transition> 帧循环同一停判据）。
            int settledFrames = 0;
            if (release && settleFrames > 0) {
                for (int f = 0; f < settleFrames; f++) {
                    view.kernelAnimTick(16.7f);
                    settledFrames++;
                    try {
                        JSONObject ao = new JSONObject(view.kernelAnimActive());
                        if (ao.optBoolean("ok") && ao.optInt("active", -1) == 0) break;
                    } catch (Throwable ignored) { /* 读数失败 ⇒ 跑满上限（有界） */ }
                }
            }
            out.put("ok", true);
            out.put("x", x0);
            out.put("y", y0);
            out.put("dx", dxTotal);
            out.put("dy", dyTotal);
            out.put("steps", steps);
            out.put("release", release);
            out.put("settled_frames", settledFrames);
            out.put("gestures_fired", gestureDispatched - beforeGestures);
            out.put("follow_moves", view.followMoves);
            out.put("follow_applied", view.followApplied);
            out.put("release_calls", view.followReleaseCalls);
            out.put("release_started", view.followReleaseStarted);
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /**
     * ★★★**S3-T3 多指拖拽注入**（2026-10-10 · 输入延迟专项 #767 · 判据 ㊱）：`N` 个指针**同时**按下并按
     *   各自位移拖动，用**真多指 MotionEvent**（DOWN → POINTER_DOWN… → 批量 MOVE → [POINTER_UP… → UP]）
     *   走 `onTouchEvent` 全链路。要证明：**一帧一次 FFI**（`batch_calls`/`moves ≈ 1`——M 指也只是一次跨界）
     *   + `ptrs_max = N`（多指真的同时跟手）。
     * @param argsJson `{points:[{x,y,dx,dy},…], steps, release?, settleFrames?}`
     */
    public String dragMulti(String argsJson) {
        JSONObject out = new JSONObject();
        try {
            if (view == null) return err(out, "视图未建").toString();
            JSONObject a = new JSONObject(argsJson);
            org.json.JSONArray pts = a.optJSONArray("points");
            if (pts == null || pts.length() < 2) return err(out, "points 至少 2 指").toString();
            final int n = pts.length();
            final float[] x0 = new float[n], y0 = new float[n], dxT = new float[n], dyT = new float[n];
            for (int i = 0; i < n; i++) {
                JSONObject p = pts.getJSONObject(i);
                x0[i] = (float) p.optDouble("x", 0);
                y0[i] = (float) p.optDouble("y", 0);
                dxT[i] = (float) p.optDouble("dx", 0);
                dyT[i] = (float) p.optDouble("dy", 0);
            }
            final int steps = Math.max(1, a.optInt("steps", 6));
            final boolean release = a.optBoolean("release", true);
            final int settleFrames = Math.max(0, a.optInt("settleFrames", 0));
            final int beforeGestures = gestureDispatched;
            view.resetFollowCounters();
            long age = 1000L * tapInjectSeq;
            tapInjectSeq++;
            final long t0 = android.os.SystemClock.uptimeMillis() + age;
            // 指针属性（id = i，工具 = 手指）与坐标缓冲（批量 MOVE 复用）
            android.view.MotionEvent.PointerProperties[] props = new android.view.MotionEvent.PointerProperties[n];
            android.view.MotionEvent.PointerCoords[] coords = new android.view.MotionEvent.PointerCoords[n];
            for (int i = 0; i < n; i++) {
                props[i] = new android.view.MotionEvent.PointerProperties();
                props[i].id = i;
                props[i].toolType = android.view.MotionEvent.TOOL_TYPE_FINGER;
                coords[i] = new android.view.MotionEvent.PointerCoords();
                coords[i].x = x0[i];
                coords[i].y = y0[i];
                coords[i].pressure = 1f;
                coords[i].size = 1f;
            }
            long t = t0;
            // DOWN（仅第 0 指在集合内）
            view.dispatchTouchEvent(android.view.MotionEvent.obtain(t0, t0,
                    android.view.MotionEvent.ACTION_DOWN, 1, props, coords, 0, 0, 0f, 0f, 0, 0, 0, 0));
            // POINTER_DOWN（第 1..n-1 指依次加入）
            for (int i = 1; i < n; i++) {
                t += 4;
                final int action = android.view.MotionEvent.ACTION_POINTER_DOWN
                        | (i << android.view.MotionEvent.ACTION_POINTER_INDEX_SHIFT);
                view.dispatchTouchEvent(android.view.MotionEvent.obtain(t0, t,
                        action, i + 1, props, coords, 0, 0, 0f, 0f, 0, 0, 0, 0));
            }
            // 批量 MOVE（全部 n 指同时；每步一个真 MotionEvent ⇒ 宿主每步一次 batch FFI）
            for (int s = 1; s <= steps; s++) {
                final float frac = (float) s / steps;
                for (int i = 0; i < n; i++) {
                    coords[i].x = x0[i] + dxT[i] * frac;
                    coords[i].y = y0[i] + dyT[i] * frac;
                }
                t += 8;
                view.dispatchTouchEvent(android.view.MotionEvent.obtain(t0, t,
                        android.view.MotionEvent.ACTION_MOVE, n, props, coords, 0, 0, 0f, 0f, 0, 0, 0, 0));
            }
            if (release) {
                // POINTER_UP（第 n-1..1 指依次抬起 ⇒ 各自松手）
                for (int i = n - 1; i >= 1; i--) {
                    t += 4;
                    final int action = android.view.MotionEvent.ACTION_POINTER_UP
                            | (i << android.view.MotionEvent.ACTION_POINTER_INDEX_SHIFT);
                    view.dispatchTouchEvent(android.view.MotionEvent.obtain(t0, t,
                            action, n, props, coords, 0, 0, 0f, 0f, 0, 0, 0, 0));
                }
                // UP（第 0 指）
                t += 4;
                view.dispatchTouchEvent(android.view.MotionEvent.obtain(t0, t,
                        android.view.MotionEvent.ACTION_UP, 1, props, coords, 0, 0, 0f, 0f, 0, 0, 0, 0));
            }
            int settledFrames = 0;
            if (release && settleFrames > 0) {
                for (int f = 0; f < settleFrames; f++) {
                    view.kernelAnimTick(16.7f);
                    settledFrames++;
                    try {
                        JSONObject ao = new JSONObject(view.kernelAnimActive());
                        if (ao.optBoolean("ok") && ao.optInt("active", -1) == 0) break;
                    } catch (Throwable ignored) { /* 读数失败 ⇒ 跑满上限（有界） */ }
                }
            }
            out.put("ok", true);
            out.put("pointers", n);
            out.put("steps", steps);
            out.put("settled_frames", settledFrames);
            out.put("gestures_fired", gestureDispatched - beforeGestures);
            out.put("follow_moves", view.followMoves);
            out.put("follow_applied", view.followApplied);
            out.put("batch_calls", view.followBatchCalls);
            out.put("ptrs_max", view.followPointersMax);
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

    /**
     * ★★★B-T2（2026-10-10）：**文本策略回读**（`whiteSpace`/`wordBreak`/`lineClamp`；内核 = SSOT）。
     *   入参 JSON 数组 id；返 `{ok,policy:{id:{…}}}`。QuickJS 绑本方法（见 quickjs_jni.c 条件注入）。
     */
    public String textPolicy(String nodeIdsJson) {
        if (handle == 0L) return "{\"ok\":false,\"error\":\"尚未 mount\"}";
        try {
            return RustLayout.textPolicy(handle, nodeIdsJson);
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
        // ★★★批 A③ 修（2026-10-08）+ 用户实测修（整棵子树）：sticky **相位 2**（与 emitAll 同口径——
        //   CSS：sticky 是 positioned，绘制在在流内容之后）。判据用 **`stickySubtreeIdSetOf`**
        //   （锚点 + 全部子孙——见 emitAll 注释：只挪锚点会让条盖住子文字）。
        //   集合为空时本比较器 = 原 nodeIdx 序（零行为变化）。
        java.util.Set<Integer> stickySub = computeStickySubtree();
        all.sort((a, b) -> {
            final int pa = stickySub.contains(a.nodeId) ? 1 : 0;
            final int pb = stickySub.contains(b.nodeId) ? 1 : 0;
            if (pa != pb) return pa - pb;
            return Integer.compare(a.nodeIdx, b.nodeIdx);
        });
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
            "gridTemplateColumns", "gridTemplateRows", "gridAutoColumns", "gridAutoRows", "aspectRatio", "pointerEvents", "fontFamily",
            // ★★★grid-template-areas 项（2026-10-08）：命名区域模板 + 子项 grid-area 命名区引用——
            //   内核（taffy GridTemplateAreas / NamedLine）已消费；漏登记 ⇒ 请求树不带 ⇒ 内核静默用默认
            //   （由 check:host-kernel-keys 当场抓出——第 5 次"宿主白名单须跟内核新字段走"）。纯字符串，无密度换算。
            "gridTemplateAreas", "gridArea",
            // ★★★justify-self 项（2026-10-06）：**网格项行内轴自对齐** —— 内核（taffy Style.justify_self）已消费，
            //   漏登记 ⇒ 请求树不带 ⇒ 内核静默用默认（真机实测：center/end 案全落 start——白名单漏项的老款缺陷）。
            "justifySelf",
            // ★★★place-items/justify-items 项（2026-10-08）：网格容器内子项行内轴对齐（内核 taffy justify_items 消费）
            "justifyItems",
            // ★★批次 41 补登记（同款漏项，本轮审计顺带抓出）：grid-column/grid-row 线号放置——
            //   内核（taffy Line<GridPlacement>）已消费但本白名单一直没登记 ⇒ 端上放置失效（静默）。
            "gridColumn", "gridRow",
            // ★★★grid-auto-flow 项（2026-10-08）：自动放置——内核（taffy GridAutoFlow）已消费，
            //   漏登记 ⇒ 请求树不带 ⇒ 内核静默用默认（与 justifySelf/gridColumn 同款漏项），门禁 check:host-kernel-keys 抓出。
            "gridAutoFlow",
            "widthRatio", "heightRatio", "marginAuto", "minWidthPct", "maxWidthPct", "minHeightPct", "maxHeightPct", "overflow",
            // ★静态基态声明（内核要解析）：裁剪形状 + 路径本体（+ 描边色/宽随 svgPath 一起进）
            "clipPath", "svgPath", "svgPathTo", "perspective",
            // ★★补登记（2026-10-08 · check:host-kernel-keys 修为精确正则后抓出）：内核 `style_from_dto`
            //   读 `dto.glow` → `style.glow`（**供 glow 强度动画**：anim.rs `is_glow_intensity` 需该规格
            //   作基准）；宿主此前不转发 ⇒ 内核 glow 恒 None ⇒ glow 强度动画无声失效。转发非行为变更
            //   （静态渲染 glow 仍由宿主自绘 Cmd.glow；无 glow 动画的节点 `glow_intensity==1.0` ⇒ 零影响）。
            "glow",
            // ★★★B-T2（2026-10-10）：**文本策略**（内核持有 = SSOT；不参与 taffy 布局）——内核
            //   `style_from_dto` 读 `dto.white_space/word_break/line_clamp` ⇒ 必须经白名单转发，否则
            //   内核恒 None（同款漏项，check:host-kernel-keys 抓出）。宿主据此重度量/重绘（读回见 textPolicy）。
            "whiteSpace", "wordBreak", "lineClamp"));

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
    public void setLengthScale(float s) { if (s > 0) lengthScale = s; }

    /* ───────── ★★★内置环境变量表（2026-10-08 · 决策 #593）：`--pf-*` → 逻辑像素（dp）─────────
     * 宿主采集平台 insets（WindowInsets）→ 归一为 dp → 本表；`physicalizeSpec` 把编译期发射的
     * `env:<name>` token 解析成 dp（再 ×density），Stage 1 宿主侧解析（Stage 2 迁内核 env 表）。 */
    private final java.util.Map<String, Double> envVars = new java.util.HashMap<>();
    /** 注入环境变量表（dp 值；键 = `--pf-*`）。可在每次 mount 前调用（旋转/折叠则重排）。 */
    public void setEnvVars(JSONObject vars) {
        envVars.clear();
        if (vars == null) return;
        java.util.Iterator<String> it = vars.keys();
        while (it.hasNext()) { String k = it.next(); envVars.put(k, vars.optDouble(k, 0)); }
    }
    /** 解析 `env:<name>[+N|-N][~F]` token → dp；未知名/无表项 ⇒ fallback（缺省 0）。非 token ⇒ null。 */
    private Double resolveEnvToken(String tok) {
        if (tok == null || !tok.startsWith("env:")) return null;
        String rest = tok.substring(4);
        double fallback = 0; int tilde = rest.indexOf('~');
        if (tilde >= 0) { try { fallback = Double.parseDouble(rest.substring(tilde + 1)); } catch (Exception e) { fallback = 0; } rest = rest.substring(0, tilde); }
        // ★★缩放（决策 #595）：`*<scale>`（名/偏移之后）——`19vw` → `env:--pf-vw*0.19`
        double scale = 1;
        int star = rest.indexOf('*');
        if (star >= 0) { try { scale = Double.parseDouble(rest.substring(star + 1)); } catch (Exception e) { scale = 1; } rest = rest.substring(0, star); }
        int off = 0; int end = rest.length();
        // ★偏移符号 = 后随**数字**的 +/-（变量名自带连字符 '-'——不能见 '-' 就当分隔符）
        for (int i = 1; i + 1 < rest.length(); i++) { char c = rest.charAt(i); if ((c == '+' || c == '-') && rest.charAt(i + 1) >= '0' && rest.charAt(i + 1) <= '9') { end = i; try { off = (c == '-' ? -1 : 1) * (int) Double.parseDouble(rest.substring(i + 1)); } catch (Exception e) { off = 0; } break; } }
        String name = rest.substring(0, end);
        Double base = envVars.get(name);
        double v = (base != null ? base : fallback) * scale + off;
        return v;
    }
    /** 字符串值若是 env token ⇒ 就地替换为 dp 数值（shape-agnostic：只碰 `env:` 前缀的字符串）。
     *  ★包可见（决策 #677）：`ScreenHost`（屏切换通路）**也必须**走同一解析——否则它把
     *    `"minHeight":"env:--pf-vh"` 等字符串原样喂内核 ⇒ serde「expected f32」⇒ `create` 返 0
     *    ⇒ 点卡片不切屏（真机实测，此前**完全静默**）。 */
    void resolveEnvInSpec(JSONObject spec) throws Exception {
        java.util.Iterator<String> it = spec.keys();
        java.util.List<String> toSet = new java.util.ArrayList<>();
        while (it.hasNext()) {
            String k = it.next(); Object v = spec.get(k);
            if (v instanceof String) { Double d = resolveEnvToken((String) v); if (d != null) toSet.add(k + '\u0000' + d); }
        }
        for (String kv : toSet) { int z = kv.indexOf('\u0000'); spec.put(kv.substring(0, z), Double.parseDouble(kv.substring(z + 1))); }
        // 四边对象（margin/padding {top,right,bottom,left}）
        for (String e : new String[]{"margin", "padding"}) {
            JSONObject o = spec.optJSONObject(e); if (o == null) continue;
            for (String side : new String[]{"top", "right", "bottom", "left"}) {
                Object sv = o.opt(side);
                if (sv instanceof String) { Double d = resolveEnvToken((String) sv); if (d != null) o.put(side, d); }
            }
        }
    }

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
        // ★★★outline 族项（2026-10-08）：轮廓宽/偏移必须 ×密度（漏则环尺寸/偏移 1/3——子代理终评抓出）
        "outlineWidth", "outlineOffset",
        "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
        "marginTop", "marginRight", "marginBottom", "marginLeft",
        "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
        // ★★★逐边 border 批（2026-10-05 · 独立终评抓出的 major）：逐边宽度必须登记 ——
        //   漏登记 ⇒ 未乘 DPR ⇒ 边框比 Web 基准**细 3 倍**（真机实测 2/3/4/1 设备px vs 应 6/9/12/3）。
        //   （本表注释原文就写着「新增长度字段必须登记」——这次是我自己漏了。）
        "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
        // ★★★S3-T2（#767）：`v-follow` 的**长度类**跟随参数（夹取区间 / 吸附阈值与目标）按密度缩放
        //   （跟手位移 `dx` 是物理 px、内核 `translate_x` 是物理 px ⇒ 源码里的逻辑 px 边界必须 ×density；
        //    spring 参数 stiffness/damping/mass 是**无量纲物理量**、gain 是比例 ⇒ 不缩放——与既有弹簧同规）。
        "followClampMin", "followClampMax", "followSnapThreshold", "followSnapTarget",
    };

    /** 物理化一个 spec/样式对象（原地改写；同时被 mount/updatePatches 复用——同一清单一处实现） */
    private void physicalizeSpec(JSONObject spec) throws Exception {
        if (spec == null) return;
        // ★★env token 解析**先于** lengthScale 早退（env 与密度无关；解析为 dp 后由下方 ×lengthScale 归一）
        if (!envVars.isEmpty()) resolveEnvInSpec(spec);
        if (lengthScale == 1f) return;
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
        // ★★★justify-self 项（2026-10-06 · 真机实测抓出）：**网格轨迹串里的 px 长度**也必须按密度缩放。
        //   gridTemplateColumns/Rows 是**字符串**（如 "240px"），不在 LEN_SCALARS（那是数值字段）⇒
        //   此前只缩了容器 width/padding（×density），轨迹串原样 ⇒ track 比物理空间小 density 倍
        //   ⇒ 子项（宽已 ×density）恰好**填满 track** ⇒ justify-self 无对齐空间（真机 center/end 全落 start）。
        //   ⇒ 与 width 同轴：把串里每个 <n>px 乘 lengthScale（fr/auto/% 等无量纲/相对单位不动）。
        for (String gk : new String[]{"gridTemplateColumns", "gridTemplateRows", "gridAutoColumns", "gridAutoRows"}) {
            String graw = spec.optString(gk, null);
            if (graw == null || graw.isEmpty()) continue;
            spec.put(gk, scalePxInCssLengths(graw));
        }
        // ★★★背景定位家族（2026-10-07）：backgroundSize/Position 里的 **px 长度**按密度缩放
        //   （与 gridTemplateColumns 同轴：字符串不在 LEN_SCALARS；% / auto / 关键字不含 px ⇒ 不动）。
        for (String bk : new String[]{"backgroundSize", "backgroundPosition"}) {
            String braw = spec.optString(bk, null);
            if (braw != null && !braw.isEmpty()) spec.put(bk, scalePxInCssLengths(braw));
        }
        // ★★★行高物理化（2026-10-08 · 用户抓出「安卓 view 不随内容自动增高」）：`lineHeight` 是**字符串 token**
        //   （如 "20px" / 无单位倍数 "1.5"）——不在 LEN_SCALARS（那是数值字段）⇒ 此前 "20px" 原样留在**逻辑**空间，
        //   而盒/字号已 ×density ⇒ 文本节点测量高度只有真实的 1/density ⇒ 容器不随内容增高、文字溢出盒外
        //   （iOS 几何是逻辑点无需换算、鸿蒙 lineHeightDesignPx 显式 ×density——三端仅 Android 有此缺口）。
        //   ⇒ 与 grid 轨迹串同轴：把 token 里的 <n>px 乘 lengthScale（无单位倍数不含 px ⇒ 不动，其高度随 fontSize 已物理）。
        {
            String lhTok = spec.optString("lineHeight", null);
            if (lhTok != null && !lhTok.isEmpty()) {
                String scaled = scalePxInCssLengths(lhTok);
                if (!scaled.equals(lhTok)) spec.put("lineHeight", scaled);
            }
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
        // ★按下态发光（Dactyl §4.2）：`pressBoxShadow.blur` 也是长度 ⇒ 同 boxShadow 缩放（漏则发光半径 1/3）。
        JSONObject pshadow = spec.optJSONObject("pressBoxShadow");
        if (pshadow != null) {
            for (String k : new String[]{"dx", "dy", "blur", "spread"}) {
                if (pshadow.has(k) && pshadow.get(k) instanceof Number) pshadow.put(k, pshadow.getDouble(k) * lengthScale);
            }
        }
        // ★★★text-shadow 项（2026-10-08 · 真机用户抓出「安卓投影太轻/光晕太小」）：**文本阴影长度也必须 ×密度**——
        //   与 boxShadow 同轴（结构化对象的 dx/dy/blur 是长度；color 不动）。漏登记 ⇒ 安卓上 dx/dy/blur 停留在
        //   CSS 逻辑 px（约物理的 1/density）⇒ 相对字号(已 ×density)的投影/光晕小 ~3 倍（Web/iOS/鸿蒙正确）。
        JSONObject tshadow = spec.optJSONObject("textShadow");
        if (tshadow != null) {
            for (String k : new String[]{"dx", "dy", "blur"}) {
                if (tshadow.has(k) && tshadow.get(k) instanceof Number) tshadow.put(k, tshadow.getDouble(k) * lengthScale);
            }
        }
    }

    /** 缩放 CSS 长度串里的 px 数值（gridTemplateColumns/Rows 用）——fr/auto/%/em 等不动 */
    private String scalePxInCssLengths(String s) {
        if (lengthScale == 1f || s == null || s.isEmpty()) return s;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(-?\\d+(?:\\.\\d+)?)px").matcher(s);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            double v = Double.parseDouble(m.group(1)) * lengthScale;
            m.appendReplacement(sb, formatNum(v) + "px");
        }
        m.appendTail(sb);
        return sb.toString();
    }

    /** 数值格式化（去尾零；避免 240.0 这类脏形态） */
    private static String formatNum(double v) {
        if (v == Math.rint(v) && !Double.isInfinite(v)) return String.valueOf((long) v);
        return String.valueOf(v);
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
            int mw = (int) spec.optDouble("fontWeight", 400);
            float ls = (float) spec.optDouble("letterSpacing", 0);
            final int clamp = (int) spec.optDouble("lineClamp", 0);
            // ★HA0.5：折行度量抽到**平台适配层**（`ProteusTextPlatform.measureWrapped`，与 iOS `measureTextWrapped` 对称）；
            //   返回 null = 单行且无 clamp（与首遍等价，零操作）。断词/长串溢出/行高封顶都在平台层。
            float[] m2 = ProteusTextPlatform.measureWrapped(t, fs, mw, spec.optString("fontFamily", null), ls,
                    spec.optString("wordBreak", null), clamp, boxW, lineHeightPxOf(spec, fs));
            if (m2 == null) continue;
            JSONObject sz = new JSONObject();
            sz.put("width", m2[0]);
            sz.put("height", m2[1]);
            // ★B-T1：折行度量同样带基线（基线是首行字体度量，与是否折行无关）
            sz.put("baseline", ProteusTextPlatform.baseline(fs, mw, spec.optString("fontFamily", null), ls));
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
     * ★★★word-break 项（2026-10-06）：`break-all` 的 Android 实现——**零宽空格（U+200B）注入**。
     *   【为什么不能用原生 API】Android `Layout` 只有 `BREAK_STRATEGY_*`（断行**质量**策略：贪心/均衡/高质量），
     *   **没有**"任意字符处可断"的原生开关（`LineBreaker` 同理）⇒ `break-all` 无原生对应。
     *   【做法】在**每个字符后**插入 U+200B（ZWSP）：StaticLayout 视其为合法断点、且**不占宽度**
     *   （对中日韩等本就可断的字符无害）；这样长不可断串（`break-all` 的目标场景）能按盒宽折行。
     *   【★两处必须同源】测量（applyWrapRemeasure）与绘制（mkCmd）**都要**经本函数，否则折行数不一致。
     *   `normal`/`break-word`/缺省 ⇒ 不改（Android 默认已按词断 + 超长词自然断 = 接近 Web break-word）。
     */
    static String applyWordBreak(String t, String wb) {
        // ★HA0.5：实现抽到平台层（度量与绘制同源共用）——本方法保留签名供 mkCmd 等既有调用方。
        return ProteusTextPlatform.applyWordBreak(t, wb);
    }

    /** ★★★word-break 项（2026-10-09 · 全端一致）：**无断点长串**判据——不含空格/制表/换行且不含 CJK。
     *   `word-break:normal` 下，无断点长串在 Web 上是「整串溢出、不折行」；而安卓 StaticLayout
     *   会**硬折**超宽行（无"禁止折长词"开关）⇒ 须显式判定为「单行溢出」（见 mkCmd / applyWrapRemeasure）。
     *   ★与鸿蒙 `WORD_BREAK_TYPE_NORMAL` 同语义（该端引擎原生即"词边界断、长词溢出"）。 */
    static boolean isUnbreakableToken(String t) {
        // ★HA0.5：实现抽到平台层（度量与绘制同源共用）——本方法保留签名供 mkCmd 等既有调用方。
        return ProteusTextPlatform.isUnbreakableToken(t);
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
            float fs = (float) spec.optDouble("fontSize", 14);
            int mw = (int) spec.optDouble("fontWeight", 400);
            float ls = (float) spec.optDouble("letterSpacing", 0);
            // ★HA0.5：单行度量抽到**平台适配层**（`ProteusTextPlatform.measureSingle`，与 iOS `measureText` 对称）
            //   —— 度量与绘制同源（共用 typefaceOf + 字号/字重/字距），此处零行为变化。
            float[] m2 = ProteusTextPlatform.measureSingle(fs, mw, spec.optString("fontFamily", null), ls, t);
            float w = m2[0];
            float glyphH = m2[1];   // ★真实字体度量（descent−ascent）
            float baseline = m2[2]; // ★B-T1：盒内容顶→基线（−ascent）——供内核 align-items:baseline 对文本对齐
            // ★批次 13（line-height）：行盒高 = 行高（倍数×fs 或绝对 px）；缺省 = 字形度量高
            float lh = lineHeightPxOf(spec, fs);
            float h = lh > 0 ? lh : glyphH;
            JSONObject sz = new JSONObject();
            // I2-ALLOW: 文本**测量**结果的取整（测量子系统，非几何换算——度量值交给内核后由内核统一 `snap`）
            sz.put("width", Math.ceil(w));
            sz.put("height", Math.ceil(h));
            // ★B-T1：基线（不取整——它是字体度量，用于对齐运算；取整会引入偏差）
            sz.put("baseline", baseline);
            m.put(String.valueOf(spec.getInt("id")), sz);
        }
        return m;
    }

    /**
     * ★批次 13：`line-height` token → **行盒高 px**（0 = 未声明，用字形度量高）。
     *   无单位倍数（`1.6`）⇒ `1.6 × fontSize`；绝对（`24px`）⇒ 24。
     */
    static float lineHeightPxOf(JSONObject spec, float fontSizePx) {
        // ★HA0.5：token 解析抽到平台层（`ProteusTextPlatform.lineHeightPx`）——本方法保留签名供既有调用方。
        return ProteusTextPlatform.lineHeightPx(spec.optString("lineHeight", null), fontSizePx);
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
    /**
     * ★★★逐边 border 批（2026-10-05）：读节点的逐边边框字段 → `float[12]` 规格（宿主逐边绘制）。
     *   返回 null = 无任何逐边声明（纯 uniform 路径——零行为变化）。
     *   `[0..3]` 宽度（NaN=未声明 ⇒ 回落 uniform）· `[4..7]` 颜色（0=未声明）· `[8..11]` 线型（0=solid）。
     *   ★线型不在折叠面（App 端仅 solid；非 solid 已在编译期诊断跳过）⇒ 全 0。
     */
    private static float[] sideBorderOf(JSONObject spec) {
        final String[] W = {"borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"};
        final String[] C = {"borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor"};
        final String[] S = {"borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle"};
        boolean any = false;
        for (String k : W) { if (spec.has(k)) { any = true; break; } }
        if (!any) for (String k : C) { if (spec.has(k)) { any = true; break; } }
        if (!any) for (String k : S) { if (spec.has(k)) { any = true; break; } }
        if (!any) return null;
        final float[] sb = new float[12];
        for (int i = 0; i < 4; i++) {
            sb[i] = spec.has(W[i]) ? (float) spec.optDouble(W[i], 0) : Float.NaN;
            final String col = spec.optString(C[i], null);
            sb[4 + i] = col != null ? parseColor(col) : 0f;
            // ★★★边框族收口批（2026-10-05）：线型（0=solid / 1=dashed / 2=dotted）
            final String stv = spec.optString(S[i], "solid");
            sb[8 + i] = "dashed".equals(stv) ? 1f : "dotted".equals(stv) ? 2f : 0f;
        }
        return sb;
    }

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
        final ProteusHostView.GradSpec grad = parseGrad(spec);
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
            // ★★★CSS 初值 `color`（2026-10-08 · 以 Web 为基准）：缺省 **黑**（Web 未声明 color 时
            //   computed 即黑）。此前缺省 **白** ⇒ 未声明颜色的页面（如 create-proteus 模板首屏
            //   `div/h1/p` 无 color）文字**白字白底 = 不可见**——用户实测「新工程编译到手机跑不起来」
            //   的真因（页面其实渲染了，只是全白看不见）。
            int textColor = tc != null ? parseColor(tc) : 0xFF000000;
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
            // ★★★word-break 项（2026-10-06）：`break-all` ⇒ 注入 ZWSP（测量与绘制同源——本函数即绘制侧，
            //   applyWrapRemeasure 是测量侧，两处都调 applyWordBreak）。此处须在 multiLine 判定**之前**改 t。
            t = applyWordBreak(t, spec.optString("wordBreak", null));
            // ★批次 4：文本水平对齐（text-align → 0/1/2）
            int ta = alignOf(spec.optString("textAlign", null));
            // ★批次 13：行高（px；0 = 缺省）
            float lh = lineHeightPxOf(spec, fs);
            // ★批次 20：字距（px）
            float ls = (float) spec.optDouble("letterSpacing", 0);
            // ★批次 35：文本装饰（0=none/1=underline/2=line-through）
            String td = spec.optString("textDecoration", null);
            int decor = "underline".equals(td) ? 1 : "line-through".equals(td) ? 2 : 0;
            // ★★★line-clamp 项（2026-10-08）：多行截断行数（0 = 无截断；Web `-webkit-line-clamp` 同语义）。
            //   clamp>0 ⇒ 强制走 StaticLayout 绘制（即便只 1 行——需要尾部省略号通道）。
            final int clamp = (int) spec.optDouble("lineClamp", 0);
            // ★★全端对齐批：绘制模式标记——multiLine=wrap 且该盒宽确需多行；clipText=nowrap 溢出裁切。
            boolean multiLine = false;
            if (wsWrap && !t.isEmpty() && w > 1f) {
                android.text.TextPaint wtp = new android.text.TextPaint();
                wtp.setTextSize(fs);
                wtp.setTypeface(ProteusHostView.typefaceOf(spec.optString("fontFamily", null), fw, null));
                if (ls != 0f && fs > 0f) wtp.setLetterSpacing(ls / fs);
                // ★★★word-break:normal（2026-10-09 · 全端一致）：**无断点长串**且宽 > 内容盒宽
                //   ⇒ 单行溢出（= Web normal「不折长词」）——否则 Android StaticLayout 会硬折超宽行。
                JSONObject padW0 = spec.optJSONObject("padding");
                float cw0 = padW0 != null
                        ? w - (float) padW0.optDouble("left", 0) - (float) padW0.optDouble("right", 0)
                        : w;
                if (cw0 < 1f) cw0 = w;
                final boolean breakAll0 = "break-all".equals(spec.optString("wordBreak", null));
                if (!breakAll0 && isUnbreakableToken(t) && wtp.measureText(t) > cw0 + 0.5f) {
                    multiLine = false;   // 单行溢出（不折行）
                } else {
                    android.text.StaticLayout wsl = android.text.StaticLayout.Builder
                            // I2-ALLOW: 文本**测量**宽（多行判定用 StaticLayout 同款整型宽；非绘制几何发射）
                            .obtain(t, 0, t.length(), wtp, Math.max(1, (int) Math.ceil(w)))
                            .setIncludePad(false)
                            .build();
                    multiLine = wsl.getLineCount() > 1;
                }
            }
            if (clamp > 0 && wsWrap) multiLine = true;   // clamp ⇒ StaticLayout（尾部省略号通道）
            final boolean clipText = !wsWrap && w > 1f
                    && "hidden".equals(spec.optString("overflow", null))
                    && !("ellipsis".equals(spec.optString("textOverflow", null)));
            { ProteusHostView.Cmd _c = new ProteusHostView.Cmd(x, y, w, h, color, t, fs, textColor, radius, grad, glowSpec, maskSpec, fw, ta, bw, bc, shadowSpec, lh, ls, decor, wsWrap ? 0 : 1, multiLine, clipText, sideBorderOf(spec)); _c.lineClamp = clamp; _c.outline = parseOutline(spec); _c.textShadow = parseTextShadow(spec.optJSONObject("textShadow")); applyTextPad(_c, spec); return _c; }
        }
        { ProteusHostView.Cmd _c = new ProteusHostView.Cmd(x, y, w, h, color, null, 0f, 0, radius, grad, glowSpec, maskSpec, 400, 0, bw, bc, shadowSpec, 0f, 0f, 0, 0, false, false, sideBorderOf(spec)); _c.outline = parseOutline(spec); _c.textShadow = parseTextShadow(spec.optJSONObject("textShadow")); return _c; }
    }

    /**
     * ★★★text 内间距批（2026-10-09）：把节点的 `padding` 四边写入 Cmd（文本绘制内缩 = 内容盒）。
     *   spec 已在入口**物理化**（padding ×density）⇒ 此处直读物理 px（绘制侧与盒同单位）。
     */
    private static void applyTextPad(ProteusHostView.Cmd c, JSONObject spec) {
        JSONObject p = spec.optJSONObject("padding");
        if (p == null) return;
        c.padL = (float) p.optDouble("left", 0);
        c.padT = (float) p.optDouble("top", 0);
        c.padR = (float) p.optDouble("right", 0);
        c.padB = (float) p.optDouble("bottom", 0);
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
            // ★★★父关系（CSS 父 transform 级联用，2026-10-08 · effects D 案）：宿主扁平绘制需显式级联。
            if (view != null) view.setNodeParent(id, spec.has("parentId") && !spec.isNull("parentId") ? spec.optInt("parentId", -1) : null);
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
        if (t != null) {
            view.setNodeTransform(id,
                    (float) t.optDouble("txPx", 0),
                    (float) t.optDouble("tyPx", 0),
                    (float) t.optDouble("sx", 1),
                    (float) t.optDouble("rotate", 0),
                    (float) t.optDouble("txPct", 0),
                    (float) t.optDouble("tyPct", 0));
        }
        // ★★★静态透明度（2026-10-08 · 子代理审 effects 案例 A）：`opacity` 此前**无任何入口**
        //   ⇒ 声明 opacity 的节点渲染为**完全不透明**。放在 transform 之后（写同一 nodeStaticTx[4] 槽位）。
        if (spec.has("opacity")) view.setNodeOpacity(id, (float) spec.optDouble("opacity", 1));
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
    /** fillGradient + 背景定位家族（2026-10-07）三个键（backgroundSize/Position/Repeat，spec 级）→ GradSpec */
    /** ★★★outline 族项（2026-10-08）：轮廓规格 `[widthPx, offsetPx, colorARGB, styleInt]`（invalid ⇒ null）。 */
    private static float[] parseOutline(JSONObject spec) {
        if (spec == null) return null;
        double ow = spec.optDouble("outlineWidth", 0);
        String ocS = spec.optString("outlineColor", "");
        String osV = spec.optString("outlineStyle", "solid");
        if (ow <= 0 || ocS.isEmpty() || "none".equals(osV)) return null;
        int oc;
        try { oc = (int) (0xFF000000L | Long.parseLong(ocS.startsWith("#") ? ocS.substring(1) : ocS, 16)); } catch (NumberFormatException e) { return null; }
        float off = (float) spec.optDouble("outlineOffset", 0);
        int style = "dashed".equals(osV) ? 1 : "dotted".equals(osV) ? 2 : 0;
        return new float[]{ (float) ow, off, oc, style };
    }

    /** ★★★text-shadow 项（2026-10-08）：`{dx,dy,blur,color}` → `[dx,dy,blur,colorHi16,colorLo16]`（坏色 ⇒ null） */
    private float[] parseTextShadow(JSONObject ts) {
        if (ts == null) return null;
        String colS = ts.optString("color", "");
        int col = colS.startsWith("#") ? parseColor(colS) : 0;
        if (col == 0) return null;
        return new float[]{
                (float) ts.optDouble("dx", 0),
                (float) ts.optDouble("dy", 0),
                (float) ts.optDouble("blur", 0),
                (float) ((col >>> 16) & 0xFFFF),
                (float) (col & 0xFFFF)};
    }

    /** 从 `Cmd.textShadow` 取回无损阴影色（`[3]`=高16 / `[4]`=低16） */
    static int textShadowColorOf(float[] ts) {
        if (ts.length >= 5) return ((int) ts[3] << 16) | (int) ts[4];
        return ts.length >= 4 ? (int) ts[3] : 0;
    }

    private ProteusHostView.GradSpec parseGrad(JSONObject spec) {
        return ProteusHostView.GradSpec.parse(spec.optJSONObject("fillGradient"),
                spec.optString("backgroundSize", null), spec.optString("backgroundPosition", null), spec.optString("backgroundRepeat", null));
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
    /** ★★★overflow-x 项（2026-10-06）：把内核 rects 里的 `clip` 字段注入视图的裁剪表。
     *   · 有 clip ⇒ setNodeClipRect（绘制时 clipRect）；无 ⇒ clearNodeClipRect（**必须清**——
     *     同 id 复用时残留 = 幽灵裁剪，与 clipPath 的同款缺陷同源）。
     *   · 增量通道与全量通道**同法**（apply_ops 的 rects 也带 clip——内核两通道同源）。 */
    private void applyClipRects(JSONObject rects) throws Exception {
        java.util.Iterator<String> it = rects.keys();
        while (it.hasNext()) {
            String key = it.next();
            int id;
            try { id = Integer.parseInt(key); } catch (NumberFormatException e) { continue; }
            JSONObject r = rects.optJSONObject(key);
            // ★★扁平键（clipX/clipY/clipW/clipH）——内核侧选择扁平形态：serde_json 键按字母序，
            //   嵌套对象会把鸿蒙"找 '}'"段落解析器截断（跨端同形纪律）。
            if (r != null && r.has("clipX") && view != null) {
                view.setNodeClipRect(id, (float) r.optDouble("clipX"), (float) r.optDouble("clipY"),
                        (float) r.optDouble("clipW"), (float) r.optDouble("clipH"));
            } else if (view != null) {
                view.clearNodeClipRect(id);
            }
        }
    }

    /**
     * ★★★用户实测修复（2026-10-08）：**sticky 整棵子树 id 集**（锚点 + 全部子孙）。
     *   为什么：sticky 的**相位 2 分区**与**吸附位移**都必须覆盖整棵子树——只处理锚点本身会
     *   ① 子文字被锚点背景盖住（相位 1 先画文字、相位 2 后画条）② 条吸顶后文字不跟随。
     */
    private java.util.Set<Integer> computeStickySubtree() {
        java.util.Set<Integer> out = new java.util.HashSet<>();
        java.util.Map<Integer, Integer> parentById = new java.util.HashMap<>();
        for (int i = 0; i < specs.size(); i++) {
            JSONObject sp = specs.get(i);
            int sid = sp.optInt("id", -1);
            if (sid < 0) continue;
            parentById.put(sid, sp.has("parentId") && !sp.isNull("parentId") ? sp.optInt("parentId", -1) : -1);
            if ("sticky".equals(sp.optString("position", ""))) out.add(sid);
        }
        for (int i = 0; i < specs.size(); i++) {
            int id = specs.get(i).optInt("id", -1);
            int cur = id, guard = 0;
            while (guard++ < 256) {
                Integer p = parentById.get(cur);
                if (p == null || p < 0) break;
                if (out.contains(p)) { out.add(id); break; }
                cur = p;
            }
        }
        return out;
    }

    private void emitAll() throws Exception {
        JSONObject rects = new JSONObject(RustLayout.readRects(handle)).getJSONObject("rects");
        applyClipRects(rects);   // ★★★overflow-x 项（2026-10-06）：内核下发的有效裁剪矩形 → 视图表
        cmds.clear();
        cmdIdsOf.clear();
        cmdIndexById.clear();
        // ★★★批 A③ 修（2026-10-08 · 用户实测"吸附后被内容盖住"）：**sticky 相位 2 绘制**——
        //   CSS 2.1 附录 E：`position:sticky` 是 **positioned 元素**，应在**在流内容之后**绘制
        //   （浏览器如此）；本宿主此前按**树序**画 ⇒ sticky 条声明在内容之前，吸附后被内容（白卡片）盖住
        //   （现象：滚动 400px 时可见、1500px 后整条消失——机器像素扫描抓出）。
        //   ★为什么在**宿主绘制序**修而不是构建期重排：sticky **参与流布局**（占位），
        //     构建期重排节点数组会改布局（#658 的 reorderNodesByZ 只动 absolute/fixed——它们脱离流）。
        //     cmds 顺序**纯绘制序**（rects 已由内核算好）⇒ 分区不影响任何几何。
        // ★★★用户实测修复（2026-10-08 · 两处根因）：
        //   ① 「蓝条**没有文字**」——此前把 sticky **锚点**单独挪到相位 2，而锚点的**子文字留在相位 1**
        //      ⇒ 相位 1 先画文字、相位 2 再画条背景 ⇒ **条把文字盖住**。⇒ 必须按**整棵子树**分区
        //      （锚点 + 全部子孙都在相位 2，树序不变 ⇒ 条先、文字后，文字可见）。
        //   ② 吸附位移也必须施加到**整棵子树**（条吸顶、文字跟随）——由 `ProteusHostView.stickyAnchorOf`
        //      在绘制侧统一处理（对子树每个 cmd 施加同一 delta）。
        //   语义同 CSS 2.1 附录 E：sticky 是 positioned 元素、整套子树绘制在在流内容之后。
        //   先算「sticky 子树 id 集」（含锚点自身）——用于分区。
        java.util.Set<Integer> stickySubtree = computeStickySubtree();
        for (int i = 0; i < specs.size(); i++) {
            JSONObject spec = specs.get(i);
            if (stickySubtree.contains(spec.optInt("id", -1))) continue; // 相位 2 留到第二遍（整棵子树）
            int id = spec.getInt("id");
            JSONObject r = rects.optJSONObject(String.valueOf(id));
            if (r == null) continue; // 无盒（display:none）——不产生指令（本仓实测的语义）
            cmdIndexById.put(id, cmds.size());
            cmds.add(mkCmd(spec, r));
            cmdIdsOf.add(id);
        }
        // ★★★批 A（决策 #653）：收集 position:fixed 节点 → 视图绘制时反向补偿内容滚动（钉在视口）
        fixedIdsOf.clear();
        stickyTopsOf.clear();
        for (int i = 0; i < specs.size(); i++) {
            JSONObject sp = specs.get(i);
            String pos = sp.optString("position", "");
            if ("fixed".equals(pos)) { int fid = sp.optInt("id", -1); if (fid >= 0) fixedIdsOf.add(fid); }
            else if ("sticky".equals(pos)) { int sid = sp.optInt("id", -1); if (sid >= 0) stickyTopsOf.put(sid, (float) sp.optDouble("top", 0)); }
        }
        // 第二遍：sticky **整棵子树**（相位 2——绘制在全部在流内容之上；条先、其子文字后 ⇒ 文字可见）
        for (int i = 0; i < specs.size(); i++) {
            JSONObject spec = specs.get(i);
            if (!stickySubtree.contains(spec.optInt("id", -1))) continue;
            int id = spec.getInt("id");
            JSONObject r = rects.optJSONObject(String.valueOf(id));
            if (r == null) continue;
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
        // ★★★overflow-x 项（2026-10-06）：变化集也带 clip（内核两通道同源）⇒ 裁剪表同批刷新
        applyClipRects(changed);
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
        view.setFixedNodes(fixedIdsOf);   // ★★★批 A：fixed 节点集（滚动反向补偿）
        view.setStickyTops(stickyTopsOf); // ★★★批 A③：sticky 节点阈值（滚动吸附）
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
