package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpTransport.java
// ★★★决策 #1160：**Android 传输栈 = OkHttp**（一次换栈同时买 HTTP/2 + 全字段读数 + HTTPDNS 接入点）
//
// 【为什么换栈（矩阵 P1 只剩的两项落点相同）】
//   `00-capability-matrix.md` §6 写着 P1 剩余两项：① HTTP/2（Android）② HTTPDNS（全端）。
//   而 `HttpURLConnection` **两项都做不到**：
//     · HTTP/2：#1155 真机实测 `server_protocols={"http/1.1":3}` —— AOSP 的 `HttpURLConnection`
//       底层虽是 `com.android.okhttp`，但**不开 h2、也不暴露协议**；
//     · HTTPDNS：没有 `Dns` 注入点。把 URL 换成 IP 会**破坏 SNI 与证书主机名校验**（不是等价方案）。
//   ⇒ 换到 OkHttp 3.14.9（选型与体积实测见 `hosts/android/thirdparty/README.md`：**+180 KB**）。
//
// 【★★换栈买到的第三样：全字段传输读数】
//   #1158 时 Android 只能给 `proto` + `ttfbMs`（平台不暴露 DNS/建连/TLS/复用）。
//   OkHttp 的 `EventListener` 把这几段摊开 ⇒ 现在 Android 与 iOS 一样是**全字段**。
//   ★口径差异如实登记：`ttfbMs` 从"连接+首字节+响应头"变成**纯首字节**
//     （`requestHeadersEnd → responseHeadersStart`）——这是变细，不是"变快"。
//
// 【★★★三条不能破的既有语义（换栈最容易静默弄坏的部分）】
//   ① **连接复用**（#1155 真回归教训）：连接池挂在 `OkHttpClient` 实例上 ⇒
//      **每请求 new client = 池归零**。⇒ 按传输配置缓存 client；per-call 的
//      timeout/redirect/读数一律走 `client.newBuilder()`（实测共享同一 ConnectionPool 与 Dispatcher）。
//   ② **唯一建连入口**（#1153 教训）：四条路径（整包/落盘/流式/上传）全部经本类，
//      不得再出现第二处 `new URL(...).openConnection()` 或 `new OkHttpClient()`。
//   ③ **零 JSON**（用户 2026-10-13 指令）：本类不解析也不产出 JSON。
//
// 【诚实边界】
//   · OkHttp 自己管 `Content-Length` / `Transfer-Encoding` / `Accept-Encoding`（自动 gzip）；
//     业务若显式设这些头会被它接管——已实测（见 `tests/android-okhttp-transport.test.ts` 的口径说明）。
//   · **`Content-Type` 有两个来源**（显式头 / `RequestBody` 的 MediaType）且实测是**显式头优先**；
//     为免"两处各一份漂移"，本仓口径 = 内容类型**只放 `cfg.contentType`**、头里剔掉（见上传路径）。
//   · `reused` 是**per-call 口径**：多跳重定向时取"任一跳是否新建连接"，
//     `dnsMs/connectMs/tlsMs` 取**末跳**（中间跳的建连时间不累加）。
//   · OkHttp 3.x 已停止维护线（安全修复不回移）；升 4.x 的代价见 thirdparty/README.md。

