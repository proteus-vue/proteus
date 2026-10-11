package dev.proteus.layoutcore;
// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/SuperappRuntimeHost.java
// ★★★B1（宿主关注点分离）：**App 壳统一运行期**的宿主桥（`proteusHost`）——项目无关。
//
// 【它做什么】作为 QuickJS 宿主回调对象（`QuickJsEngine.evalWithHost(bundle, this)`），把 JS 侧
//   运行期（`@proteus-vue/render-backend` 的 `createSuperappRuntime`）需要的**四个平台原语**
//   暴露给 JS：`mount` / `applyOps` / `readRects` / `onGesture`（+ 能力 `invoke`）。
//
// 【与 HostBridge 的关系（★关注点分离的落点）】`HostBridge` 只服务"屏内容通路"（`screen.*` 走
//   `ScreenHost` 的真内核树）。**统一运行期**不用 `screen.*`——它直接：
//     mount（把**运行期实例化**的节点交 VaporRenderHost 上屏）→ 手势（VaporRenderHost 命中）→
//     JS 派发 → **applyOps**（二进制指令增量）。⇒ 本类把这些原语转给 `VaporRenderHost`。
//   ⇒ 交互/响应式/导航**全在共享 JS 层**（三端同一份 runtime bundle），各端宿主只提供原语。
//
// 【为什么单列（分层）】「运行期宿主桥」是**引擎/运行期的一部分**（与 iOS JSExport 桥、鸿蒙 JSVM 桥同族），
//   归 runtime；不绑任何项目身份 ⇒ 换 App 不用改（见 hosts/README-LAYERS.md 判断标准）。

import org.json.JSONObject;

public final class SuperappRuntimeHost {
    private final VaporRenderHost draw;
    private final HostBridge caps;

    public SuperappRuntimeHost(VaporRenderHost draw, HostBridge caps) {
        this.draw = draw;
        this.caps = caps;
        // ★把 VaporRenderHost 的命中链转给 JS：走 **native 反向通道**（`QuickJsEngine.dispatchGesture`
        //   → `nativeDispatchGesture` → 调 JS 注册的全局回调）——**不是**嵌套 `eval`（那会重入 QuickJS）。
        //   回调名由 JS 侧 `proteusHost.onGesture(cbName)` 注册（native 层 `js_host_on_gesture` 截获）。
        draw.setGestureSink((type, targetId, chain) -> QuickJsEngine.dispatchGesture(type, targetId, chain));
    }

    /* ── 运行期四原语（JS `proteusHost.*`）── */

    /**
     * 建树 + 上屏（运行期实例化后的 `{viewport,nodes}`）。
     *   ★★★**每屏挂载后自拉泵频率**（本批 · 决策 #796「能力归 runtime」）：此前该调用写在**壳**里
     *   （`AppActivity.renderCurrent` 尾部 `lastRuntimeHost.pullPumps()`）——同一能力多消费者逐条接线，
     *   换一个壳就漏接（实测：框架参考壳 `SuperappActivity` 从未接 ⇒ 泵在框架壳上从不跑）。
     *   现在由 runtime 在 `mount`（= 每屏挂载的唯一入口）后**自发**补齐 ⇒ **任何 Android 壳零接线受益**。
     */
    @SuppressWarnings("unused")
    public String mount(String treeJson) {
        String r = draw.mount(treeJson);
        pullPumpsDeferred();
        return r;
    }

    /**
     * ★★把 `pullPumps` 排到**下一 UI message**（`view.post`）——【为什么不能栈内直调】
     *   `mount` 由 JS→native 调用进来（此刻 QuickJS 正在 eval 栈上），栈内再 `QuickJsEngine.eval`
     *   是**嵌套 eval 重入**（本仓在装置桥踩过：同上下文嵌套 eval 不可控）⇒ 只是排一帧，非盲等。
     */
    private void pullPumpsDeferred() {
        ProteusHostView v = draw.view();
        if (v == null) { return; }
        v.post(new Runnable() {
            @Override public void run() { pullPumps(); }
        });
    }

    /** 应用二进制指令流（`number[]` JSON）——增量更新。 */
    @SuppressWarnings("unused")
    public String applyOps(String opsJson) {
        return draw.applyOps(opsJson);
    }

