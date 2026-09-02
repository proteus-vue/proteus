<!-- src/components/p-draggable/index.vue —— 可拖拽元素（★G-32 B4 ④ Gesture：gesture.draggable G8）
     基于 useGesture 的 pan 识别（Web Pointer Events）；ghost 半透明拖影 + snapToGrid 网格吸附 + drag/drop emit
     双端同源码：div → view；MP/原生端识别器映射后续批次（无手势 → 元素静态）
     ★MP 安全：顶层函数调用 const（useGesture({...})）编译成运行时初始化会断——调用移入 onMounted（已验证模式） -->
<template>
  <div ref="el" class="p-draggable" :class="{ 'p-draggable-ghost': ghost && dragging }" :style="dragStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { CSSProperties } from 'vue'
import { useGesture } from '@proteus-vue/gesture'

interface PanPayload {
  type: string
  dx?: number
  dy?: number
  x?: number
  y?: number
}

const props = defineProps({
  /** 拖拽拖影（半透明跟随） */
  ghost: { type: Boolean, default: false },
  /** 网格吸附步长 px（0=自由拖拽） */
  snapToGrid: { type: Number, default: 0 },
})

const emit = defineEmits(['drag', 'drop'])

const el = ref<HTMLElement | null>(null)
const dx = ref(0)
const dy = ref(0)
const dragging = ref(false)
let baseX = 0
let baseY = 0
let gesture: { bind: (e: HTMLElement | null) => void; unbind: () => void } | null = null

onMounted(() => {
  gesture = useGesture({
    pan: onPan,
  })
  gesture.bind(el.value)
})
onUnmounted(() => {
  gesture?.unbind()
  gesture = null
})

// ★函数声明（MP 编译器剥参数类型安全；对象字面量内箭头+类型标注会炸）
function onPan(e: PanPayload): void {
  if (e.type === 'pan-start') {
    dragging.value = true
    baseX = dx.value
    baseY = dy.value
  } else if (e.type === 'pan-move') {
    let nx = baseX + (e.dx ?? 0)
    let ny = baseY + (e.dy ?? 0)
    if (props.snapToGrid > 0) {
      nx = Math.round(nx / props.snapToGrid) * props.snapToGrid
      ny = Math.round(ny / props.snapToGrid) * props.snapToGrid
    }
    dx.value = nx
    dy.value = ny
    emit('drag', { x: nx, y: ny })
  } else if (e.type === 'pan-end') {
    dragging.value = false
    emit('drop', { x: dx.value, y: dy.value })
  }
}

const dragStyle = computed(() => {
  const style: CSSProperties = {
    transform: 'translate(' + dx.value + 'px, ' + dy.value + 'px)',
    position: 'relative',
    touchAction: 'none',
  }
  return style as CSSProperties
})
</script>

<style scoped>
.p-draggable {
  display: inline-block;
  user-select: none;
}
.p-draggable-ghost {
  opacity: 0.6;
}
</style>