// examples/proteus.config.ts —— Proteus 示例工程配置（完整工程形态，自包含）
// ★配置不再挂在仓库根：示例 = 独立工程（对应 create-proteus 生成的工程结构）
import type { ProteusConfig } from '@proteus/plugin-vite'

const config: ProteusConfig = {
  platform: 'mp-weixin',
  skyline: true,
  appid: 'wx0000000000', // 替换为真实 AppID
  pagesDir: 'pages',
  routesOutput: 'router/auto-routes.ts',
  subPackages: [{ root: 'subpackages/order', name: 'order' }], // 分包示例：订单模块
  customRoute: {
    registerPresets: true,
    // 内置预设 builders（随 @proteus/router 包发布源码，插件读取后内联进 app.js 注册）
    builders: {
      halfScreen: 'node_modules/@proteus/router/src/presets/halfScreen.ts',
      slideUp: 'node_modules/@proteus/router/src/presets/slideUp.ts',
      scaleDown: 'node_modules/@proteus/router/src/presets/scaleDown.ts',
    },
  },
  // ★底线循环 ①③：规则覆盖（改这里立即改变编译行为）
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
  // 包体积预算：主包 ≤1.2MB（微信上限 2MB）；strict 时超限构建失败
  budget: {
    mainPackageKB: 1200,
    strict: false,
  },
  // ★决策 #113 集中式 meta：页面零 <route> 声明也能获得 meta（精确路径 > 目录前缀 > 默认）
  router: {
    meta: {
      // 目录级示例：user 下全部页面需登录 + 上滑转场
      'user': { requiresAuth: true, transition: 'slideUp' },
      // 精确路径：细化目录级（精确字段覆盖，目录其余保留）
      'user/profile': { title: '个人资料' },
    },
  },
}

export default config
