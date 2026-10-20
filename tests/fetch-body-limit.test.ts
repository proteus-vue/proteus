// tests/fetch-body-limit.test.ts
// ★★★决策 #1115：**响应体上限**的算法级判据（不依赖真机/网络）
//
// 【为什么要有这一层（真机之外）】
//   真机压测（`/huge` 端点 + 探针）能证明"端到端生效"，但**慢、依赖设备、难覆盖边界**。
//   本测试把两端宿主的**读取算法复刻**成纯函数，逐项锁定：
//     · 恰好等于上限 ⇒ 放行（`>` 不是 `>=`，差一个字节的边界最容易写错）
//     · 超 1 字节 ⇒ 拒，且**读了就停**（不是读完再判）
//     · chunked（无 content-length）⇒ 走累计闸，同样拒
//     · 声明长度超限 ⇒ **预判闸**直接拒，且**一块都不读**（省掉白读）
//   ★这是 #1113「静态体检」与真机探针之间的中间层：
//     静态体检只看"有没有写上限"，本测试看"上限逻辑对不对"，真机看"真的接上了"。
//
// 【复刻的是哪两端】
//   · Android：`HttpCapability.readAll()` —— `while read; total += n; if (total > MAX) throw`
//   · iOS：`BodyLimitDelegate.urlSession(_:dataTask:didReceive:)` —— 累加后 `> MAX` 则 cancel
//   两端都是「累计后比较 `>`」，本测试用同一形态；若哪天一端换成 `>=`，这里会红。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

const ANDROID = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpCapability.java'
const IOS = 'hosts/ios/ProteusHost/runtime/http-capability.swift'
const HARMONY = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http.h'
const APP = 'packages/api/src/capability-app.ts'

/** 两端约定的响应体上限（MiB）——测试与源码双向校验 */
const EXPECTED_LIMIT_MIB = 32

/** 复刻"读取累计"闸：返回 { ok, bytes, error } */
function readWithLimit(chunks: number[], limitBytes: number): { ok: boolean; bytes: number; error?: string } {
  let total = 0
  for (const n of chunks) {
    total += n
    if (total > limitBytes) return { ok: false, bytes: total, error: 'tooLarge' }
  }
  return { ok: true, bytes: total }
}

describe('★#1115 响应体上限 · 算法边界', () => {
  const LIMIT = EXPECTED_LIMIT_MIB * 1024 * 1024

  it('恰好等于上限 ⇒ 放行（边界是 `>` 不是 `>=`）', () => {
    expect(readWithLimit([LIMIT], LIMIT).ok, '恰好等于上限被拒了——两端用的是 `>` 语义').toBe(true)
  })

  it('超 1 字节 ⇒ 拒', () => {
    const r = readWithLimit([LIMIT + 1], LIMIT)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('tooLarge')
  })

  it('★多块累计：第 N 块才越线 ⇒ 在那一块立刻停（不是读完再判）', () => {
    const CH = 64 * 1024
    const chunks = Array.from({ length: Math.ceil(LIMIT / CH) + 2 }, () => CH)
    const r = readWithLimit(chunks, LIMIT)
    expect(r.ok).toBe(false)
    // 越线时读了约 LIMIT + 一块，而不是把全部 chunks 读完
    expect(r.bytes, '越线后仍在继续读（中止不彻底）').toBeLessThan(chunks.length * CH)
  })
})

