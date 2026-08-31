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
  ConsoleEntry,
  NetworkEntry,
  MpDebuggerLike,
  WxApiHandle,
  TicketHandle,
  CdpHandle,
} from './types'

const DEFAULT_TIMEOUT = 5000
/** 单次元素查询超时（automator page.$ 在模拟器未激活/IDE 协议异常时挂起无响应——实测 8s+ 无返回） */
const QUERY_TIMEOUT = 3000

/** ★元素查询诊断（05 已知限制）：$ 挂起 = 模拟器激活态/IDE 协议问题，给可行动提示而非静默拖死用例 */
const ELEMENT_QUERY_HINT =
  'MP 元素查询超时——automator page.$ 在模拟器未激活/IDE 协议异常时挂起（05 已知限制）：' +
  '① 激活模拟器页面（点 IDE 窗口/模拟器）后重试；② 改用稳通道断言（currentPage/systemInfo/evaluate）；③ 元素级交互待模拟器激活态场景'

/** ★有界调用：automator 部分协议方法（page.$/screenshot）挂起无超时 → Promise.race 兜底，超时抛诊断 */
async function withBound<T>(p: Promise<T> | null | undefined, label: string, hint = ''): Promise<T | null> {
  if (p == null) return null
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`[test-core/driver] ${label} 超时（${QUERY_TIMEOUT}ms）${hint ? `——${hint}` : ''}`)), QUERY_TIMEOUT)
    }),
  ])
}

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
      // ★$ 挂起（激活态/协议）→ 快速失败诊断；返回 null → 正常轮询（页面/元素异步渲染）
      const el = await withBound(page.$?.(this.selector), `MP 元素查询 ${this.selector}`, ELEMENT_QUERY_HINT)
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
        const el = await withBound(page.$?.(this.selector), `MP 元素查询 ${this.selector}`, ELEMENT_QUERY_HINT)
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
    return Boolean(await withBound(page.$?.(this.selector), `MP 元素查询 ${this.selector}`, ELEMENT_QUERY_HINT))
  }
}

/** ★统一测试 API MP 实现：注入 automator miniProgram（launch/connect 由 CLI/用户装配）+ 可选 debugger 句柄（wechatide 工具） */
export function createMpDriver(mini: AutomatorMiniLike, debuggerHandle?: MpDebuggerLike): TestDriver {
  // ★wx API 句柄（automator 原生 callWxMethod/mockWxMethod/restoreWxMethod）
  const wxApi: WxApiHandle = {
    async call<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T> {
      return mini.callWxMethod!(method, args) as Promise<T>
    },
    async mock<T = unknown>(method: string, impl: ((...args: any[]) => T) | T): Promise<void> {
      await mini.mockWxMethod!(method, typeof impl === 'function' ? (impl as (...args: any[]) => T) : () => impl)
    },
    async restore(method: string): Promise<void> {
      await mini.restoreWxMethod!(method)
    },
  }
  // ★登录凭据句柄（automator 原生 getTicket/setTicket/refreshTicket/testAccounts）
  const ticket: TicketHandle = {
    async set(t: string): Promise<void> {
      await mini.setTicket!(t)
    },
    async get(): Promise<string> {
      return (await mini.getTicket!()) as string
    },
    async refresh(): Promise<void> {
      await mini.refreshTicket!()
    },
    async testAccounts(): Promise<unknown> {
      return mini.testAccounts!()
    },
  }
  // ★debug 能力降级提示（wechatide 工具能力：automator 无 console/network/clearCache/refresh——需注入 debugger 句柄）
  const needDebugger = (what: string): never => {
    throw new Error(`[test-core/driver] ${what} 需要注入 wechatide debugger 句柄（createMpDriver(mini, debugger)：console/network/clearCache/refresh 是 IDE 工具能力）`)
  }
  // ★CDP 降级（小程序无 CDP 概念——渲染是原生 WXML，非 Chromium）
  const cdp: CdpHandle = {
    async send(): Promise<never> {
      throw new Error('[test-core/driver] cdp 是小程序端不适用能力（无 CDP——渲染是原生 WXML 非 Chromium；用 evaluate/wxApi 替代）')
    },
    on(): never {
      throw new Error('[test-core/driver] cdp 是小程序端不适用能力（无 CDP——渲染是原生 WXML 非 Chromium）')
    },
  }
  return {
    platform: 'mp',
    wxApi,
    ticket,
    cdp,
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
    // ★debug 能力（wechatide 工具：console/network/clearCache/refresh——automator 无这些 API，需注入 debugger 句柄）
    async consoleLogs(filter?: string): Promise<ConsoleEntry[]> {
      if (!debuggerHandle?.consoleGrep) needDebugger('consoleLogs')
      // wechatide get_simulator_console：grep 命令字符串（缺省全量）；行首 [level] 猜测级别
      const lines = await debuggerHandle!.consoleGrep!(filter ? `grep -i '${filter}'` : 'grep -v ""')
      return lines.map((line) => ({ level: guessLevel(line), text: line }))
    },
    async networkRequests(filter?: string): Promise<NetworkEntry[]> {
      if (!debuggerHandle?.networkGrep) needDebugger('networkRequests')
      const lines = await debuggerHandle!.networkGrep!(filter ? `grep -i '${filter}'` : 'grep -v ""')
      return lines.map((line) => ({ url: extractUrl(line), text: line }))
    },
    async clearCache(): Promise<void> {
      if (!debuggerHandle?.clearCache) needDebugger('clearCache')
      await debuggerHandle!.clearCache!()
    },
    async refresh(): Promise<void> {
      if (!debuggerHandle?.refresh) needDebugger('refresh')
      await debuggerHandle!.refresh!()
    },
  }
}

/** 行首 [level] 猜测（wechatide console grep 行可能带 [log]/[error] 前缀） */
function guessLevel(line: string): ConsoleEntry['level'] {
  const m = line.match(/^\[?(log|info|warn|error|debug)\]?/i)
  return m ? (m[1].toLowerCase() as ConsoleEntry['level']) : undefined
}

/** 行内提取 URL（wechatide network grep 行含请求 URL） */
function extractUrl(line: string): string {
  const m = line.match(/https?:\/\/[^\s"'<>]+/i)
  return m ? m[0] : line.slice(0, 120)
}
