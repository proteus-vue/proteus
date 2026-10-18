// tests/capability-invoke-timer.test.ts
// ★★异步能力通道的**超时形态**契约（T-app-fetch · 决策 #1063）。
//
// 【要证明什么（真机崩溃暴露的那条）】`setTimeout` **不是** ECMAScript 标准，而 App 三端 JS 引擎
//   （Android QuickJS · iOS JavaScriptCore · 鸿蒙 JSVM）**都没有**它。此前 `capability-invoke.ts`
//   在 Promise 构造器里**无条件** `setTimeout(...)` ⇒ 真机上 `useFetch` 直接
//   `ReferenceError: setTimeout is not defined`（且在 Promise 构造器内抛出 ⇒ 立刻 reject，
//   业务只能看到一条莫名其妙的失败）。
//   ⇒ 修成 `armHostCallTimeout`：有定时器用 JS 超时；没有则**降级为 host-only**
//   （帧的 meta 已带 `timeoutMs`，宿主侧本来就有 connect/read 超时）并**记录形态**（不静默）。
//
// 【判据】② 是本轮核心：**把全局 setTimeout 摘掉**（模拟 App 引擎），派发/回推必须仍然跑通，
//   且 `hostCallTimerMode() === 'host-only'`。这条能直抓"又有人写回裸 setTimeout"。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  invokeHostAsync,
  installHostResolveBridge,
  hostCallTimerMode,
  lastInvokeWire,
  pendingHostCallCount,
  HOST_INVOKE_BYTES_KEY,
  HOST_RESOLVE_BYTES_KEY,
  HOST_INVOKE_KEY,
  HOST_RESOLVE_KEY,
} from '../packages/api/src/capability-invoke'
import { decodeInvokeFrame, encodeResolveFrame } from '../packages/api/src/invoke-wire'

type AnyGlobal = Record<string, unknown>
const g = globalThis as unknown as AnyGlobal

let savedSetTimeout: unknown
let savedClearTimeout: unknown
let hadSetTimeout = false
let hadClearTimeout = false

/** 宿主桩：同步返回「已受理」帧，记录真实 reqId（全局自增，不能硬编码）。 */
function installPendingShell(seen: { reqId: string }): void {
  g[HOST_INVOKE_BYTES_KEY] = (frame: Uint8Array): Uint8Array => {
    seen.reqId = decodeInvokeFrame(frame).reqId
    return encodeResolveFrame({ reqId: seen.reqId, ok: true, pending: true })
  }
}

/** 宿主异步回推（壳完成后调用）——走**已安装**的那个入口。 */
function pushResolveBytes(frame: Uint8Array): void {
  const fn = g[HOST_RESOLVE_BYTES_KEY]
  if (typeof fn !== 'function') throw new Error('回推入口未安装')
  ;(fn as (f: Uint8Array) => void)(frame)
}

/** 摘掉全局定时器（模拟 App 引擎）。 */
function removeTimers(): void {
  delete (g as { setTimeout?: unknown }).setTimeout
  delete (g as { clearTimeout?: unknown }).clearTimeout
}

beforeEach(() => {
  hadSetTimeout = 'setTimeout' in g
  hadClearTimeout = 'clearTimeout' in g
  savedSetTimeout = g.setTimeout
  savedClearTimeout = g.clearTimeout
  delete g.proteusHost
  delete g[HOST_INVOKE_KEY]
  delete g[HOST_INVOKE_BYTES_KEY]
  delete g[HOST_RESOLVE_KEY]
  delete g[HOST_RESOLVE_BYTES_KEY]
  // ★先装回推桥（install 只在"还不是函数"时装 —— 顺序反了会把真入口挡掉）
  installHostResolveBridge()
})

afterEach(() => {
  if (hadSetTimeout) g.setTimeout = savedSetTimeout
  else delete g.setTimeout
  if (hadClearTimeout) g.clearTimeout = savedClearTimeout
  else delete g.clearTimeout
  delete g.proteusHost
  delete g[HOST_INVOKE_KEY]
  delete g[HOST_INVOKE_BYTES_KEY]
  delete g[HOST_RESOLVE_KEY]
  delete g[HOST_RESOLVE_BYTES_KEY]
})

describe('① 有定时器（Node/浏览器形态）', () => {
  it('字节腿 pending → 回推结算，timerMode = js-timer', async () => {
    const seen = { reqId: '' }
    installPendingShell(seen)
    const p = invokeHostAsync('http.request', { url: 'https://x.cn/' }, 500)
    expect(seen.reqId).not.toBe('')
    pushResolveBytes(
      encodeResolveFrame({ reqId: seen.reqId, ok: true, status: 200, body: new TextEncoder().encode('hi') }),
    )
    const out = (await p) as { data: unknown; status: number }
    expect(out.status).toBe(200)
    expect(out.data).toBe('hi')
    expect(lastInvokeWire()).toBe('bytes')
    expect(hostCallTimerMode()).toBe('js-timer')
    expect(pendingHostCallCount()).toBe(0)
  })

  it('宿主一直 pending ⇒ 到点 reject（超时真的会触发）', async () => {
    const seen = { reqId: '' }
    installPendingShell(seen)
    await expect(invokeHostAsync('http.request', { url: 'https://x.cn/' }, 30)).rejects.toThrow(/超时/)
    expect(pendingHostCallCount()).toBe(0)
  })
})

describe('② ★★App 引擎形态：没有 setTimeout 也必须跑通（host-only 降级）', () => {
  it('摘掉 setTimeout/clearTimeout ⇒ 派发不抛、回推可结算、timerMode = host-only', async () => {
    removeTimers()
    const seen = { reqId: '' }
    installPendingShell(seen)
    // 派发本身必须**同步**成功返回 Promise（构造器内不得抛 ReferenceError）
    const p = invokeHostAsync('http.request', { url: 'https://x.cn/' }, 50)
    expect(p).toBeInstanceOf(Promise)
    expect(seen.reqId).not.toBe('')

    pushResolveBytes(encodeResolveFrame({ reqId: seen.reqId, ok: true, status: 204, body: new Uint8Array(0) }))
    const out = (await p) as { status: number }
    expect(out.status).toBe(204)
    expect(hostCallTimerMode()).toBe('host-only')
    expect(pendingHostCallCount()).toBe(0)
  })
})

describe('③ JSON 腿同样走降级（宿主只有 JSON 入口时）', () => {
  it('无字节入口 + 无 setTimeout ⇒ host-only 且能结算', async () => {
    removeTimers()
    let seen = ''
    g[HOST_INVOKE_KEY] = (_m: string, a: string): string => {
      seen = (JSON.parse(a) as { __reqId?: string }).__reqId ?? ''
      return JSON.stringify({ ok: true, data: { pending: true } })
    }
    const p = invokeHostAsync('http.request', { url: 'https://x.cn/' }, 50)
    const resolve = g[HOST_RESOLVE_KEY] as (id: string, json: string) => void
    resolve(seen, JSON.stringify({ ok: true, data: { status: 200 } }))
    await expect(p).resolves.toEqual({ status: 200 })
    expect(lastInvokeWire()).toBe('json')
    expect(hostCallTimerMode()).toBe('host-only')
  })
})
