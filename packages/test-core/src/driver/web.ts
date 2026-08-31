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
  ConsoleEntry,
  NetworkEntry,
  WxApiHandle,
  TicketHandle,
} from './types'

const DEFAULT_TIMEOUT = 5000

/** MP 独有能力降级错误（web 无 wx API/登录凭据对等——业务侧已收口 platformAPI/框架自有登录） */
function mpOnlyError(what: string): Error {
  return new Error(`[test-core/driver] ${what} 是小程序独有能力（web 无对等——业务已收口 platformAPI）`)
}

/** ★debug 收集缓冲：console/request/response 事件 → 条目列表（page.on 可选，未注入则收集不可用） */
class DebugBuffer {
  private readonly consoles: ConsoleEntry[] = []
  private readonly networks: NetworkEntry[] = []
  constructor(page: PlaywrightPageLike) {
    if (page.on) {
      page.on('console', (msg: unknown) => {
        const m = msg as { type?(): string; text?(): string }
        this.consoles.push({
          level: normalizeLevel(m.type?.()),
          text: m.text?.() ?? String(msg),
        })
      })
      page.on('pageerror', (err: unknown) => {
        this.consoles.push({ level: 'error', text: err instanceof Error ? err.message : String(err) })
      })
      page.on('request', (req: unknown) => {
        const r = req as { url?(): string; method?(): string }
        this.networks.push({ url: r.url?.() ?? '', method: r.method?.(), text: `${r.method?.() ?? 'GET'} ${r.url?.() ?? ''}` })
      })
      page.on('response', (res: unknown) => {
        const r = res as { url?(): string; status?(): number }
        const hit = this.networks.find((n) => n.url === r.url?.() && n.status === undefined)
        if (hit) hit.status = r.status?.()
      })
    }
  }
  consolesOf(filter?: string): ConsoleEntry[] {
    return filter ? this.consoles.filter((c) => c.text.includes(filter)) : [...this.consoles]
  }
  networksOf(filter?: string): NetworkEntry[] {
    return filter ? this.networks.filter((n) => n.url.includes(filter)) : [...this.networks]
  }
}

function normalizeLevel(type?: string): ConsoleEntry['level'] {
  if (type === 'warning') return 'warn'
  if (type === 'error' || type === 'warn' || type === 'info' || type === 'debug' || type === 'log') return type
  return undefined
}

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
  const buffer = new DebugBuffer(page)
  // ★web 降级（小程序独有能力：wx API 业务已收口 platformAPI；登录凭据 web 无对等）
  const wxApi: WxApiHandle = {
    async call(): Promise<never> {
      throw mpOnlyError('wxApi.call')
    },
    async mock(): Promise<never> {
      throw mpOnlyError('wxApi.mock')
    },
    async restore(): Promise<never> {
      throw mpOnlyError('wxApi.restore')
    },
  }
  const ticket: TicketHandle = {
    async set(): Promise<never> {
      throw mpOnlyError('ticket.set')
    },
    async get(): Promise<never> {
      throw mpOnlyError('ticket.get')
    },
    async refresh(): Promise<never> {
      throw mpOnlyError('ticket.refresh')
    },
    async testAccounts(): Promise<never> {
      throw mpOnlyError('ticket.testAccounts')
    },
  }
  return {
    platform: 'web',
    wxApi,
    ticket,
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
      // ★evaluate 传裸表达式字符串（playwright 按表达式求值返回其值；箭头函数源码会返回函数对象）
      //   字符串不经 TS 类型检查（test-core build lib 仅 ES2020 无 DOM）
      const ua = await page.evaluate<string>('navigator.userAgent')
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
    // ★debug 能力（web 事件收集）：console/request/response（page.on 未注入时返回空数组）
    async consoleLogs(filter?: string): Promise<ConsoleEntry[]> {
      return buffer.consolesOf(filter)
    },
    async networkRequests(filter?: string): Promise<NetworkEntry[]> {
      return buffer.networksOf(filter)
    },
    async clearCache(): Promise<void> {
      // localStorage/sessionStorage 清理（cookies 由用户 context 管理）；★字符串逗号表达式（不经 TS 类型检查 + playwright 表达式求值）
      await page.evaluate('(localStorage.clear(), sessionStorage.clear())')
    },
    async refresh(): Promise<void> {
      await page.reload()
    },
  }
}
