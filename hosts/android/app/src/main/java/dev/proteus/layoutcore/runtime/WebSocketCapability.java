package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/WebSocketCapability.java
// ★★★决策 #1093（2026-10-19）：C27 `useWebSocket` 的 **Android 宿主实现**（`ws.open` / `ws.send` / `ws.close`）。
//
// 【为什么自己实现 RFC 6455（而不是引 OkHttp）】
//   本仓 Android 宿主是 `javac --release 17 -classpath <android.jar>` **裸编译**（无 Gradle、无依赖树），
//   本地也没有 OkHttp 的 jar/aar。而 `android.jar` 里**没有** `java.net.http.WebSocket`（那是 JDK 11 的
//   API，Android 不提供）。⇒ 要么引入第三方依赖（改构建体系，影响面大），要么用 `java.net.Socket`
//   实现客户端最小集。选后者：WebSocket 客户端握手 + 帧编解码约 300 行，且**零依赖**与现有构建方式一致。
//
// 【实现范围（诚实边界——只做客户端真正需要的子集）】
//   · 握手：HTTP/1.1 Upgrade，`Sec-WebSocket-Key` 用随机 16 字节 base64，**校验 `Sec-WebSocket-Accept`**
//     （不校验就等于"连上了但可能是别人的响应"，且服务端错误会静默变成乱码帧）。
//   · 帧：文本 / 二进制 / ping / pong / close。**分片（continuation）支持**——消息可能被拆成多帧到达，
//     FIN=0 时先累积，抓到 FIN=1 再一次性交给上层。
//   · 客户端发出的帧**必须掩码**（RFC 6455 §5.3：客户端不掩码，服务端应当断开）。
//   · 最大帧/消息体：16 MiB 上限（超限即 close 1009——不无限吃内存）。
//   · 不做：permessage-deflate 扩展协商（`Sec-WebSocket-Extensions` 不发 ⇒ 服务端不会用压缩）。
//
// 【线程纪律】I/O 全在网络线程；**任何回推 JS 都切主线程**（`QuickJsEngine` 非线程安全，
//   与 {@link HttpCapability} 同一条纪律）。`ws.open` **受理即返**（不等握手）——握手结果经
//   `__proteusHostWs({id,event:'open'|'error'})` 推给 JS。
//
// 【为什么 open 不阻塞等握手】G-39 §2.1 要求 `invokeNative` **统一异步**；在 JS 线程上等网络
//   会把 UI 与 JS 一起冻住（本仓红线：禁止任何盲等）。

import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import javax.net.ssl.SSLSocketFactory;

/**
 * C27 WebSocket 客户端（Android 宿主腿）。
 *
 * <p>生命周期：{@link #open} 分配 id 并起连接线程 → 握手成功推 {@code open} → 读循环推 {@code message}
 * → 对端关闭/本地关闭推到 {@code close}。连接表按 id 管理，close 后即移除。
 */
public final class WebSocketCapability {

    private static final String TAG = "proteus-ws";

    /** 回推 JS 的通道名（与 `capability-websocket.ts` 的 APP_WS_PUSH_KEY 一致）。 */
    public static final String PUSH_KEY = "__proteusHostWs";

    /** 单条消息上限（防一条恶意/错误帧吃掉内存）。 */
    private static final int MAX_MESSAGE = 16 * 1024 * 1024;

    private static final ExecutorService NET = Executors.newCachedThreadPool();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final ConcurrentHashMap<Integer, Conn> CONNS = new ConcurrentHashMap<>();

    /** WebSocket 握手用的 GUID（RFC 6455 §1.3 固定常量）。 */
    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    private WebSocketCapability() { }

    /**
     * 发起连接（**受理即返**）。
     *
     * @param args `{ url, protocols?: string[] }`
     * @return `{ id }`（连接结果经壳推 `open` / `error` 到达）
     */
    public static JSONObject open(JSONObject args) throws Exception {
        String url = args.optString("url", "");
        if (url.isEmpty()) throw new IllegalArgumentException("ws.open 需要 url");
        JSONArray protoArr = args.optJSONArray("protocols");
        String[] protocols = new String[protoArr == null ? 0 : protoArr.length()];
        for (int i = 0; i < protocols.length; i++) protocols[i] = protoArr.optString(i, "");

        int id = SEQ.incrementAndGet();
        Conn c = new Conn(id, url, protocols);
        CONNS.put(id, c);
        NET.execute(c::run);
        JSONObject out = new JSONObject();
        out.put("id", id);
        return out;
    }

