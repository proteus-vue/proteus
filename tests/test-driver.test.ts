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
  const page: PlaywrightPageLike & { goto: ReturnType<typeof vi.fn>; goBack: ReturnType<typeof vi.fn> } = {
    goto: vi.fn(async () => undefined),
    goBack: vi.fn(async () => undefined),
    url: vi.fn(() => 'http://localhost:4175/pages/index'),
    evaluate: vi.fn(async (_fn: string | ((...a: unknown[]) => unknown), ...args: unknown[]) => args[0] ?? 'Mozilla'),
    waitForTimeout: vi.fn(async () => undefined),
    screenshot: vi.fn(async (opts?: { path?: string }) => ({ path: opts?.path ?? '/tmp/web.png' })),
    locator: vi.fn(() => el),
  }
  return { page, el }
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
  const mini: AutomatorMiniLike & { reLaunch: ReturnType<typeof vi.fn>; currentPage: ReturnType<typeof vi.fn>; systemInfo: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } = {
    reLaunch: vi.fn(async (url: string) => ({ path: url.replace(/^\//, '') })),
    currentPage: vi.fn(async () => ({ path: 'pages/index', $: vi.fn(async () => element) })),
    systemInfo: vi.fn(async () => ({ platform: 'devtools', SDKVersion: '3.16.2' })),
    evaluate: vi.fn(async (_fn: string | ((...a: unknown[]) => unknown), ...args: unknown[]) => args[0] ?? 'devtools'),
    screenshot: vi.fn(async (opts?: { path?: string }) => ({ path: opts?.path ?? '/tmp/mp.png' })),
    disconnect: vi.fn(),
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
    expect(mini.evaluate).toHaveBeenCalledWith(expect.stringContaining('wx.navigateBack'))
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
    expect(mini.evaluate).toHaveBeenCalledWith(expect.stringContaining('setTimeout'), 100)
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
