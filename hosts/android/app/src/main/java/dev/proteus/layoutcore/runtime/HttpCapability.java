package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpCapability.java
// ★★★C26 `useFetch` 的 **Android 宿主实现**（`http.request`）—— T-app-fetch 首单 · 专项目样板
//
// 【它做什么】把 `PINV` 去程帧（见 `InvokeWire`）里的一次 HTTP 请求**真实发出去**，并把结果编成
//   `PRSP` 回程帧：
//     · 同步腿：请求已受理 ⇒ 立刻回 `{pending:true}`（**不阻塞 JS 线程**）；
//     · 异步腿：网络线程完成后 ⇒ 切**主线程**调 `QuickJsEngine.resolveHostBytes(...)` 回推最终帧。
//
// 【★为什么必须异步（不是"顺手做成异步"）】
//   ① G-39 `04-native-bridge.md` §2.1：`invokeNative(name,args): Promise<any>` —— **统一异步**（即使 Native 同步）；
//   ② 线程纪律「**Native → JS 回调必须切回 JS 线程；禁止在网络线程直接调 JS**」——QuickJS **非线程安全**
//      （同 `quickjs_jni.c` 对 `nativeDispatchGesture` 的注明）；从网络线程直接进 JS 是**未定义行为**；
//   ③ 本仓红线：**禁止任何盲等**（`pnpm check:no-blind-wait`）——在 JS 线程上同步等网络 = 最坏的盲等
//      （把 UI 与 JS 一起冻住）。⇒ 受理即返、完成再推，是唯一合法形态。
//
// 【★G-46 会话共享（用户点名一并实现）】`docs/proteus-resource-pool-plan/03-spi.md` 指定 Android 机制 =
//   **`CookieManager` + OkHttp CookieJar**。本实现用平台 `CookieManager` 单例（`WebView` 与网络栈共用
//   同一 cookie 存储 ⇒ 网页登录态与 App 请求共享）：
//     · 取：请求前 `getCookie(url)` 注入 `Cookie` 头（★**调用方已显式设 Cookie 头时不覆盖**——调用方语义优先）；
//     · 存：响应里每条 `Set-Cookie` 回灌 `setCookie`，并 `flush()` **同步落盘**（否则进程被杀即丢登录态）；
//     · ★诚实边界：`HttpOnly` 的 cookie 由 `CookieManager` 持有、**不**回给 JS（这正是 G-46 判据 `CMP089`
//       要的语义：JS 读不到会话 cookie）；登出级联清空（`CMP090+`）属 ResourcePool 门面，**本单未做**（已登记）。
//
// 【★诚实边界（不粉饰为"三端一致"）】
//   · 重定向：`HttpURLConnection` **默认跟随**（GET）；不暴露 `redirect: 'manual'`；
//   · 超时：`setConnectTimeout` / `setReadTimeout` 各自生效（不等于"总时限"，与 fetch 的 `AbortSignal.timeout`
//     语义有差）——如实登记，不谎称等价；
//   · HTTP/2 / 压缩：走平台默认（`Accept-Encoding` 由系统协商）。
//
// 【★零 JSON】（用户 2026-10-13 指令）：本文件**不解析也不产出 JSON**——帧是字节、响应体是字节。
//   响应体**原样回字节**，由 JS 侧按 `responseType` 解释（`interpretBody`）——宿主不猜业务语义。

