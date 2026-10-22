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
            // ★★决策 #1080：C5 传感器（订阅式 API ⇒ read = 订阅→首个采样→取消）
            case "device.sensor.read": return sensorRead(args);
            case "device.sensor.start": sensorStart(args); return new JSONObject();
            case "device.sensor.stop": sensorStop(args); return new JSONObject();
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
        // I2-ALLOW: 设备度量**报告**——`px ÷ density` 天然是小数（411.43 dp），此处不是内核下发的几何指令；
        //   内核吸附过的坐标在别处，这里的值只作为 app 读到的屏幕尺寸
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
        // I2-ALLOW: 亮度**量化**——系统设置是 0..255 整数字节（Settings.System），0..1 的浮点必须落成字节；非几何
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

    // ────────────────────────── C5 传感器（决策 #1080） ──────────────────────────

    /** 已注册的传感器监听（按 kind 复用：start/stop 幂等，多订阅共享一个系统监听） */
    private final java.util.Map<String, android.hardware.SensorEventListener> sensorListeners =
            new java.util.HashMap<>();
    /** 最近一次采样（按 kind）——read 若已有新鲜读数直接返回 */
    private final java.util.Map<String, JSONObject> sensorLast = new java.util.HashMap<>();

    /** SensorKind → Android Sensor.TYPE_* */
    private int sensorType(String kind) throws Exception {
        switch (kind) {
            case "accelerometer": return android.hardware.Sensor.TYPE_ACCELEROMETER;
            case "gyroscope": return android.hardware.Sensor.TYPE_GYROSCOPE;
            case "compass": return android.hardware.Sensor.TYPE_ORIENTATION;
            default: throw new Unsupported("device.sensor: 未知传感器 " + kind);
        }
    }

    /**
     * 一次性读取 = 订阅 → 等首个采样（有界 2s）→ 取消订阅。
     * ★为什么不能"纯读"：Android 传感器没有同步读取 API（SensorManager 只有订阅式）。
     * ★有界：2s 内无采样（设备无该传感器/未校准）⇒ 如实抛 unsupported，不返回伪造值。
     */
    private JSONObject sensorRead(JSONObject args) throws Exception {
        final String kind = args.optString("kind", "");
        final int type = sensorType(kind);
        final android.hardware.SensorManager sm =
                (android.hardware.SensorManager) activity.getSystemService(Context.SENSOR_SERVICE);
        if (sm == null) throw new Unsupported("device.sensor: 无 SensorManager");
        final android.hardware.Sensor sensor = sm.getDefaultSensor(type);
        if (sensor == null) throw new Unsupported("device.sensor: 本机无 " + kind + " 传感器");

        final Object lock = new Object();
        final JSONObject[] out = new JSONObject[1];
        android.hardware.SensorEventListener l = new android.hardware.SensorEventListener() {
            @Override public void onSensorChanged(android.hardware.SensorEvent e) {
                synchronized (lock) {
                    if (out[0] != null) return;   // 只取首个
                    try {
                        JSONObject d = new JSONObject();
                        d.put("kind", kind);
                        if (type == android.hardware.Sensor.TYPE_ORIENTATION) {
                            d.put("heading", e.values[0]);
                            d.put("x", e.values[1]);
                            d.put("y", e.values[2]);
                        } else {
                            d.put("x", e.values[0]);
                            d.put("y", e.values[1]);
                            d.put("z", e.values[2]);
                        }
                        d.put("timestamp", e.timestamp / 1000000L);
                        out[0] = d;
                    } catch (Exception ignored) { }
                    lock.notifyAll();
                }
            }
            @Override public void onAccuracyChanged(android.hardware.Sensor s, int acc) { }
        };
        sm.registerListener(l, sensor, android.hardware.SensorManager.SENSOR_DELAY_NORMAL);
        try {
            synchronized (lock) {
                long deadline = System.currentTimeMillis() + 2000;
                while (out[0] == null) {
                    long remain = deadline - System.currentTimeMillis();
                    if (remain <= 0) break;
                    lock.wait(remain);
                }
            }
        } finally {
            sm.unregisterListener(l);   // ★无论成败都取消（不泄漏监听器）
        }
        if (out[0] == null) {
            throw new IllegalStateException("device.sensor.read: 2s 内无 " + kind + " 采样（设备无该传感器或被占用）");
        }
        sensorLast.put(kind, out[0]);
        return out[0];
    }

    /** 开始持续采样（幂等；采样经 eval 推 JS 的 __proteusHostSensor）。 */
    private void sensorStart(JSONObject args) throws Exception {
        final String kind = args.optString("kind", "");
        final int type = sensorType(kind);
        if (sensorListeners.containsKey(kind)) return;   // 幂等
        final android.hardware.SensorManager sm =
                (android.hardware.SensorManager) activity.getSystemService(Context.SENSOR_SERVICE);
        if (sm == null) throw new Unsupported("device.sensor: 无 SensorManager");
        android.hardware.Sensor sensor = sm.getDefaultSensor(type);
        if (sensor == null) throw new Unsupported("device.sensor: 本机无 " + kind + " 传感器");
        android.hardware.SensorEventListener l = new android.hardware.SensorEventListener() {
            @Override public void onSensorChanged(android.hardware.SensorEvent e) {
                try {
                    JSONObject d = new JSONObject();
                    d.put("kind", kind);
                    if (type == android.hardware.Sensor.TYPE_ORIENTATION) {
                        d.put("heading", e.values[0]); d.put("x", e.values[1]); d.put("y", e.values[2]);
                    } else {
                        d.put("x", e.values[0]); d.put("y", e.values[1]); d.put("z", e.values[2]);
                    }
                    d.put("timestamp", e.timestamp / 1000000L);
                    sensorLast.put(kind, d);
                    // ★推 JS（主线程回调 ⇒ QuickJS 非线程安全，但 onSensorChanged 默认在注册线程的
                    //   Looper 上——本类注册发生在 UI 线程 ⇒ 回调在主线程，直接 eval 合法）
                    QuickJsEngine.eval("typeof __proteusHostSensor==='function'?__proteusHostSensor(" + d + "):'no-hook'");
                } catch (Throwable ignored) { }
            }
            @Override public void onAccuracyChanged(android.hardware.Sensor s, int acc) { }
        };
        sm.registerListener(l, sensor, android.hardware.SensorManager.SENSOR_DELAY_GAME);
        sensorListeners.put(kind, l);
    }

    /** 停止持续采样（幂等；不存在的 kind 静默成功）。 */
    private void sensorStop(JSONObject args) {
        String kind = args.optString("kind", "");
        android.hardware.SensorEventListener l = sensorListeners.remove(kind);
        if (l == null) return;
        android.hardware.SensorManager sm =
                (android.hardware.SensorManager) activity.getSystemService(Context.SENSOR_SERVICE);
        if (sm != null) sm.unregisterListener(l);
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