    /** 发送（文本或二进制；**受理即返**，失败经 `error` 事件回报）。 */
    public static JSONObject send(JSONObject args) throws Exception {
        int id = args.optInt("id", 0);
        Conn c = CONNS.get(id);
        if (c == null) return missingConn(id);
        boolean binary = args.optBoolean("binaryFlag", false);
        if (binary) {
            JSONArray arr = args.optJSONArray("binary");
            if (arr == null) throw new IllegalArgumentException("ws.send 二进制需要 binary: number[]");
            byte[] b = new byte[arr.length()];
            for (int i = 0; i < b.length; i++) b[i] = (byte) arr.optInt(i, 0);
            c.enqueueBinary(b);
        } else {
            c.enqueueText(args.optString("data", ""));
        }
        return new JSONObject();
    }

    /** 关闭（**受理即返**；真实 close 帧由对端或本地发送后推回）。 */
    public static JSONObject close(JSONObject args) throws Exception {
        int id = args.optInt("id", 0);
        Conn c = CONNS.get(id);
        if (c == null) return missingConn(id);
        int code = args.optInt("code", 1000);
        String reason = args.optString("reason", "");
        c.closeFromLocal(code, reason);
        return new JSONObject();
    }

    private static JSONObject missingConn(int id) throws Exception {
        // ★不是异常：连接已关（或从未存在）⇒ 让 JS 侧拿到明确原因而非崩溃
        JSONObject o = new JSONObject();
        o.put("ok", true);
        o.put("note", "连接 " + id + " 不存在（已关闭？）");
        return o;
    }

    /** 一条连接（读/写共用同一 socket；写操作经队列串行化，避免并发写帧交错）。 */
    private static final class Conn {
        final int id;
        final String url;
        final String[] protocols;
        private final java.util.concurrent.LinkedBlockingQueue<Object> outbox = new java.util.concurrent.LinkedBlockingQueue<>();
        private volatile boolean closed = false;
        private Socket socket;
        private OutputStream out;
        private InputStream in;
        private Thread writer;

        Conn(int id, String url, String[] protocols) {
            this.id = id;
            this.url = url;
            this.protocols = protocols;
        }

        void enqueueText(String s) { outbox.offer(new Frame((byte) 0x1, s.getBytes(StandardCharsets.UTF_8))); }
        void enqueueBinary(byte[] b) { outbox.offer(new Frame((byte) 0x2, b)); }

        void closeFromLocal(int code, String reason) {
            if (closed) return;
            byte[] payload = closePayload(code, reason);
            outbox.offer(new Frame((byte) 0x8, payload));
            // ★不立刻 close socket：先让 writer 把 close 帧发出去（对端才知道我们主动关）
            NET.execute(() -> {
                try { Thread.sleep(200); } catch (InterruptedException ignored) { }
                shutdown(code, reason, true);
            });
        }

        private static byte[] closePayload(int code, String reason) {
            byte[] r = reason == null ? new byte[0] : reason.getBytes(StandardCharsets.UTF_8);
            byte[] out = new byte[2 + Math.min(r.length, 123)];
            out[0] = (byte) ((code >> 8) & 0xFF);
            out[1] = (byte) (code & 0xFF);
            System.arraycopy(r, 0, out, 2, out.length - 2);
            return out;
        }

