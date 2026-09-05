<script setup lang="ts">
// website/src/pages/MultiDevice.vue —— ★#489 定稿：原版六端演示接入官网壳
// 不做任何重写：flexible-multi-device.html 原版内容/样式/交互原样保留（仅去掉它自带的顶条，导航由官网接管），
// iframe 嵌入站内页——跳转割裂感消除，主题「同一份语义 → 六端各自形态」完整还原。
import { t } from '../i18n'

const demoUrl = import.meta.env.BASE_URL + 'flexible-multi-device.html'
</script>

<template>
  <p-view class="mdev">
    <header v-p-fluid="'padding(10, 24)'" class="hd">
      <p-text class="hd-title">{{ t('mdev.subtitle') }}</p-text>
      <p-text class="hd-sub">{{ t('mdev.sub') }}</p-text>
    </header>
    <p-view class="stage-wrap">
      <iframe class="stage" :src="demoUrl" :title="t('mdev.subtitle')" scrolling="yes" />
    </p-view>
  </p-view>
</template>

<style scoped>
.mdev { gap: 4px; }
.hd { gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 0; }
.hd-title { color: var(--ink); font-size: 15px; font-weight: 700; }
.hd-sub { color: var(--muted); font-size: 12px; display: block; }
.stage-wrap { width: 100%; }
.stage {
  display: block;
  width: 100%;
  height: calc(100vh - 168px);
  min-height: 560px;
  border: 0;
  background: #0b1020;
}
</style>
