<script setup lang="ts">
// packages/studio/ui/src/panels/CodePanel.vue —— 代码视图：目录树 + **CodeMirror 6 编辑器**
//
// 【这一版换掉了什么】右侧的只读 `<pre>` → 真正的 CodeMirror 6 编辑器：
//   行号 / 当前行 / 选区 / 括号匹配 / Tab 缩进 / ⌘Z / **⌘S 写回**。
//   编辑器内核用现成的（G-56.1 红线：绝不自研），这里只做**接线与主题**。
//
// 【多标签 + 文本缓冲（2026-10-25 · #1217）】每个打开的文件一份 `EditorState` 存在 `states` 池里：
//   切标签恢复的是**同一份 state**（含未保存内容与 undo 历史），不是重新读盘。
//   基线（base/mtime）按文件分开，避免"改 A 存 B"。
//
// 【写回的三个硬约束（都在 Rust 侧，前端只是调用方）】
//   ① **mtime 冲突检测**：打开时记 mtime，保存时回传；磁盘上的值变了 ⇒ 拒绝覆盖。
//      本仓常驻多个 AI 会话同时改文件，没有这条，Studio 保存一次就会静默吃掉别人的改动；
//   ② **原子替换**：临时文件 + rename（直接 write 中途失败会留下半个源文件）；
//   ③ 保留权限位（rename 会换成新文件的 mode）。
//
// 【★语法着色（2026-10-25 · #1213 / #1215）】`HighlightStyle` + `@lezer/highlight` 的 `tags`：
//   语言包：`.vue` lang-vue · `.rs` lang-rust · `.ts/.tsx/.js/.jsx` lang-javascript ·
//   `.css` lang-css · `.m/.h` legacy-modes 的 clike（ObjC 无官方 Lezer 语法 ⇒ C 级降级）。
//   扩展名 → 语言的映射在 `ui/src/languages.json`（单一真源，门禁 ⑳ 按它扫真实目录）。
//   ★色板另立 `--syn-*` 一列（见 styles.css）：不复用 --bad/--ok 这类**状态**语义色，
//     否则"红=错误"和"红=字符串"会在同一屏上互相误导。
//   ★仍然不自己写分词器（G-56.1 红线：编辑器内核只用现成的）。

import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, selectAll, undo } from '@codemirror/commands'
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  forceParsing,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { Compartment } from '@codemirror/state'
import { langExtension, langLabel } from '../langs'
import { editorLang, effectiveLangId, langOverrides, trackEditorFile } from '../editorLang'
import {
  copyText,
  gitHead,
  hasBridge,
  invoke,
  listFiles,
  onCloseBlocked,
  readText,
  writeText,
  type SearchHit,
} from '../bridge'
import { useWorkspaceState, whenHydrated } from '../useWorkspaceState'
import { onMenuAction } from '../menu'
import StudioIcon from '../icons/StudioIcon.vue'
import SearchBox from './SearchBox.vue'
import FileTree from './FileTree.vue'
import { startDrag, termH, termMode, treeHidden, treeW } from '../layout'
import TabBar from './TabBar.vue'
import QuickOpen from './QuickOpen.vue'
import GitBar from './GitBar.vue'
import { revealPath } from '../fileTree'
import { refreshGit } from '../git'
import { openMenu } from '../contextmenu'
import { pushToast } from '../toast'
import { ask } from '../confirm'
import DiffView from '../DiffView.vue'

/** ★G5：上次打开的文件 / 折叠的目录都存在工作区会话里（重启恢复）。 */
const ws = useWorkspaceState()
/** 列哪些子树（都是 Studio 自己的源码——显示它自己，一眼能核对"屏幕这段 == 仓库那段"） */
const ROOTS = ['packages/studio/ui/src', 'packages/studio/src', 'packages/studio/native'] as const

const files = ref<string[]>([])
const cur = ref('')
/** ⌘P 快速打开（决策 #1396） */
const quickOpen = ref(false)

function onQuickPick(path: string) {
  quickOpen.value = false
  void open(path)
}

/* ── 编辑器内查找 / 跳行（决策 #1400）────────────────────────────────────────
 * 【为什么不用 @codemirror/search】它没装（加依赖要在用户终端跑 pnpm），而"⌘F 在文件里找"
 *   是编辑器最基本的操作。这里用 doc 文本 + selection 实现：
 *   **每按一次 Enter 就把命中区间选中并滚进视野** —— 选中本身就是最清晰的高亮，
 *   不需要额外 decoration 层（那样要引 StateField/ViewPlugin，代码与风险都更大）。
 * 代价（已知）：不做全量高亮、不支持正则/替换 —— 等 search 包装上再补。 */
const edFindOpen = ref(false)
const edFindQ = ref('')
const edFindTotal = ref(0)
const edFindAt = ref(-1)

function edMatches(): { from: number; to: number }[] {
  const q = edFindQ.value
  if (!q || !view) return []
  const text = view.state.doc.toString()
  const hay = text.toLowerCase()
  const needle = q.toLowerCase()
  const out: { from: number; to: number }[] = []
  let i = 0
  while (i <= hay.length - needle.length) {
    const k = hay.indexOf(needle, i)
    if (k < 0) break
    out.push({ from: k, to: k + q.length })
    i = k + Math.max(1, needle.length)
  }
  return out
}

