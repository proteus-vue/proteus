// proteus.config.ts
// Proteus 框架统一配置 —— LLM 生成任何模块前必须先读此文件，理解 platform / skyline / pagesDir 等约束
// ★拆包步骤 5：ProteusConfig 类型契约归 @proteus/plugin-vite（config.ts），本文件只负责实例化
import type { ProteusConfig } from './packages/plugin-vite/src/config'

const config: ProteusConfig = {
  platform: 'mp-weixin',
  skyline: true,
  appid: 'wx0000000000', // 使用者替换为真实 AppID
  pagesDir: 'examples/pages',
  routesOutput: 'examples/router/auto-routes.ts', // 拆包步骤 4：auto-routes 随应用存放（工厂化后路由表由应用注入）
  subPackages: [{ root: 'examples/subpackages/order', name: 'order' }], // 分包示例：订单模块
  customRoute: {
    registerPresets: true,
    builders: {
      halfScreen: 'packages/router/src/presets/halfScreen.ts',
      slideUp: 'packages/router/src/presets/slideUp.ts',
      scaleDown: 'packages/router/src/presets/scaleDown.ts',
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
  // 包体积预算（v0.4）：主包 ≤1.2MB（roadmap 目标，微信上限 2MB）；strict 时超限构建失败
  budget: {
    mainPackageKB: 1200,
    strict: false,
  },
}

export default config
