// packages/compiler/src/vapor/template.ts
// ★★V4 遗留项收官：**LayoutTemplate —— 模板 → 初始节点树**（方案 §4.1 的落地形态）
//
// 【本模块补的是什么链（本仓实测的缺口）】
//   此前 V3 的设备验证用**手写节点数组**（`largeNodes` 里 id/parentId/style 一行行写死），
//   编译器只产出订阅表（"哪个槽位写哪个节点"）。⇒ 「编译器 → IR → 自绘」这条链
//   **从未跑过**——节点树本身从没由 SFC 生成过。
//   本模块产出**静态结构**（节点 + 静态样式 + 文本占位 + v-for 行模板），
//   运行时（`slot-runtime` 的 `instantiateTemplate`）按数据把它实例化成引擎就绪的树。
//
// 【★★id 约定（必须与 build.ts 完全同源）】节点 id = **模板序 DFS 中每个 ELEMENT 的序号**
//   （`deps.ts` 的 `nextElementIndex`，pre-order，见其注释"每个元素都占一个序号"）。
//   订阅表里 `SlotSubscription.nodeId` 用的就是这套编号 ⇒ 两份产物必须逐位一致，
//   否则指令会写到**别的节点**上（症状伪装成几何错，本仓已踩过一次）。
//
// 【诚实边界（本版刻意不支持，遇到即报诊断）】
//   · 嵌套 v-for（内层行随外层行展开，需递归实例化——本版只支持单层）
//   · 元素子节点是「文本 + 插值混合」（`<p>a{{x}}b</p>`）⇒ 需拆分文本节点，本版拒绝
//   · 动态 `:style` 对象（运行期多键展开）⇒ 由订阅表以 SET_STYLE 逐键下发，模板不解析
//   · 组件标签（`<MyComp>`）⇒ 组件边界强制 L0（方案坑位 #4），不进模板
import { parse as sfcParse, type SFCDescriptor } from '@vue/compiler-sfc'
import { parse as domParse } from '@vue/compiler-dom'
import type { VaporDiagnostic } from './build'
import type { VueCompatDeps } from './sources'
import type { LayoutNode, LayoutTemplate, ListTemplate } from '@proteus-vue/slot-runtime'

// ★类型定义在**运行时契约包**（slot-runtime/layout-template.ts）——编译器只是产出方之一，
//   消费方定义的形状才是唯一契约（与 SubscriptionTable 同一处置）。
//   这里 re-export 便于 `proteus explain` 等工具从编译器侧一并取用。
export type { LayoutTemplate, LayoutNode, ListTemplate } from '@proteus-vue/slot-runtime'

/** 静态样式里**引擎认的**字段（其余（如 paint.*）由宿主绘制读，不进核心） */
const LAYOUT_FIELDS = new Set([
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'margin', 'padding', 'flexDirection', 'justifyContent', 'alignItems', 'alignSelf',
  'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'display', 'position', 'top', 'left', 'overflow',
])
/** 绘制字段（宿主自绘读这些键；模板照样要带上，否则挂载后无底色/无字色） */
const PAINT_FIELDS = new Set(['backgroundColor', 'color', 'fontSize', 'borderRadius', 'borderColor', 'borderWidth', 'opacity'])

/**
 * ★★**结构化绘制声明**（2026-10-01 · 绘制通道补齐）——`style="{...}"` 装不下的那些通道，
 * 用**属性**声明（与 CSS 语义同名，kebab 形式）：
 *   · `fill-gradient='{"kind":"linear","angle":90,"stops":[…] }'`（JSON 串；也接受 `fill-gradient-to`）
 *   · `clip-path='{"kind":"inset","params":[0,0,0.5,0]}'`
 *   · `glow='{"color":"#fff6d8","radius":60,"alpha":0.5}'`
 *   · `mask='{"kind":"linear","angle":180,"softness":0.5,"progress":0}'`
 *   · `svg-path='{"d":"M0 0 L10 10","stroke":"#333","strokeWidth":3}'`（描边路径，内核解析 segs）
 *
 * 【为什么用 JSON 串而不是拆成多个属性】这些规格是**嵌套结构**（色标数组 / 16 个裁剪参数 /
 *   五元 mask 规格）——拆成扁平属性会把"一份声明"打散成十几个键，且无法表达数组。
 *   JSON 串是**编译期可校验**的最小形态（解析失败 ⇒ 诊断，不静默丢）。
 */
