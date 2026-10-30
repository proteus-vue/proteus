<script setup lang="ts">
/**
 * TerminalPanel.vue —— **终端面板**（决策 #1386 重构）
 *
 * 【结构对齐 VS Code】
 *   ① 一条**面板级工具栏**横跨所有终端（不再"每个终端一条"）；
 *   ② 拆分后左右两栏各渲染一个 `TermPane`，工具栏仍在最上方；
 *   ③ 工具栏最左是**会话列表**（▾）+ 标签，拆分后也能看到全部会话。
 *
 * 【职责划分】
 *   · 本组件：会话表（pty 生命周期）、事件订阅与分发、工具栏、查找、拆分布局；
 *   · `TermPane`：只画一个终端的字符网格 + 收键盘（它不知道 pty 存在）。
 * 【为什么这样分】上一版把"工具栏+会话+渲染"塞进同一个组件，拆分只能靠两个组件实例，
 *   于是每条工具栏各占一栏、也没有统一会话列表 —— 与操作习惯不符。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Terminal } from '../terminal'
import { hasBridge, onTermData, onTermExit, termClose, termOpen, termResize, termWrite } from '../bridge'
import { pushToast } from '../toast'
import PButton from '../ui/PButton.vue'
import PInput from '../ui/PInput.vue'
import PSelect from '../ui/PSelect.vue'
import TermPane from './TermPane.vue'
import Icon from '../ui/Icon.vue'
import { saveLayout, termFont, termShell, termSplit, termSplitW } from '../layout'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ close: []; maximize: [] }>()

/* ── 会话表 ─────────────────────────────────────────────────────────────── */
type Sess = { id: number; title: string; term: Terminal }
const sessions = shallowRef<Sess[]>([])
/** ★**栏位模型**（决策 #1387）：`panes` 是**有序**的会话 id 列表，一个元素 = 一栏。
    支持**无限横向拆分**（VS Code 的 split 也是这种"列表/树"结构，我们这里用扁平列表）。
    `focusIdx` 指向键盘当前落在哪一栏。 */
const panes = ref<number[]>([])
/** 每栏宽度（px，0 表示 flex 平均分）；拖动某个分隔条只改它左边那栏 */
const paneBasis = ref<number[]>([])
const focusIdx = ref(0)
const ver = ref(0)
const opened = ref(false)
const exited = ref(false)

const splitCount = computed(() => panes.value.length)
const splitOn = computed(() => panes.value.length > 1)
const sid = computed(() => panes.value[focusIdx.value] ?? panes.value[0] ?? 0)
/** 每栏至少这么宽；不够宽就不再允许拆（否则挤成一条缝） */
const MIN_PANE_W = 220
const termOf = (id: number) => sessions.value.find((s) => s.id === id)?.term

/* ── 开启会话 ───────────────────────────────────────────────────────────── */
/* shell 选择持久化（决策 #1405）：真实状态在 layout.termShell，这里只是别名，避免大改模板 */
const shellSel = termShell
const shellOpts = [
  { value: 'zsh', label: 'zsh' },
  { value: 'bash', label: 'bash' },
  { value: 'sh', label: 'sh' },
]

let opening = false
/** 桩环境下的本地会话号（真机用 Rust 返回的 id） */
const TerminalPanelLocalSeq = ref(0)
async function openSession() {
  if (opening) return
  opening = true
  try {
    await doOpen()
  } finally {
    opening = false
  }
}

async function doOpen() {
  if (!hasBridge()) {
    pushToast('终端需要在 Studio 里打开（浏览器直开没有 pty）', 'err')
    return
  }
  /* 初始尺寸给个保守值，真正的 cols/rows 由 TermPane 量完再 `term_resize` 校准 */
  const c = 100
  try {
    /* ★`term_open` 在浏览器桩里可能返回空（没有真 pty）⇒ 给一个**本地 id**，
       否则"会话必须带 id 才渲染"会让终端整块不显示（门禁 ⑦ 就是这么红的第一版）。
       真机路径返回的是 Rust 的 u64，Number() 之后照常。 */
    const localSeq = (TerminalPanelLocalSeq.value += 1)
    const id = Number(await termOpen(c, 24, shellSel.value)) || 1000 + localSeq
    const t = new Terminal(c, 24)
    sessions.value = [...sessions.value, { id, title: shellSel.value, term: t }]
    /* 插到**聚焦栏右侧**（与 VS Code 的"在活动终端右边拆分"一致） */
    const at = panes.value.length ? focusIdx.value + 1 : 0
    panes.value = [...panes.value.slice(0, at), id, ...panes.value.slice(at)]
    focusIdx.value = at
    ver.value++
    opened.value = true
    exited.value = false
    void nextTick(() => focusCurrent())
  } catch (e) {
    pushToast(`开终端失败：${String((e as Error)?.message ?? e)}`, 'err')
  }
}

