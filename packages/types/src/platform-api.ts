// packages/types/src/platform-api.ts
// ★types-plus-plan B9（M9）：跨端统一 PlatformAPI 契约（类型契约层）
// 定位：业务层唯一依赖点——不出现 wx./window./plus. 裸调用（铁律 #4 类型收窄）。
// 运行时实现归 @proteus-vue/api（api-plan：createApi + 三端 adapter 已落地），本文件只定义契约。
// request 契约复用 api-types（RequestConfig/RequestResponse）——与既有运行时实现保持单一来源，
// 不再定义第二套 RequestOptions（规划 §2 的 header/statusCode 命名已收敛为 headers/status）。
// 平台独占能力（蓝牙/生物认证等）走 CapabilityIR + assertPlatform，不塞进本接口（规划 §4）。

import type { RequestConfig, RequestResponse } from './api-types'

/** 跨端存储（最小公约数：同步形态；异步/分片等走 pinia StorageAdapter 或 CapabilityIR） */
export interface StorageAPI {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  remove(key: string): void
  clear(): void
}

/** 跨端路由（对齐 Router API 语义：push 对应 navigateTo、replace 对应 redirectTo/switchTab 由实现映射） */
export interface RouterAPI {
  push(url: string, query?: Record<string, string>): void
  replace(url: string, query?: Record<string, string>): void
  back(delta?: number): void
}

/** 跨端轻量 UI 反馈 */
export interface UIAPI {
  showToast(message: string, duration?: number): void
  showLoading(title?: string): void
  hideLoading(): void
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
    back: () => {},
  },
  ui: {
    showToast: () => {},
    showLoading: () => {},
    hideLoading: () => {},
  },
}
void _platformApiShapeCheck
