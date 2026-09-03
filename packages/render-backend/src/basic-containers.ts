// packages/render-backend/src/basic-containers.ts
// ★G-42 B6（proteus-host-container-plan batches B6）：其余 4 种容器（权威 TS 版）
//   SinglePage（单页/卡片/IoT——单槽 replace 语义）/ Window（桌面多窗口——窗口组各持栈）/
//   MiniProgram（小程序导航语义 navigateTo/redirectTo/switchTab/reLaunch + L1 沙箱）/ Embedded（嵌入宿主页面）
//   · 全部通过 runContainerConformance（未声明能力组诚实 SKIP——CMP065：runner 门控 C-04 页面栈/C-06 配额/C-07 沙箱）
//   · 五原子销毁 + 框架代管资源池 + G-43 B3 ownership 接入（单槽内联；window/miniprogram 委托 StackContainer）
//   纯逻辑零依赖（容器不碰线程/桥——G-42.4）
import {
  canTransitionPageState,
  FIVE_ATOMIC_STEPS,
  assertAtomicDestroy,
  createDestroyReport,
  CONTAINER_PROFILES,
} from './container-spi'
import type {
  ContainerCapabilities,
  ContainerContext,
  ContainerEvent,
  DestroyReport,
  PageConfig,
  PageHandle,
  PageState,
  PressureLevel,
  ProteusHostContainer,
  QuotaManager,
  QuotaUsage,
  BizManifest,
  BusinessSandbox,
} from './container-spi'
import { createStackContainer, createResourcePool } from './stack-container'
import type { StackContainer, StackContainerOptions } from './stack-container'
import type { StackPolicy } from './container-spi'
import { createPageOwnership } from './page-ownership'
import type { PageOwnership } from './page-ownership'
import type { OwnershipGraph } from './ownership'

// ============================================================
// 单槽页面记录 + 生命周期（singlepage/embedded 共用核心）
// ============================================================

interface SlotPage extends PageHandle {
  config: PageConfig
  ir: unknown
  quotaHandle: unknown
  alive: boolean
  ownership: PageOwnership | null
}

type Emit = (event: string, payload: unknown) => void

function setSlotState(page: SlotPage, to: PageState): void {
  if (!canTransitionPageState(page.state, to)) {
    throw new Error(`G-42 状态机拒绝：${page.state} → ${to}（page ${page.pageId}）`)
  }
  ;(page as { state: PageState }).state = to
}

function makeSlotPage(seq: number, config: PageConfig, ownership: PageOwnership | null): SlotPage {
  const pageId = config.pageId ?? `page-${++seq}`
  return {
    pageId,
    irId: config.irId,
    state: 'created',
    mountPoint: null,
    resourcePool: createResourcePool(pageId),
    eventRegistry: {
      bind() {
        return () => {}
      },
      unbindAll() {},
      size: 0,
    },
    config,
    ir: { irId: config.irId },
    quotaHandle: null,
    alive: true,
    ownership,
  }
}

/** 五原子销毁（单槽版——与 stack-container 同构：③ releaseResources 委托 G-43 Drop 协议） */
async function destroySlotPage(page: SlotPage, pages: Map<string, SlotPage>, emit: Emit): Promise<DestroyReport> {
  const steps: DestroyReport['steps'][number][] = []

  ;(page as { mountPoint: unknown | null }).mountPoint = null
  steps.push(FIVE_ATOMIC_STEPS[0])

  page.eventRegistry.unbindAll()
  steps.push(FIVE_ATOMIC_STEPS[1])

  page.resourcePool.releaseAll()
  let reclaimedBytes = 0
  const ownershipReport = page.ownership ? page.ownership.destroy({ force: true }) : null
  if (ownershipReport) {
    reclaimedBytes += ownershipReport.freedBytes
    if (ownershipReport.quotaRemaining !== 0) {
      throw new Error(`G-43 页面销毁后配额未归零：${page.pageId} 剩余 ${ownershipReport.quotaRemaining}B`)
    }
  }
  steps.push(FIVE_ATOMIC_STEPS[2])

  page.ir = null
  steps.push(FIVE_ATOMIC_STEPS[3])

  page.quotaHandle = null // 单槽容器无配额治理（resourceQuota=false）——步骤保留（五原子完整）
  steps.push(FIVE_ATOMIC_STEPS[4])

  const report: DestroyReport = { pageId: page.pageId, steps, leaked: [], reclaimedBytes, durationMs: 0 }
  assertAtomicDestroy(report)

  page.alive = false
  ;(page as { state: PageState }).state = 'destroyed'
  pages.delete(page.pageId)
  emit('page-destroyed', { pageId: page.pageId, reclaimedBytes })
  return report
}

