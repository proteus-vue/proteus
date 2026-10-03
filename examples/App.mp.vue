<!--
  examples/App.mp.vue —— ★★★GP3-b1/GP5（2026-10-03）：**小程序端 App 壳**（Global 层声明处）

  【这是什么】Proteus 三层挂载模型的 **Global 层**在 MP 端的声明面：
    · 在这里（App.vue 的 MP 变体）**写一次** —— 编译期自动注入**每个页面产物**；
    · 对照：Web 端的 `App.vue` 是 SPA 根组件（RouterView），MP 端没有渲染层 App 概念
      ⇒ 这正是本能力的价值（uni-app 官方不支持，社区靠第三方 Vite 插件 @uni-ku/root 补）。

  【★诚实边界（方案 §1.2-bis，不许含糊）】
    · **源码层面**：声明一次 ✔（本文件就是唯一声明处）
    · **实例层面**：MP 每页独立渲染树 ⇒ Global 层是**每页一份实例**（N = 页面栈深度）
      ——与微信官方 `custom-tab-bar` 同模式（每页注入 + **共享状态**），**不得说成"单实例跨页存活"**。
    · 跨页一致靠**共享状态通道** `_proteus/global-layer.js`（require 缓存 = 同实例）= 状态一份。

  【★★GP5：八条超级应用场景（本文件承载 Global 层四条的**声明面**）】
    · ⑥ 全局网络状态条（GP3-b1 起既有——切换/隐藏）
    · ④ 全局悬浮球（客服/播放器入口——显隐 + 点它自隐）
    · ⑤ 全局音乐播放条（显隐 + 播放态切换）
    · ⑦ 全局主题容器（暗/亮切换，无需刷新——全屏绝对定位背景层，树序最底）
    · ⑧ 全局 IM 未读角标（跨页同步：任意页 +1，其它页 onShow 拉到同一份）
    验证页 `subpackages/svg-lab/pages/gp5-scenarios-demo.vue` **源码零全局声明**——
    控件全部调用随片段注入的壳方法（`glToggle*`/`glBumpIm`），是"声明一次、全应用生效"的直接证据。

  【★层间语义提醒（GP1-a 结论）】Global 在 Page **之下**（树序 = 层序）——
    本层内容的可见性依赖页面背景透明；需要**强遮挡**语义的悬浮内容应放 Overlay 层。
    本文件的场景验证的是"声明一次 + 跨页存活 + 状态共享"，不是"遮挡"。
-->
<script setup lang="ts">
import { ref } from 'vue'

/* ── 场景 ⑥：全局网络状态条（GP3-b1 既有） ── */
/** Global 层字段：注入到每个页面的 data（跨页一份状态） */
const barVisible = ref(false)
const netText = ref('网络正常')
/** ★切换全局状态条（各页面模板可直接 `@tap="toggleGlobalDemoBar"` 调用——方法随片段注入每个页面实例） */
function toggleGlobalDemoBar() {
  barVisible.value = !barVisible.value
}
/** 设置状态条文案（演示"状态一份、多页同步"） */
function setGlobalNetText(text: string) {
  netText.value = text
}

/* ── 场景 ④：全局悬浮球（客服 / 播放器入口） ── */
const fabVisible = ref(false)
function glToggleFab() {
  fabVisible.value = !fabVisible.value
}

/* ── 场景 ⑤：全局音乐播放条 ── */
const musicVisible = ref(false)
const musicTitle = ref('夜曲 · 周杰伦')
const musicPlaying = ref(true)
function glToggleMusic() {
  musicVisible.value = !musicVisible.value
}
function glTogglePlay() {
  musicPlaying.value = !musicPlaying.value
}

/* ── 场景 ⑦：全局主题容器（暗黑切换，无需刷新页面） ── */
const theme = ref('light')
function glToggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

/* ── 场景 ⑧：全局 IM 未读角标（跨页面同步） ── */
const imUnread = ref(0)
function glBumpIm() {
  imUnread.value = imUnread.value + 1
}
function glClearIm() {
  imUnread.value = 0
}
</script>

