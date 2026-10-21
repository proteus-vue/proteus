package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/TlsPinning.java
// ★★★决策 #1153：**TLS 证书 pinning**（Android 宿主侧）——P1 里唯一**不需要换栈**的一项。
//
// 【为什么单独一个类（而不是塞进 HttpCapability）】
//   `HttpCapability` 已 988 行（`check:file-size` 棘轮：存量只减不增）；
//   而 pinning 是一块**完全内聚**的职责（构造 TrustManager + 校验 SPKI 指纹），
//   与"发请求/读响应/落盘/流式"没有耦合 ⇒ 抽出来既回落棘轮也便于单独判据。
//
// 【★★实现口径：钉 SPKI，不钉整张证书】
//   钉整张证书在**续期**（同一密钥）时指纹就变 ⇒ 每次续期都得改业务代码；
//   SPKI（SubjectPublicKeyInfo）跨续期稳定，且能覆盖"链上任意一张证书"（含中间 CA）。
//   ⇒ 对链上每张证书都算 `SHA-256(cert.getPublicKey().getEncoded())`，任一命中即通过。
//   ★`getPublicKey().getEncoded()` 返回的正是 **DER 编码的 SPKI**（X.509 标准结构），
//     与 openssl 的 `x509 -pubkey | openssl pkey -pubin -outform der` 或
//     `openssl x509 -in cert.pem -noout -pubkey` 得到的字节**一致**（判据里用 openssl 生成期望值交叉验证）。
//
// 【★两种信任语义（与 `MetaTagInvoke.PinOnly` 对应）】
//   · **叠加**（缺省）：默认 TrustManager 仍要过（系统信任）**且** pin 要命中。
//     实现 = 用平台 `TrustManagerFactory` 拿到默认 X509TrustManager 做代理，再叠一层 pin 校验。
//     ★这样"自签/私有 CA"拿不到机会，pin 只是额外一道防线。
//   · **替代**（`tlsPinOnly = true`）：只看 pin（仍做主机名校验，由 `HttpsURLConnection` 负责）。
//     用途：企业内网自签证书（默认 TrustManager 必然拒 ⇒ 不替代就永远用不上 pin）。
//     ★它**放宽**了信任锚 ⇒ 只由业务显式开启。
//
// 【诚实边界】
//   · 主机名校验不在本类做：`HttpsURLConnection` 在握手后自己做（`HostnameVerifier` 默认实现），
//     本类只负责"链是否可信"。★若将来要放宽主机名，那是另一个开关，不该混进 pinning。
//   · 不校验证书过期/吊销之外的东西：代理默认 TrustManager 时这些由系统做；
//     `pinOnly` 模式下**只**校验 pin（过期/吊销不再校验）——这是"只看 pin"的必然含义，如实登记。
//   · 指纹比较用**定长比较**（`MessageDigest.isEqual`）而非 `Arrays.equals`：
//     后者会提前返回，理论上有时序侧信道（虽在证书校验场景影响有限，但用标准做法零成本）。

import android.util.Log;

import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

public final class TlsPinning {

    private static final String TAG = "proteus-tls";

    private TlsPinning() { }

    /** pin 校验失败（独立异常类型 ⇒ 上层能映射成 `fetch.tlsError` 而不是笼统 failed）。 */
    public static final class PinMismatchException extends CertificateException {
        PinMismatchException(String msg) { super(msg); }
    }

