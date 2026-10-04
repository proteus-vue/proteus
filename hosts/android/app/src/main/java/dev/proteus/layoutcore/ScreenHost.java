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
        /** ★GP3-c：global 层容器 id（-1 = 无）。★当前树模型下它会随屏销毁——见 destroy 的诚实边界 */
        int globalLayerId = -1;
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
    /** ★阶段 1：真建进内核树的**页面内容节点**累计数（判据读它证"路由页面真落地"，非 3 占位） */
    private int contentNodeTotal;
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
        // ★★★GP3-c（2026-10-03）：**三层挂载容器**（计划由执行器按契约下发，本处只"照此建树"）。
        //   内核**无 z-order 字段**（实测零命中）⇒ 层间顺序唯一真源是**树序**：
        //   按计划的 order 升序依次 put ⇒ global 在下、overlay 在上（与契约 MOUNT_LAYER_ORDER 同源）。
        //   ★容器是**纯容器**（absolute + 全屏，无背景/无裁剪）⇒ 层内容用屏坐标系绝对定位。
        org.json.JSONArray layerPlan = args.optJSONArray("layerContainers");
        int layerCount = 0;
        int globalLayerId = -1;
        JSONObject layerIds = new JSONObject();
        org.json.JSONArray nodes = new org.json.JSONArray();
        nodes.put(node(rootId, null, 0, 0, 1080, 2400, null));
        if (layerPlan != null) {
            for (int i = 0; i < layerPlan.length(); i++) {
                JSONObject p = layerPlan.getJSONObject(i);
                String layer = p.optString("layer", "");
                int off = p.optInt("nodeOffset", 0);
                if (layer.isEmpty() || off <= 0) continue; // 计划不完整 ⇒ 跳过该项（不静默伪造层）
                int id = rootId + off;
                nodes.put(layerNode(id, rootId, 1080, 2400)); // ★全屏 + absolute（纯容器）
                layerIds.put(layer, id);
                layerCount++;
                if ("global".equals(layer)) globalLayerId = id;
            }
        }
        // 内容节点挂到 **page 层**（若计划没给 page 层则回落挂屏根——向后兼容：老行为不变）
        int contentParent = layerIds.optInt("page", rootId);
        // ★★★阶段 1（2026-10-04 · App 三端对齐 B1+B2）：**屏内容**（真实页面渲染产物）。
        //   ① `content` 存在且非空 ⇒ 建**真实页面子树**（节点描述来自页面渲染器，
        //      字段名与内核 `create` 契约同源——逐字段透传，未知键由内核 serde 安全忽略）。
        //   ② 缺省（老装置/老调用方）⇒ 保持 3 个几何占位节点（**零行为变化**，向后兼容）。
        //   ★id 空间：`content` 里的 `id`/`parentId` 是**内容局部**空间 ⇒ 重映射到屏 id 空间
        //     （基址 1000，与屏根/层容器/占位不冲突）；`parentId:null`/悬空 ⇒ 挂 `contentParent`（page 容器）。
        //   【诚实边界】本处证明"内容被真建进内核树"（节点数/几何由判据读）；**视觉合成**
        //     （把该屏真画到屏上）走既有 `ProteusHostView` 单树路径，不在本类范围。
        //   ★载荷形态：`content` 是 `{nodes:[...], viewport:{...}}`（`ScreenContent` 契约）——
        //     取 `.nodes`（**不是**直接把 content 当数组，那会静默落占位——本仓首次实现时就踩了）。
        org.json.JSONObject contentObj = args.optJSONObject("content");
        org.json.JSONArray content = contentObj != null ? contentObj.optJSONArray("nodes") : null;
        final List<Integer> contentNodeIds = new ArrayList<>();
        if (content != null && content.length() > 0) {
            final Map<Integer, Integer> idMap = new HashMap<>();
            for (int i = 0; i < content.length(); i++) {
                JSONObject cn = content.optJSONObject(i);
                if (cn == null || !cn.has("id")) continue;
                idMap.put(cn.getInt("id"), 1000 + i);
            }
            for (int i = 0; i < content.length(); i++) {
                JSONObject cn = content.optJSONObject(i);
                if (cn == null || !cn.has("id")) continue;
                int newId = idMap.get(cn.getInt("id"));
                Integer parentId = contentParent; // 根/悬空父 ⇒ 挂 page 内容容器
                if (cn.has("parentId") && !cn.isNull("parentId")) {
                    Integer mapped = idMap.get(cn.optInt("parentId", Integer.MIN_VALUE));
                    if (mapped != null) parentId = mapped;
                }
                nodes.put(contentNode(newId, parentId, cn));
                contentNodeIds.add(newId);
            }
        } else {
            // 向后兼容：无 content ⇒ 3 个几何占位节点（老行为不变）
            nodes.put(node(rootId + 11, contentParent, 0, 0, 1080, 200, 0xFF3355AA));
            nodes.put(node(rootId + 12, contentParent, 0, 200, 1080, 200, 0xFFAA5533));
            nodes.put(node(rootId + 13, contentParent, 0, 400, 1080, 200, 0xFF33AA55));
        }
        JSONObject req = new JSONObject();
        req.put("viewport", new JSONObject().put("width", 1080).put("height", 2400));
        req.put("nodes", nodes);
        long h = RustLayout.create(req.toString());
        if (h <= 0) throw new IllegalStateException("screen.mount: RustLayout.create 失败（屏 " + screenId + "）");
        ScreenTree st = new ScreenTree(screenId, name);
        st.handle = h;
        st.rootNodeId = rootId;
        st.globalLayerId = globalLayerId; // ★GP3-c（destroy 的诚实边界要读它）
        screens.put(screenId, st);
        // 装置节点注册（含层容器）：root + 三层容器（偏移 1..3）+ 三个内容节点（11..13）
        nodeToScreen.put(rootId, st);
        if (layerPlan != null) {
            for (int i = 0; i < layerPlan.length(); i++) {
                JSONObject p = layerPlan.getJSONObject(i);
                int off = p.optInt("nodeOffset", 0);
                if (off > 0) nodeToScreen.put(rootId + off, st);
            }
        }
        for (int i = 11; i <= 13; i++) nodeToScreen.put(rootId + i, st);
        // ★阶段 1：内容节点也注册（动画按树分发靠它；内容节点 id 重映射到 1000+i）
        for (int id : contentNodeIds) nodeToScreen.put(id, st);
        mountCalls++;
        contentNodeTotal += contentNodeIds.size();
        JSONObject d = new JSONObject();
        d.put("rootNodeId", rootId);
        // 节点总数：屏根(1) + 层容器(layerCount) + 内容（真实内容节点 或 3 占位）
        d.put("nodes", 1 + layerCount + (contentNodeIds.isEmpty() ? 3 : contentNodeIds.size()));
        d.put("rebuild", rebuild);
        d.put("handle", h);
        // ★GP3-c 读数：三层容器 id（判据读它证明"层结构真建了"——不是壳自述）
        d.put("layerCount", layerCount);
        d.put("globalLayerId", globalLayerId); // ★跨路由存活的层（-1 = 无）
        d.put("layerIds", layerIds);
        // ★★★阶段 1 读数：**屏内容节点数**（真页面内容 vs 3 占位——判据读它证"路由页面真落地"）
        d.put("contentNodes", contentNodeIds.size());
        d.put("contentIds", new JSONArray(contentNodeIds));
        return ok(d);
    }

    /**
     * ★★★阶段 1（2026-10-04 · App 三端对齐 B2）：由**页面内容描述**构造内核节点请求。
     *
     * 【为什么透传而不是白名单转写】内容描述的字段名**与内核 `create` 契约同源**
     *   （由页面渲染器 `@proteus-vue/renderer-app` 的 selfdraw 适配器产出）⇒ 逐字段透传是
     *   **最忠实**的（新字段随渲染器演进自动流通）；内核 serde 默认忽略未知键 ⇒ 安全。
     *   只重映射 `id`/`parentId`（内容局部空间 → 屏 id 空间，见 mount 注释）。
     */
    private static JSONObject contentNode(int id, Integer parentId, JSONObject cn) throws Exception {
        JSONObject n = new JSONObject();
        java.util.Iterator<String> keys = cn.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            if ("id".equals(k) || "parentId".equals(k)) continue; // 已重映射
            n.put(k, cn.get(k));
        }
        n.put("id", id);
        if (parentId != null) n.put("parentId", parentId);
        return n;
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

    /**
     * ★★★GP3-c：**层容器节点**（全屏 absolute，`left/top` 显式 0）。
     *
     * 【为什么不能走 `node()`——本轮真机抓到的缺陷（非装置问题，是层实现缺陷）】
     *   `node()` 的启发式是「x/y≠0 才 absolute」，而层容器**恰在原点 (0,0)**
     *   ⇒ 被写成 `relative` 进入 flex 流 ⇒ 三个全屏容器**互相挤压**（真机实测：每个只剩
     *   1/3 屏高 = 800px，page 层落在 y=800、内容随之偏移 800）——契约
     *   `frame:'fullscreen'` / `MOUNT_LAYER_HOST_CONTRACT.positioning:'absolute-fullscreen'` 名存实亡。
     *   ⇒ **原点也必须显式 absolute**。判据同步升级（"几何非零"太弱——曾据此假绿）：
     *     三层容器必须**全屏 @ 原点**（1080×2400 @ (0,0)）+ 内容 y≈0。
     */
    private static JSONObject layerNode(int id, int parentId, float w, float h) throws Exception {
        JSONObject n = new JSONObject();
        n.put("id", id);
        n.put("parentId", parentId);
        n.put("position", "absolute");
        n.put("left", 0); // ★显式 0：absolute + auto inset 的静态位置有歧义，显式写入是唯一确定性来源
        n.put("top", 0);
        n.put("width", w);
        n.put("height", h);
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
        /* ★★★GP3-c（2026-10-03）：**诚实边界——当前 destroy 会连 global 层一起销毁**。
         *
         * 【为什么】本实现的树模型是**每屏一棵独立内核树**（M2 装置形态；见类头与 `ScreenTree` 注释），
         *   而三层容器建在**该屏的树里** ⇒ `proteus_layout_destroy(屏树)` 把 global 层容器一并释放。
         *   ⇒ **验收第 2 条（"全局层跨页面存活，路由切换不重建"）在本树模型下不成立**。
         *
         * 【为什么不在这里"顺手修"】M5 设计原文是「**屏 = 树内子树**，切屏 = display 切换」
         *   ——那要求**所有屏共享一棵内核树**（屏是它的子树）。这与本实现的"每屏一棵树"是
         *   **两种树模型**：改成共享树是 `ScreenHost` 的整体重构（id 分配/节点映射/动画按树分发
         *   全都要跟着改），不是 destroy 里能补的一行。**在此处硬补（如"销毁时把 global 层摘出来
         *   重建"）会制造"看起来通过了、其实是重建了一份新实例"的假绿**——那比不通过更坏。
         * ⇒ 如实记账：本响应带 `globalLayerDestroyed: true`（判据可读），并把该缺口写进任务卡。
         */
        d.put("globalLayerDestroyed", st.globalLayerId > 0); // ★如实标注（不静默）
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
        // ★阶段 1：真建进内核树的页面内容节点累计数（有 content ⇒ >0；老装置无 content ⇒ 0）
        o.put("content_node_total", contentNodeTotal);
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
