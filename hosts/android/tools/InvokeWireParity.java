package dev.proteus.layoutcore;

// hosts/android/tools/InvokeWireParity.java
// ★★二进制线格式的**跨语言对拍运行器**（JVM-only · 由 `pnpm check:invoke-wire-parity` 驱动）
//
// 【它是什么】读 `scripts/invoke-wire-golden.ts` 产出的黄金向量（TSV），对 Java 侧唯一实现
//   `InvokeWire` 做三件事，并**逐条自检**：
//     ① kind=invoke  ⇒ `encodeInvoke(decodeInvoke(input))` 必须与 TS 的往返结果**逐字节相同**；
//     ② kind=resolve ⇒ 同法（回程帧）；
//     ③ kind=reject-* ⇒ 对应解码器必须**抛错**（坏 magic / 坏版本 / 尾部残留 / 截断 ⇒ 不许静默接受）；
//   另：kind=invoke 时还验 `peekMethod(input)`（另一条独立入口——不透支全帧解码）。
//
// 【★为什么往返即足够（不做逐字段 dump 比对）】`encode(decode(x)) == x` 在**全字段**上是强断言：
//   任一字段被漏读 / 误读 / 长度算错，重编码的字节就不同。且"期望值"来自 TS 自己的往返 ⇒
//   断言的是「**Java 与 TS 语义等价**」，而不是「Java 等于人手抄的字节串」（见 golden 生成器头注）。
//
// 【★为什么不在 app 里】本文件位于 `hosts/android/tools/`（**不在** `app/src/main/java` 内）
//   ⇒ AGP 不会把它编进 APK；它只被 `check:invoke-wire-parity` 用 `javac` + `java` 在**本机 JVM** 上跑。
//   ⇒ 本仓「零真机依赖的跨语言契约门禁」形态（同族：css-conformance 的双端 runner）。
//
// 用法：java -cp <classes> dev.proteus.layoutcore.InvokeWireParity <golden.tsv>
// 退出码：0 = 全通过 / 1 = 有 FAIL

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;

public final class InvokeWireParity {

    private static int passed = 0;
    private static int failed = 0;

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("用法：InvokeWireParity <golden.tsv>");
            System.exit(2);
        }
        List<String> lines = Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8);
        for (String line : lines) {
            if (line.isEmpty() || line.startsWith("#")) continue;
            String[] c = line.split("\t", -1);
            if (c.length < 5) {
                fail("<列数不足>", "行只有 " + c.length + " 列（期望 5）：" + line);
                continue;
            }
            run(c[0], c[1], c[2], c[3], c[4]);
        }
        System.out.println();
        System.out.println("[check-invoke-wire-parity] Java 侧自检：" + passed + " 通过 / " + failed + " 失败");
        if (failed > 0) {
            System.err.println("✗ 二进制线格式**跨语言不等价**——Java 侧 `InvokeWire` 与 TS 侧 `packages/api/src/invoke-wire.ts` 已漂移。");
            System.err.println("  修法：以 TS 为 SSOT 改 Java（不要反向改 golden——golden 由 TS 生成）。");
            System.exit(1);
        }
        System.exit(0);
    }

    private static void run(String name, String kind, String inputHex, String expectHex, String extra) {
        byte[] input = unhex(inputHex);
        try {
            switch (kind) {
                case "invoke": {
                    String got = hex(InvokeWire.encodeInvoke(InvokeWire.decodeInvoke(input)));
                    if (!got.equals(expectHex)) { fail(name, "往返字节不符\n      期望 " + preview(expectHex) + "\n      实得 " + preview(got)); return; }
                    String m = InvokeWire.peekMethod(input);
                    if (!m.equals(extra)) { fail(name, "peekMethod 不符：期望 " + extra + "，实得 " + m); return; }
                    ok(name, "invoke 往返 " + input.length + "B · peekMethod=" + m);
                    return;
                }
                case "resolve": {
                    String got = hex(InvokeWire.encodeResolve(InvokeWire.decodeResolve(input)));
                    if (!got.equals(expectHex)) { fail(name, "往返字节不符\n      期望 " + preview(expectHex) + "\n      实得 " + preview(got)); return; }
                    ok(name, "resolve 往返 " + input.length + "B");
                    return;
                }
                case "reject-invoke": {
                    boolean threw = false;
                    try { InvokeWire.decodeInvoke(input); } catch (Throwable t) { threw = true; }
                    if (!threw) { fail(name, "坏帧被**静默接受**（decodeInvoke 未抛错）——判据失守"); return; }
                    ok(name, "坏帧被拒（decodeInvoke 抛错）");
                    return;
                }
                case "reject-resolve": {
                    boolean threw = false;
                    try { InvokeWire.decodeResolve(input); } catch (Throwable t) { threw = true; }
                    if (!threw) { fail(name, "坏帧被**静默接受**（decodeResolve 未抛错）——判据失守"); return; }
                    ok(name, "坏帧被拒（decodeResolve 抛错）");
                    return;
                }
                default:
                    fail(name, "未知 kind：" + kind + "（golden 与运行器版本不匹配？）");
            }
        } catch (Throwable t) {
            fail(name, "抛了非预期异常：" + t);
        }
    }

    /* ────────────────────────── 工具 ────────────────────────── */

    private static void ok(String name, String detail) {
        passed++;
        System.out.println("  ✓ " + name + " —— " + detail);
    }

    private static void fail(String name, String why) {
        failed++;
        System.err.println("  ✗ " + name + " —— " + why);
    }

    private static byte[] unhex(String s) {
        if (s == null || s.isEmpty()) return new byte[0];
        int n = s.length() / 2;
        byte[] out = new byte[n];
        for (int i = 0; i < n; i++) {
            out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(Character.forDigit((x >> 4) & 0xf, 16)).append(Character.forDigit(x & 0xf, 16));
        return sb.toString();
    }

    /** 失败时只回显首尾若干字符（大载荷全打会刷屏；诊断够用）。 */
    private static String preview(String hex) {
        if (hex == null) return "<null>";
        if (hex.length() <= 96) return hex;
        return hex.substring(0, 64) + "…(" + hex.length() / 2 + "B)…" + hex.substring(hex.length() - 32);
    }
}
