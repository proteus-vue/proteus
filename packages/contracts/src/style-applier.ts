// packages/contracts/src/style-applier.ts
// ★★★G-61 B0（2026-10-05）：**SApp（Style Applier）宿主样式应用器 SPI** —— 契约冻结
//
// 【它是什么（plan `docs/proteus-css-engine-plan/02-style-ir-contract.md` §7）】
//   L-C 层：**每宿主一个**样式应用器，是**样式唯一的落地点**。链路：
//     L-A CSE（编译期 CSS 引擎，唯一实现）→ **L-B StyleIR**（唯一样式产物）
//       → **L-C SApp（本文件）** → 宿主原生（Android View 属性 / iOS CALayer / 鸿蒙 RenderNode / …）
//   ⇒ 新增一个 CSS 字段 = 改 IR 规范 + 各端 Applier（**不再各处手写读字段**，消灭立项勘察的 G3）。
//
// 【与 G-27 `ProteusRenderBackend.patchProp` 的关系（★不造第二套 SPI）】
//   G-27 的 `patchProp` 消费的是**已解析的 prop 值**（Vue 语义面：`style` 对象 / `class`）；
//   本 SPI 消费的是 **StyleIR（已折叠的计算样式）**——即"声明→字段"这一段映射。
//   ⇒ 二者是**上下游**不是替代：SApp 产出的是"逐字段应用"，`patchProp` 是"Vue 属性写入口"。
//   plan §6 已定调：SApp 定位为 G-27 的**样式子域**，避免两套 SPI 打架。
//
// 【零运行期解析（INV-CE-03）】本契约的输入必须**已折叠**：不含 CSS 文本、不含函数表达式、
//   不含选择器/层叠/单位换算（那些在 L-A 编译期完成）。宿主实现只做"把值写到原生对象上"。
//
// 【可 conformance（INV-CE-02）】同一份 IR 喂给三个 Applier ⇒ "应用后状态"必须与 **Web 基准**等价
//   （`packages/consistency` 的 snapshot 判定）。未过 conformance ⇒ 不得标记该端"已落地"。
//
// 本文件 = **纯类型 + 零依赖**（contracts 是叶子包，不引任何实现）。
import type { ResolvedLength } from './style-ir-values'

/** StyleIR 契约版本（SSOT 在 `style-ir-registry.generated.ts`——此处 re-export 供 SPI 消费方单点引用） */
export type { ResolvedLength } from './style-ir-values'
export type { LengthBase } from './style-ir-values'

/**
 * 归一化的样式值（v1 值类型闭集）。
 * ★设计约束（plan §3）：长度必须**已折叠**（absolute dp 或 ratio + 显式基准）；颜色统一 `#RRGGBB[AA]`。
 */
export type StyleValue =
  | string // 颜色（#RRGGBB / #RRGGBBAA）/ 枚举（display/flexDirection/textAlign…）
  | number // 无单位数值（opacity / flexGrow / fontWeight / zIndex…）
  | boolean // 布尔（pointerEvents 等）
  | ResolvedLength // 长度（已折叠：absolute dp | ratio + base | auto）
  | null // 未设置（显式"无值"——与 undefined 区分：null = 显式清空）

/** 一条样式声明（字段名 = StyleIR 字段闭集的键；值 = `StyleValue`） */
export interface StyleDeclaration {
  /** StyleIR 字段名（必须在 `STYLE_IR_FIELDS` 内——否则应用器按"未知字段"策略处理） */
  field: string
  value: StyleValue
  /** 来源标记（诊断用；不进原生对象） */
  origin?: 'inline' | 'class' | 'inherited' | 'default' | 'derived'
}

/**
 * **StyleIR 载荷** = 一个节点的计算样式（键 = 字段名，值 = `StyleValue`）。
 * ★这是跨端契约的单位：编译期产出、序列化下发给宿主、被各端 Applier 消费。
 */
export interface StyleIR {
  /** 契约版本（与 `STYLE_IR_VERSION` 对齐——版本不符时应用器须显式拒绝，不静默） */
  version: number
  /** 逐字段计算样式 */
  declarations: Record<string, StyleValue>
  /**
   * 可选：逐字段的来源链（`proteus explain` 的 trace 载体——plan §3.3「引擎与字段折叠器的分界线」）。
   * 生产可不带（体积）；诊断/测试带上。
   */
  trace?: Record<string, StyleDeclaration['origin'] | Array<{ rule: string; step: string }>>
}