const PAINT_DECL_ATTRS = new Set(['fill-gradient', 'fill-gradient-to', 'clip-path', 'glow', 'mask', 'svg-path', 'svg-path-to'])

/**
 * ★★★**未支持特性的「可见化」探测**（2026-10-03 · P0 能力清单批次）。
 *
 * 【为什么必须做（本仓实测抓出的**静默风险 12 项**）】能力清单调研发现：
 *   `v-html` / `v-text` / `v-memo` / `@[ev]` / `:[k]` / `Teleport` / `KeepAlive` /
 *   `Transition` / `Suspense` / `<component :is>` / 自定义指令 —— 这些**既无实现也无诊断**
 *   ⇒ 产物里"什么都不发生"，而开发者以为生效（**页面看起来对、功能是空的**）。
 *   ★本仓纪律：**静默失败最致命**。
 *   ⇒ 本批**不实现能力**，只让"未支持"在编译期**可见**（带修法）——成本最低、收益最高。
 *
 * 【与既有诊断的关系】既有诊断已覆盖：嵌套 v-for / 混合文本 / 事件修饰符 / 多语句 handler /
 *   表达式白名单。本表补的是**之前完全没被检查**的那一批。
 */
const UNSUPPORTED_DIRECTIVES: Record<string, string> = {
  html: 'v-html 未支持（富文本渲染通道待建）——请改用文本 + 样式，或保留 Vue 渲染路径（L0）',
  text: 'v-text 未支持——请改用插值 `{{ }}`（文本槽位已支持）',
  memo: 'v-memo 未支持（依赖摘要跳过更新的语义待建）——去掉它可正常更新（仅少一层优化）',
  cloak: 'v-cloak 未支持（App 端无 CSS 首帧闪烁语义）——可安全移除',
  pre: 'v-pre 未支持（跳过编译的语义待建）——请手动改写为静态内容',
}
/** 未支持的内置组件（官方有语义，我方当普通容器 ⇒ 语义静默丢失） */
const UNSUPPORTED_BUILTINS: Record<string, string> = {
  Teleport: 'Teleport 未支持（多渲染面传送待建）——当前按普通容器渲染（内容在**原位置**，非目标容器）',
  KeepAlive: 'KeepAlive 未支持（组件缓存待建；App 端路由保活已有 app-stack 的 keep-alive 档可复用）',
  Transition: 'Transition 未支持（转场语义待建；内核动画 MA0-RT 能力已具备，缺编译期桥接）',
  TransitionGroup: 'TransitionGroup 未支持（同 Transition；且需列表差异动画）',
  Suspense: 'Suspense 未支持（异步边界待建）',
  Component: '动态组件 `<component :is>` 未支持（需运行时组件解析）',
  component: '动态组件 `<component :is>` 未支持（需运行时组件解析）',
}

/**
 * ★★**解析绘制声明属性**（`fill-gradient` / `clip-path` / `glow` / `mask` / `svg-path`…）——
 * **唯一实现**：`buildLayoutTemplate` 的模板扫描与 A/B 对照的 Vue 路径改写**共用本函数**
 * （本仓纪律：同一语义一处实现；两处各写一份 ⇒ 迟早分叉）。
 *
 * @returns `{ok:true, key, value}` 或 `{ok:false, hint}`（hint 为修法，调用方自行诊断）
 */
export function parsePaintDeclAttr(
  name: string,
  raw: string,
): { ok: true; key: string; value: unknown } | { ok: false; hint: string } {
  const field = PAINT_DECL_KEY[name]
  if (!field) return { ok: false, hint: `\`${name}\` 不是绘制声明属性` }
  try {
    const parsed = JSON.parse(raw) as unknown
    return {
      ok: true,
      key: field,
      value: field.startsWith('svgPath') && typeof parsed === 'string' ? { d: parsed } : parsed,
    }
  } catch {
    // ★纯字符串简写（只有 svgPath 的 `d` 有这个语义——`svg-path="M0 0 L10 10"`）
    if (field.startsWith('svgPath')) return { ok: true, key: field, value: { d: raw } }
    return { ok: false, hint: '例：fill-gradient=\'{"kind":"linear","angle":90,"stops":[…]}\'' }
  }
}

