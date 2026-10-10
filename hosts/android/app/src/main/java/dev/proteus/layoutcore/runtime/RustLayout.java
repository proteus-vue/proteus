package dev.proteus.layoutcore;

/**
 * ★★Rust 排版核心的 JNI 门面（Android 侧）——对应 iOS 的 layout-core-device.swift。
 *
 * 【与 iOS 共用同一份核心】两端都通过各自的边界调同一个 Rust 核心：
 *   · iOS：内核 C ABI（`packages/layout-core-rust/src/ffi.rs`，Swift 用 @_silgen_name 直调）
 *   · Android：**平台绑定层**（`platform/android/proteus-jni/src/lib.rs`，本类用 native 方法）
 * 两边都只做「JSON 进 / JSON 出」，复杂度留在核心内。
 *
 * ★HA2（2026-09-30）：JNI 绑定原来是内核里的 `layout-core-rust/src/jni.rs`，已搬到
 *   `platform/android/proteus-jni/`（独立 crate，产 `libproteus_jni.so`）——
 *   这样**内核 crate 零平台分支**（Host ABI §2.6 硬性判据）。本类**不受迁移影响**
 *   （方法签名逐字未变，只有 `System.loadLibrary` 的名字跟着新产物走）。
 *
 * 【Rust 堆内存】返回的字符串由 Rust 分配 → 由 Rust 侧统一释放（平台绑定层的 `into_java_string`
 * 用 JNIEnv::new_string 生成为 Java String，故 Java 侧无需手动释放）。
 */
public final class RustLayout {
    private RustLayout() {}

    private static boolean loaded = false;
    private static String loadError = null;

    static {
        try {
            // ★HA2：加载的是**平台绑定层**的产物（它静态链接内核 ⇒ 一个 .so 里既有内核也有 JNI 符号）。
            //   名字与 `platform/android/proteus-jni/Cargo.toml` 的 `[lib] name` 一致；
            //   改名的理由：原 `proteus_layout_core` 语义上是"内核"，而实际被加载的是绑定层。
            System.loadLibrary("proteus_jni");
            loaded = true;
        } catch (Throwable t) {
            loadError = t.getClass().getSimpleName() + ": " + t.getMessage();
        }
    }

