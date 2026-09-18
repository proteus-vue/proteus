<!-- src/components/p-page/index.vue —— 页面根容器（★G-32 B4：shell.page S1）
     页面根 = route component（G-17）：title 语义 + statusBar 沉浸 + pullRefresh 声明
     ★B2/B4 薄壳：内容插槽透传；title/statusBar/pullRefresh 为语义声明（宿主导航/滚动批次接入）
     双端同源码：div → view；MP 安全（无平台 API） -->
<template>
  <div class="p-page" :class="{ 'p-page-statusbar': statusBar, 'p-page-pull': pullRefresh }">
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps({
  /** 页面标题（导航栏/文档标题语义声明） */
  title: { type: String, default: '' },
  /** 沉浸式状态栏（内容延伸至状态栏区域） */
  statusBar: { type: Boolean, default: false },
  /** 下拉刷新（页面级滚动接入批次使用） */
  pullRefresh: { type: Boolean, default: false },
})
</script>

<style scoped>
.p-page {
  min-height: 100vh;
  box-sizing: border-box;
  background: var(--p-page-bg, #f7f8fa);
}
.p-page-statusbar {
  padding-top: env(safe-area-inset-top);
}
.p-page-pull {
  /* 下拉刷新由页面滚动容器承接（批次接入），此处仅语义占位 */
}
</style>