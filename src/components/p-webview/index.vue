<!-- src/components/p-webview/index.vue —— 内嵌网页（★权威标尺批 J：shell.webview · 对齐小程序 <web-view>）
     语义：内嵌宿主网页。MP 端原生 <web-view>（承载宿主 WebView）；Web 端 <iframe>（标准浏览器内嵌）。
     ★模板只出现两端均合法的标签：<web-view>（MP）/ <view>（Web 容器）——<iframe> 由运行时按需创建
     （避免 iframe 进入 MP 产物被当未知组件；同 p-camera 的 getUserMedia 运行时注入思路）。
     /* components-allow-platform: Web 端 iframe 元素按需创建（MP 无 iframe，走原生 <web-view>，本逻辑不执行） */ -->
<template>
  <div class="p-webview">
    <!-- MP 原生 web-view（承载宿主 WebView）——★仅支持绝对 http(s) 地址（微信要求 src 指向业务域名内的网页） -->
    <web-view
      v-if="isMp && srcIsUrl"
      class="p-webview__el"
      :src="src"
      @message="onMessage"
      @error="onError"
    />
    <!-- MP + 非 URL（如包内本地 HTML）→ 诚实占位（★平台限制：小程序 <web-view> 不支持加载包内本地文件；
         实测 raw web-view 本地路径与 data: URI 均渲染空白。真机/模拟器均如此）——不静默留白。
         ★直出 text 而非默认插槽内容：微信端默认插槽内容在本工程未验证渲染，直出更可靠 -->
    <div v-else-if="isMp" class="p-webview__host" :style="hostStyle">
      <text class="p-webview__hint">{{ mpLocalHint }}</text>
    </div>
    <!-- Web 容器（iframe 运行时注入；本地相对路径 + 远程 URL 均可加载） -->
    <div v-else :id="hostId" class="p-webview__host" :style="hostStyle" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch, onUnmounted } from 'vue'
import { isMpRuntime } from '../runtime/container-measure'

const props = defineProps({
  /** 网页地址（对齐 src） */
  src: { type: String, default: '' },
  /** 高度 px（Web 容器；缺省撑满父容器） */
  height: { type: Number, default: 0 },
  /** Web iframe 沙箱策略（缺省允许脚本/表单/同源） */
  sandbox: { type: String, default: 'allow-scripts allow-forms allow-same-origin' },
  /** MP 端 src 非 URL 时的占位文案（诚实边界：小程序 <web-view> 不支持包内本地 HTML） */
  mpLocalHint: { type: String, default: 'web-view 仅支持 https 业务域名内的网页；小程序包内本地 HTML 不受平台支持（Web 端可加载）' },
})

const emit = defineEmits(['message', 'error'])

// ★真机 bug 修复（2026-09-12）：computed 使 isMp 进 data（直调会成实例属性 → MP 错走 iframe 容器）
const isMp = computed(() => isMpRuntime())
// ★src 是否绝对 URL（MP 原生 web-view 前提；本地相对路径在 MP 端平台不支持 → 走诚实占位）
const srcIsUrl = computed(() => /^https?:\/\//i.test(props.src))
const hostId = 'p-webview-' + Math.random().toString(36).slice(2, 8)
let frame: HTMLIFrameElement | null = null

// ★样式值用「字符串」而非对象：MP WXML 的 style 属性是纯字符串，`style="{{obj}}"` 会渲染成
//   `[object Object]`（无效 CSS → 元素塌陷，占位/iframe 容器不可见）——字符串两端通用（Vue :style 亦接受字符串）。
const hostStyle = computed(() => (props.height > 0 ? `height:${props.height}px` : 'height:100%'))

function ensureFrame(): void {
  if (isMp.value) return
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
  if (!isMp.value) ensureFrame()
})

watch(
  () => props.src,
  () => {
    if (!isMp.value) ensureFrame()
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
.p-webview__hint {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  text-align: center;
  font-size: 13px;
  line-height: 1.6;
  color: var(--p-text-color-3, #86909c);
  background: var(--p-fill-color, rgba(0, 0, 0, 0.03));
}
</style>
