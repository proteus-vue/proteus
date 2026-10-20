package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/InvokeWire.java
// ★★★invoke 通道的**二进制线格式**（Java 侧唯一实现）—— SSOT = `packages/api/src/invoke-wire.ts`
//
// 【为什么有本文件（决策 #900 / T-app-wire · 用户 2026-10-13 指令）】「跨语言数据通道不要用 JSON 字符串，
//   性能损耗太大，走纯二进制方向」。此前 invoke 通道派发 `JSON.stringify({...args,__reqId})`、回推
//   `__proteusHostResolve(reqId, json)` —— **两处都是 JSON 文本**；响应体几 MB 时每字节膨胀 3~4×
//   + 两次 UTF-8 编解码 + 一次 parse（1MB 级 ~10ms）。本文件是宿主侧的解码/编码端。
//
// 【★与 TS 的等价性是**硬契约**，不是"大致相同"】三端原生编解码器必须与
//   `packages/api/src/invoke-wire.ts` **逐字节等价**——判据 = `pnpm check:invoke-wire-parity`
//   （Node 侧用 TS 编解码器产 golden 帧 → javac 编译本文件 → 跑 `InvokeWireParity` 主类 → 逐字节比对；
//   这是本仓纪律 #22「第 N 份手写副本 = 下一个静默缺陷」的**机器化对策**：手写副本不可怕，
//   没有对拍才可怕）。
//
// 【线格式（与 `blob.rs`「PLYT」/ `rects_bin.rs`「PRES」/ `slot-runtime/buffer.ts`「PVOP」同族纪律）】
//   · 全**小端**；`magic u32 + version u32` 开头（去程 `PINV` / 回程 `PRSP`），magic 不符即拒；
//   · 定长 header（20B）+ 长度前缀变长区（解码即游标推进，无字符扫描、无 JSON 语法层）；
//   · 大块载荷（请求 / 响应 body）**裸字节垫底**（不 base64、不当字符串）；
//   · 未知 TLV tag **跳过而不报错**（版本演进：老宿主遇新 tag 应忽略，而非崩）。
//
//   去程帧布局：
//     [0..20)  magic u32 · version u32 · flags u32 · metaBytes u32 · bodyBytes u32
//     [20..)   method(u16 len + utf8) · reqId(u16 len + utf8) · meta(TLV) · body(裸字节)
//   回程帧布局（字段更少）：
//     [0..20)  magic u32 · version u32 · flags u32 · metaBytes u32 · bodyBytes u32
//     [20..)   reqId(u16 len + utf8) · meta(TLV) · body(裸字节)
//   TLV 项：`tag u8 · len u32 · payload`
//
// 【★为什么本文件**不带任何 android 依赖**（纯 JDK）】① 可在 JVM 上直接 javac + java 跑（对拍门禁不需要
//   真机/模拟器）；② 宿主各入口（HostCapabilities / HostBridge / SuperappRuntimeHost）共用这一份，
//   不再各写一份（#22）。
//
// 【★诚实边界】UTF-8 用 JDK 标准实现（`String.getBytes(UTF_8)` / `new String(bytes, UTF_8)`）。
//   与 TS 侧的手写 UTF-8 在**合法字符串**上逐字节一致；差别只在**非法输入**（孤立代理对 / 畸形序列）：
//   TS 侧严格报错、JDK 侧宽松替换。本通道的输入由同进程的 JS 引擎产出（合法），故取"代码更少、
//   审查面更小"的一侧；若将来出现外部构造帧，须换成严格实现（本行即该边界的登记处）。

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

public final class InvokeWire {

    private InvokeWire() { }

    /* ────────────────────────── 常量（与 TS 同源；改一处必须三端同步 + WIRE_VERSION +1） ────────────────────────── */

    /** 去程 magic = "PINV"（小端字节序 50 49 4E 56） */
    public static final int INVOKE_MAGIC = 0x564e4950;
    /** 回程 magic = "PRSP"（小端字节序 50 52 53 50） */
    public static final int RESOLVE_MAGIC = 0x50535250;
    /** 线格式版本（★字段增删 / 语义变更 ⇒ +1；三端必须同步） */
    public static final int WIRE_VERSION = 1;
    /** header 字节数（去程 / 回程同构） */
    public static final int HEADER_BYTES = 20;

