package dev.proteus.layoutcore;

import android.graphics.Paint;
import android.os.SystemClock;
import android.view.Choreographer;
import android.view.ViewGroup;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * ★★★Morpheus 炫技场 · **第二个节目（灯光秀）的 Android 宿主**（2026-10-01）。
 *
 * 【它是什么】把「节目单（`hosts/shared/bridge/showcase-lights.ts`，800 灯颜色编舞）」
 *   在 Android 上驱动起来的宿主：JS 侧只交指令（每幕一批 `animStart`），
 *   本类**拥有帧循环**（Choreographer = Android 的 CADisplayLink）并逐帧推进内核动画。
 *
 * 【与 iOS 的对应（同一套分工，不自行发明）】
 *   · iOS：`showcase-scene.swift`（CADisplayLink + ReplayKit + 报告）；
 *   · 本类：Choreographer 帧循环 + `adb screencap` 截图 + `lights.json` 报告。
 *   幕边界判据两端一致：**内核报 active=0**（弹簧时长由物理决定，按名义时间切幕会早切/多等）。
 *
 * 【★为什么帧驱动唯一来源是宿主（本仓血泪教训）】iOS 侧曾因 JS 也启动一条帧驱动 ⇒
 *   两条驱动各推进一个 dt ⇒ 动画以 2× 实速播放（真机录屏取证）。⇒ 本类**是唯一驱动**，
 *   JS 侧（entry-lights.ts）不注册任何帧回调。勿再加第二条（判据查 anim_end_ms）。
 *
 * 【★诚实边界】本类不做颜色求值、不做几何——颜色/曲线全部在内核（`anim.rs`），
 *   几何全部由内核算（本类只把 rects 变成绘制指令）。它做的是"驱动 + 计量 + 取证"。
 *
 * 【JNI 注入】方法名/签名与 `hosts/android/js-engine/quickjs_jni.c` 的条件注入表一一对应：
 *   `mount(String)->String`（必需）· `animStart/animTick/animStop(String)->String` ·
 *   `animActive()->String` · `rects()->String` · `nowUs()->String` · `report(String)->void` ·
 *   `post(String)->void`（JS 上报计数）。
 */
final class LightsHost {

    private final android.content.Context ctx;
    private final ViewGroup root;
    private final float density;

    private ProteusHostView view;
    private long handle = 0L;

    /** 树种 spec（顺序 = 绘制顺序）与 id → 下标 */
    private final List<JSONObject> specs = new ArrayList<>();
    private final Map<Integer, Integer> indexById = new HashMap<>();

    /* ────────────────────────── 读数（报告用） ────────────────────────── */

    int mountCalls = 0;
    int postCount = 0;
    String lastError = null;

    /** 全场帧数（Choreographer） */
    private int totalFrames = 0;
    /** 逐帧工作耗时（ms）——全场 */
    private final List<Double> allWork = new ArrayList<>();
    /** vsync 间隔（ms，frameTimeNanos 差分）——全场 */
    private final List<Double> allVsync = new ArrayList<>();

    /* ────────────────────────── 当前幕状态 ────────────────────────── */

    /** 当前幕（来自 JS `__proteusLightsNext()` 的回执） */
    private JSONObject act = null;
    private double actElapsed = 0;
    private int actFrames = 0;
    private double actAnimEndMs = -1;
    private final List<Double> actWork = new ArrayList<>();
    private final List<Double> actVsync = new ArrayList<>();
    private boolean forced = false;

    /** 逐幕读数（进报告） */
    private final List<JSONObject> actsPerf = new ArrayList<>();
    /** 幕名清单（JS plan 的抄本——判据比对"演出的"与"计划的"） */
    private JSONArray plan = new JSONArray();

    private boolean running = false;
    private boolean finished = false;
    private long lastFrameNs = 0;
    /**
     * ★★**循环演出**（独立 APK 演示模式，2026-10-01）：true ⇒ 演完不 finalize，
     *   调 `__proteusLightsRestart` 重建节目单并从头再演（"点开就一直演"）。
     *   判据模式（广播触发）保持 false ⇒ 演完出报告。
     */
    private boolean loopMode = false;

