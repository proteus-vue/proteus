package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/KeyboardWatcher.java
// ★★★C14 键盘监听（Android 唯一实现）—— 2026-10-19 · 决策 #1075
//
// 【它解决什么】#1069 把键盘监听直接写在 `SuperappActivity` 里 ⇒ **只有 superapp 场景有**；
//   `host-runtime` 场景（`dev/MainActivity`）完全没有 ⇒ 那里 `__proteusHostKeyboard` 永远收不到推送。
//   与 iOS 侧 #1074 抓到的缺陷同型（iOS 是"接收通道没装"，Android 是"推送实现绑在某个 Activity 上"）。
//   本类把它提取为**可复用单元**：任何 Activity 一行 `KeyboardWatcher.install(window, density, cb)` 即可。
//
// 【为什么按 IME insets 而不是软键盘可见性】`WindowInsets.Type.ime()` 给的是**让位高度**（与
//   wx.onKeyboardHeightChange 的语义一致：0 = 收起），且不受键盘动画中间态影响。
// 【★API < 30】拿不到 `ime()` insets ⇒ **不装**（如实：高度不可知，不推假 0）。
// 【线程】insets 回调在**主线程** ⇒ 回调里可以直接 eval JS（QuickJS 非线程安全，主线程是唯一合法入口）。

import android.app.Activity;
import android.util.Log;
import android.view.Window;
import android.view.WindowInsets;

public final class KeyboardWatcher {
    private static final String TAG = "proteus-kb";

    /** 高度变化回调（dp；0 = 收起）。 */
    public interface Listener {
        void onHeightChanged(float heightDp);
    }

    private KeyboardWatcher() { }

    /** 最近一次 IME 高度（dp；0 = 收起）——供 env 采集复用（`--pf-keyboard-height`）。 */
    public static volatile float lastHeightDp = 0f;
    /** 是否已装（幂等） */
    private static volatile boolean installed = false;

    /**
     * 在给定窗口上装 IME 监听（幂等；同一进程内只装一次）。
     *
     * @param activity 提供窗口（取 decorView 装 insets 监听）
     * @param density  当前 density（px → dp；<=0 时按 1 处理）
     * @param onFrame  高度变化后的附加动作（例如触发重渲让 `--pf-keyboard-height` 生效）；
     *                 **每帧都会在主线程调用**，实现方须自行节流（本类只在高度变化 ≥0.5dp 时回调）
     * @return 是否已装（false = API 太低或安装失败，调用方据此如实标注）
     */
    public static boolean install(Activity activity, float density, final Listener onFrame) {
        if (installed) return true;
        if (android.os.Build.VERSION.SDK_INT < 30) {
            Log.i(TAG, "keyboard-watch skip（API<30：拿不到 ime() insets——高度不可知，不推假 0）");
            return false;
        }
        final float d = density > 0 ? density : 1f;
        try {
            Window win = activity.getWindow();
            win.getDecorView().setOnApplyWindowInsetsListener((v, insets) -> {
                int imePx = insets.getInsets(WindowInsets.Type.ime()).bottom;
                float dp = imePx / d;
                // 只在**变化**时回调（insets 回调节奏随焦点/键盘动画变化，重复推送会打爆订阅者）
                if (Math.abs(dp - lastHeightDp) >= 0.5f) {
                    lastHeightDp = dp;
                    try {
                        onFrame.onHeightChanged(dp);
                    } catch (Throwable t) {
                        Log.w(TAG, "keyboard listener 抛错：" + t.getMessage());
                    }
                }
                return v.onApplyWindowInsets(insets);
            });
            installed = true;
            Log.i(TAG, "keyboard-watch installed（IME insets → listener）");
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "keyboard-watch 安装失败：" + t.getMessage());
            return false;
        }
    }

    /**
     * 把高度推给 JS 的 `__proteusHostKeyboard({ height, visible })`。
     * ★未装接收器 ⇒ 回执 `no-hook`（记日志，不抛）；不影响布局（键盘高度是增强信息）。
     * @return 回执（`ok` / `no-hook` / `error:…` / `no-engine`）——判据可读它
     */
    public static String pushToJs() {
        try {
            if (!QuickJsEngine.isAvailable()) return "no-engine";
            String payload = "{\"height\":" + lastHeightDp + ",\"visible\":" + (lastHeightDp > 0f) + "}";
            QuickJsEngine.EvalResult r = QuickJsEngine.eval(
                "typeof __proteusHostKeyboard === 'function' ? __proteusHostKeyboard(" + payload + ") : 'no-hook'");
            String ack = r.ok && r.value != null ? r.value : ("error:" + r.error);
            Log.i(TAG, "keyboard-push dp=" + lastHeightDp + " ack=" + ack);
            QuickJsEngine.nativeRunPendingJobs();
            return ack;
        } catch (Throwable t) {
            Log.w(TAG, "keyboard-push 失败：" + t.getMessage());
            return "error:" + t.getMessage();
        }
    }
}
