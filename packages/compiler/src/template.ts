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
        // 对象简写 { on } → 键即值（vue-compat Batch C）
        const shorthand = inner.trim().match(/^([\w$]+)$/)
        if (shorthand) {
          parts.push(`(${shorthand[1]}?'${shorthand[1]} ':'')`)
          continue
        }
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
  /** vue-compat Batch B：内联事件表达式包装方法集合（自增/自减/简单方法调用） */
  inlineHandlers: Array<{ name: string; code: string }>
  /** vue-compat-advance Batch 2：<transition> 子元素注入的动画 class（装饰式，过渡标签不输出） */
  transitionClassName?: string
  /** vue-compat-advance Batch 2：模板使用 <transition> 标记（style 按需注入动画） */
  usesTransition: boolean
  /**
   * ★vue-compat-advance Batch 5：<transition> 离开动画状态机——子元素 v-if 为裸 ref 名时启用
   * ref：v-if 表达式 ref 名（裸 ref 才启用；复杂表达式保持 Batch 2 现状）；index：状态机索引（__tv{i}/__tl{i}）
   */
  transitionCtx?: { ref: string | undefined; tName: string; index: number }
  /** ★Batch 5：已启用的离开动画状态机列表（传给 script 生成 data/方法/写入点注入） */
  transitions: Array<{ ref: string; tName: string; index: number }>
  /** ★pinia-plan 12 P1：模板 store.<field> 引用字段（script 生成 $subscribe → setData 同步） */
  storeBindings: Set<string>
}

/**
 * ★pinia-plan 12 P1：模板 store 引用剥离 + 字段收集
 * `store.<field>` → `<field>`（剥离前缀；嵌套 store.current.title → current.title），并收集顶层字段
 * 语义：store 经 useXxxStore() 编译为实例属性（runtimeInit），模板绑定经 onLoad 的 $subscribe → setData 同步
 */
function rewriteStoreRefs(expr: string, ctx: SerializeContext): string {
  return expr.replace(/\bstore\.([A-Za-z_$][\w$]*)/g, (m, field: string) => {
    ctx.storeBindings.add(field)
    return field
  })
}

/**
 * vue-compat Batch B：尝试将内联事件表达式转包装方法（自增/自减/简单方法调用）
 * 支持：count++ / count-- / ++count / --count / fn(1) / fn('a', 2)
 * 其余（含 store 链式引用等）返回 null → 走 cleanHandler 警告原样
 */
