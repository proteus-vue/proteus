// hosts/ios/tools/InvokeBytesProbe.swift
// ★★★iOS 二进制腿的**端到端探针**（macOS 本机 · 真实 JavaScriptCore · 由 `pnpm check:ios-invoke-bytes` 驱动）
//
// 【它是什么】在 macOS 上用**真实 JSC**（不是 mock：`JSObjectGetTypedArrayBytesPtr` 等就是设备上那套
//   公开 C API）跑通 iOS 宿主二进制腿的完整回路，并逐条自检：
//     ① 注入可见：`typeof __proteusHostInvokeBytes === 'function'`
//     ② 去程：JS 传 `Uint8Array`（PINV 帧）⇒ 宿主拿到**帧字节**（方法名/url/中文 headers/body 全对）
//     ③ 回执：同步返回的 PRSP 帧与宿主编码器的结果**逐字节相同**，且 JS 侧拿到的是 **Uint8Array**
//        （`instanceof Uint8Array` ✓ 且 `Array.isArray` ✗ —— 这正是"免 JSON"的形态判据）
//     ④ 回推：`pushResolve` ⇒ JS 侧 `__proteusHostResolveBytes` 收到**逐字节相同**的帧
//     ⑤ 反向判据（不静默）：传普通数组 / 空帧 ⇒ 必须**抛 JS 异常**（静默返回 undefined 会让 JS 侧
//        误判为"已受理等回推"——那是最难查的一类假绿）
//     ⑥ 大载荷：1MB body 往返（校验和 + 长度），证明"裸字节通道不吃 JSON 膨胀"
//     ⑦ 记账：`invokeCalls` 与调用次数一致（防"桥装了但从没走过"）
//
// 【★为什么这层判据必须有（与 `verify-jsc.swift` / `verify.mjs` 同族）】「桥在代码里存在」与
//   「桥真的能把字节搬过去」是两件事——JSC 的 TypedArray 指针是**临时**的、JSExport 对 ArrayBuffer
//   不稳、Uint8Array 与 Array 在跨边界时长相相似（都可能被当数组处理）。这些都是"只有真跑一次才知道"
//   的形态，故必须有端到端探针，而不是只靠 grep 判据（`check-no-json-wire` 管"形态在不在"，
//   本探针管"形态**跑得通**"——两层判据互补，缺一即盲）。
//
// 【★诚实边界】本探针用**桩 handler**（`http.request` 回 pending；`echo` 原样回）⇒ 它证明的是
//   **桥与线格式**的通路；真实网络由 `http-capability.swift` 负责（其语义由真机/模拟器场景验）。
//
// 用法：<bin>      （无参数）
// 退出码：0 = 全通过 / 1 = 有 FAIL

import Foundation
import JavaScriptCore

@main
struct InvokeBytesProbeMain {

    static var passed = 0
    static var failed = 0