/** 无配额治理（resourceQuota=false——诚实拒绝而非静默无限；C-06 门控 SKIP） */
function noQuota(id: string): QuotaManager {
  const refuse = (): never => {
    throw new Error(`G-42: ${id} 容器无配额治理（capabilities.resourceQuota=false——CMP065 诚实声明）`)
  }
  const usage: QuotaUsage = { usedBytes: 0, limitBytes: 0, pageCount: 0, sandboxCount: 0 }
  return {
    request: () => refuse(),
    release: () => refuse(),
    usage,
    pressure: 'normal' as PressureLevel,
  }
}

interface SingleSlotOptions {
  /** 所有权图接入（G-43 B3——每页伴随所有权上下文） */
  ownership?: { graph: OwnershipGraph; quotaBytes?: number }
  /** ★Embedded：宿主挂载点工厂（config → 宿主提供的挂载元素；缺省 {} 占位） */
  getHostMountPoint?: (config: PageConfig) => unknown
}

// ============================================================
// SinglePageContainer（单页/卡片/IoT——单槽 replace 语义）
// ============================================================

export interface SinglePageContainer extends ProteusHostContainer {
  readonly id: 'singlepage'
  ownershipOf(pageId: string): PageOwnership | null
}

/** ★G-42 B6：单页容器——同一时刻至多一个页面，push = 替换（销毁旧页 → 挂新页） */
export function createSinglePageContainer(opts: SingleSlotOptions = {}): SinglePageContainer {
  const pages = new Map<string, SlotPage>()
  let current: SlotPage | null = null
  let seq = 0
  const events: Record<string, Array<(payload: unknown) => void>> = {}
  const emit: Emit = (event, payload) => {
    for (const fn of events[event] ?? []) fn(payload)
  }

  function createSlot(config: PageConfig): SlotPage {
    const ownership = opts.ownership ? createPageOwnership(config.pageId ?? `page-${++seq}`, { graph: opts.ownership.graph, quotaBytes: opts.ownership.quotaBytes }) : null
    const page = makeSlotPage(seq, config, ownership)
    if (!config.pageId) seq++
    pages.set(page.pageId, page)
    emit('page-created', { pageId: page.pageId })
    return page
  }

  function createPage(config: PageConfig): PageHandle {
    return createSlot(config)
  }

  async function destroyPage(handle: PageHandle): Promise<DestroyReport> {
    const page = pages.get(handle.pageId)
    if (!page) throw new Error(`G-42: 未知页面 ${handle.pageId}`)
    const report = await destroySlotPage(page, pages, emit)
    if (current === page) current = null
    return report
  }

  async function mountPage(handle: PageHandle): Promise<void> {
    const page = pages.get(handle.pageId)
    if (!page) throw new Error(`G-42: 未知页面 ${handle.pageId}`)
    if (page.state === 'mounted') return
    setSlotState(page, 'mounted')
    ;(page as { mountPoint: unknown | null }).mountPoint = opts.getHostMountPoint ? opts.getHostMountPoint(page.config) : {}
  }

  async function unmountPage(handle: PageHandle): Promise<void> {
    const page = pages.get(handle.pageId)
    if (!page) throw new Error(`G-42: 未知页面 ${handle.pageId}`)
    setSlotState(page, 'hidden')
    ;(page as { mountPoint: unknown | null }).mountPoint = null
  }

  const container: SinglePageContainer = {
    id: 'singlepage',
    version: '1.0.0',
    capabilities: CONTAINER_PROFILES.singlepage as ContainerCapabilities,
    async initialize() {},
    dispose() {
      pages.clear()
      current = null
    },
    createPage,
    mountPage,
    unmountPage,
    destroyPage,
    async push(config) {
      // 单槽 replace：销毁既有页面（单页/卡片同一时刻一个内容——显式语义非静默）
      for (const p of [...pages.values()]) await destroyPage(p)
      const page = createSlot(config)
      await mountPage(page)
      current = page
      return page
    },
    async pop() {
      if (!current) return null
      const page = current
      await destroyPage(page)
      return page
    },
    getCurrent() {
      return current
    },
    getStackDepth() {
      return current ? 1 : 0
    },
    async createSandbox() {
      throw new Error('G-42: singlepage 容器无沙箱（capabilities.multiBusiness=false——CMP065）')
    },
    async destroySandbox(bizId) {
      void bizId
      return createDestroyReport(bizId)
    },
    listSandboxes() {
      return []
    },
    quota: noQuota('singlepage'),
    onMemoryPressure() {},
    on(event: ContainerEvent, handler: (payload: unknown) => void) {
      events[event] = events[event] ?? []
      events[event].push(handler)
    },
    ownershipOf(pageId: string) {
      const page = pages.get(pageId)
      return page ? page.ownership : null
    },
  }
  return container
}

