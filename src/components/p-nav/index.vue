<!-- src/components/p-nav/index.vue —— 导航栏（★G-32 B2：shell.nav S2）
     声明式导航栏：title 居中 + left/right 插槽（返回/操作区）+ transparent 透明模式
     双端同源码：nav → view；MP 编译器映射原生导航（navigationStyle custom 场景） -->
<template>
  <nav class="p-nav" :class="{ 'p-nav-transparent': transparent }">
    <div class="p-nav-side p-nav-left">
      <slot name="left" />
    </div>
    <div class="p-nav-title">
      <slot>{{ title }}</slot>
    </div>
    <div class="p-nav-side p-nav-right">
      <slot name="right" />
    </div>
  </nav>
</template>

<script setup lang="ts">
defineProps({
  /** 标题文本（插槽内容优先） */
  title: { type: String, default: '' },
  /** 透明模式（随背景融合） */
  transparent: { type: Boolean, default: false },
})
</script>

<style scoped>
.p-nav {
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 8px;
  background: var(--p-nav-bg, #ffffff);
  border-bottom: 1px solid var(--p-nav-border, #ebedf0);
  position: relative;
}
.p-nav-transparent {
  background: transparent;
  border-bottom: none;
}
.p-nav-side {
  display: flex;
  align-items: center;
  min-width: 64px;
}
.p-nav-right {
  justify-content: flex-end;
}
.p-nav-title {
  flex: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>