// tests/use-mcp.test.ts
// ★WebMCP 接入（E30 engineering.mcp）：useMCP —— 把框架能力暴露为浏览器内 agent 可调用工具。
//
// 规范面（2026-09 核实，易记错处已在断言中标注）：
//   · 命名空间 `document.modelContext`（★不是 navigator）
//   · 注册 `registerTool(descriptor, { signal })`；规范**无 unregisterTool** → 注销靠 `signal.abort()`
//   · 探测须判**方法可调用**（只判对象存在会把空对象误判为支持）
// 框架差异化：能力面统一 `CapResult<T>` → 自动派生工具 + 响应归一（ok→结果 / Err→isError+错误码）
import { describe, it, expect, vi } from 'vitest'
import { useMCP, capabilityToTool, toToolResponse, toErrorResponse, capOk, capErr } from '@proteus-vue/api'
import type { McpToolDescriptor } from '@proteus-vue/api'

/** 造一个假 modelContext：记录注册/注销（signal.abort 时移除）
 *  ★签名与 McpModelContextLike 对齐（signal: unknown——接口刻意用 unknown 避免绑死 DOM 类型，
 *   MP 产物不应依赖 AbortSignal 类型）；mock 内再窄化使用。 */
function fakeModelContext(): {
  mc: { registerTool: (t: unknown, o?: { signal?: unknown }) => void; getTools: () => unknown[] }
  registered: string[]
  aborted: () => boolean
} {
  const registered: string[] = []
  let aborted = false
  const mc = {
    registerTool: (t: unknown, o?: { signal?: unknown }) => {
      registered.push((t as McpToolDescriptor).name)
      const sig = o ? o.signal : undefined
      if (sig && typeof (sig as AbortSignal).addEventListener === 'function') {
        // 模拟规范行为：signal abort → 注销（从注册表移除）
        ;(sig as AbortSignal).addEventListener('abort', () => {
          aborted = true
          registered.length = 0
        })
      }
    },
    getTools: () => registered.slice(),
  }
  return { mc, registered, aborted: () => aborted }
}

describe('WebMCP：useMCP 注册（规范面）', () => {
  it('★命名空间是 document.modelContext（不是 navigator）——注册落在 document 上', async () => {
    const { mc, registered } = fakeModelContext()
    const r = useMCP({
      document: { modelContext: mc },
      tools: [{ name: 'greet', description: '打招呼', execute: () => 'hi' }],
    })
    await r.ready
    expect(registered).toEqual(['greet'])
    expect(r.isRegistered).toBe(true)
    expect(r.isSupported).toBe(true)
  })

  it('★探测判「方法可调用」：modelContext 存在但无 registerTool → isSupported=false（不误判）', () => {
    const r = useMCP({ document: { modelContext: {} }, tools: [{ name: 'x', description: 'd', execute: () => 1 }] })
    expect(r.isSupported).toBe(false)
    expect(r.isRegistered).toBe(false)
    expect(r.toolNames).toEqual([]) // 未注册 → 不报告工具名（诚实）
  })

  it('★注销走 signal.abort（规范无 unregisterTool）——dispose 后注册表清空', async () => {
    const { mc, registered, aborted } = fakeModelContext()
    const r = useMCP({ document: { modelContext: mc }, tools: [{ name: 't1', description: 'd', execute: () => 1 }] })
    await r.ready
    expect(registered).toEqual(['t1'])
    r.dispose()
    expect(aborted()).toBe(true)
    expect(registered).toEqual([])
    expect(r.isRegistered).toBe(false)
  })

  it('★作用域销毁经注入（onDispose）——不 import vue 也能绑生命周期', async () => {
    const { mc, registered } = fakeModelContext()
    let cleanup: (() => void) | null = null
    useMCP({ document: { modelContext: mc }, tools: [{ name: 't2', description: 'd', execute: () => 1 }], onDispose: (fn) => { cleanup = fn } })
    expect(typeof cleanup).toBe('function')
    expect(registered).toEqual(['t2'])
    cleanup!() // 模拟组件卸载 / scope.dispose
    expect(registered).toEqual([])
  })

  it('enabled=false → 只探测不注册', () => {
    const { mc, registered } = fakeModelContext()
    const r = useMCP({ document: { modelContext: mc }, enabled: false, tools: [{ name: 't3', description: 'd', execute: () => 1 }] })
    expect(r.isSupported).toBe(true)
    expect(registered).toEqual([])
    expect(r.toolNames).toEqual([])
  })

  it('注册抛错（如 NotAllowedError）→ 落到 error 而非穿透', async () => {
    const mc = { registerTool: () => { throw new Error('NotAllowedError: not allowed') }, getTools: () => [] }
    const r = useMCP({ document: { modelContext: mc }, tools: [{ name: 't4', description: 'd', execute: () => 1 }] })
    await r.ready
    expect(r.error).toBeInstanceOf(Error)
    expect(r.error!.message).toContain('NotAllowedError')
    expect(r.isRegistered).toBe(false)
  })

  it('异步 registerTool（返回 Promise reject）→ error 捕获 + ready 仍 resolve', async () => {
    const mc = { registerTool: () => Promise.reject(new Error('denied')), getTools: () => [] }
    const r = useMCP({ document: { modelContext: mc }, tools: [{ name: 't5', description: 'd', execute: () => 1 }] })
    await r.ready
    expect(r.error!.message).toBe('denied')
    expect(r.isRegistered).toBe(false)
  })

  it('★降级：环境不支持（无 document / MP）→ isSupported=false、不抛错、ready 立即完成', async () => {
    const r = useMCP({ document: {}, tools: [{ name: 'x', description: 'd', execute: () => 1 }] })
    await expect(r.ready).resolves.toBeUndefined()
    expect(r.isSupported).toBe(false)
    expect(r.error).toBeNull() // 不支持不是错误（G-32.3 降级语义）
    // 不传 document 时取全局：Node 测试环境无 document.modelContext → 同样诚实降级
    const r2 = useMCP({ tools: [{ name: 'y', description: 'd', execute: () => 1 }] })
    await r2.ready
    expect(r2.isSupported).toBe(false)
  })
})

