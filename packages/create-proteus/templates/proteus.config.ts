// proteus.config.ts —— Proteus 框架统一配置（拆包步骤 7：类型契约来自 @proteus/plugin-vite npm 包）
import type { ProteusConfig } from '@proteus/plugin-vite'

const config: ProteusConfig = {
  platform: 'mp-weixin',
  skyline: true,
  appid: 'wx0000000000', // 替换为真实 AppID
  pagesDir: 'src/pages',
  routesOutput: 'src/router/auto-routes.ts',
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
    customTags: {}, // 例：{ 'my-widget': 'view' } —— 新增标签映射
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
