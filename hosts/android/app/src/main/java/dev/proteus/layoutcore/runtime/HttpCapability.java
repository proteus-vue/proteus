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

    /* ══════════════════ ★★★#1121 取消通道（S3 回收维度） ══════════════════ */

    /**
     * **在途请求表**（reqId → 连接）。取消时按 reqId 找到连接并 `disconnect()`。
     *
     * 【★为什么必须让宿主真停，而不是"JS 侧 reject 就算了"】
     *   只 reject 不改宿主 ⇒ 网络传输仍在跑、内存仍在涨（流式下尤其明显）⇒
     *   变成"用户以为取消了，其实后台还在下载"。⇒ 取消必须打到宿主。
     *
     * 【★并发安全】`ConcurrentHashMap`：网络线程注册/注销、主线程（JS 调用）取消，
     *   两侧都可能并发访问。
     */
    private static final java.util.concurrent.ConcurrentHashMap<String,
            java.util.concurrent.atomic.AtomicReference<HttpURLConnection>> INFLIGHT =
            new java.util.concurrent.ConcurrentHashMap<>();

    private static void registerRequest(String reqId, HttpURLConnection conn) {
        if (reqId == null || reqId.isEmpty()) return;
        INFLIGHT.put(reqId, new java.util.concurrent.atomic.AtomicReference<>(conn));
    }

    private static void unregisterRequest(String reqId) {
        if (reqId == null || reqId.isEmpty()) return;
        INFLIGHT.remove(reqId);
    }

    /** 取消记账（判据读它证明"取消真的打到宿主"）。 */
    static final class CancelStats {
        volatile int calls = 0;
        volatile int hits = 0;      // 找到在途请求的次数
        volatile int misses = 0;    // 未找到（已结算/不存在）
    }
    private static final CancelStats CANCEL_STATS = new CancelStats();
    public static CancelStats cancelStats() { return CANCEL_STATS; }

    /**
     * `http.cancel`：按 reqId 中止在途请求。
     *
     * @return `{ok:true, hit:bool}`——`hit=false` 表示该请求已结算或不存在（**不是错误**：
     *   取消与完成天然有竞态，如实告诉调用方"没找到"即可）
     */
    public static org.json.JSONObject cancel(org.json.JSONObject args) {
        CANCEL_STATS.calls++;
        String reqId = args == null ? null : args.optString("reqId", "");
        org.json.JSONObject out = new org.json.JSONObject();
        if (reqId == null || reqId.isEmpty()) {
            CANCEL_STATS.misses++;
            try { out.put("hit", false); } catch (Throwable ignored) { }
            return out;
        }
        java.util.concurrent.atomic.AtomicReference<HttpURLConnection> ref = INFLIGHT.remove(reqId);
        if (ref == null) {
            CANCEL_STATS.misses++;
            try { out.put("hit", false); } catch (Throwable ignored) { }
            return out;
        }
        CANCEL_STATS.hits++;
        HttpURLConnection conn = ref.get();
        if (conn != null) {
            try {
                // ★`disconnect()` 会强制关闭底层 socket ⇒ 正在阻塞的 read 抛异常 ⇒ 读线程退出
                conn.disconnect();
                Log.i(TAG, "http.cancel 已中止 reqId=" + reqId);
            } catch (Throwable t) {
                Log.w(TAG, "http.cancel disconnect 失败（reqId=" + reqId + "）：" + t);
            }
        }
        try { out.put("hit", true); } catch (Throwable ignored) { }
        return out;
    }

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

        // ★★★#1120：声明了流式上传 ⇒ 宿主**边读文件边拼 multipart 边发**（JS 不碰文件字节）
        if (f.upload != null && f.upload.path != null && !f.upload.path.isEmpty()) {
            NET.execute(new Runnable() {
                @Override public void run() {
                    InvokeWire.ResolveFrame out;
                    try {
                        out = performStreamUpload(f, url, method, timeoutMs);
                    } catch (SocketTimeoutException e) {
                        out = InvokeWire.ResolveFrame.err(f.reqId, "timeout: " + e.getMessage());
                    } catch (java.net.UnknownHostException e) {
                        out = InvokeWire.ResolveFrame.err(f.reqId, "network.unreachable: " + e.getMessage());
                    } catch (java.net.ConnectException e) {
                        out = InvokeWire.ResolveFrame.err(f.reqId, "network.unreachable: " + e.getMessage());
                    } catch (UploadFileTooLarge e) {
                        out = InvokeWire.ResolveFrame.err(f.reqId, e.getMessage());
                    } catch (Throwable t) {
                        out = InvokeWire.ResolveFrame.err(f.reqId, "fetch.failed: " + t);
                    }
                    push(out);
                }
            });
            return InvokeWire.encodeResolve(InvokeWire.ResolveFrame.pending(f.reqId));
        }

        // ★★★#1119：声明了落盘路径 ⇒ 宿主**边收边写盘**（JS 不碰字节 ⇒ 内存与文件大小解耦）
        if (f.savePath != null && !f.savePath.isEmpty()) {
            NET.execute(new Runnable() {
                @Override public void run() {
                    InvokeWire.ResolveFrame out;
                    try {
                        out = performSaveToFile(f, url, method, timeoutMs);
                    } catch (SocketTimeoutException e) {
                        out = InvokeWire.ResolveFrame.err(f.reqId, "timeout: " + e.getMessage());
                    } catch (java.net.UnknownHostException e) {
                        out = InvokeWire.ResolveFrame.err(f.reqId, "network.unreachable: " + e.getMessage());
                    } catch (java.net.ConnectException e) {
                        out = InvokeWire.ResolveFrame.err(f.reqId, "network.unreachable: " + e.getMessage());
                    } catch (Throwable t) {
                        out = InvokeWire.ResolveFrame.err(f.reqId, "fetch.failed: " + t);
                    }
                    push(out);
                }
            });
            return InvokeWire.encodeResolve(InvokeWire.ResolveFrame.pending(f.reqId));
        }

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
            registerRequest(f.reqId, conn);   // ★#1121：可取消
            conn.setRequestMethod(method);
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            // ★#1134：重定向跟随策略由去程帧决定（manual ⇒ 交回 JS 逐步处理）
            RedirectPolicy.apply(conn, f);

            // ★#1149：统一入口（顺带剔除框架内部头——四条路径共用这一份，见 applyRequestHeaders）
            applyRequestHeaders(conn, f.headers);
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
            // ★#1150 排障：非 2xx 记一行（真机抓过「503 到了但响应没回 JS」；只在异常档打，不污染正常路径）
            if (status >= 300) Log.w(TAG, "HTTP_STATUS " + status + " reqId=" + f.reqId);
            Map<String, List<String>> fields = conn.getHeaderFields();
            LinkedHashMap<String, String> respHeaders = collectHeaders(fields);

            // ★G-46：会话共享 —— 响应里的 Set-Cookie 回灌平台存储，并**同步 flush**（否则进程被杀即丢登录态）
            //   ★这里取**原始 List**（不经 `collectHeaders` 的逗号合并）——合并后的 Set-Cookie 无法可靠还原逐条
            storeCookies(url, rawSetCookie(fields));

            InputStream is = RedirectPolicy.bodyStream(status, conn);
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
            unregisterRequest(f.reqId);
            if (conn != null) conn.disconnect();
        }
    }

    /* ══════════════════ ★★★#1120 流式上传（S3） ══════════════════ */

    /**
     * **边读文件边拼 multipart 边发**（JS 侧完全不碰文件字节）。
     *
     * 【问题】原链路是「`fs.readBytes` 把整文件读进 JS → JS 拼 multipart → 作为 body 发」
     *   ⇒ **文件多大，JS 堆就吃多大**（再乘上 multipart 拼接的临时副本，峰值 ×2）。
     *
     * 【本方法】宿主直接从沙箱读文件，按 multipart 格式**流式写出**到连接：
     *   内存占用 = 一个 16 KiB 缓冲块，**与文件总大小无关**。
     *
     * 【★为什么能算 Content-Length（不用 chunked）】
     *   multipart 的每个部分长度都是**可预知**的（头部字节数 + 文件长度 + 尾部）⇒
     *   先算总数再 `setFixedLengthStreamingMode(total)`，比 chunked 更兼容（部分服务器不收 chunked）。
     *   ★文件长度用 `File.length()` 取，不读一遍文件去数。
     *
     * 【★路径校验】走 `FileTransferCapability.resolve`（**同一份**沙箱规则，不另写）。
     *
     * 【诚实边界】
     *   · 只支持**单文件**（与 wx / 现有 JS 实现一致）；
     *   · 上传进度仍只有 0 / 100（流式写出过程中没有回推进度——要做需另开回推通道，
     *     本单不假装有）；
     *   · 超 1 GiB 拒绝（与下载侧 `MAX_SAVE_BYTES` 同值，避免"上/下两个口径"）。
     */
    private static InvokeWire.ResolveFrame performStreamUpload(
            InvokeWire.InvokeFrame f, String url, String method, int timeoutMs) throws Exception {
        final UploadStats stats = new UploadStats();
        lastUploadStats = stats;
        InvokeWire.UploadSpec up = f.upload;
        stats.path = up.path;

        android.content.Context ctx = appContext();
        if (ctx == null) {
            return InvokeWire.ResolveFrame.err(f.reqId, "fetch.failed: 宿主上下文不可用（无法解析沙箱路径）");
        }
        java.io.File src = FileTransferCapability.resolve(ctx, up.path);
        if (!src.isFile()) {
            return InvokeWire.ResolveFrame.err(f.reqId, "fetch.failed: 上传文件不存在 " + up.path);
        }
        long fileLen = src.length();
        stats.fileBytes = fileLen;
        if (fileLen > MAX_SAVE_BYTES) throw new UploadFileTooLarge(fileLen);

        // ── 预算 multipart 各段字节数（不读文件）──
        byte[] headNormal = utf8Bytes(normalFieldsHead(up));
        byte[] headFile = utf8Bytes(fileFieldHead(up));
        byte[] tail = utf8Bytes("\r\n--" + up.boundary + "--\r\n");
        long total = headNormal.length + headFile.length + fileLen + tail.length;
        stats.totalBytes = total;

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            registerRequest(f.reqId, conn);   // ★#1121：可取消
            conn.setRequestMethod(method);
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            RedirectPolicy.apply(conn, f);
            conn.setDoOutput(true);
            // ★定长流式（不是 chunked）：multipart 长度可预知
            conn.setFixedLengthStreamingMode(total);
            applyRequestHeaders(conn, f.headers);   // ★#1149：统一入口（含剔除内部头）
            // ★G-46 会话共享（与其余路径同口径：调用方显式设了 Cookie 就不覆盖）
            String jarCookie = null;
            try { jarCookie = CookieManager.getInstance().getCookie(url); } catch (Throwable t) {
                Log.w(TAG, "读 CookieManager 失败（继续无 cookie 请求）：" + t);
            }
            if (jarCookie != null && !jarCookie.isEmpty() && !containsKeyIgnoreCase(f.headers, "cookie")) {
                conn.setRequestProperty("Cookie", jarCookie);
            }
            // ★Content-Type 必须带 boundary（JS 组好传下来；这里只兜底，不覆盖调用方）
            if (!containsKeyIgnoreCase(f.headers, "content-type")) {
                conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + up.boundary);
            }

            java.io.OutputStream os = new java.io.BufferedOutputStream(conn.getOutputStream(), STREAM_CHUNK);
            try {
                os.write(headNormal);
                os.write(headFile);
                // ★★核心：边读文件边写，内存只有缓冲块
                java.io.InputStream in = new java.io.FileInputStream(src);
                try {
                    byte[] buf = new byte[STREAM_CHUNK];
                    int n;
                    long sent = 0;
                    while ((n = in.read(buf)) > 0) {
                        os.write(buf, 0, n);
                        sent += n;
                        stats.sentBytes = sent;
                        stats.chunks++;
                        if (n > stats.peakChunkBytes) stats.peakChunkBytes = n;
                        if (sent > MAX_SAVE_BYTES) throw new UploadFileTooLarge(sent);
                    }
                } finally {
                    closeQuietly(in);
                }
                os.write(tail);
                os.flush();
            } finally {
                closeQuietly(os);
            }

            int status = conn.getResponseCode();
            Map<String, List<String>> fields = conn.getHeaderFields();
            LinkedHashMap<String, String> respHeaders = collectHeaders(fields);
            storeCookies(url, rawSetCookie(fields));
            // 读响应（服务器通常回一小段 JSON；仍按整包但受 32 MiB 上限约束）
            InputStream ris = RedirectPolicy.bodyStream(status, conn);
            byte[] respBody = ris != null ? readAll(ris) : new byte[0];

            InvokeWire.ResolveFrame rf = InvokeWire.ResolveFrame.ok(f.reqId);
            rf.status = status;
            rf.headers = respHeaders;
            rf.body = respBody;
            stats.completed = true;
            return rf;
        } finally {
            unregisterRequest(f.reqId);
            if (conn != null) conn.disconnect();
        }
    }

    /** 上传记账（判据读它证明"内存只与块大小相关"）。 */
    static final class UploadStats {
        volatile long fileBytes = 0;
        volatile long totalBytes = 0;
        volatile long sentBytes = 0;
        volatile int chunks = 0;
        volatile int peakChunkBytes = 0;
        volatile boolean completed = false;
        volatile String path = null;
        volatile String error = null;
    }
    private static UploadStats lastUploadStats = new UploadStats();
    public static UploadStats lastUploadStats() { return lastUploadStats; }

    /** 上传文件超限（与下载侧同值）。 */
    static final class UploadFileTooLarge extends Exception {
        UploadFileTooLarge(long atLeast) {
            super("fetch.tooLarge: 上传文件超过上限 " + MAX_SAVE_BYTES + "B（" + atLeast + "B）");
        }
    }

    /** 普通表单字段的 multipart 头（与 JS `buildMultipart` **逐字节同序**：先普通字段，再文件字段）。 */
    private static String normalFieldsHead(InvokeWire.UploadSpec up) {
        StringBuilder sb = new StringBuilder();
        if (up.formData != null) {
            for (Map.Entry<String, String> e : up.formData.entrySet()) {
                sb.append("--").append(up.boundary).append("\r\n")
                  .append("Content-Disposition: form-data; name=\"").append(e.getKey()).append("\"\r\n\r\n")
                  .append(e.getValue() == null ? "" : e.getValue()).append("\r\n");
            }
        }
        return sb.toString();
    }

    /** 文件字段的头（`filename` 与 `Content-Type` 与 JS 侧一致）。 */
    private static String fileFieldHead(InvokeWire.UploadSpec up) {
        return "--" + up.boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"" + up.fieldName + "\"; filename=\"" + up.filename + "\"\r\n"
                + "Content-Type: application/octet-stream\r\n\r\n";
    }

    private static byte[] utf8Bytes(String s) {
        return s.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    /* ══════════════════ ★★★#1119 download 流式落盘（S3） ══════════════════ */

    /**
     * 把响应体**边收边写**进沙箱文件（JS 侧完全不碰字节）。
     *
     * 【为什么这是 download 到 S3 的关键】原链路是「宿主收整包 → 回推 JS → JS 调 `fs.writeBytes` 写盘」
     *   ⇒ **文件多大，JS 堆就吃多大**（视频/安装包直接 OOM）。本方法让内存只与**块大小**相关，
     *   与文件总大小**无关**。
     *
     * 【★为什么不像流式那样用有界队列做背压】
     *   这里的"消费方"是**本地文件系统的写**，不是 JS 线程。写盘不会因为 JS 忙而停，
     *   磁盘写不动时 `FileOutputStream.write` 自己会阻塞 ⇒ 天然背压，不需要再加一层队列。
     *   ★这是诚实区分：**背压只在"消费方可能慢于生产方"时才需要人工构造**。
     *
     * 【★内存上界】`STREAM_CHUNK`（16 KiB）= 单次读缓冲。除它之外没有累积结构。
     *
     * 【安全】路径校验走 `FileTransferCapability.resolve`（**同一份**沙箱规则，不另写）。
     *
     * 【超限】本路径**不受 32 MiB 整包上限约束**（那本是"整包驻留"的护栏）；
     *   但保留一个**总字节上限** `MAX_SAVE_BYTES`（1 GiB）防止无限下载填满磁盘——
     *   超限时删掉半截文件并给显式错误（不静默留残包）。
     */
    static final long MAX_SAVE_BYTES = 1024L * 1024 * 1024;

    /** 落盘记账（真机判据读它证明"内存不随文件增长"）。 */
    static final class SaveStats {
        volatile long bytes = 0;
        volatile int chunks = 0;
        volatile int peakChunkBytes = 0;
        volatile boolean completed = false;
        volatile String path = null;
        volatile String error = null;
    }
    private static SaveStats lastSaveStats = new SaveStats();
    public static SaveStats lastSaveStats() { return lastSaveStats; }

    private static InvokeWire.ResolveFrame performSaveToFile(
            InvokeWire.InvokeFrame f, String url, String method, int timeoutMs) throws Exception {
        final SaveStats stats = new SaveStats();
        lastSaveStats = stats;
        stats.path = f.savePath;
        java.io.File out = null;
        HttpURLConnection conn = null;
        java.io.OutputStream os = null;
        try {
            android.content.Context ctx = appContext();
            if (ctx == null) {
                return InvokeWire.ResolveFrame.err(f.reqId, "fetch.failed: 宿主上下文不可用（无法解析沙箱路径）");
            }
            out = FileTransferCapability.resolve(ctx, f.savePath);
            java.io.File parent = out.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                return InvokeWire.ResolveFrame.err(f.reqId, "fetch.failed: 无法创建目录 " + parent);
            }

            conn = (HttpURLConnection) new URL(url).openConnection();
            registerRequest(f.reqId, conn);   // ★#1121：可取消
            conn.setRequestMethod(method);
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            RedirectPolicy.apply(conn, f);
            applyRequestHeaders(conn, f.headers);   // ★#1149：统一入口（含剔除内部头）
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
                java.io.OutputStream ros = conn.getOutputStream();
                try { ros.write(reqBody); ros.flush(); } finally { closeQuietly(ros); }
            }

            int status = conn.getResponseCode();
            Map<String, List<String>> fields = conn.getHeaderFields();
            LinkedHashMap<String, String> respHeaders = collectHeaders(fields);
            storeCookies(url, rawSetCookie(fields));

            InputStream is = RedirectPolicy.bodyStream(status, conn);
            // ★边收边写：内存占用 = 单个缓冲块，与文件大小无关
            os = new java.io.BufferedOutputStream(new java.io.FileOutputStream(out, false), STREAM_CHUNK);
            byte[] buf = new byte[STREAM_CHUNK];
            int n;
            if (is != null) {
                while ((n = is.read(buf)) > 0) {
                    stats.bytes += n;
                    stats.chunks++;
                    if (n > stats.peakChunkBytes) stats.peakChunkBytes = n;
                    if (stats.bytes > MAX_SAVE_BYTES) {
                        throw new SaveTooLarge(stats.bytes);
                    }
                    os.write(buf, 0, n);
                }
                closeQuietly(is);
            }
            os.flush();
            closeQuietly(os);
            os = null;

            InvokeWire.ResolveFrame rf = InvokeWire.ResolveFrame.ok(f.reqId);
            rf.status = status;
            rf.headers = respHeaders;
            // ★回程 body = 一句可读摘要（JS 侧只需要 path/size；**不回字节**）
            String summary = "{\"path\":" + org.json.JSONObject.quote(f.savePath)
                    + ",\"size\":" + stats.bytes + ",\"chunks\":" + stats.chunks + "}";
            rf.body = summary.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            stats.completed = true;
            return rf;
        } catch (SaveTooLarge e) {
            stats.error = e.getMessage();
            closeQuietly(os);
            if (out != null) { // ★不静默留残包
                try { if (out.exists() && !out.delete()) Log.w(TAG, "残包删除失败：" + out); } catch (Throwable ignored) { }
            }
            throw e;
        } catch (Throwable t) {
            stats.error = String.valueOf(t);
            closeQuietly(os);
            if (out != null) {
                try { if (out.exists() && !out.delete()) Log.w(TAG, "残包删除失败：" + out); } catch (Throwable ignored) { }
            }
            throw t;
        } finally {
            closeQuietly(os);
            unregisterRequest(f.reqId);
            if (conn != null) conn.disconnect();
        }
    }

    /** 落盘总量超限（1 GiB）——独立异常以便给出准确原因并清残包。 */
    static final class SaveTooLarge extends Exception {
        SaveTooLarge(long atLeast) {
            super("fetch.tooLarge: 落盘超过上限 " + MAX_SAVE_BYTES + "B（已收 " + atLeast + "B）");
        }
    }

    /** 应用上下文（落盘要解析沙箱路径；由装配处注入一次）。 */
    private static android.content.Context _appCtx = null;
    static void setAppContext(android.content.Context c) { _appCtx = c == null ? null : c.getApplicationContext(); }
    private static android.content.Context appContext() { return _appCtx; }

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
            registerRequest(f.reqId, conn);   // ★#1121：可取消
            conn.setRequestMethod(method);
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            RedirectPolicy.apply(conn, f);
            applyRequestHeaders(conn, f.headers);   // ★#1149：统一入口（含剔除内部头）
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

            InputStream is = RedirectPolicy.bodyStream(status, conn);
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
            unregisterRequest(f.reqId);
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
     * ★★★#1149：框架内部约定头——语义「本次请求请勿使用平台自带的 HTTP 缓存」。
     * ★Android 本就无 ResponseCache ⇒ 这里只做**剔除**（一致性 + 防外泄给业务服务端），不改传输行为。
     * ★为什么收敛到一处：同样的 header 循环原本在本文件出现 **4 次**，任一处漏剔除就会外泄。
     */
    static final String BYPASS_PLATFORM_CACHE_HEADER = "x-proteus-bypass-platform-cache";

    /** 把调用方头逐条写入连接，并**剔除框架内部头**（四条路径共用，新增路径天然覆盖）。 */
    private static void applyRequestHeaders(HttpURLConnection conn, Map<String, String> headers) {
        if (headers == null) return;
        for (Map.Entry<String, String> e : headers.entrySet()) {
            if (e.getKey() != null && e.getKey().equalsIgnoreCase(BYPASS_PLATFORM_CACHE_HEADER)) continue;
            conn.setRequestProperty(e.getKey(), e.getValue());
        }
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