    private static native String nativeVersion();
    private static native String nativeConformance(String goldenJson);
    private static native String nativeBench(int nodeCount, int iterations);
    private static native String nativeRecycleBench(int rows, int frames);
    private static native long nativeCreate(String requestJson);
    private static native boolean nativeDestroy(long handle);
    private static native int nativeHandleCount();
    private static native String nativeReadRects(long handle);
    /** ★VC4-b：统一几何快照（VC3-a 格式——多端一致性校验的 App 端探针） */
    private static native String nativeGeometrySnapshot(long handle);
    /** ★单节点绝对矩形（跨页面共享元素的终点基准） */
    private static native String nativeNodeRect(long handle, int nodeId);
    private static native String nativeHitTest(long handle, float x, float y);
    /** ★增量更新（样式补丁 JSON）——此前宿主只能 destroy+create（整树重建） */
    private static native String nativeUpdate(long handle, String patchesJson);
    /* ★★列表复用池（§12.6）：核心给**决策**，Java 侧只执行**动作**（与 iOS 同一套核心逻辑） */
    private static native long nativeRecycleCreate(int itemCount, int leadingRows, int followingRows);
    private static native String nativeRecycleUpdate(long handle, int firstVisible, int lastVisible);
    private static native String nativeRecycleStats(long handle);
    private static native void nativeRecycleDestroy(long handle);
    /* ★结构变更 / 度量注入 / Vapor 二进制指令流（补齐与 iOS 同等的生产能力） */
    private static native String nativeSetTextMeasures(long handle, String measuresJson);
    private static native String nativeSplice(long handle, String spliceJson);
    private static native String nativeApplyOps(long handle, byte[] opsBytes);
    /** ★B-T2：文本策略回读（node_ids JSON → policy） */
    private static native String nativeTextPolicy(long handle, String nodeIdsJson);
    /** ★★MA0-RT：曲线贝塞尔近似（供 PathInterpolator 用；曲线知识只在引擎一处） */
    private static native String nativeCurveBezier(int curve);
    /** ★★MA0-RT：提交规格（合成属性判定 + 节点级采样） */
    private static native String nativeAnimCommitSpec(long handle, String json);
    /* ★★内核驱动动画（tick 路径）——与 iOS 同一份内核（此前本端**完全没有**这条通路） */
    /** 启动动画（封闭集声明：curve/spring/keyframes/scroll 窗口） */
    private static native String nativeAnimStart(long handle, String json);
    /**
     * 每帧推进：返回 **32B/条**定长记录
     * （`id u32 + tx/ty/scale/rotate/opacity f32 + bg u32 + textColor u32`，全小端；
     *   末两个 u32 为打包色 `0xAARRGGBB`，`0xFFFFFFFF` = 无该基色）。
     *
     * ★为什么走 byte[]：每帧 O(N) 条走 JSON 的编解码是白付（与 iOS 的二进制通道同一条纪律）；
     *   Java 侧用 `ByteBuffer.order(LITTLE_ENDIAN)` 按偏移直读。
     */
    private static native byte[] nativeAnimTickBin(long handle, float dtMs);
    /** 停动画（`{"nodeIds":[…]}` / `{"all":true}`） */
    private static native String nativeAnimStop(long handle, String json);
    /** ★仍在推进的动画条数（0 = 全结束）——幕切换的权威判据（灯光秀幕驱动用；见 JNI lib.rs 注释） */
    private static native String nativeAnimActive(long handle);
    /** ★★A3 播放控制：`{"timeScale":1.0,"paused":false}`（回显生效值） */
    private static native String nativeAnimControl(long handle, String json);
    /** ★★C2：带 SVG 路径的节点清单 + 段列表（宿主建平台 path 用） */
    private static native String nativeSvgNodes(long handle);
    /** ★★路径变形 v1：按当前因子**算好**的变形段列表（宿主零插值——见内核 `SvgPath::morphed`） */
    private static native String nativeSvgMorphPath(long handle, String json);
    /** ★★路径变形（二进制版——**每帧路径**：一次 JNI 拷贝 + 定长字段，无 JSON 解析） */
    private static native byte[] nativeSvgMorphPathBin(long handle, int nodeId);
    /** ★MA5：滚动驱动（滚动位置 → 全部窗口动画；换算在内核） */
    private static native String nativeAnimSeekScroll(long handle, String json);
    /** ★★★S3-T1 跟手：指针位移 → 节点平移（换算在内核；返回 updates JSON，宿主零数学、零 JS 跨界） */
    private static native String nativeLayoutFollow(long handle, int nodeId, float dx, float dy, int axis, float gain, float min, float max);
    /** ★★★S3-T2 松手：回弹归零 / 滑出吸附（弹簧接管；判定在内核） */
    private static native String nativeLayoutFollowRelease(long handle, int nodeId, int axis, float stiffness, float damping, float mass, float snapThreshold, float snapTarget);
    /** ★★★S3-T3 批量跟手：一帧 M 指一次 FFI（nodeIds + 每节点 6 float：gain/dx/dy/min/max/axis） */
    private static native String nativeLayoutFollowBatch(long handle, int[] nodeIds, float[] params);
    /** ★★★场跟手（通用 `v-follow={field:…}`）：一个焦点 → 容器子树一片叶节点的高度/朝向场 */
    private static native String nativeLayoutFollowField(long handle, int containerId, float focusX, float focusY, float falloff, float minScale, float maxScale, float maxRotate);
    /** ★★★场跟手（**二进制 12B/条**：id u32 + scale f32 + rotate f32——大 N 免 JSON 解析） */
    private static native byte[] nativeLayoutFollowFieldBin(long handle, int containerId, float focusX, float focusY, float falloff, float minScale, float maxScale, float maxRotate);
    /** ★共享元素（几何原语：源矩形 + 目标节点 ⇒ dx/dy/scale，内核算） */
    private static native String nativeSharedElement(long handle, String json);

    static boolean isLoaded() { return loaded; }
    public static String getLoadError() { return loadError; }

    static String version() {
        return loaded ? nativeVersion() : "native 未加载：" + loadError;
    }

