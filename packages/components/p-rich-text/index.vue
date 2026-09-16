<!-- src/components/p-rich-text/index.vue —— 富文本（★G-32 B2：ui.rich-text U3）
     source HTML/markdown → 渲染；Web v-html 直渲，MP 编译器映射 rich-text node
     ★B2 Web-first：source 透传 v-html（MP 端待 rich-text node 映射后续批次）
     双端同源码：div → view；无平台 API -->
<template>
  <div class="p-rich-text" v-html="source" />
</template>

<script setup lang="ts">
defineProps({
  /** HTML/markdown 源 */
  source: { type: String, default: '' },
  /** 渲染 schema（HTML/MARKDOWN——B2 透传，后续批次严格化） */
  schema: { type: String, default: 'html' },
})
</script>

<style scoped>
.p-rich-text {
  line-height: 1.6;
  word-break: break-word;
}
</style>