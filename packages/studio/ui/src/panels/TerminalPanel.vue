<script setup lang="ts">
// TerminalPanel.vue —— 内置终端面板（决策 #1279）
//
// 【分工】屏幕模型/ANSI 解析在 `terminal.ts`（纯逻辑、可单测）；这里只做三件事：
//   ① 按容器尺寸量出 **字符格子数**，开/调 pty；② 把格子画成 DOM；③ 把键盘翻成终端字节。
//
// 【为什么键盘不交给浏览器】终端要的是**字节语义**（`\r` 不是 `\n`、Ctrl-C 是 `\x03`、
//   方向键是 `ESC[A`），不是"文本框里多了个字符"。所以用一个不可见的 textarea 收按键，
//   `keydown` 里自己翻译；只有输入法（中文）和粘贴才走 textarea 的 `input` 事件。
//
// 【为什么量"一个字符的宽高"】pty 只认 cols/rows。用等宽字体渲染一个隐藏标尺
//   （`W` × 40 + 行高）就能反推格子尺寸 —— 不写死 8px，因为用户可能改字号/缩放。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Terminal, runsOf } from '../terminal'
import { hasBridge, onTermData, onTermExit, termClose, termOpen, termResize, termWrite } from '../bridge'
import { pushToast } from '../toast'

/* ★`active` 由 App 传（`view === 'term'`）：面板用 v-show 常驻以保留会话，
   但**不能在启动时就开 shell** —— 用户可能整天不开终端，白起一个登录 shell
   （它会读 .zshrc、可能打印一堆东西）。所以"第一次真正显示"时才开。 */
const props = defineProps<{ active: boolean }>()
const opened = ref(false)
const bodyEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)

const term = shallowRef(new Terminal(80, 24))
/** 每次内容变化递增，触发重渲染（Terminal 内部改的是普通对象，不是响应式的） */
const ver = ref(0)
const exited = ref(false)
const cell = ref({ w: 7.2, h: 16 })
const focused = ref(false)
let offData: (() => void) | null = null
let offExit: (() => void) | null = null
let ro: ResizeObserver | null = null
let raf = 0

/** 行 → 合并后的样式段（减少 DOM 数量：4800 格通常只有几十个 span） */
const rows = computed(() => {
  void ver.value
  return term.value.grid.map((row) => runsOf(row))
})
/* ★★这两个 computed **必须显式依赖 `ver`**（2026-10-27 实测踩到）：
   `Terminal` 是普通对象（`shallowRef` 包着），改它的 `cols/rows` 字段**不会**触发响应式；
   而一个**没有任何响应式依赖**的 computed 会被永久缓存 —— 表现是：
   `term_open` 明明拿到了 146×47，界面却一直画 80×24（状态栏也一直显示 80×24），
   于是 shell 按 80 列排版、屏幕按 80 列渲染，而 pty 却是 146 列 ⇒ 折行全错。
   规矩：凡是读 `term.value.*` 的 computed，第一行都要 `void ver.value`。 */
const cols = computed(() => {
  void ver.value
  return term.value.cols
})
const rowsCount = computed(() => {
  void ver.value
  return term.value.rows
})
const cursor = computed(() => {
  void ver.value
  const t = term.value
  return {
    show: t.cursorVisible && !exited.value,
    left: t.cx * cell.value.w,
    top: t.cy * cell.value.h,
  }
})

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

/** 量一个字符的宽高：渲染 40 个 W 取平均（单字可能有字距误差），高度取标尺的行盒高 */
function measure() {
  const el = document.getElementById('termRuler')
  if (!el) return
  const r = el.getBoundingClientRect()
  // 标尺里是 'W'.repeat(40)，所以宽 / 40
  const w = r.width > 0 ? r.width / 40 : 7.2
  const h = r.height > 0 ? r.height : 16
  if (Math.abs(w - cell.value.w) > 0.05 || Math.abs(h - cell.value.h) > 0.5) {
    cell.value = { w, h }
  }
}

function gridSize() {
  const el = bodyEl.value
  if (!el) return { cols: 80, rows: 24 }
  const pad = 10 // 与 .termbody 的 padding 一致（左右各 10）
  return {
    cols: Math.max(20, Math.floor((el.clientWidth - pad) / cell.value.w)),
    rows: Math.max(4, Math.floor((el.clientHeight - pad) / cell.value.h)),
  }
}