        void run() {
            try {
                URI u = URI.create(url);
                String scheme = u.getScheme() == null ? "ws" : u.getScheme().toLowerCase(Locale.ROOT);
                if (!scheme.equals("ws") && !scheme.equals("wss")) {
                    throw new IOException("ws.open 只接受 ws:// 或 wss://（收到 " + scheme + "）");
                }
                boolean tls = scheme.equals("wss");
                String host = u.getHost();
                int port = u.getPort() > 0 ? u.getPort() : (tls ? 443 : 80);
                String path = u.getRawPath() == null || u.getRawPath().isEmpty() ? "/" : u.getRawPath();
                if (u.getRawQuery() != null) path += "?" + u.getRawQuery();

                if (tls) {
                    /**
                     * ★★★#1344 P4：**必须做主机名校验**（此前这里是真实的 MITM 漏洞）。
                     *
                     * 【缺陷形态（可对照 Android 文档复核）】原先写的是
                     *   `SSLSocketFactory.getDefault().createSocket()`（**无参**）再 `connect()`。
                     *   这条路径只做**证书链**校验（对系统 CA），**不做主机名比对** ——
                     *   `setEndpointIdentificationAlgorithm` 默认是 null。
                     *   ⇒ 任何持有**任意域名**合法证书的人都能冒充 `wss://api.bank.com`。
                     *   ★这是 Android 的经典坑：`createSocket(host, port)` 重载会自动带上
                     *     peerHost，而 `createSocket()` + `connect()` 不会。
                     *
                     * 【为什么自己设而不是换重载】`createSocket(host, port)` 没有连接超时参数，
                     *   而本端要求 15s 有界（与 http.request 同口径）⇒ 保留 `connect(timeout)`，
                     *   但**先显式设 HTTPS 端点识别**，并在 TCP 连上后**显式 startHandshake()**。
                     *
                     * 【★为什么显式 startHandshake】不显式调用时 TLS 握手是**首次读写时**惰性触发，
                     *   于是"证书不匹配"会以 `握手失败：HTTP xxx` / 读到垃圾的形式冒出来，
                     *   排查方向完全错（会以为服务端没开 WSS）。显式握手让错误归因到 TLS 层。
                     */
                    javax.net.ssl.SSLSocket s = (javax.net.ssl.SSLSocket) SSLSocketFactory.getDefault().createSocket();
                    javax.net.ssl.SSLParameters params = s.getSSLParameters();
                    params.setEndpointIdentificationAlgorithm("HTTPS");
                    s.setSSLParameters(params);
                    socket = s;
                    socket.connect(new InetSocketAddress(host, port), 15000);
                    s.startHandshake();
                } else {
                    socket = new Socket();
                    socket.connect(new InetSocketAddress(host, port), 15000);
                }
                socket.setTcpNoDelay(true);
                out = socket.getOutputStream();
                in = socket.getInputStream();

                // ── 握手 ──
                byte[] keyBytes = new byte[16];
                new Random().nextBytes(keyBytes);
                String key = Base64.encodeToString(keyBytes, Base64.NO_WRAP);
                StringBuilder req = new StringBuilder();
                req.append("GET ").append(path).append(" HTTP/1.1\r\n");
                req.append("Host: ").append(host).append(port == (tls ? 443 : 80) ? "" : ":" + port).append("\r\n");
                req.append("Upgrade: websocket\r\n");
                req.append("Connection: Upgrade\r\n");
                req.append("Sec-WebSocket-Key: ").append(key).append("\r\n");
                req.append("Sec-WebSocket-Version: 13\r\n");
                if (protocols.length > 0) {
                    req.append("Sec-WebSocket-Protocol: ").append(String.join(", ", protocols)).append("\r\n");
                }
                req.append("\r\n");
                out.write(req.toString().getBytes(StandardCharsets.UTF_8));
                out.flush();

                String resp = readHandshake(in);
                int status = parseStatus(resp);
                if (status != 101) throw new IOException("握手失败：HTTP " + status);
                String accept = headerOf(resp, "sec-websocket-accept");
                String expected = Base64.encodeToString(
                        MessageDigest.getInstance("SHA-1").digest((key + GUID).getBytes(StandardCharsets.UTF_8)),
                        Base64.NO_WRAP);
                // ★必须校验：不校验就等于接受任意响应（RFC 6455 §4.1 要求客户端验证）
                if (accept == null || !accept.trim().equals(expected)) {
                    throw new IOException("握手失败：Sec-WebSocket-Accept 不匹配");
                }
                String proto = headerOf(resp, "sec-websocket-protocol");

                pushEvent("open", "protocol", proto == null ? JSONObject.NULL : proto.trim());

                writer = new Thread(this::writeLoop, "proteus-ws-w" + id);
                writer.setDaemon(true);
                writer.start();

                readLoop();
            } catch (Throwable t) {
                Log.w(TAG, "ws " + id + " 失败：" + t);
                if (!closed) {
                    pushEvent("error", "message", String.valueOf(t.getMessage() == null ? t : t.getMessage()));
                    shutdown(1006, null, false);
                }
            }
        }

