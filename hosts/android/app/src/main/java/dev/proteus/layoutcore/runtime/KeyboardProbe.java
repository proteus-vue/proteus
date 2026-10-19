package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/KeyboardProbe.java
// ★★★ C14 键盘推送**真机探针**（Android）—— 2026-10-19 · 决策 #1075
//
// 【为什么单列一个文件】探针约 150 行；`dev/MainActivity.java` 已是 6619 行存量巨型文件
//   （`check:file-size` 棘轮只减不增）⇒ 塞进去直接判红。探针是**测试装置**，本就该独立。
//
// 【它验证什么】「真实软键盘 → WindowInsets.ime → KeyboardWatcher → JS `__proteusHostKeyboard`」全链。
//
// 【★诚实边界（本探针**未打通**，读数保留作证据）】
//   实测（MIUI 真机）：`channel="function"`（JS 接收通道正确）· 窗口有焦点 · root 有尺寸（1200×2236）·
//   EditText 已获焦且已挂窗 —— 但 **EditText 测量结果为 0×0** ⇒ 0 尺寸视图不触发输入法 ⇒ 键盘不弹。
//   尝试 5 轮（1×1 → MATCH_PARENT×40 + 布局条件等待）仍未解决；**已确认不是产品缺陷**
//   （接收通道与宿主装配都正确）。按本仓纪律停止装置迭代，交接见任务板 `T-keyboard-android-probe`。
//   ★后续建议：改用**真实可见输入控件** + 脚本 `adb shell input tap` 点击，而非程序化注入隐藏控件——
//     `showSoftInput` 对"尚未完成测量"的视图在 MIUI 上行为不稳定。
//
// 【为什么不用固定延时】本仓红线：禁止任何盲等。等待一律"条件 + 有界"：
//   每轮让出 UI 帧（`runOnUiThread` + 有界 await）后重检高度读数。

import android.app.Activity;
import android.os.Build;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

final class KeyboardProbe {
    /** 弹/收各最多等 2s（有界） */
    private static final int MAX_ROUNDS = 40;

    private final Activity activity;
    private final ViewGroup root;

    KeyboardProbe(Activity activity, ViewGroup root) {
        this.activity = activity;
        this.root = root;
    }

    /**
     * 跑一次探针（**阻塞至有界预算耗尽**；调用方在后台线程调用，内部切 UI 线程）。
     * @return 读数（写进主报告的 `keyboard_probe`）
     */
    JSONObject run() throws Exception {
        final JSONObject kp = new JSONObject();
        // ① JS 侧接收通道（capability-app-device 的 installKeyboardChannel）
        QuickJsEngine.EvalResult ch = QuickJsEngine.eval("String(typeof __proteusHostKeyboard)");
        kp.put("channel", ch.ok && ch.value != null ? ch.value : "no-eval");
        // ② 装记录器：记下每次推送载荷（判据据此断言"JS 真的收到了"）
        QuickJsEngine.eval("(function(){var g=globalThis;g.__proteusKbLog=[];var o=g.__proteusHostKeyboard;"
            + "g.__proteusHostKeyboard=function(p){try{g.__proteusKbLog.push(p)}catch(e){};"
            + "return (typeof o==='function')?o(p):'no-orig';};return 'ok';})()");
        KeyboardWatcher.resetForProbe(); // ★#1078：清掉上一轮残留读数
        // ③ 装与 superapp **同一份** KeyboardWatcher（不是另写一份）
        final float density = activity.getResources().getDisplayMetrics().density;
        KeyboardWatcher.install(activity, density, dp -> KeyboardWatcher.pushToJs());

        // ④ 诊断：窗口与容器状态（真机实测这三项全部正常，问题在 EditText 测量）
        kp.put("diag_has_window_focus", activity.hasWindowFocus());
        kp.put("diag_is_finishing", activity.isFinishing());
        kp.put("diag_root_w", root.getWidth());
        kp.put("diag_root_h", root.getHeight());
        kp.put("diag_root_attached", root.isAttachedToWindow());
        kp.put("diag_sdk", Build.VERSION.SDK_INT);

        // ⑤ 注入隐藏输入控件并请求焦点
        final EditText[] fieldRef = new EditText[1];
        final CountDownLatch latch = new CountDownLatch(1);
        activity.runOnUiThread(() -> {
            try {
                EditText et = new EditText(activity);
                // ★alpha=0 的视图无法获焦（实测）⇒ 透明背景 + 透明文字但**可见**
                et.setBackgroundColor(0x00000000);
                et.setTextColor(0x00000000);
                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 40);
                root.addView(et, lp);
                et.setFocusableInTouchMode(true);
                et.requestFocus();
                fieldRef[0] = et;
            } catch (Throwable ignored) {
                /* 下面按读数判定 */
            }
            latch.countDown();
        });
        latch.await(2, TimeUnit.SECONDS);