async function openSession() {
  if (!hasBridge) {
    // 浏览器直开：给一段说明 + 本地回显，避免一片空白让人以为坏了
    term.value.reset(80, 24)
    term.value.write('\x1b[33m终端需要在 Studio 里打开\x1b[0m（浏览器直开时没有 pty）\r\n')
    ver.value++
    return
  }
  const { cols: c, rows: r } = gridSize()
  term.value.reset(c, r)
  ver.value++
  opened.value = true
  exited.value = false
  try {
    await termOpen(c, r)
  } catch (e) {
    pushToast(`开终端失败：${String((e as Error)?.message ?? e)}`, 'err')
  }
}

function scheduleRender() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    ver.value++
  })
}

function onResize() {
  measure()
  maybeOpen()
  if (!opened.value) return
  const { cols: c, rows: r } = gridSize()
  if (c === term.value.cols && r === term.value.rows) return
  term.value.resize(c, r)
  ver.value++
  if (hasBridge && !exited.value) void termResize(c, r).catch(() => {})
}

/* ─── 键盘 → 终端字节 ────────────────────────────────────────────────────
 * 只翻译"终端认识的键"；其余（Cmd+C/V/A）放行给浏览器，粘贴靠 input 事件。
 */
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

function send(data: string) {
  if (!data) return
  if (!hasBridge) return
  void termWrite(data).catch((e) => pushToast(String((e as Error)?.message ?? e), 'err'))
}

function onKeyDown(e: KeyboardEvent) {
  // 退出后按回车重开（比让用户按按钮快）
  if (exited.value && e.key === 'Enter') {
    e.preventDefault()
    void openSession()
    return
  }
  // Cmd+C / Cmd+V / Cmd+A 交给浏览器（复制选中文本、粘贴、全选）
  if (e.metaKey && ['c', 'v', 'a', 'x'].includes(e.key.toLowerCase())) return

  // Ctrl+字母 ⇒ 控制字符（Ctrl-C=0x03、Ctrl-D=0x04…）；Ctrl+[ 也有约定
  if (e.ctrlKey && !e.metaKey && !e.altKey) {
    const k = e.key
    if (k.length === 1) {
      const lower = k.toLowerCase()
      const code = lower.charCodeAt(0)
      if (code >= 97 && code <= 122) {
        e.preventDefault()
        send(String.fromCharCode(code - 96))
        return
      }
      if (k === '[') {
        e.preventDefault()
        send('\x1b')
        return
      }
      if (k === '\\') {
        e.preventDefault()
        send('\x1c')
        return
      }
    }
  }

  const seq = SEQ[e.key]
  if (seq) {
    e.preventDefault()
    // Alt+方向键 = 按词移动（ESC 前缀）
    send((e.altKey ? '\x1b' : '') + seq)
    return
  }
  // 可打印字符：交给 textarea 的 input 事件（这样输入法、组合键、粘贴都天然正确）
  if (e.altKey && e.key.length === 1) {
    e.preventDefault()
    send('\x1b' + e.key)
  }
}

/** 打印字符统一从这里进（物理键盘 + 输入法 + 粘贴三条路汇合） */
function onInput() {
  const el = inputEl.value
  if (!el) return
  const v = el.value
  if (!v) return
  el.value = ''
  send(v)
}

/** 懒开：`active` 且量得到真实尺寸时才开会话（隐藏时 clientHeight=0，开出来只有 20×4） */
function maybeOpen() {
  if (!props.active || opened.value) return
  if (!bodyEl.value || bodyEl.value.clientHeight < 40) return
  void openSession()
}

function focusInput() {
  inputEl.value?.focus()
}

onMounted(async () => {
  measure()
  await nextTick()
  offData = onTermData((d) => {
    term.value.write(d)
    scheduleRender()
  })
  offExit = onTermExit(() => {
    exited.value = true
    term.value.write('\r\n\x1b[2m[会话已结束，按回车重开]\x1b[0m\r\n')
    ver.value++
  })
  ro = new ResizeObserver(() => onResize())
  if (bodyEl.value) ro.observe(bodyEl.value)
  maybeOpen()
  if (props.active) focusInput()
})

