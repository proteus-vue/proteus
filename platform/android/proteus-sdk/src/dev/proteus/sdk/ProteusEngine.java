// platform/android/proteus-sdk/src/dev/proteus/sdk/ProteusEngine.java
package dev.proteus.sdk;

/**
 * ★★**Proteus SDK 的引擎门面**（Host ABI 的 Android 侧；客户 App 用这个类嵌入）
 *
 * 【它与 `dev.proteus.layoutcore.RustLayout` 的关系（两个层次，别混）】
 *   · `RustLayout`  —— **内核** C ABI 的绑定（`proteus_layout_*`）：自绘宿主用的**低层**接口
 *     （自己建树、自己排版、自己取 rects、自己跑动画 tick）。
 *   · **本类** —— **Host ABI**（`proteus_engine_*`）：把"Surface / 生命周期 / 输入 / 调度 /
 *     能力 / 原生组件"收敛成**宿主契约**。客户只需实现 {@link ProteusHost} 的两个回调。
 *   ⇒ 两者在同一个 `.so` 里（`System.loadLibrary("proteus_jni")`），但**用途不同**：
 *     做产品用本类；写测试/自绘宿主才直接用 `RustLayout`。
 *
 * 【最小接入（三步，见 `docs/proteus-host-abi-integration.md`）】
 * <pre>{@code
 * ProteusEngine engine = ProteusEngine.create(host);        // ① 建引擎（预热可选：ProteusEngine.prewarm()）
 * int rc = engine.loadTree(treeJson);                       // ② 加载产物（树 JSON；可带 requiredCapabilities）
 * // ③ 每帧：engine.frame(nanos) → engine.frameUpdates() → 自己画
 * }</pre>
 *
 * 【线程契约】所有方法必须在**同一线程**（platform thread）调用（方案 §5.2）；
 *   本类不做线程同步——跨线程调用的行为**未定义**（与内核一致）。
 */
public final class ProteusEngine implements AutoCloseable {

    /* ── 错误码（与 `proteus_host_abi.h` 逐值一致；**不得改号**） ── */
    public static final int OK = 0;
    public static final int ERR_INVALID_ARG = -1;
    public static final int ERR_VERSION_MISMATCH = -2;
    /** ★能力未注册 / 产物所需能力本壳不提供（HA3：报告在 `stats()` 的 `last_error`） */
    public static final int ERR_CAPABILITY_UNREGISTERED = -3;
    public static final int ERR_NO_TREE = -4;
    public static final int ERR_INTERNAL = -5;

    /**
     * 每帧视觉更新记录长度 = **32B/条**（小端）：
     * `id u32 + tx/ty/scale/rotate/opacity f32 + bg u32 + textColor u32`
     *
     * ★★2026-10-01 由 24B → 28B（底色）→ **32B**（文字色）——末两个 u32 都是打包色
     *   `0xAARRGGBB`；`0xFFFFFFFF` = 本节点无该基色（消费方**忽略**该字段）。
     *   ★唯一事实源 = 内核 `ffi.rs::proteus_layout_anim_tick_bin`；与本端 `ProteusHostView`
     *   / iOS `animUpdateRecordBytes` / embed-demo 的常量同批更新
     *   （`scripts/check-anim-record-bytes.mjs` 从内核推出宽度并对账）。
     */
    public static final int FRAME_UPDATE_BYTES = 236;
    /** 几何二进制流的头长度（`RECTS_HEADER_BYTES` = 16） */
    public static final int RECTS_HEADER_BYTES = 16;
    /** 单条矩形字节数（id u32 + 4×f32） */
    public static final int RECT_BYTES = 20;

    static {
        System.loadLibrary("proteus_jni");
    }

    private long ptr;

    private ProteusEngine(long ptr) {
        this.ptr = ptr;
    }

    /**
     * 引擎**预热**（方案 §8.5：客户应在 `Application.onCreate` 调一次，避免首屏白屏）。
     *
     * 【诚实边界】本调用只做初始化（注册表等）；**真正的重活**是首次 `loadTree` 的
     *   解析 + 建树。⇒ 想要"真热"，在 App 启动时先 `loadTree` 一个**空树**（几毫秒）。
     */
    public static void prewarm() {
        nativePrewarm();
    }

