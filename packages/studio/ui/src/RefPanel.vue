<script setup lang="ts">
/**
 * RefPanel.vue —— 「查找引用」结果列表（决策 #1443）
 *
 * ⇧F12 → 列出符号在整个项目里的全部引用（定义处标「定义」、赋值处标「写入」）。
 * ↑↓ 选择、Enter 跳转、Esc / 点空白关闭。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { refPanelState, settleReference } from './refs'

const active = ref(0)
const state = computed(() => refPanelState.value)

const box = computed(() => {
  const d = state.value
  if (!d) return {}
  const W = 560
  const vw = window.innerWidth
  const vh = window.innerHeight
  /* 每项两行（位置 + 行文本），约 40px */
  const H = Math.min(420, 28 + d.rows.length * 40)
  const left = Math.max(8, Math.min(d.x, vw - W - 8))
  const top = d.y + H > vh - 8 ? Math.max(8, d.y - H - 12) : d.y
  return { left: `${left}px`, top: `${top}px`, width: `${W}px`, maxHeight: `${Math.min(420, vh - 16)}px` }
})

function pick(i: number): void {
  const row = state.value?.rows[i]
  if (row) settleReference(row.item)
}

function onKey(e: KeyboardEvent): void {
  if (!state.value) return
  const n = state.value.rows.length
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    settleReference(null)
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    pick(active.value)
    return
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    e.stopPropagation()
    active.value = (active.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
  }
}

function onDown(e: MouseEvent): void {
  if (!state.value) return
  if ((e.target as HTMLElement | null)?.closest('.refpanel')) return
  settleReference(null)
}

watch(state, () => (active.value = 0))

onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('mousedown', onDown, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('mousedown', onDown, true)
})
</script>

<template>
  <div v-if="state" class="refpanel" :style="box" @mousedown.stop>
    <div class="rphead">{{ state.rows.length }} 处引用</div>
    <div class="rplist">
      <button
        v-for="(row, i) in state.rows"
        :key="`${row.item.path}:${row.item.line}:${row.item.col}`"
        class="rpitem"
        :class="{ on: i === active }"
        @mouseenter="active = i"
        @click="pick(i)"
      >
        <div class="rpline">
          <span class="rpname">{{ row.name }}</span><span class="rpno">:{{ row.item.line }}</span>
          <span v-if="row.item.isDef" class="rptag def">定义</span>
          <span v-else-if="row.item.writeAccess" class="rptag write">写入</span>
          <span class="rpdir">{{ row.dir }}</span>
        </div>
        <div class="rptext">{{ row.item.text || '（行内容为空）' }}</div>
      </button>
    </div>
    <div class="rpfoot">↑↓ 选择 · Enter 跳转 · Esc 关闭</div>
  </div>
</template>

<style scoped>
.refpanel {
  position: fixed;
  z-index: 265;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #3a3f47;
  border-radius: 6px;
  background: #1f2228;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  cursor: default;
}
.rphead {
  flex: none;
  padding: 4px 9px;
  border-bottom: 1px solid #2a2d33;
  color: #8b93a1;
  font: 11px/1.5 system-ui, -apple-system, 'PingFang SC', sans-serif;
}
.rplist {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 2px 0;
}
.rpitem {
  display: block;
  width: 100%;
  padding: 3px 9px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.rpitem.on {
  background: rgba(76, 141, 255, 0.16);
}
.rpline {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.rpname {
  flex: none;
  color: #e6e9ef;
  font-weight: 600;
}
.rpdir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #6d7480;
  font-size: 10px;
  /* 右侧弱化，行号紧挨文件名（VS Code 的 `file.ts:12` 读法） */
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rpno {
  flex: none;
  color: #8fb4ff;
}
.rptag {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 9.5px;
  line-height: 1.5;
}
.rptag.def {
  background: rgba(76, 141, 255, 0.18);
  color: #9dc0ff;
}
.rptag.write {
  background: rgba(226, 179, 65, 0.16);
  color: #e2b341;
}
.rptext {
  overflow: hidden;
  color: #8b93a1;
  font: 10.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  white-space: pre;
}
.rpfoot {
  flex: none;
  padding: 3px 9px;
  border-top: 1px solid #2a2d33;
  color: #5d6673;
  font: 10px/1.5 system-ui, -apple-system, 'PingFang SC', sans-serif;
}
</style>
