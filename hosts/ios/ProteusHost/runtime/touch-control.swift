// hosts/ios/ProteusHost/runtime/touch-control.swift
// ★★★触控回传（决策 #1295）：Studio 画布上的点击/滑动/长按 → 注入到宿主自己的页面
//
// 【先说清边界：这不是"系统级触控"】
//   iOS 没有任何公开 API 能从外部给**整台手机**注入触摸（XCUITest 只能作用于被测 app 且要额外
//   runner+签名；`IOHIDEvent` 是私有 entitlement，只有 Apple 内部/越狱能用）。
//   但 Studio 预览的**就是我们自己编译的宿主**，所以"注入到本进程"不仅够了，语义还更准确：
//   和 Android `input tap`（系统级）在用途上等价 —— 你点画布，页面就响应。
//
// 【为什么复用 emitGesture 而不是自己造 UIEvent】
//   宿主真实触摸的路径是 `touchesEnded` → `classifyAndEmit` → `emitGesture`。
//   自己合成 UITouch/UIEvent 属私有 API；而直接调 `emitGesture` 走的是**同一个派发器**，
//   命中、冒泡、JS 通知全部一致 ⇒ "注入的结果 = 真手指的结果"这件事是可验证的。
//
// 【为什么是"手机主动连 Mac"】
//   与推流同向：iOS 上没有可靠的入站监听（且 Mac 不知道手机的 IP）。
//   所以本文件**主动连** `PROTEUS_TOUCH_CONTROL=host:port`（Studio 侧监听 9002），
//   之后按行收 JSON 指令。断线自动重连（Studio 重启不影响手机）。
//
// 【协议（一行一条，够用就好）】
//   {"t":"tap","nx":0.5,"ny":0.2}
//   {"t":"swipe","nx":0.5,"ny":0.8,"dx":0,"dy":-0.4}
//   {"t":"longpress","nx":0.5,"ny":0.2}
//   ★坐标用**归一化 0..1**（相对画面），不是像素也不是逻辑点：
//     ReplayKit 给的帧是 888×1920（像素），注入要的是逻辑点（390×844）——
//     中间还有系统缩放。传归一化后，由宿主自己乘 bounds，**两边都不用猜 scale**。

import Foundation
import UIKit

final class TouchControl {
    static let shared = TouchControl()

    private var host = ""
    private var port: UInt16 = 0
    private var configured = false
    private var fd: Int32 = -1
    private let lock = NSLock()

    /// 被注入的视图（弱引用：别让观测装置拖住 UI 生命周期）
    private weak var target: SelfDrawView?
    private var taps = 0
    private var fails = 0

    /// 由 shell 在 `viewDidAppear` 里注册（那时视图已就绪）
    func register(_ view: SelfDrawView) {
        target = view
    }

    /// 读环境变量并起线程；未配置时**零副作用**（和推流同纪律）
    func startIfConfigured() {
        guard !configured else { return }
        let env = ProcessInfo.processInfo.environment["PROTEUS_TOUCH_CONTROL"] ?? ""
        guard !env.isEmpty else { return }
        let parts = env.split(separator: ":")
        guard parts.count == 2, let p = UInt16(parts[1]) else {
            NSLog("[touch] CONFIG_FAILED 无法解析 PROTEUS_TOUCH_CONTROL=%@（期望 host:port）", env)
            return
        }
        host = String(parts[0])
        port = p
        configured = true
        NSLog("[touch] 控制通道 → %@:%d（Studio 侧监听，手机主动连）", host, Int(p))
        let t = Thread { [weak self] in self?.loop() }
        t.name = "touch-control"
        t.start()
    }

    // MARK: - 连接

    private func loop() {
        while true {
            let s = connect()
            if s < 0 {
                Thread.sleep(forTimeInterval: 1.0)
                continue
            }
            lock.lock(); fd = s; lock.unlock()
            NSLog("[touch] CONNECTED %@:%d", host, Int(port))
            readLines(s)
            lock.lock(); close(s); fd = -1; lock.unlock()
            NSLog("[touch] 连接断开（Studio 重启？1s 后重连）")
            Thread.sleep(forTimeInterval: 1.0)
        }
    }

