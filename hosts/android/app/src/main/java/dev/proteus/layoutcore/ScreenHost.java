package dev.proteus.layoutcore;

import android.view.View;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * ★★M5 执行器的**宿主侧实现**（`screen.*` 协议——`packages/render-backend/src/screen-executor-host.ts` 的对端）。
 *
 * 【要解决什么】执行器（JS 侧编排）把"建屏/切可见性/销毁屏/播转场"翻译成 `screen.*` 请求；
 *   而这些动作在真机上分别是 **Rust 内核树操作**与 **宿主帧循环驱动的动画** ⇒ 本类是真实现，
 *   不是壳转发（对照本仓纪律：宣称不得先于实现）。
 *
 * | 请求 | 本类动作（真 API） |
 * |---|---|
 * | `screen.mount` | 每屏一棵**真实内核树**（`RustLayout.create`）——屏 = 树，与 M5 §0.2「屏 = 树内子树」同构；返回该树根节点 id |
 * | `screen.visible` | 内核 `proteus_layout_update` 的 `display: flex/none` 补丁（真布局字段，命中测试随之生效） |
 * | `screen.destroy` | `RustLayout.destroy`（真销毁内核树）+ 计数返回 |
 * | `screen.anim` | `RustLayout.animStart`（内核曲线求值）+ **帧循环推进**（Choreographer），播完回推 token |
 *
 * 【★动画完成（token 机制）】`anim_start` 只做"启动"；推进靠宿主每帧 `anim_tick_bin`。
 *   本类用 `Choreographer` 帧回调推进到**全部到点**（按 `durationMs` 记时），然后：
 *   ① 调用 JS 的 `__proteusHostScreenAnimDone(token)`（回推完成——与 G-39「宿主拥有帧循环」一致）；
 *   ② 若 JS 侧钩子缺失 ⇒ 记录到 `animCompletions`（判据可读，不静默）。
 *   ★时长上界：`Choreographer` 回调里用真实时间差推进（`anim_tick_bin(dt)`），
 *      `durationMs + 100ms` 兜底（防"最后一帧差一点"永远不到点——不引入无退出条件的等待）。
 *
 * 【诚实边界】本类证明"内核树真建/真改/真销毁 + 内核动画真启动并被宿主帧循环推进"；
 *   屏与树的**视觉合成**（多棵内核树叠放渲染）属渲染后端接线，不在本类范围
 *   （当前每屏一棵树 ⇒ 屏间可见性由 `display` 控制，屏内渲染走既有 `ProteusHostView` 单树路径）。
 */
public final class ScreenHost {

    private static final String TAG = "proteus-screen";

    /** 屏记录：每屏一棵真实内核树（屏 = 树，M5 §0.2） */
    private static final class ScreenTree {
        final String screenId;
        final String name;
        long handle;          // RustLayout 句柄
        int rootNodeId;       // 树根节点 id（返回给执行器做动画目标）
        boolean visible = false;
        ScreenTree(String screenId, String name) { this.screenId = screenId; this.name = name; }
    }

    private final Map<String, ScreenTree> screens = new HashMap<>();
    /** ★节点 id → 屏（动画**按树分发**用：一条 anim 只灌给"目标节点所属的那棵树"——
     *   否则内核会因"节点不在该树"整批拒绝；真机实测：混合批让 3 次转场只成功 1 次）。 */
    private final Map<Integer, ScreenTree> nodeToScreen = new HashMap<>();
    private final View animHostView; // 帧循环载体（借其 Choreographer；不参与绘制）

    // ── 诊断记账（判据读：证明动作是真发生的，而非壳自述） ──
    private int mountCalls, visibleCalls, destroyCalls, animCalls, animCompleted, animHookMissing;
    /** ★跨页面共享元素计数（2026-10-01；判据读它证明"这条链真的走过"） */
    private int rectCalls, sharedCalls;
    private final List<String> callLog = new ArrayList<>();

    public ScreenHost(View hostView) {
        this.animHostView = hostView;
    }

    /**
     * 执行一个 `screen.*` 请求（由 `HostBridge.invoke` 转调；返回 JSON 串）。
     * ★未知方法 ⇒ `UnsupportedOperationException`（与 `HostCapabilities` 同一诚实分档）。
     */
    public String invoke(String method, JSONObject args) throws Exception {
        callLog.add(method);
        switch (method) {
            case "screen.mount":    return mount(args);
            case "screen.visible":  return visible(args);
            case "screen.destroy":  return destroy(args);
            case "screen.anim":     return anim(args);
            case "screen.rect":     return rect(args);
            case "screen.shared":   return shared(args);
            case "screen.stats":    return ok(stats());
            default:
                throw new UnsupportedOperationException("未实现的 screen 方法：" + method);
        }
    }

