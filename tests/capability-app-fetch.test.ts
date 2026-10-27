// tests/capability-app-fetch.test.ts
// ★★T-app-fetch（App 端 C26 useFetch 落地）· **异步原生通道**的契约测试。
//
// 【要证明什么】G-39 `docs/proteus-host-runtime-plan/04-native-bridge.md` 规定
//   `invokeNative(name, args): Promise` —— **统一异步，即使 Native 是同步**；
//   而本仓既有 `invokeHost` 是**同步**签名。本单为「天然异步的能力」（网络为第一例）
//   新增异步通道 `invokeHostAsync`：派发带 `__reqId` → 壳回推 `__proteusHostResolve`。
//   ★本测试锁四件事：
//     ① 异步壳（回 `{pending:true}`）⇒ 挂起，回推后才 settle；
//     ② **同步壳（既有宿主形态）⇒ 当场 settle**（零回归——老壳不认识 `__reqId` 也照常工作）；
//     ③ 超时 ⇒ reject，且**迟到回推是 no-op、pending 表无泄漏**；
//     ④ `request` 桥 + `useFetch` hook 端到端：载荷落在 `.data`（与 wx 桥取数语义**逐字段对齐**）。
import { describe, it, expect, afterEach } from 'vitest'
import {
  invokeHostAsync,
  installHostResolveBridge,
  pendingHostCallCount,
  HOST_RESOLVE_KEY,
  HOST_ID_KEY,
  HOST_INVOKE_KEY,
  APP_NATIVE_METHODS,
} from '../packages/api/src/capability-app'
import { createCapabilityBridge, createCapabilityHooks } from '../packages/api/src/capability'

const g = globalThis as Record<string, unknown>

/** 壳回推入口（壳完成后调用；类型断言避免 any） */
const resolveFromHost = (reqId: string, json: string): void => {
  ;(g[HOST_RESOLVE_KEY] as (a: string, b: string) => void)(reqId, json)
}

/** 装「异步壳」：立即回 `{pending:true}`，把 reqId 交回测试方决定何时回推。 */
function installAsyncShell(): { reqIds: string[]; methods: string[] } {
  const reqIds: string[] = []
  const methods: string[] = []
  g[HOST_INVOKE_KEY] = (method: string, argsJson: string): string => {
    methods.push(method)
    const args = JSON.parse(argsJson) as { __reqId?: string }
    if (args.__reqId) reqIds.push(args.__reqId)
    return JSON.stringify({ ok: true, data: { pending: true } })
  }
  return { reqIds, methods }
}

/** 装「同步壳」（既有宿主形态）：直接返回最终结果，完全不认 `__reqId`。 */
function installSyncShell(result: unknown, ok = true): void {
  g[HOST_INVOKE_KEY] = (): string => JSON.stringify(ok ? { ok: true, data: result } : result)
}

afterEach(() => {
  delete g[HOST_ID_KEY]
  delete g[HOST_INVOKE_KEY]
  delete g[HOST_RESOLVE_KEY]
})

describe('① 异步通道：派发 → 挂起 → 回推 → settle', () => {
  it('壳回 `{pending:true}` ⇒ 挂起；回推后 resolve，且 pending 表归零', async () => {
    const shell = installAsyncShell()
    let settled = false
    const p = invokeHostAsync('http.request', { url: 'https://example.com' }, 5000).then((d) => {
      settled = true
      return d
    })

    // 派发带上 `__reqId`（协议要求：壳靠它关联响应）
    expect(shell.methods).toEqual(['http.request'])
    expect(shell.reqIds).toHaveLength(1)
    expect(shell.reqIds[0]).toMatch(/^app-async-\d+$/)

    // 壳未回推前**不得** settle（证明"异步"是真的，不是假异步）
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(pendingHostCallCount()).toBe(1)

    resolveFromHost(shell.reqIds[0], JSON.stringify({ ok: true, data: { status: 200, data: { id: 7 } } }))
    expect(await p).toEqual({ status: 200, data: { id: 7 } })
    expect(pendingHostCallCount()).toBe(0)
  })

  it('★同步壳（既有宿主形态）⇒ 当场 settle（零回归：老壳不认识 __reqId 也照常工作）', async () => {
    installSyncShell({ provider: 'ios' })
    // 老壳同步给了最终结果 ⇒ 立即 resolve，且**不占** pending
    await expect(invokeHostAsync('host.context', {})).resolves.toEqual({ provider: 'ios' })
    expect(pendingHostCallCount()).toBe(0)
  })

  it('回推失败 `{ok:false,reason}` ⇒ reject 且带原因', async () => {
    const shell = installAsyncShell()
    const p = invokeHostAsync('http.request', { url: 'x' }, 5000)
    resolveFromHost(shell.reqIds[0], JSON.stringify({ ok: false, reason: 'DNS 解析失败', missing: false }))
    await expect(p).rejects.toThrow('DNS 解析失败')
  })

  it('回推 `missing:true` ⇒ reject 且消息带 `unsupported:` 前缀（供桥映射 `*.unsupported`）', async () => {
    const shell = installAsyncShell()
    const p = invokeHostAsync('http.request', { url: 'x' }, 5000)
    resolveFromHost(shell.reqIds[0], JSON.stringify({ ok: false, reason: '未实现', missing: true }))
    await expect(p).rejects.toThrow(/^unsupported:/)
  })
})

