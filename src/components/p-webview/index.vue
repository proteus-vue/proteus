<!-- src/components/p-webview/index.vue —— 内嵌网页（★权威标尺批 J：shell.webview · 对齐小程序 <web-view>）
     语义：内嵌宿主网页。MP 端原生 <web-view>（承载宿主 WebView）；Web 端 <iframe>（标准浏览器内嵌）。
     ★模板只出现两端均合法的标签：<web-view>（MP）/ <view>（Web 容器）——<iframe> 由运行时按需创建
     （避免 iframe 进入 MP 产物被当未知组件；同 p-camera 的 getUserMedia 运行时注入思路）。
     /* components-allow-platform: Web 端 iframe 元素按需创建（MP 无 iframe，走原生 <web-view>，本逻辑不执行） */ -->
<template>
  <div class="p-webview">
    <!-- MP 原生 web-view（承载宿主 WebView） -->
    <web-view
      v-if="isMp"
      class="p-webview__el"
      :src="src"
      @message="onMessage"
      @error="onError"
    />
    <!-- Web 容器（iframe 运行时注入） -->
    <div v-else :id="hostId" class="p-webview__host" :style="hostStyle" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch, onUnmounted } from 'vue'
import type { CSSProperties } from 'vue'
import { isMpRuntime } from '../runtime/container-measure'

const props = defineProps({
  /** 网页地址（对齐 src） */
  src: { type: String, default: '' },
  /** 高度 px（Web 容器；缺省撑满父容器） */
  height: { type: Number, default: 0 },
  /** Web iframe 沙箱策略（缺省允许脚本/表单/同源） */
  sandbox: { type: String, default: 'allow-scripts allow-forms allow-same-origin' },
})

const emit = defineEmits(['message', 'error'])

const isMp = isMpRuntime()
const hostId = 'p-webview-' + Math.random().toString(36).slice(2, 8)
let frame: HTMLIFrameElement | null = null

const hostStyle = computed<CSSProperties>(() => (props.height > 0 ? { height: props.height + 'px' } : { height: '100%' }))

function ensureFrame(): void {
  if (isMp) return
  // components-allow-platform: Web iframe 按需创建（MP 端走原生 <web-view>，本分支不执行）
  const doc = (globalThis as { document?: Document }).document
  const host = doc && typeof doc.getElementById === 'function' ? doc.getElementById(hostId) : null
  if (!host || typeof doc?.createElement !== 'function') return
  if (!frame) {
    const el = doc.createElement('iframe')
    el.setAttribute('sandbox', props.sandbox)
    el.setAttribute('frameborder', '0')
    el.style.width = '100%'
    el.style.height = '100%'
    el.style.border = '0'
    el.addEventListener('error', () => emit('error', { message: 'iframe load error' }))
    host.appendChild(el)
    frame = el
  }
  if (frame.src !== props.src) frame.src = props.src
}

onMounted(() => {
  if (!isMp) ensureFrame()
})

watch(
  () => props.src,
  () => {
    if (!isMp) ensureFrame()
  },
)

onUnmounted(() => {
  frame?.remove()
  frame = null
})

function onMessage(e: unknown): void {
  emit('message', e)
}
function onError(e: unknown): void {
  emit('error', e)
}

defineExpose({ reload: () => ensureFrame() })
</script>

<style scoped>
.p-webview {
  position: relative;
  width: 100%;
  overflow: hidden;
}
.p-webview__el,
.p-webview__host {
  width: 100%;
  display: block;
}
</style>
