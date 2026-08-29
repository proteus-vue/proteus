<!-- src/components/p-view/index.vue —— 通用容器（组件库 B2）
     矩阵 01 §1：display 统一 flex 纵向；box-sizing 统一 content-box（Skyline 默认，Web 侧对齐）
     双端同源码：div → view（编译期映射）；Web 原生 div + 插槽 -->
<template>
  <div
    class="p-view"
    :class="{ 'is-disabled': disabled }"
    :aria-label="ariaLabel"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
// 对象形式 defineProps（编译器静态提取）：BaseProps 契约（contracts/props.ts）逐字面量落地
// pid：跨端唯一标识（自动生成 v2.0 拆包时统一注入，当前透传）
defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
})
</script>

<style scoped>
.p-view {
  display: flex;
  flex-direction: column;
  box-sizing: content-box;
}
.is-disabled {
  opacity: 0.6;
}
</style>
