// packages/api/src/capability-hooks-options.ts
// ★★★决策 #1094（2026-10-19）：`createCapabilityHooks` 的选项类型——**单列**以守住 capability.ts 行数棘轮。

import type { CapabilityResourceRegistry } from './capability-resources'

export interface CapabilityHooksOptions {
  /**
   * ★#1094：边界资源账本（G-43 治理）。传入后能力层创建的**边界资源**
   * （WebSocket 连接 / 键盘订阅 / 传感器流等）会登记进来，`dispose()` 时确定性释放。
   * ★不传 ⇒ 行为与从前完全一致（零回归）；这是**渐进采用**，不是强制改造。
   */
  resources?: CapabilityResourceRegistry
  /** 资源归属标签（缺省 'capability'；多页面场景传页面 id——G-43「边界资源归属某个 Owner」） */
  owner?: string
  /**
   * ★#1133：**请求管线**（拦截器 / 重试 / 去重 / 并发上限 / 优先级）。
   * ★不传 ⇒ 默认并发 10（与 `wx.request` 一致）、无重试、无去重、无拦截器——既有行为不变。
   */
  fetch?: import('./capability-fetch-pipeline').FetchPipelineOptions
  /**
   * ★★★#1344 P4：**出网域名白名单，覆盖 HTTP 与 WebSocket 两条通道**。
   *
   * 【为什么必须放在能力装配层而不是各 Hook 里】这是痛点 #15 的修法：
   *   加固只做在 HTTP 那一层时，业务换个 API（`useWebSocket`）就绕过了全部限制。
   *   放在装配层 ⇒ **一处配置、两条通道**，业务无法通过换 API 逃逸。
   *
   * 【语义与 `TenantPolicy.allowedDomains` 完全一致】（同一份 `isHostAllowed` 实现）：
   *   · 不传 / 空数组 ⇒ 不限制（可选增强，否则现有业务全被拦死）
   *   · `'api.example.com'` ⇒ 精确匹配
   *   · `'*.example.com'` ⇒ **只**匹配任意一级子域（`a.b.example.com` 不匹配）
   *   · `'*'` ⇒ 全放行（仅平台内部用）
   */
  allowedDomains?: string[]
}
