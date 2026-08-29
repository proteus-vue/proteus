// packages/plugin-vite/src/config.ts
// Proteus 编译配置契约（★拆包步骤 5：类型从根 proteus.config.ts 迁入包，配置由应用定义）
// 应用侧写法：import type { ProteusConfig } from '@proteus/plugin-vite' + defineConfig 同款：
//   const config: ProteusConfig = { platform: 'mp-weixin', ... }
import type { TransformRuleOverrides } from '@proteus/compiler'
import type { RouteMeta } from '@proteus/router'

export interface ProteusConfig {
  /** 目标平台 */
  platform: 'mp-weixin' | 'web'
  /** 是否启用 Skyline 渲染（仅 mp-weixin 生效） */
  skyline: boolean
  /** 小程序 AppID */
  appid: string
  /** 页面根目录（主包路由扫描起点） */
  pagesDir: string
  /** 路由输出文件（编译期生成，勿手动编辑） */
  routesOutput: string
  /** 分包配置（可选）：root 相对项目根目录，如 'src/subpackages/order' */
  subPackages?: Array<{ root: string; name?: string }>
  /** wx.router 自定义路由配置 */
  customRoute: {
    /** 是否注册内置预设路由（wx://bottom-sheet 等） */
    registerPresets: boolean
    /** 内置预设 builders 注册表：name → 预设源码文件（由 mp-transform 插件内联进 app.js 注册） */
    builders: Record<string, string>
  }
  /**
   * ★底线循环 ①③：规则覆盖——AI / 开发者按规则 ID 改写或禁用编译规则，改配置即生效、无需改框架代码
   */
  rules?: TransformRuleOverrides
  /** 响应式 → setData 桥接策略 */
  setDataBridge: {
    /** 批量合并窗口（ms），防止高频更新风暴 */
    batchWindow: number
    /** 是否按组件粒度收集脏数据 */
    perComponent: boolean
  }
  /** 样式换算策略（跨端 CSS 一致性） */
  style: {
    /** MP 端是否 px → rpx（仅编译期生效，Web 端永不转换） */
    px2rpx: boolean
    /** px→rpx 比例，默认 2 */
    rpxRatio: number
  }
  /** 包体积预算（v0.4：构建期仪表 + 门禁） */
  budget?: {
    /** 主包体积上限 KB（微信 2MB=2048KB；roadmap 目标 ≤1.2MB≈1200KB） */
    mainPackageKB: number
    /** 超预算是否让构建失败（默认警告不阻断） */
    strict: boolean
  }
  /** 路由通用配置（docs/proteus-router-plan M6 + 决策 #113）：tabBar 唯一声明源 / 集中式 meta（页面 <route> 可选） */
  router?: {
    tabBar?: {
      color?: string
      selectedColor?: string
      /** list[i].name 对应路由 name（RouteNode.name），text/icon 供各端产物 */
      list: Array<{ name: string; text: string; icon?: string }>
    }
    /**
     * ★集中式页面 meta（决策 #113）：按页面路径配置——页面无需写 <route> 块也能获得 meta。
     * 优先级：页面 <route>.meta > 精确路径 > 目录前缀（最长匹配）> 默认
     * 键 = pagesDir 相对路径去扩展名：'user/profile'、目录级 'user'（前缀匹配其下全部页面）
     */
    meta?: Record<string, RouteMeta>
  }
}