    /**
     * 把帧里的指纹串解析成规范化的 base64 列表。
     * 接受：换行 / 逗号 / 空白分隔（业务侧三种写法都见过；线格式统一是换行）。
     * ★去掉 base64 里的空白（有些工具输出带换行）；去掉 `sha256/` 前缀（HPKP 风格）。
     * ★不在此处校验 base64 合法性——非法的指纹在比较时自然不命中，且**不会**被当成"空 pin 列表"
     *   （空列表 = 不做 pinning，那会**静默降级**成无保护，比报错危险得多）。
     */
    static List<byte[]> parsePins(String raw) {
        List<byte[]> out = new ArrayList<>();
        if (raw == null || raw.isEmpty()) return out;
        for (String part : raw.split("[\\s,]+")) {
            String p = part.trim();
            if (p.isEmpty()) continue;
            // HPKP 风格 `sha256/xxxx` ⇒ 取后半段
            // ★★不能按"第一个 /"切：base64 字母表**含 `/`**，按任意 `/` 切会把指纹截断
            //   （判据里就有一张指纹带 `/`，TS 侧同款缺陷当场被抓出）。只认确切算法前缀。
            String lower = p.toLowerCase(java.util.Locale.ROOT);
            if (lower.startsWith("sha256/")) p = p.substring("sha256/".length());
            else if (lower.startsWith("sha-256/")) p = p.substring("sha-256/".length());
            try {
                byte[] digest = Base64.getDecoder().decode(p);
                if (digest.length > 0) out.add(digest);
            } catch (Throwable t) {
                Log.w(TAG, "忽略无法解析的 pin（不影响其它指纹）：" + p);
            }
        }
        return out;
    }

