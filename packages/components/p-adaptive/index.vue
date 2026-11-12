<!-- src/components/p-adaptive/index.vue —— 容器形态自适应（★adaptive-container-plan B2：Web 拖窗口实时 reflow）
     只声明「形态区间」：容器宽度 → sheet/dialog/popover 自动切换（computeAdaptiveForm 求解，B1 纯逻辑）
     Web 端形态层样式由 resolveAdaptiveFormStyle 提供（sheet 底部全宽 / dialog·popover 居中降级——03 §6 降级链）
     ★visible 控制形态层渲染（v-model 风格）
     ★★2026-11-12（外部 F-42/F-43）：MP 端**不再是「恒首区间兜底」**——改为接 MP 尺寸观察器。
       背景：本组件原先在 onMounted 首行做了「元素为空就直接返回」的守卫，而 MP 逻辑层无 ResizeObserver、
       **模板 ref 也拿不到元素** ⇒ 该守卫必然命中 ⇒ controller 从不创建 ⇒ form 恒 'sheet'、
       modes 等于没写（不是降级，是整段逻辑被跳过）。
       现在：MP 下经 mpContainerObserverFactory（fluid 的 createMpSizeObserverFactory + adapter.measureRect）
       测量容器，与 p-zone/p-split/p-toolbar 同一套范式；含 Skyline 首帧重测 [0,50,120]ms。
     ★与 App 端 B3 原生容器（UISheet/BottomSheet/SideBarContainer）同语义：开发者只写形态区间 -->
<template>
  <!-- ★MP 测量类：运行时绑定类（不参与 scoped 后缀）→ selectorQuery 能命中；Web 下空串无副作用 -->
  <div ref="wrapEl" class="p-adaptive" :class="mpCls">
    <div v-if="visible" class="p-adaptive-form" :class="'p-adaptive-' + form" :style="formStyle">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { CSSProperties } from 'vue'
import { createAdaptiveController, resolveAdaptiveFormStyle, parseAdaptiveExpression } from '@proteus-vue/fluid'
import type { AdaptiveController, AdaptiveVariant, SizeObserverFactory } from '@proteus-vue/fluid'
import { mpContainerObserverFactory, measureClass, isMpRuntime } from '../runtime/container-measure'

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
/** ★MP 测量类（onMounted 内赋值——MP 编译安全的 ref 赋值形态，同 p-zone） */
const mpCls = ref('')
let controller: AdaptiveController | null = null
let unsubscribe: (() => void) | null = null

// ★解析区间（组件初始化一次；空 → sheet 兜底）
const variants = computed<AdaptiveVariant[]>(() => {
  const modes = parseAdaptiveExpression(props.modes)
  return modes.length ? modes : [{ form: 'sheet', lo: 0, hi: Infinity }]
})

onMounted(() => {
  // ★F-42/F-43：不再因「元素为空」提前 return（MP 端模板 ref 恒空 ⇒ 整段逻辑被跳过）。
  //   MP 下取 MP 观察器工厂（非 MP 运行时返回 null ⇒ Web 用默认 ResizeObserver）。
  //   元素照旧传入（Web RO 需要它；MP 工厂不吃它——走 selectorQuery 测量）。
  let factory: SizeObserverFactory | null = null
  if (isMpRuntime()) {
    mpCls.value = measureClass('adaptive')
    factory = mpContainerObserverFactory('.' + measureClass('adaptive'))
  }
  const el = wrapEl.value ?? ({} as unknown)
  controller = createAdaptiveController(
    el,
    factory ? { modes: variants.value, createObserver: factory } : { modes: variants.value },
  )
  unsubscribe = controller.subscribe((s) => {
    if (s.form && s.form !== form.value) {
      form.value = s.form
      emit('formChange', s.form)
    }
  })
})
onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  unsubscribe = null
  if (controller) controller.destroy()
  controller = null
})

// ★断言放方法体内（MP 编译器剥离方法体 as；纯函数解析 → CSSProperties 字面量类型）
const formStyle = computed(() => {
  const style = resolveAdaptiveFormStyle(form.value)
  return style as CSSProperties
})
</script>