function edFindStep(back = false) {
  if (!view) return
  const ms = edMatches()
  edFindTotal.value = ms.length
  if (!ms.length) {
    edFindAt.value = -1
    return
  }
  const sel = view.state.selection.main
  let idx: number
  if (back) {
    idx = ms.map((m) => m.from).filter((f) => f < sel.from).pop() ?? ms[ms.length - 1].from
    idx = ms.findIndex((m) => m.from === idx)
  } else {
    const next = ms.find((m) => m.from >= sel.to) ?? ms[0]
    idx = ms.indexOf(next)
  }
  const m = ms[idx]
  edFindAt.value = idx
  view.dispatch({ selection: { anchor: m.from, head: m.to }, scrollIntoView: true })
  view.focus()
}

watch(edFindQ, () => {
  edFindTotal.value = edMatches().length
  edFindAt.value = -1
})

function edFindOpenBox() {
  edFindOpen.value = true
  void nextTick(() => document.querySelector<HTMLInputElement>('#edFindInput')?.select())
}

function edFindClose() {
  edFindOpen.value = false
  edFindQ.value = ''
  edFindTotal.value = 0
  edFindAt.value = -1
  view?.focus()
}

/** ⌘G：跳行（1-based）。★用**内联输入框**而不是 `window.prompt`
 *  —— WKWebView 里 `prompt()` 不实现、静默返回 null，那样快捷键等于没有。 */
const edGotoOpen = ref(false)
const edGotoVal = ref('')

function gotoOpen() {
  edGotoOpen.value = true
  if (view) edGotoVal.value = String(view.state.doc.lineAt(view.state.selection.main.head).number)
  void nextTick(() => document.querySelector<HTMLInputElement>('#edGotoInput')?.select())
}

function gotoCommit() {
  const n = Number(edGotoVal.value)
  if (view && Number.isFinite(n) && n >= 1) {
    const line = view.state.doc.line(Math.min(Math.round(n), view.state.doc.lines))
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
  }
  edGotoOpen.value = false
  view?.focus()
}

/** ⌘P 打开快速面板；Esc 由面板自己处理。只在代码视图里监听（组件只在代码视图挂载）。 */
function onQuickKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    e.stopPropagation()
    edFindOpenBox()
    return
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'g') {
    e.preventDefault()
    e.stopPropagation()
    gotoOpen()
    return
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    e.stopPropagation()
    quickOpen.value = true
  }
}
const err = ref('')
const loading = ref(false)
const saving = ref(false)
const dirty = ref(false)
const lineCount = ref(0)
const host = ref<HTMLElement | null>(null)

let view: EditorView | null = null

/** 每个文件的**磁盘基线**（保存冲突检测用）。★必须按文件分开：多标签共用一份 = "改 A 存 B"。 */
interface FileRec {
  base: string
  mtime: number
}
const recs = new Map<string, FileRec>()

/** ★★文本缓冲 = 每个文件一份 `EditorState`（不是"切标签重新读盘"）。
 *  重新读盘会同时丢掉两样东西：**未保存内容**和**undo 历史**——后者只存在于 state 里。
 *  判据 ㉒ 就是钉这个：切走再切回，⌘Z 必须还能撤销之前的输入。
 *  ★state 只在内存：刷新/重启即丢（磁盘上不留任何"临时副本"）。
 *  ★`base`/`mtime` 记的是**用户开始编辑时**磁盘上的那份，保存时仍按它做冲突检测——
 *    否则切一次文件就会把"别人改过"这条线索刷新掉。 */
const states = new Map<string, EditorState>()

/** 打开的标签（顺序 = 标签栏顺序）。 */
const tabs = ref<string[]>([])
/** 有未保存改动的标签（Map 不是响应式的，单独存一份给标签上的圆点用）。 */
const dirtySet = ref<string[]>([])
const setTabDirty = (p: string, on: boolean) => {
  const has = dirtySet.value.includes(p)
  if (on && !has) dirtySet.value = [...dirtySet.value, p]
  else if (!on && has) dirtySet.value = dirtySet.value.filter((x) => x !== p)
}

/* ─── 搜索（决策 #1222 · #1223 拆分）────────────────────────────────────────
 * 输入与结果列表在 `SearchBox.vue`（它自己管防抖/序号/引擎标注）；这里只留两件事：
 *   ① `searchActive` —— 搜索时目录树**让位**（同一时刻只有一个列表）；
 *   ② `jumpTo` —— 真正跳转，因为只有这里持有 `EditorView`。
 */
const searchActive = ref(false)
const searchBox = ref<{ focus: () => void } | null>(null)

/** 跳到某条命中：打开文件 → 把光标放到**行:列**（列是字符列，这里换成 UTF-16 偏移）。 */
async function jumpTo(h: SearchHit) {
  await open(h.path)
  await nextTick()
  const v = view
  if (!v) return
  const ln = Math.min(Math.max(1, h.line), v.state.doc.lines)
  const info = v.state.doc.line(ln)
  // ★`Array.from` 按 code point 切：中文 1 个、emoji 2 个 code unit —— 直接拿字符数当偏移会跳偏
  const idx = Array.from(info.text).slice(0, Math.max(0, h.col - 1)).join('').length
  const pos = Math.min(info.from + idx, info.to)
  v.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
  v.focus()
  // 落点写到 DOM 上（`#codeHost` 的 data-caret="行:字符列"）：人眼与门禁都靠它确认
  // "真的跳到了那一格"，而不是"文件打开了"。值从 CM 的**实际 selection** 反算，不另记一份。
  const hitLine = v.state.doc.lineAt(pos)
  const carets = Array.from(hitLine.text.slice(0, pos - hitLine.from)).length + 1
  host.value?.setAttribute('data-caret', `${hitLine.number}:${carets}`)
}


