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

  it('Android：在途表 + 四处请求都注册 + cancel 真 disconnect', () => {
    const s = read(ANDROID_HTTP)
    expect(s, '缺在途请求表').toMatch(/ConcurrentHashMap<String,\s*\n?\s*java\.util\.concurrent\.atomic\.AtomicReference<HttpURLConnection>>/)
    // ★四个请求路径（整包/流式/落盘/上传）都要注册，少一个就有一条腿取消不了
    const regs = (s.match(/registerRequest\(f\.reqId, conn\)/g) ?? []).length
    expect(regs, `★只有 ${regs} 个请求路径注册了取消（应有 4 个：整包/流式/落盘/上传）`).toBe(4)
    expect(s, '★cancel 未真 disconnect（只是从表里删）').toMatch(/conn\.disconnect\(\)[\s\S]{0,120}http\.cancel/)
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

  it('★探针必须验证"后续块停止"与"宿主命中"（只验 reject 太弱）', () => {
    const s = read('hosts/shared/bridge/entry-superapp-probes.ts')
    expect(s, '缺 appCancelProbe').toMatch(/export function appCancelProbe/)
    expect(s, '★未验证后续块停止').toMatch(/chunks_stopped/)
    expect(s, '未读宿主取消记账').toMatch(/http\.cancelStats/)
  })
})
