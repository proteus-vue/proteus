<!-- src/components/p-avatar/index.vue —— 头像（★G-32 B2：ui.avatar U6）
     图片头像 + shape（circle/square）+ size + fallback（缺图显首字符）
     双端同源码：img → image；MP 安全（纯 props/样式；binderror 事件归一后续批次） -->
<template>
  <div class="p-avatar" :class="'p-avatar-' + shape" :style="avatarStyle">
    <img
      v-if="src"
      class="p-avatar-img"
      :src="src"
      :alt="fallbackText"
      @error="onError"
    />
    <div v-else class="p-avatar-text">{{ fallbackText }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 头像图源 */
  src: { type: String, default: '' },
  /** 形状：circle 圆形 / square 圆角方形 */
  shape: { type: String, default: 'circle' },
  /** 尺寸 px */
  size: { type: Number, default: 44 },
  /** 兜底文本（缺图/加载失败显示——首字符） */
  fallback: { type: String, default: '' },
})

const broken = ref(false)

const fallbackText = computed(() => (props.fallback ? props.fallback.slice(0, 1) : 'P'))

function onError(): void {
  broken.value = true
}

const avatarStyle = computed(() => {
  const style: CSSProperties = {
    width: props.size + 'px',
    height: props.size + 'px',
  }
  if (props.shape === 'circle') {
    style.borderRadius = '50%'
  } else {
    style.borderRadius = Math.round(props.size * 0.2) + 'px'
  }
  return style as CSSProperties
})
</script>

<style scoped>
.p-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #f2f3f5;
  color: #969799;
  vertical-align: middle;
}
.p-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.p-avatar-text {
  font-size: calc(0.4em + 10px);
  font-weight: 600;
}
</style>