describe('WebMCP：能力派生工具（★框架差异化）', () => {
  it('★CapResult ok → 工具结果；Err → isError + 错误码（能力面统一契约自动归一）', async () => {
    const okTool = capabilityToTool({ name: 'locate', description: '定位', run: () => capOk({ lat: 1, lng: 2 }) })
    const okRes = (await okTool.execute({})) as { content: Array<{ text: string }>; isError?: boolean }
    expect(JSON.parse(okRes.content[0].text)).toEqual({ lat: 1, lng: 2 })
    expect(okRes.isError).toBeUndefined()

    const errTool = capabilityToTool({ name: 'scan', description: '扫码', run: () => capErr('qr.denied', '用户取消') })
    const errRes = (await errTool.execute({})) as { content: Array<{ text: string }>; isError?: boolean }
    expect(errRes.isError).toBe(true)
    expect(errRes.content[0].text).toContain('qr.denied')
    expect(errRes.content[0].text).toContain('用户取消')
  })

  it('异步能力 + 抛错实现都归一（异常不穿透到 agent 通道）', async () => {
    const asyncTool = capabilityToTool({ name: 'net', description: '请求', run: async () => capOk('pong') })
    expect(((await asyncTool.execute({})) as { content: Array<{ text: string }> }).content[0].text).toBe('pong')

    const boom = capabilityToTool({ name: 'boom', description: '崩', run: () => { throw new Error('kaput') } })
    const res = (await boom.execute({})) as { content: Array<{ text: string }>; isError?: boolean }
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('kaput')
  })

  it('★void 能力（capOk(undefined)）端到端：成功响应且有可读文本（非 "undefined"）', async () => {
    // 真实形态：useVibrate/useShare 等多数能力返回 CapResult<void>
    const t = capabilityToTool({ name: 'vibrate', description: '震动', run: () => capOk(undefined) })
    const res = (await t.execute({})) as { content: Array<{ text: string }>; isError?: boolean }
    expect(res.isError).toBeUndefined()
    expect(res.content[0].text).not.toBe('undefined')
    expect(res.content[0].text.length).toBeGreaterThan(0)
  })

  it('prefix 应用到能力派生工具（显式 tools 不加前缀）', async () => {
    const { mc, registered } = fakeModelContext()
    const r = useMCP({
      document: { modelContext: mc },
      prefix: 'app_',
      tools: [{ name: 'raw', description: 'd', execute: () => 1 }],
      capabilities: [{ name: 'vibrate', description: '震动', run: () => capOk(undefined) }],
    })
    await r.ready
    expect(registered.sort()).toEqual(['app_vibrate', 'raw'])
    expect(r.toolNames.sort()).toEqual(['app_vibrate', 'raw'])
  })

  it('★注册的工具描述符符合规范形状（name/description/inputSchema/execute 四字段）', async () => {
    const { mc } = fakeModelContext()
    let captured: McpToolDescriptor | null = null
    const mcSpy = { registerTool: (t: unknown) => { captured = t as McpToolDescriptor }, getTools: () => [] }
    void mc
    useMCP({
      document: { modelContext: mcSpy },
      capabilities: [{ name: 'c', description: '能力工具', inputSchema: { type: 'object', properties: { n: { type: 'number' } } }, run: () => capOk(1) }],
    })
    expect(captured).not.toBeNull()
    expect(captured!.name).toBe('c')
    expect(captured!.description).toBe('能力工具')
    expect(captured!.inputSchema).toEqual({ type: 'object', properties: { n: { type: 'number' } } })
    expect(typeof captured!.execute).toBe('function')
  })
})

