<script setup lang="ts">
// 右栏面板的公共外壳：标题 + 内容 + 可选脚注。
// ★所有面板共用它，避免"每个面板各写一套 padding/标题样式"——那是手写 HTML 版的通病。
defineProps<{ title: string; note?: string }>()
</script>

<template>
  <section class="sec">
    <h3>{{ title }}</h3>
    <slot />
    <div v-if="note" class="note"><slot name="note">{{ note }}</slot></div>
  </section>
</template>

<style scoped>
/* 面板外壳（生产口径）：小号弱色标题 + 统一内边距 + 细分隔线。
   标题不抢内容注意力——IDE 里面板标题是"定位标签"，不是内容。 */
.sec{padding:var(--sp3) var(--sp4);border-bottom:1px solid var(--border-subtle)}
h3{margin:0 0 var(--sp2);font-size:var(--fs-xs);font-weight:600;color:var(--fg-muted);
   letter-spacing:.04em}
.note{margin-top:var(--sp2);font-size:var(--fs-xs);color:var(--fg-subtle);line-height:1.6}
</style>