    /** 对一张证书算 SHA-256(SPKI) —— 这就是 pin 的字节口径（与 openssl 的 DER pubkey 一致）。 */
    static byte[] spkiSha256(X509Certificate cert) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        return md.digest(cert.getPublicKey().getEncoded());
    }

    /** 链上任一证书的 SPKI 命中任一 pin ⇒ 通过。 */
    static boolean chainMatches(List<byte[]> pins, X509Certificate[] chain) throws Exception {
        for (X509Certificate cert : chain) {
            byte[] digest = spkiSha256(cert);
            for (byte[] pin : pins) {
                // ★定长比较（不做提前返回）
                if (MessageDigest.isEqual(digest, pin)) return true;
            }
        }
        return false;
    }

    /**
     * 造一个带 pinning 的 `SSLSocketFactory`。
     *
     * @param pinsRaw 帧里的指纹串（换行分隔）
     * @param pinOnly true ⇒ 替代系统信任；false ⇒ 叠加
     * @return `null` ⇒ **没有可用 pin**（调用方应保持平台默认行为，而不是"用了但没生效"）
     */
    public static SSLSocketFactory socketFactory(String pinsRaw, boolean pinOnly) {
        List<byte[]> pins = parsePins(pinsRaw);
        // ★空 pin 列表 ⇒ 返回 null（**不**返回一个"什么都不校验"的 factory——那会静默降级成无保护）
        if (pins.isEmpty()) {
            Log.w(TAG, "tlsPins 为空/无法解析 ⇒ 不做 pinning（保持平台默认信任链）");
            return null;
        }
        try {
            // 叠加模式需要系统默认 TrustManager 做代理；替代模式不需要
            final X509TrustManager system = pinOnly ? null : defaultTrustManager();
            final X509TrustManager pinningTm = new X509TrustManager() {
                @Override public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                    // 客户端证书（mTLS）不在本能力范围内：原样交给系统（未配置则系统会拒）
                    if (system != null) system.checkClientTrusted(chain, authType);
                }

                @Override public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                    synchronized (TlsPinning.class) { stChallenges++; }
                    note("pins");
                    // ① 叠加模式：系统信任必须先过（自签/私有 CA 在这里就被挡住）
                    if (system != null) system.checkServerTrusted(chain, authType);
                    // ② pin 必须命中
                    boolean ok;
                    try {
                        ok = chainMatches(pins, chain);
                    } catch (Exception e) {
                        note("reject");
                        throw new CertificateException("pin 校验异常：" + e);
                    }
                    if (!ok) {
                        note("reject");
                        throw new PinMismatchException(
                                "证书公钥指纹不匹配（pin 未命中）：链上 " + chain.length + " 张证书都不匹配任何 pin");
                    }
                    note("accept");
                }

                @Override public X509Certificate[] getAcceptedIssuers() {
                    return system != null ? system.getAcceptedIssuers() : new X509Certificate[0];
                }
            };
            SSLContext ctx = SSLContext.getInstance("TLS");
            ctx.init(null, new TrustManager[] { pinningTm }, null);
            return ctx.getSocketFactory();
        } catch (Throwable t) {
            // ★造不出来 ⇒ 返回 null（保持默认信任链）+ 记日志；**不**让请求带着半个配置发出去
            Log.w(TAG, "构造 pinning SSLSocketFactory 失败（保持平台默认）：" + t);
            return null;
        }
    }

    /**
     * ★★★#1153：**建立连接并挂上传输策略**（`http.request` 四条路径的唯一入口）。
     *
     * · 非 HTTPS ⇒ pinning **忽略**（对明文无意义；"禁止明文"是另一个策略，不在这里隐式做）；
     * · 帧里没有 pins ⇒ 什么都不做（保持平台默认信任链）；
     * · pin 串无法解析 ⇒ `socketFactory` 返回 null ⇒ 保持平台默认**并记日志**（不静默假装生效）。
     */
    public static java.net.HttpURLConnection open(InvokeWire.InvokeFrame f, String url) throws Exception {
        java.net.HttpURLConnection conn = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
        applyTo(conn, f);
        return conn;
    }

    /**
     * 把 pinning 挂到一条已建好的连接上。
     * ★单独暴露（不只给 `open` 用）：若将来某条路径需要自己的建连方式，也能复用挂载逻辑。
     */
    public static void applyTo(java.net.HttpURLConnection conn, InvokeWire.InvokeFrame f) {
        if (f == null || f.tlsPins == null || f.tlsPins.isEmpty()) return;
        if (!(conn instanceof javax.net.ssl.HttpsURLConnection)) return;
        javax.net.ssl.SSLSocketFactory factory = socketFactory(f.tlsPins, Boolean.TRUE.equals(f.tlsPinOnly));
        if (factory != null) ((javax.net.ssl.HttpsURLConnection) conn).setSSLSocketFactory(factory);
    }

    /** ★★★#1153：TLS 记账（真机判据读它区分"宿主没校验"与"pin 判定错"）。 */
    private static int stChallenges = 0;
    private static int stWithPins = 0;
    private static int stAccepted = 0;
    private static int stRejected = 0;

    /** 供宿主能力方法读（`http.tlsStats`）。 */
    public static java.util.Map<String, Integer> statsSnapshot() {
        synchronized (TlsPinning.class) {
            java.util.LinkedHashMap<String, Integer> m = new java.util.LinkedHashMap<>();
            m.put("challenges", stChallenges);
            m.put("with_pins", stWithPins);
            m.put("accepted", stAccepted);
            m.put("rejected", stRejected);
            m.put("default_handled", stChallenges - stWithPins);
            return m;
        }
    }

    private static void note(String kind) {
        synchronized (TlsPinning.class) {
            switch (kind) {
                case "pins": stWithPins++; break;
                case "accept": stAccepted++; break;
                case "reject": stRejected++; break;
                default: break;
            }
        }
    }

    /**
     * ★★★#1153：**错误消息归因**——四条请求路径的 catch 共用。
     *
     * @param t      捕获到的异常
     * @param prefix pin 未命中时**不**使用的原前缀（`http.failed` / `fetch.failed`）
     * @return pin 未命中 ⇒ `fetch.tlsError: ...`；否则 ⇒ `<prefix>: <t>`
     *
     * 【为什么不把所有 SSL 异常都当 tlsError】**主机名不匹配 / 系统不信任**也是 SSL 异常，
     *   但它们不是"pin 未命中"（业务看到 tlsError 会去查 pin 配置，方向就错了）。
     *   本方法只认**我们自己抛的** `PinMismatchException`（沿 cause 链找——
     *   `HttpsURLConnection` 会把它包进 `SSLHandshakeException`）⇒ 归因精确。
     */
    public static String messageOr(Throwable t, String prefix) {
        Throwable cur = t;
        int guard = 0;
        while (cur != null && guard++ < 20) {
            if (cur instanceof PinMismatchException) {
                return "fetch.tlsError: 证书 pin 校验未通过（" + cur.getMessage() + "）";
            }
            cur = cur.getCause();
        }
        return prefix + ": " + t;
    }

    /** 平台默认 X509TrustManager（叠加模式用它做代理）。 */
    private static X509TrustManager defaultTrustManager() throws Exception {
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init((KeyStore) null);
        for (TrustManager tm : tmf.getTrustManagers()) {
            if (tm instanceof X509TrustManager) return (X509TrustManager) tm;
        }
        throw new IllegalStateException("平台没有可用的 X509TrustManager");
    }
}
