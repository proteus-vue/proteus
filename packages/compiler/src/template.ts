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
import type { StyleTransformOptions, TemplateTransformOptions, TemplateTransformResult } from './types'
import type { TransformTrace } from './trace'
import { TAG_RULE_BY_TAG } from './transforms/template'
import { executeRule } from './transforms/registry'
import type { RuleContext } from './transforms/types'
import { resolveOverrides } from './overrides'

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
    // 对象语法 → 三元拼接
    const parts: string[] = []
    const re = /(['"]?)([\w-]+)\1\s*:\s*([^,}]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(t))) parts.push(`(${m[3].trim()}?'${m[2]} ':'')`)
    if (parts.length) return `{{${parts.join('+')}}}`
  }
  if (t.startsWith('[')) {
    // 数组语法（v0.3）：按顶层逗号分割，逐项转换——字符串字面量直接拼、对象项转三元、
    // 变量/三元项 → (expr?expr+' ':'')；其余形式编译期警告
    const items = splitTopLevel(t.slice(1, -1))
    const parts: string[] = []
    for (const item of items) {
      const i = item.trim()
      if (!i) continue
      const str = i.match(/^(['"])([^'"]*)\1$/)
      if (str) {
        parts.push(`'${str[2]} '`)
        continue
      }
      if (i.startsWith('{')) {
        const inner = i.slice(1, -1)
        const re = /(['"]?)([\w-]+)\1\s*:\s*([^,}]+)/g
        let m: RegExpExecArray | null
        let ok = false
        while ((m = re.exec(inner))) {
          parts.push(`(${m[3].trim()}?'${m[2]} ':'')`)
          ok = true
        }
        if (ok) continue
      }
      if (/^[\w$.]+(?:\s*\?\s*[^:]+:.+)?$/.test(i)) {
        // 简单变量 / 三元：值即类名（括号包裹避免三元嵌套优先级歧义）
        parts.push(`((${i})?(${i})+' ':'')`)
        continue
      }
      warnings.push(`:class 数组项 "${i}" 暂不支持（MVP：仅字符串/对象/简单变量/三元），已跳过`)
    }
    if (parts.length) return `{{${parts.join('+')}}}`
  }
  return `{{${t}}}`
}

/** 按顶层逗号分割（跳过字符串 / 括号内逗号） */
function splitTopLevel(expr: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (quote) {
      cur += ch
      if (ch === quote && expr[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; cur += ch; continue }
    if (ch === '(' || ch === '{' || ch === '[') { depth++; cur += ch; continue }
    if (ch === ')' || ch === '}' || ch === ']') { depth--; cur += ch; continue }
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts
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
  /** 生效的标签映射（tags.ts 常量 + config 覆盖，★底线循环 ①③） */
  tagMap: Record<string, string>
  /** 生效的事件映射 */
  eventMap: Record<string, string>
  /** 生效的语义基础类 */
  semanticClass: Record<string, string>
  /** 被禁用的规则 ID 集合 */
  disabled: Set<string>
  /** scoped CSS 作用域属性（v0.3：元素附加 data-v-xxx，样式侧选择器属性匹配） */
  scopeId?: string
  /** .self 修饰符 handler 名集合（script 生成 proteusSelfXxx 包装） */
  selfHandlers: Set<string>
  /** .once 修饰符 handler 名集合（script 生成 proteusOnceXxx 包装） */
  onceHandlers: Set<string>
}

function serializeElement(node: ElementNode, ctx: SerializeContext): string {
  const hasVHtml = node.props.some((p) => p.type === NodeTypes.DIRECTIVE && p.name === 'html')
  const hasClick = node.props.some((p) => p.type === NodeTypes.DIRECTIVE && p.name === 'on')
  // 导航链接：<a href> / <router-link to>（元素上有 @click 时不作为导航链接，交给事件映射）
  const isNavLink = (node.tag === 'a' || node.tag === 'router-link') && !hasClick
  // 标签映射（★生效配置：tags.ts 常量 + config 覆盖；规则被禁用则按未注册标签原样输出）
  const tagRuleId = TAG_RULE_BY_TAG[node.tag]
  let tag = hasVHtml ? 'rich-text' : (ctx.tagMap[node.tag] ?? kebabCase(node.tag))
  if (node.tag === 'router-link') tag = 'view'
  if (tagRuleId && ctx.disabled.has(tagRuleId)) {
    tag = kebabCase(node.tag)
    ctx.warnings.push(`规则 ${tagRuleId} 已被禁用（rules.disabled），<${node.tag}> 按未注册标签原样输出`)
  }
  // 决策 trace：标签映射
  if (!ctx.disabled.has('tag/unknown-kebab') && !(tagRuleId && ctx.disabled.has(tagRuleId))) {
    ctx.trace?.add(
      hasVHtml ? 'tag/rich-text' : node.tag === 'router-link' ? 'tag/router-link' : (TAG_RULE_BY_TAG[node.tag] ?? 'tag/unknown-kebab'),
      { line: node.loc.start.line, before: `<${node.tag}>`, after: `<${tag}>` },
    )
  }
  // 语义标签基础类（h1-h6/p/a → proteus-*，样式侧注入 Web UA 等价默认样式；rich-text 不附加）
  const baseClass = hasVHtml ? '' : (ctx.semanticClass[node.tag] ?? '')
  // 语义类随标签规则联动：tag/* 规则被禁用时标签保持原样，基础类也一并取消（避免 class 无意义）
  const tagDisabled = Boolean(tagRuleId) && ctx.disabled.has(tagRuleId)
  if (baseClass && (ctx.disabled.has('semantic/base-class') || tagDisabled)) {
    ctx.warnings.push(`语义基础类已被禁用（${tagDisabled ? `${tagRuleId} 被禁用` : 'semantic/base-class 被禁用'}，rules.disabled），不再附加`)
  }
  const effectiveBaseClass = baseClass && !ctx.disabled.has('semantic/base-class') && !tagDisabled ? baseClass : ''
  if (effectiveBaseClass) {
    ctx.trace?.add('semantic/base-class', { line: node.loc.start.line, before: node.tag, after: effectiveBaseClass })
  }
  const isInputLike = tag === 'input' || tag === 'textarea'
  const attrs: string[] = []
  let hasNavTarget = false

  // scoped CSS（v0.3）：模板元素附加作用域属性（★分派层：经注册表执行，AI 覆盖规则 apply 即生效）
  if (ctx.scopeId) {
    const scopeCtx: RuleContext = { input: { tag: node.tag, scopeId: ctx.scopeId } }
    executeRule('template/scope-attr', scopeCtx)
    const attr = (scopeCtx.output as string | undefined) ?? ctx.scopeId
    attrs.push(attr)
    ctx.trace?.add('template/scope-attr', { line: node.loc.start.line, before: `<${node.tag}>`, after: `<${node.tag} ${attr}>` })
  }

  for (const prop of node.props) {
    if (prop.type === NodeTypes.ATTRIBUTE) {
      const attr = prop as AttributeNode
      if (isNavLink && (attr.name === 'href' || attr.name === 'to' || attr.name === 'route-type')) {
        if (ctx.disabled.has('nav/navigate-link')) {
          ctx.warnings.push('规则 nav/navigate-link 已被禁用（rules.disabled），<a> 按普通 view 输出（无导航语义）')
          break
        }
        if (attr.name === 'route-type' && attr.value) {
          attrs.push(`data-route-type="${escapeXml(attr.value.content)}"`)
          ctx.trace?.add('nav/route-type', { line: node.loc.start.line, before: `route-type="${attr.value.content}"`, after: `data-route-type="${attr.value.content}"` })
        } else if (attr.value) {
          attrs.push(`data-url="${escapeXml(attr.value.content)}"`)
          hasNavTarget = true
        }
        continue
      }
      if (attr.name === 'class' && effectiveBaseClass) {
        attrs.push(`class="${effectiveBaseClass}${attr.value ? ' ' + escapeXml(attr.value.content) : ''}"`)
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
      } else if (!ctx.disabled.has('nav/navigate-link')) {
        attrs.push(`data-url="{{${exp}}}"`)
        hasNavTarget = true
      } else {
        ctx.warnings.push('规则 nav/navigate-link 已被禁用（rules.disabled），<a> 按普通 view 输出（无导航语义）')
      }
      continue
    }
    switch (dir.name) {
      case 'if':
        if (ctx.disabled.has('directive/v-if')) { ctx.warnings.push('规则 directive/v-if 已被禁用（rules.disabled），v-if 已忽略'); break }
        attrs.push(`wx:if="{{${exprContent(dir.exp)}}}"`)
        ctx.trace?.add('directive/v-if', { line: node.loc.start.line, before: `v-if="${exprContent(dir.exp)}"`, after: `wx:if="{{${exprContent(dir.exp)}}}"` })
        break
      case 'else-if':
        if (ctx.disabled.has('directive/v-else-if')) break
        attrs.push(`wx:elif="{{${exprContent(dir.exp)}}}"`)
        ctx.trace?.add('directive/v-else-if', { line: node.loc.start.line, before: 'v-else-if', after: 'wx:elif' })
        break
      case 'else':
        if (ctx.disabled.has('directive/v-else')) break
        attrs.push('wx:else')
        ctx.trace?.add('directive/v-else', { line: node.loc.start.line, before: 'v-else', after: 'wx:else' })
        break
      case 'for': {
        if (ctx.disabled.has('directive/v-for')) { ctx.warnings.push('规则 directive/v-for 已被禁用（rules.disabled），v-for 已忽略'); break }
        const f = parseForExpr(exprContent(dir.exp))
        attrs.push(`wx:for="{{${f.list}}}"`)
        if (f.item) attrs.push(`wx:for-item="${f.item}"`)
        if (f.index) attrs.push(`wx:for-index="${f.index}"`)
        ctx.trace?.add('directive/v-for', { line: node.loc.start.line, before: exprContent(dir.exp), after: `wx:for="{{${f.list}}}"` })
        break
      }
      case 'on': {
        if (ctx.disabled.has('event/click-to-tap') && ctx.disabled.has('event/modifier-catch')) {
          ctx.warnings.push('事件映射规则已全部禁用（rules.disabled），@事件 原样输出')
          const handler = cleanHandler(exprContent(dir.exp), ctx.warnings)
          attrs.push(`bind${exprContent(dir.arg)}="${handler}"`)
          break
        }
        const raw = exprContent(dir.arg)
        const mapped = ctx.eventMap[raw] ?? raw
        // 修饰符：运行时 modifiers 是 { content }[]（与声明类型 string[] 不一致，做兼容）
        const mods = (dir.modifiers as unknown as Array<{ content?: string } | string>).map((m) =>
          typeof m === 'string' ? m : (m?.content ?? ''),
        )
        const isCatch = (mods.includes('stop') || mods.includes('prevent')) && !ctx.disabled.has('event/modifier-catch')
        const handler = cleanHandler(exprContent(dir.exp), ctx.warnings)
        // 键位修饰符（@keyup.enter 等）：小程序无键盘事件对等，警告
        if (raw === 'keyup' || raw === 'keydown' || raw === 'keypress') {
          const keyMods = mods.filter((m) => !['stop', 'prevent', 'self', 'once'].includes(m))
          ctx.warnings.push(`@${raw}${keyMods.length ? '.' + keyMods.join('.') : ''} 在小程序无对等键盘事件（input 键盘行为请用 @confirm），已原样输出`)
        }
        // 自定义事件（非 EVENT_MAP，如组件 triggerEvent 事件）→ bind:/catch: 冒号形式（微信自定义组件事件标准）
        const isCustomEvent = !(raw in ctx.eventMap)
        const prefix = `${isCatch ? 'catch' : 'bind'}${isCustomEvent ? ':' : ''}`
        // .self / .once（v0.3 尾）：仅对简单方法名 handler 做包装（script 侧生成 proteusSelf/Once 方法）
        const isSelf = mods.includes('self') && !isCatch
        const isOnce = mods.includes('once') && !isCatch
        if ((isSelf || isOnce) && /^[\w$]+$/.test(handler)) {
          if (isSelf) ctx.selfHandlers.add(handler)
          if (isOnce) ctx.onceHandlers.add(handler)
          const wrap = `${isSelf ? 'proteusSelf' : 'proteusOnce'}${capitalize(handler)}`
          attrs.push(`${prefix}${mapped}="${wrap}"`)
        } else {
          attrs.push(`${prefix}${mapped}="${handler}"`)
        }
        ctx.trace?.add(
          isCatch ? 'event/modifier-catch' : isSelf || isOnce ? 'event/modifier-self-once' : 'event/click-to-tap',
          { line: node.loc.start.line, before: `@${raw}`, after: `${prefix}${mapped}` },
        )
        break
      }
      case 'bind': {
        const arg = exprContent(dir.arg)
        const exp = exprContent(dir.exp)
        if (arg === 'class') {
          if (ctx.disabled.has('directive/v-bind-class')) break
          const cls = formatClassBinding(exp, ctx.warnings)
          attrs.push(`class="${effectiveBaseClass ? `${effectiveBaseClass} ` : ''}${cls}"`)
          ctx.trace?.add('directive/v-bind-class', { line: node.loc.start.line, before: `:class="${exp}"`, after: cls })
        } else if (arg === 'style') {
          if (ctx.disabled.has('directive/v-bind-style')) break
          attrs.push(`style="${formatStyleBinding(exp)}"`)
          ctx.trace?.add('directive/v-bind-style', { line: node.loc.start.line, before: `:style="${exp}"`, after: formatStyleBinding(exp) })
        } else if (arg === 'key') {
          if (ctx.disabled.has('directive/v-bind-key')) break
          if (/^[\w$]+$/.test(exp)) attrs.push(`wx:key="${exp}"`)
          else ctx.warnings.push(`:key="${exp}" 不是简单标识符（MVP），wx:key 已忽略`)
          ctx.trace?.add('directive/v-bind-key', { line: node.loc.start.line, before: `:key="${exp}"`, after: `wx:key="${exp}"` })
        } else {
          if (ctx.disabled.has('directive/v-bind')) break
          attrs.push(`${arg}="{{${exp}}}"`)
          ctx.trace?.add('directive/v-bind', { line: node.loc.start.line, before: `:${arg}`, after: `${arg}="{{${exp}}}"` })
        }
        break
      }
      case 'model': {
        if (ctx.disabled.has('directive/v-model')) { ctx.warnings.push('规则 directive/v-model 已被禁用（rules.disabled），v-model 已忽略'); break }
        const model = exprContent(dir.exp)
        if (model && !ctx.vModelBindings.includes(model)) ctx.vModelBindings.push(model)
        if (isInputLike) attrs.push(`value="{{${model}}}"`)
        // 方法名不用 __ 前缀（微信保留前缀，真机绑定可能失效）
        attrs.push(`bindinput="proteusOn${capitalize(model)}Input"`)
        ctx.trace?.add('directive/v-model', { line: node.loc.start.line, before: `v-model="${model}"`, after: `bindinput="proteusOn${capitalize(model)}Input"` })
        break
      }
      case 'html':
        if (ctx.disabled.has('directive/v-html')) { ctx.warnings.push('规则 directive/v-html 已被禁用（rules.disabled），v-html 已忽略'); break }
        attrs.push(`nodes="{{${exprContent(dir.exp)}}}"`)
        ctx.trace?.add('directive/v-html', { line: node.loc.start.line, before: 'v-html', after: 'rich-text nodes' })
        break
      case 'show':
        if (ctx.disabled.has('directive/v-show')) break
        // v-show → hidden 属性（小程序 hidden = display:none，元素始终渲染，语义对齐 v-show）
        attrs.push(`hidden="{{!${exprContent(dir.exp)}}}"`)
        ctx.trace?.add('directive/v-show', { line: node.loc.start.line, before: `v-show="${exprContent(dir.exp)}"`, after: `hidden="{{!${exprContent(dir.exp)}}}"` })
        break
      default:
        break // v-slot / v-pre 等：MVP 忽略
    }
  }

  if (hasNavTarget && !ctx.disabled.has('nav/navigate-link')) {
    // 导航链接：绑定点击跳转（handler 由 script 转换自动注入；方法名避免 __ 前缀）
    attrs.push('bindtap="proteusNavigateTo"')
    ctx.usesNavigate = true
    ctx.trace?.add('nav/navigate-link', { line: node.loc.start.line, before: `<${node.tag}>` + (node.tag === 'a' ? ' href/to' : ' to'), after: 'data-url + bindtap="proteusNavigateTo"' })
  }
  if (effectiveBaseClass && !attrs.some((a) => a.startsWith('class='))) {
    attrs.push(`class="${effectiveBaseClass}"`)
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
    // ★底线循环 ①③：生效配置 = tags.ts 常量 + config 覆盖（规则改写/禁用即时生效）
    ...resolveOverrides(opts.rules),
    scopeId: opts.scopeId,
    selfHandlers: new Set(),
    onceHandlers: new Set(),
  }
  const root = domParse(source, { onError: () => undefined })
  const wxml = root.children.map((c) => serializeNode(c, ctx)).join('\n')
  for (const w of ctx.warnings) console.warn(`[mp-transform] ${w}`)
  return {
    wxml,
    vModelBindings: ctx.vModelBindings,
    usesNavigate: ctx.usesNavigate,
    selfHandlers: [...ctx.selfHandlers],
    onceHandlers: [...ctx.onceHandlers],
    warnings: ctx.warnings,
  }
}
