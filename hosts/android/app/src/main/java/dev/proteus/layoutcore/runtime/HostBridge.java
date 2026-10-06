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

    public HostBridge(HostCapabilities caps, ScreenHost screen) {
        this.caps = caps;
        this.screen = screen;
    }

    @SuppressWarnings("unused")
    public String invoke(String method, String argsJson) throws Exception {
        // ★screen.* 归 M5 执行器（真内核树操作 + 帧循环动画）；其余归能力层
        if (method != null && method.startsWith("screen.")) {
            org.json.JSONObject a = (argsJson == null || argsJson.isEmpty() || "null".equals(argsJson.trim()))
                    ? new org.json.JSONObject() : new org.json.JSONObject(argsJson);
            return screen.invoke(method, a);
        }
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
        // 场景不依赖 post（渲染链路的 post 在 js-batch/js-render）；保留以满足 JNI 主入口探测
    }
}
