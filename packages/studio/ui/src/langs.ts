// ui/src/langs.ts —— 语言模式注册表（决策 #1241）
//
// 【为什么要有"注册表"而不是散在组件里的 if】语言要能**被用户手动选**（状态栏的"语言模式"），
//   所以每个语言必须有：稳定 id、显示名、构造器。三者放一处，选单、状态栏、编辑器读同一份数据。
//
// 【能用官方 Lezer 就用官方，其余用 legacy-modes】
//   官方（@codemirror/lang-*）：Vue / TS / JS / JSX / Rust / CSS —— 有真实语法树，折叠/缩进都准。
//   legacy（@codemirror/legacy-modes）：流式分词，只有着色没有语法树 —— 但覆盖面极大（C/Java/Go/Python…）。
//   ★等级要如实说：legacy 语言只**着色**，不给结构化能力（README 里写清楚，不吹成"支持"）。
//
// 【Markdown 自己写了一个流模式】legacy-modes 这个版本里**没有** markdown 模式；
//   而 .md 是最常见的那类文件之一。这里用 StreamLanguage 写了个 40 行的最小实现：
//   标题/粗斜体/行内代码/围栏代码/引用/链接/列表。够读，不假装是完整 Markdown 解析器。
import { StreamLanguage, type StreamParser } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { rust } from '@codemirror/lang-rust'
import { css } from '@codemirror/lang-css'
import { vue } from '@codemirror/lang-vue'
import { c, cpp, java, kotlin, objectiveC } from '@codemirror/legacy-modes/mode/clike'
import { python } from '@codemirror/legacy-modes/mode/python'
import { go } from '@codemirror/legacy-modes/mode/go'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import { standardSQL } from '@codemirror/legacy-modes/mode/sql'
import { xml, html } from '@codemirror/legacy-modes/mode/xml'
import { json } from '@codemirror/legacy-modes/mode/javascript'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { diff } from '@codemirror/legacy-modes/mode/diff'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'

/** 最小 Markdown 流模式：只认"读文档时真的要区分"的几类 */
const markdown: StreamParser<unknown> = {
  startState: () => ({ fence: false }),
  token(stream, st) {
    const s = st as { fence: boolean }
    if (stream.sol() && /^\s*```/.test(stream.string)) {
      s.fence = !s.fence
      stream.skipToEnd()
      return 'comment'
    }
    if (s.fence) {
      stream.skipToEnd()
      return 'string'
    }
    if (stream.eatSpace()) return null
    if (stream.sol() && /^#{1,6}\s/.test(stream.string)) {
      stream.skipToEnd()
      return 'heading'
    }
    if (stream.sol() && /^\s*[-*+]\s/.test(stream.string)) {
      stream.next()
      return 'keyword'
    }
    if (stream.sol() && /^\s*>/.test(stream.string)) {
      stream.skipToEnd()
      return 'quote'
    }
    if (stream.match(/^`[^`]*`/)) return 'monospace'
    if (stream.match(/^\*\*[^*]+\*\*/) || stream.match(/^__[^_]+__/)) return 'strong'
    if (stream.match(/^\*[^*]+\*/) || stream.match(/^_[^_]+_/)) return 'emphasis'
    if (stream.match(/^!?\[[^\]]*\]\([^)]*\)/)) return 'link'
    stream.next()
    return null
  },
} as StreamParser<unknown>

export interface LangDef {
  id: string
  label: string
  /** 官方语法树（true）还是 legacy 流式着色（false）—— 状态栏/文档要如实区分 */
  ast: boolean
  make: () => Extension
}

/** ★顺序 = 选单顺序：先"本仓最常用"，再按字母 */
export const LANGS: LangDef[] = [
  { id: 'vue', label: 'Vue', ast: true, make: () => vue() },
  { id: 'ts', label: 'TypeScript', ast: true, make: () => javascript({ typescript: true }) },
  { id: 'tsx', label: 'TSX', ast: true, make: () => javascript({ typescript: true, jsx: true }) },
  { id: 'js', label: 'JavaScript', ast: true, make: () => javascript() },
  { id: 'jsx', label: 'JSX', ast: true, make: () => javascript({ jsx: true }) },
  { id: 'rust', label: 'Rust', ast: true, make: () => rust() },
  { id: 'css', label: 'CSS', ast: true, make: () => css() },
  { id: 'json', label: 'JSON', ast: false, make: () => StreamLanguage.define(json) },
  { id: 'md', label: 'Markdown', ast: false, make: () => StreamLanguage.define(markdown) },
  { id: 'py', label: 'Python', ast: false, make: () => StreamLanguage.define(python) },
  { id: 'go', label: 'Go', ast: false, make: () => StreamLanguage.define(go) },
  { id: 'java', label: 'Java', ast: false, make: () => StreamLanguage.define(java) },
  { id: 'kt', label: 'Kotlin', ast: false, make: () => StreamLanguage.define(kotlin) },
  { id: 'c', label: 'C', ast: false, make: () => StreamLanguage.define(c) },
  { id: 'cpp', label: 'C++', ast: false, make: () => StreamLanguage.define(cpp) },
  { id: 'objc', label: 'Objective-C', ast: false, make: () => StreamLanguage.define(objectiveC) },
  { id: 'sh', label: 'Shell', ast: false, make: () => StreamLanguage.define(shell) },
  { id: 'yaml', label: 'YAML', ast: false, make: () => StreamLanguage.define(yaml) },
  { id: 'toml', label: 'TOML', ast: false, make: () => StreamLanguage.define(toml) },
  { id: 'sql', label: 'SQL', ast: false, make: () => StreamLanguage.define(standardSQL) },
  { id: 'xml', label: 'XML', ast: false, make: () => StreamLanguage.define(xml) },
  { id: 'html', label: 'HTML', ast: false, make: () => StreamLanguage.define(html) },
  { id: 'rb', label: 'Ruby', ast: false, make: () => StreamLanguage.define(ruby) },
  { id: 'swift', label: 'Swift', ast: false, make: () => StreamLanguage.define(swift) },
  { id: 'lua', label: 'Lua', ast: false, make: () => StreamLanguage.define(lua) },
  { id: 'diff', label: 'Diff', ast: false, make: () => StreamLanguage.define(diff) },
  { id: 'docker', label: 'Dockerfile', ast: false, make: () => StreamLanguage.define(dockerFile) },
  { id: 'plain', label: 'Plain Text', ast: false, make: () => [] },
]

export const LANG_BY_ID: Record<string, LangDef> = Object.fromEntries(LANGS.map((l) => [l.id, l]))

/** 语言的着色扩展；未知 id ⇒ 纯文本 */
export function langExtension(id: string): Extension {
  return LANG_BY_ID[id]?.make() ?? []
}

/** 显示名（未知 id 原样返回） */
export function langLabel(id: string): string {
  return LANG_BY_ID[id]?.label ?? (id || 'Plain Text')
}
