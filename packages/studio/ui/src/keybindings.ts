/**
 * keybindings.ts —— 快捷键的**唯一注册表**（决策 #1431）
 *
 * 【为什么要有这一层】之前快捷键散落在 4 个文件里手写：
 *   `App.vue`（缩放 / ⌘B / ⌘J）、`CodePanel.vue`（⌘W / ⇧⌘F / ⌘P / ⌘⌥S）、
 *   `TerminalPanel.vue`（8 条）、以及 CodeMirror 的 `keymap.of([...])`。
 *   后果有两个：① 想改一个键要满仓 grep；② **没法按 IDE 习惯切换**（用户明确提出的需求）。
 *
 * 【设计】
 *   · `ActionId` 是"语义动作"（`editor.gotoDefinition`），**不是**"按键"；
 *   · `SCHEMES` 给出三套预设（VS Code / JetBrains / Sublime）的映射；
 *   · 面板通过 `onAction(id, fn)` 注册处理函数，**不关心键是什么**；
 *   · 用户选方案后写进 workspace state，重启保持。
 *
 * 【组合键写法】`Mod` = macOS `⌘` / 其它平台 `Ctrl`；`Shift` / `Alt` 照旧；
 *   例：`Mod+Shift+F`、`Mod+Alt+S`、`F12`、`Mod+\\`、`Mod+=`。
 *
 * 【只登记"应用级"动作】控件内部按键（Esc / Enter / 上下箭头）**不进注册表** ——
 *   它们属于控件行为，不是用户可配置的快捷键。
 */
import { ref } from 'vue'

export type KeymapScheme = 'vscode' | 'jetbrains' | 'sublime'

export type ActionId =
  | 'file.save'
  | 'file.saveAll'
  | 'file.closeTab'
  | 'editor.findInFile'
  | 'editor.searchRepo'
  | 'editor.gotoDefinition'
  | 'editor.quickOpen'
  | 'editor.gotoLine'
  | 'editor.selectNext'
  | 'view.toggleSidebar'
  | 'view.toggleTerminal'
  | 'view.toggleTerminalMax'
  | 'view.toggleRail'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.zoomReset'
  | 'term.new'
  | 'term.split'
  | 'term.find'

type Chords = Partial<Record<ActionId, string[]>>

/**
 * 三套预设。只写"有差异"的键，其余走 `BASE`（与 VS Code 一致）。
 * ★标注来源，避免以后又被问"F12 是谁的习惯"：
 *   · `F12` = **Visual Studio / VS Code** 的 Go to Definition；
 *   · `Mod+B` = **JetBrains** 的 Go to Declaration；
 *   · `Mod+Shift+O` = JetBrains 的 Go to File；`Mod+P` = VS Code / Sublime 的 Quick Open。
 */
const BASE: Chords = {
  'file.save': ['Mod+S'],
  'file.saveAll': ['Mod+Alt+S'],
  'file.closeTab': ['Mod+W'],
  'editor.findInFile': ['Mod+F'],
  'editor.searchRepo': ['Mod+Shift+F'],
  'editor.gotoDefinition': ['F12'],
  'editor.quickOpen': ['Mod+P'],
  'editor.gotoLine': ['Mod+G'],
  'editor.selectNext': ['Mod+D'],
  'view.toggleSidebar': ['Mod+B'],
  'view.toggleTerminal': ['Mod+J'],
  'view.toggleTerminalMax': ['Mod+Shift+J'],
  'view.toggleRail': ['Mod+Shift+B'],
  'view.zoomIn': ['Mod+='],
  'view.zoomOut': ['Mod+-'],
  'view.zoomReset': ['Mod+0'],
  'term.new': ['Mod+Shift+T'],
  'term.split': ['Mod+\\'],
  'term.find': ['Mod+F'],
}

export const SCHEMES: Record<KeymapScheme, Chords> = {
  vscode: {},
  jetbrains: {
    /* JetBrains：跳声明是 ⌘B；文件=⇧⌘O、符号=⇧⌘N（这里都映射到"快速打开"）；行=⌘L */
    'editor.gotoDefinition': ['Mod+B'],
    'editor.quickOpen': ['Mod+Shift+O', 'Mod+Shift+N'],
    'editor.gotoLine': ['Mod+L'],
    'editor.selectNext': ['Mod+Shift+D'], // IDEA 没有同款；避开 ⌘D（=Duplicate Line）
    'view.toggleSidebar': ['Mod+1'], // Project 视图
    'view.toggleTerminal': ['Alt+F12'], // Terminal
    'term.new': ['Alt+F12'], // IDEA 里 ⌥F12 就是开终端
    'term.split': ['Mod+Shift+\\'],
    'file.saveAll': ['Mod+S'], // IDEA 的 ⌘S 就是全部保存
    'file.save': ['Mod+S'],
  },
  sublime: {
    /* Sublime：⌘P 文件、⌘G 行、F12 定义（Sublime 4 的 goto_definition 默认 F12） */
    'editor.gotoDefinition': ['F12'],
    'editor.selectNext': ['Mod+D'],
    'file.saveAll': ['Mod+Alt+S'],
  },
}

