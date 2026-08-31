// packages/test-core/src/snapshot/wxml.ts
// ★test-framework B2：WXML 结构解析 + 规范化（02-snapshot-compile.md §快照对象 .wxml）
// 目的：快照断言从「字符串全等」升级为「结构等值」——属性序 / 空白不敏感，diff 定位到路径
// 纯 TS 零依赖（手写轻量 tokenizer，wxml 为自定义标签集，@vue/compiler-dom 的 HTML 语义不适用）
export interface WxmlAttr {
  name: string
  value: string
}

export type WxmlNode = WxmlElement | WxmlText | WxmlComment

export interface WxmlElement {
  type: 'element'
  tag: string
  attrs: WxmlAttr[]
  children: WxmlNode[]
}

export interface WxmlText {
  type: 'text'
  value: string
}

export interface WxmlComment {
  type: 'comment'
  value: string
}

/** 结构差异（diffWxml 返回首个分歧点，path 为节点路径如 children[2]/attrs.class） */
export interface WxmlDiff {
  path: string
  actual: unknown
  expected: unknown
}

/** 标签结束位置：跳过引号包裹的属性值（`{{a > 1}}` 中 > 不终止标签） */
function findTagEnd(src: string, start: number): number {
  let quote: string | null = null
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i]
    if (quote !== null) {
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === '>') return i
  }
  return src.length - 1
}

/** 解析标签体 `<...>` 内部：tag 名 + 属性表（支持带引号 / 无引号值 / 布尔属性） */
function parseTagContent(content: string): [string, WxmlAttr[]] {
  const trimmed = content.trim()
  const m = trimmed.match(/^[^\s/]+/)
  const tag = m ? m[0] : ''
  const rest = trimmed.slice(tag.length)
  const attrs: WxmlAttr[] = []
  let i = 0
  while (i < rest.length) {
    while (i < rest.length && /\s/.test(rest[i] as string)) i++
    if (i >= rest.length) break
    let name = ''
    while (i < rest.length && !/[\s=]/.test(rest[i] as string)) {
      name += rest[i]
      i++
    }
    while (i < rest.length && /\s/.test(rest[i] as string)) i++
    if (rest[i] === '=') {
      i++
      while (i < rest.length && /\s/.test(rest[i] as string)) i++
      const q = rest[i]
      if (q === '"' || q === "'") {
        const end = rest.indexOf(q as string, i + 1)
        const value = end === -1 ? rest.slice(i + 1) : rest.slice(i + 1, end)
        attrs.push({ name, value })
        i = end === -1 ? rest.length : end + 1
      } else {
        let value = ''
        while (i < rest.length && !/\s/.test(rest[i] as string)) {
          value += rest[i]
          i++
        }
        attrs.push({ name, value })
      }
    } else {
      attrs.push({ name, value: '' })
    }
  }
  return [tag, attrs]
}

/** 解析 WXML 为节点树（#root 是虚拟容器，返回其 children） */
export function parseWxml(src: string): WxmlNode[] {
  const root: WxmlElement = { type: 'element', tag: '#root', attrs: [], children: [] }
  const stack: WxmlElement[] = [root]
  const pushText = (text: string): void => {
    if (!text) return
    stack[stack.length - 1].children.push({ type: 'text', value: text })
  }
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt === -1) {
      pushText(src.slice(i))
      break
    }
    if (lt > i) pushText(src.slice(i, lt))
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4)
      const value = end === -1 ? src.slice(lt + 4) : src.slice(lt + 4, end)
      stack[stack.length - 1].children.push({ type: 'comment', value })
      i = end === -1 ? src.length : end + 3
      continue
    }
    if (src.startsWith('</', lt)) {
      const gt = src.indexOf('>', lt)
      const tag = src.slice(lt + 2, gt === -1 ? src.length : gt).trim()
      // 弹出到最近的同名标签（容忍不匹配闭合——wxml 由编译器产出，理论闭合配对）
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tag === tag) {
          stack.length = s
          break
        }
      }
      i = gt === -1 ? src.length : gt + 1
      continue
    }
    const gt = findTagEnd(src, lt)
    const inner = src.slice(lt + 1, gt)
    const selfClosing = inner.trimEnd().endsWith('/')
    const content = selfClosing ? inner.trimEnd().slice(0, -1) : inner
    const [tag, attrs] = parseTagContent(content)
    const el: WxmlElement = { type: 'element', tag, attrs, children: [] }
    stack[stack.length - 1].children.push(el)
    if (!selfClosing) stack.push(el)
    i = gt + 1
  }
  return root.children
}