    void setLoopMode(boolean v) { loopMode = v; }

    /**
     * ★★**中途颜色采样**（2026-10-01 用户语义修正后加）：终帧是"熄灯"（全暗盘）⇒
     *   终帧的色数不能代表"颜色在流动"。在 rainbow 幕结束时采一次（色带最盛），
     *   报告里 `mid_colors`/`mid_painted` 就是它——判据用它判"颜色真的在屏上"。
     */
    private int midPainted = -1;
    private int midColors = -1;

    LightsHost(android.content.Context ctx, ViewGroup root, float density) {
        this.ctx = ctx;
        this.root = root;
        this.density = density > 0 ? density : 1f;
    }

    ProteusHostView hostView() { return view; }

    /** MainActivity 在 `__proteusLightsRun` 之后把 plan 转交进来（报告里"计划 vs 实际"对账用） */
    void notePlan(String planJson) {
        try {
            plan = new JSONArray(planJson);
        } catch (Throwable ignored) { /* 坏 plan 不进报告——判据会按缺失判红，如实暴露 */ }
    }

    /** 供 JS 侧 `nowUs()` 计时之用（单调时钟；`System.nanoTime` 微秒） */
    public String nowUs() {
        return String.valueOf(System.nanoTime() / 1000);
    }

    /** JS 侧上报（计数；不作为消费证据——与 JsRenderHost.post 同口径） */
    @SuppressWarnings("unused")
    public void post(String json) {
        postCount++;
    }

    /* ══════════════════ 宿主入口（JS ↔ 本类 的跨边界） ══════════════════ */

    /**
     * 建树：`{viewport:{width,height}, nodes:[spec]}`——spec 由 JS 产出（**不含几何**）。
     * 本类：度量文本 → 内核建树 → rects → 绘制指令。
     */
    public String mount(String treeJson) {
        mountCalls++;
        JSONObject out = new JSONObject();
        try {
            JSONObject tree = new JSONObject(treeJson);
            JSONArray nodes = tree.optJSONArray("nodes");
            if (nodes == null || nodes.length() == 0) return err(out, "批次里没有节点").toString();
            JSONObject vp = tree.optJSONObject("viewport");
            float vw = vp != null ? (float) vp.optDouble("width", 1080) : 1080f;
            float vh = vp != null ? (float) vp.optDouble("height", 2400) : 2400f;

            specs.clear();
            indexById.clear();
            int textCount = 0;
            for (int i = 0; i < nodes.length(); i++) {
                JSONObject n = nodes.getJSONObject(i);
                specs.add(n);
                indexById.put(n.getInt("id"), i);
                String t = n.optString("text", null);
                if (t != null && !t.isEmpty()) textCount++;
            }

            // ① 文本度量（标题节点）——随建树请求一起给核心（顺序不可反：核心的度量器是快照）
            JSONObject measures = buildMeasures();

            // ② 建树请求：布局键 + **颜色键**（backgroundColor/color 是内核动画的基色——必须进核心）
            JSONObject request = new JSONObject();
            JSONObject viewport = new JSONObject();
            viewport.put("width", vw);
            viewport.put("height", vh);
            request.put("viewport", viewport);
            request.put("nodes", coreNodes());
            request.put("textMeasures", measures);
            handle = RustLayout.create(request.toString());
            if (handle <= 0) return err(out, "核心建树失败（handle=0）").toString();

            // ③ 几何 → 绘制指令
            int cmds = emitCmds();

            out.put("ok", true);
            out.put("nodes", specs.size());
            out.put("text_nodes", textCount);
            out.put("cmds", cmds);
            out.put("viewport", vw + "x" + vh);
            return out.toString();
        } catch (Throwable t) {
            return err(out, t.getClass().getSimpleName() + ": " + t.getMessage()).toString();
        }
    }

    /** 动画起幕（透传内核 + 返回内核回执；首帧值由下一次 tick 落地——与 iOS 同语义） */
    public String animStart(String json) {
        if (handle == 0L) return "{\"ok\":false,\"error\":\"未接入核心\"}";
        return RustLayout.animStart(handle, json);
    }

