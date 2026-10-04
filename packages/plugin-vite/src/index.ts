// packages/plugin-vite/src/index.ts —— @proteus-vue/plugin-vite 公共入口（拆包步骤 5）
// 导出：mpTransform 插件（mp-weixin 编译管线适配层）+ defaultScopedPlugin（Web 端默认 scoped 改写 + MP 标签改写）
//       + pFluidLayoutPlugin（★仅 p-fluid 属性改写——框架 Web 分支默认注册，见 plugin.ts 注释）
//       + devtoolsRelayPlugin（远程查看中转）+ runGenRoutes + 配置类型
export { default as mpTransform, defaultScopedPlugin, pFluidLayoutPlugin, resolveSharedModule, rewriteRootToPage } from './plugin'
// ★★★B1（2026-10-04）：npm/别名/子路径/内置 解析辅助（纯函数可测——tests/module-npm-b1.test.ts 消费）
export {
  classifyUnresolvedImport,
  isNodeBuiltinSource,
  normalizeModuleAliases,
  applyModuleAlias,
  npmModuleRelNoExt,
  splitNpmSource,
  resolveNpmEntry,
  // ★★★B1 修复（2026-10-04）：external 闭包缺口扫描（CJS require 悬空回归的回归锁）
  findMissingExternalTargets,
} from './plugin'
export type { ModuleAlias } from './plugin'
export { MP_PATH_POLYFILL_CODE } from './path-polyfill'
export { devtoolsRelayPlugin } from './devtools-plugin'
export { createPanelPageHandler, resolveDevtoolsDir, printPanelUrl, isOriginAllowed } from './devtools-plugin'
export type { DevtoolsRelayOptions } from './devtools-plugin'
export { createProteusRelay } from './devtools-relay'
export type { ProteusRelay, RelayRole } from './devtools-relay'
export { runGenRoutes } from './gen-routes'
// ★语义组件库包根解析（@proteus-vue/components，2026-09-14 拆包）：供外部/测试复用
export { resolveComponentsRoot, componentsRootExists, COMPONENTS_PKG } from './resolve-components'
export type { GenRoutesOptions } from './gen-routes'
export type { ProteusConfig } from './config'
export { resolveProteusViteConfig } from './vite-config'
export { profileBoundaryPlugin } from './profile-boundary-plugin'
export type { ProfileBoundaryPluginOptions } from './profile-boundary-plugin'
export type { ProteusViteContext, ProteusViteResult } from './vite-config'
export type { PluginOptions } from './plugin'
