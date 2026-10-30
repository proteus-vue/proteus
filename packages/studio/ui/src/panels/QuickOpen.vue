<script setup lang="ts">
/**
 * QuickOpen.vue —— 快速打开文件（⌘P，决策 #1396）
 *
 * 【为什么需要】代码视图里换文件只有一条路：在左边目录树里一层层点。
 * 仓库有上千个文件时，这条路的成本高到让人宁可开终端 `code xxx`。
 * VS Code 的解法是 ⌘P：输入几个字符，模糊匹配路径，回车打开。
 *
 * 【匹配规则】子序列匹配（按字符顺序命中即可），并按"命中是否连续 / 是否落在文件名上"打分：
 *   · 连续命中 > 分散命中（`cpan` 能匹配 `CodePanel.vue`）；
 *   · 命中在**文件名**上加权（用户几乎总是记得文件名，不记得目录）。
 * 【边界】只负责"列出候选 + 选一个"；真正的读取/加标签由父组件 `open(path)` 做。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import Icon from '../ui/Icon.vue'

const props = defineProps<{ files: string[]; cur?: string }>()
const emit = defineEmits<{ pick: [path: string]; close: [] }>()

const q = ref('')
const active = ref(0)
const inputEl = ref<HTMLInputElement>()

/** 打分：子序列命中 + 连续奖励 + 文件名加权；不命中返回 -1 */
function score(path: string, query: string): number {
  if (!query) return 0
  const p = path.toLowerCase()
  const base = p.slice(p.lastIndexOf('/') + 1)
  let qi = 0
  let s = 0
  let run = 0
  for (let i = 0; i < p.length && qi < query.length; i++) {
    if (p[i] === query[qi]) {
      qi++
      run++
      /* 连续命中权重更高；命中在文件名区间里再翻倍 */
      const inBase = i >= p.length - base.length
      s += (run > 1 ? 6 : 2) * (inBase ? 2 : 1)
    } else {
      run = 0
    }
  }
  if (qi < query.length) return -1
  /* 路径越长越吃亏，避免 `node_modules/...` 抢在前面 */
  return s - p.length * 0.02
}

const results = computed(() => {
  const query = q.value.trim().toLowerCase()
  if (!query) {
    /* 空查询：先给最近/当前文件所在目录的兄弟文件，再给其余（截断 50） */
    const cur = props.cur ?? ''
    const dir = cur.slice(0, cur.lastIndexOf('/') + 1)
    const near = props.files.filter((f) => f.startsWith(dir) && f !== cur)
    const rest = props.files.filter((f) => !f.startsWith(dir))
    return [...near, ...rest].slice(0, 50)
  }
  return props.files
    .map((f) => ({ f, s: score(f, query) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 50)
    .map((x) => x.f)
})

watch(results, () => (active.value = 0))

function move(d: number) {
  if (!results.value.length) return
  active.value = (active.value + d + results.value.length) % results.value.length
}

function pick(i = active.value) {
  const p = results.value[i]
  if (p) emit('pick', p)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    pick()
  }
}

/** 把命中字符高亮成 <b>（只做显示，不改匹配逻辑） */
function parts(path: string): { t: string; hit: boolean }[] {
  const query = q.value.trim().toLowerCase()
  if (!query) return [{ t: path, hit: false }]
  const p = path.toLowerCase()
  const out: { t: string; hit: boolean }[] = []
  let qi = 0
  for (let i = 0; i < path.length; i++) {
    const hit = qi < query.length && p[i] === query[qi]
    if (hit) qi++
    const last = out[out.length - 1]
    if (last && last.hit === hit) last.t += path[i]
    else out.push({ t: path[i], hit })
  }
  return out
}

const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1)
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)

onMounted(() => void nextTick(() => inputEl.value?.focus()))
</script>

<template>
  <div class="qo-mask" @click.self="emit('close')">
    <div class="qo" @keydown="onKey">
      <div class="qo-input">
        <Icon name="search" :size="13" />
        <input
          ref="inputEl"
          v-model="q"
          placeholder="按文件名搜索（子序列匹配，例如 cpan → CodePanel.vue）"
          spellcheck="false"
          @keydown.esc.prevent="emit('close')"
        />
        <span class="qo-count">{{ results.length }}</span>
      </div>
      <div class="qo-list" v-if="results.length">
        <button
          v-for="(f, i) in results"
          :key="f"
          class="qo-item"
          :class="{ on: i === active }"
          @mouseenter="active = i"
          @click="pick(i)"
        >
          <span class="qo-name">
            <template v-for="(seg, k) in parts(nameOf(f))" :key="k">
              <b v-if="seg.hit">{{ seg.t }}</b>
              <template v-else>{{ seg.t }}</template>
            </template>
          </span>
          <span class="qo-dir">{{ dirOf(f) }}</span>
        </button>
      </div>
      <div v-else class="qo-empty">没有匹配的文件</div>
    </div>
  </div>
</template>

<style scoped>
.qo-mask {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 56px;
  background: rgb(0 0 0 / 28%);
}
.qo {
  width: min(620px, 82%);
  max-height: 62%;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: 0 18px 48px rgb(0 0 0 / 50%);
  overflow: hidden;
}
.qo-input {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 11px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--fg-subtle);
}
.qo-input input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--fg);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.qo-count { font-size: 10px; color: var(--fg-subtle); }
.qo-list { overflow: auto; padding: 4px; }
.qo-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 5px 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.qo-item.on { background: var(--bg-overlay); color: var(--fg); }
.qo-name { flex: none; }
.qo-name b { color: var(--accent); font-weight: 600; }
.qo-dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--fg-subtle);
  text-align: right;
}
.qo-empty { padding: 14px; font-size: 12px; color: var(--fg-subtle); text-align: center; }
</style>
