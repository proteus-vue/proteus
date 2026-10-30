<script setup lang="ts">
/**
 * TermPane.vue —— **一个终端视图**（决策 #1386）
 *
 * 【为什么要把它从 TerminalPanel 拆出来】
 * VS Code 的终端工具栏是**面板级**的：一条横跨所有终端，拆分后下面才并排两个视图。
 * 我们之前把"工具栏 + 会话 + 渲染"塞在一个组件里，于是拆分只能靠"两个组件实例"，
 * 结果每条工具栏各占一栏、也没有统一的会话列表 —— 与操作习惯不符。
 * 现在：`TerminalPanel` 管**会话与工具栏**（一条），`TermPane` 只管**画一个终端的网格 + 收键盘**。
 *
 * 【职责边界】只做三件事：
 *   ① 按 `term.grid` 画字符网格（含查找高亮）与光标；
 *   ② 收键盘/输入法/粘贴 → `emit('input', 字节)`（字节语义在这里生成，与 pty 无关）；
 *   ③ 量自己的格子数 → `emit('resize', {cols, rows})`（父组件据此调 pty resize）。
 * 【它不知道】会话 id 怎么来的、pty 怎么开的、rt 事件怎么订阅 —— 那些都在父组件。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { runsOf, type Terminal } from '../terminal'

const props = defineProps<{
  term: Terminal
  /** 让父组件区分多个 pane（同一份 ver 变化都会重绘） */
  ver: number
  /** 查找词与匹配规则（父组件统一持有，所有 pane 共用同一份查询） */
  findQ?: string
  findCase?: boolean
  findWord?: boolean
  findRegex?: boolean
  /** 是否有焦点（决定是否画光标：拆分时只有聚焦那栏闪，决策 #1385） */
  focused?: boolean
  /** 是否显示光标（拆分时由父组件按"是否聚焦"算好传进来） */
  showCursor?: boolean
  /** 字号（px）：父组件用 ⌘= / ⌘- 调整后传进来，本组件据此**重新量格子** */
  font?: number
  /** DOM id 前缀：主栏用 `term`（门禁 ⑦ 依赖 #termBody/#termGrid/#termInput/#termCursor），
   *  副栏用 `termSide` 避免重复 id */
  idPrefix?: string
}>()

const emit = defineEmits<{
  input: [data: string]
  resize: [cols: number, rows: number]
  focus: []
}>()

const pre = computed(() => props.idPrefix ?? 'term')
const bodyEl = ref<HTMLElement>()
/** 本栏**是否真的持有键盘焦点**（决策 #1399）：光标只在聚焦时实心闪烁。
    之前单栏无条件画光标 ⇒ 点进编辑器后终端光标还在闪，误导"输入会进终端"。 */
const hasFocus = ref(false)
const inputEl = ref<HTMLTextAreaElement>()
const cell = ref({ w: 7.2, h: 16 })

/* ★滚动是**本组件内部**的视口变化，不能依赖父组件的 ver（那是 pty 输出驱动） */
const localVer = ref(0)

const rows = computed(() => {
  void props.ver
  void localVer.value
  return props.term.visibleRows().map((row) => runsOf(row))
})
const cols = computed(() => {
  void props.ver
  return props.term.cols
})
const rowsCount = computed(() => {
  void props.ver
  return props.term.rows
})

/* ── 查找高亮（与父组件一致的规则；命中区间按整行算，跨 run 也能命中）────────── */
function matchRanges(text: string): [number, number][] {
  const raw = props.findQ ?? ''
  if (!raw) return []
  const out: [number, number][] = []
  if (props.findRegex) {
    let re: RegExp
    try {
      re = new RegExp(raw, props.findCase ? 'g' : 'gi')
    } catch {
      return []
    }
    for (const m of text.matchAll(re)) {
      if (m.index === undefined || !m[0].length) continue
      out.push([m.index, m.index + m[0].length])
    }
    return out
  }
  const hay = props.findCase ? text : text.toLowerCase()
  const needle = props.findCase ? raw : raw.toLowerCase()
  let i = 0
  while (i <= hay.length - needle.length) {
    const k = hay.indexOf(needle, i)
    if (k < 0) break
    const end = k + needle.length
    const wb = (idx: number) => idx < 0 || idx >= hay.length || !/[A-Za-z0-9_$]/.test(hay[idx])
    if (!props.findWord || (wb(k - 1) && wb(end))) out.push([k, end])
    i = k + Math.max(1, needle.length)
  }
  return out
}

