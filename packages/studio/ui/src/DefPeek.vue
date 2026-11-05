<script setup lang="ts">
/**
 * DefPeek.vue —— ⌘ 长按时的**定义预览卡**（决策 #1436）
 *
 * 纯展示 + 一个点击动作（跳到定义）。数据来自 `modPeek.peekState`（模块级单例），
 * 这样 `CodePanel` 只需放一行组件，不用层层透传状态。
 *
 * 【为什么 fixed 定位】`coordsAtPos` 给的是**视口坐标**（client 坐标），
 * 用 absolute 还要自己减容器偏移、滚动时还得跟随；fixed 直接对齐。
 */
import { computed } from 'vue'
import { peekState, type PeekData } from './modPeek'
import type { DefTarget } from './nav'

const emit = defineEmits<{ (e: 'jump', t: DefTarget): void }>()

const data = computed<PeekData | null>(() => peekState.value as PeekData | null)

/** 路径显示：末两级足够分辨，完整路径在窄卡里会撑爆 */
const shortPath = computed(() => {
  const p = data.value?.target.path ?? ''
  if (!p) return ''
  if (p.startsWith('/')) return `…/${p.split('/').filter(Boolean).slice(-2).join('/')}`
  return p.split('/').slice(-2).join('/')
})

/** 卡片宽度固定，靠近右/下边界时翻转，避免被窗口切掉 */
const box = computed(() => {
  const d = data.value
  if (!d) return {}
  const W = 420
  const H = 190
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.max(8, Math.min(d.anchor.left, vw - W - 8))
  const below = d.anchor.bottom + 6
  const top = below + H > vh ? Math.max(8, d.anchor.top - H - 6) : below
  return { left: `${left}px`, top: `${top}px`, width: `${W}px` }
})
</script>

<template>
  <div v-if="data" class="defpeek" :style="box" @mousedown.stop @click="emit('jump', data.target)">
    <div class="dphead">
      <span class="dpname">{{ shortPath }}</span>
      <span class="dpline">:{{ data.target.line }}</span>
      <span v-if="data.readonly" class="dpro">只读</span>
      <span class="dptip">点击跳转</span>
    </div>
    <pre v-if="data.lines.length" class="dpcode"><div
        v-for="l in data.lines"
        :key="l.no"
        class="dprow"
        :class="{ hit: l.no === data.target.line }"
      ><span class="dpno">{{ l.no }}</span><span class="dptext">{{ l.text }}</span></div></pre>
    <div v-else class="dpempty">读不到文件内容（可能过大或不可读）</div>
  </div>
</template>

<style scoped>
.defpeek {
  position: fixed;
  /* ★必须高于 CodeMirror 的 tooltip（`.cm-tooltip` 是 z-index: 200，见 @codemirror/view baseTheme）：
     原来是 60，只要有任何 hover 提示在场，预览卡就一定被压在下面（用户截图"被顶替"的视觉成因之一）。 */
  z-index: 250;
  max-height: 190px;
  overflow: hidden;
  padding: 0;
  border: 1px solid #3a3f47;
  border-radius: 6px;
  background: #1f2228;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}
.dphead {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid #2a2d33;
  color: #8b93a1;
  font: 11px/1.4 system-ui, -apple-system, 'PingFang SC', sans-serif;
}
.dpname {
  overflow: hidden;
  color: #e6e9ef;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dpline {
  color: #4c8dff;
}
.dpro {
  padding: 0 4px;
  border: 1px solid #4a5160;
  border-radius: 3px;
  font-size: 10px;
}
.dptip {
  margin-left: auto;
  color: #5d6673;
  font-size: 10px;
}
.dpcode {
  margin: 0;
  padding: 4px 0;
  overflow: hidden;
  font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.dprow {
  display: flex;
  gap: 8px;
  padding: 0 8px;
  white-space: pre;
}
/* 定义所在行高亮：预览的全部意义就是"一眼看到它" */
.dprow.hit {
  background: rgba(76, 141, 255, 0.14);
}
.dpno {
  flex: none;
  min-width: 30px;
  color: #5d6673;
  text-align: right;
}
.dptext {
  overflow: hidden;
  color: #c9d1d9;
  text-overflow: ellipsis;
}
.dpempty {
  padding: 8px;
  color: #8b93a1;
  font-size: 11px;
}
</style>
