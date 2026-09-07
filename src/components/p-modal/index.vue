<!-- src/components/p-modal/index.vue —— 弹窗（★adaptive-container-plan B4：p-adaptive 形态能力并入）
     一次声明：<p-modal v-model:visible p-adaptive="sheet(0,600) | dialog(600,840) | popover(840,∞)" :anchor="triggerRef">
     视口宽度 → 形态自动切换（手机 Sheet 底部滑入 / 平板 Dialog 居中 / 桌面 Popover 锚定 anchor——无 anchor 居中降级，03 §6）
     ★width 覆盖：>0 时形态求解用指定宽度（预览/验证/测试不同窗口大小）；0 = 跟随视口（拖窗口实时 reflow）
     内部布局用 p-stack/p-grid 柔性原语（FLD010：禁硬编码固定宽度）；sheet 形态自动应用底部安全区（G-09 协同）
     MP：逻辑层无 innerWidth → 形态恒首区间（sheet 兜底——手机主场景，渲染端自决）
     与 App 端 B3 原生容器（UISheet/BottomSheet/SideBarContainer）同语义 -->
<template>
  <view v-if="shown" class="p-modal">
    <view class="p-modal-mask" @click="onMaskTap" />
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
import { createSizeAwareObserver, computeAdaptiveForm, parseAdaptiveExpression, resolveAdaptiveFormStyle } from '@proteus-vue/fluid'
import type { SizeAwareObserver, AdaptiveVariant } from '@proteus-vue/fluid'

// 对象形式 defineProps（编译器静态提取；MP 安全）——★pAdaptive camel prop：模板 p-adaptive="..." attr 经 Vue camelize 匹配（标准映射）
const props = defineProps({
  /** 弹窗可见（v-model:visible） */
  visible: { type: Boolean, default: false },
  /** ★形态区间声明：模板写 p-adaptive="sheet(0, 600) | dialog(600, 840) | popover(840, ∞)"（计划 API）→ pAdaptive prop */
  pAdaptive: { type: String, default: 'sheet(0, 600) | dialog(600, 840) | popover(840, ∞)' },
  /** popover 形态锚定触发源（元素引用；缺省 → popover 居中降级，03 §6 降级链） */
  anchor: { type: Object, default: null },
  /** 形态求解宽度覆盖（0 = 跟随视口；>0 = 强制指定——预览/验证/测试不同窗口大小） */
  width: { type: Number, default: 0 },
  /** 标题（header slot 存在时优先） */
  title: { type: String, default: '' },
  /** 右上角关闭按钮 */
  closable: { type: Boolean, default: true },
  /** 点击遮罩关闭 */
  maskClosable: { type: Boolean, default: true },
  /** 遮罩透明度 */
  maskOpacity: { type: Number, default: 0.5 },
})

const emit = defineEmits(['update:visible', 'formChange'])

const shown = ref(false)
const form = ref('sheet')
let aware: SizeAwareObserver | null = null

// ★解析形态区间（组件初始化一次；空 → sheet 兜底）——pAdaptive 由模板 p-adaptive attr camelize 匹配
// ★#502 兜底 hi 用 MAX_SAFE_INTEGER（JSON 安全——结果进小程序 data，Infinity 会被 setData 序列化约束整次放弃）
const variants = computed<AdaptiveVariant[]>(() => {
  const modes = parseAdaptiveExpression(props.pAdaptive)
  return modes.length ? modes : [{ form: 'sheet', lo: 0, hi: Number.MAX_SAFE_INTEGER }]
})

watch(() => props.visible, () => {
  shown.value = props.visible
})

// ★width 覆盖切换（预设宽度按钮/测试）→ 重新求解形态
watch(() => props.width, (w) => {
  if (w > 0) applyForm(computeAdaptiveForm(variants.value, w))
})

function applyForm(f: string | null): void {
  const next = f || 'sheet'
  if (next !== form.value) {
    form.value = next
    emit('formChange', next)
  }
}

