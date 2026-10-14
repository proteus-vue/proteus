// packages/shared/src/index.ts —— @proteus-vue/shared 公共入口
// 平台适配器（adapter 抽象 + mp/web 实现）+ 存储层（StorageAdapter 工厂/序列化/追踪）+ 全局类型声明（shims）
export { adapter } from './platform'
export type { PlatformAdapter, Rect } from './platform/adapter'
// ★Skyline 线收口：运行时/渲染器判定 SSOT（全框架唯一判定点）
export { detectRuntime, isMiniProgram, detectMpRenderer, isSkylineRuntime } from './platform/runtime'
export type { ProteusRuntime, MpRenderer } from './platform/runtime'
export * from './storage'
// ★★★跨语言二进制 wire 公共原语（决策 #903 / S2「去 JSON」）：小端字节游标 + 严格 UTF-8
//   ——全仓唯一实现（invoke-wire / 后续各二进制通道必须从这里 import，不再各写副本）
export { ByteWriter, ByteReader, utf8Encode, utf8Decode } from './binary/wire'
