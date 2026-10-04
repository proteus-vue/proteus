// packages/cli/src/targets.ts —— ★构建目标 SSOT（2026-10-04）
//
// 【为什么单独一个模块】构建目标名要在**三处**一致（args 解析 / build 调度 / app-content 平台），
//   分散定义会漂。★命名与**全仓一致**（`CONCRETE_PLATFORMS`：web/mp/ios/android/harmony）——
//   不自造笼统的 "app"（那是三端合一，不符合跨端框架的按端构建标准做法）。
//
// 【App 端 = 三个**具体平台**】`ios`/`android`/`harmony` → 产物分目录 `dist/app/<platform>/`。
//   当前三端内容由同一编译器产出（结构一致），但按平台分目录是标准做法：平台专属编译就绪后
//   各端产物自然分叉，宿主各取各的产物。
export const APP_PLATFORMS = ['ios', 'android', 'harmony'] as const
export type AppPlatform = (typeof APP_PLATFORMS)[number]

/** Web/MP（走 vite 管线，spawn 工程脚本） */
export const VITE_TARGETS = ['web', 'skyline'] as const
export type ViteTarget = (typeof VITE_TARGETS)[number]

/** 全部合法构建目标（`all` = 逐端全构建） */
export const BUILD_TARGETS = ['web', 'skyline', 'ios', 'android', 'harmony', 'all'] as const
export type BuildTarget = (typeof BUILD_TARGETS)[number]

export function isAppPlatform(t: string): t is AppPlatform {
  return (APP_PLATFORMS as readonly string[]).includes(t)
}

export function isViteTarget(t: string): t is ViteTarget {
  return (VITE_TARGETS as readonly string[]).includes(t)
}
