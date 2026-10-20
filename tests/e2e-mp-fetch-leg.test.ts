// tests/e2e-mp-fetch-leg.test.ts
// ★★★#1130：**MP 真容器**里验 `useFetch` 的桥行为（#1127 诚实边界②的另一半）
//
// 【与 #1127 的假 wx 测试的差别】
//   `fetch-mp-leg-live.test.ts` 用**假 wx** 复刻文档契约——验的是"我们的代码符合假设"。
//   本文件在**微信开发者工具真容器**（Skyline 模拟器）里跑，验的是"假设与真容器一致"，
//   且探针走的是**页面实例上的 `cap.useFetch` 门面**（不是直接调 `wx.request`）——
//   "底层验过" ≠ "门面验过"（层不同、链路不同）。
//
// 【★按需运行（不进 verify 主链）】
//   `PROTEUS_MP_E2E_WXIDE=1` 才跑（与 `e2e-mp-capabilities-showcase` 同策略）：
//   真容器要拉起 IDE、加载项目，单次十几秒，不适合每次全量。
//
// 【前置（不满足时用例会给出可执行命令，而不是假装通过）】
//   ① 微信开发者工具已安装（路径见 AGENTS.md §3）；
//   ② **项目已在工具里打开过**——`automation_*` 靠 projectpath 找 runtimeid，
//      没打开过会报 `cant find runtimeid by projectpath`。打开方式：
//        wechatide -c <client> open_project_window --project <showcase/dist/mp-weixin>
//      （本文件**不做**自动打开：那会弹窗干扰用户当前会话；前置缺失时报错里带命令。）
//
// 【覆盖什么（都是假 wx 测不出的）】
//   ① 同源/绝对地址正常路径：`status` / `headers` 真的透传到门面（此前被丢弃）；
//   ② ★`params` 真的拼进了 URL（服务端回显 query）——假 wx 没法证明"参数真的发出去了"；
//   ③ `responseType: 'arraybuffer'` 回来的是**真裸字节**（不是文本）；
//   ④ 真容器 timeout **确实生效**（实测 `errMsg = "request:fail timeout"` ⇒ 我们 `/timeout/i`
//      的判定真的命中，不是拍脑袋编的 errMsg），且错误码归一为 `fetch.timeout`；
//   ⑤ 四个 S3 语义在真容器里明确 `fetch.unsupported`（不因为真有 `wx.request` 就静默走下去）。
//
// 【★探针服务必须在**独立进程**（真跑抓出）】
//   driver 调 wechatide 走 `spawnSync` ⇒ **阻塞测试进程的事件循环**。服务若同进程，
//   请求期间服务端不会回包：正常路径用例在 evaluate 里挂到 tool 超时，而 timeout/unsupported
//   用例反而"通过"（它们不等服务端）——**假绿**。故服务落在
//   `tests/fixtures/mp-fetch-probe-server.mjs`（子进程），父进程读管道等它上报 `READY <port>`。
//
// 【诚实边界】
//   ① 不测并发上限（wx.request 默认 10）与真网络时延分布；
//   ② 只测 `text` / `arraybuffer` 两种 responseType（`json`/`blob` 在小程序侧映射为 text）；
//   ③ 不测取消——`config.signal` 在 MP 如实 unsupported（由 ⑤ 覆盖）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { createDriver, createWxideMini } from '@proteus-vue/test-core/driver'

const WXIDE_CLI =
  process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH || 'showcase/dist/mp-weixin'
const CLIENT = process.env.PROTEUS_WXIDE_CLIENT || 'zed'
const ENABLED = process.env.PROTEUS_MP_E2E_WXIDE === '1'

/**
 * 起**独立进程**探针服务；等它通过 stdout 主动上报 `READY <port>`（零轮询）。
 * 超时兜底只为"子进程没起来"时报可读错误，不做等待语义。
 */
