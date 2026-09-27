package dev.proteus.layoutcore;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;
import android.view.ViewGroup;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * ★★宿主 View（方案 §6.1 规格）——**角色等同 Compose 的 `AndroidComposeView`（一个 ViewGroup）**。
 *
 * 与原生对照组的差别正是 M2 要证明的事：
 *   原生   = 4050 个 View 对象各自 measure/layout/draw（View 体系递归）
 *   Proteus = 1 个宿主 + N 条绘制指令（**自绘内容无 View 树、无 View 体系递归**）
 *
 * 【为什么是 ViewGroup 而不是 View】（M3 原生组件混用，方案 L3 层「必须预留」）
 *   地图 / WebView / 广告 SDK 必须以**原生 View** 嵌入（这是不自绘的核心理由之一，
 *   见方案 §9 坑位 #4：「层级与滚动同步需专门设计」）。
 *   而 View 无法承载子 View → 升级为 ViewGroup：
 *     · **自绘内容**（色块/文本）仍走 `onDraw` 的 Canvas 指令（无 View 树）
 *     · **native-host 节点**作为**子 View**，其 measure/layout **完全由 Rust 几何驱动**
 *       （不走 ViewGroup 的默认排布逻辑 → 布局仍由排版核心决定）
 *     · **z-order**：子 View 由 `dispatchDraw` 在 `onDraw` **之后**绘制
 *       → 原生 View 天然在自绘内容**之上**（这是 Android 的固有约束，已如实记录）
 */
public class ProteusHostView extends ViewGroup {
    /** 绘制指令（由 Rust 核心的布局结果生成） */
    public static final class Cmd {
        final float x, y, w, h;
        final int color;
        final String text;
        Cmd(float x, float y, float w, float h, int color, String text) {
            this.x = x; this.y = y; this.w = w; this.h = h; this.color = color; this.text = text;
        }
    }

    /* ══════════ ★native-host 节点（原生 View 嵌入，方案 L3） ══════════ */

    /** 节点 id → 原生 View */
    private final Map<Integer, View> nativeHosts = new HashMap<>();
    /** 节点 id → Rust 几何（**位置/尺寸的唯一来源**；子 View 的 measure/layout 都用它） */
    private final Map<Integer, RectF> nativeRects = new HashMap<>();

    private List<Cmd> cmds = java.util.Collections.emptyList();
    private final Paint bgPaint = new Paint();
    /** 图集重放专用（用 shader 精确定位，避免 drawBitmap 的密度/插值干扰） */
    private final Paint atlasPaint = new Paint();
    // ★StaticLayout 要求 `TextPaint`（Paint 的子类）——文本配置色/字号都在它上面
    private final android.text.TextPaint textPaint = new android.text.TextPaint(android.graphics.Paint.ANTI_ALIAS_FLAG);

    public ProteusHostView(Context context) {
        super(context);
        textPaint.setColor(Color.BLACK);
        textPaint.setTextSize(12f);
    }

    public void setCmds(List<Cmd> value) {
        this.cmds = value;
        invalidate();
    }

    /* ── native-host 接入 ── */

    /**
     * 注册一个原生视图作为 `native-host` 节点的载体。
     *
     * @param nodeId Rust 树里的节点 id（几何按它查）
     * @param v      原生 View（WebView / MapView / 第三方 SDK View）
     */
    public void addNativeHost(int nodeId, View v) {
        nativeHosts.put(nodeId, v);
        addView(v);
        requestLayout();
    }

    /**
     * 设置 native-host 节点的几何（**必须来自 Rust 排版核心**）。
     *
     * ★为什么几何必须外部传入：方案要求「布局使用排版核心，不走 ViewGroup 递归」。
     *   若让子 View 自己 measure，就退回了 View 体系；这里显式用 Rust 的结果驱动，
     *   子 View 只负责「按给定尺寸渲染自己」。
     *
     * @param rects 节点 id → 相对**宿主**的矩形（Rust 几何 + 场景偏移）
     */
    public void setNativeHostGeometry(Map<Integer, RectF> rects) {
        nativeRects.clear();
        nativeRects.putAll(rects);
        requestLayout();
    }

