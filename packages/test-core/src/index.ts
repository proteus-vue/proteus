// packages/test-core/src/index.ts
// @proteus-vue/test-core —— Proteus 测试核心（test-framework M3）
// createMockContext（唯一 wx 来源）+ mountMpComponent（SFC → 编译 → 逻辑层实例 + WXML）
export { createMockContext } from './context'
export type { MockContext, MockContextOptions, WxStorageMock, WxRouterMock, WxUiMock } from './context'
export { mountMpComponent } from './mount-mp'
export type { MountMpComponentResult, MpComponentInstance } from './mount-mp'
// ★test-framework B7：跨端统一断言 helper（06-cross-platform-assert.md）
export { tap, isWebElement, isMpElement, stateOf, textOf } from './events'
export type { CrossPlatformElement, WebEventTarget, MpEventTarget, WebHostLike, MpHostLike } from './events'
// ★test-framework：统一测试 API —— mountComponent 双端挂载（03 §环境：Web happy-dom + @vue/test-utils / MP 逻辑层 + WXML）
export { mountComponent, mountWebComponent, sfcToComponent } from './mount'
export type { MountComponentOptions, MountedHost, UnifiedMpHost } from './mount'
// ★端能力对齐配套：页面渲染门禁（跨端断言「页面真的渲染出来了吗」——补 E2E 的视觉盲区）
export { assertPageRendered, collectRenderMetrics } from './assert-render'
export type { RenderGateOptions, RenderGateResult } from './assert-render'
// ★★框架元素探针断言原语（2026-09-14）：组件内部几何/可见/可滚——不依赖自动化工具元素查询
//   （glass-easel 隔离下工具查不到组件内部；探针由组件自测量 + driver.probes() 读取）
export { getProbe, assertProbeScrollable, assertProbeGeometry, assertProbeVisible } from './probe-assert'
export type { ProbeProbeOptions } from './probe-assert'
