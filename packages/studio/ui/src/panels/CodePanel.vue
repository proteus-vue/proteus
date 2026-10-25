<script setup lang="ts">
// packages/studio/ui/src/panels/CodePanel.vue —— 代码视图：目录树 + **CodeMirror 6 编辑器**
//
// 【这一版换掉了什么】右侧的只读 `<pre>` → 真正的 CodeMirror 6 编辑器：
//   行号 / 当前行 / 选区 / 括号匹配 / Tab 缩进 / ⌘Z / **⌘S 写回**。
//   编辑器内核用现成的（G-56.1 红线：绝不自研），这里只做**接线与主题**。
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

import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
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
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { vue } from '@codemirror/lang-vue'
import { rust } from '@codemirror/lang-rust'
import { javascript } from '@codemirror/lang-javascript'
import { css } from '@codemirror/lang-css'
import { cpp, objectiveC } from '@codemirror/legacy-modes/mode/clike'
import languageMap from '../languages.json'
import { hasBridge, listFiles, readText, writeText } from '../bridge'
import { useWorkspaceState, whenHydrated } from '../useWorkspaceState'
import StudioIcon from '../icons/StudioIcon.vue'

/** ★G5：上次打开的文件 / 折叠的目录都存在工作区会话里（重启恢复）。 */
const ws = useWorkspaceState()
/** 列哪些子树（都是 Studio 自己的源码——显示它自己，一眼能核对"屏幕这段 == 仓库那段"） */
const ROOTS = ['packages/studio/ui/src', 'packages/studio/src', 'packages/studio/native'] as const
const PREFIX = 'packages/studio/'

const files = ref<string[]>([])
const cur = ref('')
const err = ref('')
const notice = ref('')
const loading = ref(false)
const saving = ref(false)
const dirty = ref(false)
const lineCount = ref(0)
const host = ref<HTMLElement | null>(null)

/** 打开时读到的 mtime（保存时回传做冲突检测）；0 = 未知 ⇒ Rust 侧不做阻断 */
let mtime = 0
/** 磁盘上的那份内容（判断"脏"的基准） */
let savedText = ''
let view: EditorView | null = null

/** 未保存缓冲：切走再切回来不丢编辑。
 *  ★为什么不用 `confirm()` 问"放弃修改？"：Tauri 的 WKWebView 需要宿主实现
 *    `runJavaScriptConfirmPanel`，没实现时 `confirm` 会**静默返回 false**——
 *    表现是"点了另一个文件没反应"，而且完全无声。IDE 的常规做法就是留住脏缓冲（多标签同款）。
 *  ★缓冲只在内存：刷新/重启即丢（磁盘上没有任何"临时副本"，不给仓库留垃圾）。
 *  ★`base`/`mtime` 记的是**用户开始编辑时**磁盘上的那份，保存时仍按它做冲突检测——
 *    否则切一次文件就会把"别人改过"这条线索刷新掉。 */
interface DirtyBuffer {
  text: string
  base: string
  mtime: number
}
const buffers = new Map<string, DirtyBuffer>()

const short = (p: string) => (p.startsWith(PREFIX) ? p.slice(PREFIX.length) : p)

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
/** ★扩展名 → 语言 id 的映射在 `ui/src/languages.json`（**单一真源**）。
 *  为什么放 JSON 而不是写在这里：门禁要按**同一份数据**扫真实目录（判据 ⑳ 覆盖表），
 *  写死在组件里就只能靠人盯着——而"新增了文件类型但忘了接语言"恰恰是没人会盯着的那类事。 */
const LANGUAGES = languageMap.languages as Record<string, string>

/** 语言 id → CodeMirror 扩展。★全仓只有这里出现"具体哪个语言包"，换/加包只改这一处。 */
const FACTORY: Record<string, () => Extension> = {
  vue: () => vue(),
  rust: () => rust(),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  css: () => css(),
  // ★ObjC 没有官方 Lezer 语法（社区也没成熟包）⇒ 用 legacy clike 的 objectiveC：
  //   能出 C 家族的关键字/字符串/数字/注释，ObjC 特有语法（`@interface`、`[obj msg]`）只当普通文本。
  //   这是业界通行降级；README 里如实写"到 C 级"，不吹成"支持 Objective-C"。
  objc: () => StreamLanguage.define(objectiveC),
  cpp: () => StreamLanguage.define(cpp),
}

function langFor(path: string) {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  const id = LANGUAGES[ext]
  return id && FACTORY[id] ? FACTORY[id]!() : [] // 未登记 / 未实现 ⇒ 纯文本
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
        if (u.docChanged) {
          const now = u.state.doc.toString()
          dirty.value = now !== savedText
          lineCount.value = u.state.doc.lines
        }
      }),
    ],
  })
}

function mountEditor() {
  if (!host.value) return
  view = new EditorView({ state: makeState('', ''), parent: host.value })
}

