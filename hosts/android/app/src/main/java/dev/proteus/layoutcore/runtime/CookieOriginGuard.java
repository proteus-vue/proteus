// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/CookieOriginGuard.java
// ★★★#1257 安全基线：**手工注入的凭据头不得跨 origin 跟随重定向**。
//
// 【它防什么（不是理论风险，是实测出来的漏洞）】
//   `HttpCapability.buildCallConfig()` 会把平台 `CookieManager` 里的会话 cookie **手工塞进请求头**。
//   而默认路径（`redirect: 'follow'` 且没有 `onRedirect`）由**宿主自己跟随重定向**——
//   JS 侧的跨域剥离（`capability-fetch-redirect.ts::nextHopConfig`）在这条路径上**根本不执行**。
//
//   实测（真实 OkHttp 3.14.9 + 两个本地服务，端口不同 = 不同 origin）：
//     请求带 `Cookie: PROTEUS_SESSION=SECRET-123` → A 返回 302 到 B → **B 收到了这个 cookie**。
//     OkHttp 的 `RetryAndFollowUpInterceptor.followUpRequest()` 只会 `removeHeader("Authorization")`，
//     **对 Cookie 不做任何处理**——因为正常用法下 cookie 该交给 `CookieJar` 按 domain/path 匹配，
//     而我们这种"手工塞头"的用法绕过了那层保护。
//
//   ⇒ 这就是「open-redirect 凭据泄露」：任何业务接口返回 302 到攻击者域，会话 cookie 白给。
//
// 【为什么放在 **network interceptor**（而不是 application interceptor）】
//   network interceptor 对**每一跳**都会执行（OkHttp 在重定向循环里重跑 network interceptors），
//   application interceptor 只在最外层执行一次 ⇒ 放在那里看不见后面的 hop。
//   ★tag 会随 `newBuilder()` 传给后续 hop（OkHttp 的 followUpRequest 基于上一跳 request 派生）。
//
// 【口径（origin = scheme + host + 有效端口）】
//   · **同源跳转** ⇒ 保留 Cookie（业务正常的路径/端内跳转不该掉登录态）
//   · **跨源跳转** ⇒ 剥掉 Cookie / Authorization / Proxy-Authorization
//   · ★含"协议降级"（https → http 同主机）也算跨源 ⇒ 必须剥（否则凭据走明文）
//
// 【诚实边界】
//   · 本类只治理**宿主跟随重定向**这条路径；`redirectManual` 路径由 JS 管线剥离（已有判据）。
//   · 纯 OkHttp API（不碰 Android 类）⇒ 可在 JVM 上用真实 jar 跑判据，见
//     `scripts/check-cookie-origin-guard.mjs`。
package dev.proteus.layoutcore;

import java.io.IOException;

import okhttp3.HttpUrl;
import okhttp3.Interceptor;
import okhttp3.Request;
import okhttp3.Response;

public final class CookieOriginGuard implements Interceptor {

    /** 本次调用**原始请求**的 origin（作为 tag 挂在 Request 上，随重定向派生）。 */
    public static final class OriginalOrigin {
        public final String value;
        public OriginalOrigin(String value) { this.value = value; }
    }

    /** 凭据类头：跨源一跳必须全部剥掉（比浏览器更严一点——宁可掉登录态，也不外泄）。 */
    private static final String[] CREDENTIAL_HEADERS = {
            "Cookie", "Cookie2", "Authorization", "Proxy-Authorization",
    };

    /** origin = scheme://host:port（端口用 OkHttp 解析出的**有效**端口，80/443 已归一）。 */
    public static String originOf(HttpUrl url) {
        if (url == null) return "";
        return url.scheme() + "://" + url.host() + ":" + url.port();
    }

    /** 目标 origin 是否与原始 origin 相同（★scheme 参与比较 ⇒ https→http 降级判为不同源）。 */
    public static boolean sameOrigin(String originalOrigin, HttpUrl target) {
        return originalOrigin != null
                && !originalOrigin.isEmpty()
                && originalOrigin.equals(originOf(target));
    }

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request req = chain.request();
        OriginalOrigin tag = req.tag(OriginalOrigin.class);
        // 没有 tag ⇒ 不是本仓的调用路径（或旧代码）⇒ **不放行凭据头**（fail-closed）：
        //   与其猜"应该没事"，不如让调用方显式带上 origin 标记。
        String original = tag == null ? "" : tag.value;
        if (!sameOrigin(original, req.url())) {
            Request.Builder b = req.newBuilder();
            for (String h : CREDENTIAL_HEADERS) b.removeHeader(h);
            return chain.proceed(b.build());
        }
        return chain.proceed(req);
    }
}
