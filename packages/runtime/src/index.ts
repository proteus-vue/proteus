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