    /** 停动画（含清值——见 ProteusHostView.kernelAnimStop 注释） */
    public String animStop(String json) {
        if (view == null) return "{\"ok\":false,\"error\":\"未接入视图\"}";
        return view.kernelAnimStop(json == null ? "{\"all\":true}" : json);
    }

    /** 仍在推进的动画条数（0 = 全结束）——幕切换的权威判据 */
    public String animActive() {
        if (handle == 0L) return "{\"ok\":false,\"error\":\"未接入核心\"}";
        return RustLayout.animActive(handle);
    }

    /**
     * 手动推进一帧（`dtMs` 以字符串过桥——JNI 统一按字符串转）。
     * ★帧循环**不经这里**（宿主直接调 `view.kernelAnimTick`，省一次 JS 往返）；
     *   本入口给 JS 侧做确定性步进/探针用（与 iOS `animTick` 对称）。
     */
    public String animTick(String dtMs) {
        if (view == null) return "{\"ok\":false,\"error\":\"未接入视图\"}";
        double dt;
        try {
            dt = Double.parseDouble(dtMs);
        } catch (NumberFormatException e) {
            return "{\"ok\":false,\"error\":\"dtMs 非法：" + dtMs + "\"}";
        }
        int applied = view.kernelAnimTick((float) dt);
        return "{\"ok\":true,\"applied\":" + applied + ",\"active\":" + activeCount() + "}";
    }

    /** 内核几何（编排的"当前中心"来源；节目单的 centers() 用它） */
    public String rects() {
        if (handle == 0L) return "{\"ok\":false,\"error\":\"未接入核心\"}";
        return RustLayout.readRects(handle);
    }

    /** 探针（判据"真读宿主真源"）：`[id,…]` → 变换 + 底色 + 文字色（ProteusHostView.animTxProbe） */
    public String probe(String idsJson) {
        if (view == null) return "{\"ok\":false,\"error\":\"未接入视图\"}";
        return view.animTxProbe(idsJson);
    }

    /** 报告落盘（`lights.json`）——由 JS `__proteusLightsFinalize` 调 */
    public void report(String json) {
        writeReport("lights.json", json);
    }

    private void writeReport(String name, String content) {
        try {
            java.io.File f = new java.io.File(reportDir(), name);
            java.io.FileOutputStream fos = new java.io.FileOutputStream(f);
            fos.write(content.getBytes("UTF-8"));
            fos.close();
            android.util.Log.i("proteus", "报告已写入 " + f.getAbsolutePath());
        } catch (Exception e) {
            android.util.Log.e("proteus", "写报告失败 " + name, e);
        }
    }

    private java.io.File reportDir() {
        java.io.File d = ctx.getExternalFilesDir(null);
        return d != null ? d : ctx.getFilesDir();
    }

    /* ══════════════════ 帧循环（本类 = 唯一驱动）══════════════════ */

    /** 开演：预取第一幕 + 启动 Choreographer（主线程调用） */
    boolean startShow() {
        if (running) return true;
        running = true;
        finished = false;
        lastFrameNs = 0;
        Choreographer.getInstance().postFrameCallback(frameCb);
        return true;
    }

