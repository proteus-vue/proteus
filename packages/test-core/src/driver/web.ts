// packages/test-core/src/driver/web.ts
// ★统一测试 API Web 实现：Playwright Page 适配（04-e2e-web-playwright.md）
// 能力域 → playwright：navigate=page.goto / element=page.locator（惰性重查）/ evaluate=page.evaluate
// ★长按 web 无原生语义 → mousedown + 延时 + mouseup 模拟（MVP 边界）
import type {
  PlaywrightPageLike,
  PlaywrightLocatorLike,
  TestDriver,
  TestElement,
  TestElementOptions,
  ElementWaitOptions,
  PageSnapshot,
  SystemSnapshot,
} from './types'

const DEFAULT_TIMEOUT = 5000

/** Web 元素（locator 惰性查询：每次操作 Playwright 重查当前 DOM） */
class WebElement implements TestElement {
  constructor(
    private readonly page: PlaywrightPageLike,
    private readonly selector: string,
    private readonly options?: TestElementOptions,
  ) {}

  private locator(): PlaywrightLocatorLike {
    return this.page.locator(this.selector)
  }

  async tap(_options?: TestElementOptions): Promise<void> {
    await this.locator().click({ timeout: this.options?.timeout ?? DEFAULT_TIMEOUT })
  }

  async input(text: string, _options?: TestElementOptions): Promise<void> {
    await this.locator().fill(text, { timeout: this.options?.timeout ?? DEFAULT_TIMEOUT })
  }

  async longPress(durationMs = 600): Promise<void> {
    // ★web 无原生长按：mousedown → 延时 → mouseup（触发长按类业务逻辑的近似路径；事件派发在目标元素）
    const loc = this.locator()
    await loc.hover()
    await loc.dispatchEvent('mousedown')
    await this.page.waitForTimeout(durationMs)
    await loc.dispatchEvent('mouseup')
  }

  async text(_options?: TestElementOptions): Promise<string> {
    return (await this.locator().textContent()) ?? ''
  }

  async value(_options?: TestElementOptions): Promise<string> {
    return this.locator().inputValue()
  }

  async attribute(name: string): Promise<string | null> {
    return this.locator().getAttribute(name)
  }

  async waitFor(options?: ElementWaitOptions): Promise<void> {
    // 状态映射：attached/visible/detached → playwright waitFor state（对齐 ElementWaitState，不含 hidden）
    await this.locator().waitFor({
      state: options?.state ?? 'visible',
      timeout: options?.timeout ?? DEFAULT_TIMEOUT,
    })
  }

  async exists(_options?: TestElementOptions): Promise<boolean> {
    return (await this.locator().count()) > 0
  }
}

/** ★统一测试 API Web 实现：注入 playwright Page */
export function createWebDriver(page: PlaywrightPageLike): TestDriver {
  return {
    platform: 'web',
    async close(): Promise<void> {
      // 浏览器实例由用户句柄管理（launch/close 生命周期不进 driver）
    },
    async navigate(url: string): Promise<void> {
      await page.goto(url)
    },
    async reLaunch(url: string): Promise<void> {
      await page.goto(url)
    },
    async back(): Promise<void> {
      await page.goBack()
    },
    async currentPage(): Promise<PageSnapshot> {
      const url = page.url()
      return { path: url.replace(/^[a-z]+:\/\/[^/]+/, ''), url }
    },
    async systemInfo(): Promise<SystemSnapshot> {
      const ua = await page.evaluate<string>(`() => navigator.userAgent`)
      return { platform: 'web', version: ua.slice(0, 200), userAgent: ua }
    },
    element(selector: string, options?: TestElementOptions): TestElement {
      return new WebElement(page, selector, options)
    },
    async evaluate<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T> {
      return page.evaluate<T>(fn, ...args)
    },
    async screenshot(path?: string): Promise<string> {
      if (!path) return ''
      const result = await page.screenshot({ path })
      return result && typeof result === 'object' && 'path' in result && typeof result.path === 'string' ? result.path : path
    },
    async waitFor(ms: number): Promise<void> {
      await page.waitForTimeout(ms)
    },
  }
}