/**
 * 方案存 `localStorage` 而不是 workspace state —— 理由是**设置窗口是独立 Tauri 窗口**：
 * 两个窗口各自持有一份 reactive state 时，主窗口的 deep watch 会把设置窗口刚写的值覆盖回去。
 * `localStorage` 同源共享，且 `storage` 事件会广播到**其它**窗口 ⇒ 改完立刻生效，无需重启。
 */
const KEY = 'proteus.keymapScheme'
const isScheme = (v: unknown): v is KeymapScheme => v === 'vscode' || v === 'jetbrains' || v === 'sublime'

function loadScheme(): KeymapScheme {
  try {
    const v = localStorage.getItem(KEY)
    return isScheme(v) ? v : 'vscode'
  } catch {
    return 'vscode'
  }
}

/**
 * 可自定义的动作清单（决策 #1433）—— **只列已经接线的**。
 * 不列 `editor.findInFile` / `editor.gotoLine` / `editor.selectNext` / `term.*`：
 * 它们目前由 CodeMirror 的 keymap 或终端面板内部固定绑定，改这里不会生效。
 */
export interface ActionMeta {
  id: ActionId
  label: string
  group: '文件' | '编辑' | '视图'
}
export const ACTIONS: ActionMeta[] = [
  { id: 'file.save', label: '保存', group: '文件' },
  { id: 'file.saveAll', label: '保存全部', group: '文件' },
  { id: 'file.closeTab', label: '关闭标签', group: '文件' },
  { id: 'editor.searchRepo', label: '仓库搜索', group: '编辑' },
  { id: 'editor.quickOpen', label: '快速打开文件', group: '编辑' },
  { id: 'editor.gotoDefinition', label: '跳转定义', group: '编辑' },
  { id: 'view.toggleSidebar', label: '切换主侧栏', group: '视图' },
  { id: 'view.toggleRail', label: '切换左窄栏', group: '视图' },
  { id: 'view.toggleTerminal', label: '切换终端', group: '视图' },
  { id: 'view.toggleTerminalMax', label: '终端最大化', group: '视图' },
  { id: 'view.zoomIn', label: '放大画布', group: '视图' },
  { id: 'view.zoomOut', label: '缩小画布', group: '视图' },
  { id: 'view.zoomReset', label: '画布复位', group: '视图' },
]

const scheme = ref<KeymapScheme>(loadScheme())
/** 供设置面板直接读（`v-model` 用不了，因为它要同时写 localStorage，见 `setScheme`） */
export const schemeState = scheme

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && isScheme(e.newValue)) scheme.value = e.newValue
  })
}

export const keymapSchemes: { value: KeymapScheme; label: string }[] = [
  { value: 'vscode', label: 'VS Code（默认）' },
  { value: 'jetbrains', label: 'JetBrains / IDEA' },
  { value: 'sublime', label: 'Sublime Text' },
]

export const currentScheme = () => scheme.value

export function setScheme(s: KeymapScheme): void {
  if (!isScheme(s)) return
  scheme.value = s
  try {
    localStorage.setItem(KEY, s)
  } catch {
    /* 隐私模式写不了：内存里仍生效，只是不持久 */
  }
}

/** 用户自定义覆盖：`null` = 没改过；空数组 = 用户清空了该动作的键 */
const OVER_KEY = 'proteus.keymapOverrides'
const overrides = ref<Partial<Record<ActionId, string[]>>>(loadOverrides())

function loadOverrides(): Partial<Record<ActionId, string[]>> {
  try {
    const raw = localStorage.getItem(OVER_KEY)
    const o = raw ? JSON.parse(raw) : null
    return o && typeof o === 'object' ? (o as Partial<Record<ActionId, string[]>>) : {}
  } catch {
    return {}
  }
}

function persistOverrides() {
  try {
    localStorage.setItem(OVER_KEY, JSON.stringify(overrides.value))
  } catch {
    /* 写不了就只在内存生效 */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === OVER_KEY) overrides.value = loadOverrides()
  })
}

/** 某个动作在**当前方案**下的所有组合键：自定义 > 方案 > BASE */
export function chordsOf(action: ActionId): string[] {
  const ov = overrides.value[action]
  if (ov) return ov.map(normalizeChord)
  return (SCHEMES[scheme.value][action] ?? BASE[action] ?? []).map(normalizeChord)
}

/** 该动作的出厂键位（换方案后跟着变，用于"恢复默认"的对照） */
export function defaultChordsOf(action: ActionId): string[] {
  return SCHEMES[scheme.value][action] ?? BASE[action] ?? []
}

export const isCustomized = (action: ActionId) => Array.isArray(overrides.value[action])

/** 设置某动作的键位；传 `null` 恢复默认，传 `[]` 表示"禁用该动作" */
export function setChords(action: ActionId, chords: string[] | null): void {
  if (chords === null) delete overrides.value[action]
  else overrides.value = { ...overrides.value, [action]: chords.map(normalizeChord) }
  persistOverrides()
}

