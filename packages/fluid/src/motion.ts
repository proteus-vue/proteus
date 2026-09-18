// packages/fluid/src/motion.ts
// ★Fluid System S3（车机）：动效门——drive-mode 驾驶中 / prefers-reduced-motion 无障碍时禁用动效
//   纯逻辑（组件层据此加 no-motion class → CSS 禁用 transition/animation）
export interface MotionState {
  /** 车机驾驶中（宿主注入；无标准 CSS 检测——createDeviceEnv 预留） */
  isDriveMode?: boolean
  /** 系统减少动效（prefers-reduced-motion） */
  prefersReducedMotion?: boolean
}

/** 是否应减少动效：drive-mode 或系统减少动效 → true（任一命中即整体降级） */
export function shouldReduceMotion(state: MotionState = {}): boolean {
  return state.isDriveMode === true || state.prefersReducedMotion === true
}
