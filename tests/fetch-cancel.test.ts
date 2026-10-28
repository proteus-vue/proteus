// tests/fetch-cancel.test.ts
// ★★★#1121：**取消通道**（S3 回收维度）的契约判据
//
// 【要证明什么（四件）】
//   ① **JS 侧立即 reject** 且错误码是 `fetch.aborted`（与 `fetch.failed` 区分——业务能分辨"我取消了"）；
//   ② **取消真的打到宿主**（发 `http.cancel` 帧）——只 reject 不改宿主 = 后台还在跑，是最坏形态；
//   ③ **pending 表清理**（不泄漏）+ 已结算的调用取消是 no-op（**竞态是正常的**，不报错）；
//   ④ 两端宿主都有在途请求表 + `http.cancel` 真的会中止。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  invokeHostAsync,
  invokeHostStream,
  installHostResolveBridge,
  pendingHostCallCount,
  createAbortController,
  HOST_INVOKE_BYTES_KEY,
  HOST_RESOLVE_BYTES_KEY,
  HOST_INVOKE_KEY,
} from '../packages/api/src/capability-invoke'
import { decodeInvokeFrame, encodeResolveFrame } from '../packages/api/src/invoke-wire'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')
const g = globalThis as Record<string, unknown>

interface Captured { method: string; body: string }

/** 宿主桩：记录收到的帧，并按需返回受理帧（`undefined` = 已受理待回推） */
function installShell(): Captured[] {
  const seen: Captured[] = []
  g[HOST_INVOKE_BYTES_KEY] = (frame: Uint8Array): Uint8Array | undefined => {
    const f = decodeInvokeFrame(frame)
    seen.push({ method: f.method, body: new TextDecoder().decode(f.body) })
    if (f.method === 'http.cancel') return encodeResolveFrame({ reqId: f.reqId, ok: true, body: new TextEncoder().encode('{"hit":true}') })
    return undefined // 原请求：已受理
  }
  return seen
}

beforeEach(() => { installHostResolveBridge() })
afterEach(() => {
  delete g[HOST_INVOKE_BYTES_KEY]
  delete g[HOST_INVOKE_KEY]
  delete g['proteusHost']
})

describe('★#1121 取消 · JS 侧行为', () => {
  it('★abort 立即 reject 且码为 fetch.aborted', async () => {
    installShell()
    const c = createAbortController()
    const p = invokeHostAsync('http.request', { url: 'https://x.cn/s' }, 30000, { signal: c.signal })
    c.abort()
    await expect(p).rejects.toThrow(/fetch\.aborted/)
  })

  it('★abort 必须发 http.cancel 帧（否则后台还在跑）', async () => {
    const seen = installShell()
    const c = createAbortController()
    const p = invokeHostAsync('http.request', { url: 'https://x.cn/s' }, 30000, { signal: c.signal })
    c.abort()
    await expect(p).rejects.toThrow()
    const cancel = seen.find((s) => s.method === 'http.cancel')
    expect(cancel, '★未发 http.cancel ⇒ 宿主不知道要停').toBeTruthy()
    // 帧 body 里要带原始 reqId（宿主按它查在途表）
    expect(cancel!.body).toMatch(/"reqId":"app-async-\d+"/)
  })

  it('取消后 pending 表归零（不泄漏）', async () => {
    installShell()
    const c = createAbortController()
    const p = invokeHostAsync('http.request', { url: 'https://x.cn/s' }, 30000, { signal: c.signal })
    expect(pendingHostCallCount()).toBe(1)
    c.abort()
    await expect(p).rejects.toThrow()
    expect(pendingHostCallCount(), '★取消后 pending 未清理').toBe(0)
  })

  it('★已结算的调用再取消 = no-op（竞态正常，不报错也不重复 reject）', async () => {
    installShell()
    const c = createAbortController()
    // 先结算（回推最终帧）——★reqId 是**递增**的，必须从实际派发的帧里取
    const seen: string[] = []
    const orig = g[HOST_INVOKE_BYTES_KEY] as (f: Uint8Array) => Uint8Array | undefined
    let capturedReqId = ''
    g[HOST_INVOKE_BYTES_KEY] = (frame: Uint8Array): Uint8Array | undefined => {
      const f = decodeInvokeFrame(frame)
      if (f.method === 'http.request') capturedReqId = f.reqId
      return orig(frame)
    }
    const p = invokeHostAsync('http.request', { url: 'https://x.cn/s' }, 30000, { signal: c.signal })
    const reqId = capturedReqId
    expect(reqId, '未捕获到请求帧').toMatch(/^app-async-/)
    void seen
    ;(g[HOST_RESOLVE_BYTES_KEY] as (f: Uint8Array) => void)(
      encodeResolveFrame({ reqId, ok: true, status: 200, body: new Uint8Array([1]) }),
    )
    await expect(p).resolves.toBeTruthy()
    expect(() => c.abort(), '已结算后取消不该抛').not.toThrow()
    expect(pendingHostCallCount()).toBe(0)
  })

  it('abort 已发生过再传 signal ⇒ 立刻 reject（不发起请求也能报）', async () => {
    installShell()
    const c = createAbortController()
    c.abort()
    await expect(
      invokeHostAsync('http.request', { url: 'https://x.cn/s' }, 30000, { signal: c.signal }),
    ).rejects.toThrow(/fetch\.aborted/)
  })

  it('流式腿同样可取消（流式可能跑很久）', async () => {
    const seen = installShell()
    const c = createAbortController()
    const p = invokeHostStream('http.request', { url: 'https://x.cn/s' }, () => {}, 30000, c.signal)
    c.abort()
    await expect(p).rejects.toThrow(/fetch\.aborted/)
    expect(seen.some((s) => s.method === 'http.cancel'), '★流式取消未通知宿主').toBe(true)
  })
})

