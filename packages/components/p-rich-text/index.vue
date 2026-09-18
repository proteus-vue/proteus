<!-- packages/components/p-rich-text/index.vue —— 富文本（★G-32 B2：ui.rich-text U3）
     语义：受信任的富文本内容渲染（HTML 字符串 / 节点数组）。
     ★端对齐批次3（2026-09-16）：对齐官方 <rich-text> 全量属性——
       nodes（内容源，框架亦保留 source 作为可读别名）/ space（连续空格显示方式）/ user-select（文本可选）/ mode（布局兼容模式）。
     ★双端实现：MP 端原生 <rich-text>（nodes 承接，官方做节点白名单过滤）；
       Web 端 <view v-html>（浏览器原生解析；space/user-select 以 CSS 等价表达，mode 在 Web 无对等→诚实不伪造）。
     ★安全边界：nodes 为**受信任内容**（同官方语义——官方对节点/属性做受信任过滤；Web 端 v-html 不做额外净化，
       传入不可信 HTML 须先经业务侧消毒，与 Vue v-html 的既有契约一致）。 -->
<template>
  <view class="p-rich-text" :style="webTextStyle">
    <rich-text
      v-if="isMp"
      class="p-rich-text__mp"
      :nodes="nodes"
      :space="space"
      :user-select="userSelect"
      :mode="mode"
    />
    <view v-else class="p-rich-text__web" :style="webTextStyle" v-html="nodes" />
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
import { isMpRuntime } from '../runtime/container-measure'

/** 富文本节点（官方 nodes 元素节点子集） */
export interface RichTextNode {
  type?: 'node' | 'text'
  name?: string
  attrs?: Record<string, unknown>
  children?: RichTextNode[]
  text?: string
}

const props = defineProps({
  /** 节点列表 / HTML 字符串（★官方 nodes） */
  nodes: { type: [String, Array] as unknown as () => string | RichTextNode[], default: '' },
  /** 显示连续空格：ensp / emsp / nbsp（★官方 space） */
  space: { type: String, default: '' },
  /** 文本是否可选（★官方 user-select；会使节点显示为 block） */
  userSelect: { type: Boolean, default: false },
  /** 布局兼容模式：default / compat（★官方 mode） */
  mode: { type: String, default: 'default' },
  /** HTML 源（框架可读别名——等价 nodes 的字符串形态，二者取其一） */
  source: { type: String, default: '' },
})

const isMp = computed(() => isMpRuntime())
/** source 为 nodes 的字符串别名（显式 nodes 优先） */
const nodes = computed(() => (props.nodes === '' || props.nodes == null ? props.source : props.nodes))

/** Web：space/user-select 的 CSS 等价（官方 space 作用于连续空格的呈现宽度） */
const webTextStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {}
  if (props.space === 'ensp') style.whiteSpace = 'pre-wrap'
  else if (props.space === 'emsp') style.whiteSpace = 'pre-wrap'
  else if (props.space === 'nbsp') style.whiteSpace = 'pre-wrap'
  if (props.userSelect) style.userSelect = 'text'
  if (props.mode === 'compat') style.display = 'block'
  return style
})
</script>

<style scoped>
.p-rich-text {
  line-height: 1.6;
  word-break: break-word;
}
</style>
