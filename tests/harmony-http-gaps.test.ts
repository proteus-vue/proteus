// tests/harmony-http-gaps.test.ts
// ★★★#1187：**鸿蒙 HTTP 三处缺口的收口判据**（savePath 落盘 / stream 如实拒绝 / 三个 http.* 方法存在）。
//
// 【这三条缺口的共同背景】
//   鸿蒙宿主的 `handle()` 是**同步阻塞**（一次性 VM + 同步 napi：#540 实测"跨 napi 复用 VM ⇒
//   SIGSEGV"）。请求期间 JS 线程被占 ⇒ **没有回调机会** ⇒ `stream` 的 `onChunk`、
//   `abort()` 的 `signal.onabort` 都**不可能执行**。
//   ★但要区分两种缺口（本仓反复记的纪律）：
//     · **模型限制**（stream / abort）⇒ 必须**如实拒绝或如实说明**，绝不能静默降级；
//     · **只是没接**（savePath / 三个 http.* 方法）⇒ 能接就必须接（同步模型下都做得到）。
//
// 【★本轮之前的状态（都是"静默"形态，这正是本判据存在的原因）】
//   · `stream: true` ⇒ 帧里解出来了，但 `proteus_http.h` **从没用它** ⇒ `onChunk` 永远不触发、
//     请求照常成功 ⇒ 业务以为在流式收数据（假数据）。
//   · `savePath` ⇒ 同上，帧里有、宿主不用 ⇒ 业务以为落盘了，实际什么都没写。
//   · `http.cancel` / `cancelStats` / `tlsStats` ⇒ **查无分派** ⇒ 字节桥回 `missing`
//     ⇒ `host_stats` 恒 null，归因链断（#1165 已登记）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')
const HTTP = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http.h'
const SAVE = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_save.h'
const STUBS = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_stubs.h'

describe('★★★#1187 鸿蒙 savePath：逐块落盘（同步模型下可做 ⇒ 必须做）', () => {
  it('★落盘走 SaveSession（逐块直写文件，不累积 body）', () => {
    const s = read(HTTP)
    expect(s, '★savePath 未被使用（帧里有、宿主不用 = 业务以为落盘了实际没写）').toMatch(
      /if \(f\.savePath\.has && !f\.savePath\.v\.empty\(\)\)/,
    )
    expect(s, '★没有 SaveSession（落盘实现缺失）').toMatch(/SaveSession save;/)
    // ★逐块回调里必须走 save->write（否则会先全进内存再写 = 大文件打爆）
    expect(s, '★逐块回调没走 SaveSession（内存峰值会等于整个响应体）').toMatch(
      /if \(g->save != nullptr\)[\s\S]{0,200}g->save->write\(p, n\)/,
    )
  })

  it('★沙箱路径校验与 iOS `sandboxFile` 同判据（三层防护）', () => {
    const s = read(SAVE)
    // ① 非空 ② 不以 / 开头 ③ 任一段是 .. ⇒ 拒绝
    expect(s, '★缺"拒绝绝对路径"判据（可写出沙箱）').toMatch(/rel\[0\] == '\/'/)
    expect(s, '★缺"拒绝 .."判据（目录穿越）').toMatch(/rel\.compare\(start, end - start, "\.\."\) == 0/)
    // ★未注入沙箱根时也必须拒绝（否则会写到当前工作目录）
    expect(s, '★沙箱根为空时没拒绝（会写到进程 cwd）').toMatch(/root\.empty\(\)/)
  })

  it('★失败必须可见（写失败/超限 ⇒ 删半截文件 + 回错误）', () => {
    const s = read(SAVE)
    expect(s, '★写失败后没删半截文件（业务会读到损坏文件）').toMatch(/writeFailed[\s\S]{0,300}std::remove/)
    expect(s, '★超限后没删半截文件').toMatch(/exceeded[\s\S]{0,300}std::remove/)
    // 落盘上限必须与 Android/iOS 同值（1 GiB）
    expect(s, '★落盘上限与 Android/iOS 不一致').toMatch(/1024u \* 1024u \* 1024u/)
  })

  it('★沙箱根由 ArkTS 注入（C++ 拿不到 filesDir）且四方接线', () => {
    // .so 导出
    expect(read('hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host.cpp'), '★未导出 setHttpSandboxRoot').toMatch(
      /PROTEUS_PROBE_EXPORT\(setHttpSandboxRoot, HostSetHttpSandboxRoot\)/,
    )
    // d.ts 声明
    expect(read('hosts/harmony/host-app/proteus_render/src/main/cpp/types/libproteus_host/index.d.ts'), '★d.ts 缺声明').toMatch(
      /export const setHttpSandboxRoot/,
    )
    // Index.ets 重导出
    expect(read('hosts/harmony/host-app/proteus_render/Index.ets'), '★Index.ets 未重导出').toMatch(/\n\s*setHttpSandboxRoot,/)
    // ArkTS 侧三处 filesDir 赋值后都要注入（否则 savePath 恒报"未注入"）
    const sa = read('hosts/harmony/host-app/entry/src/main/ets/shell/Superapp.ets')
    const calls = (sa.match(/this\.injectSandboxRoot\(\)/g) || []).length
    expect(calls, `★injectSandboxRoot 只调了 ${calls} 处（三处 filesDir 赋值都要调）`).toBeGreaterThanOrEqual(3)
  })
})

