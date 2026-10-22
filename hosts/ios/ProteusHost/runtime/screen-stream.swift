// hosts/ios/ProteusHost/runtime/screen-stream.swift
// ★★★Studio G3（决策 #1190）：**iOS 真机画面 → Mac**（ReplayKit 捕获 → VideoToolbox 硬编 → TCP 裸 Annex-B）
//
// 【为什么是「App 内 ReplayKit」而不是「Broadcast Upload Extension」】
//   两种 iOS 录屏形态的差别是**能不能录别人的 App**：
//     · `RPScreenRecorder.startCapture`（本文件）—— 只录**本 App 窗口**，一行 entitlement 都不要；
//     · Broadcast Upload Extension —— 录整机，但要额外 target + 用户每次从控制中心手动启动 + 独立签名档。
//   Studio 要看的**就是 Proteus 宿主自己**（我们编译出的页面跑在 ProteusHost 里）⇒ 前者足够，
//   且零额外签名面。代价：App 一旦进后台，捕获即停（这正是「看宿主」语义，不是缺陷）。
//
// 【为什么自己编码（不用 AVAssetWriter）】
//   AVAssetWriter 是**写文件**的：数据要等文件收尾才完整，做不了实时。要拿到逐帧 NAL，
//   只能自己拿 `VTCompressionSession` 编 —— 输出的是 **AVCC**（4 字节长度前缀），
//   而我们的传输层（packages/studio/native/live_stream.h）吃的是 **Annex-B**（`00 00 00 01` 起始码）
//   ⇒ 本文件做一次显式转换，并在每个 IDR 前补 SPS/PPS（断线重连后解码器也能立刻起得来）。
//
// 【为什么走 TCP 裸流而不是别的】
//   Android 那条腿是 `adb exec-out screenrecord` 吐裸 H.264，Mac 侧 `live_stream.h` 只认「管道里的
//   Annex-B」。iOS 用 TCP 送同一形态 ⇒ **Studio 侧零改动**：`POC_LIVE="nc -l 9001"` 即可。
//   （USB 走 `iproxy 9001 9001`，WiFi 直连 Mac 的 9001；两条路字节流完全一样。）
//
// 【失败策略】屏幕流是**观测装置**，不是 App 功能 ⇒ 任何一步失败只打日志（`*_FAILED` 前缀，不静默），
//   绝不阻断宿主启动。日志格式固定，供判据脚本 grep。

import CoreMedia
import CoreVideo
import Foundation
import ReplayKit
import VideoToolbox

final class ScreenStream {
    static let shared = ScreenStream()

    /// 目标（`PROTEUS_SCREEN_STREAM=host:port`）
    private var host: String = ""
    private var port: UInt16 = 0
    private var configured = false
    private var started = false

    /// 编码器（首帧拿到真实像素格式后才建 —— ReplayKit 给 420v 还是 BGRA 必须实测，不能猜）
    private var session: VTCompressionSession?
    private var encodedWidth = 0
    private var encodedHeight = 0
    private var pixelFormat: OSType = 0
    private var sps: Data?
    private var pps: Data?

    /// 连接
    private var fd: Int32 = -1

    /// 读数（判据/排障用）
    private var frames = 0          // 收到的原始帧
    private var encoded = 0         // 编码成功
    private var bytes = 0           // 已发字节
    private var reconnects = 0
    private var drops = 0           // 连接失败/发送失败丢弃的帧
    private var lastLogAt = Date()

    private let lock = NSLock()

    // MARK: - 入口

    /// 读环境变量并启动。未配置时**什么都不做**（零副作用）。
    /// 幂等：`viewDidAppear` 可能在切回前台时再次调用。
    func startIfConfigured() {
        guard !configured else { return }
        let env = ProcessInfo.processInfo.environment["PROTEUS_SCREEN_STREAM"] ?? ""
        guard !env.isEmpty else { return }
        guard let (h, p) = Self.parse(env) else {
            NSLog("[stream] CONFIG_FAILED 无法解析 PROTEUS_SCREEN_STREAM=%@（期望 host:port）", env)
            return
        }
        host = h
        port = p
        configured = true
        NSLog("[stream] 配置 %@:%d（App 内 ReplayKit；只录本 App 窗口）", h, Int(p))
        startCapture()
    }

    private static func parse(_ s: String) -> (String, UInt16)? {
        let parts = s.split(separator: ":")
        guard parts.count == 2, let p = UInt16(parts[1]), p > 0 else { return nil }
        return (String(parts[0]), p)
    }

    // MARK: - 捕获

