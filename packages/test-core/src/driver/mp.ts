// packages/test-core/src/driver/mp.ts
// ★统一测试 API MP 实现：miniprogram-automator 适配（05-e2e-mp-automator.md）
// ★经验内化：Page.getData/getElement 受模拟器激活态影响 → 断言走 reLaunch/currentPage/systemInfo/evaluate；
//   元素操作每次重新解析（currentPage().$()，导航后自然失效重查，不缓存）
// 能力域 → automator：navigate/reLaunch=mini.reLaunch（全链路最稳）/ element=currentPage().$() / evaluate=mini.evaluate
import type {
  AutomatorMiniLike,
  AutomatorElementLike,
  TestDriver,
  TestElement,
  TestElementOptions,
  ElementWaitOptions,
  PageSnapshot,
  SystemSnapshot,
} from './types'

const DEFAULT_TIMEOUT = 5000

/** ★MP 元素：每次操作重新解析（不缓存——导航后页面实例变化，旧引用失效） */
class MpElement implements TestElement {
  constructor(
    private readonly mini: AutomatorMiniLike,
    private readonly selector: string,
    private readonly options?: TestElementOptions,
  ) {}

  /** 解析当前页面下的元素；缺省在单次操作超时内轮询（页面/元素异步渲染） */
  private async resolve(timeout = this.options?.timeout ?? DEFAULT_TIMEOUT): Promise<AutomatorElementLike> {
    const deadline = Date.now() + timeout
    for (;;) {
      const page = await this.mini.currentPage()
      const el = await page.$?.(this.selector)
      if (el) return el
      if (Date.now() >= deadline) {
        throw new Error(`[test-core/driver] MP 元素未找到：${this.selector}（${timeout}ms）——用 querySelectorAll 核对选择器或等待页面渲染`)
      }
      // ★evaluate 必须传函数（automator 内部 t.toString() 序列化；传字符串会直接原样下发导致运行时无响应挂起）
      await this.mini.evaluate(() => new Promise((r) => setTimeout(r, 200)))
    }
  }

  async tap(_options?: TestElementOptions): Promise<void> {
    await (await this.resolve()).tap()
  }

  async input(text: string, _options?: TestElementOptions): Promise<void> {
    await (await this.resolve()).input(text)
  }

  async longPress(durationMs = 600): Promise<void> {
    await (await this.resolve()).longPress(durationMs)
  }

  async text(_options?: TestElementOptions): Promise<string> {
    return (await this.resolve()).text()
  }

  async value(_options?: TestElementOptions): Promise<string> {
    return (await this.resolve()).value()
  }

  async attribute(name: string): Promise<string | null> {
    const el = await this.resolve()
    // automator 元素无通用属性 API → 有原生支持用之，否则 MVP 返回 null（读属性请走 evaluate/文本断言）
    return el.attribute ? el.attribute(name) : null
  }

  async waitFor(options?: ElementWaitOptions): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT
    if (options?.state === 'detached') {
      // 等待消失：轮询直到解析失败
      const deadline = Date.now() + timeout
      for (;;) {
        const page = await this.mini.currentPage()
        const el = await page.$?.(this.selector)
        if (!el) return
        if (Date.now() >= deadline) throw new Error(`[test-core/driver] MP 元素未消失：${this.selector}（${timeout}ms）`)
        await this.mini.evaluate(() => new Promise((r) => setTimeout(r, 200)))
      }
    }
    // attached/visible：轮询解析成功
    await this.resolve(timeout)
  }

  async exists(_options?: TestElementOptions): Promise<boolean> {
    const page = await this.mini.currentPage()
    return Boolean(await page.$?.(this.selector))
  }
}

/** ★统一测试 API MP 实现：注入 automator miniProgram（launch/connect 由 CLI/用户装配） */
export function createMpDriver(mini: AutomatorMiniLike): TestDriver {
  return {
    platform: 'mp',
    async close(): Promise<void> {
      mini.disconnect()
    },
    async navigate(url: string): Promise<void> {
      // ★05 经验：reLaunch 全链路最稳（重置页面栈，不依赖激活态）
      await mini.reLaunch(url)
    },
    async reLaunch(url: string): Promise<void> {
      await mini.reLaunch(url)
    },
    async back(): Promise<void> {
      // automator 无 miniProgram.navigateBack → 全局 wx.navigateBack 降级（栈空时静默失败）
      // ★globalThis 访问（test-core build 无 miniprogram 类型；小程序运行时 evaluate 上下文 globalThis.wx 存在）
      await mini.evaluate(
        () => (globalThis as unknown as { wx: { navigateBack(opts: unknown): void } }).wx.navigateBack({}),
      )
    },
    async currentPage(): Promise<PageSnapshot> {
      const cur = await mini.currentPage()
      return { path: cur.path, url: '' }
    },
    async systemInfo(): Promise<SystemSnapshot> {
      const info = await mini.systemInfo()
      return { platform: String(info.platform ?? 'unknown'), version: info.SDKVersion != null ? String(info.SDKVersion) : undefined, ...info }
    },
    element(selector: string, options?: TestElementOptions): TestElement {
      return new MpElement(mini, selector, options)
    },
    async evaluate<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T> {
      return mini.evaluate(fn as (() => unknown) | string, ...args) as Promise<T>
    },
    async screenshot(path?: string): Promise<string> {
      const result = await mini.screenshot({ path })
      return result?.path ?? path ?? ''
    },
    async waitFor(ms: number): Promise<void> {
      // automator 无 mini 级 waitFor → evaluate 延时（★必须传函数，见 resolve 注释）
      await mini.evaluate((delay) => new Promise((r) => setTimeout(r, delay)), ms)
    },
  }
}
