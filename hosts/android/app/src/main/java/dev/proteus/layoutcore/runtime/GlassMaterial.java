package dev.proteus.layoutcore;

import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Paint;
import android.graphics.RuntimeShader;
import android.graphics.Shader;
import android.os.Build;

/**
 * ★★★框架自研**液态玻璃材质**（Android 落地 · 决策 #818/#834）。
 *
 * <p>【新架构（决策 #834）】**算法真源 = Rust 的 WGSL**（`packages/shader-codegen-rust/src/materials/
 * glass.wgsl`，经 naga 落地 AGSL），本类**不再手写任何着色器**——源码来自生成物
 * {@link GeneratedMaterials#GLASS_AGSL}（`node scripts/gen-shaders.mjs` 产出，门禁防漂移）。
 * 本类只做**落地**：编译（RuntimeShader）+ 设 uniform + 交给 {@code ProteusHostView} 的玻璃遍绘制。</p>
 *
 * <p>【模型】"边缘倒角厚板"（决策 #827）：中心平坦（不折射）、仅最外倒角带沿外法线折射、
 * 模糊按离边距离键控、去饱和+磨砂白、Fresnel 高光。观感与三端同源（同一份 WGSL）。</p>
 *
 * <p>【怎么用（宿主）】{@code ProteusHostView} 对带 {@code style.glass} 的节点：把"背后已绘内容"画进
 * 离屏 {@code Bitmap} → {@link #buildPaint} → {@code canvas.drawRect(节点盒, paint)}（裁剪圆角）。
 * 坐标口径：{@code ox/oy} = 节点盒在**渲染目标**（全屏画布）内的左上角（设备像素）；
 * 采样坐标 = 片元画布坐标 + 折射位移（见 WGSL 契约）。</p>
 *
 * <p>【版本门】AGSL 需 **API 31+**（{@code android.graphics.RuntimeShader}）；不可用 ⇒ 调用方回退半透明实色。</p>
 */
public final class GlassMaterial {

    private GlassMaterial() {}

