// proteus.config.ts —— Proteus 统一配置（★#418：唯一配置文件——vite 配置由框架组装，不再有 vite.config.ts）
import type { ProteusConfig } from '@proteus-vue/plugin-vite'

const config: ProteusConfig = {
  platform: 'mp-weixin',
  skyline: true,
  appid: 'wx0000000000', // 替换为真实 AppID
  pagesDir: 'src/pages',
  routesOutput: 'src/router/auto-routes.ts',
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
  // vite 透传（可选）：完全兼容 vite 的字段——plugins / server / resolve / build 等按需追加。
  // 例：server: { port: 5173 }, plugins: [myVitePlugin()]
  // （函数形态：vite: ({ command, mode }) => ({ ... })；省略则全用框架默认组装）
  // vite: {
  //   server: { port: 5173 },
  // },
}

export default config
