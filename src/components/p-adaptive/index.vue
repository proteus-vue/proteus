<!-- src/components/p-adaptive/index.vue —— 容器形态自适应（★adaptive-container-plan B2：Web 拖窗口实时 reflow）
     只声明「形态区间」：容器宽度 → sheet/dialog/popover 自动切换（computeAdaptiveForm 求解，B1 纯逻辑）
     Web 端形态层样式由 resolveAdaptiveFormStyle 提供（sheet 底部全宽 / dialog·popover 居中降级——03 §6 降级链）
     ★visible 控制形态层渲染（v-model 风格）；MP：无 ResizeObserver → 形态恒首区间兜底（渲染端自决）
     ★与 App 端 B3 原生容器（UISheet/BottomSheet/SideBarContainer）同语义：开发者只写形态区间 -->
<template>
  <div ref="wrapEl" class="p-adaptive">
    <div v-if="visible" class="p-adaptive-form" :class="'p-adaptive-' + form" :style="formStyle">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { CSSProperties } from 'vue'
import { createAdaptiveController, resolveAdaptiveFormStyle, parseAdaptiveExpression } from '@proteus-vue/fluid'
import type { AdaptiveController, AdaptiveVariant } from '@proteus-vue/fluid'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 形态区间表达式：`sheet(0, 600) | dialog(600, 840) | popover(840, ∞)` */
  modes: { type: String, default: '' },
  /** 形态层是否渲染（false → 不渲染） */
  visible: { type: Boolean, default: true },
})

const emit = defineEmits(['update:visible', 'formChange'])

const wrapEl = ref<HTMLElement | null>(null)
const form = ref('sheet')
let controller: AdaptiveController | null = null

// ★解析区间（组件初始化一次；空 → sheet 兜底）
const variants = computed<AdaptiveVariant[]>(() => {
  const modes = parseAdaptiveExpression(props.modes)
  return modes.length ? modes : [{ form: 'sheet', lo: 0, hi: Infinity }]
})

onMounted(() => {
  if (!wrapEl.value) return // MP/无 ResizeObserver：形态恒首区间兜底
  controller = createAdaptiveController(wrapEl.value, { modes: variants.value })
  controller.subscribe((s) => {
    if (s.form && s.form !== form.value) {
      form.value = s.form
      emit('formChange', s.form)
    }
  })
})
onUnmounted(() => {
  if (controller) controller.destroy()
  controller = null
})

// ★断言放方法体内（MP 编译器剥离方法体 as；纯函数解析 → CSSProperties 字面量类型）
const formStyle = computed(() => {
  const style = resolveAdaptiveFormStyle(form.value)
  return style as CSSProperties
})
</script>
