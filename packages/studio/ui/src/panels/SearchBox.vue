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
    hits.value = r.hits
    engine.value = r.engine
    truncated.value = r.truncated
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
        placeholder="搜索仓库（⌘F）"
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
      <button
        v-for="(h, i) in hits"
        :key="`${h.path}:${h.line}:${h.col}:${i}`"
        class="hit"
        :data-hit="`${h.path}:${h.line}:${h.col}`"
        :title="`${h.path}:${h.line}:${h.col}`"
        @click="emit('jump', h)"
      >
        <span class="hpath">{{ h.path }}<span class="hline">:{{ h.line }}</span></span>
        <span class="htext">{{ h.text }}</span>
      </button>
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
.hit {
  display: block;
  width: 100%;
  padding: var(--sp1) var(--sp2);
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--dur) var(--ease);
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