/* ─── 目录树（决策 #1247 已拆到 `FileTree.vue` + `fileTree.ts`）─────────────────
 * 这里只剩一件与编辑器耦合的事：打开文件时把它的祖先目录展开（否则文件被折叠在看不见的地方）。
 * 建树/展平/折叠状态操作都是纯逻辑，已移出组件——它们是 1182 行的主要来源之一。 */

/* ─── 编辑器 ────────────────────────────────────────────────────────────── */
/** ★语言扩展放 **Compartment**（决策 #1241）：用户在状态栏手选语言时**就地重配**，
 *  不重建 state —— 重建会丢 undo 历史（"改个语言模式结果不能撤销了"是最气人的那类退化）。
 *  扩展名 → 语言 id 的映射在 `ui/src/languages.json`；语言 id → 解析器在 `ui/src/langs.ts`。 */
const langComp = new Compartment()

function langFor(path: string) {
  return langComp.of(langExtension(effectiveLangId(path)))
}

/** 语法着色：把 lezer 的 token 标签映射到 `--syn-*` 色板。
 *  ★只列"读代码时真的要区分"的类别；普通变量名**刻意不给颜色**——
 *    全都有颜色等于没颜色，变量继承正文色才能让关键字/字符串/类型凸显出来。
 *  ★注释用斜体：IDE 通用语汇，且不只靠颜色区分（色觉障碍下仍可分）。 */
const studioHighlight = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
    ],
    color: 'var(--syn-keyword)',
  },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.attributeValue], color: 'var(--syn-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syn-number)' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: 'var(--syn-comment)',
    fontStyle: 'italic',
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.tagName],
    color: 'var(--syn-type)',
  },
  { tag: [tags.attributeName, tags.propertyName], color: 'var(--syn-attr)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--syn-fn)' },
  {
    tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket, tags.angleBracket],
    color: 'var(--syn-punct)',
  },
  { tag: tags.invalid, color: 'var(--syn-invalid)', textDecoration: 'underline wavy' },
])

/** 主题：全部用 Studio 的语义 token，不引 theme-one-dark（避免两套色板打架） */
const theme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: 'var(--fs-sm)', backgroundColor: 'var(--bg-canvas)', color: 'var(--fg)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      lineHeight: '1.6',
      overflow: 'auto',
    },
    '.cm-content': { padding: 'var(--sp2) 0' },
    '.cm-line': { padding: '0 var(--sp4)' },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-surface)',
      color: 'var(--fg-subtle)',
      border: 'none',
      borderRight: '1px solid var(--border-subtle)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 var(--sp2) 0 var(--sp3)', minWidth: '40px' },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.028)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--bg-elevated)', color: 'var(--fg-muted)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(76, 141, 255, 0.26)',
    },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(76, 141, 255, 0.20)',
      outline: '1px solid var(--accent)',
    },
  },
  { dark: true },
)

function makeState(doc: string, path: string) {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      highlightSpecialChars(),
      history(),
      bracketMatching(),
      indentOnInput(),
      langFor(path),
      syntaxHighlighting(studioHighlight),
      theme,
      // ⌘S 放最前：它能 preventDefault 掉浏览器/宿主的保存行为
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            void save()
            return true
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged || !cur.value) return
        // ★每次改动都把 state 收进池子：切标签时才能连 undo 历史一起恢复
        states.set(cur.value, u.state)
        const now = u.state.doc.toString()
        const rec = recs.get(cur.value)
        dirty.value = !!rec && now !== rec.base
        setTabDirty(cur.value, dirty.value)
        if (showDiff.value) refreshDiff()
        lineCount.value = u.state.doc.lines
      }),
    ],
  })
}

function mountEditor() {
  if (!host.value) return
  view = new EditorView({ state: makeState('', ''), parent: host.value })
}

/** 把「整篇解析」放到后台时间切片里做完（决策 #1216）。
 *  ★为什么必须预热：CM 默认只解析**视口附近**，其余交给后台；一旦跳到还没解析的区域，
 *    它会在那一帧**同步补解析**——文字先出来、颜色晚到。实测（220~8000 行、Playwright、同一份 web-dist）：
 *      · `.m`（StreamLanguage）220 行：冷跳 **131ms**
 *      · `.ts` 8000 行：冷跳 **239ms**
 *      · 热跳（树已就绪）：9–27ms
 *    用户看到的就是"滚到哪、哪才开始着色"。
 *  ★为什么用 requestIdleCallback + forceParsing 小配额，而不是一次 `forceParsing(total, 1000)`：
 *    后者会**阻塞主线程 1 秒**（打字/滚动全卡）；这里每片 8ms、只在空闲时跑，跑完为止。
 *  ★返回 false 表示配额用完、还没解析完 ⇒ 继续排下一片；返回 true 就停。 */
const idle = (fn: () => void) =>
  'requestIdleCallback' in window
    ? window.requestIdleCallback(fn, { timeout: 250 })
    : window.setTimeout(fn, 16)

function warmParse(v: EditorView) {
  const total = v.state.doc.length
  // 进度落到 DOM 上（`data-parse=warming|full`）：门禁 ㉑ 靠它判断"整篇解析完了没"，
  // 而不是靠 sleep 猜——判据要能看见被测对象的状态，不能靠等。
  const mark = (s: string) => host.value?.setAttribute('data-parse', s)
  mark('warming')
  const step = () => {
    if (view !== v) return // 已切到别的文件/视图：这一轮作废，别继续烧 CPU
    const done = forceParsing(v, total, 8)
    if (done) mark('full')
    else idle(step)
  }
  idle(step)
}

