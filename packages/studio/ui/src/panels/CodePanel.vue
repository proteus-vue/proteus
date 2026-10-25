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

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import { copyText, hasBridge, listFiles, readText, writeText, type SearchHit } from '../bridge'
import { useWorkspaceState, whenHydrated } from '../useWorkspaceState'
import { onMenuAction } from '../menu'
import StudioIcon from '../icons/StudioIcon.vue'
import SearchBox from './SearchBox.vue'
import FileIcon from '../icons/FileIcon.vue'
import FolderIcon from '../icons/FolderIcon.vue'
import { openMenu } from '../contextmenu'
import { pushToast } from '../toast'
import { fileTypeIcon } from '../fileIcons'

/** ★G5：上次打开的文件 / 折叠的目录都存在工作区会话里（重启恢复）。 */
const ws = useWorkspaceState()
/** 列哪些子树（都是 Studio 自己的源码——显示它自己，一眼能核对"屏幕这段 == 仓库那段"） */
const ROOTS = ['packages/studio/ui/src', 'packages/studio/src', 'packages/studio/native'] as const

const files = ref<string[]>([])
const cur = ref('')
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


/* ─── 目录树（扁平化渲染：一次 v-for + 缩进，比递归组件少一层抽象）───────────── */
interface TreeNode {
  name: string
  path: string
  dir: boolean
  children: TreeNode[]
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', dir: true, children: [] }
  for (const p of paths) {
    const parts = p.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!
      const isLeaf = i === parts.length - 1
      let next = node.children.find((c) => c.name === name)
      if (!next) {
        next = { name, path: parts.slice(0, i + 1).join('/'), dir: !isLeaf, children: [] }
        node.children.push(next)
      }
      node = next
    }
  }
  // 目录在前、文件在后，同级按名字（不区分大小写）——IDE 的通用排序
  const sort = (ns: TreeNode[]) => {
    ns.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    ns.forEach((n) => sort(n.children))
  }
  sort(root.children)
  return root.children
}

const tree = computed(() => buildTree(files.value))
const rows = computed<{ node: TreeNode; depth: number }[]>(() => {
  const out: { node: TreeNode; depth: number }[] = []
  const walk = (ns: TreeNode[], depth: number) => {
    for (const n of ns) {
      out.push({ node: n, depth })
      if (n.dir && !ws.codeCollapsed.includes(n.path)) walk(n.children, depth + 1)
    }
  }
  walk(tree.value, 0)
  return out
})

function toggle(dir: string) {
  const i = ws.codeCollapsed.indexOf(dir)
  if (i >= 0) ws.codeCollapsed.splice(i, 1)
  else ws.codeCollapsed.push(dir)
}

/** 打开文件时把它所在的所有目录展开（否则文件被折叠在看不见的地方） */
function revealPath(path: string) {
  const parts = path.split('/')
  for (let i = 1; i < parts.length; i++) {
    const j = ws.codeCollapsed.indexOf(parts.slice(0, i).join('/'))
    if (j >= 0) ws.codeCollapsed.splice(j, 1)
  }
}

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

