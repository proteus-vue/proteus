<!-- packages/components/p-draggable/index.vue —— 可拖拽/可缩放元素（★G-32 B4 ④ Gesture：gesture.draggable G8）
     语义：把一个元素约束在容器内自由移动（可选缩放），支持惯性/阻尼/边界回弹/网格吸附。
     ★端对齐批次3（2026-09-16）：由「Web-only 手势组件」升级为**双端同语义**——
       · MP 端：原生 <movable-area> + <movable-view>（官方即此能力本体；官方 13 属性全量透传，
         direction/inertia/out-of-bounds/x/y/damping/friction/disabled/scale/scale-min/scale-max/scale-value/animation
         + movable-area 的 scale-area）。此前 MP 端为「元素静态 + 告警」，属真实能力缺口，本轮补齐。
       · Web 端：Pointer Events 手势识别（既有 useGesture 路径）+ 同一属性面语义等价表达。
     ★事件契约（跨端同名）：change（{x,y,source}）/ scale（{x,y,scale}）/ drag / drop。 -->
<template>
  <view class="p-draggable-root">
    <!-- MP：原生 movable-area（约束容器）+ movable-view（被拖动元素） -->
    <template v-if="isMp">
      <movable-area class="p-draggable-area" :scale-area="scaleArea">
        <movable-view
          class="p-draggable-view"
          :direction="direction"
          :inertia="inertia"
          :out-of-bounds="outOfBounds"
          :x="x"
          :y="y"
          :damping="damping"
          :friction="friction"
          :disabled="disabled"
          :scale="scaleEnabled"
          :scale-min="scaleMin"
          :scale-max="scaleMax"
          :scale-value="scaleValue"
          :animation="animation"
          @change="onMpChange"
          @scale="onMpScale"
        >
          <slot />
        </movable-view>
      </movable-area>
    </template>
    <!-- Web：Pointer 手势（保留既有实现）——★用原生 <div> 而非中性标签：
         手势经 useGesture 绑定 Pointer Events 到真实 DOM 元素（<view> 会被改写为 proteus-view 组件，
         拿到的不是元素，bind 失效）。本分支 v-else 平台死分支，MP 端不渲染。
         ★元素经 id + getElementById 获取（同 p-camera/p-webview：模板 ref 绑 DOM 元素在 MP 端
         带类型实参会告警，id 方案两端安全）。 -->
    <div
      v-else
      :id="elId"
      class="p-draggable"
      :class="{ 'p-draggable-ghost': ghost && dragging }"
      :style="dragStyle"
    >
      <slot />
    </div>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { CSSProperties } from 'vue'
import { useGesture } from '@proteus-vue/gesture'
import { isMpRuntime } from '../runtime/container-measure'

interface PanPayload {
  type: string
  dx?: number
  dy?: number
  x?: number
  y?: number
}

const props = defineProps({
  /** 移动方向：all / vertical / horizontal / none（★官方 direction） */
  direction: { type: String, default: 'none' },
  /** 是否带惯性（★官方 inertia） */
  inertia: { type: Boolean, default: false },
  /** 超过可移动区域后是否仍可移动（回弹，★官方 out-of-bounds） */
  outOfBounds: { type: Boolean, default: false },
  /** x 轴偏移（★官方 x；改变触发动画） */
  x: { type: [Number, String], default: 0 },
  /** y 轴偏移（★官方 y） */
  y: { type: [Number, String], default: 0 },
  /** 阻尼系数（越大移动越快，★官方 damping，默认 20） */
  damping: { type: Number, default: 20 },
  /** 摩擦系数（必须 >0，★官方 friction，默认 2） */
  friction: { type: Number, default: 2 },
  /** 是否禁用（★官方 disabled） */
  disabled: { type: Boolean, default: false },
  /** 是否支持双指缩放（★官方 scale；入参 scale 为官方保留属性名，框架侧用 scaleEnabled 避免与数值 scaleValue 混淆） */
  scaleEnabled: { type: Boolean, default: false },
  /** 缩放倍数最小值（★官方 scale-min，默认 0.1） */
  scaleMin: { type: Number, default: 0.1 },
  /** 缩放倍数最大值（★官方 scale-max，默认 10） */
  scaleMax: { type: Number, default: 10 },
  /** 缩放倍数（取值范围 0.1–10，★官方 scale-value） */
  scaleValue: { type: Number, default: 1 },
  /** 是否使用动画（★官方 animation） */
  animation: { type: Boolean, default: true },
  /** 缩放手势生效区域是否扩展到 movable-area（★官方 movable-area scale-area） */
  scaleArea: { type: Boolean, default: false },
  /** 拖拽拖影（半透明跟随；Web） */
  ghost: { type: Boolean, default: false },
  /** 网格吸附步长 px（0=自由拖拽；Web） */
  snapToGrid: { type: Number, default: 0 },
})

