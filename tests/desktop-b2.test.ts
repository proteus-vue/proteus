// tests/desktop-b2.test.ts
// ★G-24 B2（proteus-semantic-primitives-plan 04-system-integration + 06-integration-batches）：系统集成四件套
//   验证点：p-notify（Notification 探测/权限/发送）· p-permission（目录/清单生成/check/request 归一 + v-p-permission 门禁）·
//   p-clipboard（Clipboard API ok / execCommand 降级 / unsupported）· p-deeplink（parse 多形态 / match 参数化）
// @vitest-environment happy-dom（指令 DOM 断言）
import { describe, it, expect, vi } from 'vitest'
import {
  notifySupported,
  getNotifyPermission,
  requestNotifyPermission,
  sendNotification,
  PERMISSION_CATALOG,
  buildPermissionManifest,
  checkPermission,
  requestPermission,
  clipboardSupported,
  copyText,
  pasteText,
  parseDeepLink,
  matchDeepLink,
  createPermissionDirective,
} from '@proteus-vue/desktop'
import type { NotificationCtor } from '@proteus-vue/desktop'

describe('G-24 B2 p-notify（通知——04 §1 Notification API 映射）', () => {
  function makeNotification(permission: string): NotificationCtor {
    const calls: string[] = []
    const Ctor = class {
      static permission = permission
      static requested: string[] = []
      title: string
      options: Record<string, unknown>
      constructor(title: string, options?: Record<string, unknown>) {
        this.title = title
        this.options = options ?? {}
        calls.push(title)
      }
      static requestPermission(): Promise<string> {
        Ctor.requested.push('asked')
        return Promise.resolve(permission)
      }
    }
    void calls
    return Ctor as unknown as NotificationCtor
  }

  it('notifySupported / getNotifyPermission 三态 + unsupported', () => {
    expect(notifySupported({ Notification: makeNotification('granted') })).toBe(true)
    expect(notifySupported({})).toBe(false) // happy-dom 无全局 Notification
    expect(getNotifyPermission({ Notification: makeNotification('granted') })).toBe('granted')
    expect(getNotifyPermission({ Notification: makeNotification('denied') })).toBe('denied')
    expect(getNotifyPermission({ Notification: makeNotification('default') })).toBe('default')
    expect(getNotifyPermission({})).toBe('unsupported')
  })

  it('requestNotifyPermission：granted/denied 归一 + impl 注入', async () => {
    expect(await requestNotifyPermission({}, () => Promise.resolve('granted'))).toBe('granted')
    expect(await requestNotifyPermission({}, () => Promise.resolve('denied'))).toBe('denied')
    expect(await requestNotifyPermission({ Notification: makeNotification('denied') })).toBe('denied')
  })

  it('sendNotification：granted 构造成功 / 未授权 denied / 无 API unsupported', () => {
    const N = makeNotification('granted')
    const ok = sendNotification({ title: '新消息', body: '正文', tag: 't1' }, {}, N)
    expect(ok.ok).toBe(true)
    const denied = sendNotification({ title: 'x' }, {}, makeNotification('denied'))
    expect(denied).toEqual({ ok: false, error: 'notification.denied' })
    const unsup = sendNotification({ title: 'x' }, {})
    expect(unsup).toEqual({ ok: false, error: 'notification.unsupported' })
  })
})

describe('G-24 B2 p-permission（权限门禁——04 §2 权限前置）', () => {
  it('PERMISSION_CATALOG：语义有明确 web 通道（原则 #10.8）', () => {
    expect(PERMISSION_CATALOG.notification.webQueryName).toBe('notifications')
    expect(PERMISSION_CATALOG.camera.webQueryName).toBeUndefined() // 无标准 query 通道 → 诚实省略
  })

  it('buildPermissionManifest：Compiler 期清单（去重 + 未知过滤 + 稳定序）', () => {
    const m = buildPermissionManifest(['notification', 'camera', 'notification', 'unknown-xxx', 'geolocation'])
    expect(m.map((x) => x.semantic)).toEqual(['notification', 'camera', 'geolocation'])
    expect(m[0].label).toBe('通知')
    expect(m[0].requestNote).toContain('UNUserNotificationCenter')
    expect(buildPermissionManifest([])).toEqual([])
  })

  it('checkPermission：目录未知 unsupported / 无 query 通道 prompt / query 归一 / 抛错 prompt', async () => {
    expect(await checkPermission('unknown-x')).toBe('unsupported')
    expect(await checkPermission('camera')).toBe('prompt') // 无 webQueryName
    expect(await checkPermission('notification', { query: async () => 'granted' })).toBe('granted')
    expect(await checkPermission('notification', { query: async () => 'denied' })).toBe('denied')
    expect(await checkPermission('notification', { query: async () => null })).toBe('prompt')
    expect(await checkPermission('notification', { query: async () => { throw new Error('x') } })).toBe('prompt')
  })

  it('requestPermission：env.request 注入 granted/denied；缺实现 unsupported', async () => {
    expect(await requestPermission('notification', { request: async () => true })).toBe('granted')
    expect(await requestPermission('notification', { request: async () => false })).toBe('denied')
    expect(await requestPermission('notification')).toBe('unsupported')
    expect(await requestPermission('bogus', { request: async () => true })).toBe('unsupported')
  })

  it('v-p-permission 门禁：未授权点击拦截 + 授权后重放一次', async () => {
    // 授权状态可变 env：初查 denied → 点击触发 request（授权成功）→ 重放 click
    let granted = false
    const env = {
      query: async () => (granted ? 'granted' : 'denied'),
      request: async () => {
        granted = true
        return true
      },
    }
    const d = createPermissionDirective({ env })
    const el = document.createElement('button')
    const handler = vi.fn()
    el.addEventListener('click', handler) // 业务 handler（注册于指令监听之后——同元素同阶段按注册序）
    const binding = { value: { semantic: 'notification', onState: vi.fn() } } as never
    d.mounted!(el, binding as never, null as never, null as never)
    el.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(handler).toHaveBeenCalledTimes(1) // 拦截（stopImmediatePropagation）→ 授权成功 → 重放恰好一次
    expect(granted).toBe(true)
    d.unmounted!(el, binding as never, null as never, null as never)
  })

  it('v-p-permission：已授权 → 放行（业务 handler 正常触发一次）', async () => {
    const d = createPermissionDirective({ env: { query: async () => 'granted' } })
    const el = document.createElement('button')
    const handler = vi.fn()
    el.addEventListener('click', handler)
    d.mounted!(el, { value: { semantic: 'notification' } } as never, null as never, null as never)
    // 预检是异步——等其 settle（cached=granted）再点击放行
    await new Promise((r) => setTimeout(r, 5))
    el.click()
    await new Promise((r) => setTimeout(r, 5))
    expect(handler).toHaveBeenCalledTimes(1)
    d.unmounted!(el, {} as never, null as never, null as never)
  })
})

