// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/GlassInteraction.java
package dev.proteus.layoutcore;

import java.util.List;
import java.util.Map;

/**
 * ★★★决策 #1023：玻璃**交互子系统**（按下 / 长按拖动状态机 + 命中）——自 ProteusHostView 按职责拆出
 * （与 #1015 GlassBackdrop 同模式：状态内聚一处，宿主只做坐标折算与绘制读取）。
 *
 * <p>【拥有什么】press（按下强度 0..1，逐帧 lerp）· pressSubtree（按下组玻璃节点集）· touch（触点，盒局部 + 绝对）·
 * drag（横向跟手偏移 target/lerp 应用值/clamp 后实效值）· dragMoved/gestureScrolled（手势判定位）。</p>
 *
 * <p>【机制（iOS 18 tab bar 长按拖动视频取证 · 决策 #1023）】长按胶囊 ⇒ 膨胀成透镜（1.5× 宽）；
 * 拖 ⇒ lens 横向跟手（边缘色散拉丝）；松 ⇒ lerp 吸附回槽位 + 释放点 tab 选中。
 * 本类只管**状态推进**（tick 由宿主 onDraw 每帧调）；几何 clamp 在宿主 drawGlassPass（条几何在那里）。</p>
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
    /** 拖动：起点 x / 手指横移目标 / 逐帧 lerp 应用值 / clamp 后实效值（内容缩放段复用）。 */
    float dragStartX = -1e6f;
    float dragTarget = 0f, dragDx = 0f, dragAppliedDx = 0f;
    /** 拖动超阈标志（释放重定向 tap 的触发条件之一）。 */
    boolean dragMoved = false;
    /** 本手势期间 GestureDetector 是否已判 scroll（判过不会再发 tap ⇒ 释放重定向只在此时兜底派发）。 */
    boolean gestureScrolled = false;
    /** 当前"按下组"的玻璃节点集（命中 + 子树内玻璃）——供宿主判"是否点亮"。 */
    java.util.Set<Integer> pressSubtree = java.util.Collections.emptySet();

    /** 按下放大系数（对齐 iOS）——**条静止**（无系数）· **胶囊透镜**：横向 1.50× / 纵向 1.55× / 内容 1.20×·1.17×。 */
    static final float PRESS_SCALE_CAPSULE_X = 0.50f;   // ★#1023：0.14→0.50（iOS 视频取证：按下 lens ≈1.5× 宽）
    static final float PRESS_SCALE_CAPSULE_Y = 0.55f;   // 纵向 1.55×（溢出条外 = 透镜鼓出）
    static final float PRESS_CONTENT_SCALE_X = 0.20f;
    static final float PRESS_CONTENT_SCALE_Y = 0.17f;

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
                pressTarget = 1f;
                if (press < 0.01f) press = 0.01f;   // 立即起步（避免首帧无变化）
                return true;
            }
        }
        return false;
    }

    /** 拖动跟手（MOVE）——不重做 hit test（手指可移出条外 lens 仍跟手）；clamp 在宿主 drawGlassPass。 */
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
        dragDx = 0f; dragTarget = 0f; dragStartX = -1e6f; dragMoved = false;
    }

    /** 每帧推进（press + 拖拽 lerp）。返回 true = 未收敛，宿主应继续排帧（自持直到收敛即停）。 */
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
        return need;
    }
}