function startProbeServer(): Promise<{ base: string; proc: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'mp-fetch-probe-server.mjs')], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let buf = ''
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString('utf8')
      const m = /READY (\d+)/.exec(buf)
      if (m) {
        proc.stdout?.off('data', onData)
        resolve({ base: `http://127.0.0.1:${m[1]}`, proc })
      }
    }
    proc.stdout?.on('data', onData)
    proc.once('error', (e) => reject(new Error(`[e2e-mp] 探针服务启动失败：${String(e)}`)))
    proc.once('exit', (code) => reject(new Error(`[e2e-mp] 探针服务提前退出（code=${code}）`)))
  })
}

/**
 * 生成 evaluate 探针：**走页面实例上的 `cap.useFetch` 门面**。
 *
 * ★为什么不引用外部变量：`automation_evaluate` 只下发**裸函数源码**，闭包拿不到外层绑定
 *   ⇒ URL / config 用 JSON.stringify 烘焙进函数字面量。
 * ★探针返回值里绝不使用 `result` 字段名——driver 的 extractValue 会按 `result` 解包。
 */
function probe(expr: string): string {
  return `function(){
    var ps = getCurrentPages()
    var p = ps[ps.length - 1]
    var cap = p && p.cap
    if (!cap || typeof cap.useFetch !== 'function') return { missing: true, route: p && p.route }
    function norm(r) {
      if (r && r.ok === true) {
        var d = r.data
        var out = { ok: true, status: r.status, headers: r.headers || {}, dataKind: Object.prototype.toString.call(d) }
        if (d && typeof ArrayBuffer !== 'undefined' && (d instanceof ArrayBuffer || d instanceof Uint8Array)) {
          var u8 = d instanceof Uint8Array ? d : new Uint8Array(d)
          out.bytes = { len: u8.length, first: Array.prototype.slice.call(u8, 0, 8) }
        } else {
          out.data = d
        }
        return out
      }
      return { ok: false, code: r && r.error && r.error.code, message: r && r.error && r.error.message }
    }
    return Promise.resolve(${expr}).then(norm)
  }`
}

type ProbeOut =
  | {
      ok: true
      status: number
      headers: Record<string, string>
      dataKind: string
      data?: unknown
      bytes?: { len: number; first: number[] }
    }
  | { ok: false; code?: string; message?: string }
  | { missing: true; route?: string }