    /**
     * ★★**真预热**（方案 §8.5 的完整形态）：
     * 建一个临时引擎 → 装**空树** → 销毁。
     *
     * 【为什么需要它（不是"多此一举"）】`{@link #prewarm()}` 只做初始化；**真正的重活**是
     *   首次 `loadTree` 的 JSON 解析 + 建树（本仓实测：4051 节点 75ms，其中 95% 是解析）。
     *   ⇒ 在 App 启动阶段先跑一次空树，把"首次解析"的成本挪出首屏。
     *
     * 【它不做的事（诚实边界）】不缓存引擎实例——真正复用的是**JIT 热码与分配器状态**，
     *   而不是某个引擎对象（引擎与树生命周期绑定）。若你希望"首屏用一个已装好的引擎"，
     *   那是**首屏产物预加载**（`loadTree(首屏树)` 的时机问题），不是本方法能代劳的。
     */
    public static void warm(ProteusHost host) {
        ProteusEngine e = create(host);
        try {
            e.loadTree("{\"viewport\":{\"width\":1,\"height\":1},\"nodes\":[]}");
        } finally {
            e.close();
        }
    }

    /**
     * 建引擎。
     *
     * @param host 宿主回调（**必需**：内核不自建线程、不自研文本）——
     *             引擎会持它的**全局引用**直到 {@link #close()}（本类负责释放）
     * @return 引擎实例；创建失败 ⇒ 抛 {@link IllegalStateException}（带可读原因；**不返回 null**——
     *         让失败在接入期就炸出来，而不是运行到一半 NPE）
     */
    public static ProteusEngine create(ProteusHost host) {
        if (host == null) {
            throw new IllegalArgumentException("host 不能为 null（内核需要 measureText / requestFrame）");
        }
        long p = nativeCreate(host);
        if (p == 0) {
            throw new IllegalStateException("Proteus 引擎创建失败（见 logcat `[proteus]` 前缀的原因）");
        }
        return new ProteusEngine(p);
    }

    /** 加载/替换整棵树（树 JSON；可含 `requiredCapabilities` ⇒ 引擎**加载前**校验，HA3） */
    public int loadTree(String treeJson) {
        ensureOpen();
        if (treeJson == null) return ERR_INVALID_ARG;
        return nativeLoadTree(ptr, treeJson);
    }

    /**
     * ★★**一帧的全部指令，一次提交**（批处理红线，方案 §3）。
     *
     * 【为什么是"一次"】跨边界调用有固定成本；若退化成"每个节点变更一次调用"，
     *   乘法效应会吃光性能优势 ⇒ ABI 把"一帧一次"做成**唯一入口**（没有逐节点版本）。
     *   指令流格式见 `docs/generated/instruction-spec.md`（`OPS_MAGIC` + 版本 + 计数 + 池 + 指令体）。
     *
     * @return {@link #OK} 或错误码（`last_error` 里有细节）
     */
    public int submitFrame(byte[] ops) {
        ensureOpen();
        if (ops == null || ops.length == 0) return ERR_INVALID_ARG;
        return nativeSubmitFrame(ptr, ops);
    }

    /**
     * 推进一帧（在你的 vsync 回调里调：Choreographer / CADisplayLink / 定时器均可）。
     *
     * @param frameTimeNs 系统**单调**时钟纳秒（Android：`System.nanoTime()`）
     */
    public int frame(long frameTimeNs) {
        ensureOpen();
        return nativeFrame(ptr, frameTimeNs);
    }

    /**
     * 本帧的视觉更新（**32B/条**：`id u32 + tx/ty/scale/rotate/opacity f32 + bg u32 + textColor u32`，小端）。
     * 空数组 = 本帧无变化。末两个 u32 是打包色（`0xAARRGGBB`；`0xFFFFFFFF` = 无该基色）。
     *
     * 【怎么用】`ByteBuffer.order(ByteOrder.LITTLE_ENDIAN)` 按偏移直读，
     *   把五值套到你的视图/图层上（平移 → 以元素中心为锚的缩放/旋转；有基色的节点另取颜色）。
     */
    public byte[] frameUpdates() {
        ensureOpen();
        return nativeFrameUpdates(ptr);
    }

    /**
     * 当前几何（二进制：头 16B + N×20B 的 `id u32 + x/y/w/h f32`）。
     *
     * 【口径】返回的是**最近一次重排范围内**的矩形（V4 的性能设计）；要**单个**节点的绝对几何
     *   （如摆放原生 View），内核侧另有点查询入口（本 SDK 的 `nodeRect` 封装见后续批次）。
     */
    public byte[] rects() {
        ensureOpen();
        return nativeRects(ptr);
    }

    /**
     * 诊断读数（JSON）——**接入时先看它**。
     *
     * 关键字段：`frames` / `submit_frame_calls` / `submitted_ops`（批处理红线）·
     * `measure_calls`（回调活跃度）· `native_view_*`（原生组件）· `last_error`（最近一次失败原因）。
     */
    public String stats() {
        ensureOpen();
        return nativeStats(ptr);
    }