    /**
     * ★★★**"跳变驱动动画"宿主动画入口**（本批）：`v-animate` / `<Transition>` 触发时，运行期
     *   把 `{anims:[{nodeId,kind,from,to,durMs,curve}]}` 交本方法 ⇒ 转发 `VaporRenderHost.animStart`
     *   （内核动画通道 + 帧循环）。★与装置桥的 `animStart` 同一条内核路径（零新增内核能力）。
     *   ★条件注入：JS 侧仅在**本方法存在**时把 `animStart` 挂给运行期（缺省 ⇒ 运行期如实记 note）。
     */
    @SuppressWarnings("unused")
    public String animStart(String animsJson) {
        return draw.animStart(animsJson);
    }

    /**
     * ★★★**推进一帧**（动画桥的**必需配套**，见 `quickjs_jni.c` 的注入判据——`animStart` 与
     *   `animTick` **同时存在**才把 `animStart` 暴露给 JS）。本类里 `animStart` 已由
     *   `VaporRenderHost.driveKernelAnimFrames()` 自驱帧循环，故本方法只作**契约占位**（转发内核 tick，
     *   供 JS 显式单步用）；★若不加它 ⇒ `GetMethodID("animTick")` 失败 ⇒ **`proteusHost.animStart`
     *   整体不注入** ⇒ 运行期探测为 undefined ⇒ 动画静默不播（本仓在装置桥踩过同一坑）。
     */
    @SuppressWarnings("unused")
    public String animTick(String dtMsJson) {
        return draw.animTick(dtMsJson);
    }

    /**
     * ★★★**每屏滚动进度记忆**（用户：「返回去的页面滚动进度应保留，前进的才重置」——系统 App 语义）。
     *   `scrollY/scrollX` 是**视图状态**（非树状态）；统一运行期用导航历史判断方向：
     *   返回（pop）⇒ `getScroll` 读旧值 → `setScroll` 恢复；前进（push）⇒ `setScroll(0)`。
     */
    @SuppressWarnings("unused")
    public double getScroll() {
        return draw.view() != null ? draw.view().getContentScrollY() : 0;
    }

    /** 设置滚动偏移（逻辑像素；前进=0 / 返回=该页上次的值）。 */
    @SuppressWarnings("unused")
    public void setScroll(double offset) {
        if (draw.view() != null) {
            draw.view().setContentScrollY((int) Math.max(0, offset));
            draw.view().setContentScrollX(0);
        }
    }

    /** ★判据用：滚动一步 `{dx,dy}`（物理像素）——与真手指同一条 `scrollDragBy` 链。 */
    @SuppressWarnings("unused")
    public String scrollBy(String argsJson) {
        try {
            org.json.JSONObject a = new org.json.JSONObject(argsJson);
            if (draw.view() == null) return "{}";
            return draw.view().scrollDragBy((float) a.optDouble("dx", 0), (float) a.optDouble("dy", 0));
        } catch (Exception e) { return "{\"error\":\"" + e.getMessage() + "\"}"; }
    }

    /** 读内核几何（诊断/探针）。 */
    @SuppressWarnings("unused")
    public String readRects() {
        return draw.readRects();
    }

    /** ★判据用：注入一次合成 tap（`{x,y}` **物理像素**）——走 hitTest → 手势 sink → JS（与真触摸同一条链）。 */
    @SuppressWarnings("unused")
    public String tapAt(String argsJson) {
        return draw.tapAt(argsJson);
    }

    /**
     * 注册手势反向回调名（JS 侧：`proteusHost.onGesture('__proteusRuntimeGesture')`）。
     * ★native 层 `js_host_on_gesture` 会**截获**本调用（`proteusHost.onGesture` 被绑到 native 函数），
     *   本 Java 方法实际**不会被调到**——保留仅为 JNI 方法表完整性（`g_host_methods` 探测）。
     */
    @SuppressWarnings("unused")
    public void onGesture(String cbName) {
        // 见上：native 层截获并保存回调名，宿主侧无需记账
    }

    /* ── 能力 / 引擎（与 HostBridge 同形——JS 侧 `proteusHost.invoke/memUsage/gc` 仍可用）── */

    @SuppressWarnings("unused")
    public String invoke(String method, String argsJson) throws Exception {
        return caps.invoke(method, argsJson);
    }

    @SuppressWarnings("unused")
    public String memUsage() {
        return QuickJsEngine.nativeMemoryUsage();
    }