onMounted(() => {
  // 初始可见性（Web onMounted / MP attached 同步初始态——watch 无 immediate 不触发初始值）
  shown.value = props.visible
  if (props.width > 0) {
    // ★width 覆盖：直接求解（不监听视口——验证/预览固定宽度）
    applyForm(computeAdaptiveForm(variants.value, props.width))
    return
  }
  // ★视口宽度 → 形态（弹窗 fixed 覆盖全屏，容器 = 视口；globalThis.innerWidth 在 fluid 包内读取——组件审计 no-platform-api）
  aware = createSizeAwareObserver(null, {})
  aware.subscribe((s) => {
    applyForm(computeAdaptiveForm(variants.value, s.viewportWidth))
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

/** popover 锚定定位：anchor 下方弹出（无 anchor / 无 rect → 空 = 走居中降级） */
function computeAnchorStyle(anchor: unknown): Record<string, string> {
  const el = anchor as { getBoundingClientRect?: () => { left: number; top: number; width: number; height: number; bottom?: number } } | null
  if (!el || typeof el.getBoundingClientRect !== 'function') return {}
  try {
    const rect = el.getBoundingClientRect()
    // ★bottom 用 top + height 推导（fake/部分实现可能无 bottom 字段）
    const bottom = typeof rect.bottom === 'number' ? rect.bottom : rect.top + (rect.height || 0)
    return { position: 'fixed', left: rect.left + 'px', top: bottom + 8 + 'px' }
  } catch {
    return {}
  }
}

// ★断言放方法体内（MP 编译器剥离方法体 as）
// ★2026-09-07 布局专项：panel 形态类（--sheet/--dialog/--popover）声明在非 scoped 全局 style 块——
//   动态 :class="{{panelClass}}" 在 MP 产物无法加 scoped 后缀（wxss .xxx-data-v 失配 → sheet 底部定位丢失
//   → 面板落左上/中上）；全局类名唯一（p-modal-panel--*），Web 端同命中。panelStyle（inline）保留兜底。
const panelClass = computed(() => 'p-modal-panel--' + form.value)

const panelStyle = computed(() => {
  const style: Record<string, string> = {}
  // ★popover + anchor → 锚定（anchor 下方）；否则 resolveAdaptiveFormStyle（sheet 底部 / dialog·popover 居中）
  if (form.value === 'popover' && props.anchor) {
    const anchored = computeAnchorStyle(props.anchor)
    if (anchored.position) {
      return anchored as Record<string, string>
    }
  }
  const base = resolveAdaptiveFormStyle(form.value)
  for (const k of Object.keys(base)) style[k] = base[k]
  // ★G-09 协同：sheet 底部自动避让 Home Indicator（开发者无需手动 env()）
  if (form.value === 'sheet') {
    style.paddingBottom = 'env(safe-area-inset-bottom, 0px)'
    // ★#500 sheet 形态关键样式内联（动态 :class 在 MP 无法 scoped 后缀——面板定位不依赖类名，双端一致）
    style.width = '100%'
    style.maxWidth = 'none'
    style.borderRadius = '12px 12px 0px 0px'
    style.maxHeight = '80vh'
  }
  return style as Record<string, string>
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
  /* ★2026-09-07 布局专项：静态半透明（不依赖动态 style——MP 产物动态 style 若失效则全黑不透明）
     maskOpacity prop 保留（默认 0.5）；自定义透明度在产物层不再单独输出（登记：需求出现再恢复 Web inline） */
  background: rgba(0, 0, 0, 0.5);
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

<!-- ★2026-09-07 布局专项：形态类全局声明（global 非 scoped）——MP 动态 :class={{panelClass}} 无法带 scoped 后缀，
     类名全局唯一即可；scoped 段保留静态类（p-modal-panel/mask/header… 模板字面量可加后缀） -->
<style global>
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
</style>
