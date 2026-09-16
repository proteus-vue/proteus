<!-- src/components/p-textarea/index.vue —— 多行文本域（组件库 B4）
     矩阵 01 §6：value / maxlength / placeholder / focus / disabled + @input/@confirm/@focus/@blur
     事件契约：`:value` + `@input`（载荷 { value } 跨端归一，替代 v-model）
     双端同源码：textarea 原生透传（tag/passthrough）；MP textarea 原生支持 bindconfirm
     ★属性全覆盖（官方 21/21）：value/placeholder/placeholder-style/placeholder-class/disabled/
       maxlength/auto-focus(→focus 等价)/focus/auto-height/cursor-spacing/cursor/selection-start/
       selection-end/adjust-position/hold-keyboard/disable-default-padding/confirm-type/confirm-hold/
       adjust-keyboard-to/fixed/show-confirm-bar。
     ★诚实边界：MP 私有键盘/光标类属性（cursor-spacing/selection-*/adjust-*/hold-keyboard/
       confirm-type/confirm-hold/adjust-keyboard-to/fixed/show-confirm-bar）在 Web 端由原生 <textarea>
       透传为 DOM 属性——浏览器不解释（无副作用，不伪造行为）；纯 MP 能力，属平台差异。 -->
<template>
  <textarea
    class="p-textarea"
    :value="value"
    :placeholder="placeholder"
    :placeholder-style="placeholderStyle || undefined"
    :placeholder-class="placeholderClass || undefined"
    :maxlength="maxlength"
    :disabled="disabled"
    :focus="focus"
    :auto-height="autoHeight"
    :cursor-spacing="cursorSpacing"
    :cursor="cursor"
    :selection-start="selectionStart"
    :selection-end="selectionEnd"
    :adjust-position="adjustPosition"
    :hold-keyboard="holdKeyboard"
    :disable-default-padding="disableDefaultPadding"
    :confirm-type="confirmType || undefined"
    :confirm-hold="confirmHold"
    :adjust-keyboard-to="adjustKeyboardTo || undefined"
    :fixed="fixed"
    :show-confirm-bar="showConfirmBar"
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
  /** ★官方 placeholder-style：占位符内联样式（仅 color/font-size/font-weight/line-height 有效） */
  placeholderStyle: { type: String, default: '' },
  /** ★官方 placeholder-class：占位符类名 */
  placeholderClass: { type: String, default: '' },
  focus: { type: Boolean, default: false },
  /** ★官方 auto-height：自动增高（设 style.height 不生效） */
  autoHeight: { type: Boolean, default: false },
  /** ★官方 cursor-spacing：光标与键盘距离 */
  cursorSpacing: { type: Number, default: 0 },
  /** ★官方 cursor：focus 时光标位置 */
  cursor: { type: Number, default: -1 },
  /** ★官方 selection-start：自动聚焦时光标起始位置（需与 selection-end 搭配） */
  selectionStart: { type: Number, default: -1 },
  /** ★官方 selection-end：自动聚焦时光标结束位置 */
  selectionEnd: { type: Number, default: -1 },
  /** ★官方 adjust-position：键盘弹起时自动上推页面 */
  adjustPosition: { type: Boolean, default: true },
  /** ★官方 hold-keyboard：focus 时点击页面不收起键盘 */
  holdKeyboard: { type: Boolean, default: false },
  /** ★官方 disable-default-padding：去掉 iOS 默认内边距 */
  disableDefaultPadding: { type: Boolean, default: false },
  /** ★官方 confirm-type：键盘右下角按钮文字（send/search/next/go/done） */
  confirmType: { type: String, default: '' },
  /** ★官方 confirm-hold：点击键盘右下角按钮时保持键盘不收起 */
  confirmHold: { type: Boolean, default: false },
  /** ★官方 adjust-keyboard-to：键盘对齐位置（cursor/none） */
  adjustKeyboardTo: { type: String, default: '' },
  /** ★官方 fixed：fixed 定位（MP 私有布局语义） */
  fixed: { type: Boolean, default: false },
  /** ★官方 show-confirm-bar：是否显示键盘上方完成横条（iOS） */
  showConfirmBar: { type: Boolean, default: true },
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
