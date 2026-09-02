<!-- src/components/p-switch/index.vue —— 开关（★G-32 B2：ui.switch U15）
     checked 受控 v-model（modelValue ←→ update:modelValue）；loading 期间禁点
     双端同源码：div → view（Web 自绘开关；MP 编译器后续批次映射 switch 内置） -->
<template>
  <div
    class="p-switch"
    :class="{ 'p-switch-on': modelValue, 'p-switch-loading': loading }"
    role="switch"
    :aria-checked="modelValue ? 'true' : 'false'"
    @click="onToggle"
  >
    <div class="p-switch-core" />
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 加载中（禁切换） */
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

function onToggle(): void {
  if (props.loading) return
  emit('update:modelValue', !props.modelValue)
}
</script>

<style scoped>
.p-switch {
  display: inline-flex;
  align-items: center;
  width: 48px;
  height: 28px;
  border-radius: 14px;
  background: #e0e0e0;
  padding: 2px;
  box-sizing: border-box;
  transition: background 0.2s;
  vertical-align: middle;
}
.p-switch-core {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  transition: transform 0.2s;
}
.p-switch-on {
  background: #07c160;
}
.p-switch-on .p-switch-core {
  transform: translateX(20px);
}
.p-switch-loading {
  opacity: 0.6;
}
</style>