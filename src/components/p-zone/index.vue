<!-- src/components/p-zone/index.vue —— 容器断点分区（★Fluid System S1：容器级响应式渲染不同子布局）
     容器断点（sm/md/lg/xl，按容器宽度非视口）→ 渲染对应命名槽（sm/md/lg/xl；缺省 xl 槽兜底）
     薄壳引用 @proteus-vue/fluid（createContainerQuery）
     ★MP 安全：泛型 ref 降级（MP 下无 ResizeObserver → 恒 sm 槽） -->
<template>
  <div ref="rootEl" class="p-zone" :class="'p-zone-' + bp">
    <slot v-if="bp === 'sm'" name="sm" />
    <slot v-else-if="bp === 'md'" name="md" />
    <slot v-else-if="bp === 'lg'" name="lg" />
    <slot v-else name="xl" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { createContainerQuery } from '@proteus-vue/fluid'
import type { FluidContext } from '@proteus-vue/fluid'

const props = defineProps({
  /** 设计稿宽度（容器断点推导基准；缺省 375） */
  designWidth: { type: Number, default: 375 },
})

const bp = ref('sm') // sm/md/lg/xl（容器级断点）
const rootEl = ref<HTMLElement | null>(null)
let query: FluidContext | null = null

onMounted(() => {
  if (!rootEl.value) return // MP/无 ResizeObserver：恒 sm 槽
  query = createContainerQuery(rootEl.value, { designWidth: props.designWidth })
  query.subscribe((s) => {
    bp.value = s.breakpoint
  })
})
onUnmounted(() => {
  if (query) query.destroy()
  query = null
})
</script>
