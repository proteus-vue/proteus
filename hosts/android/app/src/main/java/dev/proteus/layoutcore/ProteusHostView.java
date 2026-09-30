package dev.proteus.layoutcore;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;
import android.view.ViewGroup;

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
        Cmd(float x, float y, float w, float h, int color, String text) {
            this(x, y, w, h, color, text, 0f);
        }
        Cmd(float x, float y, float w, float h, int color, String text, float fontSize) {
            this.x = x; this.y = y; this.w = w; this.h = h; this.color = color; this.text = text;
            this.fontSize = fontSize;
        }
    }

    /* ══════════ ★native-host 节点（原生 View 嵌入，方案 L3） ══════════ */

    /** 节点 id → 原生 View */
    private final Map<Integer, View> nativeHosts = new HashMap<>();
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
    /** 节点 id → [tx, ty, scale, rotate, opacity]（**宿主侧真源**：探针从这里读） */
    private final Map<Integer, float[]> animTx = new HashMap<>();
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
                animTx.put(id, new float[]{
                        (float) u.optDouble(1), (float) u.optDouble(2), (float) u.optDouble(3), rot, op});
                n++;
            }
        } catch (Throwable ignored) {
            // JSON 坏 ⇒ 返回真实条数（不假装成功）；判据侧比对"started vs applied"时会发现
        }
        lastAnimApplied = n;
        if (n > 0) invalidate();
        return n;
    }

    /** ★**每帧二进制通道**（24B/条，全小端）——与 iOS 同一份内核、同一条性能纪律 */
    private int applyTickBin(byte[] bin) {
        if (bin == null || bin.length < ANIM_RECORD_BYTES) return 0;
        java.nio.ByteBuffer bb = java.nio.ByteBuffer.wrap(bin).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        int n = bin.length / ANIM_RECORD_BYTES;
        for (int i = 0; i < n; i++) {
            int id = bb.getInt();
            float tx = bb.getFloat(), ty = bb.getFloat(), sc = bb.getFloat();
            float rot = bb.getFloat(), op = bb.getFloat();
            animTx.put(id, new float[]{tx, ty, sc, rot, op});
        }
        lastAnimApplied = n;
        if (n > 0) invalidate();
        return n;
    }

    /** 每帧记录长度（与 Rust 侧 `proteus_layout_anim_tick_bin` 的 24B/条对齐——**只在本处定义**） */
    private static final int ANIM_RECORD_BYTES = 24;

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

    /** 共享元素（转发内核 + 应用首帧 updates） */
    public String kernelSharedElement(String json) {
        String out = RustLayout.sharedElement(coreHandle, json);
        applyAnimUpdates(out);
        return out;
    }

    /** 停动画（`{"all":true}` 或 `{"nodeIds":[…]}`）——含**清值**（与 iOS `animStopAll` 同语义） */
    public String kernelAnimStop(String json) {
        String out = RustLayout.animStop(coreHandle, json);
        animTx.clear();
        invalidate();
        return out;
    }

    /**
     * 读某节点的当前变换（探针）——从**宿主侧真源** `animTx` 读，不是读我们自己传下去的参数。
     *
     * 入参 JSON：`[id, …]`；出参：`{"ok":true,"layers":[{"id":N,"tx":…,"ty":…,"scale":…,"rotate":…,"opacity":…}, …]}`
     * （与 iOS `layerTransformProbe` **同形**——两端判据脚本可共用读法）
     */
    public String animTxProbe(String idsJson) {
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"layers\":[");
        try {
            org.json.JSONArray ids = new org.json.JSONArray(idsJson);
            for (int i = 0; i < ids.length(); i++) {
                int id = ids.optInt(i);
                float[] v = animTx.get(id);
                if (i > 0) sb.append(',');
                if (v == null) {
                    // 无记录 ⇒ 恒等（未被动过）——与"层上是 identity"语义一致
                    sb.append("{\"id\":").append(id).append(",\"tx\":0,\"ty\":0,\"scale\":1,\"rotate\":0,\"opacity\":1}");
                } else {
                    sb.append("{\"id\":").append(id)
                      .append(",\"tx\":").append(v[0]).append(",\"ty\":").append(v[1])
                      .append(",\"scale\":").append(v[2]).append(",\"rotate\":").append(v[3])
                      .append(",\"opacity\":").append(v[4]).append('}');
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
    /** 稳态窗口基线（启动后 80ms 重拍；见 `kernelTickStats` 的口径注释） */
    private int ktMeasureBefore = 0, ktLayoutBefore = 0;
    private int ktMeasureBoot = 0, ktLayoutBoot = 0;

    private final android.view.Choreographer.FrameCallback ktCallback =
            new android.view.Choreographer.FrameCallback() {
        @Override public void doFrame(long frameTimeNanos) {
            if (!ktRunning) return;
            long t0 = System.nanoTime();
            if (ktFirstFrameNs == 0) ktFirstFrameNs = t0;
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
     *   / 首帧延迟（诊断"runnable 被排队"这类装置缺陷）。
     */
    public String kernelTickStats() {
        float[] w = java.util.Arrays.copyOf(ktWorkMs, ktWorkN);
        java.util.Arrays.sort(w);
        float p50 = w.length == 0 ? -1 : w[(int) (w.length * 0.50)];
        float p95 = w.length == 0 ? -1 : w[Math.min(w.length - 1, (int) (w.length * 0.95))];
        float mx = w.length == 0 ? -1 : w[w.length - 1];
        double firstDelayMs = ktFirstFrameNs > 0 ? (ktFirstFrameNs - ktStartNs) / 1e6 : -1;
        return "{\"running\":" + ktRunning + ",\"frames\":" + ktFrames
                + ",\"work_p50_ms\":" + p50 + ",\"work_p95_ms\":" + p95 + ",\"work_max_ms\":" + mx
                + ",\"first_frame_delay_ms\":" + firstDelayMs
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
    }

    public void setCmds(List<Cmd> value) {
        this.cmds = value;
        invalidate();
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
                            return true;
                        }

                        @Override public boolean onScroll(android.view.MotionEvent e1, android.view.MotionEvent e2,
                                                         float dx, float dy) {
                            if (e1 == null || e2 == null) return false;
                            android.os.Bundle b = new android.os.Bundle();
                            b.putFloat("dx", dx);
                            b.putFloat("dy", dy);
                            report("scroll", e2, b);
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
        // ★滚动：自绘内容随 scrollY 平移，并**裁剪到滚动视口**
        //   （native-host 的裁剪在 applyScrollToNativeHosts 里单独做——
        //    它们不受这个 clipRect 约束，这是 Android 的固有行为）
        final boolean scrolled = scrollY != 0 || scrollViewport != null;
        final int save = scrolled ? canvas.save() : -1;
        if (scrolled) {
            if (scrollViewport != null) {
                canvas.clipRect(scrollViewport.left, scrollViewport.top, scrollViewport.right, scrollViewport.bottom);
            }
            canvas.translate(0, -scrollY);
        }
        // ★滚动列表模式：绘制列表内容（这是**真实帧**的来源——canvas 来自窗口）
        if (listRenderer != null) {
            listRenderer.draw(canvas);
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
    public void drawCmds(Canvas canvas) {
        // ★单次遍历下发全部指令（无 View 树、无递归 measure/layout）
        final List<Cmd> list = cmds;
        // ★字号只在**变化时**设置（同字号连排时零开销；见 Cmd.fontSize 注释）
        float lastSize = textPaint.getTextSize();
        final java.util.Set<Integer> skip = skipCmdIndices;   // ★被载体提升的指令：跳过（否则重影）
        final int[] ids = cmdNodeIds;
        for (int i = 0; i < list.size(); i++) {
            if (skip != null && skip.contains(i)) continue;
            final Cmd c = list.get(i);
            // ★★逐节点变换（内核动画的**绘制落点**）：按并行表查该指令的节点变换
            //   变换语义与 iOS `applyTransform` **同构**：平移 → 以**元素中心**为锚旋转/缩放。
            float[] tf = (ids != null && i < ids.length && ids[i] >= 0) ? animTx.get(ids[i]) : null;
            final boolean xf = tf != null && (tf[0] != 0f || tf[1] != 0f || tf[2] != 1f || tf[3] != 0f);
            final int save = xf ? canvas.save() : -1;
            float op = 1f;
            if (tf != null) op = tf[4];
            if (xf) {
                canvas.translate(tf[0], tf[1]);
                float cx = c.x + c.w * 0.5f, cy = c.y + c.h * 0.5f;
                if (tf[3] != 0f) canvas.rotate(tf[3], cx, cy);
                if (tf[2] != 1f) canvas.scale(tf[2], tf[2], cx, cy);
            }
            bgPaint.setColor(c.color);
            if (op < 1f) bgPaint.setAlpha(Math.max(0, Math.min(255, (int) (Color.alpha(c.color) * op))));
            canvas.drawRect(c.x, c.y, c.x + c.w, c.y + c.h, bgPaint);
            if (c.text != null) {
                if (c.fontSize > 0 && c.fontSize != lastSize) {
                    textPaint.setTextSize(c.fontSize);
                    lastSize = c.fontSize;
                }
                textPaint.setAlpha(op < 1f ? Math.max(0, Math.min(255, (int) (255 * op))) : 255);
                canvas.drawText(c.text, c.x + 1f, c.y + c.h * 0.8f, textPaint);
            }
            if (xf) canvas.restoreToCount(save);
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
