<!-- showcase/components/page-shell/index.vue —— 页面外壳（统一标题区 + 安全区）
     ★★根节点用原生 <view>（类名留在元素上，scoped 样式生效——见 tokens.css 铁律）。 -->
<script setup lang="ts">
import { PSafe } from '@proteus-vue/components'

defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
})
</script>

<template>
  <view class="sp-shell">
    <PSafe area="top" :fallback="20" />
    <view class="sp-shell-head">
      <text class="sp-shell-title">{{ title }}</text>
      <text v-if="subtitle" class="sp-shell-sub">{{ subtitle }}</text>
    </view>
    <slot />
  </view>
</template>

<style scoped>
.sp-shell {
  display: block;
  min-height: 100vh;
  padding: var(--sp-4) var(--sp-4) calc(var(--sp-8) + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
  background: var(--sp-bg);
}
.sp-shell-head { display: block; margin-bottom: var(--sp-4); }
.sp-shell-title { display: block; font-size: 23px; font-weight: 800; color: var(--sp-text); letter-spacing: -0.2px; }
.sp-shell-sub { display: block; font-size: 13px; color: var(--sp-text-3); margin-top: var(--sp-1); }
</style>
