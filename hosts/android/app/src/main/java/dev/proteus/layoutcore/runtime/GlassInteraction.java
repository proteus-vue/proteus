// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/GlassInteraction.java
package dev.proteus.layoutcore;

import java.util.List;
import java.util.Map;

/**
 * ★★★决策 #1023/#1024：玻璃**交互子系统**（按下 / 长按拖动状态机 + 命中 + 速度驱动的液滴变形）——
 * 自 ProteusHostView 按职责拆出（与 #1015 GlassBackdrop 同模式：状态内聚一处，宿主只做坐标折算与绘制读取）。
 *
 * <p>【拥有什么】press（按下强度 0..1，逐帧 lerp）· pressSubtree（按下组玻璃节点集）· touch（触点，盒局部 + 绝对）·
 * drag（横向跟手偏移 target/lerp 应用值）· velSmooth（拖动速度 EMA——液滴变形的驱动量）·
 * dragMoved/gestureScrolled（手势判定位）。</p>
 *
 * <p>【机制（iOS 18 tab bar 长按拖动视频取证 · 决策 #1023/#1024）】长按胶囊 ⇒ 膨胀成透镜（1.5× 宽）；
 * 拖 ⇒ lens 横向跟手（边缘色散拉丝）+ **速度驱动的水滴变形**（越快越扁长：横向拉伸 + 纵向压扁 + 尾迹偏置，
 * 59fps 实测：最快帧宽 +15~25% / 高 −2~6%）；松 ⇒ lerp 吸附回槽位 + 释放点 tab 选中，速度量自然衰减（≈0.3s 落定）。</p>
 *
 * <p>【几何】lens 横向可**溢出条端**（iOS 视频实证：按在端部 tab 时 blob 盖过条端）⇒ 不做条内 clamp。</p>
 */
final class GlassInteraction {

    /** 活动交互玻璃节点 id（-1 = 无）。 */
    int nodeId = -1;
    /** 触点（命中盒局部 px）。 */
    float touchLocalX = -1e6f, touchLocalY = -1e6f;
    /** 触点绝对坐标（与命中盒坐标同空间；供 overlay 胶囊折算自身局部触点）。 */
    float touchAbsX = -1e6f, touchAbsY = -1e6f;
    /** 按下强度 0..1 与目标（逐帧 lerp）。 */
    float press = 0f, pressTarget = 0f;
    /** 拖动：起点 x / 手指横移目标 / 逐帧 lerp 应用值（= 传给绘制的偏移）。 */
    float dragStartX = -1e6f;
    float dragTarget = 0f, dragDx = 0f, dragAppliedDx = 0f;
    /** ★★★决策 #1024：拖动速度 EMA（px 每渲染帧 @≈60fps）——液滴变形驱动量（越快越扁长）。 */
    float velSmooth = 0f;
    private float lastDragTarget = 0f;
    /** 拖动超阈标志（释放重定向 tap 的触发条件之一）。 */
    boolean dragMoved = false;
    /** 本手势期间 GestureDetector 是否已判 scroll（判过不会再发 tap ⇒ 释放重定向只在此时兜底派发）。 */
    boolean gestureScrolled = false;
    /** 当前"按下组"的玻璃节点集（命中 + 子树内玻璃）——供宿主判"是否点亮"。 */
    java.util.Set<Integer> pressSubtree = java.util.Collections.emptySet();
    /** 调试日志（宿主的 `--es glassdbg 1` 同步过来；打印液滴变形量供判据）。 */
    static boolean debug = false;

    /** 按下放大系数（对齐 iOS）——**条静止**（无系数）· **胶囊透镜**：横向 1.50× / 纵向 1.55× / 内容 1.20×·1.17×。 */
    static final float PRESS_SCALE_CAPSULE_X = 0.50f;   // ★#1023：0.14→0.50（iOS 视频取证：按下 lens ≈1.5× 宽）
    static final float PRESS_SCALE_CAPSULE_Y = 0.55f;   // 纵向 1.55×（溢出条外 = 透镜鼓出）
    static final float PRESS_CONTENT_SCALE_X = 0.20f;
    static final float PRESS_CONTENT_SCALE_Y = 0.17f;
    /** ★#1024 液滴变形上限（59fps 校准：最快帧宽 +15~25% / 高 −2~6%，取上沿偏动感）。 */
    private static final float VEL_CAP = 40f;           // px/帧 上限（防瞬跳）
    private static final float STRETCH_MAX = 0.30f;     // 横向拉伸上限（+30% 宽）
    private static final float FLATTEN_MAX = 0.15f;     // 纵向压扁上限（−15% 高）

    /** 变形盒输出缓冲（复用——每帧每胶囊一次调用，避免分配）。 */
    private final float[] boxOut = new float[4];

