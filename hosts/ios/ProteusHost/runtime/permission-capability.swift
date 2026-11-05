// hosts/ios/ProteusHost/runtime/permission-capability.swift
// ★★★App 能力 C16：`permission.check` —— 权限状态查询（iOS 侧宿主实现）。
//
// 【为什么需要】`usePermission` 要的 `bridge.getPermission(name)` 在 App 端一直没有宿主方法
//   ⇒ 恒抛 `permission.unsupported`。iOS 本来就能逐框架查授权状态 ⇒ 属"有平台能力、没接线"
//   （与 Android `PermissionCapability` / 鸿蒙 `proteus_permission.h` 同一集）。
//
// 【★★iOS 为什么必须"逐框架"而不是一个统一查询】
//   iOS **没有** Android `checkSelfPermission` / Web `navigator.permissions` 那样的通用查询 API：
//   每类权限归各自的框架管，状态枚举也各不相同（`AVAuthorizationStatus` 四值 /
//   `CLAuthorizationStatus` 五值）。⇒ 本文件是"scope → 对应框架"的映射层，
//   不是"把字符串转给系统"。
//
// 【★★为什么回执里必须有 `declared`（iOS 上这个字段比 Android 更关键）】
//   权限的"用途说明"没写进 `Info.plist` 时，**真正的申请会让 App 被系统直接杀掉**
//   （不是返回 denied，是 terminate——`NSCameraUsageDescription` 缺失的经典崩法）。
//   ⇒ 查状态时先看 Info.plist 有没有对应的 UsageDescription，没有就回 `declared:false`，
//     JS 层据此报 `permission.notDeclared`：这是**能在开发期发现**的问题，
//     否则一路到真机上点相机才崩，而且崩溃日志里只有一句 "This app has crashed because it
//     attempted to access privacy-sensitive data without a usage description"。
//
// 【★口径（与 Android / 鸿蒙一致，见 capability-app-permission.ts 头注释）】
//   只查询、不申请（不弹授权框——真正的申请发生在业务实际使用该能力时）。
//   `notDetermined`（未询问）**统一映射为 denied**：Android/鸿蒙分不出"未询问"与"永久拒绝"，
//   为三端一致，iOS 也损失这一位信息。★这是刻意的取舍，不是漏做。
//
// 【诚实边界】
//   · 回执是**查询瞬间**的状态，不缓存；
//   · 定位的 `restricted`（家长控制等）如实归到 denied（业务唯一可做的动作都是"引导去设置"）；
//   · 本文件由 `check:ios-selfdraw-compile` 的 `swiftc -typecheck` 覆盖，真机由 `run-permission-probe.sh` 验。

import AVFoundation
import CoreLocation

enum PermissionCapability {

    /// 与 `capability-app-permission.ts` 的 `APP_PERMISSION_SCOPES` **同一集**
    static let scopes = ["camera", "microphone", "geolocation"]

    /// 查询 `permission.check`：`{scope}` → `{scope, state, declared, framework}`
    /// - Throws: `WsError.invalid` scope 缺失/不认识（**不静默回 denied**——把"框架不认识"
    ///   伪装成"系统拒绝"会让业务永远查不出问题）
    static func check(_ args: [String: Any]) throws -> [String: Any] {
        // ★可用性探测（`appPermissionAvailable()` 发 `{probe:true}`）：只要方法在就回 ok。
        //   显式处理而不是靠"抛错但不 missing"——后者能让探测歪打正着通过，
        //   却在宿主日志里留一串假错误，排查时误导人。
        if (args["probe"] as? Bool) == true {
            return ["probe": true, "scopes": scopes]
        }
        let scope = (args["scope"] as? String) ?? ""
        if scope.isEmpty {
            throw WsError.invalid("permission.check: 缺少 scope（支持 \(scopes.joined(separator: " / "))）")
        }
        switch scope {
        case "camera":
            // ① 用途说明是否已在 Info.plist（缺失 ⇒ 真申请会**杀进程**，见文件头）
            let declared = hasUsageDescription("NSCameraUsageDescription")
            let st = AVCaptureDevice.authorizationStatus(for: .video)
            return [
                "scope": scope,
                "state": mapAV(st),
                "declared": declared,
                "framework": "AVCaptureDevice(.video)",
            ]
        case "microphone":
            let declared = hasUsageDescription("NSMicrophoneUsageDescription")
            let st = AVCaptureDevice.authorizationStatus(for: .audio)
            return [
                "scope": scope,
                "state": mapAV(st),
                "declared": declared,
                "framework": "AVCaptureDevice(.audio)",
            ]
        case "geolocation":
            let declared = hasUsageDescription("NSLocationWhenInUseUsageDescription")
            let st = locationAuthorization()
            return [
                "scope": scope,
                "state": mapCL(st),
                "declared": declared,
                "framework": "CLLocationManager",
            ]
        default:
            throw WsError.invalid(
                "permission.check: 不认识的 scope「\(scope)」（支持 \(scopes.joined(separator: " / "))）")
        }
    }

    /// `AVAuthorizationStatus` → 两态（口径：notDetermined 归 denied，见文件头）
    private static func mapAV(_ st: AVAuthorizationStatus) -> String {
        switch st {
        case .authorized: return "granted"
        // .denied / .restricted / .notDetermined 一律 denied（业务该做的动作都是"引导去设置/先声明用途"）
        default: return "denied"
        }
    }

    /// `CLAuthorizationStatus` → 两态（`.authorizedAlways` 也算 granted）
    private static func mapCL(_ st: CLAuthorizationStatus) -> String {
        switch st {
        case .authorizedWhenInUse, .authorizedAlways: return "granted"
        default: return "denied"
        }
    }

    /// 读定位授权状态——**零副作用**（只读，不启动定位、不弹框）。
    /// ★用实例属性而不是类方法 `CLLocationManager.authorizationStatus()`：后者在 iOS 14 起已废弃。
    /// ★`CLLocationManager` 必须在**有 run loop 的线程**（通常主线程）创建 ⇒ 非主线程走类方法兜底，
    ///   否则真机上会拿到不可靠的 nil run loop 断言。宿主 `invoke` 由 JS 线程同步调用，两种都可能。
    private static func locationAuthorization() -> CLAuthorizationStatus {
        if Thread.isMainThread {
            return CLLocationManager().authorizationStatus
        }
        return CLLocationManager.authorizationStatus()
    }

    /// Info.plist 里是否有该 key（且非空）——空串等于没写（同样会崩）
    private static func hasUsageDescription(_ key: String) -> Bool {
        guard let v = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return false }
        return !v.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
