<!-- src/components/p-location/index.vue —— 定位能力入口（★G-32 能力入口组件：capability.location）
     声明式入口：点击触发 useLocation()（小程序定位 / web geolocation）；成功 emit('locate', coords)
     ★双端：能力经 @proteus-vue/api 桥（小程序走原生定位；web 走 navigator.geolocation） -->
<template>
  <div class="p-location" role="button" :aria-label="label" @click="onTrigger">
    <slot>
      <span class="p-location__label">{{ label }}</span>
    </slot>
  </div>
</template>

<script setup lang="ts">
import { createCapabilityBridge, createCapabilityHooks } from '@proteus-vue/api'

const props = defineProps({
  /** 无障碍标签 / 默认按钮文案 */
  label: { type: String, default: '定位' },
  /** 自动触发（挂载即扫；默认点击触发） */
  auto: { type: Boolean, default: false },
})

const emit = defineEmits(['locate', 'error'])

// ★MP 编译安全：桥/hooks 在方法内构造（顶层函数调用会是 runtimeInit，裸引用不可靠）
function hooksOnce() {
  return createCapabilityHooks(createCapabilityBridge())
}

function onTrigger(): void {
  hooksOnce()
    .useLocation()
    .then((r) => {
      if (r.ok) emit('locate', r.data)
      else emit('error', r.error.message)
    })
    .catch(() => emit('error', 'locate-failed'))
}
</script>

<style scoped>
.p-location {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border: 1px solid var(--p-border, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
}
</style>