function segmentsOf(line: { text: string; [k: string]: unknown }[]) {
  const full = line.map((r) => r.text).join('')
  const ranges = matchRanges(full)
  if (!ranges.length) return line.map((r) => ({ text: r.text, style: runStyle(r), hit: false }))
  const out: { text: string; style: Record<string, string>; hit: boolean }[] = []
  let base = 0
  for (const r of line) {
    const t = r.text
    const style = runStyle(r)
    let i = 0
    while (i < t.length) {
      const abs = base + i
      const hit = ranges.find(([a, b]) => abs >= a && abs < b)
      if (!hit) {
        const next = ranges.find(([a]) => a > abs)
        const stop = next ? Math.min(t.length, next[0] - base) : t.length
        out.push({ text: t.slice(i, stop), style, hit: false })
        i = stop
      } else {
        const stop = Math.min(t.length, hit[1] - base)
        out.push({ text: t.slice(i, stop), style, hit: true })
        i = stop
      }
    }
    base += t.length
  }
  return out
}

function runStyle(r: { fg: string | null; bg: string | null; bold: boolean; dim: boolean; italic: boolean; underline: boolean }) {
  const s: Record<string, string> = {}
  if (r.fg) s.color = r.fg
  if (r.bg) s.background = r.bg
  if (r.bold) s.fontWeight = '600'
  if (r.dim) s.opacity = '0.65'
  if (r.italic) s.fontStyle = 'italic'
  if (r.underline) s.textDecoration = 'underline'
  return s
}

/* ── 光标位置 ───────────────────────────────────────────────────────────── */
const cursor = computed(() => {
  void props.ver
  const t = props.term
  return {
    show: t.cursorVisible !== false && t.viewOffset === 0,
    left: t.cx * cell.value.w,
    top: t.cy * cell.value.h,
  }
})

/* ── 尺寸：量一个字多宽，算出 cols/rows 并上报 ─────────────────────────── */
function measure() {
  const el = document.getElementById((props.idPrefix ?? 'term') + 'Ruler')
  if (!el) return
  const r = el.getBoundingClientRect()
  const w = r.width > 0 ? r.width / 40 : 7.2
  const h = r.height > 0 ? r.height : 16
  if (Math.abs(w - cell.value.w) > 0.05 || Math.abs(h - cell.value.h) > 0.5) {
    cell.value = { w, h }
  }
}

function gridSize() {
  const el = bodyEl.value
  if (!el) return { cols: 80, rows: 24 }
  const pad = 10
  return {
    cols: Math.max(20, Math.floor((el.clientWidth - pad) / cell.value.w)),
    rows: Math.max(4, Math.floor((el.clientHeight - pad) / cell.value.h)),
  }
}

function syncSize() {
  measure()
  const { cols: c, rows: r } = gridSize()
  if (c < 8 || r < 3) return
  if (c !== props.term.cols || r !== props.term.rows) {
    props.term.resize(c, r)
    emit('resize', c, r)
  }
}

/* ★字号变了必须重新量：格子尺寸来自标尺的 40 个 W，`font-size` 一变 cell 就变，
   不重量就会「画面按旧字号排、pty 按旧 cols 断行」（决策 #1397）。 */
watch(
  () => props.font,
  async () => {
    await nextTick()
    measure()
    syncSize()
  },
)

let ro: ResizeObserver | null = null
onMounted(() => {
  syncSize()
  if (bodyEl.value) {
    ro = new ResizeObserver(() => syncSize())
    ro.observe(bodyEl.value)
  }
})
onBeforeUnmount(() => ro?.disconnect())

/* ── 键盘 → 字节（与 pty 无关，纯粹终端语义）────────────────────────────── */
const SEQ: Record<string, string> = {
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Home: '\x1b[H',
  End: '\x1b[F',
  PageUp: '\x1b[5~',
  PageDown: '\x1b[6~',
  Insert: '\x1b[2~',
  Delete: '\x1b[3~',
  Enter: '\r',
  Backspace: '\x7f',
  Tab: '\t',
  Escape: '\x1b',
}

/** 滚轮回看历史（决策 #1393）：每格 3 行，与主流终端一致；到顶/到底不再吞事件 */
function onWheel(e: WheelEvent) {
  const step = e.deltaY > 0 ? -3 : 3
  if (props.term.scrollView(step)) {
    e.preventDefault()
    localVer.value++
  }
}

