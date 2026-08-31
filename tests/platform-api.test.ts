// tests/platform-api.test.ts
// ★types-plus-plan B9：createPlatformAPI 运行时统一实例（storage/router/ui 三域 + request 转发）
// jsdom 环境：覆盖 wx 分支（stubGlobal）与 web 分支（localStorage/history/DOM toast）
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlatformAPI } from '../packages/api/src/platform'
import type { IRequestAdapter, RequestConfig, RequestResponse } from '@proteus-vue/types'

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
      switchTab: (o: { url: string }) => {
        urls.push(`switchTab:${o.url}`)
      },
      reLaunch: (o: { url: string }) => {
        urls.push(`reLaunch:${o.url}`)
      },
      navigateBack: (o: { delta?: number }) => {
        urls.push(`back:${o.delta}`)
      },
    })
    const api = createPlatformAPI()
    api.router.push('/pages/user', { id: '7' })
    api.router.replace('/pages/home')
    api.router.switchTab('/pages/mine')
    api.router.reLaunch('/pages/start')
    api.router.back()
    api.router.back(2)
    expect(urls).toEqual([
      '/pages/user?id=7',
      'redirect:/pages/home',
      'switchTab:/pages/mine',
      'reLaunch:/pages/start',
      'back:1',
      'back:2',
    ])
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
  it('stub wx 时 showToast/showLoading/hideLoading/showModal/showActionSheet 转发', () => {
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
      showModal: (o: { content?: string; success?: (r: { confirm: boolean; cancel: boolean }) => void }) => {
        calls.push(`modal:${o.content}`)
        if (o.success) o.success({ confirm: true, cancel: false })
      },
      showActionSheet: (o: { itemList: string[]; success?: (r: { tapIndex: number }) => void }) => {
        calls.push(`sheet:${o.itemList.join(',')}`)
        if (o.success) o.success({ tapIndex: 1 })
      },
    })
    const api = createPlatformAPI()
    api.ui.showToast('保存成功')
    api.ui.showLoading('加载中')
    api.ui.hideLoading()
    void api.ui.showModal({ content: '确认删除？' }).then((r) => expect(r.confirm).toBe(true))
    void api.ui.showActionSheet({ itemList: ['编辑', '删除'] }).then((r) => expect(r.tapIndex).toBe(1))
    expect(calls).toEqual(['toast:保存成功:1500', 'loading:加载中', 'hideLoading', 'modal:确认删除？', 'sheet:编辑,删除'])
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

  it('无 wx 时 DOM modal：确认 → { confirm: true }、遮罩点击 → { cancel: true }', async () => {
    const api = createPlatformAPI()
    const p = api.ui.showModal({ title: '确认', content: '删除？' })
    const box = document.querySelector('.proteus-modal')
    expect(box).not.toBeNull()
    const buttons = document.querySelectorAll('.proteus-modal button')
    ;(buttons[buttons.length - 1] as HTMLElement).click() // 确认按钮
    expect(await p).toEqual({ confirm: true, cancel: false })
    expect(document.querySelector('.proteus-modal')).toBeNull()

    const p2 = api.ui.showModal({ content: '遮罩' })
    const mask = document.querySelector('.proteus-modal')
    ;(mask as HTMLElement).click() // 遮罩点击 = 取消
    expect(await p2).toEqual({ confirm: false, cancel: true })
  })

  it('无 wx 时 DOM actionSheet：点项 → { tapIndex }、取消 → -1', async () => {
    const api = createPlatformAPI()
    const p = api.ui.showActionSheet({ itemList: ['编辑', '删除'] })
    const items = document.querySelectorAll('.proteus-actionsheet-item')
    ;(items[1] as HTMLElement).click() // 第二项「删除」
    expect(await p).toEqual({ tapIndex: 1 })
    expect(document.querySelector('.proteus-actionsheet')).toBeNull()

    const p2 = api.ui.showActionSheet({ itemList: ['编辑'] })
    const cancel = document.querySelector('.proteus-actionsheet-cancel')
    ;(cancel as HTMLElement).click() // 取消行
    expect(await p2).toEqual({ tapIndex: -1 })
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
