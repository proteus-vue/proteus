// hosts/ios/tools/InvokeWireParity.swift
// ★★二进制线格式的**跨语言对拍运行器**（Swift/macOS-only · 由 `pnpm check:invoke-wire-parity` 驱动）
//
// 【它是什么】读 `scripts/invoke-wire-golden.ts` 产出的黄金向量（TSV），对 Swift 侧唯一实现
//   `InvokeWire`（`hosts/ios/ProteusHost/runtime/InvokeWire.swift`）做三件事，并**逐条自检**：
//     ① kind=invoke  ⇒ `encodeInvoke(decodeInvoke(input))` 必须与 TS 的往返结果**逐字节相同**；
//     ② kind=resolve ⇒ 同法（回程帧）；
//     ③ kind=reject-* ⇒ 对应解码器必须**抛错**（坏 magic / 坏版本 / 尾部残留 / 截断 ⇒ 不许静默接受）；
//   另：kind=invoke 时还验 `peekMethod(input)`（另一条独立入口——不透支全帧解码）。
//
// 【★为什么往返即足够（不做逐字段 dump 比对）】`encode(decode(x)) == x` 在**全字段**上是强断言：
//   任一字段被漏读 / 误读 / 长度算错，重编码的字节就不同。且"期望值"来自 TS 自己的往返 ⇒
//   断言的是「**Swift 与 TS 语义等价**」，而不是「Swift 等于人手抄的字节串」（见 golden 生成器头注）。
//
// 【★为什么不在 app 里】本文件位于 `hosts/ios/tools/`（**不在** `ProteusHost/` 内，也不在
//   `check-selfdraw-compile.sh` 的 `HOST_SRCS` 清单里）⇒ 不会被编进任何 .app（它与 UIKit App 的
//   `@main` 会冲突）；它只被 `check:invoke-wire-parity` 用 `xcrun swiftc` 在**本机 macOS** 上跑。
//   ⇒ 与 Java 腿（`hosts/android/tools/InvokeWireParity.java`）同一纪律：#22 的机器化对策。
//
// 用法：<bin> <golden.tsv>
// 退出码：0 = 全通过 / 1 = 有 FAIL

import Foundation

@main
struct InvokeWireParityMain {

    static var passed = 0
    static var failed = 0

    static func main() {
        let args = CommandLine.arguments
        guard args.count >= 2 else {
            err("用法：InvokeWireParity <golden.tsv>")
            exit(2)
        }
        guard let text = try? String(contentsOfFile: args[1], encoding: .utf8) else {
            err("读不到黄金向量文件：\(args[1])")
            exit(2)
        }
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.hasSuffix("\r") ? String(raw.dropLast()) : String(raw)
            if line.isEmpty || line.hasPrefix("#") { continue }
            let c = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
            if c.count < 5 {
                fail("<列数不足>", "行只有 \(c.count) 列（期望 5）：\(line)")
                continue
            }
            run(c[0], c[1], c[2], c[3], c[4])
        }
        print("")
        print("[check-invoke-wire-parity] Swift 侧自检：\(passed) 通过 / \(failed) 失败")
        if failed > 0 {
            err("✗ 二进制线格式**跨语言不等价**——Swift 侧 `InvokeWire` 与 TS 侧 `packages/api/src/invoke-wire.ts` 已漂移。")
            err("  修法：以 TS 为 SSOT 改 Swift（不要反向改 golden——golden 由 TS 生成）。")
            exit(1)
        }
        exit(0)
    }

    static func run(_ name: String, _ kind: String, _ inputHex: String, _ expectHex: String, _ extra: String) {
        let input = unhex(inputHex)
        switch kind {
        case "invoke":
            do {
                let got = hex(try InvokeWire.encodeInvoke(try InvokeWire.decodeInvoke(input)))
                if got != expectHex {
                    fail(name, "往返字节不符\n      期望 \(preview(expectHex))\n      实得 \(preview(got))")
                    return
                }
                let m = InvokeWire.peekMethod(input)
                if m != extra {
                    fail(name, "peekMethod 不符：期望 \(extra)，实得 \(m)")
                    return
                }
                ok(name, "invoke 往返 \(input.count)B · peekMethod=\(m)")
            } catch {
                fail(name, "抛了非预期异常：\(error)")
            }
        case "resolve":
            do {
                let got = hex(try InvokeWire.encodeResolve(try InvokeWire.decodeResolve(input)))
                if got != expectHex {
                    fail(name, "往返字节不符\n      期望 \(preview(expectHex))\n      实得 \(preview(got))")
                    return
                }
                ok(name, "resolve 往返 \(input.count)B")
            } catch {
                fail(name, "抛了非预期异常：\(error)")
            }
        case "reject-invoke":
            var threw = false
            do { _ = try InvokeWire.decodeInvoke(input) } catch { threw = true }
            if !threw { fail(name, "坏帧被**静默接受**（decodeInvoke 未抛错）——判据失守"); return }
            ok(name, "坏帧被拒（decodeInvoke 抛错）")
        case "reject-resolve":
            var threw = false
            do { _ = try InvokeWire.decodeResolve(input) } catch { threw = true }
            if !threw { fail(name, "坏帧被**静默接受**（decodeResolve 未抛错）——判据失守"); return }
            ok(name, "坏帧被拒（decodeResolve 抛错）")
        default:
            fail(name, "未知 kind：\(kind)（golden 与运行器版本不匹配？）")
        }
    }

    /* ────────────────────────── 工具 ────────────────────────── */

    static func ok(_ name: String, _ detail: String) {
        passed += 1
        print("  ✓ \(name) —— \(detail)")
    }

    static func fail(_ name: String, _ why: String) {
        failed += 1
        err("  ✗ \(name) —— \(why)")
    }

    static func err(_ m: String) {
        FileHandle.standardError.write((m + "\n").data(using: .utf8)!)
    }

    static func unhex(_ s: String) -> [UInt8] {
        if s.isEmpty { return [] }
        var out: [UInt8] = []
        out.reserveCapacity(s.count / 2)
        var i = s.startIndex
        while i < s.endIndex {
            let j = s.index(i, offsetBy: 2)
            out.append(UInt8(s[i..<j], radix: 16) ?? 0)
            i = j
        }
        return out
    }

    static func hex(_ b: [UInt8]) -> String {
        var s = ""
        s.reserveCapacity(b.count * 2)
        for x in b {
            let t = String(x, radix: 16)
            if t.count == 1 { s += "0" }
            s += t
        }
        return s
    }

    /// 失败时只回显首尾若干字符（大载荷全打会刷屏；诊断够用）。
    static func preview(_ hexStr: String) -> String {
        if hexStr.count <= 96 { return hexStr }
        let head = String(hexStr.prefix(64))
        let tail = String(hexStr.suffix(32))
        return "\(head)…(\(hexStr.count / 2)B)…\(tail)"
    }
}
