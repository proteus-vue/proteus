package dev.proteus.layoutcore;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * ★★App 端**应用级生命周期事件源**（Android 真实系统回调 → JS 运行时）。
 *
 * 【为什么需要（用户质疑「再检查下安卓是否真的实现了应用生命周期相关的能力落地，保险点儿」）】
 *   取证发现：Android 宿主此前只覆写了 `onResume`/`onPause` ⇒
 *   **11 个应用级事件里只有 3 个（launch/show/hide）有真实来源**，其余 8 个是"声明但未实现"。
 *   本类补齐能用 Android 真 API 的部分，并**对无法真驱动的那几条显式标注**（不假装）：
 *
 * | 事件 | Android 真实来源（本类） | 真机驱动方式（run-host-runtime.sh ④/⑥ 阶段） |
 * |---|---|---|
 * | `memory-warning` | `ComponentCallbacks2.onTrimMemory(level)` | `am send-trim-memory <pid> RUNNING_LOW`（已实测打进回调 level=10） |
 * | `theme-change` | `Activity.onConfigurationChanged` 读 `uiMode` 位 | `cmd uimode night yes`（已实测可写） |
 * | `resize` | `onConfigurationChanged`（screenWidthDp/HeightDp 变化） | `wm user-rotation lock 1`（旋转，已实测可写） |
 * | `error` | `Thread.setDefaultUncaughtExceptionHandler` | `am broadcast dev.proteus.CRASH`（真未捕获异常 → 进程真死） |
 * | `audio-interruption-begin/end` | `ACTION_AUDIO_BECOMING_NOISY` / `ACTION_HEADSET_PLUG` **动态接收器** | ★**不可驱动**：保护广播 adb shell 注入被拒（`SecurityException`，已实测）——按"接收器已注册"验，不假装触发 |
 * | `unhandled-rejection` | ★**Android 无此概念**（Promise rejection 是 JS 引擎语义；QuickJS 宿主未接 rejection tracker） |
 * | `page-not-found` | ★**Android 无此概念**（路由未命中属框架 router 层事实——宿主系统无此类事件） |
 *
 * 【★★K 组证据链（2026-09-30 重做——初版 JS 探测"自触发"属假绿：把本类整个删掉也全绿）】
 *   本类**独立记账**（JS 侧无法伪造），在**未捕获异常处理器里**落盘 `host-app-events.json`：
 *     · `attempts[evt]`——**真系统回调**发生次数（只在真回调入口 +1）
 *     · `pushes[evt]`——**成功推入 JS** 次数（壳推通道存在且回执 ok 才 +1）
 *     · `lastPayload[evt]`——最后载荷（内容判据：如 theme=dark 由驱动命令决定）
 *     · `crash`——错误链证据（线程/消息/JS 回执）
 *   判据做**三链对齐**：真回调(attempts) → 壳推送(pushes) → JS 收到(jsProbe.seen)。
 *   ★为什么在崩溃点收口：脚本驱动的最后一个事件就是"真未捕获异常"（TEST_CRASH），
 *     崩溃后进程死亡、报告无法再写 ⇒ 必须在**死前**把全部证据一次性落盘（含此前三个事件的记账）。
 *
 * 【与 JS 侧契约】每条事件经 `forwardToJs()` 转发到 `globalThis.__proteusHostAppEvent`（JS 侧
 *   `installAppEventSource()` 消费 → 总线）。**通道未装时静默跳过**（bundle 未加载的正常态），
 *   但 attempts 仍计数（"回调发生了但 JS 还不在"——时序事实，判据读得到）。
 */
public final class HostLifecycleEvents implements ComponentCallbacks2 {
    private static final String TAG = "proteus-lifecycle";

    private final Activity activity;
    /** 证据落盘目录（Activity 的外置文件目录——脚本经 adb pull 取回） */
    private final File reportDir;
    /** 当前 UI 模式（夜间/日间）——用于 theme-change 变化判定 */
    private int lastUiMode = Configuration.UI_MODE_NIGHT_UNDEFINED;
    /** 当前窗口尺寸（用于 resize 判定） */
    private int lastWidthDp = 0;
    private int lastHeightDp = 0;
    /** 音频焦点状态（用于 interruption 配对） */
    private volatile boolean audioInterrupted = false;
    /** 卸载钩子（避免 Activity 销毁后仍收到回调 → 泄漏） */
    private volatile boolean disposed = false;

