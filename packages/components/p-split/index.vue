<!-- src/components/p-split/index.vue —— 自适应分栏（★Fluid System S1：平板/车机/多窗口核心原语）
     容器宽度 < minSplitWidth → 堆叠（column）；≥ → 并排（row）——按容器而非视口求解
     薄壳引用 @proteus-vue/fluid（createContainerQuery 容器查询运行时）
     ★Skyline 线收口：MP 下经 SelectorQuery 测量容器（运行时测量类），容器响应式真生效（不再恒堆叠）；方法体 as 可剥 -->
<template>
  <div ref="rootEl" class="p-split" :class="['p-split-' + mode, mpCls]" :style="splitStyle">
    <div class="p-split-aside"><slot name="aside" /></div>
    <div class="p-split-main"><slot /></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { CSSProperties } from 'vue'
import { createContainerQuery } from '@proteus-vue/fluid'
import type { FluidContext, SizeObserverFactory } from '@proteus-vue/fluid'
import { mpContainerObserverFactory, measureClass, isMpRuntime } from '../runtime/container-measure'

const props = defineProps({
  /** 容器宽度达到此值 → 并排分栏（px；窄于此 → 堆叠） */
  minSplitWidth: { type: Number, default: 640 },
  /** 分栏/堆叠间距（px） */
  gap: { type: Number, default: 16 },
  /** 设计稿宽度（容器断点推导基准） */
  designWidth: { type: Number, default: 375 },
})

const mode = ref('stacked') // stacked / split
const rootEl = ref<HTMLElement | null>(null)
let query: FluidContext | null = null
// ★Skyline 线收口：MP 无 ResizeObserver → 走 SelectorQuery 测量（运行时测量类不参与 scoped 后缀）
// ★MP 编译安全：探测/工厂在 onMounted 内联计算（顶层 const 调函数会被当 runtimeInit，裸引用不可靠）
const mpCls = ref('')

onMounted(() => {
  const mp = isMpRuntime()
  if (mp) {
    mpCls.value = measureClass('split')
  }
  const factory: SizeObserverFactory | null = mp ? mpContainerObserverFactory('.' + measureClass('split')) : null
  const opts = { designWidth: props.designWidth }
  query = createContainerQuery(rootEl.value ?? ({} as unknown), factory ? { designWidth: opts.designWidth, createObserver: factory } : opts)
  query.subscribe((s) => {
    mode.value = s.width >= props.minSplitWidth ? 'split' : 'stacked'
  })
})
onUnmounted(() => {
  if (query) query.destroy()
  query = null
})

// ★断言放方法体内（MP 编译器剥离方法体 as；CSSProperties 字面量类型）
const splitStyle = computed(() => {
  const style: CSSProperties = {
    display: 'flex',
    flexDirection: (mode.value === 'split' ? 'row' : 'column') as CSSProperties['flexDirection'],
    gap: props.gap + 'px',
  }
  return style as CSSProperties
})
</script>
