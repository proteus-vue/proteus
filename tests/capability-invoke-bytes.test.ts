// tests/capability-invoke-bytes.test.ts
// ★★invoke **二进制腿**的端到端契约（决策 #903 / T-app-wire）。
//
// 【要证明什么（用户 2026-10-13 指令：「跨语言数据通道不要用 JSON 字符串…走纯二进制方向」）】
//   ① **择优降级**：宿主实现 `invokeBytes` ⇒ 派发走 `PINV` 帧（`lastInvokeWire() === 'bytes'`）；
//      未实现 ⇒ **回退** JSON 通道（`'json'`）——老壳零回归，且降级**不静默**；
//   ② **同步回执**：宿主当场回 `PRSP` 帧 ⇒ 当场结算（与 JSON 腿同语义）；
//   ③ **异步回推**：宿主回 `pending` ⇒ 挂起；`__proteusHostResolveBytes(frame)` 回推后结算，
//      且 pending 表**无泄漏**；
//   ④ **大载荷走裸字节**：`responseType: 'arraybuffer'` ⇒ `data` 是**字节**（不经文本解码）；
//   ⑤ **坏帧不静默**：回推帧解码失败 ⇒ 丢弃 + 记诊断（`lastResolveDecodeErrorInfo()`），不抛进业务。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { utf8Encode, utf8Decode } from '@proteus-vue/shared'
import {
  invokeHost,
  invokeHostAsync,
  installHostResolveBridge,
  pendingHostCallCount,
  lastInvokeWire,
  lastResolveDecodeErrorInfo,
  HOST_INVOKE_BYTES_KEY,
  HOST_RESOLVE_BYTES_KEY,
  HOST_INVOKE_KEY,
} from '../packages/api/src/capability-invoke'
import { decodeInvokeFrame, encodeResolveFrame, type ResolveFrame } from '../packages/api/src/invoke-wire'

const g = globalThis as Record<string, unknown>

/** 宿主桩：实现二进制入口（返回 `PRSP` 帧，或 undefined = 已受理待回推） */
function installBytesShell(handler: (frame: Uint8Array) => Uint8Array | undefined): void {
  g[HOST_INVOKE_BYTES_KEY] = (frame: Uint8Array): Uint8Array | undefined => handler(frame)
}

/** 宿主桩：异步回推（壳完成后调用） */
function resolveBytesFromHost(frame: Uint8Array): void {
  ;(g[HOST_RESOLVE_BYTES_KEY] as (f: Uint8Array) => void)(frame)
}

function okFrame(reqId: string, body: Uint8Array, extra: Partial<ResolveFrame> = {}): Uint8Array {
  return encodeResolveFrame({ reqId, ok: true, status: 200, body, ...extra })
}

beforeEach(() => {
  installHostResolveBridge()
})

afterEach(() => {
  delete g[HOST_INVOKE_BYTES_KEY]
  delete g[HOST_INVOKE_KEY]
  delete g['proteusHost']
})

/* ────────────────────────── ① 择优降级 ────────────────────────── */

describe('① 择优降级（字节腿优先，JSON 腿兜底）', () => {
  it('宿主实现 invokeBytes ⇒ 走 PINV 帧；meta 字段被正确提取（含方法名大写归一）', async () => {
    let seen: ReturnType<typeof decodeInvokeFrame> | null = null
    installBytesShell((frame) => {
      seen = decodeInvokeFrame(frame)
      return okFrame(seen.reqId, utf8Encode('{"a":1}'))
    })
    const r = await invokeHostAsync('http.request', {
      url: 'https://api.example.com/x',
      method: 'get', // ★小写 ⇒ 线格式归一为大写
      headers: { 'x-trace': '1' },
      params: { page: 2 },
      timeout: 3000, // ★`timeout` 别名 ⇒ 线格式 `timeoutMs`
      responseType: 'json',
    })
    expect(lastInvokeWire()).toBe('bytes')
    const f = seen as unknown as ReturnType<typeof decodeInvokeFrame>
    expect(f.method).toBe('http.request')
    expect(f.meta.url).toBe('https://api.example.com/x')
    expect(f.meta.method).toBe('GET')
    expect(f.meta.headers).toEqual({ 'x-trace': '1' })
    expect(f.meta.params).toEqual({ page: '2' }) // 值统一字符串化
    expect(f.meta.timeoutMs).toBe(3000)
    expect(r).toEqual({ data: { a: 1 }, status: 200, headers: {} })
  })

  it('宿主**未**实现 invokeBytes ⇒ 回退 JSON 通道（老壳零回归，且降级可查）', async () => {
    const calls: string[] = []
    g[HOST_INVOKE_KEY] = (m: string, argsJson: string): string => {
      calls.push(`${m}|${argsJson}`)
      return JSON.stringify({ ok: true, data: { provider: 'android' } })
    }
    const r = await invokeHostAsync('host.context', {})
    expect(lastInvokeWire()).toBe('json')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('host.context')
    expect(r).toEqual({ provider: 'android' })
  })
})

