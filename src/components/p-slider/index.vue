<!-- src/components/p-slider/index.vue —— 滑块（★G-32 B2：ui.slider U16）
　　 min/max/step 约束 + v-model（modelValue ←→ update:modelValue）
　　 ★中性标签范式（2026-09-13 定案）：模板写原生 <slider>——
　　   Web：defaultScopedPlugin 改写 <slider> → <proteus-slider>（WebSlider 自绘模拟：轨道/填充/圆点）；
　　   MP：编译保留 = 微信原生 <slider>。两端视觉统一，零重复实现。
　　 ★★属性全覆盖（官方 10/10）：min/max/step/value/disabled/selected-color(→activeColor)/
　　   color(背景条)/block-size/block-color/show-value。事件 change/changing 均透传
　　   （原生载荷 e.detail.value，页面侧用 e?.detail ?? e 跨端通吃）。 -->
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
      :background-color="color || undefined"
      :block-size="blockSize"
      :block-color="blockColor"
      :show-value="showValue"
      @change="onSliderChange"
      @changing="onSliderChanging"
    />
  </view>
</template>

<script setup lang="ts">
const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  /** 激活色（滑轨已选填充；官方 selected-color，Web/MP 均支持） */
  activeColor: { type: String, default: '#07c160' },
  /** 背景条（未选轨道）颜色（官方 color；官方已标记为 deprecated→backgroundColor） */
  color: { type: String, default: '' },
  /** 滑块大小 12–28（官方 block-size） */
  blockSize: { type: Number, default: 28 },
  /** 滑块颜色（官方 block-color） */
  blockColor: { type: String, default: '#ffffff' },
  /** 是否在滑块旁显示当前值（官方 show-value） */
  showValue: { type: Boolean, default: false },
  /** 禁用 */
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'change', 'changing'])

/** 原生形状 → 数值（WebSlider / 微信 bindchange 载荷一致：e.detail.value） */
function valueOf(e: unknown): number {
  const d = (e as { detail?: { value?: unknown } })?.detail
  return Number(d?.value)
}

function onSliderChange(e: unknown): void {
  const v = valueOf(e)
  emit('update:modelValue', Number.isFinite(v) ? v : props.modelValue)
  emit('change', { value: Number.isFinite(v) ? v : props.modelValue })
}

/** ★拖动过程中触发（官方 changing）；仅反应式回传，不改 modelValue（避免拖动中受控回写抖动） */
function onSliderChanging(e: unknown): void {
  const v = valueOf(e)
  emit('changing', { value: Number.isFinite(v) ? v : props.modelValue })
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
