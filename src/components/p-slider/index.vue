<!-- src/components/p-slider/index.vue —— 滑块（★G-32 B2：ui.slider U16）
     min/max/step 约束 + v-model（modelValue ←→ update:modelValue）
     ★2026-09-07 p-slider MP 映射落地：模板用原生 <slider> 双端中性标签——
       Web 经 defaultScopedPlugin 改写 <proteus-slider>（built-in WebSlider 自绘模拟：轨道/填充/圆点 +
       { detail: { value } } 载荷）；MP 编译保留 <slider> = 微信原生 slider（bindchange）。此前
       <input type="range"> 微信无对等 → MP 双引擎不可见（已登记缺口，本批关闭）。 -->
<template>
  <view class="p-slider">
    <slider
      class="p-slider-input"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :disabled="disabled"
      :active-color="activeColor"
      @change="onSliderChange"
    />
  </view>
</template>

<script setup lang="ts">
const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  /** 激活色（滑轨填充；WebSlider/微信原生均支持） */
  activeColor: { type: String, default: '#07c160' },
  /** 禁用 */
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

// ★slider 事件载荷双端一致：{ detail: { value } }（WebSlider change / MP bindchange）
function onSliderChange(e: { detail: { value?: unknown } }): void {
  const v = Number((e as { detail?: { value?: unknown } })?.detail?.value)
  emit('update:modelValue', Number.isFinite(v) ? v : props.modelValue)
}
</script>

<style scoped>
.p-slider {
  display: inline-flex;
  align-items: center;
  width: 100%;
}
.p-slider-input {
  width: 100%;
}
</style>
