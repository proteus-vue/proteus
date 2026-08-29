// packages/types/src/index-shared.ts
// 框架级共享契约（原 index.ts 直出）——各实现包/各层引用，避免重复定义

/** 运行时平台（capabilities.CapabilityPlatform 对齐——三端契约） */
export type Platform = 'web' | 'skyline' | 'app'

/** 编译目标平台（ProteusConfig.platform） */
export type PlatformTarget = 'mp-weixin' | 'web'

/** 语言方向（i18n RTL 一等公民） */
export type LocaleDir = 'ltr' | 'rtl'

/** 转场枚举（router RouteMeta.transition 对齐） */
export type RouteTransition = 'slideUp' | 'slideDown' | 'halfScreen' | 'scaleDown' | 'none'
