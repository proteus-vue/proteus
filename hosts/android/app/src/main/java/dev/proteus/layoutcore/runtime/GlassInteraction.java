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
    // ★★★决策 #1034（用户「相邻的切换过去还是缓冲那么大呢？这不合逻辑啊」）：**点击切换用独立弹簧**——
    //   #1030 曾直接复用上面的拖动参数（ζ=0.35）⇒ 换槽数学上**反向过冲 74px**（252px 相邻切换荡过目标
    //   ~1/3 格、振铃 ~0.6s@120Hz）——「车头前冲」是手指驱动的惯性（已验收），而点击切换是**自走迁移**，
    //   越界震荡不合逻辑（iOS 59fps 取证：飞行 2-4 帧即到站、无反向过冲）。ζ≈0.85：过冲 <1px 不可见；
    //   @120Hz 到站(±10px) 8 帧 ≈67ms · 全收敛 15 帧 ≈125ms（LAG_K/LAG_C 保持不动——只服务手指拖动）。
    //   ★★★决策 #1036（用户「是不是把点击切换的物理力学缓冲全部删除了？之前只说缓冲幅度不合理，没让你全部删除」
    //   +「一点儿缓冲都没有了，不符合物理视觉和人工力学」）：**ζ 0.85→0.55——保留适度过冲**（14.5px = 5.7%，
    //   13 帧落定）。#1034 把「过冲 74px 不合理」响应成了「零过冲」= **过度修正**——弹性回弹本身是
    //   用户认可的物理手感要素，修手感是**调参**（过大→适中）不是**消项**（归零）。K 不动，C=2ζ√K 是唯一自由度。
    //   ★调参注意：ζ 是**名义值**——本积分器（显式 Euler · dt=1）在 C=1.00 时判别式 1-C=0（退化为无振荡
    //   一阶响应，这就是 #1034「零过冲」的数学原因）；ζ=0.55 的**离散等效约 0.68**，实测过冲 5.73%
    //   （连续公式会报 12.6%）。**改 C 前必须用离散积分复算，不要套连续过冲表。**
    // ★★★决策 #1038（2026-10-17 · **iOS 两边缘取证后的结构性重写**）：
    //   用户「效果还是不对」。四路拆解（iOS 59fps 逐帧几何 + 我们 24fps 逐帧 + 代码路径 + 公开逆向）后，
    //   结论是**模型错了，不是参数错了**：iOS 的切换不是「刚体平移 + 速度驱动的附加拉伸」，而是
    //   **胶囊的两条边缘各用一条弹簧追各自的目标**——前缘先走（~190ms 到站、越界约 15%），
    //   后缘晚 2–4 帧起步且慢得多（~420ms）⇒ **宽度被两边缘的间距撑开 1.48–1.62×**，中心几乎不过冲（≤1.5px）。
    //   我们旧模型（单 bpos 弹簧 + 速度×小系数拉伸）在数学上**永远做不出这个签名**：
    //   刚体只有一个自由度 ⇒ 中心过冲而宽度恒 ≈1.0×（实测 1.035×），与 iOS 正好相反。
    //   ⇒ 改为两边缘独立弹簧：lead=前缘（快、近临界）/ trail=后缘（延迟 + 慢）。
    //   离散标定（@120Hz，与 iOS 59fps 实测对齐）：宽度峰值 **1.47× @117ms** · 中心 95% 行程 **358ms** ·
    //   宽度收拢 **467ms**（iOS：1.48–1.62× / 305ms / 441ms）。**宽度上限 1.55×**（iPhone 一格 ≈ 252px）。
    private static final float FLOW_LEAD_K = 0.023f;
    private static final float FLOW_LEAD_C = 0.267f;   // ζ≈0.88（前缘不甩尾；形变由两边缘差产生，不靠过冲）
    private static final float FLOW_TRAIL_K = 0.013f;
    private static final float FLOW_TRAIL_C = 0.201f;  // ζ≈0.88
    private static final int FLOW_TRAIL_DELAY = 8;     // 后缘起步延迟（标准步；iOS 59fps 2–4 帧 ⇒ @120Hz 4–8）
    private static final float FLOW_MAX_STRETCH = 0.55f;  // 宽度最多撑到 1.55×（再大就越过多格）
    /** ★#1041：hover 高亮所需的**真实形状覆盖率**。
     *  几何推导（胶囊与槽同宽 252）：cover = 胶囊压入槽的深度 / 252。
     *   · cover=0.28 ⇒ 胶囊中心还在目标槽左侧 **56px**（只有端部圆角擦到）= 用户说的「端部刚接触就变色」；
     *   · cover=0.50 ⇒ 胶囊边缘**到达目标图标中心**（图标一半在玻璃下）⇒ 这才是"真实接触"。
     *  注意：**点击切换**不走这条（tap 时目标已知，JS 立即高亮，与 iOS 一致）；这里只管**拖动 hover**。 */
    private static final float HOVER_MIN_COVER = 0.50f;
    /** 拖动超阈标志（释放重定向 tap 的触发条件之一）。 */
    boolean dragMoved = false;
    /** 本手势期间 GestureDetector 是否已判 scroll（判过不会再发 tap ⇒ 释放重定向只在此时兜底派发）。 */
    boolean gestureScrolled = false;
    /** 当前"按下组"的玻璃节点集（命中 + 子树内玻璃）——供宿主判"是否点亮"。 */
    java.util.Set<Integer> pressSubtree = java.util.Collections.emptySet();
    /** 调试日志（宿主的 `--es glassdbg 1` 同步过来；打印液滴变形量供判据）。 */
    static boolean debug = false;

    /** 按下放大系数（对齐 iOS）——**条静止**（无系数）· **胶囊透镜**：横向 1.50× / 纵向 1.55× / 内容 1.20×·1.17×。 */
    // ★★★决策 #1033（用户「膨胀时水平方向不可能超出一个选项的宽度」+「水平幅度明显过大」）：**X 0.42→0.0（水平 1.0×，不放大）**。
    //   依据：① 胶囊宽度 84px 逻辑 = **252px 物理 = 恰好一个选项宽（顶格）** ⇒ 任何 X>1.0 必然越界；
    //   ② iOS 静止长按实测（v1023 f0030 vs f0080）：宽 **284→288px（仅 +1.4%）**、高度才是膨胀主体——
    //   #1023/#1031 的 X=0.42/0.50 是**从"按下+拖动"的帧上估的**（含拖动拉伸，把液滴拉伸当成了静压膨胀）。
    //   ⇒ 各向异性是 iOS 的真实行为（水平 ≈1.0 / 垂直 1.30），"等比放大"在几何上与本约束互斥。
    static final float PRESS_SCALE_CAPSULE_X = 0.0f;    // ★#1033：水平不放大（≤ 选项宽 252px）
    static final float PRESS_SCALE_CAPSULE_Y = 0.41f;   // ★#1043：0.30→0.41（1.41× / 相对**条高** 1.21×）
                                                        //   【为什么必须加大】#1031 取 0.30 只溢出 9.6px/侧 —— 而折射把条边
                                                        //   （源距胶囊边 9.6px）**压到显示位 3.5px**，正好落在 3.4px 的亮脊底下 ⇒
                                                        //   条边**永远看不见**（用户「胶囊玻璃无法透过去看到玻璃条的上下边」）。
                                                        //   iOS 1442 段实测：透镜高/条高 = **1.19–1.22**、溢出条 **19–22px** ⇒
                                                        //   0.41（144→203px，溢出 17.5px）既对齐 iOS，又让条边显示在 d≈16px（远离亮脊）。
                                                        //   ★这不违背 #1031「稍微溢出就行」：0.55 是每侧 27.5px（用户嫌大），0.41 是 17.5px = iOS 真值。
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

    // ★★★决策 #1030/#1034/#1035/#1036/#1038 —— 点击流动的演进（下面是**当前**模型）：
    //   tap 时捕获胶囊**视觉位**，JS 改 hlLeft 重排后 applyFlow 初始化。
    //   ★#1038 重写：不再用单一 bpos 质心弹簧（那只能产生"刚体平移"，宽度恒 ≈1.0×），
    //   改为 **两条边缘各自一条弹簧**（lead/trail，见 FLOW_LEAD_*/FLOW_TRAIL_*）：
    //     · leadP = 前缘（运动方向那一侧）相对新槽位的偏移 · trailP = 后缘；
    //     · 宽度 = 槽宽 + |leadP − trailP|（后缘被"留在后面"⇒ 撑开），中心 = (leadP+trailP)/2；
    //     · 两者都收敛到 0 ⇒ 自动回到槽位（宽度自动收拢，无需额外收回逻辑）。
    //   ⇒ 中心几乎不过冲（两边缘同向收敛），而**宽度显著撑开再收拢**——这正是 iOS 实测签名。
    private boolean flowActive = false, flowPending = false;
    private int flowNode = -1;
    /** 前缘/后缘相对新槽位的偏移（px，指向旧槽方向为正）+ 速度。 */
    private float leadP = 0f, leadV = 0f, trailP = 0f, trailV = 0f;
    /** 后缘延迟计数（>0 时后缘不积分——iOS 后缘晚 2–4 帧@59fps 起步）。 */
    private int flowTrailWait = 0;
    /** 本次流动的行程（带符号：>0 = 向右移动）与槽宽——用于归一化与宽度上限。 */
    private float flowFrom = 0f, flowSlotW = 252f;
    private float flowOldVisual = 0f;
    /** 流动已进行帧数（供 lift 包络与调试）。 */
    private int flowFrames = 0;

    /** 命中判定：该节点正是**流动中的胶囊**（宿主 drawGlassPass 据此走 capsuleBox 形变路径）。 */
    boolean isFlowNode(int id) { return flowActive && id == flowNode; }

    /** ★#1041：内容绘制回调——宿主包一层 `drawCmds(canvas, null, gContent)` 传进来，
     *  让「内容缩放窗口/裁剪」留在交互子系统内（几何只有一个来源），宿主不重复实现裁剪。 */
    interface ContentDrawer { void draw(android.graphics.Canvas c); }

    /** ★★★#1040/#1041/#1043/#1044：内容层绘制（**只在胶囊外**画清晰内容）。
     *  · 静止（capP≈0）：原样画一遍。
     *  · 抬起（press/flow）：先画**胶囊之外**（原样清晰），**胶囊内留给玻璃面**——因为复合层现已含
     *    图标/文字（#1044），胶囊的折射/放大/色散会真实作用在它们上面
     *    （与 iOS `_UIPortalView + displacementMap` 同构）。
     *    ★此前把清晰内容整块盖在胶囊上 ⇒ 折射像被完全覆盖 ⇒ 用户「经过图标文字时没有真实的光学折射」。 */
    void drawScaledContent(android.graphics.Canvas canvas, ProteusHostView.Cmd capCmd, float capP,
                           boolean isFlow, int scrollX, int scrollY, android.graphics.Path path,
                           boolean interiorFromGlass, ContentDrawer drawer) {
        // ★★★#1047：`interiorFromGlass=true` = 复合层可用 ⇒ 胶囊**内部**留给玻璃面（折射真实作用在内容上）；
        //   `false` = 层不可用 ⇒ **必须**把清晰内容也画进胶囊，否则内部只剩空采样 = 空白（用户反复报告的"滑到哪哪空白"）。
        if (capP <= 0.001f || !interiorFromGlass) { drawer.draw(canvas); return; }
        final float lw = lastCapsuleBox[2], lh = lastCapsuleBox[3];
        if (lw <= 1f || lh <= 1f) { drawer.draw(canvas); return; }
        final float lx = lastCapsuleBox[0] + scrollX, ly = lastCapsuleBox[1] + scrollY;
        final float lr = Math.min(lw, lh) * 0.5f;
        path.reset();
        path.addRoundRect(lx, ly, lx + lw, ly + lh, lr, lr, android.graphics.Path.Direction.CW);
        pathB.reset();
        pathB.addRect(-1e6f, -1e6f, 1e6f, 1e6f, android.graphics.Path.Direction.CW);
        pathB.op(path, android.graphics.Path.Op.DIFFERENCE);
        final int sv = canvas.save();
        canvas.clipPath(pathB);
        drawer.draw(canvas);
        canvas.restoreToCount(sv);
    }
    /** ★#1042：补画四角的差集路径（#1043 改为两遍绘制后不再使用，保留字段避免改动面扩大）。 */
    private final android.graphics.Path pathB = new android.graphics.Path();

    /** ★#1038：当前流动胶囊的**实际撑开比例**（bw/槽宽）——内容按此做透镜式放大（iOS 1.15→1.4×）。 */
    private float flowSpanRatio = 1f;
    float flowSpanRatio() { return flowActive ? flowSpanRatio : 1f; }
    /** ★#1039：按压/流动胶囊的**接触影**（复用宿主 paint；多层同心圆角矩形近似软阴影）。
     *  iOS 实测（亮底 B 帧 + 暗底 press3）：紧贴底缘 −18…−25/255、**向下偏 4–5px**、模糊 3–7px。
     *  此前胶囊**完全没有投影** ⇒ 缺"浮在条上"的深度线索，按压态读作"贴纸"（用户「没有生命力」）。 */
    void drawPressShadow(android.graphics.Canvas canvas, android.graphics.Paint paint,
                         float bx, float by, float bw, float bh) {
        final float sp = Math.max(press, lift);
        if (sp <= 0.02f) return;
        // ★实测校正（2026-10-17 真机）：首版 a0=0.30×255 + 6 层叠加 ⇒ 底缘实测 **183/255（−60）**，
        //   而 iOS 只有 −18…−25；且整圈外扩导致**胶囊上方也出现暗晕**（物理上不对）。
        //   ⇒ ① alpha 0.30→0.11（多层累加后约 −22）；② 只在**下半部**画（裁掉上缘，投影只向下）。
        final int a0 = (int) (0.11f * 255 * sp);
        final float rr = Math.min(bw, bh) * 0.5f;
        final float dy = 4f * sp;
        final int sc = canvas.save();
        canvas.clipRect(bx - 40f, by + bh * 0.55f, bx + bw + 40f, by + bh + dy + 20f);
        for (int k = 5; k >= 1; k--) {
            final float grow = k * 1.5f;
            final int aa = a0 / (k + 1);
            if (aa <= 0) continue;
            paint.setColor(aa << 24);
            canvas.drawRoundRect(bx - grow, by + dy - grow, bx + bw + grow, by + bh + dy + grow,
                    rr + grow, rr + grow, paint);
        }
        canvas.restoreToCount(sc);
    }
    /** ★#1038：内容缩放系数 [sx, sy]——flow 用**实际撑开比例**（横向跟满、纵向只跟 35% 的各向异性，
     *  对齐 iOS 实测"图标横向 1.2–1.7× / 纵向 1.08–1.14×"）；按压路径用固定 1.20×/1.17×。 */
    private final float[] contentScaleOut = new float[2];
    float[] contentScale(float capP, boolean isFlow) {
        if (isFlow) {
            final float r = Math.max(1f, flowSpanRatio);
            contentScaleOut[0] = r;
            contentScaleOut[1] = 1f + (r - 1f) * 0.35f;
        } else {
            contentScaleOut[0] = 1f + capP * PRESS_CONTENT_SCALE_X;
            contentScaleOut[1] = 1f + capP * PRESS_CONTENT_SCALE_Y;
        }
        return contentScaleOut;
    }

    // ★★★决策 #1032（材质相位）· ★#1038 改成**独立时间包络**（不再由位移比例 remain 触发）：
    //   iOS 实测（59fps 逐帧 4 次切换）：拉伸峰值（120–190ms）→ **精确 3 帧全透明（≈51ms）** → 中心到站（305ms）
    //   → 宽度收拢（441ms）→ 约 220–250ms 回霜。⇒ 三段：起跳升（~70ms）→ 飞行保持（含全透明峰）→ 落地收。
    //   旧实现用 `remain=|bpos|/|Δ|>0.18` 当开关，但线性弹簧归一化后该比例**与步长无关**、总在第 6 帧
    //   一步从 30% 跳到 7.3%（18% 从未被命中）⇒ 实际是"固定第 6 帧触发"，不是按行程自适应。
    private float lift = 0f;
    float lift() { return lift; }
    /** ★#1032：某节点的**有效按压**（物理按下 或 flow lift——流动胶囊的"膨胀透明"由此进入 shader）。 */
    float effPress(int nodeId) {
        float p = (nodeId == this.nodeId || pressSubtree.contains(nodeId)) ? press : 0f;
        if (flowActive && nodeId == flowNode) p = Math.max(p, lift);
        return p;
    }

    /** 找**内层胶囊**（玻璃且祖先是玻璃）——流动与 dockPick 的候选锚点同源（"胶囊身体"）。 */
    private int findCapsule(List<ProteusHostView.Cmd> list, int[] ids,
                            Map<Integer, GlassMaterial.Spec> glassByNode,
                            java.util.Map<Integer, Integer> nodeParent) {
        if (list == null || ids == null) return -1;
        for (int k = 0; k < list.size() && k < ids.length; k++) {
            if (glassByNode.get(ids[k]) == null) continue;
            Integer cur = nodeParent.get(ids[k]); int guard = 0;
            while (cur != null && guard++ < 256) { if (glassByNode.containsKey(cur)) return ids[k]; cur = nodeParent.get(cur); }
        }
        return -1;
    }

    /** ★#1030：tap 捕获（**必须在 JS 改 hlLeft 之前**调——此时 cmds 仍是旧几何）。 */
    void captureTap(List<ProteusHostView.Cmd> list, int[] ids,
                    Map<Integer, GlassMaterial.Spec> glassByNode,
                    java.util.Map<Integer, Integer> nodeParent) {
        flowPending = false; flowNode = -1;
        final int cap = findCapsule(list, ids, glassByNode, nodeParent);
        if (cap < 0) return;
        for (int k = 0; k < list.size() && k < ids.length; k++) {
            if (ids[k] == cap) {
                final ProteusHostView.Cmd c = list.get(k);
                flowOldVisual = c.x + c.w * 0.5f + bpos;   // 视觉位（基位 + 当前偏移——二次点击从当前位置续走）
                flowNode = cap; flowPending = true;
                return;
            }
        }
    }

    /** ★#1030：relayout 后初始化流动（drawGlassPass 调一次）——基位移动 |Δ|>6px 才启动。 */
    void applyFlow(List<ProteusHostView.Cmd> list, int[] ids,
                   Map<Integer, GlassMaterial.Spec> glassByNode,
                   java.util.Map<Integer, Integer> nodeParent) {
        if (!flowPending) return;
        flowPending = false;
        if (flowNode < 0 || list == null || ids == null) return;
        for (int k = 0; k < list.size() && k < ids.length; k++) {
            if (ids[k] != flowNode) continue;
            final ProteusHostView.Cmd c = list.get(k);
            final float delta = flowOldVisual - (c.x + c.w * 0.5f);
            if (Math.abs(delta) > 6f) {
                // ★#1038：两边缘都从旧视觉位出发（= 相对新槽位的偏移 Δ），目标都是 0。
                //   前缘立即起跑、后缘延迟 FLOW_TRAIL_DELAY 帧 ⇒ 宽度自动撑开 |leadP−trailP|。
                flowActive = true; flowFrom = delta; flowSlotW = Math.max(c.w, 1f);
                leadP = delta; leadV = 0f; trailP = delta; trailV = 0f;
                flowTrailWait = FLOW_TRAIL_DELAY; flowFrames = 0;
                bpos = delta; bvel = 0f;      // 兼容旧读数（内容跟随/调试日志）；每帧由两边缘均值刷新
                dragTarget = 0f; lift = 0.22f;
            }
            return;
        }
    }

    /** ★★★决策 #1027：**端部锥化**（signed；形变域 SDF 的 shp_a——>0=向右运动、前缘锥化，尾缘 0.45×）。 */
    float shapeTaper = 0f;
    /** 变形盒输出缓冲（复用——每帧每胶囊一次调用，避免分配）。 */
    private final float[] dockOut = new float[3];
    /** ★★★决策 #1029：当前停靠候选**节点 id**（拖动中变化 ⇒ 派发 hover 实时高亮；-1=无）。 */
    int dockNodeId = -1;
    private final float[] boxOut = new float[4];
    /** ★#1041：最近一帧胶囊**实际绘制盒**（bx,by,bw,bh）——内容放大区按它裁剪（见 ProteusHostView）。
     *  此前内容段用「通高矩形条」裁剪 ⇒ 胶囊圆角外侧（水滴没到的地方）的内容也被放大，
     *  用户「不是胶囊真实接触的位置」。 */
    private final float[] lastCapsuleBox = new float[4];
    float[] lastCapsuleBox() { return lastCapsuleBox; }

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
                flowActive = false; flowPending = false; lift = 0f;
                leadP = leadV = trailP = trailV = 0f; flowTrailWait = 0;   // ★#1038：按下即接管（清两边缘流动）
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
    /** 上一帧时间戳（ns）与 dt 归一化系数——★#1038：所有系数是「@120Hz 每帧」量，
     *  真机实测玻璃绘制只有 ~35fps ⇒ 帧锁会让动画慢 3 倍（1047ms vs 设计 350ms）。
     *  ⇒ 每帧把系数按 `dt / 8.333ms` 缩放（clamp 0.5..3.0），让**墙钟时长与刷新率无关**。 */
    private long lastTickNs = 0L;
    private float dtScale = 1f;

    boolean tick() {
        boolean need = false;
        // ★#1038：dt 归一化（以 @120Hz 的 8.333ms 为 1 个"帧"）——所有 k 都是按 120Hz 标定的每帧量。
        final long nowNs = System.nanoTime();
        if (lastTickNs != 0L) {
            final float dtMs = (nowNs - lastTickNs) / 1e6f;
            dtScale = Math.min(3.0f, Math.max(0.5f, dtMs / 8.333f));
        }
        lastTickNs = nowNs;
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
        // ★#1038：**两边缘弹簧**（前缘立即追、后缘延迟起步）——宽度由两边缘间距产生，中心几乎不过冲。
        if (flowActive) {
            flowFrames++;
            // ★#1038：**子步积分**（不是"系数乘 dt"）——半隐式 Euler 对系数缩放不是线性等价的，
            //   实测直接乘 dt 会让尾段慢一倍（center95% 521ms vs 设计 275ms）。
            //   把 dt 折成 n 个 @120Hz 标准步（每步用原始系数）⇒ 墙钟时长与刷新率严格无关。
            final int sub = Math.max(1, Math.min(6, Math.round(dtScale)));
            for (int s = 0; s < sub; s++) {
                leadV += (0f - leadP) * FLOW_LEAD_K - leadV * FLOW_LEAD_C;
                leadP += leadV;
                if (flowTrailWait > 0) {
                    flowTrailWait--;   // 延迟按"标准步"计（≈50ms，与刷新率无关）
                } else {
                    trailV += (0f - trailP) * FLOW_TRAIL_K - trailV * FLOW_TRAIL_C;
                    trailP += trailV;
                }
            }
            // 兼容旧读数：bpos = 中心偏移（内容跟随/调试日志沿用），bvel = 中心速度。
            final float prevCenter = bpos;
            bpos = (leadP + trailP) * 0.5f;
            bvel = bpos - prevCenter;
            need = true;
            // ★#1038：lift = **独立时间包络**（起跳快升 → 飞行保持 → 靠站后慢降），不再绑位移比例。
            // ★★★决策 #1042（用户「恢复为静态胶囊的自然过渡」）：**保持到真正到站**（done>0.02，此前 0.15 ⇒ 走完 85%
            //   就开始退霜，此时宽度还有 1.17×，与 iOS「飞行全透明 → 到站后回霜」不符）。
            //   回霜速率按 iOS 1442 实测：**释放后约 390ms**（两段式 250→239 仅 102ms + 慢尾 254ms）⇒ 取 ~0.10/标准步。
            final float done = Math.abs(bpos) / Math.max(Math.abs(flowFrom), 1f);
            final float liftT = done > 0.02f ? 1f : 0f;
            float lk = liftT > lift ? 0.45f : 0.10f;
            for (int s = 0; s < sub; s++) lift += (liftT - lift) * lk;
            // 收敛：两边缘都贴近 0 且速度近 0（此时宽度已自回收拢）。
            if (Math.abs(leadP) < 0.5f && Math.abs(leadV) < 0.3f
                    && Math.abs(trailP) < 0.5f && Math.abs(trailV) < 0.3f) {
                flowActive = false; leadP = trailP = leadV = trailV = 0f; bpos = 0f; bvel = 0f;
            }
        }
        // ★#1032：落地收回——flow 结束（bpos 收敛）后 lift 衰减 ⇒ 透明玻璃收成灰色胶囊。
        if (!flowActive && lift > 0.01f) {
            lift += (0f - lift) * 0.26f;
            if (lift < 0.01f) lift = 0f;
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
    /** ★★★决策 #1041：**胶囊真实形状**内点判定（圆角矩形 stadium + 端部锥化）——与 shader `sd_glass` 同形。
     *  判定区域不能是包围盒：胶囊两端是半圆（r = min(bw,bh)/2），盒子四角在形状之外 ⇒ 用矩形求交会在
     *  "端部还没真正碰到"时就把邻项判为已覆盖（用户「判定区域是矩形，不是胶囊真实接触的位置」）。 */
    private static boolean insideCapsule(float px, float py, float bx, float by,
                                         float bw, float bh, float rad, float taper) {
        final float hx = bw * 0.5f, hy = bh * 0.5f;
        final float cx = bx + hx, cy = by + hy;
        final float nx = Math.max(-1f, Math.min(1f, (px - cx) / Math.max(hx, 1f)));
        // 与 glass.wgsl 的 sd_glass 同式：运动端满锥化、反端 0.45×
        final float tipR = Math.max(taper, 0f), tipL = Math.max(-taper, 0f);
        final float tp = nx >= 0f ? tipR + 0.45f * tipL : tipL + 0.45f * tipR;
        final float ym = Math.max(1f - tp * nx * nx, 0.15f);
        final float dx = Math.abs(px - cx) - (hx - rad);
        final float dy = Math.abs((py - cy) / ym) - (hy - rad);
        final float ox = Math.max(dx, 0f), oy = Math.max(dy, 0f);
        return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0f) - rad <= 0f;
    }

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
        float pickCover = 0f;
        // ★#1041：用**胶囊真实形状**（stadium + 锥化）在候选盒上采样覆盖，替代矩形求交。
        final float rad = Math.min(cb[2], cb[3]) * 0.5f;
        for (int k = 0; k < list.size() && k < ids.length; k++) {
            if (ids[k] == capsuleNode || glassByNode.get(ids[k]) != null) continue;
            if (!parent.equals(nodeParent.get(ids[k]))) continue;
            final ProteusHostView.Cmd c = list.get(k);
            if (c.w <= 0f || c.h <= 0f) continue;
            int hits = 0, total = 0;
            for (int gy = 0; gy < 7; gy++) {
                for (int gx = 0; gx < 7; gx++) {
                    total++;
                    if (insideCapsule(c.x + (gx + 0.5f) * c.w / 7f, c.y + (gy + 0.5f) * c.h / 7f,
                            cb[0], cb[1], cb[2], cb[3], rad, shapeTaper)) hits++;
                }
            }
            final float cover = hits / (float) total;
            final float area = cover * c.w * c.h;
            final float dist = Math.abs(c.x + c.w * 0.5f - lensCx);
            if (pick == null || area > pickArea + 0.5f || (Math.abs(area - pickArea) <= 0.5f && dist < pickDist)) {
                pick = c; pickArea = area; pickDist = dist; pickId = ids[k]; pickCover = cover;
            }
        }
        if (pick == null) return null;
        if (debug) android.util.Log.i("proteus-glass", "GLASSDOCK lens=[" + String.format("%.0f..%.0f", cb[0], cb[0] + cb[2])
                + "] bpos=" + String.format("%.0f", bpos)
                + " pick=[" + String.format("%.0f..%.0f", pick.x, pick.x + pick.w) + "] cover=" + String.format("%.2f", pickCover));
        // ★#1041：**hover 高亮需要真实覆盖到阈值**才点亮——端部刚擦到（cover 很小）不算"接触"，
        //   否则会出现用户说的「水滴端部开始接触时，没接触的地方也变色」。
        dockNodeId = (pickCover >= HOVER_MIN_COVER) ? pickId : -1;
        dockOut[0] = pick.x + pick.w * 0.5f; dockOut[1] = pick.y + pick.h * 0.5f;
        return dockOut;
    }

    /** ★★★决策 #1023/#1024：按下胶囊的变形盒——按压膨胀（#1023）+ 拖拽跟手 + **速度驱动的液滴拉伸**（#1024：
     *  越快越扁长 = 横向拉伸 + 纵向压扁 + 尾迹偏置；lens 可溢出条端，不做条内 clamp）。
     *  写入 dragAppliedDx（内容缩放段复用）；返回复用缓冲 [bx, by, bw, bh]。 */
    float[] capsuleBox(ProteusHostView.Cmd gc) {
        final float bulge = Math.max(press, lift);   // ★#1032：流动胶囊的"起跳膨胀"由 lift 驱动
        final float ccx = gc.x + gc.w * 0.5f, ccy = gc.y + gc.h * 0.5f;
        float bx, bw, by, bh;
        // ★★★#1038：**flow 走两边缘盒**——左右边界由 lead/trail 各自决定（不是"刚体 + 拉伸系数"）：
        //   运动方向那一侧的边缘 = 前缘（跑得快），反侧 = 后缘（延迟 + 慢）⇒ 盒宽自然被撑开后收拢。
        //   宽度上限 FLOW_MAX_STRETCH（1.55×），避免多格切换时横跨过多选项。
        if (flowActive) {
            final boolean rightward = flowFrom < 0f;   // Δ<0 表示向右移动（旧视觉位在左）
            // 相对新槽位的偏移：正方向（+x）的前/后缘分别是 right−left 边
            final float leadOff = leadP, trailOff = trailP;
            float leftOff = rightward ? trailOff : leadOff;   // 左边缘的偏移
            float rightOff = rightward ? leadOff : trailOff;  // 右边缘的偏移
            // 宽度上限（按槽宽归一）：两边缘间距最多撑到 slotW*(1+FLOW_MAX_STRETCH)
            final float maxSpan = flowSlotW * (1f + FLOW_MAX_STRETCH);
            float span = flowSlotW + (rightOff - leftOff);
            if (span > maxSpan) {                 // 超限 ⇒ 对称压缩两边缘（保中心）
                final float half = (span - maxSpan) * 0.5f;
                leftOff += half; rightOff -= half; span = maxSpan;
            }
            bx = gc.x + leftOff;
            bw = Math.max(span, flowSlotW * 0.35f);
            flowSpanRatio = bw / Math.max(flowSlotW, 1f);
            dragAppliedDx = (leadP + trailP) * 0.5f;   // 内容跟随中心
            // 纵向：仍按 lift 鼓起（膨胀是材质体积，不是横向拉宽）
            by = ccy + (gc.y - ccy) * (1f + bulge * PRESS_SCALE_CAPSULE_Y);
            bh = gc.h * (1f + bulge * PRESS_SCALE_CAPSULE_Y);
            // ★★★决策 #1042：锥化改由**两边缘间距**驱动（不再只看速度）。
            //   ★★★#1043 订正（用户「左上右上部分感觉被截断」）：**系数 0.75 → 0.28**——
            //   `sd_glass` 的 `ym = 1 − taper·nx²` 是**叠加在 stadium 自身收窄之上**的：taper=0.39 时
            //   nx=±0.8 处 ym=0.75（再收窄 25%），与半圆截面叠加后剪影变成**橄榄/菱形**，
            //   端部上下被削平 = 用户看到的"左上右上被截断"。
            //   iOS 实测「端部比 stadium 再收窄 10–25%」= **阶跃后额外量**，映射到 ym 上约 0.10–0.18
            //   ⇒ spanN 峰值 0.52 × 0.28 ≈ **0.146**（落在 iOS 区间）。
            final float spanN = Math.min(1f, Math.abs(leadP - trailP) / Math.max(flowSlotW, 1f));
            final float tapK = Math.min(0.18f, spanN * 0.28f);
            shapeTaper = tapK * bulge * (rightward ? 1f : -1f);   // 锥化端 = 运动前缘（右移 ⇒ +x 端）
            if (debug) {
                android.util.Log.i("proteus-glass", "GLASSSTRETCH flow lead=" + String.format("%.1f", leadP)
                        + " trail=" + String.format("%.1f", trailP) + " span=" + String.format("%.0f", bw)
                        + " ratio=" + String.format("%.3f", bw / Math.max(flowSlotW, 1f))
                        + " center=" + String.format("%.1f", dragAppliedDx)
                        + " stretch=" + String.format("%.3f", bw / Math.max(flowSlotW, 1f) - 1f)
                        + " taper=" + String.format("%.3f", shapeTaper)
                        + " lift=" + String.format("%.2f", lift)
                        + " dt=" + String.format("%.2f", dtScale)
                        + " f=" + flowFrames
                        + " w=" + String.format("%.0f", bw) + " h=" + String.format("%.0f", bh));
            }
            boxOut[0] = bx; boxOut[1] = by; boxOut[2] = bw; boxOut[3] = bh;
            System.arraycopy(boxOut, 0, lastCapsuleBox, 0, 4);
            return boxOut;
        }
        final float sx = 1f + bulge * PRESS_SCALE_CAPSULE_X;
        final float sy = 1f + bulge * PRESS_SCALE_CAPSULE_Y;
        dragAppliedDx = bpos;   // ★#1026：内容跟随用**质心**（与透镜面同相位——惯性前冲时放大镜内容同步冲）
        bx = ccx + bpos + (gc.x - ccx) * sx;
        bw = gc.w * sx;
        by = ccy + (gc.y - ccy) * sy;
        bh = gc.h * sy;
        // ★#1024/#1026 液滴变形：速度 → 横向拉伸（尾迹偏置）/ 纵向压扁（中心不动）；
        //   #1026 起速度取 **max(手指 EMA, 质心速度)**（急停后手指停但质心仍在冲 ⇒ 畸形保持到回收期）。
        //   ★#1038：此分支**只服务拖动/长按**（flow 已走上面的两边缘盒）。
        final float sp = Math.min(Math.max(Math.abs(velSmooth), Math.abs(bvel)), VEL_CAP);
        final float lagPx = dragTarget - bpos;   // >0=手指在前（拖动中）/ <0=质心越过手指（前冲相位）
        final float pressI = press;              // 拖动/长按：形变强度随物理按压
        final float strRaw = sp * 0.024f + Math.abs(lagPx) * 0.008f;
        final float fltRaw = sp * 0.012f;
        final float stretch = Math.min(STRETCH_MAX, strRaw) * pressI;
        final float flatten = Math.min(FLATTEN_MAX, fltRaw) * pressI;
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
        final float tapRaw = sp * 0.010f + Math.abs(lagPx) * 0.002f;
        shapeTaper = Math.min(0.42f, tapRaw) * pressI * (dirT >= 0f ? 1f : -1f);
        if (debug && (stretch > 0.01f || (flowActive && Math.abs(bpos) > 1f))) {   // ★#1035：起跳相位（stretch=0）也可取证
            android.util.Log.i("proteus-glass", "GLASSSTRETCH vel=" + String.format("%.1f", velSmooth)
                    + " bvel=" + String.format("%.1f", bvel) + " lag=" + String.format("%.1f", lagPx)
                    + " stretch=" + String.format("%.3f", stretch) + " flatten=" + String.format("%.3f", flatten)
                    + " taper=" + String.format("%.3f", shapeTaper) + " lift=" + String.format("%.2f", lift)
                    + " w=" + String.format("%.0f", bw) + " h=" + String.format("%.0f", bh));
        }
        boxOut[0] = bx; boxOut[1] = by; boxOut[2] = bw; boxOut[3] = bh;
        System.arraycopy(boxOut, 0, lastCapsuleBox, 0, 4);
        return boxOut;
    }
}
