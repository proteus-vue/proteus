<!-- src/components/p-text/index.vue —— 文本（组件库 B2）
     矩阵 01 §2：selectable 映射 —— Web user-select: text（.is-selectable 类）；MP 原生 text 的 selectable 属性
     双端同源码：span → text（编译期映射） -->
<template>
  <span
    class="p-text"
    :class="{ 'is-selectable': selectable }"
    :selectable="selectable ? 'true' : ''"
    :aria-label="ariaLabel"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  selectable: { type: Boolean, default: false },
})
</script>

<style scoped>
.p-text.is-selectable {
  user-select: text;
  -webkit-user-select: text;
}
</style>
