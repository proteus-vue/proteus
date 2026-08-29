// tests/api.test.ts
// ★api-plan A1/A8：createApi 请求客户端（web fetch / wx adapter / 拦截器 / 重试 / 错误模型）+ 设备信息
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApi, ApiError, getDeviceInfo, buildUrl } from '../packages/api/src'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('web fetch adapter', () => {
  it('GET 请求 → 统一响应（data/status/headers）', async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ id: 1 }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const api = createApi({ baseURL: 'https://api.example.com' })
    const res = await api.get<{ id: number }>('/user/1')
    expect(res.status).toBe(200)
    expect(res.data).toEqual({ id: 1 })
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/user/1', expect.objectContaining({ method: 'GET' }))
  })

  it('post 带 body（JSON 序列化）+ 快捷方法', async () => {
    const fetchMock = vi.fn(async () => ({ status: 201, headers: new Headers(), json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    const api = createApi()
    await api.post('/login', { name: 'a' })
    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('/login')
    expect((call[1] as { body: string }).body).toBe('{"name":"a"}')
  })

  it('网络错误 / 超时 → ApiError（code + config 可定位）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    const api = createApi()
    await expect(api.get('/x')).rejects.toThrow(ApiError)
    await expect(api.get('/x')).rejects.toThrow(/NETWORK_ERROR/)
    // 超时
    vi.stubGlobal('fetch', vi.fn(async (_u: string, opts: { signal: AbortSignal }) => {
      await new Promise((_r, rej) => {
        opts.signal.addEventListener('abort', () => {
          const e = new Error('AbortError')
          e.name = 'AbortError'
          rej(e)
        })
      })
    }))
    await expect(createApi().get('/slow', { timeout: 10 })).rejects.toThrow(/TIMEOUT/)
  })

  it('重试：失败后自动重试（成功在第 2 次）', async () => {
    let n = 0
    const fetchMock = vi.fn(async () => {
      n++
      if (n < 2) throw new Error('flaky')
      return { status: 200, headers: new Headers(), json: async () => ({ ok: true }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const api = createApi()
    const res = await api.get('/flaky', { retry: 2, retryDelay: 1 })
    expect(res.data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('重试耗尽 → ApiError RETRY_FAILED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('always') }))
    const api = createApi()
    await expect(api.get('/x', { retry: 1, retryDelay: 1 })).rejects.toThrow(/RETRY_FAILED/)
  })

  it('beforeRequest 拦截器（改 config）+ skipAuth 跳过', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, headers: new Headers(), json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    const seen: string[] = []
    const api = createApi({
      beforeRequest: (c) => { seen.push('before'); return { ...c, headers: { ...(c.headers ?? {}), Authorization: 'Bearer t' } } },
    })
    await api.get('/a')
    await api.get('/b', { skipAuth: true })
    expect(seen).toEqual(['before'])
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer t')
  })
})

describe('wx adapter', () => {
  it('wx.request 包装 → 统一响应', async () => {
    const wxMock = {
      request: vi.fn((opts: Record<string, unknown>) => {
        opts.success?.({ statusCode: 200, data: { wx: 1 }, header: { 'x-a': '1' } })
      }),
    }
    vi.stubGlobal('wx', wxMock)
    const api = createApi()
    const res = await api.get<{ wx: number }>('/u')
    expect(res.data).toEqual({ wx: 1 })
    expect(res.status).toBe(200)
    expect(wxMock.request).toHaveBeenCalledWith(expect.objectContaining({ url: '/u', method: 'GET' }))
  })

  it('wx.request fail → ApiError NETWORK_ERROR', async () => {
    vi.stubGlobal('wx', {
      request: vi.fn((opts: Record<string, unknown>) => opts.fail?.({ errMsg: 'request:fail' })),
    })
    await expect(createApi().get('/u')).rejects.toThrow(/NETWORK_ERROR/)
  })
})

describe('设备信息 / buildUrl', () => {
  it('getDeviceInfo：无 wx → web 环境', () => {
    const info = getDeviceInfo()
    expect(info.platform).toBe('web')
    expect(info.isSkyline).toBe(false)
  })

  it('buildUrl：baseURL + url + params 拼接', () => {
    expect(buildUrl('https://a.com/api', 'user', { id: '1', v: 2 })).toBe('https://a.com/api/user?id=1&v=2')
    expect(buildUrl('', '/x')).toBe('/x')
  })
})