// ============================================================
// EmbeddedContainer（嵌入宿主页面——卡片/widget，宿主控制生命周期）
// ============================================================

export interface EmbeddedContainer extends ProteusHostContainer {
  readonly id: 'embedded'
  ownershipOf(pageId: string): PageOwnership | null
}

/** ★G-42 B6：嵌入容器——单视图嵌入宿主页面（G-30 Tier 3），宿主经 getHostMountPoint 提供挂载点 */
export function createEmbeddedContainer(opts: SingleSlotOptions = {}): EmbeddedContainer {
  const inner = createSinglePageContainer(opts)
  const container: EmbeddedContainer = {
    id: 'embedded',
    version: '1.0.0',
    capabilities: CONTAINER_PROFILES.embedded as ContainerCapabilities,
    async initialize() {},
    dispose() {
      inner.dispose()
    },
    createPage: inner.createPage,
    mountPage: inner.mountPage,
    unmountPage: inner.unmountPage,
    destroyPage: inner.destroyPage,
    push: inner.push,
    pop: inner.pop,
    getCurrent: inner.getCurrent,
    getStackDepth: inner.getStackDepth,
    async createSandbox() {
      throw new Error('G-42: embedded 容器无沙箱（capabilities.multiBusiness=false——CMP065）')
    },
    async destroySandbox(bizId) {
      void bizId
      return createDestroyReport(bizId)
    },
    listSandboxes() {
      return []
    },
    quota: noQuota('embedded'),
    onMemoryPressure() {},
    on(event, handler) {
      inner.on(event, handler)
    },
    ownershipOf(pageId: string) {
      return inner.ownershipOf(pageId)
    },
  }
  return container
}

// ============================================================
// WindowContainer（桌面多窗口——窗口组各持页面栈）
// ============================================================

export interface WindowContainerOptions {
  policy?: StackPolicy
  quotaLimitBytes?: number
  ownership?: { graph: OwnershipGraph; quotaBytes?: number }
}

export interface WindowContainer extends ProteusHostContainer {
  readonly id: 'window'
  /** 创建窗口（返回该窗口的栈容器并聚焦） */
  createWindow(windowId?: string): StackContainer
  /** 销毁窗口（窗口内全部页面五原子销毁） */
  destroyWindow(windowId: string): Promise<void>
  /** 聚焦窗口（SPI 页面操作代理目标） */
  focusWindow(windowId: string): void
  listWindows(): string[]
  readonly focusedWindow: string | null
  ownershipOf(pageId: string): PageOwnership | null
  onWindow(event: 'window-created' | 'window-destroyed' | 'window-focused', cb: (payload: unknown) => void): void
}

