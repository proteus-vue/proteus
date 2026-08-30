// packages/plugin-vite/src/index.ts —— @proteus-vue/plugin-vite 公共入口（拆包步骤 5）
// 导出：mpTransform 插件（mp-weixin 编译管线适配层）+ defaultScopedPlugin（Web 端默认 scoped 改写）+ runGenRoutes（路由表生成器）+ 配置类型
export { default as mpTransform, defaultScopedPlugin } from './plugin'
export { runGenRoutes } from './gen-routes'
export type { GenRoutesOptions } from './gen-routes'
export type { ProteusConfig } from './config'
export type { PluginOptions } from './plugin'
