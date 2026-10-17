// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/GlassBackdrop.java
package dev.proteus.layoutcore;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;

import java.util.List;
import java.util.Map;

/**
 * ★★★决策 #1015：玻璃**采样源**（背板捕获 + 宿主预模糊 + 离屏复合层）——自 ProteusHostView 按职责拆出
 * （清偿 #1003–#1014 累积的文件体积债，「玻璃采样什么」与「怎么画玻璃」分离）。
 *
 * <p>【拥有什么】{@code glassBackdrop}（着色器采样源；全分辨率、经 #1015 宿主预模糊）、
 * {@code glassBackdropFull}（内容捕获目标）、{@code glassBlurFull}（离屏复合帧的内容源）、
 * {@code glassLayerFull}（内容 + 外层玻璃面的离屏合成帧，供内层胶囊采样）、几何映射（X/Y/Scale）
 * 与 nesting 判定。全部原为 {@code ProteusHostView} 的私有字段（逐字搬移，逻辑零变化）。</p>
 *
 * <p>【与宿主的分工（Host 回调）】本类不做绘制决策：内容捕获经 {@link Host#drawContent} 借宿主的
 * {@code drawCmds}（跳过玻璃自身子树 ⇒ 背板只含"玻璃背后"内容）；离屏合成经
 * {@link Host#renderOuterFace} 借宿主的 {@code drawGlassFaceAt}（外层玻璃面按 nest=2 真 shader 渲染）。</p>
 *
 * <p>【为什么需要预模糊（#1015）】折射位移在贴现边把内容压缩 2–4× ⇒ 锐利高频跌破 shader 采样格距
 * （25-tap ≈1.93px）⇒ 菱形网纹。离线 oracle 分治（同算法渲染）：锐背板 foldHP=0.78 → 预模糊后 0.26
 * 且 4px 笔画对比保留（19→17/255）；下限放宽而无预模糊反而更糟（字形碎斑）⇒ 低通必须在**位移采样前**。</p>
 */
final class GlassBackdrop {

    /** 宿主侧能力（绘制/树结构/调试）——玻璃子系统不做绘制决策，全部向宿主要。 */
    interface Host {
        /** 宿主 drawCmds(canvas, skipIds, onlyIds)——内容捕获（skip=玻璃子树）与背板绘制共用同一遍。 */
        void drawContent(Canvas c, java.util.Set<Integer> skipIds, java.util.Set<Integer> onlyIds);

        /** 某节点（含自身）的子树 id 集合（宿主 nodeParent 表算法）。 */
        java.util.Set<Integer> subtreeOf(int rootId);

        /** 该节点是否有玻璃祖先（宿主 glassByNode + nodeParent）。 */
        boolean hasGlassAncestor(int nodeId);

        /** 离屏合成帧里画一个**外层玻璃面**（宿主 drawGlassFaceAt；采样源=本类 offscreenSource()）。 */
        void renderOuterFace(Canvas c, int nodeId, GlassMaterial.Spec g, float ox, float oy, float w, float h,
                             float nest, float bgOv);

        /** 复合层 dump 开关（宿主 `--es glassdbg 1`）。 */
        boolean debugDump();

        /** ★★★#1046：**内容版本号**——`setCmds` / `setNodeSvgStroke` / 内容属性任何变化都 +1。
         *  复合层缓存必须看它：图标来自 `nodeSvgStroke`（**不在 cmds 里**），只按 cmds 身份做键会把
         *  "SVG 尚未注入时的空版本"永久缓存下来（真机实证：复合层里有文字、没有图标 ⇒ 胶囊内一片空白）。 */
        int contentVersion();

        /** 当前 press 值（dump 记录用）。 */
        float press();

        /** dump 落盘目录（宿主 getContext().getFilesDir()）。 */
        java.io.File filesDir();
    }

