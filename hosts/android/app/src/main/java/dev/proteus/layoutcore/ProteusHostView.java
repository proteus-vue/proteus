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
}
