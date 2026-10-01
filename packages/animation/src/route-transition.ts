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
import type { AnimDecl, CompiledBatch } from './types'
import type { RouteTransitionSpec } from './presets'
import { presets } from './presets'
import { compileAnimations, isColorDecl } from './compile'

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

// ══════════════════════════════════════════════════════════════════
// ★★方向语义与执行器入口（2026-09-30：M5 虚拟栈消费者接线）
//
// 【为什么需要（M5 §0.4 契约的原话）】"退场方向（pop 的反向转场）由执行器/Morpheus 推导
//   ——**动画知识不在 router**"。而此前 `appTransition()` **全仓零真实调用点**
//   ⇒ 既有"就绪的第三腿"没有被任何执行器消费；本段补上"推入/返回"的方向换算 + 批次入口。
//
// 【方向语义（本段的核心）】
//   · `forward`（push/replace/新页进入）：**进场页播 `spec.enter`，旧页播 `spec.exit`**——原样。
//   · `back`（pop/popTo/返回）：**两组声明各自反向播放**——
//       离开的旧顶播 `reverse(enter)`（如 slideUp 的"800→0 推入"反向成"0→800 滑出"）；
//       回来的下层页播 `reverse(exit)`（视差 -240→0、透明度 0.7→1 复原）。
//     ⇒ 这是"返回动画"与"推入动画"镜像对成的唯一实现（执行器不再各写一份）。
// ══════════════════════════════════════════════════════════════════

/**
 * **反转一组声明**（`from`/`to` 互换；曲线/时长/弹簧/序列**原样**）——返回动画的基础操作。
 *
 * ★语义细节（都有测试守）：
 *   · `from` 缺省（= 起点由内核取当前值）反转时按 **0** 落定（与 `compileOne` 的缺省一致）；
 *   · `keyframes`（序列）**不逐段反转**——整条序列的端点互换（`from`↔`to`），
 *     段内曲线保持（"先下压再弹回"反向播放仍是它自己的形状，不是逐段镜像——逐段镜像
 *     会改变缓动观感，属另一个特性，本仓未声称）；
 *   · 弹簧参数保持——回程用同一物理（不引入第二套参数）。
 */
export function reverseDecls(decls: readonly AnimDecl[]): AnimDecl[] {
  return decls.map((d) => {
    // ★★颜色声明（2026-10-01）：`from` 在类型上**必填**（内核对颜色无"缺省 = 当前值"语义，
    //   见 `ColorAnimDecl.from` 注释）⇒ 端点互换即可，**不需要**标量路径那条 `?? 0` 兜底
    //   （那条兜底存在是因为标量的 `from` 可省；颜色省不了——类型系统已保证，故此处不做兜底，
    //    也就不会把 `0`（数字）塞进颜色字段造成类型错误）。
    if (isColorDecl(d)) {
      const { from, ...rest } = d
      return { ...rest, from: d.to, to: from }
    }
    const { from, ...rest } = d
    return { ...rest, from: d.to, to: from ?? 0 }
  })
}

/** 空批次（与 `compileRoute` 对空 exit 的形态一致——调用方无需处理 undefined） */
const EMPTY_BATCH: CompiledBatch = { anims: [], composited: true, nonComposited: [] }

/** 转场方向：`forward` = push（新页进入）；`back` = pop（返回——两组声明各自反向） */
export type RouteTransitionDirection = 'forward' | 'back'

