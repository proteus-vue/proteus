<!-- src/components/p-button/index.vue —— 按钮（组件库 B2）
     矩阵 01 §7：disabled/loading 原生映射 + throttle 防重复点击（runtime 内置）
     双端同源码：button 原生透传（tag/passthrough）；@click → bindtap -->
<template>
  <button
    class="p-button"
    :class="{ 'is-loading': loading }"
    :disabled="disabled || loading"
    :loading="loading ? 'true' : ''"
    :aria-label="ariaLabel"
    @click="onClick"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  throttle: { type: Number, default: 0 }, // 防重复点击间隔 ms（0 = 不节流）
})

const emit = defineEmits(['click'])

const lastClick = ref(0)

function onClick(e: unknown) {
  const now = Date.now()
  if (props.throttle > 0 && now - lastClick.value < props.throttle) return
  lastClick.value = now
  emit('click', e)
}
</script>

<style scoped>
.p-button.is-loading {
  opacity: 0.7;
}
</style>
