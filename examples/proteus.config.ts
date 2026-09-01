// examples/proteus.config.ts —— Proteus 示例工程配置（完整工程形态，自包含）
// ★配置不再挂在仓库根：示例 = 独立工程（对应 create-proteus 生成的工程结构）
import type { ProteusConfig } from '@proteus-vue/plugin-vite'

const config: ProteusConfig = {
  platform: 'mp-weixin',
  skyline: true,
  appid: 'wx33bc04a52024def7',
  pagesDir: 'pages',
  routesOutput: 'router/auto-routes.ts',
  subPackages: [{ root: 'subpackages/order', name: 'order' }], // 分包示例：订单模块
  customRoute: {
    registerPresets: true,
    // 内置预设 builders（随 @proteus-vue/router 包发布源码，插件读取后内联进 app.js 注册）
    builders: {
      halfScreen: 'node_modules/@proteus-vue/router/src/presets/halfScreen.ts',
      slideUp: 'node_modules/@proteus-vue/router/src/presets/slideUp.ts',
      scaleDown: 'node_modules/@proteus-vue/router/src/presets/scaleDown.ts',
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
  // ★约定式路由收口（决策 #112/#113）：path/name 从文件路径推导，meta 全部集中在此（<route> 块仅剩 params 等特殊声明）
  router: {
    meta: {
      // 主包页面（pageRel：pages/ 去前缀；index.vue → 目录路径归并）
      'index': { title: '首页', isTab: true },
      'mine': { title: '我的', isTab: true },
      'components-demo': { title: '组件演示' },
      'builtin-components-demo': { title: '内置组件' },
      'config-demo': { title: '配置演示' },
      'forms': { title: '表单与指令' },
      'i18n-demo': { title: '国际化' },
      'showcase': { title: '转场演示' },
      'pinia-demo': { title: '状态管理' },
      'platform-api-demo': { title: 'PlatformAPI 收口' },
      'devtools-open-api-demo': { title: '开放 API 演示' },
      'provide-inject-demo': { title: '注入演示' },
      'virtual-list-demo': { title: '虚拟列表' },
      // 目录级示例：user 下全部页面需登录 + 上滑转场
      'user': { requiresAuth: true, transition: 'slideUp' },
      // 精确路径：细化目录级（精确字段覆盖，目录其余保留）
      'user/index': { title: '用户中心' },
      'user/profile': { title: '个人资料' },
      // 分包页面（relInSub 去 pages/ 前缀）
      'list': { title: '订单列表' },
    },
  },
}

export default config