describe('② 超时与泄漏', () => {
  it('壳永不回推 ⇒ 超时 reject；迟到回推是 no-op 且不泄漏', async () => {
    const shell = installAsyncShell()
    const p = invokeHostAsync('http.request', { url: 'x' }, 20) // 20ms 超时
    await expect(p).rejects.toThrow(/超时/)
    expect(pendingHostCallCount()).toBe(0) // ★超时即从 pending 表移除

    // 迟到回推（已超时）⇒ 不抛、不复活 Promise
    expect(() => resolveFromHost(shell.reqIds[0], JSON.stringify({ ok: true, data: {} }))).not.toThrow()
    expect(pendingHostCallCount()).toBe(0)
  })

  it('壳未注册通道 ⇒ 通道缺失 reject（不是静默挂起）', async () => {
    await expect(invokeHostAsync('http.request', {})).rejects.toThrow(/壳未注册原生通道/)
  })
})

describe('③ 桥 + Hook 端到端（取数语义与 wx 桥逐字段对齐）', () => {
  it('App 宿主下 `bridge.request` 返回 RequestResponse 形状：载荷在 `.data`、状态码在 `.status`', async () => {
    g[HOST_ID_KEY] = 'android'
    const shell = installAsyncShell()
    const bridge = createCapabilityBridge()
    expect(typeof bridge.request).toBe('function')

    const p = bridge.request!({ url: 'https://api.example.com/user', method: 'GET' })
    // ★#1238 修断言：`createCapabilityBridge()` 装配时会**探测** `fs.*` / `log` 等能力
    //   （`appFileSystemAvailable()` 逐个 `invokeHost(..., {probe:true})`）⇒ 宿主方法列表
    //   不可能"恰好只有 http.request"。#1226 加探针后这条断言就假红了，只是没人在全量里发现。
    //   ★改断言比改实现正确：本用例要证明的是"**取数走能力通道**"，不是"装配过程零探测"。
    expect(shell.methods.filter((m) => m.startsWith("http.")), "取数必须走 http.request 能力通道").toEqual([
      APP_NATIVE_METHODS.httpRequest,
    ])
    resolveFromHost(
      shell.reqIds[0],
      JSON.stringify({ ok: true, data: { data: { name: 'kags' }, status: 200, headers: { 'x-trace': 't1' } } }),
    )
    const r = await p
    expect(r.data).toEqual({ name: 'kags' }) // ★载荷在 .data（与 wx 桥一致）
    expect(r.status).toBe(200)
    expect(r.headers).toEqual({ 'x-trace': 't1' })
    expect(r.config.url).toBe('https://api.example.com/user')
  })

  it('`useFetch` 端到端：解构出的 `.data` 就是载荷（迁移文档的写法）', async () => {
    g[HOST_ID_KEY] = 'ios'
    const shell = installAsyncShell()
    const hooks = createCapabilityHooks(createCapabilityBridge())
    const p = hooks.useFetch<{ items: number[] }>('/api/list')
    resolveFromHost(shell.reqIds[0], JSON.stringify({ ok: true, data: { data: { items: [1, 2] }, status: 200, headers: {} } }))
    const res = await p
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data).toEqual({ items: [1, 2] })
  })

  it('壳未实现 `http.request`（抛 unsupported）⇒ `fetch.unsupported`（不伪造成功）', async () => {
    g[HOST_ID_KEY] = 'harmony'
    g[HOST_INVOKE_KEY] = (): string => {
      throw new Error('unsupported: 未实现的原生方法：http.request')
    }
    const bridge = createCapabilityBridge()
    await expect(bridge.request!({ url: 'https://x' })).rejects.toMatchObject({ code: 'fetch.unsupported' })
  })
})

describe('④ 幂等与诊断', () => {
  it('回推入口幂等安装（重复装不覆盖、不报错）', () => {
    installHostResolveBridge()
    const first = g[HOST_RESOLVE_KEY]
    installHostResolveBridge()
    expect(g[HOST_RESOLVE_KEY]).toBe(first)
  })

  it('未知 reqId 的回推是 no-op（不抛）', () => {
    installHostResolveBridge()
    expect(() => resolveFromHost('app-async-does-not-exist', '{}')).not.toThrow()
  })
})
