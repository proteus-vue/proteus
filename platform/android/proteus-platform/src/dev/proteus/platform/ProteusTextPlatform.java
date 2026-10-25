// platform/android/proteus-platform/src/dev/proteus/platform/ProteusTextPlatform.java
// ★★**Android 平台适配层：字形（HA0.5 从 `hosts/android/.../runtime/ProteusHostView.java` 抽出）**
//
// 【这一层是什么（Host ABI 方案 §0.4.8 的判断标准）】"这段代码换到同平台的另一个 App 里，需要改吗？"
//   · 字体角色映射（system/serif/monospace/… → Android Typeface）—— **不用改** ⇒ **平台适配**
//   · 自定义字体注册表（`custom:<族名>` → Typeface）—— 同平台内通用 ⇒ 同属本层
//   ⇒ 因此它属于 `platform/`；而**宿主集成**（Surface / 生命周期 / 输入 / 调度 / 能力注册 / 绘制执行）留在 `hosts/`。
//
// 【依赖方向（硬性，`scripts/check-platform-layering.mjs` 把它机器化）】
//   platform/* ──→ **禁止**引用 hosts/* 与 Host ABI（平台层不感知宿主契约）
//   本文件只依赖 `android.graphics.Typeface` ⇒ 任何 Android 宿主都能复用它。
//
// 【与 iOS 的对称】iOS 对应件 = `platform/ios/ProteusPlatform/ProteusTextAdapter.swift` 的
//   `font(size:weight:family:)` + 自定义字体注册段。两端共用同一份**角色词汇表**
//   （`system`/`serif`/`monospace`/`rounded`/`condensed` + `custom:<名>`），跨端一致由该契约保证。
//
// 【诚实边界】本文件是**机械抽取**（逐行搬移，零语义改动）——`ProteusHostView` 的同名方法改为**委托**，
//   故所有既有调用方零改动、行为不变；由 `check:android-host-compile`（真 javac）与真机渲染守住。

package dev.proteus.platform;

import android.graphics.Typeface;

import java.util.HashMap;
import java.util.Map;

/** Android 字形（字体角色映射 + 自定义字体注册）的**唯一实现**（换壳不改）。 */
public final class ProteusTextPlatform {

    private ProteusTextPlatform() {}

    /** 与适配器 `CUSTOM_FONT_PREFIX` **同一常量**（两端契约；不一致则自定义族永远命中不了） */
    public static final String CUSTOM_FONT_PREFIX = "custom:";
    /** ★★★font-style 项（2026-10-18）：斜体/倾斜的角色串前缀（与适配器同契约；宿主只存一个角色串） */
    public static final String ITALIC_PREFIX = "italic:";
    public static final String OBLIQUE_PREFIX = "oblique:";
    /**
     * ★★★font-variant-numeric 项（2026-10-18 · 批 B F3）：**等宽数字**前缀（`tnum:`）。
     *
     * <p>【为什么用前缀而不是新字段】宿主的"逐节点字体"表**只存一个字符串**（该文件已顶行数上限），
     *   而 tnum 与 italic 同属**字形选择**（同一支字体 + 不同 OpenType 特性）⇒ 复合同一条通道
     *   ⇒ 绘制与度量天然同源（本仓为 font-style 建立的同一机制）。</p>
     */
    public static final String TABULAR_PREFIX = "tnum:";

    /** 族名 → 字体（注册表） */
    private static final Map<String, Typeface> customFonts = new HashMap<>();

    /** 未注册的自定义族名命中次数（诊断：>0 ⇒ 宿主缺字体资源，**不是**静默回退） */
    public static int customFontMisses = 0;
    /** 最近一个未注册的族名（诊断用：报告里可读出到底缺哪个字体） */
    public static String lastMissingCustomFont = null;