    /**
     * ★启动自检：把「JNI 签名漂移」变成可观测的失败。
     * external 声明与 Rust 侧 #[no_mangle] 名字不一致时，Android 在**首次调用**才抛
     * UnsatisfiedLinkError（不是加载时）→ 主动调一次，提前暴露。
     */
    public static boolean checkSymbols() {
        if (!loaded) return false;
        try {
            return version() != null && !version().isEmpty();
        } catch (Throwable t) {
            loadError = "符号解析失败（JNI 声明与 Rust 侧不一致？）：" + t.getClass().getSimpleName() + ": " + t.getMessage();
            return false;
        }
    }

    public static String conformance(String goldenJson) {
        return loaded ? nativeConformance(goldenJson) : "{\"ok\":false,\"error\":\"native 未加载：" + loadError + "\"}";
    }

    public static String bench(int nodeCount, int iterations) {
        return loaded ? nativeBench(nodeCount, iterations) : "{\"ok\":false,\"error\":\"native 未加载：" + loadError + "\"}";
    }

    /**
     * ★**建树并保留**（返回句柄；0 = 失败）。
     *
     * 为什么需要（本仓实测暴露）：方案 §5.1 的节点树语义是「页面存活期间常驻」，
     * 而早期 API（conformance / bench）用完即弃 → ① 真实 App 无法持有页面树
     * ② 内存对比时拿「渲染完即销毁」对「一直持有」，比值是假象。
     */
    public static long create(String requestJson) {
        return loaded ? nativeCreate(requestJson) : 0L;
    }

    /** 释放句柄（页面销毁） */
    public static boolean destroy(long handle) {
        return loaded && nativeDestroy(handle);
    }

    /** 读取句柄对应的绝对矩形（JSON；供截图回归等场景把几何映射到屏幕坐标） */
    public static String readRects(long handle) {
        return loaded ? nativeReadRects(handle) : "{\"ok\":false,\"error\":\"native 未加载\"}";
    }

    /** ★B-T2：读节点的**文本策略**（whiteSpace/wordBreak/lineClamp；内核=SSOT）——入参 JSON 数组 id */
    public static String textPolicy(long handle, String nodeIdsJson) {
        return loaded ? nativeTextPolicy(handle, nodeIdsJson) : "{\"ok\":false,\"error\":\"native 未加载\"}";
    }

    /**
     * ★★**统一几何快照**（VC4-b，2026-10-02）：VC3-a 格式的结构树（path/depth/children）。
     *
     * 【与 readRects 的分工】那个是扁平 id→rect 表（增量/命中用）；本方法是**一致性校验**用——
     *   三端（Web/小程序/App）产出同一格式，供比对引擎逐节点比（禁止比对层格式适配）。
     */
    public static String geometrySnapshot(long handle) {
        return loaded ? nativeGeometrySnapshot(handle) : "{\"ok\":false,\"error\":\"native 未加载\"}";
    }

    /**
     * ★★**单节点绝对矩形**（2026-10-01：跨页面共享元素的稳态几何回传）。
     *
     * 目标页刚 mount 后取节点矩形，作为共享元素飞行的终点基准；几何由内核算
     * （与 FLIP 同一套偏移+吸附收集），Java 侧零几何数学。
     */
    public static String nodeRect(long handle, int nodeId) {
        return loaded ? nativeNodeRect(handle, nodeId) : "{\"ok\":false,\"error\":\"native 未加载\"}";
    }

    /** 当前存活的树数（诊断：确认 destroy 真的释放） */
    public static int handleCount() {
        return loaded ? nativeHandleCount() : -1;
    }

    /**
     * ★★**命中测试**（M3 事件系统的几何地基）：屏幕坐标 → 节点。
     *
     * 【为什么直接问核心，而不是在 Java 侧镜像一份几何】
     *   镜像必然漂移（滚动偏移/裁剪/增量布局都会改几何），且要在 Java 里重写
     *   「逆绘制序 + 裁剪感知」的语义 —— 那正是「引擎语义泄漏到三端」的反例。
     *   这里只传坐标，由核心用**它自己算出的几何**判定。
     *
     * @return JSON：`{ ok, target, path, chain }`（target=null 表示未命中）
     */
    static String hitTest(long handle, float x, float y) {
        return loaded ? nativeHitTest(handle, x, y) : "{\"ok\":false,\"error\":\"native 未加载：" + loadError + "\"}";
    }

