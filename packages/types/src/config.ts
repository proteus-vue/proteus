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
  /** ★Skyline 布局对齐（2026-08 真机实测：Skyline 节点默认 flex 布局——switch/slider/icon 等表单元素被 stretch 占满一行且居中，
   *   与 WebView/Web 块级布局不一致——默认开启 defaultDisplayBlock（Skyline 官方对齐方案） */
  skylineLayout?: {
    defaultDisplayBlock?: boolean
  }
  /** ★G-22 柔性布局（fluid-layout-plan）：p-fluid 编译期 clamp 生成参数（构建期配置——编译需要，运行期由 app-config 覆盖 Web 端） */
  layout?: {
    designWidth?: number
    fluidViewport?: { min?: number; max?: number }
  }
  /** 小程序 AppID——★平台编译标识（构建期写 project.config.json / IDE 导入 / automator 体检）
   *  ★决策 #211 职责边界：区别于 app.config.ts 的 app.id（应用运行时标识）——appid 是构建期消费，必须在此 */
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
  /** ★15-page-scroll-container：页面模式自动包滚动容器（Skyline 页面本身不滚动，滚动必须 scroll-view；默认 true） */
  page?: {
    autoScrollContainer?: boolean
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