export function resetAllChords(): void {
  overrides.value = {}
  persistOverrides()
}

/** 该键是否已被**别的**动作占用（返回占用它的动作标签） */
export function conflictOf(chord: string, except: ActionId): string | null {
  for (const a of ACTIONS) {
    if (a.id === except) continue
    if (chordsOf(a.id).some((c) => normalizeChord(c) === normalizeChord(chord))) return a.label
  }
  return null
}

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

interface Parsed {
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
}

/**
 * 组合键归一化：修饰符保持原样，**单字符键统一小写**。
 * ★为什么必须有这一步：预设里写的是 `Mod+Shift+F`，而录制出来的事件是 `Mod+Shift+f` ——
 *   直接比字符串永远不相等 ⇒ 冲突检测形同虚设（实测：把 `⇧⌘F` 绑到"保存全部"没被拦住）。
 */
export function normalizeChord(chord: string): string {
  return chord
    .split('+')
    .map((part) => (part.length === 1 ? part.toLowerCase() : part))
    .join('+')
}

function parse(chord: string): Parsed {
  const parts = chord.split('+')
  const key = (parts.pop() ?? '').toLowerCase()
  return {
    key,
    mod: parts.includes('Mod'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
  }
}

/** 事件里的键名归一化：字母小写；`Shift+=` 产出 `+`，按 `=` 处理 */
function keyOf(e: KeyboardEvent): string {
  const k = e.key
  if (k === '+') return '='
  if (k === ' ') return 'space'
  return k.toLowerCase()
}

/**
 * 录制态（决策 #1433）：设置面板录制新键时置位。
 * ★必须让 `installKeymap` 让路 —— 否则用户按 `⌘S` 想绑键，文件先被保存了。
 */
let capturing = false
export function beginCapture(): void {
  capturing = true
}
export function endCapture(): void {
  capturing = false
}

/** 从键盘事件生成 chord（`Mod+Shift+F`）；只按修饰键时返回 `null` */
export function chordFromEvent(e: KeyboardEvent): string | null {
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return null
  const parts: string[] = []
  if (isMac() ? e.metaKey : e.ctrlKey) parts.push('Mod')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(keyOf(e))
  return parts.join('+')
}

export function matchChord(e: KeyboardEvent, chord: string): boolean {
  const c = parse(chord)
  if (keyOf(e) !== c.key) return false
  const mac = isMac()
  /* Mod：mac 上必须 meta（且不带 ctrl）；其它平台必须 ctrl（且不带 meta） */
  if (c.mod) {
    if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return false
  } else if (e.metaKey || e.ctrlKey) {
    return false
  }
  if (c.shift !== e.shiftKey) return false
  /* `Alt` 在 mac 上会改字符（如 ⌥F12 仍是 F12），只比 altKey 本身 */
  if (c.alt !== e.altKey) return false
  return true
}

/** 事件命中的动作（按当前方案顺序匹配，先到先得） */
export function actionOf(e: KeyboardEvent): ActionId | null {
  /* 合并 BASE 与当前方案：方案里没覆盖的动作仍按 VS Code 习惯工作 */
  const merged: Chords = { ...BASE, ...SCHEMES[scheme.value] }
  for (const a of Object.keys(merged) as ActionId[]) {
    for (const chord of chordsOf(a)) {
      if (matchChord(e, chord)) return a
    }
  }
  return null
}

/* ── 注册与分发 ────────────────────────────────────────────────────────── */
type Handler = (e: KeyboardEvent) => void
const handlers = new Map<ActionId, Set<Handler>>()

/** 面板注册自己关心的动作；返回取消订阅函数（`onBeforeUnmount` 里调） */
export function onAction(id: ActionId, fn: Handler): () => void {
  const set = handlers.get(id) ?? new Set<Handler>()
  set.add(fn)
  handlers.set(id, set)
  return () => set.delete(fn)
}

/**
 * 安装全局分发（捕获阶段）。
 * ★用捕获而不是冒泡：编辑器/终端会把 keydown 消化掉，冒泡到 window 时可能已被 preventDefault。
 */
export function installKeymap(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing || capturing) return
    const action = actionOf(e)
    if (!action) return
    const set = handlers.get(action)
    if (!set || !set.size) return
    e.preventDefault()
    e.stopPropagation()
    for (const fn of set) fn(e)
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}

/** 显示用标签：`Mod+Shift+F` → `⇧⌘F`（mac）/ `Ctrl+Shift+F` */
export function chordLabel(action: ActionId): string {
  const chord = chordsOf(action)[0] ?? ''
  if (!chord) return ''
  const mac = isMac()
  const parts = parse(chord)
  const bits: string[] = []
  if (parts.mod) bits.push(mac ? '⌘' : 'Ctrl')
  if (parts.alt) bits.push(mac ? '⌥' : 'Alt')
  if (parts.shift) bits.push(mac ? '⇧' : 'Shift')
  bits.push(parts.key.toUpperCase())
  return mac ? bits.join('') : bits.join('+')
}