    /** 设置壳的**能力清单**（接受 CLI `capability-manifest.json` 的同形；HA3） */
    public int setShellCapabilities(String json) {
        ensureOpen();
        return nativeSetShellCapabilities(ptr, json);
    }

    /**
     * 端上校验：产物**所需能力** ⊆ 本壳**提供**？
     *
     * @return {@link #OK} 或 {@link #ERR_CAPABILITY_UNREGISTERED}（缺失报告在 `stats().last_error`
     *         与 logcat）；**不抛出**——调用方可据此走降级路径
     */
    public int checkCapabilities(String requiredJson) {
        ensureOpen();
        return nativeCheckCapabilities(ptr, requiredJson);
    }

    /**
     * 指针事件**批处理**（一帧的所有事件一次提交）。
     *
     * @param xs    x 坐标（**引擎坐标系**：左上原点、逻辑像素）
     * @param ys    y 坐标
     * @param types 0=DOWN / 1=MOVE / 2=UP / 3=CANCEL
     * @param tsNs  系统单调时钟纳秒（**必须带**：输入延迟指标依赖它，方案 §2.4）
     * @return 命中的节点 id；`0` = 未命中；负 = 错误
     */
    public long dispatchPointers(float[] xs, float[] ys, int[] types, long[] tsNs) {
        ensureOpen();
        if (xs == null || ys == null || types == null || tsNs == null) return ERR_INVALID_ARG;
        return nativeDispatchPointers(ptr, xs, ys, types, tsNs);
    }

    /**
     * 高度便捷：单点**抬起**（内部仍走**批处理**入口——形态统一）。
     *
     * ★四个数组**必须等长**（JNI 侧契约；不等长会明确返回 {@link #ERR_INVALID_ARG}——
     *   首版这里给了 1/1/2/2 ⇒ 恒返回 -1，就是被这条契约挡下的）。
     */
    public long tap(float x, float y, long tsNs) {
        return dispatchPointers(new float[]{x}, new float[]{y}, new int[]{2}, new long[]{tsNs});
    }

    /**
     * 启动动画（声明格式与内核 `anim_start` 一致：曲线 / 弹簧 / 序列 / 滚动窗口）。
     *
     * 【为什么 SDK 要暴露它】`frameUpdates()` 里的数据**来自动画**——没有动画在跑就没有更新。
     *   客户要用 ABI 驱动动效，这是唯一入口（v1 形态）。
     *   ★诚实边界：`AnimOp` 走指令流是后续工作（届时本入口保留为宿主侧直调通路）。
     */
    public int animStart(String animsJson) {
        ensureOpen();
        if (animsJson == null) return ERR_INVALID_ARG;
        return nativeAnimStart(ptr, animsJson);
    }

    /** 停动画：`{"all":true}` 或 `{"nodeIds":[…]}`（含**清值**语义——停止必须复位视觉字段） */
    public int animStop(String json) {
        ensureOpen();
        return nativeAnimStop(ptr, json);
    }

    /** 滚动 / 动画帧之后手动同步（原生组件几何；HA4）；无原生组件时是**廉价幂等**操作 */
    public int syncNativeViews() {
        ensureOpen();
        return nativeSyncNativeViews(ptr);
    }

    @Override
    public void close() {
        if (ptr != 0) {
            nativeDestroy(ptr);
            ptr = 0;
        }
    }

    private void ensureOpen() {
        if (ptr == 0) {
            throw new IllegalStateException("引擎已关闭（close() 之后不得再调）");
        }
    }

    /* ── native 声明（与 `platform/android/proteus-jni/src/host.rs` 的符号名一一对应） ── */

    private static native void nativePrewarm();
    private static native long nativeCreate(ProteusHost host);
    private static native void nativeDestroy(long engine);
    private static native int nativeLoadTree(long engine, String treeJson);
    private static native int nativeSubmitFrame(long engine, byte[] ops);
    private static native int nativeFrame(long engine, long frameTimeNs);
    private static native byte[] nativeFrameUpdates(long engine);
    private static native byte[] nativeRects(long engine);
    private static native String nativeStats(long engine);
    private static native int nativeSetShellCapabilities(long engine, String json);
    private static native int nativeCheckCapabilities(long engine, String requiredJson);
    private static native long nativeDispatchPointers(long engine, float[] xs, float[] ys, int[] types, long[] tsNs);
    private static native int nativeSyncNativeViews(long engine);
    private static native int nativeAnimStart(long engine, String animsJson);
    private static native int nativeAnimStop(long engine, String json);
}
