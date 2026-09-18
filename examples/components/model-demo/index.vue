<!-- examples/components/p-model-demo/index.vue —— ★defineModel v-model 契约演示（2026-09-08 地基正本）
     用 @vue/compiler-sfc 权威展开（_useModel）→ prop modelValue + m.value 读→this.data.modelValue /
     写→triggerEvent('update-modelValue', v)（glass-easel update-xxx）。供 vue-compat-demo 页 v-model 绑定，真机验证双绑。 -->
<template>
  <view class="p-model-demo">
    <text class="p-model-demo-label">defineModel 值：{{ m }}</text>
    <input
      class="p-model-demo-input"
      :value="m"
      placeholder="输入测 defineModel 双绑"
      @input="onInput"
    />
  </view>
</template>

<script setup lang="ts">
import { defineModel } from 'vue'

// ★defineModel（Vue 3.4+ 宏）：compileScript 权威展开为 _useModel(__props, 'modelValue')
const m = defineModel<string>('modelValue')

function onInput(e: unknown) {
  // ★微信 input e.detail.value / Web e.target.value——跨端归一取 { value }
  const detail = (e as { detail?: { value?: string } }).detail
  m.value = detail?.value ?? ''
}
</script>

<style scoped>
.p-model-demo {
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}
.p-model-demo-input {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
}
</style>
