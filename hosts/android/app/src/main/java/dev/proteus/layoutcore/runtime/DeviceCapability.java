package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/DeviceCapability.java
// ★★★App 端「设备与系统」域能力（Android 真实实现）—— 2026-10-19 · 决策 #1067
//
// 【覆盖（12 项）】device.vibrate / device.network / clipboard.read / clipboard.write /
//   device.screen / device.info / device.battery / device.orientation /
//   device.brightness.get / device.brightness.set / device.keepScreenOn / device.hevc
//
// 【为什么单列（不塞进 HostCapabilities.java）】后者已 ~560 行且是"能力分发总表"；
//   设备域有 12 个方法 + 各自的系统 API 取数/权限分支，塞进去会把它推过千行红线。
//   分发仍由 `HostCapabilities.invokeCore` 统一做（本类只回答"某个方法怎么真做"）。
//
// 【★诚实边界（逐条登记，不粉饰为"三端一致"）】
//   · **亮度**：`Settings.System.SCREEN_BRIGHTNESS` 读的是**系统**亮度（0–255 归一）；写系统亮度需要
//     `WRITE_SETTINGS` 特殊权限（用户在设置里授权）。无权限 ⇒ **抛 failed 并说明**，不静默改窗口亮度冒充。
//   · **方向**：取 `Display.getRotation()`（**屏幕旋转**，与 Web 的视口方向同义）——不是设备物理方向。
//   · **HEVC**：`MediaCodecList` 查是否有 `video/hevc` 的解码器（真实枚举，非猜测）。
//   · **网络类型**：`ConnectivityManager` + `NetworkCapabilities`（TRANSPORT_WIFI/CELLULAR）；
//     `none` = 无默认网络。★不区分 4G/5G（需 TelephonyManager 权限且跨运营商口径不一）。
//   · **剪贴板**：`ClipboardManager` 的**主剪贴板**；Android 10+ 后台读剪贴板会被系统拒绝
//     （返回空 ⇒ 本实现如实返回空串，并在 note 里说明）。
//   · **常亮**：`FLAG_KEEP_SCREEN_ON`（真窗口标志，与 wx.setKeepScreenOn 同语义）。
//   · **震动**：`Vibrator` / `VibratorManager`（API 31+），无振动马达 ⇒ 诚实 unsupported。

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.WindowManager;

import org.json.JSONObject;

public final class DeviceCapability {

    private final Activity activity;

    public DeviceCapability(Activity activity) {
        this.activity = activity;
    }

    /** 未实现/平台无此能力（供 HostCapabilities 统一转 missing 分档）。 */
    public static final class Unsupported extends RuntimeException {
        public Unsupported(String message) { super(message); }
    }

    /** 分发（返回 `{...}` 数据对象；调用方负责包 `{"ok":true,"data":…}`）。 */
    public JSONObject invoke(String method, JSONObject args) throws Exception {
        switch (method) {
            case "device.vibrate": return vibrate(args);
            case "device.network": return network();
            case "clipboard.read": return clipboardRead();
            case "clipboard.write": clipboardWrite(args); return new JSONObject();
            case "device.screen": return screen();
            case "device.info": return deviceInfo();
            case "device.battery": return battery();
            case "device.orientation": return orientation();
            case "device.brightness.get": return brightnessGet();
            case "device.brightness.set": brightnessSet(args); return new JSONObject();
            case "device.keepScreenOn": keepScreenOn(args); return new JSONObject();
            case "device.hevc": return hevc();
            default:
                throw new Unsupported("未实现的设备方法：" + method);
        }
    }

    // ────────────────────────── C6 震动 ──────────────────────────

