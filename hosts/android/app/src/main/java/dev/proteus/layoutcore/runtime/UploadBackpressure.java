// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/UploadBackpressure.java
// ★★★#1242 上传侧的**阻塞式背压**度量（从 `HttpCapability.UploadStats` 拆出，反巨型化）。
//
// ★包名必须是 `dev.proteus.layoutcore`（与 `HttpCapability` / `HttpTransport` 同包）——
//   本仓这些 Java 源放在 `.../runtime/` 目录下，但声明的是**父包**。
//   第一版漏了 package 声明 ⇒ `check:android-host-compile` 当场报 11 个错
//   （那正是零设备编译检查存在的意义：不让编译错留到真机）。
package dev.proteus.layoutcore;
//
// 【为什么需要单独的类】
//   `HttpCapability.java` 已 991 行，加 27 行就破 1000 硬上限（`check:file-size` 当场红）。
//   ★按本仓纪律**不压缩历史注释来让位**——那会把"为什么这样做"的证据丢掉，
//     而成因恰恰是下一次改动最需要的东西。⇒ 按职责拆出：上传背压是一个独立关注点。
//
// 【上传的背压是什么形态（与 fetch/ws 都不同，必须说清）】
//   · fetch：宿主读线程 `ArrayBlockingQueue.put` 阻塞 —— 有队列、有深度可测；
//   · ws：壳推同步调进 JS，慢订阅者占住宿主线程 —— 有分发耗时；
//   · **upload**：宿主自己读文件、往 socket 写；TCP 发送窗口满时 `sink.write` **阻塞**。
//     没有队列、没有丢弃 ⇒ 唯一的证据是**单次写入的耗时**。
//   ★所以判据是"慢写次数"，不是"丢弃计数"。此前把这一类判成"无背压"是判据的语义盲区；
//     而用同文件里**下载流**的 `STREAM_QUEUE_DEPTH`/`backpressureWaits` 顶替则是**交叉污染**
//     （下载的背压证据不能证明上传有背压）。⇒ 本类给上传自己的读数。
//
// 【判据口径】
//   单块 16 KiB 的 `write` 若耗时 ≥ {@link #SLOW_WRITE_MS}，说明该时刻 socket 接不下数据
//   （≈4 MB/s 以下）⇒ 记一次阻塞。这是**慢写的直接度量**，不是总耗时
//   （总耗时由文件大小主导，无法说明背压）。
public final class UploadBackpressure {

    /** ★public 构造：`HttpCapability.UploadStats` 每实例要持有一个（包内可见不够，它是嵌套类） */
    public UploadBackpressure() {}

    /** 单块写超过该毫秒数即视为一次"socket 阻塞"（16 KiB 块 ⇒ 低于约 4 MB/s） */
    public static final long SLOW_WRITE_MS = 4L;

    /** 累计阻塞次数 */
    private int slowWrites = 0;
    /** 累计阻塞毫秒（与 slowWrites 同源——两者一起才能算出平均阻塞时长） */
    private long slowWriteMs = 0;

    /** 给一次 `sink.write` 计时并记账；返回该次耗时（ms），供调用方判断（可选）。 */
    public long recordWrite(long nanos) {
        long ms = nanos / 1_000_000L;
        if (ms >= SLOW_WRITE_MS) {
            slowWrites++;
            slowWriteMs += ms;
        }
        return ms;
    }

    public int slowWrites() { return slowWrites; }

    public long slowWriteMs() { return slowWriteMs; }

    /** 一行读数（探针/日志用；字段名与 JS 侧判据一致）。 */
    public String toJson() {
        return "\"slow_writes\":" + slowWrites + ",\"slow_write_ms\":" + slowWriteMs;
    }

    /**
     * 构造上传的**回调式请求体**：宿主边读文件边写，内存只有一块缓冲。
     *
     * 【为什么在 Java 侧再拼一遍 head/tail】multipart 的头/尾由调用方拼好传进来，
     *   本方法只负责"写头 → 循环读文件写文件 → 写尾"。
     *   ★boundary 一致性由调用方保证（头里的 boundary 与 body 用同一个 `up.boundary`）。
     *
     * 【背压】每块 `sink.write` 计时 ⇒ TCP 窗口满时的阻塞被 {@link #recordWrite} 记下。
     * 【上限】累计超过 maxBytes ⇒ 抛 {@link HttpCapability.UploadFileTooLarge}（不静默截断）。
     */
    public static HttpTransport.BodyWriter streamBody(
            String contentType,
            long total,
            java.io.File src,
            byte[] headNormal,
            byte[] headFile,
            byte[] tail,
            HttpCapability.UploadStats stats,
            long maxBytes) {
        return new HttpTransport.BodyWriter() {
            @Override public okhttp3.MediaType contentType() {
                return contentType == null ? null : okhttp3.MediaType.parse(contentType);
            }
            @Override public long contentLength() { return total; }
            @Override public void writeTo(okio.BufferedSink sink) throws java.io.IOException {
                sink.write(headNormal);
                sink.write(headFile);
                // ★★核心：边读文件边写，内存只有缓冲块
                java.io.InputStream in = new java.io.FileInputStream(src);
                try {
                    byte[] buf = new byte[HttpCapability.STREAM_CHUNK];
                    int n;
                    long sent = 0;
                    while ((n = in.read(buf)) > 0) {
                        // ★#1242：给每个块计时 ⇒ 慢写（socket 阻塞）是可观测的
                        long w0 = System.nanoTime();
                        sink.write(buf, 0, n);
                        stats.backpressure.recordWrite(System.nanoTime() - w0);
                        sent += n;
                        stats.sentBytes = sent;
                        stats.chunks++;
                        if (n > stats.peakChunkBytes) stats.peakChunkBytes = n;
                        if (sent > maxBytes) throw new java.io.IOException(
                                new HttpCapability.UploadFileTooLarge(sent).getMessage());
                    }
                } finally {
                    in.close();
                }
                sink.write(tail);
                sink.flush();
            }
        };
    }
}
