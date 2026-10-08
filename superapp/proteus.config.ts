// superapp/proteus.config.ts —— Proteus 超级应用（框架最终验收场）构建配置
// ★#418 唯一配置文件：vite 配置由框架组装（无 vite.config.ts）
//
// 【这个工程是什么】真实生产形态的超级应用——**所有超级应用级验收场景都在这里跑**
//   （首个验收模块 = GP5 全局挂载八条场景）。与另两个工程的分工：
//     · examples/  = 内部测试全家桶（编译/渲染边界用例，被测试当 fixture 引用）
//     · showcase/  = 对外官方演示（信息架构 / 品牌视觉 / 能力全景）
//     · superapp/  = **本工程**：验收场（验收标准 = 超级应用生产可用，不是 demo 级）
import type { ProteusConfig } from '@proteus-vue/plugin-vite'

const config: ProteusConfig = {
  version: 4,
  // ★v4（决策 #641）：小程序专属字段收进 targets.mp
  targets: {
    // ★★★原生身份（2026-10-08 · 决策「完整宿主 + 项目自有包名」）：CLI 生成宿主 / 打包时从这三段取
    //   applicationId / bundleId / bundleName（`resolveNativeConfigFromProject`）⇒ 产出的安装包
    //   **用本项目自己的包名**（不再统一回退 `dev.proteus.layoutcore`）。缺省/未声明 ⇒ 平台默认值。
    //   ★与 app.config.ts 的 `app.id` 保持同一语义（应用身份单一来源）。
    android: { applicationId: 'cn.proteus.superapp' },
    ios: { bundleId: 'cn.proteus.superapp' },
    harmony: { bundleName: 'cn.proteus.superapp' },
    mp: {
      // ★测试 appid（与 examples/showcase 同一测试号；生产发布需换正式号）
      appid: 'wxa720d0c502451748',
      renderer: 'skyline',
      rules: { disabled: [], mapping: {}, customTags: {} },
      setDataBridge: { batchWindow: 16, perComponent: true },
      style: { px2rpx: true, rpxRatio: 2 },
      // ★全局样式（MP app.wxss 通道）：设计 token（CSS 变量）+ 全局重置。
      //   Web 端同一文件在 main.ts import（★单一事实源：两端消费同一份 tokens.css）
      //   规范文档：docs/Proteus_超级应用视觉设计规范.md
      globalStyle: 'styles/global.css',
    },
  },
  pagesDir: 'pages',
  // ★#492 项目级路由管理：结构 + tabBar + meta 统一在 router 段
  router: {
    routesOutput: 'router/auto-routes.ts',
    // ★原生 tabBar（3 tab：首页 / 消息 / 我的）
    tabBar: {
      color: '#9a9aa5',
      selectedColor: '#5b5bd6',
      list: [
        { name: 'index', text: '首页' },
        { name: 'messages', text: '消息' },
        { name: 'mine', text: '我的' },
      ],
    },
    // wx.router 自定义路由预设（内联进 app.js 注册）
    customRoute: {
      registerPresets: true,
      builders: {
        halfScreen: 'node_modules/@proteus-vue/router/src/presets/halfScreen.ts',
        slideUp: 'node_modules/@proteus-vue/router/src/presets/slideUp.ts',
        scaleDown: 'node_modules/@proteus-vue/router/src/presets/scaleDown.ts',
      },
    },
    // 集中式 meta：tab 页 + 二级页标题
    meta: {
      index: { title: 'Proteus 超级应用', isTab: true },
      messages: { title: '消息', isTab: true },
      mine: { title: '我的', isTab: true },
      article: { title: '内容详情', transition: 'slideUp' },
      verify: { title: '验收控制台' },
    },
  },
  budget: { mainPackageKB: 1200, strict: false },
  // ★★2026-10-04（外部视觉验收挖出的**总根因**）：Web 端必须挂 `defaultScopedPlugin`——
  //   它把模板里的 `<view>/<text>/<button>…` 改写为 `<proteus-view>` 等**已注册组件**（S50 坑的既有经验）。
  //   漏了它 ⇒ 这些标签在浏览器里是**未知元素（display:inline）**⇒ 块级布局全部失效：
  //   padding 不缩进子元素、宽度失控、匿名块间隙（外部验收看到的"白块/贴左/内容压浮层"大多源于此）。
  //   ★本工程首版配置里 `vite: async () => ({ plugins: [] })` 是漏写（showcase 有这一行）。
  vite: async () => {
    const { defaultScopedPlugin } = await import('@proteus-vue/plugin-vite')
    return { plugins: [defaultScopedPlugin()] }
  },
}

export default config
