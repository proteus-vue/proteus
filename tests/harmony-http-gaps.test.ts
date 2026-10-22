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
/**
 * ★#1191：从 `proteus_http_stubs.h` 里**只取某个方法的返回块**（不做整文件 grep）。
 *   起点 = `method == "<name>"` 那一行；终点 = 该 if 块的 `return true;` 之后。
 *   ★这是修"注释里出现也算命中"的假绿所必需的：整文件 grep 会命中文件头注释。
 */
function stubBlock(method: string): string {
  const s = read('hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_stubs.h')
  const at = s.indexOf(`method == "${method}"`)
  if (at < 0) return ''
  const end = s.indexOf('return true;', at)
  return end < 0 ? s.slice(at) : s.slice(at, end + 'return true;'.length)
}
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

  it('★失败必须可见（写失败/超限 ⇒ 走 abortUnfinished 删临时文件 + 回错误）', () => {
    const s = read(SAVE)
    // ★★★#1191：原版用"`writeFailed` 到 `std::remove` 距 300 字符内"判——重构成
    //   `abortUnfinished()` 后失效（且这种"文本距离"判据本来就不稳）。
    //   ⇒ 改为判**结构**：两条失败分支都必须调用统一的清理函数。
    expect(s, '★缺 abortUnfinished（统一清理入口）').toMatch(/void abortUnfinished\(\)/)
    expect(s, '★abortUnfinished 里没删临时文件').toMatch(
      /abortUnfinished\(\)[\s\S]{0,400}std::remove\(partPath/,
    )
    expect(s, '★写失败分支没走 abortUnfinished').toMatch(/if \(writeFailed\) \{\s*abortUnfinished\(\)/)
    expect(s, '★超限分支没走 abortUnfinished').toMatch(/if \(exceeded\) \{\s*abortUnfinished\(\)/)
    // 落盘上限必须与 Android/iOS 同值（1 GiB）
    expect(s, '★落盘上限与 Android/iOS 不一致').toMatch(/1024u \* 1024u \* 1024u/)
    // ★B1：必须有析构兜底（早退/异常展开都要清）——这条有真行为判据在
    //   `tests/harmony-save-session-raii.test.ts`，这里只做结构兜底
    expect(s, '★缺析构兜底（早退会泄漏 fd + 留残包）').toMatch(/~SaveSession\(\)\s*\{\s*abortUnfinished\(\);/)
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

  it('★★★#1191（B5）沙箱根**在 hostAppRender/Boot 里自动注入**（覆盖 CLI 生成的宿主）', () => {
    /**
     * ★B5：原实现只靠内部壳 `Superapp.ets` 手动调 `injectSandboxRoot()` ⇒
     *   CLI 生成的宿主（`packages/cli/templates-host/harmony/.../MainPage.ets`）没接
     *   ⇒ **框架用户一用 savePath 就报"路径非法"**（实际是根为空）。
     *   ⇒ 修法 = 在 `hostAppBoot` / `hostAppRender` 里用入参 `filesDir` 自动注入
     *     （两套壳都走这两个入口，不必再让每个壳记得调）。
     */
    const impl = read('hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h')
    const injected = (impl.match(/setHttpSandboxRoot\(filesDir\)/g) || []).length
    expect(injected, `★只在 ${injected} 个入口自动注入（hostAppBoot / hostAppRender 都要）`).toBeGreaterThanOrEqual(2)
    // CLI 模板确实传了非空 filesDir 进这些入口（否则注入拿到空串也无用）
    const cli = read('packages/cli/templates-host/harmony/entry/src/main/ets/shell/MainPage.ets')
    expect(cli, '★CLI 模板没把 filesDir 传给 hostAppRender').toMatch(/filesDir: this\.filesDir/)
  })
})

describe('★★★#1187 鸿蒙 stream：模型限制 ⇒ 必须如实拒绝（不得静默降级）', () => {
  /**
   * ★★★#1191（独立验证 J1 修复）：**判据必须锚定返回值字面量，不能 grep 整个文件**。
   *   原版三条断言（正则匹配 `if (f.stream…)` / `一次性 VM` / `savePath`）的**首个命中全在注释**里
   *   ⇒ 变异实测：把 if 的**函数体清空**（= 恢复静默忽略）三条仍全绿。**假绿**。
   *   ⇒ 现在先取出 `f.stream` 那个 if 块，再断言块内**真的 return 了**带 unsupported 的 err。
   */
  it('★`stream: true` 必须显式报 unsupported（此前是静默忽略）', () => {
    const s = read(HTTP)
    const at = s.indexOf('if (f.stream && *f.stream)')
    expect(at, '★找不到 stream 分支（被删了？）').toBeGreaterThan(0)
    // 取该分支的块（到下一个 `\n  }\n` 为止），只在块内断言——避免注释/别处命中
    const block = s.slice(at, s.indexOf('\n  }\n', at) + 4)
    expect(block, '★stream 分支没有 return（= 静默忽略，请求照常成功）').toMatch(/return\s+proteus::wire::ResolveFrame::err/)
    // 拒绝信息必须是**返回值里的字面量**（不是注释里的）
    expect(block, '★拒绝信息不是 fetch.unsupported 字面量').toContain('fetch.unsupported')
    expect(block, '★拒绝信息没点明根因（一次性 VM + 同步 napi）').toMatch(/一次性 VM[\s\S]{0,80}同步 napi/)
    expect(block, '★拒绝信息没给替代方案（savePath）').toContain('savePath')
  })
})

describe('★★★#1187 鸿蒙**真机**证据（落盘 / stream 拒绝）', () => {
  it('★savePath 落盘：回 {path,size} 摘要且内存保留 0（逐块直写成立）', () => {
    const p = 'hosts/harmony/results/http-probe-save.json'
    expect(fs.existsSync(path.join(ROOT, p)), `★缺落盘真机证据 ${p}`).toBe(true)
    const r = JSON.parse(read(p))
    expect(r.ok, '★落盘请求未成功').toBe(true)
    // ★回执必须是摘要，不是响应体
    expect(String(r.preview), '★回执不是 {path,size} 摘要').toMatch(/"path":"download\//)
    expect(String(r.preview), '★摘要里没有 size').toMatch(/"size":\d+/)
    // ★最关键的一条：落盘模式下**内存不保留响应体**
    //   （limit.kept=0 而 limit.seen>0 ⇒ 真的是逐块写文件，不是先全进内存再写）
    expect(r.limit.seen, '★没收到数据').toBeGreaterThan(0)
    expect(r.limit.kept, `★内存里保留了 ${r.limit.kept}B（落盘模式应为 0，否则大文件会打爆）`).toBe(0)
    // 摘要长度应远小于实际字节数（响应体没有回传）
    expect(r.bodyBytes, '★回执 bodyBytes 等于全文（说明回的是响应体而非摘要）').toBeLessThan(r.limit.seen)
  })

  it('★★★#1191 savePath：真机可核对读数（saveMode / saveWritten==seen / cap=1GiB）', () => {
    /**
     * ★独立验证 J4 的修复：原判据拿 `kept==0` 当"逐块直写"的证据 —— 那是**恒真式**
     *   （落盘分支不填 gate.body，恒为 0；把 write() 改成 no-op 也还是 0）。
     * ⇒ 换成三个可核对的量 + 设备侧 stat（脚本里已加）。
     */
    const r = JSON.parse(read('hosts/harmony/results/http-probe-save.json'))
    const lim = r.limit ?? {}
    expect(lim.saveMode, '★saveMode != true（没走落盘分支）').toBe(true)
    expect(lim.saveWritten, '★saveWritten=0（一个字节都没写进文件）').toBeGreaterThan(0)
    expect(lim.saveWritten, '★saveWritten != seen（写盘量与收到量不符）').toBe(lim.seen)
    expect(lim.cap, '★cap 不是 1 GiB（J5：硬编码 32 MiB 的旧缺陷）').toBe(1024 * 1024 * 1024)
    expect(lim.saveLimit, '★saveLimit 不是 1 GiB').toBe(1024 * 1024 * 1024)
  })

  it('★★★#1191 路径穿越：真机被拒（安全判据不再只有静态）', () => {
    const p = 'hosts/harmony/results/http-probe-save-traversal.json'
    expect(fs.existsSync(path.join(ROOT, p)), `★缺路径穿越真机证据 ${p}`).toBe(true)
    const r = JSON.parse(read(p))
    expect(r.ok, '★../../etc/passwd 没被拒绝（可写出沙箱）').toBe(false)
    expect(String(r.reason), '★拒绝信息没说清是路径非法').toMatch(/savePath 非法/)
    // ★拒绝必须在**任何网络操作之前**（没进落盘分支、没装闸）
    expect(r.limit?.saveMode, '★拒绝了路径却仍进了落盘分支').toBe(false)
  })

  it('★stream：真机如实拒绝（fetch.unsupported + 点明根因 + 给替代）', () => {
    const p = 'hosts/harmony/results/http-probe-stream-reject.json'
    expect(fs.existsSync(path.join(ROOT, p)), `★缺 stream 真机证据 ${p}`).toBe(true)
    const r = JSON.parse(read(p))
    expect(r.ok, '★stream 没被拒绝（仍静默降级 = 假数据）').toBe(false)
    const reason = String(r.reason)
    expect(reason, '★拒绝码不是 fetch.unsupported').toContain('fetch.unsupported')
    expect(reason, '★没点明根因（一次性 VM + 同步 napi）').toMatch(/一次性 VM[\s\S]{0,40}同步 napi/)
    expect(reason, '★没给替代方案').toMatch(/savePath/)
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

  /**
   * ★★★#1191（独立验证 J2 修复）：**同样锚定返回块，不 grep 整文件**。
   *   原版 `no-op`/`timeout`/`pinning`/`CA` 的**首个命中全在文件头注释** ⇒ 变异实测：
   *   把三个返回值换成最小 JSON（删光文案）四条断言**仍全绿**。**假绿**。
   */
  it('★★绝不伪造"取消成功"（鸿蒙 abort 是 no-op，这是模型限制不是能力）', () => {
    const blk = stubBlock('http.cancel')
    expect(blk, '★找不到 http.cancel 的返回块').toBeTruthy()
    expect(blk, '★http.cancel 报了 ok:true（会让业务以为取消生效了）').toMatch(/ok\\":false/)
    expect(blk, '★http.cancel 返回块里没点明 abort 是 no-op').toMatch(/no-op/)
    expect(blk, '★返回块里没给出替代方案 timeout').toMatch(/timeout/)
  })

  it('★★tlsStats / cancelStats 的限制必须放进 `data`（桥结算会丢顶层 note）', () => {
    // ★B6：桥是 `p.resolve(parsed?.data ?? parsed)` ⇒ 有 data 时顶层 reason/note 整段丢失。
    const tls = stubBlock('http.tlsStats')
    expect(tls, '★找不到 tlsStats 返回块').toBeTruthy()
    expect(tls, '★tlsStats 的限制没放进 data（业务只看得到全 0）').toMatch(/\\"data\\":\{[\s\S]{0,400}pinning/)
    expect(tls, '★tlsStats 没说清 pinning 不生效').toMatch(/pinning/)
    expect(tls, '★tlsStats 没点明 RCP 只提供 CA 配置').toMatch(/CA/)

    const cs = stubBlock('http.cancelStats')
    expect(cs, '★cancelStats 的限制没放进 data').toMatch(/\\"data\\":\{[\s\S]{0,400}supported/)
    expect(cs, '★cancelStats 没说明取消不可用').toMatch(/no-op|supported/)
  })
})