/* ────────────────────────── ② 同步回执 ────────────────────────── */

describe('② 同步回执（宿主当场给结果）', () => {
  it('当场结算，不占 pending 表', async () => {
    installBytesShell((frame) => okFrame(decodeInvokeFrame(frame).reqId, utf8Encode('hello')))
    const r = await invokeHostAsync('http.request', { url: 'https://x', responseType: 'text' })
    expect(r).toEqual({ data: 'hello', status: 200, headers: {} })
    expect(pendingHostCallCount()).toBe(0)
  })

  it('★大载荷走**裸字节**：responseType=arraybuffer ⇒ data 是 Uint8Array（不经文本解码）', async () => {
    const payload = new Uint8Array(64 * 1024)
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff // 含非法 UTF-8 的任意字节
    installBytesShell((frame) => okFrame(decodeInvokeFrame(frame).reqId, payload, { headers: { 'content-type': 'image/png' } }))
    const r = (await invokeHostAsync('http.request', { url: 'https://x/i.png', responseType: 'arraybuffer' })) as {
      data: Uint8Array
    }
    expect(r.data).toBeInstanceOf(Uint8Array)
    expect(r.data.length).toBe(payload.length)
    expect(r.data[255]).toBe(255) // 逐字节无损（若走文本通道，非法 UTF-8 会解码失败）
  })

  it('中文响应体（多字节 UTF-8）→ 文本无损', async () => {
    const text = '康爱公社 · 互助保障 · 中文测试'
    installBytesShell((frame) => okFrame(decodeInvokeFrame(frame).reqId, utf8Encode(text)))
    const r = (await invokeHostAsync('http.request', { url: 'https://x', responseType: 'text' })) as { data: string }
    expect(r.data).toBe(text)
    expect(utf8Decode(utf8Encode(text))).toBe(text) // 原语自证
  })

  it('壳未实现该方法 ⇒ 抛错（与同步通道同口径）', async () => {
    installBytesShell(() => {
      throw new Error('unsupported: 未实现的原生方法：http.request')
    })
    await expect(invokeHostAsync('http.request', { url: 'https://x' })).rejects.toThrow(/unsupported/)
    expect(pendingHostCallCount()).toBe(0)
  })

  it('壳回 ok:false + missing ⇒ reject 带 `unsupported:` 前缀（桥映射 `*.unsupported`）', async () => {
    installBytesShell((frame) =>
      encodeResolveFrame({ reqId: decodeInvokeFrame(frame).reqId, ok: false, missing: true, reason: 'android 未接网络能力' }),
    )
    await expect(invokeHostAsync('http.request', { url: 'https://x' })).rejects.toThrow(/^unsupported: /)
  })
})

/* ────────────────────────── ③ 异步回推 ────────────────────────── */