    /** ★§9.3 长列表复用池跑批（4000 行 / 滚到底再回滚）——纯逻辑跑批（不含平台对象） */
    public static String recycleBench(int rows, int frames) {
        return loaded ? nativeRecycleBench(rows, frames) : "{\"ok\":false,\"error\":\"native 未加载：" + loadError + "\"}";
    }

    /* ══════════ ★★增量更新 / 列表复用池 / 结构变更 / Vapor 指令流 ══════════ */

    /** 增量更新：只发改动节点的样式补丁（几何经核心按布局边界局部重排） */
    static String update(long handle, String patchesJson) {
        return loaded ? nativeUpdate(handle, patchesJson) : NOT_LOADED;
    }

    /**
     * ★★建**复用池窗口**（§12.6）：返回句柄（0 = 失败）。
     * `leadingRows`/`followingRows` 传 0 ⇒ 用核心默认（8 / 2）。
     */
    public static long recycleCreate(int itemCount, int leadingRows, int followingRows) {
        return loaded ? nativeRecycleCreate(itemCount, leadingRows, followingRows) : 0;
    }

    /**
     * ★★复用池**本帧决策**：返回 `{acquire:[行号], release:[行号], direction, first_preload, …}`。
     *
     * 【为什么必须由核心给决策（本仓实测的设计纠正）】宿主此前**手写**方向敏感预载逻辑
     *   （`backward ? 8 : 2`）——那是 `recycle.rs` 的第二份副本，漂移是静默的。
     *   ⇒ 现在两端（iOS/Android）共用同一份决策，平台只执行"取/还对象"。
     *
     * ★执行顺序：**先 release 再 acquire**（反了 ⇒ 本帧要建的对象无法复用刚释放的 ⇒ 复用率虚低）。
     */
    public static String recycleUpdate(long handle, int firstVisible, int lastVisible) {
        return loaded ? nativeRecycleUpdate(handle, firstVisible, lastVisible) : NOT_LOADED;
    }

    /** 复用池累计读数（诊断/判据） */
    public static String recycleStats(long handle) {
        return loaded ? nativeRecycleStats(handle) : NOT_LOADED;
    }

    public static void recycleDestroy(long handle) {
        if (loaded && handle != 0) nativeRecycleDestroy(handle);
    }

    /** ★注入文本度量（增量重排会重新度量范围内文本 ⇒ 不注入则文本塌成 0 高） */
    static String setTextMeasures(long handle, String measuresJson) {
        return loaded ? nativeSetTextMeasures(handle, measuresJson) : NOT_LOADED;
    }

    /** ★结构变更（增删行）：`{removes:[id], inserts:[{parentId,nodes,index}], textMeasures:{}}` */
    static String splice(long handle, String spliceJson) {
        return loaded ? nativeSplice(handle, spliceJson) : NOT_LOADED;
    }

    /** ★★Vapor IR 二进制指令流（JNI 原生 byte[] —— 无需 iOS 那层 JSON 数组包装） */
    static String applyOps(long handle, byte[] opsBytes) {
        return loaded ? nativeApplyOps(handle, opsBytes) : NOT_LOADED;
    }

    /** ★★MA0-RT：曲线贝塞尔近似（`{"ok":true,"bezier":[…4 个数…]|null}`） */
    public static String curveBezier(int curve) {
        return loaded ? nativeCurveBezier(curve) : NOT_LOADED;
    }

    /** ★★MA0-RT：提交规格（合成属性判定 + 节点级采样；平台零参与路径的数据面） */
    static String animCommitSpec(long handle, String json) {
        return loaded ? nativeAnimCommitSpec(handle, json) : NOT_LOADED;
    }

    /* ══════════ ★★内核驱动动画（tick 路径） ══════════ */

    /** 启动动画（返回 `{"ok":true,"started":N,…}`） */
    public static String animStart(long handle, String json) {
        return loaded ? nativeAnimStart(handle, json) : NOT_LOADED;
    }

