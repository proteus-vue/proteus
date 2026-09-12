<!-- showcase/components/brand-cube/index.vue —— 品牌立方体（与官网 BrandMark / 小程序头像同源）
     等距立方体三面各持一色：一套源码 → 多个渲染目标。

     ★颜色用硬编码 hex（非 CSS 变量）：MP 编译器把内联 SVG 降级为 base64 data-URI 的 <image>，
       data-URI 内的 CSS 变量无法解析（无宿主样式上下文）→ 变量填充会丢失变黑。
       故 SVG 内的 fill 必须是具体色值（与官网 BrandMark.vue 同做法）。 -->
<script setup lang="ts">
defineProps({
  /** 边长 px（对齐 nav/hero 尺寸） */
  size: { type: Number, default: 28 },
})
</script>

<template>
  <svg
    class="sp-cube"
    :width="size"
    :height="size"
    viewBox="0 0 512 512"
    role="img"
    aria-label="Proteus"
  >
    <polygon points="256,112 385.9,187 256,262 126.1,187" fill="#a78bfa" />
    <polygon points="126.1,187 256,262 256,412 126.1,337" fill="#34d399" />
    <polygon points="256,262 385.9,187 385.9,337 256,412" fill="#3b82f6" />
  </svg>
</template>

<style scoped>
.sp-cube {
  display: block;
  flex-shrink: 0;
}
</style>
