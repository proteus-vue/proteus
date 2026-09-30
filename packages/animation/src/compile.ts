// packages/animation/src/compile.ts
// ★★Morpheus（MA1）—— **声明 → 引擎指令**（编译期；曲线求值不在这里，在内核）
//
// 【为什么要"编译"这一步（而不是声明直接下发）】
//   ① **声明与目标解耦**：预设是可复用的（同一个"滑入"用于任意页面），节点 id 只有运行时知道
//      ⇒ 编译期把二者绑定（`compileAnimations(decls, targets)`）；
//   ② **编译期校验**：非法/非合成属性在这里被拦下（§5-bis.2），不等到运行时掉帧；
//   ③ **默认值归一**：曲线/时长的缺省在编译期落定 ⇒ 下发给内核的指令**没有歧义**。
import { ANIM_KIND_ID, CURVE_ID } from './types'
import type { AnimDecl, AnimTargets, CompiledBatch, CurveId, EngineAnim } from './types'
import { validateAnimations } from './validate'

/**
 * 编译一批声明为**引擎指令**
 *
 * @param decls 声明（封闭集）
 * @param targets 目标节点（单个；多条声明可作用于同一节点——如转场的"进场页"同时位移+淡入）
 * @throws 有校验问题时**抛错**（带可读的修复建议）——不静默降级
 */
export function compileAnimations(decls: readonly AnimDecl[], targets: AnimTargets): CompiledBatch {
  const issues = validateAnimations(decls)
  if (issues.length > 0) {
    const detail = issues.map((i) => `[${i.code}] #${i.index} ${i.message} → ${i.hint}`).join('; ')
    throw new Error(`Morpheus 动画声明校验失败：${detail}`)
  }
  const anims = decls.map((d) => compileOne(d, targets))
  return {
    anims,
    composited: true, // 校验已保证全为合成属性（非合成会抛错）
    nonComposited: [],
  }
}

/** 编译单条声明（校验已过的前提下） */
export function compileOne(d: AnimDecl, targets: AnimTargets): EngineAnim {
  const easing = resolveEasing(d)
  return {
    nodeId: targets.nodeId,
    kind: ANIM_KIND_ID[d.kind],
    curve: easing.curve,
    from: d.from ?? 0,
    to: d.to,
    durMs: easing.durMs,
    delayMs: d.delayMs ?? 0,
    drive: d.drive === 'progress' ? 1 : 0,
    takeover: d.takeover !== false,
    ...(d.spring ? { spring: { stiffness: d.spring.stiffness, damping: d.spring.damping, mass: d.spring.mass ?? 1 } } : {}),
  }
}

/** 求值参数归一（曲线/时长缺省落定——下发给内核的指令不含"未指定"） */
function resolveEasing(d: AnimDecl): { curve: CurveId; durMs: number } {
  if (d.spring) {
    // 弹簧：时长由物理决定；`durMs` 给一个**名义值**（内核会用自然静止时间覆盖采样窗口）
    return { curve: CURVE_ID.easeOut, durMs: d.durationMs ?? 1000 }
  }
  return { curve: CURVE_ID[d.curve ?? 'easeOut'], durMs: d.durationMs ?? 300 }
}

/**
 * 编译成**线格式**（与内核 FFI 入参逐字段一致：`{"anims":[…]}`）
 *
 * ★为什么不在这里序列化成字符串：调用方（宿主桥/测试）可能走 `anim_start`（JSON 入口）
 *   或 `anim_commit_spec`（平台零参与路径）——**同一份数据面**，序列化由各自的桥负责。
 */
export function toWireBatch(batch: CompiledBatch): { anims: EngineAnim[] } {
  return { anims: batch.anims }
}

/**
 * ★★**编译一个路由转场预设**（MA1 的"一句话"入口）
 *
 * @param spec 预设（`presets.route.*()` 的产物）
 * @param targets 两个节点：`enter` = 进场页；`exit` = 出场页（`spec.exit` 为空时可省）
 *
 * @returns `{ enter, exit, durationMs, opaque }`——两组**已绑定节点**的指令；
 *   喂给引擎：`node.animStart(JSON.stringify({ anims: [...enter.anims, ...exit.anims] }))`
 *   （或走平台零参与路径 `anim_commit_spec`——同一份数据面）
 * @throws 校验失败（含**非合成属性**与**同属性重复**两类红线）
 */
export function compileRoute(
  spec: { enter: readonly AnimDecl[]; exit: readonly AnimDecl[]; durationMs: number; opaque: boolean },
  targets: { enter: number; exit?: number },
): { enter: CompiledBatch; exit: CompiledBatch; durationMs: number; opaque: boolean } {
  const enter = compileAnimations(spec.enter, { nodeId: targets.enter })
  const exit =
    spec.exit.length > 0 && targets.exit !== undefined
      ? compileAnimations(spec.exit, { nodeId: targets.exit })
      : { anims: [], composited: true, nonComposited: [] }
  return { enter, exit, durationMs: spec.durationMs, opaque: spec.opaque }
}

/**
 * ★★**平台零参与路径的资格判定**（§5-bis.2）
 *
 * 与内核 `plan_animations` **同语义**（此处为编译期预判，避免明知不可行还发一轮跨边界调用）。
 * 真值以内核为准（内核是唯一实现）——这里是"快速否决"，不是"第二份判定"。
 */
export function isPlatformEligible(batch: CompiledBatch): boolean {
  return batch.composited && batch.anims.length > 0
}
