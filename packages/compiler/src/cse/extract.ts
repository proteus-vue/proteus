// packages/compiler/src/cse/extract.ts
// ★★★G-61 B1：**CSE · SFC 提取**（`<template>` 元素树 + `<style>` 样式表 + inline style → CSE 输入）
//
// 【为什么需要独立一层】CSE 内核（parse/match/cascade/compute）吃**纯结构**（CseNode + CSS 文本），
//   与 Vue SFC 解耦——便于：① 单测直接用合成树（快）② explain 从 SFC 一键取输入 ③ B3 切换时替换旧折叠通路。
//
// 【提取面（v1）】
//   · 元素节点：tag + **静态 class**（`class="a b"`）+ id + 元素兄弟序（结构伪类用）
//   · `:class` / `:style` **动态绑定**：v1 **不提取**（如实计数——动态形态需运行期，见 plan B2）
//   · `<style>`（含 `scoped` 的 `-data-v-*` 后缀由 parse 的 stripScopeSuffix 处理）
//   · **全局样式表**（调用方通过 `globalCss` 传入——与 SFC 内样式**同表**：SFC 先入表 ⇒ 同特异性 SFC 胜）
//   · inline `style="..."`：解析为长手（简写经 parse 的 expandShorthand——★与规则表同一条路，
//     保证 "inline 的 margin 与规则表的 margin-top 竞争" 走同一长手语义）
//
// 【诚实边界（v1）】组件标签（`<p-button>`）与其内部模板不展开（那是实例化期的事）；`v-for` 行
//   按模板序取**首个**（与旧通路同款静态近似，差异由 B2/运行期通道处理）；`v-if` 分支全保留。

import { parse as sfcParse } from '@vue/compiler-sfc'
import type { CseDeclaration, CseNode, CseStyleSheet } from './types'
import { parseStyleSheet } from './parse'
import { expandShorthandDecl } from './shorthand'

/** 提取结果 */
export interface CseExtractResult {
  /** 根节点（多根 ⇒ 取首根并把其余挂到它下面？不——**多根时返回数组**，见 roots） */
  roots: CseNode[]
  /** 样式表（SFC 内 + globalCss 合并；同一 order 序列） */
  sheet: CseStyleSheet
  /** inline style：节点 key → 长手声明 */
  inlineStyles: Record<string, Array<{ prop: string; value: string }>>
  /** 提取期的如实记录（动态 class/style 等） */
  notes: Array<{ kind: 'dynamic-class' | 'dynamic-style' | 'v-for' | 'slot' | 'component'; detail: string }>
}

export interface ExtractOptions {
  /** 全局样式表（追加在 SFC 内样式**之后**；同特异性 SFC 胜——与旧通路同序） */
  globalCss?: string
  /** 节点 key 前缀（多文件合并时防撞） */
  keyPrefix?: string
}

/** 简易 HTML 模板扫描（与 compiler-backend-rust 的 template.rs 同族思路；只取结构+class/id/style） */
interface RawEl {
  tag: string
  classes: string[]
  id?: string
  style?: string
  children: RawEl[]
}

/** 从 SFC 提取 `<template>` 内容（深度感知；无 template ⇒ 空串） */
function extractTemplate(source: string): string {
  const openRe = /<template(\s[^>]*)?>/g
  let m: RegExpExecArray | null
  while ((m = openRe.exec(source))) {
    const start = openRe.lastIndex
    // 深度匹配
    let depth = 1
    let i = start
    const tagRe = /<\/?template(\s[^>]*)?>/g
    tagRe.lastIndex = start
    let t: RegExpExecArray | null
    while ((t = tagRe.exec(source))) {
      if (t[0].startsWith('</')) depth--
      else depth++
      if (depth === 0) {
        void i
        return source.slice(start, t.index)
      }
      i = tagRe.lastIndex
    }
    break
  }
  return ''
}

/** 解析类属性（静态 class：`class="a b"`；`:class` 动态 ⇒ note） */
function parseClassAttr(attrs: string, notes: CseExtractResult['notes'], where: string): { classes: string[]; id?: string; style?: string } {
  const classes: string[] = []
  let id: string | undefined
  let style: string | undefined
  // 静态 class
  const cm = /\sclass\s*=\s*"([^"]*)"|\sclass\s*=\s*'([^']*)'/g
  let m: RegExpExecArray | null
  while ((m = cm.exec(attrs))) {
    for (const c of (m[1] ?? m[2] ?? '').split(/\s+/).filter(Boolean)) classes.push(c)
  }
  if (/[:@]class\s*=/.test(attrs)) notes.push({ kind: 'dynamic-class', detail: where })
  const im = /\sid\s*=\s*"([^"]*)"|\sid\s*=\s*'([^']*)'/.exec(attrs)
  if (im) id = im[1] ?? im[2]
  const sm = /\sstyle\s*=\s*"([^"]*)"|\sstyle\s*=\s*'([^']*)'/.exec(attrs)
  if (sm) style = sm[1] ?? sm[2]
  if (/[:@]style\s*=/.test(attrs)) notes.push({ kind: 'dynamic-style', detail: where })
  return { classes, id, style }
}

