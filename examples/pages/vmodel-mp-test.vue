<route>
  { "title": "v-model MP 复测" }
</route>
<template>
  <view class="page">
    <text class="page-title">★G12 v-model MP 复测（Skyline）</text>
    <text class="page-sub">p-* 组件 v-model 双绑回传——单段事件 bind:update-*（G12 候选 B）在 Skyline/WebView 是否工作</text>

    <view class="card">
      <text class="card-title">① p-modal v-model:visible（update-visible 单段事件契约）</text>
      <p-button variant="primary" size="small" @click="openModal">打开弹窗</p-button>
      <p-modal v-model:visible="modalVisible" title="G12 复测弹窗" :mask-closable="true">
        <view class="modal-body">
          <text>点遮罩关闭——若 visible 回传 false 说明 update-visible 事件工作</text>
        </view>
      </p-modal>
      <text class="state-line">modalVisible：{{ modalVisible ? 'true（开）' : 'false（关）' }}</text>
    </view>

    <view class="card">
      <text class="card-title">② p-switch v-model（update-modelValue 契约）</text>
      <view class="row">
        <p-switch v-model="sw" />
        <text class="state-line">sw：{{ sw ? '开' : '关' }}</text>
      </view>
    </view>

    <view class="card">
      <text class="card-title">③ p-slider v-model（update-modelValue 契约——MP 映射已落地：原生 slider 双端）</text>
      <p-slider v-model="sliderVal" :min="0" :max="100" :step="1" />
      <text class="state-line">sliderVal：{{ sliderVal }}</text>
      <text class="page-sub note">注：p-slider 模板已换原生 slider 标签（Web = proteus-slider 模拟 / MP = 微信原生）——拖动测回传</text>
    </view>

    <view class="card">
      <text class="card-title">④ p-input（受控组件：:value + @input，非 v-model）</text>
      <p-input :value="txt" placeholder="输入文字测回传" @input="onTxtInput" />
      <text class="state-line">txt：{{ txt || '（空）' }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const modalVisible = ref(false)
const sw = ref(true)
const sliderVal = ref(40)
const txt = ref('')

function openModal(): void {
  modalVisible.value = true
}

// ★p-input 事件契约：载荷 { value }（跨端归一）——受控回显（非 v-model 契约）
function onTxtInput(e: { detail: { value?: string } }): void {
  txt.value = e?.detail?.value ?? ''
}
</script>

<style scoped>
.page {
  padding: 24rpx;
}
.page-title {
  display: block;
  font-size: 36rpx;
  font-weight: 700;
  margin-bottom: 8rpx;
}
.page-sub {
  display: block;
  font-size: 24rpx;
  color: #888;
  margin-bottom: 24rpx;
}
.card {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
}
.card-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  margin-bottom: 16rpx;
}
.row {
  display: flex;
  flex-direction: row;
  align-items: center;
}
.state-line {
  display: block;
  font-size: 26rpx;
  margin-top: 12rpx;
  color: #07c160;
}
.modal-body {
  padding: 24rpx 0;
}
</style>