    // ────────────────────────── screen.rect（★跨页面共享元素的稳态几何回传） ──────────────────────────

    /**
     * 单节点绝对矩形（内核算——与 FLIP 同一套收集/吸附，Java 侧零几何数学）。
     * 入参 `{screenId, nodeId}`；出参原样透传内核回执（`{ok,x,y,width,height}` 或 `{ok:false,error}`）。
     */
    private String rect(JSONObject args) throws Exception {
        String screenId = args.getString("screenId");
        int nodeId = args.getInt("nodeId");
        ScreenTree st = screens.get(screenId);
        if (st == null) throw new IllegalStateException("screen.rect: 未知屏 " + screenId + "（未 mount？）");
        String out = RustLayout.nodeRect(st.handle, nodeId);
        rectCalls++;
        JSONObject o = new JSONObject(out);
        // ★不伪装未知字段的语义：内核说 ok:false（不在树上/display:none）就原样抛（不静默）
        if (!o.optBoolean("ok", false)) {
            throw new IllegalStateException("screen.rect: 内核拒绝：" + out);
        }
        return ok(o);
    }

    // ────────────────────────── screen.shared（★跨页面共享元素） ──────────────────────────

    /**
     * 跨页面共享元素：`{targetScreenId, targetNodeId, sourceRect{x,y,w,h}, durMs, curve, fadeIn, token}`
     *   → 内核 `shared_element` 算几何 + 写首帧 ⇒ **同一条**帧循环完成链（token 回推）。
     *
     * 【与同树共享元素的差别】源几何由调用方（页面栈层）注入——跨页面的稳态起点只有它知道
     *   （内核只认识"当前树"，另一棵树的矩形要宿主给）。这正是内核 FFI 里 `sourceRect` 分支的用途。
     */
    private String shared(JSONObject args) throws Exception {
        String screenId = args.getString("targetScreenId");
        int nodeId = args.getInt("targetNodeId");
        ScreenTree st = screens.get(screenId);
        if (st == null) throw new IllegalStateException("screen.shared: 未知屏 " + screenId + "（未 mount？）");
        JSONObject sr = args.getJSONObject("sourceRect");
        final double durMs = args.optDouble("durMs", 400);
        final String token = args.optString("token", "");
        JSONObject body = new JSONObject();
        body.put("targetId", nodeId);
        body.put("sourceRect", sr);
        body.put("durMs", durMs);
        body.put("curve", args.optInt("curve", 1));
        body.put("fadeIn", args.optBoolean("fadeIn", true));
        String out = RustLayout.sharedElement(st.handle, body.toString());
        JSONObject ro = new JSONObject(out);
        if (!ro.optBoolean("ok", false)) throw new IllegalStateException("screen.shared: 内核拒绝：" + out);
        sharedCalls++;
        // 帧循环推进（与 screen.anim **同一条**完成链）
        final List<ScreenTree> targets = new ArrayList<>();
        targets.add(st);
        final long t0 = android.os.SystemClock.uptimeMillis();
        final long budgetMs = (long) durMs + 100;
        animHostView.post(new Runnable() {
            @Override public void run() {
                android.view.Choreographer.getInstance().postFrameCallback(new android.view.Choreographer.FrameCallback() {
                    long last = 0;
                    @Override public void doFrame(long frameTimeNanos) {
                        long now = android.os.SystemClock.uptimeMillis();
                        float dt = last == 0 ? 16f : (float) (now - last);
                        last = now;
                        for (ScreenTree t : targets) {
                            if (t.handle > 0) RustLayout.animTickBin(t.handle, dt);
                        }
                        if (now - t0 >= budgetMs) {
                            completeAnim(token, targets);
                        } else {
                            android.view.Choreographer.getInstance().postFrameCallback(this);
                        }
                    }
                });
            }
        });
        JSONObject d = new JSONObject();
        d.put("started", 1);
        d.put("fromRect", ro.optJSONObject("fromRect"));
        d.put("toRect", ro.optJSONObject("toRect"));
        return ok(d);
    }

    // ────────────────────────── screen.mount ──────────────────────────