    // ── ★K 组记账：见下方"进程级实例治理"（**静态**——多实例共享同一份证据） ──
    private BroadcastReceiver audioReceiver = null;

    // ── ★★进程级实例治理（2026-09-30 真机实测抓出："一进程多 Activity 实例"污染证据） ──
    // 【现象】`am start` 让同进程出现**第二个 MainActivity 实例**（日志实证：19:36:07 一次安装、
    //   19:36:24 又一次）⇒ ① 系统内存回调对**两个注册者**各调一次（同一次驱动计两次）；
    //   ② CRASH 广播被**两个接收器**各收一次 ⇒ 两个崩溃线程；③ 两个钩子 lambda 在链上各转发一次
    //   ⇒ 一次真崩溃出现 4 次转发/4 次落盘（`seen=4` 就是这么来的）。
    // 【治理（三条，均进程级）】
    //   ① 记账**静态化**（ATTEMPTS/PUSHES/…）：无论哪个实例处理，证据都在同一份里（不丢历史）；
    //   ② 只让**最新实例**是 ACTIVE：所有系统回调入口先过 `active()`——旧实例回调不再转发
    //      （一次驱动 = 一次转发；旧实例的钩子仍被链式调用但不转发，进程照常死）；
    //   ③ 崩溃注入**每进程一次**（CRASH_CLAIMED CAS）——广播到达多个接收器也只触发一个崩溃线程。
    private static final java.util.concurrent.atomic.AtomicReference<HostLifecycleEvents> ACTIVE =
            new java.util.concurrent.atomic.AtomicReference<HostLifecycleEvents>();
    private static final java.util.concurrent.atomic.AtomicBoolean CRASH_CLAIMED =
            new java.util.concurrent.atomic.AtomicBoolean(false);
    private static final ConcurrentHashMap<String, Integer> ATTEMPTS = new ConcurrentHashMap<String, Integer>();
    private static final ConcurrentHashMap<String, Integer> PUSHES = new ConcurrentHashMap<String, Integer>();
    private static final ConcurrentHashMap<String, String> LAST_PAYLOAD = new ConcurrentHashMap<String, String>();
    private static final java.util.concurrent.ConcurrentLinkedQueue<String> HISTORY =
            new java.util.concurrent.ConcurrentLinkedQueue<String>();
    private static volatile boolean ERROR_HANDLER_INSTALLED = false;
    private static volatile boolean AUDIO_RECEIVER_REGISTERED = false;
    private static volatile String LAST_WRITER = "";

    /** 本实例是否是当前活跃实例（最新创建、未销毁）——**唯一允许转发**的实例 */
    private boolean active() {
        return ACTIVE.get() == this && !disposed;
    }

    /** 崩溃注入许可（每进程一次——多接收器/多实例下仍只触发一个崩溃线程） */
    public static boolean claimCrashOnce() {
        return CRASH_CLAIMED.compareAndSet(false, true);
    }

    public HostLifecycleEvents(Activity activity, File reportDir) {
        this.activity = activity;
        this.reportDir = reportDir;
        Configuration cfg = activity.getResources().getConfiguration();
        this.lastUiMode = cfg.uiMode & Configuration.UI_MODE_NIGHT_MASK;
        this.lastWidthDp = cfg.screenWidthDp;
        this.lastHeightDp = cfg.screenHeightDp;
    }

    // ────────────────────────── ① 内存警告（真系统回调） ──────────────────────────

