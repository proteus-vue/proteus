<!-- src/App.vue —— Web 端根组件（SPA 壳：RouterView 按当前路由渲染页面） -->
<script setup lang="ts">
import { onMounted } from 'vue'
import RouterView from './router/RouterView.vue'
import { PToastHost, PLoadingHost } from '@proteus-vue/components'
// ★GP5：Web 端的全局场景状态（模块单例——Web 无编译期注入，页面经 store 控制；与 App.mp.vue 同字段）
import * as gp5 from './gp5-state'
import { fabVisible, musicVisible, musicPlaying, musicTitle, theme, imUnread, toggleFab, toggleMusic, togglePlay, toggleTheme, bumpIm } from './gp5-state'
// ★应用标题唯一事实源（决策 #212）：app.config.ts 的 app.name——运行时设置浏览器标签标题
//   （index.html 静态 <title> 仅首屏兜底，避免白屏期无标题；页面级标题 = router.meta.title 待导航组件消费）
import appConfig from './app.config'

onMounted(() => {
  document.title = appConfig.app.name
  // ★GP5：把场景控制函数挂到 globalThis（演示页在 Web 端**不 import 任何外部模块**——
  //   那会破坏小程序侧编译（跨目录 import 落 undefined）；经此桥，同一页源码两端可用）
  ;(globalThis as unknown as Record<string, unknown>).__PROTEUS_GP5__ = gp5
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
      <!--
        ★★★GP5（2026-10-03）：Global 层四条超级应用场景——**声明一次**（与 App.mp.vue 同语义）。
        ★Web 端状态经 `./gp5-state`（模块单例）——页面控件与之联动；MP 端经编译期注入（见 App.mp.vue）。
        ★层间语义提醒：Global 在 Page 之下（层序）——可见性依赖页面背景透明；强遮挡语义应放 Overlay。
      -->
      <!-- ⑦ 主题容器：全屏背景层（切换即时生效、无需刷新） -->
      <div class="gl-theme-bg" :class="{ 'gl-theme-bg--dark': theme === 'dark' }" />
      <!-- ④ 全局悬浮球（右下角） -->
      <div v-if="fabVisible" id="gl-fab" class="gl-fab" @click="toggleFab">客服</div>
      <!-- ⑤ 全局音乐播放条（底部停靠） -->
      <div v-if="musicVisible" id="gl-music-bar" class="gl-music-bar">
        <span class="gl-music-bar__title">{{ musicTitle }}</span>
        <span id="gl-music-play" class="gl-music-bar__btn" @click="togglePlay">{{ musicPlaying ? '暂停' : '播放' }}</span>
        <span id="gl-music-close" class="gl-music-bar__btn" @click="toggleMusic">关闭</span>
      </div>
      <!-- ⑧ 全局 IM 未读角标（右上角） -->
      <div v-if="imUnread > 0" id="gl-im-badge" class="gl-im-badge" @click="bumpIm">{{ imUnread }}</div>
      <!-- ⑥ 全局网络状态条（GP3-b1 起既有） -->
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
      ★GP5：**Toast / Loading 宿主在 Web 端挂在这里（声明一次）**——与 MP 端的按需注入不同（Web 无编译期
        注入），但"每页不用引入"的结论一致（宿主在根组件挂一次，全应用生效）。
    -->
    <overlay-layer>
      <p-toast-host />
      <p-loading-host />
      <div class="app"></div>
    </overlay-layer>
  </app-root>
</template>

<style global>
.app {
  font-family: system-ui, -apple-system, sans-serif;
  color: #1f2328;
}
/* ── ★GP5：Global 层场景样式（与 App.mp.vue 同语义，Web 单位体系） ── */
.gl-theme-bg {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background-color: #ffffff;
}
.gl-theme-bg--dark {
  background-color: #14141c;
}
.gl-fab {
  position: absolute;
  right: 16px;
  bottom: 120px;
  width: 48px;
  height: 48px;
  border-radius: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #3355aa;
  color: #ffffff;
  font-size: 13px;
}
.gl-music-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 44px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #1f2328;
}
.gl-music-bar__title {
  flex: 1;
  font-size: 12px;
  color: #ffffff;
}
.gl-music-bar__btn {
  font-size: 12px;
  color: #9db4e8;
  padding-left: 12px;
  cursor: pointer;
}
.gl-im-badge {
  position: absolute;
  right: 12px;
  top: 12px;
  min-width: 20px;
  height: 20px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #e54d42;
  color: #ffffff;
  font-size: 11px;
  padding: 0 4px;
}
</style>
