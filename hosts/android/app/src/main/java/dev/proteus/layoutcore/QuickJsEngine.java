package dev.proteus.layoutcore;

/**
 * ★★S2：Android 的 JS 执行引擎门面（QuickJS）——对应 iOS 侧的 JavaScriptCore。
 *
 * 【为什么需要（本会话核实的结构事实）】Android 宿主此前**无 JS 引擎**
 *   （`hosts/android` = Java + Rust `.so` 直连 JNI，WebView 仅作 native-host 演示）
 *   ⇒ 卡 C1「可运行 Android 实现」与 C2「JSI 通路」**都受阻于此**。
 *   选型与实测见 `docs/proteus-android-js-engine-selection.md`（QuickJS：ES2025 · 0.94MB · 8MB 可跑）。
 *
 * 【接口形态（对齐本仓既有 JNI 门面：JSON 进 / JSON 出）】
 *   与 `RustLayout` 同款：native 方法只做「字符串进 → 字符串出」，复杂度留在 native 内。
 *
 * 【★诚实边界（本类不做什么）】
 *   ① **不做能力注入**：只提供 `eval` + 一个宿主回调桩（`proteusHost.post`）；
 *      `proteusNative`（createView/…）等具体能力形状由 **HA0（Host ABI）** 决定（尚未实现）
 *      —— 本类不预设它，避免造出与 HA0 不一致的第二套约定。
 *   ② **单运行时**：一个进程一个 JSRuntime（多实例/沙箱属插件场景，后续）。
 *   ③ **无 JIT**：QuickJS 是解释器（Android W^X 下 JIT 不可靠——选型文档 §3.2）。
 *   ④ **非线程安全**：所有 eval 必须在同一线程（当前=device 主线程；跨线程需加锁，后续）。
 */
final class QuickJsEngine {
    private QuickJsEngine() {}

    private static boolean loaded = false;
    private static String loadError = null;

    static {
        try {
            // ★构建产物：hosts/android/build/js-engine/libquickjs_jni.so
            //   （由 scripts/setup-android-js-engine.sh 生成并打进 APK 的 lib/ 目录）
            System.loadLibrary("quickjs_jni");
            loaded = true;
        } catch (Throwable t) {
            loadError = t.getClass().getSimpleName() + ": " + t.getMessage();
        }
    }

    static boolean isAvailable() { return loaded; }
    static String getLoadError() { return loadError; }

    /** 引擎标识（诊断：确认 .so 真的加载了 QuickJS） */
    static native String nativeVersion();

    /** 执行 JS（无宿主桩）。返回 JSON：`{"ok":true,"value":"…"}` 或 `{"ok":false,"error":"…"}` */
    static native String nativeEval(String source);

    /** 执行 JS 并注入 `proteusHost.post(json)`（→ `host.post` 回调） */
    static native String nativeEvalWithHost(String source);

    /** 注册宿主回调（须有 `public void post(String)` 方法）；传 null 解除 */
    static native void nativeSetHostCallback(Object host);

    /**
     * ★★G-39：**泵掉挂起 job**（QuickJS 的 await / Promise 续体队列）。
     *
     * 为什么要有它（本轮取证发现的实缺）：此前 eval 完从不泵 job ⇒ 任何 `await`/`.then()`
     * 的 JS 代码在设备上**半执行**（同步段跑了、续体静默丢失）。G-39「事件循环由运行时唯一拥有」
     * 在 QuickJS 宿主上的落点 = 本入口（只有宿主壳能推进 job 队列）。
     *
     * @return 本次泵执行的任务数；未初始化返回 -1
     */
    static native int nativeRunPendingJobs();

    /** 是否仍有挂起 job（诊断：await 未完成 = 还有 pending） */
    static native boolean nativeHasPendingJobs();

    /**
     * ★★G-39/G-43：**引擎内存读数**（真实 JS 堆，不是宿主 PSS 估算）。
     * 返回 JSON：`{ok, malloc_size, memory_used_size, malloc_count, obj_count, str_size, …}`。
     */
    static native String nativeMemoryUsage();

