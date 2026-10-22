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
.sec{border-bottom:1px solid var(--line);padding:12px 14px}
h3{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--dim);letter-spacing:.4px}
.note{font-size:11.5px;color:#6f7783;margin-top:6px;line-height:1.6}
</style>
