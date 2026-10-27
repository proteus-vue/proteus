// hosts/ios/ProteusHost/runtime/phone-call-capability.swift
// ★★★#1285 App 能力 C21：`makePhoneCall` —— 拨号盘唤起（iOS 侧）。
//
// 【为什么需要】`usePhoneCall` 要的 `bridge.makePhoneCall(number)` 在 App 端一直没有宿主方法
//   ⇒ 恒抛 `phone-call.unsupported`。iOS 本来就能用 `tel:` URL 唤醒拨号 ⇒ 属"有平台能力、没接线"。
//
// 【★语义边界（别被读成"能打电话"）】
//   `UIApplication.open(tel:...)` **只打开拨号盘并预填号码**，不发起通话、不需要任何权限。
//   返回 `{dispatched:true}` = 已交给系统，不是"已拨出"。
//   ★"直接拨出"在 iOS 上**公开 API 做不到**（`telprompt:` 是私有行为、审核会拒）——如实不提供。
//
// 【★★号码校验（安全基线，同族 #1257）】
//   未校验的字符串拼进 `tel:` URL 就是注入面（`/`、`?`、`#` 会改变 URL 结构）。
//   ⇒ 白名单：`0-9 + - ( ) space # * ,`，且至少 1 位数字；非法字符**直接报错**，不清洗后放行。
//
// 【诚实边界】
//   · 模拟器没有拨号盘 ⇒ `canOpenURL` 返回 false ⇒ 本方法报 `unsupported`（不是假成功）。
//   · 需要真机验证；本文件本身由 `check:ios-selfdraw-compile` 的 `swiftc -typecheck` 覆盖。

import UIKit

enum PhoneCallCapability {

    /// 号码白名单（与 Android `PhoneCallCapability.isValidNumber` **同一集**，改一处要改两处）。
    static func isValidNumber(_ s: String) -> Bool {
        if s.isEmpty || s.count > 32 { return false }
        var digits = 0
        for c in s {
            let ok = c.isNumber || c == "+" || c == "-" || c == "(" || c == ")" || c == " " || c == "#" || c == "*" || c == ","
            if !ok { return false }
            if c.isNumber { digits += 1 }
        }
        return digits > 0
    }

    /// `phone.call`：`{ number }` → `{ dispatched, uri }`
    static func dial(_ args: [String: Any]) throws -> [String: Any] {
        let number = (args["number"] as? String) ?? ""
        guard isValidNumber(number) else {
            // ★不回显原始号码（可能敏感，且会进日志）
            throw WsError.invalid("phone.call: 号码非法（只允许 0-9 + - ( ) 空格 # * , 且至少 1 位数字）")
        }
        let raw = "tel:" + number
        guard let url = URL(string: raw) else {
            throw WsError.invalid("phone.call: 无法构造 tel URL")
        }
        // ★`canOpenURL` 在无拨号能力的环境（模拟器）返回 false ⇒ 如实 unsupported
        guard UIApplication.shared.canOpenURL(url) else {
            throw WsError.unsupported("phone.call")
        }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        return ["dispatched": true, "uri": raw]
    }
}