    static func main() {
        guard let ctx = JSContext() else { err("✗ 无法创建 JSContext"); exit(1) }
        eval(ctx, """
        globalThis.__mkU8 = function (hex) {
          var n = hex.length / 2, a = new Uint8Array(n);
          for (var i = 0; i < n; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
          return a;
        };
        globalThis.__toHex = function (u8) {
          var s = '';
          for (var i = 0; i < u8.length; i++) { var t = u8[i].toString(16); if (t.length === 1) t = '0' + t; s += t; }
          return s;
        };
        globalThis.__sum = function (u8) {
          var s = 0;
          for (var i = 0; i < u8.length; i++) s = (s * 31 + u8[i]) >>> 0;
          return s;
        };
        globalThis.__pushed = '';
        globalThis.__proteusHostResolveBytes = function (u8) { globalThis.__pushed = __toHex(u8); return 'ok'; };
        """)

        let bridge = InvokeBytesBridge()
        var seen: [String] = []
        bridge.handler = { raw in
            guard let f = try? InvokeWire.decodeInvoke(raw) else {
                return try? InvokeWire.encodeResolve(.makeErr("", "探针：去程帧解码失败"))
            }
            seen.append(f.method)
            switch f.method {
            case "http.request":
                // ★异步能力的形态：**同步回 pending 帧**，最终结果稍后回推（与 JS 侧契约一致）
                return try? InvokeWire.encodeResolve(.makePending(f.reqId))
            case "echo":
                var r = InvokeWire.ResolveFrame.makeOK(f.reqId)
                r.body = f.body
                return try? InvokeWire.encodeResolve(r)
            default:
                return try? InvokeWire.encodeResolve(.makeMissingMethod(f.reqId, "未实现：\(f.method)"))
            }
        }
        bridge.install(on: ctx)

        /* ① 注入可见 */
        check(eval(ctx, "typeof __proteusHostInvokeBytes") == "function", "注入可见（`typeof` = function）")

        /* ②③ 去程 + 回执 */
        var f = InvokeWire.InvokeFrame()
        f.method = "http.request"
        f.reqId = "app-async-1"
        f.url = "https://example.com/api"
        f.httpMethod = "POST"
        f.headers = [("X-Test", "中文值"), ("Accept", "application/json")]
        f.params = [("q", "沪深")]
        f.timeoutMs = 5000
        f.responseType = InvokeWire.RESPONSE_TEXT
        f.contentType = "application/json"
        f.body = Array("{\"name\":\"测试\"}".utf8)
        guard let pinv = try? InvokeWire.encodeInvoke(f) else { err("✗ 去程帧编码失败"); exit(1) }
        let expectPending = (try? InvokeWire.encodeResolve(.makePending("app-async-1"))) ?? []

        let got = eval(ctx, """
        (function () {
          var r = __proteusHostInvokeBytes(__mkU8('\(hex(pinv))'));
          return (r instanceof Uint8Array ? '1' : '0') + '|' + (Array.isArray(r) ? '1' : '0') + '|' + __toHex(r);
        })()
        """)
        let parts = got.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
        check(parts.count == 3 && parts[0] == "1", "回执是 `Uint8Array`（instanceof 成立）")
        check(parts.count == 3 && parts[1] == "0", "回执**不是** `Array`（免 JSON 的形态判据）")
        check(parts.count == 3 && parts[2] == hex(expectPending), "同步回执 = pending 帧（逐字节相同）")
        check(seen == ["http.request"], "宿主持到方法名（`\(seen.joined(separator: ","))`）")

        /* ② 字段真的穿过来了（中文 / 多值 headers）——用 peekMethod 之外的完整解码核对 */
        if let decoded = try? InvokeWire.decodeInvoke(pinv) {
            let okFields = decoded.url == f.url && decoded.httpMethod == "POST"
                && decoded.headers?.count == 2 && decoded.headers?.first?.1 == "中文值"
                && decoded.timeoutMs == 5000 && decoded.body == f.body
            check(okFields, "去程帧全字段（含中文 headers 与 body）在宿主侧完整可解")
        } else {
            check(false, "去程帧在宿主侧解码失败")
        }

        /* ④ 回推 */
        var fin = InvokeWire.ResolveFrame.makeOK("app-async-1")
        fin.status = 200
        fin.headers = [("Content-Type", "application/json")]
        fin.body = Array("{\"ok\":1,\"msg\":\"回推中文\"}".utf8)
        guard let finBytes = try? InvokeWire.encodeResolve(fin) else { err("✗ 回程帧编码失败"); exit(1) }
        check(bridge.pushResolve(finBytes), "回推返回 true（JS 侧入口已装）")
        check(eval(ctx, "__pushed") == hex(finBytes), "JS 侧收到逐字节相同的回推帧")

        /* ⑤ 反向判据：坏入参必须抛（不静默） */
        let plainArray = eval(ctx, """
        (function () { try { __proteusHostInvokeBytes([1,2,3]); return 'NO-THROW'; } catch (e) { return 'threw'; } })()
        """)
        check(plainArray == "threw", "入参是普通数组 ⇒ 抛 JS 异常（不静默返回）")
        let emptyFrame = eval(ctx, """
        (function () { try { __proteusHostInvokeBytes(new Uint8Array(0)); return 'NO-THROW'; } catch (e) { return 'threw'; } })()
        """)
        check(emptyFrame == "threw", "入参是空帧 ⇒ 抛 JS 异常（不静默返回）")

        /* ⑥ 大载荷（1MB）：Swift 侧造帧注入 JS（★不写成 2MB 的源码字面量）→ 宿主原样回 → 长度 + 校验和 */
        guard let bigFrame = try? InvokeWire.encodeInvoke(echoFrame(bodyLength: 1048576)),
              let bigRef = InvokeBytesBridge.makeUint8Array(ctx.jsGlobalContextRef!, bigFrame) else {
            check(false, "1MB 去程帧构造/注入失败")
            exit(1)
        }
        ctx.setObject(JSValue(jsValueRef: bigRef, in: ctx), forKeyedSubscript: "__bigFrame" as NSString)
        let big = eval(ctx, """
        (function () {
          var r = __proteusHostInvokeBytes(__bigFrame);
          return r.length + '|' + __sum(r);
        })()
        """)
        if let echoBytes = try? InvokeWire.encodeResolve(echoReply(bodyLength: 1048576)) {
            let expectBig = "\(echoBytes.count)|\(rollingSum(echoBytes))"
            check(big == expectBig, "1MB body 往返：长度+滚动和一致（期望 \(expectBig)，实得 \(big)）")
        } else {
            check(false, "1MB 回程帧编码失败")
        }

        /* ⑦ 记账（防"桥装了但没走过"） */
        let calls = (bridge.stats()["invoke_calls"] as? Int) ?? -1
        check(calls == 2, "host 侧记账 invoke_calls=\(calls)（1 小帧 + 1 大帧；两次坏入参在取参前被拒 ⇒ 不记账）")

        print("")
        if failed > 0 { err("✗ iOS 二进制腿端到端探针：\(passed) 通过 / \(failed) 失败"); exit(1) }
        print("[check-ios-invoke-bytes] ✓ 全部通过（\(passed) 项）—— JSC 字节腿可搬大载荷、回推逐字节一致、坏入参不静默")
        exit(0)
    }

