// packages/web/src/global-components.ts
// ★★★GP3-a（2026-10-03）：**三层挂载组件的模板类型声明**（GlobalComponents 声明合并）
//
// 【为什么必须单独声明】App.vue 模板里写的 `<global-layer>` 等标签要获得 vue-tsc 类型检查
//   （props/插槽/事件）——运行时注册（`installMountLayers`）只解决"能解析"，类型要靠本声明。
//   与 `@proteus-vue/components` 的 `global-components.d.ts` 同款约定（该包声明 p-* 组件）。
//
// 【为什么双名（Pascal + kebab）】两种写法都合法（Vue 模板解析两种都认）——都声明，
//   避免"换种写法就失去类型"的静默退化。
import type { AppRoot, GlobalLayer, OverlayLayer, PageLayer } from './mount-layers'

declare module 'vue' {
  export interface GlobalComponents {
    // App 壳的根（解壳：不产元素）
    AppRoot: typeof AppRoot
    'app-root': typeof AppRoot
    // 三层容器（各建立独立层叠上下文——域偏移来自 contracts）
    GlobalLayer: typeof GlobalLayer
    'global-layer': typeof GlobalLayer
    PageLayer: typeof PageLayer
    'page-layer': typeof PageLayer
    OverlayLayer: typeof OverlayLayer
    'overlay-layer': typeof OverlayLayer
  }
}
