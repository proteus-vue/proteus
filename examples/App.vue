<!-- src/App.vue —— Web 端根组件（SPA 壳：RouterView 按当前路由渲染页面） -->
<script setup lang="ts">
import { onMounted } from 'vue'
import RouterView from './router/RouterView.vue'
// ★应用标题唯一事实源（决策 #212）：app.config.ts 的 app.name——运行时设置浏览器标签标题
//   （index.html 静态 <title> 仅首屏兜底，避免白屏期无标题；页面级标题 = router.meta.title 待导航组件消费）
import appConfig from './app.config'

onMounted(() => {
  document.title = appConfig.app.name
})
</script>

<template>
  <!--
    ★★★GP3-a（2026-10-03）：**三层挂载（Web 端）**——与 `App.mp.vue` **同一套声明形态**
    （`<app-root>` / `<*-layer>`），两端落地机制不同：
      · Web：标签是**运行时组件**（App.vue 是真根组件，RouterView 嵌在 `<page-layer>` 里，
        Global 层内容**天然跨路由存活**——它在 RouterView 之外）
      · MP ：标签是**编译期**概念（编译器解壳 + Global 内容注入每页；MP 无渲染层 App）
    层容器只承担**层叠域职责**（z-index = 契约的域偏移），不做布局干预。
  -->
  <app-root>
    <global-layer>
      <!-- ★Global 层示例：全局网络状态条（与 App.mp.vue 的示例同语义——Web 端因跨路由存活而更简单） -->
      <div class="app">全局层占位（Web 端跨路由存活）</div>
    </global-layer>
    <page-layer>
      <div class="app">
        <RouterView />
      </div>
    </page-layer>
    <!--
      ★Overlay 层（最上层）：临时出现的浮层（Toast / 弹窗 / 登录拦截）。
      ★Web 端用**渲染树内节点**（不是原生 Teleport——GP0-e 结论：Teleport 会绕过框架的渲染树语义，
        层级/可枚举/conformance 都失去锚点）。浮层内容自己绝对定位在本层容器内（容器 z-index 域最高）。
      ★诚实边界：Overlay 层的**能力**（Toast 队列 / Loading 多实例 / 登录拦截）在 Web 端点各自的
        宿主组件（`p-toast-host` 等）——它们与 MP 端的注入机制不同（Web 无编译期注入），
        需要业务在 App.vue 显式挂（本层就是给它们的位置）。
    -->
    <overlay-layer>
      <div class="app"></div>
    </overlay-layer>
  </app-root>
</template>

<style global>
.app {
  font-family: system-ui, -apple-system, sans-serif;
  color: #1f2328;
}
</style>