describe('G-24 B2 p-clipboard（剪贴板——04 §1 Clipboard API + 降级）', () => {
  it('clipboardSupported：Clipboard API 存在判定', () => {
    expect(clipboardSupported({ navigator: { clipboard: { writeText: async () => undefined } } })).toBe(true)
    expect(clipboardSupported({})).toBe(false)
  })

  it('copyText：Clipboard API ok（写入 + data 回显）', async () => {
    const writeText = vi.fn(async () => undefined)
    const r = await copyText('hi', { navigator: { clipboard: { writeText } } })
    expect(r.ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hi')
  })

  it('copyText：API 拒绝 → execCommand 降级 ok', async () => {
    const ta = { value: '', select: vi.fn(), setAttribute: vi.fn(), remove: vi.fn(), style: { position: '', left: '', top: '' } }
    const r = await copyText('x', {
      navigator: { clipboard: { writeText: async () => { throw new Error('denied') } } },
      document: {
        execCommand: () => true,
        createElement: () => ta as never,
      },
    })
    expect(r.ok).toBe(true)
    expect(ta.value).toBe('x')
    expect(ta.select).toHaveBeenCalled()
  })

  it('copyText：全无 → clipboard.unsupported', async () => {
    const r = await copyText('x', {})
    expect(r).toEqual({ ok: false, error: 'clipboard.unsupported' })
  })

  it('copyText：省略 env → 回落真实全局（页面即用形态——零注入可直接复制）', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    try {
      const r = await copyText('hello')
      expect(r.ok).toBe(true)
      expect(writeText).toHaveBeenCalledWith('hello')
      expect(clipboardSupported()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('pasteText：readText ok / 无 API read-unsupported', async () => {
    const r = await pasteText({ navigator: { clipboard: { writeText: async () => undefined, readText: async () => 'pasted' } } })
    expect(r).toEqual({ ok: true, data: 'pasted' })
    const no = await pasteText({})
    expect(no.ok).toBe(false)
    expect(no.error).toBe('clipboard.read-unsupported')
  })
})

describe('G-24 B2 p-deeplink（深链——04 §深链 参数化匹配）', () => {
  it('parseDeepLink：scheme://host/path?query 多形态 + 相对路径 + 非法', () => {
    expect(parseDeepLink('proteus://user/profile?id=1&tab=orders')).toEqual({
      scheme: 'proteus',
      host: 'user',
      path: ['profile'],
      query: { id: '1', tab: 'orders' },
      raw: 'proteus://user/profile?id=1&tab=orders',
    })
    expect(parseDeepLink('https://app.example.com/order/42?from=dl')?.host).toBe('app.example.com')
    expect(parseDeepLink('/user/1')?.path).toEqual(['user', '1'])
    expect(parseDeepLink('just-a-string')).toBeNull()
    expect(parseDeepLink('')).toBeNull()
  })

  it('matchDeepLink：参数化捕获 / 字面量 / scheme 约束 / 段数不符', () => {
    expect(matchDeepLink('proteus://order/:id', 'proteus://order/42')).toEqual({ matched: true, params: { id: '42' } })
    expect(matchDeepLink('/user/:name', 'proteus://app/user/alice')).toEqual({ matched: true, params: { name: 'alice' } }) // 相对模式通配任意 scheme（host=app）
    expect(matchDeepLink('http://x/order/:id', 'proteus://order/1').matched).toBe(false) // scheme 不符
    expect(matchDeepLink('proteus://user/:id', 'proteus://user/1/extra').matched).toBe(false)
    expect(matchDeepLink('proteus://user/me', 'proteus://user/me')).toEqual({ matched: true, params: {} })
  })
})
