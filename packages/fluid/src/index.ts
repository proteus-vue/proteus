// packages/fluid/src/index.ts —— @proteus-vue/fluid 公共入口
// ★Fluid System（fluid-system-plan）：多形态设备语义布局体系核心（折叠屏/平板/车机/多窗口）
//   纯逻辑（容器查询/断点/设备环境/能力检测/统一断点入口）——零依赖，Web 运行时 + MP/App 求解器共用同一状态模型
export { createContainerQuery, resolveOrientation } from './context'
export type { FluidContext, FluidContextState, ContainerQueryOptions, ResizeObserverLike, SizeObserverFactory, FluidOrientation } from './context'
export { deriveContainerBreakpoints, resolveBreakpoint, DEFAULT_BREAKPOINT_RATIOS } from './breakpoint'
export type { FluidBreakpoint } from './breakpoint'
export { createDeviceEnv, readDisplayMode } from './env'
export type { DeviceEnv, DeviceEnvState, DeviceEnvDeps, FluidDisplayMode, MatchMediaLike } from './env'
// ★essence 02 §4 能力检测 + §2 统一断点入口（柔性系统定位补充）
export { detectFluidCapabilities } from './capabilities'
export type { FluidCapabilities, FluidSupportsFn } from './capabilities'
export { createSizeAwareObserver } from './layout'
export type { SizeAwareObserver, SizeAwareState, SizeAwareOptions, ResizeTargetLike } from './layout'
// ★S2 + G-09 SafeArea：安全区避让样式纯逻辑（Web env() 映射 + 折叠屏 hinge）
export { resolveSafeAreaStyle } from './safe-area'
export type { SafeAreaStyleOptions } from './safe-area'
// ★S3 车机/导航：动效门 + 工具栏溢出折叠纯逻辑
export { shouldReduceMotion } from './motion'
export type { MotionState } from './motion'
export { calcVisibleToolbarItems } from './nav'
export type { ToolbarOverflowOptions } from './nav'
// ★S4 无障碍：动态字号级别 + 密度语义纯逻辑
export { SCALE_LEVELS, resolveScaleRatio, resolveDensity, buildScaleStyle } from './scale'
export type { FluidDensity, ScaleStyleOptions } from './scale'
