// packages/types/src/platform-api.ts
// ★types-plus-plan B9（M9）：跨端统一 PlatformAPI 契约（类型契约层）
// 定位：业务层唯一依赖点——不出现 wx./window./plus. 裸调用（铁律 #4 类型收窄）。
// 运行时实现归 @proteus-vue/api（api-plan：createApi + 三端 adapter 已落地），本文件只定义契约。
// request 契约复用 api-types（RequestConfig/RequestResponse）——与既有运行时实现保持单一来源，
// 不再定义第二套 RequestOptions（规划 §2 的 header/statusCode 命名已收敛为 headers/status）。
// 平台独占能力（蓝牙/生物认证等）走 CapabilityIR + assertPlatform，不塞进本接口（规划 §4）。

import type { RequestConfig, RequestResponse } from './api-types'

export type { RequestConfig, RequestResponse } from './api-types'

/** 跨端存储（最小公约数：同步形态；异步/分片等走 pinia StorageAdapter 或 CapabilityIR） */
export interface StorageAPI {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  remove(key: string): void
  clear(): void
}

/** 跨端路由（对齐 Router API 语义：push 对应 navigateTo、replace 对应 redirectTo；switchTab/reLaunch 对齐微信 tab/重载语义，Web 端由实现映射为 push/replace 驱动） */
export interface RouterAPI {
  push(url: string, query?: Record<string, string>): void
  replace(url: string, query?: Record<string, string>): void
  /** 微信 switchTab：切 tab 页（Web 端映射为 replace 语义） */
  switchTab(url: string, query?: Record<string, string>): void
  /** 微信 reLaunch：关闭所有页面重开（Web 端映射为 replace 语义） */
  reLaunch(url: string, query?: Record<string, string>): void
  back(delta?: number): void
}

/** showModal 选项（对齐微信 showModal 高频字段；editable 等低频字段走 capability） */
export interface ModalOptions {
  title?: string
  content?: string
  showCancel?: boolean
  confirmText?: string
  cancelText?: string
}

/** showModal 结果（confirm=true 且无 cancel 时确认） */
export interface ModalResult {
  confirm: boolean
  cancel: boolean
}

/** showActionSheet 选项 */
export interface ActionSheetOptions {
  itemList: string[]
  /** 取消按钮文案（默认「取消」） */
  cancelText?: string
}

/** showActionSheet 结果（取消 tapIndex=-1） */
export interface ActionSheetResult {
  tapIndex: number
}

/** 跨端轻量 UI 反馈 */
export interface UIAPI {
  showToast(message: string, duration?: number): void
  showLoading(title?: string): void
  hideLoading(): void
  /** 模态确认框（对齐 wx.showModal；Web 端 DOM 实现） */
  showModal(options?: ModalOptions): Promise<ModalResult>
  /** 操作菜单（对齐 wx.showActionSheet；Web 端 DOM 实现） */
  showActionSheet(options: ActionSheetOptions): Promise<ActionSheetResult>
}

/**
 * 跨端统一 API 接口（业务层唯一依赖点）
 * —— 每端实现此接口，通过平台判别（capabilities.matchPlatform / 运行时 adapter）分派
 */
export interface PlatformAPI {
  request: <T = unknown>(config: RequestConfig) => Promise<RequestResponse<T>>
  storage: StorageAPI
  router: RouterAPI
  ui: UIAPI
}

// 编译期自测：接口形状契约（实现缺失任一成员 → 编译报错）
const _platformApiShapeCheck: PlatformAPI = {
  request: async <T>(config: RequestConfig) => ({
    data: undefined as T,
    status: 200,
    headers: {},
    config,
  }),
  storage: {
    get: () => undefined,
    set: () => {},
    remove: () => {},
    clear: () => {},
  },
  router: {
    push: () => {},
    replace: () => {},
    switchTab: () => {},
    reLaunch: () => {},
    back: () => {},
  },
  ui: {
    showToast: () => {},
    showLoading: () => {},
    hideLoading: () => {},
    showModal: async () => ({ confirm: false, cancel: true }),
    showActionSheet: async () => ({ tapIndex: -1 }),
  },
}
void _platformApiShapeCheck
