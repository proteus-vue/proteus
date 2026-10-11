// proteus.config.ts —— Proteus 统一配置（★#418：唯一配置文件——vite 配置由框架组装，不再有 vite.config.ts）
// ★★★2026-10-08 配置模型 v4（决策 #641）：**按端分区**——目标端 = 键（web/mp/ios/android/harmony），
//   各端自持配置；跨端共享面（pagesDir/router/budget/vite/audit/gates/compiler/layout/app）留顶层。
import type { ProteusConfig } from '@proteus-vue/plugin-vite'

const config: ProteusConfig = {
  version: 4,
  targets: {
    mp: {
      appid: 'wx0000000000', // 替换为真实 AppID
      renderer: 'skyline',
      // ★全局样式（设计令牌 + 页面基线）：小程序端 → app.wxss；Web 端在 src/main.ts import；
      //   App 端构建期折进节点样式（一份文件、四端一致——详见 src/styles/global.css）
      globalStyle: 'src/styles/global.css',
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
    },
    // ★App 三端：原生工程身份（包名/Bundle ID/版本），由 `proteus build --package` 注入原生文件
    ios: { bundleId: 'cn.proteus.dactyl', deviceFamily: [1], orientations: ['portrait'] },
    android: {
      applicationId: 'cn.proteus.dactyl',
      orientation: 'portrait',
      minSdk: 26,
      targetSdk: 35,
      permissions: ['android.permission.INTERNET'],
    },
    harmony: { bundleName: 'cn.proteus.dactyl', deviceTypes: ['phone'] },
  },
  app: { name: 'Dactyl 触感穹顶', version: '0.1.0', buildNumber: '1' },
  pagesDir: 'src/pages',
  // ★#492 项目级路由管理：路由相关配置统一在 router 段（结构 + tabBar + pages）
  router: {
    // 路由表产物路径（编译期 gen-routes 生成）
    routesOutput: 'src/router/auto-routes.ts',
    // ★★B（决策 #800）：tab 声明——App 端**字形/角标**在此声明，文案可省（回退各页 meta.title）。
    //   此前宿主只能吃框架缺省（index/messages/mine 三键）⇒ l2..l6 全变 "•"（真机取证）。
    //   字形为**文本字形**（非 sym:）——与 superapp 的 sym: 系统符号形态互补覆盖。
    tabBar: {
      list: [
        { name: 'index', glyph: '◉' },
        { name: 'l2', glyph: '≡' },
        { name: 'l3', glyph: '✦' },
        { name: 'l4', glyph: '✚' },
        { name: 'l5', glyph: '⌁' },
        { name: 'l6', glyph: '◫' },
      ],
    },
    // wx.router 自定义路由：内置预设 builders（随 @proteus-vue/router 包发布源码，插件读取后内联进 app.js 注册）
    customRoute: {
      registerPresets: true,
      builders: {
        halfScreen: 'node_modules/@proteus-vue/router/src/presets/halfScreen.ts',
        slideUp: 'node_modules/@proteus-vue/router/src/presets/slideUp.ts',
        scaleDown: 'node_modules/@proteus-vue/router/src/presets/scaleDown.ts',
      },
    },
    // 集中式页面配置（可选）：精确路径 > 目录前缀 > 默认
    // pages: { 'index': { title: '首页', isTab: true } },
  },
  // vite 透传（可选）：完全兼容 vite 的字段——plugins / server / resolve / build 等按需追加。
  // 例：server: { port: 5173 }, plugins: [myVitePlugin()]
  // （函数形态：vite: ({ command, mode }) => ({ ... })；省略则全用框架默认组装）
  // vite: {
  //   server: { port: 5173 },
  // },
}

export default config
