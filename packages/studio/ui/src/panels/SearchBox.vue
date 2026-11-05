<script setup lang="ts">
// panels/SearchBox.vue —— 仓库搜索的输入 + 结果列表（决策 #1222）
//
// 【为什么单独成组件】CodePanel 已经背着"目录树 / 标签 / 缓冲池 / 保存 / 跳转 / 语法着色"，
//   再把搜索的状态机（防抖、序号、引擎标注、错误）塞进去就过 1000 行了（file-size 门禁）。
//   职责边界很清楚：**这里只负责"输入 → 结果 → 选中哪一条"**；
//   真正的"跳过去"由父组件做（它持有 EditorView）。
//
// 【两个容易做错的地方】
//   ① 输入快时会有多个请求在飞，先发的慢请求后回来会盖掉新结果 ⇒ 只认最后一次（`seq`）；
//   ② 没有 rg 的机器上走内置扫描（慢一个量级）⇒ 引擎**如实显示**，不能让用户以为那是常态。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { searchText, type SearchHit } from '../bridge'
import StudioIcon from '../icons/StudioIcon.vue'

const emit = defineEmits<{
  (e: 'jump', hit: SearchHit): void
  (e: 'active', on: boolean): void
}>()

const query = ref('')
const hits = ref<SearchHit[]>([])
const engine = ref<'rg' | 'builtin'>('rg')
const truncated = ref(false)
const err = ref('')
const busy = ref(false)
const input = ref<HTMLInputElement | null>(null)

let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0
/** ≥2 个字符才算搜索：单字符在这仓里是上万条命中，那不是"搜索"是"扫描" */
const active = computed(() => query.value.trim().length >= 2)

async function run() {
  const q = query.value.trim()
  if (q.length < 2) {
    hits.value = []
    err.value = ''
    return
  }
  const mine = ++seq
  busy.value = true
  try {
    const r = await searchText(q)
    if (mine !== seq) return // 有更新的请求了：这次结果作废
    /* ★`r` 可能是 null（后端降级 / 旧版本 / 桥不可用）：不判空会让整页白屏
       （`hits` 变成 null 后，`for...of` 与 `list.length` 全部抛错） */
    hits.value = Array.isArray(r?.hits) ? r.hits : []
    engine.value = r?.engine ?? 'rg'
    truncated.value = Boolean(r?.truncated)
    err.value = ''
  } catch (e) {
    if (mine !== seq) return
    hits.value = []
    err.value = String((e as Error)?.message ?? e)
  } finally {
    if (mine === seq) busy.value = false
  }
}

watch(query, () => {
  clearTimeout(timer)
  // 220ms：比输入法组字慢一点，避免每敲一下都起一个搜索
  timer = setTimeout(() => void run(), 220)
})
watch(active, (on) => emit('active', on), { immediate: true })

/* ── 按文件分组（决策 #1425）─────────────────────────────────────────────
   平铺几百条命中时，同一文件的行挤在一起也看不出边界，左栏又窄（~260px）——
   分组后能一眼看出"命中集中在哪几个文件"，也能把无关文件折掉。 */
const groups = computed(() => {
  const map = new Map<string, SearchHit[]>()
  for (const h of hits.value ?? []) {
    const arr = map.get(h.path)
    if (arr) arr.push(h)
    else map.set(h.path, [h])
  }
  return [...map.entries()].map(([path, items]) => ({ path, items }))
})

/** 结果很多时**默认全部折叠**：几千条 DOM 一次铺出来左栏会卡 */
const MANY = 300
const collapsed = ref<string[]>([])
watch(hits, (list) => {
  const arr = list ?? []
  collapsed.value = arr.length > MANY ? [...new Set(arr.map((h) => h.path))] : []
})
const isOpen = (p: string) => !collapsed.value.includes(p)
function toggle(p: string) {
  const i = collapsed.value.indexOf(p)
  if (i >= 0) collapsed.value.splice(i, 1)
  else collapsed.value.push(p)
}
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)
/** 只显示**末尾两级目录**：左栏只有 ~260px，整条路径既放不下也没信息量（VS Code 同款取舍） */
const dirOf = (p: string) => {
  const parts = p.split('/')
  parts.pop()
  const tail = parts.slice(-2).join('/')
  return tail ? `${tail}/` : ''
}

function clear() {
  query.value = ''
  hits.value = []
  err.value = ''
  input.value?.focus()
}

