// src/compiler/template.ts
// 4-1-a Template → WXML
// 标准 HTML 标签 / Vue 指令 → 小程序标签 / 指令（映射表见 LLM_IMPLEMENTATION_GUIDE §P4-1-a）
import { parse as domParse, NodeTypes } from '@vue/compiler-dom'
import type {
  AttributeNode,
  DirectiveNode,
  ElementNode,
  TemplateChildNode,
} from '@vue/compiler-dom'
import { TAG_MAP, EVENT_MAP, SEMANTIC_CLASS } from './tags'
import type { StyleTransformOptions, TemplateTransformOptions, TemplateTransformResult } from './types'
import type { TransformTrace } from './trace'
import { TAG_RULE_BY_TAG } from './transforms/template'

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function kebabCase(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function camelToKebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/** 提取表达式节点的文本（兼容 Simple/Compound/Interpolation/Text/字符串） */
function exprContent(exp: unknown): string {
  if (exp == null) return ''
  if (typeof exp === 'string') return exp
  const node = exp as { type?: number; content?: unknown; children?: unknown[] }
  if (node.type === NodeTypes.SIMPLE_EXPRESSION) {
    return typeof node.content === 'string' ? node.content : ''
  }
  if (node.type === NodeTypes.INTERPOLATION) {
    return exprContent(node.content)
  }
  if (node.type === NodeTypes.COMPOUND_EXPRESSION || Array.isArray(node.children)) {
    return (node.children as unknown[]).map((c) => exprContent(c)).join('')
  }
  if (node.type === NodeTypes.TEXT) {
    return typeof node.content === 'string' ? node.content : ''
  }
  return ''
}

/** 解析 v-for 表达式：(item, idx) in list / item of items */
function parseForExpr(exp: string): { list: string; item?: string; index?: string } {
  const m = exp.trim().match(/^\(?\s*([\w$]+)\s*(?:,\s*([\w$]+))?\s*\)?\s+(?:in|of)\s+(.+)$/)
  if (!m) return { list: exp }
  return { list: m[3].trim(), item: m[1], index: m[2] }
}

/** 事件处理器：仅支持简单方法引用（方法名 / 方法名($event)） */
function cleanHandler(exp: string, warnings: string[]): string {
  const t = exp.trim()
  if (/^[\w$]+$/.test(t)) return t
  const m = t.match(/^([\w$]+)\(\$event\)$/)
  if (m) return m[1]
  warnings.push(`事件处理器 "${t}" 不是简单方法引用（MVP 仅支持方法名），已原样输出`)
  return t
}

/** :class 绑定：对象语法 → 三元拼接，其余 → {{expr}} */
function formatClassBinding(exp: string, warnings: string[]): string {
  const t = exp.trim()
  if (t.startsWith('{')) {
    const parts: string[] = []
    const re = /(['"]?)([\w-]+)\1\s*:\s*([^,}]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(t))) parts.push(`(${m[3].trim()}?'${m[2]} ':'')`)
    if (parts.length) return `{{${parts.join('+')}}}`
  }
  if (t.startsWith('[')) warnings.push(`:class 数组语法暂不支持（MVP），已按表达式输出`)
  return `{{${t}}}`
}

/** :style 绑定：对象语法 → prop:{{expr}} 拼接，其余 → {{expr}} */
function formatStyleBinding(exp: string): string {
  const t = exp.trim()
  if (t.startsWith('{')) {
    const parts: string[] = []
    const re = /(['"]?)([\w-]+)\1\s*:\s*([^,}]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(t))) parts.push(`${camelToKebab(m[2])}:{{${m[3].trim()}}}`)
    if (parts.length) return parts.join(';')
  }
  return `{{${t}}}`
}

/** 序列化上下文（跨递归传递的编译期状态） */
interface SerializeContext {
  vModelBindings: string[]
  warnings: string[]
  /** 是否注入源码行号注释（反黑盒） */
  annotateLines: boolean
  /** 源文件名（行号注释用） */
  filename?: string
  /** 模板中是否出现导航链接（<a href> / <router-link>，触发 __navigateTo handler 注入） */
  usesNavigate: boolean
  /** 决策 trace 收集器（阶段二，可空） */
  trace?: TransformTrace
  /** 行号注释 trace 已记录标记（避免每个元素都记一条） */
  lineNoteTraced?: boolean
}

function serializeElement(node: ElementNode, ctx: SerializeContext): string {
  const hasVHtml = node.props.some((p) => p.type === NodeTypes.DIRECTIVE && p.name === 'html')
  const hasClick = node.props.some((p) => p.type === NodeTypes.DIRECTIVE && p.name === 'on')
  // 导航链接：<a href> / <router-link to>（元素上有 @click 时不作为导航链接，交给事件映射）
  const isNavLink = (node.tag === 'a' || node.tag === 'router-link') && !hasClick
  let tag = hasVHtml ? 'rich-text' : (TAG_MAP[node.tag] ?? kebabCase(node.tag))
  if (node.tag === 'router-link') tag = 'view'
  // 决策 trace：标签映射
  ctx.trace?.add(
    hasVHtml ? 'tag/rich-text' : node.tag === 'router-link' ? 'tag/router-link' : (TAG_RULE_BY_TAG[node.tag] ?? 'tag/unknown-kebab'),
    { line: node.loc.start.line, before: `<${node.tag}>`, after: `<${tag}>` },
  )
  // 语义标签基础类（h1-h6/p/a → proteus-*，样式侧注入 Web UA 等价默认样式；rich-text 不附加）
  const baseClass = hasVHtml ? '' : (SEMANTIC_CLASS[node.tag] ?? '')
  if (baseClass) {
    ctx.trace?.add('semantic/base-class', { line: node.loc.start.line, before: node.tag, after: baseClass })
  }
  const isInputLike = tag === 'input' || tag === 'textarea'
  const attrs: string[] = []
  let hasNavTarget = false

  for (const prop of node.props) {
    if (prop.type === NodeTypes.ATTRIBUTE) {
      const attr = prop as AttributeNode
      if (isNavLink && (attr.name === 'href' || attr.name === 'to' || attr.name === 'route-type')) {
        if (attr.name === 'route-type' && attr.value) {
          attrs.push(`data-route-type="${escapeXml(attr.value.content)}"`)
          ctx.trace?.add('nav/route-type', { line: node.loc.start.line, before: `route-type="${attr.value.content}"`, after: `data-route-type="${attr.value.content}"` })
        } else if (attr.value) {
          attrs.push(`data-url="${escapeXml(attr.value.content)}"`)
          hasNavTarget = true
        }
        continue
      }
      if (attr.name === 'class' && baseClass) {
        attrs.push(`class="${baseClass}${attr.value ? ' ' + escapeXml(attr.value.content) : ''}"`)
        continue
      }
      attrs.push(attr.value ? `${attr.name}="${escapeXml(attr.value.content)}"` : attr.name)
      continue
    }
    const dir = prop as DirectiveNode
    if (isNavLink && dir.name === 'bind' && (exprContent(dir.arg) === 'href' || exprContent(dir.arg) === 'to')) {
      const exp = exprContent(dir.exp)
      if (exp.trim().startsWith('{')) {
        ctx.warnings.push('路由链接 :to/:href 对象形式暂不支持（MVP），请改用字符串路径')
      } else {
        attrs.push(`data-url="{{${exp}}}"`)
        hasNavTarget = true
      }
      continue
    }
    switch (dir.name) {
      case 'if':
        attrs.push(`wx:if="{{${exprContent(dir.exp)}}}"`)
        ctx.trace?.add('directive/v-if', { line: node.loc.start.line, before: `v-if="${exprContent(dir.exp)}"`, after: `wx:if="{{${exprContent(dir.exp)}}}"` })
        break
      case 'else-if':
        attrs.push(`wx:elif="{{${exprContent(dir.exp)}}}"`)
        ctx.trace?.add('directive/v-else-if', { line: node.loc.start.line, before: 'v-else-if', after: 'wx:elif' })
        break
      case 'else':
        attrs.push('wx:else')
        ctx.trace?.add('directive/v-else', { line: node.loc.start.line, before: 'v-else', after: 'wx:else' })
        break
      case 'for': {
        const f = parseForExpr(exprContent(dir.exp))
        attrs.push(`wx:for="{{${f.list}}}"`)
        if (f.item) attrs.push(`wx:for-item="${f.item}"`)
        if (f.index) attrs.push(`wx:for-index="${f.index}"`)
        ctx.trace?.add('directive/v-for', { line: node.loc.start.line, before: exprContent(dir.exp), after: `wx:for="{{${f.list}}}"` })
        break
      }
      case 'on': {
        const raw = exprContent(dir.arg)
        const mapped = EVENT_MAP[raw] ?? raw
        // 修饰符：运行时 modifiers 是 { content }[]（与声明类型 string[] 不一致，做兼容）
        const mods = (dir.modifiers as unknown as Array<{ content?: string } | string>).map((m) =>
          typeof m === 'string' ? m : (m?.content ?? ''),
        )
        const isCatch = mods.includes('stop') || mods.includes('prevent')
        const handler = cleanHandler(exprContent(dir.exp), ctx.warnings)
        attrs.push(`${isCatch ? 'catch' : 'bind'}${mapped}="${handler}"`)
        ctx.trace?.add(
          isCatch ? 'event/modifier-catch' : 'event/click-to-tap',
          { line: node.loc.start.line, before: `@${raw}`, after: `${isCatch ? 'catch' : 'bind'}${mapped}` },
        )
        break
      }
      case 'bind': {
        const arg = exprContent(dir.arg)
        const exp = exprContent(dir.exp)
        if (arg === 'class') {
          const cls = formatClassBinding(exp, ctx.warnings)
          attrs.push(`class="${baseClass ? `${baseClass} ` : ''}${cls}"`)
          ctx.trace?.add('directive/v-bind-class', { line: node.loc.start.line, before: `:class="${exp}"`, after: cls })
        } else if (arg === 'style') {
          attrs.push(`style="${formatStyleBinding(exp)}"`)
          ctx.trace?.add('directive/v-bind-style', { line: node.loc.start.line, before: `:style="${exp}"`, after: formatStyleBinding(exp) })
        } else if (arg === 'key') {
          if (/^[\w$]+$/.test(exp)) attrs.push(`wx:key="${exp}"`)
          else ctx.warnings.push(`:key="${exp}" 不是简单标识符（MVP），wx:key 已忽略`)
          ctx.trace?.add('directive/v-bind-key', { line: node.loc.start.line, before: `:key="${exp}"`, after: `wx:key="${exp}"` })
        } else {
          attrs.push(`${arg}="{{${exp}}}"`)
          ctx.trace?.add('directive/v-bind', { line: node.loc.start.line, before: `:${arg}`, after: `${arg}="{{${exp}}}"` })
        }
        break
      }
      case 'model': {
        const model = exprContent(dir.exp)
        if (model && !ctx.vModelBindings.includes(model)) ctx.vModelBindings.push(model)
        if (isInputLike) attrs.push(`value="{{${model}}}"`)
        // 方法名不用 __ 前缀（微信保留前缀，真机绑定可能失效）
        attrs.push(`bindinput="proteusOn${capitalize(model)}Input"`)
        ctx.trace?.add('directive/v-model', { line: node.loc.start.line, before: `v-model="${model}"`, after: `bindinput="proteusOn${capitalize(model)}Input"` })
        break
      }
      case 'html':
        attrs.push(`nodes="{{${exprContent(dir.exp)}}}"`)
        ctx.trace?.add('directive/v-html', { line: node.loc.start.line, before: 'v-html', after: 'rich-text nodes' })
        break
      case 'show':
        ctx.warnings.push('v-show 暂不支持（MVP），已忽略，请改用 v-if')
        ctx.trace?.add('directive/v-show-limit', { line: node.loc.start.line, before: 'v-show', after: '（忽略 + 编译期警告）' })
        break
      default:
        break // v-slot / v-pre 等：MVP 忽略
    }
  }

  if (hasNavTarget) {
    // 导航链接：绑定点击跳转（handler 由 script 转换自动注入；方法名避免 __ 前缀）
    attrs.push('bindtap="proteusNavigateTo"')
    ctx.usesNavigate = true
    ctx.trace?.add('nav/navigate-link', { line: node.loc.start.line, before: `<${node.tag}>` + (node.tag === 'a' ? ' href/to' : ' to'), after: 'data-url + bindtap="proteusNavigateTo"' })
  }
  if (baseClass && !attrs.some((a) => a.startsWith('class='))) {
    attrs.push(`class="${baseClass}"`)
  }
  const attrStr = attrs.length ? ` ${attrs.join(' ')}` : ''
  // 反黑盒：注入源码行号注释（默认关闭，dev 调试开启）
  const lineNote = ctx.annotateLines ? `<!-- @${node.loc.start.line} ${node.tag} -->\n` : ''
  if (lineNote && !ctx.lineNoteTraced) {
    ctx.lineNoteTraced = true
    ctx.trace?.add('annotation/line-note', { line: node.loc.start.line, before: `<${node.tag}>`, after: `<!-- @${node.loc.start.line} ${node.tag} -->` })
  }
  if (!node.children.length) return `${lineNote}<${tag}${attrStr} />`
  const hasElementChild = node.children.some((c) => c.type === NodeTypes.ELEMENT)
  if (hasElementChild) {
    const inner = node.children.map((c) => serializeNode(c, ctx)).join('\n')
    return `${lineNote}<${tag}${attrStr}>\n${inner}\n</${tag}>`
  }
  // 纯文本/插值子节点：紧凑单行（产物可读性）
  const inline = node.children.map((c) => serializeNode(c, ctx)).join('')
  return `${lineNote}<${tag}${attrStr}>${inline}</${tag}>`
}

function serializeNode(node: TemplateChildNode, ctx: SerializeContext): string {
  switch (node.type) {
    case NodeTypes.ELEMENT:
      return serializeElement(node as ElementNode, ctx)
    case NodeTypes.TEXT:
      return escapeXml((node as unknown as { content: string }).content)
    case NodeTypes.INTERPOLATION:
      ctx.trace?.add('node/interpolation', { line: (node as unknown as { loc: { start: { line: number } } }).loc.start.line, before: '{{ expr }}', after: '{{ expr }}（原样保留）' })
      return `{{ ${(node as unknown as { content: { content: string } }).content.content} }}`
    case NodeTypes.COMMENT:
      return `<!-- ${(node as unknown as { content: string }).content} -->`
    default:
      return ''
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** template 源码 → WXML（纯函数，独立可测） */
export function transformTemplateToWxml(
  source: string,
  opts: TemplateTransformOptions = { px2rpx: true, rpxRatio: 2, annotateLines: false },
): TemplateTransformResult {
  const ctx: SerializeContext = {
    vModelBindings: [],
    warnings: [],
    annotateLines: opts.annotateLines ?? false,
    filename: opts.filename,
    usesNavigate: false,
    trace: opts.trace,
  }
  const root = domParse(source, { onError: () => undefined })
  const wxml = root.children.map((c) => serializeNode(c, ctx)).join('\n')
  for (const w of ctx.warnings) console.warn(`[mp-transform] ${w}`)
  return { wxml, vModelBindings: ctx.vModelBindings, usesNavigate: ctx.usesNavigate, warnings: ctx.warnings }
}