    /** 背板捕获目标（内容画这里；末尾经预模糊成为采样源）。 */
    private Bitmap glassBackdropFull;
    /** 着色器采样源（全分辨率；#1015 起先过 GlassPreblur 低通）。 */
    private Bitmap glassBackdrop;
    /** ★#973/#1004/#1005：轻预模糊全分辨率背板（= glassBackdrop 升回全分辨率）——离屏复合帧的内容源。 */
    private Bitmap glassBlurFull;
    /** ★#1015：背板宿主预模糊（半程 + 盒式 + 升 ⇒ σ≈2.0px）——位移采样前低通，消折叠带网纹。 */
    private final GlassPreblur glassPreblur = new GlassPreblur();
    /** 采样源在其覆盖的屏幕区域中的左上角（屏幕坐标）——玻璃采样按它把"屏幕坐标"折算到位图坐标。 */
    private float glassBackdropX = 0f, glassBackdropY = 0f;
    /** ★★★决策 #906：降采样比（全分辨率像素 / 小图 texel）——buildPaint 折 tex_scale/bias 用。 */
    private float glassBackdropScaleX = 1f, glassBackdropScaleY = 1f;

    /** ★★★决策 #979/#980：离屏复合层（玻璃叠玻璃·真光学）——内层胶囊采样"内容 + 外层玻璃真 shader 面"。 */
    private android.graphics.HardwareRenderer glassHR;
    private android.media.ImageReader glassReader;
    private android.os.HandlerThread glassHT;
    private android.view.Surface glassHRSurface;
    private Bitmap glassLayerFull;
    /** ★★★决策 #1043：**复合层缓存键**——离屏合成 = 「内容 + 外层玻璃面」，而**胶囊的形变不在其中**
     *  （胶囊有玻璃祖先 ⇒ 被 skip；位移/形变全在绘制期由 `capsuleBox` 施加）。
     *  ⇒ flow / press 动画期间 `cmds` 与滚动都不变，这一帧**逐帧完全相同**，
     *  却每帧都在做 `HardwareRenderer.syncAndDraw()` + `latch.await()` 的**同步 GPU 往返**
     *  —— 这是用户「滑动落点有点儿慢、感觉被卡了一下」的直接来源（~35fps 下每帧多一次 GPU 同步）。
     *  缓存键 = (cmds 身份, 滚动, 几何)：换屏 / 改指令 / 滚动时才重建。 */
    private int layerKeyCmds = 0, layerKeyScrollX = 0, layerKeyScrollY = 0, layerKeyContent = -1;
    /** ★#1047：本次 capture 的滚动量（离屏层画内容时要做同样的 `-scroll`，见 capture 处注解）。 */
    private int capScrollX = 0, capScrollY = 0;
    /** ★★★#1047：复合层**是否可用**——成功回读后为 true；构建失败/尺寸变化/dispose 置 false。
     *  宿主据此决定"走 nest=3 采样复合层"还是"退回清晰内容"（**永不空白**）。 */
    private boolean layerFresh = false;
    boolean layerFresh() { return layerFresh && glassLayerFull != null; }
    private boolean layerKeyValid = false;
    /** 复合帧在屏幕坐标中的区域（= glassBackdropFull 的区域）。 */
    private int glassLayerX = 0, glassLayerY = 0;
    private boolean glassHasNesting = false;
    /** 捕获中标志（捕获期间宿主绘制内容会跳过玻璃子树；保留供未来路径判定）。 */
    private boolean capturingGlass = false;

    // ── 采样源 getter（宿主绘制路径用；null/尺寸判空语义与原字段读取逐点一致）──
    Bitmap bitmap() { return glassBackdrop; }
    float originX() { return glassBackdropX; }
    float originY() { return glassBackdropY; }
    float scaleX() { return glassBackdropScaleX; }
    float scaleY() { return glassBackdropScaleY; }
    Bitmap layerBitmap() { return glassLayerFull; }
    int layerX() { return glassLayerX; }
    int layerY() { return glassLayerY; }
    boolean hasNesting() { return glassHasNesting; }