    /** 去程 flags 位 */
    public static final int INVOKE_FLAG_HAS_BODY = 1 << 0;
    /** 回程 flags 位 */
    public static final int RESOLVE_FLAG_HAS_BODY = 1 << 0;
    /** 回程 flags 位：`ok === false` */
    public static final int RESOLVE_FLAG_IS_ERROR = 1 << 1;

    /* 去程 meta 的 TLV tag（★1–15 段留去程） */
    public static final int TAG_URL = 1;
    public static final int TAG_HTTP_METHOD = 2;
    public static final int TAG_HEADERS = 3;
    public static final int TAG_PARAMS = 4;
    public static final int TAG_TIMEOUT_MS = 5;
    public static final int TAG_RESPONSE_TYPE = 6;
    public static final int TAG_CONTENT_TYPE = 7;
    /** ★#1118：请求分块回推（1 = 流式；缺省/null = 整包） */
    public static final int TAG_STREAM = 8;
    /** ★#1119：落盘路径（宿主直写沙箱，JS 不碰字节） */
    public static final int TAG_SAVE_PATH = 9;
    /** ★#1120：流式上传规格（宿主自读文件 + 自拼 multipart） */
    public static final int TAG_UPLOAD_PATH = 10;
    /** ★#1134：重定向控制（1 = 宿主**不跟随**，把 3xx + Location 回给 JS；缺省/null = 跟随） */
    public static final int TAG_REDIRECT = 11;

    /* 回程 meta 的 TLV tag（★16 起留回程，两段不重叠） */
    public static final int RTAG_HTTP_STATUS = 16;
    public static final int RTAG_REASON = 17;
    public static final int RTAG_MISSING = 18;
    public static final int RTAG_PENDING = 19;
    public static final int RTAG_HEADERS = 20;
    /** ★#1118：流式块序号（有本字段 = 本帧是数据块，不结算） */
    public static final int RTAG_STREAM_SEQ = 21;

    /** 响应体解释方式（与 `RequestConfig.responseType` 同语义） */
    public static final int RESPONSE_TEXT = 0;
    public static final int RESPONSE_JSON = 1;
    public static final int RESPONSE_ARRAYBUFFER = 2;

    private static final byte[] EMPTY = new byte[0];

    /* ────────────────────────── 数据形态 ────────────────────────── */

    /** ★★★#1120：流式上传规格（宿主据此自读文件 + 自拼 multipart；字段与 TS `UploadSpec` 逐一对应）。 */
    public static final class UploadSpec {
        public String path;
        public String fieldName;
        public String filename;
        public String boundary;
        /** 普通表单字段（`LinkedHashMap` 保插入序——编码顺序是契约的一部分）。 */
        public LinkedHashMap<String, String> formData;
    }

    private static void writeUploadSpec(Writer w, UploadSpec u) {
        w.str(u.path == null ? "" : u.path);
        w.str(u.fieldName == null ? "" : u.fieldName);
        w.str(u.filename == null ? "" : u.filename);
        w.str(u.boundary == null ? "" : u.boundary);
        int n = u.formData == null ? 0 : u.formData.size();
        w.u16(n);
        if (u.formData != null) {
            for (Map.Entry<String, String> e : u.formData.entrySet()) {
                w.str(e.getKey());
                w.str(e.getValue() == null ? "" : e.getValue());
            }
        }
    }

    private static UploadSpec readUploadSpec(Reader r) {
        UploadSpec u = new UploadSpec();
        u.path = r.str();
        u.fieldName = r.str();
        u.filename = r.str();
        u.boundary = r.str();
        int n = r.u16();
        u.formData = new LinkedHashMap<>();
        for (int i = 0; i < n; i++) {
            String k = r.str();
            u.formData.put(k, r.str());
        }
        return u;
    }

