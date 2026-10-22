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
      expect(b, `★${fn} 里没注入沙箱根（B5：首屏/后续 render 都走它）`).toMatch(
        /if \(!\w+\.empty\(\)\) proteus::http::setHttpSandboxRoot\(\w+\);/,
      )
    }
    // CLI 模板首屏确实走 hostAppRender（而不是 Boot）
    const cli = read('packages/cli/templates-host/harmony/entry/src/main/ets/shell/MainPage.ets')
    expect(cli, '★CLI 模板没把 filesDir 传给 hostAppRender').toMatch(/filesDir: this\.filesDir/)
    expect(cli, '★CLI 模板首屏不是走 hostAppRender？').toMatch(/hostAppRender\(/)
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
    const lim = r.limit ?? {}
    expect(lim.saveMode, '★saveMode != true（没走落盘分支）').toBe(true)
    expect(lim.saveWritten, '★saveWritten=0（一个字节都没写进文件）').toBeGreaterThan(0)
    expect(lim.saveWritten, '★saveWritten != seen（写盘量与收到量不符）').toBe(lim.seen)
    expect(lim.cap, '★cap 不是 1 GiB（J5：硬编码 32 MiB 的旧缺陷）').toBe(1024 * 1024 * 1024)
    expect(lim.saveLimit, '★saveLimit 不是 1 GiB').toBe(1024 * 1024 * 1024)
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
    expect(sh, '★stat 不符时没置 RC=1（探针会假绿）').toMatch(/\.\s*echo\s+"✗[^\n]*\n?\s*RC=1|然后\s*RC=1|;\s*RC=1/)
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