    /** ★触发 GC（返回 0 成功）——`JS_RunGC` 后内存读数应下降（GC 有效性的机器证据） */
    static native int nativeRunGC();

    // ── Java 侧友好封装（与 native 返回的 JSON 解耦：调用方拿布尔 + 字符串） ──

    /** 执行结果（不解析 JSON 的轻量视图——调用方多数只关心"成了没 + 值/错误"） */
    static final class EvalResult {
        final boolean ok;
        final String value;
        final String error;
        final String raw;

        EvalResult(boolean ok, String value, String error, String raw) {
            this.ok = ok;
            this.value = value;
            this.error = error;
            this.raw = raw;
        }

        @Override public String toString() {
            return ok ? ("ok=" + value) : ("error=" + error);
        }
    }

    /** 执行 JS 并解析出结果（★最小 JSON 解析：只取 value/error 两个字段，不引第三方） */
    static EvalResult eval(String source) {
        if (!loaded) return new EvalResult(false, null, "引擎未加载：" + loadError, "{}");
        String raw = nativeEval(source);
        return parse(raw);
    }

    /** 同上，但注入宿主桩 */
    /**
     * ★★★**分发手势到 JS**（反向通道：Java → JS；2026-10-01 交互闭环）。
     *
     * @return JS 回调的返回串（宿主记账/判据用）；未注册或异常 ⇒ `{"ok":false,…}`
     * ★**必须在主线程调用**（QuickJS 非线程安全——宿主从 GestureListener 的同一线程调）。
     */
    static String dispatchGesture(String type, int nodeId) {
        if (!loaded) return "{\"ok\":false,\"reason\":\"引擎未加载\"}";
        String out = nativeDispatchGesture(type, nodeId);
        return out != null ? out : "{\"ok\":false,\"reason\":\"native 返回 null\"}";
    }

    static native String nativeDispatchGesture(String type, int nodeId);

    static EvalResult evalWithHost(String source, Object host) {
        if (!loaded) return new EvalResult(false, null, "引擎未加载：" + loadError, "{}");
        nativeSetHostCallback(host);
        String raw = nativeEvalWithHost(source);
        return parse(raw);
    }

    /**
     * 最小 JSON 解析（只取 `ok` / `value` / `error` 三个字段）。
     *
     * ★为什么不引 JSON 库：本类在 `MainActivity` 里已有 `org.json` 可用，
     *   但门面保持**零依赖**便于单测（JVM 侧无 android.jar 时也能跑解析逻辑）。
     */
    static EvalResult parse(String raw) {
        if (raw == null) return new EvalResult(false, null, "native 返回 null", "{}");
        boolean ok = raw.contains("\"ok\":true");
        String value = extract(raw, "value");
        String error = extract(raw, "error");
        return new EvalResult(ok, value, error, raw);
    }

    /** 取 `"key":"<转义后的串>"` 的值（反转义 `\"` `\\` `\n` `\r` `\t`） */
    private static String extract(String raw, String key) {
        String needle = "\"" + key + "\":\"";
        int i = raw.indexOf(needle);
        if (i < 0) return null;
        int p = i + needle.length();
        StringBuilder sb = new StringBuilder();
        while (p < raw.length()) {
            char c = raw.charAt(p);
            if (c == '\\' && p + 1 < raw.length()) {
                char n = raw.charAt(++p);
                switch (n) {
                    case 'n': sb.append('\n'); break;
                    case 'r': sb.append('\r'); break;
                    case 't': sb.append('\t'); break;
                    case '"': sb.append('"'); break;
                    case '\\': sb.append('\\'); break;
                    case 'u':
                        if (p + 4 < raw.length()) {
                            try {
                                sb.append((char) Integer.parseInt(raw.substring(p + 1, p + 5), 16));
                                p += 4;
                            } catch (NumberFormatException e) { sb.append(n); }
                        }
                        break;
                    default: sb.append(n);
                }
            } else if (c == '"') {
                break;
            } else {
                sb.append(c);
            }
            p++;
        }
        return sb.toString();
    }
}