    /** 去程帧（`PINV`）解码结果——业务无关的"请求元数据 + 裸字节体"。 */
    public static final class InvokeFrame {
        public String method = "";
        public String reqId = "";
        public String url;
        public String httpMethod;
        public LinkedHashMap<String, String> headers;
        public LinkedHashMap<String, String> params;
        /**
         * `null` = **未指定**（对应 TS 侧 `meta.timeoutMs === undefined`）。
         * ★为什么用可空 Integer 而不是 `int 0`：TS 的编码判据是 `!== undefined` —— 若用 0 当"未指定"，
         *   "显式传 0"与"没传"就分不开，且与本文件的编码判据（`!= null` 才写 TLV）**无法逐字节对齐**。
         */
        public Integer timeoutMs;
        /** 见 RESPONSE_* 常量；`null` = **未指定**（同上理由——TS 侧 `!== undefined` 才写 TLV） */
        public Integer responseType;
        public String contentType;
        /** ★#1118：`null` = 未指定（不写 TLV）——与 TS 侧 `meta.stream === true` 对齐 */
        public Boolean stream;
        /** ★#1119：非 null ⇒ 宿主把响应体直接写进该沙箱路径 */
        public String savePath;
        /** ★#1120：非 null ⇒ 宿主边读文件边拼 multipart 边发 */
        public UploadSpec upload;
        /** ★#1134：true ⇒ 不跟随重定向（缺省 = 跟随，与老行为一致） */
        public Boolean redirectManual;
        public byte[] body = EMPTY;

        /** 取值语义（缺省 = text）——宿主消费时用这个，不要直接读可空字段。 */
        public int responseKind() { return responseType != null ? responseType : RESPONSE_TEXT; }

        /** 取值语义（缺省 = 15000ms，与 `RequestConfig` 默认一致）。 */
        public int timeoutOrDefault() { return timeoutMs != null ? timeoutMs : 15000; }
    }

    /** 回程帧（`PRSP`）——宿主填它；`ok=false` 对应既有 `{"ok":false}`。 */
    public static final class ResolveFrame {
        public String reqId = "";
        public boolean ok = true;
        /** ★#1118：非 null ⇒ 本帧是流式数据块（不结算）；null 且 pending!=true ⇒ 最终帧 */
        public Integer streamSeq;
        /** `ok=false` 时的原因 */
        public String reason;
        /** ★保留既有语义：壳未实现该方法（桥据此给 `*.unsupported`） */
        public Boolean missing;
        /** ★保留既有语义：壳已受理、结果稍后回推（回推时须再发一帧 `pending=false`） */
        public Boolean pending;
        /** HTTP 状态码（网络类回程） */
        public Integer status;
        public LinkedHashMap<String, String> headers;
        public byte[] body = EMPTY;

        public static ResolveFrame ok(String reqId) {
            ResolveFrame f = new ResolveFrame();
            f.reqId = reqId;
            return f;
        }

        public static ResolveFrame err(String reqId, String reason) {
            ResolveFrame f = new ResolveFrame();
            f.reqId = reqId;
            f.ok = false;
            f.reason = reason;
            return f;
        }

        /** ★"无此方法"（不是失败）：桥按 `missing` 给 `*.unsupported`，与既有 JSON 通道同口径。 */
        public static ResolveFrame missingMethod(String reqId, String reason) {
            ResolveFrame f = err(reqId, reason);
            f.missing = Boolean.TRUE;
            return f;
        }

        public static ResolveFrame pending(String reqId) {
            ResolveFrame f = ok(reqId);
            f.pending = Boolean.TRUE;
            return f;
        }
    }

    /* ────────────────────────── 去程：解码（宿主主用） ────────────────────────── */

