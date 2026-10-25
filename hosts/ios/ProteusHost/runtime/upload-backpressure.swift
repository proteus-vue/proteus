// hosts/ios/ProteusHost/runtime/upload-backpressure.swift
// ★★★#1252 **上传侧的阻塞式背压读数**（与 Android `UploadBackpressure.java` 同口径、同字段名）。
//
// 【为什么单独成文件】
//   `http-capability.swift` 已 1015 行（超 1000 硬上限）。按本仓纪律**不压缩历史注释让位**——
//   那些注释记录的是"为什么这样实现"，是下一次改动最需要的东西（"拼临时文件而非自定义
//   InputStream"那 4 轮失败的取证就在那儿）。⇒ 按职责拆出：上传背压是独立关注点。
//
// 【为什么必须有这个读数（本轮抓出的真缺口）】
//   iOS 侧此前**只有下载流**的 `backpressureWaits` / `backpressureMs`（`BodyLimitDelegate`），
//   上传路径**一个读数都没有**。而审计工具当时给 upload 判"背压 ✅"——
//   命中的正是**下载流**那两行。★那是典型的**交叉污染**：下载的背压证据不能证明上传有背压。
//   （我在 #1242 批评过自己一次同款错误，这是它的镜像：那次是 Android，这次是 iOS。）
//
// 【iOS 的背压形态（与 Android 不同，必须说清）】
//   · Android：边读文件边 `sink.write` 到 socket ⇒ 慢写 = TCP 发送窗口满 = 真背压。
//   · **iOS**：先拼临时文件（到磁盘）+ 官方 `uploadTask(with:fromFile:)` 由系统发送
//     ⇒ **发送侧的背压发生在系统里，本端观测不到**；本端能观测的是**拼装侧**：
//       磁盘 I/O 争用时 `out.write` 会变慢 ⇒ 打包成为瓶颈。
//   ⇒ 指标是"**慢写次数**"（单块 ≥ `SLOW_WRITE_MS`），与 Android **同名同语义**。
//   ★不假装能观测系统发送侧的背压（那确实在系统里，本仓拿不到，如实登记）。
//
// 【判据】
//   `hosts/ios/run-upload-probe.sh` 的报告里出现 `host_upload_backpressure`；
//   `peak_chunk_bytes` 与文件大小**无关**（8 MiB 文件仍是 16 KiB）是 S3 的核心性质。
import Foundation

enum UploadBackpressure {

    /// 单块写超过该毫秒数即视为一次"慢写"（与 Android `UploadBackpressure.SLOW_WRITE_MS` 同值）
    static let SLOW_WRITE_MS = 4

    /// 上传侧记账（字段名与 Android `toJson` 对齐，便于两端对拍）
    struct Stats {
        var slowWrites = 0
        var slowWriteMs = 0
        var chunks = 0
        var peakChunkBytes = 0
    }

    /// ★线程安全：拼装在后台队列，读数由报告线程读 ⇒ 用锁保护（简单互斥足够，争用极低）
    private static let lock = NSLock()
    private static var current = Stats()

    /// 重开一轮记账（每次 `packMultipartToTemp` 开始时调）
    static func reset() {
        lock.lock()
        current = Stats()
        lock.unlock()
    }

    /// 记录一次块写：`elapsedNs` 是**这一次 `out.write` 的耗时**。
    static func recordWrite(elapsedNs: UInt64, bytes: Int) {
        let ms = Int(elapsedNs / 1_000_000)
        lock.lock()
        current.chunks += 1
        if bytes > current.peakChunkBytes { current.peakChunkBytes = bytes }
        if ms >= SLOW_WRITE_MS {
            current.slowWrites += 1
            current.slowWriteMs += ms
        }
        lock.unlock()
    }

    /// 取快照（报告用）
    static func snapshot() -> Stats {
        lock.lock()
        defer { lock.unlock() }
        return current
    }
}