        private void writeLoop() {
            try {
                while (!closed) {
                    Object o = outbox.take();
                    if (o instanceof Frame) {
                        Frame f = (Frame) o;
                        writeFrame(out, f.opcode, f.payload);
                        if (f.opcode == 0x8) { closed = true; break; }
                    }
                }
            } catch (InterruptedException ignored) {
                // 连接关闭
            } catch (IOException e) {
                if (!closed) {
                    Log.w(TAG, "ws " + id + " 写失败：" + e);
                    pushEvent("error", "message", "写失败：" + e.getMessage());
                    shutdown(1006, null, false);
                }
            }
        }

        private void readLoop() throws IOException {
            ByteArrayOutputStream acc = null;
            int accOpcode = 0;
            while (!closed) {
                int b0 = in.read();
                if (b0 < 0) { if (!closed) shutdown(1006, null, false); return; }
                int b1 = in.read();
                if (b1 < 0) return;
                boolean fin = (b0 & 0x80) != 0;
                int opcode = b0 & 0x0F;
                boolean masked = (b1 & 0x80) != 0;
                long len = b1 & 0x7F;
                if (len == 126) {
                    len = ((long) in.read() << 8) | in.read();
                } else if (len == 127) {
                    len = 0;
                    for (int i = 0; i < 8; i++) len = (len << 8) | in.read();
                }
                if (len > MAX_MESSAGE) { closeNow(1009, "消息过大"); return; }
                byte[] mask = new byte[4];
                if (masked) readFully(in, mask, 4);
                byte[] payload = new byte[(int) len];
                readFully(in, payload, payload.length);
                // ★服务端→客户端按 RFC **不该掩码**；但个别实现会掩——按位解掩总比读出错乱数据好
                if (masked) for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

                switch (opcode) {
                    case 0x8: { // close
                        int code = payload.length >= 2 ? (((payload[0] & 0xFF) << 8) | (payload[1] & 0xFF)) : 1005;
                        String reason = payload.length > 2 ? new String(payload, 2, payload.length - 2, StandardCharsets.UTF_8) : "";
                        pushEvent("close", "code", code);
                        pushEvent("close", "reason", reason);
                        try { writeFrame(out, (byte) 0x8, closePayload(code, "")); } catch (IOException ignored) { }
                        shutdown(code, reason, false);
                        return;
                    }
                    case 0x9: // ping → pong（必须回，否则对端可能判定超时）
                        try { writeFrame(out, (byte) 0xA, payload); } catch (IOException ignored) { }
                        continue;
                    case 0xA: // pong（心跳回执，无需上报）
                        continue;
                    case 0x0: { // continuation
                        if (acc == null) continue; // 无起始帧的续帧 ⇒ 丢弃（协议违规）
                        acc.write(payload);
                        if (acc.size() > MAX_MESSAGE) { closeNow(1009, "消息过大"); return; }
                        if (fin) { deliver(accOpcode, acc.toByteArray()); acc = null; }
                        continue;
                    }
                    case 0x1: case 0x2: {
                        if (acc != null) { acc = null; } // 上一条消息未收完就被新消息打断 ⇒ 丢弃
                        if (fin) { deliver(opcode, payload); }
                        else { accOpcode = opcode; acc = new ByteArrayOutputStream(); acc.write(payload); }
                        continue;
                    }
                    default:
                        // 未定义 opcode ⇒ 协议错误（RFC 6455 §5.2）
                        closeNow(1002, "未知 opcode " + opcode);
                        return;
                }
            }
        }

        private void deliver(int opcode, byte[] payload) {
            if (opcode == 0x1) {
                pushEvent("message", "data", new String(payload, StandardCharsets.UTF_8));
            } else {
                JSONArray arr = new JSONArray();
                for (byte b : payload) arr.put(b & 0xFF);
                pushEvent("message", "binary", arr);
            }
        }

        private void closeNow(int code, String reason) {
            try { writeFrame(out, (byte) 0x8, closePayload(code, reason)); } catch (IOException ignored) { }
            shutdown(code, reason, true);
        }

