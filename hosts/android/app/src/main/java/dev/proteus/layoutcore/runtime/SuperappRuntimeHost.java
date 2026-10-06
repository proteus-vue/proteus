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

    /** 建树 + 上屏（运行期实例化后的 `{viewport,nodes}`）。 */
    @SuppressWarnings("unused")
    public String mount(String treeJson) {
        return draw.mount(treeJson);
    }

    /** 应用二进制指令流（`number[]` JSON）——增量更新。 */
    @SuppressWarnings("unused")
    public String applyOps(String opsJson) {
        return draw.applyOps(opsJson);
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
}
