<!--
  examples/App.mp.vue —— ★★★GP3-b1（2026-10-03）：**小程序端 App 壳**（Global 层声明处）

  【这是什么】Proteus 三层挂载模型的 **Global 层**在 MP 端的声明面：
    · 在这里（App.vue 的 MP 变体）**写一次** —— 编译期自动注入**每个页面产物**；
    · 对照：Web 端的 `App.vue` 是 SPA 根组件（RouterView），MP 端没有渲染层 App 概念
      ⇒ 这正是本能力的价值（uni-app 官方不支持，社区靠第三方 Vite 插件 @uni-ku/root 补）。

  【★诚实边界（方案 §1.2-bis，不许含糊）】
    · **源码层面**：声明一次 ✔（本文件就是唯一声明处）
    · **实例层面**：MP 每页独立渲染树 ⇒ Global 层是**每页一份实例**（N = 页面栈深度）
      ——与微信官方 `custom-tab-bar` 同模式（每页注入 + **共享状态**），**不得说成"单实例跨页存活"**。
    · 跨页一致靠**共享状态通道** `_proteus/global-layer.js`（require 缓存 = 同实例）= 状态一份。

  【演示什么】全局网络状态条（八条超级应用场景之一）：
    · 默认**隐藏**（`v-if` false ⇒ 零渲染、零几何影响——不给既有页面添负担）
    · 任意页面的按钮都能切换它（处理器由壳提供，注入后各页可用）
    · 切到别的页面，状态**跟随**（共享状态通道生效）
-->
<script setup lang="ts">
import { ref } from 'vue'

// ★Global 层字段：注入到每个页面的 data（跨页一份状态）
const barVisible = ref(false)
const netText = ref('网络正常')

/**
 * ★切换全局状态条（各页面模板可直接 `@tap="toggleGlobalDemoBar"` 调用——
 *   方法随片段注入每个页面实例）。
 */
function toggleGlobalDemoBar() {
  barVisible.value = !barVisible.value
}

/** 设置状态条文案（演示"状态一份、多页同步"） */
function setGlobalNetText(text: string) {
  netText.value = text
}
</script>

<template>
  <app-root>
    <!--
      ★Global 层（方案 §3.2 C1）：只能在这里声明，编译期可枚举。
      ★层标签本身**不产元素**（解壳）——要布局容器请自己包 <view>。
    -->
    <global-layer>
      <view v-if="barVisible" class="gl-net-bar" id="gl-net-bar">
        <text class="gl-net-bar__text">{{ netText }}</text>
        <!-- ★id 是**静态**的（e2e 用选择器点击——scoped hash 类名查不到，本仓装置经验） -->
        <text id="gl-net-bar-hide" class="gl-net-bar__hint" bindtap="toggleGlobalDemoBar">点击隐藏</text>
      </view>
    </global-layer>
  </app-root>
</template>

<style scoped>
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
</style>
