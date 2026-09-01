<!-- src/components/p-modal/index.vue —— 弹窗（★adaptive-container-plan B4：p-adaptive 形态能力并入）
     一次声明：<p-modal v-model:visible p-adaptive="sheet(0,600) | dialog(600,840) | popover(840,∞)">
     视口宽度 → 形态自动切换（手机 Sheet 底部滑入 / 平板 Dialog 居中 / 桌面 Popover 居中降级——03 §6）
     内部布局用 p-stack/p-grid 柔性原语（FLD010：禁硬编码固定宽度）；sheet 形态自动应用底部安全区（G-09 协同）
     MP：逻辑层无 innerWidth → 形态恒首区间（sheet 兜底——手机主场景，渲染端自决）
     与 App 端 B3 原生容器（UISheet/BottomSheet/SideBarContainer）同语义 -->
<template>
  <view v-if="shown" class="p-modal">
    <view class="p-modal-mask" :style="maskStyle" @click="onMaskTap" />
    <view class="p-modal-panel" :class="panelClass" :style="panelStyle">
      <view v-if="title || closable" class="p-modal-header">
        <text v-if="title" class="p-modal-title">{{ title }}</text>
        <text v-if="closable" class="p-modal-close" @click="onCloseTap">✕</text>
      </view>
      <view class="p-modal-body">
        <slot name="header" />
        <slot />
        <slot name="footer" />
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { CSSProperties } from 'vue'
import { createSizeAwareObserver, computeAdaptiveForm, parseAdaptiveExpression, resolveAdaptiveFormStyle } from '@proteus-vue/fluid'
import type { SizeAwareObserver, AdaptiveVariant } from '@proteus-vue/fluid'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 弹窗可见（v-model:visible） */
  visible: { type: Boolean, default: false },
  /** 形态区间表达式（缺省手机 Sheet → 平板 Dialog → 桌面 Popover） */
  adaptive: { type: String, default: 'sheet(0, 600) | dialog(600, 840) | popover(840, ∞)' },
  /** 标题（header slot 存在时优先） */
  title: { type: String, default: '' },
  /** 右上角关闭按钮 */
  closable: { type: Boolean, default: true },
  /** 点击遮罩关闭 */
  maskClosable: { type: Boolean, default: true },
  /** 遮罩透明度 */
  maskOpacity: { type: Number, default: 0.5 },
})

const emit = defineEmits(['update:visible'])

const shown = ref(false)
const form = ref('sheet')
let aware: SizeAwareObserver | null = null

// ★解析形态区间（组件初始化一次；空 → sheet 兜底）
const variants = computed<AdaptiveVariant[]>(() => {
  const modes = parseAdaptiveExpression(props.adaptive)
  return modes.length ? modes : [{ form: 'sheet', lo: 0, hi: Infinity }]
})

watch(() => props.visible, () => {
  shown.value = props.visible
})

onMounted(() => {
  // 初始可见性（Web onMounted / MP attached 同步初始态——watch 无 immediate 不触发初始值）
  shown.value = props.visible
  // ★视口宽度 → 形态（弹窗 fixed 覆盖全屏，容器 = 视口；globalThis.innerWidth 在 fluid 包内读取——组件审计 no-platform-api）
  aware = createSizeAwareObserver(null, {})
  aware.subscribe((s) => {
    const f = computeAdaptiveForm(variants.value, s.viewportWidth)
    if (f) form.value = f
  })
})
onUnmounted(() => {
  if (aware) aware.destroy()
  aware = null
})

function onMaskTap(): void {
  if (props.maskClosable) emit('update:visible', false)
}
function onCloseTap(): void {
  emit('update:visible', false)
}

// ★断言放方法体内（MP 编译器剥离方法体 as；字符串拼接满足 class/CSSProperties 字面量类型）
const panelClass = computed(() => 'p-modal-panel--' + form.value)

const maskStyle = computed(() => {
  const style: CSSProperties = { opacity: String(props.maskOpacity) }
  return style as CSSProperties
})

const panelStyle = computed(() => {
  const base = resolveAdaptiveFormStyle(form.value)
  const style: Record<string, string> = {}
  for (const k of Object.keys(base)) style[k] = base[k]
  // ★G-09 协同：sheet 底部自动避让 Home Indicator（开发者无需手动 env()）
  if (form.value === 'sheet') style.paddingBottom = 'env(safe-area-inset-bottom, 0px)'
  return style as CSSProperties
})
</script>

<style scoped>
.p-modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  background: #000;
}
.p-modal-panel {
  position: fixed;
  z-index: 1001;
  background: #fff;
  border-radius: 12px;
  max-width: 480px;
  width: 92%;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}
.p-modal-panel--sheet {
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  max-width: none;
  border-radius: 12px 12px 0 0;
  max-height: 80vh;
  overflow: auto;
}
.p-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 0;
}
.p-modal-title {
  font-size: 16px;
  font-weight: 600;
}
.p-modal-close {
  color: #999;
  font-size: 16px;
  padding: 2px 6px;
}
.p-modal-body {
  padding: 16px;
}
/* 转场（enter 自动播放；visible=false 直接隐藏） */
.p-modal-panel--enter {
  animation: proteus-modal-in 280ms ease-out;
}
@keyframes proteus-modal-in {
  from { opacity: 0; transform: translateY(24px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
