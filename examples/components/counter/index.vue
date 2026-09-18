<!-- examples/components/counter/index.vue —— 组件系统演示（v0.3）
     子组件：defineProps → Component properties、emit() → triggerEvent() -->
<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps({ initial: { type: Number, default: 0 }, label: String })
const emit = defineEmits(['change'])
const count = ref(0)

function add() {
  count.value++
  emit('change', count.value)
}
</script>

<template>
  <div class="counter">
    <text class="label">{{ label }}</text>
    <text class="value">{{ count }}</text>
    <button @click="add">+</button>
  </div>
</template>

<style scoped>
.counter {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: #f0f4ff;
  border-radius: 8px;
}
.label {
  font-size: 13px;
  color: #666;
}
.value {
  font-size: 16px;
  font-weight: 700;
}
</style>
