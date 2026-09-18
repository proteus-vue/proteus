<!-- src/components/p-input/index.vue —— 输入框（组件库 B4）
     矩阵 01 §6：value / type / maxlength / placeholder / focus / disabled + @input/@confirm/@focus/@blur
     事件契约：`:value` + `@input`（载荷 { value } 跨端归一，替代 v-model——MP 自定义组件 v-model 仅覆盖原生 input/textarea）
     双端同源码：input 原生透传（tag/passthrough）；maxlength ≤ 0 = 不限（MP/Web 均忽略非法负值） -->
<template>
  <input
    class="p-input"
    :value="value"
    :type="(password ? 'password' : type) as any"
    :maxlength="maxlength"
    :placeholder="placeholder"
    :placeholder-style="placeholderStyle"
    :placeholder-class="placeholderClass"
    :cursor-spacing="cursorSpacing"
    :confirm-type="confirmType"
    :cursor="cursor"
    :disabled="disabled"
    :class="{ 'is-disabled': disabled }"
    :focus="focus"
    :always-embed="alwaysEmbed"
    :confirm-hold="confirmHold"
    :adjust-position="adjustPosition"
    :hold-keyboard="holdKeyboard"
    :cursor-color="cursorColor"
    :selection-start="selectionStart"
    :selection-end="selectionEnd"
    :safe-password-cert-path="safePasswordCertPath"
    :safe-password-length="safePasswordLength"
    :safe-password-time-stamp="safePasswordTimeStamp"
    :safe-password-nonce="safePasswordNonce"
    :safe-password-salt="safePasswordSalt"
    :safe-password-custom-hash="safePasswordCustomHash"
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
  // ── ★官方 <input> 属性对齐（2026-09-13）──
  /** 是否是密码类型（官方独立属性；等价 type="password"） */
  password: { type: Boolean, default: false },
  /** 占位符样式（内联样式字符串） */
  placeholderStyle: { type: String, default: '' },
  /** 指定光标与键盘的距离（px） */
  cursorSpacing: { type: Number, default: 0 },
  /** 键盘右下角按钮文字：send/search/next/go/done */
  confirmType: { type: String, default: '' },
  /** 光标位置 */
  cursor: { type: Number, default: -1 },
  /** 是否自动增高（textarea 语义，input 端透传） */
  autoHeight: { type: Boolean, default: false },
  focus: { type: Boolean, default: false },
  // ── ★官方 <input> 属性对齐 · 批次外收口（2026-09-18）：键盘/同层/选区/安全键盘族 ──
  //   均为 **MP 宿主透传**属性（Web 无对应能力 → 降级为 no-op，已在降级表声明 web:fallback）
  /** 强制 input 处于同层状态（iOS：默认 focus 时会切非同层） */
  alwaysEmbed: { type: Boolean, default: false },
  /** 点击键盘右下角按钮时是否保持键盘不收起 */
  confirmHold: { type: Boolean, default: false },
  /** 键盘弹起时是否自动上推页面（官方默认 true） */
  adjustPosition: { type: Boolean, default: true },
  /** focus 时点击页面是否不收起键盘 */
  holdKeyboard: { type: Boolean, default: false },
  /** 光标颜色（iOS 十六进制；Android 仅 default/green） */
  cursorColor: { type: String, default: '' },
  /** 光标起始位置（自动聚集时有效，需与 selectionEnd 搭配） */
  selectionStart: { type: Number, default: -1 },
  /** 光标结束位置（自动聚集时有效，需与 selectionStart 搭配） */
  selectionEnd: { type: Number, default: -1 },
  /** placeholder 样式类名（与 placeholderStyle 互补：类 vs 内联样式） */
  placeholderClass: { type: String, default: '' },
  // 安全键盘族（官方 type="safe-password" 时生效；鸿蒙 OS 暂不支持）
  /** 安全键盘加密公钥路径（仅支持包内路径） */
  safePasswordCertPath: { type: String, default: '' },
  /** 安全键盘输入密码长度 */
  safePasswordLength: { type: Number, default: 0 },
  /** 安全键盘加密时间戳 */
  safePasswordTimeStamp: { type: Number, default: 0 },
  /** 安全键盘加密盐值 */
  safePasswordNonce: { type: String, default: '' },
  /** 安全键盘计算 hash 盐值（指定 customHash 则无效） */
  safePasswordSalt: { type: String, default: '' },
  /** 安全键盘计算 hash 的算法表达式，如 md5(sha1('foo' + sha256(sm3(passw))) */
  safePasswordCustomHash: { type: String, default: '' },
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
  border: 1px solid var(--p-input-border, #d0d3dc);
  border-radius: var(--p-input-radius, 8px);
  /* ★两端盒模型归一（2026-09-13 真机实测）：Web <input> 与小程序 <input>/Skyline 默认
     高度/行内盒不同——只给 padding 会导致**小程序端又矮又圆（胶囊状）+ 占位文字极小**，
     与 Web 完全对不上。故显式固定高度（= 内容行高），横向 padding 保留；两端像素一致。 */
  height: var(--p-input-height, 44px);
  padding: 0 12px;
  font-size: 14px;
  background: var(--p-input-bg, #ffffff);
  color: var(--p-input-color, #1c1b22);
}
/* ★禁用态视觉弱化（2026-09-12 真机 bug 修复）：此前 disabled 只有原生禁编辑、无视觉区分 */
.p-input.is-disabled {
  background: var(--p-input-disabled-bg, #f2f2f6);
  color: var(--p-input-disabled-color, #a5a3b3);
}
</style>
