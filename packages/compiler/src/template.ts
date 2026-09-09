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
import type { FluidLayoutConfig, VModelComponentHandler } from '@proteus-vue/types/compiler-types'
import { linearFluid, calcColumns } from './fluid-layout'
import type { TransformTrace } from './trace'
import { TAG_RULE_BY_TAG } from './transforms/template'
import { TAG_SEMANTIC_MAP } from '@proteus-vue/component-ir'
import { executeRule } from './transforms/registry'
import type { RuleContext } from './transforms/types'
import { resolveOverrides } from './overrides'
import { CompilerError } from './validate'
import { lowerSvgToImage, lowerSvgDynamic, collectUnsupportedSvgTags } from './svg-lower'

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function kebabCase(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function camelToKebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/** ★scoped 类名拼接（2026-08 真机重构）：class 值 token 追加 -scopeId（'.box → box-data-v-x' 单一类，Skyline ✓；已带后缀不重复） */
function suffixClassValue(value: string, scopeId: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => (n.endsWith(`-${scopeId}`) ? n : `${n}-${scopeId}`))
    .join(' ')
}

/** 单个类名追加 scope 后缀（'fade-leave' → 'fade-leave-data-v-x'；scopeId 为空时原样） */
function suffixClassName(name: string, scopeId: string): string {
  if (!scopeId) return name
  return name.endsWith(`-${scopeId}`) ? name : `${name}-${scopeId}`
}

/** 小程序原生基础标签（映射后的标签在此集合内 → 非组件；否则视为自定义组件标签，class 走 root-class 透传） */
const NATIVE_TAGS = new Set([
  'view', 'scroll-view', 'swiper', 'swiper-item', 'movable-view', 'movable-area', 'cover-view', 'cover-image',
  'icon', 'text', 'rich-text', 'progress', 'button', 'checkbox', 'checkbox-group', 'form', 'input', 'label',
  'picker', 'picker-view', 'picker-view-column', 'radio', 'radio-group', 'slider', 'switch', 'textarea', 'navigator',
  'image', 'video', 'camera', 'live-player', 'live-pusher', 'map', 'canvas', 'web-view', 'ad', 'official-account',
  'open-data', 'slot', 'block', 'template', 'match-media', 'page-container', 'share-element', 'sticky-header',
  'sticky-section', 'root-portal', 'channel-live', 'channel-video', 'list', 'grid', 'cell', 'cell-group', 'waterflow',
])

/** ★layout/auto-flex-row：行内控件标签（与 text 同容器 → 自动 flex row；Skyline 无 inline，行内排布唯一路径） */
const INLINE_CONTROL_TAGS = new Set([
  'switch', 'slider', 'icon', 'image', 'button', 'input', 'textarea', 'checkbox', 'radio', 'label', 'navigator', 'progress',
])

/** ★#505 G2：SVG 命名空间标签（微信无对等组件——<svg> 不渲染；Skia 矢量映射为后续批次）。
 *   不含 image/text（SVG 的 <image>/<text> 与小程序原生 image/text 同名冲突——原生高频标签优先，业务 SVG 内 image/text 罕见不覆盖） */
const SVG_NAMESPACE_TAGS = new Set([
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g', 'defs',
  'lineargradient', 'radialgradient', 'stop', 'use', 'symbol', 'mask', 'clippath', 'tspan',
])

/**
 * ★TS 类型断言剥离（2026-08-31 B5 真机实测暴露：'primary' as any 原样进 WXML → 微信编译器
 *   Fatal: unmatched parenthesis → 小程序包无法编译）：类型断言是编译期擦除的 TS 语法，不应进产物。
 *   Web 端 Vue 编译器自动剥离；自研 MP 编译器补齐。支持：括号包裹 (expr as Type) → expr、尾部 expr as Type → expr（连续循环）
 */
function stripTypeAssertions(expr: string): string {
  let out = expr.trim()
  for (let i = 0; i < 5; i++) {
    let changed = false
    // 括号包裹的断言：(expr as Type) → expr（[^()] 避免误吞嵌套；字符串内 as 保留）
    out = out.replace(/\(\s*([^()]*?)\s+as\s+[A-Za-z_$][\w$.]*(\[\])?\s*\)/g, (_m, inner: string) => {
      changed = true
      return inner
    })
    // 尾部裸断言：expr as Type → expr
    out = out.replace(/\s+as\s+[A-Za-z_$][\w$.]*(\[\])?\s*$/g, () => {
      changed = true
      return ''
    })
    if (!changed) break
  }
  return out.trim()
}

/** 提取表达式节点的文本（兼容 Simple/Compound/Interpolation/Text/字符串）；★统一剥离 TS 类型断言 */
function exprContent(exp: unknown): string {
  let out = ''
  if (exp == null) return ''
  if (typeof exp === 'string') {
    out = exp
  } else {
    const node = exp as { type?: number; content?: unknown; children?: unknown[] }
    if (node.type === NodeTypes.SIMPLE_EXPRESSION) {
      out = typeof node.content === 'string' ? node.content : ''
    } else if (node.type === NodeTypes.INTERPOLATION) {
      out = exprContent(node.content)
    } else if (node.type === NodeTypes.COMPOUND_EXPRESSION || Array.isArray(node.children)) {
      out = (node.children as unknown[]).map((c) => exprContent(c)).join('')
    } else if (node.type === NodeTypes.TEXT) {
      out = typeof node.content === 'string' ? node.content : ''
    }
  }
  return stripTypeAssertions(out)
}

/** 解析 v-for 表达式：(item, idx) in list / item of items */
function parseForExpr(exp: string): { list: string; item?: string; index?: string } {
  const m = exp.trim().match(/^\(?\s*([\w$]+)\s*(?:,\s*([\w$]+))?\s*\)?\s+(?:in|of)\s+(.+)$/)
  if (!m) return { list: exp }
  return { list: m[3].trim(), item: m[1], index: m[2] }
}

/** 事件处理器：仅支持简单方法引用（方法名 / 方法名($event)） */
function cleanHandler(exp: string, warnings: string[], failFast?: boolean, filename?: string): string {
  const t = exp.trim()
  if (/^[\w$]+$/.test(t)) return t
  const m = t.match(/^([\w$]+)\(\$event\)$/)
  if (m) return m[1]
  const msg = `事件处理器 "${t}" 不是简单方法引用（MVP 仅支持方法名），已原样输出`
  if (failFast) failFastThrow(filename, msg)
  warnings.push(msg)
  return t
}

/** ★2026-09-09 支持矩阵 fail-fast（rules.failFast）：矩阵外语义「已原样输出」类软警告 → 编译期硬报错（fail-closed）。
 *  防「原样输出不生效」的静默放行——产物流到真机才暴露（对比 uni-app 黑盒）；缺省关（诚实警告不拦截） */
function failFastThrow(filename: string | undefined, msg: string): never {
  throw new CompilerError(filename ?? 'anonymous.vue', `${msg}——rules.failFast 开启：矩阵外语义编译期硬报错（不再原样输出放行）`)
}

/** :class 绑定：对象语法 → 三元拼接，其余 → {{expr}}
 * ★2026-08 scoped 后缀：scopeId 非空时字符串字面量/对象键后缀（'box' → 'box-data-v-x'）；动态变量类名无法静态后缀 → 编译期警告 */
