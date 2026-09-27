package dev.proteus.layoutcore;

/**
 * ★★Rust 排版核心的 JNI 门面（Android 侧）——对应 iOS 的 layout-core-device.swift。
 *
 * 【与 iOS 共用同一份核心】两端都通过各自的边界调同一个 Rust 核心：
 *   · iOS：C ABI（ffi.rs，Swift 用 @_silgen_name）
 *   · Android：JNI（jni.rs，本类用 external 方法）
 * 两边都只做「JSON 进 / JSON 出」，复杂度留在核心内。
 *
 * 【Rust 堆内存】返回的字符串由 Rust 分配 → 由 Rust 侧统一释放（见 jni.rs 的 into_java_string
 * 用 JNIEnv::new_string 生成为 Java String，故 Java 侧无需手动释放）。
 */
final class RustLayout {
    private RustLayout() {}

    private static boolean loaded = false;
    private static String loadError = null;

    static {
        try {
            System.loadLibrary("proteus_layout_core");
            loaded = true;
        } catch (Throwable t) {
            loadError = t.getClass().getSimpleName() + ": " + t.getMessage();
        }
    }

    private static native String nativeVersion();
    private static native String nativeConformance(String goldenJson);
    private static native String nativeBench(int nodeCount, int iterations);
    private static native String nativeRecycleBench(int rows, int frames);

    static boolean isLoaded() { return loaded; }
    static String getLoadError() { return loadError; }

    static String version() {
        return loaded ? nativeVersion() : "native 未加载：" + loadError;
    }

    /**
     * ★启动自检：把「JNI 签名漂移」变成可观测的失败。
     * external 声明与 Rust 侧 #[no_mangle] 名字不一致时，Android 在**首次调用**才抛
     * UnsatisfiedLinkError（不是加载时）→ 主动调一次，提前暴露。
     */
    static boolean checkSymbols() {
        if (!loaded) return false;
        try {
            return version() != null && !version().isEmpty();
        } catch (Throwable t) {
            loadError = "符号解析失败（JNI 声明与 Rust 侧不一致？）：" + t.getClass().getSimpleName() + ": " + t.getMessage();
            return false;
        }
    }

    static String conformance(String goldenJson) {
        return loaded ? nativeConformance(goldenJson) : "{\"ok\":false,\"error\":\"native 未加载：" + loadError + "\"}";
    }

    static String bench(int nodeCount, int iterations) {
        return loaded ? nativeBench(nodeCount, iterations) : "{\"ok\":false,\"error\":\"native 未加载：" + loadError + "\"}";
    }

    /** ★§9.3 长列表复用池跑批（4000 行 / 滚到底再回滚） */
    static String recycleBench(int rows, int frames) {
        return loaded ? nativeRecycleBench(rows, frames) : "{\"ok\":false,\"error\":\"native 未加载：" + loadError + "\"}";
    }
}
