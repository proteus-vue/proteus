// tests/harmony-session-reuse.test.ts
// ★★★决策 #1156：**鸿蒙 RCP session 必须跨请求复用**——静态判据（防回归）。
//
// 【它守的是一个真机实测抓出的**真缺陷**（不是推断）】
//   `hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http.h` 的 `handle()` 原本是
//   「建 session → 发请求 → **关 session**」⇒ 每个 `http.request` 都是全新 RCP session。
//   RCP 的连接池随 session 生灭 ⇒ **鸿蒙端完全没有连接复用**。
//
//   ★真机证据（2026-10-21 · HUAWEI KLE-AL00U · `bash hosts/harmony/run-transport-probe.sh 3`）：
//     修复前：服务端记账 `requests=3, connections=3, reused=false`，
//             三个**不同源端口**（`192.168.0.163:55588/55600/55608`）⇒ 3 条独立 TCP。
//             而同轮设备侧 `statuses=[200,200,200]`、`ms=[58,19,19]` —— **功能全绿**
//             （这正是本仓反复记的形态：**功能对、性能错、零日志**）。
//     对照：Android/iOS 同一判据下均为 `3 请求 / 1 连接`。
//
// 【为什么用静态判据】这段逻辑要 HMS RCP 头 + 设备才能真跑（CI 无 SDK、无设备）；
//   而"是否每请求关 session"是**结构性形态**，静态就能守。真机行为判据是
//   `hosts/harmony/results/transport-probe.json` + `check:cache-evidence` 的 transport 段。
//
// 【★★诚实边界（本判据不看的东西）】
//   · 不看 session **内容语义**（cookie / 认证状态是否随 session 跨请求保留）——
//     RCP 的 cookie 持久化行为**尚未取证**，本轮只证连接复用，不宣称"会话共享已具备"。
//   · 不看"进程退出时是否 close"：刻意不 close（关闭时机没有安全窗口，见源码 `SessionSlot` 注释）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const HTTP_H = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http.h'
/** ★#1204：`SessionSlot` / `sessionSlot()` / `acquireSession()` 已搬到本头（从 handle() 分出） */
const RCPAPI_H = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_rcpapi.h'
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('★★★#1156 鸿蒙 RCP session 必须跨请求复用（真机抓出的零复用缺陷）', () => {
  const h = src(HTTP_H)
  /** ★#1204：会话槽相关代码在新头里——判据要**两处联合**看（搬走不等于语义变了） */
  const rc = src(RCPAPI_H)

  /** `handle()` 的函数体（从签名到文件末尾的 `#endif` 前的闭合）——够用且稳定 */
  function handleBody(): string {
    const start = h.indexOf('ResolveFrame handle(')
    expect(start, `没找到 handle()（${H_INCLUDE_HINT}）`).toBeGreaterThan(0)
    return h.slice(start)
  }

  /**
   * ★★★**去行注释后再断言**（本轮破坏性验证逼出来的第二课）。
   *
   * 【为什么必须去注释】首版直接对原文做正则：把 `slot.session = session;` 注释掉之后
   *   `/slot\.session\s*=\s*session/` **仍然命中注释里的那串字符** ⇒ 判据全绿而行为已回退。
   *   这是本仓记过多次的同族缺陷：**断言"名字/文案存在"等于没断言**
   *   （#1115/#1118/#1122 都栽在"注释里也有这句"）。
   *   ⇒ 只看**活代码**：去掉 `//` 行注释（本文件注释全用行注释；不含 `http://` 之类需保护的内容）。
   */
  function code(src: string): string {
    return src
      .split('\n')
      .map((line) => {
        const i = line.indexOf('//')
        return i >= 0 ? line.slice(0, i) : line
      })
      .join('\n')
  }

  const H_INCLUDE_HINT = `${HTTP_H} 形态变了？`

  it('① 存在**进程级** session 缓存容器（含互斥锁）', () => {
    // ★#1204：容器已搬到 proteus_http_rcpapi.h（纯搬迁，语义不变）
    expect(rc, '★没有 SessionSlot（session 仍是每请求局部变量 ⇒ 必然零复用）').toMatch(/struct\s+SessionSlot/)
    expect(rc, '★SessionSlot 缺 mutex（并发请求会竞争建/取）').toMatch(/std::mutex/)
    expect(rc, '★没有进程序仓 `sessionSlot()` 单例').toMatch(/inline\s+SessionSlot&\s+sessionSlot\(\)/)
  })

  it('★★② `handle()` 里 session 从**共享槽**取，不是每请求新建', () => {
    /**
     * ★★★#1204：session 的"取/建"已搬到 `proteus_http_rcpapi.h` 的 `acquireSession()`。
     *   判据必须**两段联合**（与 stream 判据同源）：① `handle()` 调用 `acquireSession`；
     *   ② `acquireSession` 内部"先查槽、槽空才建、建完写回"。任一段缺失都等于复用失效。
     */
    const body = code(handleBody())
    expect(body, '★handle() 没调 acquireSession（session 获取通路断了）').toMatch(/acquireSession\(/)
    // ★handle() 自己**不得**直建 session（否则绕过共享槽 ⇒ 每请求新建）
    const createCountInHandle = (body.match(/createSession\(/g) ?? []).length
    expect(createCountInHandle, `★handle() 里仍直接 createSession ${createCountInHandle} 次（应 0 次，交给 acquireSession）`).toBe(0)

    const rcode = code(rc)
    const acqAt = rcode.indexOf('acquireSession(')
    expect(acqAt, '★acquireSession 未定义').toBeGreaterThan(0)
    const acqBody = rcode.slice(acqAt)
    expect(acqBody, '★acquireSession 里没有取共享槽（sessionSlot()）').toMatch(/sessionSlot\(\)/)
    // ★允许 createSession 存在，但必须**恰好 1 次**且在"槽为空"之后
    const createCount = (acqBody.match(/createSession\(/g) ?? []).length
    expect(createCount, `★acquireSession 里 createSession 出现 ${createCount} 次（应恰好 1 次，且在槽为空时）`).toBe(1)
    expect(acqBody, '★createSession 不在"槽为空"的分支里（每请求都会新建）').toMatch(
      /session\s*!=\s*nullptr[\s\S]{0,200}return session[\s\S]{0,2000}createSession\(/,
    )
    /**
     * ★★★**必须真的写回共享槽**——只"查"不"写"等于缓存恒空 ⇒ 每请求照样新建。
     * 【这条是破坏性验证逼出来的（本轮实测）】首版判据只查了 `sessionSlot()` 出现、
     *   `pCreateSession` 只出现一次、没有 `pCloseSession`——把 `slot.session = session;`
     *   注释掉之后**5 条全绿**（缓存永不命中，行为与修复前完全一致）。
     *   ⇒ 「查缓存」与「写缓存」必须各有一条断言（与 `tls-pinning-reuse` 的 get/put 配对同源）。
     */
    expect(acqBody, '★建完 session 没有写回共享槽（`slot.session = session`）⇒ 缓存恒空，每请求仍新建').toMatch(
      /slot\.session\s*=\s*session/,
    )
  })

  it('★★③ `handle()` **不得**关闭共享 session（关了 ⇒ 下个请求重建 ⇒ 复用再次归零）', () => {
    const body = code(handleBody())
    expect(body, '★handle() 里仍有 pCloseSession —— 关掉共享 session 等于丢掉连接池').not.toMatch(/pCloseSession\(/)
  })

  it('④ 建 session 的次数有记账（`sessionsCreated`，供探针回执当因果证据）', () => {
    expect(h, '★Stats 没有 sessionsCreated 字段').toMatch(/int\s+sessionsCreated\s*=\s*0/)
    expect(h, '★sessionsCreated 从未自增（读数永远是 0 ⇒ 无法证明复用）').toMatch(/stats\(\)\.sessionsCreated\+\+/)
  })

  /**
   * ★★★#1204：**session 配置必须是进程寿命（static），不能是栈局部**。
   *
   * 【这条判据来自一次真机崩溃（不是推断）】重构后请求一发出就 `SIGSEGV(SEGV_MAPERR)`，栈是：
   *   `handle() → RcpSessionBasedFetchHandle → RcpToCppRequest(const Rcp_SessionConfiguration*, …)`
   *   `→ std::string(char const*) → strlen`。
   * ⇒ **RCP 是在 fetch 时才读 session 配置里的 `char*` 字段**（CA 内容/文件路径等），
   *   而不是在 `CreateSession` 时拷一份。原实现的 `Rcp_SessionConfiguration sc{}` 是
   *   `handle()` **栈上的局部变量** ⇒ `CreateSession` 返回后可能已被覆盖 ⇒ 悬垂指针。
   *   之前没崩只是栈布局恰好还留着旧值 —— **"以前没崩 ≠ 正确"**。
   *
   * 【为什么静态判据守得住】"配置变量是不是 static"是结构性形态，一眼可判；
   *   而真机崩不崩取决于栈布局，**不能靠"跑一遍没崩"当验证**。
   */
  it('★★★⑥ session 配置必须是 static（栈局部 ⇒ RCP 在 fetch 时读到悬垂指针 ⇒ SIGSEGV）', () => {
    const rcode6 = code(rc)
    const acqDef = rcode6.indexOf('inline Rcp_Session* acquireSession')
    expect(acqDef, '没找到 acquireSession 定义').toBeGreaterThan(0)
    const seg = rcode6.slice(acqDef, acqDef + 3000)
    // ★必须声明为 static（跨调用存活）
    expect(seg, '★Rcp_SessionConfiguration 不是 static ⇒ 栈局部，CreateSession 返回后即悬垂').toMatch(
      /static\s+Rcp_SessionConfiguration\s+\w+/,
    )
    // ★且**不得**回到栈局部形态（`Rcp_SessionConfiguration sc{};` 无 static 前缀）
    expect(seg, '★仍有栈局部的 Rcp_SessionConfiguration 声明（悬垂复发）').not.toMatch(
      /\n\s+Rcp_SessionConfiguration\s+\w+\s*\{\s*\}\s*;/,
    )
  })

  it('★⑤ 锁只护"取/建"，不覆盖整段请求（否则并发请求被串行化）', () => {
    const body = code(handleBody())
    /**
     * ★★★断言要**精确到 session 槽的锁**，而不是"文件里有没有 unique_lock"。
     *
     * 【为什么改（#1156 实测假红）】首版用 `not.toMatch(/std::unique_lock<std::mutex>\s+\w+\(/)` 扫整个
     *   `handle()` —— 而**异步等待**（`cv.wait_for` 必须配 `unique_lock`）也在同一个函数里
     *   ⇒ 判据把"等待响应的锁"误判成"session 槽持锁"，红得毫无道理。
     *   ★这与上文 ③ 同源：**判据要盯住它真正想守的东西**，否则会被无关代码形态带偏。
     * ⇒ 只看 session 那一段块（`sessionSlot()` 到该块结束附近）里是否用了函数级锁。
     */
    /**
     * ★#1204：session 的"取/建+加锁"整体搬到 `proteus_http_rcpapi.h` 的 `acquireSession()`。
     * ★定位必须用 `acquireSession` 的定义处（不是 `sessionSlot()` 的定义处——那是文件更早的
     *   单例声明，附近本来就没有锁 ⇒ 会假红）。
     */
    const rcode5 = code(rc)
    const acqDef = rcode5.indexOf('inline Rcp_Session* acquireSession')
    expect(acqDef, '没找到 acquireSession 定义').toBeGreaterThan(0)
    const slotSeg = rcode5.slice(acqDef, acqDef + 2200)
    expect(slotSeg, '★session 槽用了函数级 unique_lock（会持锁到请求结束 ⇒ 并发被串行化）').not.toMatch(
      /std::unique_lock<std::mutex>\s+\w+\(/,
    )
    expect(slotSeg, '★session 槽没有 lock_guard（取/建之间无保护）').toMatch(/std::lock_guard<std::mutex>/)
  })
})