    /* ────────────────────────── 夹具 ────────────────────────── */

    /// 1MB echo 去程帧（JS 侧用它的字节，宿主 handler 把 body 原样装进回程帧）
    static func echoFrame(bodyLength: Int) -> InvokeWire.InvokeFrame {
        var f = InvokeWire.InvokeFrame()
        f.method = "echo"
        f.reqId = "big-1"
        f.body = syntheticBytes(bodyLength)
        return f
    }

    static func echoReply(bodyLength: Int) -> InvokeWire.ResolveFrame {
        var r = InvokeWire.ResolveFrame.makeOK("big-1")
        r.body = syntheticBytes(bodyLength)
        return r
    }

    /// 与 JS 侧 `(i*31)&255` 同源的合成字节（两端各自生成，不靠"传过去再看"）
    static func syntheticBytes(_ n: Int) -> [UInt8] {
        var out = [UInt8](repeating: 0, count: n)
        for i in 0..<n { out[i] = UInt8((i &* 31) & 255) }
        return out
    }

    /// 与 JS `__sum` 同源的滚动校验和（UInt32 环绕）
    static func rollingSum(_ b: [UInt8]) -> UInt32 {
        var s: UInt32 = 0
        for x in b { s = (s &* 31) &+ UInt32(x) }
        return s
    }

    /* ────────────────────────── 工具 ────────────────────────── */

    @discardableResult
    static func eval(_ ctx: JSContext, _ expr: String) -> String {
        ctx.evaluateScript(expr)?.toString() ?? ""
    }

    static func check(_ ok: Bool, _ what: String) {
        if ok { passed += 1; print("  ✓ \(what)") } else { failed += 1; err("  ✗ \(what)") }
    }

    static func hex(_ b: [UInt8]) -> String {
        var s = ""
        s.reserveCapacity(b.count * 2)
        for x in b {
            let t = String(x, radix: 16)
            s += t.count == 1 ? "0" + t : t
        }
        return s
    }

    static func err(_ m: String) {
        FileHandle.standardError.write((m + "\n").data(using: .utf8)!)
    }
}