/** 应用相位（决定应用器的行为差异：首屏可批量、更新须增量、主题走 token 重算、动画走帧通道） */
export type ApplyPhase = 'mount' | 'update' | 'theme' | 'animate'

/**
 * 增量补丁（动态 class / 主题切换的最小差量）。
 * ★与 `StyleIR` 的关系：`StylePatch` = 两个 IR 的 diff（编译期算好），宿主只应用差量。
 */
export interface StylePatch {
  /** 要写入/覆盖的字段 */
  set: Record<string, StyleValue>
  /** 要清除的字段（回到"未设置"） */
  unset?: string[]
}

/** 宿主对单个字段的能力档位（喂给 Capability Registry 的 byHost 校验） */
export type FieldSupport =
  /** 原生直接实现（写一个原生属性即可） */
  | 'native'
  /** 编译期重写后实现（如 vh→ratio、rgba→hex8） */
  | 'rewritten'
  /** 编译期降级实现（如 grid→嵌套 flex——语义等价，配方在 Registry 的 `degradeTo`） */
  | 'degraded'
  /** 该端不支持（编译期须报错或走降级，运行期**不得**静默忽略） */
  | 'absent'

/** 宿主的样式能力声明（覆盖 IR 全字段；未实现必须显式 `absent`——INV-CE-04 禁假绿） */
export interface HostStyleCapabilities {
  /** 宿主标识（`web` / `skyline` / `app`——App 三平台共享一套引擎，见 plan §3 的三端模型） */
  host: 'web' | 'skyline' | 'app'
  /** 逐字段能力（缺省视为 `absent`——不撒谎） */
  fields: Record<string, FieldSupport>
  /** 该宿主的已知量化差异（如"整套 UI ×1.15"这类密度差——如实登记，不静默） */
  notes?: string[]
}

/** 应用结果（可观测：应用器**不得**静默失败——plan INV-CE-04） */
export interface ApplyResult {
  /** 成功应用的字段数 */
  applied: number
  /** 跳过的字段（含原因——"不支持"必须可见，不得静默） */
  skipped: Array<{ field: string; reason: 'unsupported' | 'absent' | 'unknown-field' | 'invalid-value' }>
  /** 降级发生的字段（编译期配方执行结果——运行期降级属违约） */
  degraded?: Array<{ field: string; recipe: string }>
}

/** 度量结果（承接既有 measure 能力；可选——宿主不提供文本度量时省略） */
export interface MeasureResult {
  width: number
  height: number
  /** 基线（文本类节点用；缺省 = 无基线概念） */
  baseline?: number
}

/**
 * ★★★**SApp · 宿主样式应用器 SPI**（G-61 L-C 契约）。
 *
 * 实现者（每宿主一个）：
 *   · Web Applier（**A 档**：不接管渲染；只做 IR 探针 + 基准采集器——plan §7.1）
 *   · Skyline Applier（IR → wxss 子集 + 编译期降级）
 *   · App Applier（IR → `layout-core-rust` 引擎字段 + 绘制属性；**复用既有 `apply_style_key` 通道**）
 */
export interface ProteusStyleApplier {
  /** 该端声明能做什么（喂给 Capability Registry 的 byHost 校验——INV-CE-04） */
  capabilities(): HostStyleCapabilities

  /** 完整应用一个节点的 IR（首屏 / 整屏重建）——**唯一样式落地点** */
  applyStyleIR(node: unknown, ir: StyleIR, phase: ApplyPhase): ApplyResult

  /** 增量应用（动态 class / 主题切换；与既有 `patchProp` 通道对接） */
  applyDiff(node: unknown, patch: StylePatch): ApplyResult

  /** 可选：文本/自适应度量（承接既有 measure 能力） */
  measure?(node: unknown): MeasureResult
}

/**
 * conformance 判据的输入形态（plan §7.2）：同一 IR 喂给各 Applier ⇒ 采集"应用后状态" ⇒ 与 **Web 基准**等价。
 * ★比对对象是 **Web 基准**（`expected`），**不是端与端互比**（D1：两端可以同时偏且一致）。
 */
export interface ApplierConformanceCase {
  id: string
  /** 输入 IR（同一份喂给所有端） */
  ir: StyleIR
  /** 期望的应用后状态（来自 Web 基准采集——B-a/B-b） */
  expected: {
    /** 逐字段归一化值（相对基准） */
    fields: Record<string, StyleValue>
    /** 允许的容差档位（承 `packages/consistency/src/tolerance.ts`——禁全局阈值） */
    tolerance: 'structure' | 'color' | 'font' | 'textMetrics' | 'nonDeterministic'
  }
}
