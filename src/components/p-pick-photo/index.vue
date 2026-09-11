<!-- src/components/p-pick-photo/index.vue —— 拍照/相册能力入口（★G-32 能力入口组件：capability.pick-photo）
     声明式入口：点击触发 useCamera()（小程序授权 / web getUserMedia）；成功 emit('pick', access)
     ★双端：能力经 @proteus-vue/api 桥（小程序走原生授权；web 走 getUserMedia） -->
<template>
  <div class="p-pick-photo" role="button" :aria-label="label" @click="onTrigger">
    <slot>
      <span class="p-pick-photo__label">{{ label }}</span>
    </slot>
  </div>
</template>

<script setup lang="ts">
import { createCapabilityBridge, createCapabilityHooks } from '@proteus-vue/api'

const props = defineProps({
  /** 无障碍标签 / 默认按钮文案 */
  label: { type: String, default: '选择图片' },
  /** 自动触发（挂载即扫；默认点击触发） */
  auto: { type: Boolean, default: false },
})

const emit = defineEmits(['pick', 'error'])

// ★MP 编译安全：桥/hooks 在方法内构造（顶层函数调用会是 runtimeInit，裸引用不可靠）
function hooksOnce() {
  return createCapabilityHooks(createCapabilityBridge())
}

function onTrigger(): void {
  hooksOnce()
    .useCamera()
    .then((r) => {
      if (r.ok) emit('pick', r.data)
      else emit('error', r.error.message)
    })
    .catch(() => emit('error', 'pick-failed'))
}
</script>

<style scoped>
.p-pick-photo {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border: 1px solid var(--p-border, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
}
</style>
