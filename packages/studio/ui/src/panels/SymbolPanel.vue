<script setup lang="ts">
// ui/src/panels/SymbolPanel.vue —— 文件**结构大纲**面板（决策 #1481）
//
// 【为什么单独一个面板，而不是在卡片里折叠展开】
//   用户原话："这个预览面板其实就是一个结构提取总览，然后点击箭头可以单开新的面板展示
//   更详细的结构输出列表"。两个东西的**用途不同**：
//     · 卡片 = 扫一眼（3 个符号 + 计数），必须小、必须不挡视线；
//     · 面板 = 查清单（95 条），必须能滚、能分组、点一条能跳过去。
//   硬塞进卡片只会让卡片变高变窄，两头都不好用。
//
// 【★为什么不改布局（右侧栏/底部面板）】
//   `CodePanel.vue` 997 行、`App.vue` 985 行，都贴着 1000 行硬上限；而且动布局会牵到
//   布局判据 ㉓。所以这一版做成**浮层**：Teleport 到 body、固定定位、自带关闭。
//   要做"常驻侧栏大纲"是布局决策，另开单。
//
// 【数据】`file_symbols`（Rust 侧只认**第 0 列**的顶层声明，见 file_brief::scan_symbols）。
//   摘要与清单是两条命令：悬停是热路径，不为"可能不会点开的面板"付钱。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { fileSymbols, type SymbolRow } from '../bridge'
import { placeBeside, type AnchorRect } from '../popover'
import { useWorkspaceState } from '../useWorkspaceState'
import StudioIcon from '../icons/StudioIcon.vue'

const props = defineProps<{
  path: string
  /** 父面板（悬停卡）的矩形 —— 决策 #1482：子面板锚定**父面板**，不是锚定某一行 */
  anchor: AnchorRect | null
}>()
const emit = defineEmits<{ close: [] }>()
const ws = useWorkspaceState()

/* 面板尺寸：宽度固定（清单是等宽名字 + 行号，窄了会截断），高度用于垂直夹取 */
const W = 340
const EST_H = 420
const LEAVE_GRACE = 300

const pos = computed(() => {
  const a = props.anchor
  if (!a) return { left: 24, top: 88, side: 'right' as const }
  return placeBeside(a, { w: W, h: EST_H })
})

const rows = ref<SymbolRow[]>([])
const err = ref('')
const loading = ref(true)

/** 分组顺序：先"契约"（interface/type/class）再"实现"（function/const/…） */
const ORDER = ['interface', 'type', 'class', 'enum', 'function', 'const', 'let', 'var']

const groups = computed(() => {
  const m = new Map<string, SymbolRow[]>()
  for (const r of rows.value) {
    const k = r.kind
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(r)
  }
  return [...m.entries()]
    .sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
    .map(([kind, items]) => ({ kind, items: items.sort((x, y) => x.line - y.line) }))
})

const exportedCount = computed(() => rows.value.filter((r) => r.exported).length)
const name = computed(() => props.path.slice(props.path.lastIndexOf('/') + 1))
const dir = computed(() => {
  const i = props.path.lastIndexOf('/')
  return i > 0 ? props.path.slice(0, i) : ''
})

