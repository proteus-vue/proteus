// src/runtime/index.ts —— 运行时公共入口
// 页面生命周期（onReady/onUnload/onLoad + createPage/createComponent）与 setData 桥接、store 桥
export { onReady, onUnload, onLoad, createPage, createComponent } from './pageLifecycle'
export { setDataBridge } from './setDataBridge'
export { createStore, connectPageStore } from './store'
