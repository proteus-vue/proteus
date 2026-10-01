// packages/animation/src/compile.ts
// ★★Morpheus（MA1）—— **声明 → 引擎指令**（编译期；曲线求值不在这里，在内核）
//
// 【为什么要"编译"这一步（而不是声明直接下发）】
//   ① **声明与目标解耦**：预设是可复用的（同一个"滑入"用于任意页面），节点 id 只有运行时知道
//      ⇒ 编译期把二者绑定（`compileAnimations(decls, targets)`）；
//   ② **编译期校验**：非法/非合成属性在这里被拦下（§5-bis.2），不等到运行时掉帧；
//   ③ **默认值归一**：曲线/时长的缺省在编译期落定 ⇒ 下发给内核的指令**没有歧义**。
import { ANIM_KIND_ID, AnimKind, CURVE_ID } from './types'
import type { AnimDecl, AnimKindId, AnimTargets, CompiledBatch, CurveId, EngineAnim } from './types'
import { validateAnimations, isComposited } from './validate'
import { parseColorToChannels } from './color'

/**
 * 编译选项（**可选注入**——与 C4 漏点计数器的注入模式同构）
 *
 * ★为什么是"注入"而不是"内部记账"：`compileAnimations` 是**纯函数**（可预测、可缓存、零全局状态），
 *   这个性质值得保住 ⇒ 只有调用方显式传入注册表时才记账（见 `escape.ts` 的逃生口统计）。
 */
export interface CompileOptions {
  /**
   * 逃生口注册表：成功编译的声明会计入"声明式使用量"（逃生口率的分母）。
   * 不传 ⇒ 零副作用（纯函数行为不变）。
   */
  escapes?: { noteDeclarative: (n: number) => void }
}

/**
 * 编译一批声明为**引擎指令**
 *
 * @param decls 声明（封闭集）
 * @param targets 目标节点（单个；多条声明可作用于同一节点——如转场的"进场页"同时位移+淡入）
 * @param opts 可选（逃生口记账——见 `CompileOptions`）
 * @throws 有校验问题时**抛错**（带可读的修复建议）——不静默降级
 */
export function compileAnimations(
  decls: readonly AnimDecl[],
  targets: AnimTargets,
  opts?: CompileOptions,
): CompiledBatch {
  const issues = validateAnimations(decls)
  if (issues.length > 0) {
    const detail = issues.map((i) => `[${i.code}] #${i.index} ${i.message} → ${i.hint}`).join('; ')
    throw new Error(
      `Morpheus 动画声明校验失败：${detail}` +
        '\n  ⇒ 若封闭集确实表达不了，走**显式逃生口**（`escapes.register({kind, detail, reason, behaviorRisk})`）' +
        '——可用但必须登记并接受 degraded 风险（Morpheus §4.2），不要绕过框架。',
    )
  }
  const anims = decls.flatMap((d) => compileOne(d, targets))
  // ★§4.2：声明式使用量记账（仅在显式注入注册表时——纯函数性质不变）
  opts?.escapes?.noteDeclarative(anims.length)
  // ★★**合成属性判定**（2026-10-01 修正：此前恒 `true`）
  //   颜色（kind 5..8）是 paint-only 但**非合成**（见 validate.ts 的 PAINT_ONLY_KINDS 注释）
  //   ⇒ `composited` 必须如实反映，否则上层会把它当平台路径可用（`isPlatformEligible` 会放行，
  //     而内核 `anim_commit_spec` 侧会**整批拒绝**——两处结论不一致就是"静默分档"）。
  const kindNames = new Set(decls.map((d) => d.kind))
  const composited = [...kindNames].every((k) => isComposited(k))
  return {
    anims,
    composited,
    nonComposited: composited ? [] : [...kindNames].filter((k) => !isComposited(k)),
  }
}

/**
 * 编译单条声明（校验已过的前提下）——★**返回数组**：颜色声明会展开成 4 条通道指令
 *   （见内核 `AnimKind::ColorR/G/B/A`；分解理由：求值机器全是标量的 ⇒ 零改动复用）。
 */
export function compileOne(d: AnimDecl, targets: AnimTargets): EngineAnim[] {
  const easing = resolveEasing(d)
  // ★★颜色：一个声明 → 四条标量通道（R/G/B/A），共用同一曲线/时长/延迟/弹簧
  if (d.kind === 'color') {
    const from = parseColorToChannels(d.from)
    const to = parseColorToChannels(d.to)
    const mk = (kind: AnimKindId, f: number, t: number): EngineAnim => ({
      nodeId: targets.nodeId,
      kind,
      curve: easing.curve,
      from: f,
      to: t,
      durMs: easing.durMs,
      delayMs: d.delayMs ?? 0,
      drive: d.drive === 'progress' ? 1 : 0,
      takeover: d.takeover !== false,
      ...(d.spring
        ? { spring: { stiffness: d.spring.stiffness, damping: d.spring.damping, mass: d.spring.mass ?? 1 } }
        : {}),
      ...(d.scroll ? { scrollFrom: d.scroll.from, scrollTo: d.scroll.to } : {}),
    })
    return [
      mk(AnimKind.COLOR_R, from.r, to.r),
      mk(AnimKind.COLOR_G, from.g, to.g),
      mk(AnimKind.COLOR_B, from.b, to.b),
      mk(AnimKind.COLOR_A, from.a, to.a),
    ]
  }
  return [
    {
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
      // ★MA6：序列（每段曲线在编译期落定；durMs = 各段之和 ⇒ 内核用它做时间→进度换算）
      ...(d.keyframes
        ? {
            keyframes: d.keyframes.map((s) => ({
              to: s.to,
              durMs: s.durationMs,
              curve: CURVE_ID[s.curve ?? 'easeOut'],
            })),
          }
        : {}),
      // ★MA5：滚动窗口（内核据 scrollTo > scrollFrom 判定为滚动驱动）
      ...(d.scroll ? { scrollFrom: d.scroll.from, scrollTo: d.scroll.to } : {}),
    },
  ]
}

/** 求值参数归一（曲线/时长缺省落定——下发给内核的指令不含"未指定"） */
function resolveEasing(d: AnimDecl): { curve: CurveId; durMs: number } {
  // ★MA6：序列模式的时长 = 各段之和（**不是**缺省 300——否则内核的 time→progress 换算会错）
  if (d.kind !== 'color' && d.keyframes) {
    const sum = d.keyframes.reduce((acc, s) => acc + s.durationMs, 0)
    return { curve: CURVE_ID[d.curve ?? 'easeOut'], durMs: d.durationMs ?? sum }
  }
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
 *
 * ★MA5：**滚动驱动批次不具备资格**——平台路径的语义是"提交后平台按时间自主插值"，
 *   而滚动动画的进度来自外部位置；混用会把"跟手"变成"到点自动播放"。
 *   （内核在 `anim_commit_spec` 入口同样**明确拒绝**，此处提前否决省一轮跨边界调用。）
 */
export function isPlatformEligible(batch: CompiledBatch): boolean {
  return batch.composited && batch.anims.length > 0 && !isScrollDriven(batch)
}

/** 该批次是否含**滚动驱动**动画（MA5；内核按 `scrollTo > scrollFrom` 判定） */
export function isScrollDriven(batch: CompiledBatch): boolean {
  return batch.anims.some((a) => (a.scrollTo ?? 0) > (a.scrollFrom ?? 0))
}
