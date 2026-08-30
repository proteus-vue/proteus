// packages/renderer-app/src/index.ts
// @proteus-vue/renderer-app —— App 端 Vue 自定义渲染器（app-plan B1 核心）
// Vue 官方 createRenderer + NativeAdapter 抽象：标准 Vue SFC 三端复用的 App 运行时通道
// v0.6 正式形态：nativeAdapter 由 iOS/Android 工程实现（B2）；本仓用 mock adapter 验证接线
import { createRenderer } from '@vue/runtime-core'
import { createAppHostConfig } from './host'
import type { NativeAdapter } from './native'

export type { NativeAdapter, NativeNode, NativeTextNode, NativeElementNode, NativeCommentNode } from './native'
export { createAppHostConfig } from './host'
export { createMockAdapter } from './adapters/mock'

/**
 * 创建 App 渲染器：createRenderer(host config) 包装——业务调用方：
 *   const renderer = createAppRenderer(nativeAdapter)
 *   const app = renderer.createApp(App)
 *   app.mount(containerNativeNode)
 */
export function createAppRenderer(adapter: NativeAdapter) {
  return createRenderer(createAppHostConfig(adapter))
}