import android.net.Uri;
import android.util.Log;
import android.webkit.CookieManager;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class HttpCapability {

    private static final String TAG = "proteus-http";

    /** 网络线程池（缓存线程：HTTP 请求是 IO 密集，线程数由并发请求数决定）。 */
    private static final ExecutorService NET = Executors.newCachedThreadPool();

    private HttpCapability() { }

    /** 单次读取块（读响应体用）。★注意：这是**单次读的缓冲量**，不是响应体总上限（见 {@link #MAX_BODY_BYTES}）。 */
    private static final int READ_CHUNK = 16 * 1024;

    /**
     * ★★★决策 #1115：**响应体硬上限**（32 MiB）。
     *
     * 【为什么必须有（#1114 的取证结论）】此前 `readAll(InputStream)` 是 `ByteArrayOutputStream`
     *   一路 `write`，**没有任何总量上限**——服务器回 500 MB 就吃掉 500 MB（再经 `[UInt8]`/`number[]`
     *   回推 JS，峰值 ×2~4）。超级应用规模下这是硬伤（大 JSON 列表 / 日志导出 / 图片直返）。
     *
     * 【为什么是 32 MiB】响应体是"一次进内存再跨界"的语义（现有帧协议是一问一答），
     *   而仓里 `FileTransferCapability` 的文件读写上限是 64 MiB——**网络响应应当更保守**
     *   （它还要再转一次数组）。取 32 MiB 使"合法但很大"的 JSON 仍可用，同时把内存峰值约束在可控区间。
     *
     * 【★与 READ_CHUNK 的区别（#1114 踩过的混淆）】`READ_CHUNK=16KB` 只决定"每次从流里读多少"，
     *   与"总共能收多少"无关；把两者混为一谈会让判据以为"已经有上限了"。
     */
    static final long MAX_BODY_BYTES = 32L * 1024 * 1024;

    /**
     * 处理一次 `http.request`（去程帧已解码）。
     *
     * @return 立刻可回的 `PRSP` 帧字节 —— 正常路径 = `{pending:true}`（受理回执）；参数非法 = 错误帧。
     */
    public static byte[] handle(InvokeWire.InvokeFrame f) {
        if (f.url == null || f.url.isEmpty()) {
            return InvokeWire.encodeResolve(InvokeWire.ResolveFrame.err(f.reqId, "http.request 需要 url（meta 里没带）"));
        }
        final String url;
        try {
            url = appendParams(f.url, f.params);
        } catch (Throwable t) {
            return InvokeWire.encodeResolve(InvokeWire.ResolveFrame.err(f.reqId, "URL 拼接失败：" + t.getMessage()));
        }
        final String method = f.httpMethod != null ? f.httpMethod : "GET";
        final int timeoutMs = f.timeoutOrDefault();

        // ★★★#1118：请求声明了流式 ⇒ 走「边读边推」路径（不整包进内存，也不受 32 MiB 上限约束）
        if (f.stream != null && f.stream) {
            NET.execute(new Runnable() {
                @Override public void run() {
                    try {
                        performStreaming(f, url, method, timeoutMs);
                    } catch (StreamAborted e) {
                        // 消费侧/队列侧主动中止：已推过的块就此为止，末帧如实报错
                        push(InvokeWire.ResolveFrame.err(f.reqId, e.getMessage()));
                    } catch (SocketTimeoutException e) {
                        push(InvokeWire.ResolveFrame.err(f.reqId, "timeout: " + e.getMessage()));
                    } catch (java.net.UnknownHostException e) {
                        push(InvokeWire.ResolveFrame.err(f.reqId, "network.unreachable: " + e.getMessage()));
                    } catch (java.net.ConnectException e) {
                        push(InvokeWire.ResolveFrame.err(f.reqId, "network.unreachable: " + e.getMessage()));
                    } catch (Throwable t) {
                        push(InvokeWire.ResolveFrame.err(f.reqId, "http.failed: " + t));
                    }
                }
            });
            return InvokeWire.encodeResolve(InvokeWire.ResolveFrame.pending(f.reqId));
        }

        NET.execute(new Runnable() {
            @Override public void run() {
                InvokeWire.ResolveFrame out;
                try {
                    out = perform(f, url, method, timeoutMs);
                } catch (BodyTooLargeException e) {
                    // ★#1115：超限是**独立错误档**（桥据此给 `fetch.tooLarge`，不混进 fetch.failed）
                    out = InvokeWire.ResolveFrame.err(f.reqId, e.getMessage());
                } catch (SocketTimeoutException e) {
                    // ★G-39 错误模型：timeout 是独立一档（桥据此给 *.timeout，而不是笼统 failed）
                    out = InvokeWire.ResolveFrame.err(f.reqId, "timeout: " + e.getMessage());
                } catch (java.net.UnknownHostException e) {
                    out = InvokeWire.ResolveFrame.err(f.reqId, "network.unreachable: " + e.getMessage());
                } catch (java.net.ConnectException e) {
                    out = InvokeWire.ResolveFrame.err(f.reqId, "network.unreachable: " + e.getMessage());
                } catch (Throwable t) {
                    out = InvokeWire.ResolveFrame.err(f.reqId, "http.failed: " + t);
                }
                push(out);
            }
        });

        // 受理回执：JS 侧 `invokeHostAsyncBytes` 见此帧 ⇒ 保持 pending 等回推（**不结算**）
        return InvokeWire.encodeResolve(InvokeWire.ResolveFrame.pending(f.reqId));
    }

    /** 真正发请求（**网络线程**上执行——本方法内绝不触碰 JS）。 */
    private static InvokeWire.ResolveFrame perform(InvokeWire.InvokeFrame f, String url, String method, int timeoutMs)
            throws Exception {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            // 跟随重定向由平台默认处理（见文件头「诚实边界」）
            conn.setInstanceFollowRedirects(true);

            if (f.headers != null) {
                for (Map.Entry<String, String> e : f.headers.entrySet()) {
                    conn.setRequestProperty(e.getKey(), e.getValue());
                }
            }
            // ★G-46：会话共享 —— 注入平台 cookie 存储里的会话 cookie（调用方已显式设 Cookie 头则不覆盖）
            String jarCookie = null;
            try {
                jarCookie = CookieManager.getInstance().getCookie(url);
            } catch (Throwable t) {
                Log.w(TAG, "读 CookieManager 失败（继续无 cookie 请求）：" + t);
            }
            if (jarCookie != null && !jarCookie.isEmpty() && f.headers != null
                    && !containsKeyIgnoreCase(f.headers, "cookie")) {
                conn.setRequestProperty("Cookie", jarCookie);
            }

            byte[] body = f.body != null ? f.body : new byte[0];
            if (body.length > 0) {
                if (f.contentType != null && !containsKeyIgnoreCase(f.headers, "content-type")) {
                    conn.setRequestProperty("Content-Type", f.contentType);
                }
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(body.length);
                OutputStream os = conn.getOutputStream();
                try {
                    os.write(body);
                    os.flush();
                } finally {
                    closeQuietly(os);
                }
            }

            int status = conn.getResponseCode();
            Map<String, List<String>> fields = conn.getHeaderFields();
            LinkedHashMap<String, String> respHeaders = collectHeaders(fields);

            // ★G-46：会话共享 —— 响应里的 Set-Cookie 回灌平台存储，并**同步 flush**（否则进程被杀即丢登录态）
            //   ★这里取**原始 List**（不经 `collectHeaders` 的逗号合并）——合并后的 Set-Cookie 无法可靠还原逐条
            storeCookies(url, rawSetCookie(fields));

            InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            // ★#1115 第一道闸：Content-Length 预判（有声明就直接拒，避免白读一遍再丢）
            long declared = -1;
            try {
                declared = conn.getContentLengthLong();
            } catch (Throwable ignored) { /* 未知长度（chunked）⇒ 交给读取时累计闸 */ }
            if (declared > MAX_BODY_BYTES) {
                throw new BodyTooLargeException(declared);
            }
            byte[] respBody = is != null ? readAll(is) : new byte[0];

            InvokeWire.ResolveFrame rf = InvokeWire.ResolveFrame.ok(f.reqId);
            rf.status = status;
            rf.headers = respHeaders;
            rf.body = respBody;
            return rf;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /* ══════════════════ ★★★#1118 流式（S3：边读边推 + 真背压） ══════════════════ */

    /**
     * 流式块大小。★与 {@link #READ_CHUNK} 分开：后者是"从流里读多少"，这里决定"回推给 JS 的粒度"。
     * 取 16 KiB：与 READ_CHUNK 同量级 ⇒ 一次读一块、推一块，不额外攒批（攒批会加延迟）。
     */
    private static final int STREAM_CHUNK = 16 * 1024;

    /**
     * ★★★**背压的实现点**：待推队列的深度上限。
     *
     * 【为什么这是真背压，而不是"限流"】读线程从 socket 读到一块 ⇒ 放进队列 ⇒ 立刻回读下一块。
     *   队列**满**时读线程在这里**阻塞**（{@link java.util.concurrent.ArrayBlockingQueue#put}）⇒
     *   不再从 socket 读 ⇒ TCP 接收窗口耗尽 ⇒ 服务器发送被内核压住。
     *   ⇒ **消费慢会真的让生产变慢**，而不是把内存越堆越多。
     *
     * 【为什么是 8】8 × 16 KiB = 128 KiB 在途。够吸收 JS 线程的抖动（一两帧的调度延迟），
     *   又不至于让"消费停了"还继续吞几 MB。
     */
    private static final int STREAM_QUEUE_DEPTH = 8;

    /** 流式被主动中止（消费侧抛错 / 队列等太久）——独立异常以便末帧给出准确原因。 */
    static final class StreamAborted extends Exception {
        StreamAborted(String msg) { super(msg); }
    }

    /** 流式通道记账（真机判据读它证明"边读边推 + 背压真的发生过"）。 */
    static final class StreamStats {
        volatile int chunks = 0;
        volatile long bytes = 0;
        volatile int maxQueued = 0;
        /** 读线程因队列满而阻塞的累计次数（> 0 = 背压真的发生过） */
        volatile int backpressureWaits = 0;
        volatile long backpressureMs = 0;
        volatile boolean completed = false;
        volatile String error = null;
    }

    private static StreamStats lastStreamStats = new StreamStats();

    /** 最近一次流式的记账（判据出口；每次流式开始时重置）。 */
    public static StreamStats lastStreamStats() { return lastStreamStats; }

    /**
     * 边读边推：每块编成 `PRSP` 帧（带 `streamSeq`）推给 JS，最后推一帧无 seq 的最终帧。
     *
     * 【线程】本方法在**网络线程**上跑。`push` 内部切主线程（G-39 线程纪律）。
     * 【★推的顺序保证】所有回推都经 {@link #push} 的 `Handler.post`（主线程单队列）⇒ 到达 JS 的
     *   顺序 = 入队顺序。故 seq 0,1,2… 在 JS 侧必然连续（丢帧只可能来自宿主内部 bug）。
     */
    private static void performStreaming(InvokeWire.InvokeFrame f, String url, String method, int timeoutMs)
            throws Exception {
        final StreamStats stats = new StreamStats();
        lastStreamStats = stats;
        HttpURLConnection conn = null;
        final java.util.concurrent.ArrayBlockingQueue<byte[]> q =
                new java.util.concurrent.ArrayBlockingQueue<>(STREAM_QUEUE_DEPTH);

        /** 消费者：从队列取块 → 编码 → 切主线程回推。★与读线程**并行** ⇒ 队列才是解耦点。 */
        final Thread consumer = new Thread(new Runnable() {
            @Override public void run() {
                int seq = 0;
                try {
                    while (true) {
                        byte[] chunk = q.take();
                        if (chunk == SENTINEL) break;
                        if (chunk.length == 0) continue;
                        InvokeWire.ResolveFrame rf = InvokeWire.ResolveFrame.ok(f.reqId);
                        rf.pending = true;      // ★块帧不结算
                        rf.streamSeq = seq;     // ★有 seq = 数据块
                        rf.body = chunk;
                        // ★★★#1118：等主线程**真的把这个块交给 JS** 之后才取下一块 ⇒
                        //   消费慢 ⇒ 队列满 ⇒ 读线程阻塞 ⇒ 真背压（否则积压跑到无界消息队列里）
                        pushAndWait(rf);
                        stats.chunks++;
                        stats.bytes += chunk.length;
                        seq++;
                    }
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            }
        }, "proteus-http-stream-consumer");
        consumer.start();

        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setInstanceFollowRedirects(true);
            if (f.headers != null) {
                for (Map.Entry<String, String> e : f.headers.entrySet()) {
                    conn.setRequestProperty(e.getKey(), e.getValue());
                }
            }
            String jarCookie = null;
            try { jarCookie = CookieManager.getInstance().getCookie(url); } catch (Throwable t) {
                Log.w(TAG, "读 CookieManager 失败（继续无 cookie 请求）：" + t);
            }
            if (jarCookie != null && !jarCookie.isEmpty() && !containsKeyIgnoreCase(f.headers, "cookie")) {
                conn.setRequestProperty("Cookie", jarCookie);
            }
            byte[] reqBody = f.body != null ? f.body : new byte[0];
            if (reqBody.length > 0) {
                if (f.contentType != null && !containsKeyIgnoreCase(f.headers, "content-type")) {
                    conn.setRequestProperty("Content-Type", f.contentType);
                }
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(reqBody.length);
                OutputStream os = conn.getOutputStream();
                try { os.write(reqBody); os.flush(); } finally { closeQuietly(os); }
            }

            int status = conn.getResponseCode();
            Map<String, List<String>> fields = conn.getHeaderFields();
            LinkedHashMap<String, String> respHeaders = collectHeaders(fields);
            storeCookies(url, rawSetCookie(fields));

            InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            byte[] buf = new byte[STREAM_CHUNK];
            int n;
            if (is != null) {
                while ((n = is.read(buf)) > 0) {
                    byte[] chunk = new byte[n];
                    System.arraycopy(buf, 0, chunk, 0, n);
                    // ★★★背压点：队列满 ⇒ 这里**阻塞**（读线程停 ⇒ socket 不再被消费 ⇒ TCP 窗口收敛）
                    long t0 = 0;
                    if (q.remainingCapacity() == 0) { t0 = System.nanoTime(); stats.backpressureWaits++; }
                    q.put(chunk);
                    if (t0 != 0) stats.backpressureMs += (System.nanoTime() - t0) / 1_000_000L;
                    int depth = q.size();
                    if (depth > stats.maxQueued) stats.maxQueued = depth;
                }
                closeQuietly(is);
            }

            // 排空后收尾：送哨兵 → 等消费者推完所有块 → 再推最终帧（★顺序错了最终帧会插到块前面）
            q.put(SENTINEL);
            consumer.join();

            InvokeWire.ResolveFrame fin = InvokeWire.ResolveFrame.ok(f.reqId);
            fin.status = status;
            fin.headers = respHeaders;
            fin.body = new byte[0];   // ★最终帧不回 body（数据块已逐块给过）
            stats.completed = true;
            push(fin);
        } catch (Throwable t) {
            stats.error = String.valueOf(t);
            try { q.put(SENTINEL); } catch (InterruptedException ignored) { }
            try { consumer.join(1000); } catch (InterruptedException ignored) { }
            throw t;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** 队列哨兵（长度 0 的私有标记；真实块不会是同一个对象引用）。 */
    private static final byte[] SENTINEL = new byte[0];

    /* ────────────────────────── 小工具 ────────────────────────── */

    /** query 参数拼接（用平台 `Uri` 编码器，避免手写百分号编码）。 */
    private static String appendParams(String url, LinkedHashMap<String, String> params) {
        if (params == null || params.isEmpty()) return url;
        Uri.Builder b = Uri.parse(url).buildUpon();
        for (Map.Entry<String, String> e : params.entrySet()) {
            b.appendQueryParameter(e.getKey(), e.getValue());
        }
        return b.build().toString();
    }

    private static boolean containsKeyIgnoreCase(Map<String, String> m, String key) {
        if (m == null) return false;
        for (String k : m.keySet()) {
            if (k != null && k.equalsIgnoreCase(key)) return true;
        }
        return false;
    }

    /**
     * 响应头拍平（同名多值取**逗号连接**——与 HTTP 语义一致，且不丢信息）。
     * ★`Set-Cookie` 的合并结果**只**用于回给 JS 看；回灌 cookie 存储走 {@link #rawSetCookie}（原始逐条）。
     */
    private static LinkedHashMap<String, String> collectHeaders(Map<String, List<String>> fields) {
        LinkedHashMap<String, String> out = new LinkedHashMap<>();
        if (fields == null) return out;
        for (Map.Entry<String, List<String>> e : fields.entrySet()) {
            String name = e.getKey();
            if (name == null) continue; // 状态行（形如 "HTTP/1.1 200 OK"）——不是头
            List<String> vals = e.getValue();
            if (vals == null || vals.isEmpty()) continue;
            out.put(name, join(vals));
        }
        return out;
    }

    /** 取原始 `Set-Cookie` 逐条值（不经合并——回灌 cookie 存储必须逐条）。 */
    private static List<String> rawSetCookie(Map<String, List<String>> fields) {
        if (fields == null) return java.util.Collections.emptyList();
        for (Map.Entry<String, List<String>> e : fields.entrySet()) {
            if (e.getKey() != null && "Set-Cookie".equalsIgnoreCase(e.getKey()) && e.getValue() != null) {
                return e.getValue();
            }
        }
        return java.util.Collections.emptyList();
    }

    private static String join(List<String> vals) {
        if (vals.size() == 1) return vals.get(0);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < vals.size(); i++) {
            if (i > 0) sb.append(", ");
            sb.append(vals.get(i));
        }
        return sb.toString();
    }

    /** 把响应里的 `Set-Cookie`（逐条原始值）写进平台 cookie 存储并 flush。 */
    private static void storeCookies(String url, List<String> setCookies) {
        if (setCookies == null || setCookies.isEmpty()) return;
        try {
            CookieManager cm = CookieManager.getInstance();
            boolean touched = false;
            for (String v : setCookies) {
                if (v == null || v.isEmpty()) continue;
                cm.setCookie(url, v);
                touched = true;
            }
            if (touched) cm.flush();
        } catch (Throwable t) {
            Log.w(TAG, "写 CookieManager 失败（不影响本次响应）：" + t);
        }
    }

    private static byte[] readAll(InputStream is) throws Exception {
        // ★★★决策 #1115：**累计计数 + 超限中止**（不再无界 write）。
        //   两道闸：① 有 Content-Length 时预判（避免白读）；② 读取过程中累计（防 chunked / 谎报长度）。
        //   超限抛专用异常 ⇒ 上层映射为 `fetch.tooLarge`（**显式错误码**，不是笼统 failed，也不静默截断）。
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream(Math.max(READ_CHUNK, 8192));
            byte[] buf = new byte[READ_CHUNK];
            long total = 0;
            int n;
            while ((n = is.read(buf)) > 0) {
                total += n;
                if (total > MAX_BODY_BYTES) {
                    throw new BodyTooLargeException(total);
                }
                bos.write(buf, 0, n);
            }
            return bos.toByteArray();
        } finally {
            closeQuietly(is);
        }
    }

    /** 响应体超限（映射为 `fetch.tooLarge`——独立一档，见 #1115）。 */
    static final class BodyTooLargeException extends Exception {
        BodyTooLargeException(long atLeast) {
            super("fetch.tooLarge: 响应体超过上限 " + MAX_BODY_BYTES + "B（已读 " + atLeast + "B）");
        }
    }

    private static void closeQuietly(java.io.Closeable c) {
        try { if (c != null) c.close(); } catch (Throwable ignored) { }
    }

    /**
     * ★★★#1118：**投递并等待主线程处理完**（流式专用重载）——真背压的前提。
     *
     * 【为什么必须等】`push` 只是 `Handler.post`（异步）⇒ 若消费者 post 完立刻取下一块，
     *   队列**永远不会满**，积压会转移到**主线程的无界消息队列**里 ⇒ "有界队列"形同虚设，
     *   内存照样随响应体增长（实测：`max_queued=3`、`backpressure_waits=0`，队列从未满）。
     *   ⇒ 消费者必须等"主线程真的执行完这次回推"才取下一块。
     *
     * 【超时兜底】主线程被长时间占用（如 JS 死循环）时不能让读线程永久阻塞 ⇒
     *   `await(PUSH_ACK_TIMEOUT_MS)`；超时即放行（宁可少一次背压，也不能卡死网络线程）。
     */
    private static void pushAndWait(InvokeWire.ResolveFrame f) {
        final java.util.concurrent.CountDownLatch ack = new java.util.concurrent.CountDownLatch(1);
        pushCore(f, ack);
        try {
            ack.await(PUSH_ACK_TIMEOUT_MS, java.util.concurrent.TimeUnit.MILLISECONDS);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
    }

    /** 回推确认超时（主线程长期被占时的兜底；正常应在几十 ms 内）。 */
    private static final long PUSH_ACK_TIMEOUT_MS = 5000;

    /** ★切**主线程**回推（线程纪律：Native → JS 必须回 JS 线程；见文件头）。 */
    private static void push(InvokeWire.ResolveFrame f) {
        pushCore(f, null);
    }

    private static void pushCore(final InvokeWire.ResolveFrame f, final java.util.concurrent.CountDownLatch ack) {
        final byte[] bytes;
        try {
            bytes = InvokeWire.encodeResolve(f);
        } catch (Throwable t) {
            Log.e(TAG, "回程帧编码失败（结果丢弃，reqId=" + f.reqId + "）：" + t);
            return;
        }
        android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
        h.post(new Runnable() {
            @Override public void run() {
                try {
                    String r = QuickJsEngine.resolveHostBytes(bytes);
                    if (r != null && r.startsWith("{\"ok\":false")) {
                        Log.w(TAG, "回推未生效（JS 侧未挂 __proteusHostResolveBytes 或回调已超时）：" + r);
                    }
                } finally {
                    // ★无论成败都放行等待方（否则一次异常会永久卡住读线程）
                    if (ack != null) ack.countDown();
                }
            }
        });
    }
}
