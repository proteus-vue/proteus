<script setup lang="ts">
// website/src/pages/MultiDevice.vue —— ★#489 全端同屏页（dogfooding：六渲染后端真实输出墙）
// 复用 MultiDeviceWall（与 Playground 同源编译/IR/渲染管线）；chrome 双语走 t()
import MultiDeviceWall from '../components/MultiDeviceWall.vue'
import { t } from '../i18n'
</script>

<template>
  <p-view class="mdev">
    <header v-p-fluid="'padding-top(20, 40) padding-bottom(8, 20)'">
      <span class="eyebrow">◆ Proteus · RenderBackend SPI</span>
      <p-heading :level="1" class="title">{{ t('mdev.subtitle') }}</p-heading>
      <p-text class="sub">{{ t('mdev.sub') }}</p-text>
    </header>
    <MultiDeviceWall />
  </p-view>
</template>

<style scoped>
.mdev { padding-bottom: 56px; max-width: 1180px; }
.title { color: var(--ink); margin: 10px 0 8px; }
.sub { color: var(--muted); font-size: 13.5px; line-height: 1.75; display: block; max-width: 860px; }
</style>
