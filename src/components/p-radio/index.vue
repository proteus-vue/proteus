<!-- src/components/p-radio/index.vue —— 单选（★G-32 B2：ui.radio U14 · 权威标尺批次 1 对齐官方 <radio>）
     value 本项标识 + modelValue 当前选中值（父级持有，v-model）→ 相等即选中
     ★属性对齐官方 4 项：`value` / `checked`(→modelValue 语义归一) / `disabled` / `color`
     ★事件契约：`change` 载荷 `{ detail: { value, name } }`（官方 radio-group 的 change 携带选中 value）
     ★形态（2026-09-13 定案）：**自绘**（圆形 + 内圆点）——原生 radio 的圆角尺寸跨端难统一；
       且 T2 提醒：圆点用 `background`（非单边异色 border）避免 Skyline 圆角失效。
     双端同源码；MP 安全（无平台 API） -->
<template>
  <view class="p-radio" :class="{ 'p-radio--on': isActive, 'p-radio--disabled': disabled }" role="radio" :aria-checked="isActive ? 'true' : 'false'" @click="choose">
    <view class="p-radio__dot" :style="dotStyle"><view v-if="isActive" class="p-radio__core" /></view>
    <text class="p-radio__label">
      <slot />
    </text>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
  /** 本项标识（★官方 value；选中时随 change 携带） */
  value: { type: [String, Number], default: '' },
  /** 当前选中值（★v-model；官方 checked 经语义归一——组选中值由父级持有） */
  modelValue: { type: [String, Number], default: '' },
  /** 是否禁用（★官方对齐） */
  disabled: { type: Boolean, default: false },
  /** 选中色（★官方 color；缺省微信绿 #07c160） */
  color: { type: String, default: '' },
  /** 组名（框架扩展：同组 radio 共享 name，便于 change 区分组） */
  name: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'change'])

const isActive = computed(() => props.modelValue === props.value)

/** ★2026-09-13 修：自定义 color 必须同时作用于**圆点外圈边框**与**内圆背景**——
    此前只设内圆 background → 外圈边框仍是默认绿（用户实测「边框没跟上还是绿色」）。
    统一色（非单边异色），避免 Skyline 圆角失效陷阱。 */
const dotStyle = computed(() => {
  // ★选中态才应用自定义色（填充 + 边框统一色，避免单边异色陷阱）；未选保持默认灰
  if (!props.color || !isActive.value) return undefined
  return { backgroundColor: props.color, borderColor: props.color }
})

function choose(): void {
  if (props.disabled || isActive.value) return
  emit('update:modelValue', props.value)
  // ★裸载荷（MP 端 e.detail = payload；包 { detail } 会双层 → 页面读不到）
  emit('change', { value: props.value, name: props.name })
}
</script>

<style scoped>
.p-radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 14px;
}
/* ★weui 标准（基础库权威提取）：`wx-radio .wx-radio-input{background:#fff;border:1px solid #d1d1d1;
   border-radius:50%;height:22px;width:22px}`；选中 = **绿底填充**（`.wx-radio-input-checked{background-color:#09bb07}`）
   + 白色内点。此前实现反了（白底 + 绿点）。 */
.p-radio__dot {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 11px;
  border: 1px solid #d1d1d1;
  background: #fff;
  box-sizing: border-box;
  transition: background 0.15s, border-color 0.15s;
}
.p-radio--on .p-radio__dot {
  background: #07c160;
  border-color: #07c160;
}
.p-radio__core {
  width: 8px;
  height: 8px;
  border-radius: 4px;
  /* 白色内点（选中态填充色为绿色） */
  background: #fff;
}
.p-radio__label {
  display: block;
  color: #323233;
}
/* 禁用：淡化 + 禁点（与 p-switch/p-checkbox 状态视觉统一） */
.p-radio--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>