// packages/types/src/index.ts
// @proteus/types —— 框架级共享类型单一来源（types-plan B3）
// 零运行时依赖（纯类型 + schema 数据）；各包/各层从本包引用框架级契约，避免重复定义
// ★MP 产物安全（决策 #32/#36）：共享模块 _proteus/types 进 MP（Platform 常量等为纯数据）

/** 运行时平台（capabilities.CapabilityPlatform 对齐——三端契约） */
export type Platform = 'web' | 'skyline' | 'app'

/** 编译目标平台（ProteusConfig.platform） */
export type PlatformTarget = 'mp-weixin' | 'web'

/** 语言方向（i18n RTL 一等公民） */
export type LocaleDir = 'ltr' | 'rtl'

/** 转场枚举（router RouteMeta.transition 对齐） */
export type RouteTransition = 'slideUp' | 'slideDown' | 'halfScreen' | 'scaleDown' | 'none'

export { proteusConfigSchema } from './config-schema'
export type { ProteusConfigSchema } from './config-schema'
