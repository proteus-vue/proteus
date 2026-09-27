package dev.proteus.layoutcore;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.view.View;

import java.util.List;

/**
 * ★宿主自绘 View（方案 §6.1 规格：**单个宿主 View + Canvas 下发，不走 ViewGroup 递归**）。
 *
 * 与原生对照组的差别正是 M2 要证明的事：
 *   原生   = 4050 个 View 对象各自 measure/layout/draw（View 体系递归）
 *   Proteus = 1 个 View + N 条绘制指令（无 View 树、无 View 体系递归）
 */
public class ProteusHostView extends View {
    /** 绘制指令（由 Rust 核心的布局结果生成） */
    public static final class Cmd {
        final float x, y, w, h;
        final int color;
        final String text;
        Cmd(float x, float y, float w, float h, int color, String text) {
            this.x = x; this.y = y; this.w = w; this.h = h; this.color = color; this.text = text;
        }
    }

    private List<Cmd> cmds = java.util.Collections.emptyList();
    private final Paint bgPaint = new Paint();
    /** 图集重放专用（用 shader 精确定位，避免 drawBitmap 的密度/插值干扰） */
    private final Paint atlasPaint = new Paint();
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    public ProteusHostView(Context context) {
        super(context);
        textPaint.setColor(Color.BLACK);
        textPaint.setTextSize(12f);
    }

    public void setCmds(List<Cmd> value) {
        this.cmds = value;
        invalidate();
    }

    public int cmdCount() { return cmds.size(); }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
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
     * ★M3 优化后的绘制路径（三条优化叠加）。
     * 与 `drawCmds`（基线）并列保留 —— 便于**同机对照归因**，而不是只看一个总数。
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

        // ③：文本（图集命中则重放位图；未命中退化为 drawText —— 见 atlasBitmapFor 的自适应说明）
        final android.graphics.Paint.FontMetrics fm = textPaint.getFontMetrics();
        final float baselineOffset = -fm.ascent;
        for (int i = 0; i < n; i++) {
            final Cmd c = list.get(i);
            if (c.text == null) continue;
            final android.graphics.Bitmap bm = atlasBitmapFor(c.text);
            if (bm != null) {
                // ★用 BitmapShader + 精确矩形 + **FILTER_BITMAP_FLAG 关闭**：
                //   关闭滤波即「最近邻采样」，避免双线性插值把字形边缘糊化
                //   （本仓实测：默认 drawBitmap 会与 drawText 产生 4.1% 亮度差，
                //     平均 2.2/255 但最大 76 —— 集中在笔画边缘，即采样差异）
                atlasPaint.setShader(new android.graphics.BitmapShader(bm,
                        android.graphics.Shader.TileMode.CLAMP, android.graphics.Shader.TileMode.CLAMP));
                atlasPaint.setFilterBitmap(false);
                canvas.drawRect(c.x + 1f, c.y + c.h * 0.8f - baselineOffset,
                        c.x + 1f + bm.getWidth(), c.y + c.h * 0.8f - baselineOffset + bm.getHeight(), atlasPaint);
                atlasPaint.setShader(null);
            } else {
                canvas.drawText(c.text, c.x + 1f, c.y + c.h * 0.8f, textPaint);
            }
        }
    }

    /** 报告图集规模（可观测：命中率与内存占用的证据） */
    public int atlasSize() { return textAtlas.size(); }
}