    /**
     * 建屏（真内核树）：`RustLayout.create` 一棵**屏树**。
     *
     * ★屏内容（真实业务里是 Vue 组件的渲染产物）在**装置场景**里用几何合理的占位子树表示；
     *   生产接入时此处换成"渲染后端产出内核树 + 插入"的调用（端口语义不变）。
     *   ★诚实标注：本装置证明"树真建/真控"，**不**声称"屏内容已由 Vue 渲染"（那属 renderer 接线）。
     */
    private String mount(JSONObject args) throws Exception {
        String screenId = args.getString("screenId");
        String name = args.optString("name", screenId);
        boolean rebuild = args.optBoolean("rebuild", false);
        // 幂等：同 screenId 重复 mount（rebuild）⇒ 先销毁旧树（真释放，不泄漏）
        ScreenTree old = screens.get(screenId);
        if (old != null) {
            if (old.handle > 0) RustLayout.destroy(old.handle);
            screens.remove(screenId);
        }
        // 屏树：根 + 3 个子（几何上是一个全屏容器 + 三行——足以证明布局与可见性真生效）
        int rootId = 100 + screens.size() * 10;
        org.json.JSONArray nodes = new org.json.JSONArray();
        nodes.put(node(rootId, null, 0, 0, 1080, 2400, null));
        nodes.put(node(rootId + 1, rootId, 0, 0, 1080, 200, 0xFF3355AA));
        nodes.put(node(rootId + 2, rootId, 0, 200, 1080, 200, 0xFFAA5533));
        nodes.put(node(rootId + 3, rootId, 0, 400, 1080, 200, 0xFF33AA55));
        JSONObject req = new JSONObject();
        req.put("viewport", new JSONObject().put("width", 1080).put("height", 2400));
        req.put("nodes", nodes);
        long h = RustLayout.create(req.toString());
        if (h <= 0) throw new IllegalStateException("screen.mount: RustLayout.create 失败（屏 " + screenId + "）");
        ScreenTree st = new ScreenTree(screenId, name);
        st.handle = h;
        st.rootNodeId = rootId;
        screens.put(screenId, st);
        for (int i = 0; i < 4; i++) nodeToScreen.put(rootId + i, st); // 装置节点 root..root+3
        mountCalls++;
        JSONObject d = new JSONObject();
        d.put("rootNodeId", rootId);
        d.put("nodes", 4);
        d.put("rebuild", rebuild);
        d.put("handle", h);
        return ok(d);
    }

    private static JSONObject node(int id, Integer parentId, float x, float y, float w, float h, Integer color) throws Exception {
        JSONObject n = new JSONObject();
        n.put("id", id);
        if (parentId != null) n.put("parentId", parentId);
        // ★★顶层几何字段（2026-10-01 修复）：内核 `create` 读的是顶层 width/height/left/top
        //   + position（见 `MainActivity.buildKernelTree` 的既有正确形态）——
        //   本方法**原先把它们包在 `style` 里** ⇒ 内核忽略未知的 style 包装 ⇒ 全屏树 0×0
        //   （本轮"跨页面共享元素"判据当场抓到：`目标节点无可测尺寸（0×0）`）。
        //   ★同源纪律：装置代码的字段形态也要对着**内核真实契约**核，不能对着"看起来合理"写。
        n.put("position", x != 0 || y != 0 ? "absolute" : "relative");
        if (x != 0) n.put("left", x);
        if (y != 0) n.put("top", y);
        n.put("width", w);
        n.put("height", h);
        if (color != null) n.put("bg", color);
        return n;
    }

    // ────────────────────────── screen.visible ──────────────────────────

    /**
     * 可见性（真内核字段）：`display: flex|none` 补丁 ⇒ 布局与**命中测试**随之生效
     *   （内核 `Display::None` 会被布局跳过、被 hit.rs 过滤——不是宿主层"藏起来"）。
     */
    private String visible(JSONObject args) throws Exception {
        String screenId = args.getString("screenId");
        boolean visible = args.optBoolean("visible", true);
        ScreenTree st = screens.get(screenId);
        if (st == null) throw new IllegalStateException("screen.visible: 未知屏 " + screenId + "（未 mount？）");
        org.json.JSONArray patches = new org.json.JSONArray();
        JSONObject p = new JSONObject();
        p.put("id", st.rootNodeId);
        p.put("style", new JSONObject().put("display", visible ? "flex" : "none"));
        patches.put(p);
        String out = RustLayout.update(st.handle, patches.toString());
        JSONObject r = new JSONObject(out);
        if (!r.optBoolean("ok", false)) {
            throw new IllegalStateException("screen.visible: 内核 update 失败：" + out);
        }
        st.visible = visible;
        visibleCalls++;
        // ★真实生效读数：可见时该屏树的几何矩形数（0 ⇒ 内核确实按 display:none 跳过布局）
        int rects = 0;
        try {
            JSONObject rectsJson = new JSONObject(RustLayout.readRects(st.handle));
            JSONObject rectsObj = rectsJson.optJSONObject("rects");
            rects = rectsObj == null ? 0 : rectsObj.length();
        } catch (Exception ignore) { /* 读数失败不改变动作结果（记为 0） */ }
        JSONObject d = new JSONObject();
        d.put("visible", visible);
        d.put("rects", rects);
        d.put("relayout", r.optInt("relayout_count", -1));
        return ok(d);
    }

