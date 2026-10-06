// packages/contracts/src/style-ir-values.ts
// ★★★G-61 B0（2026-10-05）：**StyleIR 值类型**（契约冻结——plan `02-style-ir-contract.md` §3）
//
// 【为什么单独一个文件】值类型是 StyleIR 契约的**地基**（长度三态 / 四边 / 四角 / 2D 变换），
//   被 `style-applier.ts`（SPI）与 `style-ir-registry.generated.ts`（字段表）共同引用；
//   放在 contracts 叶子包 ⇒ 任何端（含宿主侧 TS 桥）都能零依赖引用，**不引入第二份定义**。
//
// 【与既有资产的关系（★不重造）】`ResolvedLength` 与 `packages/component-ir/src/pnode.ts` 的定义
//   **同构**（`{kind:'absolute',dp}` | `{kind:'ratio',ratio,base}`）——那边是 M0 阶段的实现，
//   本文件是**跨层契约**（contracts 是所有人的依赖方向终点）。两处语义必须一致：
//   CSE 的单位折叠真值在 `component-ir/src/pnode-style.ts::resolveLength`（唯一实现，本文件只声明形状）。
//
import type { EnvVarName } from './env-vars'

// 【零运行期解析（INV-CE-03）】本文件只有**已折叠形态**：不含 CSS 文本、不含函数表达式。

/** 比例基准（CSS 百分号 / 视口单位 / 字号单位的求值基准——显式写出，消除"宽高百分比基准"分歧） */
export type LengthBase =
  | 'parentWidth'
  | 'parentHeight'
  | 'viewportWidth'
  | 'viewportHeight'
  | 'fontSize'
  | 'rootFontSize'

/**
 * 已折叠的长度（三态 + null）。
 * ★纪律（plan §3）：`absolute` 与 `ratio` **不得同时表达同一维度的语义**——
 *   禁止"既给 dp 又给比例"导致各端自由选择（那正是不一致的来源）。
 */
export type ResolvedLength =
  | { kind: 'absolute'; dp: number }
  | { kind: 'ratio'; ratio: number; base: LengthBase }
  /**
   * ★★★环境变量引用（2026-10-08 · 决策 #593）：值来自**运行期环境表**（内置 `--pf-*`）——
   *   编译期不折字面值，发射“引用”；求值时 = 环境表[name] + offset（逻辑像素）。
   *   `offset`：`calc(var(--pf-X) + Npx)` 的常量偏移；`fallback`：`var(--pf-X, Npx)` 的第二参数。
   *   ★合法名 = `EnvVarName` 闭集（`packages/contracts/src/env-vars.ts`）；未知名编译期报错（不静默为 0）。
   */
  | { kind: 'env'; name: EnvVarName; offset?: number; fallback?: number }
  | { kind: 'auto' }
  | null

/** 四边值（margin / padding / border-width / border-color …） */
export interface StyleEdges<T> {
  top: T
  right: T
  bottom: T
  left: T
}

/** 四角值（border-radius 逐角） */
export interface StyleCorners<T> {
  topLeft: T
  topRight: T
  bottomRight: T
  bottomLeft: T
}

/** 2D 变换（plan §3：v1 只支持 2D 子集——3D / skew / matrix 由 lint 拦截或降级） */
export interface StyleTransform2D {
  tx: ResolvedLength
  ty: ResolvedLength
  /** 缩放（等比时 sx === sy） */
  sx: number
  sy: number
  /** 旋转（度） */
  rotateDeg: number
  /** 变换锚点（盒分数 0..1——与三端宿主既有 `transformOrigin` 同口径） */
  originX: number
  originY: number
}

/** 颜色（统一规范化：`#RRGGBB` | `#RRGGBBAA`——CSS4 序，低 8 位 alpha） */
export type StyleColor = string

/** 值类型名（注册表的 `valueType` 字段读它——UI 与门禁共用的闭集） */
export type StyleValueType =
  | 'length'
  | 'color'
  | 'number'
  | 'enum'
  | 'transform'
  | 'transform-origin'
  | 'engine-field'
  | 'semantic-only'
  | 'forbidden'