    public int nativeHostCount() {
        return nativeHosts.size();
    }

    /* ── ViewGroup 生命周期：用 Rust 几何驱动 ── */

    @Override
    protected void onMeasure(int widthSpec, int heightSpec) {
        // 宿主自身：接受 parent 给的尺寸（它由外部布局决定）
        int w = MeasureSpec.getSize(widthSpec);
        int h = MeasureSpec.getSize(heightSpec);
        // ★子 View（native-host）：**尺寸来自 Rust 几何**（EXACTLY）——不退化为 View 体系测量
        for (Map.Entry<Integer, View> e : nativeHosts.entrySet()) {
            RectF rect = nativeRects.get(e.getKey());
            int nw = rect != null ? Math.round(rect.width()) : 0;
            int nh = rect != null ? Math.round(rect.height()) : 0;
            e.getValue().measure(
                    MeasureSpec.makeMeasureSpec(nw, MeasureSpec.EXACTLY),
                    MeasureSpec.makeMeasureSpec(nh, MeasureSpec.EXACTLY));
        }
        setMeasuredDimension(w, h);
    }

    @Override
    protected void onLayout(boolean changed, int l, int t, int r, int b) {
        // ★子 View（native-host）：**位置来自 Rust 几何**（绝对定位，非流式排布）
        for (Map.Entry<Integer, View> e : nativeHosts.entrySet()) {
            RectF rect = nativeRects.get(e.getKey());
            if (rect == null) continue;
            View v = e.getValue();
            v.layout(Math.round(rect.left), Math.round(rect.top),
                     Math.round(rect.right), Math.round(rect.bottom));
        }
    }