function onKeyDown(e: KeyboardEvent) {
  /* 一敲键就回到实时（否则用户以为打字没反应） */
  if (props.term.viewOffset !== 0) {
    props.term.resetView()
    localVer.value++
  }
  if (e.metaKey && ['c', 'v', 'a', 'x'].includes(e.key.toLowerCase())) return
  if (e.ctrlKey && !e.metaKey && !e.altKey) {
    const k = e.key
    if (k.length === 1) {
      const code = k.toLowerCase().charCodeAt(0)
      if (code >= 97 && code <= 122) {
        e.preventDefault()
        emit('input', String.fromCharCode(code - 96))
        return
      }
      if (k === '[') {
        e.preventDefault()
        emit('input', '\x1b')
        return
      }
      if (k === '\\') {
        e.preventDefault()
        emit('input', '\x1c')
        return
      }
    }
  }
  const seq = SEQ[e.key]
  if (seq) {
    e.preventDefault()
    emit('input', (e.altKey ? '\x1b' : '') + seq)
    return
  }
  if (e.altKey && e.key.length === 1) {
    e.preventDefault()
    emit('input', '\x1b' + e.key)
  }
}

/** 打印字符入口：`beforeinput` 只取本次要插入的文本（`input`+清值会二次派发，决策 #1367） */
function onBeforeInput(e: InputEvent) {
  if (e.isComposing) return
  const d = e.data
  if (d == null) return
  e.preventDefault()
  if (d) emit('input', d)
}

function onCompositionEnd(e: CompositionEvent) {
  const d = e.data
  if (d) emit('input', d)
}

function focus() {
  inputEl.value?.focus()
}
defineExpose({ focus, syncSize })
</script>

<template>
  <div class="tp" :style="{ '--fs-term': (props.font ?? 12) + 'px' }" @click="focus">
    <!-- 标尺：只用来量"一个字多宽"，不参与布局（每栏各一个，避免量到别栏的字体） -->
    <span class="ruler" :id="pre + 'Ruler'" aria-hidden="true">WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW</span>

    <div
      class="body"
      :id="pre + 'Body'"
      ref="bodyEl"
      :style="{ '--cw': cell.w + 'px', '--ch': cell.h + 'px' }"
      @click="focus"
      @wheel.prevent="onWheel"
    >
      <div class="grid" :id="pre + 'Grid'" :style="{ width: cols * cell.w + 'px', height: rowsCount * cell.h + 'px' }">
        <div v-for="(line, y) in rows" :key="y" class="trow" :style="{ height: cell.h + 'px' }">
          <span
            v-for="(seg, i) in segmentsOf(line)"
            :key="i"
            :style="seg.style"
            :class="{ hit: seg.hit }"
            >{{ seg.text }}</span
          >
        </div>
        <!-- 光标：拆分时只有聚焦那栏由父组件传 showCursor=true -->
        <div
          v-if="cursor.show && (props.showCursor ?? true) && hasFocus"
          class="cur"
          :id="pre + 'Cursor'"
          :style="{ left: cursor.left + 'px', top: cursor.top + 'px' }"
        />
        <!-- 失焦时画**空心**光标：既告诉用户"光标在这"，又不暗示"现在能直接打字"（不闪） -->
        <div
          v-else-if="cursor.show && (props.showCursor ?? true)"
          class="cur hollow"
          :id="pre + 'CursorIdle'"
          :style="{ left: cursor.left + 'px', top: cursor.top + 'px' }"
        />
      </div>
    </div>

    <!-- 输入收集器：不可见但**真实可聚焦**（display:none 收不到键盘） -->
    <textarea
      ref="inputEl"
      :id="pre + 'Input'"
      class="input"
      spellcheck="false"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      @keydown="onKeyDown"
      @beforeinput="onBeforeInput"
      @compositionend="onCompositionEnd"
      @focus="((hasFocus = true), emit('focus'))"
      @blur="hasFocus = false"
    />
  </div>
</template>

<style scoped>
.tp {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--bg-canvas);
}
.ruler {
  position: absolute;
  visibility: hidden;
  white-space: pre;
  font: var(--fs-term, 12px) / 1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  pointer-events: none;
}
.body {
  position: absolute;
  inset: 0;
  padding: 5px;
  overflow: auto;
}
.grid {
  position: relative;
  font: var(--fs-term, 12px) / 1 var(--term-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-variant-ligatures: none;
}
.trow {
  display: block;
  white-space: pre;
  line-height: var(--ch);
}
.trow span.hit {
  background: rgb(250 204 21 / 32%);
  border-radius: 2px;
  color: var(--fg);
}
.cur.hollow {
  background: transparent;
  box-shadow: inset 0 0 0 1px rgb(230 232 238 / 55%);
  mix-blend-mode: normal;
  animation: none;
}
.cur {
  position: absolute;
  width: var(--cw);
  height: var(--ch);
  background: rgba(230, 232, 238, 0.75);
  mix-blend-mode: difference;
  pointer-events: none;
  animation: blink 1.06s steps(1) infinite;
}
@keyframes blink {
  0%, 50% { opacity: 1; }
  50.01%, 100% { opacity: 0; }
}
.input {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  opacity: 0;
  resize: none;
  pointer-events: none;
}
</style>
