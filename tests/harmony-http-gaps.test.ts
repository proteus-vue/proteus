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
 *   起点 = `method == "<name>"` 那一行；终点 = 该 if 块的**闭合大括号**。
 *   ★这是修"注释里出现也算命中"的假绿所必需的：整文件 grep 会命中文件头注释。
 *
 * ★★★#1344 B-2c 修正：终点**不能**取"第一个 `return true;`" —— `http.cancel` 现在是
 *   **两分支**（会话模式 `return true` 在前，一次性 VM 的 no-op 文案在后）⇒ 旧切法会把
 *   后半段的 no-op 断言整个切掉，导致"不得伪造成功"那条**永远看不到要断言的文本**。
 *   ★改用**花括号配平**取完整 if 块（字符串与注释里的括号不参与计数）。
 */
function stubBlock(method: string): string {
  const s = read('hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_stubs.h')
  const at = s.indexOf(`method == "${method}"`)
  if (at < 0) return ''
  // 从方法判断处找到该 if 的 `{`（跳过 `&&`/`||` 等表达式里的括号：只看第一个 `{`）
  const braceAt = s.indexOf('{', at)
  if (braceAt < 0) return ''
  let depth = 0
  let i = braceAt
  let inStr: string | null = null
  let inLineComment = false
  for (; i < s.length; i++) {
    const c = s[i]
    const next = s[i + 1]
    if (inLineComment) {
      if (c === '\n') inLineComment = false
      continue
    }
    if (inStr !== null) {
      if (c === '\\') { i++; continue }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '/' && next === '/') { inLineComment = true; i++; continue }
    if (c === '/' && next === '*') {
      const endC = s.indexOf('*/', i + 2)
      if (endC < 0) break
      i = endC + 1
      continue
    }
    if (c === '"' || c === "'") { inStr = c; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return s.slice(at, i + 1)
    }
  }
  return s.slice(at)
}
const HTTP = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http.h'
const SAVE = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_save.h'
const STUBS = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_stubs.h'
/** ★#1203：「本端不支持的能力」前置拒绝实现（stream / tlsPins / upload 都在这里） */
const GUARD_H = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_guard.h'
/** ★#1344 B-2c/B-3：会话式 VM（在途表 / 真取消 / 流式块回推的注册处） */
const SESSION_H = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_vm_session.h'
/** ★#1344 B-3：逐块接收闸（累积 / 落盘 / 流式回推 三选一分流点；从 proteus_http.h 抽出） */
const RECV_H = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_recv.h'