/**
 * 打开一个文件。
 *
 * `opts.diff` = 打开后**顺带**把 Diff 打开到指定来源（决策 #1247：Git 清单点一下就回答
 * "这个文件相对 HEAD 改了什么"）。放在 opts 里而不是再写一个 `openAndDiff()`，
 * 是因为"打开哪个文件"与"看完哪个文件的差异"必须走**同一条**状态更新路径——
 * 两条路径必然在 `cur` / `recs` / `states` 上漂移（这正是标签跨界那次缺陷的同族原因）。
 */
async function open(path: string, opts: { diff?: 'disk' | 'head' } = {}) {
  if (!path) return
  // ★点同一个标签 = 不重新读盘：重新读盘会把未保存内容与 undo 历史一起冲掉。
  //   但"看它的 diff"这半件事仍要做（同一文件再点一次清单项就是这种情形）。
  if (path === cur.value && states.has(path)) {
    if (opts.diff) await enterDiff(opts.diff)
    return
  }
  cur.value = path
  ws.codeFile = path
  revealPath(path, ws.codeCollapsed)
  if (!tabs.value.includes(path)) tabs.value.push(path)
  ws.openFiles = [...tabs.value]
  err.value = ''
  loading.value = true

  // ① 内存里已有这个文件的 state ⇒ 直接恢复（含未保存内容与 undo 历史），**不读盘**
  const cached = states.get(path)
  const rec0 = recs.get(path)
  if (cached && rec0) {
    await nextTick()
    view?.setState(cached)
    // ★这条分支也必须登记：文件已在内存时走这里，漏了状态栏就会停在上一个文件的类型上（实测踩到）
    trackEditorFile(path)
    host.value?.setAttribute('data-lang', effectiveLangId(path))
    await syncDiffAfterOpen(opts.diff)
    dirty.value = cached.doc.toString() !== rec0.base
    setTabDirty(path, dirty.value)
    lineCount.value = cached.doc.lines
    loading.value = false
    if (view) warmParse(view)
    return
  }

  // ② 第一次打开：读盘，建 state + 基线
  try {
    const f = await readText(path)
    recs.set(path, { base: f.text, mtime: f.mtime_us })
    const st = makeState(f.text, path)
    states.set(path, st)
    await nextTick()
    view?.setState(st)
    trackEditorFile(path)
    host.value?.setAttribute('data-lang', effectiveLangId(path))
    await syncDiffAfterOpen(opts.diff)
    dirty.value = false
    setTabDirty(path, false)
    lineCount.value = st.doc.lines
    if (view) warmParse(view)
  } catch (e) {
    err.value = String((e as Error)?.message ?? e)
    dirty.value = false
  } finally {
    loading.value = false
  }
}

/** 关标签：删掉它的 state 与基线（未保存内容一起丢——"关闭"的语义，不是"隐藏"）。 */
/** 只把标签与它的缓冲丢掉，不切换当前文件（关闭兄弟标签时要用） */
function forget(path: string) {
  const i = tabs.value.indexOf(path)
  if (i < 0) return
  tabs.value.splice(i, 1)
  states.delete(path)
  recs.delete(path)
  setTabDirty(path, false)
  ws.openFiles = [...tabs.value]
}

/** 关掉除 `keep` 以外的所有标签 */
async function closeOthers(keep: string) {
  const victims = tabs.value.filter((p) => p !== keep)
  const dirty = victims.filter(isDirtyPath)
  if (dirty.length && !(await confirmDiscard(dirty))) return
  for (const p of victims) forget(p)
  if (cur.value !== keep) void open(keep)
}

/** 关掉 `path` 右侧的所有标签 */
async function closeRight(path: string) {
  const i = tabs.value.indexOf(path)
  if (i < 0) return
  const victims = tabs.value.slice(i + 1)
  const dirty = victims.filter(isDirtyPath)
  if (dirty.length && !(await confirmDiscard(dirty))) return
  for (const p of victims) forget(p)
}

async function close(path: string) {
  const i = tabs.value.indexOf(path)
  if (i < 0) return
  if (isDirtyPath(path) && !(await confirmDiscard([path]))) return
  forget(path)
  if (cur.value !== path) return
  const next = tabs.value[Math.max(0, i - 1)] ?? ''
  cur.value = ''
  if (next) {
    void open(next)
    return
  }
  // 没有标签了：清空编辑器（保留实例，避免重建）
  dirty.value = false
  lineCount.value = 0
  view?.setState(makeState('', ''))
  host.value?.removeAttribute('data-parse')
}

/* ─── 右键菜单（决策 #1234）：三处上下文，一套开关/定位 ──────────────────────
 * 标签栏 / 文件树 / 编辑器各给自己那份项，**动作都落到同一批函数**（close/save/undo…），不复制逻辑。
 */
/** 瞬时反馈统一走 toast（决策 #1236）：不再塞进状态栏 */
function flash(msg: string) {
  pushToast(msg)
}

async function copyPath(p: string) {
  try {
    await copyText(p)
    flash('已复制路径')
  } catch (e) {
    flash('复制失败：' + String((e as Error)?.message ?? e))
  }
}

function onTabMenu(e: MouseEvent, p: string) {
  const i = tabs.value.indexOf(p)
  openMenu(
    e,
    [
      { id: 'close', label: '关闭', accel: '⌘W', danger: true },
      { id: 'closeOthers', label: '关闭其他', disabled: tabs.value.length < 2 },
      { id: 'closeRight', label: '关闭右侧', disabled: i >= tabs.value.length - 1 },
      { id: 's1', label: '', sep: true },
      { id: 'copyPath', label: '复制相对路径' },
    ],
    (id) => {
      if (id === 'close') close(p)
      else if (id === 'closeOthers') closeOthers(p)
      else if (id === 'closeRight') closeRight(p)
      else if (id === 'copyPath') void copyPath(p)
    },
  )
}

