<!-- src/components/p-selection/index.vue —— 局部文本选区（★权威标尺批 H：ui.selection · 对齐小程序 <selection>）
     语义：包裹可选中文本，监听用户选区变化（selectionchange），暴露选中字符串与偏移。
     双端同源码：div → view（MP 端选区由原生 selectionchange 事件驱动；Web 端由 document selectionchange 承接）。
     /* components-allow-platform: Web 端选区矩形/文本依赖 document.getSelection() + Range.getBoundingClientRect（MP 无该 API → 走原生 selectionchange 事件载荷，本逻辑不执行） */ -->
<template>
  <div
    class="p-selection"
    :class="{
      'p-selection--disabled': disableContextMenu,
      'p-selection--selecting': active,
    }"
    :style="wrapStyle"
    @selectionchange="onSelectionChange"
    @scroll="onScroll"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { CSSProperties } from 'vue'

/** 选区变化载荷（对齐小程序 selectionchange event.detail） */
export interface SelectionChangeDetail {
  /** 选区是否已折叠（无选中内容） */
  isCollapsed: boolean
  /** 选中的纯文本 */
  selectedString: string
  /** 起始节点 id */
  firstNodeId: string
  /** 起始偏移 */
  firstOffset: number
  /** 结束节点 id */
  lastNodeId: string
  /** 结束偏移 */
  lastOffset: number
  /** 起始选区矩形（可选） */
  firstRangeRect?: { left: number; top: number; width: number; height: number } | null
}

const props = defineProps({
  /** 是否隐藏客户端原生文本选区按钮（对齐 disable-context-menu） */
  disableContextMenu: { type: Boolean, default: false },
  /** 用户选择文本是否可选（映射 CSS user-select） */
  selectable: { type: Boolean, default: true },
})

const emit = defineEmits(['selectionchange'])

const active = ref(false)

/** Web 平台选区 → 统一载荷（从 DOM Selection 归一） */
function fromWebSelection(sel: Selection | null): SelectionChangeDetail | null {
  if (!sel) return null
  const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null
      const firstRangeRect = range
        ? (() => {
            // components-allow-platform: Web Range 选区矩形（MP 端走原生 selectionchange 载荷，本分支不执行）
            const r = range.getBoundingClientRect()
            return { left: r.left, top: r.top, width: r.width, height: r.height }
          })()
        : null
  const startEl = range?.startContainer?.parentElement as (HTMLElement & { id?: string }) | null
  const endEl = range?.endContainer?.parentElement as (HTMLElement & { id?: string }) | null
  return {
    isCollapsed: sel.isCollapsed,
    selectedString: sel.toString(),
    firstNodeId: startEl?.id ?? '',
    firstOffset: range?.startOffset ?? 0,
    lastNodeId: endEl?.id ?? '',
    lastOffset: range?.endOffset ?? 0,
    firstRangeRect,
  }
}

/** 事件 → 统一载荷（MP 原生 detail / Web Selection） */
function normalizeDetail(payload: unknown): SelectionChangeDetail | null {
  // MP 原生 selectionchange：CustomEvent detail 已含各字段
  const d = payload as { detail?: Partial<SelectionChangeDetail> } | Partial<SelectionChangeDetail> | null
  const detail = (d && 'detail' in d ? d.detail : d) as Partial<SelectionChangeDetail> | null
  if (detail && typeof detail === 'object' && ('selectedString' in detail || 'isCollapsed' in detail)) {
    return {
      isCollapsed: !!detail.isCollapsed,
      selectedString: detail.selectedString ?? '',
      firstNodeId: detail.firstNodeId ?? '',
      firstOffset: detail.firstOffset ?? 0,
      lastNodeId: detail.lastNodeId ?? '',
      lastOffset: detail.lastOffset ?? 0,
      firstRangeRect: detail.firstRangeRect ?? null,
    }
  }
  // Web：从 document.getSelection() 归一
  const doc = (globalThis as { document?: Document }).document
  if (doc && typeof doc.getSelection === 'function') return fromWebSelection(doc.getSelection())
  return null
}

function onSelectionChange(e: unknown) {
  const detail = normalizeDetail(e)
  if (!detail) return
  active.value = !detail.isCollapsed
  emit('selectionchange', detail)
}

function onScroll() {
  // 滚动会改变选区矩形——主动重算一次（Web）
  const doc = (globalThis as { document?: Document }).document
  if (!doc || typeof doc.getSelection !== 'function') return
  const detail = fromWebSelection(doc.getSelection())
  if (detail) emit('selectionchange', detail)
}

const wrapStyle = computed<CSSProperties>(() => ({
  userSelect: props.selectable ? 'text' : 'none',
  WebkitUserSelect: props.selectable ? 'text' : 'none',
}))
</script>

<style scoped>
.p-selection {
  display: block;
}
.p-selection--disabled {
  /* 隐藏原生选区按钮（平台侧实现，这里仅语义标记） */
  -webkit-touch-callout: none;
}
</style>
