#!/usr/bin/env node
// scripts/check-no-json-wire.mjs —— ★★★静态门禁：**跨语言数据通道禁 JSON 文本**（S2「去 JSON」的机器化）
//
// 【为什么需要】跨语言逐帧通道一律走 JSON 文本（`number[]` + `双 UTF-8`）是本仓结构性瓶颈
//   （方案 `docs/proteus-performance-plan/14-input-bridge-latency.md` 的 B2）：JS 侧
//   `JSON.stringify(Array.from(bytes))`（每字节膨胀 3~4×）+ 宿主 `new JSONArray` 逐元素解析 +
//   `Integer` 装箱。**"字节通道"曾是 `number[]` JSON——名字骗人**（决策 #769）。
//   ⇒ 已落地 **字节直传**（`applyOpsBytes`：`Uint8Array`→`byte[]`）；本门禁把它**钉住**，
//     防止后续改动**静默回退**到旧 JSON 通道（与 `check:no-blind-wait` / `check:host-rounding`
//     同族：**结构性问题只有工具层能兜住**）。
//
// ★★2026-10-13 扩面（决策 #903 / T-app-wire · 用户「跨语言数据通道不要用 JSON 字符串，
//   性能损耗太大，走纯二进制方向」）：从**指令通道**扩到**能力（invoke）通道**——
//   后者此前是"派发 `JSON.stringify({...args,__reqId})` + 回推 `__proteusHostResolve(reqId,json)`"
//   **两处 JSON**，且最坏的不是请求参数而是**响应体**（HTML/JSON/文件几 MB）。
//   现已在 JS 桥 + Java 宿主 + C 桥三处落地二进制帧（`PINV`/`PRSP`，见 `packages/api/src/invoke-wire.ts`）。
//
// 【判据（机器推导，不手写清单）】
//   逐帧指令的**生产出口**必须走 `sendOps`（内部优先 `applyOpsBytes`）：
//   ① `hosts/android/bridge/entry-vapor.ts`：**除 `sendOps` 回退体外，不得出现** `applyOps(JSON.stringify(`
//      ——即命令字节不得被编成 `number[]` JSON 文本再发。
//   ② 宿主 `VaporRenderHost.java` 必须**定义** `applyOpsBytes`（字节直传入口）。
//   ③ C 桥 `quickjs_jni.c` 必须**引用** `applyOpsBytes`（JS `Uint8Array` → `byte[]` 的转接）。
//   ★#903 扩面（能力通道，形态同族）：
//   ④ JS 桥 `packages/api/src/capability-invoke.ts` 的二进制腿必须**齐备**（探测 / 派发 / 帧解码 /
//      **回程入口**）—— 尤其：回程**必须**同时装二进制入口，否则"派发走字节、回推仍走 JSON"= 半截去 JSON。
//   ⑤ Java 宿主：`InvokeWire.java` 必须定义 `decodeInvoke` + `encodeResolve`（帧的字节出入）；
//      `HostCapabilities.java` 必须定义 `invokeBytes(byte[])`；`HttpCapability.java` 必须
//      **经 `resolveHostBytes` 回推**（字节），且**不得 import `org.json`**（响应体原样当字节，不解析）。
//   ⑥ C 桥：必须引用 `invokeBytes`（探针 + 条件注入）与 `nativeResolveHostBytes`（反向回推），
//      且回推造 JS `Uint8Array` 必须走**公开 API**（`JS_NewArrayBufferCopy` + `JS_TYPED_ARRAY_UINT8`）。
//      ★2026-10-13 订正：本条原写 `JS_NewUint8ArrayCopy`，但它在 QuickJS 公开头里**不存在**
//      （`quickjs.c` 内 static，`nm libquickjs.a` ⇒ `t` 不可外链）⇒ **判据自身不可满足**：
//      真按它写就 `error: call to undeclared function`。这是一条"能 grep 到、却永远编不过"的假判据
//      ——**形态判据不能替代"编得过"**，故同时给 C 桥补了真编译步（`hosts/android/check-host-compile.sh`）。
//   ★2026-10-13 再扩面（iOS 腿落地：#904）：
//   ⑦ Swift 宿主：`InvokeWire.swift` 必须定义 `decodeInvoke` + `encodeResolve` + magic 常量；
//      `invoke-bytes-bridge.swift` 必须走 **JSC C API**（`JSObjectMakeFunctionWithCallback` 注入 +
//      `JSObjectGetTypedArrayBytesPtr` 取裸指针 + `JSObjectMakeTypedArray` 造 Uint8Array 回）——
//      这正是"不走 JSExport 传 NSData/NSArray"的可机器判定形态；
//      `http-capability.swift` 必须用 `URLSession` 且**经 `encodeResolve` 回推帧**（不 `JSONSerialization`
//      解析响应体）；`superapp-runtime-host.swift` 必须真的 `installInvokeBytes`（否则桥=死代码）。
//   ⑧ **跨文件名字一致性**（独立判据）：JS 侧常量 `HOST_INVOKE_BYTES_KEY` / `HOST_RESOLVE_BYTES_KEY`
//      的**值**必须逐字出现在 Swift 桥里——两侧名字对不上是**静默失效**（桥装了、JS 探不到）。
//
// 【★跨语言等价不由本门禁负责（分工要清楚）】本门禁只判"**通道形态**是不是字节"（静态、零环境）；
//   "各端编解码器是否**逐字节等价**"由 `check:invoke-wire-parity` 负责（TS SSOT ⇄ Java ⇄ Swift，
//   golden 向量 + 破坏性验证）。两者是**两层**：形态对 ≠ 字节对（前者过、后者红 = 常见真缺陷）。
//   ★第三层（iOS 专有）："桥的形态**跑得通**吗"由 `check:ios-invoke-bytes` 负责
//   （真实 JSC 上跑去程/回执/回推/1MB 大载荷/坏入参）——静态判据**证明不了**临时指针、Uint8Array
//   与 Array 的形态差异、回调签名可选性这些只有真跑才暴露的坑。
//
// 【诚实边界】① 指令通道只覆盖 **Android vapor**；iOS/鸿蒙字节通道、整树 mount 的 blob 为后续。
//   ② 能力通道：已落 **Android + iOS** 两端（鸿蒙 ArkTS 编解码器未做——#903/#904 已登记），
//   故 ⑤⑥ 判 Android、⑦⑧ 判 iOS；鸿蒙接入时**扩本门禁**（不要新开一个门禁）。
//
// 用法：node scripts/check-no-json-wire.mjs
// 退出码：0 通过 / 1 命中
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BRIDGE = path.join(ROOT, 'hosts/android/bridge/entry-vapor.ts')
const HOST = path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/VaporRenderHost.java')
const CBRIDGE = path.join(ROOT, 'hosts/android/js-engine/quickjs_jni.c')
// ── #903 扩面：能力（invoke）通道 ──
const INVOKE_BRIDGE = path.join(ROOT, 'packages/api/src/capability-invoke.ts')
const RUNTIME_JAVA = path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime')
const WIRE_JAVA = path.join(RUNTIME_JAVA, 'InvokeWire.java')
const CAPS_JAVA = path.join(RUNTIME_JAVA, 'HostCapabilities.java')
const HTTP_JAVA = path.join(RUNTIME_JAVA, 'HttpCapability.java')
// ── #904 扩面：iOS 腿 ──
const IOS_RUNTIME = path.join(ROOT, 'hosts/ios/ProteusHost/runtime')
const WIRE_SWIFT = path.join(IOS_RUNTIME, 'InvokeWire.swift')
const BRIDGE_SWIFT = path.join(IOS_RUNTIME, 'invoke-bytes-bridge.swift')
const HTTP_SWIFT = path.join(IOS_RUNTIME, 'http-capability.swift')
const SUPERAPP_SWIFT = path.join(IOS_RUNTIME, 'superapp-runtime-host.swift')
const SCENE_SWIFT = path.join(ROOT, 'hosts/ios/ProteusHost/shell/superapp-scene.swift')
const IOS_PROBE = path.join(ROOT, 'hosts/ios/tools/InvokeBytesProbe.swift')
const IOS_GATE = path.join(ROOT, 'hosts/ios/check-invoke-bytes.sh')