    /**
     * **只读方法名**（不做全帧解码）—— 给宿主记账 / 日志用。
     *
     * 【为什么单列一个（与 Swift 侧 `InvokeWire.peekMethod`、TS 侧同语义）】宿主日志端口要的是
     *   "哪个能力被调"，而帧是字节；若为记日志去 {@link #decodeInvoke}，会把 **body 整块拷贝一遍**
     *   （HTTP 请求体可能几 MB）——记日志的开销不该与载荷成正比。本方法只走 header + 两个长度前缀
     *   （method / reqId），**不碰 meta / body**。
     *   ★只用于诊断：解码失败返回 `"?"`（调用方本就要处理真正的失败，不该被日志路径影响）。
     *   ★调用点见 `HostBridge.invokeBytes`（回推前记一笔 `invokeLogger`）与对拍工具
     *     `hosts/android/tools/InvokeWireParity.java`（golden 向量里 `extra` 一列即本方法的期望值）。
     *
     * 【2026-10-13 补漏】本方法此前**只在调用方存在、定义处缺失**（`HostBridge` / 对拍工具都调它）
     *   ⇒ `javac` 报 `找不到符号: 方法 peekMethod(byte[])`。补上后该跨文件契约完整。
     */
    public static String peekMethod(byte[] bytes) {
        try {
            Reader r = new Reader(bytes);
            if (r.u32() != INVOKE_MAGIC) return "?";
            r.u32(); // version
            r.u32(); // flags
            r.u32(); // metaBytes
            r.u32(); // bodyBytes
            return r.str();
        } catch (Throwable t) {
            return "?";
        }
    }

    /**
     * 解码 `PINV` 帧。
     * ★判据与 TS 侧 `decodeInvokeFrame` 一致：magic / 版本不符即拒；尾部有残留即拒（防长度算错被静默接受）。
     */
    public static InvokeFrame decodeInvoke(byte[] bytes) {
        Reader r = new Reader(bytes);
        int magic = r.u32();
        if (magic != INVOKE_MAGIC) {
            throw new IllegalArgumentException("去程帧 magic 不符：0x" + Integer.toHexString(magic)
                    + "（期望 0x" + Integer.toHexString(INVOKE_MAGIC) + "）");
        }
        int version = r.u32();
        if (version != WIRE_VERSION) {
            throw new IllegalArgumentException("去程帧版本不符：" + version + "（期望 " + WIRE_VERSION + "）");
        }
        r.u32(); // flags（当前仅 HAS_BODY；body 长度已由 bodyBytes 给出 ⇒ 解码无需它）
        int metaBytes = r.u32();
        int bodyBytes = r.u32();
        InvokeFrame f = new InvokeFrame();
        f.method = r.str();
        f.reqId = r.str();
        decodeInvokeMeta(new Reader(r.raw(metaBytes)), f);
        f.body = r.raw(bodyBytes);
        if (r.remaining() != 0) {
            throw new IllegalArgumentException("去程帧尾部有 " + r.remaining() + " 字节残留（格式或长度不符）");
        }
        return f;
    }

    /** 解码 `PRSP` 帧（宿主侧一般不用；对拍门禁与诊断用）。 */
    public static ResolveFrame decodeResolve(byte[] bytes) {
        Reader r = new Reader(bytes);
        int magic = r.u32();
        if (magic != RESOLVE_MAGIC) {
            throw new IllegalArgumentException("回程帧 magic 不符：0x" + Integer.toHexString(magic)
                    + "（期望 0x" + Integer.toHexString(RESOLVE_MAGIC) + "）");
        }
        int version = r.u32();
        if (version != WIRE_VERSION) {
            throw new IllegalArgumentException("回程帧版本不符：" + version + "（期望 " + WIRE_VERSION + "）");
        }
        int flags = r.u32();
        int metaBytes = r.u32();
        int bodyBytes = r.u32();
        ResolveFrame f = new ResolveFrame();
        f.reqId = r.str();
        f.ok = (flags & RESOLVE_FLAG_IS_ERROR) == 0;
        decodeResolveMeta(new Reader(r.raw(metaBytes)), f);
        f.body = r.raw(bodyBytes);
        if (r.remaining() != 0) {
            throw new IllegalArgumentException("回程帧尾部有 " + r.remaining() + " 字节残留（格式或长度不符）");
        }
        return f;
    }

    /* ────────────────────────── 回程：编码（宿主主用） ────────────────────────── */

