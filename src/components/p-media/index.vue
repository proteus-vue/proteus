<!-- src/components/p-media/index.vue —— 媒体统一入口（★G-32 B2：ui.media U7）
     kind image/video/audio/live 统一入口（消灭 video/audio 分离组件）
     ★B2 Web-first：kind 决定元素（img/video/audio 显式 v-if——MP 编译器不支持动态标签）
     双端同源码；无平台 API（controls/autoplay/loop/muted 透传原生属性） -->
<template>
  <div class="p-media">
    <img
      v-if="kind === 'image'"
      class="p-media-el"
      :src="src"
      :alt="poster"
      :style="mediaStyle"
    />
    <video
      v-else-if="kind === 'video' || kind === 'live'"
      class="p-media-el"
      :src="src"
      :poster="poster"
      :controls="controls"
      :autoplay="autoplay"
      :loop="loop"
      :muted="muted"
      :style="mediaStyle"
    />
    <audio
      v-else-if="kind === 'audio'"
      class="p-media-el"
      :src="src"
      :controls="controls"
      :autoplay="autoplay"
      :loop="loop"
    />
    <div v-else class="p-media-placeholder">媒体待传入 kind=image|video|audio|live</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 媒体类型：image / video / audio / live */
  kind: { type: String, default: 'image' },
  /** 资源地址 */
  src: { type: String, default: '' },
  /** 封面（video/live） */
  poster: { type: String, default: '' },
  /** 显示控制条 */
  controls: { type: Boolean, default: true },
  /** 自动播放 */
  autoplay: { type: Boolean, default: false },
  /** 循环 */
  loop: { type: Boolean, default: false },
  /** 静音 */
  muted: { type: Boolean, default: false },
  /** 宽 px（0=自适应） */
  width: { type: Number, default: 0 },
  /** 高 px（0=自适应） */
  height: { type: Number, default: 0 },
})

const mediaStyle = computed(() => {
  const style: CSSProperties = {}
  if (props.width) style.width = props.width + 'px'
  if (props.height) style.height = props.height + 'px'
  return style as CSSProperties
})
</script>

<style scoped>
.p-media {
  display: inline-flex;
  max-width: 100%;
}
.p-media-el {
  max-width: 100%;
  border-radius: 4px;
}
.p-media-placeholder {
  padding: 12px 16px;
  background: #f7f8fa;
  color: #969799;
  border-radius: 4px;
  font-size: 13px;
}
</style>