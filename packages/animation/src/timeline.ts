// packages/animation/src/timeline.ts
// ★★Morpheus（MA1 收尾）—— **跨属性共享时间轴**（此前记在「未做」清单里的最后一项能力缺口）
//
// 【先纠正一个判断（取证结论，2026-09-30）】此前文档把"多属性严格对齐的分段编排"记为
//   "评估中/未做"。**取证后发现内核侧并不缺能力**：`AnimEngine::tick` 在**单次调用内**
//   对**所有**动画施加同一个 `dt`（`for (mut a, idx) in self.anims.drain(..) { step(&mut a, dt_ms) }`）
//   ⇒ 只要各轨道**总时长相同**，它们的时间推进就是**结构性同步**的
//   （Rust 侧 `cross_property_tracks_advance_in_lockstep` + `..._independent_of_tick_granularity` 两条判据钉住）。
//   ⇒ 缺的是**声明面入口**：手写时"给每条轨道凑同一个总时长"极易算错（少 1ms 就错拍），
//     而且错了**不会报错**——只是看起来"有点不齐"（典型静默缺陷）。
//   本模块就是那个入口：**停靠点（stops）共享，各属性各自的段由它推导**，总时长**由构造保证一致**。
//
// 【与 `keyframes` 的关系】`keyframes` 是**单属性**的多段（MA6）；`timeline` 是**多属性**共享
//   停靠点（本模块）。两者最终都编译成 `AnimDecl.keyframes`（同一份内核语义），
//   故校验/编译/平台路径**全部复用**（不新增第二条求值路径）。

import type { AnimDecl, AnimKindName, AnimTargets, CompiledBatch, CurveName, KeyframeSeg } from './types'
import { compileAnimations } from './compile'
import type { CompileOptions } from './compile'

/** 一个**停靠点**：在 `at` 毫秒处，各属性各自的值 */
export interface TimelineStop {
  /** 时间点（毫秒，从 0 起；**首停靠点必须是 0**） */
  at: number
  /**
   * 该停靠点上各属性的值（**每个轨道都必须在每个停靠点有值**——缺失即"断轨"，直接报错）。
   * 键 = `AnimKindName`（`translateX` / `translateY` / `scale` / `rotate` / `opacity`）。
   */
  values: Partial<Record<AnimKindName, number>>
  /** 从本停靠点到**下一**停靠点所用的曲线（缺省 `easeOut`；最后一点的值被忽略） */
  curve?: CurveName
}

/**
 * 共享时间轴声明（**多属性、共享停靠点**）
 *
 * ```ts
 * // "卡片先压下再弹回，同时位移与淡入——三条轨道严格同拍"
 * const c = compileTimeline({
 *   kinds: ['scale', 'translateY', 'opacity'],
 *   stops: [
 *     { at: 0,   values: { scale: 1, translateY: 0,  opacity: 0 }, curve: 'easeOut' },
 *     { at: 90,  values: { scale: 0.94, translateY: 6, opacity: 1 }, curve: 'springApprox' },
 *     { at: 350, values: { scale: 1, translateY: 0, opacity: 1 } },
 *   ],
 * }, { nodeId: cardId })
 * // ⇒ 3 条动画，**总时长都是 350ms**（由构造保证）；内核单次 tick 内同步推进 ⇒ 严格同拍
 * ```
 */
export interface TimelineSpec {
  /**
   * 参与时间轴的属性（每项编译成一条动画；**不许重复**）
   *
   * ★**只接受标量属性**（2026-10-01 明确）：`color` 的值是颜色字符串，而停靠点的
   *   `values` 是数字表 ⇒ 颜色轨道**类型不过**（不是运行时才发现）。这是 v1 的显式边界：
   *   颜色要"多属性同拍"，把它的 4 条通道当独立动画另发即可
   *   （`compileAnimations([{ kind: 'color', … }])`），时间轴暂不承载颜色。
   */
  kinds: readonly Exclude<AnimKindName, 'color'>[]
  /** 停靠点（**按 `at` 严格升序**；首点 `at === 0`） */
  stops: readonly TimelineStop[]
}