function newSession() {
  void openSession()
}

function switchTo(id: number) {
  const i = panes.value.indexOf(id)
  if (i >= 0) {
    /* 已在该列表里 ⇒ 只是把焦点移过去（标签/列表点击都走这条） */
    focusIdx.value = i
  } else if (panes.value.length) {
    /* 不在任何栏里（被关掉了）⇒ 替换当前栏 */
    const next = [...panes.value]
    next[focusIdx.value] = id
    panes.value = next
  } else {
    panes.value = [id]
    focusIdx.value = 0
  }
  exited.value = false
  ver.value++
  void nextTick(() => focusCurrent())
}

async function closeSession(id: number) {
  /* ★**先更新 UI，再异步关 pty**（决策 #1392）：
     原实现 `await termClose(id)` 在前 —— 真机上这个 IPC 走 spawn_blocking（有界 300ms，
     极端情况更久），期间列表/面板**一点变化都没有**，用户看到的就是"第一次点击无反应"，
     再点一次（第二次的 close 也许瞬间返回）才生效。
     现在：立刻从 sessions/panes 里摘掉（乐观更新），关 pty 丢到后台。 */
  const rest = sessions.value.filter((s) => s.id !== id)
  sessions.value = rest
  /* ★**补位而不是留空**（决策 #1391）：用户报"删除要点两次"，
     原因是删掉的会话如果正显示在某栏里，那一栏会变成空白 —— 看起来像"没删掉"。
     现在：该栏用"另一个还没上屏的会话"顶上；没有可顶的就收掉这一栏。 */
  const at = panes.value.indexOf(id)
  if (at >= 0) {
    const used = new Set(panes.value.filter((p) => p !== id))
    const spare = rest.find((x) => !used.has(x.id))
    const next = [...panes.value]
    if (spare) next[at] = spare.id
    else next.splice(at, 1)
    panes.value = next
  }
  if (focusIdx.value >= panes.value.length) focusIdx.value = Math.max(0, panes.value.length - 1)
  if (!panes.value.length) {
    termSplit.value = false
    opened.value = false
    void openSession()
  }
  ver.value++
  void termClose(id).catch(() => {})
}

/* ── pty → 网格 ─────────────────────────────────────────────────────────── */
let offData: (() => void) | null = null
let offExit: (() => void) | null = null
const lastSeq = new Map<number, number>()

onMounted(() => {
  offData = onTermData((id, d, seq) => {
    if (seq) {
      const seen = lastSeq.get(id) ?? 0
      if (seq <= seen) return
      lastSeq.set(id, seq)
    }
    /* ★`id=0` = 浏览器桩/旧 payload（不带会话 id）⇒ 落到**主栏会话**，
       否则门禁那种"直接派发 studio:term-data"的场景会被当成未知会话丢掉（实测必红）。 */
    const s =
      sessions.value.find((x) => x.id === id) ??
      (id === 0 ? sessions.value.find((x) => x.id === (panes.value[0] ?? 0)) : undefined)
    if (!s) return
    /* ★**只写一次**（决策 #1376）：这里曾残留第二处 write，导致整段输出重复、命令执行两次。 */
    s.term.write(d)
    ver.value++
  })
  offExit = onTermExit((id) => {
    if (panes.value.includes(id)) exited.value = true
  })
  if (props.active) void openSession()
})

onBeforeUnmount(() => {
  offData?.()
  offExit?.()
  for (const s of sessions.value) void termClose(s.id).catch(() => {})
})

watch(
  () => props.active,
  (v) => {
    if (v && !opened.value) void openSession()
    if (v) void nextTick(() => focusCurrent())
  },
)

