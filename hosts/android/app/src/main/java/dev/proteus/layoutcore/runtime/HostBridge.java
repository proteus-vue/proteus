package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HostBridge.java
// ★★关注点分层（见 hosts/README-LAYERS.md）：**JNI 宿主桥**（`proteusHost` 对象）——项目无关。
//
// 【它做什么】作为 QuickJS 宿主回调对象（`QuickJsEngine.evalWithHost(source, host)`），
//   把 JS 侧 `proteusHost.invoke(method, args)` 的调用转给能力层 / `screen.*` 执行器。
//
// 【为什么独立成类（2026-10-07 分层重构）】此前是 `MainActivity`（dev 装置）的**嵌套类**，
//   而 shell（`SuperappActivity`）与 dev（`MainActivity`）都要用它 ⇒ shell 反向依赖 dev。
//   而「宿主桥」本质是**引擎/运行时的一部分**（对应 iOS 侧的 JSExport 桥）⇒ 归 runtime。


public final class HostBridge {
    /**
     * ★★App 端原生能力通道（真实实现）：转调 {@link HostCapabilities}。
     * 未实现的方法由 HostCapabilities 抛 UnsupportedOperationException ⇒ JNI 转成 JS 异常
     * ⇒ 桥识别 missing ⇒ `*.unsupported`（诚实分档，不是"静默失败"）。
     */
    private final HostCapabilities caps;
    /** ★★M5 执行器的宿主实现（screen.* 协议——真内核树 + 真动画） */
    private final ScreenHost screen;

    /** ★DevTools 桥调用日志端口（决策 #679）：JS→原生的 `proteusHost.invoke` 逐次上报
     *  （dev 面板"Network · 项目通道"）。★release 下为 null ⇒ 零开销、零行为变化。 */
    public interface InvokeLogger { void log(String method, boolean ok, long ms); }
    private InvokeLogger invokeLogger;
    public void setInvokeLogger(InvokeLogger l) { this.invokeLogger = l; }

    public HostBridge(HostCapabilities caps, ScreenHost screen) {
        this.caps = caps;
        this.screen = screen;
    }

    @SuppressWarnings("unused")
    public String invoke(String method, String argsJson) throws Exception {
        long t0 = System.nanoTime();
        boolean ok = true;
        try {
            // ★screen.* 归 M5 执行器（真内核树操作 + 帧循环动画）；其余归能力层
            if (method != null && method.startsWith("screen.")) {
                org.json.JSONObject a = (argsJson == null || argsJson.isEmpty() || "null".equals(argsJson.trim()))
                        ? new org.json.JSONObject() : new org.json.JSONObject(argsJson);
                return screen.invoke(method, a);
            }
            return caps.invoke(method, argsJson);
        } catch (Throwable t) {
            ok = false;
            throw t;
        } finally {
            if (invokeLogger != null) { try { invokeLogger.log(method, ok, (System.nanoTime() - t0) / 1_000_000); } catch (Throwable ignored) { } }
        }
    }

    /**
     * ★★★**二进制线格式的能力通道**（S2「去 JSON」· 决策 #903）——与 {@link #invoke} **并列**的第二条腿。
     *
     * 【为什么（用户 2026-10-13 指令）】「跨语言数据通道不要用 JSON 字符串，性能损耗太大，
     *   走纯二进制方向」。入参 / 出参都是 `PINV` / `PRSP` **帧字节**（见 {@link InvokeWire}）——
     *   HTTP 响应体原样当 `byte[]` 搬，不再每字节膨胀 3~4× + 两次 UTF-8 + 一次 `JSON.parse`。
     *
     * 【为什么只做一层转发（真源在能力层）】帧的**解码 / 分发 / 编码**全在 {@link HostCapabilities#invokeBytes}
     *   —— 本类与 {@link SuperappRuntimeHost} 都只是"宿主桥"，各自持有一个 caps ⇒ 两边各写一份实现
     *   就是本仓纪律 #22 的"第 N 份手写副本"（既有 `invoke` 已按此原则转发）。
     *
     * ★由 JNI 条件注入驱动：Java 侧**存在**本方法 ⇒ `quickjs_jni.c` 才把 `proteusHost.invokeBytes`
     *   暴露给 JS（否则 JS 侧探测 undefined ⇒ 回退 JSON 腿，降级不静默）。
     */
    @SuppressWarnings("unused")
    public byte[] invokeBytes(byte[] frame) throws Exception {
        long t0 = System.nanoTime();
        boolean ok = true;
        try {
            return caps.invokeBytes(frame);
        } catch (Throwable t) {
            ok = false;
            throw t;
        } finally {
            // ★记账只在装了日志端口时做（release 下 invokeLogger == null ⇒ **零解析、零开销**）；
            //   只读方法名而不全帧解码——见 `InvokeWire.peekMethod` 的说明。
            if (invokeLogger != null) {
                try { invokeLogger.log(InvokeWire.peekMethod(frame), ok, (System.nanoTime() - t0) / 1_000_000); } catch (Throwable ignored) { }
            }
        }
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
        // 场景不依赖 post（渲染链路的 post 在 js-batch/js-render）；保留以满足 JNI 主入口探测
    }
}
