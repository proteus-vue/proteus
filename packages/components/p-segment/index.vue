<!-- src/components/p-segment/index.vue —— 分段控制器（★G-32 B4：shell.segment S4）
     options[{label,value?}] + active 受控（v-model:active）+ select emit
     双端同源码：div → view；字段经 computed 预计算为数据行（WXML 禁止函数调用 S38；dataset 传值）。 -->
<template>
  <div class="p-segment">
    <div
      v-for="row in rows"
      :key="row.key"
      class="p-segment-item"
      :class="{ 'p-segment-on': active == row.value }"
      :data-value="row.value"
      @click="onSelect"
    >
      {{ row.label }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface SegmentItem {
  label?: string
  value?: string | number
}

const props = defineProps({
  /** 分段项 [{label,value?}?]（value 缺省=label） */
  options: { type: Array as () => SegmentItem[], default: () => [] },
  /** 当前激活项 value */
  active: { type: [String, Number], default: '' },
})

const emit = defineEmits(['update:active', 'select'])

/** ★预计算数据行（WXML 不能调函数；`value` 用方括号取值避开 ref 剥离规则误伤） */
const rows = computed(() =>
  props.options.map((opt, i) => {
    const value = String(opt['value'] != null ? opt['value'] : opt.label != null ? opt.label : '')
    return { key: value + '#' + i, value, label: opt.label != null ? opt.label : value }
  }),
)

function onSelect(e: unknown): void {
  const ev = e as { currentTarget?: { dataset?: { value?: unknown } } }
  const v = ev?.currentTarget?.dataset?.value
  const s = v == null ? '' : String(v)
  emit('update:active', s)
  emit('select', s)
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