    /**
     * 角色 + 字重 → Android `Typeface`（**度量与绘制共用同一支** —— 防"度量用 A、绘制用 B"分叉）。
     *
     * | 角色 | 映射 |
     * |---|---|
     * | `system` | `sans-serif` |
     * | `serif` | `serif` |
     * | `monospace` | `monospace` |
     * | `rounded` | `sans-serif-rounded`（API 21+ 有该族；缺则回退 DEFAULT 并计数） |
     * | `condensed` | `sans-serif-condensed`（同上） |
     *
     * ★★**为什么这是"映射"而不是"自己发明一套"**：角色字符串由**适配器**产出（`normalizeFontFamily`
     *   已把 CSS 候选清单归一到 5 个角色）。平台侧只做「角色 → 本平台字体」——这是唯一平台相关的部分。
     *   iOS 侧已按同一契约实现（`ProteusTextAdapter.font`）。**两端共用一份词汇表**，未知角色显式回退 + 计数。
     *   ★诚实边界：Android 的族名是**系统族（family）**，与 iOS 的 `SystemDesign`/具体字体名**不是同一批字体**
     *     ⇒ 两端"衬线体"长得不完全一样（平台字体库的固有差异，能力对齐 ≠ 像素一致）。
     */
    public static Typeface typefaceOf(String role, int weight, int[] fallbackCounter) {
        // ★★★font-style 项（2026-10-18 · 批 B F3）：角色串可带 `italic:` 前缀（宿主的节点字体角色表只存一个字符串）
        if (role != null) {
            if (role.startsWith(ITALIC_PREFIX)) return typefaceOf(role.substring(ITALIC_PREFIX.length()), weight, true, fallbackCounter);
            if (role.startsWith(OBLIQUE_PREFIX)) return typefaceOf(role.substring(OBLIQUE_PREFIX.length()), weight, true, fallbackCounter);
            // ★font-variant-numeric：`tnum:` 前缀 = 等宽数字标记（字形本身不在这层换，见 tabularOfRole）
            if (role.startsWith(TABULAR_PREFIX)) return typefaceOf(role.substring(TABULAR_PREFIX.length()), weight, false, fallbackCounter);
        }
        return typefaceOf(role, weight, false, fallbackCounter);
    }

