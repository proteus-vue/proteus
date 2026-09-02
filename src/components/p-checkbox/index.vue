<!-- src/components/p-checkbox/index.vue —— 多选（★G-32 B2：ui.checkbox U13）
     checked 受控（v-model）+ indeterminate 半选 + group 归一（v-model:group 数组）
     ★简化：单选态 v-model（checked），group 数组态由父级持有（modelValue 数组时进入群选） -->
<template>
  <div class="p-checkbox" :class="{ 'p-checkbox-on': isChecked, 'p-checkbox-ind': indeterminate }" @click="toggle">
    <span class="p-checkbox-box">
      <span v-if="indeterminate" class="p-checkbox-ind-mark">−</span>
      <span v-else-if="isChecked" class="p-checkbox-check-mark">✓</span>
    </span>
    <span class="p-checkbox-label">
      <slot />
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
  /** 选中态（受控 v-model） */
  modelValue: { type: Boolean, default: false },
  /** 半选态（父级不定——显式控制） */
  indeterminate: { type: Boolean, default: false },
  /** 禁用 */
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const isChecked = computed(() => props.modelValue)

function toggle(): void {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}
</script>

<style scoped>
.p-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 14px;
}
.p-checkbox-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid #c8c9cc;
  border-radius: 4px;
  color: #fff;
  font-size: 12px;
  box-sizing: border-box;
  transition: all 0.15s;
}
.p-checkbox-on .p-checkbox-box {
  background: #07c160;
  border-color: #07c160;
}
.p-checkbox-ind .p-checkbox-box {
  background: #07c160;
  border-color: #07c160;
}
.p-checkbox-label {
  color: #323233;
}
</style>