// packages/contracts/src/scroll.ts
// ★★SC（可停靠滚动容器）契约 —— 声明式封闭集（《可停靠滚动容器与滚动编排能力方案》§6）
//
// 【本文件是什么】把方案 §0.1 的"统一抽象"固化成**可机器校验的声明面**：
//   两个场景（Sheet 弹层 / 页面级内容容器）**只差三个参数**——
//     ① 是否模态（`modal`）② 停靠参照系（`anchor: 'top' | 'bottom'`）③ 初始档位（`initial`）
//   ⇒ 一个封闭集，不是两个组件。本契约是该封闭集的**唯一事实来源**：
//     编译期校验（SC2）、各端映射（SC5）、一致性校验（SC7）都从这里取值（铁律 #9 同源）。
//
// 【为什么是封闭集而不是开放参数】（方案 §6.3 逃生口清单）
//   开放任意回弹物理函数 / 任意嵌套策略 / 任意滚动事件回调
//   ⇒ 毁掉 conformance 与 AI 可校验（与"不开放任意原生调用"同理）。
//
// 【零运行时依赖】与 contracts/style.ts / layers.ts 同款：纯数据 + 纯类型 + 纯函数。
//
// 【诚实边界（写在最前，不许含糊）】
//   本文件是**声明面契约**；各端**执行**（停靠判定/回弹自算/协商/二楼状态机）尚未实现
//   （见方案 §8 的 SC3–SC7）。当前已落地的是：契约 + 编译期校验 + 门禁（SC2）。
import { LAYER_PRIMITIVES } from './layers'

/**
 * 停靠点（detent）——统一走《单位系统与舍入规范》：声明用**逻辑单位**，
 * 内核产物理像素整数。三种形态（封闭）：
 *   · 分数：`0.4`（= 40%）——跨端唯一可移植的形态（iOS 用分数、Android 用 px、鸿蒙用 vp）
 *   · 关键字：`'full' | 'half' | 'header'`（语义档位，各端映射到自己的默认值）
 *   · 像素：`'120px'`（逃生口**受限**：允许但按逻辑单位解释——见 §6.1「档位最多 3」）
 */
export type DetentSpec = number | 'full' | 'half' | 'header' | `${number}px`

/** 档位上限（方案 §5.1 坑①：鸿蒙 `bindSheet` **最多 3 档且必须递增**）⇒ 取最小公倍数 3 */
export const DETENT_LIMIT = 3

/** 语义关键字 → 参考分数（各端映射的基准；`header` 由容器头部实测高度决定，此处给保守值） */
export const DETENT_KEYWORD_RATIO: Record<'full' | 'half' | 'header', number> = {
  full: 1.0,
  half: 0.5,
  header: 0.2,
}

/**
 * overscroll（回弹）配置（方案 §3：**本轮决策 = 可配**）
 *
 * `mode`：`custom`（默认，框架自算——跨端一致 + 可声明可校验）/ `system`（原生，需显式声明）
 * ★方案 §3.4：默认必须是 custom（否则核心卖点丢一半，且各端原生手感必然不一致）。
 * ★方案 §3.5：`system` 模式**编译期警告 + 登记允许差异清单（VC5-d）**，不得静默。
 */
export interface OverscrollSpec {
  /** 阻尼系数（0 < damping < 1；原生 iOS rubber band 约 0.55——本参数即可配点） */
  damping: number
  /** 最大拉伸位移（逻辑单位；上限保护，防"拖到天边"） */
  maxOffset: number
  mode: 'custom' | 'system'
}

/** 默认回弹配置（与 iOS rubber band 同量级——作为起点，非"最优手感"承诺） */
export const DEFAULT_OVERSCROLL: OverscrollSpec = { damping: 0.55, maxOffset: 120, mode: 'custom' }

/** 嵌套滚动协商策略（方案 §5.2：**iOS 默认扩展、Android 默认不扩展** ⇒ 必须显式声明） */
export const NESTED_POLICIES = ['header-first', 'content-first', 'none'] as const
export type NestedPolicy = (typeof NESTED_POLICIES)[number]

/** 停靠参照系（方案 §0.1：Sheet 距底 / 页面容器距顶——**参数不是分支**） */
export const DOCK_ANCHORS = ['top', 'bottom'] as const
export type DockAnchor = (typeof DOCK_ANCHORS)[number]

/** 二楼模式（方案 §4.4：**只做触发 + 转场参数**，路由复用现有系统） */
export type TwoLevelSpec = 'none' | { route: string }

/**
 * 可停靠滚动容器的**完整声明**（封闭集；方案 §6.1 的机器可读形态）。
 * ★所有字段都对应一个编译期校验点（见 `scroll-safety.ts`）。
 */
export interface DockDeclaration {
  /** 停靠点数组：最多 3、必须递增（方案 §6.2 约束 1） */
  detents: DetentSpec[]
  /** 初始档位：必须是 detents 中一项（方案 §6.1） */
  initial: DetentSpec
  /** 回弹（本轮决策：可配；`system` 需登记） */
  overscroll?: OverscrollSpec
  /**
   * 嵌套协商策略。★方案 §6.2 约束 2：**`scrollExpands` 必填**（各端默认相反）
   *   ——本契约以 `nested` 承担该语义（`none` = 不扩展）。
   */
  nested: NestedPolicy
  /** 从哪一档开始不遮罩（方案 §5.4；模态场景专属） */
  undimmedFrom?: DetentSpec
  /** 是否模态（Sheet=是 / 页面容器=否——**参数不是分支**） */
  modal?: boolean
  /** 停靠参照系（`bottom`=Sheet / `top`=页面容器） */
  anchor?: DockAnchor
  /** 二楼（本轮决策：纳入；只做触发） */
  twoLevel?: TwoLevelSpec
}

/** 档位归一为参考分数（校验"递增"与"initial ∈ detents"用；`header` 取保守分数） */
export function detentRatio(d: DetentSpec): number {
  if (typeof d === 'number') return d
  if (typeof d === 'string' && d.endsWith('px')) {
    // 像素档位无法脱离屏幕高判断——给**单调哨兵**（校验递增时按声明顺序比较用）；
    // 真实渲染期的换算走《单位系统与舍入规范》（内核产物理像素）
    return Number(d.slice(0, -2)) / 1000
  }
  return DETENT_KEYWORD_RATIO[d as 'full' | 'half' | 'header'] ?? 0
}

/** 声明是否"模态式 Sheet"（供各端映射与校验分流——参数化，非两套实现） */
export function isSheetLike(decl: Pick<DockDeclaration, 'modal' | 'anchor'>): boolean {
  return decl.modal === true || decl.anchor === 'bottom'
}

/** 层级依赖（方案 §7：吸顶/停靠依赖层级提升——但**归属不同**，本引用只是显式依赖） */
export const DOCK_REQUIRES_LAYER = LAYER_PRIMITIVES.includes('layer-navigation')
