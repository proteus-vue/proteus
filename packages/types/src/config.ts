// packages/types/src/config.ts
// ★类型收口（10-type-consolidation）：ProteusConfig（原 @proteus-vue/plugin-vite/src/config.ts 的 interface）
// runtime 值（defineConfig 等助手）留 @proteus-vue/plugin-vite
import type { TransformRuleOverrides } from './compiler-types'
import type { RouteMeta } from './router-types'

export interface ProteusConfig {
  /** 目标平台 */
  platform: 'mp-weixin' | 'web'
  /** 是否启用 Skyline 渲染（仅 mp-weixin 生效） */
  skyline: boolean
  /** 小程序 AppID */
  appid: string
  /** 页面根目录（主包路由扫描起点） */
  pagesDir: string
  /** 路由输出文件（编译期生成） */
  routesOutput: string
  /** 分包配置（可选） */
  subPackages?: Array<{ root: string; name?: string }>
  /** wx.router 自定义路由配置 */
  customRoute: {
    registerPresets: boolean
    /** 内置预设 builders 注册表：name → 预设源码文件 */
    builders: Record<string, string>
  }
  /** ★底线循环 ①③：规则覆盖（AI/config 改写或禁用规则） */
  rules?: TransformRuleOverrides
  /** 响应式 → setData 桥接策略 */
  setDataBridge: {
    batchWindow: number
    perComponent: boolean
  }
  /** 样式换算策略 */
  style: {
    px2rpx: boolean
    rpxRatio: number
  }
  /** 包体积预算 */
  budget?: {
    mainPackageKB: number
    strict: boolean
  }
  /** 路由通用配置（tabBar 唯一声明源 / 集中式 meta） */
  router?: {
    tabBar?: {
      color?: string
      selectedColor?: string
      list: Array<{ name: string; text: string; icon?: string }>
    }
    /** 集中式 meta（决策 #113）：精确路径 > 目录前缀 > 默认 */
    meta?: Record<string, RouteMeta>
  }
}
