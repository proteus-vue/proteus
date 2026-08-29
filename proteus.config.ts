// proteus.config.ts
// Proteus 框架统一配置 —— LLM 生成任何模块前必须先读此文件，理解 platform / skyline / pagesDir 等约束
import type { TransformRuleOverrides } from './packages/compiler/src'

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
   * 可用规则 ID 见 src/compiler/transforms/（或运行 listTransformRules() 枚举）
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
}

const config: ProteusConfig = {
  platform: 'mp-weixin',
  skyline: true,
  appid: 'wx0000000000', // 使用者替换为真实 AppID
  pagesDir: 'examples/pages',
  routesOutput: 'src/router/auto-routes.ts',
  subPackages: [{ root: 'examples/subpackages/order', name: 'order' }], // 分包示例：订单模块
  customRoute: {
    registerPresets: true,
    builders: {
      halfScreen: 'src/router/presets/halfScreen.ts',
      slideUp: 'src/router/presets/slideUp.ts',
      scaleDown: 'src/router/presets/scaleDown.ts',
    },
  },
  // ★底线循环 ①③：规则覆盖开关（改这里立即改变编译行为，演示页 examples/pages/config-demo.vue）
  // 示例：
  //   disabled: ['directive/v-if'],                               // 禁用规则（v-if 忽略 + 编译期警告）
  //   mapping: { 'tag/link-to-view': { a: 'text' } },             // 改写映射（a → text 而非 view）
  //   customTags: { 'my-widget': 'view' },                        // 新增标签映射
  rules: {
    disabled: [],
    mapping: {},
    // 已启用：<demo-box> → <view>（config-demo 页演示）；删除此键即回到未注册标签原样输出
    customTags: { 'demo-box': 'view' },
  },
  setDataBridge: {
    batchWindow: 16, // ~1 帧
    perComponent: true,
  },
  style: {
    px2rpx: true,
    rpxRatio: 2,
  },
}

export default config