    public static boolean isAvailable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
    }

    /** ★#966：该材质是否为**玻璃族**（`GlassUniforms`）——玻璃族的剪影可由 shader 的 SDF 覆盖率给出，
     *  模糊族（BlurUniforms）无 SDF ⇒ 仍须宿主圆角矩形裁剪。判别与 buildPaint 内 `isGlass` 同源。 */
    public static boolean isGlassMaterial(String material) {
        final GeneratedMaterials.Def def = GeneratedMaterials.MATERIALS.get(material);
        return def == null || "GlassUniforms".equals(def.uniformStruct);
    }

    /** ★★★决策 #966/#969：**按下形变路径**（形状域变形的**剪影**）——圆角矩形轮廓沿外法线按
     *  `amp·exp(-d²/2σ²)` **向内**偏移（`d` = 轮廓点到触点距离），与 shader `sd_glass` 的形变式**同源**。
     *  ★#969：方向 = **内陷（凹）**（iOS 按下表面凹进去），不是外凸。
     *  ★为什么要宿主建路径：实测本设备**忽略 `RuntimeShader` 返回的 alpha**（返回 0 / 圆覆盖率都仍画成
     *   不透明矩形）⇒ 剪影只能来自**几何裁剪**（`clipPath`）。`press=0` ⇒ 路径 ≈ 原圆角矩形（逐像素等价）。
     *  ★坐标系：`bx,by,bw,bh` 与 `tx,ty` 必须在**同一画布坐标空间**（调用方传的是外扩/缩放后的盒）。 */
    public static android.graphics.Path inflatedPillPath(float bx, float by, float bw, float bh,
                                                         float r, float tx, float ty, float press) {
        final float shortSide = Math.min(bw, bh);
        final float amp = shortSide * 0.5f * 0.42f * Math.max(0f, Math.min(1f, press));   // 充气峰值（同 shader）
        final float sig = Math.max(shortSide * 0.5f * 1.25f, 1f);                        // 高斯展布（同 shader）
        final float rr = Math.max(0f, Math.min(r, shortSide * 0.5f));
        final float twoSig2 = 2f * sig * sig;
        final float x0 = bx, y0 = by, x1 = bx + bw, y1 = by + bh;
        final java.util.ArrayList<float[]> pts = new java.util.ArrayList<>();
        final float step = 4f;
        for (float x = x0 + rr; x < x1 - rr; x += step) pts.add(new float[]{x, y0, 0f, -1f});
        arcPts(pts, x1 - rr, y0 + rr, rr, -90f, 0f);
        for (float y = y0 + rr; y < y1 - rr; y += step) pts.add(new float[]{x1, y, 1f, 0f});
        arcPts(pts, x1 - rr, y1 - rr, rr, 0f, 90f);
        for (float x = x1 - rr; x > x0 + rr; x -= step) pts.add(new float[]{x, y1, 0f, 1f});
        arcPts(pts, x0 + rr, y1 - rr, rr, 90f, 180f);
        for (float y = y1 - rr; y > y0 + rr; y -= step) pts.add(new float[]{x0, y, -1f, 0f});
        arcPts(pts, x0 + rr, y0 + rr, rr, 180f, 270f);
        final android.graphics.Path p = new android.graphics.Path();
        boolean first = true;
        for (float[] q : pts) {
            final float dx = q[0] - tx, dy = q[1] - ty;
            final float inf = amp * (float) Math.exp(-(dx * dx + dy * dy) / twoSig2);
            // ★#969：**向内偏移**（凹/内陷）——iOS 按下玻璃表面在触点处凹进去（不是凸出）。
            final float X = q[0] - q[2] * inf, Y = q[1] - q[3] * inf;
            if (first) { p.moveTo(X, Y); first = false; } else { p.lineTo(X, Y); }
        }
        p.close();
        return p;
    }

    /** 圆角弧采样（外法线 = 径向）：`(cx,cy)` 圆心 · `rr` 半径 · `a0→a1` 角度（度）。 */
    private static void arcPts(java.util.List<float[]> pts, float cx, float cy, float rr, float a0, float a1) {
        if (rr <= 0.5f) return;
        // I2-ALLOW: 圆角弧的**离散采样点数**（非几何坐标舍入——弧点由 float 三角函数算出，N 仅为细分常数）
        final int n = Math.max(2, (int) Math.ceil(Math.abs(a1 - a0) / 6f));
        for (int i = 1; i < n; i++) {
            final double th = Math.toRadians(a0 + (a1 - a0) * i / n);
            final float nx = (float) Math.cos(th), ny = (float) Math.sin(th);
            pts.add(new float[]{cx + rr * nx, cy + rr * ny, nx, ny});
        }
    }

    /** 玻璃材质参数（由内核 `style.glass` 折出）。 */
    public static final class Spec {
        public final float blur;
        public final int tint;
        public final float radius;
        public final boolean border;
        public final float saturation;
        /** ★★★决策 #900：材质 id（`glass`/`backdropBlur`/`frosted`/`vibrancy`）——按此选 AGSL 源 + uniform。 */
        public final String material;
        /** ★★★决策 #905：触控形变（对齐 Apple `UIGlassEffect.isInteractive`）——该玻璃响应点按/拖动。 */
        public final boolean interactive;
        /** ★★★决策 #906：交互效果形态——0=上层玻璃表面流动（默认）/ 1=内容折射位移（`glass.effect`）。 */
        public final float effect;
        /** ★#952：选中胶囊叠加层强度（0/1——叠半透明中性色 light→灰·dark→亮）。 */
        public final float overlay;

        public Spec(float blur, int tint, float radius, boolean border, float saturation) {
            this(blur, tint, radius, border, saturation, "glass", false, 0f);
        }

        public Spec(float blur, int tint, float radius, boolean border, float saturation, String material) {
            this(blur, tint, radius, border, saturation, material, false, 0f);
        }

        public Spec(float blur, int tint, float radius, boolean border, float saturation, String material, boolean interactive) {
            this(blur, tint, radius, border, saturation, material, interactive, 0f);
        }

        public Spec(float blur, int tint, float radius, boolean border, float saturation, String material, boolean interactive, float effect) {
            this.blur = blur;
            this.tint = tint;
            this.radius = radius;
            this.border = border;
            this.saturation = saturation;
            this.material = (material == null || !GeneratedMaterials.MATERIALS.containsKey(material)) ? "glass" : material;
            this.interactive = interactive;
            this.effect = effect;
            this.overlay = 0f;
        }

        /** ★#952：带 overlay 的构造（0/1）。 */
        public Spec(float blur, int tint, float radius, boolean border, float saturation, String material, boolean interactive, float effect, float overlay) {
            this.blur = blur; this.tint = tint; this.radius = radius; this.border = border; this.saturation = saturation;
            this.material = (material == null || !GeneratedMaterials.MATERIALS.containsKey(material)) ? "glass" : material;
            this.interactive = interactive; this.effect = effect; this.overlay = overlay;
        }
    }

    /**
     * 用"背后内容"位图 + 盒 + 规格构建玻璃 {@code Paint}（null = 不可用/失败 ⇒ 调用方降级半透明实色）。
     *
     * <p>★★★【为什么必须缓存（真机"滚动闪烁"的根因 · 决策 #836）】{@code new RuntimeShader} 会
     * **编译 AGSL**——而旧版**每帧每玻璃节点都新建一次**（真机实测 3 次滑动 = 94 次编译）⇒ 编译未就绪
     * 的那一帧玻璃面画不出 ⇒ **滚动时玻璃闪烁**。着色器**源码是静态的**（生成物常量）⇒ 只为「编译」缓存：
     * 按 **nodeId** 缓存 {@code RuntimeShader}（每个玻璃节点一份，避免同帧多节点互相覆盖 uniform），
     * 每帧只**更新输入纹理 + uniform**（廉价），不再重建。</p>
     *
     * @param nodeId   玻璃节点 id（缓存键——同一节点的着色器跨帧复用）
     * @param backdrop 背景位图（**只覆盖玻璃并集包围盒**，见 #837 优化——不再是整屏）
     * @param ox,oy    节点盒在**画布**内的左上角（设备像素；AGSL `origin` uniform）
     * @param bdX,bdY  `backdrop` 在其覆盖屏幕区域中的左上角（画布坐标）——采样位图须减去它
     * @param w,h      节点盒尺寸（设备像素）
     * @param radius   圆角（设备像素）
     */
    /**
     * ★★★决策 #911：玻璃盒区域的**平均亮度**（0..1）——供 shader **区域级霜锚点**（浅霜/深霜切换，对齐 iOS
     *   `.regular`「flip from light to dark based on the background」）。从**降采样背景位图**取该节点盒覆盖区域，
     *   按步长采样求均值（玻璃节点通常 1-2 个 ⇒ 每帧成本可忽略；步长自适应 ≈ ≤26×26 采样点）。
     *   ★缺省/越界 ⇒ 0（视作深底 ⇒ 锚点高 ⇒ 翻白霜——比"不变"更接近 iOS，且不崩）。
     */
    private static float regionLum(Bitmap backdrop, float bx, float by, float bw, float bh) {
        if (backdrop == null || backdrop.isRecycled()) return 0f;
        // I2-ALLOW: **位图采样区域的像素边界**（非布局几何——背景位图必须整数像素，几何仍走内核吸附值）
        int x0 = Math.max(0, (int) bx), y0 = Math.max(0, (int) by);
        int x1 = Math.min(backdrop.getWidth(), (int) Math.ceil(bx + bw));
        int y1 = Math.min(backdrop.getHeight(), (int) Math.ceil(by + bh));
        if (x1 <= x0 || y1 <= y0) return 0f;
        final int dx = x1 - x0, dy = y1 - y0;
        final int step = Math.max(1, Math.max(dx, dy) / 26);
        double sum = 0; int n = 0;
        for (int y = y0; y < y1; y += step) {
            for (int x = x0; x < x1; x += step) {
                final int p = backdrop.getPixel(x, y);
                sum += (0.299 * ((p >> 16) & 0xff) + 0.587 * ((p >> 8) & 0xff) + 0.114 * (p & 0xff)) / 255.0;
                n++;
            }
        }
        return n > 0 ? (float) (sum / n) : 0f;
    }

    public static Paint buildPaint(int nodeId, Bitmap backdrop, float ox, float oy, float bdX, float bdY, float w, float h, float radius, Spec spec) {
        return buildPaint(nodeId, backdrop, ox, oy, bdX, bdY, w, h, radius, spec, -1e6f, -1e6f, 0f);
    }

    /** ★#905 重载：带触控形变参数（touch 盒局部 px；press 0..1）。 */
    public static Paint buildPaint(int nodeId, Bitmap backdrop, float ox, float oy, float bdX, float bdY, float w, float h, float radius, Spec spec, float touchX, float touchY, float press) {
        return buildPaint(nodeId, backdrop, ox, oy, bdX, bdY, w, h, radius, spec, touchX, touchY, press, 1f, 1f);
    }

    /** ★★★决策 #906：带**降采样比**（backdrop 是缩小图；tex_scale/bias 按 divX/divY 折算）。 */
    public static Paint buildPaint(int nodeId, Bitmap backdrop, float ox, float oy, float bdX, float bdY, float w, float h, float radius, Spec spec, float touchX, float touchY, float press, float divX, float divY) {
        if (!isAvailable() || backdrop == null || backdrop.isRecycled() || spec == null || w <= 0f || h <= 0f) {
            android.util.Log.w("proteus-glass", "buildPaint early-null: avail=" + isAvailable()
                    + " backdrop=" + (backdrop == null ? "null" : backdrop.getWidth() + "x" + backdrop.getHeight())
                    + " spec=" + (spec == null ? "null" : "ok") + " w=" + w + " h=" + h);
            return null;
        }
        try {
            // ★★★只为「编译」缓存（源码静态）：每节点一份 RuntimeShader，跨帧复用 ⇒ 不再每帧重编（滚动不闪）。
            //   ★#900：缓存键 = nodeId + 材质（同一节点换材质需重建，正常情况下节点材质固定）。
            final GeneratedMaterials.Def def = GeneratedMaterials.MATERIALS.get(spec.material);
            final String fragSrc = def != null ? def.frag : GeneratedMaterials.GLASS_AGSL;
            final boolean isGlass = def == null || "GlassUniforms".equals(def.uniformStruct);
            final int shaderKey = nodeId * 8 + (isGlass ? 0 : 1);
            RuntimeShader sh = SHADER_CACHE.get(shaderKey);
            if (sh == null) {
                sh = new RuntimeShader(fragSrc);
                SHADER_CACHE.put(shaderKey, sh);
                android.util.Log.i("proteus-glass", "buildPaint: 编译 AGSL（一次，节点 " + nodeId + "，材质 " + spec.material + "，真源=WGSL）");
            }
            // 每帧只更新输入纹理 + uniform（廉价）
            // ★决策 #906：输入位图是**轻降采样小图** ⇒ 显式 LINEAR 过滤（否则最近邻放大出块状）。
            BitmapShader bs = new BitmapShader(backdrop, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) bs.setFilterMode(BitmapShader.FILTER_MODE_LINEAR);
            sh.setInputShader("backdrop_tex", bs);

            float a = ((spec.tint >>> 24) & 0xFF) / 255f;
            float cr = ((spec.tint >> 16) & 0xFF) / 255f;
            float cg = ((spec.tint >> 8) & 0xFF) / 255f;
            float cb = (spec.tint & 0xFF) / 255f;
            sh.setFloatUniform("tint", cr, cg, cb, a);
            sh.setFloatUniform("size_px", w, h);
            // ★AGSL 采样空间 = 画布像素：tex_scale=盒尺寸、tex_bias=节点左上角（**减去背景位图原点** ⇒
            //   采样落到该位图坐标）。render target 仍是整画布（玻璃画在主画布上），故 `origin` 用画布坐标。
            sh.setFloatUniform("origin", ox, oy);
            // ★决策 #906：tex_scale/bias 按**降采样比**折算（backdrop 是缩小图，覆盖同一屏幕区）。
            sh.setFloatUniform("tex_scale", w / divX, h / divY);
            sh.setFloatUniform("tex_bias", (ox - bdX) / divX, (oy - bdY) / divY);
            sh.setFloatUniform("blur", spec.blur);
            sh.setFloatUniform("saturation", spec.saturation);
            // ★#900：玻璃族专有 uniform（倒角厚板模型）；模糊族（backdropBlur/frosted/vibrancy）**无**这些键
            //   ⇒ 不设（设了会抛"未知 uniform"）。判别键 = 材质字典的 uniformStruct。
            if (isGlass) {
                sh.setFloatUniform("light_dir", -0.35f, -0.94f);
                sh.setFloatUniform("radius", radius);
                // ★边缘峰值位移：调研守恒 refractionAmount ≈ 2×倒角带宽；带宽 in-kernel = min(size)*0.22
                sh.setFloatUniform("refract_depth", Math.min(w, h) * 0.33f);   // ★#910：以 band(=0.33·min) 为基准 ⇒ strength=1.0 中性；非恒等 ⇒ 真旋钮
                // ★★★决策 #908：镜面高光 0.18 → 0.35 —— 真机像素对照 iOS：玻璃的"材质身份"主要来自**顶光高光
                //   + 锐利内缘亮线**；0.18 时几乎不可见 ⇒ 玻璃读作"半透明塑料片"。WGSL 里该项乘 `bevel_mask`
                //   （仅外缘带生效）⇒ 加大只强化边缘高光，不会把整面洗白。
                sh.setFloatUniform("specular", 0.35f);
                // ★★★决策 #911：区域级霜锚点——传入玻璃盒（含 pad 视角即节点盒）区域的平均背景亮度。
                //   换算同 tex_bias：节点盒左上在 backdrop 位图坐标 = (ox-bdX)/divX，宽 = w/divX。
                sh.setFloatUniform("bg_lum", regionLum(backdrop, (ox - bdX) / divX, (oy - bdY) / divY, w / divX, h / divY));
                // ★★★决策 #905：触控形变（touch 盒局部 px / press 0..1）
                sh.setFloatUniform("touch", touchX, touchY);
                sh.setFloatUniform("press", press);
                // ★#952：选中胶囊叠加层（0=无 / 1=叠半透明中性色）
                sh.setFloatUniform("overlay", spec.overlay);
                // ★`_pad2` 是尾部对齐填充（着色器不读）——**不设**：naga 落 AGSL 时把它改名 `_pad2_`，
                //   用原名 `setFloatUniform("_pad2")` 会抛（未知名）⇒ buildPaint 返 null ⇒ 玻璃静默降级实色。
            }

            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            p.setShader(sh);
            return p;
        } catch (Throwable t) {
            android.util.Log.w("proteus-glass", "buildPaint: AGSL FAIL " + t + " :: " + android.util.Log.getStackTraceString(t));
            return null; // 着色器编译/构建失败 ⇒ 降级（不崩）
        }
    }

    /** 节点 id → 已编译的 AGSL 着色器（源码静态 ⇒ 只编译一次；见 buildPaint 注释）。 */
    private static final java.util.HashMap<Integer, RuntimeShader> SHADER_CACHE = new java.util.HashMap<>();

    /** 清空着色器缓存（重挂载/换场景时调用——旧节点的着色器不再需要）。 */
    public static void clearShaderCache() {
        SHADER_CACHE.clear();
    }
}
