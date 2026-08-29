// packages/types/src/brand.ts
// ★types-plan B6：品牌类型防混淆（Brand Type）——store id / module domain / route name 混用编译报错
// 构造仅内部（defineXxx 自动包装），业务侧只消费类型（品牌不穿透）
export type Brand<T, B extends string> = T & { readonly __brand: B }

/** 品牌类型：跨层标识符防混淆 */
export type StoreId = Brand<string, 'StoreId'>
export type ModuleDomain = Brand<string, 'ModuleDomain'>
export type RouteName = Brand<string, 'RouteName'>
export type CapabilityId = Brand<string, 'CapabilityId'>

/** 构造（仅框架 defineXxx 内部使用；业务侧禁止手写） */
export const asStoreId = (s: string): StoreId => s as StoreId
export const asModuleDomain = (s: string): ModuleDomain => s as ModuleDomain
export const asRouteName = (s: string): RouteName => s as RouteName
export const asCapabilityId = (s: string): CapabilityId => s as CapabilityId
