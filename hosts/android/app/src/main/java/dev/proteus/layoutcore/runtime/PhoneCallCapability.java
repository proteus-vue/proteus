// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/PhoneCallCapability.java
// ★★★#1285 App 能力 C21：`makePhoneCall` —— 拨号盘唤起（Android 侧）。
//
// 【为什么需要】`usePhoneCall` 要的 `bridge.makePhoneCall(number)` 在 App 端一直没有宿主方法
//   ⇒ 恒抛 `phone-call.unsupported`。Android 本来就有 `Intent.ACTION_DIAL` ⇒ 属"有平台能力、没接线"。
//
// 【★语义边界（必须写在前面，别被读成"能打电话"）】
//   `ACTION_DIAL` **只打开拨号盘并预填号码**，不发起通话、也**不需要任何权限**。
//   返回 `{dispatched:true}` = **已交给系统**，不是"已拨出"——是否真的拨由用户在拨号盘决定。
//   ★若将来要"直接拨出"（`ACTION_CALL` + `CALL_PHONE` 权限），那是一个**不同的能力**，
//     涉及运行时权限申请与审核合规，不在本单范围，且**不得**用同一个方法名偷偷替换。
//
// 【★★号码校验（安全基线，同族 #1257）】
//   把未校验的字符串拼进 `tel:` URI 就是注入面（可带 `//`、`?`、`#` 改变 URI 结构，
//   甚至构造出额外的 Intent extra 语义）。⇒ 这里**白名单**：只允许
//   `0-9 + - ( ) space # * ,`（RFC 3966 的 tel URI 合法字符子集）。
//   ★不"清洗后放行"——非法字符直接报错，让业务知道号码有问题（静默清洗 = 打到错的号）。
//
// 【为什么单独成文件】`HostCapabilities.java` 已有 200+ 行分派 ⇒ 新能力落新文件（决策 #870 三层范式）。
package dev.proteus.layoutcore.runtime;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import org.json.JSONObject;

public final class PhoneCallCapability {

    private static final String TAG = "proteus-phone";

    private PhoneCallCapability() { }

    /**
     * 号码白名单：`0-9` `+` `-` `(` `)` 空格 `#` `*` `,`。
     * ★RFC 3966 允许的 tel URI 字符远不止这些，但**业务够用的最小集**越小越安全；
     *   要支持分机（`,`）与暂停（`#`）所以保留它们。
     */
    private static boolean isValidNumber(String s) {
        if (s == null) return false;
        // 长度闸：E.164 最长 15 位数字，含分隔符给到 32 足够（防把整个 payload 塞进来）
        if (s.isEmpty() || s.length() > 32) return false;
        int digits = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            boolean ok = (c >= '0' && c <= '9') || c == '+' || c == '-' || c == '(' || c == ')'
                    || c == ' ' || c == '#' || c == '*' || c == ',';
            if (!ok) return false;
            if (c >= '0' && c <= '9') digits++;
        }
        // 至少 1 位数字（只有 `+` 或 `-` 的号码没有意义）
        return digits > 0;
    }

    /**
     * `phone.call`：`{ number }` → `{ dispatched: true, uri }`
     *
     * @throws IllegalArgumentException 号码为空/含非法字符/无数字（**失败**，不是 unsupported）
     * @throws UnsupportedOperationException 设备上没有拨号应用（⇒ `missing` ⇒ JS 侧 `phone-call.unsupported`）
     */
    public static JSONObject dial(Context ctx, JSONObject args) throws Exception {
        String number = args.optString("number", "");
        if (!isValidNumber(number)) {
            // ★错误信息里**不回显原始号码**（可能是敏感数据，会进日志）
            throw new IllegalArgumentException(
                    "phone.call: 号码非法（只允许 0-9 + - ( ) 空格 # * , 且至少 1 位数字）");
        }
        // ★`tel:` 后直接拼已校验的号码（白名单保证不会被解析成别的 URI 结构）
        Uri uri = Uri.parse("tel:" + number);
        Intent intent = new Intent(Intent.ACTION_DIAL, uri);
        // ★不设 FLAG_ACTIVITY_NEW_TASK：本调用方是 Activity 上下文；设了会让拨号盘脱离本任务栈
        //
        // ★★★**不要用 `resolveActivity()` 做前置判断**（真机实测踩过，本仓第 N 次同类教训）：
        //   `targetSdk >= 30` 起有**包可见性（package visibility）**限制——`resolveActivity` /
        //   `queryIntentActivities` 会对**未在 `<queries>` 里声明**的包返回 null/过滤结果，
        //   而 `startActivity()` 本身**不受此限**（解析发生在系统侧）。
        //   实测：本机 `pm query-activities -a android.intent.action.DIAL -d tel:10086`
        //   明明找到 `com.android.contacts/.activities.TwelveKeyDialer`，而 `resolveActivity()` 返回 null
        //   ⇒ 首版据此报"设备上没有可处理拨号的 Activity"，功能在**有拨号器的设备上也不可用**。
        //   ⇒ 正确做法：直接 `startActivity`，用 `ActivityNotFoundException` 区分"真没有拨号器"。
        try {
            ctx.startActivity(intent);
        } catch (android.content.ActivityNotFoundException e) {
            // ★抛 UnsupportedOperationException（不是普通异常）：JNI 会转成 missing
            //   ⇒ JS 侧得到 `phone-call.unsupported`（如实"本设备不可用"），而不是笼统的 failed。
            throw new UnsupportedOperationException("phone.call: 设备上没有可处理拨号的 Activity");
        }
        JSONObject o = new JSONObject();
        o.put("dispatched", true);
        // ★回显的是**已校验**的号码（用于真机判据核对"传进去的和拼出来的一致"）
        o.put("uri", "tel:" + number);
        return o;
    }
}
