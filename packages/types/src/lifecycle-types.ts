// packages/types/src/lifecycle-types.ts
// ★types-plus-plan B1（01 §3）/ 08 契约表：生命周期阶段类型（收口自 runtime 实现，单一来源）
// 08 契约表：Lifecycle plan 引用 AppPhase/LaunchType/LifecycleContext/PhaseHook（types 提供）
// 零依赖（Platform 类型来自 index-shared）

import type { Platform } from './index-shared'

/** 应用生命周期阶段（runtime PHASE_ORDER 同值；新增阶段走编译期 PHASE_ORDER 联动） */
export type AppPhase = 'bootstrap' | 'coreReady' | 'navigationReady' | 'beforeFirstPaint' | 'interactive'

/** 启动类型 */
export type LaunchType = 'cold' | 'warm' | 'recover'

/** 阶段上下文（业务钩子只读 ctx + 调已注册服务，禁止直连平台 API） */
export interface LifecycleContext {
  launchType: LaunchType
  launchOptions?: { path?: string; query?: Record<string, string> }
  network: 'wifi' | '4g' | '3g' | 'none'
  platform: Platform
  /** ★minimal 模式（coreReady 超时/失败后）——业务读此标记跳过非必要逻辑 */
  isMinimalMode: boolean
}

/** 阶段钩子（defineApp phases 配置） */
export type PhaseHook = (ctx: LifecycleContext) => void | Promise<void>

/** 阶段超时降级策略（lifecycle-plan B1+B2） */
export type FallbackStrategy = 'warn' | 'minimal' | 'home' | 'skeleton' | 'lazy'