    /** ★#950：某玻璃盒区域的背景平均亮度（0..1；-1=无背板）——与 `GlassMaterial.buildPaint` 的 regionLum 同口径
     *  （背板是降采样小图 ⇒ 用 `glassBackdropScaleX/Y` + `glassBackdropX/Y` 折算）。 */
    float regionLum(ProteusHostView.Cmd c) {
        if (glassBackdrop == null || glassBackdrop.isRecycled()) return -1f;
        final int bx = (int) ((c.x - glassBackdropX) / glassBackdropScaleX);
        final int by = (int) ((c.y - glassBackdropY) / glassBackdropScaleY);
        final int bw = Math.max(1, (int) (c.w / glassBackdropScaleX));
        final int bh = Math.max(1, (int) (c.h / glassBackdropScaleY));
        final int x0 = Math.max(0, bx), y0 = Math.max(0, by);
        final int x1 = Math.min(glassBackdrop.getWidth(), bx + bw);
        final int y1 = Math.min(glassBackdrop.getHeight(), by + bh);
        if (x1 <= x0 || y1 <= y0) return -1f;
        final int step = Math.max(1, Math.max(x1 - x0, y1 - y0) / 20);
        double sum = 0; int n = 0;
        for (int y = y0; y < y1; y += step) for (int x = x0; x < x1; x += step) {
            final int p = glassBackdrop.getPixel(x, y);
            sum += (0.299 * ((p >> 16) & 0xff) + 0.587 * ((p >> 8) & 0xff) + 0.114 * (p & 0xff)) / 255.0;
            n++;
        }
        return n > 0 ? (float) (sum / n) : -1f;
    }

    /** ★★★#837 捕获优化：只栅格化**玻璃节点并集包围盒（+外扩 pad）**，不再整屏（真机实测整屏捕获 ~1.5–2ms）。
     *  ★pad = 边缘折射位移 + 模糊核最大采样半径 + 余量（覆盖着色器会采到的所有背景像素）。
     *  包围盒钳到屏幕；位图随之变小 ⇒ 像素填充成正比下降（玻璃集中于局部时收益最大）。 */
    private static float glassPad(ProteusHostView.Cmd c, GlassMaterial.Spec g) {
        // 折射峰值位移 = min(w,h)*0.22（与 buildPaint/shader 同式）；模糊最远采样 ≈ blur*0.55*1.6
        return Math.min(c.w, c.h) * 0.42f + g.blur * 0.55f * 1.6f + 4f;   // ★#910：位移峰值 1.15·band ⇒ pad 需 ≥此
    }