function formatClassBinding(exp: string, warnings: string[], scopeId = ''): string {
  const t = exp.trim()
  const sfx = (name: string): string => (scopeId && !name.endsWith(`-${scopeId}`) ? `${name}-${scopeId}` : name)
  // 表达式内字符串字面量后缀（三元值 'a'/'b' 等）
  const sfxExpr = (e: string): string => (scopeId ? e.replace(/'([^']*)'/g, (_m, s: string) => `'${sfx(s)}'`) : e)
  const dynWarn = (name: string): void => {
    if (scopeId) warnings.push(`:class 动态类名 "${name}" 无法 scoped 后缀（MP 单类选择器机制），该动态类在小程序无 scoped 样式匹配（Web 端正常）`)
  }
  if (t.startsWith('{')) {
    // 对象语法 → 三元拼接
    const parts: string[] = []
    const re = /(['"]?)([\w-]+)\1\s*:\s*([^,}]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(t))) parts.push(`(${m[3].trim()}?'${sfx(m[2])} ':'')`)
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
        parts.push(`'${sfx(str[2])} '`)
        continue
      }
      if (i.startsWith('{')) {
        const inner = i.slice(1, -1)
        // 对象简写 { on } → 键即值（vue-compat Batch C）
        const shorthand = inner.trim().match(/^([\w$]+)$/)
        if (shorthand) {
          parts.push(`(${shorthand[1]}?'${sfx(shorthand[1])} ':'')`)
          continue
        }
        const re = /(['"]?)([\w-]+)\1\s*:\s*([^,}]+)/g
        let m: RegExpExecArray | null
        let ok = false
        while ((m = re.exec(inner))) {
          parts.push(`(${m[3].trim()}?'${sfx(m[2])} ':'')`)
          ok = true
        }
        if (ok) continue
      }
      if (/^[\w$.]+(?:\s*\?\s*[^:]+:.+)?$/.test(i)) {
        // 简单变量 / 三元：值即类名（括号包裹避免三元嵌套优先级歧义）
        if (scopeId && /^[\w$.]+$/.test(i)) dynWarn(i)
        parts.push(`((${sfxExpr(i)})?(${sfxExpr(i)})+' ':'')`)
        continue
      }
      warnings.push(`:class 数组项 "${i}" 暂不支持（MVP：仅字符串/对象/简单变量/三元），已跳过`)
    }
    if (parts.length) return `{{${parts.join('+')}}}`
  }
  if (/^[\w$.]+$/.test(t)) dynWarn(t)
  return `{{${sfxExpr(t)}}}`
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
  /** ★2026-09-09 支持矩阵 fail-fast：矩阵外语义「已原样输出」→ 编译期 CompilerError（rules.failFast） */
  failFast?: boolean
  /** scoped CSS 作用域属性（v0.3：元素附加 data-v-xxx，样式侧选择器属性匹配） */
  scopeId?: string
  /** ★组件模式根节点标记（首个顶层元素：class 追加 {{rootClass}} 接收外部 class 透传） */
  isComponentRoot?: boolean
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
  /** ★#494 模板表达式中的裸标识符（与 script runtimeInits 求交 → 快照 setData——实例属性模板读不到） */
  templateRefs: Set<string>
  /** ★#500 :style 绑定的动态标识符（同名 computed 派生对象 → 编译器自动序列化字符串——MP 双渲染器 style 仅收字符串） */
  styleBindings: Set<string>
  /** ★2026-09-09 G-62 事件命中：带事件的静态 SVG 图形表（touch 坐标 + 几何判定） */
  svgHits: Array<{ imageId: string; viewBox: string; shapes: import('./svg-lower').SvgHitShape[] }>
  /** ★2026-09-09 G-62 P1：动态 <svg> 收集（computed 名 + SVG 模板字面量 + 依赖 + viewBox）——
   *  由 script 侧生成 computed（复用既有 computed 链路：依赖追踪/init/写入补丁重算） */
  dynamicSvgs: Array<{ computedName: string; parts: import('./svg-lower').SvgPart[]; deps: string[]; viewBox: string }>
  /** ★2026-09-08 useTemplateRef/模板 ref 承接：ref="x" → 注入 id="x"（selectComponent 需要）+ 收集 ref 名（script 侧 useTemplateRef → this.<var> = this.selectComponent('#x')） */
  templateRefNames: Set<string>
  /** ★#500 自定义组件 v-model[:arg] 回写处理器（prop + update:arg 事件 → 页面 setData；★#505 M4 完整契约含 arg/propName） */
  vModelComponentHandlers: VModelComponentHandler[]
  /** ★G-22 柔性布局：p-fluid 编译期 clamp 生成参数（designWidth/viewport；缺省 375/320-1440） */
  fluidLayout?: FluidLayoutConfig
  /** ★#496 页面上下文标记（语义编译仅页面——组件内 p-grid 走运行时组件；Skyline query 需页面 onReady） */
  isPage?: boolean
  /** ★#496 柔性语义编译：p-grid 语义元素收集（script 注入档位 style 变量与求解段；index = style 变量序） */
  semanticGrids: Array<{ minColWidth: number; gap: number; index: number; defaultStyle: string }>
}

/**
 * ★pinia-plan 12 P1：模板 store 引用剥离 + 字段收集
 * `store.<field>` → `<field>`（剥离前缀；嵌套 store.current.title → current.title），并收集顶层字段
 * 语义：store 经 useXxxStore() 编译为实例属性（runtimeInit），模板绑定经 onLoad 的 $subscribe → setData 同步
 */
function rewriteStoreRefs(expr: string, ctx: SerializeContext): string {
  // ★#494 收集表达式裸标识符（script 侧与 runtimeInits 求交 → 快照 setData）
  for (const id of expr.match(/\b[A-Za-z_$][\w$]*\b/g) ?? []) ctx.templateRefs.add(id)
  return expr.replace(/\bstore\.([A-Za-z_$][\w$]*)/g, (m, field: string) => {
    ctx.storeBindings.add(field)
    return field
  })
}

/**
 * ★G-22 柔性布局：解析 p-fluid 表达式（prop(min,max) 空格分隔组）
 * `font-size(20, 32) gap(12,20)` → [{ prop: 'font-size', min: 20, max: 32 }, ...]；非法组忽略（FLD003 由调用方告警）
 */
function parseFluidExpr(expr: string): Array<{ prop: string; min: number; max: number }> {
  const out: Array<{ prop: string; min: number; max: number }> = []
  const re = /([A-Za-z][A-Za-z-]*)\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(expr))) {
    out.push({ prop: m[1], min: Number(m[2]), max: Number(m[3]) })
  }
  return out
}

/** ★16-progress-skyline-degrade：<progress> → 自定义 view 进度条（Skyline 官方不支持原生 progress，真机实测不渲染）
 * 属性映射：percent → inner 宽度；active-color/color → 填充色；stroke-width → track 高度；show-info → 百分比文字
 * 静态属性直接输出、绑定属性插值（{{expr}}）；show-info 无值属性 = true（微信布尔语义） */
function serializeProgress(node: ElementNode, ctx: SerializeContext): string {
  const find = (name: string): AttributeNode | DirectiveNode | undefined =>
    node.props.find((p) =>
      p.type === NodeTypes.ATTRIBUTE ? (p as AttributeNode).name === name : exprContent((p as DirectiveNode).arg) === name,
    )
  const staticVal = (name: string): string | undefined => {
    const a = find(name) as AttributeNode | undefined
    return a && a.type === NodeTypes.ATTRIBUTE && a.value ? a.value.content : undefined
  }
  const bindVal = (name: string): string | undefined => {
    const d = find(name) as DirectiveNode | undefined
    return d && d.type === NodeTypes.DIRECTIVE && d.exp ? exprContent(d.exp) : undefined
  }
  const attr = (name: string): { static?: string; bind?: string } => ({ static: staticVal(name), bind: bindVal(name) })
  const p = attr('percent')
  const c = attr('active-color') || attr('color')
  const sw = attr('stroke-width')
  const percentInner = p.bind ?? p.static ?? '0' // 裸表达式（info 插值用）
  const percentExpr = p.bind ? `{{${p.bind}}}` : (p.static ?? '0')
  const colorExpr = c.bind ? `{{${c.bind}}}` : (c.static ?? '#07c160')
  const swExpr = sw.bind ? `{{${sw.bind}}}` : (sw.static ?? '6')
  const widthStyle = p.bind ? `width:{{${p.bind}}}%` : `width:${p.static ?? 0}%`
  const colorStyle = c.bind ? `background-color:{{${c.bind}}}` : `background-color:${c.static ?? '#07c160'}`
  // show-info：无值属性（微信布尔 true）；:show-info 绑定表达式；缺失 → 不显示
  const si = find('show-info')
  const showInfo = si
    ? si.type === NodeTypes.DIRECTIVE
      ? (exprContent((si as DirectiveNode).exp) || 'true')
      : 'true'
    : 'false'
  ctx.trace?.add('component/progress-degrade', {
    line: node.loc.start.line,
    before: '<progress percent="70" show-info>',
    after: '自定义 view 进度条（Skyline 不支持原生 progress，16-progress-skyline-degrade）',
  })
  return (
    `<view class="proteus-progress">\n` +
    `  <view class="proteus-progress-track" style="height:${swExpr}px">\n` +
    `    <view class="proteus-progress-inner" style="${widthStyle};${colorStyle}"></view>\n` +
    `  </view>\n` +
    `  ${showInfo === 'false' ? '' : `<text wx:if="{{${showInfo}}}" class="proteus-progress-info">{{${percentInner}}}%</text>\n`}` +
    `</view>`
  )
}

// ★#496 柔性语义编译 helper（p-grid）

/** 语义编译标签集合（本轮 p-grid；p-stack/p-fit 后续 #496 M2——flex 语义可先留运行时组件） */
const SEMANTIC_COMPILE_TAGS = new Set(['p-grid'])

/** 需迁移到合成包装节点的指令（循环/条件/渲染 key——包装承载渲染，内容节点剥离） */
const LOOP_DIRECTIVES = new Set(['for', 'if', 'else-if', 'else', 'key'])

/** ★2026-09-08 v-once/v-pre 诚实对齐：判断元素（含子节点/属性）是否含 {{ }} 插值——无插值=纯静态内容（剥离 v-once/v-pre 语义等价），有插值=依赖运行期（v-once 惰性冻结/v-pre 跳过编译在 MP 无对等 → 诚实 warning） */
function hasInterpolation(node: ElementNode): boolean {
  // 属性插值 {{ }}
  for (const p of node.props) {
    if (p.type === NodeTypes.ATTRIBUTE && (p as AttributeNode).value && (p as AttributeNode).value?.content.includes('{{')) return true
    if (p.type === NodeTypes.DIRECTIVE) {
      const d = p as DirectiveNode
      if (d.exp && exprContent(d.exp).includes('{{')) return true
      if (d.arg && exprContent(d.arg).includes('{{')) return true
    }
  }
  // 子节点插值（递归）
  for (const c of node.children) {
    if (c.type === NodeTypes.TEXT && (c as { content?: string }).content?.includes('{{')) return true
    if (c.type === NodeTypes.INTERPOLATION) return true
    if (c.type === NodeTypes.ELEMENT && hasInterpolation(c as ElementNode)) return true
  }
  return false
}

