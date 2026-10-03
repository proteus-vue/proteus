<!--
  examples/pages/gp3-global-layer-demo.vue —— ★★★GP3-b1（2026-10-03）：**Global 层（每页注入 + 状态共享）验证页**

  【怎么验（e2e 与人工同款）】
    ① 本页**没有**声明任何"全局状态条"逻辑——全局内容全部来自 `App.mp.vue` 的 `<global-layer>`；
    ② 点「切换」→ 状态条出现（本页）。实现方式 = 调用**注入到本页实例的壳方法**
       （`toggleGlobalDemoBar` 随 Global 层片段注入每个页面，见 App.mp.vue）；
    ③ 跳到别的页面 → 状态条**仍在**（每页注入 + 共享状态通道，与官方 custom-tab-bar 同模式）；
    ④ 回本页点「切换」→ 消失（状态一份，多页同步）。

  【★诚实边界（方案 §1.2-bis）】MP 端每页独立渲染树 ⇒ Global 层是**每页一份实例**
    （N = 页面栈），跨页一致靠**共享状态**（不是实例存活）。
  【★本页为什么用 getCurrentPages 取实例调用（而不是直接写标识符）】`barVisible` 等名字
    属于**壳**的作用域（本页不声明它们——声明了就成"页面优先"覆盖，反而不共享）。
    直接写未声明的标识符过不了 vue-tsc（模板/脚本都会按本页作用域类型检查）——
    故经页面实例取壳方法：这正是"注入"的语义（方法就在本页实例上）。
    业务代码建议走状态层（store）而不是这个方法通道——此处是 GP3-b1 的验证页。
-->
<script setup lang="ts">
import { ref } from 'vue'

/** 本页自己的字段（对照：全局状态条的字段由 App 壳注入，本页没有声明） */
const taps = ref(0)

type ShellBridge = { toggleGlobalDemoBar?: () => void; data?: Record<string, unknown> }

/** 取当前页实例（壳方法注入在它上面） */
function currentPage(): ShellBridge | undefined {
  const pages = getCurrentPages() as unknown as ShellBridge[]
  return pages[pages.length - 1]
}

function toggleBar() {
  const p = currentPage()
  p?.toggleGlobalDemoBar?.()
}

function bump() {
  taps.value++
}
</script>

<template>
  <view class="gp3">
    <text class="gp3-title">GP3-b1 · Global 层（每页注入 + 状态共享）</text>
    <text class="gp3-sub">全局状态条声明在 App.mp.vue（唯一声明处），本页不引入任何全局内容</text>

    <view class="gp3-block">
      <button id="gp3-toggle" class="gp3-btn" @tap="toggleBar">
        切换全局状态条（调用注入的壳方法）
      </button>
      <button id="gp3-bump" class="gp3-btn gp3-btn--ghost" @tap="bump">本页计数 taps={{ taps }}</button>
    </view>

    <view class="gp3-block">
      <text class="gp3-note">跨页验证：开启后跳「首页 / 组件演示」，状态条应仍在（共享状态）</text>
      <navigator url="/pages/index" class="gp3-link">去首页</navigator>
      <navigator url="/pages/components-demo" class="gp3-link">去组件演示</navigator>
    </view>
  </view>
</template>

<style scoped>
.gp3 {
  display: flex;
  flex-direction: column;
  padding: 24rpx;
}
.gp3-title {
  font-size: 32rpx;
  font-weight: 700;
  margin-bottom: 8rpx;
}
.gp3-sub {
  font-size: 24rpx;
  color: #666;
  margin-bottom: 24rpx;
}
.gp3-block {
  display: flex;
  flex-direction: column;
  margin-bottom: 32rpx;
}
.gp3-btn {
  margin-bottom: 16rpx;
}
.gp3-btn--ghost {
  background-color: #f2f3f5;
  color: #333;
}
.gp3-note {
  font-size: 24rpx;
  color: #999;
  margin-bottom: 12rpx;
}
.gp3-link {
  font-size: 28rpx;
  color: #1a7af8;
  margin-bottom: 12rpx;
}
</style>