describe('③ 异步回推（pending → resolveBytes）', () => {
  it('回 pending ⇒ 挂起；回推后结算；pending 表归零（无泄漏）', async () => {
    let dispatched: Uint8Array | null = null
    installBytesShell((frame) => {
      dispatched = frame
      return encodeResolveFrame({ reqId: decodeInvokeFrame(frame).reqId, ok: true, pending: true })
    })
    const p = invokeHostAsync('http.request', { url: 'https://x', responseType: 'json' })
    expect(pendingHostCallCount()).toBe(1)

    const reqId = decodeInvokeFrame(dispatched as unknown as Uint8Array).reqId
    resolveBytesFromHost(okFrame(reqId, utf8Encode('{"n":42}')))
    await expect(p).resolves.toEqual({ data: { n: 42 }, status: 200, headers: {} })
    expect(pendingHostCallCount()).toBe(0)
  })

  it('回推时壳返回 `pending` 帧则**不**结算（保持挂起，等最终帧）', async () => {
    let dispatched: Uint8Array | null = null
    installBytesShell((frame) => {
      dispatched = frame
      return undefined // 宿主返回空 ⇒ 语义等同"已受理待回推"
    })
    const p = invokeHostAsync('http.request', { url: 'https://x' })
    const reqId = decodeInvokeFrame(dispatched as unknown as Uint8Array).reqId
    resolveBytesFromHost(encodeResolveFrame({ reqId, ok: true, pending: true })) // 尚非最终结果
    expect(pendingHostCallCount()).toBe(1) // ★仍挂着（不是提前 resolve 成 undefined）
    resolveBytesFromHost(okFrame(reqId, utf8Encode('done')))
    await expect(p).resolves.toEqual({ data: 'done', status: 200, headers: {} })
  })

  it('超时 ⇒ reject，且**迟到回推是 no-op、无泄漏**', async () => {
    let dispatched: Uint8Array | null = null
    installBytesShell((frame) => {
      dispatched = frame
      return undefined
    })
    const p = invokeHostAsync('http.request', { url: 'https://x' }, 60)
    const reqId = decodeInvokeFrame(dispatched as unknown as Uint8Array).reqId
    await expect(p).rejects.toThrow(/超时/)
    expect(pendingHostCallCount()).toBe(0)
    // 迟到回推：不应抛、不应复活
    expect(() => resolveBytesFromHost(okFrame(reqId, utf8Encode('late')))).not.toThrow()
    expect(pendingHostCallCount()).toBe(0)
  })
})

/* ────────────────────────── ④ 坏帧不静默 ────────────────────────── */

describe('④ 诊断（坏帧不静默）', () => {
  it('回推帧解码失败 ⇒ 丢弃 + 记诊断（不抛进业务）', () => {
    const bad = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    expect(() => resolveBytesFromHost(bad)).not.toThrow()
    expect(lastResolveDecodeErrorInfo()).toMatch(/magic 不符/)
  })

  it('派发帧编码失败（超长字符串）⇒ reject（不静默丢件）', async () => {
    installBytesShell((frame) => okFrame(decodeInvokeFrame(frame).reqId, new Uint8Array(0)))
    const huge = 'x'.repeat(70000) // > 65535 ⇒ u16 长度前缀放不下
    await expect(invokeHostAsync('http.request', { url: `https://x/?q=${huge}` })).rejects.toThrow(/字符串过长/)
    expect(pendingHostCallCount()).toBe(0)
  })
})

/* ────────── ⑤ 全能力通道（2026-10-19：用户「能力通道也去 JSON 化」） ────────── */