/* ── 输入 / 尺寸（TermPane 上报）────────────────────────────────────────── */
const paneRefs = ref<(InstanceType<typeof TermPane> | null)[]>([])
function setPaneRef(i: number, el: unknown) {
  paneRefs.value[i] = el as InstanceType<typeof TermPane> | null
}

function focusCurrent() {
  paneRefs.value[focusIdx.value]?.focus()
}

let lastOut = { d: '', at: 0 }
async function writeToTerm(data: string, target = sid.value) {
  if (!hasBridge() || !data) return
  const now = performance.now()
  if (data === lastOut.d && now - lastOut.at < 4) return
  lastOut = { d: data, at: now }
  try {
    /* ★绝不重发用户输入（决策 #1366）：失败只重开会话，不把这一批再发一遍 */
    await termWrite(target, data)
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    if (msg.includes('终端未打开')) {
      opened.value = false
      void openSession()
    }
    pushToast(msg, 'err')
  }
}

/* ★按**该栏的会话 id** 发送/校准（不是"当前焦点栏"）：后台栏的 resize 也要落到自己身上 */
const onPaneInput = (id: number, data: string) => void writeToTerm(data, id)
const onPaneResize = (id: number, c: number, r: number) => {
  if (hasBridge()) void termResize(id, c, r).catch(() => {})
}

/* ── 工具栏动作 ─────────────────────────────────────────────────────────── */
const sendCtrl = (seq: string) => void writeToTerm(seq)

async function switchShell(v: 'zsh' | 'bash' | 'sh') {
  shellSel.value = v
  saveLayout()
  const cur = sid.value
  if (cur) await closeSession(cur)
  void openSession()
}

/** 拆分（决策 #1387）：**可无限横向拆**
    · 点一次 = 在聚焦栏右侧新开一栏（宽度不够就提示，不再硬塞）；
    · 已经拆过时，点同一按钮 = 合并回单栏（会话不关，仍留在标签/列表里）。 */
/** 拆分（决策 #1387）：**每次点都继续拆**（与 VS Code 一致），撤销靠每栏右上角的 ✕ */
function toggleSplit() {
  const roomy = (wrapEl.value?.clientWidth ?? 1200) / (panes.value.length + 1) >= MIN_PANE_W
  if (!roomy) {
    pushToast(`面板太窄，放不下第 ${panes.value.length + 1} 栏（每栏至少 ${MIN_PANE_W}px）`, 'err')
    return
  }
  termSplit.value = true
  void openSession()
}

/** 关掉某一栏（同时结束它的 pty —— 与 VS Code「关闭终端」一致） */
function closePane(idx: number) {
  const id = panes.value[idx]
  if (id) void closeSession(id)
}

const wrapEl = ref<HTMLElement>()

