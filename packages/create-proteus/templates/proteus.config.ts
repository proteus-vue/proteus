// proteus.config.ts —— Proteus 框架统一配置（模板默认值）
// 可用规则 ID 见 @proteus/compiler 的 listTransformRules()（或 npx proteus rules）
import type { TransformRuleOverrides } from '@proteus/compiler'

export interface ProteusConfig {
  /** 目标平台 */
  platform: 'mp-weixin' | 'web'
  /** 是否启用 Skyline 渲染（仅 mp-weixin 生效） */
  skyline: boolean
  /** 小程序 AppID（替换为你的真实 AppID） */
  appid: string
  /** 页面根目录（主包路由扫描起点） */
  pagesDir: string
  /** 路由输出文件（编译期生成，勿手动编辑） */
  routesOutput: string
  /** 分包配置（可选）：root 相对项目根目录 */
  subPackages?: Array<{ root: string; name?: string }>
  /** wx.router 自定义路由配置 */
  customRoute: {
    /** 是否注册内置预设路由 */
    registerPresets: boolean
    /** 内置预设 builders 注册表（随 @proteus/compiler 发布后从 npm 引用） */
    builders: Record<string, string>
  }
  /** ★底线循环 ①③：规则覆盖（disabled / mapping / customTags），改这里即改变编译行为 */
  rules?: TransformRuleOverrides
  /** 响应式 → setData 桥接策略 */
  setDataBridge: {
    batchWindow: number
    perComponent: boolean
  }
  /** 样式换算策略 */
  style: {
    /** MP 端是否 px → rpx（Web 端永不转换） */
    px2rpx: boolean
    rpxRatio: number
  }
}

const config: ProteusConfig = {
  platform: 'mp-weixin',
  skyline: true,
  appid: 'wx0000000000', // 替换为真实 AppID
  pagesDir: 'src/pages',
  routesOutput: 'src/router/auto-routes.ts',
  customRoute: {
    registerPresets: true,
    builders: {},
  },
  rules: {
    disabled: [],
    mapping: {},
    customTags: {}, // 例：{ 'my-widget': 'view' } —— 新增标签映射
  },
  setDataBridge: {
    batchWindow: 16,
    perComponent: true,
  },
  style: {
    px2rpx: true,
    rpxRatio: 2,
  },
}

export default config