/** 解析 p-grid 语义 props（MVP：静态属性或 :bind 数字字面量；其它形态 → 回退运行时组件并警告） */
function tryParseSemanticGrid(node: ElementNode): { minColWidth: number; gap: number } | null {
  let minColWidth = 160
  let gap = 12
  for (const p of node.props) {
    const d = p as { type: number; name?: string; arg?: { content: string } | null; exp?: { content: string } | null; value?: { content: string } | null }
    if (d.type === NodeTypes.ATTRIBUTE) {
      const name = d.name ?? ''
      if (name !== 'min-col-width' && name !== 'minColWidth' && name !== 'gap') continue
      const raw = d.value ? d.value.content : undefined
      if (raw === undefined) continue
      const num = Number(raw.trim())
      if (!Number.isFinite(num)) return null
      if (name === 'gap') gap = num
      else minColWidth = num
      continue
    }
    // :bind 数字字面量（:min-col-width="160"）——arg 即属性名（kebab 原文），exp 即字面量
    if (d.type === NodeTypes.DIRECTIVE) {
      if (d.name !== 'bind') continue
      const propName = exprContent(d.arg) // 'min-col-width' / 'minColWidth' / 'gap'
      if (propName !== 'min-col-width' && propName !== 'minColWidth' && propName !== 'gap') continue
      const raw = exprContent(d.exp)
      const num = Number(raw.trim())
      if (!Number.isFinite(num)) return null
      if (propName === 'gap') gap = num
      else minColWidth = num
    }
  }
  return { minColWidth, gap }
}

/** 合成元素（走标准递归序列化——class/scope/v-for 处理自动一致） */
function makeSemanticElement(src: ElementNode, tag: string, props: unknown[], children: unknown[]): ElementNode {
  return { type: NodeTypes.ELEMENT, tag, tagType: src.tagType, props: props as never, children: children as never, loc: src.loc } as unknown as ElementNode
}

/** 静态属性节点 */
function attrValue(name: string, value: string): AttributeNode {
  return { type: NodeTypes.ATTRIBUTE, name, value: { content: value, loc: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 }, source: '' } } } as AttributeNode
}

/**
 * p-grid → 容器 flex（静态 gap）+ 直接子元素逐包档位容器（子 v-for/v-if 迁移到包装层）
 * ★#496c 宽度用 px 档（Skyline 实测 calc 百分比在 flex-basis 不可靠——320 宽被算出 3 列内容宽并排）：
 *   flex-basis 由运行档 setData（px——Skyline 已验证可靠）；列数基准 = 容器实测宽（SelectorQuery），
 *   非屏幕宽（页面 padding 会让 px 溢出换行成单列空档，#496b 教训）。
 */
function buildGridItemStyle(containerWidth: number, minColWidth: number, gap: number): string {
  const cols = calcColumns(containerWidth, minColWidth, gap)
  // ★#496f 整 px 向下取整：小数 basis 两卡+gap 恰=容器宽，Skyline 小数 px 取整方向不定（向上→总和>容器→wrap 成单列不满，日志 w=393.4 basis=190.7 实证）
  const basis = Math.floor((containerWidth - (cols - 1) * gap) / cols)
  return `flex-grow:0; flex-shrink:0; flex-basis:${basis}px`
}

/**
 * p-grid → 容器 flex（静态 gap）+ 直接子元素逐包档位容器（子 v-for/v-if 迁移到包装层）
 * 档位 style 由 script 段 setData（pgridStyle{index}）——页面 onLoad 屏幕宽近似 + onReady SelectorQuery 实测精修
 */
function serializeSemanticGrid(node: ElementNode, ctx: SerializeContext, grid: { minColWidth: number; gap: number }): string {
  const index = ctx.semanticGrids.length
  const designWidth = ctx.fluidLayout?.designWidth ?? 375
  const defaultStyle = buildGridItemStyle(designWidth, grid.minColWidth, grid.gap)
  ctx.semanticGrids.push({ minColWidth: grid.minColWidth, gap: grid.gap, index, defaultStyle })
  ctx.trace?.add('fluid/semantic-grid', {
    line: node.loc.start.line,
    before: `<p-grid min-col-width="${grid.minColWidth}" gap="${grid.gap}">…</p-grid>`,
    after: `容器 flex(row/wrap/gap ${grid.gap}px) id=pgrid${index} + 子项 p-grid-item（style 绑 {{pgridStyle${index}}}——px 档位实测容器宽，#496c）`,
  })

  const semanticProp = (dirName: string): boolean => dirName === 'min-col-width' || dirName === 'minColWidth' || dirName === 'gap'

  // 容器 props：p-grid 自身 v-if/v-for/用户 class/style 保留；仅剥语义 props（静态/bind min-col-width·gap）
  const containerProps: unknown[] = []
  for (const p of node.props) {
    const d = p as { type: number; name?: string; arg?: { content: string } | null }
    const isDir = d.type === NodeTypes.DIRECTIVE
    if (isDir) {
      const dirName = d.name ?? ''
      if (dirName === 'bind' && (semanticProp(exprContent(d.arg)) || exprContent(d.arg) === 'style')) continue
      containerProps.push(p)
      continue
    }
    if (semanticProp(d.name ?? '') || d.name === 'style') continue
    containerProps.push(p)
  }
  containerProps.push(attrValue('style', `display:flex;flex-wrap:wrap;gap:${grid.gap}px`))
  containerProps.push(attrValue('id', `pgrid${index}`)) // ★#496c SelectorQuery 实测容器宽（页面级）
  if (!containerProps.some((p) => (p as { type: number; name?: string }).type === NodeTypes.ATTRIBUTE && (p as { name?: string }).name === 'class')) {
    containerProps.push(attrValue('class', 'p-grid'))
  } else {
    // 用户 class 与 p-grid 并存：class 属性追加（Scope 后缀由序列化统一处理）
    for (let i = 0; i < containerProps.length; i++) {
      const p = containerProps[i] as { type: number; name?: string; value?: { content: string } }
      if (p.type === NodeTypes.ATTRIBUTE && p.name === 'class' && p.value) p.value.content += ' p-grid'
    }
  }
  const container = makeSemanticElement(node, 'view', containerProps, [])

  // 直接子元素 → 包档位容器（循环/条件迁移到包装）；class 合并（'p-grid-item ' + 子类）；style 合并（子 style + basis）
  const children: unknown[] = []
  for (const child of node.children) {
    if (child.type !== NodeTypes.ELEMENT) {
      children.push(child)
      continue
    }
    const el = child as ElementNode
    const loop: unknown[] = []
    const rest: unknown[] = []
    let childClass = ''
    let childStyle = ''
    for (const p of el.props) {
      const d = p as { type: number; name?: string; arg?: { content: string } | null; value?: { content: string } }
      const isDir = d.type === NodeTypes.DIRECTIVE
      if (isDir) {
        // 指令名在 name（v-for/if/else…）；bind-key 经 arg 识别
        if (LOOP_DIRECTIVES.has(d.name ?? '') || (d.name === 'bind' && exprContent(d.arg) === 'key')) {
          loop.push(p)
          continue
        }
        rest.push(p)
        continue
      }
      if (d.name === 'class' && d.value) {
        childClass = d.value.content.trim()
        continue
      }
      if (d.name === 'style' && d.value) {
        childStyle = d.value.content.trim()
        continue
      }
      rest.push(p)
    }
    const wrapProps: unknown[] = [...loop, attrValue('class', childClass ? `p-grid-item ${childClass}` : 'p-grid-item')]
    if (childStyle) {
      // 子项静态 style 与档位 style 变量冲突（同 index 多子异 style 无法合入变量）——警告剥离（MVP；给子项用 class 代替 style）
      ctx.warnings.push(`p-grid 子项静态 style 已剥离（档位 style 由 {{pgridStyle${index}}} 变量承载，语义编译 #496）——请改用 class`)
    }
    wrapProps.push(attrValue('style', `{{pgridStyle${index}}}`))
    wrapProps.push(...rest)
    const item = makeSemanticElement(el, 'view', wrapProps, [{ ...el, props: [...rest] } as unknown as ElementNode])
    children.push(item)
  }
  ;(container as unknown as { children: unknown[] }).children = children
  return serializeElement(container, ctx)
}

/** ★G-62 P2：SVG 子树内实测不支持特性（use/symbol/text/tspan）→ 编译期诚实警告。
 *  依据真机 spike（examples/pages/svg-p2-spike.vue）：Skyline image 的 SVG 渲染支持 mask/clipPath/
 *  渐变/transform/dasharray/opacity/filter，但 use+symbol 与 text 实测空白——提前告知（反黑盒）。 */
function warnUnsupportedSvgFeatures(node: ElementNode, ctx: SerializeContext): void {
  const bad = collectUnsupportedSvgTags(node)
  if (!bad.size) return
  const names = [...bad].map((t) => `<${t}>`).join('/')
  // ★2026-09-09 根因实证（对照实验）：Skyline 渲染引擎**解码 SVG 成功但丢弃文字元素**——
  //   同一 SVG 含 <text> 时其它元素（rect 等）正常渲染、仅文字缺失；切 WebView 渲染模式后文字全部正常。
  //   → 这是 Skyline 的 SVG 实现限制（官方文档未记载），非小程序整体限制、非编译器问题。
  const isText = [...bad].some((t) => t === 'text' || t === 'tspan')
  const fix = isText
    ? '方案：① 文字移到 SVG 外的 <text> 组件叠加（推荐——原生渲染、可选中、字体可控）；② 文字轮廓化为 <path>（设计工具导出 SVG 时选 outline/convert to path）；③ 该页改用 WebView 渲染模式（renderer: webview——文字可渲染，但放弃 Skyline 特性）'
    : '方案：改用 <path> 展开或图片'
  const msg =
    `SVG 子标签 ${names} 在 Skyline 下不渲染（实测：Skyline 解码 SVG 成功但丢弃该元素；同一 SVG 切 WebView 后正常）` +
    `——Skyline 的 SVG 实现限制（官方文档未记载）。${fix}`
  ctx.warnings.push(msg)
  ctx.trace?.add('template/svg-p2-unsupported', {
    line: node.loc.start.line,
    before: `SVG 含 ${names}`,
    after: '（Skyline 丢弃文字元素——WebView 正常；根因已实证）',
  })
}