/** 模板文本 → 元素树（轻量扫描：标签/属性/嵌套；文本节点忽略（CSE 只算元素）） */
function scanElements(html: string, notes: CseExtractResult['notes']): RawEl[] {
  const roots: RawEl[] = []
  const stack: Array<{ el: RawEl; tag: string }> = []
  const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'image', 'source', 'track', 'wbr', 'area', 'base', 'col', 'embed', 'link', 'meta', 'param'])
  let i = 0
  const n = html.length
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt < 0) break
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt)
      i = end < 0 ? n : end + 3
      continue
    }
    const gt = html.indexOf('>', lt)
    if (gt < 0) break
    const raw = html.slice(lt + 1, gt)
    if (raw.startsWith('/')) {
      // 闭标签
      const tag = raw.slice(1).trim().toLowerCase()
      // 找到栈里最近的同名（容错）
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k]!.tag === tag) {
          stack.length = k
          break
        }
      }
      i = gt + 1
      continue
    }
    const selfClose = raw.endsWith('/')
    const body = selfClose ? raw.slice(0, -1) : raw
    const sp = body.search(/[\s/]/)
    const tag = (sp < 0 ? body : body.slice(0, sp)).trim().toLowerCase()
    const attrs = sp < 0 ? '' : body.slice(sp)
    if (!tag || tag.startsWith('!') || tag.startsWith('?')) {
      i = gt + 1
      continue
    }
    if (tag === 'template') {
      // <template v-if/#slot> 容器：透传子节点（CSE 的匹配是元素树——Vue 的 template 不是元素）
      i = gt + 1
      continue
    }
    if (/^v-for|[\s]v-for/.test(attrs)) notes.push({ kind: 'v-for', detail: `<${tag}>` })
    if (tag.includes('-') && !tag.startsWith('view') && !tag.startsWith('text')) notes.push({ kind: 'component', detail: `<${tag}>` })
    if (/[\s]slot([\s=]|$)/.test(attrs)) notes.push({ kind: 'slot', detail: `<${tag}>` })
    const { classes, id, style } = parseClassAttr(attrs, notes, `<${tag}>`)
    const el: RawEl = { tag, classes, children: [] }
    if (id !== undefined) el.id = id
    if (style !== undefined) el.style = style
    const parent = stack[stack.length - 1]?.el
    if (parent) parent.children.push(el)
    else roots.push(el)
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push({ el, tag })
    i = gt + 1
  }
  return roots
}

/** RawEl → CseNode（赋 key：`<prefix><DFS 序>`；兄弟序由 computeTree 重算，这里给初值） */
function toCseNode(raw: RawEl, path: string, keyPrefix: string, inline: CseExtractResult['inlineStyles']): CseNode {
  const key = `${keyPrefix}${path}`
  const node: CseNode = { key, tag: raw.tag, classes: raw.classes, index: 0, count: 1, children: [] }
  if (raw.id !== undefined) node.id = raw.id
  if (raw.style !== undefined) inline[key] = parseInlineStyleToLonghand(raw.style)
  node.children = raw.children.map((c, i) => toCseNode(c, `${path}.${i}`, keyPrefix, inline))
  return node
}

/** inline style 文本 → 长手声明（与规则表同一条长手展开通道） */
export function parseInlineStyleToLonghand(style: string): Array<{ prop: string; value: string }> {
  const out: Array<{ prop: string; value: string }> = []
  for (const part of style.split(';')) {
    const t = part.trim()
    if (!t) continue
    const i = t.indexOf(':')
    if (i <= 0) continue
    const prop = t.slice(0, i).trim().toLowerCase()
    const value = t.slice(i + 1).trim()
    if (!prop || !value) continue
    const expanded: CseDeclaration[] | null = expandShorthandDecl(prop, value, false)
    if (expanded) for (const d of expanded) out.push({ prop: d.prop, value: d.value })
    else out.push({ prop, value })
  }
  return out
}

/**
 * 从 SFC 源码提取 CSE 输入。
 * @example
 *   const { roots, sheet, inlineStyles } = extractFromSfc(source, { globalCss })
 *   const result = computeTree(roots, sheet, { inlineStyles, viewport })
 */
export function extractFromSfc(source: string, opts: ExtractOptions = {}): CseExtractResult {
  const { descriptor } = sfcParse(source, { filename: 'extract.vue' })
  const tpl = descriptor.template?.content ?? extractTemplate(source)
  const notes: CseExtractResult['notes'] = []
  const rawRoots = scanElements(tpl, notes)
  const inlineStyles: CseExtractResult['inlineStyles'] = {}
  const keyPrefix = opts.keyPrefix ?? ''
  const roots = rawRoots.map((r, i) => toCseNode(r, String(i), keyPrefix, inlineStyles))

  // 样式表：SFC `<style>` 块（逐块）+ globalCss 追加（同 order 序列递增）
  let sheet: CseStyleSheet = { rules: [], layerOrder: [], skipped: [] }
  let order = 0
  let sheetIdx = 0
  for (const blk of descriptor.styles ?? []) {
    if (!blk?.content) continue
    const one = parseStyleSheet(blk.content, { sheet: sheetIdx++, orderBase: order })
    order = one.nextOrder
    sheet = {
      rules: [...sheet.rules, ...one.rules],
      layerOrder: [...sheet.layerOrder, ...one.layerOrder.filter((l) => !sheet.layerOrder.includes(l))],
      skipped: [...sheet.skipped, ...one.skipped],
    }
  }
  if (opts.globalCss) {
    const one = parseStyleSheet(opts.globalCss, { sheet: sheetIdx++, orderBase: order })
    order = one.nextOrder
    sheet = {
      rules: [...sheet.rules, ...one.rules],
      layerOrder: [...sheet.layerOrder, ...one.layerOrder.filter((l) => !sheet.layerOrder.includes(l))],
      skipped: [...sheet.skipped, ...one.skipped],
    }
  }
  void order
  return { roots, sheet, inlineStyles, notes }
}