    private func startCapture() {
        let rec = RPScreenRecorder.shared()
        guard rec.isAvailable else {
            NSLog("[stream] CAPTURE_FAILED isAvailable=false（模拟器 / 系统禁用）")
            return
        }
        // 麦克风不需要：纯画面。`startCapture` 会弹一次系统「允许录制」授权窗。
        started = true
        rec.startCapture { [weak self] sampleBuffer, type, error in
            guard let self else { return }
            if let error {
                NSLog("[stream] CAPTURE_FAILED %@", "\(error)")
                return
            }
            guard type == .video, CMSampleBufferIsValid(sampleBuffer) else { return }
            self.handle(sampleBuffer)
        }
        NSLog("[stream] startCapture 已调用（等系统授权窗「允许」；未点则无帧）")
    }

    // MARK: - 编码

    private func handle(_ sb: CMSampleBuffer) {
        guard let pb = CMSampleBufferGetImageBuffer(sb) else { return }
        lock.lock()
        frames += 1
        lock.unlock()

        if session == nil {
            let w = CVPixelBufferGetWidth(pb)
            let h = CVPixelBufferGetHeight(pb)
            let fmt = CVPixelBufferGetPixelFormatType(pb)
            guard ensureSession(width: w, height: h, format: fmt) else { return }
        }

        let pts = CMSampleBufferGetPresentationTimeStamp(sb)
        var flagsOut: VTEncodeInfoFlags = []
        let st = VTCompressionSessionEncodeFrame(
            session!, imageBuffer: pb, presentationTimeStamp: pts, duration: .invalid,
            frameProperties: nil, infoFlagsOut: &flagsOut
        ) { [weak self] status, _ /*infoFlags*/, encodedSb in
            guard let self else { return }
            if status != noErr {
                self.lock.lock()
                self.drops += 1
                self.lock.unlock()
                return
            }
            guard let out = encodedSb else { return }
            self.emit(out)
        }
        if st != noErr {
            lock.lock()
            drops += 1
            lock.unlock()
            if drops <= 3 || drops % 120 == 0 {
                NSLog("[stream] ENCODE_FAILED status=%d（累计丢 %d）", Int(st), drops)
            }
        }
    }

