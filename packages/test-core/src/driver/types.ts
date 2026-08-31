// packages/test-core/src/driver/types.ts
// ★test-framework 统一测试 API（E2E 层）：TestDriver 多端自动化能力接口
// ★能力域对照 wechatide-skill automator「意图→工具」表（docs/wechatide-skill/skills/automator/SKILL.md）：
//   automation_navigate → navigate/reLaunch/back；automation_runtime_info → currentPage/systemInfo
//   querySelectorAll → element；automation_element_action → TestElement（tap/input/longPress/read）
//   automation_evaluate → evaluate；simulator_screenshot → screenshot；waitForSelector/wait → waitFor
// ★实现采用「注入句柄 + 结构类型」：Web 传 playwright Page、MP 传 automator miniProgram（形状兼容即用）
//   ——test-core 零新增运行时依赖；两端句柄由用户/CLI 装配后传入
// ★MP 经验内化（05-e2e-mp-automator.md）：Page.getData/getElement 受模拟器激活态影响 →
//   driver 以 reLaunch/currentPage/systemInfo/evaluate 为稳定断言通道，元素操作每次重新解析（不缓存）

/** 页面快照（automation_runtime_info → currentPage） */
export interface PageSnapshot {
  /** 路径：web = URL pathname；mp = 页面 route（pages/index） */
  path: string
  /** 完整 URL（mp 无此概念时为空串） */
  url: string
}

/** 运行时快照（systemInfo） */
export interface SystemSnapshot {
  /** web = 'web'；mp = automator systemInfo().platform（devtools/ios/android/...） */
  platform: string
  /** mp 基础库版本；web 为浏览器 userAgent 截断 */
  version?: string
  [key: string]: unknown
}

/** 元素等待状态（waitForSelector 语义） */
export type ElementWaitState = 'attached' | 'visible' | 'detached'

export interface ElementWaitOptions {
  timeout?: number
  state?: ElementWaitState
}

export interface TestElementOptions {
  /** 单次元素操作超时（ms，缺省 5000） */
  timeout?: number
}

/**
 * ★统一元素（automation_element_action / Playwright locator）
 * MP 端每次操作重新解析（导航后自然失效重查）；Web 端 locator 惰性查询（Playwright 语义）
 */
export interface TestElement {
  /** 点击（automation_element_action tap / locator.click） */
  tap(options?: TestElementOptions): Promise<void>
  /** 输入文本（input / locator.fill） */
  input(text: string, options?: TestElementOptions): Promise<void>
  /** 长按（web 模拟 mousedown+延时+mouseup；mp element.longPress） */
  longPress(durationMs?: number): Promise<void>
  /** 读文本（text / locator.textContent） */
  text(options?: TestElementOptions): Promise<string>
  /** 读值（input/textarea value；mp element.value） */
  value(options?: TestElementOptions): Promise<string>
  /** 读属性（web locator.getAttribute；mp 用 evaluate 降级，null = 缺失） */
  attribute(name: string): Promise<string | null>
  /** 等待（waitForSelector 语义：attached/visible/detached） */
  waitFor(options?: ElementWaitOptions): Promise<void>
  /** 存在性（单次查询；web locator.count > 0 / mp 解析成功） */
  exists(options?: TestElementOptions): Promise<boolean>
}

/**
 * ★统一测试驱动（多端自动化测试能力接口）
 * 一套能力接口 → web（Playwright）/ mp（miniprogram-automator）/ 未来 app 各自实现
 */
export interface TestDriver {
  readonly platform: 'web' | 'mp'
  /** 关闭连接（automator disconnect / playwright browser close 由用户句柄负责，这里只解绑） */
  close(): Promise<void>
  /** 导航到页面（automation_navigate：web goto / mp reLaunch——05 经验：reLaunch 全链路最稳） */
  navigate(url: string): Promise<void>
  /** 重置到首页/指定页（reLaunch 语义，两端一致） */
  reLaunch(url: string): Promise<void>
  /** 返回上一页（web goBack / mp evaluate wx.navigateBack 降级） */
  back(): Promise<void>
  /** 当前页面快照（automation_runtime_info：web url / mp currentPage） */
  currentPage(): Promise<PageSnapshot>
  /** 运行时信息（systemInfo：web 注入 navigator 数据 / mp automator systemInfo） */
  systemInfo(): Promise<SystemSnapshot>
  /** 查找元素（querySelectorAll → 惰性元素） */
  element(selector: string, options?: TestElementOptions): TestElement
  /** 执行受控表达式（automation_evaluate：web page.evaluate / mp mini.evaluate；函数或源码字符串） */
  evaluate<T = unknown>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>
  /** 截图（simulator_screenshot：返回本地图片路径；web 不传 path 时返回空串） */
  screenshot(path?: string): Promise<string>
  /** 固定等待（ms） */
  waitFor(ms: number): Promise<void>
}

// ============ 结构类型（注入句柄最小形状，零依赖） ============

/** playwright Page 最小形状（结构兼容即可注入） */
export interface PlaywrightPageLike {
  goto(url: string, options?: unknown): Promise<unknown>
  goBack(options?: unknown): Promise<unknown>
  url(): string
  evaluate<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>
  waitForTimeout(ms: number): Promise<void>
  screenshot(options?: { path?: string }): Promise<Buffer | { path?: string }>
  locator(selector: string): PlaywrightLocatorLike
}

/** playwright Locator 最小形状 */
export interface PlaywrightLocatorLike {
  click(options?: unknown): Promise<void>
  fill(text: string, options?: unknown): Promise<void>
  textContent(options?: unknown): Promise<string | null>
  inputValue(options?: unknown): Promise<string>
  getAttribute(name: string): Promise<string | null>
  waitFor(options?: { state?: string; timeout?: number }): Promise<void>
  count(): Promise<number>
  dispatchEvent(type: string, init?: unknown): Promise<void>
  hover(options?: unknown): Promise<void>
}

/** miniprogram-automator Element 最小形状 */
export interface AutomatorElementLike {
  tap(): Promise<void>
  input(text: string): Promise<void>
  longPress(durationMs?: number): Promise<void>
  text(): Promise<string>
  value(): Promise<string>
  /** automator 无通用属性读取 → 由 MpDriver 用 evaluate 降级；可选 */
  attribute?(name: string): Promise<string | null>
}

/** miniprogram-automator MiniProgram 最小形状 */
export interface AutomatorMiniLike {
  reLaunch(url: string): Promise<{ path: string; waitFor?(ms: number): Promise<void> }>
  currentPage(): Promise<{ path: string; $?(selector: string): Promise<AutomatorElementLike | null> }>
  systemInfo(): Promise<Record<string, unknown>>
  evaluate(fn: string | ((...args: unknown[]) => unknown), ...args: unknown[]): Promise<unknown>
  screenshot(options?: { path?: string }): Promise<{ path: string }>
  disconnect(): void
  /** 复用 connect 模式（CLI 装配：PROTEUS_MP_E2E_CONNECT）——无 launch，close 语义一致 */
}
