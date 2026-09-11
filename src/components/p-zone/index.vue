<!-- src/components/p-zone/index.vue —— 容器断点分区（★Fluid System S1：容器级响应式渲染不同子布局）
     容器断点（sm/md/lg/xl，按容器宽度非视口）→ 渲染对应命名槽（sm/md/lg/xl；缺省 xl 槽兜底）
     薄壳引用 @proteus-vue/fluid（createContainerQuery）
     ★Skyline 线收口：MP 下经 SelectorQuery 测量容器（运行时测量类），容器断点真生效 -->
<template>
  <div ref="rootEl" class="p-zone" :class="['p-zone-' + bp, mpCls]">
    <slot v-if="bp === 'sm'" name="sm" />
    <slot v-else-if="bp === 'md'" name="md" />
    <slot v-else-if="bp === 'lg'" name="lg" />
    <slot v-else name="xl" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { createContainerQuery } from '@proteus-vue/fluid'
import type { FluidContext, SizeObserverFactory } from '@proteus-vue/fluid'
import { mpContainerObserverFactory, measureClass, isMpRuntime } from '../runtime/container-measure'

const props = defineProps({
  /** 设计稿宽度（容器断点推导基准；缺省 375） */
  designWidth: { type: Number, default: 375 },
})

const bp = ref('sm') // sm/md/lg/xl（容器级断点）
const rootEl = ref<HTMLElement | null>(null)
let query: FluidContext | null = null
// ★Skyline 线收口：MP 无 ResizeObserver → SelectorQuery 测量（onMounted 内联计算，MP 编译安全）
const mpCls = ref('')

onMounted(() => {
  const mp = isMpRuntime()
  if (mp) mpCls.value = measureClass('zone')
  const factory: SizeObserverFactory | null = mp ? mpContainerObserverFactory('.' + measureClass('zone')) : null
  query = createContainerQuery(rootEl.value ?? ({} as unknown), factory ? { designWidth: props.designWidth, createObserver: factory } : { designWidth: props.designWidth })
  query.subscribe((s) => {
    bp.value = s.breakpoint
  })
})
onUnmounted(() => {
  if (query) query.destroy()
  query = null
})
</script>