function tryInlineHandler(exp: string): { name: string; code: string } | null {
  const t = exp.trim()
  // 自增/自减（对齐 ref 重写：this.data.x ± 1，决策 #36）
  let m = t.match(/^([\w$]+)\+\+$/) ?? t.match(/^\+\+([\w$]+)$/)
  if (m) {
    return {
      name: `proteusInlineInc${capitalize(m[1])}`,
      code: `this.setData({ ${m[1]}: this.data.${m[1]} + 1 })`,
    }
  }
  m = t.match(/^([\w$]+)--$/) ?? t.match(/^--([\w$]+)$/)
  if (m) {
    return {
      name: `proteusInlineDec${capitalize(m[1])}`,
      code: `this.setData({ ${m[1]}: this.data.${m[1]} - 1 })`,
    }
  }
  // 简单方法调用：fn(字面量参数)——无 . 链（store.xxx 等链式走警告）
  m = t.match(/^([\w$]+)\(([^()]*)\)$/)
  if (m && /^[\w$,'"\s]*$/.test(m[2])) {
    const key = m[2].replace(/\W/g, '') || 'NoArgs'
    return {
      name: `proteusInline${capitalize(m[1])}${key}`,
      code: `this.${m[1]}(${m[2]})`,
    }
  }
  // ★pinia-plan 12 P2：store 方法调用——store.toggle() / store.play({...}) / store.setVolume(store.volume - 0.1)
  //   store 是 useXxxStore() 编译的实例属性（this.store）；事件表达式中 store. 引用改写为 this.store.
  m = t.match(/^store\.([A-Za-z_$][\w$]*)\s*\(([^()]*)\)$/)
  if (m) {
    const method = m[1]
    const args = m[2].trim()
    // key 保留 +/- 语义（store.volume - 0.1 vs + 0.1 区分；否则同名方法冲突覆盖）
    const key = args.replace(/[^A-Za-z0-9_$+-]/g, '').replace(/-/g, 'Minus').replace(/\+/g, 'Plus') || 'NoArgs'
    return {
      name: `proteusStore${capitalize(method)}${key}`,
      code: `this.store.${method}(${args.replace(/\bstore\./g, 'this.store.')})`,
    }
  }
  return null
}

function serializeElement(node: ElementNode, ctx: SerializeContext): string {
  // ★Batch A（vue-compat）：平台无对等标签——显式警告（反黑盒，不再静默输出无效产物）
  if (node.tag === 'component') {
    ctx.warnings.push(
      `<component :is> 动态组件在小程序无对等机制（产物为无效标签）——请用 v-if/v-else 条件渲染（vue-compat Batch A）`,
    )
    ctx.trace?.add('template/is-component', { line: node.loc.start.line, before: '<component :is>', after: '（无效标签，请条件渲染）' })
  }
  // ★vue-compat-advance Batch 2：<transition> 装饰式——动画 class 注入子元素，过渡标签不输出（进入动画自动播放，离开立即移除）
  const isTransition = node.tag === 'transition'
  if (isTransition) {
    const nameAttr = node.props.find((p) => p.type === NodeTypes.ATTRIBUTE && p.name === 'name') as AttributeNode | undefined
    const tName = (nameAttr && nameAttr.value ? nameAttr.value.content : 'fade') || 'fade'
    ctx.transitionClassName = `proteus-transition-${tName}`
    ctx.usesTransition = true
    // ★Batch 5：离开动画状态机——首个子元素 v-if 为裸 ref 名时启用（index 在启用时分配）
    ctx.transitionCtx = { ref: undefined, tName, index: -1 }
    ctx.trace?.add('transition/component', {
      line: node.loc.start.line,
      before: `<transition name="${tName}">`,
      after: `子元素注入 class="proteus-transition-${tName}"（进入动画自动播放；裸 ref v-if 子元素启用离开动画状态机 Batch 5）`,
    })
    // 装饰语义：不输出过渡标签本身，直接序列化子元素（动画 class 由子元素注入）
    return node.children.map((c) => serializeNode(c, ctx)).join('\n')
  }
  if ((node.tag === 'transition-group' || node.tag === 'teleport' || node.tag === 'suspense' || node.tag === 'keep-alive') && !isTransition) {
    ctx.warnings.push(
      `<${node.tag}> 在小程序无对等组件（已原样输出，不生效）——缓存/传送请移除；多元素转场请用路由 routeType（vue-compat Batch A）`,
    )
    ctx.trace?.add('template/no-peer', { line: node.loc.start.line, before: `<${node.tag}>`, after: '（无对等，原样输出）' })
  }
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
      // ★Batch A（vue-compat）：模板 ref 小程序无对等——显式警告（不再静默无效）
      if (attr.name === 'ref') {
        ctx.warnings.push(
          `模板 ref="${attr.value ? attr.value.content : ''}" 在小程序无对等绑定（永不赋值）——请用 this.selectComponent('#id')（vue-compat Batch A）`,
        )
        ctx.trace?.add('template/template-ref', { line: node.loc.start.line, before: `ref="${attr.value ? attr.value.content : ''}"`, after: '（剥离，无对等）' })
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
        // ★Batch 5：transition 子元素 v-if 为裸 ref 名 → 离开动画状态机（显示由 __tv{i} 控制，ref 写入点联动）
        if (ctx.transitionCtx && /^[A-Za-z_$][\w$]*$/.test(exprContent(dir.exp))) {
          const ref = exprContent(dir.exp)
          ctx.transitionCtx.ref = ref
          ctx.transitionCtx.index = ctx.transitions.length
          ctx.transitions.push({ ref, tName: ctx.transitionCtx.tName, index: ctx.transitionCtx.index })
          attrs.push(`wx:if="{{__tv${ctx.transitionCtx.index}}}"`)
          ctx.trace?.add('transition/leave-state', {
            line: node.loc.start.line,
            before: `v-if="${ref}"`,
            after: `wx:if="{{__tv${ctx.transitionCtx.index}}}"（离开动画状态机：__tl${ctx.transitionCtx.index} 播离开动画 + 延迟移除）`,
          })
          break
        }
        // 非裸 ref（复杂表达式）或非 transition 子元素：Batch 2 现状（立即显隐）
        if (ctx.transitionCtx) ctx.transitionCtx.ref = undefined // 复杂表达式不启用状态机
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
        // .self / .once（v0.3 尾）：仅对简单方法名 handler 做包装（script 侧生成 proteusSelf/Once 方法）
        const isSelf = mods.includes('self') && !isCatch
        const isOnce = mods.includes('once') && !isCatch
        // ★vue-compat Batch B：内联表达式（count++ / fn(1)）→ 包装方法；其余走 cleanHandler（警告原样）
        const rawHandler = exprContent(dir.exp)
        const inline = tryInlineHandler(rawHandler)
        let handler: string
        if (inline && !isSelf && !isOnce) {
          handler = inline.name
          if (!ctx.inlineHandlers.some((h) => h.name === inline.name)) ctx.inlineHandlers.push(inline)
          ctx.trace?.add('event/inline-expression', { line: node.loc.start.line, before: `@${exprContent(dir.arg)}="${rawHandler}"`, after: `${inline.name}（包装方法）` })
        } else {
          handler = cleanHandler(rawHandler, ctx.warnings)
        }
        // 键位修饰符（@keyup.enter 等）：小程序无键盘事件对等，警告
        if (raw === 'keyup' || raw === 'keydown' || raw === 'keypress') {
          const keyMods = mods.filter((m) => !['stop', 'prevent', 'self', 'once'].includes(m))
          ctx.warnings.push(`@${raw}${keyMods.length ? '.' + keyMods.join('.') : ''} 在小程序无对等键盘事件（input 键盘行为请用 @confirm），已原样输出`)
        }
        // 自定义事件（非 EVENT_MAP，如组件 triggerEvent 事件）→ bind:/catch: 冒号形式（微信自定义组件事件标准）
        const isCustomEvent = !(raw in ctx.eventMap)
        const prefix = `${isCatch ? 'catch' : 'bind'}${isCustomEvent ? ':' : ''}`
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
        // ★vue-compat-advance Batch 1/7：作用域插槽 <slot :item> —— MP/Skyline 平台限制（无模板传参机制），显式警告 + 替代模式
        if (node.tag === 'slot' && arg !== 'class' && arg !== 'style' && arg !== 'name') {
          ctx.warnings.push(
            `作用域插槽 <slot :${arg}> 在小程序无对等机制（父侧拿不到子组件数据；MP/Skyline 无模板传参——vue-compat-advance Batch 7 平台限制）——替代模式：子组件 props 接收数据 + 自定义事件回调传数据，如 <MyList :items="items" @item-tap="onItemTap" />（props.items 内渲染 + triggerEvent 回传）`,
          )
          ctx.trace?.add('slot/scoped-slot', { line: node.loc.start.line, before: `<slot :${arg}="${exp}">`, after: '（无效，MP 不传数据）→ 替代：props 传子 + 事件回调' })
        }
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
          // ★pinia-plan 12 P1：:prop="store.x" 同样剥离前缀
          attrs.push(`${arg}="{{${rewriteStoreRefs(exp, ctx)}}}"`)
          ctx.trace?.add('directive/v-bind', { line: node.loc.start.line, before: `:${arg}`, after: `${arg}="{{${rewriteStoreRefs(exp, ctx)}}}"` })
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
        // ★Batch A（vue-compat）：自定义指令（v-focus 等）小程序无对等——显式警告（反黑盒，不再静默剥离）
        if (dir.name === 'slot' || dir.name === 'pre' || dir.name === 'cloak') {
          break // v-slot/v-pre/v-cloak：MVP 忽略（无对等语义）
        }
        ctx.warnings.push(
          `自定义指令 v-${dir.name} 在小程序无对等机制（已剥离且不执行）——请改用方法调用或条件渲染（vue-compat Batch A）`,
        )
        ctx.trace?.add('directive/custom', { line: node.loc.start.line, before: `v-${dir.name}`, after: '（剥离，无对等）' })
        break
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
  // ★vue-compat-advance Batch 2/5：<transition> 子元素注入动画 class（首个元素；进入动画由重建自动播放）
  // ★Batch 5：裸 ref v-if 状态机启用时，class 追加 __tl{i} 插值（离开中切换 leave 动画 class）
  if (ctx.transitionClassName) {
    const animCls = ctx.transitionClassName
    ctx.transitionClassName = undefined
    const tctx = ctx.transitionCtx
    ctx.transitionCtx = undefined // 首个元素消费后清空（多子元素场景后续元素不受影响）
    const leaveExpr = tctx && tctx.ref !== undefined ? ` {{__tl${tctx.index} ? '${animCls}-leave' : ''}}` : ''
    const clsIdx = attrs.findIndex((a) => a.startsWith('class='))
    if (clsIdx >= 0) {
      attrs[clsIdx] = attrs[clsIdx].replace(/^class="/, `class="${animCls}${leaveExpr} `)
    } else {
      attrs.push(`class="${animCls}${leaveExpr}"`)
    }
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
      // ★pinia-plan 12 P1：模板 store 引用 → 剥离前缀 + 收集字段（{{ store.current.title }} → {{ current.title }}）
      return `{{ ${rewriteStoreRefs((node as unknown as { content: { content: string } }).content.content, ctx)} }}`
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
    inlineHandlers: [],
    usesTransition: false,
    transitions: [],
    storeBindings: new Set<string>(),
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
    inlineHandlers: ctx.inlineHandlers,
    usesTransition: ctx.usesTransition,
    // ★Batch 5：离开动画状态机列表（裸 ref v-if 的 transition 子元素）
    transitions: ctx.transitions,
    // ★pinia-plan 12 P1：模板 store 引用字段（script 生成绑定）
    storeBindings: [...ctx.storeBindings],
    warnings: ctx.warnings,
  }
}
