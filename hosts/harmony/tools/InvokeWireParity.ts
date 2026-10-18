// hosts/harmony/tools/InvokeWireParity.ts
// ★★二进制线格式的**跨语言对拍运行器**（鸿蒙/ArkTS 侧 · 由 `pnpm check:invoke-wire-parity` 驱动）
//
// 【它是什么】读 `scripts/invoke-wire-golden.ts` 产出的黄金向量（TSV），对 ArkTS 侧唯一实现
//   `hosts/harmony/host-app/entry/src/main/ets/runtime/InvokeWire.ts` 做三件事，并**逐条自检**：
//     ① kind=invoke  ⇒ `encodeInvoke(decodeInvoke(input))` 必须与 TS 的往返结果**逐字节相同**；
//     ② kind=resolve ⇒ 同法（回程帧）；
//     ③ kind=reject-* ⇒ 对应解码器必须**抛错**（坏 magic / 坏版本 / 尾部残留 / 截断 ⇒ 不许静默接受）。
//   另：kind=invoke 时还验 `peekMethod(input)`（另一条独立入口——不透支全帧解码）。
//
// 【★为什么用 tsx 跑，而不是"鸿蒙自带编译器"】ArkTS 没有独立 CLI 编译器（编译发生在 hvigor
//   构建里）。本门禁验的是**字节语义**（同一份源码），能抓住"线格式漂移"；
//   "这份源码能否被 ArkTS 编译"由 `bash hosts/harmony/build-host-app.sh` 兜住
//   （该文件被 `http-capability.ts` → `Superapp.ets` 引用 ⇒ 不编译会立刻暴露）。
//   ★这是**诚实边界**：不把"tsx 跑过"说成"ArkTS 编译器验过"。
//
// 【★为什么不在 app 里】本文件位于 `hosts/harmony/tools/`（**不在** `entry/src/main/ets/` 内）
//   ⇒ 不参与 HAP 构建；只被本门禁在 Node 上跑（与 Android `hosts/android/tools/` 同一纪律）。
//
// 用法：npx tsx hosts/harmony/tools/InvokeWireParity.ts <golden.tsv>
// 退出码：0 = 全通过 / 1 = 有 FAIL / 2 = 用法错误
import fs from 'node:fs'

import {
  decodeInvoke,
  decodeResolve,
  encodeInvoke,
  encodeResolve,
  peekMethod,
} from '../host-app/entry/src/main/ets/runtime/InvokeWire.ts'

let passed = 0
let failed = 0

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')

function unhex(s: string): Uint8Array {
  if (s === '-') return new Uint8Array(0)
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16)
  return out
}

function preview(s: string): string {
  return s.length <= 160 ? s : `${s.slice(0, 160)}…（共 ${s.length} 字符）`
}

function ok(name: string, what: string): void {
  passed++
  console.log(`  ✓ ${name}：${what}`)
}

function fail(name: string, why: string): void {
  failed++
  console.log(`  ✗ ${name}：${why}`)
}

function run(name: string, kind: string, inputHex: string, expectHex: string, extra: string): void {
  const input = unhex(inputHex)
  if (kind === 'invoke') {
    let got: string
    try {
      got = hex(encodeInvoke(decodeInvoke(input)))
    } catch (e) {
      fail(name, `往返抛错（${(e as Error).message}）`)
      return
    }
    if (got !== expectHex) {
      fail(name, `往返字节不符\n      期望 ${preview(expectHex)}\n      实得 ${preview(got)}`)
      return
    }
    const m = peekMethod(input)
    if (m !== extra) {
      fail(name, `peekMethod 不符：期望 ${extra}，实得 ${m}`)
      return
    }
    ok(name, `invoke 往返 ${input.length}B · peekMethod=${m}`)
    return
  }
  if (kind === 'resolve') {
    let got: string
    try {
      got = hex(encodeResolve(decodeResolve(input)))
    } catch (e) {
      fail(name, `往返抛错（${(e as Error).message}）`)
      return
    }
    if (got !== expectHex) {
      fail(name, `往返字节不符\n      期望 ${preview(expectHex)}\n      实得 ${preview(got)}`)
      return
    }
    ok(name, `resolve 往返 ${input.length}B`)
    return
  }
  if (kind === 'reject-invoke') {
    let threw = false
    try {
      decodeInvoke(input)
    } catch (e) {
      threw = true
    }
    if (!threw) {
      fail(name, '坏帧被**静默接受**（decodeInvoke 未抛错）——判据失守')
      return
    }
    ok(name, `坏帧被拒（${input.length}B）`)
    return
  }
  if (kind === 'reject-resolve') {
    let threw = false
    try {
      decodeResolve(input)
    } catch (e) {
      threw = true
    }
    if (!threw) {
      fail(name, '坏帧被**静默接受**（decodeResolve 未抛错）——判据失守')
      return
    }
    ok(name, `坏帧被拒（${input.length}B）`)
    return
  }
  fail(name, `未知 kind：${kind}`)
}

const goldenPath = process.argv[2]
if (!goldenPath) {
  console.error('用法：npx tsx hosts/harmony/tools/InvokeWireParity.ts <golden.tsv>')
  process.exit(2)
}
const lines = fs.readFileSync(goldenPath, 'utf8').split('\n')
for (const line of lines) {
  if (line.length === 0 || line.startsWith('#')) continue
  const c = line.split('\t')
  if (c.length < 5) {
    fail('<列数不足>', `行只有 ${c.length} 列（期望 5）：${line}`)
    continue
  }
  run(c[0], c[1], c[2], c[3], c[4])
}

console.log('')
console.log(`[check-invoke-wire-parity] ArkTS 侧自检：${passed} 通过 / ${failed} 失败`)
if (failed > 0) {
  console.error('✗ 二进制线格式**跨语言不等价**——鸿蒙 `InvokeWire.ts` 与 TS 侧 `packages/api/src/invoke-wire.ts` 已漂移。')
  console.error('  修法：以 TS 为 SSOT 改 ArkTS（不要反向改 golden——golden 由 TS 生成）。')
  process.exit(1)
}
process.exit(0)
