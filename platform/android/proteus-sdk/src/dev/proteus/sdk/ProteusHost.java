// platform/android/proteus-sdk/src/dev/proteus/sdk/ProteusHost.java
package dev.proteus.sdk;

/**
 * ★★**宿主回调接口**（Host ABI ⑦ 号接口的 Android 侧形态；客户 App 需实现它）
 *
 * 【为什么是两个方法（最小集）】Host ABI 的 vtable 有七个回调，但对"嵌入一个页面"来说，
 *   只有两个是**必需**的：
 *   · {@link #measureText}——内核不自研文本（Profile §L4）⇒ 文本尺寸必须由平台给；
 *   · {@link #requestFrame}——内核**不自建线程**（方案 §5.1）⇒ 帧调度权归宿主。
 *   其余（图片解码 / 原生组件）按需实现（未实现 ⇒ 引擎**明确报错**，不静默跳过）。
 *
 * 【★线程契约（方案 §5.2 三条硬约束）】所有与引擎的交互必须在**同一线程**（platform thread）：
 *   创建、加载、提交、取更新、指针派发、销毁——全部在你的主线程上做完。
 *   回调（这两个方法）也**由引擎在同一线程内同步调用**（不会从别的线程打回来）。
 */
public interface ProteusHost {
    /**
     * 量文本：返回**打包的两个 float**（宽、高）。
     *
     * 【为什么打包成 long 而不是返回 float[]】本方法**每棵树每个文本节点调一次**；
     *   返回数组 ⇒ 每次一个临时对象（GC 压力）。两个 f32 恰好塞进一个 i64 ⇒ 零分配。
     *   实现范例（Android 原生）：
     * <pre>{@code
     * Paint p = new Paint();
     * p.setTextSize(fontSize);
     * float w = p.measureText(text);
     * float h = p.getFontMetrics().descent - p.getFontMetrics().ascent;
     * return (Float.floatToRawIntBits(w) & 0xFFFFFFFFL) | (((long) Float.floatToRawIntBits(h)) << 32);
     * }</pre>
     *
     * 【★必须调 paint.setTextSize】内核把 `fontSize` 交给你（它不知道平台字号语义）；
     *   若忽略它，量出来的尺寸与绘制不符 ⇒ 布局与绘制分叉（本仓已踩过同族缺陷）。
     *
     * @param text       文本内容
     * @param fontSize   字号（px；0 = 未指定，用你的默认）
     * @param fontWeight 字重（400 = normal；0 = 未指定）
     * @param fontFamily 语义族名（system/serif/monospace/rounded/condensed 或 custom:xxx；可为 null）
     * @return 打包的 (width, height)：低 32 位 = width 的 float 位模式，高 32 位 = height
     */
    long measureText(String text, float fontSize, int fontWeight, String fontFamily);

    /**
     * 引擎告知"本帧有内容需要提交" ⇒ 宿主**排下一帧**（例如 `Choreographer.postFrameCallback`）。
     *
     * 【语义】这不是"必须立刻画"，而是"有事要做"——宿主可以合并到自己的帧节奏里。
     */
    void requestFrame();

    /* ────────────────────────── ⑦ 原生组件（**可选**，HA4） ──────────────────────────
     * 【引擎驱动生命周期（宿主不必维护 IR↔原生对象对应）】树里 `nativeHost:true` 的节点，
     *   引擎会在 `loadTree`/`submitFrame` 时**自动**回调本三方法（创建 / 几何真变了才 update /
     *   节点消失或换树 ⇒ destroy）。宿主只负责"把 kind 变成一个真 View 并摆到给的矩形"。
     *
     * 【三个方法都有**缺省实现**（opt-in）】不实现 ⇒ 引擎在树里遇到 nativeHost 时会**明确报错**
     *   （`stats().last_error` + `native_view_create_failed`），**不静默跳过**——"界面缺一块"必须可见。
     *
     * 【几何单位】与 `measureText` 的 `fontSize` 同单位（当前 SDK 契约 = 逻辑像素/px）。
     * 【线程】与其余回调一致：由引擎在**同一线程**同步调用。
     */

    /**
     * 创建一个原生 View（map/video/web-view/…），返回一个**不透明句柄**（Java 对象；引擎只透传）。
     * 不支持该 kind ⇒ **返回 null**（引擎记为"宿主拒绝创建"并如实报错；业务侧应走降级）。
     */
    default Object nativeViewCreate(String kind, float x, float y, float width, float height) {
        return null;
    }

    /** 更新原生 View 的几何（**仅当矩形真变了**才被调；句柄 = create 的返回）。 */
    default void nativeViewUpdate(Object handle, float x, float y, float width, float height) {}

    /** 销毁原生 View（节点消失 / 换树 / 引擎销毁时调）。 */
    default void nativeViewDestroy(Object handle) {}
}