function normalizeNodes(nodes: WxmlNode[]): WxmlNode[] {
  const out: WxmlNode[] = []
  for (const n of nodes) {
    if (n.type === 'comment') continue
    if (n.type === 'text') {
      const value = n.value.replace(/\s+/g, ' ').trim()
      if (value) out.push({ type: 'text', value })
      continue
    }
    const attrs = [...n.attrs].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    out.push({ type: 'element', tag: n.tag, attrs, children: normalizeNodes(n.children) })
  }
  return out
}

/** 规范化树：丢弃注释 + 文本空白折叠 + 属性按键排序（快照等值的基准形态） */
export function normalizeWxml(src: string): WxmlNode[] {
  return normalizeNodes(parseWxml(src))
}

function serialize(nodes: WxmlNode[], depth: number): string {
  const pad = '  '.repeat(depth)
  const lines: string[] = []
  for (const n of nodes) {
    if (n.type === 'text') {
      lines.push(pad + n.value)
      continue
    }
    if (n.type === 'comment') continue // 注释在 normalize 阶段已丢弃，防御性跳过（收窄）
    const attrStr = n.attrs.map((a) => (a.value === '' ? a.name : `${a.name}="${a.value}"`)).join(' ')
    const open = `${pad}<${n.tag}${attrStr ? ' ' + attrStr : ''}`
    if (n.children.length === 0) {
      lines.push(`${open} />`)
    } else {
      lines.push(`${open}>`)
      lines.push(serialize(n.children, depth + 1))
      lines.push(`${pad}</${n.tag}>`)
    }
  }
  return lines.join('\n')
}

/** 规范化后的稳定字符串形态（进 vitest 快照：属性序 / 空白 / 注释不敏感） */
export function canonicalizeWxml(src: string): string {
  return serialize(normalizeWxml(src), 0)
}

function diffNodes(a: WxmlNode[], b: WxmlNode[], path: string[]): WxmlDiff | null {
  if (a.length !== b.length) {
    return { path: path.concat(['<length>']).join(''), actual: a.length, expected: b.length }
  }
  for (let i = 0; i < a.length; i++) {
    const d = diffNode(a[i], b[i], path.concat([`[${i}]`]))
    if (d) return d
  }
  return null
}

function diffNode(a: WxmlNode, b: WxmlNode, path: string[]): WxmlDiff | null {
  if (a.type !== b.type) return { path: path.join(''), actual: a.type, expected: b.type }
  if (a.type === 'comment') return null // 规范化后已丢弃，防御性相等
  if (a.type === 'text') {
    const ta = a as WxmlText
    const tb = b as WxmlText
    return ta.value === tb.value ? null : { path: path.join(''), actual: ta.value, expected: tb.value }
  }
  const ea = a as WxmlElement
  const eb = b as WxmlElement
  if (ea.tag !== eb.tag) return { path: path.concat(['<tag>']).join(''), actual: ea.tag, expected: eb.tag }
  const ae = Object.fromEntries(ea.attrs.map((x) => [x.name, x.value]))
  const be = Object.fromEntries(eb.attrs.map((x) => [x.name, x.value]))
  for (const k of new Set([...Object.keys(ae), ...Object.keys(be)])) {
    if (ae[k] !== be[k]) {
      return { path: path.concat(['<attrs>', k]).join(''), actual: ae[k] ?? undefined, expected: be[k] ?? undefined }
    }
  }
  return diffNodes(ea.children, eb.children, path.concat(['<children>']))
}

/** 结构 diff：规范化后比较，返回首个分歧点（无差异 → null） */
export function diffWxml(actual: string, expected: string): WxmlDiff | null {
  return diffNodes(normalizeWxml(actual), normalizeWxml(expected), [])
}

/** 结构断言：不一致抛错并带路径定位（测试夹具用；快照用 canonicalizeWxml 走 vitest） */
export function assertWxmlEqual(actual: string, expected: string, label = 'wxml'): void {
  const d = diffWxml(actual, expected)
  if (d) {
    throw new Error(
      `[snapshot] ${label} 结构不一致 @ ${d.path}：实际 ${JSON.stringify(d.actual)} ≠ 期望 ${JSON.stringify(d.expected)}`,
    )
  }
}
