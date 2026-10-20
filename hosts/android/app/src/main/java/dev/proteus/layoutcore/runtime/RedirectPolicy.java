package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/RedirectPolicy.java
// ★★★#1134：**重定向跟随策略**（Android 宿主的"那一小块"）——从 `HttpCapability` 抽出。
//
// 【为什么单列（两个理由，都不是"为了好看"）】
//   ① 职责：`HttpCapability` 是"把帧变成真实 HTTP 请求"，重定向**是否符合业务意图**是另一件事；
//   ② 硬约束：`HttpCapability` 已 984 行，加两个 helper 就破 1000 行门禁（`check:file-size`）。
//
// 【为什么策略只有"跟不跟"这一条（不是把整套规则搬来）】
//   跟随循环 / 限额 / 逐跳拦截 / 跨域剥离凭据 / RFC 方法改写全在 JS
//   （`packages/api/src/capability-fetch-redirect.ts`，跨端同一份）。
//   宿主越少掺和越好：宿主里没有"业务语义"，也不该有。
//
// 【★四条请求路径都必须调用本类（漏一条 = 该路径静默跟随 = open-redirect 凭据泄露）】
import java.io.InputStream;
import java.net.HttpURLConnection;

public final class RedirectPolicy {
    private RedirectPolicy() {}

    /**
     * 按去程帧的 `redirectManual` 决定**是否跟随**。
     * 缺省（null）⇒ 跟随——与改造前行为完全一致（老 JS 不发该 tag）。
     */
    public static void apply(HttpURLConnection conn, InvokeWire.InvokeFrame f) {
        boolean manual = Boolean.TRUE.equals(f.redirectManual);
        conn.setInstanceFollowRedirects(!manual);
    }

    /**
     * 取响应体流。
     *
     * ★为什么 3xx 也走 `getErrorStream`：`setInstanceFollowRedirects(false)` 下，
     *   部分实现对 3xx 调 `getInputStream()` 会抛 `IOException`，而 `getErrorStream()` 是稳定路径。
     *   我们**不关心 3xx 的 body**（业务要的是 status + Location），"能拿到流"（可空）就够。
     */
    public static InputStream bodyStream(int status, HttpURLConnection conn) throws java.io.IOException {
        return status >= 300 ? conn.getErrorStream() : conn.getInputStream();
    }
}
