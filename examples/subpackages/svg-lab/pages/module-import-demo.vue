<!--
  examples/subpackages/svg-lab/pages/module-import-demo.vue —— ★★★B1：外部模块导入验证页

  【这张卡要验什么】用户点名的核心诉求：「跨端框架的基本任务就是让开发者在业务开发代码里面不感知
    平台环境差异，不是直接把限制丢给开发者自己」——**业务代码写标准 import，MP 端零感知**：
      ① **npm 包**（ms）：构建期 esbuild 打包为 `_proteus/npm/ms.js`，页面 require 单例产物；
      ② 产物核对：本页 .js 顶部有 require、`_proteus/npm/ms.js` 存在（构建日志 + 本页 e2e 断言）。

  【诚实边界（照实说，别让开发者撞墙）】
    · npm 包**依赖 Node 内置模块**（fs/path/crypto…）且无 browser 分支的 → 构建期**显式报错**
      （proteus-node-builtin-guard 插件给中文指引，含是哪个包引入的）——不做 polyfill（体积/语义陷阱）；
    · 含原生绑定（.node）/ H5 专属 DOM 的包同理不支持；
    · 打进来的 npm 包进代码包体积——大包仍需业务侧按需 import 子路径。

  【与 Web 端的同源】Web 端走 vite 正常打包；MP 端走这里（同款 browser 条件解析 + esbuild 内联）——
    业务代码**一个字都不用改**。
-->
<script setup lang="ts">
import { ref } from 'vue'
// ① npm 包（真实第三方，构建期打包——业务代码零感知平台）
import ms from 'ms'

const human = ref('')
const count = ref(0)

/** 格式化一个时长（每次点击换一个值——产物里可见 ms 被打包进 _proteus/npm/ms.js） */
function formatDur(): void {
  count.value++
  const durations = [60000, 3600000, 86400000, 1500, 90000]
  human.value = ms(durations[count.value % durations.length])
}
</script>

<template>
  <view class="mod-page">
    <text class="mod-title">外部模块导入验证（B1：npm 包构建期打包）</text>
    <text class="mod-hint">点按钮调用 ms 格式化时长——MP 端由 _proteus/npm/ms.js 提供（require 缓存单例）</text>
    <button class="mod-btn" @click="formatDur">格式化时长</button>
    <text class="mod-uid">结果：{{ human }}</text>
    <text class="mod-count">次数：{{ count }}</text>
  </view>
</template>

<style scoped>
.mod-page {
  display: flex;
  flex-direction: column;
  padding: 24rpx;
}
.mod-title {
  font-size: 30rpx;
  font-weight: 600;
  margin-bottom: 12rpx;
}
.mod-hint {
  font-size: 24rpx;
  color: #666;
  margin-bottom: 24rpx;
}
.mod-btn {
  margin-bottom: 24rpx;
}
.mod-uid,
.mod-count {
  font-size: 26rpx;
  margin-bottom: 8rpx;
}
</style>
