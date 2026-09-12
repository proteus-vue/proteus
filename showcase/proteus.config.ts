// showcase/proteus.config.ts —— Proteus 官方演示小程序配置
// ★#418 唯一配置文件：vite 配置由框架组装（无 vite.config.ts）；本文件 = 构建期（怎么构建）
import type { ProteusConfig } from '@proteus-vue/plugin-vite'
import path from 'node:path'

const config: ProteusConfig = {
  platform: 'mp-weixin',
  skyline: true,
  // ★官方演示小程序 appid（与 examples 不同：examples 是内部测试工程）
  appid: 'wxa720d0c502451748',
  pagesDir: 'pages',
  // ★#492 项目级路由管理：结构 + tabBar + meta 统一在 router 段
  router: {
    routesOutput: 'router/auto-routes.ts',
    // ★分包（2026-09-13）：按官方演示的信息架构，组件详情 / 能力详情各自独立分包——
    //   ① 主包只留 5 tab + 平台能力页（不占 32 页硬限）；② 详情页按需加载；
    //   ③ 内容规模可持续增长（160 页目标）不挤爆主包。
    //   root 相对项目根；页面路径 = root/pages/<name>（gen-routes 独立扫描各分包树）。
    subPackages: [
      { root: 'subpackages/components', name: 'components' },
      { root: 'subpackages/capabilities', name: 'capabilities' },
    ],
    // ★原生 tabBar（微信 tabBar.list 直接声明——color/selectedColor/list 顺序全可控）
    tabBar: {
      color: '#8a8a99',
      selectedColor: '#7c5cff',
      list: [
        { name: 'index', text: '首页' },
        { name: 'components', text: '组件' },
        { name: 'semantics', text: '语义' },
        { name: 'capabilities', text: '能力' },
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
    // ★集中式 meta：页面零 <route> 声明即获 meta（tab 页 isTab 由 tabBar.list 决定，此处给 title）
    meta: {
      index: { title: '首页', isTab: true },
      components: { title: '组件库', isTab: true },
      semantics: { title: '语义与编译', isTab: true },
      capabilities: { title: '原生能力', isTab: true },
      mine: { title: '我的', isTab: true },
      // 二级页（从首页/分区进入，非 tab）
      'system-glass': { title: '液态玻璃' },
      'system-fluid': { title: '柔性布局' },
      'system-safe': { title: '安全区与自适应' },
      'backends': { title: '多渲染后端' },
      'transitions': { title: '转场动效' },
      'playground': { title: '在线编译' },
      'engineering-router': { title: '路由' },
      'engineering-state': { title: '状态管理' },
      'engineering-i18n': { title: '国际化' },
      'about': { title: '关于 Proteus' },
      // ★分包页 meta：键相对**分包内 pages/**（gen-routes 对分包页取 relInSub 去 pages/ 前缀）——
      //   组件详情（subpackages/components/pages/*）与能力详情（subpackages/capabilities/pages/*）。
      'p-button': { title: 'p-button 按钮' },
      'p-input': { title: 'p-input 输入框' },
      'camera': { title: 'useCamera 相机' },
    },
  },
  rules: { disabled: [], mapping: {}, customTags: {} },
  setDataBridge: { batchWindow: 16, perComponent: true },
  style: { px2rpx: true, rpxRatio: 2 },
  // ★全局样式（MP app.wxss 通道）：设计 token（CSS 变量）+ 全局重置。
  //   Web 端同一文件在 main.ts import（★单一事实源：两端消费同一份 tokens.css）
  globalStyle: 'styles/tokens.css',
  // 包体积预算：官方演示主包 ≤1.2MB（微信上限 2MB）
  budget: { mainPackageKB: 1200, strict: false },
  // ★框架内置组件目录（monorepo 根 src/components；相对 root 解析）
  frameworkComponentsDir: '../src/components',
  // Web 端工程专属插件（框架内建 vue + route-blocks，此处补 defaultScoped）
  vite: async () => {
    const { defaultScopedPlugin } = await import('@proteus-vue/plugin-vite')
    return {
      plugins: [defaultScopedPlugin()],
      resolve: {
        alias: [
          { find: '@proteus-vue/components', replacement: path.join(__dirname, '../src/components') },
          // ★框架组件（src/components）经 adapter L2 抽象消费 @proteus-vue/shared——根 node_modules 未 hoist
          { find: '@proteus-vue/shared', replacement: path.join(__dirname, '../packages/shared/src/index.ts') },
          { find: '@proteus-vue/glass', replacement: path.join(__dirname, '../packages/glass/src/index.ts') },
          { find: '@proteus-vue/worklet', replacement: path.join(__dirname, '../packages/worklet/src/index.ts') },
          { find: '@proteus-vue/api', replacement: path.join(__dirname, '../packages/api/src/index.ts') },
        ],
      },
    }
  },
}

export default config
