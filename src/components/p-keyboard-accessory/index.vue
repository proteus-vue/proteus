<!-- src/components/p-keyboard-accessory/index.vue —— 键盘上方工具栏（★权威标尺批 H：shell.keyboard-accessory · 对齐小程序 <keyboard-accessory>）
     语义：input/textarea 聚焦时，在键盘上方悬浮一条工具栏（内放按钮/图标）。
     MP 端：原生 <keyboard-accessory>（WebView）承接；Web 端：visualViewport 读数驱动（键盘弹出时吸底）。
     视图最大高度 200px（对齐官方约束）。
     /* components-allow-platform: 键盘高度读数依赖 visualViewport（Web 专属）；MP 端由原生 keyboard-accessory 承接，本逻辑不执行 */ -->
<template>
  <div
    class="p-keyboard-accessory"
    :class="{ 'p-keyboard-accessory--visible': visible }"
    :style="rootStyle"
    :aria-hidden="!visible"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 是否可见（受控；不传则由键盘高度自动判定） */
  visible: { type: Boolean, default: undefined as unknown as boolean },
  /** 工具栏最大高度 px（对齐官方 200px 上限） */
  maxHeight: { type: Number, default: 200 },
  /** 背景色（缺省白） */
  background: { type: String, default: '' },
})

const autoVisible = ref(false)
const keyboardHeight = ref(0)

let vv: { height?: number; addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void } | undefined
let baseHeight = 0
let onResize: (() => void) | undefined

onMounted(() => {
  // components-allow-platform: Web visualViewport 键盘读数；MP 无 visualViewport → 恒不可见（由原生组件承接）
  const g = globalThis as { visualViewport?: typeof vv; innerHeight?: number }
  vv = g.visualViewport
  baseHeight = g.innerHeight ?? 0
  if (vv && typeof vv.addEventListener === 'function') {
    onResize = () => {
      const vh = vv?.height ?? 0
      const visibleNow = vh > 0 && baseHeight > 0 && vh < baseHeight * 0.6
      keyboardHeight.value = visibleNow ? Math.max(0, baseHeight - vh) : 0
      autoVisible.value = visibleNow
    }
    vv.addEventListener('resize', onResize)
    onResize()
  }
})

onUnmounted(() => {
  if (vv && onResize && typeof vv.removeEventListener === 'function') vv.removeEventListener('resize', onResize)
})

const isVisible = computed(() => (props.visible === undefined ? autoVisible.value : props.visible))

const rootStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    position: 'fixed',
    left: '0',
    right: '0',
    bottom: keyboardHeight.value + 'px',
    maxHeight: props.maxHeight + 'px',
    boxSizing: 'border-box',
    overflow: 'hidden',
    zIndex: 1000,
  }
  if (props.background) style.background = props.background
  return style
})
</script>

<style scoped>
.p-keyboard-accessory {
  display: none;
  border-top: 1px solid var(--p-border-color, rgba(0, 0, 0, 0.08));
  background: var(--p-bg-color, #fff);
  padding: 6px 12px;
}
.p-keyboard-accessory--visible {
  display: block;
}
</style>