async function refreshFiles() {
  try {
    files.value = await listFiles([...ROOTS])
    flash('文件树已刷新')
  } catch (e) {
    err.value = String((e as Error)?.message ?? e)
  }
}

function onEditorMenu(e: MouseEvent) {
  if (!cur.value) return
  openMenu(
    e,
    [
      { id: 'save', label: '保存', accel: '⌘S', disabled: !dirty.value },
      { id: 's1', label: '', sep: true },
      { id: 'undo', label: '撤销', accel: '⌘Z' },
      { id: 'redo', label: '重做', accel: '⇧⌘Z' },
      { id: 'selectAll', label: '全选', accel: '⌘A' },
      { id: 's2', label: '', sep: true },
      { id: 'copyPath', label: '复制相对路径' },
    ],
    (id) => {
      if (id === 'save') void save()
      else if (id === 'undo' && view) undo(view)
      else if (id === 'redo' && view) redo(view)
      else if (id === 'selectAll' && view) selectAll(view)
      else if (id === 'copyPath' && cur.value) void copyPath(cur.value)
    },
  )
}

// 状态栏手选语言 → 就地重配（决策 #1241）。只在"当前打开的这个文件"上生效，
// 且生效值没变时不重复 dispatch（切标签时 path 变化也会触发本 watch）。
watch(
  () => `${editorLang.path}|${langOverrides[editorLang.path] ?? ''}`,
  () => {
    const p = editorLang.path
    if (!view || !p || p !== cur.value) return
    const eff = effectiveLangId(p)
    if (host.value?.getAttribute('data-lang') === eff) return
    view.dispatch({ effects: langComp.reconfigure(langExtension(eff)) })
    host.value?.setAttribute('data-lang', eff)
    states.set(p, view.state)
    if (langOverrides[p]) pushToast(`语言模式：${langLabel(eff)}`, 'info')
  },
)

/**
 * 保存**指定文件**（不一定是当前标签）——关闭其他标签时要能把它们一起存掉。
 * 返回是否成功（失败会自己弹错误 toast，调用方据此决定要不要继续关闭）。
 */
async function savePath(path: string): Promise<boolean> {
  const rec = recs.get(path)
  if (!rec) return false
  const st = path === cur.value && view ? view.state : states.get(path)
  if (!st) return false
  const body = st.doc.toString()
  if (body === rec.base) return true
  try {
    const nm = await writeText(path, body, rec.mtime)
    rec.base = body
    rec.mtime = nm
    states.set(path, st)
    setTabDirty(path, false)
    if (path === cur.value) dirty.value = false
    return true
  } catch (e) {
    // ★失败必须显示出来：静默失败的保存比不保存更糟（用户以为已落盘）
    pushToast(String((e as Error)?.message ?? e), 'err')
    return false
  }
}

async function save() {
  if (!cur.value || saving.value) return
  saving.value = true
  const ok = await savePath(cur.value)
  saving.value = false
  if (ok) {
    pushToast(`已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`)
    void refreshGit()
  }
}

/* ── Git 只读（决策 #1246）：状态与拉取都在 `ui/src/git.ts`（#1247 拆出，GitBar.vue 渲染）
 *    —— 这里只负责"保存后刷新一下"，因为那件事发生时用户在编辑器里。 ─────────── */

/* ── Diff 视图（决策 #1245）：比"磁盘基线 vs 当前缓冲" ───────────────────── */
const showDiff = ref(false)
const diffBase = ref('')
const diffNow = ref('')
const diffSource = ref<'disk' | 'head'>('disk')
const headText = ref<string | null>(null)

function refreshDiff() {
  const p = cur.value
  if (!p) return
  const rec = recs.get(p)
  if (!rec) return
  diffBase.value = diffSource.value === 'head' ? (headText.value ?? '') : rec.base
  diffNow.value = view ? view.state.doc.toString() : ''
}

/** 切换 Diff 的来源：磁盘基线 / git HEAD（只读；未跟踪的文件没有 HEAD 版本） */
async function switchDiffSource(src: 'disk' | 'head') {
  diffSource.value = src
  if (src === 'head' && cur.value) {
    try {
      headText.value = await gitHead(cur.value)
    } catch {
      headText.value = null
    }
  }
  refreshDiff()
}

/** 进入 Diff 并切到指定来源（`open(path, { diff })` 走这里，决策 #1247） */
async function enterDiff(src: 'disk' | 'head') {
  showDiff.value = true
  await switchDiffSource(src)
}

/**
 * 打开文件后把 Diff 对齐到**当前这个文件**（决策 #1247 修的一个真缺陷）。
 * ★`headText` 是**上一个文件**的 HEAD 内容。原来读盘分支只调了 `refreshDiff()`，
 *   于是"来源=HEAD 时切到另一个文件"会把 A 的 HEAD 与 B 的缓冲做 diff ——
 *   行号连续、增减数看着合理，**内容完全串了**，而且不会报错。
 *   来源是 head 就必须为当前文件重取；不能指望"上次抓的那份还能用"。
 */
async function syncDiffAfterOpen(src?: 'disk' | 'head') {
  if (src) {
    await enterDiff(src)
    return
  }
  if (!showDiff.value) return
  if (diffSource.value === 'head') await switchDiffSource('head')
  else refreshDiff()
}