// ★事件名与 MP 原生 bind:<name> 对齐（跨端同名契约）
const emit = defineEmits(['change', 'scale', 'drag', 'drop'])

const isMp = computed(() => isMpRuntime())
const elId = 'p-draggable-' + Math.random().toString(36).slice(2, 8)
const dx = ref(0)
const dy = ref(0)
const dragging = ref(false)
const baseX = ref(0)
const baseY = ref(0)
let gesture: { bind: (e: HTMLElement | null) => void; unbind: () => void } | null = null

/** Web：叠加手势位移与受控 x/y 初值（MP 端同样以 x/y 为初始位置，语义一致） */
const startX = computed(() => Number(props.x) || 0)
const startY = computed(() => Number(props.y) || 0)

/** Web 元素经 id 获取（同 p-camera/p-webview 的 MP-safe 方案） */
function findEl(): HTMLElement | null {
  // components-allow-platform: Web 端元素查找（MP 端走原生 movable-view，本分支不执行）
  const doc = (globalThis as { document?: Document }).document
  return (doc?.getElementById?.(elId) as HTMLElement | null) ?? null
}

function bindGesture(): void {
  if (isMp.value || gesture) return
  gesture = useGesture({ pan: onPan })
  gesture.bind(findEl())
}

onMounted(() => {
  // MP 端由原生 movable-view 承接（无需手势识别器）；Web 端绑定 Pointer 手势
  bindGesture()
})

onUnmounted(() => {
  gesture?.unbind()
  gesture = null
})

// ★函数声明（MP 编译器剥参数类型安全；对象字面量内箭头+类型标注会炸）
function onPan(e: PanPayload): void {
  if (e.type === 'pan-start') {
    dragging.value = true
    baseX.value = dx.value
    baseY.value = dy.value
  } else if (e.type === 'pan-move') {
    let nx = baseX.value + (e.dx ?? 0)
    let ny = baseY.value + (e.dy ?? 0)
    if (props.snapToGrid > 0) {
      nx = Math.round(nx / props.snapToGrid) * props.snapToGrid
      ny = Math.round(ny / props.snapToGrid) * props.snapToGrid
    }
    dx.value = nx
    dy.value = ny
    emit('drag', { x: nx, y: ny })
    emit('change', { x: nx, y: ny, source: 'touch' })
  } else if (e.type === 'pan-end') {
    dragging.value = false
    emit('drop', { x: dx.value, y: dy.value })
  }
}

/** MP 原生 movable-view 拖动（官方 e.detail = {x, y, source}）——载荷归一为裸对象（跨端父级读 e.detail.*） */
function onMpChange(e: unknown): void {
  const d = normalizeDetail(e)
  emit('change', d)
  emit('drag', { x: (d as { x?: number }).x ?? 0, y: (d as { y?: number }).y ?? 0 })
}
function onMpScale(e: unknown): void {
  emit('scale', normalizeDetail(e))
}

function normalizeDetail(e: unknown): unknown {
  const p = e as { detail?: unknown }
  return p && typeof p === 'object' && 'detail' in p ? p.detail : e
}

const dragStyle = computed(() => {
  const style: CSSProperties = {
    transform: 'translate(' + (startX.value + dx.value) + 'px, ' + (startY.value + dy.value) + 'px)',
    position: 'relative',
    touchAction: 'none',
  }
  return style as CSSProperties
})
</script>

<style scoped>
.p-draggable-root {
  display: block;
}
.p-draggable {
  display: inline-block;
  user-select: none;
}
.p-draggable-ghost {
  opacity: 0.6;
}
.p-draggable-area {
  width: 100%;
  height: 100%;
  min-height: 100px;
  overflow: hidden;
  position: relative;
}
</style>