describe.skipIf(!ENABLED)('★#1130 MP 真容器 · useFetch 门面行为', () => {
  let server: ChildProcess
  let base = ''
  let driver: ReturnType<typeof createDriver>

  beforeAll(async () => {
    const started = await startProbeServer()
    server = started.proc
    base = started.base
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: CLIENT })
    driver = createDriver({ platform: 'mp', mini })

    // ★★就绪探测（有界、不 sleep）：IDE 刚打开项目或在重编译时，automator 会回
    //   「cant find runtimeid by projectpath」/「timeout waiting for automator response」——
    //   那是**准备期**，不是前置缺失。用 `currentPage` 作探针：能读到页面 ⇒ 容器就绪。
    //   ★上限 6 次：真正的"项目没打开"在这里会全部失败，最终按下方错误提示给出命令。
    let ready = false
    for (let i = 0; i < 6 && !ready; i++) {
      try {
        const cur = await mini.currentPage()
        ready = Boolean(cur && cur.path)
      } catch {
        /* 准备期：继续探测（每次调用本身有 tool 侧超时，不是盲等） */
      }
    }
    if (!ready) {
      throw new Error(
        `[e2e-mp] 真容器不可用（就绪探测 6 次均失败）\n` +
          `★常见原因①：项目没在开发者工具里打开过（cant find runtimeid by projectpath）。先执行：\n` +
          `  wechatide -c ${CLIENT} open_project_window --project ${PROJECT}\n` +
          `★常见原因②：IDE 正在重编译（刷新后常见）——等模拟器画面出来后重跑本文件。`,
      )
    }
    try {
      await driver.reLaunch('/subpackages/capabilities/pages/fetch')
      await driver.waitFor(800)
    } catch (e) {
      throw new Error(`[e2e-mp] 进入 fetch 页失败：${e instanceof Error ? e.message : String(e)}`, { cause: e })
    }
  }, 180_000)

  afterAll(() => {
    // ★只关我们自己起的子进程（不动用户的 IDE / 项目窗口）
    if (server && !server.killed) server.kill('SIGTERM')
  })

  /** 调门面取结果（探针串行下发；页面在 beforeAll 已落到 fetch 页）。 */
  async function callFetch(expr: string): Promise<ProbeOut> {
    return (await driver.evaluate(probe(expr) as unknown as () => unknown)) as ProbeOut
  }

  it('① 正常路径：status / headers / JSON 自动解析', async () => {
    const res = await callFetch(`cap.useFetch(${JSON.stringify(`${base}/echo`)}, { params: { t: '7' } })`)
    expect(res).toMatchObject({ ok: true, status: 200 })
    const ok = res as Extract<ProbeOut, { ok: true }>
    // ★headers 透传（此前 FetchResult 只有 data）
    expect(String(ok.headers['x-probe'] ?? ok.headers['X-Probe'] ?? '')).toBe('mp-true')
    // ★data 是解析后的对象（不是字符串）
    expect(ok.dataKind).toBe('[object Object]')
    expect(ok.data).toMatchObject({ path: '/echo' })
  }, 60_000)

  it('② ★params 真的拼进了 URL（服务端回显 query）', async () => {
    const res = await callFetch(`cap.useFetch(${JSON.stringify(`${base}/echo`)}, { params: { a: '1', b: '两个' } })`)
    expect(res).toMatchObject({ ok: true, status: 200 })
    const ok = res as Extract<ProbeOut, { ok: true }>
    const echoed = ok.data as { query?: Record<string, string>; search?: string }
    // ★这条在真容器抓过真缺陷：mpRequest 曾整段丢弃 config.params（Web 腿用了 encodedUrl）
    expect(echoed.query, `服务端没收到 query（search=${echoed.search}）`).toMatchObject({ a: '1', b: '两个' })
  }, 60_000)

  it('③ responseType=arraybuffer ⇒ 裸字节（真 ArrayBuffer/Uint8Array，非文本）', async () => {
    const res = await callFetch(`cap.useFetch(${JSON.stringify(`${base}/bin`)}, { responseType: 'arraybuffer' })`)
    expect(res).toMatchObject({ ok: true, status: 200 })
    const ok = res as Extract<ProbeOut, { ok: true }>
    expect(ok.bytes, `★没拿到字节（dataKind=${ok.dataKind}）`).toMatchObject({ len: 4, first: [1, 2, 3, 250] })
  }, 60_000)

  it('④ 真容器 timeout 生效且错误码归一为 fetch.timeout（服务端 3000ms，客户端 1200ms）', async () => {
    const t0 = Date.now()
    const res = await callFetch(`cap.useFetch(${JSON.stringify(`${base}/slow`)}, { timeout: 1200 })`)
    const elapsed = Date.now() - t0
    expect(res, `超时没触发（实得 ${JSON.stringify(res)}，耗时 ${elapsed}ms）`).toMatchObject({
      ok: false,
      code: 'fetch.timeout',
    })
    // ★不仅要码对，还要**真的早于服务端响应**返回（否则可能是服务端先回）
    expect(elapsed, `★超时判定耗时 ${elapsed}ms 未早于服务端 3000ms`).toBeLessThan(2900)
  }, 60_000)

  it('⑤ 四个 S3 语义在 MP 真容器里明确 unsupported（不静默忽略）', async () => {
    const cases: Array<{ name: string; expr: string }> = [
      { name: 'savePath', expr: `cap.useFetch(${JSON.stringify(`${base}/echo`)}, { savePath: 'download/x' })` },
      { name: 'onChunk', expr: `cap.useFetch(${JSON.stringify(`${base}/echo`)}, { onChunk: function () {} })` },
      { name: 'upload', expr: `cap.useFetch(${JSON.stringify(`${base}/echo`)}, { upload: { path: 'a.txt' } })` },
      { name: 'signal', expr: `cap.useFetch(${JSON.stringify(`${base}/echo`)}, { signal: { aborted: false } })` },
    ]
    for (const c of cases) {
      const res = await callFetch(c.expr)
      expect(res, `${c.name} 应被拒绝（实得 ${JSON.stringify(res)}）`).toMatchObject({
        ok: false,
        code: 'fetch.unsupported',
      })
    }
  }, 120_000)
})
