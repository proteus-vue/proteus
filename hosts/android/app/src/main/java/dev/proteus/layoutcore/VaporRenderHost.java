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

            // ④ 几何 → 指令 → 上屏
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

            // 文本可能变了 ⇒ 需重度量（订阅更新里文本与宽度都可能动）
            double measureMs = remeasureChanged();
            long te = System.nanoTime();
            patchedCmdsFor(changed);
            double emitMs = (System.nanoTime() - te) / 1e6;

            out.put("ok", true);
            out.put("applied", lastApplied);
            out.put("changed", lastChangedNodes);
            out.put("relayout", uo.optInt("relayout", -1));
            out.put("layout_ms", round3(layoutMs));
            out.put("measure_ms", round3(measureMs));
            out.put("emit_cmds_ms", round3(emitMs));
            if (changed != null) out.put("rects", changed);
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

    /* ────────────────────────── 内部：度量 / 核心键 / 指令 ────────────────────────── */

    /** 几何相关键白名单（与 `JsRenderHost.LAYOUT_KEYS` 同源；绘制属性不进核心） */
    private static final java.util.Set<String> LAYOUT_KEYS = new java.util.HashSet<>(java.util.Arrays.asList(
            "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
            "margin", "padding", "flexDirection", "justifyContent", "alignItems", "alignSelf",
            "flexGrow", "flexShrink", "flexBasis", "gap", "display", "position", "top", "left",
            "widthRatio", "heightRatio", "overflow"));

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
        String t = spec.optString("text", null);
        if (t != null && !t.isEmpty()) {
            float fs = (float) spec.optDouble("fontSize", 14);
            String tc = spec.optString("color", null);
            int textColor = tc != null ? parseColor(tc) : 0xFFFFFFFF;
            return new ProteusHostView.Cmd(x, y, w, h, color, t, fs, textColor);
        }
        return new ProteusHostView.Cmd(x, y, w, h, color, null);
    }

    /** 全量：几何 → 指令（矩形 + 文本 + 底色） */
    private void emitAll() throws Exception {
        JSONObject rects = new JSONObject(RustLayout.readRects(handle)).getJSONObject("rects");
        cmds.clear();
        cmdIndexById.clear();
        for (int i = 0; i < specs.size(); i++) {
            JSONObject spec = specs.get(i);
            int id = spec.getInt("id");
            JSONObject r = rects.optJSONObject(String.valueOf(id));
            if (r == null) continue; // 无盒（display:none）——不产生指令（本仓实测的语义）
            cmdIndexById.put(id, cmds.size());
            cmds.add(mkCmd(spec, r));
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

    private void pushToView() {
        if (view == null) return;
        view.setCmds(cmds);
        view.invalidate();
    }

    private void ensureView() {
        if (view != null) return;
        view = new ProteusHostView(ctx);
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
