<script setup lang="ts">
/**
 * DefChooser.vue —— 「多个定义」选择列表（决策 #1442）
 *
 * 定位在触发处下方（F12 光标 / ⌘+单击鼠标处），↑↓ 选择、Enter 确认、Esc 取消、
 * 点击外部也取消。视觉与定义预览卡同一套深色。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { chooserState, settleDefinition } from './chooser'

const active = ref(0)
const state = computed(() => chooserState.value)

const box = computed(() => {
  const d = state.value
  if (!d) return {}
  const W = 460
  const vw = window.innerWidth
  const vh = window.innerHeight
  /* 估算高度：标题 26 + 每项 38 */
  const H = Math.min(360, 30 + d.items.length * 38)
  const left = Math.max(8, Math.min(d.x, vw - W - 8))
  const top = d.y + H > vh - 8 ? Math.max(8, d.y - H - 12) : d.y
  return { left: `${left}px`, top: `${top}px`, width: `${W}px`, maxHeight: `${Math.min(360, vh - 16)}px` }
})

function pick(i: number): void {
  const it = state.value?.items[i]
  if (it) settleDefinition(it.target)
}

function onKey(e: KeyboardEvent): void {
  if (!state.value) return
  const n = state.value.items.length
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    settleDefinition(null)
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

/** 点空白关闭：选择器是"临时动作"，不该像对话框那样挡着 */
function onDown(e: MouseEvent): void {
  if (!state.value) return
  if ((e.target as HTMLElement | null)?.closest('.defchooser')) return
  settleDefinition(null)
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
  <div v-if="state" class="defchooser" :style="box" @mousedown.stop>
    <div class="dchead">多个定义 · 选择要跳转的位置</div>
    <div class="dclist">
      <button
        v-for="(it, i) in state.items"
        :key="`${it.target.path}:${it.target.line}:${it.target.col}`"
        class="dcitem"
        :class="{ on: i === active }"
        @mouseenter="active = i"
        @click="pick(i)"
      >
        <span class="dcname">{{ it.name }}</span>
        <span class="dcmeta">{{ it.dir }}<span class="dcline">:{{ it.target.line }}</span></span>
      </button>
    </div>
    <div class="dcfoot">↑↓ 选择 · Enter 跳转 · Esc 取消</div>
  </div>
</template>

<style scoped>
.defchooser {
  position: fixed;
  z-index: 260;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #3a3f47;
  border-radius: 6px;
  background: #1f2228;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  cursor: default;
}
.dchead {
  flex: none;
  padding: 4px 9px;
  border-bottom: 1px solid #2a2d33;
  color: #8b93a1;
  font: 11px/1.5 system-ui, -apple-system, 'PingFang SC', sans-serif;
}
.dclist {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 2px 0;
}
.dcitem {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 4px 9px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.dcitem.on {
  background: rgba(76, 141, 255, 0.16);
}
.dcname {
  flex: none;
  color: #e6e9ef;
  font: 11.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.dcmeta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #6d7480;
  font: 10.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dcline {
  color: #8fb4ff;
}
.dcfoot {
  flex: none;
  padding: 3px 9px;
  border-top: 1px solid #2a2d33;
  color: #5d6673;
  font: 10px/1.5 system-ui, -apple-system, 'PingFang SC', sans-serif;
}
</style>