    private final Choreographer.FrameCallback frameCb = new Choreographer.FrameCallback() {
        @Override
        public void doFrame(long frameTimeNanos) {
            if (!running) return;
            double dtMs = lastFrameNs == 0 ? 0 : (frameTimeNanos - lastFrameNs) / 1e6;
            lastFrameNs = frameTimeNanos;
            totalFrames++;
            if (actFrames > 0) actVsync.add(dtMs);
            allVsync.add(dtMs);

            // ① 没有在演的幕 ⇒ 取下一幕（JS 发令；JS 内部会调 proteusHost.animStart）
            if (act == null && !finished) {
                String nextOut;
                try {
                    QuickJsEngine.EvalResult r = QuickJsEngine.eval("__proteusLightsNext()");
                    if (!r.ok) {
                        failShow("取幕失败：" + r.error);
                        return;
                    }
                    nextOut = r.value;
                } catch (Throwable t) {
                    failShow("取幕异常：" + t);
                    return;
                }
                if (nextOut == null) {
                    failShow("取幕回执为空");
                    return;
                }
                try {
                    JSONObject o = new JSONObject(nextOut);
                    if (o.optBoolean("done")) {
                        // ★循环模式（独立 APK）：重建节目单从头再演（"点开就一直演"）；
                        //   判据模式：finalize 出报告。
                        if (loopMode) {
                            QuickJsEngine.EvalResult rst = QuickJsEngine.eval("__proteusLightsRestart()");
                            if (!rst.ok) {
                                failShow("重播失败：" + rst.error);
                                return;
                            }
                            finishActTotals();
                            Choreographer.getInstance().postFrameCallback(this);
                            return;
                        }
                        finishShow();
                        return;
                    }
                    if (!o.optBoolean("ok")) {
                        failShow("取幕回执非 ok：" + o.optString("error", nextOut.substring(0, Math.min(160, nextOut.length()))));
                        return;
                    }
                    act = o;
                    actElapsed = 0;
                    actFrames = 0;
                    actAnimEndMs = -1;
                    forced = false;
                    actWork.clear();
                    actVsync.clear();
                } catch (Throwable t) {
                    failShow("取幕回执解析失败：" + nextOut.substring(0, Math.min(160, nextOut.length())));
                    return;
                }
            }

            // ② 逐帧推进（计时只包"内核 tick + 写层"这一段——与 iOS 同口径）
            long t0 = System.nanoTime();
            if (view != null) view.kernelAnimTick((float) dtMs);
            double work = (System.nanoTime() - t0) / 1e6;
            actWork.add(work);
            allWork.add(work);

            actElapsed += dtMs;
            actFrames++;

            // ②b ★中途颜色采样（rainbow 幕**进行中** 45% 处——色带最盛；
            //   若放在幕尾，色带已回归基线色 ⇒ 色数偏低，证据变弱）
            if (act != null && midColors < 0 && "rainbow".equals(act.optString("name"))) {
                double span = act.optDouble("spanMs", 0);
                if (span > 0 && actElapsed >= span * 0.45) {
                    int[] s2 = samplePaintedOnly();
                    midPainted = s2[0];
                    midColors = s2[1];
                }
            }

            // ③ 幕边界：内核报 active=0（首次）→ 再等 holdMs 定型 ⇒ 切幕
            int active = activeCount();
            if (actAnimEndMs < 0 && active == 0 && actFrames > 1) actAnimEndMs = actElapsed;
            boolean natural = actAnimEndMs >= 0 && actElapsed >= actAnimEndMs + act.optDouble("holdMs", 0);
            boolean cap = actElapsed > act.optDouble("spanMs", 0) + act.optDouble("holdMs", 0) + 3000;
            if (natural || cap) {
                if (cap && !natural) forced = true;
                recordAct(active);
                act = null;
            }

            Choreographer.getInstance().postFrameCallback(this);
        }
    };

    private int activeCount() {
        if (handle == 0L) return -1;
        try {
            String a = RustLayout.animActive(handle);
            JSONObject o = new JSONObject(a);
            return o.optInt("active", -1);
        } catch (Throwable t) {
            return -1;
        }
    }

    /** 本幕读数入册（时长/帧数/工作时长分布/vsync/动画结束时刻） */
    private void recordAct(int activeAtCut) {        try {
            JSONObject r = new JSONObject();
            r.put("name", act.optString("name", "?"));
            r.put("anims", act.optInt("anims", 0));
            r.put("color_anims", act.optInt("color_anims", 0));
            r.put("span_ms", act.optDouble("spanMs", 0));
            r.put("hold_ms", act.optDouble("holdMs", 0));
            r.put("frames", actFrames);
            r.put("elapsed_ms", round1(actElapsed));
            r.put("anim_end_ms", round1(actAnimEndMs));
            r.put("forced", forced);
            r.put("active_at_cut", activeAtCut);
            r.put("work_p50", round3(pct(actWork, 50)));
            r.put("work_p95", round3(pct(actWork, 95)));
            r.put("work_p99", round3(pct(actWork, 99)));
            r.put("work_max", round3(maxOf(actWork)));
            r.put("vsync_p50", round3(pct(actVsync, 50)));
            actsPerf.add(r);
            // ★中途颜色采样（rainbow = 色带最盛的一幕；此时灯全亮且各色）
            if ("rainbow".equals(r.optString("name")) && midColors < 0) {
                int[] sample = samplePaintedOnly();
                midPainted = sample[0];
                midColors = sample[1];
            }
        } catch (Throwable t) {
            /* JSONObject.put 不会失败；保底不中断演出 */
        }
    }

