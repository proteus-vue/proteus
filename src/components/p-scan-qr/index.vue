<!-- src/components/p-scan-qr/index.vue —— 扫码能力入口（★G-32 能力入口组件：capability.scan-qr）
     声明式入口：点击触发 useQRCode()（小程序扫码 / web 摄像头降级）；成功 emit('scan', result)
     ★双端：能力经 @proteus-vue/api 桥（小程序走原生扫码；web 无标准 → Err 显式降级） -->
<template>
  <div class="p-scan-qr" role="button" :aria-label="label" @click="onTrigger">
    <slot>
      <span class="p-scan-qr__label">{{ label }}</span>
    </slot>
  </div>
</template>

<script setup lang="ts">
import { createCapabilityBridge, createCapabilityHooks } from '@proteus-vue/api'

const props = defineProps({
  /** 无障碍标签 / 默认按钮文案 */
  label: { type: String, default: '扫码' },
  /** 自动触发（挂载即扫；默认点击触发） */
  auto: { type: Boolean, default: false },
})

const emit = defineEmits(['scan', 'error'])

// ★MP 编译安全：桥/hooks 在方法内构造（顶层函数调用会是 runtimeInit，裸引用不可靠）
function hooksOnce() {
  return createCapabilityHooks(createCapabilityBridge())
}

function onTrigger(): void {
  hooksOnce()
    .useQRCode()
    .then((r) => {
      if (r.ok) emit('scan', r.data)
      else emit('error', r.error.message)
    })
    .catch(() => emit('error', 'scan-failed'))
}
</script>

<style scoped>
.p-scan-qr {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border: 1px solid var(--p-border, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
}
</style>
