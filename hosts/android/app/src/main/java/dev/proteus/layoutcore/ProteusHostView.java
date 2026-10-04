package dev.proteus.layoutcore;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;
import android.view.ViewGroup;
import org.json.JSONObject;

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
        /**
         * ★★文本字号（**设备像素**；0 = 沿用 paint 当前字号）。
         *
         * 【为什么必须带上（2026-09-29 实测的公平性缺陷）】此前 Cmd **没有字号字段**，
         *   所有文本都用 `textPaint` 的默认值 **12px** 画；而原生对照用 **8sp**——
         *   本机 480dpi（density 3.0）⇒ 8sp = **24px** ⇒ 原生字形线性尺寸是本侧的 **2×**
         *   （面积 4×）⇒ **我们画的字更小、更省**，对比对我们有利（不公平）。
         *   ★纪律：**两边必须画同样的东西**（既有注释已记：不加背景色时两边绘制面积差 6 倍，
         *     像素自检 14803 vs 2479 直接暴露）——字号同属"同样的东西"。
         */
        final float fontSize;
        /**
         * ★★文本**静态色**（打包 `0xAARRGGBB`；0 = 未声明 ⇒ 用 `textPaint` 当前值）。
         *
         * 【为什么要带上（2026-10-01 收文字色边界）】文字色动画的"复位目标"与"探针回落值"
         *   都必须是**该节点绘制时真正会用到的静态色**——没有这个字段，`animTxProbe` 在
         *   stop 清表后只能报空串 ⇒ 判据无法区分"复位成功（应=基色）"与"读不到"
         *   （与底色当年抓出的口径缺陷同一形态）。
         *   ★与内核树里该节点的 `color` 声明**必须一致**（由场景构造方保证；判据断言自洽）。
         */
        final int textColor;
        /**
         * ★批次 3（CSS 兼容对齐）：文本**字重**（`font-weight` 折叠值；数值）。
         *   语义：`>= 600` ⇒ `Typeface.BOLD`（与 iOS `weight >= 600`、`configureText` 同判据）；
         *   缺省 **400**（normal）⇒ 既有全部路径零行为变化。
         */
        final int fontWeight;
        /**
         * ★批次 4（CSS 兼容对齐）：文本**水平对齐**（`text-align`）。0=left（缺省，零行为变化）/ 1=center / 2=right。
         *   映射到 `Paint.Align`（LEFT/CENTER/RIGHT）+ 绘制 x 按对齐换算（见 drawCmds）。
         */
        final int textAlign;
        /** ★批次 5（CSS 兼容对齐 · 边框）：uniform 边框宽度（px；0=无边框，零行为变化）。 */
        final float borderWidth;
        /** ★批次 5：uniform 边框颜色（ARGB；borderWidth>0 时生效）。 */
        final int borderColor;
        /** ★批次 10（CSS 兼容对齐 · 超级应用视觉）：盒阴影规格 `{dx,dy,blur,spread,color}`；null=无阴影（零行为变化）。 */
        final float[] boxShadow;
        /** ★批次 13（line-height）：行盒高（px；0 = 用字形度量高，字形基线沿用旧 0.8h——零行为变化）。 */
        final float lineHeight;
        /** ★批次 20（CSS 兼容对齐 · 以 Web 为基准）：`letter-spacing`（字距，**px**；0=默认 normal，零行为变化）。
         *   绘制/度量均按 `setLetterSpacing(px / fontSize)`（Android 该 API 的单位是 **em**）。 */
        final float letterSpacing;
        /** ★批次 35：文本装饰（0=none / 1=underline / 2=line-through）。 */
        final int textDecoration;
        /**
         * ★★圆角半径（px；0 = 直角）——纯绘制属性（内核不收，只影响观感）。
         *
         * 【为什么加（2026-10-01 · 灯光秀）】灯光秀的 800 颗灯珠用 4px 圆角（圆点观感）；
         *   既有 `drawCmds` 只有直角 `drawRect`。默认 0 ⇒ **既有全部路径零行为变化**。
         */
        final float radius;
        /**
         * ★★**渐变填充规格**（v1 · 2026-10-01）——`fillGradient` 的**结构化副本**
         *   （`kind` u8: 0=无 / 1=linear / 2=radial；`angleDeg`；`cx/cy/r`；`stops` 色标数组）。
         *   空（null）= 纯色填充（既有路径零行为变化）。
         *   ★为什么用"结构化副本"而不是原始 JSON：绘制每帧都要用（`drawCmds` 的 shader），
         *     每帧 `JSONObject` 解析会让绘制路径带上解析开销（本仓绘制纪律：零分配/零解析）。
         */
        final GradSpec gradient;
        /** ★★遮罩规格（mask v1）：`[kind(int), angle, cx, cy, r, softness]`；null = 无遮罩。
         *   揭示色标由**内核算好**（`MaskSpec::reveal_stops`）——宿主只翻译（零数学）。 */
        final float[] mask;
        /** ★★发光规格（glow v1）：`[color(int), radius, alpha]`；null = 无发光。
         *   渲染 = **分层同心描边**（N 层宽度梯度 + alpha 平方衰减——见 TS `glowLayers`）。 */
        final float[] glow;
        Cmd(float x, float y, float w, float h, int color, String text) {
            this(x, y, w, h, color, text, 0f, 0, 0f);
        }
        Cmd(float x, float y, float w, float h, int color, String text, float fontSize) {
            this(x, y, w, h, color, text, fontSize, 0, 0f);
        }
        Cmd(float x, float y, float w, float h, int color, String text, float fontSize, int textColor) {
            this(x, y, w, h, color, text, fontSize, textColor, 0f);
        }
        Cmd(float x, float y, float w, float h, int color, String text, float fontSize, int textColor, float radius) {
            this(x, y, w, h, color, text, fontSize, textColor, radius, null);
        }
        Cmd(float x, float y, float w, float h, int color, String text, float fontSize, int textColor, float radius,
            GradSpec gradient) {
            this(x, y, w, h, color, text, fontSize, textColor, radius, gradient, null, null);
        }
        Cmd(float x, float y, float w, float h, int color, String text, float fontSize, int textColor, float radius,
            GradSpec gradient, float[] glow) {
            this(x, y, w, h, color, text, fontSize, textColor, radius, gradient, glow, null);
        }
        Cmd(float x, float y, float w, float h, int color, String text, float fontSize, int textColor, float radius,
            GradSpec gradient, float[] glow, float[] mask) {
            this(x, y, w, h, color, text, fontSize, textColor, radius, gradient, glow, mask, 400, 0, 0f, 0);
        }
        Cmd(float x, float y, float w, float h, int color, String text, float fontSize, int textColor, float radius,
            GradSpec gradient, float[] glow, float[] mask, int fontWeight, int textAlign) {
            this(x, y, w, h, color, text, fontSize, textColor, radius, gradient, glow, mask, fontWeight, textAlign, 0f, 0);
        }
        Cmd(float x, float y, float w, float h, int color, String text, float fontSize, int textColor, float radius,
            GradSpec gradient, float[] glow, float[] mask, int fontWeight, int textAlign, float borderWidth, int borderColor) {
            this(x, y, w, h, color, text, fontSize, textColor, radius, gradient, glow, mask, fontWeight, textAlign, borderWidth, borderColor, null);
        }
        Cmd(float x, float y, float w, float h, int color, String text, float fontSize, int textColor, float radius,
            GradSpec gradient, float[] glow, float[] mask, int fontWeight, int textAlign, float borderWidth, int borderColor, float[] boxShadow) {
            this(x, y, w, h, color, text, fontSize, textColor, radius, gradient, glow, mask, fontWeight, textAlign, borderWidth, borderColor, boxShadow, 0f);
        }
        Cmd(float x, float y, float w, float h, int color, String text, float fontSize, int textColor, float radius,
            GradSpec gradient, float[] glow, float[] mask, int fontWeight, int textAlign, float borderWidth, int borderColor, float[] boxShadow, float lineHeight) {
            this(x, y, w, h, color, text, fontSize, textColor, radius, gradient, glow, mask, fontWeight, textAlign, borderWidth, borderColor, boxShadow, lineHeight, 0f);
        }
        Cmd(float x, float y, float w, float h, int color, String text, float fontSize, int textColor, float radius,
            GradSpec gradient, float[] glow, float[] mask, int fontWeight, int textAlign, float borderWidth, int borderColor, float[] boxShadow, float lineHeight, float letterSpacing) {
            this(x, y, w, h, color, text, fontSize, textColor, radius, gradient, glow, mask, fontWeight, textAlign, borderWidth, borderColor, boxShadow, lineHeight, letterSpacing, 0);
        }
        Cmd(float x, float y, float w, float h, int color, String text, float fontSize, int textColor, float radius,
            GradSpec gradient, float[] glow, float[] mask, int fontWeight, int textAlign, float borderWidth, int borderColor, float[] boxShadow, float lineHeight, float letterSpacing, int textDecoration) {
            this.x = x; this.y = y; this.w = w; this.h = h; this.color = color; this.text = text;
            this.fontSize = fontSize;
            this.textColor = textColor;
            this.radius = radius;
            this.gradient = gradient;
            this.glow = glow;
            this.mask = mask;
            this.fontWeight = fontWeight;
            this.textAlign = textAlign;
            this.borderWidth = borderWidth;
            this.borderColor = borderColor;
            this.boxShadow = boxShadow;
            this.lineHeight = lineHeight;
            this.letterSpacing = letterSpacing;
            this.textDecoration = textDecoration;
        }
    }

    /**
     * ★★**渐变规格**（v1 · 2026-10-01）——`fillGradient` 的宿主侧结构化形态。
     *
     * 【跨语言契约（与 TS `packages/animation/src/gradient.ts`、iOS `applyGradient` 同式）】
     *   · linear：`angle`（CSS 语义：0=向上/90=向右）——端点 = 中心 ± 半程方向向量；
     *   · radial：`cx/cy/r` 单位空间——`RadialGradient` 半径 = `r × 宽度`；
     *   · 色标：`colors`（ARGB int[]）+ `offsets`（0..1 float[]），**两数组等长**。
     *   ★alpha 已在颜色里（`alpha` 字段乘进 ARGB）——两端都不靠十六进制顺序。
     */
    static final class GradSpec {
        final int kind; // 1=linear 2=radial
        final float angleDeg;
        final float cx, cy, r;
        final int[] colors;
        final float[] offsets;
        GradSpec(int kind, float angleDeg, float cx, float cy, float r, int[] colors, float[] offsets) {
            this.kind = kind; this.angleDeg = angleDeg; this.cx = cx; this.cy = cy; this.r = r;
            this.colors = colors; this.offsets = offsets;
        }
        /**
         * 解析树里的 **`fillGradient`** JSON（非法 ⇒ null——★不静默挂一个空渐变）。
         * ★契约键名（与 TS `GRADIENT_CONTRACT_KEYS` 同表）：`kind` · `linear` · `radial` ·
         *   `angle` · `stops` · `offset` · `color` · `alpha` · `cx` · `cy`。门禁
         *   `check-gradient-contract.mjs` 要求本端引用全部键名（漏一个 = 该维度静默降级）。
         */
        static GradSpec parse(org.json.JSONObject fg) {
            if (fg == null) return null;
            String k = fg.optString("kind", "");
            int kind = "linear".equals(k) ? 1 : "radial".equals(k) ? 2 : 0;
            if (kind == 0) return null;
            org.json.JSONArray st = fg.optJSONArray("stops");
            if (st == null || st.length() < 2) return null;
            int n = st.length();
            int[] colors = new int[n];
            float[] offsets = new float[n];
            for (int i = 0; i < n; i++) {
                org.json.JSONObject o = st.optJSONObject(i);
                if (o == null) return null;
                String hex = o.optString("color", "");
                if (!hex.startsWith("#") || hex.length() != 7) return null; // 只接受 #RRGGBB（与 TS 校验同规）
                int c;
                try {
                    c = (int) (0xFF000000L | Long.parseLong(hex.substring(1), 16));
                } catch (NumberFormatException e) {
                    return null;
                }
                float a = (float) o.optDouble("alpha", 1.0);
                a = a < 0 ? 0 : a > 1 ? 1 : a;
                int aa = (int) (a * 255f + 0.5f);
                colors[i] = (c & 0x00FFFFFF) | (aa << 24);
                offsets[i] = (float) o.optDouble("offset", 0);
            }
            float angle = (float) fg.optDouble("angle", 90);
            float cx = (float) fg.optDouble("cx", 0.5);
            float cy = (float) fg.optDouble("cy", 0.5);
            float r = (float) fg.optDouble("r", 1.0);
            if (kind == 2 && !(r > 0)) return null;
            return new GradSpec(kind, angle, cx, cy, r, colors, offsets);
        }
    }

    /* ══════════ ★native-host 节点（原生 View 嵌入，方案 L3） ══════════ */

    /** 节点 id → 原生 View */
    private final Map<Integer, View> nativeHosts = new HashMap<>();
    /** ★★**变换原点表**（transform-origin v1）：节点 id → `[x, y]` 盒分数（缺省不存 = 中心） */
    private final Map<Integer, float[]> nodeTransformOrigin = new HashMap<>();

    /** ★批次 34：节点 id → **逐角圆角掩码**（bit0=TL/1=TR/2=BR/3=BL；15=统一，缺省不存） */
    private final Map<Integer, Integer> nodeRadiusCorners = new HashMap<>();
    /** 场景注入某节点的逐角圆角掩码（仅**非统一**时注入——统一走 Cmd.radius） */
    public void setNodeRadiusCorners(int nodeId, int mask) {
        if (mask == 15) { nodeRadiusCorners.remove(nodeId); return; }
        nodeRadiusCorners.put(nodeId, mask);
    }

    /** ★批次 36：节点 id → 字体角色（`fontFamily` 归一；缺省不存 = system） */
    private final Map<Integer, String> nodeFontRole = new HashMap<>();
    /** 场景注入某节点的字体角色 */
    public void setNodeFontRole(int nodeId, String role) {
        if (role == null || role.isEmpty()) { nodeFontRole.remove(nodeId); return; }
        nodeFontRole.put(nodeId, role);
    }

    /** 场景注入某节点的变换原点（`[x, y]` 盒分数）——建树时由 LightsHost/MainActivity 调用 */
    public void setNodeTransformOrigin(int nodeId, float ox, float oy) {
        nodeTransformOrigin.put(nodeId, new float[]{ox, oy});
    }

    /**
     * ★批次 39：节点 id → **静态变换**。格式与 `animTx` **前 9 位同构** `[txPx,tyPx,scale,rotate,opacity,rotX,rotY,skewX,skewY]`，
     *   末尾追加 `txPct,tyPct`（位移的**盒比例**分量；绘制时按盒尺寸换算——`translate(-50%,-50%)` 居中刚需）。
     *   缺省不存 = 无变换。动画表缺该节点时退回本表（静态是动画的基态）。
     */
    private final Map<Integer, float[]> nodeStaticTx = new HashMap<>();
    /** 场景注入某节点的静态变换（编译期 CSS `transform`）——px 位移 + 盒比例位移 + 等比缩放 + 旋转 */
    public void setNodeTransform(int nodeId, float txPx, float tyPx, float scale, float rotate, float txPct, float tyPct) {
        if (txPx == 0f && tyPx == 0f && txPct == 0f && tyPct == 0f && scale == 1f && rotate == 0f) {
            nodeStaticTx.remove(nodeId);
            return;
        }
        nodeStaticTx.put(nodeId, new float[]{txPx, tyPx, scale, rotate, 1f, 0f, 0f, 0f, 0f, txPct, tyPct});
    }

    /** 节点 id → Rust 几何（**位置/尺寸的唯一来源**；子 View 的 measure/layout 都用它） */
    private final Map<Integer, RectF> nativeRects = new HashMap<>();

    /* ══════════ ★★字体族（与 iOS `SelfDrawBridge.font(size:weight:family:)` 同契约） ══════════ */

    /**
     * **语义角色 → Android `Typeface`**（与 iOS 侧**同一套角色词汇表**，见适配器 `normalizeFontFamily`）
     *
     * | 角色 | Android 映射 |
     * |---|---|
     * | `system` | `Typeface.DEFAULT`（含 bold 变体） |
     * | `serif` | `Typeface.SERIF` |
     * | `monospace` | `Typeface.MONOSPACE` |
     * | `rounded` | `Typeface.create("sans-serif-rounded", …)`（API 21+ 有该族；缺则回退 DEFAULT 并计数） |
     * | `condensed` | `Typeface.create("sans-serif-condensed", …)`（同上） |
     *
     * ★★**为什么这是"映射"而不是"自己发明一套"**：角色字符串由**适配器**产出（`normalizeFontFamily`
     *   已把 CSS 候选清单归一到 5 个角色）。平台侧只做「角色 → 本平台字体」——这是唯一平台相关的部分。
     *   iOS 侧已按同一契约实现（`SelfDrawBridge.font`）。**两端共用一份词汇表**，未知角色显式回退 + 计数。
     *   ★诚实边界：Android 的族名（`sans-serif-rounded` 等）是**系统族（family）**，
     *     与 iOS 的 `SystemDesign`/具体字体名**不是同一批字体** ⇒ 两端"衬线体"长得不完全一样
     *     （那是平台字体库的固有差异，能力对齐 ≠ 像素一致）。
     */
    public static android.graphics.Typeface typefaceOf(String role, int weight, int[] fallbackCounter) {
        boolean bold = weight >= 600;
        // ★★自定义字体（`custom:<族名>`）——**先查注册表**（2026-09-29）
        //   契约见适配器 `CUSTOM_FONT_PREFIX`。未注册 ⇒ **回退 system + 计数**（不静默：
        //   "未识别"与"识别为默认"必须可区分）。
        if (role != null && role.startsWith(CUSTOM_FONT_PREFIX)) {
            String name = role.substring(CUSTOM_FONT_PREFIX.length());
            android.graphics.Typeface tf = customFonts.get(name);
            if (tf != null) return tf;
            customFontMisses++;
            lastMissingCustomFont = name;
            return android.graphics.Typeface.create("sans-serif",
                    bold ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
        }
        String fam;
        switch (role == null ? "system" : role) {
            case "serif": fam = "serif"; break;
            case "monospace": fam = "monospace"; break;
            case "rounded": fam = "sans-serif-rounded"; break;
            case "condensed": fam = "sans-serif-condensed"; break;
            case "system": fam = "sans-serif"; break;
            default:
                // ★未知角色：**显式回退 + 计数**（不静默——两端契约不一致时必须可见）
                if (fallbackCounter != null) fallbackCounter[0]++;
                fam = "sans-serif";
                break;
        }
        return android.graphics.Typeface.create(fam, bold ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
    }

    /* ══════════ ★★自定义字体注册通道（@font-face / 打包字体）══════════════ */

    /** 与适配器 `CUSTOM_FONT_PREFIX` **同一常量**（两端契约；不一致则自定义族永远命中不了） */
    public static final String CUSTOM_FONT_PREFIX = "custom:";

    /** 族名 → 字体（注册表） */
    private static final java.util.Map<String, android.graphics.Typeface> customFonts = new java.util.HashMap<>();

    /** 未注册的自定义族名命中次数（诊断：>0 ⇒ 宿主缺字体资源，**不是**静默回退） */
    public static int customFontMisses = 0;
    /** 最近一个未注册的族名（诊断用：报告里可读出到底缺哪个字体） */
    public static String lastMissingCustomFont = null;

    /**
     * 注册自定义字体（**族名 → 字体文件路径**）。
     *
     * 【为什么需要显式注册】平台无法从族名"猜"出字体文件：`Typeface.create(name,…)` 只在
     *   **系统已安装字体**里查找，打包进 assets 或外部路径的字体必须先 `createFromFile` 加载。
     *   ⇒ 注册是应用（宿主）的责任；框架提供通道 + 未注册时的**显式可见降级**。
     *
     * @return true = 注册成功（字体文件可解析）；false = 失败（调用方应记日志，**不静默**）
     */
    public static boolean registerFont(String family, String filePath) {
        try {
            android.graphics.Typeface tf = android.graphics.Typeface.createFromFile(filePath);
            customFonts.put(family, tf);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 注册表规模（验收判据用） */
    public static int registeredFontCount() { return customFonts.size(); }

    /** 清空注册表（测试隔离用——跨用例共享状态必须可归零，本仓纪律 #10） */
    public static void clearFonts() {
        customFonts.clear();
        customFontMisses = 0;
        lastMissingCustomFont = null;
    }

    /** 字体族回退计数（诊断：>0 ⇒ 两端词汇表不一致） */
    public int fontFamilyFallbacks = 0;

    /**
     * 按角色/字号/字重配置 `textPaint`（**度量与绘制共用同一支 paint** ⇒ 同源）
     *
     * ★为什么必须"同源"：iOS 侧已因"度量用一支字体、绘制用另一支"踩过（字被裁而报告全绿）。
     *   本方法让两者的唯一来源都是 `typefaceOf`。
     */
    public void configureText(float sizePx, int weight, String familyRole, int color) {
        textPaint.setTextSize(sizePx);
        textPaint.setTypeface(typefaceOf(familyRole, weight, null));
        textPaint.setColor(color);
    }

    private List<Cmd> cmds = java.util.Collections.emptyList();
    private final Paint bgPaint = new Paint();
    /** 图集重放专用（用 shader 精确定位，避免 drawBitmap 的密度/插值干扰） */
    private final Paint atlasPaint = new Paint();
    // ★StaticLayout 要求 `TextPaint`（Paint 的子类）——文本配置色/字号都在它上面
    private final android.text.TextPaint textPaint = new android.text.TextPaint(android.graphics.Paint.ANTI_ALIAS_FLAG);
    /** ★★C2：描边笔（STROKE 风格——与填充用的 bgPaint 分开；圆头圆角与 iOS 一致） */
    private final android.graphics.Paint strokePaint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
    /** ★批次 5：边框描边专用（与 SVG/glow 的 strokePaint 分开——避免相互污染 STROKE 样式/宽度）。 */
    private final android.graphics.Paint borderPaint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
    /** ★批次 10：盒阴影填充专用（分层近似——与 border/glow 分开避免相互污染）。 */
    private final android.graphics.Paint shadowPaint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
    /** ★★软边遮罩合成用（mask v1）：`渐变 shader + DST_IN`（见 drawCmds 的遮罩合成段） */
    private final android.graphics.Paint maskPaint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);

    /* ══════════ ★★逐节点平台动画（Android：载体 View + ViewPropertyAnimator）══════════ */

    /**
     * 动画载体：一个**只画该节点那几条指令**的 View。
     *
     * 【为什么必须是 View（据 android.jar 的取证结论，非记忆）】"逐节点平台动画"要求
     *   **渲染线程**自主插值。Android 公开 API 里：
     *   · `RenderNode` + `Canvas.drawRenderNode` **是**公开的，但 **`RenderNodeAnimator` 不公开**
     *     ⇒ 裸 `RenderNode` 的属性只能被主线程逐帧"设置"，**无法在 RenderThread 上动画**；
     *   · 能被平台动画的只有 **View**（`ViewPropertyAnimator` → `RenderNodeAnimator`）。
     *   ⇒ 落点：把目标节点**提升**为只含该节点指令的载体 View，由平台动画驱动其 transform/alpha。
     *
     * ★**这不是"改回 View 体系"**：载体只承载**被动画的节点**（通常 1–3 个），其余节点仍走
     *   `onDraw` 指令流（无 View 树）；动画结束载体即拆除。
     */
    private static final class CarrierView extends View {
        private final List<Cmd> items;       // 已转成**相对载体**坐标
        private final Paint bg = new Paint();
        private final android.text.TextPaint tp = new android.text.TextPaint(android.graphics.Paint.ANTI_ALIAS_FLAG);

        CarrierView(Context ctx, List<Cmd> items) {
            super(ctx);
            this.items = items;
            setWillNotDraw(false);
            tp.setColor(Color.BLACK);
            tp.setTextSize(12f);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            float last = tp.getTextSize();
            for (int i = 0; i < items.size(); i++) {
                Cmd c = items.get(i);
                bg.setColor(c.color);
                canvas.drawRect(c.x, c.y, c.x + c.w, c.y + c.h, bg);
                if (c.text != null) {
                    if (c.fontSize > 0 && c.fontSize != last) { tp.setTextSize(c.fontSize); last = c.fontSize; }
                    canvas.drawText(c.text, c.x + 1f, c.y + c.h * 0.8f, tp);
                }
            }
        }
    }

    /** 节点 id → 动画载体 */
    private final Map<Integer, CarrierView> animCarriers = new HashMap<>();
    /** 节点 id → 载体几何（节点矩形，宿主坐标系） */
    private final Map<Integer, RectF> animCarrierRects = new HashMap<>();
    /** 动画中**要从指令流里跳过**的指令下标（内容已由载体画 ⇒ 不能再画一份，否则重影） */
    private java.util.Set<Integer> skipCmdIndices = null;

    /* 判据计数器：动画期间 measure / layout / draw 的增量都应为 0（三个"零"） */
    private int onMeasureCount = 0;
    private int onLayoutCount = 0;
    /** 载体动画读数（判据：model 值逐帧推进 + 终态精确） */
    private float carrierTx = 0f, carrierTy = 0f, carrierScale = 1f, carrierAlpha = 1f;
    private int carrierDrawBefore = 0, carrierDrawAfter = 0;
    private int carrierMeasureBefore = 0, carrierMeasureAfter = 0;
    private int carrierLayoutBefore = 0, carrierLayoutAfter = 0;
    private boolean carrierAnimRunning = false;

    /**
     * ★★**接入逐节点动画载体**：把该节点的指令提升为独立 View，并启动平台动画。
     *
     * @param nodeId 节点 id（簿记键；宿主不解析其语义）
     * @param items  该节点的绘制指令（**绝对坐标**；内部转成相对载体坐标）
     * @param rect   节点矩形（宿主坐标系；载体位置 = 它，动画走 translation ⇒ 不触发 layout）
     * @param skip   这些指令在 `cmds` 里的下标（从指令流跳过）
     */
    public void attachAnimCarrier(int nodeId, List<Cmd> items, RectF rect, java.util.Set<Integer> skip,
                                  float tx, float ty, float scale, float rotation, float alpha,
                                  long durMs, long delayMs,
                                  float bx1, float by1, float bx2, float by2) {
        // ① 指令坐标 → 相对载体
        List<Cmd> rel = new java.util.ArrayList<>(items.size());
        for (Cmd c : items) {
            rel.add(new Cmd(c.x - rect.left, c.y - rect.top, c.w, c.h, c.color, c.text, c.fontSize));
        }
        final CarrierView carrier = new CarrierView(getContext(), rel);
        // ② 播放中把这些指令从指令流跳过（否则**重影**：指令流一份 + 载体一份）
        skipCmdIndices = skip;
        animCarriers.put(nodeId, carrier);
        animCarrierRects.put(nodeId, new RectF(rect));
        addView(carrier);
        carrier.layout(exactPx(rect.left), exactPx(rect.top), exactPx(rect.right), exactPx(rect.bottom));
        invalidate();

        android.animation.TimeInterpolator interp = (bx1 == 0f && by1 == 0f && bx2 == 1f && by2 == 1f)
                ? new android.view.animation.LinearInterpolator()
                : new android.view.animation.PathInterpolator(bx1, by1, bx2, by2);
        // ③ 三个"零"的基线（动画期间 measure/layout/draw 都不得增长）
        carrierDrawBefore = onDrawCount;
        carrierMeasureBefore = onMeasureCount;
        carrierLayoutBefore = onLayoutCount;
        carrierAnimRunning = true;
        carrier.animate()
                .translationX(tx).translationY(ty)
                .scaleX(scale).scaleY(scale)
                .rotation(rotation).alpha(alpha)
                .setDuration(durMs).setStartDelay(delayMs)
                .setInterpolator(interp)
                .withEndAction(new Runnable() {
                    @Override public void run() {
                        carrierAnimRunning = false;
                        carrierDrawAfter = onDrawCount;
                        carrierMeasureAfter = onMeasureCount;
                        carrierLayoutAfter = onLayoutCount;
                    }
                })
                .start();
    }

    /** 逐节点动画读数（判据：三个"零"增量 + model 值推进 + 终态） */
    public String carrierAnimStats() {
        CarrierView c = animCarriers.isEmpty() ? null : animCarriers.values().iterator().next();
        if (c != null) {
            carrierTx = c.getTranslationX();
            carrierTy = c.getTranslationY();
            carrierScale = c.getScaleX();
            carrierAlpha = c.getAlpha();
        }
        return "{\"running\":" + (carrierAnimRunning ? "true" : "false")
                + ",\"carriers\":" + animCarriers.size()
                + ",\"tx\":" + carrierTx + ",\"ty\":" + carrierTy
                + ",\"scale\":" + carrierScale + ",\"alpha\":" + carrierAlpha
                + ",\"draw_delta\":" + (carrierDrawAfter - carrierDrawBefore)
                + ",\"measure_delta\":" + (carrierMeasureAfter - carrierMeasureBefore)
                + ",\"layout_delta\":" + (carrierLayoutAfter - carrierLayoutBefore)
                + ",\"on_draw_count\":" + onDrawCount
                + ",\"on_measure_count\":" + onMeasureCount
                + ",\"on_layout_count\":" + onLayoutCount + "}";
    }

    /** 拆除全部动画载体（复位 + 恢复指令流绘制；相位间清理） */
    public void resetAnimCarriers() {
        for (CarrierView c : animCarriers.values()) {
            c.animate().cancel();
            removeView(c);
        }
        animCarriers.clear();
        animCarrierRects.clear();
        skipCmdIndices = null;
        carrierAnimRunning = false;
        carrierTx = carrierTy = 0f;
        carrierScale = carrierAlpha = 1f;
        carrierDrawBefore = carrierDrawAfter = onDrawCount;
        invalidate();
    }

    public int animCarrierCount() { return animCarriers.size(); }
    public int onMeasureCount() { return onMeasureCount; }
    public int onLayoutCount() { return onLayoutCount; }

    /* ══════════ ★★内核驱动动画（tick 路径）：node id → Cmd 变换 ══════════ */

    /**
     * 指令表与节点 id 的**并行表**（`-1` = 该指令未绑定节点）。
     *
     * 【为什么需要】内核动画按**节点 id** 给值，而 `Cmd` 是"纯绘制指令"（不含 id——
     *   见 `JsRenderHost.cmdIds` 的同款注释：给 Cmd 塞 id 会把宿主协议与簿记耦合）。
     *   ⇒ 映射在宿主侧；绘制时按下标查表套变换。
     */
    private int[] cmdNodeIds = null;
    /** 节点 id → [tx, ty, scale, rotate, opacity, rotateX, rotateY]（**宿主侧真源**：探针从这里读） */
    private final Map<Integer, float[]> animTx = new HashMap<>();
    /**
     * ★★节点 id → **透视距离**（px；B 批 3D）——场景建树时注入（`setNodePerspective`）。
     * 语义与 iOS `layerPerspective` / CSS `perspective` 同：rotateX/Y ≠ 0 时 d 参与投影。
     */
    private final Map<Integer, Float> nodePerspective = new HashMap<>();

    /** 场景注入某节点的透视距离（B 批 3D；缺省无透视 = 正交投影） */
    public void setNodePerspective(int nodeId, float d) {
        if (d > 0) nodePerspective.put(nodeId, d);
    }

    /**
     * ★★**裁剪形状快照**（C1；建树时注入）——kind 1=inset 2=circle 3=polygon；
     * params 是**盒分数**。动画期只改参数（由 108B 记录携带），不动类型。
     */
    private final Map<Integer, float[]> nodeClipKindAndBase = new HashMap<>();

    /**
     * 场景注入某节点的裁剪形状（C1；kind 0 = 不注入）。
     * ★同时记**基态参数**（16 槽；不足补 0）——静态裁剪（声明了但未动画）靠它渲染：
     *   内核只上报"值变化"的节点 ⇒ 未动的裁剪节点不会出现在每帧记录里
     *   （首版只从每帧记录取参数 ⇒ **静态裁剪完全不生效**——由红蓝对比测试抓出）。
     */
    public void setNodeClipPath(int nodeId, int kind, float[] params) {
        if (kind > 0 && params != null) {
            float[] full = new float[17]; // [0] = kind，[1..16] = 参数
            full[0] = kind;
            for (int i = 0; i < Math.min(16, params.length); i++) full[i + 1] = params[i];
            nodeClipKindAndBase.put(nodeId, full);
        }
    }
    /** 裁剪类型（0 = 无）——宿主内用（探针/绘制判定） */
    /** 裁剪形状类型（探针/判据用——公开只读视图，不改变任何行为） */
    public int clipKindOfPublic(int nodeId) {
        return clipKindOf(nodeId);
    }

    /** 描边路径总弧长（探针/判据用；0 = 无描边层）——读**宿主真源** `nodeSvgStroke` */
    public float svgStrokeLength(int nodeId) {
        Object[] svg = nodeSvgStroke.get(nodeId);
        if (svg == null) return 0f;
        try {
            android.graphics.Path p = (android.graphics.Path) svg[0];
            return new android.graphics.PathMeasure(p, false).getLength();
        } catch (Throwable t) {
            return 0f;
        }
    }

    private int clipKindOf(int nodeId) {
        final float[] v = nodeClipKindAndBase.get(nodeId);
        return v == null ? 0 : (int) v[0];
    }

    /**
     * 场景注入某节点的 SVG 描边（C2）——段列表由内核给出。
     *
     * ★段形态 = **内核 `PathSeg` 的 serde 序列化形态**（2026-10-01 真机接通时修正）：
     *   `{"MoveTo":[x,y]}` / `{"LineTo":[x,y]}` / `{"CubicTo":[x1,y1,x2,y2,x,y]}` /
     *   `{"QuadTo":[x1,y1,x,y]}` / `"Close"`（单位串）。
     *   ★首版按臆想的 `{"t":"M","v":[…]}` 写 ⇒ 与内核不对接（iOS 侧真机抓出 strokeEnd=-1）。
     */
    public void setNodeSvgStroke(int nodeId, org.json.JSONArray segs, int strokeColor, float strokeWidth) {
        setNodeSvgStroke(nodeId, segs, strokeColor, strokeWidth, 0f);
    }

    /**
     * ★★**含声明基态的重载**（2026-10-01 · 手卷浏览抓出的缺口）：`progressBase` = 这条路径
     *   在树里声明的"生来画到哪"（`svgPath.progress`；缺省 0 = 未画）——静态浏览的描边节点
     *   声明 `progress:1`，宿主据此直接画全；无动画表项时以它为回落值。
     */
    public void setNodeSvgStroke(int nodeId, org.json.JSONArray segs, int strokeColor, float strokeWidth,
                                 float progressBase) {
        android.graphics.Path path = new android.graphics.Path();
        for (int i = 0; i < segs.length(); i++) {
            Object raw = segs.opt(i);
            if ("Close".equals(raw)) { path.close(); continue; }
            if (!(raw instanceof org.json.JSONObject)) continue;
            org.json.JSONObject seg = (org.json.JSONObject) raw;
            java.util.Iterator<String> keys = seg.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                org.json.JSONArray va = seg.optJSONArray(k);
                if (va == null) continue;
                float[] v = new float[va.length()];
                for (int kk = 0; kk < va.length(); kk++) v[kk] = (float) va.optDouble(kk, 0);
                switch (k) {
                    case "MoveTo": if (v.length >= 2) path.moveTo(v[0], v[1]); break;
                    case "LineTo": if (v.length >= 2) path.lineTo(v[0], v[1]); break;
                    case "CubicTo":
                        if (v.length >= 6) path.cubicTo(v[0], v[1], v[2], v[3], v[4], v[5]);
                        break;
                    case "QuadTo":
                        if (v.length >= 4) path.quadTo(v[0], v[1], v[2], v[3]);
                        break;
                    default: break;
                }
            }
        }
        nodeSvgStroke.put(nodeId, new Object[]{path, strokeColor, strokeWidth, progressBase});
    }

    /** 每帧下发的裁剪参数（16 槽；空 = 本帧该节点无裁剪更新） */
    private final Map<Integer, float[]> animClip = new HashMap<>();

    /**
     * ★★**SVG 描边快照**（C2；建树时注入）——{Path, strokeColor, strokeWidth, progressBase}。
     * 段列表由**内核解析**（`svg_path` 模块）；本类只做"段 → android.graphics.Path"的翻译。
     * ★第 4 项 = 声明基态（2026-10-01）：绘制/探针在动画表无该节点时**回落到它**
     *   （静态 `progress:1` 的路径生来已画成——见 `svgPath.progress` 内核注释）。
     */
    private final Map<Integer, Object[]> nodeSvgStroke = new HashMap<>(); // {Path, strokeColor(int), strokeWidth(float), progressBase(float)}
    /** 每帧下发的描边进度（0..1；空 = 本帧无更新） */
    private final Map<Integer, Float> animStroke = new HashMap<>();
    /**
     * ★★节点 id → **动画颜色**（打包 `0xAARRGGBB`）——内核颜色通道的绘制落点（2026-10-01）
     *
     * 【为什么要这张表（与 `animTx` 同源的理由）】内核每帧下发的颜色要**落到绘制**上：
     *   `drawCmds` 用 `Cmd.color` 画（那是 Java 侧的静态调色板）⇒ 动画期间必须用覆盖值。
     *   表里没有的节点 ⇒ 用 `Cmd.color`（= 未参与颜色动画的常态，零额外开销）。
     * 【与 `animTx` 的分工】`animTx` 是**几何变换**（tx/ty/scale/rotate/opacity），
     *   本表只装**颜色**——两者生命周期一致（都在 `animStopAll`/`clearScene` 时清）。
     */
    private final Map<Integer, Integer> animColor = new HashMap<>();
    /**
     * ★★节点 id → **动画文字色**（打包 `0xAARRGGBB`）——文字色通道的绘制落点（2026-10-01）
     *
     * 【为什么单开一张表（而不是与 `animColor` 合并成一个"当前色"）】底色与文字色是
     *   两条**独立轨道**（一个节点可以同时动两者），合并会让后写者覆盖前者。
     *   绘制时分别取：底色 → `bgPaint`，文字色 → `textPaint`。
     */
    private final Map<Integer, Integer> animTextColor = new HashMap<>();
    /** 最近一次 apply 的条数（诊断） */
    public int lastAnimApplied = 0;

    public void setCmdNodeIds(int[] ids) {
        this.cmdNodeIds = ids;
        invalidate();
    }

    /** 节点 → 变换映射的规模（探针/判据：确认值真的落了） */
    public int animTxCount() { return animTx.size(); }

    /**
     * 应用内核 `updates`（JSON 形态：`{"updates":[[id,tx,ty,scale,rot,op],…]}`）——返回条数。
     *
     * ★与 `applyTickBin` **同一条真源**（`animTx`）：两条通道只是编码不同（JSON/二进制），
     *   语义必须一致 ⇒ 解析后都进同一个 map。
     */
    public int applyAnimUpdates(String json) {
        if (json == null) return 0;
        int n = 0;
        try {
            org.json.JSONObject o = new org.json.JSONObject(json);
            org.json.JSONArray arr = o.optJSONArray("updates");
            if (arr == null) return 0;
            for (int i = 0; i < arr.length(); i++) {
                org.json.JSONArray u = arr.optJSONArray(i);
                if (u == null || u.length() < 4) continue;
                int id = u.optInt(0);
                float rot = u.length() >= 6 ? (float) u.optDouble(4) : 0f;
                float op = u.length() >= 6 ? (float) u.optDouble(5) : 1f;
                // ★B 批 3D：第 9/10 项（40B 记录的 JSON 形态）
                float rotX = u.length() >= 10 ? (float) u.optDouble(8) : 0f;
                float rotY = u.length() >= 10 ? (float) u.optDouble(9) : 0f;
                animTx.put(id, new float[]{
                        (float) u.optDouble(1), (float) u.optDouble(2), (float) u.optDouble(3), rot, op, rotX, rotY});
                // ★C2：第 28 项 = 描边进度（u32::MAX = 无描边路径；否则 f32 位模式）
                if (u.length() >= 28) {
                    long sv = (long) u.optDouble(27, 4294967295.0);
                    if (sv >= 0 && sv < 4294967295L) {
                        animStroke.put(id, Float.intBitsToFloat((int) sv));
                    } else {
                        animStroke.remove(id);
                    }
                }
                // ★C1：第 11 项 = 裁剪类型；第 12..27 项 = 16 参数
                if (u.length() >= 27) {
                    final boolean hasClip = u.optDouble(10, 0) != 0;
                    if (hasClip) {
                        float[] ps = new float[16];
                        for (int k = 0; k < 16; k++) ps[k] = (float) u.optDouble(11 + k, 0);
                        animClip.put(id, ps);
                    } else {
                        animClip.remove(id);
                    }
                }
                // ★颜色（2026-10-01）：第 7/8 项是打包色（底色 / 文字色）；
                //   **越界或 u32::MAX 哨兵**（JSON 形态 4294967295 = "无该基色"）⇒ 清出表。
                //   ★哨兵必须**排除**（与 iOS `packedOpt` 同一处口径缺陷的修复）：
                //     写成 `<= 0xFFFFFFFF` 会把哨兵当合法色（0xFFFFFFFF = 不透明白）⇒
                //     无颜色轨道的节点被涂白。`< 0xFFFFFFFF` 才正确。
                if (u.length() >= 7) {
                    long raw = (long) u.optDouble(6, -1);
                    if (raw >= 0 && raw < 0xFFFFFFFFL) animColor.put(id, (int) raw);
                    else animColor.remove(id);
                }
                if (u.length() >= 8) {
                    long raw = (long) u.optDouble(7, -1);
                    if (raw >= 0 && raw < 0xFFFFFFFFL) animTextColor.put(id, (int) raw);
                    else animTextColor.remove(id);
                }
                n++;
            }
        } catch (Throwable ignored) {
            // JSON 坏 ⇒ 返回真实条数（不假装成功）；判据侧比对"started vs applied"时会发现
        }
        lastAnimApplied = n;
        if (n > 0) invalidate();
        return n;
    }

    /** ★**每帧二进制通道**（32B/条，全小端）——与 iOS 同一份内核、同一条性能纪律 */
    private int applyTickBin(byte[] bin) {
        if (bin == null || bin.length < ANIM_RECORD_BYTES) return 0;
        java.nio.ByteBuffer bb = java.nio.ByteBuffer.wrap(bin).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        int n = bin.length / ANIM_RECORD_BYTES;
        for (int i = 0; i < n; i++) {
            int id = bb.getInt();
            float tx = bb.getFloat(), ty = bb.getFloat(), sc = bb.getFloat();
            float rot = bb.getFloat(), op = bb.getFloat();
            int rgba = bb.getInt();
            int textRgba = bb.getInt();
            // ★B 批 3D（40B 记录末尾追加）——在 bg/textColor 之后
            float rotX = bb.getFloat(), rotY = bb.getFloat();
            // ★长度 7 → 9（追加 skewX/skewY 两槽——下标 7/8；既有下标 0..6 语义不变）
            animTx.put(id, new float[]{tx, ty, sc, rot, op, rotX, rotY, 0f, 0f});
            // ★★C1：裁剪段（@40 起：kind u32 + 16×f32——108B 记录）
            int clipKind = bb.getInt();
            if (clipKind != 0) {
                float[] ps = new float[16];
                for (int k = 0; k < 16; k++) ps[k] = bb.getFloat();
                animClip.put(id, ps);
            } else {
                // 类型 0 = 本节点无裁剪 —— 保险清掉（与"解绑含清值"同源）
                animClip.remove(id);
                for (int k = 0; k < 16; k++) bb.getFloat();
            }
            // ★★C2：描边进度（@108 的 f32；NaN = 无描边路径——112B 记录）
            float strokeRaw = bb.getFloat();
            if (!Float.isNaN(strokeRaw)) animStroke.put(id, strokeRaw);
            else animStroke.remove(id);
            // ★★渐变 v2（2026-10-01）：混合后的色标（@112 起：kind u32 + n u32 + 8×colors u32
            //   + 8×offsets f32——184B 记录）。`kind=0` = 无渐变/未变化（忽略）。
            //   ★这些是**内核已混合**的结果（唯一 lerp 实现在内核——宿主零插值数学）；
            //     直接更新该节点的 shader 规格（绘制侧下一帧自然用新色标）。
            int gradKind = bb.getInt();
            int gradN = bb.getInt();
            int[] gColors = new int[8];
            float[] gOffsets = new float[8];
            for (int k = 0; k < 8; k++) gColors[k] = bb.getInt();
            for (int k = 0; k < 8; k++) gOffsets[k] = bb.getFloat();
            // ★★路径变形 v1（@184 的 f32；NaN = 本节点无 B 态）
            //   ★★顺序纪律（2026-10-01 真机崩溃的根因）：**读取顺序必须与内核写入顺序逐字节一致**。
            //     内核顺序 = 渐变段 → path_morph(@184) → glow(@188) → **geo(@192)**；
            //     首版把 geo 写在 morph/glow **之前**读 ⇒ 全部错位（"geo[0]"读到 path_morph，
            //     无 B 态节点是 NaN ⇒ NaN 传进 LinearGradient 端点 ⇒ nativeCreate 抛
            //     IllegalArgumentException ⇒ **绘制线程崩溃**（真机黑屏无报告）。
            //     这是本仓"线格式偏移即契约"纪律的又一次实证：**追加字段也要按序读**。
            float morphRaw = bb.getFloat();
            if (!Float.isNaN(morphRaw)) {
                animMorphFactor.put(id, morphRaw);
                refreshMorphPath(id, morphRaw);   // 因子变化才真查（内部有缓存判断）
            } else {
                animMorphFactor.remove(id);
                morphCache.remove(id);
            }
            // ★★发光**强度**（glow v1，@188 的 f32；NaN = 本节点无发光——192B 记录）。
            //   契约键名 `"intensity"`（与 TS `GRADIENT_CONTRACT_KEYS` 同表）——本表即它在本端的落点。
            float glowRaw = bb.getFloat();
            if (!Float.isNaN(glowRaw)) animGlow.put(id, glowRaw);
            else animGlow.remove(id);
            // ★★渐变几何（@192 起 4×f32 = `[angle, cx, cy, r]`——渐变 v2 扩展；
            //   在 morph/glow **之后**（与内核写入顺序一致——顺序纪律见上）。
            //   ★NaN/非有限 ⇒ 不覆盖几何（首版错位把 NaN 传进 shader 崩了绘制线程）。
            float gAngle = bb.getFloat(), gCx = bb.getFloat(), gCy = bb.getFloat(), gR = bb.getFloat();
            // ★★渐变**入表**（2026-10-01 真机取证：此前只读不用 ⇒ animGrad 永远空 ⇒
            //   探针读到静态回落值 0.55、绘制也用静态几何——**"读了但没入表"是最隐蔽的一类**）
            if (gradKind != 0) {
                final boolean geoOk = Float.isFinite(gAngle) && Float.isFinite(gCx)
                        && Float.isFinite(gCy) && Float.isFinite(gR);
                animGrad.put(id, new ProteusHostView.TickGrad(gradKind, Math.min(gradN, 8), gColors, gOffsets,
                        geoOk ? new float[]{gAngle, gCx, gCy, gR} : new float[]{0f, 0f, 0f, 0f}));
            } else {
                animGrad.remove(id);
            }
            // ★★遮罩（mask v1，@208：kind u32 + oA/aA/oB/aB 4×f32——228B 记录）
            //   ★色标是**内核已算好**的揭示结果（宿主零数学——与"渐变/变形只翻译结果"同一分工）
            int mk = bb.getInt();
            float mOA = bb.getFloat(), mAA = bb.getFloat();
            float mOB = bb.getFloat(), mAB = bb.getFloat();
            if (mk != 0) animMask.put(id, new float[]{mk, mOA, mAA, mOB, mAB});
            else animMask.remove(id);
            // ★★倾斜（skew v1，@228/@232：2×f32——236B 记录，在遮罩段**之后**）
            //   ★顺序纪律：读取顺序必须与内核写入顺序逐字节一致（见上方注释；错位曾致真机崩溃）
            float skewX = bb.getFloat(), skewY = bb.getFloat();
            float[] txArr = animTx.get(id);
            if (txArr != null && txArr.length >= 9) {
                txArr[7] = skewX;
                txArr[8] = skewY;
            }
            // ★颜色（2026-10-01）：0xFFFFFFFF = 无该基色 ⇒ 不入覆盖表（保持静态绘制）
            if (rgba != 0xFFFFFFFF) animColor.put(id, rgba);
            if (textRgba != 0xFFFFFFFF) animTextColor.put(id, textRgba);
        }
        lastAnimApplied = n;
        if (n > 0) invalidate();
        return n;
    }

    /**
     * 每帧记录长度（与 Rust 侧 `proteus_layout_anim_tick_bin` 对齐——**只在本处定义**）
     *
     * ★★2026-10-01 由 **24B → 28B（底色）→ 32B（文字色）→ 40B（3D）→ 108B（裁剪）
     *   → 112B（描边）→ 184B（渐变 v2）→ 188B（路径变形 v1）→ 192B（发光 v1）
     *   → 208B（渐变几何）→ 228B（软边遮罩）→ 236B（倾斜）**：
     *   `id u32 + 五值 f32 + bg u32 + textColor u32`。
     *   末两个 u32 都是打包色 `0xAARRGGBB`；`0xFFFFFFFF` = **无该基色**（忽略该字段）。
     *   ★唯一事实源 = 内核 `ffi.rs` 的 8 个 `extend_from_slice`；iOS / SDK / embed-demo
     *     的常量必须与它同批更新（历史上因两处各写步长而错位解析过）。
     *     `scripts/check-anim-record-bytes.mjs` 从内核推出宽度并与各消费端对账。
     */
    private static final int ANIM_RECORD_BYTES = 236;

    /**
     * ★★每帧发光**强度**表（glow v1）：节点 id → `intensity`（0..1 乘子，乘在静态 alpha 上）。
     *  ★契约键名（与 TS `GRADIENT_CONTRACT_KEYS` 同表）：`glow` / `radius` / `alpha` / **`intensity`**
     *    ——`intensity` 走**每帧通道**（可动画），`glow.radius`/`glow.alpha` 是静态声明。
     */
    // intensity 语义见上（表名即键名；门禁 check-gradient-contract 要求本端引用该键）

    private final Map<Integer, Float> animGlow = new HashMap<>();
    /** ★★每帧遮罩揭示表（mask v1）：节点 id → `[kind, oA, aA, oB, aB]`（**内核已算好**） */
    private final Map<Integer, float[]> animMask = new HashMap<>();

    /** ★★每帧变形覆盖表（路径变形 v1）：节点 id → 当前因子（NaN 缺省 = 无 B 态） */
    private final Map<Integer, Float> animMorphFactor = new HashMap<>();
    /** 变形段的缓存（key = 节点 id；值 = [factor, Path]）——只在因子变化时重取（避免每帧搬运） */
    private final Map<Integer, Object[]> morphCache = new HashMap<>();

    /**
     * ★★路径变形 v1：内核按当前因子**算好**的段列表 → 平台 Path（宿主零插值）。
     *  仅在因子变化时调用（内核 `proteus_layout_svg_morph_path`）。
     *
     * 【契约键名（`scripts/check-svg-path-shape.mjs` 门禁覆盖）】两态在树里声明：
     *  A 态 **`"svgPath"`** · B 态 **`"svgPathTo"`**（同命令序列——内核建树时校验签名）。
     *  本类负责"变形后的段 → Path"的翻译与描边路径同步；键名透传在 LightsHost CORE_KEYS
     *  与自绘适配器 LAYOUT_KEYS（两处都必须带上，否则请求树不带 B 态 ⇒ 变形被拒且静默）。
     */
    private void refreshMorphPath(int nodeId, float factor) {
        Object[] cached = morphCache.get(nodeId);
        if (cached != null && ((Float) cached[0]) == factor) return;
        try {
            // ★★二进制通道（性能修正）：JSON 版在此把 p95 抬到 2.57ms（每帧 JSON 编解码）——
            //   与 tick_bin 同源理由（"每帧走 JSON 是白付"）。格式见内核
            //   `proteus_layout_svg_morph_path_bin` 注释（u32 count + 每条 u32 tag + f32 坐标）。
            byte[] bin = RustLayout.svgMorphPathBin(coreHandle, nodeId);
            if (bin == null || bin.length < 4) return;
            java.nio.ByteBuffer bb = java.nio.ByteBuffer.wrap(bin).order(java.nio.ByteOrder.LITTLE_ENDIAN);
            int count = bb.getInt();
            android.graphics.Path path = new android.graphics.Path();
            for (int i = 0; i < count && bb.remaining() >= 4; i++) {
                int tag = bb.getInt();
                switch (tag) {
                    case 0: path.moveTo(bb.getFloat(), bb.getFloat()); break;
                    case 1: path.lineTo(bb.getFloat(), bb.getFloat()); break;
                    case 2:
                        path.cubicTo(bb.getFloat(), bb.getFloat(), bb.getFloat(), bb.getFloat(),
                                bb.getFloat(), bb.getFloat());
                        break;
                    case 3: path.quadTo(bb.getFloat(), bb.getFloat(), bb.getFloat(), bb.getFloat()); break;
                    case 4: path.close(); break;
                    default: return; // 未知 tag ⇒ 停（格式不匹配——不静默画错）
                }
            }
            morphCache.put(nodeId, new Object[]{factor, path});
            // 同步更新描边画的 path（否则变形不反映在线上——"变形只改了数据没改画面"）
            // ★第 4 项（声明基态）必须**保留**（2026-10-01：这里整组重建数组，漏拷 ⇒
            //   变形一帧后静态 `progress:1` 的鸟/山描边回落成 0 就消失了）
            Object[] sv = nodeSvgStroke.get(nodeId);
            if (sv != null) nodeSvgStroke.put(nodeId, new Object[]{path, sv[1], sv[2], sv[3]});
        } catch (Throwable ignored) { /* 查询失败不阻断（下一帧再试） */ }
    }

    /** ★★每帧渐变覆盖表（渐变 v2）：节点 id → 内核**已混合**的色标（绘制优先用它） */
    private final Map<Integer, TickGrad> animGrad = new HashMap<>();

    /** 每帧渐变覆盖（kind + n + 色标——与内核 `NodeVisual.grad` 同形） */
    static final class TickGrad {
        final int kind;
        final int n;
        final int[] colors;
        final float[] offsets;
        /** ★★几何（渐变 v2 扩展）：`[angle, cx, cy, r]`——**内核已混合**（"光本身在动"） */
        final float[] geo;
        TickGrad(int kind, int n, int[] colors, float[] offsets, float[] geo) {
            this.kind = kind; this.n = n; this.colors = colors; this.offsets = offsets; this.geo = geo;
        }
    }

    /**
     * ★★发光层数（glow v1）——**跨语言常数**：TS `GLOW_LAYERS` / Swift `glowLayers` 同值。
     *  ★改它必须三处同批（分层不一致 = 两端光晕形状不同——"跨端一致优先"纪律）。
     */
    private static final int GLOW_LAYERS = 5;

    /** 直接推进一帧（确定性步进：判据用它做"固定 dt"读数，与 iOS 的 JS 驱动 probe 同形） */
    public int kernelAnimTick(float dtMs) {
        return applyTickBin(RustLayout.animTickBin(coreHandle, dtMs));
    }

    /** 启动动画（转发内核；返回内核 JSON） */
    public String kernelAnimStart(String json) {
        return RustLayout.animStart(coreHandle, json);
    }

    /** 滚动驱动（转发内核 + 应用 updates） */
    public String kernelAnimSeekScroll(String json) {
        String out = RustLayout.animSeekScroll(coreHandle, json);
        applyAnimUpdates(out);
        return out;
    }

    // ────────────────────────── ★★真手势滚动（生产通路） ──────────────────────────

    /** 拖拽滚动出口**被驱动次数**（判据读它证明"这条路径真的走过"——不区分来源） */
    public int scrollDragDriveCount = 0;

    /** ★★滚动位置观察者（滚动模式：宿主把每次位置喂给 LightsHost 记账——见 noteScrollPosition） */
    public interface ScrollPosListener { void onScrollPos(int x, int y); }
    private ScrollPosListener scrollPosListener;
    public void setScrollPosListener(ScrollPosListener l) { this.scrollPosListener = l; }

    /** 拖拽回调（**真手势接线点**：`GestureDetector.onScroll` 与判据探针都调这一处） */
    public interface ScrollDragListener {
        /** @param dx,dy 平台 `onScroll` 的滚动量（px；正片 = 手指上移 = 向下滚动） */
        void onScrollDrag(float dx, float dy);
    }

    private ScrollDragListener scrollDragListener;

    public void setScrollDragListener(ScrollDragListener l) {
        this.scrollDragListener = l;
    }

    /**
     * ★★**真手势滚动一步**（生产通路，2026-10-01 收诚实边界）：
     *   ① 内容偏移（`setContentScrollY`——native-host 平移/裁剪随之更新）
     *   ② 内核按新位置驱动窗口动画（`anim_seek_scroll`——换算在内核，宿主只报位置）
     *   ③ 把 updates 当帧写层（`applyAnimUpdates`）
     *
     * 【★符号（自然滚动方向）——实测标定，勿凭直觉】平台 `GestureDetector.onScroll` 的
     *   `(dx, dy)` 是**滚动量**（源码：`mLastFocusY - focusY`，正 = 手指**上移**），
     *   **不是**手指位移。手指上移 = 向下翻看 = 内容上移；而 `setContentScrollY` 的约定是
     *   "正数 = 内容上移" ⇒ **直接相加** `scrollY += dy`。
     *   ★首版按"dy = 手指位移"实现成 `+= -dy`，真机 M6b 当场读出 `scrollY=-100`（方向反）——
     *   同源纪律：算术方向一律用真机读数标定，不靠假设。
     *
     * 【为什么这就是生产形态】真实产品里由**手指**触发（GestureDetector.onScroll → 本函数）；
     *   JS/QuickJS 全程不在链路上（内核 seek 与写层都在宿主这一次调用里完成）。
     */
    public String scrollDragBy(float dx, float dy) {
        scrollDragDriveCount++;
        // ① 内容偏移（滚动量直接相加：正 = 向下滚动 = 内容上移）
        final int prev = scrollY;
        int target = prev + (int) dy;
        // ★★垂直**范围钳制**（2026-10-02 —— 用户实测「安卓示例页面可以一直上下滚动」的修复）：
        //   仅当场景**显式设置过**范围（`setVerticalScrollRange`，由内容高 − 视口高推导）时钳制；
        //   默认未设置 ⇒ 与改前行为完全一致（既有探针/内核动画用例零影响）。
        //   ★为什么必须有：无范围时手指可把内容拖到屏幕外任意远（观感=坏了），
        //     且 contentScrollY 单调漂移（实测锚块 y 180→264 无界），而 Web/MP 根本不滚动
        //     ⇒ 跨端交互不一致（正是多端一致性要消灭的形态）。
        if (verticalRangeSet) target = Math.max(0, Math.min(verticalRange, target));
        setContentScrollY(target);
        if (coreHandle == 0) return "{\"ok\":false,\"error\":\"未接入核心\"}";
        // ② 内核按**新滚动位置**驱动全部窗口动画（宿主只报位置——换算在内核）
        String out = kernelAnimSeekScroll("{\"scroll\":" + scrollY + "}");
        // ③ 观察者回调（诊断/判据读数；不改变上面两条实现）
        if (scrollDragListener != null) scrollDragListener.onScrollDrag(dx, dy);
        return out;
    }

    /**
     * ★★垂直滚动范围（物理像素；内容高 − 视口高）。由**场景**从内核几何推导后设置
     *   （`VaporRenderHost.contentHeightPx()` − 视图高）；未设置 ⇒ 不钳制（默认，保持既有行为）。
     */
    private int verticalRange = 0;
    private boolean verticalRangeSet = false;

    public void setVerticalScrollRange(int range) {
        this.verticalRange = Math.max(0, range);
        this.verticalRangeSet = true;
    }

    /** 供报告/判据读（-1 = 未设置） */
    public int verticalScrollRange() { return verticalRangeSet ? verticalRange : -1; }

    /**
     * ★★**横向手势滚动一步**（长卷探索模式 · 2026-10-01）——与 `scrollDragBy` **同构**
     *   （同三步：内容偏移 → 内核 seek → 观察者回调），只是轴换成 X。
     *
     * @param dx 平台 `onScroll` 的横向滚动量（px；正 = 手指左移 = 内容左移 = 看右侧）
     */
    public String scrollDragByX(float dx) {
        scrollDragDriveCount++;
        final int prev = scrollX;
        // ★符号：`onScroll` 的 dx 是**滚动量**（正 = 内容左移）——与 Y 轴同款"直接相加"；
        // ★钳到 [0, range]（不许拖出内容——见 setHorizontalScrollRange 注释）
        String out = applyScrollX(Math.max(0, Math.min(horizontalRange, prev + (int) dx)));
        if (scrollDragListener != null) scrollDragListener.onScrollDrag(dx, 0f);
        return out;
    }

    /**
     * ★★**应用横向滚动位置**（拖动手势 / 惯性滑动 / 判据驱动**共用唯一入口**）：
     *   ① 内容偏移（画布平移）→ ② 内核 seek_scroll（驱动滚动窗口动画，如卷轴补偿）
     *   → ③ 监听者记账。★三处（手指/惯性/测试）必须走同一条——否则读数与观感分叉。
     */
    public String applyScrollX(int x) {
        final int clamped = Math.max(0, Math.min(horizontalRange, x));
        setContentScrollX(clamped);
        if (scrollPosListener != null) scrollPosListener.onScrollPos(clamped, scrollY);
        if (coreHandle == 0) return "{\"ok\":false,\"error\":\"未接入核心\"}";
        return kernelAnimSeekScroll("{\"scroll\":" + clamped + "}");
    }

    /** 当前横向偏移（判据/诊断读数） */
    public int contentScrollX() { return scrollX; }

    /** 共享元素（转发内核 + 应用首帧 updates） */
    public String kernelSharedElement(String json) {
        String out = RustLayout.sharedElement(coreHandle, json);
        applyAnimUpdates(out);
        return out;
    }

    /** 停动画（`{"all":true}` 或 `{"nodeIds":[…]}`）——含**清值**（与 iOS `animStopAll` 同语义） */
    /** ★A2：仍在推进的动画条数（0 = 全结束）——循环语义的判据（infinite 应恒 > 0） */
    public String kernelAnimActive() {
        return RustLayout.animActive(coreHandle);
    }

    /** ★A3：播放控制（时间因子/暂停；回显生效值） */
    public String kernelAnimControl(String json) {
        return RustLayout.animControl(coreHandle, json);
    }

    /** ★B 批：平台零参与路径的提交规格（判据用它做"3D 被拒绝"的机器断言） */
    public String kernelAnimCommitSpec(String json) {
        return RustLayout.animCommitSpec(coreHandle, json);
    }

    public String kernelAnimStop(String json) {
        String out = RustLayout.animStop(coreHandle, json);
        animTx.clear();
        animColor.clear();     // ★颜色与变换同一生命周期（2026-10-01）
        animTextColor.clear(); // ★文字色同（两条轨道同一生命周期）
        animClip.clear();      // ★C1 裁剪同（清表 ⇒ 回树里声明的基态形状）
        animStroke.clear();    // ★C2 描边同（清表 ⇒ 回基态：未画）
        animGrad.clear();      // ★渐变 v2 同（清表 ⇒ 回树里声明的 A 态渐变）
        animMorphFactor.clear(); // ★路径变形 v1 同（清表 ⇒ 回 A 态路径）
        morphCache.clear();
        animGlow.clear();        // ★发光 v1 同（清表 ⇒ 回声明强度 1.0）
        animMask.clear();        // ★遮罩 v1 同（清表 ⇒ 回声明基态揭示）
        invalidate();
        return out;
    }

    /**
     * ★★★**清空"按节点 id 键"的全部每树状态**（2026-10-01 A/B 判据 ④ 实测抓出）。
     *
     * 【为什么必须有它（这是一个真缺陷，不是判据口径问题）】
     *   节点 id 是**每棵树重新分配**的（A 树 0..24、B 树 1..38），而下面这些表都以
     *   **节点 id 为键且从不清空**：重新 mount 之后，新树里"恰好同 id"的节点会
     *   **继承上一棵树的裁剪 / 描边 / 变换原点 / 动画快照**——真机上表现为
     *   **幽灵裁剪 / 幽灵描边**（新树里一个从未声明 clipPath 的节点被旧形状裁掉）。
     *
     * 【实测证据（A/B 两棵树前后 mount，同一视图）】B 树节点 5（一个纯文本）探到
     *   `clip=1`、节点 6（一个纯色块）探到 `stroke_len=512.023`——两者都只出现在
     *   **A 树**的同 id 节点上，B 树从未声明。⇒ 逐项对照当场判红，根因即本表未清。
     *
     * 【与 `kernelAnimStop` 的关系】那个是"动画会话结束"的清理（内核句柄仍活着）；
     *   本方法是"**整棵树换掉**"的清理（句柄已 destroy）——动画快照同样失去意义
     *   （它们按 id 指向旧树的节点），故一并清（不留给新树"继承"）。
     */
    public void resetPerTreeState() {
        nodeSvgStroke.clear();
        nodeClipKindAndBase.clear();
        nodeTransformOrigin.clear();
        nodeStaticTx.clear();
        nodeRadiusCorners.clear();
        nodeFontRole.clear();
        animTx.clear();
        animColor.clear();
        animTextColor.clear();
        animClip.clear();
        animStroke.clear();
        animGrad.clear();
        animMorphFactor.clear();
        morphCache.clear();
        animGlow.clear();
        animMask.clear();
    }

    /**
     * 读某节点的当前变换（探针）——从**宿主侧真源** `animTx` 读，不是读我们自己传下去的参数。
     *
     * 入参 JSON：`[id, …]`；出参：`{"ok":true,"layers":[{"id":N,"tx":…,"ty":…,"scale":…,"rotate":…,"opacity":…}, …]}`
     * （与 iOS `layerTransformProbe` **同形**——两端判据脚本可共用读法）
     */
    /** 节点 id → 绘制指令下标（-1 = 未登记）；探针回落到静态色时要查它 */
    private int indexOfNode(int nodeId) {
        final int[] ids = cmdNodeIds;
        if (ids == null) return -1;
        for (int i = 0; i < ids.length; i++) if (ids[i] == nodeId) return i;
        return -1;
    }

    public String animTxProbe(String idsJson) {
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"layers\":[");
        try {
            org.json.JSONArray ids = new org.json.JSONArray(idsJson);
            for (int i = 0; i < ids.length(); i++) {
                int id = ids.optInt(i);
                float[] v = animTx.get(id);
                if (i > 0) sb.append(',');
                // ★颜色（2026-10-01）：从宿主真源读——**语义 = "绘制时实际会用哪个颜色"**。
                //   ① 动画覆盖表里有 ⇒ 报它（动画值，16 进制不带 `#`）；
                //   ② 表里没有（未参与 / 已 stop 清表）⇒ 回落到该节点的**静态绘制色**
                //      （与 `drawCmds` 的取色规则同一处：`Cmd.color`）——**不是空串**。
                //   ★为什么必须回落（真机判据抓出的口径缺陷）：`kernelAnimStop` 清表之后，
                //     若探针报空，判据就无法区分"复位成功（应=底色）"与"读不到"——
                //     而绘制侧那一刻用的正是静态色 ⇒ 探针必须报同一个数（真读＝读实际值）。
                Integer bgv = animColor.get(id);
                if (bgv == null) {
                    // ★回落到静态绘制色（与 `drawCmds` 取色规则同源：该指令的 `Cmd.color`）
                    final int cmdIdx = indexOfNode(id);
                    if (cmdIdx >= 0 && cmds != null && cmdIdx < cmds.size()) bgv = cmds.get(cmdIdx).color;
                }
                // ★文字色（2026-10-01）：语义同上——动画覆盖表优先，否则回落该指令的**静态文字色**
                //   （`Cmd.textColor`；0 = 未声明 ⇒ 空串 = "无文字色轨道"——如实标注）。
                Integer tcv = animTextColor.get(id);
                if (tcv == null) {
                    final int cmdIdx = indexOfNode(id);
                    if (cmdIdx >= 0 && cmds != null && cmdIdx < cmds.size()) {
                        final int staticTc = cmds.get(cmdIdx).textColor;
                        tcv = staticTc != 0 ? staticTc : null;
                    }
                }
                final String textHex = tcv == null ? "" : String.format("%08X", tcv);
                final String bgHex = bgv == null ? "" : String.format("%08X", bgv);
                // ★★C2：描边进度真读（与 iOS `strokeEnd` 同语义、同三态）：
                //   ① 动画表有 ⇒ 报动画值（绘制侧 `drawCmds` 用的正是它）；
                //   ② 表无但节点有 svgPath ⇒ **0**（基态 = 未画——与 stop 后 `animStroke.remove`
                //      的复位语义一致，探针读的是"绘制时实际会用哪个值"）；
                //   ③ 连路径都没有 ⇒ **-1**（"无描边轨道"——与 iOS 找不到 CAShapeLayer 报 -1 同口径）。
                final float strokeProg;
                if (animStroke.containsKey(id)) strokeProg = animStroke.get(id);
                // ★回落**声明基态**（2026-10-01 修正：此前硬编码 0 ⇒ 静态已画成的路径探针也报 0，
                //   与绘制实际值不一致——"读实际值"是探针的口径）
                else if (nodeSvgStroke.containsKey(id)) strokeProg = (Float) nodeSvgStroke.get(id)[3];
                else strokeProg = -1f;
                // ★★渐变（v1 · 2026-10-01）：**真读宿主绘制真源**（该 cmd 的 GradSpec——`drawCmds`
                //   用的就是它）——判据据此断言"渐变真的挂上了"（与 iOS 读层上 type/色标数同语义）。
                //   形态 "linear:2" / "radial:3"；无 ⇒ 空串。
                // ★★发光（glow v1）：**真读宿主绘制真源**（该 cmd 的 glow 规格 + 当前强度）——
                //   形态 "5:0.500"（分层数:首层 alpha）——与 iOS 探针同口径（判据跨端共用读法）。
                String glowStr = "";
                {
                    final int ci = indexOfNode(id);
                    if (ci >= 0 && cmds != null && ci < cmds.size() && cmds.get(ci).glow != null) {
                        final float[] g = cmds.get(ci).glow;
                        final float gi = animGlow.containsKey(id) ? animGlow.get(id) : 1f;
                        final float a0 = g[2] * gi;
                        glowStr = String.format("%d:%.3f", GLOW_LAYERS, a0);
                    }
                }
                // ★★遮罩（mask v1）：**真读宿主合成真源**（animMask 覆盖 or 静态声明）——
                //   形态 "linear:0.300,1.000"（kind:oA,aA）——判据据此断言"揭示真的在变"
                String maskStr = "";
                {
                    final float[] mr = animMask.get(id);
                    if (mr != null) {
                        maskStr = (mr[0] == 2 ? "radial:" : "linear:")
                                + String.format(java.util.Locale.US, "%.3f,%.3f", mr[1], mr[2]);
                    } else {
                        final int ci = indexOfNode(id);
                        if (ci >= 0 && cmds != null && ci < cmds.size() && cmds.get(ci).mask != null) {
                            final float[] mspec = cmds.get(ci).mask;
                            maskStr = (mspec[0] == 2 ? "radial:" : "linear:") + "static";
                        }
                    }
                }
                String morphStr = "";
                {
                    final Float mf = animMorphFactor.get(id);
                    if (mf != null) morphStr = String.format("%.4f", mf);
                }
                String gradStr = "";
                {
                    // ★v2：每帧覆盖优先（内核已混合 ⇒ 报实时色标数——判据据此断言"动画中色标在变"）
                    final TickGrad tg0 = animGrad.get(id);
                    if (tg0 != null) {
                        // ★几何也报（判据据此断言"光的几何真的在动"）：径向报 r、线性报 angle
                        final float geo = tg0.kind == 2 ? tg0.geo[3] : tg0.geo[0];
                        gradStr = (tg0.kind == 2 ? "radial:" : "linear:") + tg0.n
                                + ":" + String.format(java.util.Locale.US, "%.4f", geo);
                    } else {
                        final int ci = indexOfNode(id);
                        if (ci >= 0 && cmds != null && ci < cmds.size() && cmds.get(ci).gradient != null) {
                            final GradSpec g = cmds.get(ci).gradient;
                            final float geo = g.kind == 2 ? g.r : g.angleDeg;
                            gradStr = (g.kind == 2 ? "radial:" : "linear:") + g.colors.length
                                    + ":" + String.format(java.util.Locale.US, "%.4f", geo);
                        }
                    }
                }
                // ★★C1：裁剪参数真读（动画表优先，否则基态）——判据据此断言形变真的落到绘制侧
                final float[] clipDisp;
                if (animClip.containsKey(id)) clipDisp = animClip.get(id);
                else {
                    final float[] base17 = nodeClipKindAndBase.get(id);
                    if (base17 != null) {
                        float[] ps = new float[16];
                        for (int k = 0; k < 16; k++) ps[k] = base17[k + 1];
                        clipDisp = ps;
                    } else clipDisp = null;
                }
                final String clipStr = (clipDisp == null || clipKindOf(id) == 0)
                        ? ""
                        : String.format("%d:%.4f,%.4f,%.4f,%.4f", clipKindOf(id),
                                clipDisp[0], clipDisp[1], clipDisp[2], clipDisp[3]);
                // ★B 批 3D：rotateX/rotateY（v[5]/v[6]；旧 5 元素记录缺省 0——向后兼容）
                final float rX = v != null && v.length >= 7 ? v[5] : 0f;
                final float rY = v != null && v.length >= 7 ? v[6] : 0f;
                // ★★倾斜（skew v1）：真读宿主当前值（判据据此断言"倾斜真的落地"）
                final float skX = v != null && v.length >= 9 ? v[7] : 0f;
                final float skY = v != null && v.length >= 9 ? v[8] : 0f;
                if (v == null) {
                    // 无记录 ⇒ 恒等（未被动过）——与"层上是 identity"语义一致
                    sb.append("{\"id\":").append(id)
                      .append(",\"tx\":0,\"ty\":0,\"scale\":1,\"rotate\":0,\"opacity\":1")
                      .append(",\"rotateX\":0,\"rotateY\":0")
                      .append(",\"strokeProgress\":").append(strokeProg)
                      .append(",\"gradient\":\"").append(gradStr).append("\"")
                      .append(",\"glow\":\"").append(glowStr).append("\"")
                      .append(",\"mask\":\"").append(maskStr).append("\"")
                      .append(",\"mask\":\"").append(maskStr).append("\"")
                      .append(",\"pathMorph\":\"").append(morphStr).append("\"")
                      .append(",\"glow\":\"").append(glowStr).append("\"")
                      .append(",\"mask\":\"").append(maskStr).append("\"")
                      .append(",\"bg\":\"").append(bgHex)
                      .append("\",\"textColor\":\"").append(textHex).append("\"}");
                } else {
                    sb.append("{\"id\":").append(id)
                      .append(",\"tx\":").append(v[0]).append(",\"ty\":").append(v[1])
                      .append(",\"scale\":").append(v[2]).append(",\"rotate\":").append(v[3])
                      .append(",\"opacity\":").append(v[4])
                      .append(",\"rotateX\":").append(rX).append(",\"rotateY\":").append(rY)
                      .append(",\"skewX\":").append(skX).append(",\"skewY\":").append(skY)
                      .append(",\"clip\":\"").append(clipStr).append("\"")
                      .append(",\"strokeProgress\":").append(strokeProg)
                      .append(",\"gradient\":\"").append(gradStr).append("\"")
                      .append(",\"pathMorph\":\"").append(morphStr).append("\"")
                      .append(",\"glow\":\"").append(glowStr).append("\"")
                      .append(",\"mask\":\"").append(maskStr).append("\"")
                      .append(",\"bg\":\"").append(bgHex)
                      .append("\",\"textColor\":\"").append(textHex).append("\"}");
                }
            }
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"入参需为 id 数组 JSON\"}";
        }
        sb.append("]}");
        return sb.toString();
    }

    /* ── 真帧循环（`postOnAnimation` = Choreographer 驱动，与 iOS CADisplayLink 同一形态） ── */

    private boolean ktRunning = false;
    private int ktFrames = 0;
    private long ktStartNs = 0, ktLastNs = 0, ktStopAtNs = 0, ktFirstFrameNs = 0;
    private final float[] ktWorkMs = new float[8192];
    private int ktWorkN = 0;
    /**
     * ★★**vsync 间隔**（2026-10-01 加：把「120 FPS」从"未声称"变成机器判据）
     *
     * 【为什么必须单独记（取证结论）】此前只记 `frames`，而"500ms 出 59 帧"只能反推 ≈118 FPS——
     *   反推值不能区分三种情况：① 真在 120Hz 满帧；② 前半段掉帧后半段满帧；③ 帧回调被节流。
     *   ⇒ 记**每个 vsync 的真实间隔**（`Choreographer` 的 `frameTimeNanos` 差，不是我们自己
     *   调用的时间差），判据据此算 p50/p95 与"是否达到显示器刷新率"。
     *   ★与 iOS 侧的 `allVsync` 同一口径（两端判据可互相参照）。
     */
    private final float[] ktVsyncMs = new float[8192];
    private int ktVsyncN = 0;
    private long ktLastFrameTimeNanos = 0;
    /** 稳态窗口基线（启动后 80ms 重拍；见 `kernelTickStats` 的口径注释） */
    private int ktMeasureBefore = 0, ktLayoutBefore = 0;
    private int ktMeasureBoot = 0, ktLayoutBoot = 0;

    private final android.view.Choreographer.FrameCallback ktCallback =
            new android.view.Choreographer.FrameCallback() {
        @Override public void doFrame(long frameTimeNanos) {
            if (!ktRunning) return;
            long t0 = System.nanoTime();
            if (ktFirstFrameNs == 0) ktFirstFrameNs = t0;
            // ★★vsync 间隔取 **Choreographer 的 frameTimeNanos 差**（真实 vsync 时刻，
            //   不是我们自己调用的时刻——后者混入调度延迟，会把"渲染节拍"测成"回调节拍"；
            //   本仓在 scrollListRun 的注释里记过同一个坑："初版测到的只是调回节拍，与渲染无关"）。
            if (ktLastFrameTimeNanos != 0 && ktVsyncN < ktVsyncMs.length) {
                ktVsyncMs[ktVsyncN++] = (frameTimeNanos - ktLastFrameTimeNanos) / 1e6f;
            }
            ktLastFrameTimeNanos = frameTimeNanos;
            float dtMs = (t0 - ktLastNs) / 1e6f;
            ktLastNs = t0;
            // ★首帧/卡顿保护：dt 上限 100ms（否则一步跳完整段动画——真机首帧常见）
            if (dtMs > 100f) dtMs = 100f;
            if (dtMs <= 0f) dtMs = 16.7f;
            applyTickBin(RustLayout.animTickBin(coreHandle, dtMs));
            ktFrames++;
            float work = (System.nanoTime() - t0) / 1e6f;
            if (ktWorkN < ktWorkMs.length) ktWorkMs[ktWorkN++] = work;
            if (System.nanoTime() >= ktStopAtNs) { ktRunning = false; return; }
            android.view.Choreographer.getInstance().postFrameCallback(this);
        }
    };

    /* ── ★★★过渡动画帧循环（P3-3，2026-10-03）：驱动到"内核没有活跃动画"为止 ── */

    private boolean trRunning = false;
    private int trFrames = 0;
    private float trLastDtMs = 16.7f;

    /**
     * ★★**过渡动画驱动**（与 `kernelTickStart` 的区别：**时长未知**——由"内核还有没有活跃动画"
     *   决定何时停；而 MA0-RT 的基准循环是**给定时长**、到点自停）。
     *
     * 【为什么停判据用 `animActive`（内核权威）】过渡时长由**声明**决定（`durMs`），但
     *   接管/串联会改变实际时长 ⇒ "还没完就停"会截断动画、"完了不停"会空转。
     *   `proteus_layout_anim_active` 是内核自报的**仍在推进条数**——与 MA5 幕切换同一条权威判据。
     *
     * 【为什么每帧 `postFrameCallback` 而不设死时限】过渡是**疏散**的（本批 220ms 量级）；
     *   上限保护仍保留（`maxMs`，防"内核有 bug 说永远活跃"时无限帧循环）。
     */
    public void driveKernelAnimFrames() {
        if (coreHandle == 0) return;
        if (trRunning) return;   // 已在驱动（多次可见性切换合并到同一循环）
        trRunning = true;
        trFrames = 0;
        final long hardStopAtNs = System.nanoTime() + 3_000_000_000L;   // 硬上限 3s
        android.view.Choreographer.getInstance().postFrameCallback(new android.view.Choreographer.FrameCallback() {
            @Override public void doFrame(long frameTimeNanos) {
                if (!trRunning) return;
                float dtMs = trLastDtMs;
                if (dtMs > 100f) dtMs = 100f;
                applyTickBin(RustLayout.animTickBin(coreHandle, dtMs));
                trFrames++;
                // 停判据：内核自报活跃数（权威）——0 = 全结束
                int active = -1;
                try {
                    String a = RustLayout.animActive(coreHandle);
                    JSONObject ao = new JSONObject(a);
                    if (ao.optBoolean("ok")) active = ao.optInt("active", -1);
                } catch (Throwable ignored) { /* 读数失败 ⇒ 靠硬上限兜底（不静默盲转） */ }
                if (active == 0 || System.nanoTime() > hardStopAtNs) {
                    trRunning = false;
                    return;
                }
                android.view.Choreographer.getInstance().postFrameCallback(this);
            }
        });
    }

    /** 过渡帧循环读数（判据：帧数 > 0 = 真的驱动过；与 `transition_started` 互补） */
    public int transitionFrames() { return trFrames; }

    /**
     * 启动真帧循环（时长驱动：到点自停——**不是**"看到没有动画了才停"，避免判据依赖时序）。
     *
     * 【★★为什么用 `Choreographer.postFrameCallback` 而不是 `View.postOnAnimation`（真机实测纠偏）】
     *   首版用 `postOnAnimation`：真机读数 `frames=1`——**首帧即停**。
     *   根因：`postOnAnimation` 对**尚未 attach 到窗口**的 View 会把 runnable **排队**，
     *   直到首次 traversal（attach）才执行；而那时 `System.nanoTime()` 已超过 `ktStopAtNs`
     *   ⇒ 首帧进来就判定"到点"，循环只跑 1 帧。
     *   （同批读数 `measure_delta=1 / layout_delta=1` 正是那次 traversal —— 两处证据互相印证。）
     *   ⇒ 改用 **Choreographer 直接注册**：与 View 的 attach 状态无关，语义也更贴近
     *     iOS 的 `CADisplayLink`（"每 vsync 一次"是**显示器**的属性，不是某个 View 的属性）。
     *
     * 【基线口径（与 `carrierAnimStats` 同一先例）】`measure/layout` 的增量量的是
     *   **稳态窗口**（启动 +80ms 之后）：接入 View 触发的**一次性 traversal** 不算"动画期间"。
     */
    public String kernelTickStart(long durationMs) {
        if (coreHandle == 0) return "{\"ok\":false,\"error\":\"未接入核心\"}";
        ktRunning = true; ktFrames = 0; ktWorkN = 0; ktFirstFrameNs = 0;
        ktVsyncN = 0; ktLastFrameTimeNanos = 0;
        ktMeasureBoot = onMeasureCount; ktLayoutBoot = onLayoutCount;
        ktMeasureBefore = onMeasureCount; ktLayoutBefore = onLayoutCount;
        ktLastNs = System.nanoTime();
        ktStartNs = ktLastNs;
        ktStopAtNs = ktLastNs + durationMs * 1_000_000L;
        // ★稳态基线：+80ms 重拍（那时首次 traversal 已发生，量的才是"动画期间"）
        //   ——但只在**还没到点**时重拍（极短时长下不覆盖，避免语义含糊）
        final long rebaseAt = ktStartNs + 80_000_000L;
        if (ktStopAtNs > rebaseAt) {
            postDelayed(new Runnable() {
                @Override public void run() {
                    if (!ktRunning) return;
                    ktMeasureBefore = onMeasureCount;
                    ktLayoutBefore = onLayoutCount;
                }
            }, 80);
        }
        android.view.Choreographer.getInstance().postFrameCallback(ktCallback);
        return "{\"ok\":true,\"duration_ms\":" + durationMs + "}";
    }

    public void kernelTickStop() {
        ktRunning = false;
        android.view.Choreographer.getInstance().removeFrameCallback(ktCallback);
    }
    public boolean kernelTickRunning() { return ktRunning; }

    /**
     * 帧循环读数：帧数 / 每帧工作 p50·p95·max / **稳态窗口内是否发生 measure·layout**（应恒为 0）
     *   / 首帧延迟（诊断"runnable 被排队"这类装置缺陷）
     *   ★★2026-10-01 加：**vsync 间隔分布 + FPS + 显示器刷新率**（把"120 FPS"变成可断言量）
     */
    public String kernelTickStats() {
        float[] w = java.util.Arrays.copyOf(ktWorkMs, ktWorkN);
        java.util.Arrays.sort(w);
        float p50 = w.length == 0 ? -1 : w[(int) (w.length * 0.50)];
        float p95 = w.length == 0 ? -1 : w[Math.min(w.length - 1, (int) (w.length * 0.95))];
        float mx = w.length == 0 ? -1 : w[w.length - 1];
        double firstDelayMs = ktFirstFrameNs > 0 ? (ktFirstFrameNs - ktStartNs) / 1e6 : -1;
        // ★vsync 间隔分布（判据据此算 FPS 与"是否达到显示器刷新率"）——见 ktVsyncMs 注释
        float[] vs = java.util.Arrays.copyOf(ktVsyncMs, ktVsyncN);
        java.util.Arrays.sort(vs);
        float vp50 = vs.length == 0 ? -1 : vs[(int) (vs.length * 0.50)];
        float vp95 = vs.length == 0 ? -1 : vs[Math.min(vs.length - 1, (int) (vs.length * 0.95))];
        // FPS 用 **vsync 间隔之和**算（真实帧节拍，不含首帧前的空档——与 iOS 侧同一口径）
        double vsSumMs = 0;
        for (float v : vs) vsSumMs += v;
        double fps = vsSumMs > 0 ? (vs.length * 1000.0) / vsSumMs : -1;
        // 显示器刷新率（报告里如实带上：判据据此判断"是否满帧"，不硬编码 60/120）
        double refreshHz = -1;
        try {
            android.view.Display disp = getDisplay();
            if (disp != null) refreshHz = disp.getRefreshRate();
        } catch (Throwable ignored) {
            // 取不到就如实留 -1（判据会据此走"无刷新率基线"分支，不静默假装）
        }
        return "{\"running\":" + ktRunning + ",\"frames\":" + ktFrames
                + ",\"work_p50_ms\":" + p50 + ",\"work_p95_ms\":" + p95 + ",\"work_max_ms\":" + mx
                + ",\"first_frame_delay_ms\":" + firstDelayMs
                + ",\"fps\":" + fps
                + ",\"vsync_p50_ms\":" + vp50 + ",\"vsync_p95_ms\":" + vp95
                + ",\"vsync_samples\":" + ktVsyncN
                + ",\"display_refresh_hz\":" + refreshHz
                // 稳态窗口内增量（口径见 kernelTickStart 注释）
                + ",\"measure_delta\":" + (onMeasureCount - ktMeasureBefore)
                + ",\"layout_delta\":" + (onLayoutCount - ktLayoutBefore)
                // 接入时的一次性成本（如实记录，不计入动画期）
                + ",\"boot_measure_delta\":" + (onMeasureCount - ktMeasureBoot)
                + ",\"boot_layout_delta\":" + (onLayoutCount - ktLayoutBoot)
                + ",\"on_measure_count\":" + onMeasureCount + ",\"on_layout_count\":" + onLayoutCount + "}";
    }

    public ProteusHostView(Context context) {
        super(context);
        // ★★**必须显式开自绘**（本仓实测踩到，2026-09-29 · S5 端到端）：
        //   `ViewGroup` 的构造函数会置 `WILL_NOT_DRAW`（= `PFLAG_SKIP_DRAW`）
        //   ⇒ `View.draw()` 直接跳过 background + `onDraw`，**只画子 View**。
        //   本类是自绘宿主（内容全在 `onDraw` 的指令里）⇒ 不开这个开关，
        //   `onDraw` **一次都不会被调用**，屏幕上什么都看不到。
        //   ★为什么此前没暴露：既有场景都先 `setBackgroundColor(...)`（"白底便于区分未绘制区"），
        //     而 `setBackground(非 null)` 会**顺带清掉**这个标志 ⇒ 靠副作用侥幸能画。
        //     离屏路径（`view.drawCmds(canvas)` 直接调用）**看不到这个缺陷**——
        //     它绕过了 `View.draw()` 的分发。实测对照：同一棵树离屏重放 3640 个采样点有像素，
        //     而屏幕截图整屏背景色、`onDrawCount() == 0`。
        //   ★纪律：**离屏判据不能替代上屏判据**——"我发出的指令"与"屏幕真的画了一帧"是两件事。
        setWillNotDraw(false);
        textPaint.setColor(Color.BLACK);
        textPaint.setTextSize(12f);
        // ★C2：描边笔样式（STROKE + 圆头圆角——与 iOS `.round` 一致）
        strokePaint.setStyle(android.graphics.Paint.Style.STROKE);
        strokePaint.setStrokeCap(android.graphics.Paint.Cap.ROUND);
        strokePaint.setStrokeJoin(android.graphics.Paint.Join.ROUND);
        // ★批次 5：边框笔（STROKE 一次设定，绘制时只改色/宽）
        borderPaint.setStyle(android.graphics.Paint.Style.STROKE);
    }

    public void setCmds(List<Cmd> value) {
        this.cmds = value;
        // ★★★显示列表随指令变更重建（脏时一次 5ms；此后每帧回放 2ms）。
        //   ★尺寸未知时（未布局）先置空——onSizeChanged/首次 onDraw 时补建（见 ensurePicture）。
        if (getWidth() > 0 && getHeight() > 0 && value != null && !value.isEmpty()) {
            rebuildPicture(getWidth(), getHeight());
        } else {
            framePicture = null;
        }
        invalidate();
    }

    /** 尺寸就绪后补建显示列表（布局完成前 setCmds 的场景） */
    private void ensurePicture() {
        if (framePicture == null && cmds != null && !cmds.isEmpty() && getWidth() > 0 && getHeight() > 0) {
            rebuildPicture(getWidth(), getHeight());
        }
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        framePicture = null;   // 尺寸变化 ⇒ 旧显示列表失效
        ensurePicture();
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

    /* ══════════ ★★滚动容器 + native-host 滚动同步（方案坑位 #4「层级与滚动同步需专门设计」）══════════ */

    /**
     * 滚动状态（content offset）。
     *
     * 【架构分工】（本仓的设计原则）
     *   · **滚动量**（用户手势产生）→ 运行时状态，归**平台侧**（这里）
     *   · **滚动范围**（内容总高 − 视口高）→ 布局约束，归 **Rust 侧**（由几何算出）
     *   · **可见区行号** → 由滚动量 + 布局算出，归 **Rust 侧**（复用池已实现，见 `ListWindow`）
     *   本类只持有 scrollY 并驱动绘制/子 View 平移。
     */
    private int scrollY = 0;
    /** ★★**横向内容偏移**（长卷探索模式 · 2026-10-01）：`scrollDragByX` 写它、绘制平移用 */
    private int scrollX = 0;
    /** 滚动视口（内容坐标系里的可见矩形；native-host 的裁剪面） */
    private android.graphics.Rect scrollViewport = null;

    public int getContentScrollY() { return scrollY; }

    /**
     * 设置滚动偏移（正数 = 内容上移，即向下滚动）。
     *
     * ★★native-host 的跟随用 `setTranslationY` 而非重新 `layout()`（关键设计）：
     *   · `layout()` 会触发子 View 的 `onMeasure/onLayout` → 每帧都跑测量（重）
     *   · `setTranslationY()` 只影响**绘制阶段的变换**，零 layout 成本
     *   → 这是 Android 的标准做法（RecyclerView 滚动时也不重测子 View）。
     */
    public void setContentScrollY(int y) {
        if (this.scrollY == y) return;
        this.scrollY = y;
        applyScrollToNativeHosts();
        invalidate();
    }

    /** ★★**长卷模式开关**（横向手势通路——`program: 'inkScroll'` 时置 true） */
    private boolean horizontalScroll = false;
    /**
     * ★★**横向偏移模式**（2026-10-01 · 手卷浏览）：`true` ⇒ 画布真平移（`translate(-scrollX)`）。
     *   · 与第一版"卷筒滚动展开"（进度模式，不平移）的区别就在这个开关；
     *   · 偏移模式下滚动值 = **内容偏移**（0..range），手势 1:1 跟手 + 抛滑惯性。
     */
    private boolean offsetScroll = false;

    public void setOffsetScroll(boolean v) { this.offsetScroll = v; }

    /** 惯性滑动器（抛滑——`OverScroller` 是平台标准实现，零自研阈值） */
    private android.widget.OverScroller flingScroller;

    private android.widget.OverScroller scroller() {
        if (flingScroller == null) flingScroller = new android.widget.OverScroller(getContext());
        return flingScroller;
    }

    /** 抛滑（在 `onFling` 里调用——`vx` 是平台给的手指速度，正=向右） */
    public void startFlingX(float vx) {
        // ★符号：手指向右甩（vx>0）⇒ 内容向右回退（scrollX 减小）⇒ 取 −vx
        scroller().fling(scrollX, 0, (int) (-vx), 0, 0, horizontalRange, 0, 0);
        flingDrives++;
        postInvalidateOnAnimation();
    }

    /**
     * ★★**每帧推进惯性**（由 LightsHost 的 Choreographer 帧循环调用——复用同一帧驱动，
     *   不新增第二条帧源；本仓纪律："帧驱动唯一来源"）。
     * ★两个读数（`inertiaFrames`/`inertiaMoved`）是**"抛滑真的接线了"的机器证据**（2026-10-01）：
     *   本仓刚抓到同族缺陷（`startFlingX` 声明了但 `onFling` 里没人调用 ⇒ 抛滑静默不存在）
     *   ——"报告有、通路无"只能靠计数现形（判据据此判红/绿）。
     */
    public void stepInertia() {
        if (flingScroller == null) return;
        if (flingScroller.computeScrollOffset()) {
            inertiaFrames++;
            final int nx = flingScroller.getCurrX();
            if (nx != scrollX) inertiaMoved++;
            applyScrollX(nx);
        }
    }

    /** 抛滑次数（onFling / 判据驱动都会计数）· 惯性活跃帧 · 惯性**真的推动了画布**的帧 */
    public int flingDrives() { return flingDrives; }
    public int inertiaFrames() { return inertiaFrames; }
    public int inertiaMovedFrames() { return inertiaMoved; }
    /** 惯性是否仍在推进（收尾条件等待用——"等它停"而不是"等固定时长"） */
    public boolean flingActive() {
        return flingScroller != null && !flingScroller.isFinished();
    }

    private int flingDrives = 0;
    private int inertiaFrames = 0;
    private int inertiaMoved = 0;

    /** 设置长卷模式（横向手势驱动；见 `scrollDragByX`） */
    public void setHorizontalScroll(boolean v) { this.horizontalScroll = v; }

    /**
     * ★★**展卷行程上限**（长卷模式）：滚动值 = 展卷进度（0..range）。
     *   ★为什么必须有上限：无上限时拖过头（如累计 4680px）后，往回拖要先"消化"多余量
     *     ——手指明明在动而画面不动（观感=坏了）。⇒ 上限 = 节目声明的行程（`scroll_range`）。
     */
    private int horizontalRange = Integer.MAX_VALUE / 4;

    public void setHorizontalScrollRange(int range) {
        if (range > 0) horizontalRange = range;
    }

    /** ★★横向内容偏移（长卷探索模式：横移整幅长卷）——与 `setContentScrollY` 同语义（X 轴）。 */
    public void setContentScrollX(int x) {
        if (this.scrollX == x) return;
        this.scrollX = x;
        invalidate();
    }

    /** 设置滚动视口（内容坐标）；native-host 超出视口时应被裁剪 */
    public void setScrollViewport(android.graphics.Rect viewport) {
        this.scrollViewport = viewport;
        applyScrollToNativeHosts();
        invalidate();
    }

    /**
     * ★把滚动状态应用到 native-host 子 View。
     *
     * 两件事：
     *   ① **平移**：`translationY = -scrollY`（零 layout 成本，见 `setContentScrollY` 注释）
     *   ② **裁剪**：超出滚动视口的 native-host 设为 `INVISIBLE`
     *      —— ★为什么手动做：Android 的 `clipChildren` 只能裁到**父 View 边界**，
     *        而滚动容器可能只是页面的一部分（如「列表嵌在卡片里」）→ 必须显式判定。
     *        这也是方案说「滚动同步需专门设计」的实质：**原生 View 不受自绘裁剪面约束**。
     */
    private void applyScrollToNativeHosts() {
        for (Map.Entry<Integer, View> e : nativeHosts.entrySet()) {
            View v = e.getValue();
            RectF rect = nativeRects.get(e.getKey());
            if (rect == null) continue;
            v.setTranslationY(-scrollY);
            if (scrollViewport != null) {
                // 内容坐标系下，该 native-host 的可见性（与视口求交）
                boolean intersects = rect.bottom > scrollViewport.top + scrollY
                        && rect.top < scrollViewport.bottom + scrollY;
                v.setVisibility(intersects ? View.VISIBLE : View.INVISIBLE);
            }
        }
    }

    /** 报告滚动同步状态（核验用：native-host 的实际 translationY 与可见性） */
    public String scrollSyncDump() {
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (Map.Entry<Integer, View> e : nativeHosts.entrySet()) {
            View v = e.getValue();
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"nodeId\":").append(e.getKey())
              .append(",\"translationY\":").append(v.getTranslationY())
              .append(",\"layoutTop\":").append(v.getTop())
              .append(",\"visible\":").append(v.getVisibility() == View.VISIBLE)
              .append("}");
        }
        return sb.append(']').toString();
    }

    /* ── ViewGroup 生命周期：用 Rust 几何驱动 ── */

    /**
     * ★卡 I2（舍入时机统一）：内核已把几何吸附为**整数逻辑像素** ⇒ 本转换**无损**。
     *
     * 为什么保留下转换而不是沿用 `Math.round`：平台层**不得再做舍入决策**
     * （否则又与内核的策略分叉——那正是"三端差 1px"的成因）。
     * 转换只为满足 View API 的 int 签名；若内核不变式被破坏，本转换是**直接截断**，
     * 会立刻在像素核验里暴露，而不是被"再舍入一次"悄悄掩盖。
     * （静态门禁：`pnpm check:host-rounding`）
     */
    private static int exactPx(float v) {
        return (int) v;
    }

    @Override
    protected void onMeasure(int widthSpec, int heightSpec) {
        onMeasureCount++;   // ★判据："逐节点动画期间零测量"（见 carrierAnimStats）
        // 宿主自身：接受 parent 给的尺寸（它由外部布局决定）
        int w = MeasureSpec.getSize(widthSpec);
        int h = MeasureSpec.getSize(heightSpec);
        // ★子 View（native-host）：**尺寸来自 Rust 几何**（EXACTLY）——不退化为 View 体系测量
        for (Map.Entry<Integer, View> e : nativeHosts.entrySet()) {
            RectF rect = nativeRects.get(e.getKey());
            int nw = rect != null ? exactPx(rect.width()) : 0;
            int nh = rect != null ? exactPx(rect.height()) : 0;
            e.getValue().measure(
                    MeasureSpec.makeMeasureSpec(nw, MeasureSpec.EXACTLY),
                    MeasureSpec.makeMeasureSpec(nh, MeasureSpec.EXACTLY));
        }
        setMeasuredDimension(w, h);
    }

    @Override
    protected void onLayout(boolean changed, int l, int t, int r, int b) {
        onLayoutCount++;    // ★判据："逐节点动画期间零布局"
        // ★子 View（native-host）：**位置来自 Rust 几何**（绝对定位，非流式排布）
        for (Map.Entry<Integer, View> e : nativeHosts.entrySet()) {
            RectF rect = nativeRects.get(e.getKey());
            if (rect == null) continue;
            View v = e.getValue();
            v.layout(exactPx(rect.left), exactPx(rect.top),
                     exactPx(rect.right), exactPx(rect.bottom));
        }
        ensureViewport();
        applyScrollToNativeHosts();
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

    /* ══════════ ★★事件系统：触摸派发（M3）——自绘路线的第一个「可响应输入」闭环 ══════════ */

    /** 命中的回调（宿主/业务方在此处理 tap/gesture） */
    public interface HitListener {
        /**
         * @param targetId 命中的节点 id（-1 = 未命中）
         * @param chain    冒泡链（target 自身 + 全部祖先，自深到浅）——事件沿它传播
         * @param x        触摸点（**内容坐标**：已加回滚动偏移）
         * @param y        触摸点（内容坐标）
         */
        void onHit(int targetId, int[] chain, float x, float y);
    }

    /** Rust 树的句柄（`0` = 未接入核心 → 触摸不派发）。由 MainActivity 在建树后设置。 */
    private long coreHandle = 0L;
    private HitListener hitListener;

    /**
     * 接入 Rust 核心的树句柄 —— **触摸派发的前置条件**。
     *
     * ★为什么必须显式接入（而不是宿主自己算几何）：见 `RustLayout.hitTest` 注释——
     *   几何的唯一来源是核心，宿主不保留第二份，避免漂移。
     */
    public void attachCore(long handle) {
        this.coreHandle = handle;
    }

    public void setHitListener(HitListener l) {
        this.hitListener = l;
    }

    /** 上次命中的诊断读数（`targetId` -1 = 未命中）——供验收脚本核验 */
    public int lastHitTarget = -1;
    public int[] lastHitChain = new int[0];
    public float lastHitX = 0f, lastHitY = 0f;

    /** 触摸点数（诊断：确认事件真的到了宿主） */
    public int touchEventCount = 0;

    /* ── ★★手势（M3「事件系统、手势」的后半段）── */

    /**
     * 语义手势回调（**与平台手势识别器对接**，不自研状态机）。
     *
     * ★★为什么用平台的 `GestureDetector` 而不是自写状态机（方案 06 的明确规定）：
     *   方案 §6 的映射表写得很清楚 —— tap→`GestureDetector`、longPress→`LongPressGesture`、
     *   swipe→`FlingGesture`，**各端用平台识别器**。理由与本仓「不自研文本基础设施」同源：
     *   手势的**判定阈值/时间窗/速度计算**是平台长年调优的结果（各家厂商的可达性、
     *   触摸采样率、防抖都不一样），自研必然在各端产生不一致的手感与优先级，
     *   而手势恰恰是**用户最能感知**的交互层。
     *   ⇒ 本仓只做两件事：① 把平台手势**归一为语义事件**（跨端同形的 API）
     *     ② 用**核心算出的命中节点**给事件标注 target（这是自绘才需要补的那一环）。
     */
    public interface GestureListener {
        /**
         * @param type     语义手势类型：tap / longpress / fling / scroll
         * @param targetId 手势**起始**时的命中节点（-1 = 未命中）
         * @param chain    冒泡链（target 自身 + 全部祖先）
         * @param x,y      手势起点（**内容坐标**）
         * @param extra    类型相关读数（fling 的速度 / scroll 的距离与方向）
         */
        void onGesture(String type, int targetId, int[] chain, float x, float y, android.os.Bundle extra);
    }

    private GestureListener gestureListener;
    /** ★手势的 target 在 **DOWN 时刻**确定（与 Android/CSS 一致：手势归属按下时命中的那个节点，
     *  中途划过别的节点不改归属） */
    private int gestureTarget = -1;
    private int[] gestureChain = new int[0];
    private float gestureStartX = 0f, gestureStartY = 0f;
    private android.view.GestureDetector gestureDetector;

    /** 最近一次识别到的手势（诊断/验收读它） */
    public String lastGestureType = "";
    public int lastGestureTarget = -1;
    public String lastGestureDetail = "";

    public void setGestureListener(GestureListener l) {
        this.gestureListener = l;
    }

    /** 手势识别器（懒建：只有需要时才创建，避免普通场景多一个对象） */
    private android.view.GestureDetector detector() {
        if (gestureDetector == null) {
            gestureDetector = new android.view.GestureDetector(getContext(),
                    new android.view.GestureDetector.SimpleOnGestureListener() {
                        @Override public boolean onDown(android.view.MotionEvent e) { return true; }

                        @Override public boolean onSingleTapUp(android.view.MotionEvent e) {
                            report("tap", e, null);
                            return true;
                        }

                        @Override public void onLongPress(android.view.MotionEvent e) {
                            report("longpress", e, null);
                        }

                        @Override public boolean onFling(android.view.MotionEvent e1, android.view.MotionEvent e2,
                                                        float vx, float vy) {
                            if (e1 == null || e2 == null) return false;
                            android.os.Bundle b = new android.os.Bundle();
                            b.putFloat("vx", vx);
                            b.putFloat("vy", vy);
                            // 方向按**主轴**判定（|vx| 与 |vy| 比较）——与 Flutter/RN 的惯例一致
                            String dir = Math.abs(vx) >= Math.abs(vy)
                                    ? (vx > 0 ? "right" : "left")
                                    : (vy > 0 ? "down" : "up");
                            b.putString("direction", dir);
                            b.putFloat("speed", (float) Math.hypot(vx, vy));
                            report("fling", e2, b);
                            // ★★手卷抛滑**接线**（2026-10-01）：横轴模式下把平台的甩速交给
                            //   `OverScroller`（惯性由帧循环 `stepInertia` 推进）。
                            //   ★此前只 report（"手势语义上报"）而 `startFlingX` 无人调用 ⇒
                            //     惯性滑动**声明了但没接**（同类缺陷：报告有、通路无）。
                            if (horizontalScroll) startFlingX(vx);
                            return true;
                        }

                        @Override public boolean onScroll(android.view.MotionEvent e1, android.view.MotionEvent e2,
                                                         float dx, float dy) {
                            if (e1 == null || e2 == null) return false;
                            android.os.Bundle b = new android.os.Bundle();
                            b.putFloat("dx", dx);
                            b.putFloat("dy", dy);
                            report("scroll", e2, b);
                            // ★★真手势滚动**接线**（2026-10-01 收诚实边界）：平台的拖拽识别
                            //   直接进生产通路（内容偏移 + 内核滚动联动 + 写层）——此前这里
                            //   只 report（手势语义上报），内容纹丝不动（边界原文："真机手指拖拽未接线"）。
                            // ★★长卷模式（2026-10-01）：`horizontalScroll` 开时走 **X 轴**通路
                            //   （横移整幅长卷——同类手势、另一个轴；两轴互斥由模式开关决定）。
                            if (horizontalScroll) {
                                scrollDragByX(dx);
                            } else {
                                scrollDragBy(dx, dy);
                            }
                            return true;
                        }
                    });
        }
        return gestureDetector;
    }

    /** 归一为语义手势并上报（target 用 DOWN 时刻定下的那个） */
    private void report(String type, android.view.MotionEvent e, android.os.Bundle extra) {
        if (extra == null) extra = new android.os.Bundle();
        // 位移读数（tap/longpress 也用得上：区分「按住没动」与「按住了但滑了」）
        extra.putFloat("dx_total", e.getX() - gestureStartX);
        extra.putFloat("dy_total", e.getY() - gestureStartY);
        lastGestureType = type;
        lastGestureTarget = gestureTarget;
        lastGestureDetail = type + " target=" + gestureTarget + " " + extra;
        android.util.Log.i("proteus", "手势识别：" + lastGestureDetail);
        if (gestureListener != null) {
            gestureListener.onGesture(type, gestureTarget, gestureChain, gestureStartX, gestureStartY, extra);
        }
        invalidate();
    }

    @Override
    public boolean onTouchEvent(android.view.MotionEvent ev) {
        touchEventCount++;
        final int action = ev.getActionMasked();
        if (action == android.view.MotionEvent.ACTION_DOWN) {
            // ★★触摸即刹停惯性（平台标准行为：上手就停）——不刹会"拖拽被旧抛滑顶掉"：
            //   每帧 `stepInertia` 会把 scrollX 拉回抛滑时间线，拖动量被静默吞掉。
            if (flingScroller != null && !flingScroller.isFinished()) flingScroller.forceFinished(true);
            // ★DOWN 时刻做命中 → 这一整个手势都归它（与平台语义一致）
            dispatchHit(ev.getX(), ev.getY());
            gestureTarget = lastHitTarget;
            gestureChain = lastHitChain;
            gestureStartX = lastHitX;
            gestureStartY = lastHitY;
        }
        // ★交给平台识别器判定 tap / longpress / fling / scroll（不自研阈值与时间窗）
        detector().onTouchEvent(ev);
        return true;      // 消费，避免同一个手势被重复上报
    }

    /**
     * 按**屏幕/视图坐标**做命中派发（与 `onTouchEvent` 同一条代码路径）。
     *
     * ★抽成公开方法不是为了绕过 onTouchEvent，而是为了**可测**：
     *   设备上 `adb shell input tap` 需要 INJECT_EVENTS 权限（本仓已实测被拒），
     *   故验收脚本让 app 自己调用本方法——它走的是**同一个** `dispatchHit`，
     *   与真实触摸的区别仅在「事件从哪来」。
     */
    public void dispatchHit(float viewX, float viewY) {
        // ★坐标换算：绘制是「canvas.translate(0, -scrollY)」后再画内容，
        //   故屏幕坐标 → 内容坐标要**加回** scrollY。
        //   若不做这一步，列表滚动后命中会整体偏移（越往下滚错得越多）——
        //   这正是「命中必须由核心算、且与滚动同源」的原因之一。
        final float contentX = viewX;
        final float contentY = viewY + scrollY;
        lastHitX = contentX;
        lastHitY = contentY;

        int targetId = -1;
        int[] chain = new int[0];
        if (coreHandle != 0L) {
            String json = RustLayout.hitTest(coreHandle, contentX, contentY);
            try {
                org.json.JSONObject o = new org.json.JSONObject(json);
                if (o.optBoolean("ok", false)) {
                    if (!o.isNull("target")) targetId = o.getInt("target");
                    org.json.JSONArray arr = o.optJSONArray("chain");
                    if (arr != null) {
                        chain = new int[arr.length()];
                        for (int i = 0; i < arr.length(); i++) chain[i] = arr.getInt(i);
                    }
                }
            } catch (Exception e) {
                android.util.Log.e("ProteusHostView", "命中结果解析失败：" + json, e);
            }
        }
        lastHitTarget = targetId;
        lastHitChain = chain;
        if (hitListener != null) hitListener.onHit(targetId, chain, contentX, contentY);
        invalidate();     // 命中态可视化（例如高亮）由子类/监听方决定
    }

    /** 命中诊断转储（验收脚本读它） */
    public String hitDump() {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"target\":").append(lastHitTarget).append(",\"chain\":[");
        for (int i = 0; i < lastHitChain.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(lastHitChain[i]);
        }
        sb.append("],\"x\":").append(lastHitX).append(",\"y\":").append(lastHitY)
          .append(",\"touch_events\":").append(touchEventCount).append('}');
        return sb.toString();
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

    /**
     * ★★真实帧计数（**可观测性**：区分"我发出了指令"与"屏幕真的画了一帧"）。
     *
     * 【为什么需要（本仓实测）】S5 端到端首次跑：离屏重放有 3640 个采样点有像素，
     *   而设备截图**整屏是背景色**。⇒ 缺的正是这个读数——没有它无法区分
     *   ① onDraw 未被调用（视图/标志问题）② onDraw 调用了但画的内容在屏外/被裁。
     */
    private int onDrawCount = 0;

    /** 真实帧数（`onDraw` 调用次数；0 ⇒ 屏幕上一帧都没画过） */
    public int onDrawCount() { return onDrawCount; }

    @Override
    protected void onDraw(Canvas canvas) {
        onDrawCount++;
        super.onDraw(canvas);
        ensurePicture();   // ★首帧补建（setCmds 早于布局时）
        // ★滚动：自绘内容随 scrollY 平移，并**裁剪到滚动视口**
        //   （native-host 的裁剪在 applyScrollToNativeHosts 里单独做——
        //    它们不受这个 clipRect 约束，这是 Android 的固有行为）
        // ★★三种滚动语义（2026-10-01 两次实测后定案）：
        //   · **纵向偏移**（既有：列表/长内容）：画布 `translate(0,-scrollY)`——内容比视口高；
        //   · **横向偏移**（手卷浏览 `offsetScroll`）：画布 `translate(-scrollX,0)`——**画比屏宽**；
        //   · 横向**进度**（第一版"卷筒展开"，已弃用）：滚动值是进度，画固定——**不平移**。
        final boolean scrolled = offsetScroll
                ? (scrollX != 0 || scrollY != 0 || scrollViewport != null)
                : (!horizontalScroll && (scrollX != 0 || scrollY != 0 || scrollViewport != null));
        final int save = scrolled ? canvas.save() : -1;
        if (scrolled) {
            if (scrollViewport != null) {
                canvas.clipRect(scrollViewport.left, scrollViewport.top, scrollViewport.right, scrollViewport.bottom);
            }
            canvas.translate(-scrollX, -scrollY);
        }
        // ★滚动列表模式：绘制列表内容（这是**真实帧**的来源——canvas 来自窗口）
        if (listRenderer != null) {
            listRenderer.draw(canvas);
        } else if (framePicture != null && !animatingFrame()) {
            // ★★★显示列表回放（2026-10-02 正式路径）：静态帧回放（2ms）替代逐条重放（8ms）。
            //   `animatingFrame` = 有逐帧覆盖（动画表中非空）时为真 ⇒ 那些帧必须走全功能 drawCmds
            //   （显示列表是**静态录制**，播不了逐帧动画）。
            if (!drawPictureReplay(canvas)) drawCmds(canvas);
        } else {
            drawCmds(canvas);
        }
        if (scrolled) canvas.restoreToCount(save);
    }

    /** 用布局后的尺寸建立默认滚动视口（= 宿主全屏）；也可由场景显式设置 */
    private void ensureViewport() {
        if (scrollViewport == null && getWidth() > 0) {
            scrollViewport = new android.graphics.Rect(0, 0, getWidth(), getHeight());
        }
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
    /** ★批次 34：逐角圆角填充（mask 位：bit0=TL/1=TR/2=BR/3=BL；未置位角半径=0）。 */
    private void drawPathCorners(Canvas canvas, Cmd c, int mask, android.graphics.Paint p) {
        final float r = c.radius;
        final float[] radii = new float[]{
            (mask & 1) != 0 ? r : 0f, (mask & 1) != 0 ? r : 0f,      // 左上
            (mask & 2) != 0 ? r : 0f, (mask & 2) != 0 ? r : 0f,      // 右上
            (mask & 4) != 0 ? r : 0f, (mask & 4) != 0 ? r : 0f,      // 右下
            (mask & 8) != 0 ? r : 0f, (mask & 8) != 0 ? r : 0f,      // 左下
        };
        final android.graphics.Path path = new android.graphics.Path();
        path.addRoundRect(new android.graphics.RectF(c.x, c.y, c.x + c.w, c.y + c.h), radii, android.graphics.Path.Direction.CW);
        canvas.drawPath(path, p);
    }

    public void drawCmds(Canvas canvas) {
        // ★单次遍历下发全部指令（无 View 树、无递归 measure/layout）
        final List<Cmd> list = cmds;
        // ★字号只在**变化时**设置（同字号连排时零开销；见 Cmd.fontSize 注释）
        float lastSize = textPaint.getTextSize();
        int lastWeight = -1;   // ★批次 3：字重变化才重建 typeface（-1 = 首次必设，与默认 paint 对齐）
        float lastLetter = Float.NaN;   // ★批次 20：字距变化才 setLetterSpacing（NaN = 首次必设）
        int lastDecor = -1;   // ★批次 35：装饰变化才设下划线/删除线
        String lastFamRole = null;   // ★批次 36：字体角色变化才重设 typeface
        int lastAlign = -1;    // ★批次 4：文本对齐变化才设 Paint.Align
        final java.util.Set<Integer> skip = skipCmdIndices;   // ★被载体提升的指令：跳过（否则重影）
        final int[] ids = cmdNodeIds;
        for (int i = 0; i < list.size(); i++) {
            if (skip != null && skip.contains(i)) continue;
            final Cmd c = list.get(i);
            // ★★逐节点变换（内核动画的**绘制落点**）：按并行表查该指令的节点变换
            //   变换语义与 iOS `applyTransform` **同构**：平移 → 以**元素中心**为锚旋转/缩放。
            float[] tf = (ids != null && i < ids.length && ids[i] >= 0) ? animTx.get(ids[i]) : null;
            // ★批次 39：无动画值时退回**静态变换**（编译期 CSS transform —— 前 9 位与 animTx 同构）
            boolean fromStatic = false;
            if (tf == null && ids != null && i < ids.length && ids[i] >= 0) {
                tf = nodeStaticTx.get(ids[i]);
                fromStatic = tf != null;
            }
            final float rotX = tf != null && tf.length >= 7 ? tf[5] : 0f;
            final float rotY = tf != null && tf.length >= 7 ? tf[6] : 0f;
            final boolean has3d = rotX != 0f || rotY != 0f;
            // ★批次 39：静态位移的**盒比例**分量按本节点绘制盒换算（translate(-50%,-50%) 居中）
            float tfTx = tf != null ? tf[0] : 0f;
            float tfTy = tf != null ? tf[1] : 0f;
            if (fromStatic && tf != null && tf.length >= 11) { tfTx += tf[9] * c.w; tfTy += tf[10] * c.h; }
            // ★C1：有裁剪也必须 save/restore（clipPath 是画布状态，不 restore 会**泄漏到后面所有指令**）
            // ★C1：有裁剪声明就必须 save/restore（**含静态裁剪**——首版只认动画中的 ⇒ 静态漏 restore）
            final boolean hasClip = ids != null && i < ids.length && clipKindOf(ids[i]) > 0;
            final boolean xf = (tf != null && (tfTx != 0f || tfTy != 0f || tf[2] != 1f || tf[3] != 0f || has3d))
                    || hasClip;
            final int save = xf ? canvas.save() : -1;
            // ★★软边遮罩（mask v1）：**saveLayer 包裹**（开层 → 画内容 → 用 DST_IN 叠渐变 → 还原）。
            //   揭示色标来自 `animMask`（内核已算好）或建树静态声明——宿主零揭示数学。
            //   ★与 clipPath 的差异：clip 是"硬边裁剪"（直接改画布状态），遮罩是"软边合成"
            //     （必须开层做 DST_IN——两者在同一节点上**天然可叠加**：先 clip 后遮罩）。
            float[] maskSpec = (ids != null && i < ids.length && ids[i] >= 0 && cmds != null && i < cmds.size())
                    ? cmds.get(i).mask : null;
            float[] maskReveal = (ids != null && i < ids.length) ? animMask.get(ids[i]) : null;
            final boolean hasMask = maskSpec != null && (maskReveal != null
                    ? (maskReveal[2] > 0.001f || maskReveal[4] > 0.001f)  // 未全隐才开层（省性能）
                    : true);
            final int maskLayer = hasMask
                    ? canvas.saveLayer(c.x, c.y, c.x + c.w, c.y + c.h, null) : -1;
            float op = 1f;
            if (tf != null) op = tf[4];
            // ★★倾斜（skew v1）：取出本节点的倾斜角（画布变换用——见下）
            final float tfSkewX = tf != null && tf.length >= 9 ? tf[7] : 0f;
            final float tfSkewY = tf != null && tf.length >= 9 ? tf[8] : 0f;
            if (xf) {
                // ★tf 可能为 null 而仅因裁剪进入本分支（C1）——兜底为零变换
                // ★批次 39：tfTx/tfTy 已含静态位移的盒比例分量（见上）
                canvas.translate(tfTx, tfTy);
                // ★★变换原点（transform-origin v1）：缺省 (0.5, 0.5) = 元素中心（既有行为零变化）——
                //   放底部（0.5, 1.0）= "从根部弯折"（与水草/旗帜的物理直觉一致）。
                final float[] org = nodeTransformOrigin.get(ids != null && i < ids.length ? ids[i] : -1);
                final float ox = org != null ? org[0] : 0.5f;
                final float oy = org != null ? org[1] : 0.5f;
                float cx = c.x + c.w * ox, cy = c.y + c.h * oy;
                if (tf != null && tf[3] != 0f) canvas.rotate(tf[3], cx, cy);
                if (tf != null && tf[2] != 1f) canvas.scale(tf[2], tf[2], cx, cy);
                // ★★倾斜（skew v1）：`canvas.skew(tanSkewX, tanSkewY)` —— 与 iOS 的 shear 矩阵同式。
                //   ★花括号包裹（本仓纪律：变量声明必须自带块——否则作用域会漏到外层）
                if (tfSkewX != 0f || tfSkewY != 0f) {
                    canvas.translate(cx, cy);
                    canvas.skew((float) Math.tan(Math.toRadians(tfSkewX)),
                            (float) Math.tan(Math.toRadians(tfSkewY)));
                    canvas.translate(-cx, -cy);
                }
                // ★★B 批 3D（2026-10-01）：rotateX/rotateY 用 `android.graphics.Camera` 生成
                //   **投影矩阵**（本质 = 平移-旋转-平移 + 透视除法；d = 节点 perspective）。
                //   ★锚点 = 元素中心（与 iOS `CATransform3DRotate` 同语义——先在中心建变换再平移回去）。
                //   ★无 perspective 的节点 = 相机无限远 ⇒ 正交投影（与 iOS 无透视一致）。
                if (has3d) {
                    final Float dObj = nodePerspective.get(ids[i]);
                    android.graphics.Camera cam = new android.graphics.Camera();
                    if (dObj != null && dObj > 0f) cam.setLocation(0, 0, -dObj);
                    cam.save();
                    if (rotX != 0f) cam.rotateX(rotX);
                    if (rotY != 0f) cam.rotateY(rotY);
                    android.graphics.Matrix m3d = new android.graphics.Matrix();
                    cam.getMatrix(m3d);
                    cam.restore();
                    canvas.translate(cx, cy);
                    canvas.concat(m3d);
                    canvas.translate(-cx, -cy);
                }
            }
            // ★★C1 裁剪（2026-10-01）：该节点有裁剪形状时，在**绘制内容之前**设 clipPath——
            //   参数由内核每帧下发（盒分数 → px 用 c.w/c.h 换算；与 iOS mask 同一套语义）。
            //   ★save/restore 已由上面的变换块统一管理（xf 为真时必有 save；裁剪也搭这一趟车）。
            final int clipNodeId = (ids != null && i < ids.length) ? ids[i] : -1;
            if (clipNodeId >= 0) {
                // ★参数：每帧值优先（动画中），否则**树里声明的基态**（静态裁剪也必须渲染）
                final float[] base = nodeClipKindAndBase.get(clipNodeId);
                final float[] clipP = animClip.containsKey(clipNodeId)
                        ? animClip.get(clipNodeId)
                        : base; // base[0] 是 kind，参数从 base[1] 起 —— 见下面的读取偏移
                final int ck = clipKindOf(clipNodeId);
                final boolean fromBase = !animClip.containsKey(clipNodeId);
                if (clipP != null && ck > 0) {
                    // ★偏移：基态形态是 [kind, p0..p15]（+1）；每帧形态是 [p0..p15]（+0）
                    final int off = fromBase ? 1 : 0;
                    final float[] P = clipP;
                    android.graphics.Path cp = new android.graphics.Path();
                    if (ck == 1) { // inset
                        float top = P[off + 0] * c.h, right = P[off + 1] * c.w;
                        float bottom = P[off + 2] * c.h, left = P[off + 3] * c.w;
                        cp.addRect(c.x + left, c.y + top, c.x + c.w - right, c.y + c.h - bottom,
                                android.graphics.Path.Direction.CW);
                    } else if (ck == 2) { // circle（r 相对 min(w,h)）
                        float r = P[off + 2] * Math.min(c.w, c.h);
                        cp.addCircle(c.x + P[off + 0] * c.w, c.y + P[off + 1] * c.h, r, android.graphics.Path.Direction.CW);
                    } else { // polygon
                        final int n = Math.min((P.length - off) / 2, 8);
                        if (n >= 3) {
                            cp.moveTo(c.x + P[off + 0] * c.w, c.y + P[off + 1] * c.h);
                            for (int k = 1; k < n; k++) {
                                cp.lineTo(c.x + P[off + 2 * k] * c.w, c.y + P[off + 2 * k + 1] * c.h);
                            }
                            cp.close();
                        }
                    }
                    canvas.clipPath(cp);
                }
            }
            // ★★颜色覆盖（2026-10-01）：该节点参与颜色动画时用内核值，否则用静态 `Cmd.color`
            //   （表里没有 ⇒ 零额外开销；与 `animTx` 的查表同一形态）
            final Integer animBg = (ids != null && i < ids.length && ids[i] >= 0) ? animColor.get(ids[i]) : null;
            bgPaint.setColor(animBg != null ? animBg : c.color);
            if (op < 1f) {
                int base = animBg != null ? animBg : c.color;
                bgPaint.setAlpha(Math.max(0, Math.min(255, (int) (Color.alpha(base) * op))));
            }
            // ★★渐变填充（v1 · 2026-10-01）：有规格 ⇒ 给 bgPaint 挂 shader（**矩形局部坐标**——
            //   shader 的坐标是画布绝对坐标，故按 cmd 的 x/y/w/h 建）。
            //   ★与 TS `linearGradientEndpoints` / iOS `applyGradient` **同式**：
            //     线性端点 = 中心 ± 半程方向向量（0°=向上）；径向半径 = r × 宽度。
            //   ★用完即清 shader（paint 是复用的——不清会漏到后续所有指令，与"裁剪不 restore"
            //     同一类画布状态泄漏）。
            android.graphics.Shader gradShader = null;
            // ★★渐变 v2：**每帧覆盖优先**（内核已混合的色标——动画期用它；否则用静态声明）
            final TickGrad tg = (ids != null && i < ids.length && ids[i] >= 0) ? animGrad.get(ids[i]) : null;
            if (tg != null) {
                // ★★几何用**内核已混合**的值（`tg.geo = [angle, cx, cy, r]`——渐变 v2 扩展：
                //   "光本身在动"：r 扩散 / angle 转向 / cx 移动）——与 iOS 同式
                final boolean geoOk = Float.isFinite(tg.geo[0]) && Float.isFinite(tg.geo[1])
                        && Float.isFinite(tg.geo[2]) && Float.isFinite(tg.geo[3]);
                if (tg.kind == 1 && c.gradient != null && geoOk) {
                    final double rad = Math.toRadians(tg.geo[0]);
                    final float dx = (float) Math.sin(rad);
                    final float dy = (float) -Math.cos(rad);
                    gradShader = new android.graphics.LinearGradient(
                            c.x + (0.5f - dx / 2f) * c.w, c.y + (0.5f - dy / 2f) * c.h,
                            c.x + (0.5f + dx / 2f) * c.w, c.y + (0.5f + dy / 2f) * c.h,
                            java.util.Arrays.copyOf(tg.colors, tg.n), java.util.Arrays.copyOf(tg.offsets, tg.n),
                            android.graphics.Shader.TileMode.CLAMP);
                } else if (tg.kind == 2 && c.gradient != null && geoOk && tg.geo[3] > 0f) {
                    gradShader = new android.graphics.RadialGradient(
                            c.x + tg.geo[1] * c.w, c.y + tg.geo[2] * c.h, tg.geo[3] * c.w,
                            java.util.Arrays.copyOf(tg.colors, tg.n), java.util.Arrays.copyOf(tg.offsets, tg.n),
                            android.graphics.Shader.TileMode.CLAMP);
                }
            }
            if (gradShader == null && c.gradient != null) {
                final GradSpec g = c.gradient;
                if (g.kind == 1) {
                    final double rad = Math.toRadians(g.angleDeg);
                    // I2-ALLOW: **非几何舍入**——渐变端点（绘制效果参数）的浮点换算；
                    //   内核只管矩形几何（已吸附），渐变是宿主绘制属性（与 borderRadius 同层）。
                    final float dx = (float) Math.sin(rad);
                    final float dy = (float) -Math.cos(rad);
                    final float ex0 = c.x + (0.5f - dx / 2f) * c.w;
                    final float ey0 = c.y + (0.5f - dy / 2f) * c.h;
                    final float ex1 = c.x + (0.5f + dx / 2f) * c.w;
                    final float ey1 = c.y + (0.5f + dy / 2f) * c.h;
                    gradShader = new android.graphics.LinearGradient(ex0, ey0, ex1, ey1, g.colors, g.offsets,
                            android.graphics.Shader.TileMode.CLAMP);
                } else if (g.kind == 2 && g.r > 0f) {
                    gradShader = new android.graphics.RadialGradient(
                            c.x + g.cx * c.w, c.y + g.cy * c.h, g.r * c.w, g.colors, g.offsets,
                            android.graphics.Shader.TileMode.CLAMP);
                }
            }
            if (gradShader != null) bgPaint.setShader(gradShader);
            // ★批次 10（CSS 兼容对齐 · 超级应用视觉）：盒阴影——**分层圆角矩形近似**（N 层 alpha 衰减）。
            //   ★为什么不用 setShadowLayer：Android 硬件加速下它**只支持文本**（对 Path/Rect 无效）——
            //     真机静默不画（见下方 glow 的同款注释）。分层填充是确定性的且 GPU 廉价。
            if (c.boxShadow != null) {
                final float sdx = c.boxShadow[0];
                final float sdy = c.boxShadow[1];
                final float sblur = c.boxShadow[2];
                final int scol = (int) c.boxShadow[4];
                final float scAlpha = Color.alpha(scol) / 255f;
                final int scRgb = scol & 0x00FFFFFF;
                final int SHADOW_LAYERS = 6;
                final int ssave = canvas.save();
                canvas.translate(sdx, sdy);
                for (int s = SHADOW_LAYERS; s >= 1; s--) {
                    final float t = (float) s / SHADOW_LAYERS; // 1(最外) → 1/N(最内)
                    final float exp = c.radius > 0f ? c.radius + sblur * t : sblur * t;
                    final int a = Math.max(0, Math.min(255, (int) (scAlpha * (1f - t) * (255f / SHADOW_LAYERS) * 2f * op)));
                    shadowPaint.setColor((a << 24) | scRgb);
                    if (c.radius > 0f) canvas.drawRoundRect(c.x - sblur * t, c.y - sblur * t, c.x + c.w + sblur * t, c.y + c.h + sblur * t, exp, exp, shadowPaint);
                    else canvas.drawRect(c.x - sblur * t, c.y - sblur * t, c.x + c.w + sblur * t, c.y + c.h + sblur * t, shadowPaint);
                }
                canvas.restoreToCount(ssave);
            }
            // ★圆角（灯光秀的灯珠）：radius > 0 走 drawRoundRect——纯绘制属性，默认 0 零行为变化
            final Integer rcm = (ids != null && i < ids.length) ? nodeRadiusCorners.get(ids[i]) : null;
            if (rcm != null) { drawPathCorners(canvas, c, rcm, bgPaint); }
            else if (c.radius > 0f) canvas.drawRoundRect(c.x, c.y, c.x + c.w, c.y + c.h, c.radius, c.radius, bgPaint);
            else canvas.drawRect(c.x, c.y, c.x + c.w, c.y + c.h, bgPaint);
            if (gradShader != null) bgPaint.setShader(null); // ★清（paint 复用——漏挂会污染后续指令）
            // ★★C2 描边（2026-10-01）：该节点有 SVG 路径时**画线**——用 PathMeasure 按进度截取
            //   （`getSegment(0, progress×len)` 的原生等价物；与 iOS `strokeEnd` 同一语义）。
            //   ★画在内容之后（描边叠在色块上——与 iOS 子层顺序一致）。
            //   ★★**必须平移到节点绝对位置**（2026-10-01 真机截图目视抓出的真缺陷）：
            //     段坐标是**节点局部坐标**（d 的坐标系 = 节点盒，与内核解析约定一致），
            //     首版直接 `drawPath` ⇒ 所有描边都画在**画布原点**（山/水纹/竹/鸟在左上角聚成一团）。
            //     ★为什么判据没抓到：X 组的测试节点恰好在 (0,0)（局部 == 绝对 ⇒ 恒等通过）——
            //       "判据的坐标系不覆盖平移"是判据盲区，这回由**目视核对**兜住（多一道证据形态的价值）。
            if (ids != null && i < ids.length && ids[i] >= 0) {
                final Object[] svg = nodeSvgStroke.get(ids[i]);
                if (svg != null) {
                    final android.graphics.Path sp = (android.graphics.Path) svg[0];
                    final int scol = (Integer) svg[1];
                    final float swid = (Float) svg[2];
                    // ★回落**声明基态**（2026-10-01）：表无该节点 ⇒ 用 `svgPath.progress` 声明的
                    //   "生来画到哪"（缺省 0 = 未画）；此前硬编码 0 ⇒ 静态 `progress:1` 的路径永不显形。
                    final float strokeBase = (Float) svg[3];
                    final float prog = animStroke.containsKey(ids[i]) ? animStroke.get(ids[i]) : strokeBase;
                    if (prog > 0f) {
                        strokePaint.setColor(scol);
                        strokePaint.setStrokeWidth(swid);
                        final int svgSave = canvas.save();
                        canvas.translate(c.x, c.y);
                        if (prog >= 1f) {
                            canvas.drawPath(sp, strokePaint);
                        } else {
                            // 按弧长截取（PathMeasure——Android 原生）
                            android.graphics.PathMeasure pm = new android.graphics.PathMeasure(sp, false);
                            android.graphics.Path seg = new android.graphics.Path();
                            pm.getSegment(0f, pm.getLength() * prog, seg, true);
                            canvas.drawPath(seg, strokePaint);
                        }
                        canvas.restoreToCount(svgSave);
                    }
                }
            }
            // ★★发光（glow v1）：**分层同心描边**（N 层宽度梯度 + alpha 平方衰减）——
            //   与 TS `glowLayers` / Swift 同式（GLOW_LAYERS = 5）。
            //   ★为什么不用 setShadowLayer：Android 硬件加速下它**只支持文本**（对 Path 无效）
            //     ——真机静默不画的经典陷阱；分层填充是确定性的且 GPU 廉价。
            //   ★发光随**画线进度**走（有描边路径时按进度截断——"画到哪、光到哪"）；
            //     纯色块节点则按圆角矩形描边发光。
            if (ids != null && i < ids.length && ids[i] >= 0) {
                final int ci2 = i < list.size() ? i : -1;
                final float[] gspec = ci2 >= 0 ? list.get(ci2).glow : null;
                if (gspec != null) {
                    final float gi0 = animGlow.containsKey(ids[i]) ? animGlow.get(ids[i]) : 1f;
                    final int gcol = (int) gspec[0];
                    final float grad = gspec[1];
                    final float galpha = gspec[2] * gi0;
                    if (galpha > 0.003f) {
                        final int gsave = canvas.save();
                        canvas.translate(c.x, c.y);
                        strokePaint.setStyle(android.graphics.Paint.Style.STROKE);
                        strokePaint.setStrokeCap(android.graphics.Paint.Cap.ROUND);
                        strokePaint.setStrokeJoin(android.graphics.Paint.Join.ROUND);
                        final Object[] svg2 = nodeSvgStroke.get(ids[i]);
                        final float strokeBase2 = svg2 != null ? (Float) svg2[3] : 0f;
                        final float prog2 = animStroke.containsKey(ids[i]) ? animStroke.get(ids[i]) : strokeBase2;
                        // 基准线宽：有描边路径用它的 strokeWidth；否则用发光半径的一小撮（纯色块的"边缘光"）
                        final float baseW = svg2 != null ? (Float) svg2[2] : Math.max(1f, grad * 0.12f);
                        // 由内到外（同式：boost = radius×k/N · alpha = a0×(1-(k-1)/N)²）
                        for (int k = 1; k <= GLOW_LAYERS; k++) {
                            final float t = (k - 1f) / GLOW_LAYERS;
                            final float a = galpha * (1 - t) * (1 - t);
                            if (a <= 0.003f) continue;
                            final float boost = grad * (k / (float) GLOW_LAYERS);
                            strokePaint.setColor((gcol & 0x00FFFFFF) | (((int) (a * 255)) << 24));
                            strokePaint.setStrokeWidth(baseW + boost * 2f);
                            if (svg2 != null) {
                                // 线条发光：路径 + 进度截断（变形后的 path 已在表中）
                                final android.graphics.Path sp2 = (android.graphics.Path) svg2[0];
                                if (prog2 >= 1f) {
                                    canvas.drawPath(sp2, strokePaint);
                                } else if (prog2 > 0f) {
                                    android.graphics.PathMeasure pm2 = new android.graphics.PathMeasure(sp2, false);
                                    android.graphics.Path seg2 = new android.graphics.Path();
                                    pm2.getSegment(0f, pm2.getLength() * prog2, seg2, true);
                                    canvas.drawPath(seg2, strokePaint);
                                }
                            } else if (c.radius > 0f) {
                                // 色块发光：圆角矩形描边（局部坐标——已 translate 到 c.x/c.y）
                                canvas.drawRoundRect(0, 0, c.w, c.h, c.radius, c.radius, strokePaint);
                            } else {
                                canvas.drawRect(0, 0, c.w, c.h, strokePaint);
                            }
                        }
                        canvas.restoreToCount(gsave);
                    }
                }
            }
            if (c.text != null) {
                if (c.fontSize > 0 && c.fontSize != lastSize) {
                    textPaint.setTextSize(c.fontSize);
                    lastSize = c.fontSize;
                }
                // ★批次 3：字重只在**变化时**设置 typeface（>=600 ⇒ BOLD；缺省 400 = normal，
                //   与既有 `typefaceOf(role, weight)` 同判据）——同字重连排时零开销。
                // ★批次 36：字体角色（节点侧表）优先——角色或字重变化都重设 typeface
                final String famRole = (ids != null && i < ids.length) ? nodeFontRole.get(ids[i]) : null;
                if (c.fontWeight != lastWeight || !java.util.Objects.equals(famRole, lastFamRole)) {
                    textPaint.setTypeface(ProteusHostView.typefaceOf(famRole, c.fontWeight, null));
                    lastWeight = c.fontWeight;
                    lastFamRole = famRole;
                }
                // ★批次 20：字距（仅在变化时设——同字距连排零开销）；Android 单位 em ⇒ px/字号
                if (c.letterSpacing != lastLetter) {
                    textPaint.setLetterSpacing(c.fontSize > 0f ? c.letterSpacing / c.fontSize : 0f);
                    lastLetter = c.letterSpacing;
                }
                // ★批次 35：文本装饰（变化时才设——同值连排零开销）
                if (c.textDecoration != lastDecor) {
                    textPaint.setUnderlineText(c.textDecoration == 1);
                    textPaint.setStrikeThruText(c.textDecoration == 2);
                    lastDecor = c.textDecoration;
                }
                // ★批次 4：文本水平对齐（仅在变化时设 Align——同对齐连排零开销）
                if (c.textAlign != lastAlign) {
                    textPaint.setTextAlign(c.textAlign == 1 ? Paint.Align.CENTER
                            : c.textAlign == 2 ? Paint.Align.RIGHT : Paint.Align.LEFT);
                    lastAlign = c.textAlign;
                }
                // ★★文字色覆盖（2026-10-01）：动画值优先，其次静态 `Cmd.textColor`
                //   （两者都无 ⇒ 保持 paint 现值——既有场景不受影响，零额外开销）。
                //   ★alpha 口径（与底色路径同一条）：把**色自身 alpha × opacity** 落进 paint——
                //     此前 `op==1` 时无条件 `setAlpha(255)` 会把动画色的 alpha 通道**压回不透明**
                //     （文字色四通道里 A 是独立可动的，钳住它 = 静默丢一个通道）。
                final Integer animTc = (ids != null && i < ids.length && ids[i] >= 0)
                        ? animTextColor.get(ids[i]) : null;
                if (animTc != null) textPaint.setColor(animTc);
                else if (c.textColor != 0) textPaint.setColor(c.textColor);
                final int alphaBase = (animTc != null || c.textColor != 0)
                        ? Color.alpha(animTc != null ? animTc : c.textColor) : 255;
                textPaint.setAlpha(op < 1f ? Math.max(0, Math.min(255, (int) (alphaBase * op))) : alphaBase);
                // ★批次 4：绘制 x 按对齐换算（LEFT:CENTER:RIGHT 的 x 语义不同——见 Paint.Align）
                final float tx = c.textAlign == 1 ? c.x + c.w * 0.5f
                        : c.textAlign == 2 ? c.x + c.w - 1f : c.x + 1f;
                // ★批次 13（line-height，CSS 标准语义）：**半行距居中**——行盒高 = lineHeight 时，
                //   字形内容区在行盒内**垂直居中**（上下各分一半行距）＝ Web/Skyline 的真 CSS 行为。
                //   未声明行高 ⇒ 沿用旧 0.8h（既有路径零行为变化）。
                final float baseY;
                if (c.lineHeight > 0f) {
                    android.graphics.Paint.FontMetrics fm = textPaint.getFontMetrics();
                    final float contentH = fm.descent - fm.ascent;
                    baseY = c.y + (c.lineHeight - contentH) * 0.5f - fm.ascent;
                } else {
                    baseY = c.y + c.h * 0.8f;
                }
                canvas.drawText(c.text, tx, baseY, textPaint);
            }
            // ★批次 5（CSS 兼容对齐 · 边框）：uniform 边框（stroke 半内缩：strokeWidth/2 居中于边线）。
            if (c.borderWidth > 0 && c.borderColor != 0) {
                borderPaint.setColor(c.borderColor);
                borderPaint.setStrokeWidth(c.borderWidth);
                borderPaint.setAlpha(op < 1f ? Math.max(0, Math.min(255, (int) (Color.alpha(c.borderColor) * op))) : Color.alpha(c.borderColor));
                final float inset = c.borderWidth * 0.5f;
                final float l = c.x + inset, t = c.y + inset, rr = c.x + c.w - inset, bb = c.y + c.h - inset;
                if (c.radius > 0) canvas.drawRoundRect(l, t, rr, bb, c.radius, c.radius, borderPaint);
                else canvas.drawRect(l, t, rr, bb, borderPaint);
            }
            // ★★软边遮罩合成（mask v1）：**在全部内容（含文字/描边/发光）之后**用
            //   `渐变 shader + DST_IN` 把本层按揭示色标"擦"出来——
            //   ★必须放最后（放中间会让之后画的东西"逃出遮罩"——文字逃出是最容易被忽略的）。
            if (hasMask) {
                final float[] rev = maskReveal != null
                        ? maskReveal
                        : new float[]{maskSpec[0], 0f, 1f, 1f, 1f}; // 静态：无每帧覆盖 ⇒ 全显兜底
                final int mk = (int) rev[0];
                // 端点钉死（与内核同一纪律）：alpha 由 [aA, aB] 两标编码（白 + alpha）
                final int aA = (int) (Math.max(0f, Math.min(1f, rev[2])) * 255f + 0.5f);
                final int aB = (int) (Math.max(0f, Math.min(1f, rev[4])) * 255f + 0.5f);
                final int[] mcols = {(aA << 24) | 0x00FFFFFF, (aB << 24) | 0x00FFFFFF};
                final float[] mpos = {rev[1], rev[3]};
                android.graphics.Shader mshader;
                if (mk == 1) {
                    // 线性：沿 angle（与渐变同一套端点换算：0°=向上）
                    final double rad = Math.toRadians(maskSpec[1]);
                    final float dx = (float) Math.sin(rad);
                    final float dy = (float) -Math.cos(rad);
                    mshader = new android.graphics.LinearGradient(
                            c.x + (0.5f - dx / 2f) * c.w, c.y + (0.5f - dy / 2f) * c.h,
                            c.x + (0.5f + dx / 2f) * c.w, c.y + (0.5f + dy / 2f) * c.h,
                            mcols, mpos, android.graphics.Shader.TileMode.CLAMP);
                } else {
                    // 径向：自圆心向外
                    mshader = new android.graphics.RadialGradient(
                            c.x + maskSpec[2] * c.w, c.y + maskSpec[3] * c.h, maskSpec[4] * c.w,
                            mcols, mpos, android.graphics.Shader.TileMode.CLAMP);
                }
                maskPaint.setShader(mshader);
                maskPaint.setXfermode(new android.graphics.PorterDuffXfermode(
                        android.graphics.PorterDuff.Mode.DST_IN));
                canvas.drawRect(c.x, c.y, c.x + c.w, c.y + c.h, maskPaint);
                maskPaint.setShader(null);
                canvas.restoreToCount(maskLayer);
            }
            if (xf) canvas.restoreToCount(save);
        }
    }

    /**
     * ★★**视觉签名**（手卷浏览的像素级证据）：把当前画面渲染到离屏位图，按 24×48 网格采样。
     *   起点与收尾各采一次 ⇒ 差异百分比 = "画面真的随滚动变了"（堵住"全黑也判绿"的洞）。
     */
    public int[] renderSignature() {
        final int vw = getWidth() > 0 ? getWidth() : 1080;
        final int vh = getHeight() > 0 ? getHeight() : 2400;
        android.graphics.Bitmap bmp = null;
        try {
            bmp = android.graphics.Bitmap.createBitmap(vw, vh, android.graphics.Bitmap.Config.ARGB_8888);
            measure(android.view.View.MeasureSpec.makeMeasureSpec(vw, android.view.View.MeasureSpec.EXACTLY),
                    android.view.View.MeasureSpec.makeMeasureSpec(vh, android.view.View.MeasureSpec.EXACTLY));
            layout(0, 0, vw, vh);
            draw(new android.graphics.Canvas(bmp));
            final int gx = 24, gy = 48;
            int[] out = new int[gx * gy];
            int k = 0;
            for (int j = 0; j < gy; j++) {
                for (int i = 0; i < gx; i++) {
                    out[k++] = bmp.getPixel(vw * i / gx + vw / (2 * gx), vh * j / gy + vh / (2 * gy));
                }
            }
            return out;
        } catch (Throwable t) {
            return new int[0];
        } finally {
            if (bmp != null) bmp.recycle();
        }
    }

    /** 当前文本字号（**审计用**：报告里记录两侧实际绘制字号，防"不公平"静默复发） */
    public float currentTextSizePx() { return textPaint.getTextSize(); }

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
        // I2-ALLOW: 文本栅格化位图尺寸（测量子系统，非布局几何——位图必须整数像素）
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

    /**
     * ★★**实测结论（2026-10-02）**：本快路径在本机**劣于基线**（9ms vs 7ms）——
     *   真因不是查表（23 处对 4051 条指令仅微秒级），而是**软件光栅下逐条 drawRect
     *   本身已是最优**（Path 批处理反劣化：Skia 对 drawRect 有整数快路径，Path 走通用填充）。
     *   ⇒ 保留供对照（与"文本图集"同处置：保留但默认不启用），**正式路径 = Picture 复用**（见下）。
     *
     * ★★★**静态快路径**（保留对照；结论见上方）。
     *
     * 【为什么需要（归因数据）】基线 `drawCmds` 主循环含 **23 处特性查表**（动画表 8 张 /
     *   clip / mask / svg / glow / skipSet…）——4051 条指令 ⇒ **~9.3 万次哈希查询 + 分支**，
     *   实测软光栅 9.3ms（原生 4.2ms）。而**绝大多数帧**（无动画、无裁剪、无特效）根本
     *   不需要这些查表——它们是"每帧都在为不可能发生的功能付费"。
     *
     * 【本方法】在上述特性**全静态**时走极简循环：
     *   · 零查表（调用方先过 `canUseFastPath()`）
     *   · paint 状态**仅在变化时**设置（基线每条 setColor/setAlpha ⇒ Skia paint 重建）
     *   · 色块按**同色连续段**批处理（一条 Path 一次 drawPath，见 `drawCmdsOptimized` 的验证：
     *     该手法已实测 0 像素差）
     *   · 文本连续段避免重复 setSize/setColor
     *
     * ★正确性保证：调度层（render path）只在 `canUseFastPath()` 为真时选它；其余帧仍走
     *   `drawCmds`（全功能）。两条路径的**逐像素一致性**由 app-4050 的像素 diff 判据锁定。
     */
    public boolean canUseFastPath() {
        if (cmds == null || cmds.isEmpty()) return false;
        // ① 无逐帧/逐节点覆盖（动画全静）+ 无 svg/clip 静态表
        if (!animTx.isEmpty() || !animColor.isEmpty() || !animGrad.isEmpty() || !animMask.isEmpty()
                || !animStroke.isEmpty() || !animClip.isEmpty() || !animGlow.isEmpty()
                || !animTextColor.isEmpty() || !nodeSvgStroke.isEmpty() || !nodeClipKindAndBase.isEmpty()) {
            return false;
        }
        if (skipCmdIndices != null && !skipCmdIndices.isEmpty()) return false;
        // ② 指令级：不得含快路径不支持的特性（渐变/圆角/发光/遮罩）——O(n) 单遍扫描
        //    （每帧一次，非每指令；成本可忽略）
        for (int i = 0; i < cmds.size(); i++) {
            final Cmd c = cmds.get(i);
            if (c.gradient != null || c.glow != null || c.mask != null || c.radius > 0f) return false;
        }
        return true;
    }

    public void drawCmdsFast(Canvas canvas) {
        final List<Cmd> list = cmds;
        final int n = list.size();
        // ① 色块：同色连续段 → 一条 Path
        int curColor = 0;
        boolean hasColor = false;
        float lastTextSize = -1f;
        int lastTextColor = 0;
        boolean hasTextColor = false;
        for (int i = 0; i < n; i++) {
            final Cmd c = list.get(i);
            // —— 色块（★逐条 drawRect——归因实测：Path 批处理在软件光栅下**反而更慢**
            //    （8~10ms vs 逐条 3~7ms）：Skia 对 drawRect 有整数快路径，Path 要走通用填充。
            //    保留的优化只有 **paint 状态去重**（同色不重设）——那是有收益的部分）——
            if (c.color != 0) {
                if (!hasColor || c.color != curColor) {
                    bgPaint.setColor(c.color);
                    curColor = c.color;
                    hasColor = true;
                }
                canvas.drawRect(c.x, c.y, c.x + c.w, c.y + c.h, bgPaint);
            }
            // —— 文本（同段内 paint 状态只在变化时设）——
            if (c.text != null) {
                if (c.fontSize > 0 && c.fontSize != lastTextSize) {
                    textPaint.setTextSize(c.fontSize);
                    lastTextSize = c.fontSize;
                }
                if (c.textColor != 0 && c.textColor != lastTextColor) {
                    textPaint.setColor(c.textColor);
                    lastTextColor = c.textColor;
                    hasTextColor = true;
                } else if (c.textColor == 0 && hasTextColor) {
                    textPaint.setColor(0xFF000000);
                    lastTextColor = 0;
                    hasTextColor = false;
                }
                canvas.drawText(c.text, c.x + 1f, c.y + c.h * 0.8f, textPaint);
            }
        }
    }

    /**
     * ★★★**显示列表复用（Picture）**（2026-10-02 · L2 缺口正式解法）。
     *
     * 【为什么是它（真因归因链）】
     *   1. 归因：软光栅 9.3ms = 色块 3ms + 文本 7ms；文本是大头；
     *   2. 假设检验：静态快路径（零查表 + paint 去重）实测 **9ms 更慢** ⇒ 查表不是瓶颈；
     *   3. 对照原生：`View.draw` 4.4ms 完成 6000 次绘制调用 ⇒ 差异在**逐调用 Java→JNI→Skia**
     *      路径成本；原生侧 DisplayList 的**回放循环在 native 内**（零逐调用 JNI）；
     *   4. 实测验证：同为软件画布，Picture 录制 5ms + **回放 2ms**（`drawPicture` 单次调用
     *      → native 批处理）⇒ **回放 2ms vs 原生 4.4ms = 0.45×（快 2.2 倍）**，且逐像素一致（diff=0）。
     *
     * 【语义（与行级显示列表复用同源，见 flat-redraw 场景）】
     *   · `cmds` 变了（或首次）⇒ `rebuildPicture()`（含录制，5ms）
     *   · 未变 ⇒ `drawPictureReplay(canvas)`（2ms）——**稳态帧成本**
     *   纯 App 的滚动/动画帧属后者；这正是"每帧成本"对比的正确口径。
     */
    private android.graphics.Picture framePicture = null;


    /**
     * 是否存在**逐帧覆盖**（动画中）——决定能否走显示列表回放。
     * ★显示列表是静态录制：有逐帧覆盖时必须走全功能 `drawCmds`（否则动画不动）。
     */
    public boolean hasFrameOverrides() {
        return !animTx.isEmpty() || !animColor.isEmpty() || !animGrad.isEmpty() || !animMask.isEmpty()
                || !animStroke.isEmpty() || !animClip.isEmpty() || !animGlow.isEmpty() || !animTextColor.isEmpty();
    }
    private boolean animatingFrame() { return hasFrameOverrides(); }

    /** 指令变更后重建显示列表（脏时调用一次） */
    public void rebuildPicture(int width, int height) {
        android.graphics.Picture pic = new android.graphics.Picture();
        android.graphics.Canvas c = pic.beginRecording(width, height);
        drawCmds(c);
        pic.endRecording();
        framePicture = pic;
    }

    /** 回放显示列表（稳态帧：单次调用 → native 批处理） */
    public boolean drawPictureReplay(Canvas canvas) {
        if (framePicture == null) return false;
        canvas.drawPicture(framePicture);
        return true;
    }

    /** 显示列表是否已就绪（诊断） */
    public boolean hasPicture() { return framePicture != null; }

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
        // I2-ALLOW: 文本排版宽度参数（测量子系统——平台度量文本；`maxWidth` 来自内核整数 c.w ⇒ 本身无损）
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

    /* ══════════════ ★★MA0-RT：容器级平台动画（RenderThread 零参与） ══════════════ */

    /**
     * ★★**容器级合成动画**（Morpheus §5-bis：提交一次 ⇒ RenderThread 自主插值）
     *
     * 【为什么 Android 的落点是"容器级"而不是像 iOS 那样的"逐层"】
     *   两端生产绘制形态不同（本轮实测确认）：
     *     · iOS：**CALayer 树**（每节点一层）⇒ 可对每个节点下 `CAKeyframeAnimation`；
     *     · Android：**单 ViewGroup + Canvas 指令直下发**（真拍平，**无 per-node 平台对象**）
     *       ⇒ 生产路径上没有"可动画的载体"，逐节点下动画需要引入 per-node `RenderNode`
     *         （= 改绘制架构，另案评估）。
     *   ⇒ **本端落地"整页转场"这一最主流的合成动画场景**：动**宿主 View 自己**的
     *     transform / alpha —— 这正是 §5-bis.1 说的"转场天然只需要动 transform/opacity"。
     *
     * 【为什么这样就是 RenderThread 零参与】`View.animate()`（ViewPropertyAnimator）对
     *   `translationX/Y` / `scaleX/Y` / `rotation` / `alpha` 这几个属性，Android 内部走
     *   **`RenderNodeAnimator`（渲染线程原生动画）** ⇒ 主线程只在**启动时**参与一次，
     *   之后每帧由 RenderThread 直接更新 RenderNode，**主线程不参与**（也不触发 onDraw）。
     *
     * 【与本引擎的关系】曲线由内核给（`curve_bezier_approx` → `PathInterpolator`）；
     *   本方法**只做"翻译成平台 API"**，没有任何曲线数学。
     *
     * @return 是否成功提交
     */
    public boolean animatePageComposited(
            float tx, float ty, float scale, float rotation, float alpha,
            long durMs, long delayMs, float bezierX1, float bezierY1, float bezierX2, float bezierY2) {
        android.animation.TimeInterpolator interp;
        if (bezierX1 == 0f && bezierY1 == 0f && bezierX2 == 1f && bezierY2 == 1f) {
            interp = new android.view.animation.LinearInterpolator();
        } else {
            // ★平台自带（API 21+），不需要 support library 依赖
            interp = new android.view.animation.PathInterpolator(bezierX1, bezierY1, bezierX2, bezierY2);
        }
        // ★记录起始 onDrawCount：动画期间它应当**不增长**（= 主线程没参与每帧绘制）
        pageAnimDrawBefore = onDrawCount;
        pageAnimRunning = true;
        this.animate()
                .translationX(tx)
                .translationY(ty)
                .scaleX(scale)
                .scaleY(scale)
                .rotation(rotation)
                .alpha(alpha)
                .setDuration(durMs)
                .setStartDelay(delayMs)
                .setInterpolator(interp)
                .withEndAction(new Runnable() {
                    @Override public void run() {
                        pageAnimRunning = false;
                        pageAnimDrawAfter = onDrawCount;
                    }
                })
                .start();
        return true;
    }

    /** 容器级动画读数（判据：`draw_delta` 应为 0 = 主线程未参与每帧绘制） */
    public String pageAnimStats() {
        return "{\"running\":" + (pageAnimRunning ? "true" : "false")
                + ",\"draw_before\":" + pageAnimDrawBefore
                + ",\"draw_after\":" + pageAnimDrawAfter
                + ",\"draw_delta\":" + (pageAnimDrawAfter - pageAnimDrawBefore)
                + ",\"tx\":" + getTranslationX()
                + ",\"alpha\":" + getAlpha()
                + ",\"on_draw_count\":" + onDrawCount + "}";
    }

    private boolean pageAnimRunning = false;
    private int pageAnimDrawBefore = 0;
    private int pageAnimDrawAfter = 0;

    /** 复位容器级动画（相位间清理） */
    public void resetPageAnim() {
        animate().cancel();
        setTranslationX(0f);
        setTranslationY(0f);
        setScaleX(1f);
        setScaleY(1f);
        setRotation(0f);
        setAlpha(1f);
        pageAnimRunning = false;
        pageAnimDrawBefore = onDrawCount;
        pageAnimDrawAfter = onDrawCount;
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

        /**
         * ★★**按核心决策释放**（recycle 窗口给的 `release` 行号列表）。
         *
         * 【为什么不再按 from/to 区间扫（本仓实测的设计纠正）】`releaseOutside(from,to)`
         *   要求**调用方自己算**窗口边界——而方向敏感预载（前进方向多留、离开方向少留）
         *   正是 `recycle.rs` 已经实现并有单测的逻辑。宿主再写一份 ⇒ **同一语义两份实现**，
         *   漂移是静默的（只是多建/少建几行对象，任何几何断言都发现不了）。
         *   ⇒ 现在直接把核心给的行号列表执行掉（与 iOS 的 `scrollRows` 同一条路）。
         */
        /**
         * ★★**按行子树录制**（整树级虚拟化：一行 ≠ 一个色块，而是**一棵小树**）。
         *
         * 【与 `acquireRow` 的差别】`acquireRow` 把一行压成一个「色块 + 文本」；
         *   本方法按**SFC 产出的真实节点集**录制——行内每个节点（容器/圆点/文字）
         *   各画各的矩形与文本，全部录进**同一个 `RenderNode`**（= Android 的 layer 等价物）。
         *   ⇒ 这才是"整树级虚拟化"：**层**的粒度是行，而**行内的树**被完整还原。
         *
         * 【为什么仍是"一行的所有节点进一个 RenderNode"（而不是一节点一 RenderNode）】
         *   Android 的 `RenderNode` 是**录制容器**：一个 node 内可含多条绘制命令。
         *   行内节点数在 SFC 里是编译期已知的固定值 ⇒ 一个 node 承载整行**对象数恒定**
         *   （500 行 × 3 节点 = 1500 节点，但活跃对象只有 ~24 个行 node）——
         *   与 iOS 一节点一 CALayer 的差别是**平台特性**（CALayer 不能承载多条独立绘制命令
         *   而不合层），不是语义差别。★如实记录，不在两端假装同构。
         *
         * - Parameter parts: 行内各节点**相对行原点**的矩形 + 样式（由调用方从核心几何减去行原点得到）
         */
        public void acquireRowSubtree(int row, float x, float y, float w, float h, RowPart[] parts) {
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
            android.graphics.Paint tp = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
            tp.setColor(android.graphics.Color.WHITE);
            for (RowPart p : parts) {
                if (p.color != 0) {
                    paint.setColor(p.color);
                    // ★圆角：SFC 里行容器与圆点都带 borderRadius（不还原就与 iOS 视觉不一致）
                    if (p.radius > 0) rc.drawRoundRect(p.dx, p.dy, p.dx + p.w, p.dy + p.h, p.radius, p.radius, paint);
                    else rc.drawRect(p.dx, p.dy, p.dx + p.w, p.dy + p.h, paint);
                }
                if (p.text != null && !p.text.isEmpty()) {
                    tp.setTextSize(p.fontSize > 0 ? p.fontSize : 14f);
                    if (p.textColor != 0) tp.setColor(p.textColor);
                    rc.drawText(p.text, p.dx, p.dy + p.fontSize * 0.85f, tp);
                }
            }
            node.endRecording();
            active.put(row, node);
        }

        /** 行内一个节点的绘制规格（**相对行原点**） */
        public static final class RowPart {
            public final float dx, dy, w, h;
            public final int color;        // 0 = 不画底
            public final float radius;     // 圆角（0 = 直角）
            public final String text;      // null = 非文本
            public final int textColor;    // 0 = 用默认
            public final float fontSize;
            public RowPart(float dx, float dy, float w, float h, int color, float radius,
                           String text, int textColor, float fontSize) {
                this.dx = dx; this.dy = dy; this.w = w; this.h = h;
                this.color = color; this.radius = radius;
                this.text = text; this.textColor = textColor; this.fontSize = fontSize;
            }
        }

        public int releaseRows(int[] rows) {
            int released = 0;
            for (int row : rows) {
                android.graphics.RenderNode n = active.remove(row);
                if (n != null) {
                    if (pool.size() < poolCap) pool.addLast(n);
                    released++;
                }
            }
            return released;
        }

        /** 释放窗口外的行（★保留：早期用例/对照仍用它——语义清晰，但**不再用于新路径**） */
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

        /** 当前已物化的行号（升序）——诊断："哪些行真的活着" */
        public int[] activeRows() {
            int[] a = new int[active.size()];
            int i = 0;
            for (int r : active.keySet()) a[i++] = r;
            java.util.Arrays.sort(a);
            return a;
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
