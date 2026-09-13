<!-- src/components/p-checkbox/index.vue —— 多选（★G-32 B2：ui.checkbox U13 · 权威标尺批次 1 对齐官方 <checkbox>）
     ★形态（2026-09-13 定案，与 p-switch 一致）：**自绘**「小方框 + 勾」——官方 checkbox 的原生形态
       本身就是小方框（非开关），自绘可控且两端一致；不沿用原生 <checkbox> 组件（形态/尺寸跨端难以统一）。
     ★属性对齐官方 4 项：`checked`(→modelValue 语义归一) / `disabled` / `color` / `value`(群选标识)。
     ★事件契约：`change` 载荷 `{ detail: { value: 选中态, name: 群选标识 } }`（与官方 checkbox-group 的
       `{ value: [标识...] }` 同源语义，单选用 boolean 更直观）；受控 v-model（update:modelValue）。 -->
<template>
  <view
    class="p-checkbox"
    :class="{ 'p-checkbox--on': isChecked, 'p-checkbox--ind': indeterminate, 'p-checkbox--disabled': disabled }"
    role="checkbox"
    :aria-checked="indeterminate ? 'mixed' : isChecked ? 'true' : 'false'"
    :aria-disabled="disabled ? 'true' : 'false'"
    @click="toggle"
  >
    <view class="p-checkbox__box" :style="boxStyle">
      <view v-if="indeterminate" class="p-checkbox__dash" :style="dashStyle" />
      <text v-else-if="isChecked" class="p-checkbox__check" :style="checkStyle">✓</text>
    </view>
    <text class="p-checkbox__label">
      <slot />
    </text>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
  /** 选中态（受控 v-model；★官方 checked 经语义归一为 modelValue） */
  modelValue: { type: Boolean, default: false },
  /** ★官方 value：checkbox 标识（群选时随 change 携带，用于区分组内成员） */
  value: { type: String, default: '' },
  /** 半选态（框架扩展：父级不定——显式控制，如全选组的一部分选中） */
  indeterminate: { type: Boolean, default: false },
  /** 是否禁用（★官方对齐） */
  disabled: { type: Boolean, default: false },
  /** 选中色（★官方 color；缺省微信绿 #07c160） */
  color: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'change'])

const isChecked = computed(() => props.modelValue)

/** ★weui 形态：选中=白底 + 绿勾 → 自定义 color 只作用于**边框**与**勾/杠**，不改底色
    （统一色，避免 S2 单边异色 border 陷阱；显式 inline style，不依赖 CSS 变量在 MP 的支持） */
const boxStyle = computed(() => {
  if (!(isChecked.value || props.indeterminate) || !props.color) return undefined
  return { borderColor: props.color }
})
const checkStyle = computed(() => (props.color ? { color: props.color } : undefined))
const dashStyle = computed(() => (props.color ? { background: props.color } : undefined))

function toggle(): void {
  if (props.disabled) return
  const next = !props.modelValue
  emit('update:modelValue', next)
  // ★载荷**裸值**（框架约定：MP triggerEvent(name, payload) → 页面 e.detail = payload；
  //   不可再包 { detail } —— 会变成 e.detail.detail（真机踩坑：群选无效）
  emit('change', { value: next, name: props.value })
}
</script>

<style scoped>
/* ★weui 标准（基础库 app.asar 权威提取，2026-09-13 对齐）：
   `wx-checkbox .wx-checkbox-input{background:#fff;border:1px solid #d1d1d1;border-radius:3px;height:22px;width:22px}`
   选中 = **白底 + 绿勾**（`.wx-checkbox-input-checked .wx-checkbox-icon{color:#09bb07}`）——非绿底！ */
.p-checkbox {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px; /* weui margin-right:5px */
  font-size: 14px;
}
.p-checkbox__box {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid #d1d1d1;
  border-radius: 3px;
  background: #fff;
  box-sizing: border-box;
  transition: border-color 0.15s;
}
.p-checkbox--on .p-checkbox__box,
.p-checkbox--ind .p-checkbox__box {
  border-color: var(--p-checkbox-color, #07c160);
}
/* 绿勾（文字字形——两端渲染一致；此前用绿底白勾，与 weui 白底绿勾不符） */
.p-checkbox__check {
  display: block;
  font-size: 15px;
  line-height: 1;
  font-weight: 700;
  color: var(--p-checkbox-color, #07c160);
}
/* 半选横杠（weui: 选中态淡填充 + 横线） */
.p-checkbox__dash {
  display: block;
  width: 12px;
  height: 2px;
  border-radius: 1px;
  background: var(--p-checkbox-color, #07c160);
}
.p-checkbox__label {
  display: block;
  color: #323233;
}
/* 禁用：淡化 + 禁点（与 p-switch 状态视觉统一） */
.p-checkbox--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