/** 拖动第 i 个分隔条：只改它**左边那栏**的像素宽（其余栏继续 flex 平分剩余空间） */
function startDragSplit(i: number, e: PointerEvent) {
  const wrap = (e.currentTarget as HTMLElement).parentElement
  if (!wrap) return
  const rect = wrap.getBoundingClientRect()
  const others = Math.max(0, panes.value.length - i - 1)
  const maxW = rect.width - others * MIN_PANE_W - 8 * (panes.value.length - 1)
  const move = (ev: PointerEvent) => {
    const w = Math.round(Math.min(Math.max(MIN_PANE_W, ev.clientX - rect.left), Math.max(MIN_PANE_W, maxW)))
    const next = [...paneBasis.value]
    next[i] = w
    paneBasis.value = next
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/* ── 标签拖拽排序（决策 #1403）────────────────────────────────────────────
 * 用原生 HTML5 drag：标签只有几个、不需要跨窗口拖拽，pointer 手写反而更多代码。
 * 拖拽只调整 `sessions` 的顺序（= 标签顺序 = 侧栏列表顺序），不动 pty 与会话 id。 */
const dragIdx = ref(-1)
const dropIdx = ref(-1)

function onDragStart(i: number, e: DragEvent) {
  dragIdx.value = i
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    /* Firefox/Safari 需要设置数据才会真正开始拖拽 */
    e.dataTransfer.setData('text/plain', String(i))
  }
}

function onDragOver(i: number, e: DragEvent) {
  if (dragIdx.value < 0) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropIdx.value = i
}

function onDragLeave(i: number) {
  if (dropIdx.value === i) dropIdx.value = -1
}

function onDrop(i: number) {
  const from = dragIdx.value
  dragIdx.value = -1
  dropIdx.value = -1
  if (from < 0 || from === i) return
  const arr = [...sessions.value]
  const [moved] = arr.splice(from, 1)
  arr.splice(i, 0, moved)
  sessions.value = arr
}

function onDragEnd() {
  dragIdx.value = -1
  dropIdx.value = -1
}

/* ── 会话列表（VS Code 那条 ▾）─────────────────────────────────────────── */
/** ★**常驻会话侧栏**（决策 #1389）：多会话时**自动出现**在右侧（不再需要点 ▾），
    当前会话行左侧有蓝条高亮，每项 hover 出现「重命名 / 删除」，宽度可拖（VS Code 同款）。 */
const listVisible = computed(() => sessions.value.length > 1)
const listW = ref(190)
const renamingId = ref(0)
const renameText = ref('')

function startRename(id: number) {
  renamingId.value = id
  renameText.value = sessions.value.find((s) => s.id === id)?.title ?? ''
  /* 侧栏列表与标签栏都会用到重命名 —— 选择器同时覆盖两处 */
  void nextTick(() =>
    document.querySelector<HTMLInputElement>('.litem input, .ttab .tinput')?.select(),
  )
}

function commitRename(id: number) {
  const t = renameText.value.trim()
  if (t) sessions.value = sessions.value.map((s) => (s.id === id ? { ...s, title: t } : s))
  renamingId.value = 0
}

/** 拖动会话列表的宽度（贴着 pane 区右边） */
function startDragList(e: PointerEvent) {
  const move = (ev: PointerEvent) => {
    const rect = (wrapEl.value as HTMLElement | undefined)?.getBoundingClientRect()
    if (!rect) return
    listW.value = Math.round(Math.min(Math.max(140, rect.right - ev.clientX), Math.min(420, rect.width - 260)))
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/* ── 查找 ───────────────────────────────────────────────────────────────── */
const findOpen = ref(false)
const findQ = ref('')
const fCase = ref(false)
const fWord = ref(false)
const fRegex = ref(false)
const searched = ref(false)
const hitRows = ref<number[]>([])
const hitIdx = ref(-1)
let findTimer: number | undefined

/** 与 TermPane 同一套匹配规则（这里只需"这一行有没有命中"，用于计数与上下跳） */
function matchLine(text: string): boolean {
  const raw = findQ.value
  if (!raw) return false
  if (fRegex.value) {
    try {
      return new RegExp(raw, fCase.value ? '' : 'i').test(text)
    } catch {
      return false
    }
  }
  const hay = fCase.value ? text : text.toLowerCase()
  const needle = fCase.value ? raw : raw.toLowerCase()
  let i = 0
  while (i <= hay.length - needle.length) {
    const k = hay.indexOf(needle, i)
    if (k < 0) return false
    const end = k + needle.length
    const wb = (idx: number) => idx < 0 || idx >= hay.length || !/[A-Za-z0-9_$]/.test(hay[idx])
    if (!fWord.value || (wb(k - 1) && wb(end))) return true
    i = k + Math.max(1, needle.length)
  }
  return false
}

function computeHits() {
  hitRows.value = []
  hitIdx.value = -1
  if (!findQ.value) return
  const t = termOf(sid.value)
  if (!t) return
  t.text()
    .split('\n')
    .forEach((text, y) => {
      if (matchLine(text)) hitRows.value.push(y)
    })
  if (hitRows.value.length) hitIdx.value = 0
}

function doFind(back = false) {
  if (!findQ.value) return
  if (!hitRows.value.length) {
    computeHits()
    searched.value = true
    if (!hitRows.value.length) return
    hitIdx.value = 0
    return
  }
  hitIdx.value = (hitIdx.value + (back ? -1 : 1) + hitRows.value.length) % hitRows.value.length
}

function toggleRule(which: 'case' | 'word' | 'regex') {
  if (which === 'case') fCase.value = !fCase.value
  else if (which === 'word') fWord.value = !fWord.value
  else fRegex.value = !fRegex.value
  computeHits()
  searched.value = true
}

watch(findQ, () => {
  hitRows.value = []
  hitIdx.value = -1
  searched.value = false
  if (findTimer) window.clearTimeout(findTimer)
  if (!findQ.value) return
  findTimer = window.setTimeout(() => {
    computeHits()
    searched.value = true
  }, 120)
})

function closeFind() {
  findOpen.value = false
  findQ.value = ''
  hitRows.value = []
  hitIdx.value = -1
  searched.value = false
  void nextTick(() => focusCurrent())
}

async function openFind() {
  findOpen.value = true
  await nextTick()
  const el = document.querySelector<HTMLInputElement>('.termfind input')
  el?.focus()
  el?.select()
}

/** 状态栏文本：`cols×rows · 运行中/已退出`（供人看，也被门禁 ⑦ 断言） */
const statText = computed(() => {
  void ver.value
  const t = termOf(sid.value)
  const c = t?.cols ?? 0
  const r = t?.rows ?? 0
  return `${c}×${r} · ${exited.value ? '已退出' : '运行中'}`
})

/** 终端面板内的快捷键（决策 #1394）：
 *  · ⌘⇧T 新建会话 · ⌘F 查找（原有）
 *  · ⌘\ 拆分（在右侧新开一栏，VS Code 的 split 键位）
 *  · ⌘W 关闭**当前栏**的会话（面板里按才生效，不会误关窗口）
 *  · ⌘1…⌘9 切到第 N 个会话 · ⌘⇧[ / ⌘⇧] 上一个/下一个会话
 */
function onPanelKey(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.shiftKey && e.key.toLowerCase() === 't') {
    e.preventDefault()
    e.stopPropagation()
    newSession()
    return
  }
  if (mod && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    e.stopPropagation()
    void openFind()
    return
  }
  if (mod && (e.key === '\\' || e.key === '|')) {
    e.preventDefault()
    e.stopPropagation()
    toggleSplit()
    return
  }
  /* 字号缩放（决策 #1397）：⌘= 放大 / ⌘- 缩小 / ⌘0 复位。与浏览器缩放无关，只影响终端网格 */
  if (mod && (e.key === '=' || e.key === '+')) {
    e.preventDefault()
    e.stopPropagation()
    termFont.value = Math.min(22, termFont.value + 1)
    return
  }
  if (mod && e.key === '-') {
    e.preventDefault()
    e.stopPropagation()
    termFont.value = Math.max(9, termFont.value - 1)
    return
  }
  if (mod && e.key === '0') {
    e.preventDefault()
    e.stopPropagation()
    termFont.value = 12
    return
  }
  /* ⌘K 清屏（决策 #1405）：与 VS Code 一致发 Ctrl-L，**保留回滚缓冲**（还能往上翻翻旧输出） */
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    e.stopPropagation()
    void sendCtrl('\x0c')
    return
  }
  if (mod && e.key.toLowerCase() === 'w') {
    e.preventDefault()
    e.stopPropagation()
    const cur = sid.value
    if (cur) void closeSession(cur)
    return
  }
  if (mod && !e.shiftKey && /^[1-9]$/.test(e.key)) {
    const idx = Number(e.key) - 1
    const target = sessions.value[idx]
    if (target) {
      e.preventDefault()
      e.stopPropagation()
      switchTo(target.id)
    }
    return
  }
  /* ★按下 Shift 时 `e.key` 是 `{` / `}`（US 布局），不是 `[` / `]` —— 两种都要认（踩过一次） */
  if (mod && e.shiftKey && ['[', ']', '{', '}'].includes(e.key)) {
    const i = sessions.value.findIndex((x) => x.id === sid.value)
    if (i >= 0) {
      const n = sessions.value.length
      const fwd = e.key === ']' || e.key === '}'
      const next = (i + (fwd ? 1 : -1) + n) % n
      e.preventDefault()
      e.stopPropagation()
      switchTo(sessions.value[next].id)
    }
  }
}

defineExpose({ focus: focusCurrent })
</script>

<template>
  <div
    class="termwrap"
    id="termWrap"
    @keydown.capture="onPanelKey"
    :style="{ '--fs-term': termFont + 'px' }"
  >
    <!-- ★面板级工具栏：一条，横跨左右两栏（VS Code 同款布局） -->
    <div class="termbar" @click.stop>
      <div class="ttabs">
        <button
          v-for="(s, ti) in sessions"
          :key="s.id"
          class="ttab"
          :class="{ on: panes.includes(s.id), drag: dragIdx === ti, over: dropIdx === ti && dragIdx !== ti }"
          :title="`${s.title} · 会话 ${s.id}（可拖动排序，双击重命名）`"
          draggable="true"
          @click="switchTo(s.id)"
          @dblclick.stop="startRename(s.id)"
          @dragstart="onDragStart(ti, $event)"
          @dragover.prevent="onDragOver(ti, $event)"
          @dragleave="onDragLeave(ti)"
          @drop.prevent="onDrop(ti)"
          @dragend="onDragEnd"
        >
          <input
            v-if="renamingId === s.id"
            v-model="renameText"
            class="tinput"
            @click.stop
            @keydown.enter.prevent="commitRename(s.id)"
            @keydown.esc.prevent="renamingId = 0"
            @blur="commitRename(s.id)"
          />
          <span v-else class="tname">{{ s.title }}</span>
          <span class="tx" title="关闭这个终端" @click.stop="closeSession(s.id)">✕</span>
        </button>
        <PButton size="sm" title="新建终端（⌘⇧T）" @click="newSession"><Icon name="plus" :size="12" /></PButton>
      </div>

      <span class="tfill" />
      <PSelect
        :model-value="shellSel"
        :options="shellOpts"
        size="sm"
        title="切换 shell（会重开当前栏的会话）"
        :width="70"
        @update:model-value="switchShell($event as 'zsh' | 'bash' | 'sh')"
      />
      <PButton size="sm" title="终止当前命令（Ctrl-C）" @click="sendCtrl('\x03')">终止</PButton>
      <PButton size="sm" title="清屏（Ctrl-L）" @click="sendCtrl('\x0c')">清屏</PButton>
      <PButton size="sm" :active="findOpen" title="在终端里查找" @click="findOpen = !findOpen">查找</PButton>
      <PButton size="sm" :active="splitOn" title="拆分终端（在右侧新开一栏）" @click="toggleSplit">
        <Icon name="split" :size="12" />
      </PButton>
      <PButton size="sm" title="最大化 / 还原（⌘⇧J）" @click="emit('maximize')">
        <Icon name="maximize" :size="12" />
      </PButton>
      <PButton size="sm" variant="ghost" title="关闭面板（⌘J）" @click="emit('close')">
        <Icon name="close" :size="12" />
      </PButton>
    </div>

    <div v-if="findOpen" class="termfind" @click.stop>
      <div class="findbox">
        <PInput
          v-model="findQ"
          placeholder="查找（↑↓ 或 Enter 切换命中）"
          @keydown.enter.prevent="doFind($event.shiftKey)"
          @keydown.esc.prevent="closeFind"
        />
        <div class="frules" @click.stop>
          <button class="frule" :class="{ on: fCase }" title="区分大小写" @click="toggleRule('case')">Aa</button>
          <button class="frule" :class="{ on: fWord }" title="全字匹配" @click="toggleRule('word')">
            <span class="ab">ab</span>
          </button>
          <button class="frule" :class="{ on: fRegex }" title="正则表达式" @click="toggleRule('regex')">.*</button>
        </div>
      </div>
      <span class="fcount">{{
        hitRows.length ? `${hitIdx + 1}/${hitRows.length}` : searched && findQ.trim() ? '无命中' : ''
      }}</span>
      <PButton size="sm" title="上一个（⇧Enter）" :disabled="!hitRows.length" @click="doFind(true)">↑</PButton>
      <PButton size="sm" title="下一个（Enter）" :disabled="!hitRows.length" @click="doFind(false)">↓</PButton>
      <PButton size="sm" title="关闭查找（Esc）" @click="closeFind">✕</PButton>
    </div>

    <div class="tmain">
      <div class="tpanes" ref="wrapEl">
      <template v-for="(pid, idx) in panes" :key="pid">
        <div
          v-if="idx > 0"
          class="vsplit"
          title="拖动调整左栏宽度"
          @pointerdown="startDragSplit(idx - 1, $event)"
        />
        <div
          class="tpane"
          :style="paneBasis[idx] ? { flex: `0 0 ${paneBasis[idx]}px` } : undefined"
          @click="focusIdx = idx"
        >
          <button v-if="panes.length > 1" class="pclose" title="关闭这一栏" @click.stop="closePane(idx)">
            ✕
          </button>
          <TermPane
            v-if="termOf(pid)"
            :ref="(el) => setPaneRef(idx, el)"
            :id-prefix="idx === 0 ? 'term' : 'termSide' + idx"
            :term="termOf(pid)!"
            :ver="ver"
            :font="termFont"
            :find-q="findQ"
            :find-case="fCase"
            :find-word="fWord"
            :find-regex="fRegex"
            :show-cursor="focusIdx === idx"
            @input="(d: string) => onPaneInput(pid, d)"
            @resize="(c: number, r: number) => onPaneResize(pid, c, r)"
            @focus="focusIdx = idx"
          />
        </div>
      </template>
      </div>

      <!-- ★常驻会话侧栏（决策 #1389）：**多会话时自动出现**，不用点；宽度可拖 -->
      <template v-if="listVisible">
        <div class="tlistdrag" title="拖动调整列表宽度" @pointerdown="startDragList" />
        <div class="tlist" :style="{ width: listW + 'px' }">
          <div
            v-for="s in sessions"
            :key="s.id"
            class="litem"
            :class="{ on: s.id === sid, inuse: panes.includes(s.id) }"
            @click="switchTo(s.id)"
            @dblclick="startRename(s.id)"
          >
            <Icon class="licon" name="terminal" :size="15" />
            <input
              v-if="renamingId === s.id"
              v-model="renameText"
              class="linput"
              @click.stop
              @keydown.enter.prevent="commitRename(s.id)"
              @keydown.esc.prevent="renamingId = 0"
              @blur="commitRename(s.id)"
            />
            <span v-else class="lname">{{ s.title }}</span>
            <button class="lact" title="重命名" @pointerdown.stop @click.stop="startRename(s.id)">
              <Icon name="pencil" :size="14" />
            </button>
            <button class="lact danger" title="关闭这个终端" @pointerdown.stop @click.stop="closeSession(s.id)">
              <Icon name="trash" :size="14" />
            </button>
          </div>
        </div>
      </template>
    </div>

    <div class="termstat">
      <!-- ★`#termStat` 的文本必须是 `146×12 · 运行中`（门禁 ⑦ 用锚定正则校验）；
           拆分标记放在**它外面**，别污染这个判据。 -->
      <span v-if="splitOn" class="tbadge">拆分·{{ panes.length }}栏</span>
      <span id="termStat">{{ statText }}</span>
    </div>
  </div>
</template>

<style scoped>
.termwrap {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-canvas);
}
.termbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  flex: none;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 11px;
  color: var(--fg-dim);
}
.tfill { flex: 1; }

