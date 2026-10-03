<!--
  examples/pages/gp4-loading-demo.vue —— ★★★GP4-b（2026-10-03）：**Loading 多实例与遮罩范围**验证页

  【对照 uni.showLoading（本卡的对外证据）】
    · `uni.showLoading` = **全局单例**（连调 = 覆盖前一个；只能一个）
    · 本页演示：**多个 Loading 同时存在**（不同 id）+ 三种遮罩范围
      （`global` 跨页 / `page` 仅本页 + 卸载自动清理 / `region` 就地贴合区域）

  【★本页源码没有宿主标签】宿主由构建期按需注入（检测到 loading API 用法才注入）。
  【★区域遮罩为什么是组件（不是服务）】区域遮罩要贴合**某个元素的盒子**——就地包裹天然精确；
    放进页面级宿主就得测量元素矩形 + 处理滚动/尺寸变化（脆弱且三端有差异）。
-->
<script setup lang="ts">
import { ref } from 'vue'
import { showLoading, hideLoading, clearLoadings, loadingStats } from '@proteus-vue/runtime'

/** 读数（e2e 断言面） */
const lastId = ref('（无）')
const activeCount = ref(0)
const regionOn = ref(false)
const regionText = ref('区域加载中…')
/** region 区内的点击计数（"拦内不拦外"的判据：遮罩在时点不动） */
const regionTaps = ref(0)
const outsideTaps = ref(0)

function refresh() {
  activeCount.value = loadingStats().shown - loadingStats().hidden
}

/** ① 多实例：两个不同 id 的 Loading 同时存在（uni.showLoading 做不到） */
function twoInstances() {
  showLoading({ id: 'work-a', text: '任务 A…', scope: 'page' })
  lastId.value = showLoading({ id: 'work-b', text: '任务 B…', scope: 'page' })
  refresh()
}

/** ② 全局范围：跨页存活（跳页后仍在；回来看还在） */
function globalBusy() {
  lastId.value = showLoading({ id: 'net-busy', text: '网络忙（全局）', scope: 'global' })
  refresh()
}

/** ③ 区域范围：就地包裹（本页一个盒子内的遮罩） */
function regionBusy() {
  regionOn.value = true
  regionText.value = '区域加载中…'
}

/** ④ 同名替换（对齐 uni.showLoading 语义：同 id 再调 = 替换文案，不叠出第二个） */
function replaceSame() {
  showLoading({ id: 'work-a', text: '任务 A（文案已更新）', scope: 'page' })
  refresh()
}

function endA() {
  hideLoading('work-a')
  refresh()
}
function endB() {
  hideLoading('work-b')
  refresh()
}
function endGlobal() {
  hideLoading('net-busy')
  refresh()
}
function endAll() {
  clearLoadings()
  regionOn.value = false
  refresh()
}

/** 区域/区外点击（拦内不拦外的判据） */
function onRegionTap() {
  regionTaps.value++
}
function onOutsideTap() {
  outsideTaps.value++
}
</script>

<template>
  <view class="gp4l">
    <text class="gp4l-title">GP4-b · Loading 多实例与遮罩范围</text>
    <text class="gp4l-sub">对照 uni.showLoading（全局单例）：可多实例共存 / 三种遮罩范围 / 范围外不受影响</text>

    <view class="gp4l-block">
      <text class="gp4l-label">① 多实例（两个不同 id 同时存在）</text>
      <button id="gp4l-two" class="gp4l-btn" @tap="twoInstances">显示 A + B</button>
      <button id="gp4l-end-a" class="gp4l-btn gp4l-btn--ghost" @tap="endA">结束 A</button>
      <button id="gp4l-end-b" class="gp4l-btn gp4l-btn--ghost" @tap="endB">结束 B</button>
      <button id="gp4l-replace" class="gp4l-btn gp4l-btn--ghost" @tap="replaceSame">同名替换（A 换文案）</button>
    </view>

    <view class="gp4l-block">
      <text class="gp4l-label">② 全局范围（跨页存活）</text>
      <button id="gp4l-global" class="gp4l-btn" @tap="globalBusy">网络忙（global）</button>
      <button id="gp4l-end-global" class="gp4l-btn gp4l-btn--ghost" @tap="endGlobal">结束 global</button>
      <navigator url="/pages/index" class="gp4l-link">去首页（global 应仍在；page 级的应已清理）</navigator>
    </view>

    <view class="gp4l-block">
      <text class="gp4l-label">③ 区域范围（就地包裹；拦内不拦外）</text>
      <button id="gp4l-region" class="gp4l-btn" @tap="regionBusy">区域加载（region）</button>
      <view class="gp4l-region-box" @tap="onRegionTap">
        <p-loading-region :active="regionOn" :text="regionText" />
        <text class="gp4l-region-text">区域内容（active 时点这里不应有反应）</text>
        <text class="gp4l-region-count">regionTaps={{ regionTaps }}</text>
      </view>
      <button id="gp4l-outside" class="gp4l-btn gp4l-btn--ghost" @tap="onOutsideTap">
        区域外的按钮（应始终可点）outside={{ outsideTaps }}
      </button>
    </view>

    <view class="gp4l-block">
      <button id="gp4l-end-all" class="gp4l-btn gp4l-btn--ghost" @tap="endAll">全部结束</button>
      <text id="gp4l-readout" class="gp4l-readout">lastId={{ lastId }} · 活跃≈{{ activeCount }}</text>
    </view>
  </view>
</template>

<style scoped>
.gp4l {
  display: flex;
  flex-direction: column;
  padding: 24rpx;
}
.gp4l-title {
  font-size: 32rpx;
  font-weight: 700;
  margin-bottom: 8rpx;
}
.gp4l-sub {
  font-size: 24rpx;
  color: #666;
  margin-bottom: 24rpx;
}
.gp4l-block {
  display: flex;
  flex-direction: column;
  margin-bottom: 28rpx;
}
.gp4l-label {
  font-size: 24rpx;
  color: #999;
  margin-bottom: 10rpx;
}
.gp4l-btn {
  margin-bottom: 12rpx;
}
.gp4l-btn--ghost {
  background-color: #f2f3f5;
  color: #333;
}
.gp4l-link {
  font-size: 26rpx;
  color: #1a7af8;
  margin-top: 8rpx;
}
.gp4l-region-box {
  position: relative;
  height: 200rpx;
  background-color: #f7f8fa;
  border: 1rpx solid #e5e6eb;
  border-radius: 12rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin-bottom: 12rpx;
}
.gp4l-region-text {
  font-size: 26rpx;
  color: #666;
}
.gp4l-region-count {
  font-size: 24rpx;
  color: #07c160;
  margin-top: 8rpx;
}
.gp4l-readout {
  font-size: 24rpx;
  color: #07c160;
}
</style>
