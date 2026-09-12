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