/** 执行器入口的产物：两页各自要播的**已绑定节点**批次 + 编排参数 */
export interface RouteTransitionPlan {
  /** 进入视野的页（forward：新页；back：返回后可见的下层页）的批次 */
  incoming: CompiledBatch
  /** 离开视野的页（forward：被压住的旧页；back：正在滑出、随后销毁的旧顶）的批次 */
  outgoing: CompiledBatch
  durationMs: number
  opaque: boolean
  direction: RouteTransitionDirection
  /** 规范化的枚举名（非法输入已归一到 `none`） */
  transition: RouteTransition
  /**
   * ★预设的语义角色（见 `RouteTransitionSpec.role`）：
   *   · `'push'`（对称型）：`enter`/`exit` 是"前进语义"，back 走角色互换 + 反向（镜像对）；
   *   · `'dismiss'`（退场型，如 `slideDown`）：`exit` 描述"被关闭页下滑"（pop 语义），**原样**绑定。
   * ★调用方（执行器/演示装置）可据此判断"这个转场在哪个方向才有意义"——
   *   `'dismiss'` 型的动作是"退场"，**forward 方向下新页静止 ⇒ 视觉上看不到退场动作**（如实语义，不是 bug）。
   */
  role: 'push' | 'dismiss'
}

/**
 * ★★**转场批次入口**（执行器唯一调用点；与 `ScreenCommand.enter/exit` 的命令流配套）
 *
 * @param transition 来自命令流（`ScreenCommand.enter/exit` 的 `transition`；非法/缺省 ⇒ none）
 * @param targets 两页的**节点 id**（屏子树根节点；`incoming` 缺省 = 只播退场——如 exit-only 提交）
 * @param opts `direction`（缺省 forward）+ 预设参数覆盖（distance/durationMs）
 *
 * @returns 两页各自的一批指令（一次 `animStart` 合并喂给引擎——**一次导航 = 一次跨边界提交**）
 * @throws 校验失败（声明非法/非合成——与直接调 `compileRoute` 同一红线，不静默降级）
 */
export function routeTransitionBatches(
  transition: unknown,
  targets: { incoming?: number; outgoing?: number },
  opts?: { direction?: RouteTransitionDirection; distance?: number; durationMs?: number },
): RouteTransitionPlan {
  const spec = appTransition(transition, opts)
  const direction: RouteTransitionDirection = opts?.direction ?? 'forward'
  const role: 'push' | 'dismiss' = spec.role ?? 'push'
  // ★★方向绑定（两类角色，见 `RouteTransitionSpec.role` 的完整说明）：
  //   · 'push'（对称型）：back = **角色互换 + 反向播放**（镜像对）；
  //   · 'dismiss'（退场型，如 slideDown）：`exit` 就是"被关闭页下滑"（pop 语义）⇒ **原样绑定**
  //     （若按 push 推导会得到"下层页升上来"——方向完全相反，产品页演示取证抓出）。
  const effective =
    role === 'dismiss'
      ? { enter: spec.enter, exit: spec.exit, durationMs: spec.durationMs, opaque: spec.opaque }
      : direction === 'back'
        ? { enter: reverseDecls(spec.exit), exit: reverseDecls(spec.enter), durationMs: spec.durationMs, opaque: spec.opaque }
        : { enter: spec.enter, exit: spec.exit, durationMs: spec.durationMs, opaque: spec.opaque }
  const name: RouteTransition = (Object.keys(APP_TRANSITION_MAP) as RouteTransition[]).includes(transition as RouteTransition)
    ? (transition as RouteTransition)
    : 'none'
  // ★空规格 = 无动画转场（`none` / 缺省 / exit 为空的预设如 `bottomSheet`）——
  //   必须**短路**返回空批次：`compileAnimations([])` 是**红线**（"空声明"是调用方的错，
  //   不是"没有动画"的表达——表达"没有动画"的正是本分支）。真机实测抓出：首版直接进
  //   compileRoute ⇒ `none` 转场抛 "[empty] 动画声明为空"。
  // ★两侧各自独立判空（`bottomSheet` 只动进场页、`slideDown` 只动退场页 ⇒ 各有一侧为空）
  const incoming =
    targets.incoming !== undefined && effective.enter.length > 0
      ? compileAnimations(effective.enter, { nodeId: targets.incoming })
      : EMPTY_BATCH
  const outgoing =
    targets.outgoing !== undefined && effective.exit.length > 0
      ? compileAnimations(effective.exit, { nodeId: targets.outgoing })
      : EMPTY_BATCH
  return { incoming, outgoing, durationMs: spec.durationMs, opaque: spec.opaque, direction, transition: name, role }
}
