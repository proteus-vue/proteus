// packages/shared/src/index.ts —— @proteus-vue/shared 公共入口
// 平台适配器（adapter 抽象 + mp/web 实现）+ 存储层（StorageAdapter 工厂/序列化/追踪）+ 全局类型声明（shims）
export { adapter } from './platform'
export type { PlatformAdapter, Rect } from './platform/adapter'
// ★Skyline 线收口：运行时/渲染器判定 SSOT（全框架唯一判定点）
export { detectRuntime, isMiniProgram, detectMpRenderer, isSkylineRuntime } from './platform/runtime'
export type { ProteusRuntime, MpRenderer } from './platform/runtime'
export * from './storage'