<template>
  <app-root>
    <!--
      ★Global 层（方案 §3.2 C1）：只能在这里声明，编译期可枚举。
      ★层标签本身**不产元素**（解壳）——要布局容器请自己包 <view>。
    -->
    <global-layer>
      <!-- ⑦ 主题容器：全屏背景层（树序最底——页面背景透明时透出；切换即时生效、无需刷新） -->
      <view
        id="gl-theme-bg"
        class="gl-theme-bg"
        :class="{ 'gl-theme-bg--dark': theme === 'dark' }"
      />

      <!-- ⑥ 全局网络状态条 -->
      <view v-if="barVisible" class="gl-net-bar" id="gl-net-bar">
        <text class="gl-net-bar__text">{{ netText }}</text>
        <!-- ★id 是**静态**的（e2e 用选择器点击——scoped hash 类名查不到，本仓装置经验） -->
        <text id="gl-net-bar-hide" class="gl-net-bar__hint" bindtap="toggleGlobalDemoBar">点击隐藏</text>
      </view>

      <!-- ④ 全局悬浮球（右下角；点它自隐——演示"在任意页都可用"） -->
      <view v-if="fabVisible" id="gl-fab" class="gl-fab" bindtap="glToggleFab">
        <text class="gl-fab__text">客服</text>
      </view>

      <!-- ⑤ 全局音乐播放条（底部停靠；播放态可切） -->
      <view v-if="musicVisible" id="gl-music-bar" class="gl-music-bar">
        <text class="gl-music-bar__title">{{ musicTitle }}</text>
        <text id="gl-music-play" class="gl-music-bar__btn" bindtap="glTogglePlay">{{ musicPlaying ? '暂停' : '播放' }}</text>
        <text id="gl-music-close" class="gl-music-bar__btn" bindtap="glToggleMusic">关闭</text>
      </view>

      <!-- ⑧ 全局 IM 未读角标（右上角；点它 +1——跨页同步） -->
      <view v-if="imUnread > 0" id="gl-im-badge" class="gl-im-badge" bindtap="glBumpIm">
        <text class="gl-im-badge__text">{{ imUnread }}</text>
      </view>
    </global-layer>
  </app-root>
</template>

<style scoped>
/* ── ⑦ 主题容器：全屏绝对背景（亮/暗两态） ── */
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

/* ── ⑥ 网络状态条（顶部条，参与正常布局流） ── */
.gl-net-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  height: 56rpx;
  padding-left: 24rpx;
  padding-right: 24rpx;
  background-color: #fff7e6;
  border-bottom: 1rpx solid #f0d9a8;
}
.gl-net-bar__text {
  font-size: 24rpx;
  color: #8a6d3b;
}
.gl-net-bar__hint {
  font-size: 22rpx;
  color: #b08a44;
}

/* ── ④ 悬浮球（右下角，绝对定位——Skyline 官方建议"页面根节点下 absolute 达到 fixed 效果"） ── */
.gl-fab {
  position: absolute;
  right: 32rpx;
  bottom: 240rpx;
  width: 96rpx;
  height: 96rpx;
  border-radius: 48rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  background-color: #3355aa;
}
.gl-fab__text {
  font-size: 26rpx;
  color: #ffffff;
}

/* ── ⑤ 音乐播放条（底部停靠） ── */
.gl-music-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 88rpx;
  padding-left: 24rpx;
  padding-right: 24rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: #1f2328;
}
.gl-music-bar__title {
  flex: 1;
  font-size: 24rpx;
  color: #ffffff;
}
.gl-music-bar__btn {
  font-size: 24rpx;
  color: #9db4e8;
  padding-left: 24rpx;
}

/* ── ⑧ IM 未读角标（右上角） ── */
.gl-im-badge {
  position: absolute;
  right: 24rpx;
  top: 24rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 20rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  background-color: #e54d42;
}
.gl-im-badge__text {
  font-size: 22rpx;
  color: #ffffff;
}
</style>
