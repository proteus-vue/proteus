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
 *
 * <p>【#1026 物理】质心弹簧-阻尼跟随手指：稳态滞后 ∝ 速度（拖尾）；急停 ⇒ 质心惯性**前冲越指**再弹回
 * （"车头前冲收窄成滴尖然后回收"，59fps 实测 +36% 宽过冲 / ~150ms 回收）——参数见 LAG_K/LAG_C。</p>
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
    // ★★★决策 #1026（iOS 19:14 录屏取证：急停时"车头前冲收窄成滴尖然后回收"）：**水滴质心的物理跟随**——
    //   bpos/bvel = 质心位置/速度，以**弹簧-阻尼**追手指（dragTarget）：
    //   · 稳态滞后 ∝ 速度（拖越快质心拖得越后 = 拖尾）；· **急停时质心惯性前冲**（越过手指）再弹回 = "车头前冲/回收"；
    //   · 校准（59fps 实测 a036：骤停瞬间宽 504px = 基准 +36%，150ms 回收到 402px = 25% 回收）
    //     ⇒ ζ=C/(2√K)=0.35（过冲 ~31%）/ 稳态滞后 = (C/K)·v = 3.5v px。
    float bpos = 0f, bvel = 0f;
    private static final float LAG_K = 0.040f;
    private static final float LAG_C = 0.140f;
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

    /** ★#1029：上一次 hover 派发的候选（拖动中变化才上报——防每帧刷 JS）。 */
    private int hoverNode = -1;
    /** ★#1029：拖动中刷新候选，**变化时返回新候选 id**（否则 -1）——宿主据此派发 hover。 */
    int hoverChanged() { if (dockNodeId == hoverNode) return -1; hoverNode = dockNodeId; return hoverNode; }
    /** ★#1029：手势收尾清零（下次拖动重新派发）。 */
    void hoverReset() { hoverNode = -1; }

    /** ★★★决策 #1027：**端部锥化**（signed；形变域 SDF 的 shp_a——>0=向右运动、前缘锥化，尾缘 0.45×）。 */
    float shapeTaper = 0f;
    /** 变形盒输出缓冲（复用——每帧每胶囊一次调用，避免分配）。 */
    private final float[] dockOut = new float[3];
    /** ★★★决策 #1029：当前停靠候选**节点 id**（拖动中变化 ⇒ 派发 hover 实时高亮；-1=无）。 */
    int dockNodeId = -1;
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
                lastDragTarget = 0f; velSmooth = 0f; bpos = 0f; bvel = 0f;   // 新手势 ⇒ 动力学归零（防上轮残留瞬跳）
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
        bpos = 0f; bvel = 0f;   // ★#1026：硬吸附到槽位（JS 新 hlLeft）⇒ 质心动力学同步清零
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
        // ★#1026：水滴质心弹簧-阻尼推进（惯性前冲/回收的动力学本体；按住期间始终步进）。
        if (nodeId >= 0 && pressTarget > 0.5f) {
            bvel += (dragTarget - bpos) * LAG_K - bvel * LAG_C;
            bpos += bvel;
            if (Math.abs(dragTarget - bpos) > 0.5f || Math.abs(bvel) > 0.4f) need = true;
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

    /** ★★★决策 #1028（用户「哪个选项落在胶囊里面的区域大就近停靠，不依赖手指的落点」）：
     *  释放时按**胶囊覆盖面积**选停靠 tab——返回派发点（重叠最大 tab 的中心；盒坐标空间 = 屏幕坐标）。
     *  · 候选 = 胶囊的**同父兄弟**（tab items；跳过玻璃兄弟）；面积 = lens 盒 ∩ 候选盒；
     *  · 全部无重叠（拖出条外）⇒ 就近（中心距 lens 中心最近）；找不到胶囊/候选 ⇒ null（调用方用释放点兜底）。 */
    float[] dockPick(List<ProteusHostView.Cmd> list, int[] ids,
                     java.util.Map<Integer, Integer> nodeParent,
                     java.util.Map<Integer, GlassMaterial.Spec> glassByNode) {
        if (list == null || ids == null || nodeId < 0) return null;
        // ① 胶囊 = 按下组内的**内层玻璃**（与外层条 nodeId 区分）
        ProteusHostView.Cmd capsule = null; int capsuleNode = -1;
        for (int k = 0; k < list.size() && k < ids.length; k++) {
            if (ids[k] != nodeId && glassByNode.get(ids[k]) != null && pressSubtree.contains(ids[k])) {
                capsule = list.get(k); capsuleNode = ids[k]; break;
            }
        }
        if (capsule == null) return null;
        // ② 胶囊当前（已拖拽/形变）盒——与 drawGlassPass 同源（capsuleBox 复用缓冲）
        final float[] cb = capsuleBox(capsule);
        final float lensCx = cb[0] + cb[2] * 0.5f;
        // ③ 候选 = 同父兄弟（tab items；跳过玻璃）
        final Integer parent = nodeParent.get(capsuleNode);
        if (parent == null) return null;
        ProteusHostView.Cmd pick = null; int pickId = -1; float pickArea = -1f, pickDist = Float.MAX_VALUE;
        for (int k = 0; k < list.size() && k < ids.length; k++) {
            if (ids[k] == capsuleNode || glassByNode.get(ids[k]) != null) continue;
            if (!parent.equals(nodeParent.get(ids[k]))) continue;
            final ProteusHostView.Cmd c = list.get(k);
            if (c.w <= 0f || c.h <= 0f) continue;
            final float ox = Math.min(cb[0] + cb[2], c.x + c.w) - Math.max(cb[0], c.x);
            final float oy = Math.min(cb[1] + cb[3], c.y + c.h) - Math.max(cb[1], c.y);
            final float area = (ox > 0f && oy > 0f) ? ox * oy : 0f;
            final float dist = Math.abs(c.x + c.w * 0.5f - lensCx);
            if (pick == null || area > pickArea + 0.5f || (Math.abs(area - pickArea) <= 0.5f && dist < pickDist)) {
                pick = c; pickArea = area; pickDist = dist; pickId = ids[k];
            }
        }
        if (pick == null) return null;
        if (debug) android.util.Log.i("proteus-glass", "GLASSDOCK lens=[" + String.format("%.0f..%.0f", cb[0], cb[0] + cb[2])
                + "] bpos=" + String.format("%.0f", bpos)
                + " pick=[" + String.format("%.0f..%.0f", pick.x, pick.x + pick.w) + "] area=" + String.format("%.0f", pickArea));
        dockNodeId = pickId;   // ★#1029：候选节点（hover 实时高亮用）
        dockOut[0] = pick.x + pick.w * 0.5f; dockOut[1] = pick.y + pick.h * 0.5f;
        return dockOut;
    }

    /** ★★★决策 #1023/#1024：按下胶囊的变形盒——按压膨胀（#1023）+ 拖拽跟手 + **速度驱动的液滴拉伸**（#1024：
     *  越快越扁长 = 横向拉伸 + 纵向压扁 + 尾迹偏置；lens 可溢出条端，不做条内 clamp）。
     *  写入 dragAppliedDx（内容缩放段复用）；返回复用缓冲 [bx, by, bw, bh]。 */
    float[] capsuleBox(ProteusHostView.Cmd gc) {
        final float sx = 1f + press * PRESS_SCALE_CAPSULE_X;
        final float sy = 1f + press * PRESS_SCALE_CAPSULE_Y;
        final float ccx = gc.x + gc.w * 0.5f, ccy = gc.y + gc.h * 0.5f;
        dragAppliedDx = bpos;   // ★#1026：内容跟随用**质心**（与透镜面同相位——惯性前冲时放大镜内容同步冲）
        float bx = ccx + bpos + (gc.x - ccx) * sx;
        float bw = gc.w * sx;
        float by = ccy + (gc.y - ccy) * sy;
        float bh = gc.h * sy;
        // ★#1024/#1026 液滴变形：速度 → 横向拉伸（尾迹偏置）/ 纵向压扁（中心不动）；
        //   #1026 起速度取 **max(手指 EMA, 质心速度)**（急停后手指停但质心仍在冲 ⇒ 畸形保持到回收期）。
        final float sp = Math.min(Math.max(Math.abs(velSmooth), Math.abs(bvel)), VEL_CAP);
        final float lagPx = dragTarget - bpos;   // >0=手指在前（拖动中）/ <0=质心越过手指（前冲相位）
        final float stretch = Math.min(STRETCH_MAX, sp * 0.024f + Math.abs(lagPx) * 0.008f) * press;
        final float flatten = Math.min(FLATTEN_MAX, sp * 0.012f) * press;
        if (stretch > 0.001f) {
            final float extraW = bw * stretch;
            // 方向：优先用质心速度（前冲相位仍朝原方向）；都小时退化不敏感
            final float dirV = Math.abs(bvel) > Math.abs(velSmooth) ? bvel : velSmooth;
            final boolean right = dirV >= 0f;
            final float extL = extraW * (right ? 0.65f : 0.35f);   // 尾迹（运动反侧）拉得更多 = 水滴感
            final float extR = extraW * (right ? 0.35f : 0.65f);
            bx -= extL; bw += extL + extR;
            by += bh * flatten * 0.5f; bh *= (1f - flatten);
        }
        // ★★★决策 #1027：端部锥化——速度+滞后驱动（越快越尖；dirT 符号给 host 定"哪端是前缘"）。
        //   上限 0.42（端头竖直收窄至 ~58% 高）；0 = 恒等（不触碰非按下路径）。
        // ★#1027 订正：方向**优先手指 EMA**（它保留"最后拖动方向"的记忆并渐衰）——急停瞬间 bvel 会先翻转
        //   （质心被拉回），若直取 bvel 会把滴尖瞬间换端；velSmooth 衰减后用 bvel（回收相位滴尖随实际运动）。
        final float dirT = Math.abs(velSmooth) > 0.5f ? velSmooth
                : (Math.abs(bvel) > Math.abs(velSmooth) ? bvel : velSmooth);
        shapeTaper = Math.min(0.42f, sp * 0.010f + Math.abs(lagPx) * 0.002f) * press * (dirT >= 0f ? 1f : -1f);
        if (debug && stretch > 0.01f) {
            android.util.Log.i("proteus-glass", "GLASSSTRETCH vel=" + String.format("%.1f", velSmooth)
                    + " bvel=" + String.format("%.1f", bvel) + " lag=" + String.format("%.1f", lagPx)
                    + " stretch=" + String.format("%.3f", stretch) + " flatten=" + String.format("%.3f", flatten)
                    + " taper=" + String.format("%.3f", shapeTaper)
                    + " w=" + String.format("%.0f", bw) + " h=" + String.format("%.0f", bh));
        }
        boxOut[0] = bx; boxOut[1] = by; boxOut[2] = bw; boxOut[3] = bh;
        return boxOut;
    }
}
