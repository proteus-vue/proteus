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

/**
 * 统一的写入入口（决策 #1354）：**会话丢了就自己重开再重试一次**。
 *
 * 为什么需要：Rust 侧会话是**单例**，而"面板显示着" ≠ "会话还在"。
 * 切 shell（关旧开新）、手机推流中断后的重启、应用重启后面板被恢复成打开态……
 * 任一情形都会让 SESSION 变成 None，此时任何按键/按钮都返回"终端未打开"——
 * 用户看到的就是"有时候正常、有时候一直报错"。
 * 与其让人去理解会话状态，不如在这里**自愈**：重开一次，把这一击补发出去。
 */
/* ★写入去重（决策 #1365）：实测"输入 cd 显示 cccd、命令执行两次"，
   说明同一批字节被重复发送。4ms 窗口远低于人手/系统重复率，不会误吞正常输入。
   （根因仍在查：可能是重复的事件源；这里先把"确定性重复"挡住。） */
let lastOut = { d: '', at: 0 }
let lastIn = { d: '', at: 0 }
const lastSeq = new Map<number, number>()
let applied = 0

async function writeToTerm(data: string) {
  if (!hasBridge) return
  const now = performance.now()
  if (data === lastOut.d && now - lastOut.at < 4) return
  lastOut = { d: data, at: now }
  try {
    await termWrite(sid.value ?? 0, data, 'send')
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    /* ★★**绝不重发用户输入**（决策 #1366）：原来的"重开 + 重发"会让一次按键进两次 shell
       （实测日志：单个按键后端收到两次 `write len=1`）⇒ 字符重复、命令执行两次。
       现在只重开会话（让下一次按键可用）+ 提示一次，**不重发这一批字节**。 */
    if (msg.includes('终端未打开')) {
      opened.value = false
      openSession()
    }
    pushToast(msg, 'err')
  }
}
import PButton from '../ui/PButton.vue'
import PInput from '../ui/PInput.vue'
import PSelect from '../ui/PSelect.vue'
import { pushToast } from '../toast'

/* ★`active` 由 App 传（`view === 'term'`）：面板用 v-show 常驻以保留会话，
   但**不能在启动时就开 shell** —— 用户可能整天不开终端，白起一个登录 shell
   （它会读 .zshrc、可能打印一堆东西）。所以"第一次真正显示"时才开。 */
const props = defineProps<{
  active: boolean
  /** 副栏（拆分右侧）：不显示工具栏/查找条，避免两套工具条重复 */
  minimal?: boolean
  /** 当前是否处于左右拆分（主栏据此高亮"拆分"按钮） */
  split?: boolean
}>()
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

/** ★并发守卫（决策 #1364）：`opened` 在 await 之后才置位，期间 ResizeObserver
 *  会反复触发 `maybeOpen()` ⇒ 每触发一次就多开一个会话（截图里 4 个 zsh 标签就是这么来的）。
 *  多出来的会话还会让写入撞上"终端未打开 → 自愈重发"，表现为**字符重复、命令执行两次**。 */
let opening = false

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
  if (!hasBridge) {
    // 浏览器直开：给一段说明 + 本地回显，避免一片空白让人以为坏了
    term.value.reset(80, 24)
    term.value.write('\x1b[33m终端需要在 Studio 里打开\x1b[0m（浏览器直开时没有 pty）\r\n')
    ver.value++
    return
  }
  const { cols: c, rows: r } = gridSize()
  /* ★尺寸不合法就别开（决策 #1354）：面板被 `v-show` 藏起来时量出来可能是 0×0，
     拿这个尺寸去 openpty 只会得到一个畸形终端（ps1 刷屏/立刻 EOF）。
     这时候**不开会话**，等它真正可见时（ResizeObserver 会再调 maybeOpen）再开。 */
  if (c < 8 || r < 3) {
    opened.value = false
    return
  }
  try {
    const id = await termOpen(c, r, shellSel.value)
    const t = new Terminal(c, r)
    sessions.value = [...sessions.value, { id, title: shellSel.value, term: t }]
    activeId.value = id
    term.value = t
    ver.value++
    opened.value = true
    exited.value = false
    /* ★新建后**立刻把焦点交给输入框**（决策 #1377）：`＋` 按钮被点过之后焦点在按钮上，
       用户得再点一下终端才能打字 —— 这是"新建终端后要点击才能输入"的原因。 */
    void nextTick(() => focusInput())
  } catch (e) {
    pushToast(`开终端失败：${String((e as Error)?.message ?? e)}`, 'err')
  }
}