    /** 捕获"无玻璃面"的内容帧（作玻璃采样的背后内容）；调用方须保证本屏有玻璃节点。
     *  末尾经 #1015 预模糊低通 ⇒ 采样源（消折叠带混叠网纹）。 */
    void capture(Host host, int W, int H, List<ProteusHostView.Cmd> list, int[] ids,
                 Map<Integer, GlassMaterial.Spec> glassByNode,
                 boolean scrolled, int scrollX, int scrollY, Rect viewport, int pageBg) {
        if (W <= 0 || H <= 0) return;
        if (list == null || ids == null) return;
        // ★★★#1047（子代理独立审计发现的坐标系缺陷）：复合层里画内容时也要先 `-scroll`
        //   —— `drawCmds` 对 fixed 节点会 `translate(+scroll)`（它假定画布已在"内容空间"），
        //   而离屏层只做了 `-gx/-gy`、没做 `-scroll`（对比背板路径的 `translate(-bx - scrollX, ...)`）。
        //   ⇒ 滚动后图标/文字被**额外位移 scrollY**、整体画到层边界之外 ⇒ 胶囊内部空白。
        this.capScrollX = scrolled ? scrollX : 0;
        this.capScrollY = scrolled ? scrollY : 0;
        // ① 玻璃节点并集包围盒（屏幕坐标）+ 外扩 pad
        float minX = Float.MAX_VALUE, minY = Float.MAX_VALUE, maxX = -Float.MAX_VALUE, maxY = -Float.MAX_VALUE;
        for (int i = 0; i < list.size() && i < ids.length; i++) {
            GlassMaterial.Spec g = glassByNode.get(ids[i]);
            if (g == null) continue;
            final ProteusHostView.Cmd c = list.get(i);
            if (c.w <= 0f || c.h <= 0f) continue;
            final float pad = glassPad(c, g);
            minX = Math.min(minX, c.x - pad);
            minY = Math.min(minY, c.y - pad);
            maxX = Math.max(maxX, c.x + c.w + pad);
            maxY = Math.max(maxY, c.y + c.h + pad);
        }
        if (minX > maxX) return;   // 无有效玻璃盒
        // ② 钳到屏幕 ⇒ 位图尺寸（★I2-ALLOW: 玻璃背景**位图**的像素尺寸——位图必须整数像素，非几何吸附；
        //    玻璃采样用的背景缓冲与内核几何无关，见卡 I2 例外「位图/像素缓冲尺寸」）
        final int bx = Math.max(0, (int) Math.floor(minX));
        final int by = Math.max(0, (int) Math.floor(minY));
        final int bw = Math.max(1, Math.min(W, (int) Math.ceil(maxX)) - bx);
        final int bh = Math.max(1, Math.min(H, (int) Math.ceil(maxY)) - by);
        // ★★★决策 #906：全分辨率背板（内容画这里；末尾轻降采样）。
        if (glassBackdropFull == null || glassBackdropFull.getWidth() != bw || glassBackdropFull.getHeight() != bh) {
            if (glassBackdropFull != null) glassBackdropFull.recycle();
            glassBackdropFull = android.graphics.Bitmap.createBitmap(bw, bh, android.graphics.Bitmap.Config.ARGB_8888);
        }
        glassBackdropX = bx;
        glassBackdropY = by;
        final Canvas bc = new Canvas(glassBackdropFull);
        // ★★★决策 #846 修复「玻璃两侧黑块」：原来 `CLEAR`（透明）⇒ 玻璃盒外扩 pad 超出**内容**的部分
        //   为透明黑 ⇒ AGSL 折射把它当背景采样 ⇒ 玻璃左/右边缘黑块（真机「滚动到看不到内容时两个黑块」）。
        //   改为填**页面底色**（取 View 的背景色；无背景色 ⇒ 白）。与鸿蒙自绘位图 clear 色同口径。
        bc.drawColor(pageBg);
        // ③ 画内容：位图坐标 = 屏幕坐标 −(bx,by)；屏幕坐标 = 内容坐标 −(scrollX,scrollY)
        //    ⇒ 一次 translate(−scrollX−bx, −scrollY−by)；视口裁剪按位图坐标平移。
        final boolean cClipViewport = scrolled && viewport != null;
        final int cSave = (scrolled || bx != 0 || by != 0) ? bc.save() : -1;
        if (cClipViewport) {
            bc.clipRect(viewport.left - bx, viewport.top - by,
                    viewport.right - bx, viewport.bottom - by);
        }
        bc.translate(-bx - (scrolled ? scrollX : 0), -by - (scrolled ? scrollY : 0));
        capturingGlass = true;
        try {
            // ★★★决策 #893（对齐 iOS 液态玻璃基准）：背板**排除所有玻璃节点自身子树** ⇒ 只含"玻璃背后"的内容，
            //   自身内容不被糊进材质（真 iOS：材质只糊背后）。自身内容随后由 drawGlassPass 在玻璃面之上清晰重画。
            java.util.Set<Integer> glassSubtree = new java.util.HashSet<>();
            for (Integer gid : glassByNode.keySet()) glassSubtree.addAll(host.subtreeOf(gid));
            host.drawContent(bc, glassSubtree, null);   // 跳过玻璃节点自身子树 ⇒ 纯背景
        } finally {
            capturingGlass = false;
        }
        if (cSave != -1) bc.restoreToCount(cSave);
        // ★★★决策 #1013（用户「获取的映射感觉有点儿脏」+ 会话内离线对照实证）：**采样源全分辨率（DIV 2→1）**。
        //   【离线复现（oracle，合成「获取风格」蓝字内容）】DIV=2（/2 降采样→shader 放大）时，蓝色笔画周围
        //   出现**网格状插值织纹**（周期 ≈5-6px 斜向条纹，与用户截图自相关峰 lag 2/4/6 吻合）；DIV=1 干净平滑。
        //   【成本】条级玻璃盒（~1044×168 逻辑 ⇒ 全分辨率位图 ~1.2MB）单缓冲、ARGB_8888、每帧一次 /1 blit——
        //   玻璃节点少（1-2 块/屏），可接受（#906 当初降低分辨率是为大盒性能，当前场景盒小）。
        //   ★若未来大盒性能回归（>2 屏面积），回退口径应为"按盒尺寸自适应 DIV"（大盒 2 / 小盒 1），不是全体回 2。
        final int DIV = 1;
        // I2-ALLOW: **降采样缓冲的位图像素尺寸**（非几何坐标——位图必须整数像素；几何采样走内核吸附值）
        final int sw = Math.max(1, Math.round((float) bw / DIV));
        final int sh = Math.max(1, Math.round((float) bh / DIV));
        if (glassBackdrop == null || glassBackdrop.getWidth() != sw || glassBackdrop.getHeight() != sh) {
            if (glassBackdrop != null) glassBackdrop.recycle();
            glassBackdrop = android.graphics.Bitmap.createBitmap(sw, sh, android.graphics.Bitmap.Config.ARGB_8888);
        }
        final Paint filtp = new Paint(Paint.FILTER_BITMAP_FLAG);
        // ★★★决策 #1015（用户「内容还是不够清晰…映射感觉有点儿脏」· 离线 oracle 分治 + PIL 全管线实证）：
        //   **宿主预模糊**——半程双线性 + 3×3 盒式 + 升采样（等效 σ≈2.0px），在**位移采样前**低通。
        //   【机理】贴现边压缩 2–4× ⇒ 锐利高频跌破 25-tap 格距（1.93px）⇒ 菱形网纹；预模糊后网纹
        //   消失（foldHP 0.78→0.26）、4px 笔画对比保留（19→17/255）。只糊背板（玻璃采样源），玻璃外内容不受影响。
        //   ★tex_scale/bias 仍按 bw/sw 折算（DIV=1 ⇒ 恒等）；链细节见 GlassPreblur。
        glassPreblur.apply(glassBackdropFull, bw, bh, glassBackdrop, sw, sh, filtp);
        glassBackdropScaleX = (float) bw / sw;
        glassBackdropScaleY = (float) bh / sh;

        // ★★★决策 #979：**玻璃叠玻璃（真光学）**——内层玻璃（选中胶囊）的采样源 = **内容 + 外层玻璃面（真 shader）**
        //   的离屏合成帧。★用**离屏硬件渲染**（`HardwareRenderer`+`ImageReader`）——实测本设备可行（#973 的
        //   "软件 Canvas 不支持 / HARDWARE 位图不可变"只是**错误路径**，非"离屏不可达"）。
        glassHasNesting = false;
        if (glassByNode.size() > 1) {
            for (Integer gid : glassByNode.keySet()) {
                if (host.hasGlassAncestor(gid)) { glassHasNesting = true; break; }
            }
        }
        if (glassHasNesting) {
            // ★★★决策 #1004/#1005：**全分辨率（轻链）背板**——离屏复合帧的内容源。外层玻璃面在复合帧里
            //   按 nest=2 渲染（tap 在 shader、宿主只做 /2 抗锯齿）⇒ 与屏上条面同口径（内层采它不会读出
            //   不一致的清晰度）。★#1005：由"深链预模糊"改回**仅 /2 往返**（与主链同形——只是把 /2 级
            //   升回全分辨率，供离屏 1:1 采样；shader 的 nest=2 tap 承担全部模糊）。
            // ★★★#1043：**只在内容/滚动/几何真正变化时重建复合层**（见字段处注解）。
            //   动画期间（press/flow）cmds 与滚动都不变 ⇒ 命中缓存，省掉每帧一次同步 GPU 往返。
            final int kc = System.identityHashCode(list);
            final int kv = host.contentVersion();   // ★#1046：图标(svg)/文本等"不在 cmds 里"的内容变化
            if (layerKeyValid && kc == layerKeyCmds && kv == layerKeyContent
                    && scrollX == layerKeyScrollX && scrollY == layerKeyScrollY
                    && glassLayerFull != null) {
                // 命中：直接复用上一帧的复合层（胶囊形变不进入这一层）
            } else {
                if (glassBlurFull == null || glassBlurFull.getWidth() != bw || glassBlurFull.getHeight() != bh) {
                    if (glassBlurFull != null) glassBlurFull.recycle();
                    glassBlurFull = android.graphics.Bitmap.createBitmap(bw, bh, android.graphics.Bitmap.Config.ARGB_8888);
                }
                new Canvas(glassBlurFull).drawBitmap(glassBackdrop, new Rect(0, 0, sw, sh),
                        new Rect(0, 0, bw, bh), filtp);
                buildGlassLayerOffscreen(host, bx, by, bw, bh, list, ids, glassByNode);
                layerKeyCmds = kc; layerKeyScrollX = scrollX; layerKeyScrollY = scrollY; layerKeyContent = kv;
                layerKeyValid = glassLayerFull != null;
            }
        }
    }

