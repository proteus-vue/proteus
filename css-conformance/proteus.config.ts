// css-conformance/proteus.config.ts —— CSS 一致性验收项目（G-61 续）构建配置
//
// 【这个工程是什么（用户 2026-10-05 指定）】CSS 视觉验收的**独立项目**——
//   「需要真实的 vue 页面里面去做真实编译渲染验收，不是装置写逻辑代码」。
//   ⇒ 页面 = 纯静态 Vue SFC（真实业务写法，无 JS 拼样式/无自报读数）；走**真实构建链**
//   （`proteus build --target web|skyline|ios|android|harmony`）→ 各端真实渲染 → 逐端截图 vs Web 基准。
//
// 【与另三个工程的分工】
//   · examples/       = 内部测试全家桶（编译/渲染边界用例）
//   · showcase/       = 对外官方演示
//   · superapp/       = 超级应用验收场（GP5 全局挂载等）
//   · css-conformance = **本工程**：CSS 特性逐项视觉验收场（一页一特性域，案例即真实业务形态）
//
// 【页面组织】`pages/<域>.vue`（text / border / layout / paint / …）——每页内一个特性一块案例区，
//   案例容器带稳定 id（`case-<feature>-<value>`），供逐端截图与差异登记寻址。
import type { ProteusConfig } from '@proteus-vue/plugin-vite'

const config: ProteusConfig = {
  platform: 'mp-weixin',
  skyline: true,
  // ★测试 appid（与 examples/showcase/superapp 同一测试号）
  appid: 'wxa720d0c502451748',
  pagesDir: 'pages',
  router: {
    routesOutput: 'router/auto-routes.ts',
    // 集中式 meta（页面标题；无 tabBar——验收项目单栈路由）
    meta: {
      text: { title: 'CSS 验收 · 文本' },
      border: { title: 'CSS 验收 · 边框' },
      'justify-self': { title: 'CSS 验收 · 网格自对齐' },
      'word-break': { title: 'CSS 验收 · 断词' },
      layout: { title: 'CSS 验收 · 布局' },
      paint: { title: 'CSS 验收 · 绘制' },
    },
  },
  rules: { disabled: [], mapping: {}, customTags: {} },
  setDataBridge: { batchWindow: 16, perComponent: true },
  style: { px2rpx: true, rpxRatio: 2 },
  // ★全局样式（MP app.wxss 通道；Web 端 main.ts 同源 import）——设计 token + 页面骨架类。
  globalStyle: 'styles/global.css',
  budget: { mainPackageKB: 800, strict: false },
  // ★Web 端必须挂 `defaultScopedPlugin`（S50 坑：view/text 等标签需改写成 proteus-* 组件，
  //   否则浏览器按未知元素（display:inline）渲染 ⇒ 块级布局全部失效——superapp 实测同因）。
  vite: async () => {
    const { defaultScopedPlugin } = await import('@proteus-vue/plugin-vite')
    return { plugins: [defaultScopedPlugin()] }
  },
}

export default config
