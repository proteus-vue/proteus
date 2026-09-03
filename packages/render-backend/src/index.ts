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
// ★G-31 B5：组件渲染快照基础设施（conformance 渲染层——驱动 nodeOps + 控件 readback）
export { renderComponentSnapshot, createControlReader } from './conformance-component'
export type { RenderNodeSnapshot, ControlReader } from './conformance-component'
// ★G-27 B6：混合渲染（Texture Sharing + 页面/区域级切后端 + DevTools 路由 trace）
export { createHybridRenderer, textureRef, runHybridConformance } from './hybrid'
export type { HybridRegion, HybridRendererOptions, HybridRouteTrace, HybridRenderer, HybridTextureRef, HybridConformanceResult } from './hybrid'
// ★G-41 B1：ProteusNodeOpsDispatcher（方案 B 全局转发层 + 热切换 + H-03 双引擎验证）
export { createNodeOpsDispatcher, renderIRTree, semanticSequence, DispatcherError } from './dispatcher'
export type { ProteusNodeOpsDispatcher, DispatcherNodeOps, NodeOpsCall } from './dispatcher'
// ★G-41 B2：Host Conformance 套件（H-01~H-08 32 项权威 TS 版——CMP058 上线门禁）
export { runHostConformance, formatHostConformance, createHostRuntimeStub, createCarrierStub } from './host-conformance'
export type { HostConformanceResult, HostConformanceSummary, HostConformanceOptions, HostRuntimeLike, CarrierLike } from './host-conformance'
// ★G-41 B3：真实 Vue createRenderer 接入（Dispatcher → RendererOptions → renderer——标准 SFC/App 落到任意后端）
export { createVueRendererOptions, createProteusRenderer, createProteusRendererForBackend } from './vue-bridge'
export type { ProteusRenderer } from './vue-bridge'