/* 会话列表 */
.slistwrap { position: relative; }
.slist {
  position: absolute;
  z-index: 30;
  left: 0;
  top: calc(100% + 4px);
  min-width: 190px;
  padding: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 7px;
  box-shadow: 0 10px 26px rgb(0 0 0 / 40%);
}
.sitem {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}
.sitem:hover { background: var(--bg-overlay); color: var(--fg); }
.sitem.on { color: var(--fg); }
.sitem.new { color: var(--fg-subtle); }
.sdot { width: 6px; height: 6px; border-radius: 50%; background: var(--fg-subtle); flex: none; }
.sdot.live { background: #4ade80; }
.sname { flex: 1; }
.sid { color: var(--fg-subtle); font-size: 10px; }

/* 标签 */
.ttabs { display: flex; align-items: center; gap: 2px; max-width: 40%; overflow-x: auto; scrollbar-width: none; }
.ttabs::-webkit-scrollbar { display: none; }
.ttab {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 5px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--fg-subtle);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.ttab:hover { background: var(--bg-overlay); color: var(--fg-muted); }
.ttab.on { background: var(--bg-elevated); border-color: var(--border-subtle); color: var(--fg); }
/* 拖拽中的标签与落点指示（左侧 2px 竖条，和会话侧栏的高亮语汇一致） */
.ttab .tinput {
  width: 78px;
  height: 16px;
  padding: 0 3px;
  border: 1px solid var(--accent);
  border-radius: 3px;
  background: var(--bg-canvas);
  color: var(--fg);
  font: inherit;
  font-size: 11px;
}
.ttab.drag { opacity: .45; }
.ttab.over { border-left: 2px solid var(--accent); padding-left: 3px; }
.ttab .tx { opacity: 0.45; font-size: 9px; }
.ttab .tx:hover { opacity: 1; color: #f87171; }

/* 查找 */
.termfind {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto auto;
  gap: 6px;
  align-items: center;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-subtle);
  flex: none;
  overflow: hidden;
}
.findbox { position: relative; min-width: 0; width: 100%; }
.findbox :deep(input), .findbox :deep(.pinput) { padding-right: 78px; box-sizing: border-box; }
.frules { position: absolute; right: 3px; top: 50%; transform: translateY(-50%); display: flex; gap: 1px; }
.frule {
  height: 16px;
  min-width: 20px;
  padding: 0 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-subtle);
  font-size: 10px;
  line-height: 16px;
  cursor: pointer;
}
.frule:hover { background: var(--bg-overlay); color: var(--fg-muted); }
.frule.on { background: rgb(96 165 250 / 30%); color: var(--fg); }
.frule .ab { text-decoration: underline; text-underline-offset: 1px; }
.fcount { font-size: 10px; color: var(--fg-dim); min-width: 34px; text-align: right; }

