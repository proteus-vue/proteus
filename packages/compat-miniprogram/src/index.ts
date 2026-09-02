// packages/compat-miniprogram/src/index.ts —— @proteus-vue/compat-miniprogram 公共入口
// ★G-31 B6（proteus-component-semantics-plan migration.md）：Layer 1 兼容层
//   三步迁移（migration.md §4）：
//     Step 1 装 compat 层旧代码跑通 → createWxCompat + bindCompatPlatform（wx.* + useStorage 委托 Proteus）
//     Step 2 跑 codemod 批量转原生语义 → migrateMpSource（标签自动 + 存储直改 + manual 标注）
//     Step 3 人工处理剩余（语义识别 scroll-view/swiper + 路由名表）
//   包名收口 @proteus-vue 组织 scope（决策 #215a；plan 文档写 @proteus/compat-miniprogram）
import type { CapabilityHooks, PlatformAPI } from '@proteus-vue/api'
import { createWxCompat } from './wx-compat'
import type { WxCompat } from './wx-compat'

export { AUTO_CODEMOD_TAGS, MANUAL_TAGS, isAutoCodeable, isManualTag } from './tags'
export { migrateMpSource, countMigration, MANUAL_MARK } from './codemod'
export type { MigrationStats } from './codemod'
export { createWxCompat } from './wx-compat'
export type { WxCompat } from './wx-compat'

// —— useStorage 迁移目标绑定（codemod 输出 useStorage().set 等——需先绑定平台实例） ——

let boundPlatform: PlatformAPI | null = null

/** 绑定平台实例（迁移期入口：bindCompatPlatform(createPlatformAPI())——旧代码 useStorage/wx 可用） */
export function bindCompatPlatform(platform: PlatformAPI): void {
  boundPlatform = platform
}

export interface CompatStorage {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  remove(key: string): void
  clear(): void
}

/** ★G-32 C15 目标 Hook（codemod 输出形态）：useStorage() → 平台 storage（绑定后可用） */
export function useStorage(): CompatStorage {
  if (!boundPlatform) {
    throw new Error('[compat-miniprogram] useStorage 未绑定平台——请先 bindCompatPlatform(createPlatformAPI())')
  }
  return boundPlatform.storage
}

/** 一键绑定（迁移入口常用形态） */
export function installCompat(platform: PlatformAPI, cap: CapabilityHooks): WxCompatLegacy {
  bindCompatPlatform(platform)
  const wx = createWxCompat(platform, cap)
  const g = globalThis as { wx?: unknown }
  if (!g.wx) g.wx = wx
  return wxCompatLegacy(wx)
}

/** 兼容桥（类型包装——installCompat 返回值） */
export type WxCompatLegacy = WxCompat

function wxCompatLegacy(wx: WxCompat): WxCompatLegacy {
  return wx
}