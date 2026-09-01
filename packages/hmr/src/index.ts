// packages/hmr/src/index.ts —— @proteus-vue/hmr 公共入口（devtools-plus G-34 M1：HMR 运行时）
// 用途：开发期工具链（不随业务产物发布）——HMR payload 协议 + 运行时 + Vue hot 适配 +
//       WebSocket 客户端 + 安全 reload。★零依赖：全部接口注入式，纯逻辑可单测（Web 端优先）。
export type { HmrEvent, HmrPayload, HmrTransport, SafeReload } from './types'
export { createHmrRuntime } from './runtime'
export type { HmrRuntime, HmrRuntimeOptions } from './runtime'
export { createVueHotAdapter } from './vue-adapter'
export type { VueHotAdapter, VueHotAdapterOptions, VueHotApiLike } from './vue-adapter'
export { createHmrClient } from './client'
export type { HmrClient, HmrClientOptions, HmrWebSocketLike } from './client'
export { createSafeReload } from './safe-reload'
export type { SafeReloadOptions } from './safe-reload'
