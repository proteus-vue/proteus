// tests/types/platform-api.types.ts
// ★types-plus-plan B9：PlatformAPI 契约类型级断言（正例 + @ts-expect-error 负例）
// 由根 vue-tsc（build:web）校验：负例若未报错 → @ts-expect-error 未使用 → 编译失败（防漂移）
import type { PlatformAPI, RouterAPI, StorageAPI, UIAPI } from '../../packages/types/src/platform-api'
import type { RequestConfig } from '../../packages/types/src/api-types'

// ---- 正例：完整实现满足 PlatformAPI ----
const full: PlatformAPI = {
  request: async <T>(config: RequestConfig) => ({
    data: undefined as T,
    status: 200,
    headers: {},
    config,
  }),
  storage: {
    get: <T>() => undefined as T | undefined,
    set: () => {},
    remove: () => {},
    clear: () => {},
  },
  router: {
    push: (url: string, query?: Record<string, string>) => void [url, query],
    replace: () => {},
    back: (delta?: number) => void [delta],
  },
  ui: {
    showToast: (message: string, duration?: number) => void [message, duration],
    showLoading: () => {},
    hideLoading: () => {},
  },
}
void full

// ---- 子接口可独立引用 ----
const storage: StorageAPI = { get: () => undefined, set: () => {}, remove: () => {}, clear: () => {} }
const router: RouterAPI = { push: () => {}, replace: () => {}, back: () => {} }
const ui: UIAPI = { showToast: () => {}, showLoading: () => {}, hideLoading: () => {} }
void [storage, router, ui]

// ---- 负例：缺任一成员必须报错（防漂移） ----
// @ts-expect-error 缺 request
const noRequest: PlatformAPI = {
  storage: { get: () => undefined, set: () => {}, remove: () => {}, clear: () => {} },
  router: { push: () => {}, replace: () => {}, back: () => {} },
  ui: { showToast: () => {}, showLoading: () => {}, hideLoading: () => {} },
}
// @ts-expect-error 缺 storage
const noStorage: PlatformAPI = {
  request: async <T>(config: RequestConfig) => ({
    data: undefined as T,
    status: 200,
    headers: {},
    config,
  }),
  router: { push: () => {}, replace: () => {}, back: () => {} },
  ui: { showToast: () => {}, showLoading: () => {}, hideLoading: () => {} },
}
// @ts-expect-error storage.get 必须返回 T | undefined
const badGet: StorageAPI = { get: () => 'never', set: () => {}, remove: () => {}, clear: () => {} }
void [noRequest, noStorage, badGet]