    /** 离屏复合帧的**内容源**（外层玻璃面渲染采样用）：与屏上条面同口径的预模糊背板。 */
    Bitmap offscreenSource() {
        return glassBlurFull != null ? glassBlurFull : glassBackdropFull;
    }

    /** ★#979：离屏合成「内容 + 外层玻璃面」——`glassLayerFull` = 帧缓冲读回（全分辨率，屏幕区 [gx,gy]）。 */
    private void buildGlassLayerOffscreen(Host host, int gx, int gy, int gw, int gh, List<ProteusHostView.Cmd> list,
                                          int[] ids, Map<Integer, GlassMaterial.Spec> glassByNode) {
        try {
            if (glassReader == null || glassLayerX != gx || glassLayerY != gy
                    || glassLayerFull == null || glassLayerFull.getWidth() != gw || glassLayerFull.getHeight() != gh) {
                dispose();
                glassHT = new android.os.HandlerThread("glass-layer");
                glassHT.start();
                glassReader = android.media.ImageReader.newInstance(gw, gh,
                        android.hardware.HardwareBuffer.RGBA_8888, 2,
                        android.hardware.HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE | android.hardware.HardwareBuffer.USAGE_GPU_COLOR_OUTPUT);
                glassHR = new android.graphics.HardwareRenderer();
                glassHRSurface = glassReader.getSurface();
                glassHR.setSurface(glassHRSurface);
                glassLayerX = gx; glassLayerY = gy;
            }
            final android.graphics.RenderNode node = new android.graphics.RenderNode("glass-layer");
            node.setPosition(0, 0, gw, gh);
            glassHR.setContentRoot(node);
            final Canvas c = node.beginRecording(gw, gh);
            // 离屏局部坐标（原点 0,0；div=1）：盒在离屏画布的位置 = 屏幕盒 − (gx,gy)
            c.drawColor(0x00000000);
            // ① 内容（把**预模糊**全分辨率背板搬到离屏局部坐标；背板覆盖屏幕区 [gx,gy]，其 (0,0) 已对应屏幕 (gx,gy)）
            //   ★#1004：用 glassBlurFull（轻链预模糊）而非 glassBackdropFull——外层玻璃面在此帧上按 nest=2
            //   渲染，内容必须与屏上条面同口径（否则内层读到"更锐的条"）。
            if (glassBlurFull != null) c.drawBitmap(glassBlurFull, 0f, 0f, null);
            else if (glassBackdropFull != null) c.drawBitmap(glassBackdropFull, 0f, 0f, null);
            // ② 逐"外层玻璃"（无玻璃祖先者）：用真 shader 合成其玻璃面（采样 = 内容背板）
            for (int k = 0; k < list.size() && k < ids.length; k++) {
                final GlassMaterial.Spec g = glassByNode.get(ids[k]);
                if (g == null || host.hasGlassAncestor(ids[k])) continue;
                final ProteusHostView.Cmd gc = list.get(k);
                // ★#1004：外层在复合帧里按 nest=2（宿主已预模糊 ⇒ 小残差 tap）渲染——与屏上条面同口径。
                host.renderOuterFace(c, ids[k], g, gc.x - gx, gc.y - gy, gc.w, gc.h, 2f, -1f);
                // ②b ★#982：**外层玻璃自身的镜面边**——iOS 的条本就有一条 1px 高光边（shader `edge_hi` 只 ~0.12
                //   ⇒ 经内层胶囊采样后衰减殆尽）。这里在复合层里沿**外层玻璃轮廓**再描一道**清晰的镜面边**
                //   （属"渲染条本身"，非手画替代光学）⇒ 内层胶囊采样时能透出这条边。
                // ★★★决策 #1031（用户「弹起来的胶囊水滴无法看到下面玻璃条的上下边」）：**暗缝 + 亮脊双线**——
                //   #982 的白描边（230α）画在**白条面**上对比度 ≈10L（等于看不见）⇒ 用户看不到条边。
                //   iOS 边模型（#1002）= 1px 暗缝 + 亮脊 ⇒ 先 3px 半透明暗缝（对比 ~60L），再 1.2px 白核
                //   ⇒ 透过弹起胶囊（采样本复合层）能清楚看到条的上下边。
                final android.graphics.Path bp = new android.graphics.Path();
                bp.addRoundRect(new android.graphics.RectF(gc.x - gx, gc.y - gy, gc.x - gx + gc.w, gc.y - gy + gc.h),
                        g.radius, g.radius, android.graphics.Path.Direction.CW);
                final Paint ep = new Paint(Paint.ANTI_ALIAS_FLAG);
                ep.setStyle(Paint.Style.STROKE);
                // ★★★决策 #1043（用户「胶囊玻璃无法透过去看到玻璃条的上下边」）：
                //   **边线加粗加深**——3px/α96 + 1.3px/α205 在复合层里清楚（实测 y176-179 = 201-213），
                //   但胶囊采样时有 ① 折射压缩（s'≈0.5 ⇒ 3px→1.5px）② nest=3 残差模糊（σ≈1.9px）
                //   ⇒ 细线被抹平到看不见。
                //   iOS 实测：条边透过胶囊后是「2–3px 高光 + **20–23px 暗带**」、边线过渡 0.84→12.5px
                //   ⇒ 它读作一条**宽带**而不是细线。这里把合成边线加粗到 **9px/α150**（透出后约 4–5px、仍可辨），
                //   白核 2px/α235。
                ep.setStrokeWidth(9f);
                ep.setColor(android.graphics.Color.argb(150, 12, 14, 20));
                c.drawPath(bp, ep);
                ep.setStrokeWidth(2f);
                ep.setColor(android.graphics.Color.argb(235, 255, 255, 255));
                c.drawPath(bp, ep);
            }
            // ★★★决策 #1044（用户「我们的经过图标文字时没有真实的光学折射」）：
            //   把玻璃子树的内容（tab 图标/文字）也画进复合层 —— 此前复合层只含「背景 + 外层玻璃面 + 条边线」，
            //   而图标/文字属于**玻璃子树**、在 `captureGlassBackdrop` 里被排除（"材质只糊背后"的正确语义）。
            //   ⇒ 胶囊采样时根本没有图标可折射（只有纯色背景），所以永远没有透镜扭曲/彩虹。
            //   iOS 的做法（公开逆向 + 私有选择器实证）：`_UILiquidLensView` =
            //   `_UIPortalView 采样 bar 自身内容 + displacementMap over SDF` ⇒ **图标是被透镜 warp 的**。
            //   ★★★决策 #1045（用户「滑过去的时候下面变成全白了，玻璃条边线也看不到了」）：**必须排除内层玻璃**
            //   —— 首版写成"遍历所有 glassByNode 加子树"，而**外层条的子树里就包含选中胶囊自己**（n181 是
            //   n179 的后代）⇒ 胶囊采样到**自己的静态影像**（还带着条边线的描边）⇒ 滑过去整片糊白、
            //   条边线被自己的白影像盖掉。⇒ 只取**外层玻璃**的子树，再**减去所有内层玻璃的子树**（留下图标/文字）。
            final java.util.Set<Integer> glassContentIds = new java.util.HashSet<>();
            for (int k = 0; k < list.size() && k < ids.length; k++) {
                if (glassByNode.get(ids[k]) != null && !host.hasGlassAncestor(ids[k])) {
                    glassContentIds.addAll(host.subtreeOf(ids[k]));
                }
            }
            for (int k = 0; k < list.size() && k < ids.length; k++) {
                if (glassByNode.get(ids[k]) != null && host.hasGlassAncestor(ids[k])) {
                    glassContentIds.removeAll(host.subtreeOf(ids[k]));   // 内层胶囊自身（采样源不能含自己）
                }
            }
            if (!glassContentIds.isEmpty()) {
                final int sc = c.save();
                c.translate(-gx - capScrollX, -gy - capScrollY);   // ★#1047：与背板路径同口径（含 -scroll）
                host.drawContent(c, null, glassContentIds);
                c.restoreToCount(sc);
            }
            node.endRecording();
            final java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
            glassReader.setOnImageAvailableListener(r -> latch.countDown(), new android.os.Handler(glassHT.getLooper()));
            glassHR.createRenderRequest().syncAndDraw();

            latch.await(3, java.util.concurrent.TimeUnit.SECONDS);
            final android.media.Image img = glassReader.acquireLatestImage();
            if (img == null) { android.util.Log.w("proteus-glass", "GLASSLAYER offscreen: no image"); return; }
            final android.hardware.HardwareBuffer buf = img.getHardwareBuffer();
            final Bitmap wrap = Bitmap.wrapHardwareBuffer(buf, null);
            if (glassLayerFull != null) glassLayerFull.recycle();
            glassLayerFull = wrap.copy(Bitmap.Config.ARGB_8888, false);
            layerFresh = glassLayerFull != null;   // ★#1047：回读成功 ⇒ 层可用
            if (wrap != null) wrap.recycle();
            img.close();
            // ★★★决策 #980：**不再降采样**——条的边线只有 ~1–2px，降采样 2× + 线性采样会把它**抹没**。
            //   ⇒ 内层直接采**全分辨率层**（`glassLayerFull`，div=1）。
            // ★判据（任务 A）：`glassDebug` 时 dump 复合层 + 几何 ⇒ 供脚本做"胶囊内部 vs 复合层同位置"逐点对照。
            if (host.debugDump()) {
                try {
                    // ★raw 转储（比 PNG 更易无损读回）：宽高头(LittleEndian) + 每像素 4 字节 ARGB。
                    final int w = glassLayerFull.getWidth(), h = glassLayerFull.getHeight();
                    final int[] px = new int[w * h];
                    glassLayerFull.getPixels(px, 0, w, 0, 0, w, h);
                    final byte[] out = new byte[8 + w * h * 4];
                    out[0]=(byte)w; out[1]=(byte)(w>>8); out[2]=(byte)(w>>16); out[3]=(byte)(w>>24);
                    out[4]=(byte)h; out[5]=(byte)(h>>8); out[6]=(byte)(h>>16); out[7]=(byte)(h>>24);
                    for (int i = 0; i < px.length; i++) {
                        int v = px[i];
                        int o = 8 + i * 4;
                        out[o]=(byte)v; out[o+1]=(byte)(v>>8); out[o+2]=(byte)(v>>16); out[o+3]=(byte)(v>>24);
                    }
                    final java.io.File tmp = new java.io.File(host.filesDir(), "glasslayer.raw.tmp");
                    final java.io.File dst = new java.io.File(host.filesDir(), "glasslayer.raw");
                    final java.io.FileOutputStream fo = new java.io.FileOutputStream(tmp);
                    fo.write(out); fo.flush(); fo.close();
                    tmp.renameTo(dst);
                    StringBuilder sb = new StringBuilder("GLASSDUMP gx=").append(gx).append(" gy=").append(gy)
                            .append(" gw=").append(gw).append(" gh=").append(gh);
                    for (int k = 0; k < list.size() && k < ids.length; k++) {
                        if (glassByNode.get(ids[k]) != null) {
                            ProteusHostView.Cmd gc = list.get(k);
                            sb.append(" | n").append(ids[k]).append("=").append(gc.x).append(",").append(gc.y)
                              .append(",").append(gc.w).append(",").append(gc.h)
                              .append(" ov=").append(glassByNode.get(ids[k]).overlay)
                              .append(" anc=").append(host.hasGlassAncestor(ids[k]));
                        }
                    }
                    sb.append(" | press=").append(host.press());
                    android.util.Log.i("proteus-glass", sb.toString());
                } catch (Throwable t) { android.util.Log.w("proteus-glass", "GLASSDUMP fail " + t); }
            }
        } catch (Throwable t) {
            layerFresh = false;   // ★#1047：失败 ⇒ 宿主退回清晰内容（永不空白）
            android.util.Log.w("proteus-glass", "GLASSLAYER offscreen FAIL " + t);
        }
    }

    private void dispose() {
        try { if (glassHR != null) glassHR.destroy(); } catch (Throwable ignored) {}
        try { if (glassReader != null) glassReader.close(); } catch (Throwable ignored) {}
        try { if (glassHT != null) glassHT.quitSafely(); } catch (Throwable ignored) {}
        try { if (glassHRSurface != null) glassHRSurface.release(); } catch (Throwable ignored) {}
        glassHR = null; glassReader = null; glassHT = null; glassHRSurface = null;
        layerFresh = false;   // ★#1047：dispose ⇒ 层不可用
        if (glassLayerFull != null) { glassLayerFull.recycle(); glassLayerFull = null; }
        if (glassBlurFull != null) { glassBlurFull.recycle(); glassBlurFull = null; }   // ★#1004
    }
}