describe('⑤ 同步能力也走字节腿', () => {
  it('宿主装字节桥 ⇒ invokeHost（同步）走 PINV，args 编为 JSON 字节，data 按 JSON 腿同规则取 .data', () => {
    let seen: ReturnType<typeof decodeInvokeFrame> | null = null
    installBytesShell((frame) => {
      seen = decodeInvokeFrame(frame)
      return okFrame((seen as unknown as { reqId: string }).reqId, utf8Encode('{"ok":true,"data":{"level":0.72,"charging":true}}'))
    })
    const r = invokeHost('battery.get', { probe: true })
    expect(lastInvokeWire()).toBe('bytes')
    expect(r).toEqual({ ok: true, data: { level: 0.72, charging: true } })
    const f = seen as unknown as ReturnType<typeof decodeInvokeFrame>
    expect(f.method).toBe('battery.get')
    expect(f.meta.contentType).toBe('application/json')
    expect(JSON.parse(utf8Decode(f.body ?? new Uint8Array(0)))).toEqual({ probe: true })
  })

  it('同步字节腿：宿主回 `{"ok":false,"missing":true}` 的**body** ⇒ 结果是 unsupported（不是回落）', () => {
    installBytesShell((frame) => {
      const rid = decodeInvokeFrame(frame).reqId
      return encodeResolveFrame({
        reqId: rid,
        ok: true,
        body: utf8Encode('{"ok":false,"missing":true,"reason":"unsupported: iOS 禁止动态模块加载"}'),
      })
    })
    const r = invokeHost('extension.load', { id: 'x' })
    expect(lastInvokeWire()).toBe('bytes') // ★没有回落：能力级 unsupported 不是通道级 missing
    expect(r).toMatchObject({ ok: false, missing: true })
    expect((r as { reason: string }).reason).toMatch(/unsupported/)
  })

  it('同步字节腿：**帧级** missing（旧壳只认 http.request）⇒ 回落 JSON 腿且可查', () => {
    installBytesShell((frame) =>
      encodeResolveFrame({ reqId: decodeInvokeFrame(frame).reqId, ok: false, missing: true, reason: '当前仅 http.request' }),
    )
    g[HOST_INVOKE_KEY] = () => '{"ok":true,"data":{"provider":"android"}}'
    const r = invokeHost('host.context')
    expect(lastInvokeWire()).toBe('json')
    expect(r).toEqual({ ok: true, data: { provider: 'android' } })
  })

  it('同步字节腿：宿主抛错（老壳没有通用分发）⇒ 回落 JSON，不把通道故障当能力失败', () => {
    installBytesShell(() => {
      throw new Error('unsupported method')
    })
    g[HOST_INVOKE_KEY] = () => '{"ok":true,"data":42}'
    const r = invokeHost('idle.request', { timeout: 5 })
    expect(lastInvokeWire()).toBe('json')
    expect(r).toEqual({ ok: true, data: 42 })
  })
})

describe('⑥ 异步通用能力（非 http.request）', () => {
  it('payload = JSON 字节（无 HTTP meta）；回程 body 按 JSON 腿规则取 .data', async () => {
    let seen: ReturnType<typeof decodeInvokeFrame> | null = null
    installBytesShell((frame) => {
      seen = decodeInvokeFrame(frame)
      return okFrame((seen as unknown as { reqId: string }).reqId, utf8Encode('{"ok":true,"data":{"online":true,"type":"wifi"}}'))
    })
    const r = await invokeHostAsync('network.get', {})
    expect(lastInvokeWire()).toBe('bytes')
    expect(r).toEqual({ online: true, type: 'wifi' })
    const f = seen as unknown as ReturnType<typeof decodeInvokeFrame>
    expect(f.meta.url).toBeUndefined()
    expect(f.meta.contentType).toBe('application/json')
  })

  it('异步通用能力：帧级 missing + 有 JSON 腿 ⇒ 回落 JSON（lastInvokeWire 如实为 json）', async () => {
    installBytesShell((frame) => encodeResolveFrame({ reqId: decodeInvokeFrame(frame).reqId, ok: false, missing: true }))
    g[HOST_INVOKE_KEY] = (method: string) => {
      // JSON 腿同步返回最终结果（不必回推）
      return '{"ok":true,"data":{"method":"' + method + '"}}'
    }
    const r = await invokeHostAsync('device.get', {})
    expect(lastInvokeWire()).toBe('json')
    // JSON 腿既有语义：resolve `.data`（不是整个 {ok,data} 壳）
    expect(r).toEqual({ method: 'device.get' })
  })

  it('异步通用能力：帧级 missing 且**无 JSON 腿** ⇒ reject unsupported（不谎报通道缺失）', async () => {
    installBytesShell((frame) => encodeResolveFrame({ reqId: decodeInvokeFrame(frame).reqId, ok: false, missing: true }))
    await expect(invokeHostAsync('device.get', {})).rejects.toThrow(/^unsupported: /)
    expect(pendingHostCallCount()).toBe(0)
  })
})
