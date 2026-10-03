<!--
  examples/subpackages/svg-lab/pages/gp4-auth-gate-demo.vue —— ★★★GP4-c：**登录失效拦截**验证页

  【这张卡要验什么】"在任意页面任何请求返回 401，弹窗出现且不可取消"——
    本页模拟"页面内 401"（用户没点导航，后台 token 过期）：
      · 点「模拟 401」⇒ 弹窗出现（覆盖本页；**点遮罩/点别处都不关**）
      · 点「重新登录」⇒ 走**既有导航**（`router.replace`）到"登录页"（本页用 replace 到本页自身模拟）
      · 点「模拟登录成功」⇒ `markAuthRestored()` ⇒ 弹窗消失
  【★本页手写宿主（而非靠注入）】因为要绑 `onAction`——自动注入的是裸标签，无法绑业务回调。
    这类"需要业务动作"的宿主**必须手写**（且手写后该能力的自动注入会让位，防双宿主）。
  【★它为什么不是"新机制"】本页的 `expired` 与**路由守卫**读同一份事实
    （`createAuthChecker()` 直接喂给 `createRouter({ auth })`）；守卫在导航时拦 requiresAuth 页，
      本页演示的是**非导航触发**那条路（同一判据的第二路输入）。
-->
<script setup lang="ts">
import { ref } from 'vue'
import { notifyAuthExpired, markAuthRestored, isAuthExpired, authGateState } from '@proteus-vue/runtime'

/** 读数（e2e 断言面） */
const taps = ref(0)
const expiredReadout = ref(false)
const actionCalls = ref(0)
const messageText = ref('')

function refresh() {
  expiredReadout.value = isAuthExpired()
  messageText.value = authGateState().message
}

/** ① 模拟"任意请求返回 401"（业务在请求拦截器里就这么调一行） */
function simulate401() {
  notifyAuthExpired('登录已过期，请重新登录')
  refresh()
}

/** ② 模拟"登录成功"（业务在登录成功回调里调一行） */
function simulateLoginOk() {
  markAuthRestored()
  refresh()
}

/** ③ "重新登录"动作（业务注入——此处演示用**既有导航**收口，不自己造栈） */
function onRelogin() {
  actionCalls.value++
  // 真实业务：router.replace({ name: 'login' })——走既有导航（栈不异常）
  // 本页就地演示（不真的跳，免得 e2e 跑飞）；动作被调到的证据就是 actionCalls
}

function bumpOutside() {
  taps.value++
}

refresh()
</script>

<template>
  <view class="gp4a">
    <text class="gp4a-title">GP4-c · 登录失效拦截（不可取消模态）</text>
    <text class="gp4a-sub">模拟"页面内请求返回 401"：弹窗出现且不可取消，唯一出口是登录态恢复</text>

    <view class="gp4a-block">
      <text class="gp4a-label">① 触发（模拟请求拦截器里的 401 上报）</text>
      <button id="gp4a-401" class="gp4a-btn" @tap="simulate401">模拟 401（弹窗出现）</button>
      <button id="gp4a-login-ok" class="gp4a-btn gp4a-btn--ghost" @tap="simulateLoginOk">模拟登录成功（弹窗消失）</button>
    </view>

    <view class="gp4a-block">
      <text class="gp4a-label">② 证明"不可取消"：下面的按钮在弹窗出现时应**点不动**</text>
      <button id="gp4a-outside" class="gp4a-btn gp4a-btn--ghost" @tap="bumpOutside">
        普通页面按钮 taps={{ taps }}
      </button>
    </view>

    <!--
      ★**本页手写宿主**（不靠自动注入）——因为它需要绑 `onAction`（"重新登录"动作必须交给业务走既有导航）。
      自动注入的是**裸标签**（无法绑事件）⇒ 需要注入业务回调的场景**手写宿主**（这正是"手动优先"设计
      存在的意义：一旦手写，该能力的自动注入整体让位，防双宿主）。
      ★Toast/Loading 宿主不需要回调（纯状态驱动）⇒ 它们靠注入即可；本组件是"需要业务动作"的那一类。
    -->
    <p-auth-gate :on-action="onRelogin" />

    <view class="gp4a-block">
      <text class="gp4a-label">读数（e2e 断言面）</text>
      <text id="gp4a-readout" class="gp4a-readout">
        expired={{ expiredReadout }} · actionCalls={{ actionCalls }} · taps={{ taps }} · msg={{ messageText }}
      </text>
    </view>
  </view>
</template>

<style scoped>
.gp4a {
  display: flex;
  flex-direction: column;
  padding: 24rpx;
}
.gp4a-title {
  font-size: 32rpx;
  font-weight: 700;
  margin-bottom: 8rpx;
}
.gp4a-sub {
  font-size: 24rpx;
  color: #666;
  margin-bottom: 24rpx;
}
.gp4a-block {
  display: flex;
  flex-direction: column;
  margin-bottom: 28rpx;
}
.gp4a-label {
  font-size: 24rpx;
  color: #999;
  margin-bottom: 10rpx;
}
.gp4a-btn {
  margin-bottom: 12rpx;
}
.gp4a-btn--ghost {
  background-color: #f2f3f5;
  color: #333;
}
.gp4a-readout {
  font-size: 24rpx;
  color: #07c160;
}
</style>
