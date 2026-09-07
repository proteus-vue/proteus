<!-- src/components/p-segment/index.vue —— 分段控制器（★G-32 B4：shell.segment S4）
     options[{label,value?}] + active 受控（v-model:active）+ select emit
     双端同源码：div → view；MP 安全（v-for + 方法取字段——S3 p-tabbar 惯例） -->
<template>
  <div class="p-segment">
    <div
      v-for="opt in options"
      :key="optValue(opt)"
      class="p-segment-item"
      :class="{ 'p-segment-on': String(active) === optValue(opt) }"
      @click="onSelect(opt)"
    >
      {{ optLabel(opt) }}
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  /** 分段项 [{label,value?}?]（value 缺省=label） */
  options: { type: Array as () => unknown[], default: () => [] },
  /** 当前激活项 value */
  active: { type: [String, Number], default: '' },
})

const emit = defineEmits(['update:active', 'select'])

// ★MP 安全：字段访问走方法（数组泛型 unknown）
function optValue(opt: unknown): string {
  const o = opt as { value?: string | number; label?: string }
  return String(o.value ?? o.label ?? '')
}
function optLabel(opt: unknown): string {
  const o = opt as { label?: string; value?: string | number }
  return o.label ?? String(o.value ?? '')
}

function onSelect(opt: unknown): void {
  const v = optValue(opt)
  emit('update:active', v)
  emit('select', v)
}
</script>

<style scoped>
/* ★#389 主题变量钩子（默认值 = 原浅色，零破坏；暗色主题侧注变量——同 p-page --p-page-bg 范式） */
.p-segment {
  display: inline-flex;
  padding: 2px;
  background: var(--seg-bg, #f2f3f5);
  border-radius: 8px;
  font-size: 14px;
}
.p-segment-item {
  padding: 6px 16px;
  border-radius: 6px;
  color: var(--seg-item-color, #646566);
  transition: all 0.15s;
}
.p-segment-on {
  background: var(--seg-on-bg, #fff);
  color: var(--seg-on-color, #323233);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
</style>