    /**
     * 循环模式：一轮演完的**轻量收尾**（不写报告）——清本幕状态、留总计，
     * 由随后的 `__proteusLightsRestart` 重建节目单继续演。
     * ★读数处理：`actsPerf` 保留（诊断仍可看**最近一轮**的逐幕读数）；
     *   `allWork/allVsync` 不清（累计分布——"演了 N 轮"的总体帧成本）。
     */
    private void finishActTotals() {
        act = null;
        actElapsed = 0;
        actAnimEndMs = -1;
        forced = false;
        android.util.Log.i("proteus", "灯光秀一轮演完（loop）· 累计帧=" + totalFrames
                + " · 本轮幕数=" + actsPerf.size());
        actsPerf.clear();
    }

    /** 收尾：截屏 + JS finalize（由 JS 组装报告并调 report()） */
    private void finishShow() {
        finished = true;
        running = false;
        // 定格截图（谢幕语 hold 期间可再来一张；这里在幕序末尾拍）
        JSONObject stats = new JSONObject();
        try {
            stats.put("frames", totalFrames);
            stats.put("work_p50", round3(pct(allWork, 50)));
            stats.put("work_p95", round3(pct(allWork, 95)));
            stats.put("work_p99", round3(pct(allWork, 99)));
            stats.put("vsync_p50", round3(pct(allVsync, 50)));
            // ★acts 必须转成**真 JSONArray**（2026-10-01 真机抓出的序列化缺陷）：
            //   直接 put(List<JSONObject>) 时 org.json 把 List 当未知类型**字符串化**
            //   ⇒ JS 侧 `stats.acts.map(...)` 拿到字符串 ⇒ "TypeError: not a function"
            //   （演出本身没事——是收尾报告这一步炸的；首跑 11 幕全部演完的读数因此丢了收尾）。
            JSONArray actsArr = new JSONArray();
            for (JSONObject a : actsPerf) actsArr.put(a);
            stats.put("acts", actsArr);
            stats.put("plan", plan);
            stats.put("post_count", postCount);
            stats.put("view_draws", view != null ? view.onDrawCount() : -1);
            int[] painted = samplePainted();
            stats.put("painted_samples", painted[0]);
            stats.put("painted_colors", painted[1]);
            stats.put("mid_painted", midPainted);
            stats.put("mid_colors", midColors);
            stats.put("finished_at_ms", System.currentTimeMillis());
        } catch (Throwable t) {
            try { stats.put("stats_error", String.valueOf(t)); } catch (Throwable ignored) {}
        }
        // JS 组装报告（escapes 等在 JS 侧）→ 再回调本类 report() 落盘
        QuickJsEngine.EvalResult r = QuickJsEngine.eval(
                "__proteusLightsFinalize(" + JSONObject.quote(stats.toString()) + ")");
        if (!r.ok) {
            // 不静默：finalize 失败时写一个最小报告（判据会因缺字段判红——如实暴露）
            writeReport("lights.json", "{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(r.error))
                    + ",\"host_stats\":" + stats + "}");
        }
    }

    private void failShow(String msg) {
        lastError = msg;
        running = false;
        finished = true;
        try {
            JSONObject out = new JSONObject();
            out.put("ok", false);
            out.put("error", msg);
            out.put("host_stats", new JSONObject().put("frames", totalFrames).put("acts", actsPerf));
            writeReport("lights.json", out.toString());
        } catch (Throwable ignored) { /* 保底：写不出就只剩 logcat */ }
        android.util.Log.e("proteus", "灯光秀失败：" + msg);
    }

    /** 供 MainActivity 读（诊断） */
    boolean isRunning() { return running; }

    // ── 统计工具 ──

