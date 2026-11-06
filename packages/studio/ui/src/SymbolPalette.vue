<script setup lang="ts">
/**
 * SymbolPalette.vue —— 文件内符号面板（决策 #1454，⌘⇧O）
 *
 * 顶部输入框实时过滤，下面列表；↑↓ 选择、Enter 跳转、Esc 关闭、点空白取消。
 * 默认选中第一项 —— 打开就能回车跳，和 VS Code 手感一致。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { settleSymbol, symbolsState } from './symbols'
import type { SymbolItem } from './bridge'

const q = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)

/** tsserver 的 kind 是英文；常见几条给中文，其余原样（不硬翻，免得译错） */
const KIND: Record<string, string> = {
  module: '模块',
  class: '类',
  interface: '接口',
  type: '类型',
  enum: '枚举',
  function: '函数',
  const: '常量',
  let: '变量',
  var: '变量',
  property: '字段',
  method: '方法',
  local: '局部',
}

const all = computed(() => symbolsState.value?.items ?? [])
const shown = computed(() => {
  const k = q.value.trim().toLowerCase()
  if (!k) return all.value
  return all.value.filter((s) => s.name.toLowerCase().includes(k))
})

const box = computed(() => {
  const d = symbolsState.value
  if (!d) return {}
  const W = 460
  const rows = Math.min(12, Math.max(1, shown.value.length))
  const H = Math.min(360, 42 + rows * 26)
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.max(8, Math.min(d.x, vw - W - 8))
  const top = d.y + H > vh - 8 ? Math.max(8, d.y - H - 12) : d.y
  return { left: `${left}px`, top: `${top}px`, width: `${W}px`, maxHeight: `${Math.min(360, vh - 16)}px` }
})

function kindLabel(s: SymbolItem): string {
  return KIND[s.kind] ?? s.kind
}

function pick(i: number): void {
  const s = shown.value[i]
  if (s) settleSymbol(s)
}

function onKey(e: KeyboardEvent): void {
  if (!symbolsState.value) return
  const n = shown.value.length
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    settleSymbol(null)
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
    if (!n) return
    active.value = (active.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
  }
}

function onDown(e: MouseEvent): void {
  if (!symbolsState.value) return
  if ((e.target as HTMLElement | null)?.closest('.sympal')) return
  settleSymbol(null)
}

/* 过滤词变化时把选中项拉回第一行（否则可能指向已被过滤掉的项） */
watch(q, () => (active.value = 0))

watch(symbolsState, async (d) => {
  if (!d) return
  q.value = ''
  active.value = 0
  await nextTick()
  input.value?.focus()
})

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
  <div v-if="symbolsState" class="sympal" :style="box" @mousedown.stop>
    <div class="symhead">
      <input
        ref="input"
        v-model="q"
        class="symq"
        placeholder="按名称过滤…"
        spellcheck="false"
        autocomplete="off"
      />
    </div>
    <div class="symlist">
      <button
        v-for="(s, i) in shown"
        :key="`${s.name}:${s.line}:${s.col}`"
        class="symrow"
        :class="{ on: i === active }"
        :style="{ paddingLeft: `${9 + s.depth * 14}px` }"
        @mouseenter="active = i"
        @click="pick(i)"
      >
        <span class="symname">{{ s.name }}</span>
        <span class="symkind">{{ kindLabel(s) }}</span>
        <span class="symline">:{{ s.line }}</span>
      </button>
      <div v-if="!shown.length" class="symempty">没有匹配的符号</div>
    </div>
    <div class="symfoot">{{ shown.length }} / {{ all.length }} 个符号 · ↑↓ 选择 · Enter 跳转 · Esc 关闭</div>
  </div>
</template>

<style scoped>
.sympal {
  position: fixed;
  z-index: 268;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #3a3f47;
  border-radius: 6px;
  background: #1f2228;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  cursor: default;
}
.symhead {
  flex: none;
  padding: 5px 8px;
  border-bottom: 1px solid #2a2d33;
}
.symq {
  width: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: #e6e9ef;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.symq::placeholder {
  color: #5d6673;
}
.symlist {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 2px 0;
}
.symrow {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  padding: 3px 9px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.symrow.on {
  background: rgba(76, 141, 255, 0.16);
}
.symname {
  flex: none;
  max-width: 62%;
  overflow: hidden;
  color: #e6e9ef;
  font: 11.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.symkind {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  color: #8b93a1;
  font: 9.5px/1.6 system-ui, -apple-system, 'PingFang SC', sans-serif;
}
.symline {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #6d7480;
  font: 10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.symempty {
  padding: 8px 10px;
  color: #6d7480;
  font-size: 11px;
}
.symfoot {
  flex: none;
  padding: 3px 9px;
  border-top: 1px solid #2a2d33;
  color: #5d6673;
  font: 10px/1.5 system-ui, -apple-system, 'PingFang SC', sans-serif;
}
</style>
