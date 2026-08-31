// packages/router/src/transforms/transform-transition.ts
// 转场映射（docs/proteus-router-plan M3 §4 / M4 §3.2）—— 三端共用同一份枚举，保证一致性
// <route>.meta.transition 是双端同 API：Web 走 Vue <Transition>、MP 走 Skyline routeType、App 走 native（v0.6）
// ★透明化：本表是 Web RouterView / MP 运行时 / App 适配的单一事实来源（不再是各端私有硬编码）
// ★RouteTransition 收口 @proteus-vue/contracts（跨层 DTO，铁律 #9 消除重复定义——原本地定义删除）
import type { RouteTransition } from '@proteus-vue/types'
export type { RouteTransition } from '@proteus-vue/types'

/** Web：transition → Vue <Transition> name（RouterView 消费） */
export const WEB_TRANSITION_MAP: Record<RouteTransition, string> = {
  slideUp: 'slide-up',
  slideDown: 'slide-down',
  halfScreen: 'halfscreen',
  scaleDown: 'scale',
  none: 'none',
}

/** MP：transition → 小程序运行时 navigateTo({ routeType }) 传参 / app.json routeType（运行时传参） */
export const MP_ROUTE_TYPE_MAP: Record<RouteTransition, string> = {
  slideUp: 'slideUp',
  slideDown: 'slideDown',
  halfScreen: 'halfScreen',
  scaleDown: 'scaleDown',
  none: 'none',
}

/** 校验 transition 是否合法（对齐 schema.ts 枚举） */
export function isTransition(v: unknown): v is RouteTransition {
  return v === 'slideUp' || v === 'slideDown' || v === 'halfScreen' || v === 'scaleDown' || v === 'none'
}

/** Web 转场名（非枚举/undefined → fade 兜底） */
export function webTransitionName(transition: unknown): string {
  if (isTransition(transition) && transition !== 'none') {
    return WEB_TRANSITION_MAP[transition]
  }
  return 'fade'
}

/** MP routeType（undefined/非法 → 不声明） */
export function mpRouteType(transition: RouteTransition | undefined): string | undefined {
  return transition && transition !== 'none' ? MP_ROUTE_TYPE_MAP[transition] : undefined
}