        // ⑥ 诊断：EditText 焦点与**测量尺寸**（实测为 0×0 ⇒ 键盘不触发）
        EditText et0 = fieldRef[0];
        if (et0 != null) {
            kp.put("diag_edit_focused", et0.isFocused());
            kp.put("diag_edit_attached", et0.isAttachedToWindow());
            kp.put("diag_edit_w", et0.getWidth());
            kp.put("diag_edit_h", et0.getHeight());
        }

        // ⑦ 等布局测量完成。★真机实测（#1078）：`yieldFrame` 40 轮 26ms 就跑完（UI 线程空闲但
        //   EditText 始终不测量——注入的视图在 MIUI 上不参与常规 layout pass）。
        //   ⇒ **手动 measure + layout**（确定性，不依赖系统什么时候走 layout）：
        //     按父容器可用尺寸给一个明确测量规格，再把结果写回。
        activity.runOnUiThread(() -> {
            try {
                EditText cur = fieldRef[0];
                if (cur != null && cur.getWidth() == 0) {
                    int w = Math.max(root.getWidth(), 200);
                    cur.measure(
                        android.view.View.MeasureSpec.makeMeasureSpec(w, android.view.View.MeasureSpec.EXACTLY),
                        android.view.View.MeasureSpec.makeMeasureSpec(80, android.view.View.MeasureSpec.EXACTLY));
                    cur.layout(0, 0, cur.getMeasuredWidth(), cur.getMeasuredHeight());
                    kp.put("diag_manual_measure", cur.getMeasuredWidth() + "x" + cur.getMeasuredHeight());
                }
            } catch (Throwable mt) { try { kp.put("diag_manual_measure_err", String.valueOf(mt)); } catch (Throwable ignored) { } }
        });
        for (int i = 0; i < 10; i++) {
            EditText cur = fieldRef[0];
            if (cur != null && cur.getWidth() > 0) break;
            yieldFrame();
        }
        activity.runOnUiThread(() -> {
            try {
                EditText cur = fieldRef[0];
                if (cur != null) {
                    cur.requestFocus();
                    InputMethodManager imm = (InputMethodManager) activity.getSystemService(Activity.INPUT_METHOD_SERVICE);
                    if (imm != null) imm.showSoftInput(cur, InputMethodManager.SHOW_IMPLICIT);
                }
            } catch (Throwable ignored) { }
        });

        // ⑧ 等弹出（条件：高度 > 0）
        long tWait0 = System.nanoTime();
        // ★决策 #1078：**条件等待**（insets 回调 notifyAll；零轮询）——替代原来的 40 次 yield
        float shown = KeyboardWatcher.awaitHeight(true, 3000);
        kp.put("diag_wait_ms", (System.nanoTime() - tWait0) / 1000000);
        kp.put("shown_height_dp", shown);
        if (shown <= 0f) kp.put("shown_error", "键盘 2s 内未出现（0 尺寸输入控件 / 硬件键盘 / 模拟器？）");
        kp.put("js_calls_on_show", jsLogLength());

