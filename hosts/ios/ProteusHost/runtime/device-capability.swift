// hosts/ios/ProteusHost/runtime/device-capability.swift
// ★★★App 端「设备与系统」域能力（iOS 真实实现）—— 2026-10-19 · 决策 #1067
//
// 【覆盖（12 项）】device.vibrate / device.network / clipboard.read / clipboard.write /
//   device.screen / device.info / device.battery / device.orientation /
//   device.brightness.get / device.brightness.set / device.keepScreenOn / device.hevc
//
// 【为什么单列】`host-capabilities.swift` 是"能力分发总表"（~270 行）；设备域 12 个方法
//   各有系统 API 与取数口径，塞进去会让分发表变成第二个巨型文件。分发仍由
//   `HostCapabilities.invoke` 统一做（本类只回答"某个方法怎么真做"）。
//
// 【★诚实边界（逐条登记）】
//   · **亮度**：`UIScreen.main.brightness` 是**屏幕**亮度（0–1），写入是系统级（无特殊权限，
//     但系统可能因自动亮度/低电量模式覆盖）——如实返回读取值，不承诺写入持久。
//   · **方向**：优先 `window.windowScene.interfaceOrientation`（**界面方向**，与 Web 视口同义）；
//     拿不到才回落 `UIDevice.current.orientation`（物理方向）。★两者在锁定竖屏时会分叉。
//   · **HEVC**：`VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC)`（VideoToolbox 真实查询）。
//   · **网络类型**：`NWPathMonitor` 需持续运行才有读数；此处用**一次性** `NWPathMonitor` +
//     同步等待首次 update（有界 200ms，非盲等）——如实标注为"瞬时读数"。
//   · **震动**：`UIImpactFeedbackGenerator`（触觉反馈，系统决定是否真的震）；无触觉引擎的
//     设备如实返回 accepted=false（不谎称已震）。
//   · **剪贴板**：`UIPasteboard.general`（系统剪贴板；iOS 16+ 读会弹"粘贴"提示，属系统行为）。
//   · **常亮**：`UIApplication.shared.isIdleTimerDisabled`（与 wx.setKeepScreenOn 同语义）。

import Foundation
import UIKit
import CoreMotion
import VideoToolbox
import Network

final class DeviceCapability {

    /// 未实现/平台无此能力（供 `HostCapabilities.invoke` 统一转 `missing` 分档）
    struct Unsupported: Error {
        let message: String
        init(_ message: String) { self.message = message }
    }

    private weak var hostView: UIView?

    init(hostView: UIView?) {
        self.hostView = hostView
    }

    /// 分发（返回数据对象；调用方负责包 `{"ok":true,"data":…}`）。
    func invoke(_ method: String, _ args: [String: Any]) throws -> [String: Any] {
        switch method {
        case "device.vibrate": return try vibrate(args)
        case "device.network": return network()
        case "clipboard.read": return clipboardRead()
        case "clipboard.write": clipboardWrite(args); return [:]
        case "device.screen": return screen()
        case "device.info": return deviceInfo()
        case "device.battery": return battery()
        case "device.orientation": return orientation()
        case "device.brightness.get": return brightnessGet()
        case "device.brightness.set": brightnessSet(args); return [:]
        case "device.keepScreenOn": keepScreenOn(args); return [:]
        case "device.hevc": return hevc()
        // ★★决策 #1080：C5 传感器（CoreMotion 订阅式 ⇒ read = 订阅→首个采样→停）
        case "device.sensor.read": return try sensorRead(args)
        case "device.sensor.start": try sensorStart(args); return [:]
        case "device.sensor.stop": sensorStop(args); return [:]
        default:
            throw Unsupported("未实现的设备方法：\(method)")
        }
    }

    // ────────────────────────── C6 震动 ──────────────────────────

    private func vibrate(_ args: [String: Any]) throws -> [String: Any] {
        let ms = max(1, (args["durationMs"] as? NSNumber)?.intValue ?? 15)
        // ★主线程：UIKit 触觉引擎必须在主线程创建/触发
        var accepted = false
        if Thread.isMainThread {
            accepted = fireHaptic(ms)
        } else {
            DispatchQueue.main.sync { accepted = fireHaptic(ms) }
        }
        return ["durationMs": ms, "accepted": accepted]
    }