/** ★G-42 B6：多窗口容器——每窗口一个完整页面栈（委托 StackContainer），SPI 操作代理聚焦窗口 */
export function createWindowContainer(opts: WindowContainerOptions = {}): WindowContainer {
  const windows = new Map<string, StackContainer>()
  const windowEvents: Record<string, Array<(payload: unknown) => void>> = {}
  let focused: string | null = null
  let seq = 0
  const emitWindow = (event: string, payload: unknown): void => {
    for (const fn of windowEvents[event] ?? []) fn(payload)
  }

  function stackOptions(): StackContainerOptions {
    return { policy: opts.policy, quotaLimitBytes: opts.quotaLimitBytes, ownership: opts.ownership }
  }

  function createWindow(windowId?: string): StackContainer {
    const id = windowId ?? `window-${++seq}`
    if (windows.has(id)) throw new Error(`G-42: 窗口已存在 ${id}`)
    const stack = createStackContainer(stackOptions())
    windows.set(id, stack)
    focused = id
    emitWindow('window-created', { windowId: id })
    emitWindow('window-focused', { windowId: id })
    return stack
  }

  function focusedStack(): StackContainer {
    if (!focused || !windows.has(focused)) {
      createWindow()
    }
    return windows.get(focused!)!
  }

  async function destroyWindow(windowId: string): Promise<void> {
    const stack = windows.get(windowId)
    if (!stack) throw new Error(`G-42: 未知窗口 ${windowId}`)
    for (const page of [...stack.stackView]) {
      await stack.destroyPage(page)
    }
    windows.delete(windowId)
    if (focused === windowId) {
      focused = windows.keys().next().value ?? null
      if (focused) emitWindow('window-focused', { windowId: focused })
    }
    emitWindow('window-destroyed', { windowId })
  }

  const container: WindowContainer = {
    id: 'window',
    version: '1.0.0',
    capabilities: CONTAINER_PROFILES.window as ContainerCapabilities,
    async initialize() {
      if (windows.size === 0) createWindow('window-1')
    },
    dispose() {
      windows.clear()
      focused = null
    },
    createWindow,
    destroyWindow,
    focusWindow(windowId: string) {
      if (!windows.has(windowId)) throw new Error(`G-42: 未知窗口 ${windowId}`)
      focused = windowId
      emitWindow('window-focused', { windowId })
    },
    listWindows() {
      return [...windows.keys()]
    },
    get focusedWindow() {
      return focused
    },
    createPage(config) {
      return focusedStack().createPage(config)
    },
    mountPage(handle) {
      return focusedStack().mountPage(handle)
    },
    unmountPage(handle) {
      return focusedStack().unmountPage(handle)
    },
    destroyPage(handle) {
      return focusedStack().destroyPage(handle)
    },
    push(config) {
      return focusedStack().push(config)
    },
    pop() {
      return focusedStack().pop()
    },
    getCurrent() {
      return focusedStack().getCurrent()
    },
    getStackDepth() {
      return focusedStack().getStackDepth()
    },
    async createSandbox() {
      throw new Error('G-42: window 容器无沙箱（capabilities.multiBusiness=false——CMP065）')
    },
    async destroySandbox(bizId) {
      void bizId
      return createDestroyReport(bizId)
    },
    listSandboxes() {
      return []
    },
    get quota() {
      return focusedStack().quota
    },
    onMemoryPressure() {},
    on(event, handler) {
      const stack = focusedStack()
      stack.on(event, handler)
    },
    ownershipOf(pageId: string) {
      for (const stack of windows.values()) {
        const own = stack.ownershipOf(pageId)
        if (own) return own
      }
      return null
    },
    onWindow(event, cb) {
      windowEvents[event] = windowEvents[event] ?? []
      windowEvents[event].push(cb)
    },
  }
  return container
}

// ============================================================
// MiniProgramContainer（小程序容器——导航语义 + L1 沙箱）
// ============================================================

