// packages/animation/src/index.ts
// @proteus-vue/animation —— ★★**Morpheus 声明式动画引擎的表面层**（MA1）
//
// 【定位（Morpheus §0）】框架层内置的高性能动画引擎的**声明式表面**：
//   开发者一句话写转场/让位/入场，不必写动画算法；
//   编译期校验把"会不会掉帧"变成**编译期问题**（§5-bis.2）。
//
// 【本包做什么 / 不做什么（诚实边界）】
//   ✅ 做：声明式类型（封闭集）· 编译期校验（非合成属性/同属性重复/参数非法）· 编译到引擎指令 · 预设库
//   ❌ 不做：**曲线求值与物理积分**（在 Rust 内核 `layout-core-rust/src/anim.rs`，唯一实现）
//           —— 本包不引入任何曲线数学，宿主侧同样零曲线数学（纪律 #22：第 N 份手写副本 = 下一个静默缺陷）
//   ❌ 不做：动画状态的持有（那是内核的 `AnimEngine`，本包只是"声明 → 指令"的纯函数层）
//
// 【三层分工（一图看清）】
//   ```
//   本包（声明 + 校验 + 编译）        ← 一句话写动画 / 编译期拦住错误
//        ↓ 引擎指令（跨语言契约）
//   Rust 内核（曲线求值 + 物理 + FLIP）← 唯一实现，每帧零 JS 求值
//        ↓ 每帧二进制通道 / 提交规格
//   宿主（翻译成平台 API）             ← 零曲线数学；iOS CAKeyframe / Android RenderNodeAnimator
//   ```

export { AnimKind, ANIM_KIND_ID, Curve, CURVE_ID } from './types'
export type {
  AnimKindId,
  AnimKindName,
  CurveId,
  CurveName,
  DriveName,
  SpringConfig,
  ScrollWindow,
  KeyframeSeg,
  AnimDecl,
  AnimTargets,
  EngineAnim,
  CompiledBatch,
  ValidationIssue,
} from './types'

export { COMPOSITED_KINDS, isComposited, validateAnimations, formatIssues } from './validate'
export {
  compileAnimations,
  compileOne,
  compileRoute,
  toWireBatch,
  isPlatformEligible,
  isScrollDriven,
} from './compile'
export { presets, route, list, element, easing, scroll } from './presets'
// ★★声明式编排层（"几百个元素谁先动、各自去哪"的一句话入口）
//   —— 抽出的 `easing.ts` 是它与预设库共享的手感常量（避免循环依赖，见该文件头）
export { compileChoreography, staggerRanks, choreograph, STAGGER_ORDERS, terminalAttitudes } from './choreography'
export type { ChoreoAttitude, ChoreoCanvas, ChoreoCtx, ChoreoPoint, ChoreoScene, ChoreoSpec, StaggerOrder } from './choreography'
// ★点阵字形（`choreograph.text` 的数据源；独立导出便于上层预览"这句会排成什么形状"）
export { textBitmap, FONT_5X7, GLYPH_ADVANCE, GLYPH_HEIGHT } from './bitmap-font'
export type { TextBitmap, GlyphRows } from './bitmap-font'
// ★★统一路由转场枚举的**第三腿**（App / Morpheus；Web 与 MP 两腿在 @proteus-vue/router）
export { APP_TRANSITION_MAP, appTransition, appTransitions } from './route-transition'
// ★★方向语义 + 执行器入口（2026-09-30：M5 虚拟栈命令流的消费者接线）
export { reverseDecls, routeTransitionBatches } from './route-transition'
export type { RouteTransitionDirection, RouteTransitionPlan } from './route-transition'
// ★★跨属性共享时间轴（多属性共享停靠点——内核 lockstep 推进的声明面入口）
export { compileTimeline, timelineDuration } from './timeline'
export type { TimelineSpec, TimelineStop } from './timeline'
// ★★MA0/§4.2：逃生口（显式通道 + 可统计 + degraded 单列）
export { EscapeRegistry, escapes, ESCAPE_KINDS, ESCAPE_RATIO_TARGET } from './escape'
export type { EscapeKind, EscapeRecord, EscapeSummary } from './escape'
// ★★MA1 收尾：AI 说明书（与 111 条编译规则同构）+ conformance 对账（说明书 ↔ 实现）
export { ANIM_RULES, listAnimRules, getAnimRule, formatAnimRule, formatAnimCatalog } from './rules'
export type { AnimRule, AnimRuleKind } from './rules'
export { runConformance, conformanceSummary, resolvePreset, verifiableRefs } from './conformance'
export type { ConformanceFinding } from './conformance'
export type { RouteTransitionSpec, ListShiftSpec, ElementSpec, SharedElementSpec, ScrollSpec } from './presets'