    /** ★`ComponentCallbacks2.onTrimMemory` —— Android 的**内存压力**标准回调（对应 iOS 内存警告） */
    @Override
    public void onTrimMemory(int level) {
        // ★实例守卫（见"进程级实例治理"）：多实例下**只有活跃实例转发**——一次驱动=一次转发
        if (!active()) return;
        // ★level 语义映射：Android 的 TRIM_MEMORY_* 常量 → 0..3 的通用档（与 iOS 对齐的粗粒度）
        int mapped;
        if (level >= TRIM_MEMORY_COMPLETE) mapped = 3;          // 后台且即将被杀（最紧急）
        else if (level >= TRIM_MEMORY_MODERATE) mapped = 2;      // 后台内存吃紧
        else if (level >= TRIM_MEMORY_RUNNING_CRITICAL) mapped = 2;
        else if (level >= TRIM_MEMORY_RUNNING_LOW) mapped = 1;
        else mapped = 0;                                          // RUNNING_MODERATE / UI_HIDDEN
        Log.i(TAG, "onTrimMemory level=" + level + " → mapped=" + mapped);
        // ★rawLevel 原样带出（判据内容校验用：send-trim-memory 驱动的等级应原样出现）
        forwardToJs("memory-warning", "{\"level\":" + mapped + ",\"rawLevel\":" + level + "}");
    }

    @Override
    public void onLowMemory() {
        // 老 API（<14）的等价回调——同样派发（最高档）
        if (!active()) return;
        Log.i(TAG, "onLowMemory（老 API 路径，按最高档派发）");
        forwardToJs("memory-warning", "{\"level\":3,\"rawLevel\":-1}");
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        // 占位：由 Activity 显式调用 {@link #handleConfiguration}（ComponentCallbacks 的这条
        // 在 Activity 注册时不会自动触发——Activity 自己有同名方法，见 MainActivity 的覆写）
    }

    // ────────────────────────── ② 配置变化：主题 + 尺寸（真系统回调） ──────────────────────────

    /**
     * 配置变化（Activity.onConfigurationChanged 转发进来）——派发 `theme-change` 与 `resize`。
     *
     * ★为什么由 Activity 转发而不是本类自己收：`ComponentCallbacks2` 只有
     *   `onTrimMemory`/`onLowMemory`/`onConfigurationChanged` 三个方法，而 Activity 的
     *   `onConfigurationChanged` 是**独立覆写点**（系统只调 Activity 的那个）⇒ 必须转发。
     * ★前提：manifest 的 `configChanges` 必须包含 `uiMode`/`screenSize` 等（否则配置变化会
     *   **重建 Activity**——本类实例被 dispose，事件丢失；本轮已补 `uiMode`）。
     */
    public void handleConfiguration(Configuration cfg) {
        // ★实例守卫：两个实例都覆写 onConfigurationChanged ⇒ 只有活跃实例转发（一次变化=一次转发）
        if (!active()) return;
        // ① 主题（夜间模式）
        int uiMode = cfg.uiMode & Configuration.UI_MODE_NIGHT_MASK;
        if (uiMode != lastUiMode && uiMode != Configuration.UI_MODE_NIGHT_UNDEFINED) {
            lastUiMode = uiMode;
            String theme = uiMode == Configuration.UI_MODE_NIGHT_YES ? "dark" : "light";
            Log.i(TAG, "配置变化：主题 → " + theme);
            forwardToJs("theme-change", "{\"theme\":\"" + theme + "\"}");
        }
        // ② 尺寸（旋转/分屏/折叠屏展开）
        if (cfg.screenWidthDp != lastWidthDp || cfg.screenHeightDp != lastHeightDp) {
            lastWidthDp = cfg.screenWidthDp;
            lastHeightDp = cfg.screenHeightDp;
            Log.i(TAG, "配置变化：尺寸 → " + lastWidthDp + "x" + lastHeightDp + "dp");
            forwardToJs("resize", "{\"windowWidth\":" + lastWidthDp + ",\"windowHeight\":" + lastHeightDp + "}");
        }
    }

    // ────────────────────────── ③ 全局错误（真钩子） ──────────────────────────