    /** 编码 `PRSP` 帧（宿主 → JS）。 */
    public static byte[] encodeResolve(ResolveFrame f) {
        byte[] meta = encodeResolveMeta(f);
        byte[] body = f.body != null ? f.body : EMPTY;
        int flags = 0;
        if (body.length > 0) flags |= RESOLVE_FLAG_HAS_BODY;
        if (!f.ok) flags |= RESOLVE_FLAG_IS_ERROR;
        Writer w = new Writer(64);
        w.u32(RESOLVE_MAGIC);
        w.u32(WIRE_VERSION);
        w.u32(flags);
        w.u32(meta.length);
        w.u32(body.length);
        w.str(f.reqId);
        w.raw(meta);
        w.raw(body);
        return w.done();
    }

    /** 编码 `PINV` 帧（宿主侧一般不用；对拍门禁用——与 TS `encodeInvokeFrame` 逐字节比对）。 */
    public static byte[] encodeInvoke(InvokeFrame f) {
        byte[] meta = encodeInvokeMeta(f);
        byte[] body = f.body != null ? f.body : EMPTY;
        Writer w = new Writer(64);
        w.u32(INVOKE_MAGIC);
        w.u32(WIRE_VERSION);
        w.u32(body.length > 0 ? INVOKE_FLAG_HAS_BODY : 0);
        w.u32(meta.length);
        w.u32(body.length);
        w.str(f.method);
        w.str(f.reqId);
        w.raw(meta);
        w.raw(body);
        return w.done();
    }

    /* ────────────────────────── meta 编解码（TLV） ────────────────────────── */

    private static void decodeInvokeMeta(Reader r, InvokeFrame f) {
        while (r.remaining() > 0) {
            int tag = r.u8();
            int len = r.u32();
            if (r.remaining() < len) {
                throw new IllegalArgumentException("meta TLV 被截断：tag=" + tag + " len=" + len + " 剩余=" + r.remaining());
            }
            Reader p = new Reader(r.raw(len));
            switch (tag) {
                case TAG_URL: f.url = p.str(); break;
                case TAG_HTTP_METHOD: f.httpMethod = p.str(); break;
                case TAG_HEADERS: f.headers = readNameValues(p); break;
                case TAG_PARAMS: f.params = readNameValues(p); break;
                case TAG_TIMEOUT_MS: f.timeoutMs = p.u32(); break;
                case TAG_RESPONSE_TYPE: f.responseType = p.u8(); break;
                case TAG_CONTENT_TYPE: f.contentType = p.str(); break;
                case TAG_STREAM: f.stream = p.u8() != 0; break;
                case TAG_SAVE_PATH: f.savePath = p.str(); break;
                case TAG_UPLOAD_PATH: f.upload = readUploadSpec(p); break;
                case TAG_REDIRECT: f.redirectManual = p.u8() != 0; break;
                // ★未知 tag 跳过（版本演进：老解码头遇到新 tag 应忽略，而非报错）
                default: break;
            }
        }
    }

    private static void decodeResolveMeta(Reader r, ResolveFrame f) {
        while (r.remaining() > 0) {
            int tag = r.u8();
            int len = r.u32();
            if (r.remaining() < len) {
                throw new IllegalArgumentException("回程 meta TLV 被截断：tag=" + tag + " len=" + len + " 剩余=" + r.remaining());
            }
            Reader p = new Reader(r.raw(len));
            switch (tag) {
                case RTAG_HTTP_STATUS: f.status = p.u32(); break;
                case RTAG_REASON: f.reason = p.str(); break;
                case RTAG_MISSING: f.missing = p.u8() != 0; break;
                case RTAG_PENDING: f.pending = p.u8() != 0; break;
                case RTAG_HEADERS: f.headers = readNameValues(p); break;
                case RTAG_STREAM_SEQ: f.streamSeq = p.u32(); break;
                default: break;
            }
        }
    }

