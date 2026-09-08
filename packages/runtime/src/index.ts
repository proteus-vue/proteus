// src/runtime/index.ts —— 运行时公共入口
// 页面生命周期（onReady/onUnload/onLoad + createPage/createComponent）与 setData 桥接、store 桥、Pinia 持久化
// ★pinia-plan（docs/proteus-pinia-plan）：持久化层（社区兼容 + 自研轻量）在 ./pinia/persistence，工厂在 ./pinia
export { onReady, onUnload, onLoad, createPage, createComponent } from './pageLifecycle'
export { setDataBridge } from './setDataBridge'
export { createStore, connectPageStore } from './store'
export { createPersistedStatePlugin } from './pinia/persistence/plugin'
export type { PersistOptions } from './pinia/persistence/plugin'
export { persisted, createPersistence } from './pinia/persistence/lightweight'
export type { PersistenceOptions } from './pinia/persistence/lightweight'
export { createWebPinia, createMpPinia, createAppPinia, createSsrPinia } from './pinia'
export { registerProvide, readInject, clearProvides, provideCount, subscribeProvide, notifyProvide, nextPageId, destroyPage } from './provide-inject'
export { defineApp, LifecycleOrchestrator, PHASE_ORDER, PhaseTimeoutError } from './lifecycle'
export type { AppLifecycleConfig, LifecycleContext, LifecycleTrace, LifecyclePhase, FallbackStrategy, LaunchType, ProteusApp } from './lifecycle'
// ★★2026-09-08 reactivity-runtime spke：re-export vue 的 reactive 族/守卫/effect（@vue/reactivity 经 vue 重导出——vue 是
//   peer dep，tsc/esbuild 可解析；@vue/reactivity 未在 pnpm 提升到包 node_modules，直接 import 会 TS2307）。
//   产物经 esbuild bundle 会把 reactivity 内联进 _proteus/runtime.js（仅 @proteus-vue/* external）——页面/组件以
//   require('@proteus-vue/runtime') 获取（走 _proteus/ 共享模块映射），不开新的裸包 require。
//   ★ref/computed/watch 仍由编译器内联；此处仅 reactive/readonly/浅族/守卫/toRaw/effect（运行时真 Proxy 所需）。
export {
  reactive,
  readonly,
  shallowReactive,
  shallowReadonly,
  isReactive,
  isReadonly,
  isProxy,
  isShallow,
  toRaw,
  effect,
} from 'vue'