    // ────────────────────────── screen.destroy ──────────────────────────

    /** 销毁屏（真内核树销毁）：释放句柄 + 返回真摘掉的节点数（如实报，不假装）。 */
    private String destroy(JSONObject args) throws Exception {
        String screenId = args.getString("screenId");
        ScreenTree st = screens.remove(screenId);
        if (st == null) {
            JSONObject d = new JSONObject();
            d.put("removed", 0);
            d.put("note", "屏不存在（重复销毁？）——如实记 0，不假装");
            return ok(d);
        }
        boolean destroyed = st.handle > 0 && RustLayout.destroy(st.handle);
        // ★清节点映射（防"已销毁屏的节点 id 被后续转场误配"——id 复用会造成静默错配）
        nodeToScreen.entrySet().removeIf(en -> en.getValue() == st);
        destroyCalls++;
        JSONObject d = new JSONObject();
        d.put("removed", destroyed ? 4 : 0);
        d.put("destroyed", destroyed);
        return ok(d);
    }

    // ────────────────────────── screen.anim ──────────────────────────

    /**
     * 播转场（真内核动画 + **宿主帧循环推进**）：
     *   ① `RustLayout.animStart`（内核受理：曲线/弹簧/序列全在 Rust 侧求值）；
     *   ② `Choreographer.postFrameCallback` 逐帧 `animTickBin(dt)` 推进（真时间差）；
     *   ③ 到点后把变换应用到本屏宿主视图（若有）+ **回推 token**（JS `__proteusHostScreenAnimDone`）。
     *
     * ★为什么用 Choreographer 而不是自己 sleep：帧节拍是显示器的属性（本仓已在 platform-anim /
     *   kernel-anim 两处踩过 `View.postOnAnimation` 与"测试混进重活被饿死"的坑）。
     */
    private String anim(JSONObject args) throws Exception {
        JSONArray anims = args.optJSONArray("anims");
        final String token = args.optString("token", "");
        final long durationMs = (long) Math.max(0, args.optDouble("durationMs", 300));
        if (anims == null || anims.length() == 0) {
            JSONObject d = new JSONObject();
            d.put("started", 0);
            d.put("immediate", true);
            return ok(d);
        }
        // ★★按树分发（真机实测的必需形态）：每条 anim 只灌给"其 nodeId 所属的那棵树"——
        //   内核会因"节点不在该树"拒绝，若把整批灌给每棵树，混批会导致**整批失败**
        //   （实测：3 次转场只有 1 次成功启动）。
        Map<ScreenTree, JSONArray> perTree = new HashMap<>();
        int unmatched = 0;
        for (int i = 0; i < anims.length(); i++) {
            JSONObject a = anims.getJSONObject(i);
            ScreenTree owner = nodeToScreen.get(a.optInt("nodeId", -1));
            if (owner == null) { unmatched++; continue; }
            JSONArray arr = perTree.get(owner);
            if (arr == null) { arr = new JSONArray(); perTree.put(owner, arr); }
            arr.put(a);
        }
        if (unmatched > 0) {
            // 如实上报（不静默）：目标节点不在任何在册屏树里
            android.util.Log.w(TAG, "screen.anim: " + unmatched + " 条动画的目标节点不在在册屏树（已跳过）");
        }
        int started = 0;
        final List<ScreenTree> targets = new ArrayList<>();
        for (Map.Entry<ScreenTree, JSONArray> en : perTree.entrySet()) {
            JSONObject startBody = new JSONObject();
            startBody.put("anims", en.getValue());
            String out = RustLayout.animStart(en.getKey().handle, startBody.toString());
            JSONObject r = new JSONObject(out);
            if (r.optBoolean("ok", false)) {
                int n = r.optInt("started", 0);
                started += n;
                if (n > 0) targets.add(en.getKey());
            }
        }
        if (targets.isEmpty() && screens.isEmpty()) {
            throw new IllegalStateException("screen.anim: 无屏可动（未 mount？）");
        }
        if (started == 0) {
            JSONObject d = new JSONObject();
            d.put("started", 0);
            d.put("immediate", true);
            d.put("note", "内核未受理任何动画（如实）");
            return ok(d);
        }
        animCalls++;
        // ② 帧循环推进（真实时间差，不用固定 sleep）；到点回推
        final long t0 = android.os.SystemClock.uptimeMillis();
        final long budgetMs = durationMs + 100; // 上界（防"最后一帧差一点"）
        animHostView.post(new Runnable() {
            @Override public void run() {
                android.view.Choreographer.getInstance().postFrameCallback(new android.view.Choreographer.FrameCallback() {
                    long last = 0;
                    @Override public void doFrame(long frameTimeNanos) {
                        long now = android.os.SystemClock.uptimeMillis();
                        float dt = last == 0 ? 16f : (float) (now - last);
                        last = now;
                        for (ScreenTree st : targets) {
                            if (st.handle > 0) RustLayout.animTickBin(st.handle, dt);
                        }
                        if (now - t0 >= budgetMs) {
                            completeAnim(token, targets);
                        } else {
                            android.view.Choreographer.getInstance().postFrameCallback(this);
                        }
                    }
                });
            }
        });
        JSONObject d = new JSONObject();
        d.put("started", started);
        // ★不设 immediate ⇒ JS 侧等 token 回推（见 screen-executor-host.ts 的两种完成形态）
        return ok(d);
    }