async function open(path: string) {
  if (!path) return
  // ★点同一个标签 = 什么都不做：重新读盘会把未保存内容与 undo 历史一起冲掉
  if (path === cur.value && states.has(path)) return
  cur.value = path
  ws.codeFile = path
  revealPath(path)
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
function closeOthers(keep: string) {
  for (const p of [...tabs.value]) if (p !== keep) forget(p)
  if (cur.value !== keep) void open(keep)
}

/** 关掉 `path` 右侧的所有标签 */
function closeRight(path: string) {
  const i = tabs.value.indexOf(path)
  if (i < 0) return
  for (const p of tabs.value.slice(i + 1)) forget(p)
}

function close(path: string) {
  const i = tabs.value.indexOf(path)
  if (i < 0) return
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

function onNodeMenu(e: MouseEvent, node: { path: string; dir: boolean }) {
  const collapsed = ws.codeCollapsed.includes(node.path)
  openMenu(
    e,
    [
      node.dir
        ? { id: 'toggle', label: collapsed ? '展开目录' : '折叠目录' }
        : { id: 'open', label: '打开' },
      { id: 's1', label: '', sep: true },
      { id: 'copyPath', label: '复制相对路径' },
      { id: 'refresh', label: '刷新文件树' },
    ],
    (id) => {
      if (id === 'toggle') toggle(node.path)
      else if (id === 'open') void open(node.path)
      else if (id === 'copyPath') void copyPath(node.path)
      else if (id === 'refresh') void refreshFiles()
    },
  )
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

/** 树行图标：目录分展开/折叠；文件按扩展名取类型图标与类型色 */
function nodeIcon(node: { path: string; dir: boolean }): { name: string; color?: string } {
  if (node.dir) return { name: ws.codeCollapsed.includes(node.path) ? 'folder' : 'folderOpen' }
  const t = fileTypeIcon(node.path)
  return t ? { name: t.icon, color: t.color } : { name: 'file' }
}

async function save() {
  if (!view || !cur.value || saving.value) return
  const rec = recs.get(cur.value)
  if (!rec) return
  const body = view.state.doc.toString()
  if (body === rec.base) return
  saving.value = true
  try {
    const nm = await writeText(cur.value, body, rec.mtime)
    rec.base = body
    rec.mtime = nm
    dirty.value = false
    setTabDirty(cur.value, false)
    states.set(cur.value, view.state)
    pushToast(`已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`)
  } catch (e) {
    // ★失败必须显示出来：静默失败的保存比不保存更糟（用户以为已落盘）
    pushToast(String((e as Error)?.message ?? e), 'err')
  } finally {
    saving.value = false
  }
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
const menuOffs = [
  onMenuAction('file.save', () => void save()),
  onMenuAction('edit.find', () => searchBox.value?.focus()),
  onMenuAction('file.closeTab', () => {
    if (cur.value) close(cur.value)
  }),
]

onMounted(boot)
onBeforeUnmount(() => {
  view?.destroy()
  view = null
  menuOffs.forEach((off) => off())
})
</script>

<template>
  <div class="codepane">
    <div class="split">
      <!-- 左栏（决策 #1222）：搜索框常驻顶部；一旦有查询，结果列表**替换**目录树
           （VS Code 同款：同一时刻只有一个列表，不叠浮层、不用管 z 序）。 -->
      <div class="side">
        <!-- 搜索框常驻顶部；一旦有查询，结果列表**替换**目录树（VS Code 同款：同一时刻一个列表） -->
        <SearchBox ref="searchBox" @jump="jumpTo" @active="searchActive = $event" />
        <nav v-if="!searchActive" class="files" id="codeFiles">
        <button
          v-for="r in rows"
          :key="r.node.path"
          :class="{ on: r.node.path === cur, dir: r.node.dir }"
          :style="{ paddingLeft: `${8 + r.depth * 14}px` }"
          :title="r.node.path"
          :data-dir="r.node.dir ? r.node.path : undefined"
          :data-file="r.node.dir ? undefined : r.node.path"
          :aria-expanded="r.node.dir ? !ws.codeCollapsed.includes(r.node.path) : undefined"
          :data-icon="nodeIcon(r.node).name"
          @click="r.node.dir ? toggle(r.node.path) : open(r.node.path)"
          @contextmenu.prevent.stop="onNodeMenu($event, r.node)"
        >
          <!-- ★不再画折叠箭头（决策 #1238）：目录**图标本身**就是展开/折叠的开关——
               闭合与展开是两套形状，点行即切；层级改由缩进表达。
               少一个 12px 箭头，名字整体左移，和同级文件名的左边界才真正对齐。 -->
          <FolderIcon v-if="r.node.dir" :open="!ws.codeCollapsed.includes(r.node.path)" :size="16" class="ico" />
          <FileIcon v-else :path="r.node.path" :size="16" class="ico" />
          <span class="name">{{ r.node.name }}</span>
        </button>
        </nav>
      </div>
      <!-- ★右栏 = 编辑器自己的区域（决策 #1218）：文件信息条 + 标签栏 + 编辑器**都在这里**。
           原先它们是 `.codepane` 的直接子元素 ⇒ 横跨整页、压在左栏树上面（用户截图指出）。
           IDE 的通用布局就是"左栏只有树，编辑器头部跟着编辑器"。 -->
      <div class="pane">
        <div class="bar">
          <span class="path" id="codePath" :title="cur">{{ cur || '—' }}</span>
          <span class="meta" id="codeMeta">{{ loading ? '读取中…' : `${lineCount} 行` }}</span>
          <!-- 未保存：可点的 chip（⌘S 之外的第二条路径） -->
          <button v-if="dirty" class="dirty" id="codeDirty" title="保存（⌘S）" @click="save">
            <span class="bullet" />未保存
          </button>
          <span v-else-if="saving" class="meta">保存中…</span>
          <span style="flex: 1" />
          <span class="note" id="codeNote">⌘S 保存 · 底部可切语言模式（28 种）</span>
        </div>
        <!-- 标签栏（2026-10-25 · 决策 #1217）：点=切换，×=关闭，小圆点=未保存。
             ★标签只负责"切换文件"，缓冲与 undo 历史在 states 池里，切标签不重建 state。 -->
        <div v-if="tabs.length" class="tabs" id="codeTabs">
          <button
            v-for="p in tabs"
            :key="p"
            class="tab"
            :class="{ on: p === cur }"
            :title="p"
            :data-tab="p"
            @click="open(p)"
            @contextmenu.prevent.stop="onTabMenu($event, p)"
          >
            <span class="tname">{{ p.split('/').pop() }}</span>
            <span v-if="dirtySet.includes(p)" class="tdot" aria-label="未保存" />
            <span class="tclose" role="button" aria-label="关闭" @click.stop="close(p)">×</span>
          </button>
        </div>
        <div v-if="err" class="err" id="codeErr">{{ err }}</div>
        <!-- ★编辑器宿主：#canvas 之类都不在这里，CodeMirror 自己管滚动与测量 -->
        <div v-show="!err" class="host" id="codeHost" ref="host" @contextmenu.prevent="onEditorMenu" />
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
  width: 232px;
  flex: none;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
}
/* 目录树（次级侧栏）：行高 24px，落在 4px 网格上 */
.files {
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--sp1) 0;
}
.files button {
  display: flex;
  align-items: center;
  gap: var(--sp1);
  width: 100%;
  height: 24px;
  padding-right: var(--sp2);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--fg-muted);
  font: var(--fs-xs) / 24px ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease);
}
.files button:hover {
  background: var(--bg-overlay);
  color: var(--fg);
}
.files button.on {
  background: var(--bg-elevated);
  color: var(--fg);
  /* 选中态：左侧 2px 强调条（与活动栏同一套语汇，不靠"变亮"单维度区分） */
  box-shadow: inset 2px 0 0 var(--accent);
}
.files button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.files button.dir {
  color: var(--fg);
}
.ico {
  flex: none;
  opacity: 0.8;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pane {
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
/* 标签栏：行高 28px（4px 网格）；活动标签用底部 2px 强调条，不靠"变亮"单维度 */
.tabs {
  flex: none;
  display: flex;
  align-items: stretch;
  height: 28px;
  padding: 0 var(--sp1);
  gap: 2px;
  overflow-x: auto;
  background: var(--bg-canvas);
  border-bottom: 1px solid var(--border-subtle);
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar {
  display: none;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: var(--sp1);
  max-width: 220px;
  padding: 0 var(--sp2);
  border: 0;
  border-radius: var(--r-sm) var(--r-sm) 0 0;
  background: transparent;
  color: var(--fg-muted);
  font: var(--fs-xs) / 28px ui-monospace, SFMono-Regular, Menlo, monospace;
  cursor: pointer;
  box-shadow: inset 0 -2px 0 transparent;
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease);
}
.tab:hover {
  background: var(--bg-surface);
  color: var(--fg);
}
.tab.on {
  background: var(--bg-surface);
  color: var(--fg);
  box-shadow: inset 0 -2px 0 var(--accent);
}
.tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.tname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 未保存：一个 5px 圆点（与顶栏 chip 用同一语汇），不抢文字宽度 */
.tdot {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--warn);
}
/* 关闭：hover 才显形，常驻会显得很吵（IDE 的通用做法） */
.tclose {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: var(--r-sm);
  color: var(--fg-subtle);
  font-size: 13px;
  line-height: 13px;
  text-align: center;
  opacity: 0;
  transition: opacity var(--dur) var(--ease);
}
.tab:hover .tclose,
.tab.on .tclose,
.tclose:focus-visible {
  opacity: 1;
}
.tclose:hover {
  background: var(--bg-overlay);
  color: var(--fg);
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
</style>
