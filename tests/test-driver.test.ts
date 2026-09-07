// tests/test-driver.test.ts
// ★test-framework 统一测试 API（E2E 层）：TestDriver 一套能力接口 → web（Playwright）/ mp（automator）双端分发
// 用 vi.fn fake 句柄验证统一接口分发（不真实 launch——真机链路走 e2e-mp/e2e-web 独立文件）
// 能力域对照 wechatide-skill automator 意图→工具表：navigate/runtime-info/element-action/evaluate/screenshot/wait
import { describe, it, expect, vi } from 'vitest'
import { createDriver } from '@proteus-vue/test-core/driver'
import type { TestDriver, PlaywrightPageLike, AutomatorMiniLike } from '@proteus-vue/test-core/driver'

/** fake playwright Page（形状兼容 PlaywrightPageLike） */
function fakePage() {
  const el = {
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    textContent: vi.fn(async () => 'counter: 1'),
    inputValue: vi.fn(async () => '7'),
    getAttribute: vi.fn(async () => 'primary'),
    waitFor: vi.fn(async () => undefined),
    count: vi.fn(async () => 1),
    dispatchEvent: vi.fn(async () => undefined),
    hover: vi.fn(async () => undefined),
  }
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
  const page = {
    goto: vi.fn(async () => undefined),
    goBack: vi.fn(async () => undefined),
    url: vi.fn(() => 'http://localhost:4175/pages/index'),
    evaluate: vi.fn(async (_fn: string | ((...a: unknown[]) => unknown), ...args: unknown[]) => args[0] ?? 'Mozilla'),
    waitForTimeout: vi.fn(async () => undefined),
    screenshot: vi.fn(async (opts?: { path?: string }) => ({ path: opts?.path ?? '/tmp/web.png' })),
    locator: vi.fn(() => el),
    reload: vi.fn(async () => undefined),
    // ★debug 事件收集：console/request/response（模拟 playwright 事件订阅）
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      ;(handlers[event] ??= []).push(handler)
    }),
    // ★整体断言（vi.fn Mock 与 PlaywrightPageLike 交叉类型逆变冲突——fake 句柄不需要严格类型）
  } as unknown as PlaywrightPageLike & {
    goto: ReturnType<typeof vi.fn>
    goBack: ReturnType<typeof vi.fn>
    reload: ReturnType<typeof vi.fn>
  }
  return { page, el, handlers }
}