watch(
  () => props.active,
  async (on) => {
    if (!on) return
    await nextTick()
    measure()
    maybeOpen()
    focusInput()
  },
)

onBeforeUnmount(() => {
  offData?.()
  offExit?.()
  ro?.disconnect()
  if (raf) cancelAnimationFrame(raf)
  // ★卸载时才关：视图切换不该杀 shell（用户经常在 code/term 之间来回切）
  if (hasBridge) void termClose().catch(() => {})
})

defineExpose({ focus: focusInput, term })
</script>

<template>
  <div class="termwrap" id="termWrap" @click="focusInput">
    <!-- 标尺：只用来量"一个等宽字符多大"，不参与布局 -->
    <span id="termRuler" class="termruler" aria-hidden="true">WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW</span>

    <div class="termbody" ref="bodyEl" id="termBody" :style="{ '--cw': cell.w + 'px', '--ch': cell.h + 'px' }">
      <div class="termgrid" :style="{ width: cols * cell.w + 'px', height: rowsCount * cell.h + 'px' }" id="termGrid">
        <div v-for="(line, y) in rows" :key="y" class="trow" :style="{ height: cell.h + 'px' }">
          <span v-for="(r, i) in line" :key="i" :style="runStyle(r)">{{ r.text }}</span>
        </div>
        <div v-if="cursor.show" class="tcur" :style="{ left: cursor.left + 'px', top: cursor.top + 'px' }" id="termCursor" />
      </div>
    </div>

    <!-- 输入收集器：不可见但**真实可聚焦**（不是 display:none，否则收不到键盘） -->
    <textarea
      ref="inputEl"
      id="termInput"
      class="terminput"
      spellcheck="false"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      @keydown="onKeyDown"
      @input="onInput"
      @focus="focused = true"
      @blur="focused = false"
    />

    <div v-if="!focused" class="termhint">点一下这里才能输入</div>
    <div v-if="exited" class="termdead" id="termDead">会话已结束 · 按回车重开</div>
    <div class="termstat" id="termStat">{{ cols }}×{{ rowsCount }} · {{ exited ? '已退出' : '运行中' }}</div>
  </div>
</template>

<style scoped>
/* 面板本体：与 .codepane 同一套定位约定（绝对铺满 .main），配色跟 Studio 的深色一致。
   ★字体必须**同时**给到标尺和网格：量字符宽度靠标尺，画字靠网格，两者不一致就整体错半格。 */
.termwrap {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-canvas);
  color: var(--fg);
  font: var(--fs-sm) / 1.45 ui-monospace, Menlo, monospace;
  font-variant-ligatures: none;
  cursor: text;
}
.termruler {
  position: absolute;
  left: -9999px;
  top: 0;
  white-space: pre;
  visibility: hidden;
  pointer-events: none;
}
.termbody {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 10px;
  box-sizing: border-box;
}
.termgrid {
  position: relative;
  white-space: pre;
}
.trow {
  display: block;
  white-space: pre;
  line-height: var(--ch);
}
.tcur {
  position: absolute;
  width: var(--cw);
  height: var(--ch);
  background: rgba(230, 232, 238, 0.75);
  mix-blend-mode: difference;
  pointer-events: none;
  animation: tcur-blink 1.06s steps(1) infinite;
}
@keyframes tcur-blink {
  0%, 50% { opacity: 1; }
  50.01%, 100% { opacity: 0; }
}
/* 输入收集器：**不可见但可聚焦**（display:none 会收不到键盘，这是终端类 UI 的经典坑） */
.terminput {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  outline: none;
  opacity: 0;
  resize: none;
  overflow: hidden;
  background: transparent;
  color: transparent;
}
.termhint,
.termdead,
.termstat {
  position: absolute;
  right: var(--sp3);
  padding: 2px 8px;
  border-radius: var(--r-pill);
  font-size: var(--fs-2xs);
  pointer-events: none;
}
.termhint {
  bottom: 28px;
  background: var(--bg-elevated);
  color: var(--fg-subtle);
  border: 1px solid var(--border-subtle);
}
.termdead {
  bottom: 28px;
  background: var(--bad-weak);
  color: var(--bad);
  border: 1px solid var(--bad);
}
.termstat {
  bottom: 6px;
  color: var(--fg-subtle);
}
</style>
