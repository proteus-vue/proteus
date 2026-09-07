// packages/test-core/src/context.ts
// ★test-framework M3：createMockContext——小程序测试的**唯一 wx 来源**（03-component-integration.md 铁律）
// 标准件：wx 全局 mock（PlatformAPI 四域内存实现 + vi.fn 可断言）+ Page/Component/App 构造器捕获
//          + getApp/getCurrentPages + 内存存储
import { vi } from 'vitest'

type StorageSetter = (key: string, value: unknown) => void
type StorageGetter = (key: string) => unknown
type StorageRemover = (key: string) => void
type StorageClearer = () => void

// ★vitest 1.x vi.fn 泛型约束为 any[]（旧 API），赋值用双重断言绕开 Mock 泛型差异
export interface WxStorageMock {
  setStorageSync: ReturnType<typeof vi.fn>
  getStorageSync: ReturnType<typeof vi.fn>
  removeStorageSync: ReturnType<typeof vi.fn>
  clearStorageSync: ReturnType<typeof vi.fn>
}

export interface WxRouterMock {
  navigateTo: ReturnType<typeof vi.fn>
  redirectTo: ReturnType<typeof vi.fn>
  navigateBack: ReturnType<typeof vi.fn>
  switchTab: ReturnType<typeof vi.fn>
  reLaunch: ReturnType<typeof vi.fn>
}

export interface WxUiMock {
  showToast: ReturnType<typeof vi.fn>
  showLoading: ReturnType<typeof vi.fn>
  hideLoading: ReturnType<typeof vi.fn>
  showModal: ReturnType<typeof vi.fn>
  showActionSheet: ReturnType<typeof vi.fn>
}

export interface MockContext {
  /** wx 全局（storage/router/ui 内存实现 + vi.fn 可断言） */
  wx: {
    storage: WxStorageMock
    router: WxRouterMock
    ui: WxUiMock
    request: ReturnType<typeof vi.fn>
    getSystemInfoSync: ReturnType<typeof vi.fn>
  }
  getApp: ReturnType<typeof vi.fn>
  getCurrentPages: ReturnType<typeof vi.fn>
  /** 构造器捕获：Page/Component/App 注册的配置（断言 data/methods/lifetimes） */
  registrations: { page?: unknown; component?: unknown; app?: unknown }
  /** 内存存储（getStorageSync 读回真实值） */
  store: Map<string, unknown>
  /** 卸载全局 mock（afterEach 调用，决策 #156 教训） */
  cleanup: () => void
}

export interface MockContextOptions {
  /** 存储初始值（key → value） */
  storage?: Record<string, unknown>
  /** 页面栈（getCurrentPages 返回） */
  pages?: unknown[]
  /** 自定义 wx 扩展（平台 API 补充） */
  extraWx?: Record<string, unknown>
}

const DEFAULT_SYSTEM_INFO = { platform: 'devtools', windowWidth: 375, windowHeight: 667, pixelRatio: 2 }

/** 创建小程序 mock 上下文（唯一 wx 来源；afterEach 调 cleanup 恢复全局） */
export function createMockContext(options: MockContextOptions = {}): MockContext {
  const store = new Map<string, unknown>(Object.entries(options.storage ?? {}))

  const storage: WxStorageMock = {
    setStorageSync: vi.fn((key: string, value: unknown) => {
      store.set(key, value)
    }) as unknown as ReturnType<typeof vi.fn>,
    getStorageSync: vi.fn((key: string) => store.get(key)) as unknown as ReturnType<typeof vi.fn>,
    removeStorageSync: vi.fn((key: string) => {
      store.delete(key)
    }) as unknown as ReturnType<typeof vi.fn>,
    clearStorageSync: vi.fn(() => {
      store.clear()
    }) as unknown as ReturnType<typeof vi.fn>,
  }

  const wx = {
    storage,
    router: {
      navigateTo: vi.fn(),
      redirectTo: vi.fn(),
      navigateBack: vi.fn(),
      switchTab: vi.fn(),
      reLaunch: vi.fn(),
    },
    ui: {
      showToast: vi.fn(),
      showLoading: vi.fn(),
      hideLoading: vi.fn(),
      showModal: vi.fn(),
      showActionSheet: vi.fn(),
    },
    request: vi.fn(),
    getSystemInfoSync: vi.fn(() => DEFAULT_SYSTEM_INFO),
    ...(options.extraWx ?? {}),
  } as MockContext['wx']

  const registrations: MockContext['registrations'] = {}

  const getApp = vi.fn(() => ({}))
  const getCurrentPages = vi.fn(() => options.pages ?? [])
  const Page = (config: unknown) => {
    registrations.page = config
  }
  const Component = (config: unknown) => {
    registrations.component = config
  }
  const App = (config: unknown) => {
    registrations.app = config
  }

  // 全局注入（stubGlobal 在 cleanup 时恢复）
  vi.stubGlobal('wx', wx)
  vi.stubGlobal('getApp', getApp)
  vi.stubGlobal('getCurrentPages', getCurrentPages)
  vi.stubGlobal('Page', Page)
  vi.stubGlobal('Component', Component)
  vi.stubGlobal('App', App)

  return {
    wx,
    getApp,
    getCurrentPages,
    registrations,
    store,
    cleanup: () => {
      vi.unstubAllGlobals()
    },
  } as MockContext
}
