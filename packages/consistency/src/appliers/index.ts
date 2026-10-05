// packages/consistency/src/appliers/index.ts
// ★★★G-61 B3：**三端 Applier 出口**（L-C · 每宿主一个，走同一 conformance；plan §7.1/§7.2）
//
// 【三端策略（plan §7.1 定调，不追求对称）】
//   · **Web**：A 档——不接管渲染；`compareIrToComputed` 是"应用"本身（IR 探针 + 基准采集器）
//   · **Skyline**：IR → wxss 子集（`mapStyleIRToSkyline`）+ 编译期降级（v1 无配方 ⇒ unsupported）
//   · **App**：IR → 内核 DTO + ops 键空间（`mapStyleIRToApp`；复用 `apply_style_key` 通道）
//
// 【conformance 判据（plan §7.2）】同一份 IR 喂三个 Applier ⇒ 产出"应用后状态" ⇒ 与 **Web 基准**
//   （B-a 计算样式 / B-b 几何）判定等价。★比对对象是 **Web 基准**（D1：不是端间互比）。
export { mapStyleIRToApp, APP_LAYOUT_FIELDS, APP_PAINT_FIELDS } from './app'
export type { AppMappingResult } from './app'
export { mapStyleIRToSkyline } from './skyline'
export type { SkylineApplierOptions, SkylineMappingResult } from './skyline'
export {
  compareIrToComputed,
  normalizeComputedColor,
  normalizeComputedValue,
  normalizeIrValue,
  IR_FIELD_TO_CSS,
} from './web'
export type { IrCompareEntry, NormalizedComputed } from './web'