    /**
     * ★★★font-style 项（2026-10-18 · 批 B F3）：**带斜体的字形解析**（原签名委托到本方法，行为不变）。
     *
     * <p>【为什么斜体必须进这一层】斜体不是"画的时候把画布歪一下"——它是**另一套字形**
     * （字宽/字高/字重都不同）⇒ 度量与绘制必须用同一支字体（本仓已因"度量一支、绘制另一支"
     * 踩过"字被裁而报告全绿"）。唯一实现放在本层 ⇒ 三处调用点（度量/绘制/预测量）天然同源。</p>
     *
     * <p>【Android 的表达方式】`Typeface.create(base, style)` 的 style 是位掩码：
     * `BOLD` / `ITALIC` / `BOLD_ITALIC` ⇒ 斜体与字重可组合。</p>
     */
    public static Typeface typefaceOf(String role, int weight, boolean italic, int[] fallbackCounter) {
        boolean bold = weight >= 600;
        int style = (bold ? Typeface.BOLD : Typeface.NORMAL) | (italic ? Typeface.ITALIC : Typeface.NORMAL);
        // ★★自定义字体（`custom:<族名>`）——**先查注册表**
        //   契约见适配器 `CUSTOM_FONT_PREFIX`。未注册 ⇒ **回退 system + 计数**（不静默：
        //   "未识别"与"识别为默认"必须可区分）。
        if (role != null && role.startsWith(CUSTOM_FONT_PREFIX)) {
            String name = role.substring(CUSTOM_FONT_PREFIX.length());
            Typeface tf = customFonts.get(name);
            if (tf != null) {
                // 自定义字体族可能自带斜体（家族文件）；`create(base, style)` 让系统按 style 取变体，
                // 取不到时平台回退同族的常规面（可接受：显式族优先于形态）。
                return style == Typeface.NORMAL ? tf : Typeface.create(tf, style);
            }
            customFontMisses++;
            lastMissingCustomFont = name;
            return Typeface.create("sans-serif", style);
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
        return Typeface.create(fam, style);
    }

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
            Typeface tf = Typeface.createFromFile(filePath);
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

    /* ══════════ 文本度量（Vapor 通路；HA0.5 从 VaporRenderHost 抽出）══════════
     * ★对称 iOS `ProteusTextAdapter.measureText` / `measureTextWrapped`。
     *   【与宿主的分工】平台层**只度量**（给定文本+字体参数 → {w,h}）；**绘制执行**仍在宿主
     *   （Android View 的 Canvas / iOS CATextLayer——两端同构，绘制都不在平台层）。
     *   【度量与绘制同源纪律】度量与绘制共用 `typefaceOf`（同一支字体），否则"度量用 A、绘制用 B"会分叉。 */

    /** 行高 token → 行盒高 px（0 = 未声明；无单位倍数×fontSize / 绝对 px）。与 iOS `lineHeightPx` 同义。 */
    public static float lineHeightPx(String token, float fontSizePx) {
        if (token == null || token.isEmpty()) return 0f;
        try {
            if (token.endsWith("px")) return Float.parseFloat(token.substring(0, token.length() - 2));
            return Float.parseFloat(token) * fontSizePx;   // 无单位倍数
        } catch (NumberFormatException e) {
            return 0f;
        }
    }

    /**
     * ★★★word-break 项：`break-all` 的 Android 实现——**零宽空格（U+200B）注入**。
     *   【为什么不能用原生 API】Android `Layout` 只有 `BREAK_STRATEGY_*`（断行**质量**策略），
     *   **没有**"任意字符处可断"的原生开关 ⇒ `break-all` 无原生对应。
     *   【做法】每个字符后插 U+200B（ZWSP）：StaticLayout 视其为合法断点、且**不占宽度**。
     *   ★度量（本类 measureWrapped）与绘制（宿主 mkCmd）**同源**——都调本方法。
     */
    public static String applyWordBreak(String t, String wb) {
        if (t == null || t.isEmpty() || !"break-all".equals(wb)) return t;
        StringBuilder sb = new StringBuilder(t.length() * 2);
        for (int i = 0; i < t.length(); i++) {
            sb.append(t.charAt(i)).append('\u200B');
        }
        return sb.toString();
    }

    /** ★★★word-break 项：**无断点长串**判据——不含空白且不含 CJK。`normal` 下 Web 上"整串溢出、不折行"；
     *   安卓 StaticLayout 会硬折 ⇒ 须显式判为「单行溢出」（见 measureWrapped / 宿主 mkCmd）。 */
    public static boolean isUnbreakableToken(String t) {
        for (int i = 0; i < t.length(); i++) {
            char c = t.charAt(i);
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') return false;
            Character.UnicodeBlock b = Character.UnicodeBlock.of(c);
            if (b == Character.UnicodeBlock.CJK_UNIFIED_IDEOGRAPHS
                    || b == Character.UnicodeBlock.CJK_UNIFIED_IDEOGRAPHS_EXTENSION_A
                    || b == Character.UnicodeBlock.CJK_SYMBOLS_AND_PUNCTUATION
                    || b == Character.UnicodeBlock.HIRAGANA
                    || b == Character.UnicodeBlock.KATAKANA
                    || b == Character.UnicodeBlock.HANGUL_SYLLABLES) return false;
        }
        return true;
    }

    /** 配一支与绘制同源的度量用 `TextPaint`（字号/字重/字体角色/字距）。 */
    public static android.text.TextPaint paintFor(float sizePx, int weight, String familyRole, float letterSpacingPx) {
        return paintFor(sizePx, weight, familyRole, letterSpacingPx, false);
    }

    /** ★★★font-style 项（2026-10-18 · 批 B F3）：带斜体的 paint 构造（度量与绘制同源——同一支字体）。 */
    public static android.text.TextPaint paintFor(float sizePx, int weight, String familyRole, float letterSpacingPx, boolean italic) {
        return paintFor(sizePx, weight, familyRole, letterSpacingPx, italic, tabularOfRole(familyRole));
    }

    /**
     * ★★★font-variant-numeric 项（2026-10-18 · 批 B F3）：角色串是否带 `tnum:` 前缀（**唯一判据**）。
     *   绘制（宿主 `configureText`/mkText）与度量（本类 `paintFor`）共用本判据 ⇒ 两侧同源。
     */
    public static boolean tabularOfRole(String familyRole) {
        return familyRole != null && familyRole.startsWith(TABULAR_PREFIX);
    }

    /**
     * ★★★批 B F3 收尾三项（2026-10-25 · 基准 = Web）：`word-spacing` 的**版本门**。
     *   `Paint.setWordSpacing` 是 **API 29** 才有的（本仓 minSdk = 24）。
     *   ⇒ 低版本**如实不生效**并只告警一次（logcat），不静默近似（不用 ScaleXSpan 假装）。
     *   ★为什么不用 ScaleXSpan 近似：它横向缩放**整段字形**（字形被压扁），与词间距语义不同。
     */
    public static final int WORD_SPACING_MIN_API = 29;
    private static boolean wordSpacingWarned = false;
    /** 是否支持 word-spacing（探针可读；低版本 = false 且已告警） */
    /** ★批 B F3 收尾：把词距应用到 paint（版本门在此——API 29 以下如实跳过并告警一次）。 */
    public static void applyWordSpacing(android.text.TextPaint tp, float px) {
        if (px != 0f && supportsWordSpacing()) tp.setWordSpacing(px);
    }

    public static boolean supportsWordSpacing() {
        if (android.os.Build.VERSION.SDK_INT >= WORD_SPACING_MIN_API) return true;
        if (!wordSpacingWarned) {
            wordSpacingWarned = true;
            android.util.Log.w("ProteusText", "word-spacing 需要 API " + WORD_SPACING_MIN_API +
                    "（本机 " + android.os.Build.VERSION.SDK_INT + "）⇒ 本机该属性不生效（如实降级，不做字形缩放近似）");
        }
        return false;
    }

    /**
     * ★★★font-variant-numeric 项（2026-10-18 · 批 B F3）：**等宽数字**（`tabular-nums` → OpenType `tnum`）。
     *
     * <p>【为什么必须在本层】tnum 选的是**另一套数字字形**（字宽不同）⇒ 度量与绘制必须同源
     * （本仓已因"度量一支、绘制另一支"踩过"字被裁而报告全绿"）。唯一实现放这里 ⇒ 三处调用点天然同源。</p>
     *
     * <p>【Android 的表达方式】`Paint.setFontFeatureSettings("\"tnum\" 1")`（API 21+）。
     * ★诚实边界：能否生效取决于**字体是否带 tnum 特性**——Web 实测（Chromium）Helvetica Neue 上
     * tnum 使数字宽 +55%，而 SF Pro / Georgia 本身已等宽（差异 0）；不带该特性的字族静默无效
     * = 与 Web 一致（浏览器同样不报错）。</p>
     */
    public static android.text.TextPaint paintFor(float sizePx, int weight, String familyRole, float letterSpacingPx,
                                                  boolean italic, boolean tabular) {
        android.text.TextPaint tp = new android.text.TextPaint();
        tp.setTextSize(sizePx);
        tp.setTypeface(typefaceOf(familyRole, weight, italic, null));
        if (letterSpacingPx != 0f && sizePx > 0f) tp.setLetterSpacing(letterSpacingPx / sizePx);
        if (tabular) tp.setFontFeatureSettings("\"tnum\" 1");
        return tp;
    }

    /**
     * ★★★批 B F3 收尾三项（2026-10-25）：带**词间距**的 paint（单位 = 物理 px，与 CSS 一致）。
     *   ★与字距不同：`setLetterSpacing` 的单位是 **em**（要除以字号），`setWordSpacing` 的单位是 **px**。
     */
    public static android.text.TextPaint paintForWithWordSpacing(float sizePx, int weight, String familyRole,
                                                                float letterSpacingPx, boolean italic, boolean tabular,
                                                                float wordSpacingPx) {
        android.text.TextPaint tp = paintFor(sizePx, weight, familyRole, letterSpacingPx, italic, tabular);
        if (wordSpacingPx != 0f && supportsWordSpacing()) tp.setWordSpacing(wordSpacingPx);
        return tp;
    }

    /** 单行度量：`{width, glyphHeight, baseline}`（**未取整**；glyphHeight = descent−ascent；baseline = −ascent）。
     *  调用方按测量子系统口径取整（`Math.ceil`）。
     *  ★B-T1（2026-10-10）：第 3 项 **baseline**（盒内容顶 → 基线）供内核 `align-items: baseline` 对文本对齐；
     *    既有调用方只取 [0]/[1] ⇒ 零影响。 */
    public static float[] measureSingle(float sizePx, int weight, String familyRole, float letterSpacingPx, String text) {
        return measureSingle(sizePx, weight, familyRole, letterSpacingPx, text, false);
    }

    /** ★★★font-style 项（2026-10-18）：带斜体的单行度量（与绘制同源——同一支字体，否则度量偏窄会被裁）。 */
    public static float[] measureSingle(float sizePx, int weight, String familyRole, float letterSpacingPx, String text, boolean italic) {
        return measureSingle(sizePx, weight, familyRole, letterSpacingPx, text, italic, false);
    }

    /** ★★★font-variant-numeric 项（2026-10-18）：带等宽数字的单行度量（与绘制同源）。 */
    public static float[] measureSingle(float sizePx, int weight, String familyRole, float letterSpacingPx, String text,
                                        boolean italic, boolean tabular) {
        android.text.TextPaint tp = paintFor(sizePx, weight, familyRole, letterSpacingPx, italic, tabular);
        float w = tp.measureText(text);
        android.graphics.Paint.FontMetrics fm = tp.getFontMetrics();
        return new float[]{ w, fm.descent - fm.ascent, -fm.ascent };
    }

    /** ★B-T1：文本基线（盒内容顶 → 基线；Android = −ascent）。与 `measureSingle` 同源（同一 paintFor）。 */
    public static float baseline(float sizePx, int weight, String familyRole, float letterSpacingPx) {
        return baseline(sizePx, weight, familyRole, letterSpacingPx, false);
    }

    /** ★★★font-style 项（2026-10-18）：带斜体的基线（与绘制同源）。 */
    public static float baseline(float sizePx, int weight, String familyRole, float letterSpacingPx, boolean italic) {
        return baseline(sizePx, weight, familyRole, letterSpacingPx, italic, false);
    }

    /** ★★★font-variant-numeric 项（2026-10-18）：带等宽数字的基线（与绘制同源）。 */
    public static float baseline(float sizePx, int weight, String familyRole, float letterSpacingPx, boolean italic, boolean tabular) {
        android.text.TextPaint tp = paintFor(sizePx, weight, familyRole, letterSpacingPx, italic, tabular);
        return -tp.getFontMetrics().ascent;
    }

    /**
     * 折行度量：`{width, height}`；**null = 单行且无 clamp**（与首遍等价，调用方可跳过——零操作）。
     *   与 iOS `measureTextWrapped` 同语义：折行高度 = 行数 × 行盒高（声明行高时）/ StaticLayout 自然高；
     *   `lineClamp` 封顶（min(自然行数, clamp)）；`wordBreak=break-all` ⇒ ZWSP 注入断行；
     *   无断点长串（normal）溢出盒宽 ⇒ 单行溢出（返回 null，不增长）。
     */
    public static float[] measureWrapped(String text, float sizePx, int weight, String familyRole,
                                         float letterSpacingPx, String wordBreak, int lineClamp,
                                         float boxW, float lineHeightPx) {
        return measureWrapped(text, sizePx, weight, familyRole, letterSpacingPx, wordBreak, lineClamp, boxW, lineHeightPx, false);
    }

    /** ★★★font-style 项（2026-10-18）：带斜体的折行度量（与绘制同源）。 */
    public static float[] measureWrapped(String text, float sizePx, int weight, String familyRole,
                                         float letterSpacingPx, String wordBreak, int lineClamp,
                                         float boxW, float lineHeightPx, boolean italic) {
        return measureWrapped(text, sizePx, weight, familyRole, letterSpacingPx, wordBreak, lineClamp, boxW, lineHeightPx, italic, false);
    }

    /** ★★★font-variant-numeric 项（2026-10-18）：带等宽数字的折行度量（与绘制同源）。 */
    public static float[] measureWrapped(String text, float sizePx, int weight, String familyRole,
                                         float letterSpacingPx, String wordBreak, int lineClamp,
                                         float boxW, float lineHeightPx, boolean italic, boolean tabular) {
        return measureWrapped(text, sizePx, weight, familyRole, letterSpacingPx, wordBreak, lineClamp,
                boxW, lineHeightPx, italic, tabular, 0f, null, 0f);
    }

    /**
     * ★★★批 B F3 收尾三项（2026-10-25 · 基准 = Web）：带 **词间距 / 断词溢出 / 首行缩进** 的折行度量。
     * · wordSpacingPx：词间距（物理 px；影响行宽 ⇒ 影响折行点，必须进度量）
     * · overflowWrap：`break-word` / `anywhere` ⇒ **允许**长词按盒宽折断；`normal`（缺省）⇒ 维持
     *   「无断点长串溢出盒宽 ⇒ 单行溢出」的既有判据（= Web normal 的长词整体溢出）。
     * · textIndentPx：首行缩进（首行可用宽 = 盒宽 − 缩进；Web 真值：缩进占首行、后续行不占）。
     * ★度量与绘制同源：宿主 mkCmd / applyWrapRemeasure 与本方法共用同一判据。
     */
    public static float[] measureWrapped(String text, float sizePx, int weight, String familyRole,
                                         float letterSpacingPx, String wordBreak, int lineClamp,
                                         float boxW, float lineHeightPx, boolean italic, boolean tabular,
                                         float wordSpacingPx, String overflowWrap, float textIndentPx) {
        String mt = applyWordBreak(text, wordBreak);
        android.text.TextPaint tp = paintForWithWordSpacing(sizePx, weight, familyRole, letterSpacingPx, italic, tabular, wordSpacingPx);
        // ★无断点长串 + 溢出盒宽（normal 且未声明 overflow-wrap 的折断值）⇒ 单行溢出（与宿主 mkCmd 同步）
        final boolean allowBreakLongWord = "break-word".equals(overflowWrap) || "anywhere".equals(overflowWrap);
        if (!allowBreakLongWord && !"break-all".equals(wordBreak) && isUnbreakableToken(text) && tp.measureText(text) > boxW + 0.5f) {
            return null;
        }
        // ★★★批 B F3 收尾（2026-10-25）：首行缩进 = `LeadingMarginSpan.Standard`（StaticLayout 原生消费——
        //   首行按 first 缩进、其余行按 rest；本仓只有"首行缩进"语义 ⇒ rest = 0）。
        java.lang.CharSequence measured = mt;
        if (textIndentPx != 0f && mt.length() > 0) {
            android.text.SpannableString ss = new android.text.SpannableString(mt);
            ss.setSpan(new android.text.style.LeadingMarginSpan.Standard(Math.round(textIndentPx), 0),
                    0, mt.length(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            measured = ss;
        }
        android.text.StaticLayout.Builder slb = android.text.StaticLayout.Builder
                // I2-ALLOW: 文本**测量**宽（StaticLayout 需整型像素宽；测量回执走 remeasure 通道，非绘制几何发射）
                .obtain(measured, 0, measured.length(), tp, Math.max(1, (int) Math.ceil(boxW)))
                .setIncludePad(false);
        if (lineClamp > 0) {
            slb.setEllipsize(android.text.TextUtils.TruncateAt.END);
            slb.setMaxLines(lineClamp);
        }
        android.text.StaticLayout sl = slb.build();
        int lines = sl.getLineCount();
        if (lines <= 1 && lineClamp <= 0) return null;   // 单行（无 clamp）⇒ 与首遍等价
        float h = lineHeightPx > 0f ? lines * lineHeightPx : sl.getHeight();
        float w = 0f;
        for (int i = 0; i < lines; i++) w = Math.max(w, sl.getLineWidth(i));
        // I2-ALLOW: 测量结果报文取整（width/height 为机器判据可读字段——与"几何发射"无关）
        return new float[]{ (float) Math.ceil(Math.min(boxW, w + 0.5f)), (float) Math.ceil(h) };
    }
}