/* 视图区 */
.tmain { display: flex; flex: 1; min-height: 0; }
.tpanes { display: flex; flex: 1; min-height: 0; position: relative; min-width: 0; }

/* ── 会话侧栏（VS Code 同款）────────────────────────────────────────── */
.tlistdrag { flex: 0 0 4px; cursor: col-resize; }
.tlistdrag:hover { background: var(--border-subtle); }
.tlist {
  flex: none;
  overflow: auto;
  padding: 4px 0;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-subtle);
}
.litem {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 6px 0 10px;
  font-size: 12px;
  color: var(--fg-muted);
  cursor: pointer;
  user-select: none;
}
.litem:hover { background: var(--bg-overlay); }
/* 当前会话：左侧蓝条 + 提亮（VS Code 的高亮样式） */
.litem.on { color: var(--fg); background: var(--bg-elevated); }
.litem.on::before {
  content: '';
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  width: 2px;
  border-radius: 1px;
  background: var(--accent);
}
.litem .licon { color: var(--fg-subtle); }
.litem.on .licon { color: var(--accent); }
.litem .licon { color: var(--fg-subtle); }
.lname { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.linput {
  flex: 1;
  min-width: 0;
  height: 18px;
  border: 1px solid var(--accent);
  border-radius: 3px;
  background: var(--bg-canvas);
  color: var(--fg);
  font: inherit;
  font-size: 11px;
  padding: 0 4px;
}
/* 操作按钮：hover 才显形，避免列表噪音 */
.lact {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--fg-subtle);
  opacity: 0;
  cursor: pointer;
}
.lact.danger:hover { background: rgb(248 113 113 / 14%); color: #f87171; }
.litem:hover .lact { opacity: 0.8; }
.lact:hover { opacity: 1; color: var(--fg); }
.tpane { position: relative; flex: 1 1 0; min-width: 0; }
.vsplit { flex: 0 0 6px; cursor: col-resize; border-left: 1px solid var(--border-subtle); }
.vsplit:hover { background: var(--border-subtle); }
/* 单栏关闭（>1 栏才出现）：hover 才显形，避免平时干扰 */
.pclose {
  position: absolute;
  z-index: 5;
  right: 4px;
  top: 4px;
  width: 18px;
  height: 18px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--fg-subtle);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity .12s ease;
}
.tpane:hover .pclose { opacity: 1; }
.pclose:hover { color: #f87171; border-color: #f87171; }
.termstat {
  flex: none;
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: var(--fg-subtle);
  padding: 1px 8px;
}
.tbadge { color: var(--accent); }
</style>