    private static byte[] encodeInvokeMeta(InvokeFrame f) {
        Writer w = new Writer(64);
        if (f.url != null) writeTlv(w, TAG_URL, () -> w.str(f.url));
        if (f.httpMethod != null) writeTlv(w, TAG_HTTP_METHOD, () -> w.str(f.httpMethod));
        if (f.headers != null) writeTlv(w, TAG_HEADERS, () -> writeNameValues(w, f.headers));
        if (f.params != null) writeTlv(w, TAG_PARAMS, () -> writeNameValues(w, f.params));
        // ★判据与 TS 逐字对齐：TS 是 `!== undefined` 才写 —— 故此处一律 `!= null`（**不是** `!= 0`）
        if (f.timeoutMs != null) writeTlv(w, TAG_TIMEOUT_MS, () -> w.u32(f.timeoutMs));
        if (f.responseType != null) writeTlv(w, TAG_RESPONSE_TYPE, () -> w.u8(f.responseType));
        if (f.contentType != null) writeTlv(w, TAG_CONTENT_TYPE, () -> w.str(f.contentType));
        // ★#1118：只在**显式 true** 时写（与 TS `meta.stream === true` 逐字对齐；false/null 都不写）
        if (Boolean.TRUE.equals(f.stream)) writeTlv(w, TAG_STREAM, () -> w.u8(1));
        if (f.savePath != null) writeTlv(w, TAG_SAVE_PATH, () -> w.str(f.savePath));
        if (f.upload != null) writeTlv(w, TAG_UPLOAD_PATH, () -> writeUploadSpec(w, f.upload));
        // ★#1134：只在**显式要求不跟随**时写（缺省 = 平台跟随）
        if (Boolean.TRUE.equals(f.redirectManual)) writeTlv(w, TAG_REDIRECT, () -> w.u8(1));
        return w.done();
    }

    private static byte[] encodeResolveMeta(ResolveFrame f) {
        Writer w = new Writer(64);
        if (f.status != null) writeTlv(w, RTAG_HTTP_STATUS, () -> w.u32(f.status));
        if (f.reason != null) writeTlv(w, RTAG_REASON, () -> w.str(f.reason));
        if (f.missing != null) writeTlv(w, RTAG_MISSING, () -> w.u8(f.missing ? 1 : 0));
        if (f.pending != null) writeTlv(w, RTAG_PENDING, () -> w.u8(f.pending ? 1 : 0));
        if (f.headers != null) writeTlv(w, RTAG_HEADERS, () -> writeNameValues(w, f.headers));
        if (f.streamSeq != null) writeTlv(w, RTAG_STREAM_SEQ, () -> w.u32(f.streamSeq));
        return w.done();
    }

    /** 写一个 TLV 项：`tag u8 + len u32 + payload`（len 由**占位回填**得到，payload 只编码一遍）。 */
    private static void writeTlv(Writer w, int tag, Runnable payload) {
        w.u8(tag);
        int lenAt = w.length();
        w.u32(0); // 占位
        int payloadAt = w.length();
        payload.run();
        w.patchU32(lenAt, w.length() - payloadAt);
    }

    /** 键值对列表：`count u16 + (name u16len+utf8, value u16len+utf8) × count` */
    private static void writeNameValues(Writer w, Map<String, String> nv) {
        if (nv.size() > 0xffff) throw new IllegalArgumentException("键值对过多（>65535）：" + nv.size());
        w.u16(nv.size());
        for (Map.Entry<String, String> e : nv.entrySet()) {
            w.str(e.getKey());
            w.str(e.getValue());
        }
    }

    private static LinkedHashMap<String, String> readNameValues(Reader r) {
        int n = r.u16();
        LinkedHashMap<String, String> out = new LinkedHashMap<>();
        for (int i = 0; i < n; i++) out.put(r.str(), r.str());
        return out;
    }

    /* ────────────────────────── 小端字节游标（与 `shared/src/binary/wire.ts` 同语义） ────────────────────────── */

    /** 写入游标（自动倍增扩容；`done()` 返回已写段）。 */
    static final class Writer {
        private byte[] buf;
        private int pos;

        Writer(int size) { buf = new byte[Math.max(8, size)]; }

        int length() { return pos; }

        private void ensure(int n) {
            if (pos + n <= buf.length) return;
            int cap = buf.length == 0 ? 64 : buf.length;
            while (cap < pos + n) cap *= 2;
            byte[] next = new byte[cap];
            System.arraycopy(buf, 0, next, 0, pos);
            buf = next;
        }

