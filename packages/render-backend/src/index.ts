// packages/render-backend/src/index.ts —— @proteus-vue/render-backend 公共入口
// ★G-27（render-backend-1-plan）：可插拔渲染后端 SPI + conformance + 官方后端原型
//   B1：ProteusRenderBackend 接口 + BackendCapabilities + runBackendConformance（接口完整性自检）
//   B2：VueDomBackend（DOM nodeOps——Vue 生态零成本复用验证）
//   B3 前置：HeadlessBackend（内存节点树——SSR/测试/AI Agent 无设备回归）
//   零依赖纯逻辑（VueDom 需 documentLike 注入；Headless 完全纯）
export type {
  BackendId,
  BackendCapabilities,
  IRNode,
  NodeHandle,
  LayoutConstraints,
  Size,
  NormalizedInputEvent,
  ExternalTexture,
  ProteusRenderBackend,
} from './spi'
export { runBackendConformance } from './conformance'
export type { ConformanceCheck, ConformanceResult } from './conformance'
export { createHeadlessBackend, toPlainTree } from './headless'
export type { HeadlessNode } from './headless'
export { createVueDomBackend } from './vue-dom'
// ★G-27 B4：NativeBackend（nodeOps → 原生视图 + 宿主适配器）
export { createNativeBackend, createMockNativeAdapter } from './native'
export type { NativeViewDescriptor, NativeViewAdapter, MockNativeAdapter, NativePlatform } from './native'
// ★G-27 B5：FlutterBackend spike（Proteus 语义 → Flutter widget 树映射层）
export { createFlutterBackend, mapWidgetType, toWidgetTree } from './flutter'
export type { FlutterWidgetDescriptor } from './flutter'
