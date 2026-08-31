// tests/platform-api.test.ts
// ★types-plus-plan B9：createPlatformAPI 运行时统一实例（storage/router/ui 三域 + request 转发）
// jsdom 环境：覆盖 wx 分支（stubGlobal）与 web 分支（localStorage/history/DOM toast）
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlatformAPI } from '../packages/api/src/platform'
import type { IRequestAdapter, RequestConfig, RequestResponse } from '../packages/types/src/api-types'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('storage（wx 优先，web/内存兜底）', () => {
  it('stub wx 时走 wx.setStorageSync/getStorageSync/clearStorageSync', () => {
    let stored: Record<string, unknown> = { a: 1 }
    vi.stubGlobal('wx', {
      setStorageSync: (k: string, v: unknown) => {
        stored[k] = v
      },
      getStorageSync: (k: string) => stored[k],
      removeStorageSync: (k: string) => {
        delete stored[k]
      },
      clearStorageSync: () => {
        stored = {}
      },
    })
    const api = createPlatformAPI()
    api.storage.set('a', 1)
    expect(api.storage.get<number>('a')).toBe(1)
    api.storage.remove('a')
    expect(api.storage.get('a')).toBeUndefined()
    api.storage.set('b', { x: 1 })
    api.storage.clear()
    expect(api.storage.get('b')).toBeUndefined()
  })

  it('无 wx 时走 localStorage（JSON 序列化往返）', () => {
    const api = createPlatformAPI()
    api.storage.set('obj', { x: [1, 2] })
    expect(api.storage.get<{ x: number[] }>('obj')).toEqual({ x: [1, 2] })
    expect(localStorage.getItem('obj')).toBe('{"x":[1,2]}')
    api.storage.remove('obj')
    expect(api.storage.get('obj')).toBeUndefined()
  })
})

describe('router（wx 优先 / web pushState + popstate）', () => {
  it('stub wx 时 push 调 wx.navigateTo（query 拼接）', () => {
    const urls: string[] = []
    vi.stubGlobal('wx', {
      navigateTo: (o: { url: string }) => {
        urls.push(o.url)
      },
      redirectTo: (o: { url: string }) => {
        urls.push(`redirect:${o.url}`)
      },
      navigateBack: (o: { delta?: number }) => {
        urls.push(`back:${o.delta}`)
      },
    })
    const api = createPlatformAPI()
    api.router.push('/pages/user', { id: '7' })
    api.router.replace('/pages/home')
    api.router.back()
    api.router.back(2)
    expect(urls).toEqual(['/pages/user?id=7', 'redirect:/pages/home', 'back:1', 'back:2'])
  })

  it('无 wx 时 pushState + dispatchEvent(popstate)（web-adapter 监听驱动路由）', () => {
    const seen: string[] = []
    window.addEventListener('popstate', () => seen.push(window.location.pathname + window.location.search))
    const api = createPlatformAPI()
    api.router.push('/pages/user', { kw: 'a b' })
    expect(window.location.pathname + window.location.search).toBe('/pages/user?kw=a%20b')
    expect(seen).toContain('/pages/user?kw=a%20b')
    api.router.back()
  })
})

describe('ui（wx 优先 / DOM toast 兜底）', () => {
  it('stub wx 时 showToast/showLoading/hideLoading 转发', () => {
    const calls: string[] = []
    vi.stubGlobal('wx', {
      showToast: (o: { title: string; duration?: number }) => {
        calls.push(`toast:${o.title}:${o.duration}`)
      },
      showLoading: (o: { title?: string }) => {
        calls.push(`loading:${o.title}`)
      },
      hideLoading: () => {
        calls.push('hideLoading')
      },
    })
    const api = createPlatformAPI()
    api.ui.showToast('保存成功')
    api.ui.showLoading('加载中')
    api.ui.hideLoading()
    expect(calls).toEqual(['toast:保存成功:1500', 'loading:加载中', 'hideLoading'])
  })

  it('无 wx 时 DOM toast：showToast 插入节点、hideLoading 移除', () => {
    const api = createPlatformAPI()
    api.ui.showLoading('加载中')
    const el = document.querySelector('.proteus-toast')
    expect(el).not.toBeNull()
    expect(el?.textContent).toBe('加载中')
    api.ui.hideLoading()
    expect(document.querySelector('.proteus-toast')).toBeNull()
  })
})

describe('request（注入 adapter 转发契约签名）', () => {
  it('request 转发 config → adapter，原样返回响应', async () => {
    const stubAdapter: IRequestAdapter = {
      name: 'web',
      request: async <T>(config: RequestConfig): Promise<RequestResponse<T>> => ({
        data: { echoed: config.url } as T,
        status: 200,
        headers: { 'x-test': '1' },
        config,
      }),
    }
    const api = createPlatformAPI(stubAdapter)
    const res = await api.request<{ echoed: string }>({ url: '/ping', method: 'GET' })
    expect(res.data).toEqual({ echoed: '/ping' })
    expect(res.status).toBe(200)
    expect(res.headers['x-test']).toBe('1')
  })
})