    private static double pct(List<Double> xs, int p) {
        if (xs.isEmpty()) return -1;
        List<Double> cp = new ArrayList<>(xs);
        java.util.Collections.sort(cp);
        int i = Math.min(cp.size() - 1, Math.max(0, cp.size() * p / 100));
        return cp.get(i);
    }

    private static double maxOf(List<Double> xs) {
        double m = 0;
        for (double x : xs) if (x > m) m = x;
        return m;
    }

    private static double round1(double v) { return Math.round(v * 10.0) / 10.0; }
    private static double round3(double v) { return Math.round(v * 1000.0) / 1000.0; }

    /* ══════════════════ 树 → 核心 / 绘制 ══════════════════ */

    /** 布局键白名单（★含颜色键：backgroundColor/color 是内核动画的基色，必须进核心） */
    private static final java.util.Set<String> CORE_KEYS = new java.util.HashSet<>(java.util.Arrays.asList(
            "width", "height", "widthRatio", "heightRatio", "minWidth", "maxWidth", "minHeight", "maxHeight",
            "margin", "padding", "flexDirection", "justifyContent", "alignItems", "alignSelf",
            "flexGrow", "flexShrink", "flexBasis", "gap", "display", "position", "top", "left",
            "overflow", "isText", "textStyleKey",
            // ★★颜色（灯光秀的命脉）：底色 = 颜色动画的起点与复位目标；color = 文字色基色
            "backgroundColor", "color"));

    /** 缺省字号（**布局单位** = px，与本场景 viewport 同坐标系） */
    private static final double DEFAULT_FONT_UNITS = 14.0;

    private JSONArray coreNodes() throws Exception {
        JSONArray arr = new JSONArray();
        for (JSONObject spec : specs) {
            JSONObject n = new JSONObject();
            n.put("id", spec.getInt("id"));
            if (spec.has("parentId") && !spec.isNull("parentId")) n.put("parentId", spec.getInt("parentId"));
            for (String k : CORE_KEYS) {
                if (spec.has(k) && !spec.isNull(k)) n.put(k, spec.get(k));
            }
            String t = spec.optString("text", null);
            if (t != null && !t.isEmpty()) {
                n.put("text", t);
                // I2-ALLOW: **非几何**——把 fontSize 编码成整数缓存键（×100 定点表示），
                //   不是坐标/尺寸换算（几何一律由内核产出并经 snap 吸附，平台层零舍入）
                n.put("textStyleKey", (int) Math.round(spec.optDouble("fontSize", DEFAULT_FONT_UNITS) * 100));
            }
            arr.put(n);
        }
        return arr;
    }

    /** 文本度量（标题节点）→ `textMeasures` JSON（id 字符串键） */
    private JSONObject buildMeasures() throws Exception {
        JSONObject measures = new JSONObject();
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        for (JSONObject spec : specs) {
            int id = spec.getInt("id");
            String text = spec.optString("text", null);
            if (text == null || text.isEmpty()) continue;
            double fs = spec.optDouble("fontSize", DEFAULT_FONT_UNITS);
            paint.setTextSize((float) fs);
            // I2-ALLOW: 文本**测量**结果的取整（测量子系统；度量值交给内核后由内核统一吸附）
            int w = (int) Math.ceil(paint.measureText(text));
            Paint.FontMetrics fm = paint.getFontMetrics();
            int h = (int) Math.ceil(fm.descent - fm.ascent);
            JSONObject size = new JSONObject();
            size.put("width", w);
            size.put("height", h);
            measures.put(String.valueOf(id), size);
            spec.put("fontSize", fs);
        }
        return measures;
    }

