// packages/test-core/src/index.ts
// @proteus-vue/test-core —— Proteus 测试核心（test-framework M3）
// createMockContext（唯一 wx 来源）+ mountMpComponent（SFC → 编译 → 逻辑层实例 + WXML）
export { createMockContext } from './context'
export type { MockContext, MockContextOptions, WxStorageMock, WxRouterMock, WxUiMock } from './context'
export { mountMpComponent } from './mount-mp'
export type { MountMpComponentResult, MpComponentInstance } from './mount-mp'
// ★test-framework B7：跨端统一断言 helper（06-cross-platform-assert.md）
export { tap, isWebElement, isMpElement } from './events'
export type { CrossPlatformElement, WebEventTarget, MpEventTarget } from './events'