/** 供 ⌘F / 菜单「查找」调用 */
defineExpose({ focus: () => {
  input.value?.focus()
  input.value?.select()
} })

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="sbox" :class="{ idle: !active }">
    <div class="find">
      <StudioIcon name="search" :size="13" class="fico" />
      <input
        id="codeSearch"
        ref="input"
        v-model="query"
        placeholder="搜索仓库（⇧⌘F）"
        spellcheck="false"
        autocomplete="off"
      />
      <button v-if="query" class="fclear" id="codeSearchClear" aria-label="清除搜索" @click="clear">
        ×
      </button>
    </div>
    <div v-if="err" class="fnerr" id="codeSearchErr">{{ err }}</div>
    <!-- ★引擎如实显示：没 rg 时是内置扫描（慢一个量级） -->
    <div v-else-if="active" class="fnmeta" id="codeSearchMeta">
      {{ busy ? '搜索中…' : `${hits.length}${truncated ? '+' : ''} 条命中 · ${engine === 'rg' ? 'rg' : '内置扫描（装 ripgrep 更快）'}` }}
    </div>
    <div v-if="active" class="hits" id="codeHits">
      <div v-for="g in groups" :key="g.path" class="hgroup">
        <button class="ghead" :title="g.path" @click="toggle(g.path)">
          <span class="chev">{{ isOpen(g.path) ? '▾' : '▸' }}</span>
          <span class="gname">{{ baseOf(g.path) }}</span>
          <span class="gdir">{{ dirOf(g.path) }}</span>
          <span class="gcount">{{ g.items.length }}</span>
        </button>
        <template v-if="isOpen(g.path)">
          <button
            v-for="(h, i) in g.items"
            :key="`${h.path}:${h.line}:${h.col}:${i}`"
            class="hit"
            :data-hit="`${h.path}:${h.line}:${h.col}`"
            :title="`${h.path}:${h.line}:${h.col}`"
            @click="emit('jump', h)"
          >
            <span class="hln">L{{ h.line }}</span>
            <span class="htext">{{ h.text }}</span>
          </button>
        </template>
      </div>
      <div v-if="!hits.length && !busy" class="fnmeta">无命中</div>
    </div>
  </div>
</template>

<style scoped>
/* 有查询时占满左栏（结果要能滚），没查询时只占 32px 给目录树让位 */
.sbox {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sbox.idle {
  flex: none;
}
/* 搜索框：32px 高（4px 网格）；焦点用底部 2px 强调条，不用 outline 抢空间 */
.find {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp1);
  height: 32px;
  padding: 0 var(--sp2);
  color: var(--fg-subtle);
  border-bottom: 1px solid var(--border-subtle);
}
.find:focus-within {
  box-shadow: inset 0 -2px 0 var(--accent);
  color: var(--fg-muted);
}
.find input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--fg);
  font: var(--fs-xs) / 1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  outline: none;
}
.find input::placeholder {
  color: var(--fg-subtle);
}
.fclear {
  flex: none;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-subtle);
  font-size: 13px;
  line-height: 16px;
  text-align: center;
  cursor: pointer;
}
.fclear:hover {
  background: var(--bg-overlay);
  color: var(--fg);
}
.fnmeta {
  padding: var(--sp1) var(--sp2);
  color: var(--fg-subtle);
  font: var(--fs-xs) / 1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}
/* 错误用状态色 --bad：这里是**真的出错了**（查询太短 / rg 报错），不是普通提示 */
.fnerr {
  padding: var(--sp1) var(--sp2);
  color: var(--bad);
  font: var(--fs-xs) / 1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.hits {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--sp1) 0;
}
/* 文件组：组头吸顶不明显但可点，条目缩进 */
.hgroup {
  margin-bottom: 2px;
}
.ghead {
  display: flex;
  align-items: baseline;
  gap: 4px;
  width: 100%;
  padding: 3px var(--sp2);
  border: 0;
  background: transparent;
  color: var(--fg-muted);
  font: var(--fs-xs) / 1.4 system-ui, -apple-system, 'PingFang SC', sans-serif;
  text-align: left;
  cursor: pointer;
}
.ghead:hover {
  background: var(--bg-overlay);
  color: var(--fg);
}
.chev {
  width: 8px;
  flex: none;
  color: var(--fg-subtle);
}
.gname {
  flex: none;
  max-width: 60%;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gdir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-subtle);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gcount {
  flex: none;
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
}
.hit {
  display: flex;
  gap: 6px;
  width: 100%;
  padding: 2px var(--sp2) 2px 20px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--dur) var(--ease);
}
/* 行号列：定宽右对齐，扫读时不会左右跳 */
.hln {
  flex: none;
  min-width: 30px;
  color: var(--accent);
  font: var(--fs-xs) / 16px ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: right;
}
.hit:hover {
  background: var(--bg-overlay);
}
.hpath {
  display: block;
  overflow: hidden;
  color: var(--fg-subtle);
  font: var(--fs-xs) / 16px ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hline {
  color: var(--accent);
}
.htext {
  display: block;
  overflow: hidden;
  color: var(--fg);
  font: var(--fs-xs) / 16px ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  white-space: pre;
}
</style>
