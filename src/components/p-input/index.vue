<!-- src/components/p-input/index.vue —— 输入框（组件库 B4）
     矩阵 01 §6：value / type / maxlength / placeholder / focus / disabled + @input/@confirm/@focus/@blur
     事件契约：`:value` + `@input`（载荷 { value } 跨端归一，替代 v-model——MP 自定义组件 v-model 仅覆盖原生 input/textarea）
     双端同源码：input 原生透传（tag/passthrough）；maxlength ≤ 0 = 不限（MP/Web 均忽略非法负值） -->
<template>
  <input
    class="p-input"
    :value="value"
    :type="type"
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
  type: { type: String, default: 'text' }, // text / number / password / ...
  maxlength: { type: Number, default: -1 }, // ≤0 = 不限
  placeholder: { type: String, default: '' },
  focus: { type: Boolean, default: false },
})

const emit = defineEmits(['input', 'confirm', 'focus', 'blur'])

// 事件归一：载荷统一 { value }（MP e.detail.value / Web e.target.value，eventField 兜底）
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
.p-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
}
</style>
