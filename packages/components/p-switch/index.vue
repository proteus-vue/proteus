<!-- src/components/p-switch/index.vue —— 开关（★G-32 B2：ui.switch U15）
     ★★设计决策（2026-09-13，用户评审 + G-31 铁律）——**自绘，不沿用原生 <switch>**：
       · 官方 `<switch type="switch|checkbox">` 用「开关 / 复选框」二选一切换形态，是**平台历史包袱**
         （checkbox 形态与 p-checkbox 语义重复、外观是独立小方框）。G-31 铁律禁止把平台私有形态
         上升为框架标准 → Proteus 改为 `shape: round | square`——「圆角 / 方角**开关**」，
         语义更纯粹（都是开关，只是圆角不同）。
       · 原生 `<switch>` 的方角**物理上做不到**（wxss 无法改原生组件内部圆角）→ 必须自绘。
       · 自绘同时解决：两端视觉完全一致、`shape` 可控、主题通道可作用、spinner 可精确居中。
     ★事件契约：change 载荷 `{ detail: { value } }`（与 MP 原生 bind:change 一致），跨端同名，受控 v-model。
     ★状态：disabled（淡化不可交互）/ loading（淡化 + **拇指内旋转指示器**）——两者视觉可分辨。 -->
<template>
  <view
    class="p-switch"
    :class="[
      {
        'p-switch--round': shape === 'round',
        'p-switch--square': shape === 'square',
        'p-switch--on': modelValue,
        'p-switch--disabled': disabled && !loading,
        'p-switch--loading': loading,
      },
    ]"
    :style="trackStyle"
    role="switch"
    :aria-checked="modelValue ? 'true' : 'false'"
    :aria-disabled="disabled || loading ? 'true' : 'false'"
    @click="onToggle"
  >
    <!-- 滑块（thumb）：loading 指示器位于其**内部正中**（flex 居中，两端天然对齐） -->
    <view class="p-switch__thumb">
      <view v-if="loading" class="p-switch__spinner">
        <view class="p-switch__spinner-dot" />
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
  /** 开关状态（受控 v-model；★官方 checked 经语义归一为 modelValue） */
  modelValue: { type: Boolean, default: false },
  /** 是否禁用（★官方对齐） */
  disabled: { type: Boolean, default: false },
  /** ★形态（替代官方 type）：round 圆角（默认）/ square 方角——**都是开关**，仅圆角不同。
   *  （官方 type=checkbox 的复选框形态属平台包袱，已登记为「有意不沿用」→ 用 p-checkbox 组件。） */
  shape: { type: String, default: 'round' },
  /** 打开态颜色（★官方对齐；缺省微信绿 #07c160） */
  color: { type: String, default: '' },
  /** ★框架扩展：加载中（禁切换 + 拇指内旋转指示器，与禁用态可分辨） */
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'change'])

/** 打开态轨道色（官方 color；缺省微信绿） */
const trackStyle = computed(() => {
  if (!props.modelValue || !props.color) return undefined
  return { backgroundColor: props.color, borderColor: props.color }
})

function onToggle(): void {
  if (props.disabled || props.loading) return
  const next = !props.modelValue
  emit('update:modelValue', next)
  // ★裸载荷（MP 端 e.detail = payload；包 { detail } 会双层 → 页面读不到）
  emit('change', { value: next })
}
</script>

<style scoped>
/* 轨道：官方尺寸 52×32；关闭=浅灰底灰边，打开=品牌色（可被 color 覆盖） */
.p-switch {
  position: relative;
  display: inline-block;
  width: 52px;
  height: 32px;
  border-radius: 16px;
  /* ★weui：`wx-switch .wx-switch-input{background-color:rgba(0,0,0,.1);border-color:transparent}` */
  background: rgba(0, 0, 0, 0.1);
  border: 1px solid transparent;
  box-sizing: border-box;
  vertical-align: middle;
  transition: background 0.2s, border-color 0.2s;
  cursor: pointer;
}
.p-switch--on {
  background: #07c160;
  border-color: #07c160;
}
/* ★shape=square：方角开关（轨道与滑块都改方角）——与 round 同为开关形态，非 checkbox */
.p-switch--square {
  border-radius: 5px;
}
.p-switch--square .p-switch__thumb {
  border-radius: 4px;
}
/* 滑块：内缩 2px 贴合（52 - 2*2 - 28 = 20 位移） */
.p-switch__thumb {
  position: absolute;
  top: 1px;
  left: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 14px;
  background: #fff;
  /* ★weui：`:after{box-shadow:0 2px 3px rgba(0,0,0,.06)}` */
  box-shadow: 0 2px 3px rgba(0, 0, 0, 0.06);
  box-sizing: border-box;
  transition: transform 0.2s;
}
.p-switch--on .p-switch__thumb {
  transform: translateX(20px);
}
/* ★加载指示器：位于滑块**内部正中**（flex 居中）——
   画法 = 统一色 border 环 + 随转子元素点（★不用 border-top-color 缺口弧：
   Skyline 下「单边异色 border + border-radius」会让圆角失效 → 圆环渲染成方块，真机实测） */
.p-switch__spinner {
  position: relative;
  width: 14px;
  height: 14px;
  border-radius: 7px;
  border: 1.5px solid rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
  animation: p-switch-spin 0.7s linear infinite;
}
.p-switch__spinner-dot {
  position: absolute;
  top: -1.5px;
  left: 50%;
  width: 4px;
  height: 4px;
  margin-left: -2px;
  border-radius: 2px;
  background: #07c160;
}
@keyframes p-switch-spin {
  to {
    transform: rotate(360deg);
  }
}
/* 状态：禁用淡化 0.5 / 加载淡化 0.45（携带 spinner）——两者可分辨 */
.p-switch--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.p-switch--loading {
  opacity: 0.45;
  cursor: default;
}
</style>