describe('★#1115 两端实现同值同语义（防"换端就成败不同"）', () => {
  it('Android 上限 = 32 MiB，且用 `>` 比较、抛出专用异常', () => {
    const s = read(ANDROID)
    expect(s, 'Android 缺 MAX_BODY_BYTES').toMatch(/MAX_BODY_BYTES\s*=\s*32L?\s*\*\s*1024\s*\*\s*1024/)
    expect(s, '累计比较必须是 `total > MAX_BODY_BYTES`（`>=` 会少一字节）').toMatch(/total\s*>\s*MAX_BODY_BYTES/)
    expect(s, '超限必须抛专用异常（否则只能给笼统 failed）').toMatch(/BodyTooLargeException/)
    // 预判闸：Content-Length 超限时直接拒
    expect(s, 'Android 缺 Content-Length 预判').toMatch(/getContentLengthLong\(\)/)
    expect(s, 'Android 预判后未抛超限异常').toMatch(/declared\s*>\s*MAX_BODY_BYTES[\s\S]{0,120}BodyTooLargeException/)
  })

  it('iOS 上限 = 32 MiB（与 Android **同值**），且用 delegate 逐块 + cancel 真中止', () => {
    const s = read(IOS)
    expect(s, 'iOS 缺 MAX_BODY_BYTES').toMatch(/MAX_BODY_BYTES\s*=\s*32\s*\*\s*1024\s*\*\s*1024/)
    // ★关键：必须是 delegate（逐块），不能是 completion（那时数据已全部进内存）
    expect(s, 'iOS 仍在用 completionHandler 版 dataTask（数据已全进内存，事后拒绝无效）').not.toMatch(/dataTask\(with:\s*req\)\s*\{/)
    expect(s, 'iOS 缺 URLSessionDataDelegate 实现').toMatch(/URLSessionDataDelegate/)
    expect(s, 'iOS 缺逐块回调 didReceive').toMatch(/didReceive\s+data:\s*Data/)
    expect(s, 'iOS 超限未调用 cancel()（不是真中止）').toMatch(/tooLargeAt[\s\S]{0,200}cancel\(\)/)
  })

  it('★鸿蒙上限 = 32 MiB（与 Android/iOS **同值**），且用 RCP 逐块回调 + CancelRequest 真中止', () => {
    const s = read(HARMONY)
    // 同值：32u * 1024u * 1024u
    expect(s, '鸿蒙缺 MAX_BODY_BYTES').toMatch(/MAX_BODY_BYTES\s*=\s*32u\s*\*\s*1024u\s*\*\s*1024u/)
    // ★关键：必须挂 RCP 的逐块回调（FetchSync 返回时整包已在内存 ⇒ 只看 resp->body.length 等于事后拒绝）
    // ★★注意断言的是**调用点**，不是符号名——符号在 dlsym 行里也可能出现，
    //   只查符号名的话"声明了但不调用"照样绿（本轮破坏性验证实测：改成 gateInstalled=false 仍全绿）。
    expect(s, '鸿蒙未接逐块接收回调（FetchSync 整包已进内存 ⇒ 上限不"有界"）').toMatch(
      /HMS_Rcp_SetRequestOnBinaryDataRecvCallback/,
    )
    expect(s, '★逐块回调**声明了但没注册**（必须有真实调用点 gateInstalled = (pSetOnBinaryRecv(req, ocb) == 0)）').toMatch(
      /gateInstalled\s*=\s*\(pSetOnBinaryRecv\(req,\s*ocb\)\s*==\s*0\)/,
    )
    expect(s, '鸿蒙未实现 Rcp_OnBinaryReceiveCallbackFunc 形态').toMatch(/Rcp_OnBinaryReceiveCallback/)
    // 同上：断言**调用点**（cancelFn(...) 被真的调用），不是符号名
    expect(s, '鸿蒙超限未调用 HMS_Rcp_CancelRequest（不是真中止）').toMatch(/HMS_Rcp_CancelRequest/)
    expect(s, '★cancel 只有 dlsym 没有调用点（cancelFn 未被调用 ⇒ 读完再拒）').toMatch(
      /g->cancelRc\s*=\s*g->cancelFn\(g->session,\s*g->req\)/,
    )
    // 越线后必须停止累积（否则"读了就停"只是文案）
    expect(s, '越线后仍在累积（内存未锁住）').toMatch(/exceeded\) return n/)
    // 超限优先于 errCode：cancel 会把 errCode 变成"已取消"，按 errCode 分支会把超限误报成网络取消
    expect(s, '超限分支未优先于 errCode 分支（cancel 会让 errCode 变成"已取消" ⇒ 误报）').toMatch(
      /if \(gate\.exceeded\)/,
    )
    // 诚实边界：旧设备缺符号时必须**如实计数**，不能装作有界
    expect(s, '缺逐块符号的退化路径未记账').toMatch(/tooLargeFallback/)
    expect(s, '退化路径未做事后拒绝').toMatch(/respLen > MAX_BODY_BYTES/)
  })

  it('★鸿蒙探针回执必须带逐块闸读数（错误码分不出"边读边掐"与"读完再拒"）', () => {
    const s = read('hosts/harmony/host-app/proteus_render/src/main/cpp/http_probe.h')
    expect(s, '探针未暴露 limit 读数').toMatch(/\\"limit\\":/)
    expect(s, '探针未暴露 cancelCalled').toMatch(/cancelCalled/)
    expect(s, '探针未暴露 chunks（无法证明逐块）').toMatch(/\\"chunks\\":/)
  })

  it('★jsonEscape 必须转义控制字符（二进制响应别把回执撑成非法 JSON）', () => {
    // 真实踩到（#1117 真机判据）：/huge 回全 0x07 ⇒ preview 原样塞入 ⇒ http-probe.json
    // 不是合法 JSON ⇒ 判据脚本 JSON.parse 抛错，看起来像"探针失败"，实为编码缺陷。
    const s = read('hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host_helpers.h')
    expect(s, 'jsonEscape 缺控制字符分支').toMatch(/c\s*<\s*0x20/)
    expect(s, 'jsonEscape 未输出 \\u00XX 转义').toMatch(/\\\\u%04x/)
  })

  it('★探针预览必须过滤不可打印字节（人是读摘要，不是读二进制）', () => {
    const s = read('hosts/harmony/host-app/proteus_render/src/main/cpp/http_probe.h')
    expect(s, '预览未过滤不可打印字符').toMatch(/uc\s*<\s*0x20\s*\|\|\s*uc\s*>=\s*0x7f/)
  })

  it('★鸿蒙编译门禁必须挂 HMS sysroot 且两种形态都编（RCP 分支此前从未被编译过）', () => {
    const s = read('scripts/check-harmony-host-compile.sh')
    expect(s, '门禁未挂 HMS include（RCP 分支被裁掉 ⇒ 改了也全绿）').toMatch(/HMS_INC=/)
    expect(s, '门禁未把 HMS_FLAGS 传给 clang').toMatch(/HMS_FLAGS\[@\]/)
    // 两种形态：带 HMS（RCP 真编）+ 不带 HMS（unsupported 分支也必须是发布形态）
    const noHms = (s.match(/harmony_cc_nohms_/g) || []).length
    expect(noHms, '门禁只编了一种形态（#if 另一分支坏了抓不到）').toBeGreaterThan(1)
  })

  it('★JS 侧把 `fetch.tooLarge` 映射成**专用错误码**（不能混进 fetch.failed）', () => {
    const s = read(APP)
    expect(s, 'JS 侧未识别 fetch.tooLarge 前缀').toMatch(/\^fetch\\\.tooLarge:/)
    expect(s, '未抛 CapError("fetch.tooLarge")').toMatch(/CapError\(\s*'fetch\.tooLarge'/)
  })
})

describe('★#1115 探针装置（真机判据的入口存在）', () => {
  it('服务端有超大响应端点，且能分别测「声明长度」与「chunked」两道闸', () => {
    const s = read('hosts/android/tools/transfer-echo-server.mjs')
    expect(s, '缺 /huge 端点').toMatch(/url\.pathname\s*===\s*'\/huge'/)
    expect(s, '缺 chunked 模式（不声明长度 ⇒ 测累计闸）').toMatch(/chunked/)
    expect(s, 'chunked 分支未省略 content-length').toMatch(/else res\.writeHead\(200,\s*\{[^}]*'content-length'/)
  })

  it('JS 探针存在，且**成功返回也算失败**（能识别"上限未生效"）', () => {
    const s = read('hosts/shared/bridge/entry-superapp.ts')
    expect(s, '缺 appFetchLimitProbe 导出').toMatch(/export function appFetchLimitProbe/)
    expect(s, '探针未把"成功返回"判为失败（那样上限失效也不会红）').toMatch(/上限未生效/)
    expect(s, '探针未按 code === fetch.tooLarge 判定').toMatch(/code\s*===\s*'fetch\.tooLarge'/)
    expect(s, '★探针函数必须挂到 globalThis（否则宿主 eval 到 no-hook）').toMatch(
      /__proteusHostAppFetchLimitProbe\s*=\s*\(b: string/,
    )
  })

  it('★Android 探针必须**自己载入 bundle/boot**（否则 eval 到空引擎 ⇒ no-hook）', () => {
    const s = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/FetchLimitProbe.java')
    expect(s, 'Android 探针未载入 bundle-superapp.js').toMatch(/readAsset\(activity,\s*"bundle-superapp\.js"\)/)
    expect(s, 'Android 探针未 boot').toMatch(/__proteusSuperappBootJson\(\)/)
    expect(s, 'Android 探针未构造真实宿主栈').toMatch(/new SuperappRuntimeHost\(/)
  })

  it('★iOS 壳的探针分支必须**异步收尾**（主线程循环会饿死 http 回推 ⇒ 死锁）', () => {
    const s = read('hosts/ios/ProteusHost/shell/superapp-scene.swift')
    expect(s, 'iOS 壳缺 --fetch-limit-probe 分支').toMatch(/hasPrefix\("--fetch-limit-probe="\)/)
    // ★判据看的是"用 asyncAfter 递归推进"，而不是 while + usleep（ws 探针那种会死锁）
    const start = s.indexOf('hasPrefix("--fetch-limit-probe=")')
    const seg = s.slice(start, start + 3000)
    expect(seg, 'iOS 探针分支未用 asyncAfter 链推进').toMatch(/DispatchQueue\.main\.asyncAfter/)
    expect(
      seg,
      '★iOS 探针分支出现 usleep/while 轮询——主线程阻塞会饿死 DispatchQueue.main.async 的回推（死锁）',
    ).not.toMatch(/usleep/)
  })
})
