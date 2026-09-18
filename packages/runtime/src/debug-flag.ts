// src/runtime/debug-flag.ts
// 调试开关：由 vite define 注入的构建期常量 __PROTEUS_DEBUG__
// （PROTEUS_DEBUG=1 构建时为 true；正式构建为 false 且被 tree-shake）
// 与编译器注入的页面日志共用同一个开关来源。
export const DEBUG = typeof __PROTEUS_DEBUG__ !== 'undefined' && __PROTEUS_DEBUG__
