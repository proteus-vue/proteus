<!-- src/components/p-textarea/index.vue —— 多行文本域（组件库 B4）
     矩阵 01 §6：value / maxlength / placeholder / focus / disabled + @input/@confirm/@focus/@blur
     事件契约：`:value` + `@input`（载荷 { value } 跨端归一，替代 v-model）
     双端同源码：textarea 原生透传（tag/passthrough）；MP textarea 原生支持 bindconfirm -->
<template>
  <textarea
    class="p-textarea"
    :value="value"
    :maxlength="maxlength"
    :placeholder="placeholder"
    :disabled="disabled"
    :focus="focus"
    :aria-label="ariaLabel"
    @input="onInput"
    @confirm="onConfirm"
    @focus="onFocus"
    @blur="onBlur"
  />
</template>

<script setup lang="ts">
import { eventValue } from '../runtime/event'

defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  value: { type: String, default: '' },
  maxlength: { type: Number, default: -1 }, // ≤0 = 不限
  placeholder: { type: String, default: '' },
  focus: { type: Boolean, default: false },
})

const emit = defineEmits(['input', 'confirm', 'focus', 'blur'])

function onInput(e: unknown) {
  emit('input', { value: eventValue(e) })
}
function onConfirm(e: unknown) {
  emit('confirm', { value: eventValue(e) })
}
function onFocus(e: unknown) {
  emit('focus', e)
}
function onBlur(e: unknown) {
  emit('blur', e)
}
</script>

<style scoped>
.p-textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
  min-height: 80px;
}
</style>