/** 切到某个会话：只换渲染目标 + 按当前面板尺寸校准 pty */
function switchTo(id: number) {
  const s = sessions.value.find((x) => x.id === id)
  if (!s) return
  activeId.value = id
  term.value = s.term
  exited.value = false
  ver.value++
  const { cols: c, rows: r } = gridSize()
  if (c >= 8 && r >= 3 && (s.term.cols !== c || s.term.rows !== r)) {
    s.term.resize(c, r)
    void termResize(id, c, r).catch(() => {})
  }
  void nextTick(() => focusInput())
}

/** 关掉某个会话（关完若是最后一个，就再开一个新的，避免面板空着） */
async function closeSession(id: number) {
  const rest = sessions.value.filter((x) => x.id !== id)
  await termClose(id).catch(() => {})
  sessions.value = rest
  if (!rest.length) {
    activeId.value = 0
    opened.value = false
    void openSession()
    return
  }
  if (activeId.value === id) switchTo(rest[0].id)
}

/** 新建终端（⌘⇧T / 工具栏 +） */
function newSession() {
  if (!hasBridge) return
  opened.value = false
  void openSession()
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
  if (hasBridge && !exited.value) void termResize(activeId.value, c, r).catch(() => {})
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

/* ★**唯一出口去重**（决策 #1368）：实测一次按键仍产生两次 `term_write`，
   说明 `beforeinput` 与输入法的 `compositionend` **各发了一次**（ASCII 在中文输入源下
   也会走一遍 IME 组合）。30ms 窗口下人不可能重复输入同一个字符（键盘连发也 ≥33ms），
   所以这里合并是安全的。所有输入路径（按键/IME/粘贴）都经过本函数。 */
let lastSend = { d: '', at: 0 }

function send(data: string) {
  if (!data) return
  const now = performance.now()
  if (data === lastSend.d && now - lastSend.at < 30) return
  lastSend = { d: data, at: now }
  if (!hasBridge) return
  void writeToTerm(data)
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

/**
 * 打印字符入口（决策 #1367）：用 **`beforeinput`** 而不是 `input`。
 *
 * ★为什么换：原实现 `@input` + 处理里 `el.value = ''`，在 WKWebView 里一次按键会派发
 *   **两次 input**（实测后端日志：单个按键收到 `write len=1` 两次 ⇒ 字符重复、命令执行两次）。
 *   `beforeinput` 的 `e.data` 就是"这一次要插入的文本"，`preventDefault()` 后 textarea 永远是空的，
 *   既不会累积、也不会因为"清值"再触发一轮事件。
 * ★输入法：`isComposing` 时放行给 `compositionend`（中文一次上屏要整段发，不能逐字）。
 * ★粘贴：Cmd+V 走 `insertFromPaste`，同样带 `data` ⇒ 一次发完整段。
 */
function onBeforeInput(e: InputEvent) {
  if (e.isComposing) return
  const d = e.data
  if (d == null) return
  e.preventDefault()
  if (d) send(d)
}

/** 输入法上屏：整段一起发（逐字发会把候选词的中间态也送进 shell）。
 *
 * ★**必须跳过"刚发过的同一段"**（决策 #1369）：ASCII 字符在中文输入源下会先触发
 *   `beforeinput`（我们已发），紧接着再触发 `compositionend`（同一字符）——
 *   这是我加 `compositionend` 时自己造出来的第二个重复源。
 *   200ms 窗口只用于"这串字符刚刚发过就不再发"，不影响真正的输入法上屏。
 */
function onCompositionEnd(e: CompositionEvent) {
  const d = e.data
  if (!d) return
  if (d === lastSend.d && performance.now() - lastSend.at < 200) return
  send(d)
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
  /* ★每个会话的"已见最大序号"（决策 #1373）：seq <= 已见 ⇒ 重复投递，丢弃。
     这是幂等判据，不依赖时间窗/内容比较，重复多少次都只画一次。 */
  offData = onTermData((id, d, seq) => {
      if (seq) {
        const seen = lastSeq.get(id) ?? 0
        if (seq <= seen) return
        lastSeq.set(id, seq)
      }
      /* ★`id=0` = 浏览器桩/旧 payload（不带会话 id）⇒ 落到**当前活动会话**，
         否则门禁那种"直接派发 studio:term-data"的场景会被当成"未知会话"丢掉。 */
      /* 同一块输出 4ms 内只画一次（防止重复投递把每行画两遍） */
      const tn = performance.now()
      if (d === lastIn.d && tn - lastIn.at < 4) return
      lastIn = { d, at: tn }
      const target =
        sessions.value.find((x) => x.id === id) ??
        sessions.value.find((x) => x.id === activeId.value)
      /* ★★**只能写一次**（决策 #1376）：这里历史上残留了第二处 `term.value.write(d)`，
         导致**每块输出被应用两次** ⇒ 屏幕整段重复、echo 里字符翻倍（p,w → ppw）。
         排查 8 轮都没找到，因为它藏在处理函数**末尾**、跟在 early-return 之后。 */
      if (!target) return
      target.term.write(d)
      /* ★网格取样（决策 #1374）：每 10 块输出把**网格里真实的最后几行**发到日志（不进 shell），
         用来判定"重复发生在 pty 输出 / 网格 / DOM 渲染"里的哪一层。 */
      applied++
      if (applied % 10 === 0) {
        const lines = term.value
          .text()
          .split('\n')
          .filter((t) => t.trim().length > 0)
          .slice(-6)
          .join(' ⏎ ')
        void termWrite(activeId.value, lines, 'diag').catch(() => {})
      }
      /* 只有**当前活动会话**才需要重绘（后台会话继续累积，切过去时统一重绘） */
      if (id === 0 || id === activeId.value) scheduleRender()
  })
  offExit = onTermExit((id) => {
      if (id !== activeId.value) return
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
  /* 关掉**全部**会话（多会话后不能只关当前那个） */
  for (const s of sessions.value) void termClose(s.id).catch(() => {})
})

/* ── 工具栏（决策 #1349）──────────────────────────────────────────────────
 * 用户指出：终端只有一块裸屏，没有关闭/终止/新建/拆分/shell 选择/搜索/多终端列表。
 * 本轮先做**能真正生效**的部分（都基于已有的单会话后端）：
 *   终止（^C）· 清屏（^L）· shell 选择（zsh/bash/sh，白名单，重开会话）· 查找 · 最大化 · 关闭。
 * 多终端 / 拆分 / 会话列表需要后端**多会话 id**，是下一步（现在只有唯一会话）。 */
const emit = defineEmits<{ close: []; maximize: []; split: [] }>()
const shellSel = ref<'zsh' | 'bash' | 'sh'>('zsh')
const shellOpts = [
  { value: 'zsh', label: 'zsh' },
  { value: 'bash', label: 'bash' },
  { value: 'sh', label: 'sh' },
]
const findOpen = ref(false)
/* ── 多会话（决策 #1363）─────────────────────────────────────────────────
 * 每个会话持有**独立的 `Terminal` 实例**（自己的网格/回滚/光标），
 * 面板只渲染"当前活动"那一个；切会话只是换 `term.value` 的指向，不重排不丢内容。
 * 后端已经是 id 化的会话表（#1362），所以这里只管 UI 层的列表与切换。 */
type Sess = { id: number; title: string; term: Terminal }
const sessions = shallowRef<Sess[]>([])
const activeId = ref(0)
/** 当前会话 id（term_* 调用都要带 id） */
const sid = computed(() => (activeId.value || null))
const findQ = ref('')
/* 匹配规则（决策 #1358）：与 VS Code 一致 —— Aa 区分大小写 · ab 全字匹配 · .* 正则 */
const fCase = ref(false)
const fWord = ref(false)
const fRegex = ref(false)

async function sendCtrl(seq: string) {
  if (!hasBridge) return
  await writeToTerm(seq)
}

/** 切 shell = 关掉当前会话再开一个新的（单会话后端只能这样换） */
async function switchShell(v: 'zsh' | 'bash' | 'sh') {
  shellSel.value = v
  if (!hasBridge) return
  try {
    if (sid.value !== null) await closeSession(sid.value)
  } catch {
    /* 已经关了也无所谓 */
  }
  opened.value = false
  openSession()
}

/**
 * 把一行 run 按命中区间切开（决策 #1357 / #1358）。
 *
 * ★做法：先在**整行拼接文本**上算命中区间，再把区间映射回各个 run。
 *   这样"跨 run 的词"（同一行里颜色不同把词切断）也能命中——之前按 run 单独找是找不全的。
 * ★匹配规则与 VS Code 对齐：区分大小写 / 全字匹配 / 正则（正则非法时不报错、按无命中处理）。
 */
function matchRanges(text: string): [number, number][] {
  const raw = findQ.value
  if (!raw) return []
  const out: [number, number][] = []
  if (fRegex.value) {
    let re: RegExp
    try {
      re = new RegExp(raw, fCase.value ? 'g' : 'gi')
    } catch {
      return [] // 正则写了一半就报错太吵；当作无命中
    }
    for (const m of text.matchAll(re)) {
      if (m.index === undefined || !m[0].length) continue
      out.push([m.index, m.index + m[0].length])
    }
    return out
  }
  const hay = fCase.value ? text : text.toLowerCase()
  const needle = fCase.value ? raw : raw.toLowerCase()
  let i = 0
  while (i <= hay.length - needle.length) {
    const k = hay.indexOf(needle, i)
    if (k < 0) break
    const end = k + needle.length
    if (!fWord.value || (isWordBoundary(hay, k - 1) && isWordBoundary(hay, end))) {
      out.push([k, end])
    }
    i = k + Math.max(1, needle.length)
  }
  return out
}

const isWordChar = (c: string) => /[A-Za-z0-9_$]/.test(c)
function isWordBoundary(text: string, idx: number) {
  if (idx < 0 || idx >= text.length) return true
  return !isWordChar(text[idx])
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
      /* 找覆盖 abs 的那个区间 */
      const hit = ranges.find(([a, b]) => abs >= a && abs < b)
      if (!hit) {
        /* 不在命中里：吃到下一个区间起点 */
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

/* 查找（决策 #1355）：**自己在网格里搜**。
   原本想用 WebKit 的 `window.find()`，但在 Tauri 的 WKWebView 里实测无效（用户："搜索无效"）。
   我们的终端本来就是自己渲染的字符网格（`rows`），直接扫文本更可靠，还能给出 "2/7" 计数。 */
const hitRows = ref<number[]>([]) // 命中的行号（去重，用来高亮整行）
const hitIdx = ref(-1)
const hitLine = computed(() => (hitIdx.value >= 0 ? hitRows.value[hitIdx.value] : -1))

function computeHits() {
  hitRows.value = []
  hitIdx.value = -1
  if (!findQ.value) return
  rows.value.forEach((line, y) => {
    const text = line.map((r) => r.text).join('')
    if (matchRanges(text).length) hitRows.value.push(y)
  })
  if (hitRows.value.length) hitIdx.value = 0
}

/** 跳到第 n 个命中：滚动到那一行（居中一点），整行高亮 1.2s */
function gotoHit(n: number) {
  if (!hitRows.value.length) return
  hitIdx.value = (n + hitRows.value.length) % hitRows.value.length
  const y = hitRows.value[hitIdx.value]
  const body = bodyEl.value
  if (body) {
    const top = y * cell.h - body.clientHeight / 2 + cell.h
    body.scrollTop = Math.max(0, top)
  }
  flash.value = y
  if (flashTimer) window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => (flash.value = -1), 1200)
}

const flash = ref(-1)
let flashTimer: number | undefined

/** Enter = 下一个（重新计算命中）+ 跳；Shift+Enter = 上一个；输入变化时清空计数 */
function doFind(back = false) {
  const q = findQ.value.trim()
  if (!q) return
  if (!hitRows.value.length) {
    computeHits()
    searched.value = true
    if (!hitRows.value.length) return
    gotoHit(0)
    return
  }
  gotoHit(hitIdx.value + (back ? -1 : 1))
}

/* ★**边打边搜**（决策 #1356）：用户对照 VS Code 期待"输进去就出命中数"。
   之前只在 Enter 时才搜，而计数框在**还没搜**时就显示「无命中」（hitRows 初始为空）——
   于是看起来"搜什么都无命中"。现在：
     · 输入后 120ms 自动搜并跳到第一个命中；
     · `searched` 标记"确实搜过"，避免把"还没搜"误报成"无命中"。 */
const searched = ref(false)

/** 切换匹配规则后**立刻重算**（否则要再敲一个字才生效） */
function toggleRule(which: 'case' | 'word' | 'regex') {
  if (which === 'case') fCase.value = !fCase.value
  else if (which === 'word') fWord.value = !fWord.value
  else fRegex.value = !fRegex.value
  hitRows.value = []
  hitIdx.value = -1
  if (!findQ.value) return
  computeHits()
  searched.value = true
  if (hitRows.value.length) gotoHit(0)
}
let findTimer: number | undefined

watch(findQ, () => {
  hitRows.value = []
  hitIdx.value = -1
  searched.value = false
  if (findTimer) window.clearTimeout(findTimer)
  if (!findQ.value.trim()) return
  findTimer = window.setTimeout(() => {
    computeHits()
    searched.value = true
    if (hitRows.value.length) gotoHit(0)
  }, 120)
})

/** 关闭查找（决策 #1361）：收框、清掉命中高亮、焦点还给终端 —— 用户不必再点工具栏的「查找」 */
function closeFind() {
  findOpen.value = false
  findQ.value = ''
  hitRows.value = []
  hitIdx.value = -1
  searched.value = false
  flash.value = -1
  void nextTick(() => focusInput())
}

/** 打开查找框并聚焦输入（给 ⌘F 用：**焦点在终端**时才走这里） */
async function openFind() {
  findOpen.value = true
  await nextTick()
  const el = document.querySelector<HTMLInputElement>('.termfind input')
  el?.focus()
  el?.select()
}

defineExpose({ focus: focusInput, term, openFind })
</script>

<template>
  <div
    class="termwrap"
    id="termWrap"
    @click="focusInput"
    @keydown.capture="
      (e) => {
        /* 焦点在终端里时 ⌘F 归终端（决策 #1358）：不该去开代码视图的搜索 */
        /* ⇧⌘T = 新建终端（与 VS Code 一致），同样只在焦点位于终端时生效 */
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 't') {
          e.preventDefault()
          e.stopPropagation()
          newSession()
          return
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault()
          e.stopPropagation()
          void openFind()
        }
      }
    "
  >
    <!-- 工具栏（决策 #1349）：关闭 / 最大化 / 终止 / 清屏 / shell / 查找 -->
    <div v-if="!props.minimal" class="termbar" @click.stop>
      <!-- 多终端标签（决策 #1363）：每个会话一个标签，✕ 单独关闭，+ 新建 -->
      <div class="ttabs">
        <button
          v-for="s in sessions"
          :key="s.id"
          class="ttab"
          :class="{ on: s.id === activeId }"
          :title="`${s.title} · 会话 ${s.id}`"
          @click="switchTo(s.id)"
        >
          <span class="tname">{{ s.title }}</span>
          <span class="tx" title="关闭这个终端" @click.stop="closeSession(s.id)">✕</span>
        </button>
        <PButton size="sm" title="新建终端（⌘⇧T）" @click="newSession">＋</PButton>
      </div>
      <!-- 全部换成 Studio 自己的控件（决策 #1350）：原生 select 在 macOS 上是系统绘制，
           样式不可控，且弹层会盖在原生层之上（画布在下层）。 -->
      <PSelect
        :model-value="shellSel"
        :options="shellOpts"
        size="sm"
        title="切换 shell（会重开一个会话）"
        :width="72"
        @update:model-value="switchShell($event as 'zsh' | 'bash' | 'sh')"
      />
      <PButton size="sm" title="终止当前命令（Ctrl-C）" @click="sendCtrl('\x03')">终止</PButton>
      <PButton size="sm" title="清屏（Ctrl-L）" @click="sendCtrl('\x0c')">清屏</PButton>
      <PButton size="sm" :active="findOpen" title="在终端里查找" @click="findOpen = !findOpen">查找</PButton>
      <span class="tfill" />
      <PButton size="sm" :active="props.split" title="拆分终端（左右各一个会话）" @click="emit('split')">◫</PButton>
      <PButton size="sm" title="最大化 / 还原（⌘⇧J）" @click="emit('maximize')">⤢</PButton>
      <PButton size="sm" variant="ghost" title="关闭面板（⌘J）" @click="emit('close')">✕</PButton>
    </div>
    <div v-if="findOpen && !props.minimal" class="termfind" @click.stop>
      <!-- 查找框：规则开关**放在输入框内部右侧**（决策 #1359，对齐 VS Code 的观感） -->
      <div class="findbox">
        <PInput
          v-model="findQ"
          placeholder="查找（↑↓ 或 Enter 切换命中）"
          @keydown.enter.prevent="doFind($event.shiftKey)"
          @keydown.esc.prevent="closeFind"
        />
        <div class="frules" @click.stop>
          <button
            class="frule"
            :class="{ on: fCase }"
            title="区分大小写（⌥⌘C）"
            @click="toggleRule('case')"
          >
            Aa
          </button>
          <button
            class="frule"
            :class="{ on: fWord }"
            title="全字匹配（⌥⌘W）"
            @click="toggleRule('word')"
          >
            <span class="ab">ab</span>
          </button>
          <button
            class="frule"
            :class="{ on: fRegex }"
            title="正则表达式（⌥⌘R）"
            @click="toggleRule('regex')"
          >
            .*
          </button>
        </div>
      </div>
      <span class="fcount">{{
        hitRows.length ? `${hitIdx + 1}/${hitRows.length}` : searched && findQ.trim() ? '无命中' : ''
      }}</span>
      <PButton size="sm" title="上一个（⇧Enter）" :disabled="!hitRows.length" @click="doFind(true)">↑</PButton>
      <PButton size="sm" title="下一个（Enter）" :disabled="!hitRows.length" @click="doFind(false)">↓</PButton>
      <PButton size="sm" title="关闭查找（Esc）" @click="closeFind">✕</PButton>
    </div>

    <!-- 标尺：只用来量"一个等宽字符多大"，不参与布局 -->
    <span id="termRuler" class="termruler" aria-hidden="true">WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW</span>

    <div class="termbody" ref="bodyEl" id="termBody" :style="{ '--cw': cell.w + 'px', '--ch': cell.h + 'px' }">
      <div class="termgrid" :style="{ width: cols * cell.w + 'px', height: rowsCount * cell.h + 'px' }" id="termGrid">
        <div
          v-for="(line, y) in rows"
          :key="y"
          class="trow"
          :class="{ flash: y === flash }"
          :style="{ height: cell.h + 'px' }"
        >
          <span
            v-for="(seg, i) in segmentsOf(line)"
            :key="i"
            :style="seg.style"
            :class="{ hit: seg.hit }"
            >{{ seg.text }}</span
          >
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
      @beforeinput="onBeforeInput"
      @compositionend="onCompositionEnd"
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

/* 工具栏：窄、与面板同色，按钮 hover 才亮 */
.termbar{display:flex;align-items:center;gap:4px;padding:3px 8px;flex:none;
         border-bottom:1px solid var(--border-subtle);font-size:11px;color:var(--fg-dim)}
.tfill{flex:1}

/* 查找命中行：淡黄底闪一下（与终端配色兼容，不用刺眼的纯黄） */
.trow.flash { background: rgb(250 204 21 / 22%); }
/* ★用**网格定列**而不是 flex（决策 #1360）：`flex:1` + 输入框 `width:100%` 时，
   输入框会一路顶出去，把右侧的计数/上下/关闭挤出可视区（用户截图：操作栏被盖住）。
   网格里第一列 `minmax(0,1fr)` 会**自己收缩**，后四列 auto 永远保留。 */
.termfind {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto auto; gap: 6px;
  align-items: center; padding: 4px 8px; border-bottom: 1px solid var(--border-subtle);
  flex: none; overflow: hidden;
}
.fcount { font-size: 10px; color: var(--fg-dim); min-width: 34px; text-align: right; }

/* 命中词：暖黄底（与终端配色协调），所有命中都标 */
.trow span.hit { background: rgb(250 204 21 / 32%); border-radius: 2px; color: var(--fg); }

/* 查找框 + 内嵌规则按钮（决策 #1359） */
.findbox { position: relative; min-width: 0; width: 100%; }
.findbox :deep(input),
.findbox :deep(.pinput) { padding-right: 78px; box-sizing: border-box; }
.frules { position: absolute; right: 3px; top: 50%; transform: translateY(-50%); display: flex; gap: 1px; }
.frule {
  height: 16px; min-width: 20px; padding: 0 4px; border: none; border-radius: 4px;
  background: transparent; color: var(--fg-subtle); font-size: 10px; line-height: 16px;
  cursor: pointer;
}
.frule:hover { background: var(--bg-overlay); color: var(--fg-muted); }
.frule.on { background: rgb(96 165 250 / 30%); color: var(--fg); }
.frule .ab { text-decoration: underline; text-underline-offset: 1px; }

/* 终端标签：窄、可横向滚动（会话多了也不会把工具栏挤爆） */
.ttabs { display: flex; align-items: center; gap: 2px; max-width: 45%; overflow-x: auto;
         scrollbar-width: none; }
.ttabs::-webkit-scrollbar { display: none; }
.ttab { display: inline-flex; align-items: center; gap: 3px; height: 20px; padding: 0 5px;
        border: 1px solid transparent; border-radius: 5px; background: transparent;
        color: var(--fg-subtle); font-size: 11px; cursor: pointer; white-space: nowrap; }
.ttab:hover { background: var(--bg-overlay); color: var(--fg-muted); }
.ttab.on { background: var(--bg-elevated); border-color: var(--border-subtle); color: var(--fg); }
.ttab .tx { opacity: .45; font-size: 9px; }
.ttab .tx:hover { opacity: 1; color: #f87171; }
</style>