function serializeElement(node: ElementNode, ctx: SerializeContext): string {
  // ★2026-09-08 v-pre 诚实对齐：compiler-dom 解析阶段已把 v-pre 元素内容跳过编译（{{ }} 变 raw TEXT），v-pre 属性不在 props——
  //   用元素原始源码检测（node.loc.source 含 v-pre）。含 {{ }} 插值 → WXML 仍会插值（v-pre 跳过编译无法实现）→ 诚实警告；纯静态 → 等价（静默）
  if (/<[^>]*\bv-pre\b[^>]*>/.test(node.loc.source) && !ctx.disabled.has('directive/v-pre')) {
    const dyn = hasInterpolation(node)
    if (dyn) {
      ctx.warnings.push(`v-pre 元素含 {{ }} 插值——WXML 无 raw 模式（{{ }} 仍会被插值，v-pre 应跳过编译无法实现），已剥离；如需原样文本请用转义（vue-compat Batch A）`)
      ctx.trace?.add('directive/v-pre', { line: node.loc.start.line, before: 'v-pre（含插值）', after: '（剥离：WXML 无 raw 模式，诚实警告）' })
    } else {
      ctx.trace?.add('directive/v-pre', { line: node.loc.start.line, before: 'v-pre（纯静态）', after: '剥离（静态内容等价：无需跳过编译）' })
    }
  }
  // ★#496 柔性语义编译：<p-grid> 语义元素——仅页面（Skyline SelectorQuery 需页面 onReady；组件内 p-grid 回退运行时组件）
  // ★#505 M3 批 3：规则禁用须整体回退（template/script/gen-routes 三侧一致）——旧行为 template 照常语义编译但
  //   script 不注入默认档（disabled 只查了 script 侧）→ 产物 wxml 引用 {{pgridStyleN}} 永远 undefined = 半失效产物；
  //   现在禁用 → 回退运行时组件（产物保留 <p-grid> 标签，gen-routes 同步注册 usingComponents）
  if (SEMANTIC_COMPILE_TAGS.has(node.tag)) {
    if (ctx.disabled.has('fluid/semantic-grid')) {
      ctx.warnings.push(`规则 fluid/semantic-grid 已被禁用（rules.disabled）——<p-grid> 回退运行时组件（产物保留 <p-grid> 标签；页面需经 gen-routes 注册该组件，禁用即放弃 #496 编译器档位语义）`)
      ctx.trace?.add('fluid/semantic-grid', { line: node.loc.start.line, before: '<p-grid>（语义编译）', after: '<p-grid> 回退运行时组件（规则禁用）' })
    } else if (ctx.isPage) {
      const grid = tryParseSemanticGrid(node)
      if (grid) return serializeSemanticGrid(node, ctx, grid)
      ctx.warnings.push(`<p-grid> 的 min-col-width/gap 需为静态数值（动态 props 语义编译暂不支持 #496 MVP）——已回退运行时组件（仅 Web 可用）`)
      ctx.trace?.add('fluid/semantic-grid', { line: node.loc.start.line, before: '<p-grid 动态 props>', after: '回退运行时组件（#496 MVP 限制）' })
    } else {
      ctx.warnings.push(`组件模板内 <p-grid> 暂不走语义编译（#496c：SelectorQuery 需页面上下文）——回退运行时组件，请改为页面级或后续批次支持`)
    }
  }
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
  // ★2026-09-08 <teleport> → Skyline root-portal 对齐（官方：root-portal 使子树脱离页面、类似 fixed，用于弹窗/弹出层——
  //   正是弹层层叠/传送的正解）。<teleport>content</teleport> → <root-portal>content</root-portal>（脱离页面盖住一切）；
  //   to 属性 MP 无 target 选择器语义（root-portal 恒脱离页面 = fixed 等价）——警告说明忽略 to；@vue/compiler-dom 已
  //   把 teleport 当容器（tag=teleport），NATIVE_TAGS 已含 root-portal（原样透传）。
  if (node.tag === 'teleport' && !isTransition) {
    const child = node.children.map((c) => serializeNode(c, ctx)).join('\n')
    const toVal = node.props.find((p) => p.type === NodeTypes.ATTRIBUTE && (p as AttributeNode).name === 'to') as AttributeNode | undefined
    if (toVal?.value?.content) {
      ctx.warnings.push(
        `<teleport to="${toVal.value.content}"> 的 to 目标在小程序无对等（root-portal 恒脱离页面 = fixed 等价，无 target 选择器语义）——已忽略 to，子内容包进 <root-portal>（脱离页面层叠）`,
      )
    }
    ctx.trace?.add('template/teleport-root-portal', { line: node.loc.start.line, before: '<teleport>', after: '<root-portal>（脱离页面层叠：用于弹窗/弹出层——官方文档 root-portal 语义）' })
    return `<root-portal>\n${child}\n</root-portal>`
  }
  if ((node.tag === 'transition-group' || node.tag === 'suspense' || node.tag === 'keep-alive') && !isTransition) {
    const noPeerMsg = `<${node.tag}> 在小程序无对等组件（已原样输出，不生效）——缓存/多元素转场请移除或改用路由 routeType（vue-compat Batch A）`
    if (ctx.failFast) failFastThrow(ctx.filename, noPeerMsg)
    ctx.warnings.push(noPeerMsg)
    ctx.trace?.add('template/no-peer', { line: node.loc.start.line, before: `<${node.tag}>`, after: '（无对等，原样输出）' })
  }
  // ★2026-09 fluid-system 真机缺口：自定义组件子级插槽内容 <template #name> MP 接线——
  //   旧产物丢 slot 名并包在 <template>（WXML 不渲染内容）→ 整段不可见（侧边栏/容器全丢同源）。
  //   微信机制：具名插槽 → 内容须带 slot 属性（<view slot="name">）；默认插槽 → 解壳内联（微信默认插槽接受直接子节点）
  const slotDir = node.tag === 'template'
    ? node.props.find((p): p is DirectiveNode => p.type === NodeTypes.DIRECTIVE && p.name === 'slot')
    : undefined
  if (slotDir) {
    const arg = exprContent(slotDir.arg)
    const slotName = arg && arg !== 'default' ? arg : ''
    // 作用域插槽参数（#default="{ errors }"）——微信 slot 不向内容传参，反黑盒警告 + 按普通插槽渲染
    const scopeText = exprContent(slotDir.exp).trim()
    if (scopeText) {
      ctx.warnings.push(`作用域插槽 <template #${arg || 'default'}${scopeText ? `="${scopeText}"` : ''}> 的数据在 MP/Skyline 无对等机制（微信 slot 不向内容传参）——已按普通插槽渲染，${scopeText} 恒不可用（vue-compat-advance Batch 7 平台限制）；请改 props 传子 + 事件回调`)
      ctx.trace?.add('slot/scoped-template', { line: node.loc.start.line, before: `<template #${arg || 'default'}="${scopeText}">`, after: '（解壳按普通插槽渲染；作用域参数不可用）' })
    } else {
      ctx.trace?.add('slot/named-template', {
        line: node.loc.start.line,
        before: `<template #${slotName || 'default'}>`,
        after: slotName ? `<view slot="${slotName}">（微信 slot 机制：组件侧 <slot name> 对位）` : '解壳内联（微信默认插槽接受直接子节点）',
      })
    }
    const inner = node.children.map((c) => serializeNode(c, ctx)).join('\n')
    if (!slotName) return inner // 默认插槽：解壳内联
    const hasEl = node.children.some((c) => c.type === NodeTypes.ELEMENT)
    return hasEl ? `<view slot="${slotName}">\n${inner}\n</view>` : `<view slot="${slotName}">${inner}</view>`
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
  // ★16-progress-skyline-degrade：Skyline 官方不支持 progress（组件支持表"暂不考虑"）——
  //   小程序语义 <progress> 降级为自定义 view 进度条（双端一致 + Skyline 可用；rules.disabled 可关）
  if (tag === 'progress' && !ctx.disabled.has('component/progress-degrade')) {
    return serializeProgress(node, ctx)
  }
  // ★★2026-09-09 G-62 SVG→Skyline P0：<svg> 子树 lowering → <image> data-URI。
  //   地基实证（examples/pages/image-spike.vue 真机截图）：Skyline <image> 完整渲染 SVG base64 data-URI
  //   （path/stroke/circle 正确）——静态图标 80% 场景零改代码可用（canvas 路线被 node() 通道阻塞，见专项 §9）。
  //   仅静态子树 lowering；含动态绑定（v-bind/v-if/v-for/插值/事件）→ 返回 null 走下方诚实警告（P1 待做）。
  if (node.tag.toLowerCase() === 'svg' && !ctx.disabled.has('template/svg-to-image')) {
    const lowered = lowerSvgToImage(node)
    if (lowered) {
      const vb = lowered.viewBox
      const w = (() => {
        const m = vb.trim().split(/\s+/).map(Number)
        return m.length === 4 && m[2] > 0 ? m[2] : 24
      })()
      const h = (() => {
        const m = vb.trim().split(/\s+/).map(Number)
        return m.length === 4 && m[3] > 0 ? m[3] : 24
      })()
      ctx.trace?.add('template/svg-to-image', {
        line: node.loc.start.line,
        before: '<svg><path d fill/></svg>',
        after: `<image src="data:image/svg+xml;base64,…" />（P0 静态 SVG → data-URI，viewBox ${vb}）`,
      })
      // 尺寸：沿用 <svg> 上的 width/height 属性（若有），否则用 viewBox 比例 + 24px 基准
      const sizeAttr = (n: string): string | undefined => {
        const a = node.props.find((p) => p.type === NodeTypes.ATTRIBUTE && (p as { name: string }).name === n) as
          | { value?: { content: string } }
          | undefined
        return a?.value?.content
      }
      const wAttr = sizeAttr('width') ?? sizeAttr('size')
      const hAttr = sizeAttr('height') ?? sizeAttr('size')
      const style = wAttr
        ? `width:${/^\d+$/.test(wAttr) ? wAttr + 'px' : wAttr};${hAttr ? `height:${/^\d+$/.test(hAttr) ? hAttr + 'px' : hAttr};` : ''}`
        : `width:${w}px;height:${h}px;`
      // ★G-62 P2：实测不支持的 SVG 特性（use/symbol/text/tspan）诚实警告（Skyline image 渲染为空白）
      warnUnsupportedSvgFeatures(node, ctx)
      // ★2026-09-09 事件命中：图形带事件 → 加 id + touch 绑定 + 收集（真机实证 tap 无坐标、touchstart 有）
      // 规则 template/svg-hit 禁用 → 不生成命中绑定（与 script 侧同规则，避免半失效产物）
      if (lowered.hitShapes.length && !ctx.disabled.has('template/svg-hit')) {
        const imgId = `proteus-svg-hit-${ctx.svgHits.length + 1}`
        ctx.svgHits.push({ imageId: imgId, viewBox: lowered.viewBox, shapes: lowered.hitShapes })
        ctx.trace?.add('template/svg-hit', {
          line: node.loc.start.line,
          before: `<svg><circle @click="onX"/></svg>`,
          after: `<image id="${imgId}" bindtouchstart="proteusSvgHit1" />（touch 坐标 + 几何命中）`,
        })
        return `<image id="${imgId}" class="${ctx.scopeId ? `proteus-svg-${ctx.scopeId} ` : ''}" style="${style}" src="${lowered.dataUri}" mode="aspectFit" bindtouchstart="proteusSvgHit${ctx.svgHits.length}" />`
      }
      return `<image class="${ctx.scopeId ? `proteus-svg-${ctx.scopeId} ` : ''}" style="${style}" src="${lowered.dataUri}" mode="aspectFit" />`
    }
    // ★★2026-09-09 G-62 P1：动态 SVG → computed（运行时重生成 SVG 字符串 + <image src="{{x}}">）。
    //   绕开 canvas node() 阻塞（专项 §9）：微信逻辑层无 btoa，但 encodeURIComponent 可用，
    //   真机实证「运行时拼 SVG → computed → setData → Skyline 实时重渲染 + 响应式有效」（image-spike.vue）。
    //   复用既有 computed 链路（依赖追踪/init/写入补丁重算）——script 侧由 dynamicSvgs 生成。
    if (!ctx.disabled.has('template/svg-dynamic')) {
      const dynName = `proteusSvg${ctx.dynamicSvgs.length + 1}`
      const dyn = lowerSvgDynamic(node, dynName)
      if (dyn) {
        ctx.dynamicSvgs.push({ computedName: dyn.computedName, parts: dyn.parts, deps: [...dyn.deps], viewBox: dyn.viewBox })
        const sizeAttr = (n: string): string | undefined => {
          const a = node.props.find((p) => p.type === NodeTypes.ATTRIBUTE && (p as { name: string }).name === n) as
            | { value?: { content: string } }
            | undefined
          return a?.value?.content
        }
        const wAttr = sizeAttr('width')
        const hAttr = sizeAttr('height')
        const style = wAttr
          ? `width:${/^\d+$/.test(wAttr) ? wAttr + 'px' : wAttr};${hAttr ? `height:${/^\d+$/.test(hAttr) ? hAttr + 'px' : hAttr};` : ''}`
          : ''
        ctx.trace?.add('template/svg-dynamic', {
          line: node.loc.start.line,
          before: '<svg><path :d="d" :fill="c"/></svg>',
          after: `<image src="{{${dyn.computedName}}}" />（P1 动态 SVG → computed 重生成，deps: ${[...dyn.deps].join('/') || '无'}）`,
        })
        warnUnsupportedSvgFeatures(node, ctx)
        return `<image class="${ctx.scopeId ? `proteus-svg-${ctx.scopeId} ` : ''}"${style ? ` style="${style}"` : ''} src="{{${dyn.computedName}}}" mode="aspectFit" />`
      }
    }
  }
  // ★#505 G2 补：SVG 命名空间标签在小程序无对等组件（微信无 <svg>，Skia 矢量映射为后续批次）——
  //   旧行为静默当未注册自定义组件原样输出 → 产物无效标签（p-svg 真机不渲染实证）；反黑盒显式警告
  //   ★2026-09-09：静态 <svg> 已由上方 lowering 处理（P0）；此处兜底动态 SVG / 非 svg 的 SVG 子标签
  if (SVG_NAMESPACE_TAGS.has(node.tag.toLowerCase()) && !ctx.disabled.has('template/svg-no-peer')) {
    const svgMsg = `<${node.tag}> 为 SVG 矢量标签，在小程序无对等组件（微信无 <svg>）——已原样输出但不会渲染。完整 <svg> 子树可经 template/svg-to-image（静态）/ template/svg-dynamic（动态）lowering 为 <image> data-URI；此警告出现在独立 SVG 子标签（无 <svg> 父）或 lowering 不支持的形态（如 v-for）——见 docs/svg-skyline-alignment-plan/`
    if (ctx.failFast) failFastThrow(ctx.filename, svgMsg)
    ctx.warnings.push(svgMsg)
    ctx.trace?.add('template/svg-no-peer', { line: node.loc.start.line, before: `<${node.tag}>`, after: '（MP 无对等：SVG 标签不渲染）' })
  }
  // ★#505 M3 批 2：p-* 是框架保留前缀（src/components 语义组件 + p-grid 等语义编译标签——TAG_SEMANTIC_MAP 登记即合法）——
  //   未登记 = 拼写错误或未入库组件：旧行为静默按未注册自定义组件输出（gen-routes 不注册 → MP 整块不渲染、无语义链接）
  //   反黑盒显式警告（与 conformance render.semanticLink「p-* 语义空白」收紧同源——本规则把同源收紧带到主编译产物侧）；
  //   config tags 映射显式覆盖的 p-*（用户自定义逃生舱）不警告
  if (node.tag.startsWith('p-') && !TAG_SEMANTIC_MAP[node.tag] && !ctx.tagMap[node.tag] && !ctx.disabled.has('tag/unknown-p-star')) {
    ctx.warnings.push(
      `<${node.tag}> 以 p- 前缀命名但不在组件库语义登记表（TAG_SEMANTIC_MAP）——拼写错误或未入库组件？产物将按未注册自定义组件输出（MP 端不渲染、无语义链接）；请检查组件名或移除 p- 前缀`,
    )
    ctx.trace?.add('tag/unknown-p-star', { line: node.loc.start.line, before: `<${node.tag}>`, after: '（未登记 p-*：按未注册自定义组件输出——MP 不渲染）' })
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
  // ★2026-09-08 v-text 对齐：v-text="expr" → 元素内容覆盖为文本插值 {{ expr }}（Vue 语义：v-text 覆盖子节点，输出文本）
  let vTextExpr: string | undefined

  // scoped CSS（v0.3，★Skyline 兼容修复）：作用域 **class**（glass-easel 不支持属性选择器）
  //   ★仅计算、末尾统一发射（2026-08 真机实测修复：WXML 重复 class 属性只保留其一——独立 scope class 属性会丢掉用户 class，
  //   scoped 复合选择器 .a.data-v-xxx 失配 → 样式全丢）
  //   ★#505 M5：补 disabled 检查（旧：scopeId 存在即无条件 executeRule——禁用不生效 = 半接线；
  //   现禁用 → 模板类名不再后缀；须与 style/scoped-css 配对禁用保持 wxss 一致，配对警告见 transformTemplateToWxml）
  let scopeClass = ''
  if (ctx.scopeId && !ctx.disabled.has('template/scope-attr')) {
    const scopeCtx: RuleContext = { input: { tag: node.tag, scopeId: ctx.scopeId } }
    executeRule('template/scope-attr', scopeCtx)
    scopeClass = (scopeCtx.output as string | undefined) ?? ctx.scopeId
    ctx.trace?.add('template/scope-attr', { line: node.loc.start.line, before: `<${node.tag}>`, after: `<${node.tag} class="${scopeClass}">` })
  }
  // ★scoped 类名拼接后缀（2026-08 真机重构）：scopeClass 作为类名后缀（.box → .box-data-v-x 单类选择器），不再附加独立 scope class
  const scopeSuffix = scopeClass || ''
  // class 源缓冲：静态 class / :class 绑定（发射统一合并为单个 class 属性，见本函数末尾）
  let staticClass: string | undefined
  let bindingClass: string | undefined
  // ★G-22 柔性布局：static style 缓冲（静态 style 属性 + p-fluid 生成 clamp 合并发射）
  let staticStyle: string | undefined

  // ★#505 G1：预扫描本元素 v-for 项名（:key="item.id" 剥前缀用——微信 wx:key 语义 = item 的字段名，非路径）。
  //   仅同元素 v-for（最常见形态）；嵌套/外层引用因无作用域链保持原样（诚实边界：无法静态判定则警告）。
  const forDirective = node.props.find(
    (p) => p.type === NodeTypes.DIRECTIVE && p.name === 'for' && !ctx.disabled.has('directive/v-for'),
  )
  const forItemName = forDirective ? parseForExpr(exprContent((forDirective as DirectiveNode).exp)).item : undefined

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
      if (attr.name === 'class') {
        // 静态 class 缓冲（仅用户类名；语义基础类由末尾统一发射合并——避免重复）
        staticClass = attr.value ? escapeXml(attr.value.content) : ''
        continue
      }
      // ★G-22 柔性布局：静态 style 缓冲（与 p-fluid 生成声明合并发射）
      if (attr.name === 'style') {
        staticStyle = attr.value ? attr.value.content : ''
        continue
      }
      // ★G-22 柔性布局：p-fluid 指令 → 编译期 clamp 生成（设计稿/视口取自 fluidLayout 配置）
      // ★#505 M3 批 4：补 disabled 检查（fluid/p-fluid 已登记 #496 M3——旧行为不查 disabled = 规则声明可关但实际无法关）
      if (attr.name === 'p-fluid') {
        const expr = attr.value ? attr.value.content : ''
        if (ctx.disabled.has('fluid/p-fluid')) {
          ctx.warnings.push(`规则 fluid/p-fluid 已被禁用（rules.disabled）——p-fluid="${expr}" 不再生成流式样式（属性剥离；需流式请恢复规则或改静态 px/rem）`)
          ctx.trace?.add('fluid/p-fluid', { line: node.loc.start.line, before: `p-fluid="${expr}"`, after: '（规则禁用——剥离，不生成样式）' })
          continue
        }
        const groups = parseFluidExpr(expr)
        if (!groups.length) {
          // FLD003：p-fluid 须提供 prop(min, max) 区间——无法解析则剥离 + 告警，不生成样式
          ctx.warnings.push(`p-fluid="${expr}" 未解析出 prop(min, max) 组（FLD003：须提供 min/max 区间）——已剥离，未生成样式`)
        } else {
          const cfg = ctx.fluidLayout
          const designWidth = cfg?.designWidth ?? 375
          const viewport = { min: cfg?.viewport?.min ?? 320, max: cfg?.viewport?.max ?? 1440 }
          // ★#496 M3：MP 产物用 calc 线性（Skyline/WebView 共用 wxml——Skyline 无 clamp，WebView 支持 calc+vw；clamp 边界仅超界屏 ±1-2px）
          const decls = groups.map((g) => `${g.prop}: ${linearFluid(g.min, g.max, designWidth, viewport)}`).join('; ')
          staticStyle = staticStyle ? staticStyle + '; ' + decls : decls
          ctx.trace?.add('fluid/p-fluid', { line: node.loc.start.line, before: `p-fluid="${expr}"`, after: `style 追加 ${decls}` })
        }
        continue
      }
      // ★2026-09-08 useTemplateRef/模板 ref 承接：ref="x" → 注入 id="x"（this.selectComponent('#x') 需要）+ 收集 ref 名
      //   （script 侧 const b = useTemplateRef('x') → this.b = this.selectComponent('#x') 组件实例引用；页面对视区子组件也可）。
      //   注意：selectComponent 仅组件模式可靠（页面 query 组件需渲染树就绪）——非组件模式对原生标签 id 无害（选择器留窗口）
      if (attr.name === 'ref') {
        const refName = attr.value ? attr.value.content : ''
        if (refName && !ctx.disabled.has('template/template-ref')) {
          ctx.templateRefNames.add(refName)
          // 若元素无显式 id，注入 ref 名作 id（selectComponent 选择器；用户须保证 ref 唯一）
          const hasId = node.props.some((p) => p.type === NodeTypes.ATTRIBUTE && (p as AttributeNode).name === 'id')
          if (!hasId) attrs.push(`id="${escapeXml(refName)}"`)
          ctx.trace?.add('template/template-ref', { line: node.loc.start.line, before: `ref="${refName}"`, after: `id="${refName}" + 收集（script useTemplateRef('${refName}') → this.selectComponent('#${refName}') 组件实例引用）` })
        } else if (refName) {
          ctx.warnings.push(`模板 ref="${refName}" 被规则 template/template-ref 禁用——不注入 id/不收集（useTemplateRef 将拿不到实例）`)
        }
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
      case 'text':
        if (ctx.disabled.has('directive/v-text')) { ctx.warnings.push('规则 directive/v-text 已被禁用（rules.disabled），v-text 已忽略'); break }
        vTextExpr = exprContent(dir.exp)
        ctx.trace?.add('directive/v-text', { line: node.loc.start.line, before: `v-text="${exprContent(dir.exp)}"`, after: `元素内容 → {{ ${exprContent(dir.exp)} }}（v-text 覆盖子节点）` })
        break
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
          const handler = cleanHandler(exprContent(dir.exp), ctx.warnings, ctx.failFast, ctx.filename)
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
        // ★vue-compat Batch B + #505 迁执行层：内联表达式（count++ / fn(1) / x = 字面量）→ 包装方法，
        //   判定经规则 apply（event/inline-expression）；其余走 cleanHandler（警告原样）。
        //   禁用规则 → 不包装 → bindtap="x = !x" 原样输出（#500 缺陷形态 + 反黑盒警告——删规则即红）。
        const rawHandler = exprContent(dir.exp)
        let inline: { name: string; code: string } | null = null
        if (!isSelf && !isOnce && !ctx.disabled.has('event/inline-expression')) {
          const inlineCtx: RuleContext = { input: { exp: rawHandler } }
          executeRule('event/inline-expression', inlineCtx)
          inline = (inlineCtx.output as { name: string; code: string } | null | undefined) ?? null
        }
        let handler: string
        if (inline) {
          handler = inline.name
          if (!ctx.inlineHandlers.some((h) => h.name === inline.name)) ctx.inlineHandlers.push(inline)
          ctx.trace?.add('event/inline-expression', { line: node.loc.start.line, before: `@${exprContent(dir.arg)}="${rawHandler}"`, after: `${inline.name}（包装方法）` })
        } else {
          handler = cleanHandler(rawHandler, ctx.warnings, ctx.failFast, ctx.filename)
        }
        // 键位修饰符（@keyup.enter 等）：小程序无键盘事件对等，警告
        if (raw === 'keyup' || raw === 'keydown' || raw === 'keypress') {
          const keyMods = mods.filter((m) => !['stop', 'prevent', 'self', 'once'].includes(m))
          const keyMsg = `@${raw}${keyMods.length ? '.' + keyMods.join('.') : ''} 在小程序无对等键盘事件（input 键盘行为请用 @confirm），已原样输出`
          if (ctx.failFast) failFastThrow(ctx.filename, keyMsg)
          ctx.warnings.push(keyMsg)
        }
        // 自定义事件（非 EVENT_MAP，如组件 triggerEvent 事件）→ bind:/catch: 冒号形式（微信自定义组件事件标准）
        const isCustomEvent = !(raw in ctx.eventMap)
        const prefix = `${isCatch ? 'catch' : 'bind'}${isCustomEvent ? ':' : ''}`
        // ★#505 校准族：.self/.once 包装判定与命名经规则 apply（event/modifier-self-once）——
        //   简单方法名 + self/once → proteusSelf/Once<Cap>（script 生成包装方法）；复杂表达式 → null（原样）。
        //   禁用规则 → 不包装 → .self/.once 语义丢失（显式警告，删规则即红）。
        const selfOnceCtx: RuleContext = { input: { handler, isSelf, isOnce } }
        const wrapped = !ctx.disabled.has('event/modifier-self-once')
        if (wrapped) executeRule('event/modifier-self-once', selfOnceCtx)
        const wrapDecision = (selfOnceCtx.output as { kind: string; target: string; wrap: string } | null | undefined) ?? null
        if (wrapDecision) {
          if (isSelf) ctx.selfHandlers.add(wrapDecision.target)
          if (isOnce) ctx.onceHandlers.add(wrapDecision.target)
          attrs.push(`${prefix}${mapped}="${wrapDecision.wrap}"`)
        } else {
          if (!wrapped && (isSelf || isOnce)) {
            ctx.warnings.push(`规则 event/modifier-self-once 已被禁用（rules.disabled），.self/.once 语义已丢失（事件直接绑定 ${handler}，无目标限制/单次标记）`)
          }
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
          bindingClass = formatClassBinding(exp, ctx.warnings, scopeSuffix)
          ctx.trace?.add('directive/v-bind-class', { line: node.loc.start.line, before: `:class="${exp}"`, after: bindingClass })
        } else if (arg === 'style') {
          if (ctx.disabled.has('directive/v-bind-style')) break
          const styleOut = formatStyleBinding(exp)
          // ★#500 + #505 M2 试点：动态标识符绑定（非字面量对象/非模板拼接）→ 收集给 script 侧
          //   （同名 computed 派生对象自动序列化字符串）。判定经注册表规则 apply 分派（directive/v-bind-style）——
          //   删规则/禁用规则即不收集 → script 不注入 __proteusStyleString → 对象直进 setData 静默失效（删规则即红）。
          const styleCtx: RuleContext = { input: { exp } }
          executeRule('directive/v-bind-style', styleCtx)
          const styleDecision = styleCtx.output as { target?: string; derived?: boolean } | undefined
          if (styleDecision?.derived && styleDecision.target) ctx.styleBindings.add(styleDecision.target)
          attrs.push(`style="${styleOut}"`)
          ctx.trace?.add('directive/v-bind-style', { line: node.loc.start.line, before: `:style="${exp}"`, after: styleOut })
        } else if (arg === 'key') {
          if (ctx.disabled.has('directive/v-bind-key')) break
          // ★#505 G1（官方 wx:key 语义对齐——微信文档：wx:key 直接指定 item 的字段名字符串，禁止数据绑定；
          //   item 为字符串/数值时用 *this）。映射：
          //   :key="item.id"（forItemName 前缀）→ wx:key="id"（微信自动从 item 取 id 字段）
          //   :key="idx"/:key="id"（裸标识符）→ wx:key="idx"（既有形态；微信解释为 item.idx 字段）
          //   :key="item"（基础值数组，forItemName 本身）→ wx:key="*this"
          //   :key="*this" → wx:key="*this"；表达式（含运算/括号/{{}}）→ 警告忽略（不静默丢代码）
          const t = exp.trim()
          const isExpr = /[^\w$.]/.test(t) || /{{/.test(t) // 含非标识符字符 = 表达式（. 允许——多级路径走剥前缀逻辑）
          if (isExpr) {
            ctx.warnings.push(`:key="${exp}" 是表达式（含运算/括号/{{}}），wx:key 需静态字段名或 *this（微信规范：wx:key 直接指定 item 的字段名，禁用数据绑定）——已忽略`)
            ctx.trace?.add('directive/v-bind-key', { line: node.loc.start.line, before: `:key="${exp}"`, after: '（忽略：wx:key 仅静态字段名/*this）' })
          } else if (t === '*this') {
            attrs.push(`wx:key="*this"`)
            ctx.trace?.add('directive/v-bind-key', { line: node.loc.start.line, before: `:key="${exp}"`, after: 'wx:key="*this"' })
          } else if (forItemName && t === forItemName) {
            // :key="item"（基础值数组——项本身作 key）→ *this
            attrs.push(`wx:key="*this"`)
            ctx.trace?.add('directive/v-bind-key', { line: node.loc.start.line, before: `:key="${exp}"`, after: 'wx:key="*this"（for 项本身——基础值数组）' })
          } else if (forItemName && t.startsWith(`${forItemName}.`)) {
            // :key="item.id" → wx:key="id"（剥 v-for 项前缀，微信从 item 取字段）
            const field = t.slice(forItemName.length + 1)
            attrs.push(`wx:key="${field}"`)
            ctx.trace?.add('directive/v-bind-key', { line: node.loc.start.line, before: `:key="${exp}"`, after: `wx:key="${field}"（剥 v-for 项前缀——微信 wx:key = item 的字段名）` })
          } else if (/^[\w$]+(?:\.[\w$]+)*$/.test(t) && /^[\w$]+\.[\w$]+/.test(t)) {
            // 多级路径但前缀不是本元素 forItemName（可能引用外层 v-for 项）——无法静态判定，诚实警告原样
            ctx.warnings.push(`:key="${exp}" 引用非本元素 v-for 项（${forItemName ? `本元素项名 ${forItemName}` : '本元素无 v-for'}）——wx:key 需指定当前 item 的字段名，已忽略（嵌套 v-for 的 key 请引用最内层项）`)
            ctx.trace?.add('directive/v-bind-key', { line: node.loc.start.line, before: `:key="${exp}"`, after: '（忽略：嵌套/外层项引用无法静态映射为 wx:key 字段名）' })
          } else {
            // 裸标识符（idx / id——微信解释为 item 的该字段名）
            attrs.push(`wx:key="${t}"`)
            ctx.trace?.add('directive/v-bind-key', { line: node.loc.start.line, before: `:key="${exp}"`, after: `wx:key="${t}"` })
          }
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
        // ★#500 + #505 校准族：形态判定与契约命名经规则 apply（directive/v-model）——
        //   组件形态（非 input-like 且非原生标签）= prop + update:arg 事件（Vue 组件双向绑定核心语义；
        //   旧产物无脑 bindinput → p-modal v-model:visible 永不生效真机实证）；原生/input = value + bindinput。
        //   禁用规则 → 上面既有 disabled 分支已忽略（删规则即红）。
        const modelArg = exprContent(dir.arg)
        const vmodelCtx: RuleContext = {
          input: { model, arg: modelArg, isInputLike, isNativeTag: NATIVE_TAGS.has(tag) },
        }
        executeRule('directive/v-model', vmodelCtx)
        const vmodel = vmodelCtx.output as
          | { kind: 'component'; model: string; propName: string; updateHandler: string }
          | { kind: 'input'; model: string; inputHandler: string }
        if (vmodel.kind === 'component') {
          const { propName, updateHandler } = vmodel
          // ★G12 候选 B（2026-09-07 Skyline 真机实证）：事件名单段归一 update:{arg} → update-{arg}——
          //   glass-easel/微信编译链事件名 = 单段标识符（双冒号 bind:update:* 被丢弃 → Skyline 下 v-model
          //   关不掉/不回传：p-modal 遮罩关、p-switch、p-input 三实证）；arg 语义在 IR 保留（见 vModelComponentHandlers.arg）
          const updateEvent = propName ? `update-${propName}` : 'update-model' // propName = modelValue/visible/active…（含 kebab 变体）
          attrs.push(`${propName}="{{${model}}}"`)
          attrs.push(`bind:${updateEvent}="${updateHandler}"`)
          if (!ctx.vModelComponentHandlers.some((h) => h.name === updateHandler)) {
            // ★#505 M4：完整契约入旁路/IR——arg + propName 不再丢失（script 仅消费 name/model，产物等价）
            ctx.vModelComponentHandlers.push({ name: updateHandler, model, propName, ...(modelArg ? { arg: modelArg } : {}) })
          }
          ctx.trace?.add('directive/v-model', {
            line: node.loc.start.line,
            before: `v-model${modelArg ? ':' + modelArg : ''}="${model}"`,
            after: `${propName}="{{${model}}}" + bind:${updateEvent}="${updateHandler}"（组件 prop + 单段事件回写——G12 候选 B）`,
          })
          break
        }
        if (isInputLike) attrs.push(`value="{{${model}}}"`)
        // 方法名不用 __ 前缀（微信保留前缀，真机绑定可能失效）
        attrs.push(`bindinput="${vmodel.inputHandler}"`)
        ctx.trace?.add('directive/v-model', { line: node.loc.start.line, before: `v-model="${model}"`, after: `bindinput="${vmodel.inputHandler}"` })
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
        // ★#500 复合表达式加括号：!a || b 语义——旧产物 (!a)||b → p-sidebar nav 恒可见真机根因；裸标识符保持无括号
        const showExpr = exprContent(dir.exp)
        const showNeg = /^[\w$.]+$/.test(showExpr.trim()) ? `!${showExpr.trim()}` : `!(${showExpr})`
        attrs.push(`hidden="{{${showNeg}}}"`)
        ctx.trace?.add('directive/v-show', { line: node.loc.start.line, before: `v-show="${showExpr}"`, after: `hidden="{{${showNeg}}}"` })
        break
      default:
        // ★Batch A（vue-compat）：自定义指令（v-focus 等）小程序无对等——显式警告（反黑盒，不再静默剥离）
        if (dir.name === 'slot' || dir.name === 'cloak' || dir.name === 'text') {
          break // v-slot/v-text/v-cloak：MVP 忽略（v-text 已由 case 'text' 覆盖内容）
        }
        // ★2026-09-08 v-once / v-pre 诚实对齐：元素无插值（纯静态）→ 剥离无警告（语义等价；静态内容天然只渲染一次）；含插值 → 诚实 warning（MP 无惰性冻结/raw 模式）
        if (dir.name === 'once' || dir.name === 'pre') {
          const dyn = hasInterpolation(node)
          if (dyn) {
            ctx.warnings.push(
              dir.name === 'once'
                ? `v-once 元素含 {{ }} 插值——MP 数据驱动无「渲染一次」惰性（无对等），已剥离；静态内容请去掉插值（vue-compat Batch A）`
                : `v-pre 元素含 {{ }} 插值——WXML 无 raw 模式（{{ }} 仍会被插值，v-pre 应跳过编译无法实现），已剥离；如需原样文本请用转义（vue-compat Batch A）`,
            )
            ctx.trace?.add(dir.name === 'once' ? 'directive/v-once' : 'directive/v-pre', { line: node.loc.start.line, before: `v-${dir.name}（含插值）`, after: '（剥离：MP 无对等，诚实警告）' })
          } else {
            ctx.trace?.add(dir.name === 'once' ? 'directive/v-once' : 'directive/v-pre', { line: node.loc.start.line, before: `v-${dir.name}（纯静态）`, after: '剥离（静态内容语义等价：只渲染一次/不需编译）' })
          }
          break
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
  // ★vue-compat-advance Batch 2/5：<transition> 子元素动画 class（进入动画由重建自动播放；离开由 __tl{i} 插值切换）
  let transitionAnimCls = ''
  let transitionLeaveExpr = ''
  if (ctx.transitionClassName) {
    transitionAnimCls = ctx.transitionClassName
    ctx.transitionClassName = undefined
    const tctx = ctx.transitionCtx
    ctx.transitionCtx = undefined // 首个元素消费后清空（多子元素场景后续元素不受影响）
    if (tctx && tctx.ref !== undefined) {
      transitionLeaveExpr = `{{__tl${tctx.index} ? '${suffixClassName(`${transitionAnimCls}-leave`, scopeSuffix)}' : ''}}`
    }
  }
  // ★统一 class 发射（★2026-08 真机重构）：scope 后缀化各类名（.box → .box-data-v-x 单一类，Skyline ✓）——
  //   不再附加独立 scope class（复合选择器 .a.data-v-x 在 Skyline 不匹配，真机实测 p-button 自身样式失效）
  const suffix = (v: string): string => (scopeSuffix ? suffixClassValue(v, scopeSuffix) : v)
  // ★layout/auto-flex-row（2026-08 用户决策）：Skyline 引擎不支持 inline 布局（text 天生 block 占满一行）——
  //   容器**恰好** 1 个 text + **恰好** 1 个行内控件（switch/slider/icon/image/button 等）→ 自动 flex row（双端一致：行内排布唯一路径）
  //   ★保守规则：多 text（label+描述+按钮）或多控件（纵向列表容器）不触发——避免误伤
  let autoFlexRow = false
  if (!ctx.disabled.has('layout/auto-flex-row')) {
    const childTags = node.children
      .filter((c) => c.type === NodeTypes.ELEMENT)
      .map((c) => (ctx.tagMap[(c as ElementNode).tag] ?? kebabCase((c as ElementNode).tag)))
    const controls = childTags.filter((t) => INLINE_CONTROL_TAGS.has(t))
    const textCount = childTags.filter((t) => t === 'text').length
    autoFlexRow = controls.length === 1 && textCount === 1
    if (autoFlexRow) {
      ctx.trace?.add('layout/auto-flex-row', {
        line: node.loc.start.line,
        before: `<${node.tag}>（1 text + 1 行内控件）`,
        after: `自动附加 proteus-flex-row（display:flex;row;align-items:center——Skyline 无 inline，行内排布必须 flex row）`,
      })
    }
  }
  const classStatic = [transitionAnimCls, autoFlexRow ? 'proteus-flex-row' : '', effectiveBaseClass, staticClass].filter((c): c is string => Boolean(c)).map(suffix)
  const classInterp = [bindingClass, transitionLeaveExpr].filter((c): c is string => Boolean(c))
  // ★组件根节点（组件模式首元素）：接收外部 class 透传（root-class 属性 → rootClass property → 根节点 {{rootClass}}）
  if (ctx.isComponentRoot) classInterp.push('{{rootClass}}')
  // ★自定义组件标签（p-view/counter 等非原生标签）：class 全部改发 root-class 透传——
  //   微信页面 wxss 无法可靠作用于组件 host 节点（真机实测：p-view 外层容器 box 样式不生效，即使 styleIsolation: apply-shared）——
  //   Vue 的 class 继承语义需编译期等价：组件标签 class → root-class 属性 → 组件 properties.rootClass → 组件根节点绑定 {{rootClass}}
  const isComponentTag = !NATIVE_TAGS.has(tag)
  const rootClassEnabled = !ctx.disabled.has('component/root-class')
  if (classStatic.length || classInterp.length) {
    const clsValue = `${classStatic.join(' ')}${classInterp.length ? `${classStatic.length ? ' ' : ''}${classInterp.join(' ')}` : ''}`
    // 规则禁用时回退普通 class（组件标签 class 留在组件节点，不做透传）
    attrs.push(isComponentTag && rootClassEnabled ? `root-class="${clsValue}"` : `class="${clsValue}"`)
    if (isComponentTag && rootClassEnabled) {
      ctx.trace?.add('component/root-class', { line: node.loc.start.line, before: `<${node.tag} class="${clsValue}">`, after: `<${node.tag} root-class="${clsValue}">` })
    }
  }
  // ★G-22 柔性布局：static style 发射（用户静态 style + p-fluid 生成 clamp 合并）
  if (staticStyle) attrs.push(`style="${escapeXml(staticStyle)}"`)
  const attrStr = attrs.length ? ` ${attrs.join(' ')}` : ''
  // 反黑盒：注入源码行号注释（默认关闭，dev 调试开启）
  const lineNote = ctx.annotateLines ? `<!-- @${node.loc.start.line} ${node.tag} -->\n` : ''
  if (lineNote && !ctx.lineNoteTraced) {
    ctx.lineNoteTraced = true
    ctx.trace?.add('annotation/line-note', { line: node.loc.start.line, before: `<${node.tag}>`, after: `<!-- @${node.loc.start.line} ${node.tag} -->` })
  }
  // ★2026-09-08 v-text 对齐：内容覆盖为文本插值（v-text 覆盖子节点，输出 {{ expr }}）
  if (vTextExpr !== undefined) {
    return `${lineNote}<${tag}${attrStr}>{{ ${vTextExpr} }}</${tag}>`
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
    templateRefs: new Set<string>(),
    // ★#500 :style 动态标识符绑定收集
    styleBindings: new Set<string>(),
    // ★2026-09-09 G-62 事件命中：带事件的静态 SVG 图形表
    svgHits: [],
    // ★2026-09-09 G-62 P1：动态 SVG 收集
    dynamicSvgs: [],
    // ★2026-09-08 useTemplateRef/模板 ref 承接（ref="x" → id + 收集）
    templateRefNames: new Set<string>(),
    vModelComponentHandlers: [],
    // ★#496 柔性语义编译：p-grid 收集
    semanticGrids: [],
    isPage: opts.isComponent !== true,
    // ★G-22 柔性布局：p-fluid 编译期 clamp 生成参数
    fluidLayout: opts.fluidLayout,
  }
  const root = domParse(source, { onError: () => undefined })
  // ★组件模式：顶层第一个元素为组件根节点（class 追加 {{rootClass}}，接收外部 root-class 透传）
  const isComp = opts.isComponent === true
  // ★15-page-scroll-container：页面模式自动包滚动容器（Skyline 页面本身不滚动，滚动必须 scroll-view）——
  //   顶层已是 scroll-view/p-scroll-view 根时不重复包装（用户显式滚动容器场景）；开关 autoScrollContainer 默认 true
  const autoScroll = opts.autoScrollContainer !== false && !isComp
  const topTags = root.children.filter((c) => c.type === NodeTypes.ELEMENT).map((c) => (c as ElementNode).tag)
  const alreadyScroll = topTags.length === 1 && (topTags[0] === 'scroll-view' || topTags[0] === 'p-scroll-view')
  let firstEl = isComp
  const inner = root.children
    .map((c) => {
      if (firstEl && c.type === NodeTypes.ELEMENT) {
        firstEl = false
        return serializeNode(c, { ...ctx, isComponentRoot: true })
      }
      return serializeNode(c, ctx)
    })
    .join('\n')
  let wxml = inner
  if (autoScroll && !alreadyScroll) {
    // ★15-page-scroll-container：页面滚动 API 桥接（批次2）——声明 onPageScroll/onReachBottom 等时
    //   自动包装 scroll-view 绑定对应事件（页面本身不滚动，页面级钩子靠 scroll-view 事件触发）
    const hooks = opts.pageScrollHooks ?? {}
    const bindAttrs: string[] = ['scroll-y', 'class="proteus-page-scroll"']
    if (hooks.hasOnPageScroll) bindAttrs.push('bindscroll="proteusPageScroll"')
    if (hooks.hasOnReachBottom) bindAttrs.push('bindscrolltolower="proteusReachBottom"')
    if (hooks.hasOnPullDownRefresh) {
      // ★批次3：refresher 受控结束（bindrefresherrefresh → proteusPullDownRefresh 置 false 收回）
      bindAttrs.push('refresher-enabled="{{true}}" refresher-triggered="{{__proteusRefreshing}}" bindrefresherrefresh="proteusPullDownRefresh"')
    }
    if (hooks.hasPageScrollTo) {
      // ★批次3：wx.pageScrollTo 运行时桥接（scroll-top 受控滚动；scroll-with-animation 平滑）
      bindAttrs.push('scroll-top="{{__proteusPageScrollTop}}" scroll-with-animation')
    }
    // 高度由 compileVueSfc 注入 .proteus-page-scroll（100vh，scoped 转换后拼接，不参与后缀）
    wxml = `<scroll-view ${bindAttrs.join(' ')}>\n${inner}\n</scroll-view>`
  } else if (!isComp && (opts.pageScrollHooks?.hasOnPageScroll || opts.pageScrollHooks?.hasOnReachBottom)) {
    // 歧义警告（反黑盒）：手动写 scroll-view 又声明页面滚动钩子——滚动源歧义
    ctx.warnings.push(
      '歧义警告：页面声明 onPageScroll/onReachBottom 且顶层是 scroll-view（用户显式滚动容器）——页面级滚动钩子不会被 scroll-view 触发，请用 bindscroll/bindscrolltolower 或交由自动包装（15-page-scroll-container）',
    )
  }
  // ★#505 M5：template/scope-attr 禁用配对警告（模板类名不再后缀 → wxss 若仍 scoped（style/scoped-css 未禁用）
  //   选择器带后缀 → 失配样式全丢——两相规则须配对禁用/启用；仅提示一次）
  if (opts.scopeId && ctx.disabled.has('template/scope-attr') && !ctx.disabled.has('style/scoped-css')) {
    ctx.warnings.push('规则 template/scope-attr 已被禁用但 style/scoped-css 仍启用——模板类名不再后缀而 wxss 选择器仍带后缀（scoped 样式失配）；请一并禁用 style/scoped-css 或恢复 template/scope-attr')
  }
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
    templateRefs: [...ctx.templateRefs],
    templateRefNames: [...ctx.templateRefNames],
    // ★#500 :style 动态标识符绑定（script 侧同名 computed 派生值自动序列化）
    styleBindings: [...ctx.styleBindings],
    // ★2026-09-09 G-62 事件命中：带事件的静态 SVG 图形表
    svgHits: ctx.svgHits,
    // ★2026-09-09 G-62 P1：动态 SVG（script 侧生成 computed）
    dynamicSvgs: ctx.dynamicSvgs,
    // ★#500 自定义组件 v-model 回写处理器
    vModelComponentHandlers: ctx.vModelComponentHandlers,
    semanticGrids: ctx.semanticGrids,
    // ★15-page-scroll-container：已自动包滚动容器（compileVueSfc 据此注入高度样式）
    pageScrollWrapped: autoScroll && !alreadyScroll,
    warnings: ctx.warnings,
  }
}
