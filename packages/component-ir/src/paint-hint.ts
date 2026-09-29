// packages/component-ir/src/paint-hint.ts
// ★★paint-hint 的**唯一推导实现**（编译期判定"平台该用哪种绘制策略"）
//
// 【为什么必须抽成独立函数（本仓纪律：同一语义一处实现）】
//   同一个判定有**两条真实调用方**：
//   ① `pnode-style.ts`（PNode / CSS-Profile 路径：样式已被归一化成 PaintProps/TextProps）；
//   ② `renderer-app/adapters/selfdraw.ts`（Vue 运行时路径：样式还是 CSS 原始值/Spec 字段）。
//   两条路径若各写一份判定，**必然漂移**——而漂移的后果是"一类节点在一条路上用紧凑格式、
//   另一条路上不用"，画面/内存只在一半场景出问题，最难查。
//
// 【判据的设计原则：**充分**而非"不矛盾"】
//   每个字段的下游动作都是"**换存储格式 / 不分配存储**"⇒ 条件不充分就**直接画错**（不是慢）。
//   故每个字段都写成"该策略成立的**全部**条件"，且**拿不准一律 false**
//   （宁可保守走通用路径，不可优化出错误画面）。
//
// 【★本模块诞生的直接原因（2026-09-29 实测）】
//   原推导只检查了一半条件，实测两个字段都判错：
//   · `isMonochrome` 不看底色 ⇒ `color:#ffffff;background-color:#285ac8`（4050 夹具的真实形状）判 true；
//   · `isPureBackground` 没排除带文本的节点 ⇒ 同一节点同时判 true（那意味着"没有字形要画"）。
//   而两个 hint 当时**全仓零消费者** ⇒ 缺陷长期不可见；接线前必须先修判据。
import { isOpaqueColor, isNeutralColor } from './color'
import type { PaintHint } from './pnode'

/** 推导输入（**已解析的原始值**——两条调用方都容易提供，不需要先归一化成 PaintProps） */
export interface PaintHintInput {
  /** 该节点是否有文本要画（有字形就有存储需求） */
  hasText: boolean
  /** 文本颜色（CSS 颜色串；未设置 = undefined） */
  textColor?: string | null
  /** 背景色（CSS 颜色串） */
  backgroundColor?: string | null
  /** 是否有背景图/渐变（复合绘制 —— 任何"只有一块底色"的策略都不成立） */
  hasBackgroundImage?: boolean
  /** 是否有圆角（圆角要保留 alpha 边缘） */
  hasBorderRadius?: boolean
  /** 是否有边框（边框是第二处绘制） */
  hasBorderWidth?: boolean
  /** 层透明度（< 1 需要 alpha 合成） */
  opacity?: number
  /** 是否落入 L3 合成层（z-index/fixed/filter/shadow/3D） */
  needsCompositing?: boolean
  /** 是否有 transform（2D/3D 变换 ⇒ 需要独立合成） */
  hasTransform?: boolean
}

/**
 * 推导 paint-hint。
 *
 * 【字段语义与各自的**完整**条件】
 * · `isMonochrome`：可对文本层用**紧凑单通道存储**（iOS `contentsFormat = .gray8Uint`，实测 −39%）。
 *   要求：有文本 + 文本色**确定不透明** + **颜色是中性色**（灰度格式无彩色通道！）
 *        + 无底色/背景图（否则是两种颜色）+ 无圆角/透明度（紧凑格式无 alpha 边缘）
 *        + 非合成层。
 *   ★"中性色"这一条是**格式的硬约束**而非保守选择：8 位灰度**表达不了色相**，
 *     红字写进 gray8Uint 会变灰。−39% 的实验用的是白字，故这一条在实验里**恰好成立**、
 *     但从未被写进判据——若不补，彩色文本会被静默去色。
 * · `isPureBackground`：**该层只有一块底色要画**（走 backgroundColor 通道，不分配存储）。
 *   要求：底色确定不透明 + 无背景图 + 无边框/圆角 + 非合成 + 无 transform + 不透明
 *        + **没有文本**（有字形就必须有存储——这条此前缺失）。
 * · `staticSubtree`：由树级分析填充（本函数不管）。
 * · `needsCompositingLayer`：直传。
 */
export function derivePaintHint(input: PaintHintInput): PaintHint {
  const {
    hasText, textColor, backgroundColor,
    hasBackgroundImage = false, hasBorderRadius = false, hasBorderWidth = false,
    opacity, needsCompositing = false, hasTransform = false,
  } = input

  const opacityIsOne = opacity === undefined || opacity === 1

  return {
    isMonochrome: !!(
      hasText &&
      isOpaqueColor(textColor) &&
      isNeutralColor(textColor) &&          // ★灰度格式的硬约束（见上方说明）
      !backgroundColor &&
      !hasBackgroundImage &&
      !hasBorderRadius &&
      opacityIsOne &&
      !needsCompositing
    ),
    isPureBackground: !!(
      isOpaqueColor(backgroundColor) &&
      !hasBackgroundImage &&
      !hasBorderWidth &&
      !hasBorderRadius &&
      !needsCompositing &&
      !hasTransform &&
      !hasText &&                            // ★本字段 = "只有一块底色要画"
      opacityIsOne
    ),
    // 由树级分析填充（本函数只管单节点）
    staticSubtree: false,
    needsCompositingLayer: needsCompositing,
  }
}
