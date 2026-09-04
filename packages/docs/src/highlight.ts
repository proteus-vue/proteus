// packages/docs/src/highlight.ts
// ★轻量代码高亮器（零依赖——docs 子集 tokenizer，接口兼容 shiki 替换位）
//   语言：js/ts/vue(拆块)/json/bash/css + plain；token：comment/string/keyword/number/tag/attr/fn
//   输出 HTML span（内容先转义——防注入）
//   ★#386：vue/html 补 attr token（标签内属性名）+ 闭合标签归 tag
//   ★#386c：① 函数名 fn token（word 非关键字且紧跟 "("——ref(/handleTap(/var(/log()；
//     ② vue SFC 拆块：<script> 体按 ts、<style> 体按 css（选择器 fn / 属性名 attr / 数字带单位）

const KEYWORDS_JS = new Set(
  ('const let var function return if else for while do class extends new await async type interface enum from import export of in typeof instanceof try catch finally throw switch case break continue default void null undefined true false this super static get set readonly public private protected implements declare namespace as satisfies delete yield').split(
    ' ',
  ),
)
const KEYWORDS_BASH = new Set('if then else elif fi for while do done echo cd npm npx node pnpm yarn export source sudo mkdir rm cp mv ls cat grep'.split(' '))
const KEYWORDS_CSS = new Set('important media supports keyframes import from to and not'.split(' '))

export type DocTokenType = 'comment' | 'string' | 'keyword' | 'number' | 'tag' | 'attr' | 'fn'

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

/** 逐字符扫描 tokenizer（注释/字符串优先，其次标签/属性/函数名/关键字/数字） */
function tokenize(code: string, lang: string): Token[] {
  const keywords = keywordsOf(lang)
  const tokens: Token[] = []
  let plain = ''
  let i = 0
  // ★#386 vue/html 标签态：<tag 之后、> 之前——词串全部视为属性名（attr）
  let inTag = false
  const isHtml = lang === 'vue' || lang === 'html'
  const isCss = lang === 'css'
  // ★#386c css 布尔态：{} 内属性名(attr)/选择器(fn)分流
  let inBrace = false

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

    // —— 标签开始（vue/html 的 <tag 与 </tag——闭合标签同色）——
    if (isHtml && code[i] === '<' && (isWord(code[i + 1] ?? '') || (code[i + 1] === '/' && isWord(code[i + 2] ?? '')))) {
      let j = i + 1
      if (code[j] === '/') j++
      while (j < code.length && /[\w-.]/.test(code[j])) j++
      flush()
      tokens.push({ cls: 'tag', text: code.slice(i, j) })
      inTag = true
      i = j
      continue
    }

    // —— 标签内的属性名（inTag：wx:if / bind:tap / @tap / :key / v-p-hover / class …）——
    if (isHtml && inTag && /[@\w.:$-]/.test(code[i])) {
      let j = i
      while (j < code.length && /[@\w.:$-]/.test(code[j])) j++
      flush()
      tokens.push({ cls: 'attr', text: code.slice(i, j) })
      i = j
      continue
    }

    // —— 标签结束符（> 归位 inTag；本身保持 plain）——
    if (isHtml && inTag && code[i] === '>') {
      inTag = false
      plain += '>'
      i++
      continue
    }

    // —— css 括号态 ——
    if (isCss && (code[i] === '{' || code[i] === '}')) {
      inBrace = code[i] === '{'
      plain += code[i]
      i++
      continue
    }

    // —— css 选择器（{} 外的 word / .word / #word → fn 蓝）——
    if (isCss && !inBrace && (isWord(code[i]) || ((code[i] === '.' || code[i] === '#') && isWord(code[i + 1] ?? '')))) {
      let j = i
      if (code[j] === '.' || code[j] === '#') j++
      while (j < code.length && /[\w-]/.test(code[j])) j++
      flush()
      tokens.push({ cls: 'fn', text: code.slice(i, j) })
      i = j
      continue
    }

    // —— css 属性名（{} 内 word(含 -) 紧跟 ":" → attr 橙）——
    if (isCss && inBrace && isWord(code[i])) {
      let j = i
      while (j < code.length && /[\w-]/.test(code[j])) j++
      let k = j
      while (k < code.length && code[k] === ' ') k++
      if (code[k] === ':') {
        flush()
        tokens.push({ cls: 'attr', text: code.slice(i, j) })
        i = j
        continue
      }
    }

    // —— 数字（css 下连同单位 px/%/rem 一体）——
    if (/[0-9]/.test(code[i]) && !isWord(code[i - 1] ?? '')) {
      let j = i
      while (j < code.length && (isCss ? /[\w.%]/ : /[0-9._]/).test(code[j])) j++
      flush()
      tokens.push({ cls: 'number', text: code.slice(i, j) })
      i = j
      continue
    }

    // —— 关键字 / 函数名 / 成员属性（★#386c：非关键字 word 紧跟 "(" → fn 蓝；
    //    ★#386d："." 后的成员属性 word → attr 橙——count.value / console.log 的属性语义，且 obj.class 不再误紫）——
    if (isWord(code[i])) {
      let j = i
      while (j < code.length && /[\w$]/.test(code[j])) j++
      const word = code.slice(i, j)
      const isMember = i > 0 && code[i - 1] === '.' && (lang === 'js' || lang === 'ts' || lang === 'vue')
      const canFn = lang === 'js' || lang === 'ts' || lang === 'vue' || isCss
      let k = j
      while (k < code.length && code[k] === ' ') k++
      if (canFn && (!keywords.has(word) || isMember) && code[k] === '(') {
        flush()
        tokens.push({ cls: 'fn', text: word })
        i = j
        continue
      }
      if (isMember) {
        flush()
        tokens.push({ cls: 'attr', text: word })
        i = j
        continue
      }
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

/** token 列表 → HTML（转义出口唯一） */
function renderTokens(tokens: Token[]): string {
  return tokens.map((t) => (t.cls ? span(t.cls, t.text) : escapeHtml(t.text))).join('')
}

/** ★#386c vue SFC 拆块：<script> 体按 ts、<style> 体按 css，其余按 vue 原规则（子段直接 tokenize——不递归） */
const SFC_BLOCK_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/g
function highlightVueSfc(code: string): string {
  let out = ''
  let last = 0
  for (const m of code.matchAll(SFC_BLOCK_RE)) {
    const idx = m.index
    if (idx > last) out += renderTokens(tokenize(code.slice(last, idx), 'vue'))
    const block = m[0]
    const openEnd = block.indexOf('>')
    const closeStart = block.lastIndexOf('</')
    out += renderTokens(tokenize(block.slice(0, openEnd + 1), 'vue'))
    out += renderTokens(tokenize(block.slice(openEnd + 1, closeStart), m[1] === 'style' ? 'css' : 'ts'))
    out += renderTokens(tokenize(block.slice(closeStart), 'vue'))
    last = idx + block.length
  }
  if (last < code.length) out += renderTokens(tokenize(code.slice(last), 'vue'))
  return out
}

/** ★轻量高亮：code → HTML（span.docs-tok-*，内容已转义；未知语言纯转义） */
export function highlight(code: string, lang: string): string {
  if (lang !== 'js' && lang !== 'ts' && lang !== 'vue' && lang !== 'json' && lang !== 'bash' && lang !== 'sh' && lang !== 'shell' && lang !== 'css' && lang !== 'html') {
    return escapeHtml(code)
  }
  if (lang === 'vue') return highlightVueSfc(code)
  return renderTokens(tokenize(code, lang))
}
