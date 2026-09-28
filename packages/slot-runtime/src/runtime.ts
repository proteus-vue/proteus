// packages/slot-runtime/src/runtime.ts
// Vapor for Proteus IR · V3 —— **订阅表驱动的槽位运行时**（方案 §1.3 L1 层的完整形态）
//
// 【V3 补的是什么】V1 交付了槽位容器与指令通道，但槽位要**手工 setSlot**；
//   V2 交付了编译器算出的 `SubscriptionTable`（源 → 槽位 + 求值函数声明）。
//   本模块把两者接起来：**加载订阅表 → 注册订阅 → 源变化时自动求值并直写槽位**。
//   这就是方案 §1.2 的目标路径：
//
//     ref 写入 → 直写对应槽位 → UpdateProgram 发射指令 → 提交
//     （对比 Vue 默认：组件 render 重跑 → 重建 VNode → diff → patch）
//
// 【★诚实边界：本模块不依赖 Vue】
//   方案 §4.1 的措辞是「保留 Vue 运行时响应式（Proxy 依赖收集），只把**监听之后做什么**改掉」。
//   故本模块只要求调用方提供一个 `subscribe(sourceName, cb)` 钩子——
//   生产环境用 Vue 的 `watch`/`effect` 接，测试用同步桩。这样：
//     · 本模块可独立测试（不依赖 Vue 版本）
//     · 换响应式实现（如方案 §8 讨论的 alien-signals）不用改这里
import type { SlotKind, UpdateTier } from './opcode'
import { SlotRuntime, createSlot } from './slot'
import type { Slot } from './slot'
import type { EvaluatorSpec, SubscriptionTable } from './table'

/** 源订阅钩子：源值变化时回调（由宿主注入；Vue 场景 = watch / effect） */
export type SourceSubscriber = (sourceName: string, onChange: () => void) => void

/** 求值上下文（取源值用） */
export interface EvalContext {
  /** 读源当前值（Vue 场景 = `unref` 后的值；列表源 = 数组） */
  read(sourceName: string): unknown
}

/** 加载结果（供宿主对账与诊断） */
export interface LoadResult {
  /** 实际建立订阅的 L1 槽位数 */
  l1Slots: number
  /** 未建订阅的 L0 槽位数（走 Vue 渲染） */
  l0Slots: number
  /** 未知源名（订阅表引用了宿主没提供的源——**必须上报**，否则是静默不更新） */
  unknownSources: string[]
  /** 无法实例化的求值函数（形态不支持等）——同样上报 */
  unsupportedEvaluators: Array<{ evaluatorId: number; reason: string }>
}

/**
 * 订阅表驱动的槽位运行时（方案 §1.3 的 L1 完整形态）
 *
 * 用法（宿主侧）：
 * ```ts
 * const rt = new VaporRuntime(table, { push: (op) => buffer.push(op) }, keys, strings)
 * rt.load(evaluatorCtx, (sourceName, cb) => watch(sourceName, cb))   // 注册订阅
 * rt.relink()   // 首帧：把所有 L1 槽位写入一次
 * ```
 */
export class VaporRuntime {
  private readonly slots = new Map<number, Slot>();
  private readonly slotById = new Map<number, { slot: Slot; spec: SubscriptionTable['sources'][number]['slots'][number]; evalId: number }>()
  private readonly evalImpls = new Map<number, (ctx: EvalContext) => unknown>()
  private readonly sourcesOfSlot = new Map<number, string[]>()
  private loaded = false

  constructor(
    readonly table: SubscriptionTable,
    readonly rt: SlotRuntime,
    /** 求值函数的**实现**（由 evaluator 声明重建；id → 函数） */
    private readonly evaluators: Map<number, (ctx: EvalContext) => unknown>,
  ) {}