    @SuppressWarnings("unused")
    public void gc() {
        QuickJsEngine.nativeRunGC();
    }

    @SuppressWarnings("unused")
    public void post(String json) {
        // 运行期走同步链（无 post 需求）；保留以兼容桥探测
    }

    /* ══════════ ★★★v-pump 周期驱动（通用原语，2026-10-10）══════════
     * 【做什么】页面用 `v-pump` 声明的**运行期数据源**（按 hz 跳变）——JS 侧 `superapp-runtime` 在
     *   挂载每屏后调本类 `setPumps(hzListJson)`（仅带频率，不带数据）；宿主据此起一个 **Choreographer
     *   帧回调**，按"最小间隔"到期才 `eval(__proteusSuperappPump({dtMs}))`（**不是每帧一次**——省跨界）。
     * 【为什么在宿主】App 端**不跑页面脚本**、也**无 JS 定时器** ⇒ 周期驱动由宿主提供（合法帧源，
     *   无 sleep/盲等）。JS 只负责"按 dt 产新值 → 写数据源 → 既有 slot-runtime 增量"。
     * 【诚实边界】泵驱动的更新走**数据通路（Vapor/applyOps）**；**手势路径仍零 JS**（不受影响）。 */
    private long pumpIntervalNs = 0L;      // 最小泵间隔（ns）；0 = 无泵（循环不跑）
    private long pumpLastNs = 0L;
    private boolean pumpLoopOn = false;

    /** JS 侧 `superapp-runtime` 挂载每屏后调：传该屏泵的频率列表（`[]`/空 ⇒ 停泵循环）。 */
    @SuppressWarnings("unused")
    public void setPumps(String hzListJson) {
        long minNs = 0L;
        try {
            org.json.JSONArray arr = new org.json.JSONArray(hzListJson == null ? "[]" : hzListJson);
            for (int i = 0; i < arr.length(); i++) {
                double hz = arr.optDouble(i, 0);
                if (hz > 0) { long ns = (long) (1_000_000_000.0 / hz); if (minNs == 0L || ns < minNs) minNs = ns; }
            }
        } catch (Throwable ignored) { minNs = 0L; }
        pumpIntervalNs = minNs;
        if (minNs > 0L) { pumpLastNs = 0L; startPumpLoop(); }
    }

    /** ★宿主每屏渲染后抽一次泵频率（调 JS `__proteusSuperappPumpHz()` ⇒ `setPumps`）——起/停周期驱动。 */
    @SuppressWarnings("unused")
    public void pullPumps() {
        try {
            QuickJsEngine.EvalResult r = QuickJsEngine.eval("__proteusSuperappPumpHz()");
            if (r != null && r.ok && r.value != null) setPumps(r.value);
            else setPumps("[]");
        } catch (Throwable ignored) { setPumps("[]"); }
    }

    private final android.view.Choreographer.FrameCallback pumpCb =
            new android.view.Choreographer.FrameCallback() {
        @Override public void doFrame(long frameTimeNanos) {
            if (!pumpLoopOn) return;
            if (pumpIntervalNs <= 0L) { pumpLoopOn = false; return; }
            final long now = System.nanoTime();
            long dt = pumpLastNs == 0L ? pumpIntervalNs : (now - pumpLastNs);
            if (dt < pumpIntervalNs) {   // 未到最小间隔 ⇒ 不解 JS（省跨界）
                android.view.Choreographer.getInstance().postFrameCallback(this);
                return;
            }
            pumpLastNs = now;
            try {
                final double dtMs = dt / 1e6;
                QuickJsEngine.EvalResult r = QuickJsEngine.eval("__proteusSuperappPump(" + org.json.JSONObject.quote("{\"dtMs\":" + dtMs + "}") + ")");
                // JS 回 `{ok,fired,pumps}`——pumps==0 ⇒ 当前屏无泵 ⇒ 自停（等下次 setPumps 再起）
                if (r != null && r.value != null && r.value.contains("\"pumps\":0")) { pumpLoopOn = false; return; }
            } catch (Throwable ignored) { /* 单帧失败不停循环；下次照常 */ }
            android.view.Choreographer.getInstance().postFrameCallback(this);
        }
    };

    private void startPumpLoop() {
        if (pumpLoopOn) return;
        pumpLoopOn = true;
        android.view.Choreographer.getInstance().postFrameCallback(pumpCb);
    }
}