    /** 报告 native-host 的当前布局（核验用：确认 Rust 几何真的落到了子 View 上） */
    public String nativeHostLayoutDump() {
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (Map.Entry<Integer, View> e : nativeHosts.entrySet()) {
            View v = e.getValue();
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"nodeId\":").append(e.getKey())
              .append(",\"left\":").append(v.getLeft())
              .append(",\"top\":").append(v.getTop())
              .append(",\"width\":").append(v.getWidth())
              .append(",\"height\":").append(v.getHeight())
              .append(",\"visible\":").append(v.getVisibility() == View.VISIBLE)
              .append("}");
        }
        return sb.append(']').toString();
    }

    /* ══════════ ★滚动列表模式（§9.3）：把 ListRenderer 接到**真实 View 绘制管线** ══════════ */

    private ListRenderer listRenderer;

    /**
     * 启用滚动列表模式。
     *
     * ★★为什么必须挂到真实 View 上（本仓实测教训）：
     *   初版在宿主里**自建 `RenderNode` 并录制**，但那个 node **从未挂进窗口** →
     *   显示系统根本没收到帧（系统 `dumpsys gfxinfo` 只统计到 31 帧，全是冷启动画面），
     *   于是「帧间隔」测到的只是 Choreographer 的回调节拍，**与渲染无关**。
     *   正解：把列表绘制放进**在窗口里的 View** 的 `onDraw`，由 `invalidate()` 驱动真实帧。
     */
    public void enableListMode(ListRenderer r) {
        this.listRenderer = r;
        invalidate();
    }

    /** 请求重绘（由滚动驱动每帧调用 → 产生真实帧） */
    public void requestListFrame() {
        invalidate();
    }

    public int cmdCount() { return cmds.size(); }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        // ★滚动列表模式：绘制列表内容（这是**真实帧**的来源——canvas 来自窗口）
        if (listRenderer != null) {
            listRenderer.draw(canvas);
            return;
        }
        drawCmds(canvas);
    }

    /**
     * ★把指令下发到给定 Canvas（抽出为公开方法，便于**分路径测量**）。
     *
     * 为什么需要分路径（本仓实测教训）：
     *   · 软件路径（`Bitmap` + `Canvas`）：立即光栅化 —— 测出 8ms
     *   · **硬件路径（`RenderNode` 的 `RecordingCanvas`）**：只**录制** DisplayList，
     *     真正光栅化由 RenderThread 异步完成 —— 这才是方案 §6.1 规定的路径
     *     （「宿主 Canvas 下发指令 → DisplayList → RenderThread → Skia → GPU」）
     *   拿软件路径的数字去和原生（走硬件加速）比，是**不对等比较**，会得出「Proteus 绘制更慢」的假象。
     */
    public void drawCmds(Canvas canvas) {
        // ★单次遍历下发全部指令（无 View 树、无递归 measure/layout）
        final List<Cmd> list = cmds;
        for (int i = 0; i < list.size(); i++) {
            final Cmd c = list.get(i);
            bgPaint.setColor(c.color);
            canvas.drawRect(c.x, c.y, c.x + c.w, c.y + c.h, bgPaint);
            if (c.text != null) canvas.drawText(c.text, c.x + 1f, c.y + c.h * 0.8f, textPaint);
        }
    }

    /** 只画色块（**归因用**：拆出「色块 vs 文本」各占多少绘制时间） */
    public void drawRectsOnly(Canvas canvas) {
        final List<Cmd> list = cmds;
        for (int i = 0; i < list.size(); i++) {
            final Cmd c = list.get(i);
            bgPaint.setColor(c.color);
            canvas.drawRect(c.x, c.y, c.x + c.w, c.y + c.h, bgPaint);
        }
    }

    /** 只画文本（**归因用**） */
    public void drawTextOnly(Canvas canvas) {
        final List<Cmd> list = cmds;
        for (int i = 0; i < list.size(); i++) {
            final Cmd c = list.get(i);
            if (c.text != null) canvas.drawText(c.text, c.x + 1f, c.y + c.h * 0.8f, textPaint);
        }
    }

    /* ══════════════════ ★M3 绘制优化（三条，均对应真实渲染器的既有做法）══════════════════ */

    /**
     * ① **paint 状态去重**：仅在颜色变化时 setColor。
     *    渲染器通用做法（同色连续绘制不重设状态，避免无谓的 pipeline 失效）。
     */
    private final android.graphics.Path rectPath = new android.graphics.Path();
    /** ★LRU（accessOrder=true）：命中会移到队尾，超限淘汰最久未用（并回收其位图）。
     *  为什么不是「满即清空」：文案多变时清空会造成**抖动**（刚缓存又被清），LRU 让热文案常驻。 */
    private final java.util.LinkedHashMap<String, android.graphics.Bitmap> textAtlas =
            new java.util.LinkedHashMap<String, android.graphics.Bitmap>(64, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(java.util.Map.Entry<String, android.graphics.Bitmap> eldest) {
                    if (size() > ATLAS_MAX_ENTRIES) {
                        eldest.getValue().recycle();
                        return true;
                    }
                    return false;
                }
            };

    /**
     * ② **同色矩形批处理**：同色连续矩形累积为一条 Path，一次 `drawPath`。
     *    把 N 次绘制调用（每次都要走 matrix/clip/paint 的管线设置）压成 1 次。
     *    ★边界：仅当颜色连续相同时合并（跨色合并会改变绘制语义）；
     *      超大 Path 会占用较多内存，故设 4096 个矩形的分片上限。
     */
    private static final int PATH_CHUNK = 4096;

    /**
     * ③ **文本图集（glyph atlas）**：把 (文本, 样式) 预渲染为 ALPHA_8 位图，绘制时 `drawBitmap` 复用。
     *
     * 为什么这是真实做法而非应试技巧：
     *   · Skia/Impeller/Flutter 的文字渲染本质就是「shape 一次 → 缓存 glyph → 重放位置」；
     *     Android Canvas 的 drawText 每次调用都要重走 shaping/font 查找，无法跨调用复用
     *   · 本实现用「按串缓存位图」近似该机制（对**重复文案**——列表项、标签、按钮——命中率极高）
     *   · ALPHA_8 = 每像素 1 字节，一条目约 1–2KB；缓存**有上限**（LRU 淘汰，见下），不会无限增长
     *
     * ★诚实边界：本优化的收益与**文案重复率**强相关。M2 基准里 2000 条全为 "item"，
     *   命中率 100% → 收益最大化；真实业务（长列表、变动文案）需按实测命中率评估。
     *   命中率低时自动退化为 drawText（缓存未命中即直接绘制并写入缓存）。
     */
    /**
     * 位图图集上限。★**保留但默认不启用**（见 `drawCmdsOptimized` 的说明）。
     *
     * 实测对照（缓存充足时的诚实数据）：
     * | 路径 | 重复文案 | 多变文案 |
     * |---|---|---|
     * | drawText | 4.83ms | 5.97ms |
     * | 位图图集 | 4.69ms | 5.80ms |
     * | StaticLayout | 5.44ms | 10.73ms |
     * → 三者在**这个规模**下差距 <1ms，说明**短文本渲染不是瓶颈**。
     *   图集曾因缓存抖动测出 28ms（假象），容量修好后并无优势 → 默认不启用。
     */
    private static final int ATLAS_MAX_ENTRIES = 512;
    /** 建图集的最小重复次数（2 = 第二次出现才建；见 atlasBitmapFor 的自适应说明） */
    private static final int ATLAS_MIN_REPEAT = 2;
    /** 「已见次数」计数表（有界 LRU：避免多变文案撑爆内存） */
    private final java.util.LinkedHashMap<String, Integer> textSeen =
            new java.util.LinkedHashMap<String, Integer>(64, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(java.util.Map.Entry<String, Integer> eldest) {
                    return size() > 2048;
                }
            };

    /**
     * 取文案的图集位图；**首次出现返回 null**（调用方直接 drawText）。
     *
     * ★★自适应策略（本仓实测教训）：
     *   初版「首次出现即建位图」在**文案多变**场景下实测 **98ms**（比基线还慢 8 倍）——
     *   2000 条各不相同 → 建 2000 次位图（每次 createBitmap+Canvas+drawText 约 50μs）。
     *   改为「**第二次出现才建**」后：多变文案走 drawText（不建位图，退化为基线），
     *   重复文案（列表项/标签/按钮）才享受图集收益。这是**自适应**而非一刀切。
     */
    private android.graphics.Bitmap atlasBitmapFor(String text) {
        android.graphics.Bitmap bm = textAtlas.get(text);
        if (bm != null) return bm;
        // 计数（有界 LRU，避免多变文案把计数表撑爆）
        Integer seen = textSeen.get(text);
        if (seen == null) {
            textSeen.put(text, 1);
            return null;                     // 首次：不建位图
        }
        textSeen.put(text, seen + 1);
        if (seen + 1 < ATLAS_MIN_REPEAT) return null;   // 未达重复阈值：仍不建

        android.graphics.Paint.FontMetrics fm = textPaint.getFontMetrics();
        int w = Math.max(1, (int) Math.ceil(textPaint.measureText(text)));
        int h = Math.max(1, (int) Math.ceil(fm.descent - fm.ascent));
        // ★ALPHA_8：只存覆盖率（文字单色）→ 内存为 ARGB_8888 的 1/4
        //   ★★必须用带 DisplayMetrics 的重载：`createBitmap(w,h,config)` 的 density 是
        //     DENSITY_DEFAULT(160)，而设备 480dpi → drawBitmap 会**放大 3 倍**
        //     （本仓实测：像素校验 14126/14803 不符，根因即此）
        android.content.res.Resources res = getResources();
        bm = android.graphics.Bitmap.createBitmap(res.getDisplayMetrics(), w, h,
                android.graphics.Bitmap.Config.ALPHA_8);
        android.graphics.Canvas bc = new android.graphics.Canvas(bm);
        bc.drawText(text, 0f, -fm.ascent, textPaint);
        textAtlas.put(text, bm);
        return bm;
    }

    /**
     * ★M3 优化后的绘制路径。与 `drawCmds`（基线）并列保留 —— 便于**同机对照归因**。
     *
     * ★★关于「位图图集」：**实现保留但默认不启用**（本仓实测结论）——
     *   多变文案下建位图开销（28.39ms）远超收益；重复文案下也不优于 `drawText`（6.03 vs 4.73ms）。
     *   根因：Skia 的字形缓存本来就按**字形**索引，跨文案复用，`drawText` 已享受这一层优化；
     *   而按「整串」建位图是**更粗的粒度**，只在极特殊场景（如完全静态的重复图标化文本）才有意义。
     *   故正式路径改为**按长度分流**（短 drawText / 长 StaticLayout），
     *   图集相关代码（`atlasBitmapFor` / `drawCmdsOptimized` 的图集分支）保留供对照与未来评估。
     */
    public void drawCmdsOptimized(Canvas canvas) {
        final List<Cmd> list = cmds;
        int n = list.size();

        // ① + ②：色块批处理（同色连续 → 一条 Path → 一次 drawPath）
        rectPath.reset();
        int pending = 0;
        int lastColor = 0;
        boolean hasColor = false;
        for (int i = 0; i < n; i++) {
            final Cmd c = list.get(i);
            if (!hasColor || c.color != lastColor || pending >= PATH_CHUNK) {
                if (pending > 0) canvas.drawPath(rectPath, bgPaint);
                rectPath.reset();
                if (!hasColor || c.color != lastColor) {
                    bgPaint.setColor(c.color);   // ① 仅在颜色变化时设置
                    lastColor = c.color;
                    hasColor = true;
                }
                pending = 0;
            }
            rectPath.addRect(c.x, c.y, c.x + c.w, c.y + c.h, android.graphics.Path.Direction.CW);
            pending++;
        }
        if (pending > 0) canvas.drawPath(rectPath, bgPaint);

        // ③：文本 —— **按长度分流**（依据见 STATIC_LAYOUT_MIN_CHARS 处的实测表）
        //   ★默认 drawText：实测短文本下它最快（Skia 字形缓存按**字形**索引，天然跨文案复用）
        //   ★长文本走 StaticLayout：预计算断行开始有收益
        for (int i = 0; i < n; i++) {
            final Cmd c = list.get(i);
            if (c.text == null) continue;
            if (c.text.length() >= STATIC_LAYOUT_MIN_CHARS) {
                final android.text.StaticLayout layout = layoutFor(c.text, Math.max(1f, c.w));
                canvas.save();
                canvas.translate(c.x + 1f, c.y + c.h * 0.1f);
                layout.draw(canvas);
                canvas.restore();
            } else {
                canvas.drawText(c.text, c.x + 1f, c.y + c.h * 0.8f, textPaint);
            }
        }
    }

    /** 报告图集规模（可观测：命中率与内存占用的证据） */
    public int atlasSize() { return textAtlas.size(); }

    /* ══════════ ★方案 §6.1 规定的 Android 文本通道：StaticLayout + 后台预热 ══════════ */

    /**
     * **StaticLayout 文本缓存**（方案 §6.1 原文：
     *   「文本：`StaticLayout`（预计算行宽高与截断）+ 后台线程缓存预热 TextLayoutCache」）。
     *
     * 为什么用 StaticLayout 而不是每次 `drawText`：
     *   · `drawText` 每次调用都要重走 **shaping（字形选择 + 定位）** 与 font 查找；
     *     `StaticLayout` 把「断行 + shaping 结果」**一次算好**，绘制时只是**重放**已算好的行
     *   · 它对**行内样式/断行/截断**有完整信息（`getLineCount/getLineWidth/...`），
     *     比 `drawText` 更接近真实文本渲染器的做法
     *   · 与方案引用的生产案例一致：「StaticLayout 替换 DynamicLayout + 后台预热 → 绘制降至约 2ms」
     *
     * ★与「按串缓存位图」的区别（这是关键改进）：
     *   位图缓存对**重复文案**有效，但对**每条都不同**的文案会退化为建位图（此前实测 98ms → 41ms）；
     *   StaticLayout **不建位图**（只缓存布局结果），故**无论文案是否重复都不吃亏**。
     */
    private final java.util.LinkedHashMap<String, android.text.StaticLayout> layoutCache =
            new java.util.LinkedHashMap<String, android.text.StaticLayout>(128, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(java.util.Map.Entry<String, android.text.StaticLayout> eldest) {
                    return size() > LAYOUT_CACHE_MAX;
                }
            };

    /**
     * 布局缓存上限。**★这是经过实测权衡后的值**：
     *
     * | cache 上限 | proteus-mem 增量 | 多变文案 StaticLayout |
     * |---|---|---|
     * | 1024 | 12.2 MB | **49.4ms**（工作集 2025 > 1024 → LRU 抖动，第二遍全未命中） |
     * | 8192 | 27.2 MB | **10.7ms**（缓存生效） |
     *
     * ⇒ 15MB 换 38ms。**但**：正式绘制路径走 `drawText`（不依赖本缓存），
     *   本缓存只为**长文本**（≥ STATIC_LAYOUT_MIN_CHARS）服务，而长文本在真实页面里数量很少。
     *   故取**中间值**：既避免小工作集抖动，又不必为极端场景常驻 15MB。
     *
     * ★纪律：**缓存容量必须 ≥ 工作集**，否则 LRU 抖动会让「优化」变成「劣化」
     *   （本仓实测：同一个 StaticLayout 路径，容量不足时 49.4ms、充足时 10.7ms）。
     */
    private static final int LAYOUT_CACHE_MAX = 2048;
    private int layoutBuilds = 0;   // 真实构建次数（可观测：预热是否生效）

    /**
     * StaticLayout 的启用阈值（字符数）。
     *
     * ★★为什么要分流（本仓实测结论，与方案 §6.1 的生产案例并不矛盾）：
     *   · 方案 §6.1 的生产案例是**长文本测量**（DynamicLayout → StaticLayout，30–50ms → 2ms）
     *   · 而本仓 4050 元素基准是**大量短文本**（"item"、"row 12"）——实测三路径对比：
     *       | 路径 | 重复文案 | 多变文案 |
     *       |---|---|---|
     *       | drawText（基线） | **4.73ms** | **6.03ms** |
     *       | 位图图集 | 6.03ms | 28.39ms |
     *       | StaticLayout（缓存充足） | 5.50ms | 10.67ms |
     *   · 结论：**短文本下 drawText 最快**（Skia 内部字形缓存已按**字形**索引，
     *     与「文案是否重复」无关）；StaticLayout 的价值在**长文本/多行**（预计算断行）
     *   ⇒ 按长度分流：短文本走 drawText，长文本走 StaticLayout。
     */
    private static final int STATIC_LAYOUT_MIN_CHARS = 48;

    /** 取（或构建）文本的 StaticLayout */
    private android.text.StaticLayout layoutFor(String text, float maxWidth) {
        android.text.StaticLayout cached = layoutCache.get(text);
        if (cached != null) return cached;
        int w = Math.max(1, (int) Math.ceil(maxWidth));
        android.text.StaticLayout layout = android.text.StaticLayout.Builder
                .obtain(text, 0, text.length(), textPaint, w)
                .setIncludePad(false)
                .setAlignment(android.text.Layout.Alignment.ALIGN_NORMAL)
                .build();
        layoutCache.put(text, layout);
        layoutBuilds++;
        return layout;
    }

    /**
     * ★**后台线程预热**（方案 §6.1 明确要求）。
     *
     * 为什么必须后台：构建 StaticLayout 要跑 shaping，是布局里最贵的一步。
     * 放在主线程会让首帧卡顿（生产案例：长文本 30–50ms）。
     * 预热后主线程只做「查表 + 重放」。
     *
     * @param texts 待预热的文案集合（平台侧从数据源取出）
     * @return 预热线程（便于测试 join）
     */
    public Thread prewarmAsync(final java.util.Collection<String> texts, final float maxWidth) {
        Thread t = new Thread(new Runnable() {
            @Override public void run() {
                for (String s : texts) {
                    if (s == null) continue;
                    try {
                        synchronized (layoutCache) {
                            if (!layoutCache.containsKey(s)) layoutFor(s, maxWidth);
                        }
                    } catch (Throwable ignored) { /* 预热失败不影响主路径 */ }
                }
            }
        }, "proteus-text-prewarm");
        t.setDaemon(true);
        t.start();
        return t;
    }

    public int layoutBuildCount() { return layoutBuilds; }
    public int layoutCacheSize() { return layoutCache.size(); }

    /**
     * ★**StaticLayout 绘制路径**（§6.1 规定的实现）。
     *
     * 与基线 `drawCmds` 的区别：文本走「缓存布局 + 重放」，而非每次 `drawText`。
     * 色块部分仍用同色批处理（M3 优化）。
     */
    public void drawCmdsStaticLayout(Canvas canvas) {
        final List<Cmd> list = cmds;
        final int n = list.size();

        // 色块：同色批处理（与 drawCmdsOptimized 同）
        rectPath.reset();
        int pending = 0;
        int lastColor = 0;
        boolean hasColor = false;
        for (int i = 0; i < n; i++) {
            final Cmd c = list.get(i);
            if (!hasColor || c.color != lastColor || pending >= PATH_CHUNK) {
                if (pending > 0) canvas.drawPath(rectPath, bgPaint);
                rectPath.reset();
                if (!hasColor || c.color != lastColor) {
                    bgPaint.setColor(c.color);
                    lastColor = c.color;
                    hasColor = true;
                }
                pending = 0;
            }
            rectPath.addRect(c.x, c.y, c.x + c.w, c.y + c.h, android.graphics.Path.Direction.CW);
            pending++;
        }
        if (pending > 0) canvas.drawPath(rectPath, bgPaint);

        // 文本：StaticLayout 重放（★不建位图，文案多变也不吃亏）
        final int save = canvas.save();
        for (int i = 0; i < n; i++) {
            final Cmd c = list.get(i);
            if (c.text == null) continue;
            final android.text.StaticLayout layout = layoutFor(c.text, Math.max(1f, c.w));
            canvas.save();
            canvas.translate(c.x + 1f, c.y + c.h * 0.1f);
            layout.draw(canvas);
            canvas.restore();
        }
        canvas.restoreToCount(save);
    }

    /* ══════════════ ★§9.2「不拍平时」对照变体（拍平的另一极） ══════════════ */

    /**
     * ★「不拍平」结构：**每个元素创建自己的绘制对象**（Android 上 = 一个 `RenderNode`）。
     *
     * 与主路径的区别（即方案 §12.3 的两种形态）：
     *   · **真拍平**（主路径 `drawCmds`/`drawCmdsOptimized`）：不创建绘制对象，
     *     所有指令直接下发到**宿主已有的 Canvas**（复用宿主 backing store）→ ✅ 采用
     *   · **不拍平**（本方法）：每元素一个 `RenderNode`（各自持有 DisplayList + 可能的离屏缓冲）
     *     → 正是 iOS 实验里「一行一个 layer」在 Android 的同构形态
     *
     * 为何要测：§9.2 明确要求「**不拍平时的耗时仍 ≤ 原生**」——
     * 拍平只对静态子树生效，动态内容（列表、轮播）不走拍平，故这是**能力下限**的验证。
     */
    private final java.util.List<android.graphics.RenderNode> unflattened =
            new java.util.ArrayList<>();

    /** 建立「不拍平」结构（每元素一个独立绘制对象） */
    public void buildUnflattened() {
        unflattened.clear();
        final int n = cmds.size();
        for (int i = 0; i < n; i++) {
            final Cmd c = cmds.get(i);
            android.graphics.RenderNode node = new android.graphics.RenderNode("el");
            // 位置设在自身坐标（子节点内部用相对坐标绘制）
            node.setPosition((int) c.x, (int) c.y, (int) (c.x + c.w), (int) (c.y + c.h));
            android.graphics.RecordingCanvas rc = node.beginRecording();
            bgPaint.setColor(c.color);
            rc.drawRect(0f, 0f, c.w, c.h, bgPaint);
            if (c.text != null) rc.drawText(c.text, 1f, c.h * 0.8f, textPaint);
            node.endRecording();
            unflattened.add(node);
        }
    }

    /** 绘制「不拍平」结构（逐个 drawRenderNode，不做任何批量） */
    public void drawUnflattened(Canvas canvas) {
        final int n = unflattened.size();
        for (int i = 0; i < n; i++) {
            canvas.drawRenderNode(unflattened.get(i));
        }
    }

    /** 报告「不拍平」结构的对象数（供报告与内存归因） */
    public int unflattenedCount() { return unflattened.size(); }

    /* ══════════ ★§9.3 平台侧：滚动列表 + RenderNode 池化 + 帧率测量 ══════════ */

    /**
     * 滚动列表渲染器：**平台侧**真实对象（`RenderNode`）的复用池。
     *
     * 与 Rust 侧 `recycle::RecyclePool` 的关系：
     *   · Rust 侧负责**决定**「哪些行该存在、哪些该释放」（平台无关逻辑，已验收）
     *   · 本类负责**执行**：把 RenderNode 对象放进池里复用，滚动时不新建
     *
     * ★这是 §12.7 P1「layer 复用池」在 Android 上的落地（`RenderNode` 即 layer 的等价物）。
     */
    public static final class ListRenderer {
        private final java.util.ArrayDeque<android.graphics.RenderNode> pool = new java.util.ArrayDeque<>();
        private final java.util.HashMap<Integer, android.graphics.RenderNode> active = new java.util.HashMap<>();
        private final int poolCap;
        private int created = 0;
        private int reused = 0;
        private int drawn = 0;

        public ListRenderer(int poolCap) { this.poolCap = poolCap; }

        public void acquireRow(int row, float x, float y, float w, float h, int color, String text) {
            android.graphics.RenderNode node = pool.pollLast();
            if (node == null) {
                node = new android.graphics.RenderNode("row-" + row);
                created++;
            } else {
                reused++;
            }
            node.setPosition((int) x, (int) y, (int) (x + w), (int) (y + h));
            android.graphics.RecordingCanvas rc = node.beginRecording();
            android.graphics.Paint paint = new android.graphics.Paint();
            paint.setColor(color);
            rc.drawRect(0f, 0f, w, h, paint);
            if (text != null) {
                android.graphics.Paint tp = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
                tp.setColor(android.graphics.Color.WHITE);
                tp.setTextSize(10f);
                rc.drawText(text, 4f, h * 0.75f, tp);
            }
            node.endRecording();
            active.put(row, node);
        }

        public void releaseRow(int row) {
            android.graphics.RenderNode node = active.remove(row);
            if (node == null) return;
            if (pool.size() < poolCap) pool.addLast(node);
        }

        /** 清空全部（回收所有 Row 到池） */
        public void releaseAll(java.util.List<Integer> rows) {
            for (Integer r : rows) releaseRow(r);
        }

        /** 绘制当前活跃行（逐个 drawRenderNode） */
        public void draw(android.graphics.Canvas canvas) {
            drawn++;
            for (android.graphics.RenderNode n : active.values()) {
                canvas.drawRenderNode(n);
            }
        }

        public boolean hasRow(int row) { return active.containsKey(row); }

        /** 释放窗口外的行（★滚动时的主要回收动作——不释放则内存随滚动累积） */
        public int releaseOutside(int from, int to) {
            int released = 0;
            java.util.Iterator<java.util.Map.Entry<Integer, android.graphics.RenderNode>> it = active.entrySet().iterator();
            java.util.List<android.graphics.RenderNode> back = new java.util.ArrayList<>();
            while (it.hasNext()) {
                java.util.Map.Entry<Integer, android.graphics.RenderNode> e = it.next();
                int row = e.getKey();
                if (row < from || row > to) {
                    android.graphics.RenderNode n = e.getValue();
                    if (pool.size() < poolCap) pool.addLast(n);
                    it.remove();
                    released++;
                }
            }
            return released;
        }

        public int activeCount() { return active.size(); }
        public int createdCount() { return created; }
        public int reusedCount() { return reused; }
        public int pooledCount() { return pool.size(); }
        public int drawCalls() { return drawn; }
        public double reuseRatio() {
            int total = created + reused;
            return total == 0 ? 0.0 : (double) reused / total;
        }
    }
}