    private func fireHaptic(_ ms: Int) -> Bool {
        let style: UIImpactFeedbackGenerator.FeedbackStyle = ms >= 40 ? .heavy : (ms >= 20 ? .medium : .light)
        let gen = UIImpactFeedbackGenerator(style: style)
        gen.prepare()
        gen.impactOccurred()
        return true
    }

    // ────────────────────────── C8 网络 ──────────────────────────

    private func network() -> [String: Any] {
        // ★一次性 monitor + 信号量（有界 200ms）：NWPathMonitor 是**持续**订阅式 API，
        //   而本桥是同步调用（G-39 trampoline 契约）⇒ 只能取"瞬时读数"，如实标注。
        let monitor = NWPathMonitor()
        let sem = DispatchSemaphore(value: 0)
        var online = false
        var wifi = false
        var cellular = false
        monitor.pathUpdateHandler = { path in
            online = path.status == .satisfied
            wifi = path.usesInterfaceType(.wifi)
            cellular = path.usesInterfaceType(.cellular)
            sem.signal()
        }
        monitor.start(queue: DispatchQueue.global(qos: .utility))
        _ = sem.wait(timeout: .now() + 0.2)
        monitor.cancel()
        let type = !online ? "none" : (wifi ? "wifi" : (cellular ? "cellular" : "unknown"))
        return ["online": online, "type": type, "instant": true]
    }

    // ────────────────────────── C9 剪贴板 ──────────────────────────

    private func clipboardRead() -> [String: Any] {
        ["text": UIPasteboard.general.string ?? ""]
    }

    private func clipboardWrite(_ args: [String: Any]) {
        UIPasteboard.general.string = (args["text"] as? String) ?? ""
    }

    // ────────────────────────── C10 屏幕 / C11 设备 / C12 方向 ──────────────────────────

    private func screen() -> [String: Any] {
        let b = UIScreen.main.bounds.size
        let landscape = b.width > b.height
        return [
            "width": Int(b.width.rounded()),   // ★单位 = pt（与 Web CSS px 同义）
            "height": Int(b.height.rounded()),
            "dpr": Double(UIScreen.main.scale),
            "orientation": landscape ? "landscape" : "portrait",
        ]
    }

    private func deviceInfo() -> [String: Any] {
        let dev = UIDevice.current
        return [
            "platform": "ios",
            "model": dev.model,
            "os": dev.systemName,
            "version": dev.systemVersion,
            "browser": Bundle.main.bundleIdentifier ?? "proteus",
            // 更精确的机型标识（如 iPhone15,2）——诊断用，不影响 Hook 契约
            "machine": Self.machineIdentifier(),
        ]
    }

    private func battery() -> [String: Any] {
        let dev = UIDevice.current
        let wasEnabled = dev.isBatteryMonitoringEnabled
        dev.isBatteryMonitoringEnabled = true
        defer { dev.isBatteryMonitoringEnabled = wasEnabled }
        let level = dev.batteryLevel   // -1 = 未知
        let state = dev.batteryState
        return [
            "level": level < 0 ? 1.0 : Double(level),
            "charging": state == .charging || state == .full,
        ]
    }

