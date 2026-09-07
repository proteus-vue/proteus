<!-- src/components/p-toolbar/index.vue —— 工具栏溢出折叠（★Fluid System S3：车机/平板有限容器宽度）
     导航项超出容器 → 多余项收进「更多」（展开面板）——calcVisibleToolbarItems 纯计算（fluid 包）
     按容器而非视口求解（createContainerQuery）；容器不可测（MP 无 ResizeObserver）→ 不折叠全显示（铁律 G-22.2）
     ★车机：drive-mode / prefers-reduced-motion → no-motion class（CSS 禁用动效） -->
<template>
  <div ref="rootEl" class="p-toolbar" :class="{ 'p-toolbar-no-motion': reducedMotion }">
    <div class="p-toolbar-row">
      <button
        v-for="item in visibleItems"
        :key="itemKey(item)"
        type="button"
        class="p-toolbar-item"
        @click="onSelect(item)"
      >
        {{ itemLabel(item) }}
      </button>
      <button v-if="hasMore" type="button" class="p-toolbar-more" @click="open = !open">
        {{ moreLabel }}<span v-if="hiddenCount > 0" class="p-toolbar-badge">{{ hiddenCount }}</span>
      </button>
    </div>
    <div v-if="open && hasMore" class="p-toolbar-panel">
      <button
        v-for="item in hiddenItems"
        :key="itemKey(item)"
        type="button"
        class="p-toolbar-item"
        @click="onPickHidden(item)"
      >
        {{ itemLabel(item) }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { createContainerQuery, createDeviceEnv, shouldReduceMotion, calcVisibleToolbarItems } from '@proteus-vue/fluid'
import type { FluidContext, DeviceEnv } from '@proteus-vue/fluid'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 导航项（{ key, label }） */
  items: { type: Array, default: () => [] },
  /** 单导航项宽度（px；溢出计算用） */
  itemWidth: { type: Number, default: 80 },
  /** 「更多」按钮宽度（px） */
  moreWidth: { type: Number, default: 48 },
  /** 「更多」文案 */
  moreLabel: { type: String, default: '更多' },
})

const emit = defineEmits(['select'])

const containerWidth = ref(0)
const open = ref(false)
const reducedMotion = ref(false)
const rootEl = ref<HTMLElement | null>(null)
let query: FluidContext | null = null
let env: DeviceEnv | null = null

onMounted(() => {
  if (!rootEl.value) return // MP/无 ResizeObserver：容器宽 0 → 不折叠全显示
  query = createContainerQuery(rootEl.value, {})
  query.subscribe((s) => {
    containerWidth.value = s.width
  })
  env = createDeviceEnv()
  reducedMotion.value = shouldReduceMotion(env.get())
  env.subscribe((s) => {
    reducedMotion.value = shouldReduceMotion(s)
  })
})
onUnmounted(() => {
  if (query) query.destroy()
  query = null
  if (env) env.destroy()
  env = null
})

// 容器不可测（0）→ calcVisibleToolbarItems 返回全量（不折叠——MP 降级「朴素但正确」）
// ★单行表达式体（MP computed 转换按表达式拼接——多行对象参数尾逗号会产生 `}),)` 双逗号 JS 语法错误）
const visibleCount = computed(() => calcVisibleToolbarItems({ count: props.items.length, containerWidth: containerWidth.value, itemWidth: props.itemWidth, moreWidth: props.moreWidth }))

// ★断言放方法体内（MP 编译器剥离方法体 as；简单对象类型无逗号——避免泛型逗号破坏 JS 产物）
function itemKey(item: unknown): string {
  const obj = item as { key?: string }
  return obj.key || ''
}
function itemLabel(item: unknown): string {
  const obj = item as { label?: string }
  return obj.label || ''
}

const visibleItems = computed(() => props.items.slice(0, visibleCount.value))
const hiddenItems = computed(() => props.items.slice(visibleCount.value))
const hasMore = computed(() => hiddenItems.value.length > 0)
const hiddenCount = computed(() => hiddenItems.value.length)

function onPickHidden(item: unknown): void {
  open.value = false
  emit('select', itemKey(item))
}

function onSelect(item: unknown): void {
  emit('select', itemKey(item))
}
</script>

<style scoped>
.p-toolbar-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.p-toolbar-item,
.p-toolbar-more {
  border: 0;
  background: transparent;
  padding: 8px 12px;
  font-size: 14px;
  color: #333;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.p-toolbar-item:active,
.p-toolbar-more:active {
  background: #f0f2f5;
}
.p-toolbar-badge {
  margin-left: 4px;
  font-size: 11px;
  color: #fff;
  background: #ff4d4f;
  border-radius: 8px;
  padding: 0 5px;
}
.p-toolbar-panel {
  position: absolute;
  margin-top: 4px;
  background: #fff;
  border: 1px solid #eee;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  z-index: 20;
}
/* ★drive-mode / prefers-reduced-motion：禁用动效 */
.p-toolbar-no-motion *,
.p-toolbar-no-motion {
  transition: none !important;
  animation: none !important;
}
</style>
