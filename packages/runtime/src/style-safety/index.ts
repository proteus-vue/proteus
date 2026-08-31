// packages/runtime/src/style-safety/index.ts
// G-31 style-safety B1：运行时 Style Validator 出口（patchStyle 接入点在 App Renderer G-22）
// 语义：任何动态 :style 值必须经 validateStyle 才可抵达原生渲染管线（原则 #10.1）
export { validateStyle, validateProp, isValidStyleProp } from './validator'
export type { StyleRejection, ValidateStyleOptions, PropValidationResult } from './validator'
export { ALLOWED_STYLE_PROPS, FALLBACK_DEFAULTS, PROP_TYPES } from './whitelist'
export type { AllowedStyleProp, StylePropKind } from './whitelist'
export { narrowValue } from './platform-narrowing'
export type { StylePlatform, NarrowResult } from './platform-narrowing'