    private func ensureSession(width: Int, height: Int, format: OSType) -> Bool {
        var s: VTCompressionSession?
        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: format,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
        ]
        let st = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault, width: Int32(width), height: Int32(height),
            codecType: kCMVideoCodecType_H264,
            encoderSpecification: nil,
            imageBufferAttributes: attrs as CFDictionary,
            compressedDataAllocator: nil, outputCallback: nil, refcon: nil,
            compressionSessionOut: &s
        )
        guard st == noErr, let sess = s else {
            NSLog("[stream] SESSION_FAILED VTCompressionSessionCreate status=%d fmt=%@", Int(st), Self.fourCC(format))
            return false
        }
        // 实时模式：宁可掉画质也不攒缓冲（与 Studio 的「看到现在」目标一致）
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_High_AutoLevel)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_AverageBitRate, value: 8_000_000 as CFNumber)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: 60 as CFNumber)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
        VTCompressionSessionPrepareToEncodeFrames(sess)
        session = sess
        encodedWidth = width
        encodedHeight = height
        pixelFormat = format
        NSLog("[stream] 编码器就绪 %dx%d fmt=%@ bitrate=8Mbps", width, height, Self.fourCC(format))
        return true
    }

    private static func fourCC(_ v: OSType) -> String {
        let b = [UInt8((v >> 24) & 0xFF), UInt8((v >> 16) & 0xFF), UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF)]
        return String(bytes: b, encoding: .ascii) ?? "\(v)"
    }

    // MARK: - AVCC → Annex-B → TCP

    private func emit(_ sb: CMSampleBuffer) {
        guard let fd_ = CMSampleBufferGetFormatDescription(sb) else { return }
        // 参数集：首帧取一次（IDR 前重发，重连后解码器可自举）
        if sps == nil || pps == nil { readParamSets(fd_) }

        var out = Data()
        let isKey = Self.isKeyFrame(sb)
        if isKey, let s = sps, let p = pps {
            out.append(contentsOf: [0, 0, 0, 1]); out.append(s)
            out.append(contentsOf: [0, 0, 0, 1]); out.append(p)
        }
        guard let bb = CMSampleBufferGetDataBuffer(sb) else { return }
        var total = 0
        var ptr: UnsafeMutablePointer<Int8>?
        let st = CMBlockBufferGetDataPointer(bb, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &total, dataPointerOut: &ptr)
        guard st == noErr, let base = ptr, total > 4 else { return }

        var off = 0
        var nalCount = 0
        while off + 4 <= total {
            // AVCC：4 字节大端长度前缀
            let l0 = UInt32(UInt8(bitPattern: base[off]))
            let l1 = UInt32(UInt8(bitPattern: base[off + 1]))
            let l2 = UInt32(UInt8(bitPattern: base[off + 2]))
            let l3 = UInt32(UInt8(bitPattern: base[off + 3]))
            let len = Int((l0 << 24) | (l1 << 16) | (l2 << 8) | l3)
            off += 4
            guard len > 0, off + len <= total else { break }
            out.append(contentsOf: [0, 0, 0, 1])
            out.append(UnsafeBufferPointer(start: UnsafeRawPointer(base + off).assumingMemoryBound(to: UInt8.self), count: len))
            off += len
            nalCount += 1
        }
        guard !out.isEmpty else { return }
        Self.send(out, host: host, port: port, state: self)

        lock.lock()
        encoded += 1
        bytes += out.count
        let n = encoded
        let b = bytes
        let rc = reconnects
        let dr = drops
        let shouldLog = Date().timeIntervalSince(lastLogAt) >= 1.0
        if shouldLog { lastLogAt = Date() }
        lock.unlock()

        if shouldLog {
            NSLog(
                "[stream] frames=%d encoded=%d bytes=%d kbps=%.1f reconnects=%d drops=%d size=%dx%d nals=%d key=%d",
                frames, n, b, Double(b) * 8.0 / 1000.0, rc, dr, encodedWidth, encodedHeight, nalCount, isKey ? 1 : 0
            )
        }
    }

    private func readParamSets(_ fd: CMVideoFormatDescription) {
        var count = 0
        guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            fd, parameterSetIndex: 0, parameterSetPointerOut: nil,
            parameterSetSizeOut: nil, parameterSetCountOut: &count, nalUnitHeaderLengthOut: nil
        ) == noErr, count >= 2 else {
            NSLog("[stream] PARAMSET_FAILED count=%d", count)
            return
        }
        var ptr: UnsafePointer<UInt8>?
        var size = 0
        if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            fd, parameterSetIndex: 0, parameterSetPointerOut: &ptr,
            parameterSetSizeOut: &size, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil
        ) == noErr, let p = ptr, size > 0 {
            sps = Data(bytes: p, count: size)
        }
        ptr = nil; size = 0
        if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            fd, parameterSetIndex: 1, parameterSetPointerOut: &ptr,
            parameterSetSizeOut: &size, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil
        ) == noErr, let p = ptr, size > 0 {
            pps = Data(bytes: p, count: size)
        }
        NSLog("[stream] 参数集 SPS=%d B PPS=%d B", sps?.count ?? 0, pps?.count ?? 0)
    }

    private static func isKeyFrame(_ sb: CMSampleBuffer) -> Bool {
        guard let arr = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[CFString: Any]],
              let first = arr.first else {
            // 没有附件表时按「同步」处理（首个编码帧必是 IDR）
            return true
        }
        let notSync = first[kCMSampleAttachmentKey_NotSync] as? Bool ?? false
        return !notSync
    }

    // MARK: - TCP（每次都确保连上；失败下一帧再试，不阻塞编码线程）

    private static func send(_ data: Data, host: String, port: UInt16, state: ScreenStream) {
        if state.fd < 0 {
            guard state.connect() else {
                state.lock.lock(); state.drops += 1; state.lock.unlock()
                return
            }
        }
        let ok = data.withUnsafeBytes { (buf: UnsafeRawBufferPointer) -> Bool in
            guard let base = buf.baseAddress else { return false }
            var off = 0
            while off < data.count {
                let n = Darwin.send(state.fd, base.advanced(by: off), data.count - off, 0)
                if n <= 0 { return false }
                off += n
            }
            return true
        }
        if !ok {
            close(state.fd)
            state.fd = -1
            state.lock.lock(); state.reconnects += 1; state.lock.unlock()
        }
    }

    private func connect() -> Bool {
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        guard inet_pton(AF_INET, host, &addr.sin_addr) == 1 else { return false }
        let s = socket(AF_INET, SOCK_STREAM, 0)
        guard s >= 0 else { return false }
        // 发送超时 2s：Mac 侧没起来时不能把编码线程挂死
        var tv = timeval(tv_sec: 2, tv_usec: 0)
        setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        let rc = withUnsafePointer(to: &addr) { p -> Int32 in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard rc == 0 else {
            close(s)
            NSLog("[stream] CONNECT_FAILED %@:%d（Mac 侧还没监听？下一帧重试）", host, Int(port))
            return false
        }
        fd = s
        NSLog("[stream] CONNECTED %@:%d", host, Int(port))
        return true
    }
}