    /** 几何 → 绘制指令（★几何只来自内核；本方法不含任何布局计算） */
    private int emitCmds() throws Exception {
        JSONObject rects = new JSONObject(RustLayout.readRects(handle)).getJSONObject("rects");
        List<ProteusHostView.Cmd> cmds = new ArrayList<>(specs.size());
        List<Integer> cmdIds = new ArrayList<>(specs.size());
        for (JSONObject spec : specs) {
            int id = spec.getInt("id");
            JSONObject r = rects.optJSONObject(String.valueOf(id));
            if (r == null) continue;
            String bg = spec.optString("backgroundColor", null);
            String text = spec.optString("text", null);
            boolean isText = text != null && !text.isEmpty();
            int color = bg == null || bg.isEmpty() ? 0 : MainActivity.parseHex(bg);
            if (!isText && color == 0) continue;
            float fs = isText ? (float) spec.optDouble("fontSize", DEFAULT_FONT_UNITS) : 0f;
            // 文字静态色（探针回落 + 绘制兜底都与它同源）
            String tc = spec.optString("color", null);
            int textColor = tc == null || tc.isEmpty() ? 0 : MainActivity.parseHex(tc);
            // 圆角（纯绘制；灯光秀的灯珠 4px）
            float radius = (float) spec.optDouble("borderRadius", 0);
            cmds.add(new ProteusHostView.Cmd(
                    (float) r.getDouble("x"), (float) r.getDouble("y"),
                    (float) r.getDouble("width"), (float) r.getDouble("height"),
                    color, isText ? text : null, fs, textColor, radius));
            cmdIds.add(id);
        }
        int[] ids = new int[cmdIds.size()];
        for (int i = 0; i < ids.length; i++) ids[i] = cmdIds.get(i);
        ensureView();
        view.setCmds(cmds);
        view.setCmdNodeIds(ids);
        view.invalidate();
        return cmds.size();
    }

    private void ensureView() {
        if (view != null) return;
        view = new ProteusHostView(ctx);
        android.widget.FrameLayout.LayoutParams lp = new android.widget.FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        view.setLayoutParams(lp);
        root.addView(view);
        view.attachCore(handle);
    }

    /**
     * 离屏像素自检（"颜色真的画出来了"的机器判据）：
     * 数非透明采样点 + **不同颜色数**（灯光秀的核心主张 = 颜色在流动，单色会露馅）。
     */
    private int[] samplePainted() {
        return samplePaintedImpl(true);
    }

    /** 中途采样（不写 PNG——定格截图留给终帧） */
    private int[] samplePaintedOnly() {
        return samplePaintedImpl(false);
    }

    private int[] samplePaintedImpl(boolean writePng) {
        if (view == null) return new int[]{-1, -1};
        int W = 1080, H = 2400;
        android.graphics.Bitmap bmp = null;
        try {
            int vw = view.getWidth() > 0 ? view.getWidth() : W;
            int vh = view.getHeight() > 0 ? view.getHeight() : H;
            bmp = android.graphics.Bitmap.createBitmap(vw, vh, android.graphics.Bitmap.Config.ARGB_8888);
            view.measure(android.view.View.MeasureSpec.makeMeasureSpec(vw, android.view.View.MeasureSpec.EXACTLY),
                    android.view.View.MeasureSpec.makeMeasureSpec(vh, android.view.View.MeasureSpec.EXACTLY));
            view.layout(0, 0, vw, vh);
            view.draw(new android.graphics.Canvas(bmp));
            int painted = 0;
            java.util.HashSet<Integer> colors = new java.util.HashSet<>();
            for (int y = 0; y < vh; y += 12) {
                for (int x = 0; x < vw; x += 12) {
                    int px = bmp.getPixel(x, y);
                    if ((px >>> 24) != 0) {
                        painted++;
                        if (colors.size() < 4096) colors.add(px);
                    }
                }
            }
            // ★顺带把定格帧存成 PNG（官网配图 + 目视证据）——失败不影响判定
            if (writePng) {
                try {
                    java.io.File png = new java.io.File(reportDir(), "lights-final.png");
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(png);
                    bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, fos);
                    fos.close();
                } catch (Throwable ignored) { /* 截图失败不是判据前提 */ }
            }
            return new int[]{painted, colors.size()};
        } catch (Throwable t) {
            return new int[]{-1, -1};
        } finally {
            if (bmp != null) bmp.recycle();
        }
    }

    private JSONObject err(JSONObject out, String msg) {
        lastError = msg;
        try {
            out.put("ok", false);
            out.put("error", msg);
        } catch (Exception ignored) { /* JSONObject.put 不会失败 */ }
        return out;
    }
}
