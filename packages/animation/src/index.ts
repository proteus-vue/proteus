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
export type { RouteTransitionSpec, ListShiftSpec, ElementSpec, ScrollSpec } from './presets'