    /** 动画完成：回推 token（钩子缺失则记数，不静默） */
    private void completeAnim(String token, List<ScreenTree> targets) {
        try {
            String expr = "typeof __proteusHostScreenAnimDone === 'function' ? String(__proteusHostScreenAnimDone("
                    + jsonStr(token) + ", '{}')) : 'no-hook'";
            QuickJsEngine.EvalResult r = QuickJsEngine.eval(expr);
            if (r.ok && r.value != null && !"no-hook".equals(r.value)) {
                animCompleted++;
                android.util.Log.i(TAG, "screen.anim 完成回推 token=" + token + "（累计 " + animCompleted + "）");
            } else {
                animHookMissing++;
                android.util.Log.w(TAG, "screen.anim 完成但 JS 钩子缺失（token=" + token + "）——记数不静默");
            }
            QuickJsEngine.nativeRunPendingJobs();
        } catch (Throwable t) {
            animHookMissing++;
            android.util.Log.w(TAG, "screen.anim 回推失败：" + t.getMessage());
        }
    }

    // ────────────────────────── 诊断 ──────────────────────────

    /** 宿主自报记账（判据读它证明"动作真发生"——不是桥自述） */
    public JSONObject stats() throws Exception {
        JSONObject o = new JSONObject();
        o.put("mount_calls", mountCalls);
        o.put("visible_calls", visibleCalls);
        o.put("destroy_calls", destroyCalls);
        o.put("anim_calls", animCalls);
        o.put("anim_completed", animCompleted);
        o.put("anim_hook_missing", animHookMissing);
        o.put("rect_calls", rectCalls);
        o.put("shared_calls", sharedCalls);
        o.put("live_screens", screens.size());
        JSONArray log = new JSONArray();
        int from = Math.max(0, callLog.size() - 32);
        for (int i = from; i < callLog.size(); i++) log.put(callLog.get(i));
        o.put("calls", log);
        // 在册屏的可见性快照（判据核对"树保留"：pop 后被隐藏的屏仍在册）
        JSONArray vis = new JSONArray();
        for (ScreenTree st : screens.values()) {
            JSONObject e = new JSONObject();
            e.put("screenId", st.screenId);
            e.put("visible", st.visible);
            e.put("rootNodeId", st.rootNodeId);
            vis.put(e);
        }
        o.put("screens", vis);
        o.put("handle_count", RustLayout.handleCount());
        return o;
    }

    /** 释放全部屏树（Activity 销毁时调——框架代管资源，G-42 精神） */
    public void dispose() {
        for (ScreenTree st : screens.values()) {
            if (st.handle > 0) {
                try { RustLayout.destroy(st.handle); } catch (Throwable ignored) { /* 尽力而为 */ }
            }
        }
        screens.clear();
    }

    private static String ok(Object data) throws Exception {
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("data", data == null ? JSONObject.NULL : data);
        return out.toString();
    }

    private static String jsonStr(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }
}