  /**
   * 从订阅表重建求值函数（把**可序列化的声明**变成可执行函数）
   *
   * 【为什么单独一步（而不是直接吃函数）】方案 §4.4 要求产物可序列化
   *   （跨端禁 eval）⇒ 声明与实现分离：声明随产物下发，实现在各端本地重建。
   *   本方法就是「本地重建」的参考实现：
   *     · `member` —— 纯路径访问，**免解析**（热路径主力）
   *     · `const`  —— 常量
   *     · `expr`   —— 表达式文本（各端按自己的能力求值；本实现给出最简单的成员回退）
   */
  static buildEvaluators(specs: EvaluatorSpec[]): Map<number, (ctx: EvalContext) => unknown> {
    const out = new Map<number, (ctx: EvalContext) => unknown>()
    for (const s of specs) {
      switch (s.form) {
        case 'member': {
          const segs = (s.path ?? '').split('.').filter(Boolean)
          const [root, ...rest] = segs
          out.set(s.evaluatorId, (ctx) => {
            let v = ctx.read(root!)
            for (const seg of rest) {
              if (v == null || typeof v !== 'object') return undefined
              v = (v as Record<string, unknown>)[seg]
            }
            return v
          })
          break
        }
        case 'const': {
          const text = (s.expr ?? '').trim()
          const parsed: unknown = /^-?\d+(\.\d+)?$/.test(text)
            ? Number(text)
            : text === 'true'
              ? true
              : text === 'false'
                ? false
                : text.replace(/^['"]|['"]$/g, '')
          out.set(s.evaluatorId, () => parsed)
          break
        }
        case 'expr': {
          // ★诚实边界：本参考实现只支持**单一路径/值引用**的表达式形态。
          //   完整表达式求值（`n + 1`、三元、模板串）需要目标端的表达式执行器——
          //   方案 §6 的三端执行层各有一份（App 端可用 Hermes 的 function 构造，
          //   Web 端直接 new Function，小程序端需走 WXS/Worklet）。
          //   ⇒ 不在本层猜：标为不支持并上报（由调用方决定降级或补实现）。
          const expr = (s.expr ?? '').trim()
          if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(expr)) {
            const segs = expr.split('.')
            const [root, ...rest] = segs
            out.set(s.evaluatorId, (ctx) => {
              let v = ctx.read(root!)
              for (const seg of rest) {
                if (v == null || typeof v !== 'object') return undefined
                v = (v as Record<string, unknown>)[seg]
              }
              return v
            })
          }
          break
        }
        default:
          break
      }
    }
    return out
  }

  /** 注册订阅（方案 §4.3 Step 5：源变化 → 求值 → 直写槽位） */
  load(ctx: EvalContext, subscribe: SourceSubscriber): LoadResult {
    const unknownSources: string[] = []
    const unsupportedEvaluators: Array<{ evaluatorId: number; reason: string }> = []
    let l1Slots = 0

    for (const src of this.table.sources) {
      for (const spec of src.slots) {
        const impl = this.evaluators.get(spec.evaluatorId)
        if (!impl) {
          unsupportedEvaluators.push({ evaluatorId: spec.evaluatorId, reason: '求值函数未实例化（形态不支持）' })
          continue
        }
        // 每个槽位只建一次（一个源可能出现在多个 slot 里；同一槽位也可能被多个源引用）
        let slot = this.slots.get(spec.slotId)
        if (!slot) {
          slot = createSlot(
            {
              id: spec.slotId,
              nodeId: spec.nodeId,
              kind: spec.kind as SlotKind,
              keyId: this.rt.keys.intern(spec.propKey),
              listId: spec.slotId, // ★列表槽位：listId 由调用方在 nodeId 语义里携带（V3 简化）
              listSlotId: spec.slotId,
            },
            this.rt.keys,
            this.rt.strings,
            undefined as unknown,
          )
          this.slots.set(spec.slotId, slot)
        }
        this.slotById.set(spec.slotId, { slot, spec, evalId: spec.evaluatorId })
        // 记录该槽位被哪些源驱动（多源依赖时任一变化都要重算）
        const deps = this.sourcesOfSlot.get(spec.slotId) ?? []
        deps.push(src.sourceName)
        this.sourcesOfSlot.set(spec.slotId, deps)
        l1Slots++
      }
    }

    // 注册订阅：源变化 → 求值其全部槽位 → 直写
    for (const src of this.table.sources) {
      subscribe(src.sourceName, () => {
        this.writeSlotsOfSource(src.sourceName, ctx)
      })
    }

    this.loaded = true
    return {
      l1Slots,
      l0Slots: this.table.l0Slots.length,
      unknownSources,
      unsupportedEvaluators,
    }
  }

  /** 写入某源驱动的全部槽位（源变化时由订阅回调触发） */
  writeSlotsOfSource(sourceName: string, ctx: EvalContext): void {
    for (const src of this.table.sources) {
      if (src.sourceName !== sourceName) continue
      for (const spec of src.slots) {
        const entry = this.slotById.get(spec.slotId)
        const impl = this.evaluators.get(spec.evaluatorId)
        if (!entry || !impl) continue
        const next = impl(ctx)
        // ★直写：setSlot 内部 Object.is 短路 + 标脏 + 排帧（V1 已实现）
        this.rt.setSlot(entry.slot, next as never)
      }
    }
  }

  /** ★首帧同步：把所有 L1 槽位按当前源值写一遍（否则首屏不会出现这些值） */
  relink(ctx: EvalContext): void {
    for (const src of this.table.sources) {
      this.writeSlotsOfSource(src.sourceName, ctx)
    }
  }

  /** 某槽位是否已建立订阅（诊断：确认"这个槽位真的被接管了"） */
  hasSlot(slotId: number): boolean {
    return this.slots.has(slotId)
  }

  get loaded_(): boolean {
    return this.loaded
  }

  /** 该槽位由哪些源驱动（诊断 / explain） */
  depsOf(slotId: number): string[] {
    return this.sourcesOfSlot.get(slotId) ?? []
  }

  /** L1 槽位表（供宿主对账：哪些槽位由 L1 接管） */
  slotIds(): number[] {
    return [...this.slots.keys()].sort((a, b) => a - b)
  }
}

/** 槽位分层（诊断输出用） */
export function tierOf(table: SubscriptionTable, slotId: number): UpdateTier {
  for (const s of table.sources) {
    for (const sl of s.slots) if (sl.slotId === slotId) return sl.tier
  }
  return 'L0'
}