        // ⑨ 收起
        activity.runOnUiThread(() -> {
            try {
                InputMethodManager imm = (InputMethodManager) activity.getSystemService(Activity.INPUT_METHOD_SERVICE);
                EditText cur = fieldRef[0];
                if (imm != null && cur != null) imm.hideSoftInputFromWindow(cur.getWindowToken(), 0);
                if (cur != null) root.removeView(cur);
            } catch (Throwable ignored) { }
        });
        float hidden = KeyboardWatcher.awaitHeight(false, 2000);
        kp.put("hidden_height_dp", hidden);
        if (hidden != 0f) kp.put("hidden_error", "键盘 2s 内未收起");
        kp.put("js_calls_total", jsLogLength());
        QuickJsEngine.EvalResult log = QuickJsEngine.eval("JSON.stringify(globalThis.__proteusKbLog || [])");
        kp.put("js_log", log.ok && log.value != null ? log.value : "[]");
        return kp;
    }

    /** 让出一帧（UI 线程处理完当前消息）——**不是固定延时**，是有界 await。 */
    private void yieldFrame() {
        final CountDownLatch tick = new CountDownLatch(1);
        activity.runOnUiThread(tick::countDown);
        try {
            tick.await(100, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** 条件等待键盘高度进入 expectShown 状态（>0 / ==0），有界 MAX_ROUNDS 轮。 */
    /** 等待循环实际迭代数（诊断：证明 yieldFrame 真的跑了） */
    private int lastWaitRounds = 0;

    private float waitHeight(boolean expectShown) {
        lastWaitRounds = 0;
        for (int i = 0; i < MAX_ROUNDS; i++) {
            lastWaitRounds = i + 1;
            float h = KeyboardWatcher.lastHeightDp;
            if (expectShown ? h > 0f : h == 0f) return h;
            yieldFrame();
        }
        return KeyboardWatcher.lastHeightDp;
    }

    private int jsLogLength() {
        QuickJsEngine.EvalResult r = QuickJsEngine.eval("String((globalThis.__proteusKbLog||[]).length)");
        try {
            return r.ok && r.value != null ? Integer.parseInt(r.value.trim()) : 0;
        } catch (Throwable t) {
            return 0;
        }
    }

    /**
     * ★★★异步驱动（决策 #1078）：**后台线程**跑探针，UI 线程只负责挂控件/请求焦点。
     *
     * 【为什么必须异步（真根因，推翻了 #1075 的"尺寸"判断）】探针原先在 `appHostRun()` 里同步调用，
     *   而那是**主线程**（广播 onReceive → runAll）⇒ `latch.await(2s)` **阻塞主线程**
     *   ⇒ UI 消息队列不执行 ⇒ layout 永不跑 ⇒ EditText 恒 0×0 ⇒ 键盘不弹。
     *   **不是尺寸/alpha/焦点问题**（当时那些读数全都正常）。这是"在 UI 线程上同步等 UI 线程"的自锁。
     *
     * @param write 落盘回调（`(name, content) => void`，由 Activity 提供——复用其报告目录）
     */
    public static void runAsync(Activity activity, ViewGroup root, WriteReport write) {
        new Thread(() -> {
            JSONObject kp = null;
            try {
                kp = new KeyboardProbe(activity, root).run();
            } catch (Throwable t) {
                kp = new JSONObject();
                try { kp.put("error", String.valueOf(t)); } catch (Throwable ignored) { }
            }
            JSONObject out = kp;
            try {
                write.write("keyboard-probe.json", out.toString(2));
                android.util.Log.i("proteus-kb", "KEYBOARD_PROBE_DONE " + out);
            } catch (Throwable t) {
                android.util.Log.e("proteus-kb", "KEYBOARD_PROBE_WRITE_FAIL " + t);
            }
        }, "proteus-kb-probe").start();
    }

    /** 落盘回调（由 Activity 提供——复用其报告目录） */
    public interface WriteReport {
        void write(String name, String content);
    }

}