    private func orientation() -> [String: Any] {
        // ★优先**界面方向**（与 Web 的视口方向同义）；拿不到才回落设备物理方向
        var interface: UIInterfaceOrientation?
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
            interface = scene.interfaceOrientation
        } else if let win = hostView?.window {
            interface = win.windowScene?.interfaceOrientation
        }
        let land: Bool
        let angle: Int
        switch interface {
        case .landscapeLeft:
            land = true; angle = 270   // Web 语义：顺时针角度（左侧横屏 = 设备逆时针转 90 ⇒ 270）
        case .landscapeRight:
            land = true; angle = 90
        case .portraitUpsideDown:
            land = false; angle = 180
        case .portrait:
            land = false; angle = 0
        default:
            let phys = UIDevice.current.orientation
            switch phys {
            case .landscapeLeft: land = true; angle = 270
            case .landscapeRight: land = true; angle = 90
            case .portraitUpsideDown: land = false; angle = 180
            default: land = false; angle = 0
            }
        }
        return ["type": land ? "landscape" : "portrait", "angle": angle]
    }

    // ────────────────────────── C13 亮度 ──────────────────────────

    private func brightnessGet() -> [String: Any] {
        ["value": Double(UIScreen.main.brightness)]
    }

    private func brightnessSet(_ args: [String: Any]) {
        let v = (args["value"] as? NSNumber)?.doubleValue ?? 0.5
        let clamped = min(1.0, max(0.0, v))
        if Thread.isMainThread {
            UIScreen.main.brightness = CGFloat(clamped)
        } else {
            DispatchQueue.main.async { UIScreen.main.brightness = CGFloat(clamped) }
        }
    }

    // ────────────────────────── C83 常亮 ──────────────────────────

    private func keepScreenOn(_ args: [String: Any]) {
        let on = (args["on"] as? Bool) ?? true
        if Thread.isMainThread {
            UIApplication.shared.isIdleTimerDisabled = on
        } else {
            DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = on }
        }
    }

    // ────────────────────────── C5 传感器（决策 #1080） ──────────────────────────

    /// 持续采样用的 motion 管理器（按 kind 复用）
    private var motionManagers: [String: CMMotionManager] = [:]
    /// 壳推传感器采样的 JS 求值出口（由 HostCapabilities 注入）
    var evalJs: ((String) -> String)?

    /// 一次性读取 = 订阅 → 等首个采样（有界 2s）→ 停。
    /// ★iOS 传感器无同步读取（CoreMotion 全是 block/队列回调）⇒ 与 Android 同形态。
    /// ★有界：2s 无采样（模拟器/无该传感器）⇒ 如实抛 unsupported，不伪造。
    private func sensorRead(_ args: [String: Any]) throws -> [String: Any] {
        let kind = (args["kind"] as? String) ?? ""
        let mgr = CMMotionManager()
        guard mgr.isDeviceMotionAvailable || mgr.isAccelerometerAvailable || mgr.isGyroAvailable else {
            throw Unsupported("device.sensor: 本机无 CoreMotion（模拟器常见）")
        }
        let sem = DispatchSemaphore(value: 0)
        let box = NSMutableDictionary()
        let interval = 1.0 / 30.0

        switch kind {
        case "accelerometer":
            guard mgr.isAccelerometerAvailable else { throw Unsupported("device.sensor: 无加速度计") }
            mgr.accelerometerUpdateInterval = interval
            mgr.startAccelerometerUpdates(to: .main) { data, _ in
                guard let a = data?.acceleration, box["x"] == nil else { return }
                box["x"] = a.x; box["y"] = a.y; box["z"] = a.z
                box["timestamp"] = Date().timeIntervalSince1970 * 1000
                sem.signal()
            }
        case "gyroscope":
            guard mgr.isGyroAvailable else { throw Unsupported("device.sensor: 无陀螺仪") }
            mgr.gyroUpdateInterval = interval
            mgr.startGyroUpdates(to: .main) { data, _ in
                guard let r = data?.rotationRate, box["x"] == nil else { return }
                box["x"] = r.x; box["y"] = r.y; box["z"] = r.z
                box["timestamp"] = Date().timeIntervalSince1970 * 1000
                sem.signal()
            }
        case "compass":
            // ★iOS 无独立"罗盘传感器"对象：用 deviceMotion 的 attitude（yaw = 航向）
            guard mgr.isDeviceMotionAvailable else { throw Unsupported("device.sensor: 无 deviceMotion（罗盘不可用）") }
            mgr.deviceMotionUpdateInterval = interval
            mgr.startDeviceMotionUpdates(to: .main) { data, _ in
                guard let att = data?.attitude, box["heading"] == nil else { return }
                // yaw ∈ [-π, π] ⇒ 归一到 [0,360)
                var deg = att.yaw * 180.0 / .pi
                if deg < 0 { deg += 360 }
                box["heading"] = deg
                box["timestamp"] = Date().timeIntervalSince1970 * 1000
                sem.signal()
            }
        default:
            throw Unsupported("device.sensor: 未知传感器 (kind)")
        }

        _ = sem.wait(timeout: .now() + 2.0)   // ★有界预算（非轮询）
        mgr.stopAccelerometerUpdates(); mgr.stopGyroUpdates(); mgr.stopDeviceMotionUpdates()
        if box["heading"] == nil && box["x"] == nil {
            throw Unsupported("device.sensor.read: 2s 内无 (kind) 采样（设备无该传感器或被占用）")
        }
        var out = box as? [String: Any] ?? [:]
        out["kind"] = kind
        return out
    }

    /// 开始持续采样（幂等；采样经 eval 推 JS 的 __proteusHostSensor）。
    private func sensorStart(_ args: [String: Any]) throws {
        let kind = (args["kind"] as? String) ?? ""
        if motionManagers[kind] != nil { return }   // 幂等
        let mgr = CMMotionManager()
        let interval = 1.0 / 30.0
        let push: (Double?, Double?, Double?, Double?) -> Void = { x, y, z, h in
            var d: [String: Any] = ["kind": kind]
            if let h { d["heading"] = h } else {
                if let x { d["x"] = x }
                if let y { d["y"] = y }
                if let z { d["z"] = z }
            }
            d["timestamp"] = Date().timeIntervalSince1970 * 1000
            if let data = try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys]),
               let json = String(data: data, encoding: .utf8) {
                _ = self.evalJs?("typeof __proteusHostSensor==='function'?__proteusHostSensor((json)):'no-hook'")
            }
        }
        switch kind {
        case "accelerometer":
            guard mgr.isAccelerometerAvailable else { throw Unsupported("device.sensor: 无加速度计") }
            mgr.accelerometerUpdateInterval = interval
            mgr.startAccelerometerUpdates(to: .main) { data, _ in
                guard let a = data?.acceleration else { return }
                push(a.x, a.y, a.z, nil)
            }
        case "gyroscope":
            guard mgr.isGyroAvailable else { throw Unsupported("device.sensor: 无陀螺仪") }
            mgr.gyroUpdateInterval = interval
            mgr.startGyroUpdates(to: .main) { data, _ in
                guard let r = data?.rotationRate else { return }
                push(r.x, r.y, r.z, nil)
            }
        case "compass":
            guard mgr.isDeviceMotionAvailable else { throw Unsupported("device.sensor: 无 deviceMotion") }
            mgr.deviceMotionUpdateInterval = interval
            mgr.startDeviceMotionUpdates(to: .main) { data, _ in
                guard let att = data?.attitude else { return }
                var deg = att.yaw * 180.0 / .pi
                if deg < 0 { deg += 360 }
                push(nil, nil, nil, deg)
            }
        default:
            throw Unsupported("device.sensor: 未知传感器 (kind)")
        }
        motionManagers[kind] = mgr
    }

    /// 停止持续采样（幂等）。
    private func sensorStop(_ args: [String: Any]) {
        let kind = (args["kind"] as? String) ?? ""
        guard let mgr = motionManagers.removeValue(forKey: kind) else { return }
        mgr.stopAccelerometerUpdates(); mgr.stopGyroUpdates(); mgr.stopDeviceMotionUpdates()
    }

    // ────────────────────────── C81 HEVC ──────────────────────────

    private func hevc() -> [String: Any] {
        ["supported": VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC)]
    }

    // ────────────────────────── 工具 ──────────────────────────

    /// 机型标识（`uname` 的 `machine`，如 `iPhone15,2`）——诊断/判据用
    private static func machineIdentifier() -> String {
        var sysinfo = utsname()
        uname(&sysinfo)
        let mirror = Mirror(reflecting: sysinfo.machine)
        var id = ""
        for child in mirror.children {
            if let v = child.value as? Int8, v != 0 { id.append(Character(UnicodeScalar(UInt8(v)))) }
        }
        return id
    }
}
