// packages/test-core/src/index.ts
// @proteus-vue/test-core —— Proteus 测试核心（test-framework M3）
// createMockContext（唯一 wx 来源）+ mountMpComponent（SFC → 编译 → 逻辑层实例 + WXML）
export { createMockContext } from './context'
export type { MockContext, MockContextOptions, WxStorageMock, WxRouterMock, WxUiMock } from './context'
export { mountMpComponent } from './mount-mp'
export type { MountMpComponentResult, MpComponentInstance } from './mount-mp'