export interface MiniProgramContainerOptions {
  policy?: Partial<StackPolicy>
  quotaLimitBytes?: number
  ownership?: { graph: OwnershipGraph; quotaBytes?: number }
}

export interface MiniProgramTabConfig {
  readonly pageId: string
  readonly irId: string
}

export interface MiniProgramSandbox extends BusinessSandbox {
  scope: { bizId: string; values: Record<string, unknown> }
}

export interface MiniProgramContainer extends ProteusHostContainer {
  readonly id: 'miniprogram'
  /** 压栈导航（wx.navigateTo——10 层上限，超限显式拒绝） */
  navigateTo(config: PageConfig): Promise<PageHandle>
  /** 替换栈顶（wx.redirectTo） */
  redirectTo(config: PageConfig): Promise<PageHandle>
  /** 重启（wx.reLaunch——清栈后压新页） */
  reLaunch(config: PageConfig): Promise<PageHandle>
  /** 切 tab（wx.switchTab——非 tab 页全销毁，tab 页 keep-alive 常驻） */
  switchTab(pageId: string): Promise<PageHandle>
  /** 返回（wx.navigateBack） */
  navigateBack(): Promise<PageHandle | null>
  /** 注册 tab 页（switchTab 前必须注册） */
  registerTab(config: MiniProgramTabConfig): void
  listTabs(): string[]
  ownershipOf(pageId: string): PageOwnership | null
}