/**
 * Git 清单项 → "打开 + 直接看相对 HEAD 的改动"（决策 #1247 的联动）。
 * ★未跟踪文件（`?`）的 HEAD 版本不存在，仍进 Diff：头部会写"HEAD 里没有这个文件"，
 *   这是**事实**不是错误——比"点了没反应"好得多。
 */
function openChanged(path: string) {
  void open(path, { diff: 'head' })
}

function toggleDiff() {
  showDiff.value = !showDiff.value
  if (showDiff.value) refreshDiff()
}

/** 这个文件有没有未保存改动（不依赖"当前标签"，关闭其他标签时也要能判断） */
function isDirtyPath(path: string): boolean {
  const rec = recs.get(path)
  if (!rec) return false
  const st = path === cur.value && view ? view.state : states.get(path)
  return !!st && st.doc.toString() !== rec.base
}

/**
 * 关闭前的拦截（决策 #1243）：
 * 有未保存改动就**三选一**——保存并关闭 / 不保存 / 取消。取消是默认落点（防手滑）。
 * 多个文件一起关时也走这一条，只是文案换成"共 N 个文件"。
 */
async function confirmDiscard(paths: string[]): Promise<boolean> {
  const names = paths.map((p) => p.split('/').pop() ?? p)
  const one = paths.length === 1
  const r = await ask({
    title: one ? '有未保存的修改' : `${paths.length} 个文件有未保存的修改`,
    body: one
      ? `「${names[0]}」还没保存。关闭后这些修改会丢失。`
      : `${names.slice(0, 4).join('、')}${names.length > 4 ? ` 等 ${names.length} 个文件` : ''} 还没保存。关闭后这些修改会丢失。`,
    actions: [
      { id: 'save', label: one ? '保存并关闭' : '全部保存并关闭', kind: 'default' },
      { id: 'discard', label: '不保存', kind: 'danger' },
      { id: 'cancel', label: '取消', kind: 'cancel' },
    ],
  })
  if (r === 'cancel') return false
  if (r === 'save') {
    for (const p of paths) {
      const ok = await savePath(p)
      if (!ok) return false // 存盘失败就别关，别让人以为存上了
    }
  }
  return true
}

async function boot() {
  mountEditor()
  if (!hasBridge()) {
    err.value = '无 Tauri 桥（浏览器直开时属正常）'
    return
  }
  // ★必须等"从磁盘恢复完毕"：本组件的 onMounted 早于父组件 App 的 hydrate，
  //   直接读 ws.codeFile 会拿到 ''（然后打开默认文件并把用户上次的选择覆盖掉）。
  await whenHydrated()
  try {
    files.value = await listFiles([...ROOTS])
  } catch (e) {
    err.value = String((e as Error)?.message ?? e)
    return
  }
  if (files.value.length === 0) {
    err.value = '文件列表为空（仓库根可达但没匹配到源码）'
    return
  }
  // 优先级：**上次打开的文件**（若还在列表里）> App.vue（自证）> 第一条
  // ★上次那个文件可能已被删/改名 ⇒ 找不到就体面回退，而不是报错
  const pref =
    files.value.find((f) => f === ws.codeFile) ??
    files.value.find((f) => f.endsWith('ui/src/App.vue')) ??
    files.value[0]!
  // 恢复上次的标签列表：只留"磁盘上还在"的（被删/改名的体面丢弃），当前文件排最前
  const restored = ws.openFiles.filter((p) => files.value.includes(p))
  await open(pref)
  for (const p of restored) if (p !== pref && !tabs.value.includes(p)) tabs.value.push(p)
  ws.openFiles = [...tabs.value]
}

/** 切到代码视图时补两件事（启动阶段面板是 v-show 隐藏的）：
 *  ① `requestMeasure()`：隐藏时量的宽高是 0，显示后不重量，滚动/视口映射可能是错的；
 *  ② 继续预热解析（只在可见时做，避免设备投屏时白烧 CPU）。 */
watch(
  () => ws.view,
  (v) => {
    if (v !== 'code' || !view) return
    nextTick(() => {
      view?.requestMeasure()
      warmParse(view!)
    })
  },
)


/* ─── 菜单动作（决策 #1221）：文件菜单属于编辑器，注册在这里 ──────────────────
 * ★⌘S / ⌘W 的**唯一**通路在真机上是菜单（accelerator 在 NSApplication 层被吃掉，
 *   CodeMirror 的 keymap 收不到）。所以这两个处理器不是"锦上添花"，
 *   少了它们真机上按 ⌘S 就真的什么都不会发生。 */
/** 焦点是否在普通输入框里（搜索框/未来的表单）——
 *  这时撤销/全选该作用于**输入框**，不是编辑器文档。 */
function inPlainInput(): boolean {
  const el = document.activeElement as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
}

const menuOffs = [
  onMenuAction('file.save', () => void save()),
  onMenuAction('edit.find', () => searchBox.value?.focus()),
  // 撤销/重做/全选：菜单加速键会把 ⌘Z 吃掉（见 src/menu.rs 注释），所以真正的实现在这里。
  onMenuAction('edit.undo', () => {
    if (inPlainInput()) document.execCommand('undo')
    else if (view) undo(view)
  }),
  onMenuAction('edit.redo', () => {
    if (inPlainInput()) document.execCommand('redo')
    else if (view) redo(view)
  }),
  onMenuAction('edit.selectAll', () => {
    if (inPlainInput()) document.execCommand('selectAll')
    else if (view) selectAll(view)
  }),
  onMenuAction('file.closeTab', () => {
    if (cur.value) close(cur.value)
  }),
]