describe('WebMCP：响应归一（可序列化保证）', () => {
  it('toToolResponse：字符串直出 / 对象 JSON / 循环引用降级为字符串（不抛给 agent）', () => {
    expect(toToolResponse('hi').content[0].text).toBe('hi')
    expect(toToolResponse({ a: 1 }).content[0].text).toBe('{"a":1}')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => toToolResponse(cyclic)).not.toThrow()
    expect(toToolResponse(cyclic).content[0].text).toBe('[object Object]')
  })

  it('★toToolResponse：空载荷（CapResult<void>）不得产出字面量 "undefined"（浏览器实测缺陷）', () => {
    // 缺陷背景（真实浏览器验证暴露）：多数能力是 `CapResult<void>`（如 useVibrate → capOk(undefined)），
    //   原实现走 JSON.stringify(undefined) → 字面量 "undefined" 字符串——agent 会当有效数据解析。
    expect(toToolResponse(undefined).content[0].text).not.toBe('undefined')
    expect(toToolResponse(null).content[0].text).not.toBe('null')
    // 且必须仍是**成功**响应（无 isError）
    expect(toToolResponse(undefined).isError).toBeUndefined()
  })

  it('toErrorResponse：Error 与非 Error 都产出 isError 响应', () => {
    expect(toErrorResponse(new Error('e1')).isError).toBe(true)
    expect(toErrorResponse('plain').content[0].text).toBe('plain')
  })
})

describe('WebMCP：破坏性验证（改坏 → 应变红）', () => {
  it('探测若退化为「对象存在即支持」→ 空 modelContext 会被误判（本用例锁住现行判据）', () => {
    // 反例形态：`!!doc.modelContext` 会把 `{}` 判为支持 → 注册静默失败且不报错。
    // 现行实现判方法可调用，故 `{}` → false。此断言即「不得退回弱判据」的锁。
    const r = useMCP({ document: { modelContext: {} } })
    expect(r.isSupported).toBe(false)
  })

  it('注销若不走 signal.abort → 工具残留（dispose 后注册表必须为空）', async () => {
    const { mc, registered } = fakeModelContext()
    const r = useMCP({ document: { modelContext: mc }, tools: [{ name: 'must_clear', description: 'd', execute: () => 1 }] })
    await r.ready
    expect(registered).toContain('must_clear')
    r.dispose()
    expect(registered).not.toContain('must_clear')
  })

  it('能力 Err 若被当成功返回 → isError 缺失（本用例锁住失败语义）', async () => {
    const t = capabilityToTool({ name: 'e', description: 'd', run: () => capErr('x.fail', 'boom') })
    const res = (await t.execute({})) as { isError?: boolean }
    expect(res.isError, '★能力失败必须标 isError——否则 agent 会把错误当成功数据').toBe(true)
  })
})