describe('★#1121 取消 · AbortController 自实现（App 引擎没有）', () => {
  it('基本语义：aborted / onabort 单次触发', () => {
    const c = createAbortController()
    let n = 0
    c.signal.onabort = () => { n++ }
    expect(c.signal.aborted).toBe(false)
    c.abort()
    expect(c.signal.aborted).toBe(true)
    expect(n).toBe(1)
    c.abort()   // 幂等
    expect(n).toBe(1)
  })
})

describe('★#1121 取消 · 两端宿主', () => {
  const ANDROID_HTTP = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpCapability.java'
  const IOS_HTTP = 'hosts/ios/ProteusHost/runtime/http-capability.swift'

  it('Android：在途表 + 四处请求都注册 + cancel 真中止调用', () => {
    const s = read(ANDROID_HTTP)
    // ★★★#1160 换栈后口径：句柄由 `HttpURLConnection` 改为 `okhttp3.Call`。
    //   性质不变（按 reqId 找到在途请求并**真中止**），所以断言锁"在途表 + 真中止调用点"，
    //   不锁某个具体传输类型（那是实现细节，随栈走）。
    expect(s, '缺在途请求表').toMatch(/ConcurrentHashMap<String,\s*\n?\s*java\.util\.concurrent\.atomic\.AtomicReference<okhttp3\.Call>>/)
    // ★四个请求路径（整包/流式/落盘/上传）都要注册，少一个就有一条腿取消不了
    const regs = (s.match(/registerRequest\(f\.reqId, call\)/g) ?? []).length
    expect(regs, `★只有 ${regs} 个请求路径注册了取消（应有 4 个：整包/流式/落盘/上传）`).toBe(4)
    // ★判据锁**调用点**（不是符号名）：`call.cancel()` 必须在 cancel() 方法里真被调用
    expect(s, '★cancel 未真中止底层调用（只是从表里删）').toMatch(/call\.cancel\(\)[\s\S]{0,200}http\.cancel/)
  })

  it('Android：结算时从在途表注销（防泄漏 + 防取消错杀已完成的）', () => {
    const s = read(ANDROID_HTTP)
    const unregs = (s.match(/unregisterRequest\(f\.reqId\)/g) ?? []).length
    expect(unregs, '★注销点少于注册点（在途表会泄漏）').toBeGreaterThanOrEqual(4)
  })

  it('iOS：在途表 + 四处注册 + cancel 真 cancel()', () => {
    const s = read(IOS_HTTP)
    expect(s, '缺在途请求表').toMatch(/private static var inflight: \[String: URLSessionTask\]/)
    const regs = (s.match(/registerInflight\(reqId, task\)/g) ?? []).length
    expect(regs, `★只有 ${regs} 个请求路径注册了取消（应有 4 个）`).toBe(4)
    expect(s, '★cancel 未真调 task.cancel()').toMatch(/t\.cancel\(\)/)
    expect(s, '结算时未注销在途表').toMatch(/unregisterInflight\(reqId\)/)
  })

  it('两端都提供 http.cancel 能力方法（否则 JS 发的帧没人接）', () => {
    expect(read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HostCapabilities.java'), 'Android').toMatch(/case "http\.cancel":/)
    expect(read('hosts/ios/ProteusHost/runtime/host-capabilities.swift'), 'iOS').toMatch(/case "http\.cancel":/)
  })

  /**
   * ★★★#1165：**鸿蒙的取消是 no-op**——这是「调度模型差异」，不是"少写一个方法"。
   *
   * 【实证链（三层，全部可从源码复核）】
   *   ① 鸿蒙 `handle()` 在 napi 调用内**同步完成往返**（一次性 VM：`proteus_http.h` 头注 +
   *      `HMS_Rcp_Fetch` + 有界 `wait_for`，napi 返回时 VM 已销毁 ⇒ 异步回推无接收方）；
   *   ② JS 侧 `invokeHostAsyncBytes` 是 `out = fn(frame)` **同步取结果**
   *      （`capability-invoke.ts`：`attachAbort(...)` 之后**第 4 行**就同步调用）；
   *   ③ ⇒ 请求进行中 JS 线程**被占**，`signal.onabort` 没有执行机会；App 精简引擎也无
   *      `setTimeout` 可以"稍后取消"。
   *   ⇒ **准确结论**：鸿蒙上 `abort()` 是 no-op（**连 JS 侧 reject 都不会发生**），
   *     而**不存在"后台还在下载"**——根本没有后台，请求就在调用线程里跑完。
   *   ⇒ 鸿蒙上限时的手段是 **`timeout`**（宿主有界等待 + 超时主动 cancel）。
   *
   * ★为什么这条必须有判据：#1163 曾写成"abort 只 reject 本地、宿主传输不停"（错）。
   *   那个写法会让业务以为"取消至少能兜住"，于是不去设 `timeout`——**夸大与贬低都是假信息**。
   */
  it('★★★鸿蒙：取消是 no-op（同步 napi 占满 JS 线程）——文档必须如实写，且这是模型限制不是缺方法', () => {
    const md = read('website/content/capabilities/fetch.md')
    const row = /^\| 鸿蒙 \| ([^|]+) \| (.+) \|$/m.exec(md)
    expect(row, '找不到 fetch 页鸿蒙行').toBeTruthy()
    expect(row![2], '★鸿蒙行必须写明 abort() 是 no-op（不能只写"未实现 http.cancel"）').toMatch(/abort\(\)[^。]*no-op/)
    expect(row![2], '★必须指出正确替代：用 timeout 限时（否则业务没有可用的兜底手段）').toMatch(/timeout/)
    // ★不得再出现#1163 的错误说法（会让业务误以为本地会 reject）
    expect(md, '★"abort() 只 reject 本地"是错误描述（实际连 reject 都不发生）——见 #1165').not.toMatch(
      /abort\(\)\s*只\s*reject\s*本地/,
    )
  })

  it('★★★鸿蒙同步语义的结构证据：attachAbort 之后紧接同步 fn(frame)，中间无 await', () => {
    const s = read('packages/api/src/capability-invoke.ts')
    const iA = s.indexOf('attachAbort(signal, reqId, fn, timer, reject)')
    expect(iA, '找不到 attachAbort 调用点').toBeGreaterThan(0)
    const seg = s.slice(iA, iA + 600)
    // ★关键：注册取消后**同一同步段内**就发请求 ⇒ 中间没有让出事件循环的机会
    expect(seg, '★attachAbort 之后未同步调用 fn(frame)（若改成 await，本判据需重评鸿蒙语义）').toMatch(
      /attachAbort\([^)]*\)\s*\n\s*let out: Uint8Array \| undefined\s*\n\s*try \{\s*\n\s*out = fn\(frame\)/,
    )
  })

  /**
   * ★★★#1165 → #1344 B-2c **翻转**：鸿蒙 abort 不再是 no-op（**会话式 VM 下真取消已成立**）。
   *
   * 【旧判据（#1165）说的是什么，为什么现在不成立】
   *   当时宿主是**一次性 VM + 同步 napi**：请求在调用线程里同步跑完 ⇒ 期间 JS 没有执行机会
   *   ⇒ `abort()` 连本地 reject 都不会发生。证据曾是「8s 慢请求完整返回 + `cancelCalled=false`」。
   *
   * 【#1344 B-2c 推翻了它的前提】
   *   会话式 VM 让 `http.request` 变成**异步**（宿主立即回 `pending`，响应由 tick 回推）⇒
   *   JS 线程在请求期间是**空闲的** ⇒ `abort()` 有执行机会，且能真的打到宿主：
   *   真机判据（`hosts/harmony/run-session-cancel-probe.sh`，2026-10-28 KLE-AL00U）：
   *     `SESSION_CANCEL_DONE ok=true ... hostCancelCalls=1 noInflight=0 unsupported=0 stage=ok`
   *     `settle_ms_after_abort=2`（慢响应 10s，取消后 2ms 结束）
   *   ⇒ 现在断言的是「会话模式下取消**真的发生**」，而不是「不发生」。
   *
   * 【为什么改成读会话判据证据，不再读 http-probe.json】
   *   ① `http-probe.json` 走的是**一次性 VM** 的 `superapp-http` 场景 —— 那条路径的 abort 确实
   *      仍是 no-op（生产形态未变），但它**不能**用来断言"鸿蒙不支持取消"（会话模式已支持）；
   *   ② 原判据把"慢流完整返回"当唯一证据，而那个读数会被**任何**能力探针覆盖（本轮还发现
   *      `run-http-probe.sh --cap-method=*` 覆盖同名文件的装置缺陷，已修为独立文件名）；
   *   ③ 真正的能力判据在 `vm-session-cancel.json`（会话场景专用文件，无覆盖风险）。
   *
   * ★诚实边界（不变）：**一次性 VM 生产路径**的 abort 仍是 no-op（`proteus_http_stubs.h`
   *   的 `harmony-sync-napi` 分支，判据 `harmony-http-gaps.test.ts` 守着）。
   *   取消能力只在**会话模式**成立 —— 两面都必须如实登记，不能只报好消息。
   */
  it('★★★鸿蒙真机证据：会话模式下 abort **真的取消**（hostCancelCalls=1 + 早结算）', () => {
    const p = 'hosts/harmony/results/vm-session-cancel.json'
    if (!fs.existsSync(path.join(ROOT, p))) {
      // 证据文件缺失不判红（干净 clone 没跑过真机）——但显式说明，不静默通过
      expect(true, `⚠ 缺会话取消真机证据 ${p}（跑 bash hosts/harmony/run-session-cancel-probe.sh）`).toBe(true)
      return
    }
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')) as {
      ok?: boolean
      hostCancelCalls?: number
      hostCancelNoInflight?: number
      hostCancelUnsupported?: number
      cancelStage?: string
      jsTicks?: number
      probeResult?: string
    }
    let probe: { error_code?: string; stopped_early?: boolean; settle_ms_after_abort?: number } = {}
    try {
      probe = JSON.parse(String(d.probeResult ?? '{}'))
    } catch {
      /* 下面逐条断言会给出具体失败点 */
    }
    expect(probe.error_code, '★业务拿到的应是 fetch.aborted').toBe('fetch.aborted')
    expect(probe.stopped_early, '★abort 后应立即结算（不是等满慢响应/超时）').toBe(true)
    // ★核心（M7 破坏性验证的产物）：JS 侧读数**证明不了**宿主真的调了 cancel
    //   （JS 是先本地 reject）⇒ 必须读宿主记账。
    expect(Number(d.hostCancelCalls), '★★宿主必须真调 HMS_Rcp_CancelRequest（calls>0）').toBeGreaterThan(0)
    expect(Number(d.hostCancelNoInflight), '★reqId 应在在途表里命中（noInflight=0）').toBe(0)
    expect(Number(d.hostCancelUnsupported), '★RCP cancel 符号应可用（unsupported=0）').toBe(0)
    expect(String(d.cancelStage), '★归因应为 ok（非某层断链）').toBe('ok')
    expect(Number(d.jsTicks), '★会话态应保留（jsTicks>1）').toBeGreaterThan(1)
  })

  it('★探针必须验证"后续块停止"与"宿主命中"（只验 reject 太弱）', () => {
    const s = read('hosts/shared/bridge/entry-superapp-probes.ts')
    expect(s, '缺 appCancelProbe').toMatch(/export function appCancelProbe/)
    expect(s, '★未验证后续块停止').toMatch(/chunks_stopped/)
    expect(s, '未读宿主取消记账').toMatch(/http\.cancelStats/)
  })
})