async function open(path: string) {
  // ① 离开当前文件前，把未保存的内容收进缓冲（不弹窗、不丢）
  if (dirty.value && cur.value && view) {
    buffers.set(cur.value, { text: view.state.doc.toString(), base: savedText, mtime })
  }
  cur.value = path
  ws.codeFile = path
  revealPath(path)
  loading.value = true
  err.value = ''
  notice.value = ''
  try {
    // ② 总是读一次磁盘：既要 baseline，也要"现在磁盘是什么样"这条事实
    const f = await readText(path)
    // ③ 有脏缓冲就恢复它（连带**当时**的 mtime，冲突检测才不会被切文件刷新掉）
    const buf = buffers.get(path)
    const doc = buf ? buf.text : f.text
    savedText = buf ? buf.base : f.text
    mtime = buf ? buf.mtime : f.mtime_us
    dirty.value = !!buf
    lineCount.value = doc ? doc.replace(/\n$/, '').split('\n').length : 0
    await nextTick()
    view?.setState(makeState(doc, path))
  } catch (e) {
    err.value = String((e as Error)?.message ?? e)
    savedText = ''
    dirty.value = false
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!view || !cur.value || saving.value) return
  const body = view.state.doc.toString()
  if (body === savedText) return
  saving.value = true
  notice.value = ''
  try {
    mtime = await writeText(cur.value, body, mtime)
    savedText = body
    dirty.value = false
    buffers.delete(cur.value)
    notice.value = `已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`
  } catch (e) {
    // ★失败必须显示出来：静默失败的保存比不保存更糟（用户以为已落盘）
    notice.value = String((e as Error)?.message ?? e)
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
  await open(pref)
}

onMounted(boot)
onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<template>
  <div class="codepane">
    <div class="bar">
      <span class="path" id="codePath" :title="cur">{{ cur || '—' }}</span>
      <span class="meta" id="codeMeta">{{ loading ? '读取中…' : `${lineCount} 行` }}</span>
      <!-- 未保存：可点的 chip（⌘S 之外的第二条路径） -->
      <button v-if="dirty" class="dirty" id="codeDirty" title="保存（⌘S）" @click="save">
        <span class="bullet" />未保存
      </button>
      <span v-else-if="saving" class="meta">保存中…</span>
      <span class="notice" id="codeNotice" :class="{ bad: !!notice && !notice.startsWith('已保存') }">
        {{ notice }}
      </span>
      <span style="flex: 1" />
      <span class="note" id="codeNote">⌘S 保存 · 着色 .vue/.rs/.ts/.css/.m</span>
    </div>
    <div class="split">
      <nav class="files" id="codeFiles">
        <button
          v-for="r in rows"
          :key="r.node.path"
          :class="{ on: r.node.path === cur, dir: r.node.dir }"
          :style="{ paddingLeft: `${8 + r.depth * 12}px` }"
          :title="r.node.path"
          :data-dir="r.node.dir ? r.node.path : undefined"
          :data-file="r.node.dir ? undefined : r.node.path"
          :aria-expanded="r.node.dir ? !ws.codeCollapsed.includes(r.node.path) : undefined"
          @click="r.node.dir ? toggle(r.node.path) : open(r.node.path)"
        >
          <!-- 折叠箭头 + 类型图标：箭头只占位不显示在文件行上，这样同级名字都对齐 -->
          <span
            class="caret"
            :class="{ open: r.node.dir && !ws.codeCollapsed.includes(r.node.path) }"
          >
            <StudioIcon v-if="r.node.dir" name="chevron" :size="12" />
          </span>
          <StudioIcon :name="r.node.dir ? 'folder' : 'file'" :size="13" class="ico" />
          <span class="name">{{ r.node.name }}</span>
        </button>
      </nav>
      <div class="pane">
        <div v-if="err" class="err" id="codeErr">{{ err }}</div>
        <!-- ★编辑器宿主：#canvas 之类都不在这里，CodeMirror 自己管滚动与测量 -->
        <div v-show="!err" class="host" id="codeHost" ref="host" />
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
.notice {
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-subtle);
  user-select: text;
}
/* 保存失败/冲突：红色，且**必须**能看清全文（这里用 title + 不截断宽度） */
.notice.bad {
  color: var(--bad);
  max-width: 60%;
}
.split {
  flex: 1;
  min-height: 0;
  display: flex;
}
/* 目录树（次级侧栏）：行高 24px，落在 4px 网格上 */
.files {
  width: 232px;
  flex: none;
  overflow: auto;
  padding: var(--sp1) 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
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
/* 折叠箭头：12px 固定宽度（文件行的空占位同宽，保证同级名字左对齐） */
.caret {
  flex: none;
  display: grid;
  place-items: center;
  width: 12px;
  height: 12px;
  transition: transform var(--dur) var(--ease);
}
.caret.open {
  transform: rotate(90deg);
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pane {
  flex: 1;
  min-width: 0;
  display: flex;
}
/* 编辑器宿主：撑满剩余空间；滚动交给 .cm-scroller */
.host {
  flex: 1;
  min-width: 0;
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
</style>
