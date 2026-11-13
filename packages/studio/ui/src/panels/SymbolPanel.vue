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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fileSymbols, type SymbolRow } from '../bridge'
import { useAnchoredPopover, type AnchorRect } from '../popover'
import { useWorkspaceState } from '../useWorkspaceState'
import { filterSymbols } from '../symbolMatch'
import StudioIcon from '../icons/StudioIcon.vue'

const props = defineProps<{
  path: string
  /** 父面板（悬停卡）的矩形 —— 决策 #1482：子面板锚定**父面板**，不是锚定某一行 */
  anchor: AnchorRect | null
}>()
const emit = defineEmits<{ close: [] }>()
const ws = useWorkspaceState()

/* 面板尺寸：宽度固定（清单是等宽名字 + 行号，窄了会截断），高度只作首帧估算 */
const W = 340
const EST_H = 420
const LEAVE_GRACE = 300

/* ★位置与最大高度都交给模型（决策 #1482 / #1483）：子面板锚定**父面板矩形**，
   并且永远不穿出"可用底边"（状态栏上方）。 */
const { el, pos, maxH } = useAnchoredPopover(computed(() => props.anchor), W, EST_H)

const rows = ref<SymbolRow[]>([])
const err = ref('')
const loading = ref(true)

/** 分组顺序：先"契约"（interface/type/struct/class/trait）再"实现"（function/const/…） */
const ORDER = [
  'interface',
  'type',
  'struct',
  'class',
  'trait',
  'enum',
  'function',
  'const',
  'let',
  'var',
  'module',
]

/* ★决策 #1491：过滤 + 键盘导航。
   真实的 `bridge.ts` 有 **95 个符号**，只靠鼠标滚是一件事倍功半的活；
   IDE 里这个动作的标准形状是"**打字即过滤、↑↓ 选、回车跳**"。
   ★决策 #1499：匹配口径搬到 `symbolMatch.ts` —— 连续子串 / 词首缩写 / 子序列三档，
     **只取最高档**。放在这里写成一行的代价是「精确命中被模糊命中淹没」没人能验。 */
const q = ref('')
const matched = computed(() => filterSymbols(rows.value, q.value))

const groups = computed(() => {
  const m = new Map<string, SymbolRow[]>()
  for (const r of matched.value) {
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
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  /* ★输入框自己已经处理了 ↑↓/回车（`@keydown="onNavKey"`），而 keydown 会冒泡到 window
     ⇒ 不拦的话**一次按键走两格**（门禁 ㊿t 就是因为这个红在 `sym14` 而不是 `sym12`）。 */
  if (e.target === inputEl.value) return
  onNavKey(e)
  /* ★打字即过滤：**不自动聚焦输入框**——面板可能是悬停 380ms 自动开的，
     那时用户手还在编辑器里打字，抢焦点会把输入打到面板里（很难受）。
     做法是"按下一个可见字符才聚焦 + 写入"，与命令面板的手感一致。 */
  const typing = e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey
  if (typing && document.activeElement !== inputEl.value) {
    q.value += e.key
    inputEl.value?.focus()
    e.preventDefault()
  }
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
/** 过滤后的**扁平**顺序（与屏幕上的分组顺序一致）—— ↑↓ 走的就是这个下标 */
const flat = computed(() => groups.value.flatMap((g) => g.items))
const cursor = ref(0)
watch(q, () => (cursor.value = 0))
watch(flat, (list) => {
  if (cursor.value >= list.length) cursor.value = Math.max(0, list.length - 1)
})

const inputEl = ref<HTMLInputElement | null>(null)

/** ↑↓ / 回车 / 打字即过滤：键盘操作都从面板自己的 keydown 进来（输入框里也走同一套） */
function onNavKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const n = flat.value.length
    if (!n) return
    cursor.value = (cursor.value + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
    return
  }
  if (e.key === 'Enter') {
    const r = flat.value[cursor.value]
    if (r) {
      e.preventDefault()
      go(r)
    }
  }
}

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
      ref="el"
      :style="{
        left: `${pos.left}px`,
        top: `${pos.top}px`,
        width: `${W}px`,
        maxHeight: `${maxH}px`,
      }"
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
          >· {{ q ? `匹配 ${matched.length}/${rows.length}` : rows.length }} 个符号<template
            v-if="!q"
            > · {{ exportedCount }} 个导出</template
          ></span
        >
      </div>

      <!-- 过滤（决策 #1491）：95 个符号靠滚是折磨；这里是 IDE 的标准形状 -->
      <div v-if="!loading && !err && rows.length" class="sym-f">
        <input
          ref="inputEl"
          v-model="q"
          class="sym-q"
          type="text"
          spellcheck="false"
          :placeholder="`过滤 ${rows.length} 个符号…（直接打字即可）`"
          @keydown="onNavKey"
        />
      </div>

      <div v-if="loading" class="sym-empty">读取中…</div>
      <div v-else-if="err" class="sym-empty err">{{ err }}</div>
      <div v-else-if="!rows.length" class="sym-empty">这个文件里没有可列的顶层声明</div>
      <div v-else-if="!matched.length" class="sym-empty">没有匹配「{{ q }}」的符号</div>

      <div v-else class="sym-list">
        <section v-for="g in groups" :key="g.kind" class="sym-g">
          <div class="sym-gh">{{ g.kind }}<span class="sym-gn">{{ g.items.length }}</span></div>
          <button
            v-for="r in g.items"
            :key="`${r.line}:${r.name}`"
            class="sym-i"
            :class="{ dim: !r.exported, cur: flat[cursor] === r }"
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
  /* ★决策 #1483：`max-height` 由模型按"可用底边"算出，必须是**含边框**的高度，
     否则 content-box 下会多出 2px（上/下各 1px 边框）——实测正好把底边顶出状态栏 2px。 */
  box-sizing: border-box;
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
/* 过滤框（决策 #1491）：无边框、贴面板底色的"隐形输入"，不抢视觉 */
.sym-f {
  padding: 0 var(--sp3) var(--sp2);
  border-bottom: 1px solid var(--border-subtle);
}
.sym-q {
  width: 100%;
  height: 22px;
  padding: 0 var(--sp2);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: var(--bg-surface);
  color: var(--fg);
  font: 11px/1.4 inherit;
  outline: none;
}
.sym-q:focus {
  border-color: var(--accent);
}
.sym-q::placeholder {
  color: var(--fg-subtle);
}
/* 键盘光标行：与 hover 同色，另加左侧 2px 强调条（与文件树选中态同一套语汇） */
.sym-i.cur {
  background: var(--bg-overlay);
  box-shadow: inset 2px 0 0 var(--accent);
}
.sym-list {
  overflow: auto;
  padding: var(--sp1) 0 var(--sp2);
}
.sym-gh {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 18px;
  padding: 0 var(--sp3);
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
  align-items: center;
  gap: var(--sp2);
  width: 100%;
  /* ★决策 #1485：行高走统一档位（标准 24px）。原来用 `padding: 2px` + line-height
     撑出 ~20.5px，与文件树的 24px 不一致 —— hover 背景块在两个面板里高低不同。 */
  height: var(--row-h, 24px);
  padding: 0 var(--sp3);
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