/**
 * **词边界精确匹配**——本门禁 2026-10-13 破坏性验证抓出的真缺陷：
 *   初版用 `src.includes(token)`，于是把 `installInvokeBytes` 改名成 `installInvokeBytesDisabled`
 *   （或把 `__proteusHostResolveBytes` 改名成 `...BytesX`）都**照样判绿**——子串匹配不是契约检查。
 *   ★教训同「自测必须对准消费方的契约」：判据的**匹配语义**也是契约的一部分。
 */
const hasExact = (src, token) => new RegExp(`(?<![A-Za-z0-9_])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`).test(src)

let failed = false
const fail = (m) => { console.error(`✗ ${m}`); failed = true }

// ── ① 桥：逐帧字节不得经 number[] JSON（唯一合法处 = sendOps 回退体）──
{
  const src = fs.readFileSync(BRIDGE, 'utf-8')
  if (!src.includes('applyOpsBytes')) fail('桥缺 `applyOpsBytes` 新通道引用（去 JSON 通道未被使用）')
  // 其它一切 `applyOps(JSON.stringify(` 均违规（sendOps 回退体里的那一处除外——用函数体切分排除）
  const fnMatch = /function sendOps\([\s\S]*?\n\}/.exec(src)
  const sendOpsBody = fnMatch ? fnMatch[0] : ''
  const total = (src.match(/applyOps\(\s*JSON\.stringify/gi) || []).length
  const inFallback = (sendOpsBody.match(/applyOps\(\s*JSON\.stringify/gi) || []).length
  if (total - inFallback > 0) {
    fail(`桥里出现 ${total - inFallback} 处 \`applyOps(JSON.stringify(...))\`（逐帧字节被编成 number[] JSON）——应统一走 \`sendOps\`（其内优先 applyOpsBytes）`)
  } else {
    console.log(`  ✓ 桥：逐帧字节走 \`sendOps\`（回退体 ${inFallback} 处 number[] JSON 属合规兜底）`)
  }
}

// ── ② 宿主：必须定义字节直传入口 applyOpsBytes ──
{
  const host = fs.readFileSync(HOST, 'utf-8')
  if (!/public\s+String\s+applyOpsBytes\s*\(\s*byte\[\]/.test(host)) {
    fail('宿主 `VaporRenderHost.java` 未定义 `applyOpsBytes(byte[])`（字节直传入口缺失）')
  } else {
    console.log('  ✓ 宿主：`applyOpsBytes(byte[])` 字节直传入口存在')
  }
}

// ── ③ C 桥：必须有 applyOpsBytes 的转接 ──
{
  const c = fs.readFileSync(CBRIDGE, 'utf-8')
  if (!c.includes('applyOpsBytes')) fail('C 桥 `quickjs_jni.c` 缺 `applyOpsBytes` 转接（Uint8Array→byte[]）')
  else console.log('  ✓ C 桥：`applyOpsBytes` 转接存在（JS Uint8Array → Java byte[]）')
}

/* ══════════════════ ★#903 扩面：能力（invoke）通道 ══════════════════ */

// ── ④ JS 桥：invoke 的二进制腿必须齐备（尤其**回程**——半截去 JSON 是最容易漏的形态）──
{
  const src = fs.readFileSync(INVOKE_BRIDGE, 'utf-8')
  const need = [
    ['getHostInvokeBytes', '取壳的二进制入口（探测 `__proteusHostInvokeBytes` / `proteusHost.invokeBytes`）'],
    ['invokeHostAsyncBytes', '二进制腿的派发实现'],
    ['decodeResolveFrame', '回程帧解码（reqId 编在帧内）'],
    ['settleHostCallBytes', '二进制回程的结算'],
    ['HOST_RESOLVE_BYTES_KEY', '二进制回程入口的全局键'],
  ]
    const missing = need.filter(([p]) => !hasExact(src, p))
    if (missing.length) {
      for (const [p, why] of missing) {
        fail(`\`capability-invoke.ts\` 缺 \`${p}\`（${why}）——invoke 的二进制腿不完整（S2 去 JSON 被回退）`)
      }
    } else {
      console.log('  ✓ JS 桥：invoke 二进制腿齐备（探测 / 派发 / 帧解码 / 结算 / 回程入口）')
    }
  // ★独立判据（防"派发走字节、回推仍走 JSON"的半截形态）：回程入口必须真的被**安装**
  if (!/g\[HOST_RESOLVE_BYTES_KEY\]\s*=/.test(src)) {
    fail('`installHostResolveBridge` 未安装二进制回程入口（`__proteusHostResolveBytes`）——大响应体仍会走 JSON 文本')
  } else {
    console.log('  ✓ JS 桥：二进制回程入口已安装（与 JSON 入口并存 ⇒ 老壳零回归）')
  }
  // ★反向判据：大载荷不得被 base64 / number[] 化（那正是"名字骗人"的旧形态）
  if (/btoa\(|Array\.from\(.*body/.test(src)) {
    fail('`capability-invoke.ts` 出现 base64 / `Array.from(body)` 形态（大载荷被文本化——应走裸字节）')
  }
}

// ── ⑤ Java 宿主：帧编解码器 + 二进制能力入口 + HTTP 能力（字节回推、不解析 JSON）──
if (!fs.existsSync(WIRE_JAVA)) {
  fail('缺 `InvokeWire.java`（帧编解码器的 Java 唯一实现）——能力通道的二进制腿无宿主侧落点')
} else {
  const w = fs.readFileSync(WIRE_JAVA, 'utf-8')
  const gaps = []
  if (!/static\s+InvokeFrame\s+decodeInvoke\s*\(\s*byte\[\]/.test(w)) gaps.push('`decodeInvoke(byte[])`')
  if (!/static\s+byte\[\]\s+encodeResolve\s*\(\s*ResolveFrame/.test(w)) gaps.push('`encodeResolve(ResolveFrame)`')
  if (!w.includes('INVOKE_MAGIC') || !w.includes('RESOLVE_MAGIC')) gaps.push('magic 常量（`PINV`/`PRSP`）')
  if (gaps.length) fail(`\`InvokeWire.java\` 缺 ${gaps.join(' / ')}（帧的字节出入不成立）`)
  else console.log('  ✓ Java 宿主：`InvokeWire` 帧编解码齐备（decodeInvoke / encodeResolve / magic）')
}

{
  const caps = fs.readFileSync(CAPS_JAVA, 'utf-8')
  if (!/public\s+byte\[\]\s+invokeBytes\s*\(\s*byte\[\]/.test(caps)) {
    fail('`HostCapabilities.java` 未定义 `invokeBytes(byte[])`（JNI 条件注入的探测目标缺失 ⇒ 宿主永远走 JSON 腿）')
  } else {
    console.log('  ✓ Java 宿主：`HostCapabilities.invokeBytes(byte[])` 二进制入口存在')
  }
}

if (!fs.existsSync(HTTP_JAVA)) {
  fail('缺 `HttpCapability.java`（`http.request` 的宿主实现）——二进制通道无真实消费者，等于没落地')
} else {
  const h = fs.readFileSync(HTTP_JAVA, 'utf-8')
  if (!h.includes('resolveHostBytes')) {
    fail('`HttpCapability.java` 未经 `resolveHostBytes` 回推（异步结果会退回 JSON 回推入口）')
  } else {
    console.log('  ✓ Java 宿主：`HttpCapability` 经 `resolveHostBytes` 回推（异步结果走字节）')
  }
  // ★"响应体原样当字节"的可机器判定形态：该文件**不解析 JSON**（解析会引 org.json）
  if (/^\s*import\s+org\.json\./m.test(h)) {
    fail('`HttpCapability.java` import 了 `org.json`（响应体被解析 ⇒ 大载荷又在走文本层）——响应体应原样回字节，由 JS 侧按 responseType 解释')
  } else {
    console.log('  ✓ Java 宿主：`HttpCapability` 零 `org.json` 依赖（响应体原样回字节）')
  }
}

// ── ⑥ C 桥：invokeBytes 探针/注入 + 反向回推（且用公开 API 造 JS 字节视图，而非 JSON 串）──
{
  const c = fs.readFileSync(CBRIDGE, 'utf-8')
  const need = [
    ['invokeBytes', '`invokeBytes` 的条件注入与 JNI 调用（能力通道的二进制腿）'],
    ['nativeResolveHostBytes', '反向回推导出（宿主 → JS 的字节帧）'],
    // ★2026-10-13 订正（原 token **不可满足**）：本条原写 `JS_NewUint8ArrayCopy`，但该函数在
    //   QuickJS **公开头里不存在**——它在 `quickjs.c` 内是 `static`（`nm libquickjs.a` ⇒ `t`，
    //   **链接期不可外链**）⇒ 真去调用会 `error: call to undeclared function`（NDK clang 18 直接红）。
    //   即：判据自己写了一个"能 grep 到、但永远编不过"的名字 ⇒ 判据是假的（形态对 ≠ 编得过）。
    //   ⇒ 改判**真实可用的公开 API 组合**，且**只认调用形态**（`名字(`）：
    //     ★实测教训——只匹配裸 token 时，注释里提一句 `JS_NewArrayBufferCopy` 就能让判据"绿"，
    //     而代码其实没调它（破坏性验证① 当场抓出）。注释里的名字应算**文档**，不算**证据**。
    //   `JS_NewArrayBufferCopy(` = 把字节**拷**进 JS 堆（而非把帧编成 JSON 串）；
    //   `JS_TYPED_ARRAY_UINT8` = 造的确是 `Uint8Array` 视图（不是裸 `ArrayBuffer` / 字符串）。
    //   ★同源教训见 `hosts/android/check-host-compile.sh` 新增的 C 桥编译步（grep 不能替代编译）。
    [/JS_NewArrayBufferCopy\s*\(/, '回推时把字节**拷**进 JS 堆（须是**调用**形态，而非只在注释里提名字）'],
    [/JS_TYPED_ARRAY_UINT8/, '回推造的是 `Uint8Array` 视图（而非裸 `ArrayBuffer` / 字符串）'],
  ]
  // ★反向判据（比正向判据更贴这次的真缺陷）：**不得调用 QuickJS 未导出的 API**——
  //   `JS_NewUint8ArrayCopy`（`quickjs.c` 内 static）与 `JS_IsArrayBuffer`（公开头无声明）
  //   在外部 TU 里一调就是"能 grep 绿、却编不过"的断代码（NDK clang 18：undeclared function ⇒ error）。
  const forbid = [
    [/JS_NewUint8ArrayCopy\s*\(/, '调用了 QuickJS **未导出**的 `JS_NewUint8ArrayCopy`（`quickjs.c` 内 static ⇒ 编译期 undeclared）'],
    [/JS_IsArrayBuffer\s*\(/, '调用了 QuickJS **未导出**的 `JS_IsArrayBuffer`（公开头无此声明 ⇒ 编译期 undeclared）'],
  ]
  for (const [re, why] of forbid) {
    if (re.test(c)) fail(`C 桥${why}`)
  }
  const missing = need.filter(([p]) => (typeof p === 'string' ? !hasExact(c, p) : !p.test(c)))
  if (missing.length) {
    for (const [p, why] of missing) fail(`C 桥缺 \`${p}\`（${why}）`)
  } else {
    console.log('  ✓ C 桥：`invokeBytes` 注入 + `nativeResolveHostBytes` 回推 + `JS_NewArrayBufferCopy`/`JS_TYPED_ARRAY_UINT8`（公开 API 造 Uint8Array）齐备')
  }
}

/* ══════════════════ ★#904 扩面：iOS 腿（Swift / JSC C API） ══════════════════ */

// ── ⑦ Swift 宿主：编解码器 + JSC C-API 字节桥 + http 能力 + **真的被装上** ──
{
  const missingFiles = [WIRE_SWIFT, BRIDGE_SWIFT, HTTP_SWIFT].filter((f) => !fs.existsSync(f))
  if (missingFiles.length) {
    for (const f of missingFiles) fail(`缺 iOS 腿源码：${path.relative(ROOT, f)}（能力通道的二进制腿在 iOS 侧无落点）`)
  } else {
    const w = fs.readFileSync(WIRE_SWIFT, 'utf-8')
    const gaps = []
    // ★Swift 的参数是「外部标签 + 形参名」（如 `decodeInvoke(_ bytes: [UInt8])`）⇒ 正则要放过形参名
    if (!/static\s+func\s+decodeInvoke\s*\(\s*(?:_\s+\w+\s*:\s*)?\[UInt8\]\s*\)/.test(w)) gaps.push('`decodeInvoke([UInt8])`')
    if (!/static\s+func\s+encodeResolve\s*\(\s*(?:_\s+\w+\s*:\s*)?ResolveFrame\s*\)/.test(w)) gaps.push('`encodeResolve(ResolveFrame)`')
    if (!w.includes('INVOKE_MAGIC') || !w.includes('RESOLVE_MAGIC')) gaps.push('magic 常量（`PINV`/`PRSP`）')
    if (gaps.length) fail(`\`InvokeWire.swift\` 缺 ${gaps.join(' / ')}（帧的字节出入不成立）`)
    else console.log('  ✓ iOS 宿主：`InvokeWire` 帧编解码齐备（decodeInvoke / encodeResolve / magic）')

    const b = fs.readFileSync(BRIDGE_SWIFT, 'utf-8')
    const need = [
      ['JSObjectMakeFunctionWithCallback', '经 **JSC C API** 注入全局函数（JSExport 传不了 Uint8Array）'],
      ['JSObjectGetTypedArrayBytesPtr', '从 JS `Uint8Array` 取**裸指针**（免逐元素拷贝）'],
      ['JSObjectMakeTypedArray', '回执时造 JS `Uint8Array`（而非 NSData/NSArray ⇒ 免 JS 侧 Array.from）'],
      ['__proteusHostResolveBytes', '异步回推入口名（宿主 → JS）'],
    ]
    const bMissing = need.filter(([p]) => !hasExact(b, p))
    if (bMissing.length) {
      for (const [p, why] of bMissing) fail(`\`invoke-bytes-bridge.swift\` 缺 \`${p}\`（${why}）`)
    } else {
      console.log('  ✓ iOS 宿主：JSC C-API 字节桥齐备（注入 / 裸指针读 / 造 Uint8Array / 回推入口）')
    }
    // ★反向判据：不得退回"把字节当 Objective-C 对象/数组"的旧形态
    if (/invokeBytes\s*\(\s*_?\s*\w*\s*:\s*NSData|Array\.from\(/.test(b)) {
      fail('`invoke-bytes-bridge.swift` 出现 NSData / `Array.from(` 形态（字节被文本化/逐元素搬运——正是要消灭的那层开销）')
    }

    const h = fs.readFileSync(HTTP_SWIFT, 'utf-8')
    if (!hasExact(h, 'URLSession')) fail('`http-capability.swift` 未使用 `URLSession`（iOS 腿的网络实现缺失）')
    else if (!hasExact(h, 'encodeResolve')) fail('`http-capability.swift` 未编 `encodeResolve` 帧回推（结果无法走字节通道）')
    else if (/JSONSerialization/.test(h)) fail('`http-capability.swift` 用 `JSONSerialization` 解析响应体（大载荷又回文本层——应原样回字节）')
    else console.log('  ✓ iOS 宿主：`http-capability` 走 URLSession + `encodeResolve` 回推 + 零 JSON 解析')

    // ★独立判据：桥必须**真的被运行期装上**（不然是死代码：grep 全绿、真机永远走 JSON 腿）。
    //   ★两条都要：运行期**有这个方法**（定义）+ 壳**真的调了**（调用点）——只判定义会漏掉
    //   "方法在但没人调"的形态（本轮破坏性验证① 正是先想用改名糊过去，暴露了"只判定义"不够）。
    const sa = fs.readFileSync(SUPERAPP_SWIFT, 'utf-8')
    const scene = fs.readFileSync(SCENE_SWIFT, 'utf-8')
    if (!hasExact(sa, 'installInvokeBytes')) {
      fail('`superapp-runtime-host.swift` 未定义 `installInvokeBytes`（桥存在但没装上 ⇒ 真机永远回落 JSON 腿）')
    } else if (!hasExact(scene, 'installInvokeBytes')) {
      fail('`superapp-scene.swift` 未调用 `installInvokeBytes`（定义在但没有调用点 = 死代码 ⇒ 真机永远回落 JSON 腿）')
    } else {
      console.log('  ✓ iOS 宿主：字节桥有定义**且**壳真的调用了（非死代码）')
    }
  }
}

// ── ⑧ 跨文件名字一致性（独立判据：两侧名字对不上 = 静默失效）──
{
  const js = fs.readFileSync(INVOKE_BRIDGE, 'utf-8')
  const pickValue = (key) => {
    const m = new RegExp(`${key}\\s*=\\s*'([^']+)'`).exec(js)
    return m ? m[1] : null
  }
  const invokeKey = pickValue('HOST_INVOKE_BYTES_KEY')
  const resolveKey = pickValue('HOST_RESOLVE_BYTES_KEY')
  for (const [key, name] of [[invokeKey, 'HOST_INVOKE_BYTES_KEY'], [resolveKey, 'HOST_RESOLVE_BYTES_KEY']]) {
    if (!key) { fail(`读不到 JS 侧 \`${name}\` 的字面值（门禁自身的对账前提失效）`); continue }
    const sides = [
      [BRIDGE_SWIFT, 'invoke-bytes-bridge.swift'],
      [CBRIDGE, 'quickjs_jni.c'],
    ]
    for (const [file, label] of sides) {
      if (!fs.existsSync(file)) continue
      // C 桥侧只对账"去程/回程"两个名字；Swift 侧两个都要在
      if (label === 'quickjs_jni.c' && name === 'HOST_INVOKE_BYTES_KEY') {
        // C 桥经 `proteusHost.invokeBytes` 方法名注入（不直接用全局键名）⇒ 只查回推键
        if (!hasExact(fs.readFileSync(file, 'utf-8'), resolveKey ?? '\u0000')) {
          fail(`C 桥未使用 JS 侧回推键 \`${resolveKey}\`（名字对不上 ⇒ 回推静默失效）`)
        }
        continue
      }
      if (!hasExact(fs.readFileSync(file, 'utf-8'), key)) {
        fail(`${label} 里找不到 JS 侧常量 \`${name}\` 的值 \`${key}\`（两侧名字对不上 ⇒ 静默失效）`)
      }
    }
  }
  // 判据脚本自身必须在（防"判据被删掉后没人发现"）
  if (!fs.existsSync(IOS_PROBE) || !fs.existsSync(IOS_GATE)) {
    fail('iOS 端到端判据缺失（`tools/InvokeBytesProbe.swift` / `check-invoke-bytes.sh`）——形态判据不能替代通路判据')
  } else {
    console.log('  ✓ 跨文件对账：JS 键名 ↔ Swift/C 桥一致；iOS 端到端判据（探针 + 门禁脚本）在位')
  }
}

if (failed) {
  console.error('\n✗ 跨语言数据通道出现 JSON 文本（S2 去 JSON 被回退）——见上')
  console.error('  正确做法：逐帧指令走 `sendOps`（字节直传）；能力调用走 `invokeBytes` / `resolveHostBytes`（`PINV`/`PRSP` 帧）')
  process.exit(1)
}
console.log('\n✅ 跨语言数据通道零 JSON 文本（指令 + 能力双通道均走字节直传 · S2/#769/#903）')
