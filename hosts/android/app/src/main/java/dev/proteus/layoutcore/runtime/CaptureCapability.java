package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/CaptureCapability.java
// ★★★决策 #1083（`useScreenCapture` · C71）：录屏/截屏状态（Android 腿）。
//
// 【Android 的诚实边界（**先取证再实现**，SDK 37 实测）】
//   · **没有**公开的"正在被录屏 / 投屏"查询 API —— `MediaProjectionManager` 只能**发起**投屏授权，
//     不能问"别人是否在录屏"。⇒ `getRecordingState` **不实现**（回执缺 `recording` 字段 ⇒ 桥给 unsupported）。
//     ★不伪造 `false`：业务会以为"确认没在录屏"，实际是"查不了"。
//   · **API 34+** 有 `Activity.registerScreenCaptureCallback` —— 它报的是**本应用窗口被用户截屏**（不是录屏）。
//   · 画中画：`Activity.isInPictureInPictureMode()` 是**本 Activity** 的状态（Android 也不允许查询别的应用
//     的窗口状态）。语义如实登记为"本应用是否在 PiP"，不冒充"屏幕上有没有别的 PiP"。
//
// 【为什么单列一个文件】`HostCapabilities` 是存量文件；本类是独立职责（平台状态查询 + 回调注册）。

import android.app.Activity;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Display;

import org.json.JSONObject;

public final class CaptureCapability {

    private final Activity activity;
    /** 截图回调（API 34+）；null = 未注册/不支持 */
    private Activity.ScreenCaptureCallback captureCb;
    /** 推 JS 的出口（壳注入；null ⇒ 只记录不推） */
    private Push push;

    /** 壳推出口（`{ userCapture: true }` → `__proteusHostCapture`） */
    public interface Push { void emit(JSONObject payload); }

    public CaptureCapability(Activity activity, Push push) {
        this.activity = activity;
        this.push = push;
    }

    public void setPush(Push p) { this.push = p; }

    /**
     * 一次取全部状态。
     * ★**只写本端真能查的字段**——缺字段 = 该能力在本端不可用（桥据此给 unsupported，不是 false）。
     */
    public JSONObject state() throws Exception {
        JSONObject o = new JSONObject();
        // recording：Android 无公开 API ⇒ **不写该字段**（诚实：不是 false）
        if (Build.VERSION.SDK_INT >= 24) {
            try {
                if (activity != null) o.put("pip", activity.isInPictureInPictureMode());
            } catch (Throwable ignored) {
                // 查询失败 ⇒ 同样不写（不伪造）
            }
        }
        // ★诊断：把"本端能查什么"如实带出（判据据它区分 unsupported 与 failed）
        o.put("recordingSupported", false);
        o.put("pipSupported", Build.VERSION.SDK_INT >= 24);
        o.put("userCaptureSupported", Build.VERSION.SDK_INT >= 34);
        return o;
    }

    /** 注册"用户截屏"回调（API 34+；幂等）。返回是否真的注册上。 */
    public boolean installUserCapture() {
        if (Build.VERSION.SDK_INT < 34 || activity == null) return false;
        if (captureCb != null) return true;
        try {
            captureCb = () -> {
                if (push == null) return;
                try {
                    JSONObject p = new JSONObject();
                    p.put("userCapture", true);
                    new Handler(Looper.getMainLooper()).post(() -> push.emit(p));
                } catch (Throwable ignored) { /* 单次推送失败不影响后续 */ }
            };
            activity.registerScreenCaptureCallback(activity.getMainExecutor(), captureCb);
            return true;
        } catch (Throwable t) {
            captureCb = null;
            return false;
        }
    }

    /** 注销（幂等）。 */
    public void uninstallUserCapture() {
        if (captureCb == null || activity == null) return;
        try { activity.unregisterScreenCaptureCallback(captureCb); } catch (Throwable ignored) { /* 已失效 */ }
        captureCb = null;
    }

    /** 本端是否支持"录屏状态"查询（恒 false——Android 无公开 API；将来开放就在此返回 true）。 */
    public boolean supportsRecordingState() { return false; }

    /** 诊断：显示器状态（**仅供判据记录**，不冒充录屏状态）。 */
    public JSONObject displayProbe() {
        JSONObject o = new JSONObject();
        try {
            if (activity == null || Build.VERSION.SDK_INT < 17) return o;
            DisplayManager dm = (DisplayManager) activity.getSystemService(Activity.DISPLAY_SERVICE);
            Display d = dm == null ? null : dm.getDisplay(Display.DEFAULT_DISPLAY);
            if (d != null) {
                o.put("displayState", d.getState());
                o.put("displayFlags", d.getFlags());
            }
        } catch (Throwable ignored) { /* 诊断失败不抛 */ }
        return o;
    }
}