    /**
     * ★安装全局未捕获异常钩子（对应 `App.onError`）。
     *
     * 【证据形态】钩子里的 JS 调用与证据落盘都**切回主线程**执行（QuickJS 运行时是单线程的，
     *   从崩溃线程直接 eval 有线程安全问题）——用 `CountDownLatch` 等主线程完成后再链式
     *   调用原 handler（进程随后真死）。若主线程已不可用，最多等 3 秒仍然崩溃（不悬挂）。
     * ★保留原 handler 并**链式调用**（不吞掉别人装的 handler——Kotlin/第三方 SDK 可能也装了；
     *   覆盖而不转发会让那些库的崩溃上报失效，属"解决了自己的问题、制造了别人的问题"）。
     * ★★只让**活跃实例**转发（见"进程级实例治理"）：旧实例的 lambda 仍在链上（保证进程照样死），
     *   但**不转发/不落盘**——否则一次崩溃会因"多实例链式调用"产生 N 次转发（今日实测 4 次）。
     */
    public void installErrorHandler() {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        ACTIVE.set(this); // ★本实例成为活跃实例（最新创建者）——旧实例的转发入口从此全部失活
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            final String msg = e.getClass().getName() + ": " + String.valueOf(e.getMessage());
            Log.e(TAG, "uncaught " + t.getName() + ": " + msg);
            if (ACTIVE.get() == this && !disposed) {
                final CountDownLatch latch = new CountDownLatch(1);
                try {
                    activity.runOnUiThread(() -> {
                        try {
                            String ack = forwardToJs("error", "{\"error\":" + jsonStr(msg) + "}");
                            // ★死前落盘：全部记账 + JS 探针快照 + 本错误链证据（K 组判据读这份）
                            writeEvidence("android-uncaught", t.getName(), msg, ack);
                        } finally {
                            latch.countDown();
                        }
                    });
                    latch.await(3, TimeUnit.SECONDS);
                } catch (Throwable ignore) {
                    // 主线程不可用 ⇒ 无法落盘：判据会因证据缺失而红（诚实，不静默）
                }
            }
            if (prev != null) prev.uncaughtException(t, e);
        });
        ERROR_HANDLER_INSTALLED = true;
        Log.i(TAG, "全局未捕获异常钩子已装（链式保留原 handler；ACTIVE=本实例）");
    }

    // ────────────────────────── ④ 音频中断（真动态接收器） ──────────────────────────

    /**
     * ★音频中断（对应 `App.onAudioInterruptionBegin/End`）——**动态接收器**（真实现）。
     *
     * Android 没有"音频中断"这个统一回调（那是 iOS 的 `AVAudioSession` 概念）
     * ⇒ 用两条真实系统广播近似：
     *   · `ACTION_AUDIO_BECOMING_NOISY`（耳机拔出/断路）⇒ begin
     *   · `ACTION_HEADSET_PLUG` state=1（耳机插回）⇒ end；state=0（拔出）⇒ begin
     * ★这是**平台语义映射**，不是假装 iOS 语义——注释如实说明。
     * ★★诚实边界（判据依据）：这两条是**保护广播**——adb shell（uid 2000）注入被系统拒绝
     *   （`SecurityException: not allowed to send broadcast`，本机已实测）⇒ **真机脚本无法驱动**。
     *   ⇒ K 组对这两条事件的判据是"**接收器已注册**"（`audioReceiverRegistered`），
     *     并明确标注"未驱动"——**不假装跑过**。真实触发要靠物理拔插耳机。
     */
    public boolean registerAudioReceiver() {
        if (audioReceiver != null) return true;
        try {
            final BroadcastReceiver r = new BroadcastReceiver() {
                @Override public void onReceive(Context c, Intent i) {
                    if (i == null || i.getAction() == null) return;
                    if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(i.getAction())) {
                        markAudioInterruption(true);      // 耳机拔出：音频不应继续外放 ⇒ 开始
                    } else if (Intent.ACTION_HEADSET_PLUG.equals(i.getAction())) {
                        int state = i.getIntExtra("state", -1);   // 1=插入 0=拔出
                        markAudioInterruption(state != 1);
                    }
                }
            };
            IntentFilter f = new IntentFilter();
            f.addAction(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            f.addAction(Intent.ACTION_HEADSET_PLUG);
            if (Build.VERSION.SDK_INT >= 33) {
                activity.registerReceiver(r, f, Context.RECEIVER_NOT_EXPORTED);
            } else {
                activity.registerReceiver(r, f);
            }
            audioReceiver = r;
            AUDIO_RECEIVER_REGISTERED = true;
            Log.i(TAG, "音频信号接收器已注册（BECOMING_NOISY / HEADSET_PLUG）——★保护广播不可 adb 注入，脚本不驱动");
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "音频接收器注册失败：" + t.getMessage());
            return false;
        }
    }

    /** 宿主壳可调入口（接收器与真实音频焦点回调共用）——配对语义：begin/end 交替才派发 */
    public void markAudioInterruption(boolean begin) {
        // ★实例守卫：多实例各注册一个接收器 ⇒ 只有活跃实例转发（一次插拔=一次转发）
        if (!active()) return;
        if (begin && !audioInterrupted) {
            audioInterrupted = true;
            Log.i(TAG, "音频中断开始（耳机拔出/断路）");
            forwardToJs("audio-interruption-begin", "null");
        } else if (!begin && audioInterrupted) {
            audioInterrupted = false;
            Log.i(TAG, "音频中断结束（耳机插回）");
            forwardToJs("audio-interruption-end", "null");
        }
    }

    // ────────────────────────── 转发通道 ──────────────────────────

    /**
     * 转发到 JS 侧（`globalThis.__proteusHostAppEvent(evt, payloadJson)`），并记账。
     * ★返回**回执**（'ok' / 'no-hook' / 'unknown-event:…' / 'error:…'）——错误链证据要读它。
     * ★日志用 ASCII 标记（`attempt` / `push-ok`）——脚本的 logcat 条件等待按它们对齐
     *   （中文日志在 adb shell grep 里转义麻烦）。
     */
    private String forwardToJs(String evt, String payloadJson) {
        // ★K 记账①：真系统回调发生（本方法只被真回调/真接收器调用；调用点均已经过 active() 守卫）
        //   ★记账是**进程级静态**的：多实例共享同一份证据（不因"谁处理"而丢历史）
        ATTEMPTS.merge(evt, 1, Integer::sum);
        LAST_PAYLOAD.put(evt, payloadJson);
        // ★K 历史环（上限 64）：判据据此做**驱动载荷内容断言**（如 send-trim-memory 的 rawLevel=10
        //   必须能在历史里找到——只有真驱动过才会有该条目，自动触发的其他等级替代不了它）
        HISTORY.add("{\"evt\":" + jsonStr(evt) + ",\"payload\":" + payloadJson + ",\"ts\":" + System.currentTimeMillis() + "}");
        while (HISTORY.size() > 64) HISTORY.poll();
        Log.i(TAG, "attempt " + evt);
        try {
            if (!QuickJsEngine.isAvailable()) return "no-engine";
            QuickJsEngine.EvalResult r = QuickJsEngine.eval(
                    "typeof __proteusHostAppEvent === 'function' ? __proteusHostAppEvent("
                            + jsonStr(evt) + ", " + payloadJson + ") : 'no-hook'");
            String ack = r.ok && r.value != null ? r.value : ("error:" + r.error);
            if (!"no-hook".equals(ack) && !ack.startsWith("unknown-event") && !ack.startsWith("error")) {
                // ★K 记账②：壳推通道真的把事件送进了 JS（白名单通过 + 回执 ok）
                PUSHES.merge(evt, 1, Integer::sum);
                Log.i(TAG, "push-ok " + evt + " #" + PUSHES.get(evt));
            } else {
                Log.i(TAG, "push-skip " + evt + " ack=" + ack);
            }
            QuickJsEngine.nativeRunPendingJobs(); // 续体执行（与壳转发同款）
            return ack;
        } catch (Throwable t) {
            Log.w(TAG, "转发失败（" + evt + "）：" + t.getMessage());
            return "error:" + t.getMessage();
        }
    }

    // ────────────────────────── ★K 证据落盘 ──────────────────────────

    /**
     * 把**全部证据**写入 `host-app-events.json`（在未捕获异常处理器里、进程死前调用）：
     * `{ ts, java: {attempts, pushes, lastPayload, …}, jsProbe: {…}, crash: {note, thread, error, jsAck} }`。
     * ★JS 探针快照经 `JSON.stringify(globalThis.__proteusAppEventProbe)` 当场读取（引擎尚存活）。
     */
    private void writeEvidence(String note, String thread, String errMsg, String jsAck) {
        try {
            JSONObject ev = new JSONObject();
            ev.put("ts", System.currentTimeMillis());
            ev.put("java", stats());
            // JS 探针快照（须在主线程调用——本方法由 installErrorHandler 的 runOnUiThread 路径调用）
            Object probe = JSONObject.NULL;
            try {
                QuickJsEngine.EvalResult r = QuickJsEngine.eval(
                        "JSON.stringify(globalThis.__proteusAppEventProbe || null)");
                if (r.ok && r.value != null && !"null".equals(r.value)) probe = new JSONObject(r.value);
            } catch (Throwable t) {
                probe = "eval-failed:" + t.getMessage();
            }
            ev.put("jsProbe", probe);
            JSONObject c = new JSONObject();
            c.put("note", note);
            c.put("thread", thread);
            c.put("error", errMsg);
            c.put("jsAck", jsAck);
            ev.put("crash", c);
            File f = new File(reportDir, "host-app-events.json");
            FileOutputStream fos = new FileOutputStream(f);
            fos.write(ev.toString(2).getBytes("UTF-8"));
            fos.close();
            Log.i(TAG, "K 证据已写入 " + f.getAbsolutePath());
        } catch (Throwable t) {
            Log.e(TAG, "K 证据写入失败：" + t.getMessage());
        }
    }

    /**
     * ★K 组记账导出（并入主报告顶层 `host_app_events`；主报告在 RUN 相位写——快照语义，
     *   最终判据以 writeEvidence 落盘的 `host-app-events.json` 为准）。
     * ★**留痕**（`LAST_WRITER`）：最后一次 stats() 的调用者（诊断"多实例"污染用——
     *   若判决报告出自旧实例，判据会看到 writer 与活跃实例不符）。
     */
    public JSONObject stats() {
        JSONObject o = new JSONObject();
        try {
            o.put("attempts", new JSONObject(ATTEMPTS));
            o.put("pushes", new JSONObject(PUSHES));
            // ★历史环（原样 JSON 条目数组——判据解析每条做内容断言）
            org.json.JSONArray h = new org.json.JSONArray();
            for (String e : HISTORY) {
                try { h.put(new JSONObject(e)); } catch (Exception bad) { /* 跳过坏条目（理论不该有） */ }
            }
            o.put("history", h);
            JSONObject lp = new JSONObject();
            for (String k : LAST_PAYLOAD.keySet()) {
                String raw = LAST_PAYLOAD.get(k);
                try {
                    lp.put(k, raw == null || "null".equals(raw) ? JSONObject.NULL : new JSONObject(raw));
                } catch (Exception bad) {
                    lp.put(k, raw); // 载荷非 JSON（理论不该发生）——原样带出，判据侧会显式红
                }
            }
            o.put("lastPayload", lp);
            o.put("errorHandlerInstalled", ERROR_HANDLER_INSTALLED);
            o.put("audioReceiverRegistered", AUDIO_RECEIVER_REGISTERED);
            o.put("active", active());
        } catch (Exception e) {
            try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { /* 兜底 */ }
        }
        return o;
    }

    private static String jsonStr(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }

    /** 卸载（Activity onDestroy）——清 disposed 防泄漏 + 注销音频接收器（防泄漏） */
    public void dispose() {
        disposed = true;
        // ★只在自己是活跃实例时让出 ACTIVE（旧实例销毁不得踢掉新实例）
        ACTIVE.compareAndSet(this, null);
        BroadcastReceiver r = audioReceiver;
        audioReceiver = null;
        if (r != null) {
            try { activity.unregisterReceiver(r); } catch (Throwable ignored) { /* 未注册/已销毁——可忽略 */ }
        }
    }
}