    /** 命中交互玻璃（hx/hy = 命中坐标系；命中 ⇒ 记录触点与起点、press 起步）。返回 true = 命中。 */
    boolean hit(List<ProteusHostView.Cmd> list, int[] ids, Map<Integer, GlassMaterial.Spec> glassByNode, float hx, float hy) {
        for (int i = 0; i < list.size() && i < ids.length; i++) {
            final GlassMaterial.Spec g = glassByNode.get(ids[i]);
            if (g == null || !g.interactive) continue;
            final ProteusHostView.Cmd c = list.get(i);
            if (hx >= c.x && hx <= c.x + c.w && hy >= c.y && hy <= c.y + c.h) {
                nodeId = ids[i];
                touchLocalX = hx - c.x;
                touchLocalY = hy - c.y;
                touchAbsX = hx;
                touchAbsY = hy;
                dragStartX = hx;
                dragTarget = 0f; dragDx = 0f; dragAppliedDx = 0f; dragMoved = false;
                lastDragTarget = 0f; velSmooth = 0f;   // 新手势 ⇒ 速度归零（防上轮残留瞬跳）
                pressTarget = 1f;
                if (press < 0.01f) press = 0.01f;   // 立即起步（避免首帧无变化）
                return true;
            }
        }
        return false;
    }

    /** 拖动跟手（MOVE）——不重做 hit test（手指可移出条外 lens 仍跟手）。 */
    void drag(float hx, float hy) {
        if (nodeId < 0) return;
        touchAbsX = hx;
        touchAbsY = hy;
        if (dragStartX < -1e5f) dragStartX = hx;
        dragTarget = hx - dragStartX;
        if (Math.abs(dragTarget) > 16f) dragMoved = true;
    }

    /** 松手：press 目标 0（回弹）+ 拖拽目标 0（lens 吸附回槽位）。 */
    void release() {
        pressTarget = 0f;
        dragTarget = 0f;
    }

    /** 硬清零（UP 事件收尾——吸附立即生效，不等 lerp）。 */
    void resetDrag() {
        dragDx = 0f; dragTarget = 0f; dragStartX = -1e6f; dragMoved = false; lastDragTarget = 0f;
    }

    /** 每帧推进（press + 拖拽 lerp + 速度 EMA/衰减）。返回 true = 未收敛，宿主应继续排帧（自持直到收敛即停）。 */
    boolean tick() {
        boolean need = false;
        if (nodeId >= 0) {
            if (Math.abs(press - pressTarget) > 0.005f) {
                press += (pressTarget - press) * 0.28f;
                need = true;
            } else if (pressTarget == 0f) {
                press = 0f; nodeId = -1;   // 回弹完 ⇒ 收工
            } else {
                press = pressTarget;
            }
        }
        if (Math.abs(dragDx - dragTarget) > 0.5f) {
            dragDx += (dragTarget - dragDx) * 0.35f;
            need = true;
        } else if (dragDx != dragTarget) {
            dragDx = dragTarget;
            need = true;
        }
        // ★#1024：速度跟踪（按住时差分 EMA；停手/松手 ⇒ 衰减——液滴自然落定 ≈0.3s）。
        if (nodeId >= 0 && pressTarget > 0.5f) {
            final float vel = dragTarget - lastDragTarget;
            lastDragTarget = dragTarget;
            velSmooth += (vel - velSmooth) * 0.4f;
            if (Math.abs(velSmooth) > 0.3f) need = true;
        } else if (Math.abs(velSmooth) > 0.3f) {
            velSmooth *= 0.82f;
            need = true;
        } else {
            velSmooth = 0f;
        }
        return need;
    }

    /** ★★★决策 #1023/#1024：按下胶囊的变形盒——按压膨胀（#1023）+ 拖拽跟手 + **速度驱动的液滴拉伸**（#1024：
     *  越快越扁长 = 横向拉伸 + 纵向压扁 + 尾迹偏置；lens 可溢出条端，不做条内 clamp）。
     *  写入 dragAppliedDx（内容缩放段复用）；返回复用缓冲 [bx, by, bw, bh]。 */
    float[] capsuleBox(ProteusHostView.Cmd gc) {
        final float sx = 1f + press * PRESS_SCALE_CAPSULE_X;
        final float sy = 1f + press * PRESS_SCALE_CAPSULE_Y;
        final float ccx = gc.x + gc.w * 0.5f, ccy = gc.y + gc.h * 0.5f;
        dragAppliedDx = dragDx;
        float bx = ccx + dragDx + (gc.x - ccx) * sx;
        float bw = gc.w * sx;
        float by = ccy + (gc.y - ccy) * sy;
        float bh = gc.h * sy;
        // ★#1024 液滴变形：速度 → 横向拉伸（尾迹偏置）/ 纵向压扁（中心不动）。
        final float sp = Math.min(Math.abs(velSmooth), VEL_CAP);
        final float stretch = Math.min(STRETCH_MAX, sp * 0.024f) * press;
        final float flatten = Math.min(FLATTEN_MAX, sp * 0.012f) * press;
        if (stretch > 0.001f) {
            final float extraW = bw * stretch;
            final boolean right = velSmooth >= 0f;
            final float extL = extraW * (right ? 0.65f : 0.35f);   // 尾迹（运动反侧）拉得更多 = 水滴感
            final float extR = extraW * (right ? 0.35f : 0.65f);
            bx -= extL; bw += extL + extR;
            by += bh * flatten * 0.5f; bh *= (1f - flatten);
        }
        if (debug && stretch > 0.01f) {
            android.util.Log.i("proteus-glass", "GLASSSTRETCH vel=" + String.format("%.1f", velSmooth)
                    + " stretch=" + String.format("%.3f", stretch) + " flatten=" + String.format("%.3f", flatten)
                    + " w=" + String.format("%.0f", bw) + " h=" + String.format("%.0f", bh));
        }
        boxOut[0] = bx; boxOut[1] = by; boxOut[2] = bw; boxOut[3] = bh;
        return boxOut;
    }
}