onMounted(async () => {
  try {
    rows.value = await fileSymbols(props.path)
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

/* 悬停自动关闭（决策 #1482）：面板是"链路的第二级"，
   指针离开 300ms 就收起；父面板（卡片）由 FileTree 决定去留，这里不越权。 */
let leaveTimer: ReturnType<typeof setTimeout> | null = null
function onEnter() {
  if (leaveTimer) {
    clearTimeout(leaveTimer)
    leaveTimer = null
  }
}
function onLeave() {
  onEnter()
  leaveTimer = setTimeout(() => emit('close'), LEAVE_GRACE)
}
onBeforeUnmount(() => {
  if (leaveTimer) clearTimeout(leaveTimer)
})

/** 点一条 → 交给 `ws.jump`（CodePanel 监听它并负责打开文件 + 定位），然后收起面板。
 *  ★这里不自己调编辑器：`EditorView` 只在 CodePanel 里，跨组件拿是错的（#1409 的既有约定）。 */
function go(r: SymbolRow) {
  ws.jump = { path: props.path, line: r.line }
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      class="sym"
      id="symbolPanel"
      role="dialog"
      aria-label="结构大纲"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px`, width: `${W}px` }"
      :data-side="pos.side"
      @mouseenter="onEnter"
      @mouseleave="onLeave"
    >
      <header class="sym-h">
        <div class="sym-t">
          <StudioIcon name="rows" :size="13" />
          <span class="sym-name">{{ name }}</span>
        </div>
        <button class="sym-x" title="关闭（Esc）" @click="emit('close')">✕</button>
      </header>
      <div class="sym-sub">
        {{ dir }}<span v-if="!loading && !err" class="sym-n"
          >· {{ rows.length }} 个符号 · {{ exportedCount }} 个导出</span
        >
      </div>

      <div v-if="loading" class="sym-empty">读取中…</div>
      <div v-else-if="err" class="sym-empty err">{{ err }}</div>
      <div v-else-if="!rows.length" class="sym-empty">这个文件里没有可列的顶层声明</div>

      <div v-else class="sym-list">
        <section v-for="g in groups" :key="g.kind" class="sym-g">
          <div class="sym-gh">{{ g.kind }}<span class="sym-gn">{{ g.items.length }}</span></div>
          <button
            v-for="r in g.items"
            :key="`${r.line}:${r.name}`"
            class="sym-i"
            :class="{ dim: !r.exported }"
            :data-sym="r.name"
            :title="`${r.exported ? '导出' : '内部'} · 第 ${r.line} 行`"
            @click="go(r)"
          >
            <span class="sym-nm">{{ r.name }}</span>
            <span class="sym-ln">{{ r.line }}</span>
          </button>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ★位置由 `placeBeside` 算（决策 #1482），这里**不写 top/right** ——
   上一版固定 `top:88px; right:24px`，于是面板飞到窗口角落、与触发入口毫无关系。 */
.sym {
  position: fixed;
  z-index: 70;
  display: flex;
  flex-direction: column;
  max-height: 70vh;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--bg-elevated);
  box-shadow: 0 18px 44px rgb(0 0 0 / 42%);
}
.sym-h {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--sp2) var(--sp2) 0 var(--sp3);
}
.sym-t {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  color: var(--fg);
}
.sym-name {
  overflow: hidden;
  font: 600 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sym-x {
  flex: none;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-subtle);
  cursor: pointer;
  font-size: 11px;
}
.sym-x:hover {
  background: var(--bg-overlay);
  color: var(--fg);
}
.sym-sub {
  padding: 2px var(--sp3) var(--sp2);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--fg-subtle);
  font-size: 10px;
}
.sym-n {
  margin-left: 4px;
}
.sym-empty {
  padding: var(--sp3);
  color: var(--fg-subtle);
  font-size: 11px;
}
.sym-empty.err {
  color: var(--danger, #f87171);
}
.sym-list {
  overflow: auto;
  padding: var(--sp1) 0 var(--sp2);
}
.sym-gh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px var(--sp3) 2px;
  color: var(--fg-subtle);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.sym-gn {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bg-overlay);
  font-variant-numeric: tabular-nums;
}
.sym-i {
  display: flex;
  align-items: baseline;
  gap: var(--sp2);
  width: 100%;
  padding: 2px var(--sp3);
  border: 0;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.sym-i:hover {
  background: var(--bg-overlay);
}
/* 非导出（内部实现）淡一档：大纲里"对外契约"和"内部实现"要能一眼分开 */
.sym-i.dim .sym-nm {
  color: var(--fg-muted);
}
.sym-nm {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sym-ln {
  flex: none;
  color: var(--fg-subtle);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
</style>
