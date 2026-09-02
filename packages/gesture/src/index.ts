// packages/gesture/src/index.ts —— @proteus-vue/gesture 公共入口
// ★G-32 B4 ④ Gesture（proteus-semantic-primitives-plus-plan §6）：手势 = 声明式约束
//   纯识别器（recognizers）+ Web 官方接线（useGesture Hook / v-gesture 指令）
//   零依赖纯逻辑——Web Pointer / MP touch / 原生识别器统一喂 GestureInput
export { createGestureRecognizer } from './recognizers'
export type {
  GesturePoint,
  GestureInput,
  GestureInputKind,
  GestureEvent,
  GestureKind,
  GestureEventHandler,
  GestureRecognizerConfig,
} from './recognizers'
export { useGesture, createGestureDirective } from './use-gesture'
export type { GestureHandlers, UseGestureOptions, VGestureBindingValue } from './use-gesture'