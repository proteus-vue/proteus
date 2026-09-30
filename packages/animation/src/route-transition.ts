// packages/animation/src/route-transition.ts
// ★★Morpheus × 统一路由转场枚举 —— **第三腿**（Web / MP / App 三端同一份 `RouteTransition`）
//
// 【为什么需要（本轮取证发现的缺口）】仓库里已有**统一枚举** `RouteTransition`
//   （`@proteus-vue/contracts`：`slideUp | slideDown | halfScreen | scaleDown | none`），
//   且 Web 腿（`WEB_TRANSITION_MAP` → Vue `<Transition>` name）与 MP 腿
//   （`MP_ROUTE_TYPE_MAP` → `wx.navigateTo({routeType})`）都已落地——
//   但**App 腿是空的**（`packages/router/src/transforms/transform-transition.ts` 注释写着
//   "App 走 native（v0.6）"，`APP_TRANSITION_MAP` 从未实现）。
//   而 Morpheus 预设库（本包）正是 App 侧的转场实现 ⇒ **本文件就是把第三腿接上**。
//
// 【为什么映射必须穷尽（防漂移的结构手段）】本文件的表是 `Record<RouteTransition, …>`：
//   枚举一旦增员，**这里会编译报错**（而不是静默漏一个值）——与 Web/MP 两张表的防漂移方式一致。
//
// 【与其它两张表的关系（谁拥有什么）】
//   · Web/MP 表：是"**名字**映射"（转场名 → 平台标识串），属于 router 包；
//   · 本表：是"**规格**映射"（转场 → Morpheus 声明/几何），属于本包——
//     因为 App 侧的转场不是"报个名字给平台"，而是**自己驱动动画**（内核 curve/FLIP 那套）。
//   ⇒ 三张表**共用同一个枚举**（防漂移），但各自返回自己那端真正需要的形态。
//
// 【诚实边界】本桥只保证"给定同一个 `meta.transition`，三端取到语义对应的转场"；
//   App 侧**路由栈本身**（push/pop/多层栈）属 router M5 计划（`docs/proteus-router-plan/05-m5-app-codegen.md`），
//   尚未实现 ⇒ 本表当前是"就绪的第三腿"，由未来的 App 路由调用。

import type { RouteTransition } from '@proteus-vue/contracts'
import type { RouteTransitionSpec } from './presets'
import { presets } from './presets'

/**
 * ★**统一枚举 → Morpheus 转场规格**（App 腿；穷尽映射——枚举增员时本表编译报错）
 *
 * `none` 映射为**空规格**（不做任何动画），而不是 `undefined`：
 *   调用方拿到的永远是"可以执行的东西"，不需要在任何地方写 `if (spec)` 分支。
 */
export const APP_TRANSITION_MAP: Record<RouteTransition, RouteTransitionSpec> = {
  // 推入（新页从下往上）—— 与 Web `slide-up` / MP `routeType: 'slideUp'` 同语义
  slideUp: presets.route.slideUp(),
  // 下滑关闭（当前页往下滑出，露出下层）—— 与 Web `slide-down` / MP `slideDown` 同语义
  slideDown: presets.route.slideDown(),
  // 半屏（弹窗从底部滑入，下层不动）—— 与 Web `halfscreen` / MP `halfScreen` 同语义
  halfScreen: presets.route.bottomSheet(),
  // 缩放下沉（新页放大进入 + 旧页下沉）—— 与 Web `scale` / MP `scaleDown` 同语义
  scaleDown: presets.route.zoom(),
  // 无转场（瞬切）
  none: {
    name: 'none',
    wxRouteType: null,
    enter: [],
    exit: [],
    opaque: true,
    durationMs: 0,
  },
}

/**
 * 取某转场在本端（App / Morpheus）的规格
 *
 * @param transition 来自 `<route>.meta.transition`（**非法/缺省 ⇒ `none`**，与 Web 侧
 *   `webTransitionName` 的"非枚举 → fade 兜底"同一防御姿态；不抛错——路由元信息是数据，不是代码）
 * @param opts 覆盖预设参数（距离/时长等；`none` 无参数）
 */
export function appTransition(transition: unknown, opts?: { distance?: number; durationMs?: number }): RouteTransitionSpec {
  const spec = APP_TRANSITION_MAP[transition as RouteTransition]
  if (!spec) return APP_TRANSITION_MAP.none
  if (!opts || (opts.distance === undefined && opts.durationMs === undefined)) return spec
  // 参数覆盖：按转场名重建（各预设的入参面不同，只传两者共有的）
  const p = opts.distance
  const d = opts.durationMs
  switch (transition as RouteTransition) {
    case 'slideUp':
      return presets.route.slideUp({ distance: p, durationMs: d })
    case 'slideDown':
      return presets.route.slideDown({ distance: p, durationMs: d })
    case 'halfScreen':
      return presets.route.bottomSheet({ distance: p, durationMs: d })
    case 'scaleDown':
      return presets.route.zoom({ durationMs: d, fromOffsetY: p })
    default:
      return spec
  }
}

/** 本端支持的转场清单（**从映射表推导**，不手写第二份——防漂移） */
export function appTransitions(): RouteTransition[] {
  return Object.keys(APP_TRANSITION_MAP) as RouteTransition[]
}
