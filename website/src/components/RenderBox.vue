<script setup lang="ts">
// website/src/components/RenderBox.vue —— ★#388 渲染后端输出树可视化（递归）
// 每个 node = 后端真实输出（renderIRTree 产物）的一个视图节点；语义节点（layout.grid 等）带徽标；
// grid 语义的容器真实用 CSS grid auto-fit 渲染——设备宽度变化时 auto-fit 真实重排（容器行为，非截图）
import { computed } from 'vue'
import type { TreeJsonNode } from '../playground/backends'

const props = defineProps({
  node: { type: Object as () => TreeJsonNode, required: true },
  /** 后端主题色（design-tokens color.backend） */
  color: { type: String, default: 'var(--brand)' },
  root: { type: Boolean, default: false },
})

const isGrid = computed(() => props.node.label.includes('grid') || props.node.label.includes('Grid') || props.node.label.includes('list'))
const isText = computed(() => props.node.label.toLowerCase().includes('text') || props.node.label.toLowerCase().includes('label'))
const semantic = computed(() => (props.node.props?.semantic as string) ?? '')
const hasChildren = computed(() => props.node.children.length > 0)
</script>

<template>
  <p-view
    class="rbox"
    :class="{ 'rbox-leaf': !hasChildren, 'rbox-text': isText, 'rbox-grid': isGrid, 'rbox-root': root }"
    :style="{ '--rb-color': color }"
  >
    <p-text class="rbox-label">{{ node.label }}<span v-if="semantic" class="rbox-sem">{{ semantic }}</span></p-text>
    <p-text v-if="node.text && !hasChildren" class="rbox-text-content">{{ node.text }}</p-text>
    <template v-if="isGrid">
      <p-view class="rbox-grid-inner">
        <RenderBox v-for="(c, i) in node.children" :key="i" :node="c" :color="color" />
      </p-view>
    </template>
    <template v-else>
      <RenderBox v-for="(c, i) in node.children" :key="i" :node="c" :color="color" />
    </template>
  </p-view>
</template>

<style scoped>
/* ★#386e box-sizing 显式 border-box（p-view 默认 content-box，嵌套 padding 逐层外扩裁剪——同 #386e 根因） */
.rbox.p-view {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--rb-color) 45%, transparent);
  border-radius: var(--radius-sm);
  padding: 6px;
  gap: 4px;
  min-width: 0;
  background: color-mix(in srgb, var(--rb-color) 6%, transparent);
  position: relative;
}
.rbox-root { width: 100%; height: 100%; overflow: auto; }
.rbox-label { color: var(--rb-color); font-size: 10px; font-family: ui-monospace, Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.rbox-sem { color: var(--dim); margin-left: 6px; }
.rbox-text-content { color: var(--ink); font-size: 12px; }
.rbox-grid-inner {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
  width: 100%;
}
.rbox-leaf { min-height: 22px; }
</style>