/** 该属性名是否是绘制声明属性（A/B 的 Vue 路径改写用同一判据） */
export function isPaintDeclAttr(name: string): boolean {
  return PAINT_DECL_ATTRS.has(name)
}

/** kebab 属性名 → 引擎字段名 */
const PAINT_DECL_KEY: Record<string, string> = {
  'fill-gradient': 'fillGradient',
  'fill-gradient-to': 'fillGradientTo',
  'clip-path': 'clipPath',
  glow: 'glow',
  mask: 'mask',
  'svg-path': 'svgPath',
  'svg-path-to': 'svgPathTo',
}
/** 四边缩写属性（`margin-left` ⇒ `margin.left`） */
const EDGE_FIELDS = new Set(['margin', 'padding'])

const kebabToCamel = (s: string): string => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

/**
 * 解析 `style="a: b; c: d"` 静态样式串 → 引擎字段
 *
 * 【为什么支持字符串而不只支持 `:style="{}"`（模板常见写法）】SFC 里静态样式几乎都写成
 *   `style="height: 56px; ..."`；不支持它等于"模板里的样式全部丢失且无提示"。
 *   本函数对**认不出的键/值**产出诊断（不静默吞——本仓纪律）。
 */
export function parseStaticStyle(
  css: string,
  pushDiag: (msg: string, hint?: string) => void,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const part of css.split(';')) {
    const t = part.trim()
    if (!t) continue
    const idx = t.indexOf(':')
    if (idx < 0) continue
    const rawKey = t.slice(0, idx).trim()
    const rawVal = t.slice(idx + 1).trim()
    if (!rawKey || !rawVal) continue
    const key = kebabToCamel(rawKey)
    // 四边：`margin-bottom` / `padding-left` …
    const edge = key.match(/^(margin|padding)(Top|Right|Bottom|Left)$/)
    if (edge) {
      const f = edge[1]!
      const side = edge[2]!.toLowerCase()
      const num = numOf(rawVal)
      if (num === undefined) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 不是纯数值（本版只支持 px/数字）`); continue }
      const cur = (out[f] as Record<string, number> | undefined) ?? {}
      cur[side] = num
      out[f] = cur
      continue
    }
    if (EDGE_FIELDS.has(key)) {
      const num = numOf(rawVal)
      if (num === undefined) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 不是纯数值`); continue }
      out[key] = { top: num, right: num, bottom: num, left: num }
      continue
    }
    // ★★`box-sizing`（2026-10-02）：**Web/MP 由 CSS 引擎读**（百分比宽度 + 横向 padding 要
    //   正确收进盒内，必须显式 border-box——各端默认值不同，显式声明才跨端一致）；
    //   App 两内核**恒为 border-box**（taffy `BoxSizing::BorderBox` / TS 核心「宽高含 padding」）
    //   ⇒ 该键进产物后对端上是无副作用的忠实记录（Rust serde 忽略未知键、Android 白名单不收）。
    if (key === 'boxSizing') {
      out[key] = rawVal
      continue
    }
    if (LAYOUT_FIELDS.has(key)) {
      if (key === 'flexDirection' || key === 'justifyContent' || key === 'alignItems' || key === 'alignSelf' || key === 'position' || key === 'display' || key === 'overflow') {
        out[key] = rawVal
        continue
      }
      // ★★百分比宽高 → **比例字段**（2026-10-02：单位模型在模板产物里缺的一环）
      //
      // 【为什么必须有（实测抓出的跨端形态差）】`width: 100%` 是"内容随屏宽、左右留白恒定"
      //   的标准写法；本版此前对百分比**直接丢弃 + 诊断**（"只支持 px/数字"）⇒ 同一份 SFC：
      //   Web/MP 走 CSS 引擎正常流式，到了 iOS/Android 的 Vapor 链就**静默变成无宽度**
      //   ——同一份源码两端形态不同，正是多端一致性要消灭的那类差异。
      // 【为什么映射为 ratio 而不是数值】百分比不是长度（没有密度可乘）——内核原生支持
      //   `widthRatio`（Rust `width_ratio` → taffy `percent()`；TS 核心 `widthRatio`），
      //   基准 = 父**内容盒**（内核注释已证）。宿主物理化白名单（LEN_SCALARS）**不含**比例键
      //   ⇒ 与「长度 × 密度、比例不动」的换算纪律天然一致。
      if (key === 'width' || key === 'height') {
        const pct = /^(\d+(?:\.\d+)?)%$/.exec(rawVal)
        if (pct) {
          out[key === 'width' ? 'widthRatio' : 'heightRatio'] = Number(pct[1]) / 100
          continue
        }
      }
      const num = numOf(rawVal)
      if (num === undefined) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 不是纯数值（支持 px/数字/百分比宽高）`); continue }
      out[key] = num
      continue
    }
    if (PAINT_FIELDS.has(key)) {
      if (key === 'backgroundColor' || key === 'color' || key === 'borderColor') {
        out[key] = rawVal
      } else {
        const num = numOf(rawVal)
        if (num === undefined) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 不是纯数值`); continue }
        out[key] = num
      }
      continue
    }
    // 认不出的键：诊断（可能是指令/伪类等不需要的键——故用 hint 说明而非 error）
    pushDiag(`style 里 \`${rawKey}\` 不在引擎字段表内（已忽略）`, '引擎字段见 packages/compiler/src/vapor/template.ts 的 LAYOUT_FIELDS/PAINT_FIELDS')
  }
  return out
}