        private void shutdown(int code, String reason, boolean notify) {
            if (closed) return;
            closed = true;
            CONNS.remove(id);
            try { if (socket != null) socket.close(); } catch (IOException ignored) { }
            if (notify) {
                pushEvent("close", "code", code);
                pushEvent("close", "reason", reason == null ? "" : reason);
            }
        }

        private JSONObject event(String name) {
            JSONObject o = new JSONObject();
            try {
                o.put("id", id);
                o.put("event", name);
            } catch (Exception ignored) { }
            return o;
        }

        /** ★org.json 的 put 抛**受检** JSONException，而事件构造在 I/O 循环里 ☞ 统一收口。 */
        private void pushEvent(String name, String key, Object value) {
            JSONObject o = event(name);
            try {
                if (key != null) o.put(key, value);
            } catch (Exception ignored) { }
            push(o);
        }
    }

    /** 一帧待发数据。 */
    private static final class Frame {
        final byte opcode;
        final byte[] payload;
        Frame(byte opcode, byte[] payload) { this.opcode = opcode; this.payload = payload; }
    }

    /**
     * 写一帧（**客户端必须掩码**——RFC 6455 §5.3）。
     *
     * <p>★不掩码的客户端帧，规范允许服务端直接断开；不少服务端（含多数网关）确实会断。
     */
    private static synchronized void writeFrame(OutputStream out, byte opcode, byte[] payload) throws IOException {
        if (out == null) throw new IOException("连接未建立");
        Frame2 f = new Frame2(opcode, payload);
        out.write(f.bytes());
        out.flush();
    }

    /** 编码后的一帧（含掩码）。 */
    private static final class Frame2 {
        private final byte[] buf;
        Frame2(byte opcode, byte[] payload) {
            int len = payload.length;
            int headerLen = 2 + (len > 65535 ? 8 : len > 125 ? 2 : 0) + 4;
            buf = new byte[headerLen + len];
            int i = 0;
            buf[i++] = (byte) (0x80 | opcode); // FIN=1
            if (len > 65535) {
                buf[i++] = (byte) (0x80 | 127);
                for (int k = 7; k >= 0; k--) buf[i++] = (byte) ((long) len >> (8 * k));
            } else if (len > 125) {
                buf[i++] = (byte) (0x80 | 126);
                buf[i++] = (byte) ((len >> 8) & 0xFF);
                buf[i++] = (byte) (len & 0xFF);
            } else {
                buf[i++] = (byte) (0x80 | len);
            }
            byte[] mask = new byte[4];
            new Random().nextBytes(mask);
            System.arraycopy(mask, 0, buf, i, 4);
            i += 4;
            for (int k = 0; k < len; k++) buf[i + k] = (byte) (payload[k] ^ mask[k & 3]);
        }
        byte[] bytes() { return buf; }
    }

    /** 读 HTTP 响应头（到空行为止）。 */
    private static String readHandshake(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int state = 0;
        while (state < 4) {
            int b = in.read();
            if (b < 0) throw new EOFException("握手响应提前结束");
            buf.write(b);
            // 检测 \r\n\r\n
            if ((state == 0 || state == 2) && b == '\r') state++;
            else if ((state == 1 || state == 3) && b == '\n') state++;
            else state = (b == '\r') ? 1 : 0;
            if (buf.size() > 64 * 1024) throw new IOException("握手响应头过大");
        }
        return buf.toString("UTF-8");
    }

    private static int parseStatus(String resp) {
        int sp = resp.indexOf(' ');
        if (sp < 0) return 0;
        int sp2 = resp.indexOf(' ', sp + 1);
        String code = sp2 < 0 ? resp.substring(sp + 1).trim() : resp.substring(sp + 1, sp2).trim();
        try { return Integer.parseInt(code); } catch (NumberFormatException e) { return 0; }
    }

    private static String headerOf(String resp, String lowerName) {
        for (String line : resp.split("\r\n")) {
            int c = line.indexOf(':');
            if (c <= 0) continue;
            if (line.substring(0, c).trim().toLowerCase(Locale.ROOT).equals(lowerName)) {
                return line.substring(c + 1).trim();
            }
        }
        return null;
    }

    private static void readFully(InputStream in, byte[] b, int len) throws IOException {
        int off = 0;
        while (off < len) {
            int n = in.read(b, off, len - off);
            if (n < 0) throw new EOFException("连接已断开");
            off += n;
        }
    }

