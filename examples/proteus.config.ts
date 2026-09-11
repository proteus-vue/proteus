// examples/proteus.config.ts —— Proteus 示例工程配置（完整工程形态，自包含）
// ★配置不再挂在仓库根：示例 = 独立工程（对应 create-proteus 生成的工程结构）
import type { ProteusConfig } from '@proteus-vue/plugin-vite'
// ★#420 配置收敛：Web 端工程专属插件（框架内建 vue + route-blocks，此处补 defaultScoped/devtools 中继/docs 引擎）
import { defaultScopedPlugin, devtoolsRelayPlugin } from '@proteus-vue/plugin-vite'
import { docsMdPlugin } from '@proteus-vue/docs/vite'
// ★module-plan B4：模块图谱 → Web manualChunks（有 modules/ 目录时自动生效）
import { scanModuleConfigs, DependencyGraph, generateRollupOptions } from '@proteus-vue/module'
import type { PluginOption } from 'vite'
import path from 'node:path'

const config: ProteusConfig = {
  platform: 'mp-weixin',
  skyline: true,
  // ★G-29 编译器后端插拔（compiler-backend-1-plan §5）：backend: 'node' | 'rust'（缺省 node 零开销）
  //   改 'rust' → 每次 build:mp 对每个 .vue 跑 Node/Rust 双编译语义等价校验（G-29.1）——不一致构建红
  //   （等价 CLI：proteus build --compiler rust；或临时 env：PROTEUS_COMPILER=rust npm run build:mp）
  compiler: {
    backend: 'node',
  },
  appid: 'wx33bc04a52024def7',
  pagesDir: 'pages',
  // ★#492 项目级路由管理：路由相关配置统一在 router 段（结构 + tabBar + meta）——
  //   routesOutput/subPackages/customRoute 已从顶层收编此处，顶层写法仍兼容（router.* 优先）
  router: {
    // 路由表产物路径（编译期 gen-routes 生成）
    routesOutput: 'router/auto-routes.ts',
    // 分包：各分包独立扫描树
    subPackages: [
      { root: 'subpackages/order', name: 'order' }, // 分包示例：订单模块
      { root: 'subpackages/svg-lab', name: 'svg-lab' }, // SVG 诊断探针页（腾出主包名额——主包有 32 页硬限）
    ],
    // wx.router 自定义路由：内置预设 builders（随 @proteus-vue/router 包发布源码，插件读取后内联进 app.js 注册）
    customRoute: {
      registerPresets: true,
      builders: {
        halfScreen: 'node_modules/@proteus-vue/router/src/presets/halfScreen.ts',
        slideUp: 'node_modules/@proteus-vue/router/src/presets/slideUp.ts',
        scaleDown: 'node_modules/@proteus-vue/router/src/presets/scaleDown.ts',
      },
    },
    // ★决策 #113 集中式 meta：页面零 <route> 声明也能获得 meta（精确路径 > 目录前缀 > 默认）
    // ★约定式路由收口（决策 #112/#113）：path/name 从文件路径推导，meta 全部集中在此（<route> 块仅剩 params 等特殊声明）
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
      'fluid-layout-demo': { title: '柔性布局' },
      'fluid-system-demo': { title: 'Fluid System' },
      'glass-demo': { title: '液态玻璃（G-07）' },
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
  // ★#420 配置收敛：框架内置组件目录（组件库未拆包共享——monorepo 根 src/components；相对 root 解析）
  frameworkComponentsDir: '../src/components',
  // 包体积预算：主包 ≤1.2MB（微信上限 2MB）；strict 时超限构建失败
  budget: {
    mainPackageKB: 1200,
    strict: false,
  },
  // ★决策 #113 集中式 meta 已迁入上方 router.meta（★#492 项目级路由管理）
  // ★#420 配置收敛（原 vite.config.ts 内容收归此处——vite 配置由框架组装，本字段做工程专属扩展）：
  //   Web：框架内建 vue + route-blocks，此处补 defaultScoped（<style> 默认 scoped 对齐 MP 语义）/ devtools 中继 / docs 引擎；
  //   mp：框架内建 mpTransform（frameworkComponentsDir 上方已声明）；
  //   module-plan B4：Web manualChunks（有 modules/ 时自动生效）为 async 扫描——vite 字段支持 async 函数
  vite: async (ctx) => {
    const isMp = ctx.mode === 'mp-weixin'
    const plugins: PluginOption[] = []
    if (!isMp) {
      plugins.push(defaultScopedPlugin(), devtoolsRelayPlugin(), docsMdPlugin())
    }
    const scan = await scanModuleConfigs(__dirname)
    const graph = DependencyGraph.fromConfigs(
      scan.modules.filter((m) => m.ok && m.name).map((m) => ({ name: m.name!, version: m.version ?? '0.0.0', chunk: m.chunk, dependencies: m.dependencies })),
    )
    const rollupOptions = isMp ? undefined : generateRollupOptions(graph).rollupOptions
    return {
      plugins,
      resolve: {
        alias: [
          { find: '@proteus-vue/components', replacement: path.join(__dirname, '../src/components') },
          // ★框架组件（src/components）经 adapter L2 抽象消费 @proteus-vue/shared——vite 需显式别名
          //   （根 node_modules 未 hoist shared，rollup 解析不到）；类型侧在 tsconfig paths 已补
          { find: '@proteus-vue/shared', replacement: path.join(__dirname, '../packages/shared/src/index.ts') },
          // ★G-07 液态玻璃：框架组件 pg-glass 消费 @proteus-vue/glass（纯逻辑 SSOT）
          { find: '@proteus-vue/glass', replacement: path.join(__dirname, '../packages/glass/src/index.ts') },
          // ★Skyline 线收口：框架组件消费 @proteus-vue/worklet（UI 线程动画）
          { find: '@proteus-vue/worklet', replacement: path.join(__dirname, '../packages/worklet/src/index.ts') },
        ],
      },
      build: rollupOptions ? { rollupOptions } : undefined,
    }
  },
}

export default config