describe('★★★#1187 鸿蒙 savePath：逐块落盘（同步模型下可做 ⇒ 必须做）', () => {
  it('★落盘走 SaveSession（逐块直写文件，不累积 body）', () => {
    const s = read(HTTP)
    expect(s, '★savePath 未被使用（帧里有、宿主不用 = 业务以为落盘了实际没写）').toMatch(
      /if \(f\.savePath\.has && !f\.savePath\.v\.empty\(\)\)/,
    )
    expect(s, '★没有 SaveSession（落盘实现缺失）').toMatch(/SaveSession save;/)
    // ★★★#1344 B-3：`recvGate` 已抽到 `proteus_http_recv.h`（三选一分流点：累积/落盘/流式）。
    //   判据必须跟着走 —— 否则"文件搬了、判据还在看旧文件"会变成**永远绿的空断言**。
    const recv = read(RECV_H)
    // ★逐块回调里必须走 save->write（否则会先全进内存再写 = 大文件打爆）
    expect(recv, '★逐块回调没走 SaveSession（内存峰值会等于整个响应体）').toMatch(
      /if \(g->save != nullptr\)[\s\S]{0,200}g->save->write\(p, n\)/,
    )
    // ★且落盘分支必须**在**流式分支之前（savePath 优先，两者同时出现时不能悄悄改语义）
    const saveAt = recv.indexOf('if (g->save != nullptr)')
    const streamAt = recv.indexOf('if (g->streamReqId != nullptr')
    expect(saveAt, '★找不到落盘分支').toBeGreaterThan(0)
    expect(streamAt, '★找不到流式分支').toBeGreaterThan(0)
    expect(saveAt, '★落盘分支必须在流式分支之前（savePath 优先，语义不能偷偷变）').toBeLessThan(streamAt)
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

  it('★★★#1192（B5）沙箱根在 **HostAppRender** 里注入（CLI 首屏只走它）', () => {
    /**
     * ★独立验证第二轮 NB1 抓出：上一轮我把注入加在 Boot / Drive，而
     *   · CLI 模板**从不调** hostAppBoot；· 首屏 renderCurrent 调 **hostAppRender**；
     *   · hostAppDrive 只在 switchTab 里。
     *   ⇒ 原判据只数"全文出现 ≥2 次"，任何两处都过 ⇒ **假绿**（Boot+Drive 也满足）。
     * ⇒ 现在**按函数切块**，断言 HostAppRender 块内必须有注入。
     */
    const impl = read('hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h')
    const fnBody = (name: string): string => {
      const at = impl.indexOf(`static napi_value ${name}(`)
      if (at < 0) return ''
      // 到下一个 static napi_value 或文件末尾
      const next = impl.indexOf('static napi_value ', at + 10)
      return impl.slice(at, next < 0 ? impl.length : next)
    }
    for (const fn of ['HostAppBoot', 'HostAppRender']) {
      const b = fnBody(fn)
      expect(b, `★找不到 ${fn}（函数改名了？）`).toBeTruthy()
      /**
       * ★★★#1196（第四轮 W3b 修复）：**必须用反向引用锁住"同一个变量"**。
       *   原正则 `if \(!\w+\.empty\(\)\) ...setHttpSandboxRoot\(\w+\);` 是"两个独立的 \w+"
       *   ⇒ 变异 `if (!fd2.empty()) setHttpSandboxRoot(fd);`（条件判 fd2、注入传空 fd）
       *   **仍全绿**，而实际效果是**每次 render 都把沙箱根清空** ⇒ B5 变成"永远路径非法"。
       *   ⇒ 用 `\1` 反向引用：条件与实参必须是**同一个标识符**。
       */
      const m = /if \(!(\w+)\.empty\(\)\) proteus::http::setHttpSandboxRoot\((\w+)\);/.exec(b)
      expect(m, `★${fn} 里没注入沙箱根（B5：首屏/后续 render 都走它）`).toBeTruthy()
      expect(m![1], `★${fn} 的注入用的是**另一个变量**（条件判 ${m![1]}、传参 ${m![2]}）⇒ 会把沙箱根清空`).toBe(m![2])
    }
    // CLI 模板首屏确实走 hostAppRender（而不是 Boot）
    const cli = read('packages/cli/templates-host/harmony/entry/src/main/ets/shell/MainPage.ets')
    expect(cli, '★CLI 模板没把 filesDir 传给 hostAppRender').toMatch(/filesDir: this\.filesDir/)
    expect(cli, '★CLI 模板首屏不是走 hostAppRender？').toMatch(/hostAppRender\(/)
  })
})

describe('★★★#1187/#1344 鸿蒙 stream：**双口径**（会话模式放行 / 一次性 VM 如实拒绝）', () => {
  /**
   * ★★★#1191（独立验证 J1 修复）：**判据必须锚定返回值字面量，不能 grep 整个文件**。
   *   原版三条断言（正则匹配 `if (f.stream…)` / `一次性 VM` / `savePath`）的**首个命中全在注释**里
   *   ⇒ 变异实测：把 if 的**函数体清空**（= 恢复静默忽略）三条仍全绿。**假绿**。
   *   ⇒ 现在先取出 `f.stream` 那个 if 块，再断言块内**真的 return 了**带 unsupported 的 err。
   *
   * ★★★#1344 B-3 翻转：stream 在**会话式 VM** 里已实现（逐块回推）⇒ 判据从"一律拒绝"变成
   *   **双口径**：
   *     · 钩子**未注册**（一次性 VM / 生产路径）⇒ 必须仍如实拒绝（这条不能丢——否则
   *       业务在一次性 VM 上以为 `onChunk` 会跑，实际一次都不触发）；
   *     · 钩子**已注册**（会话模式）⇒ 必须放行。
   *   ⇒ 断言要点：
   *     ① 拒绝分支带 `!httpStreamAvailable()` 条件（**无条件拒绝**在会话模式下会误杀真实流式）；
   *     ② 该分支仍 return 带 `fetch.unsupported` 的字面量（保留根因与替代方案）；
   *     ③ `handle()` 确实调用了 guard；
   *     ④ 会话侧**真的注册/注销**了钩子（注册缺失 ⇒ 会话里 stream 永远被拒；注销缺失 ⇒
   *        会话关掉后仍"看起来支持"）。
   */
  it('★`stream: true` 必须双口径：无回推接收方 ⇒ 拒绝；会话模式 ⇒ 放行', () => {
    const guard = read(GUARD_H)
    const at = guard.indexOf('if (f.stream && *f.stream && !httpStreamAvailable())')
    expect(at, '★找不到 stream 的双口径分支（条件必须含 !httpStreamAvailable()）').toBeGreaterThan(0)
    const block = guard.slice(at, guard.indexOf('\n  }', at) + 4)
    expect(block, '★stream 分支没有 return（= 静默忽略，请求照常成功）').toMatch(/return\s+"/)
    // 拒绝信息必须是**返回值里的字面量**（不是注释里的）
    expect(block, '★拒绝信息不是 fetch.unsupported 字面量').toContain('fetch.unsupported')
    expect(block, '★拒绝信息没点明根因（一次性 VM + 同步 napi）').toMatch(/一次性 VM[\s\S]{0,80}同步 napi/)
    expect(block, '★拒绝信息没给替代方案（savePath）').toContain('savePath')
    // ★钩子与可用性判据必须同头（否则 guard 看不见它 ⇒ 又变成 include 顺序的隐式契约）
    expect(guard, '★`httpStreamAvailable` 不在 guard 头里（可见性靠 include 顺序 = 脆弱）')
      .toContain('httpStreamAvailable')
    // ② 调用点必须在 handle() 里（guard 写了不调用 = 静默失效原样保留）
    const h = read(HTTP)
    expect(h, '★handle() 没调用 unsupportedFeatureReason（guard 成了死代码）')
      .toContain('unsupportedFeatureReason(f)')
    // ③ 会话侧真的注册 + 注销钩子
    const sess = read(SESSION_H)
    expect(sess, '★会话打开时没注册流式钩子（会话里 stream 会被误拒）')
      .toContain('setHttpStreamHandler(&pushStreamChunk)')
    expect(sess, '★会话关闭时没注销流式钩子（关掉后仍"看起来支持"）')
      .toContain('setHttpStreamHandler(nullptr)')
    // ④ 钩子实现必须真的把块编成**带 streamSeq 的 PRSP 帧**（不是只累加计数）
    const pushAt = sess.indexOf('inline size_t pushStreamChunk(')
    expect(pushAt, '★找不到 pushStreamChunk 实现').toBeGreaterThan(0)
    const pushBlock = sess.slice(pushAt, sess.indexOf('\n}', pushAt) + 2)
    expect(pushBlock, '★流式块帧没带 streamSeq（JS 侧无法判定块序/丢帧）').toContain('streamSeq')
    expect(pushBlock, '★流式块没入队（pushResolve 未调用 ⇒ 永远到不了 JS）').toContain('pushResolve')
  })
})

describe('★★★#1187 鸿蒙**真机**证据（落盘 / stream 拒绝）', () => {
  it('★savePath 落盘：回 {path,size} 摘要（不回响应体）', () => {
    const p = 'hosts/harmony/results/http-probe-save.json'
    expect(fs.existsSync(path.join(ROOT, p)), `★缺落盘真机证据 ${p}`).toBe(true)
    const r = JSON.parse(read(p))
    expect(r.ok, '★落盘请求未成功').toBe(true)
    // ★回执必须是摘要，不是响应体
    expect(String(r.preview), '★回执不是 {path,size} 摘要').toMatch(/"path":"download\//)
    expect(String(r.preview), '★摘要里没有 size').toMatch(/"size":\d+/)
    expect(r.limit.seen, '★没收到数据').toBeGreaterThan(0)
    /**
     * ★★★#1192（独立验证第二轮 J-J4-1）：**删掉原来的 `kept==0` 断言**。
     *   它自相矛盾——同一文件下面已写清 `kept` 是恒真式（落盘分支不填 `gate.body`）。
     *   "逐块写"与"内存有界"由 `saveWritten`（写进文件的量）与 `harmony-save-session-raii`
     *   的真行为判据覆盖，不用 `kept` 冒充。
     */
    expect(r.bodyBytes, '★回执 bodyBytes 等于全文（说明回的是响应体而非摘要）').toBeLessThan(r.limit.seen)
  })

  it('★★★#1191 savePath：真机可核对读数（saveMode / saveWritten==seen / cap=1GiB）', () => {
    /**
     * ★独立验证 J4 的修复：原判据拿 `kept==0` 当"逐块直写"的证据 —— 那是**恒真式**
     *   （落盘分支不填 gate.body，恒为 0；把 write() 改成 no-op 也还是 0）。
     * ⇒ 换成三个可核对的量 + 设备侧 stat（脚本里已加）。
     */
    const r = JSON.parse(read('hosts/harmony/results/http-probe-save.json'))
    // ★#1199（第五轮 D1）：**本块必须自带 ok:true 前提**——失败路径下 `saveWritten`
    //   语义是"写入后丢弃的字节"，拿它跟设备大小比会误读。别依赖另一个测试块的前提。
    expect(r.ok, '★落盘未成功时下列读数无意义').toBe(true)
    const lim = r.limit ?? {}
    expect(lim.saveMode, '★saveMode != true（没走落盘分支）').toBe(true)
    expect(lim.saveWritten, '★saveWritten=0（一个字节都没写进文件）').toBeGreaterThan(0)
    expect(lim.saveWritten, '★saveWritten != seen（写盘量与收到量不符）').toBe(lim.seen)
    expect(lim.cap, '★cap 不是 1 GiB（J5：硬编码 32 MiB 的旧缺陷）').toBe(1024 * 1024 * 1024)
    expect(lim.saveLimit, '★saveLimit 不是 1 GiB').toBe(1024 * 1024 * 1024)
    /**
     * ★★★#1197（第四轮验证者指出）：**证据里必须有设备侧 stat 读数**。
     *   原来只信探针自报的 `preview.size` ⇒ 离线/判据都**无法复判**"文件真的在设备上、
     *   大小真的对得上"。⇒ 脚本已把 `hdc stat -c %s` 的结果写进 `deviceStat`，
     *   这里断言三件：设备大小 == 回执 size、match 为真、且 `saveWritten` 与设备大小一致。
     */
    expect(r.deviceStat, '★证据里缺 deviceStat（离线无法复判设备文件真实大小）').toBeTruthy()
    expect(r.deviceStat.sizeOnDevice, '★设备侧大小缺失（stat 没跑或文件不存在）').toBeGreaterThan(0)
    expect(r.deviceStat.sizeOnDevice, '★设备侧大小 != 回执 size（摘要不可信）').toBe(r.deviceStat.sizeReported)
    expect(r.deviceStat.match, '★脚本没把 match 判为真').toBe(true)
    // ★#1198：**只看 deviceStat 存在不够**——必须有 `verified:true`（= 整条判据通过时才写）
    expect(r.deviceStat.verified, '★证据未标记 verified（可能是校验失败时写下的坏证据）').toBe(true)
    expect(r.deviceStat.sizeOnDevice, '★设备文件大小 != saveWritten（写入量与落盘量不符）').toBe(lim.saveWritten)
  })

  it('★★★#1193（B4）落盘内存**不随文件大小增长**（64MiB 实测 VmHWM 只涨 3.4MiB）', () => {
    /**
     * ★这条收口 #1191/#1192 一直标着的"B4 未取证"：
     *   `SaveSession` 逐块直写只消除**本层** body 累积；RCP 的 `Rcp_Response.body` 是否整包驻留
     *   此前**没有任何数据**（只降级了文案）。⇒ 现在用 `/proc/self/status` 的 `VmHWM`
     *   在真机上做两组对照（1 MiB vs 64 MiB）。
     *
     * 判定逻辑：若 RCP 整包驻留，64 MiB 那次 VmHWM 至少涨 ~64 MiB；
     *   实测只涨 3.41 MiB（≈ 固定开销）⇒ **内存与文件大小无关在本端成立**。
     * ★注意：这证明的是"本端（鸿蒙 + RCP）在 64 MiB 量级不整包驻留"，
     *   不外推到 1 GiB（未压测）。
     */
    const small = JSON.parse(read('hosts/harmony/results/http-probe-save-1m.json')).limit
    const big = JSON.parse(read('hosts/harmony/results/http-probe-save-64m.json')).limit

    // 两组都必须真的收全（防"截断了所以内存小"的假绿）
    expect(small.seen, '★1MiB 组没收到全部字节').toBe(1024 * 1024)
    expect(big.seen, '★64MiB 组没收到全部字节（截断会让内存看起来很小）').toBe(64 * 1024 * 1024)
    expect(big.saveWritten, '★64MiB 组没全写进文件').toBe(64 * 1024 * 1024)
    // 逐块：64MiB 必须远多于 1 块
    expect(big.chunks, `★chunks=${big.chunks}（太少 ⇒ 不是逐块）`).toBeGreaterThan(100)

    const smallDelta = (small.vmHwmAfterKb ?? 0) - (small.vmHwmBeforeKb ?? 0)
    const bigDelta = (big.vmHwmAfterKb ?? 0) - (big.vmHwmBeforeKb ?? 0)
    // VmHWM 必须可读（0 = 不可得，不能当"内存 0"）
    expect(small.vmHwmBeforeKb, '★VmHWM 读不到（判据会退化成恒真）').toBeGreaterThan(0)
    expect(big.vmHwmBeforeKb, '★VmHWM 读不到').toBeGreaterThan(0)

    // ★核心判据：文件大 64 倍，内存增量不得超过 16 MiB（远小于文件大小）
    expect(
      bigDelta,
      `★64MiB 落盘让进程峰值涨了 ${(bigDelta / 1024).toFixed(1)}MiB（疑似 RCP 整包驻留）`,
    ).toBeLessThan(16 * 1024)
    // 并与小文件对照：增量不应随文件线性增长（64 倍文件、增量不到 4 倍）
    expect(
      bigDelta,
      `★内存增量随文件增长（1MiB:+${(smallDelta / 1024).toFixed(1)}MiB vs 64MiB:+${(bigDelta / 1024).toFixed(1)}MiB）`,
    ).toBeLessThan(Math.max(smallDelta * 4, 8 * 1024))
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

  it('★★★#1192 探针脚本：设备侧 stat 核对 + 可重放的"预期拒绝"模式', () => {
    /**
     * ★独立验证第二轮 J-J6-1：脚本确实加了 `hdc shell stat -c %s`，但**没有任何机器判据守着它**
     *   （删掉那 20 行，全部判据仍绿）⇒ 这是"实现有效但无回归防线"。
     * ★J-J6-2：路径穿越证据**无法用脚本复现**（save 分支要求 ok:true，而穿越必须 ok:false）。
     */
    const sh = read('hosts/harmony/run-http-probe.sh')
    expect(sh, '★脚本缺设备侧 stat 核对（只信探针自报摘要 ⇒ 写 0 字节也能全绿）').toMatch(
      /stat -c %s/,
    )
    expect(sh, '★缺"设备大小 != 回执 size"的失败分支').toMatch(/SIZE_ON_DEVICE.*!=.*SIZE_REPORTED|!= "\$SIZE_REPORTED"/)
    // ★#1194（J-R1）：光有比较不算——失败分支必须**真的置 RC=1**
    /**
     * ★★★#1199（第五轮 W1 再修）：**300 字符窗口会跨到下一个分支**。
     *   验证者实测字符距离：分支1→自己的 RC=1 = 83、分支2→自己的 = 127、
     *   **分支1→分支2 的 RC=1 = 217（仍在 300 内）** ⇒ 只删分支1 的 `RC=1` 时，
     *   断言1 会命中分支2 的 `RC=1` ⇒ 全绿；而按变异版真跑时 `FINAL_RC=0`
     *   （脚本会在"设备上没有落盘文件"的情况下打印「✓ 判据通过」）。
     *   ⇒ **按分支切片**：每段只到下一个 `elif`/`fi` 为止，窗口不跨分支。
     */
    const statBlock = sh.slice(sh.indexOf('stat -c %s'), sh.indexOf('T-app-fetch 真机判据通过'))
    /** 取某个 `if/elif ... then` 分支的**体内**（到下一个 `elif`/`fi` 之前） */
    const branchBody = (needle: string): string => {
      const at = statBlock.indexOf(needle)
      if (at < 0) return ''
      const from = statBlock.indexOf('then', at) + 4
      const ends = [statBlock.indexOf('elif', from), statBlock.indexOf('fi', from)].filter((x) => x > 0)
      const end = ends.length ? Math.min(...ends) : statBlock.length
      return statBlock.slice(from, end)
    }
    const b1 = branchBody('if [ -z "$SIZE_ON_DEVICE" ]')
    const b2 = branchBody('elif [ "$SIZE_ON_DEVICE" != "$SIZE_REPORTED" ]')
    expect(b1, '★找不到「设备上无文件」分支').toBeTruthy()
    expect(b2, '★找不到「大小不符」分支').toBeTruthy()
    // ★分支体内的 RC=1 —— 不允许借用另一个分支的
    expect(b1, '★「设备无文件」分支没置 RC=1（该分支失效测不出来）').toMatch(/RC=1/)
    expect(b2, '★「大小不符」分支没置 RC=1（该分支失效测不出来）').toMatch(/RC=1/)
    expect(sh, '★缺 --expect-reject 模式（穿越证据无法复现）').toMatch(/--expect-reject/)
  })

  it('★★★#1192 `lastTransport()` 每请求清空（否则上一请求读数"粘"到本次）', () => {
    const s = read(HTTP)
    // 必须在 handle() 入口清空（否则复用连接/早退时会残留上一请求的读数）
    const fnAt = s.indexOf('inline proteus::wire::ResolveFrame handle(')
    expect(fnAt, '★找不到 handle()').toBeGreaterThan(0)
    const body = s.slice(fnAt, s.indexOf('\n}\n', fnAt))
    expect(body, '★handle() 入口没清空 lastTransport（上一请求读数会粘到本次）').toMatch(
      /lastTransport\(\)\.clear\(\)/,
    )
    // ★#1194（J-R3）：必须**在第一个 return 之前**——挪到 url/stream 早退之后同样是回归形态
    const clearAt = body.indexOf('lastTransport().clear()')
    const firstReturn = body.indexOf('return ')
    expect(clearAt, '★clear 在第一个 return 之后（早退请求会把上次读数粘过去）').toBeLessThan(firstReturn)
    /**
     * ★★★#1196（第四轮 W3a 修复）：**必须是无条件整行**。
     *   变异 `if (false) lastTransport().clear();` ⇒ 文本位置没变（仍在第一个 return 之前）
     *   ⇒ 原判据**全绿**，而实际一次都不清。
     *   ⇒ 断言该行**行首只有空白 + 语句**（不被包进 if/循环/条件表达式）。
     */
    // ★#1196：行首必须只有空白（不被包进 if/循环），但**允许同一行有后续语句**
    //   （我们把 lastLimitDiag 重置与它并到了一行以省行数）
    expect(body, '★clear 被包进了条件语句（`if (false) ...` 能骗过位置判据）').toMatch(
      /^\s*lastTransport\(\)\.clear\(\);/m,
    )
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
      /proteus::http::httpStubDispatch\(method, argsJson, &o\)/,
    )
  })

  /**
   * ★★★#1191（独立验证 J2 修复）：**同样锚定返回块，不 grep 整文件**。
   *   原版 `no-op`/`timeout`/`pinning`/`CA` 的**首个命中全在文件头注释** ⇒ 变异实测：
   *   把三个返回值换成最小 JSON（删光文案）四条断言**仍全绿**。**假绿**。
   *
   * ★★★#1344 B-2c 翻转（**双口径**）：会话式 VM 起，`http.cancel` 在会话模式下**真能取消**
   *   （查在途表 → `HMS_Rcp_CancelRequest`，真机 `cancelStats.calls=1` 已证）。
   *   但**一次性 VM（生产路径）仍是 no-op** —— 那条分支绝不能改成伪造成功。
   *   ⇒ 判据从"一律不得 ok:true"改为：
   *     · `g_sessionCancel == nullptr` 分支 ⇒ 仍须 `ok:false` + `no-op` + 建议 `timeout`；
   *     · `g_sessionCancel != nullptr` 分支 ⇒ 必须**真的调钩子**（`g_sessionCancel(stubReqId(...))`），
   *       不能只写好文案却什么都不做。
   */
  it('★★双口径：会话模式真取消（调钩子）· 一次性 VM 仍如实报 no-op', () => {
    const blk = stubBlock('http.cancel')
    expect(blk, '★找不到 http.cancel 的返回块').toBeTruthy()
    // ① 一次性 VM 分支：不得伪造成功
    expect(blk, '★一次 VM 分支报了 ok:true（会让业务以为取消生效了）').toMatch(/ok\\":false/)
    expect(blk, '★一次 VM 分支没点明 abort 是 no-op').toMatch(/no-op/)
    expect(blk, '★一次 VM 分支没给出替代方案 timeout').toMatch(/timeout/)
    // ② 会话分支：必须真的调钩子（否则"支持取消"是文案摆设）
    expect(blk, '★http.cancel 的会话分支没调 g_sessionCancel（写了文案但不取消）')
      .toMatch(/g_sessionCancel\(\s*stubReqId\(/)
    expect(blk, '★会话分支没把 reqId 解析出来（钩子拿不到要取消谁）').toContain('stubReqId')
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