    /**
     * 把一条事件推给 JS。
     * ★双通道（#1093 真机死锁修复）：
     *   ① `PENDING_PUSH`——探针的泵循环会主动 drain（主线程被探针占着时唯一可行的路）；
     *   ② `MAIN.post`——正常运行时的路径（JS 线程非探针占用，post 能排上）。
     *   两条都投不会重复：② 里的 eval 会再检查一次队列归属（见 drainPendingPushes 的消费语义）。
     */
    private static void push(JSONObject payload) {
        Log.i(TAG, "ws push 入队：" + payload);
        PENDING_PUSH.offer(payload);
        final String expr = "typeof " + PUSH_KEY + "==='function'?" + PUSH_KEY + "("
                + JSONObject.quote(payload.toString()) + "):'no-hook'";
        MAIN.post(() -> {
            // ★主线程真正跑起来时，队列里的同类载荷已被探针 drain 掉则跳过
            if (!PENDING_PUSH.remove(payload)) return;
            try {
                QuickJsEngine.eval(expr);
            } catch (Throwable t) {
                Log.w(TAG, "ws 回推失败：" + t);
            }
        });
    }

// ══════════════════════════════════════════════════════════════════
// ★#1093：**探针用的推送队列**（真机实测抓出的死锁）
//   探针在主线程上跑"泵驱动循环"（几十秒），而壳推用 `MAIN.post` 排队 ⇒
//   主线程被探针占着 ⇒ 推送 Runnable 永远排不上 ⇒ **死锁**（探针等事件，事件等主线程）。
//   ⇒ 壳推除了 post 到主线程，**还投一份到本进程内的队列**；探针循环里主动调用
//     `drainPendingPushes()` 就地分发（不需主线程空闲）。
// ══════════════════════════════════════════════════════════════════

/** 进程内待分发推送队列（探针专用）。 */
private static final java.util.concurrent.ConcurrentLinkedQueue<JSONObject> PENDING_PUSH =
        new java.util.concurrent.ConcurrentLinkedQueue<>();

/**
 * 就地分发给 JS（**不经主线程 post**）——供探针的泵循环调用。
 * @return 本次分发的条数
 */
/** 队列剩余条数（诊断：区分"宿主没入队"与"JS 没消费"）。 */
public static int pendingCount() { return PENDING_PUSH.size(); }

public static int drainPendingPushes() {
    int n = 0;
    JSONObject p;
    while ((p = PENDING_PUSH.poll()) != null) {
        try {
            // ★必须读 eval 的**结果**（不是"没抛异常就算成功"）：
            //   QuickJsEngine.eval 把 JS 错误包在 EvalResult 里返回，不抛 Java 异常
            //   ⇒ 只 catch Throwable 会把"JS 侧报错"记成成功（首版实测：drained_total=3 却一条没分发）。
            // ★用**显式 globalThis 属性**调用（裸标识符在个别 JS 引擎里可能解析不到
            //   bracket 赋值的全局属性）；并记录 eval 的真实返回值——不能只看"没报错"。
            QuickJsEngine.EvalResult r = QuickJsEngine.eval(
                    "typeof globalThis." + PUSH_KEY + "==='function'"
                    + "?globalThis." + PUSH_KEY + "(" + JSONObject.quote(p.toString()) + ")"
                    + ":('no-hook:'+typeof globalThis." + PUSH_KEY + ")");
            Log.i(TAG, "ws drain 回执 ok=" + (r.ok ? "true" : "false")
                    + " value=" + (r.ok ? r.value : r.error) + " payload=" + p);
            if (r.ok) {
                n++;
            } else {
                Log.w(TAG, "ws 就地分发失败（JS）：" + r.error + " payload=" + p);
            }
        } catch (Throwable t) {
            Log.w(TAG, "ws 就地分发失败（Java）：" + t);
        }
    }
    return n;
}

    /** 诊断读数（判据用）：活跃连接数。 */
    public static int activeCount() { return CONNS.size(); }

    /** 全部活跃连接 id（诊断用）。 */
    public static int[] activeIds() {
        int[] ids = new int[CONNS.size()];
        int i = 0;
        for (Integer k : CONNS.keySet()) ids[i++] = k;
        return ids;
    }
}