/** 时间轴校验失败（带可操作提示——不静默） */
function assertTimeline(spec: TimelineSpec): void {
  const { kinds, stops } = spec
  if (!Array.isArray(kinds) || kinds.length === 0) {
    throw new Error('时间轴需要至少一个轨道（`kinds` 为空）')
  }
  if (new Set(kinds).size !== kinds.length) {
    throw new Error(`\`kinds\` 含重复属性：${kinds.join(' / ')}（每属性只能有一条轨道——内核对同 (节点,属性) 是替换语义）`)
  }
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new Error('时间轴需要至少**两个**停靠点（单点无法构成区间——单段动画请直接用 curve/spring）')
  }
  let prev = -Infinity
  stops.forEach((s, i) => {
    if (!Number.isFinite(s.at)) throw new Error(`停靠点 #${i} 的 \`at\` 非有限数`)
    if (s.at <= prev) {
      throw new Error(`停靠点必须按 \`at\` **严格升序**（#${i} = ${s.at}ms，前一点 = ${prev === -Infinity ? '—' : `${prev}ms`}）`)
    }
    prev = s.at
  })
  if (stops[0]!.at !== 0) {
    throw new Error(`首停靠点必须是 \`at: 0\`（当前 ${stops[0]!.at}ms）——时间轴从"现在"开始，起点前的偏移请用 \`delayMs\``)
  }
  // 每个轨道在每个停靠点都必须有值（缺失 = 断轨：那一段不知道该动到哪 ⇒ 静默错形）
  stops.forEach((s, i) => {
    for (const k of kinds) {
      const v = s.values[k]
      if (v === undefined) {
        throw new Error(
          `轨道 \`${k}\` 在停靠点 #${i}（at=${s.at}ms）没有值——**每个轨道都必须在每个停靠点有值**；`
            + '若该属性此刻不该动，请显式写"不动"的目标值（缺失会变成静默错形）',
        )
      }
      if (!Number.isFinite(v)) throw new Error(`轨道 \`${k}\` 在停靠点 #${i} 的值非有限数：${v}`)
    }
  })
}

/**
 * ★★**编译共享时间轴**（多属性、共享停靠点）
 *
 * @returns `CompiledBatch`——`anims.length === kinds.length`，且**所有动画的总时长相同**
 *   （由构造保证；这正是内核 lockstep 推进的前提）
 * @throws 校验失败（停靠点乱序 / 缺值 / 重复轨道等；见 `assertTimeline`）
 */
export function compileTimeline(spec: TimelineSpec, targets: AnimTargets, opts?: CompileOptions): CompiledBatch {
  assertTimeline(spec)
  const { kinds, stops } = spec
  const decls: AnimDecl[] = kinds.map((kind) => {
    const segs: KeyframeSeg[] = []
    for (let i = 1; i < stops.length; i++) {
      segs.push({
        to: stops[i]!.values[kind]!,
        durationMs: stops[i]!.at - stops[i - 1]!.at,
        // 曲线属于"**从上一停靠点到本停靠点**"这一段 ⇒ 取上一停靠点的 curve
        curve: stops[i - 1]!.curve ?? 'easeOut',
      })
    }
    const last = stops[stops.length - 1]!
    return {
      kind,
      from: stops[0]!.values[kind]!,
      to: last.values[kind]!,
      // ★总时长取"最后一个停靠点的 at"——各轨道**同一个数**（由构造保证一致，不靠调用方凑）
      durationMs: last.at,
      keyframes: segs,
    }
  })
  // 复用既有编译（校验 / 逃生口记账 / 合成属性判定全部同一份实现——不新增第二条路径）
  return compileAnimations(decls, targets, opts)
}

/** 时间轴总时长（毫秒；`stops` 末点的 `at`）——供调用方做编排/交接参考 */
export function timelineDuration(spec: TimelineSpec): number {
  const last = spec.stops[spec.stops.length - 1]
  return last ? last.at : 0
}