    /** 每帧推进（空数组 = 本帧无变化；步长 32B 见 native 声明） */
    static byte[] animTickBin(long handle, float dtMs) {
        return loaded ? nativeAnimTickBin(handle, dtMs) : new byte[0];
    }

    /** 停动画 */
    static String animStop(long handle, String json) {
        return loaded ? nativeAnimStop(handle, json) : NOT_LOADED;
    }

    /** ★MA5：滚动驱动 */
    static String animSeekScroll(long handle, String json) {
        return loaded ? nativeAnimSeekScroll(handle, json) : NOT_LOADED;
    }

    /** ★★★S3-T1 跟手：指针位移 → 节点平移（换算在内核）——返回 `{ok,changed,updates}` */
    static String layoutFollow(long handle, int nodeId, float dx, float dy, int axis, float gain, float min, float max) {
        return loaded ? nativeLayoutFollow(handle, nodeId, dx, dy, axis, gain, min, max) : NOT_LOADED;
    }

    /** ★★★S3-T2 松手：回弹/吸附（弹簧接管，判定在内核）——返回 `{ok,started,targets}` */
    static String layoutFollowRelease(long handle, int nodeId, int axis, float stiffness, float damping, float mass, float snapThreshold, float snapTarget) {
        return loaded ? nativeLayoutFollowRelease(handle, nodeId, axis, stiffness, damping, mass, snapThreshold, snapTarget) : NOT_LOADED;
    }

    /** ★★★S3-T3 批量跟手（一帧 M 指一次 FFI）——返回 `{ok,applied,updates}` */
    static String layoutFollowBatch(long handle, int[] nodeIds, float[] params) {
        return loaded ? nativeLayoutFollowBatch(handle, nodeIds, params) : NOT_LOADED;
    }

    /** ★★★场跟手（通用 `v-follow={field:…}`）：焦点 → 容器子树一片叶节点的高度/朝向场——返回 `{ok,applied,updates}` */
    static String layoutFollowField(long handle, int containerId, float focusX, float focusY, float falloff, float minScale, float maxScale, float maxRotate) {
        return loaded ? nativeLayoutFollowField(handle, containerId, focusX, focusY, falloff, minScale, maxScale, maxRotate) : NOT_LOADED;
    }

    /** ★★★场跟手（**二进制**）：返回 12B/条定长 `byte[]`（大 N 免 JSON 解析） */
    static byte[] layoutFollowFieldBin(long handle, int containerId, float focusX, float focusY, float falloff, float minScale, float maxScale, float maxRotate) {
        return loaded ? nativeLayoutFollowFieldBin(handle, containerId, focusX, focusY, falloff, minScale, maxScale, maxRotate) : new byte[0];
    }

    /** ★仍在推进的动画条数（0 = 全结束）——幕切换的权威判据 */
    public static String animActive(long handle) {
        return loaded ? nativeAnimActive(handle) : NOT_LOADED;
    }

    /** ★★A3：播放控制（时间因子/暂停） */
    public static String animControl(long handle, String json) {
        return loaded ? nativeAnimControl(handle, json) : NOT_LOADED;
    }

    /** ★★C2：SVG 路径清单（含段列表） */
    public static String svgNodes(long handle) {
        return loaded ? nativeSvgNodes(handle) : NOT_LOADED;
    }

    /** ★★路径变形 v1：当前变形后的段列表（`{"nodeId":N}`） */
    static String svgMorphPath(long handle, String json) {
        return loaded ? nativeSvgMorphPath(handle, json) : NOT_LOADED;
    }

    /** ★★路径变形（二进制——每帧用；null = 失败/无 B 态） */
    static byte[] svgMorphPathBin(long handle, int nodeId) {
        return loaded ? nativeSvgMorphPathBin(handle, nodeId) : null;
    }

    /** ★共享元素（几何原语） */
    static String sharedElement(long handle, String json) {
        return loaded ? nativeSharedElement(handle, json) : NOT_LOADED;
    }

    private static final String NOT_LOADED = "{\"ok\":false,\"error\":\"native 未加载\"}";
}