    private JSONObject vibrate(JSONObject args) throws Exception {
        final long ms = Math.max(1, args.optLong("durationMs", 15));
        final Vibrator vib;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vib = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            vib = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vib == null || !vib.hasVibrator()) {
            throw new Unsupported("device.vibrate: 本机无振动马达");
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vib.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
            vib.vibrate(ms);
        }
        JSONObject d = new JSONObject();
        d.put("durationMs", ms);
        return d;
    }

    // ────────────────────────── C8 网络 ──────────────────────────

    private JSONObject network() throws Exception {
        ConnectivityManager cm = (ConnectivityManager) activity.getSystemService(Context.CONNECTIVITY_SERVICE);
        boolean online = false;
        String type = "none";
        if (cm != null) {
            Network n = cm.getActiveNetwork();
            NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
            if (caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                online = true;
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) type = "wifi";
                else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) type = "cellular";
                else type = "unknown";
            }
        }
        JSONObject d = new JSONObject();
        d.put("online", online);
        d.put("type", type);
        return d;
    }

    // ────────────────────────── C9 剪贴板 ──────────────────────────

    private JSONObject clipboardRead() throws Exception {
        ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
        String text = "";
        String note = null;
        if (cm != null && cm.hasPrimaryClip()) {
            ClipData clip = cm.getPrimaryClip();
            if (clip != null && clip.getItemCount() > 0) {
                CharSequence cs = clip.getItemAt(0).coerceToText(activity);
                if (cs != null) text = cs.toString();
            }
            if (text.isEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                note = "Android 10+ 后台读剪贴板会被系统拒绝（返回空）——前台读取才可靠";
            }
        }
        JSONObject d = new JSONObject();
        d.put("text", text);
        if (note != null) d.put("note", note);
        return d;
    }

    private void clipboardWrite(JSONObject args) throws Exception {
        final String text = args.optString("text", "");
        activity.runOnUiThread(() -> {
            ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("proteus", text));
        });
    }

    // ────────────────────────── C10 屏幕 / C11 设备 / C12 方向 ──────────────────────────

    private JSONObject screen() throws Exception {
        DisplayMetrics dm = new DisplayMetrics();
        Display display = activity.getWindowManager().getDefaultDisplay();
        display.getRealMetrics(dm);
        boolean landscape = activity.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        JSONObject d = new JSONObject();
        // ★单位 = **dp（密度无关像素）**，与 Web 的 CSS px 同义（不是物理 px——那会让 3x 屏出 1080 宽）
        d.put("width", Math.round(dm.widthPixels / dm.density));
        d.put("height", Math.round(dm.heightPixels / dm.density));
        d.put("dpr", (double) dm.density);
        d.put("orientation", landscape ? "landscape" : "portrait");
        return d;
    }

    private JSONObject deviceInfo() throws Exception {
        JSONObject d = new JSONObject();
        d.put("platform", "android");
        d.put("model", Build.MODEL == null ? "Android" : Build.MODEL);
        d.put("os", "Android");
        d.put("version", Build.VERSION.RELEASE == null ? String.valueOf(Build.VERSION.SDK_INT) : Build.VERSION.RELEASE);
        d.put("browser", activity.getPackageName());
        return d;
    }

    private JSONObject battery() throws Exception {
        BatteryManager bm = (BatteryManager) activity.getSystemService(Context.BATTERY_SERVICE);
        JSONObject d = new JSONObject();
        if (bm == null) {
            d.put("level", 1.0);
            d.put("charging", false);
            return d;
        }
        int pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        int status = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATUS);
        boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING
                || status == BatteryManager.BATTERY_STATUS_FULL;
        d.put("level", Math.max(0, Math.min(100, pct)) / 100.0);
        d.put("charging", charging);
        return d;
    }

    private JSONObject orientation() throws Exception {
        Display display = activity.getWindowManager().getDefaultDisplay();
        int rotation = display.getRotation();
        boolean landscape = rotation == android.view.Surface.ROTATION_90 || rotation == android.view.Surface.ROTATION_270;
        JSONObject d = new JSONObject();
        d.put("type", landscape ? "landscape" : "portrait");
        // ★角度语义对齐 Web 的 `screen.orientation.angle`：0=自然方向，90/180/270 顺时针
        int angle = rotation == android.view.Surface.ROTATION_90 ? 90
                : rotation == android.view.Surface.ROTATION_180 ? 180
                : rotation == android.view.Surface.ROTATION_270 ? 270 : 0;
        d.put("angle", angle);
        return d;
    }

    // ────────────────────────── C13 亮度 ──────────────────────────

    private JSONObject brightnessGet() throws Exception {
        int v = Settings.System.getInt(activity.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, 128);
        JSONObject d = new JSONObject();
        d.put("value", Math.max(0, Math.min(255, v)) / 255.0);
        return d;
    }

    private void brightnessSet(JSONObject args) throws Exception {
        final int raw = (int) Math.round(Math.max(0, Math.min(1, args.optDouble("value", 0.5))) * 255);
        if (!Settings.System.canWrite(activity)) {
            // ★不静默：写系统亮度是**特殊权限**（WRITE_SETTINGS）。不冒充"已生效"。
            Intent i = new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS,
                    android.net.Uri.parse("package:" + activity.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { activity.startActivity(i); } catch (Throwable ignored) { }
            throw new IllegalStateException(
                    "device.brightness.set 需要 WRITE_SETTINGS 特殊权限（已尝试打开授权页）——未修改亮度");
        }
        Settings.System.putInt(activity.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, raw);
    }

    // ────────────────────────── C83 常亮 ──────────────────────────

    private void keepScreenOn(JSONObject args) {
        final boolean on = args.optBoolean("on", true);
        activity.runOnUiThread(() -> {
            if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    // ────────────────────────── C81 HEVC ──────────────────────────

    private JSONObject hevc() throws Exception {
        boolean supported = false;
        MediaCodecList list = new MediaCodecList(MediaCodecList.REGULAR_CODECS);
        for (MediaCodecInfo info : list.getCodecInfos()) {
            if (info.isEncoder()) continue;
            for (String t : info.getSupportedTypes()) {
                if ("video/hevc".equalsIgnoreCase(t)) { supported = true; break; }
            }
            if (supported) break;
        }
        JSONObject d = new JSONObject();
        d.put("supported", supported);
        return d;
    }
}
