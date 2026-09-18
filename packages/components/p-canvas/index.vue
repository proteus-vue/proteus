<!-- packages/components/p-canvas/index.vue —— 画布（★G-32 B2：ui.canvas U8）
     engine 2d/webgl/skia（语义等价官方 <canvas type>，经 audit SEMANTIC_ALIAS_BY_TAG 归一）+ resolution 分辨率感知。
     ★端对齐批次3（2026-09-16）：补官方剩余属性 canvas-id / disable-scroll——
       canvas-id 为画布唯一标识（建立 CanvasContext 的句柄，指定 type 后可省）；disable-scroll 阻止画布手势期间的页面滚动。
     ★双端实现：MP 端原生 <canvas>（同层渲染；type=engine 决定 2d/webgl 上下文）；
       Web 端 <canvas> 元素（context 经 engine 映射、canvas-id → DOM id、disable-scroll → touch-action:none）。
       共用同一语义属性面，不重复实现绘制逻辑（帧渲染属能力批次 getCanvasContext）。 -->
<template>
  <view class="p-canvas" :style="canvasStyle">
    <canvas
      v-if="isMp"
      class="p-canvas-el"
      :type="mpCanvasType"
      :canvas-id="resolvedId"
      :id="resolvedId"
      :disable-scroll="disableScroll"
    />
    <canvas
      v-else
      class="p-canvas-el"
      :id="resolvedId"
      :width="pixelWidth"
      :height="pixelHeight"
      :style="webCanvasStyle"
    />
    <slot />
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
import { isMpRuntime } from '../runtime/container-measure'

const props = defineProps({
  /** 渲染引擎：2d / webgl / skia（★语义等价官方 <canvas type>；skia 非原生 canvas 类型 → MP 回落 2d） */
  engine: { type: String, default: '2d' },
  /** 画布唯一标识（★官方 canvas-id：CanvasContext 句柄；缺省按组件实例生成，保证唯一） */
  canvasId: { type: String, default: '' },
  /** 画布中移动且有绑定手势事件时禁止页面滚动/下拉刷新（★官方 disable-scroll） */
  disableScroll: { type: Boolean, default: false },
  /** CSS 宽 px（0=自适应） */
  width: { type: Number, default: 300 },
  /** CSS 高 px（0=自适应） */
  height: { type: Number, default: 150 },
  /** 分辨率倍率（>1 高清渲染；canvas 内部分辨率 = CSS × 倍率） */
  resolution: { type: Number, default: 1 },
})

const isMp = computed(() => isMpRuntime())
const autoId = 'p-canvas-' + Math.random().toString(36).slice(2, 8)
/** 官方 canvas-id：显式传入优先，否则组件自生成（避免多实例同 id 互相顶替） */
const resolvedId = computed(() => props.canvasId || autoId)
/** 官方 <canvas type> 仅支持 2d / webgl（skia 是框架扩展引擎 → MP 端回落 2d） */
const mpCanvasType = computed(() => (props.engine === 'webgl' ? 'webgl' : '2d'))

const pixelWidth = computed(() => Math.max(1, Math.round(props.width * props.resolution)))
const pixelHeight = computed(() => Math.max(1, Math.round(props.height * props.resolution)))

const canvasStyle = computed(() => {
  const style: CSSProperties = {
    width: props.width + 'px',
    height: props.height + 'px',
  }
  return style as CSSProperties
})

/** Web：disable-scroll → touch-action:none（与 MP「画布手势期间不滚页面」同语义） */
const webCanvasStyle = computed<CSSProperties>(() =>
  props.disableScroll ? { display: 'block', touchAction: 'none' } : { display: 'block' },
)

defineExpose({ canvasId: () => resolvedId.value })
</script>

<style scoped>
.p-canvas {
  display: inline-block;
  background: #f7f8fa;
  border-radius: 4px;
  overflow: hidden;
}
.p-canvas-el {
  display: block;
}
</style>
