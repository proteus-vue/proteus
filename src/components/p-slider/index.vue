<!-- src/components/p-slider/index.vue —— 滑块（★G-32 B2：ui.slider U16）
     min/max/step 约束 + v-model（modelValue ←→ update:modelValue）
     双端同源码：Web input[type=range]；MP 编译器后续批次映射 slider 内置 -->
<template>
  <div class="p-slider">
    <input
      class="p-slider-input"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      @input="onInput"
    />
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
})

const emit = defineEmits(['update:modelValue'])

function onInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
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
  accent-color: #07c160;
}
</style>