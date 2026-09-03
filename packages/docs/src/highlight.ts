// packages/docs/src/highlight.ts
// ★轻量代码高亮器（零依赖——docs 子集 tokenizer，接口兼容 shiki 替换位）
//   语言：js/ts/vue(拆块)/json/bash/css + plain；token：comment/string/keyword/number/tag
//   输出 HTML span（内容先转义——防注入）

const KEYWORDS_JS = new Set(
  ('const let var function return if else for while do class extends new await async type interface enum from import export of in typeof instanceof try catch finally throw switch case break continue default void null undefined true false this super static get set readonly public private protected implements declare namespace as satisfies delete yield').split(
    ' ',
  ),
)
const KEYWORDS_BASH = new Set('if then else elif fi for while do done echo cd npm npx node pnpm yarn export source sudo mkdir rm cp mv ls cat grep'.split(' '))
const KEYWORDS_CSS = new Set('important media supports keyframes import from to and not'.split(' '))

export type DocTokenType = 'comment' | 'string' | 'keyword' | 'number' | 'tag' | 'attr'

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function span(cls: string, content: string): string {
  return `<span class="docs-tok-${cls}">${escapeHtml(content)}</span>`
}

/** 关键字集合（按语言） */
function keywordsOf(lang: string): Set<string> {
  if (lang === 'bash' || lang === 'sh' || lang === 'shell') return KEYWORDS_BASH
  if (lang === 'css') return KEYWORDS_CSS
  return KEYWORDS_JS // js/ts/json/vue 共用（json 仅 true/false/null 命中）
}

interface Token {
  cls: string | null
  text: string
}

/** 逐字符扫描 tokenizer（注释/字符串优先，其次关键字/数字） */
function tokenize(code: string, lang: string): Token[] {
  const keywords = keywordsOf(lang)
  const tokens: Token[] = []
  let plain = ''
  let i = 0

  const flush = (): void => {
    if (plain !== '') {
      tokens.push({ cls: null, text: plain })
      plain = ''
    }
  }

  const isWord = (c: string): boolean => /[A-Za-z_$]/.test(c)

  while (i < code.length) {
    const rest = code.slice(i)
    const two = code.slice(i, i + 2)

    // —— 注释 ——
    if (two === '//' && (lang === 'js' || lang === 'ts' || lang === 'vue')) {
      const end = code.indexOf('\n', i)
      const stop = end < 0 ? code.length : end
      flush()
      tokens.push({ cls: 'comment', text: code.slice(i, stop) })
      i = stop
      continue
    }
    if (two === '/*' && (lang === 'js' || lang === 'ts' || lang === 'css' || lang === 'vue')) {
      const end = code.indexOf('*/', i + 2)
      const stop = end < 0 ? code.length : end + 2
      flush()
      tokens.push({ cls: 'comment', text: code.slice(i, stop) })
      i = stop
      continue
    }
    if (lang === 'bash' && code[i] === '#') {
      const end = code.indexOf('\n', i)
      const stop = end < 0 ? code.length : end
      flush()
      tokens.push({ cls: 'comment', text: code.slice(i, stop) })
      i = stop
      continue
    }
    if (lang === 'vue' && rest.startsWith('<!--')) {
      const end = code.indexOf('-->', i + 4)
      const stop = end < 0 ? code.length : end + 3
      flush()
      tokens.push({ cls: 'comment', text: code.slice(i, stop) })
      i = stop
      continue
    }

    // —— 字符串（单/双/反引号，\ 转义） ——
    if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const quote = code[i]
      let j = i + 1
      while (j < code.length) {
        if (code[j] === '\\') {
          j += 2
          continue
        }
        if (code[j] === quote) {
          j++
          break
        }
        j++
      }
      flush()
      tokens.push({ cls: 'string', text: code.slice(i, j) })
      i = j
      continue
    }

    // —— 标签（vue/html 的 <tag）——
    if ((lang === 'vue' || lang === 'html') && code[i] === '<' && isWord(code[i + 1] ?? '')) {
      let j = i + 1
      while (j < code.length && /[\w-.]/.test(code[j])) j++
      flush()
      tokens.push({ cls: 'tag', text: code.slice(i, j) })
      i = j
      continue
    }

    // —— 数字 ——
    if (/[0-9]/.test(code[i]) && !isWord(code[i - 1] ?? '')) {
      let j = i
      while (j < code.length && /[0-9._]/.test(code[j])) j++
      flush()
      tokens.push({ cls: 'number', text: code.slice(i, j) })
      i = j
      continue
    }

    // —— 关键字 ——
    if (isWord(code[i])) {
      let j = i
      while (j < code.length && /[\w$]/.test(code[j])) j++
      const word = code.slice(i, j)
      flush()
      tokens.push({ cls: keywords.has(word) ? 'keyword' : null, text: word })
      i = j
      continue
    }

    plain += code[i]
    i++
  }
  flush()
  return tokens
}

/** ★轻量高亮：code → HTML（span.docs-tok-*，内容已转义；未知语言纯转义） */
export function highlight(code: string, lang: string): string {
  if (lang !== 'js' && lang !== 'ts' && lang !== 'vue' && lang !== 'json' && lang !== 'bash' && lang !== 'sh' && lang !== 'shell' && lang !== 'css' && lang !== 'html') {
    return escapeHtml(code)
  }
  const tokens = tokenize(code, lang)
  return tokens
    .map((t) => (t.cls ? span(t.cls, t.text) : escapeHtml(t.text)))
    .join('')
}