import java.io.InputStream;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Dns;
import okhttp3.EventListener;
import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Android 宿主的**唯一传输入口**（OkHttp）。
 *
 * <p>一次请求的生命周期：
 * <ol>
 *   <li>{@link #newCall} 取 per-call 配置好的 {@link Call}（共享进程级连接池）；</li>
 *   <li>{@link #execute} 发出并拿到 {@link Response}；</li>
 *   <li>{@link #transport} 读回本次调用的传输读数（EventListener 采集）。</li>
 * </ol>
 */
public final class HttpTransport {

    private HttpTransport() { }

    /** 回调式请求体（上传路径用：边读文件边写，内存只有缓冲块）。 */
    public interface BodyWriter {
        /** 内容类型（可为 null ⇒ 不设）；★必须经此传入，显式同名头会被 OkHttp 忽略。 */
        MediaType contentType();
        /** 已知总长；-1 ⇒ 用分块。 */
        long contentLength();
        /** 写体（**在 OkHttp 的 IO 线程上同步执行**，不得触碰 JS）。 */
        void writeTo(okio.BufferedSink sink) throws java.io.IOException;
    }

    /* ══════════════════ ★★★客户端缓存（连接复用的前提） ══════════════════ */

    /**
     * 进程级 client 缓存。
     *
     * <p>【为什么必须缓存（#1155 的真回归教训）】`OkHttpClient` 持有 `ConnectionPool`；
     * 每请求 new 一个 ⇒ 每个 client 一个池 ⇒ **连接复用归零**，且没有任何报错
     * （正是 #1154 踩过的形态：pinning 每请求新建 `SSLContext` ⇒ 池按 factory 分桶 ⇒ 3/3）。
     *
     * <p>缓存键 = 影响**连接身份**的配置：pinning 指纹 + pinOnly + 自定义 DNS。
     * timeout / redirect / EventListener 等 per-call 项**不进键**（它们经 `newBuilder()` 派生）。
     */
    private static final Map<String, OkHttpClient> CLIENTS = new ConcurrentHashMap<>();

    /** 构造 client 的次数（判据读它证明"没有每请求新建"）。 */
    private static final java.util.concurrent.atomic.AtomicInteger CLIENTS_CREATED =
            new java.util.concurrent.atomic.AtomicInteger(0);

    public static int clientsCreated() { return CLIENTS_CREATED.get(); }

    /**
     * HTTPDNS 接入点（★★本单只做 seam：业务 API + 线格式 tag 属下一单）。
     *
     * <p>为 null ⇒ 用系统 DNS（`Dns.SYSTEM`）。非 null ⇒ 域名解析走注入实现。
     * ★这是 `HttpURLConnection` **根本给不了**的接入点（它没有 Dns 注入）。
     * ★注入的解析器**必须返回 IP 列表**；SNI 与证书主机名校验仍用原域名（OkHttp 保证）。
     */
    private static volatile HttpDns httpDns = null;

    /** 自定义 DNS 的契约（返回该域名对应的 IP 列表；空列表 = 解析失败）。 */
    public interface HttpDns {
        List<InetAddress> lookup(String hostname) throws UnknownHostException;
    }

    /**
     * 安装/清除 HTTPDNS 解析器（进程级）。
     *
     * <p>★清除后**新建**的 client 才用系统 DNS——已缓存的 client 不可变（OkHttp 的 client 是 immutable）。
     * 因此安装/清除会**清空 client 缓存**（下一次请求重建，代价一次建连）。
     */
    public static void setHttpDns(HttpDns dns) {
        httpDns = dns;
        CLIENTS.clear();
    }

    /** DNS 记账（判据读它证明"注入的解析器真的被调用"）。 */
    private static volatile int dnsLookups = 0;
    private static volatile String lastDnsHost = null;

    public static int dnsLookupCount() { return dnsLookups; }
    public static String lastDnsHost() { return lastDnsHost; }

    /* ══════════════════ ★★★per-call 配置 ══════════════════ */

    /**
     * 一次请求的传输配置（由帧解码而来）。
     *
     * <p>★所有 per-call 项集中在此，不散落在四条路径里——这样"新加一个传输策略"只需改一处
     * （#1153 的"唯一建连入口"纪律）。
     */
    public static final class CallConfig {
        public String url;
        public String method = "GET";
        public int timeoutMs = 15000;
        /** 帧里的 pin 串（换行分隔 SPKI base64）；null/空 ⇒ 不做 pinning。 */
        public String tlsPins;
        public boolean tlsPinOnly;
        /** true ⇒ **不跟随**重定向（交回 JS 逐步处理，#1134）。 */
        public boolean redirectManual;
        /** 调用方请求头（已剔除框架内部头）。 */
        public final LinkedHashMap<String, String> headers = new LinkedHashMap<>();
        /** 请求体；null ⇒ 无体。 */
        public byte[] body;
        /** 请求体的内容类型（写进 RequestBody，**不是**同名头）。 */
        public String contentType;
        /** 非 null ⇒ 用回调式请求体（上传路径：边读文件边写）。 */
        public BodyWriter bodyWriter;
        /** 取消/读数归属键（帧的 reqId）。 */
        public String tag;
    }

    /**
     * 取一条**已配置好但未发出**的调用。
     *
     * <p>★per-call 的 timeout / redirect / EventListener 走 `newBuilder()`：
     * 实测（`newBuilder()` 后 `connectionPool() == 原池`）共享同一连接池与调度器 ⇒ 不影响复用。
     */
    public static Call newCall(CallConfig cfg) {
        OkHttpClient client = clientFor(cfg);
        Request req = buildRequest(cfg);
        // ★★★#1134 语义必须保留：`redirectManual` ⇒ **宿主不跟随**，把 3xx 交回 JS 逐步处理。
        //   ★这是 per-call 项（不进 client 缓存键）：`newBuilder()` 实测共享同一 ConnectionPool。
        //   ★漏了这一行的后果是"JS 以为自己在逐跳处理、实际宿主已经跟完了"——open-redirect 凭据泄露
        //     正是这条路径要防的（#1134 的立单理由）。
        OkHttpClient callClient = client.newBuilder()
                .followRedirects(!cfg.redirectManual)
                .connectTimeout(cfg.timeoutMs, TimeUnit.MILLISECONDS)
                .readTimeout(cfg.timeoutMs, TimeUnit.MILLISECONDS)
                .writeTimeout(cfg.timeoutMs, TimeUnit.MILLISECONDS)
                .build();
        return callClient.newCall(req);
    }

    /** 发出并返回响应（**阻塞**；调用方保证不在 JS 线程上跑）。 */
    public static Response execute(Call call) throws java.io.IOException {
        return call.execute();
    }

    /** 从一次调用上摘下发起的 reqId（取消通道用；未设置 ⇒ null）。 */
    public static String tagOf(Call call) {
        Object t = call.request().tag(String.class);
        return t instanceof String ? (String) t : null;
    }

    /* ══════════════════ 构建 ══════════════════ */

    /** 缓存键：只含**影响连接身份**的项（见 {@link #CLIENTS} 的注释）。 */
    private static String clientKey(CallConfig cfg) {
        String pins = cfg.tlsPins == null ? "" : cfg.tlsPins;
        boolean hasDns = httpDns != null;
        return pins + "|" + cfg.tlsPinOnly + "|" + hasDns;
    }

    private static OkHttpClient clientFor(CallConfig cfg) {
        String key = clientKey(cfg);
        OkHttpClient cached = CLIENTS.get(key);
        if (cached != null) return cached;
        OkHttpClient created = buildClient(cfg);
        OkHttpClient prev = CLIENTS.putIfAbsent(key, created);
        if (prev == null) {
            CLIENTS_CREATED.incrementAndGet();
            return created;
        }
        return prev;
    }

    /** 真正的构造（**只在缓存未命中时**调用；不得在别处 new `OkHttpClient`）。 */
    private static OkHttpClient buildClient(CallConfig cfg) {
        OkHttpClient.Builder b = new OkHttpClient.Builder()
                // ★★★连接复用：这是进程级 client 的池（缓存命中即共享），不是 per-call
                .connectionPool(new okhttp3.ConnectionPool(8, 5, TimeUnit.MINUTES))
                // ★HTTP/2 必须显式先列（OkHttp 默认含 h2，但显式化后"删掉即回归"可被破坏性验证打红）
                .protocols(java.util.Arrays.asList(Protocol.HTTP_2, Protocol.HTTP_1_1))
                // ★重试交给框架层管线（#1133）：宿主重复发请求会让"重试次数"口径与 JS 侧不一致
                .retryOnConnectionFailure(false)
                .eventListenerFactory(new TransportListenerFactory());

        Dns dns = httpDnsSeam();
        if (dns != null) b.dns(dns);

        // ★TLS pinning：与 #1153/#1155 同一套 TrustManager（同源，不另写一份）
        TlsPinning.SslMaterial ssl = TlsPinning.sslMaterial(cfg.tlsPins, cfg.tlsPinOnly);
        if (ssl != null) b.sslSocketFactory(ssl.socketFactory, ssl.trustManager);
        return b.build();
    }

    /** 把 HTTPDNS seam 包成 OkHttp 的 `Dns`（顺带记账，判据能证明它真的被调用）。 */
    private static Dns httpDnsSeam() {
        final HttpDns impl = httpDns;
        if (impl == null) return null;
        return new Dns() {
            @Override public List<InetAddress> lookup(String hostname) throws UnknownHostException {
                dnsLookups++;
                lastDnsHost = hostname;
                List<InetAddress> out = impl.lookup(hostname);
                if (out == null || out.isEmpty()) throw new UnknownHostException("HTTPDNS 无结果：" + hostname);
                return out;
            }
        };
    }

    private static Request buildRequest(CallConfig cfg) {
        Request.Builder b = new Request.Builder().url(cfg.url).tag(String.class, cfg.tag == null ? "" : cfg.tag);
        for (Map.Entry<String, String> e : cfg.headers.entrySet()) {
            if (e.getKey() == null || e.getValue() == null) continue;
            b.header(e.getKey(), e.getValue());
        }
        RequestBody body = requestBodyOf(cfg);
        String m = cfg.method == null || cfg.method.isEmpty() ? "GET" : cfg.method;
        // ★OkHttp 的硬约束（实测）：GET/HEAD **不许**有体；POST/PUT/PATCH **必须**有体
        boolean methodAllowsBody = !("GET".equalsIgnoreCase(m) || "HEAD".equalsIgnoreCase(m));
        if (body == null && !methodAllowsBody) {
            b.method(m, null);
        } else if (body == null) {
            // 空体：仍要发 POST/PUT 之类（用长度 0 的体，而不是 null）
            b.method(m, RequestBody.create(null, new byte[0]));
        } else {
            b.method(m, body);
        }
        return b.build();
    }

    private static RequestBody requestBodyOf(final CallConfig cfg) {
        if (cfg.bodyWriter != null) {
            return new RequestBody() {
                @Override public MediaType contentType() { return cfg.bodyWriter.contentType(); }
                @Override public long contentLength() { return cfg.bodyWriter.contentLength(); }
                @Override public void writeTo(okio.BufferedSink sink) throws java.io.IOException {
                    cfg.bodyWriter.writeTo(sink);
                }
            };
        }
        if (cfg.body == null) return null;
        MediaType mt = cfg.contentType == null ? null : MediaType.parse(cfg.contentType);
        // ★必须用 byte[] 重载：`create(MediaType, String)` 会给 Content-Type 追加 `; charset=utf-8`
        //   （实测），而宿主**不得**擅自改写业务给出的内容类型。
        return RequestBody.create(mt, cfg.body);
    }

    /* ══════════════════ ★★★传输读数（EventListener） ══════════════════ */

    /**
     * 单次调用的读数累积（每个 reqId 一份；EventListener **没有** "call 结束" 的全局钩子保证顺序，
     * 所以按 `Call` 实例归集，取用时按 tag 匹配）。
     */
    static final class CallMetrics {
        long dnsStart = -1, dnsEnd = -1;
        long connectStart = -1, connectEnd = -1;
        long secureStart = -1, secureEnd = -1;
        long reqHeadersEnd = -1, respHeadersStart = -1;
        /** 本次 call 是否**新建**了连接（发生过 connectStart ⇒ 未复用）。 */
        volatile boolean connected = false;
        volatile String proto = null;
        volatile Throwable failure = null;
    }

    /** 最近若干次调用的读数（按 tag 保留；判据在 request 完成后立刻取）。 */
    private static final Map<String, CallMetrics> METRICS = new ConcurrentHashMap<>();

    /** 取走某 reqId 的读数（取走即删，防无界增长）。 */
    static CallMetrics takeMetrics(String reqId) {
        if (reqId == null || reqId.isEmpty()) return null;
        return METRICS.remove(reqId);
    }

    /**
     * ★★★#1160（独立验证抓出的泄漏）：**失败/取消路径也要清读数**。
     *
     * <p>【缺陷形态】`takeMetrics()` 只在**成功返回前**调用；而 `METRICS` 是在
     * `TransportListener` 构造时就写进去的 ⇒ DNS 失败 / 连接失败 / 超时 / 用户取消 /
     * 体积超限等异常出口都不会 remove ⇒ 长跑应用里 key（reqId 递增）**无界增长**。
     * 本类头注写着"取走即删，防无界增长"，但那只覆盖了成功路径——契约与实现不符。
     *
     * <p>⇒ 四条请求路径的 `finally` 必须调本方法（与 `takeMetrics` 幂等：先取走的再删是 no-op）。
     */
    static void dropMetrics(String reqId) {
        if (reqId == null || reqId.isEmpty()) return;
        METRICS.remove(reqId);
    }

    /** 当前在读数的条数（判据读它证明"失败路径不泄漏"）。 */
    static int pendingMetrics() { return METRICS.size(); }

    /**
     * 把读数编成线格式的 name-values（与 `TransportReadout` 同一口径：**缺键 = 不可得**）。
     *
     * @param m     读数（可为 null ⇒ 返回 null，调用方不写 tag）
     * @param proto 响应里的协议（OkHttp 的 `Protocol.toString()` 就是 `h2` / `http/1.1`）
     */
    static LinkedHashMap<String, String> readout(CallMetrics m, String proto) {
        LinkedHashMap<String, String> out = new LinkedHashMap<>();
        if (proto != null && !proto.isEmpty()) out.put("proto", proto);
        if (m == null) return out.isEmpty() ? null : out;
        // ★reused：本 call **没有**发生过 connectStart ⇒ 走的是池里的已有连接。
        //   ★不写 false 当"测不到"——这里能确定（OkHttp 的 connectStart 是"真的建连"的事件）。
        out.put("reused", m.connected ? "0" : "1");
        putMs(out, "dnsMs", m.dnsStart, m.dnsEnd);
        putMs(out, "connectMs", m.connectStart, m.connectEnd);
        putMs(out, "tlsMs", m.secureStart, m.secureEnd);   // 明文/复用 ⇒ 两端有一端为 -1 ⇒ 不写
        putMs(out, "ttfbMs", m.reqHeadersEnd, m.respHeadersStart);
        return out.isEmpty() ? null : out;
    }

    private static void putMs(Map<String, String> out, String key, long start, long end) {
        if (start <= 0 || end <= 0 || end < start) return;   // 缺一段 ⇒ 不写（不填 0）
        out.put(key, Long.toString((end - start) / 1_000_000L));
    }

    /** 每次调用一份 EventListener，按 tag 写进 {@link #METRICS}。 */
    private static final class TransportListenerFactory implements EventListener.Factory {
        @Override public EventListener create(Call call) {
            return new TransportListener(call);
        }
    }

    private static final class TransportListener extends EventListener {
        private final String reqId;
        private final CallMetrics m;

        TransportListener(Call call) {
            String t = tagOf(call);
            this.reqId = t == null ? "" : t;
            this.m = new CallMetrics();
            if (!reqId.isEmpty()) METRICS.put(reqId, m);
        }

        private long now() { return System.nanoTime(); }

        @Override public void dnsStart(Call call, String domainName) { m.dnsStart = now(); }
        @Override public void dnsEnd(Call call, String domainName, List<InetAddress> addrs) { m.dnsEnd = now(); }
        @Override public void connectStart(Call call, java.net.InetSocketAddress addr, java.net.Proxy p) {
            m.connected = true;
            if (m.connectStart < 0) m.connectStart = now();   // 多地址重试只记第一段
        }
        @Override public void connectEnd(Call call, java.net.InetSocketAddress addr, java.net.Proxy p, Protocol proto) {
            if (m.connectEnd < 0) m.connectEnd = now();
        }
        @Override public void secureConnectStart(Call call) { m.secureStart = now(); }
        @Override public void secureConnectEnd(Call call, okhttp3.Handshake h) { m.secureEnd = now(); }
        @Override public void requestHeadersEnd(Call call, Request req) { m.reqHeadersEnd = now(); }
        @Override public void responseHeadersStart(Call call) { m.respHeadersStart = now(); }
        @Override public void responseHeadersEnd(Call call, Response resp) {
            if (resp != null && resp.protocol() != null) m.proto = resp.protocol().toString();
        }
        @Override public void callFailed(Call call, java.io.IOException e) { m.failure = e; }
    }

    /* ══════════════════ 响应工具（四条路径共用） ══════════════════ */

    /** 响应头拍平（同名多值逗号连接，与 `HttpCapability.collectHeaders` 同口径）。 */
    static LinkedHashMap<String, String> collectHeaders(Headers h) {
        LinkedHashMap<String, String> out = new LinkedHashMap<>();
        if (h == null) return out;
        for (int i = 0; i < h.size(); i++) {
            String name = h.name(i);
            if (name == null || name.isEmpty()) continue;
            if (out.containsKey(name)) continue;
            out.put(name, joinAll(h.values(name)));
        }
        return out;
    }

    private static String joinAll(List<String> vals) {
        if (vals == null || vals.isEmpty()) return "";
        if (vals.size() == 1) return vals.get(0);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < vals.size(); i++) {
            if (i > 0) sb.append(", ");
            sb.append(vals.get(i));
        }
        return sb.toString();
    }

    /** 取原始 `Set-Cookie` 逐条值（回灌 cookie 存储必须逐条，不能合并）。 */
    static List<String> rawSetCookie(Headers h) {
        if (h == null) return java.util.Collections.emptyList();
        return new ArrayList<>(h.values("Set-Cookie"));
    }

    /**
     * 取响应体流。
     *
     * <p>★为什么不用 `ResponseBody.byteStream()` 后就不管 `Response`：OkHttp 要求
     * **关闭响应体**才会把连接还给池（否则连接泄漏、下次不复用）。⇒ 这里的流是
     * `response.body().byteStream()`，调用方读完必须 {@code close()}——它同时关掉响应体。
     * ★3xx 也走同一入口：OkHttp 不把"错误流"分离，`body()` 对任何状态码都有值。
     */
    static InputStream bodyStream(Response resp) {
        if (resp == null) return null;
        ResponseBody b = resp.body();
        return b == null ? null : b.byteStream();
    }
}
