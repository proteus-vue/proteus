package dev.proteus.layoutcore;

/**
 * ★★C82 App 端 WebAssembly：**wasm3 运行时的 Java 门面**（宿主侧 wasm 引擎）。
 *
 * 【为什么在宿主侧而不是 JS 引擎里（本轮取证结论）】
 *   App 端 JS 引擎 QuickJS **内建无 WebAssembly**——双证据：
 *   ① `.tools/quickjs/qjs -e "typeof WebAssembly"` → `undefined`；
 *   ② Bellard 版与 quickjs-ng 源码里 "WebAssembly" **零命中**。
 *   ⇒ 但**平台能做**：wasm 运行时属**宿主能力**（Host ABI 的用途正是"平台能力注入"），
 *     由宿主提供引擎 → 经 `proteusHost.invoke` 暴露给 JS（与 window/worker/preload 同模式）。
 *
 * 【为什么是 wasm3（与 QuickJS 选型同一判据）】纯解释器无 JIT ⇒ Android W^X 限制下可用；
 *   MIT + 纯 C ⇒ 与 QuickJS 同族（静态链进单个 .so）。
 *
 * 【能力面（诚实边界）】
 *   · ✅ 解析/校验/实例化 wasm 模块、调用导出函数（≤4 参数，标量返回值）；
 *   · ⛔ **不支持 WASI**（未链接 m3_api_wasi）——WASI 需 posix 文件系统桥，与移动端沙箱冲突（G-49）；
 *   · ⛔ 内存/表直接读写属后续批次（当前只覆盖"调用导出函数"这条主路径）；
 *   · ⛔ >53 位精度的 i64 经 JSON 会失真（需精确 i64 请走内存通道，后续批次）。
 */
final class WasmRuntime {
    private WasmRuntime() {}

    /** 最近一次失败原因（供上层读——与 quickjs_jni.c 的 last_error 同惯例，**不静默**） */
    @SuppressWarnings("unused")
    static String lastError = null;

    private static boolean loaded = false;
    private static String loadError = null;

    static {
        try {
            System.loadLibrary("proteus_wasm");
            loaded = true;
        } catch (Throwable t) {
            loadError = t.getClass().getSimpleName() + ": " + t.getMessage();
        }
    }

    static boolean isAvailable() {
        return loaded;
    }

    static String getLoadError() {
        return loadError;
    }

    /** 引擎标识（诊断：确认 .so 真链了 wasm3） */
    static native String nativeWasmVersion();

    /**
     * 实例化 wasm 模块。
     *
     * @param bytesJson  JSON 数组形态的字节（`[0,97,115,109,...]`——由 JS 侧从 ArrayBuffer 转）
     * @param limitsJson `{"stackBytes":N,"memoryBytes":N}`（可选；宿主治理——不受信模块的资源上限）
     * @return 句柄（>0）；失败返回 0 且 {@link #lastError} 有可读原因
     */
    static native long nativeWasmInstantiate(String bytesJson, String limitsJson);

    /**
     * 调用导出函数。
     *
     * @param callJson `{"fn":"name","args":[1,2]}`（≤4 参数；标量）
     * @return `{"ok":true,"result":N}` 或 `{"ok":false,"error":"…"}`
     */
    static native String nativeWasmCall(long handle, String callJson);

    /** 释放实例（幂等） */
    static native boolean nativeWasmRelease(long handle);
}
