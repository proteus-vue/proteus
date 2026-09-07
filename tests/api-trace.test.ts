// tests/api-trace.test.ts —— devtools 打通：api 请求 → TraceBus → 面板 timeline / network 插件
// 协议（ApiOptions.traceBus，结构类型注入零硬依赖）：start `METHOD url` → end（成功）/ error（重试耗尽），traceId 每请求配对
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApi } from '@proteus-vue/api'
import type { ApiTraceBus } from '@proteus-vue/api'

interface Recorded {
  source: string
  phase: string
  name: string
  payload: unknown
  traceId?: string
}

function mockBus() {
  const events: Recorded[] = []
  const emit = vi.fn((source: string, phase: string, name: string, payload?: unknown, traceId?: string) => {
    events.push({ source, phase, name, payload, traceId })
  })
  return { emit, events }
}

function okFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, headers: new Headers(), json: async () => ({ ok: 1 }) })))
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('api → TraceBus 协议', () => {
  it('请求成功 → start(METHOD url) → end（traceId 配对 + payload url/method/status）', async () => {
    okFetch()
    const bus = mockBus()
    const api = createApi({ baseURL: 'https://api.example.com', traceBus: bus as unknown as ApiTraceBus })
    await api.get('/user/1')
    expect(bus.events.length).toBe(2)
    expect(bus.events[0]).toMatchObject({ source: 'api', phase: 'start', name: 'GET /user/1' })
    expect((bus.events[0].payload as { url: string; method: string }).url).toBe('/user/1')
    expect(bus.events[1].phase).toBe('end')
    expect((bus.events[1].payload as { status: number }).status).toBe(200)
    expect(bus.events[1].traceId).toBe(bus.events[0].traceId)
  })

  it('请求失败 → start → error（payload 带 message）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    const bus = mockBus()
    const api = createApi({ baseURL: 'https://api.example.com', traceBus: bus as unknown as ApiTraceBus })
    await expect(api.get('/x')).rejects.toThrow('boom')
    expect(bus.events[0].phase).toBe('start')
    expect(bus.events[1].phase).toBe('error')
    expect((bus.events[1].payload as { message: string }).message).toContain('boom')
  })

  it('无 traceBus → 请求正常不发射（缺省关闭）', async () => {
    okFetch()
    const api = createApi({ baseURL: 'https://api.example.com' })
    const res = await api.get('/ok')
    expect(res.status).toBe(200)
  })
})
