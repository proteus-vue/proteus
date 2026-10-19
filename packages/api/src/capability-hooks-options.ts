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
}
