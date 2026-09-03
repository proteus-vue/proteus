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
export type { ProteusNodeOpsDispatcher, DispatcherNodeOps, NodeOpsCall, HotSwitchStrategy } from './dispatcher'
// ★G-41 B2：Host Conformance 套件（H-01~H-08 32 项权威 TS 版——CMP058 上线门禁）
export { runHostConformance, formatHostConformance, createHostRuntimeStub, createCarrierStub } from './host-conformance'
export type { HostConformanceResult, HostConformanceSummary, HostConformanceOptions, HostRuntimeLike, CarrierLike } from './host-conformance'
// ★G-41 B3：真实 Vue createRenderer 接入（Dispatcher → RendererOptions → renderer——标准 SFC/App 落到任意后端）
export { createVueRendererOptions, createProteusRenderer, createProteusRendererForBackend } from './vue-bridge'
export type { ProteusRenderer } from './vue-bridge'
// ★G-41 B4：WebHostRuntime（Web 宿主骨架：Main + Worker + Event Loop——host-guide §5 落地）
export { createWebHostRuntime } from './web-host'
export type { WebHostRuntime, WebWorkerHandle, WebHostOptions } from './web-host'
// ★G-41 B5：热切换生产级（switchBackend 三策略——rebuild/rehydrate/hybrid）
export { createBackendSwitcher } from './hot-switch'
export type { BackendSwitcher, HotSwitchOptions } from './hot-switch'
// ★G-42 B1：HostContainer 容器 SPI + 类型定义（插头形状）
export {
  CONTAINER_PROFILES,
  PAGE_STATE_TRANSITIONS,
  canTransitionPageState,
  FIVE_ATOMIC_STEPS,
  assertAtomicDestroy,
  createDestroyReport,
  DEFAULT_STACK_POLICY,
  profileOfContainer,
} from './container-spi'
export type {
  ContainerCapabilities,
  PageState,
  PageHandle,
  ResourcePool,
  DestroyReport,
  DestroyStep,
  QuotaManager,
  QuotaHandle,
  QuotaUsage,
  PressureLevel,
  StackPolicy,
  SuperAppPolicy,
  BizManifest,
  BusinessSandbox,
  ContainerContext,
  ContainerEvent,
  ProteusHostContainer,
} from './container-spi'
// ★G-42 B2：StackContainer 参考实现（页面栈 + 五原子销毁 + 资源代管 + 配额）
export { createStackContainer, createResourcePool, createQuotaManager } from './stack-container'
export type { StackContainer, StackContainerOptions } from './stack-container'
// ★G-42 B3：容器 Conformance 套件（C-01~C-08 + 仓库治理扫描 + 安全网关纯函数）
export { runContainerConformance, formatContainerConformance, scanRepoForFork, checkBizManifest, checkCapabilityAuthorization, FORK_SIGNATURES, SENSITIVE_CAPABILITIES } from './container-conformance'
export type { ContainerConformanceResult, ContainerConformanceSummary, ForkHit } from './container-conformance'
// ★G-42 B4：SuperAppContainer（业务沙箱 + 崩溃隔离 + 安全网关——C-07 组转 PASS）
export { createSuperAppContainer } from './superapp-container'
export type { SuperAppContainer, SuperAppOptions, SuperSandbox, SandboxExecutionResult } from './superapp-container'
// ★G-42 B6：其余 4 种容器（SinglePage/Embedded 单槽 + Window 多窗口 + MiniProgram 导航语义/L1 沙箱）
export { createSinglePageContainer, createEmbeddedContainer, createWindowContainer, createMiniProgramContainer } from './basic-containers'
export type {
  SinglePageContainer,
  EmbeddedContainer,
  WindowContainer,
  WindowContainerOptions,
  MiniProgramContainer,
  MiniProgramContainerOptions,
  MiniProgramTabConfig,
  MiniProgramSandbox,
} from './basic-containers'
// ★G-43 B1：所有权核心类型 + Tracker（Owned/Borrow/Weak/Managed + 所有权图 + Drop 五阶段）
export { OwnershipGraph, Owned, Borrow, Weak, Managed, ManagedRegistry, createQuotaTracker, OWNERSHIP_ERRORS, OwnershipError, getProteusOwnershipGraph } from './ownership'
export type { OwnedState, GraphNode, GraphEdge, LeakInfo, OwnershipErrorCode } from './ownership'
// ★G-43 B2：借用检查器（源码级静态分析——B-01~B-08 + PSS strict/loose/off）
export { analyzeOwnershipSource } from './borrow-checker'
export type { BorrowDiagnostic, BorrowAnalysisResult, BorrowRule, BorrowSeverity, PssMode, BorrowCheckerOptions } from './borrow-checker'
// ★G-43 B3：与 G-42 五原子销毁集成（页面所有权上下文——releaseResources 委托 Drop 协议 + forceDrop）
export { createPageOwnership } from './page-ownership'
export type { PageOwnership, PageOwnershipOptions, PageAllocOptions, PageOwnershipDestroyReport } from './page-ownership'
// ★G-43 B4：DevTools 所有权图数据层（mutation 事件流 → 历史时间线/计数器/四类诊断/alloc-drop 配对）
export { createOwnershipHistory, createOwnershipCounters, diagnoseOwnershipIssues, buildOwnershipTimeline, formatOwnershipDiagnosis } from './ownership-observability'
export type {
  OwnershipHistory,
  OwnershipHistoryOptions,
  OwnershipRecord,
  OwnershipRecordKind,
  OwnershipCounters,
  TypeCounter,
  OwnershipDiagnosis,
  OwnershipDiagnosisOptions,
  LongBorrow,
  CrossPageRef,
  OwnershipTimeline,
  TimelineEvent,
} from './ownership-observability'
// graph mutation 事件（B4 数据层订阅源——history/计数器/诊断）
export type { OwnershipMutation } from './ownership'
// ★G-43 B5：PSS 编译器支持（P1~P9 限制 + CMP071 + 作用域自动 drop + 管线组合）
export { resolvePssMode, analyzePss, insertScopeDrops, runPss } from './pss'
export type { PssRule, PssDiagnostic, PssAnalysisResult, PssAnalysisOptions, ScopeDropInsertion, ScopeDropResult, PssPipelineOptions, PssPipelineResult } from './pss'
// ★G-43 B5：Owned 状态订阅（useOwned/useBorrow 响应式底座）
export type { OwnedStateListener } from './ownership'