/** ★G-42 B6：小程序容器——页面栈导航语义（10 层上限）+ tab keep-alive + L1 沙箱（scope 隔离） */
export function createMiniProgramContainer(opts: MiniProgramContainerOptions = {}): MiniProgramContainer {
  const policy: StackPolicy = {
    ...{ maxDepth: 10, overflowStrategy: 'reject' as const, keepAlive: { maxCount: 3, memoryBudgetBytes: 64 * 1024 * 1024 } },
    ...opts.policy,
  }
  // 页面生命周期（五原子/资源池/ownership）委托内部 StackContainer；导航栈语义由本容器管理
  const inner = createStackContainer({
    policy,
    quotaLimitBytes: opts.quotaLimitBytes,
    ownership: opts.ownership,
  } as StackContainerOptions)
  const stack: PageHandle[] = []
  const tabs = new Map<string, MiniProgramTabConfig>()
  const tabPages = new Map<string, PageHandle>()
  const sandboxes = new Map<string, MiniProgramSandbox>()
  let seq = 0

  async function destroyAll(exceptPageId?: string): Promise<void> {
    for (const p of [...stack]) {
      if (exceptPageId && p.pageId === exceptPageId) continue
      await inner.destroyPage(p)
      const i = stack.indexOf(p)
      if (i >= 0) stack.splice(i, 1)
    }
  }

  const container: MiniProgramContainer = {
    id: 'miniprogram',
    version: '1.0.0',
    capabilities: CONTAINER_PROFILES.miniprogram as ContainerCapabilities,
    async initialize() {},
    dispose() {
      stack.length = 0
      tabPages.clear()
      sandboxes.clear()
    },
    createPage(config) {
      return inner.createPage(config)
    },
    mountPage(handle) {
      return inner.mountPage(handle)
    },
    unmountPage(handle) {
      return inner.unmountPage(handle)
    },
    destroyPage(handle) {
      // 委托内部栈五原子销毁 + 同步移除本容器导航栈（栈治理一致性）
      return inner.destroyPage(handle).then((report) => {
        const i = stack.findIndex((p) => p.pageId === handle.pageId)
        if (i >= 0) stack.splice(i, 1)
        return report
      })
    },
    async push(config) {
      return container.navigateTo(config)
    },
    async pop() {
      return container.navigateBack()
    },
    getCurrent() {
      return stack[stack.length - 1] ?? null
    },
    getStackDepth() {
      return stack.length
    },
    async navigateTo(config) {
      // 页面栈深度治理（wx.navigateTo 10 层上限）：reject 显式拒绝（真实 MP 语义）/ destroy-oldest 销毁栈底
      if (stack.length >= policy.maxDepth) {
        if (policy.overflowStrategy === 'destroy-oldest') {
          const oldest = stack[0]
          // tab 页不回收（keep-alive）——栈底是 tab 页且已满 → 显式拒绝
          if (!oldest || tabs.has(oldest.pageId)) {
            throw new Error(`G-42 小程序导航超限：页面栈已达 ${policy.maxDepth} 层（栈底为 tab 页不可回收）`)
          }
          await container.destroyPage(oldest)
        } else {
          throw new Error(`G-42 小程序导航超限：页面栈已达 ${policy.maxDepth} 层（navigateTo 拒绝）`)
        }
      }
      const page = inner.createPage(config)
      await inner.mountPage(page)
      stack.push(page)
      return page
    },
    async redirectTo(config) {
      const top = stack[stack.length - 1]
      if (top) {
        await container.destroyPage(top)
      }
      return container.navigateTo(config)
    },
    async reLaunch(config) {
      await destroyAll()
      return container.navigateTo(config)
    },
    async switchTab(pageId) {
      const tab = tabs.get(pageId)
      if (!tab) throw new Error(`G-42: switchTab 目标未注册为 tab 页：${pageId}`)
      // 目标 tab 页先出栈（后续置顶）
      const existing = tabPages.get(pageId)
      const targetIdx = existing ? stack.indexOf(existing) : -1
      if (targetIdx >= 0) stack.splice(targetIdx, 1)
      // 非 tab 页全销毁（wx.switchTab 语义）；其他 tab 页保活出栈（unmount → hidden，IR 保留）
      for (const p of [...stack]) {
        if (tabs.has(p.pageId)) {
          await inner.unmountPage(p)
        } else {
          await inner.destroyPage(p)
        }
        const i = stack.indexOf(p)
        if (i >= 0) stack.splice(i, 1)
      }
      // 目标 tab 页：已存在（保活）→ 置顶 + 确保挂载；不存在 → 创建（keepAlive 标记）
      let tabPage = existing
      if (tabPage && tabPage.state !== 'destroyed') {
        stack.push(tabPage)
        if (tabPage.state === 'hidden') await inner.mountPage(tabPage)
      } else {
        tabPage = inner.createPage({ ...tab, keepAlive: true })
        tabPages.set(pageId, tabPage)
        await inner.mountPage(tabPage)
        stack.push(tabPage)
      }
      return tabPage
    },
    async navigateBack() {
      const top = stack.pop()
      if (!top) return null
      await inner.destroyPage(top)
      return top
    },
    registerTab(config) {
      tabs.set(config.pageId, config)
    },
    listTabs() {
      return [...tabs.keys()]
    },
    // —— L1 沙箱（scope 隔离——插件/分包业务；崩溃网关是 SuperApp L2 职责）——
    async createSandbox(bizId, manifest) {
      void manifest
      if (sandboxes.has(bizId)) throw new Error(`G-42: 沙箱已存在 ${bizId}`)
      const sb: MiniProgramSandbox = {
        bizId,
        isolatedScope: { bizId, values: {} as Record<string, unknown> },
        quotaHandle: null,
        state: 'running',
        scope: { bizId, values: {} as Record<string, unknown> },
      }
      sandboxes.set(bizId, sb)
      return sb
    },
    async destroySandbox(bizId) {
      const sb = sandboxes.get(bizId)
      if (sb) {
        ;(sb as { state: 'running' | 'crashed' | 'destroyed' }).state = 'destroyed'
        sandboxes.delete(bizId)
      }
      return createDestroyReport(bizId)
    },
    listSandboxes() {
      return [...sandboxes.values()]
    },
    quota: inner.quota,
    onMemoryPressure(cb: (level: PressureLevel) => void) {
      inner.onMemoryPressure(cb)
    },
    on(event: ContainerEvent, handler: (payload: unknown) => void) {
      inner.on(event, handler)
    },
    ownershipOf(pageId: string) {
      return inner.ownershipOf(pageId)
    },
  }
  return container
}