    private func connect() -> Int32 {
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        guard inet_pton(AF_INET, host, &addr.sin_addr) == 1 else { return -1 }
        let s = socket(AF_INET, SOCK_STREAM, 0)
        guard s >= 0 else { return -1 }
        var noSigPipe: Int32 = 1
        setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))
        let rc = withUnsafePointer(to: &addr) { p -> Int32 in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        if rc != 0 {
            close(s)
            return -1
        }
        return s
    }

    private func readLines(_ s: Int32) {
        var buf = [UInt8](repeating: 0, count: 4096)
        var acc = Data()
        while true {
            let n = read(s, &buf, buf.count)
            if n <= 0 { return }
            acc.append(contentsOf: buf[0..<n])
            while let nl = acc.firstIndex(of: 0x0A) {
                let line = acc.prefix(upTo: nl)
                acc.removeSubrange(acc.startIndex...nl)
                if let text = String(data: line, encoding: .utf8), !text.isEmpty {
                    handle(text)
                }
            }
        }
    }

    // MARK: - 指令分发

    private func handle(_ line: String) {
        guard let d = line.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let type = o["t"] as? String else {
            NSLog("[touch] BAD_CMD %@", line)
            return
        }
        let nx = (o["nx"] as? Double) ?? 0.5
        let ny = (o["ny"] as? Double) ?? 0.5
        /* ★必须回主线程：`emitGesture` 会改 CALayer/派发 JS，非主线程是未定义行为 */
        DispatchQueue.main.async { [weak self] in
            guard let self, let v = self.target else {
                self?.fails += 1
                NSLog("[touch] NO_TARGET（视图还没注册）")
                return
            }
            let res = v.injectTouch(nx, ny, type,
                                    dx: (o["dx"] as? Double) ?? 0,
                                    dy: (o["dy"] as? Double) ?? 0)
            self.taps += 1
            NSLog("[touch] %@ nx=%.3f ny=%.3f ⇒ %@（累计 %d 次）", type, nx, ny, res, self.taps)
        }
    }
}

/*
 * ★★★#1344：`injectTouch` 从 `selfdraw-scene.swift` 移到这里（该文件 8219 → 8250 行，
 *   越过 check:file-size 的"存量只减不增"）。移到这里的理由不只是省行：
 *   本文件本就是**触控回传的职责落点**（控制连接 + 协议 + 注入），
 *   文件头已解释"为什么必须复用 emitGesture"——注入入口放在协议旁边，改协议时不必再开
 *   一个 8000 行的文件。
 */
extension SelfDrawView {
    /// 触控回传入口（决策 #1295）：把**归一化坐标**注入成一次手势。
    ///
    /// 【为什么走 `emitGesture` 而不是合成 UITouch】`touchesEnded` 最终也是调它
    ///   （真触摸 → classifyAndEmit → emitGesture）⇒ 走同一派发器，命中/冒泡/JS 通知全一致，
    ///   "注入结果 = 真手指结果"才成立。合成 UIEvent 属私有 API，不用。
    ///
    /// 【为什么收归一化 0..1】推流帧是像素（如 888×1920），注入要逻辑点（如 390×844），
    ///   中间还有系统缩放。传归一化后由**这里**乘 `bounds`，两边都不必猜 scale。
    /// - Returns: 诊断串（进宿主日志；判据靠它确认"真的注入了"）
    @discardableResult
    func injectTouch(_ nx: Double, _ ny: Double, _ type: String, dx: Double = 0, dy: Double = 0) -> String {
        guard bounds.width > 1, bounds.height > 1 else { return "no-bounds" }
        let x = min(max(nx, 0), 1) * Double(bounds.width)
        let y = min(max(ny, 0), 1) * Double(bounds.height)
        switch type {
        case "longpress":
            emitGesture(x: x, y: y, type: "longpress")
            return String(format: "longpress@%.1f,%.1f", x, y)
        case "swipe":
            /* 方向由位移符号推导（与协议注释一致：类型 = `swipe:<dir>`）*/
            let dir: String
            if abs(dx) > abs(dy) { dir = dx > 0 ? "right" : "left" }
            else { dir = dy > 0 ? "down" : "up" }
            emitGesture(x: x, y: y, type: "swipe:\(dir)")
            return String(format: "swipe:%@@%.1f,%.1f", dir, x, y)
        default:
            emitGesture(x: x, y: y, type: "tap")
            return String(format: "tap@%.1f,%.1f", x, y)
        }
    }
}