/** 脏缓冲数量同步给 Rust（决策 #1244）：窗口的关闭请求在**系统层**就要判断，前端来不及接。 */
watch(
  () => dirtySet.value.length,
  (n) => {
    if (hasBridge()) void invoke('set_dirty_count', { n })
  },
  { immediate: true },
)

/** 关闭被拦下（⌘W 关窗口 / 点红点 / ⌘Q）⇒ 弹同一套三选一；选完再放行。 */
const offCloseBlocked = onCloseBlocked((n) => {
  const dirty = [...dirtySet.value]
  void (async () => {
    if (!dirty.length || (await confirmDiscard(dirty))) await invoke('close_now')
    else if (n > 0) pushToast('已取消关闭', 'info')
  })()
})

onMounted(boot)
/* ⌘P 监听（决策 #1396）：与 boot 分开挂，避免把启动流程改成 async 包装 */
onMounted(() => window.addEventListener('keydown', onQuickKey, true))
// 首帧后拉一次 git 状态（只读；非仓库会自己降级）
void refreshGit()
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onQuickKey, true)
  window.removeEventListener('keydown', onQuickKey, true)
  offCloseBlocked()
  view?.destroy()
  view = null
  menuOffs.forEach((off) => off())
})
</script>

<template>
  <div class="codepane">
    <!-- ⌘P 快速打开（决策 #1396）：浮在编辑器之上，不挡文件树 -->
    <QuickOpen v-if="quickOpen" :files="files" :cur="cur" @pick="onQuickPick" @close="quickOpen = false" />
    <div class="split">
      <!-- 左栏（决策 #1222）：搜索框常驻顶部；一旦有查询，结果列表**替换**目录树
           （VS Code 同款：同一时刻只有一个列表，不叠浮层、不用管 z 序）。 -->
      <div
        class="side"
        :class="{ hidden: treeHidden }"
        :style="{ width: (treeHidden ? 0 : treeW) + 'px' }"
      >
        <!-- 拖动条（决策 #1344）：代码视图的"左栏"就是这棵文件树，宽度可拖、可收起。
             ★放在 `.side` 内部是安全的：门禁按 `#codeFiles button[data-file]` 选文件，
               不做 nth-child 序号假设（与 rail 的情况不同，那里不能插节点）。 -->
        <div class="treegrip" title="拖动调整文件树宽度（⌘B 收起/展开）" @pointerdown="startDrag('tree', $event)" />
        <!-- 搜索框常驻顶部；一旦有查询，结果列表**替换**目录树（VS Code 同款：同一时刻一个列表） -->
        <SearchBox ref="searchBox" @jump="jumpTo" @active="searchActive = $event" />
        <!-- Git 只读条（决策 #1246 · #1247 拆成组件）：分支 + 改动数；点清单项 = 打开 + 看 HEAD diff -->
        <GitBar :cur="cur" @open="openChanged" />
        <!-- 文件树（#1247 拆成组件）：只在没有搜索查询时显示（同一时刻只有一个列表） -->
        <FileTree
          v-if="!searchActive"
          :files="files"
          :cur="cur"
          @open="open"
          @copy="copyPath"
          @refresh="refreshFiles"
        />
      </div>
      <!-- ★右栏 = 编辑器自己的区域（决策 #1218）：文件信息条 + 标签栏 + 编辑器**都在这里**。
           原先它们是 `.codepane` 的直接子元素 ⇒ 横跨整页、压在左栏树上面（用户截图指出）。
           IDE 的通用布局就是"左栏只有树，编辑器头部跟着编辑器"。 -->
      <!-- ★编辑器列让出终端面板高度（决策 #1348）：终端浮在它下方，
           不给 padding 的话最后几行代码会被盖住。文件树（.side）**不**让，所以它占满整列。 -->
      <div class="pane" :style="{ paddingBottom: termMode !== 'off' ? termH + 'px' : undefined }">

        <!-- 跳行（⌘G）：内联输入，不用 window.prompt（WKWebView 不支持） -->
        <div v-if="edGotoOpen" class="edfind goto" @click.stop>
          <span class="lbl">行</span>
          <input
            id="edGotoInput"
            v-model="edGotoVal"
            placeholder="行号"
            inputmode="numeric"
            @keydown.enter.prevent="gotoCommit"
            @keydown.esc.prevent="((edGotoOpen = false), view?.focus())"
          />
          <button title="跳转（Enter）" @click="gotoCommit">↵</button>
          <button title="取消（Esc）" @click="((edGotoOpen = false), view?.focus())">✕</button>
        </div>

        <!-- 编辑器内查找（决策 #1400）：⌘F 打开；Enter/⇧Enter 逐个命中（每次选中并滚入视野） -->
        <div v-if="edFindOpen" class="edfind" @click.stop>
          <input
            id="edFindInput"
            v-model="edFindQ"
            placeholder="在文件中查找"
            spellcheck="false"
            @keydown.enter.prevent="edFindStep($event.shiftKey)"
            @keydown.esc.prevent="edFindClose"
          />
          <span class="cnt">{{ edFindQ ? (edFindTotal ? `${edFindAt + 1}/${edFindTotal}` : '无命中') : '' }}</span>
          <button title="上一个（⇧Enter）" @click="edFindStep(true)">↑</button>
          <button title="下一个（Enter）" @click="edFindStep(false)">↓</button>
          <button title="关闭（Esc）" @click="edFindClose">✕</button>
        </div>
        <div class="bar">
          <span class="path" id="codePath" :title="cur">{{ cur || '—' }}</span>
          <span class="meta" id="codeMeta">{{ loading ? '读取中…' : `${lineCount} 行` }}</span>
          <!-- 未保存：可点的 chip（⌘S 之外的第二条路径） -->
          <button v-if="dirty" class="dirty" id="codeDirty" title="保存（⌘S）" @click="save">
            <span class="bullet" />未保存
          </button>
          <span v-else-if="saving" class="meta">保存中…</span>
          <button class="dtoggle" id="diffToggle" :class="{ on: showDiff }" :aria-pressed="showDiff"
                  :title="showDiff ? (diffSource === 'head' ? '当前对比 git HEAD（只读）' : '当前对比磁盘上的版本') : '对比磁盘上的版本（看未保存的改动）'"
                  @click="toggleDiff">
            Diff
          </button>
          <span style="flex: 1" />
          <span class="note" id="codeNote">⌘S 保存 · 底部可切语言模式（28 种）</span>
        </div>
        <!-- 标签栏（2026-10-25 · 决策 #1217 · #1247 拆成组件）：点=切换，×=关闭，小圆点=未保存。
             ★标签只负责"切换文件"，缓冲与 undo 历史在 states 池里，切标签不重建 state。 -->
        <TabBar :tabs="tabs" :cur="cur" :dirty="dirtySet" @open="open" @close="close" @menu="onTabMenu" />
        <div v-if="err" class="err" id="codeErr">{{ err }}</div>
        <!-- ★编辑器宿主：#canvas 之类都不在这里，CodeMirror 自己管滚动与测量 -->
        <div v-show="!err && !showDiff" class="host" id="codeHost" ref="host" @contextmenu.prevent="onEditorMenu" />
        <DiffView
          v-if="showDiff"
          :original="diffBase"
          :modified="diffNow"
          :path="cur"
          :source="diffSource"
          :missing="diffSource === 'head' && headText === null"
          @switch="switchDiffSource"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.codepane {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-canvas);
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--sp2);
  height: 32px;
  padding: 0 var(--sp3);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
}
.path {
  max-width: 34%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.meta {
  font-variant-numeric: tabular-nums;
}
.note {
  color: var(--fg-subtle);
}
/* 未保存：chip 形态（可点保存），比一个纯圆点更明确 */
.dirty {
  display: inline-flex;
  align-items: center;
  gap: var(--sp1);
  height: 20px;
  padding: 0 var(--sp2);
  border: 1px solid var(--warn);
  border-radius: var(--r-pill);
  background: var(--warn-weak);
  color: var(--warn);
  font-size: var(--fs-2xs);
  cursor: pointer;
}
.dirty:hover {
  background: var(--warn);
  color: var(--bg-canvas);
}
.bullet {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.split {
  flex: 1;
  min-height: 0;
  display: flex;
}
/* 左栏容器（决策 #1222/#1223）：上面是 SearchBox（它自带样式），下面要么目录树、要么结果 */
.side {
  /* 宽度由内联 style 控制（决策 #1344）；这里只保留结构性约束 */
  position: relative;
  flex: none;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
}
/* Diff 开关：低存在感的文字按钮，开了才亮（和"未保存"chip 区分开，别抢注意力） */
.dtoggle{flex:none;height:18px;padding:0 6px;border:1px solid transparent;border-radius:var(--r-sm);
  background:transparent;color:var(--fg-subtle);font:11px/16px -apple-system,'PingFang SC',sans-serif;
  cursor:pointer}
.dtoggle:hover{background:var(--bg-overlay);border-color:var(--border-subtle);color:var(--fg)}
.dtoggle.on{background:rgba(255,255,255,.08);border-color:var(--border);color:var(--fg)}
.pane {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 编辑器宿主：撑满剩余空间；滚动交给 .cm-scroller */
.host {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  user-select: text;
}
.err {
  margin: var(--sp4);
  padding: var(--sp2) var(--sp3);
  border: 1px solid var(--bad);
  border-radius: var(--r-md);
  background: var(--bad-weak);
  color: var(--bad);
  font-size: var(--fs-sm);
  white-space: pre-wrap;
  user-select: text;
}

/* 文件树收起时：不留边距与边框，否则会剩一条"空壳" */
.side.hidden { padding: 0; border-right: none; overflow: hidden; }
/* 拖拽条：贴在文件树右缘（6px 命中区，hover 才亮） */
.treegrip { position: absolute; top: 0; bottom: 0; right: -3px; width: 6px;
            cursor: col-resize; z-index: 5; background: transparent; transition: background .12s; }
.treegrip:hover { background: var(--accent); opacity: .35; }

/* 编辑器内查找框（决策 #1400）：贴右上角，不遮代码首行（下面是 .bar 的高度） */
.edfind {
  position: absolute;
  right: 10px;
  top: 34px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 7px;
  box-shadow: 0 8px 22px rgb(0 0 0 / 40%);
}
.edfind.goto .lbl { font-size: 10px; color: var(--fg-subtle); }
.edfind.goto input { width: 72px; }
.edfind input {
  width: 168px;
  height: 20px;
  padding: 0 5px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: var(--bg-canvas);
  color: var(--fg);
  font: inherit;
  font-size: 11px;
  outline: none;
}
.edfind input:focus { border-color: var(--accent); }
.edfind .cnt { min-width: 34px; font-size: 10px; color: var(--fg-subtle); text-align: right; }
.edfind button {
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-subtle);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
}
.edfind button:hover { background: var(--bg-overlay); color: var(--fg); }
</style>
