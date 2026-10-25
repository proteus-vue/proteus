// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/LogCapability.java
// ★★★#1225 App 能力批 1 第 2 项：`log` —— 三端日志通路的宿主实现（Android 侧）。
//
// 【为什么需要（#1212 的口径二修）】`useLog` 要的 `bridge.log(level, message, data)` 在 App 端
//   **一直没有宿主方法** ⇒ `useLog` 恒抛 `log.unsupported`。此前把它判成"零原生（A 类）"是错的：
//   A 类的判据只能是「**桥接口所需方法已存在**」，而宿主根本没有 `log.*`。
//   Android 本来就有 `android.util.Log` ⇒ 属"有平台能力、没接线"，三端各加一个方法即可。
//
// 【语义（与 Web/MP 对齐）】三个级别（log / warn / error）→ 平台日志级别；`data` 序列化后附在
//   message 之后（平台日志是单行字符串）。**不吞异常、不造假成功**：
//   参数非法 ⇒ 返错让 JS 侧看到（而不是"记了个空日志还说成功"）。
//
// 【为什么单独成文件】`HostCapabilities.java` 已有 200+ 行分派、`capability-types.ts` 等均贴棘轮基线
//   ⇒ 新能力落新文件（决策 #870 三层范式）。
package dev.proteus.layoutcore.runtime;

import org.json.JSONArray;
import org.json.JSONObject;

public final class LogCapability {
    /** 与 Android 日志 tag 长度上限（23）无关：本仓统一标签，便于 `adb logcat -s proteus-log` 过滤 */
    private static final String TAG = "proteus-log";

    private LogCapability() {}

    /**
     * 写一条日志。
     * @param args `{level: "log"|"warn"|"error", message: string, data?: any}`
     * @return `{written: true, level, bytes}`（bytes = 实际写出的字符数，供判据核对"真的到了宿主"）
     * @throws IllegalArgumentException level 非法或 message 缺失（**不静默记空日志**）
     */
    public static JSONObject write(JSONObject args) throws Exception {
        String level = args.optString("level", "log");
        String message = args.optString("message", null);
        if (message == null) throw new IllegalArgumentException("log: 缺少 message");

        StringBuilder line = new StringBuilder(message);
        // data 可选：对象/数组序列化后追加（保持与原 message 可区分）
        if (args.has("data") && !args.isNull("data")) {
            Object data = args.get("data");
            String s;
            if (data instanceof JSONObject || data instanceof JSONArray) s = data.toString();
            else s = String.valueOf(data);
            line.append(' ').append(s);
        }
        String out = line.toString();

        switch (level) {
            case "log": case "info":   android.util.Log.i(TAG, out); break;
            case "warn":  android.util.Log.w(TAG, out); break;
            case "error": android.util.Log.e(TAG, out); break;
            default: throw new IllegalArgumentException("log: 未知 level「" + level + "」（仅 log / warn / error）");
        }

        JSONObject o = new JSONObject();
        o.put("written", true);
        o.put("level", level);
        o.put("bytes", out.length());
        return o;
    }
}