        void u8(int v) { ensure(1); buf[pos++] = (byte) (v & 0xff); }

        void u16(int v) {
            ensure(2);
            buf[pos++] = (byte) (v & 0xff);
            buf[pos++] = (byte) ((v >>> 8) & 0xff);
        }

        void u32(int v) {
            ensure(4);
            buf[pos++] = (byte) (v & 0xff);
            buf[pos++] = (byte) ((v >>> 8) & 0xff);
            buf[pos++] = (byte) ((v >>> 16) & 0xff);
            buf[pos++] = (byte) ((v >>> 24) & 0xff);
        }

        /**
         * u16 长度前缀 + UTF-8（长度以**字节**计，与 TS `str()` 同约定）。
         * ★这是"本通道 JSON 被消灭"的落点之一：字符串只在此处编码一次，无引号转义、无 U+XXXX 转义展开。
         *   ★为什么这里**不能**把反斜杠-u 写成字面量（2026-10-13 实测）：javac 在**词法分析之前**
         *   先扫全文件的 Unicode 转义（JLS §3.3）⇒ 注释里出现「反斜杠 + u + 非十六进制字符」
         *   就是 **编译错误**（`错误: 非法的 Unicode 转义`）——故本文件一律写作 `U+XXXX` 形式。
         */
        void str(String s) {
            byte[] b = (s == null ? "" : s).getBytes(StandardCharsets.UTF_8);
            if (b.length > 0xffff) throw new IllegalArgumentException("字符串过长（>65535B）：" + b.length);
            ensure(2 + b.length);
            u16(b.length);
            System.arraycopy(b, 0, buf, pos, b.length);
            pos += b.length;
        }

        /** 裸字节（无前缀）——大载荷走这里。 */
        void raw(byte[] b) {
            if (b == null || b.length == 0) return;
            ensure(b.length);
            System.arraycopy(b, 0, buf, pos, b.length);
            pos += b.length;
        }

        /** 在指定位置回填 u32（TLV 长度前缀）。 */
        void patchU32(int at, int v) {
            if (at < 0 || at + 4 > pos) throw new IllegalArgumentException("回填越界：@" + at + "（已写 " + pos + " 字节）");
            buf[at] = (byte) (v & 0xff);
            buf[at + 1] = (byte) ((v >>> 8) & 0xff);
            buf[at + 2] = (byte) ((v >>> 16) & 0xff);
            buf[at + 3] = (byte) ((v >>> 24) & 0xff);
        }

        byte[] done() {
            byte[] out = new byte[pos];
            System.arraycopy(buf, 0, out, 0, pos);
            return out;
        }
    }

    /** 读取游标（越界即抛，不静默补零）。 */
    static final class Reader {
        private final byte[] buf;
        private int pos;

        Reader(byte[] buf) { this.buf = buf; }

        int remaining() { return buf.length - pos; }

        void need(int n, String what) {
            if (remaining() < n) throw new IllegalArgumentException("字节流被截断（" + what + "）");
        }

        int u8() { need(1, "u8"); return buf[pos++] & 0xff; }

        int u16() { need(2, "u16"); int v = (buf[pos] & 0xff) | ((buf[pos + 1] & 0xff) << 8); pos += 2; return v; }

        int u32() {
            need(4, "u32");
            int v = (buf[pos] & 0xff) | ((buf[pos + 1] & 0xff) << 8)
                    | ((buf[pos + 2] & 0xff) << 16) | ((buf[pos + 3] & 0xff) << 24);
            pos += 4;
            return v;
        }

        String str() {
            int len = u16();
            need(len, "str");
            String s = new String(buf, pos, len, StandardCharsets.UTF_8);
            pos += len;
            return s;
        }

        /** 裸字节**拷贝**（调用方长期持有；TS 侧返回视图，此处不返回视图以免宿主复用底层数组时被改写）。 */
        byte[] raw(int n) {
            need(n, "raw");
            byte[] out = new byte[n];
            System.arraycopy(buf, pos, out, 0, n);
            pos += n;
            return out;
        }
    }
}
