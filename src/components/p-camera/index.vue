<!-- src/components/p-camera/index.vue —— 相机（★权威标尺批 I：ui.camera · 对齐小程序 <camera>）
     语义：相机预览 + 拍照。MP 端原生 <camera> 承接；Web 端 getUserMedia + <video> 预览（标准 API）。
     ★v-if 双分支：<camera>（MP 原生）/ <video>（Web 标准）——两端均编译安全（死分支不渲染）。
     /* components-allow-platform: Web 端相机预览依赖 navigator.mediaDevices.getUserMedia（MP 端走原生 <camera> 组件，本逻辑不执行；useCamera() 仅探权限不提供流） */ -->
<template>
  <div class="p-camera" :class="{ 'p-camera--active': active }">
    <!-- MP 原生相机组件 -->
    <camera
      v-if="isMp"
      class="p-camera__el"
      :device-position="devicePosition"
      :flash="flash"
      mode="normal"
      @initdone="onInitDone"
      @error="onError"
    >
      <slot />
    </camera>
    <!-- Web 相机预览（getUserMedia 流） -->
    <video
      v-else
      class="p-camera__el"
      :id="videoId"
      autoplay
      playsinline
      muted
      :style="videoStyle"
    />
    <!-- Web fallback：无摄像头 / 未授权 -->
    <div v-if="!isMp && errorText" class="p-camera__hint">{{ errorText }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { CSSProperties } from 'vue'
import { isMpRuntime } from '../runtime/container-measure'

const props = defineProps({
  /** 摄像头朝向：back 后置 / front 前置（对齐 device-position） */
  devicePosition: { type: String, default: 'back' },
  /** 闪光灯：auto / on / off（对齐 flash） */
  flash: { type: String, default: 'auto' },
  /** 预览宽高比（padding-top 百分比；缺省 4:3） */
  aspectRatio: { type: Number, default: 4 / 3 },
})

const emit = defineEmits(['initdone', 'error', 'ready'])

// ★★真机 bug 修复（2026-09-12）：`isMpRuntime()` 直接调用 → 编译器归 runtimeInit 实例属性（this.isMp），
//   模板只能读 data → wx:if="{{isMp}}" 恒 false → MP 端错走 <video> Web 分支（真机渲染成 video 组件）。
//   改 computed：编译产物 = attached() { this.data.isMp = isMpRuntime(); setData(...) }（首帧前写入 data ✓）。
const isMp = computed(() => isMpRuntime())
const active = ref(false)
const errorText = ref('')
const videoId = 'p-camera-' + Math.random().toString(36).slice(2, 8)

const videoStyle = computed<CSSProperties>(() => ({
  width: '100%',
  display: 'block',
  aspectRatio: String(props.aspectRatio),
  objectFit: 'cover',
}))

let stream: { getTracks(): Array<{ stop(): void }> } | null = null

function stopStream(): void {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
}

async function startWebPreview(): Promise<void> {
  // components-allow-platform: Web getUserMedia 预览（MP 端走原生 <camera>，本分支不执行）
  const nav = (globalThis as { navigator?: { mediaDevices?: { getUserMedia?: (c: Record<string, unknown>) => Promise<unknown> } } }).navigator
  const gum = nav?.mediaDevices?.getUserMedia
  if (typeof gum !== 'function') {
    errorText.value = '当前环境无摄像头 API'
    emit('error', { message: 'mediaDevices.getUserMedia unavailable' })
    return
  }
  try {
    const s = (await gum({ video: { facingMode: props.devicePosition === 'front' ? 'user' : 'environment' } })) as { getTracks(): Array<{ stop(): void }> }
    stream = s
    const doc = (globalThis as { document?: Document }).document
    const el = doc?.getElementById?.(videoId) as (HTMLVideoElement & { srcObject?: unknown }) | null
    if (el) el.srcObject = s as unknown as MediaProvider
    active.value = true
    emit('ready', { kind: 'camera', supported: true, granted: true })
  } catch (e) {
    errorText.value = '相机未授权或不可用'
    emit('error', { message: e instanceof Error ? e.message : 'getUserMedia failed' })
  }
}

function onInitDone(): void {
  active.value = true
  emit('initdone')
}

function onError(e: unknown): void {
  emit('error', e)
}

onMounted(() => {
  if (!isMp.value) void startWebPreview()
})

onUnmounted(() => {
  stopStream()
})

defineExpose({ isActive: () => active.value, stop: stopStream })
</script>

<style scoped>
.p-camera {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 8px;
  background: #000;
}
.p-camera__el {
  width: 100%;
  display: block;
}
.p-camera__hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 13px;
  background: rgba(0, 0, 0, 0.6);
}
</style>
