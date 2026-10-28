// packages/api/src/capability-runtime.ts
// ★★★决策 #1094（2026-10-19）：能力实例的**边界资源运行时**（G-43 治理的装配点）。
//
// 【为什么单列】`capability.ts` 是 1093 行的存量棘轮（`check:file-size` 只减不增）——
//   把"账本 + App WebSocket 实例 + dispose 编排"放进去必然越界。职责上也更清楚：
//   本文件回答"一个能力实例持有哪些边界资源、怎么释放"，语义实现仍在 capability.ts。

import { createAppWebSocket } from './capability-websocket'
import type { CapabilityResourceRegistry } from './capability-resources'
import type { CapabilityHooksOptions } from './capability-hooks-options'

export interface CapabilityRuntime {
  /** 边界资源账本（未传 ⇒ null，行为与从前一致） */
  resources: CapabilityResourceRegistry | null
  /** 带账本的 App WebSocket 工厂（连接会登记为 `ws-connection`） */
  appWs: ReturnType<typeof createAppWebSocket>
  /** 释放编排：**先资源后订阅**（反过来会让已关连接的回调在释放期间还被调一次） */
  dispose(scope: { dispose(): void }): void
  /**
   * WebSocket 连接路由：**有账本且是 App 宿主** ⇒ 走带登记的实例；否则走原桥。
   * ★为什么不是"永远用 appWs"：App 桥存在时才该走 App 腿；
   *   wx/web 的 connectWebSocket 是各自平台实现，不能被 App 实现覆盖。
   */
  connectWs<T>(bridge: { connectWebSocket?: (u: string, p?: string[]) => Promise<T> }, url: string, protocols?: string[]): Promise<T>
}

/**
 * 组装一个能力实例的边界资源运行时。
 * @param opts `createCapabilityHooks` 的第二参数（不传 ⇒ 全部退化为旧行为）
 */
export function makeCapabilityRuntime(opts: CapabilityHooksOptions): CapabilityRuntime {
  const resources = opts.resources ?? null
  /**
   * ★★★#1344 P4：**白名单从装配层下传**（一处配置覆盖 HTTP + WS 两条通道）。
   *   不传 ⇒ 不限制（与 HTTP 的 TenantPolicy 同口径）。
   */
  const appWs = createAppWebSocket({
    resources: resources ?? undefined,
    owner: opts.owner,
    allowedDomains: opts.allowedDomains,
  })
  return {
    resources,
    appWs,
    dispose(scope) {
      if (resources) resources.releaseAll()
      scope.dispose()
    },
    connectWs<T>(bridge: { connectWebSocket?: (u: string, p?: string[]) => Promise<T> }, url: string, protocols?: string[]): Promise<T> {
      if (resources && typeof (globalThis as { __PROTEUS_HOST_ID__?: unknown }).__PROTEUS_HOST_ID__ === 'string') {
        return appWs(url, protocols) as unknown as Promise<T>
      }
      if (!bridge.connectWebSocket) {
        return Promise.reject(Object.assign(new Error('桥未提供 connectWebSocket（useWebSocket 不可用）'), { code: 'websocket.unsupported' }))
      }
      return bridge.connectWebSocket(url, protocols)
    },
  }
}