/** fake automator miniProgram（形状兼容 AutomatorMiniLike） */
function fakeMini() {
  const element = {
    tap: vi.fn(async () => undefined),
    input: vi.fn(async () => undefined),
    longPress: vi.fn(async () => undefined),
    text: vi.fn(async () => 'counter: 1'),
    value: vi.fn(async () => '7'),
  }
  const mini = {
    reLaunch: vi.fn(async (url: string) => ({ path: url.replace(/^\//, '') })),
    currentPage: vi.fn(async () => ({ path: 'pages/index', $: vi.fn(async () => element) })),
    systemInfo: vi.fn(async () => ({ platform: 'devtools', SDKVersion: '3.16.2' })),
    evaluate: vi.fn(async (_fn: string | ((...a: unknown[]) => unknown), ...args: unknown[]) => args[0] ?? 'devtools'),
    screenshot: vi.fn(async (opts?: { path?: string }) => ({ path: opts?.path ?? '/tmp/mp.png' })),
    disconnect: vi.fn(),
    // ★wx API（automation_wx_api）
    callWxMethod: vi.fn(async () => ({ ok: true })),
    mockWxMethod: vi.fn(async () => undefined),
    restoreWxMethod: vi.fn(async () => undefined),
    // ★登录凭据（automation_testaccount）
    setTicket: vi.fn(async () => undefined),
    getTicket: vi.fn(async () => 'ticket-abc'),
    refreshTicket: vi.fn(async () => undefined),
    testAccounts: vi.fn(async () => [{ name: '测试号A' }]),
    // ★整体断言（vi.fn Mock 与 AutomatorMiniLike 交叉类型逆变冲突——fake 句柄不需要严格类型）
  } as unknown as AutomatorMiniLike & {
    reLaunch: ReturnType<typeof vi.fn>
    currentPage: ReturnType<typeof vi.fn>
    systemInfo: ReturnType<typeof vi.fn>
    evaluate: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    callWxMethod: ReturnType<typeof vi.fn>
    mockWxMethod: ReturnType<typeof vi.fn>
    restoreWxMethod: ReturnType<typeof vi.fn>
    setTicket: ReturnType<typeof vi.fn>
    getTicket: ReturnType<typeof vi.fn>
    refreshTicket: ReturnType<typeof vi.fn>
    testAccounts: ReturnType<typeof vi.fn>
  }
  return { mini, element }
}

describe('createDriver（统一入口：platform + 注入句柄）', () => {
  it('web：navigate/reLaunch/back → page.goto/goBack', async () => {
    const { page } = fakePage()
    const driver = createDriver({ platform: 'web', page })
    await driver.navigate('/pages/home')
    await driver.reLaunch('/pages/index')
    await driver.back()
    expect(page.goto).toHaveBeenCalledTimes(2)
    expect(page.goto).toHaveBeenNthCalledWith(1, '/pages/home')
    expect(page.goto).toHaveBeenNthCalledWith(2, '/pages/index')
    expect(page.goBack).toHaveBeenCalledTimes(1)
  })

  it('mp：navigate/reLaunch → mini.reLaunch（05 经验：reLaunch 全链路最稳）；back → evaluate wx.navigateBack', async () => {
    const { mini } = fakeMini()
    const driver = createDriver({ platform: 'mp', mini })
    await driver.navigate('/pages/home')
    await driver.reLaunch('/pages/index')
    await driver.back()
    expect(mini.reLaunch).toHaveBeenNthCalledWith(1, '/pages/home')
    expect(mini.reLaunch).toHaveBeenNthCalledWith(2, '/pages/index')
    // ★evaluate 传函数（automator 序列化）——断言函数体含 wx.navigateBack
    const backFn = mini.evaluate.mock.calls[0][0] as (() => unknown)
    expect(backFn.toString()).toContain('wx.navigateBack')
  })

  it('currentPage/systemInfo：两端统一 PageSnapshot/SystemSnapshot 形状', async () => {
    const web = createDriver({ platform: 'web', page: fakePage().page })
    const wPage = await web.currentPage()
    expect(wPage).toEqual({ path: '/pages/index', url: 'http://localhost:4175/pages/index' })
    const wInfo = await web.systemInfo()
    expect(wInfo.platform).toBe('web')
    expect(wInfo.version).toContain('Mozilla')

    const mp = createDriver({ platform: 'mp', mini: fakeMini().mini })
    const mPage = await mp.currentPage()
    expect(mPage).toEqual({ path: 'pages/index', url: '' })
    const mInfo = await mp.systemInfo()
    expect(mInfo.platform).toBe('devtools')
    expect(mInfo.SDKVersion).toBe('3.16.2')
  })

  it('element：统一 TestElement（tap/input/text/value/attribute/waitFor/exists）双端分发', async () => {
    const { page, el } = fakePage()
    const web = createDriver({ platform: 'web', page })
    const wEl = web.element('.c button')
    await wEl.tap()
    await wEl.input('hi')
    expect(await wEl.text()).toBe('counter: 1')
    expect(await wEl.value()).toBe('7')
    expect(await wEl.attribute('type')).toBe('primary')
    await wEl.waitFor()
    expect(await wEl.exists()).toBe(true)
    expect(page.locator).toHaveBeenCalledWith('.c button')
    expect(el.click).toHaveBeenCalledTimes(1)
    expect(el.fill).toHaveBeenCalledWith('hi', expect.anything())

    const { mini, element } = fakeMini()
    const mp = createDriver({ platform: 'mp', mini })
    const mEl = mp.element('button')
    await mEl.tap()
    await mEl.input('hi')
    expect(await mEl.text()).toBe('counter: 1')
    expect(await mEl.value()).toBe('7')
    await mEl.waitFor()
    expect(await mEl.exists()).toBe(true)
    expect(element.tap).toHaveBeenCalledTimes(1)
    expect(element.input).toHaveBeenCalledWith('hi')
  })

  it('evaluate/screenshot/waitFor：两端能力对齐（automation_evaluate / simulator_screenshot）', async () => {
    const { page } = fakePage()
    const web = createDriver({ platform: 'web', page })
    await web.evaluate('() => 42')
    expect(await web.screenshot('/tmp/web.png')).toBe('/tmp/web.png')
    await web.waitFor(100)
    expect(page.waitForTimeout).toHaveBeenCalledWith(100)

    const { mini } = fakeMini()
    const mp = createDriver({ platform: 'mp', mini })
    await mp.evaluate('() => wx.getSystemInfoSync()')
    expect(await mp.screenshot('/tmp/mp.png')).toBe('/tmp/mp.png')
    await mp.waitFor(100)
    // ★evaluate 传函数 + 参数（automator 序列化）——断言第二参数透传 100
    expect(mini.evaluate).toHaveBeenCalledWith(expect.any(Function), 100)
    expect(mini.screenshot).toHaveBeenCalledWith({ path: '/tmp/mp.png' })
  })
})

describe('★一套能力接口多端复用（统一测试 API 目标形态）', () => {
  it('同一份业务用例代码 → web/mp 双端跑（fake 句柄验证分发一致性）', async () => {
    /** 跨端业务用例：只碰统一能力接口（driver），不写 page./mini. 平台 API */
    const runShared = async (driver: TestDriver): Promise<void> => {
      await driver.reLaunch('/pages/index')
      const btn = driver.element('button')
      await btn.waitFor()
      await btn.tap()
      await driver.waitFor(100)
      const cur = await driver.currentPage()
      expect(cur.path).toContain('pages/index')
      const info = await driver.systemInfo()
      expect(info.platform).toBeTruthy()
      await driver.screenshot()
    }
    const web = createDriver({ platform: 'web', page: fakePage().page })
    const mp = createDriver({ platform: 'mp', mini: fakeMini().mini })
    await runShared(web)
    await runShared(mp)
  })

  it('close：web 空操作（浏览器句柄用户管）/ mp 解绑 disconnect', async () => {
    const web = createDriver({ platform: 'web', page: fakePage().page })
    await expect(web.close()).resolves.toBeUndefined()
    const { mini } = fakeMini()
    const mp = createDriver({ platform: 'mp', mini })
    await mp.close()
    expect(mini.disconnect).toHaveBeenCalledTimes(1)
  })
})

describe('debug 能力域（console/network/clearCache/refresh——wechatide debugger 域）', () => {
  it('web：console/network 事件收集 + clearCache + refresh', async () => {
    const { page, handlers } = fakePage()
    const driver = createDriver({ platform: 'web', page })
    // 模拟 console/request/response 事件
    handlers.console?.forEach((h) => h({ type: () => 'error', text: () => 'boom' }))
    handlers.request?.forEach((h) => h({ url: () => 'https://api.example.com/x', method: () => 'POST' }))
    handlers.response?.forEach((h) => h({ url: () => 'https://api.example.com/x', status: () => 200 }))
    const logs = await driver.consoleLogs()
    expect(logs).toEqual([{ level: 'error', text: 'boom' }])
    expect(await driver.consoleLogs('nope')).toEqual([]) // filter 生效
    const nets = await driver.networkRequests()
    expect(nets).toHaveLength(1)
    expect(nets[0].method).toBe('POST')
    expect(nets[0].status).toBe(200)
    expect(nets[0].url).toContain('api.example.com')
    await driver.clearCache()
    expect(page.evaluate).toHaveBeenCalledWith('(localStorage.clear(), sessionStorage.clear())')
    await driver.refresh()
    expect(page.reload).toHaveBeenCalledTimes(1)
  })

  it('mp：console/network/clearCache/refresh 走注入 debugger 句柄（wechatide 工具）；未注入抛错提示', async () => {
    const { mini } = fakeMini()
    // 未注入 debugger → 抛错提示
    const bare = createDriver({ platform: 'mp', mini })
    await expect(bare.consoleLogs()).rejects.toThrow(/注入 wechatide debugger 句柄/)
    await expect(bare.refresh()).rejects.toThrow(/注入 wechatide debugger 句柄/)
    // 注入 debugger 句柄 → 转发
    const consoleGrep = vi.fn(async () => ['[error] boom'])
    const networkGrep = vi.fn(async () => ['POST https://api.example.com/x 200'])
    const clearCache = vi.fn(async () => undefined)
    const refresh = vi.fn(async () => undefined)
    const mp = createDriver({ platform: 'mp', mini, debugger: { consoleGrep, networkGrep, clearCache, refresh } })
    const logs = await mp.consoleLogs('boom')
    expect(logs).toEqual([{ level: 'error', text: '[error] boom' }])
    expect(consoleGrep).toHaveBeenCalledWith(expect.stringContaining('boom'))
    const nets = await mp.networkRequests()
    expect(nets[0].url).toContain('https://api.example.com/x')
    expect(nets[0].text).toContain('200')
    await mp.clearCache()
    expect(clearCache).toHaveBeenCalledTimes(1)
    await mp.refresh()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('小程序独有能力（wxApi / ticket——automation_wx_api / automation_testaccount）', () => {
  it('mp：wxApi.call/mock/restore → automator callWxMethod/mockWxMethod/restoreWxMethod', async () => {
    const { mini } = fakeMini()
    const mp = createDriver({ platform: 'mp', mini })
    expect(await mp.wxApi.call('showToast', { title: 'hi' })).toEqual({ ok: true })
    expect(mini.callWxMethod).toHaveBeenCalledWith('showToast', { title: 'hi' })
    await mp.wxApi.mock('getSystemInfoSync', () => ({ platform: 'mock' }))
    await mp.wxApi.restore('getSystemInfoSync')
    expect(mini.mockWxMethod).toHaveBeenCalledWith('getSystemInfoSync', expect.any(Function))
    expect(mini.restoreWxMethod).toHaveBeenCalledWith('getSystemInfoSync')
  })

  it('mp：ticket.set/get/refresh/testAccounts → automator 原生', async () => {
    const { mini } = fakeMini()
    const mp = createDriver({ platform: 'mp', mini })
    await mp.ticket.set('ticket-x')
    expect(mini.setTicket).toHaveBeenCalledWith('ticket-x')
    expect(await mp.ticket.get()).toBe('ticket-abc')
    await mp.ticket.refresh()
    expect(mini.refreshTicket).toHaveBeenCalledTimes(1)
    expect(await mp.ticket.testAccounts()).toEqual([{ name: '测试号A' }])
  })

  it('web：wxApi/ticket 降级抛错（小程序独有能力）', async () => {
    const web = createDriver({ platform: 'web', page: fakePage().page })
    await expect(web.wxApi.call('showToast')).rejects.toThrow(/小程序独有能力/)
    await expect(web.wxApi.mock('x', 1)).rejects.toThrow(/小程序独有能力/)
    await expect(web.ticket.set('t')).rejects.toThrow(/小程序独有能力/)
    await expect(web.ticket.get()).rejects.toThrow(/小程序独有能力/)
  })
})

describe('CDP debug 能力（web：注入 CDP session 透传；mp：降级）', () => {
  it('web：注入 CDP 会话 → cdp.send/on 透传（Performance/Network/DOM 域命令）', async () => {
    const send = vi.fn(async (_method: string, params?: Record<string, unknown>) => ({ params }))
    const events: Record<string, Array<(...args: unknown[]) => void>> = {}
    const cdpSession = {
      send,
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        ;(events[event] ??= []).push(handler)
      }),
    }
    const driver = createDriver({ platform: 'web', page: fakePage().page, cdp: cdpSession as never })
    // 性能追踪（CDP 域命令透传）
    await driver.cdp.send('Performance.enable')
    await driver.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 200, downloadThroughput: 1000, uploadThroughput: 1000 })
    expect(send).toHaveBeenNthCalledWith(1, 'Performance.enable', undefined)
    expect(send).toHaveBeenNthCalledWith(2, 'Network.emulateNetworkConditions', expect.objectContaining({ latency: 200 }))
    // CDP 事件订阅
    const handler = vi.fn()
    driver.cdp.on('Network.requestWillBeSent', handler)
    events['Network.requestWillBeSent']?.forEach((h) => h({ request: { url: 'https://x.com' } }))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('web：未注入 CDP 会话 → 抛错提示（createWebDriver 第二参数）', async () => {
    const web = createDriver({ platform: 'web', page: fakePage().page })
    await expect(web.cdp.send('Performance.enable')).rejects.toThrow(/注入 CDP 会话/)
  })

  it('mp：cdp 降级抛错（无 CDP 概念——渲染是原生 WXML 非 Chromium）', async () => {
    const mp = createDriver({ platform: 'mp', mini: fakeMini().mini })
    await expect(mp.cdp.send('Performance.enable')).rejects.toThrow(/小程序端不适用/)
  })
})