/** `56px` / `56` / `0.5` → 数值；`50%` / `auto` → undefined（百分比**宽高**在调用处另行映射为 widthRatio/heightRatio；其余属性的百分比仍不支持，见诊断） */
function numOf(v: string): number | undefined {
  const t = v.trim().replace(/px$/i, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/**
 * 主入口：SFC 源码 → LayoutTemplate（静态结构）
 *
 * @param compat 可注入的 SFC/DOM 解析器（与 `buildVaporSubscriptions` 同一注入面，供 Vue 多版本兼容测试）
 */
export interface LayoutTemplateResult {
  /** 产物（契约形状；序列化即用——诊断不混进产物） */
  template: LayoutTemplate
  diagnostics: VaporDiagnostic[]
  ok: boolean
}

export function buildLayoutTemplate(
  source: string,
  filename = 'anonymous.vue',
  compat?: Pick<VueCompatDeps, 'sfcParse' | 'domParse'>,
): LayoutTemplateResult {
  const diagnostics: VaporDiagnostic[] = []
  const nodes: LayoutNode[] = []
  const lists: ListTemplate[] = []
  const roots: number[] = []
  const diag = (message: string, hint?: string, code = 'VAPOR_TEMPLATE_UNSUPPORTED'): void => {
    diagnostics.push({ severity: 'warn', code, message, hint })
  }

  const vueParse = compat?.sfcParse ?? sfcParse
  const dom = compat?.domParse ?? domParse
  let desc: SFCDescriptor
  try {
    desc = vueParse(source, { filename }).descriptor
  } catch (e) {
    diagnostics.push({
      severity: 'error',
      code: 'VAPOR_TEMPLATE_SFC_PARSE_FAILED',
      message: `SFC 解析失败：${String((e as Error)?.message ?? e)}`,
      hint: '模板产物不可用（调用方应退回标准 Vue 渲染路径）',
    })
    return { template: { nodes: [], lists: [], roots: [], ok: false }, diagnostics, ok: false }
  }
  if (!desc.template) {
    diagnostics.push({
      severity: 'error', code: 'VAPOR_TEMPLATE_NO_TEMPLATE',
      message: '该 SFC 没有 <template> 块', hint: '纯逻辑组件（无渲染）不需要模板产物',
    })
    return { template: { nodes: [], lists: [], roots: [], ok: false }, diagnostics, ok: false }
  }
  const ast = dom(desc.template.content, { comments: false }) as unknown as { children: unknown[] }

  // ★与 deps.ts 完全同源的两套计数器（见文件头「id 约定」）
  let nextElementIndex = 0
  let nextListId = 0
  /** 当前所处的 v-for 行子树收集器（用于把行内节点归到该列表的 subtreeIds） */
  let rowCollector: { listId: number; ids: number[] } | null = null
  /** 当前行模板的 listId 栈（嵌套检测用） */
  const activeListStack: number[] = []

  type Node = {
    type: number
    tag?: string
    props?: Array<{
      type: number
      name: string
      arg?: { content?: string }
      exp?: { content?: string }
      value?: { content?: string }
    }>
    children?: unknown[]
  }

  const walk = (children: unknown[], parentId: number | null): void => {
    for (const raw of children) {
      const n = raw as Node
      if (n.type !== 1 /* ELEMENT */) {
        // 文本/插值节点在**父元素**上处理（本函数只在元素遍历里被调用，见下方 children 过滤）
        continue
      }
      const tag = n.tag ?? ''
      const id = nextElementIndex++

      // ── props 扫描（与 deps.ts 同序：先 :key / v-for，再其余）──
      let forCode: string | undefined
      for (const p of n.props ?? []) {
        if (p.type === 7 /* DIRECTIVE */ && p.name === 'for' && p.exp?.content) forCode = p.exp.content.trim()
      }
      const subChildren = (n.children ?? []) as unknown[]
      const elementChildren = subChildren.filter((c) => (c as Node).type === 1)
      const textChildren = subChildren.filter((c) => {
        const t = (c as Node).type
        return t === 2 /* TEXT */ || t === 5 /* INTERPOLATION */
      })

      const style: Record<string, unknown> = {}
      let hasDynamicStyle = false
      // ★★未支持特性探测（P0：让静默变可见——见 UNSUPPORTED_DIRECTIVES 头注）
      for (const p of n.props ?? []) {
        if (p.type === 7 /* DIRECTIVE */ && typeof p.name === 'string' && UNSUPPORTED_DIRECTIVES[p.name]) {
          diag(`${tag}(id=${id}) ${UNSUPPORTED_DIRECTIVES[p.name]}!`)
        }
        // ★动态名判据 = `arg.isStatic === false`（实测：静态与动态的 arg.type 都是 4，
        //   **只有 isStatic 区分**——首版按"有无 arg.content"判 ⇒ 两者都有 content ⇒ 全漏）。
        const argNode = p.arg as { isStatic?: boolean } | undefined
        const isDynamicName = p.type === 7 && argNode != null && argNode.isStatic === false
        if (p.type === 7 && p.name === 'on' && isDynamicName) {
          diag(
            `${tag}(id=${id}) 动态事件名 \`@[expr]\` 未支持（本版只处理静态事件名）`,
            '请改用静态事件名（如 @click / @tap）',
          )
        }
        if (p.type === 7 && p.name === 'bind' && isDynamicName) {
          diag(
            `${tag}(id=${id}) 动态属性名 \`:[expr]\` 未支持（本版只处理静态属性名）`,
            '请改用静态属性名（如 :width / :show）',
          )
        }
        // 自定义指令 `v-xxx`（非 v-bind/v-on/v-for/v-if/v-show/v-model 等已处理项）
        const KNOWN_DIRECTIVES = ['bind', 'on', 'for', 'if', 'else-if', 'else', 'show', 'model', 'slot', 'text', 'html', 'memo', 'once', 'cloak', 'pre']
        if (p.type === 7 && typeof p.name === 'string'
            && UNSUPPORTED_DIRECTIVES[p.name] === undefined
            && !KNOWN_DIRECTIVES.includes(p.name)) {
          diag(
            `${tag}(id=${id}) 自定义指令 \`v-${p.name}\` 未支持（指令注册表待建）`,
            '去掉它或保留 Vue 渲染路径（L0）',
          )
        }
      }
      for (const p of n.props ?? []) {
        if (p.type === 6 /* ATTRIBUTE */ && p.name === 'style' && p.value?.content) {
          Object.assign(style, parseStaticStyle(p.value.content, (m, hint) => diag(`${tag}(id=${id}) ${m}`, hint)))
        }
        if (p.type === 7 /* DIRECTIVE */ && p.name === 'bind' && p.arg?.content === 'style') {
          hasDynamicStyle = true
        }
        // ★★结构化绘制声明（见 PAINT_DECL_ATTRS 头注）：JSON 串 → 结构字段（解析失败 ⇒ 诊断）
        if (p.type === 6 /* ATTRIBUTE */ && isPaintDeclAttr(p.name) && p.value?.content) {
          const r = parsePaintDeclAttr(p.name, p.value.content)
          if (r.ok) {
            style[r.key] = r.value
          } else {
            diag(`${tag}(id=${id}) 属性 \`${p.name}\` 不是合法 JSON（已忽略）`, r.hint)
          }
        }
      }

      // ── v-for：建立行模板（本版只支持单层）──
      let nodeListId: number | undefined
      if (forCode) {
        if (activeListStack.length > 0) {
          diag(
            `${tag}(id=${id}) 嵌套 v-for 未支持（本版只支持单层）`,
            '嵌套列表请保留标准 Vue 渲染路径（L0）；或等 LayoutTemplate 支持递归实例化',
          )
          // 嵌套时**不建**行模板，仅按静态节点处理（调用方据 ok=false 决定是否使用）
        } else {
          const parts = forCode.split(/\s+(?:in|of)\s+/)
          const alias = (parts[0] ?? '').trim()
          const names = alias.replace(/[()]/g, '').split(',').map((s) => s.trim()).filter(Boolean)
          nodeListId = nextListId++
          const collector = { listId: nodeListId, ids: [] as number[] }
          rowCollector = collector
          activeListStack.push(nodeListId)
          lists.push({ listId: nodeListId, rowRootId: id, subtreeIds: collector.ids, scope: names[0] ?? '' })
          // ★ids 引用同一数组：行根在下方统一 push（避免此处重复添加）
        }
      }

      // ★★内置组件探测（P0：当普通容器 = 语义静默丢失——见 UNSUPPORTED_BUILTINS 头注）
      if (tag && UNSUPPORTED_BUILTINS[tag]) {
        diag(`${tag}(id=${id}) ${UNSUPPORTED_BUILTINS[tag]}`)
      }
      // ★★**组件边界标记**（P1 组件系统第一批，2026-10-03）：`<MyComp>` 这类**大写开头**的标签
      //   是 Vue 组件（协议：PascalCase = 组件，kebab-case = 原生标签——与 Vue 官方同约定）。
      //   ⇒ 在节点上打 `component` 标记（运行时据此走 L0 边界语义；见 LayoutNode.component 注释）。
      //   ★本版只做**标记 + props 通道**；组件内部渲染/生命周期/插槽分发是后续批次
      //     （标记本身已比"当普通元素"有价值：宿主能识别"这里是组件位、需要 L0 处理"）。
      const isComponentTag = /^[A-Z]/.test(tag) && !UNSUPPORTED_BUILTINS[tag]
      // ★★插槽出口 `<slot>`（P0）：组件系统未建 ⇒ 插槽内容分发不存在（静默空位）
      if (tag === 'slot') {
        diag(
          `slot(id=${id}) 插槽出口 \`<slot>\` 未支持（组件系统待建——见能力清单 P1）`,
          '插槽内容不会被分发到这里；请保留 Vue 渲染路径（L0）或等组件系统',
        )
      }
      const node: LayoutNode = { id, parentId, tag, style }
      if (nodeListId !== undefined) node.listId = nodeListId
      if (isComponentTag) node.component = tag
      // 文本：静态文本 或 插值 → 占位（初始值由运行时回填；**混合文本不支持**）
      if (textChildren.length > 0) {
        if (elementChildren.length > 0) {
          diag(`${tag}(id=${id}) 同时含元素与文本子节点（本版不支持混合内容）`, '请拆分为纯容器或纯文本元素')
        } else if (textChildren.length > 1) {
          diag(`${tag}(id=${id}) 含多个文本/插值子节点（本版不支持，需文本节点拆分）`)
        } else {
          const c = textChildren[0] as Node & { content?: unknown }
          // TEXT 的 content 是字符串；INTERPOLATION 的 content 是 {content: 'expr'}
          const isInterp = (c as { type: number }).type === 5
          node.text = isInterp ? '' : String((c.content as string) ?? '')
        }
      }
      if (hasDynamicStyle) {
        diag(`${tag}(id=${id}) 含动态 :style 对象（模板不解析；由订阅表以 SET_STYLE 逐键下发）`)
      }
      nodes.push(node)
      if (parentId === null) roots.push(id)
      if (rowCollector) rowCollector.ids.push(id)

      walk(subChildren, id)

      // 行子树收集结束（pre-order ⇒ 子树连续；此处收尾）
      if (nodeListId !== undefined) {
        activeListStack.pop()
        rowCollector = null
      }
    }
  }

  walk(ast.children ?? [], null)
  const ok = !diagnostics.some((d) => d.severity === 'error')
  // ★产物本身不带诊断（干净形状便于跨端序列化）；诊断放在包装层
  return { template: { nodes, lists, roots, ok }, diagnostics, ok }
}
