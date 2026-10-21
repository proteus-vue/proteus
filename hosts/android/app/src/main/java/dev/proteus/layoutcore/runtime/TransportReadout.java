package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/TransportReadout.java
// ★★★决策 #1158：**Android 宿主侧传输读数采集**（`HttpURLConnection` 能给什么，就给什么）。
//
// 【为什么单列一个类】`HttpCapability.java` 在 #1158 之前已 990 行（`check:file-size` 硬上限 1000），
//   本轮加传输读数把它顶到 1031 行。按纪律**不抬基线**，也不把注释删掉糊弄 ⇒ 把这块独立出来。
//   ★这也不是"为过门禁而拆"：传输读数与 HTTP 请求执行是**两个关注点**
//     （前者回答"这次网络怎么走的"，后者回答"请求怎么发出去"），本来就该分开。
//
// 【★★Android 能测什么、不能测什么（都是实测结论，不是推断）】
//   · `proto`：`getHeaderFields()` 里**键为 null** 的那一项就是状态行（如 `"HTTP/1.1 200 OK"`）
//     ⇒ 取第一个空格前的 token。★`HttpCapability.collectHeaders` 已把 null 键当状态行跳过，
//     所以读它**不会**污染响应头。
//   · `ttfbMs`：从调用 `getResponseCode()` 起到它返回（含**连接建立 + 首字节 + 响应头**）。
//     ★语义如实标注：`HttpURLConnection` 不细分 TTFB 与头部时间。
//   · `reused` / `dnsMs` / `connectMs` / `tlsMs`：平台**不暴露** ⇒ **键不出现**。
//     ★绝不填 0/false —— "不可得"与"测到 0"是两件事，混了业务会据此误判
//     （例如真以为 "DNS 只花了 0ms"）。
//
// 【零外部依赖】只用 `java.util`（与 `HttpCapability` 其余部分一致，无 OkHttp 等第三方库）。

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 传输读数采集（纯静态工具；**不持有状态**）。 */
public final class TransportReadout {
    private TransportReadout() {
        // 工具类：禁止实例化
    }

    /**
     * 采集一次请求的传输读数。
     *
     * @param fields         `HttpURLConnection.getHeaderFields()`（可为 null）
     * @param ttfbStartNanos 调用 `getResponseCode()` **之前**取的 `System.nanoTime()`
     * @return null ⇒ 一项都没测到（调用方据此**不写**线格式 tag，而不是写个空对象）
     */
    public static LinkedHashMap<String, String> collect(Map<String, List<String>> fields, long ttfbStartNanos) {
        LinkedHashMap<String, String> out = new LinkedHashMap<>();
        try {
            if (fields != null) {
                List<String> statusLine = fields.get(null);
                if (statusLine != null && !statusLine.isEmpty() && statusLine.get(0) != null) {
                    String sl = statusLine.get(0).trim();
                    int sp = sl.indexOf(' ');
                    String proto = sp > 0 ? sl.substring(0, sp) : sl;
                    if (!proto.isEmpty()) out.put("proto", proto);
                }
            }
            long ms = (System.nanoTime() - ttfbStartNanos) / 1_000_000L;
            if (ms >= 0) out.put("ttfbMs", Long.toString(ms));
        } catch (Throwable ignored) {
            // ★读数失败**绝不能影响请求本身**（观测是旁路，不是主路径）
        }
        return out.isEmpty() ? null : out;
    }
}