describe('★★★#1187 鸿蒙 stream：模型限制 ⇒ 必须如实拒绝（不得静默降级）', () => {
  it('★`stream: true` 必须显式报 unsupported（此前是静默忽略）', () => {
    const s = read(HTTP)
    expect(s, '★stream 仍被静默忽略（onChunk 永不触发但请求成功 = 假数据）').toMatch(
      /if \(f\.stream && \*f\.stream\)/,
    )
    expect(s, '★stream 的拒绝信息没点明根因（一次性 VM + 同步 napi）').toMatch(
      /一次性 VM[\s\S]{0,80}同步 napi/,
    )
    // 必须给出可行的替代（否则业务无从下手）
    expect(s, '★拒绝信息没给替代方案（savePath / 整包）').toMatch(/savePath/)
  })
})

describe('★★★#1187 鸿蒙三个 http.* 方法：必须有分派（不再 missing）且不得伪造成功', () => {
  it('★cancel / cancelStats / tlsStats 三个都要有', () => {
    const s = read(STUBS)
    for (const m of ['http.cancel', 'http.cancelStats', 'http.tlsStats']) {
      expect(s, `★${m} 仍无分派（字节桥会回 missing ⇒ host_stats 恒 null）`).toContain(`"${m}"`)
    }
    // 必须挂进通用分派
    expect(read('hosts/harmony/host-app/proteus_render/src/main/cpp/invoke_bytes_bridge.h'), '★stub 未接线到字节桥').toMatch(
      /#include "proteus_http_stubs\.h"/,
    )
    expect(read('hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h'), '★分派未接到 httpStubDispatch').toMatch(
      /proteus::http::httpStubDispatch\(method, &o\)/,
    )
  })

  it('★★绝不伪造"取消成功"（鸿蒙 abort 是 no-op，这是模型限制不是能力）', () => {
    const s = read(STUBS)
    // `http.cancel` 必须是 ok:false + 点明 no-op
    // ★正则要容忍字符串拼接里的换行（C++ 那段是 `"{\"ok\":false,\"reason\":..."` 跨行拼的）
    expect(s, '★http.cancel 报了 ok:true（会让业务以为取消生效了）').toMatch(
      /http\.cancel"[\s\S]{0,260}ok\\":false/,
    )
    expect(s, '★http.cancel 没点明 abort 是 no-op').toMatch(/no-op/)
    expect(s, '★没给出替代方案 timeout').toMatch(/timeout/)
  })

  it('★★tlsStats 必须如实说"鸿蒙未接 SPKI pinning"（安全策略假成立比没有更危险）', () => {
    const s = read(STUBS)
    expect(s, '★tlsStats 没说清 pinning 不生效').toMatch(/pinning/i)
    expect(s, '★tlsStats 没点明 RCP 只提供 CA 配置（不做 fingerprint 校验）').toMatch(/CA/)
  })
})
