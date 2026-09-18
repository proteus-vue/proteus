<!-- website/src/components/BrandMark.vue —— 官网品牌标记（Proteus 多彩立方体）
     与小程序头像同源（docs/brand/avatar.svg）：等距立方体三面各持一色，
     隐喻「一套源码 → 多个渲染目标」。纯内联 SVG（零请求、随主题缩放清晰）。
     用法：<BrandMark :size="22" />（默认 22px，导航品牌区尺寸） -->
<script setup lang="ts">
withDefaults(defineProps<{ size?: number; flat?: boolean }>(), { size: 22, flat: false })
</script>

<template>
  <svg
    class="brand-mark"
    :width="size"
    :height="size"
    viewBox="0 0 512 512"
    role="img"
    aria-label="Proteus"
  >
    <defs v-if="!flat">
      <linearGradient id="bmTop" x1="0.5" y1="0" x2="0.5" y2="1">
        <stop offset="0" stop-color="#c4b5fd" /><stop offset="1" stop-color="#8b5cf6" />
      </linearGradient>
      <linearGradient id="bmLeft" x1="0.25" y1="0" x2="0.5" y2="1">
        <stop offset="0" stop-color="#4ade80" /><stop offset="1" stop-color="#16a34a" />
      </linearGradient>
      <linearGradient id="bmRight" x1="0.75" y1="0" x2="0.5" y2="1">
        <stop offset="0" stop-color="#60a5fa" /><stop offset="1" stop-color="#2563eb" />
      </linearGradient>
    </defs>
    <polygon points="256,112 385.9,187 256,262 126.1,187" :fill="flat ? '#a78bfa' : 'url(#bmTop)'" />
    <polygon points="126.1,187 256,262 256,412 126.1,337" :fill="flat ? '#34d399' : 'url(#bmLeft)'" />
    <polygon points="256,262 385.9,187 385.9,337 256,412" :fill="flat ? '#3b82f6' : 'url(#bmRight)'" />
  </svg>
</template>

<style scoped>
.brand-mark {
  display: block;
  flex-shrink: 0;
}
</style>
