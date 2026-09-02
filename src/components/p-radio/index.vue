<!-- src/components/p-radio/index.vue —— 单选（★G-32 B2：ui.radio U14）
     value 本项值 + group 当前选中值（父级持有）→ 命中即选中
     ★B2 简形：value + group 受控；切换 emit('update:group', value)
     双端同源码；MP 安全（无平台 API） -->
<template>
  <div class="p-radio" :class="{ 'p-radio-on': isActive }" @click="choose">
    <span class="p-radio-dot"><span v-if="isActive" class="p-radio-core" /></span>
    <span class="p-radio-label">
      <slot />
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
  /** 本项值 */
  value: { type: [String, Number], default: '' },
  /** 当前选中值（父级 group 持有） */
  group: { type: [String, Number], default: '' },
  /** 禁用 */
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:group'])

const isActive = computed(() => props.group === props.value)

function choose(): void {
  if (props.disabled || isActive.value) return
  emit('update:group', props.value)
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
.p-radio-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid #c8c9cc;
  border-radius: 50%;
  box-sizing: border-box;
  transition: all 0.15s;
}
.p-radio-on .p-radio-dot {
  border-color: #07c160;
}
.p-radio-core {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #07c160;
}
.p-radio-label {
  color: #323233;
}
</style>