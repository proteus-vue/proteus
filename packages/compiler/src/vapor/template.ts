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
//   · ~~嵌套 v-for~~ ⇒ ✅ 2026-10-03 P2 批次已支持（递归实例化，见 ListTemplate.parentListId）
//   · ~~元素子节点是「文本 + 插值混合」~~ ⇒ ✅ 2026-10-03 P2-2 已支持（`a{{x}}b` 编译期切分，
//     见 LayoutNode.textSegments；元素与文本**混排**仍拒绝——需文本节点结构化）
//   · 动态 `:style` 对象（运行期多键展开）⇒ 由订阅表以 SET_STYLE 逐键下发，模板不解析
//   · 组件标签（`<MyComp>`）⇒ 边界标记 + props 通道（P1 第一批）；内部渲染待后续批次
import { parse as sfcParse, type SFCDescriptor } from '@vue/compiler-sfc'
import { parse as domParse } from '@vue/compiler-dom'
import type { VaporDiagnostic } from './build'
import type { VueCompatDeps } from './sources'
import type { LayoutNode, LayoutTemplate, ListTemplate, TextSegment } from '@proteus-vue/slot-runtime'
// ★混合文本（P2-2）里的插值段要编成表达式程序——复用**同一套**编译器（能力边界一处收敛）
import { compileExpr } from './expr'

// ★类型定义在**运行时契约包**（slot-runtime/layout-template.ts）——编译器只是产出方之一，
//   消费方定义的形状才是唯一契约（与 SubscriptionTable 同一处置）。
//   这里 re-export 便于 `proteus explain` 等工具从编译器侧一并取用。
export type { LayoutTemplate, LayoutNode, ListTemplate, TextSegment } from '@proteus-vue/slot-runtime'

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
 * 【与既有诊断的关系】既有诊断已覆盖：~~混合文本~~（2026-10-03 P2-2 已支持）/ 事件修饰符
 *   （2026-10-03 P2-3 起 .stop/.self/.once 支持，其余产诊断）/ 多语句 handler /
 *   表达式白名单（嵌套 v-for 曾诊断拒绝，2026-10-03 P2 批次已改为**真支持**）。
 *   本表补的是**之前完全没被检查**的那一批。
 */
const UNSUPPORTED_DIRECTIVES: Record<string, string> = {
  html:
    'v-html 未支持（**富文本通道**待建：内核文本是单串、宿主是单次 drawText，' +
    '不支持分段字形/内联样式）——请改为多个文本节点 + 样式，或保留 Vue 渲染路径（L0）',
  cloak: 'v-cloak 未支持（App 端无 CSS 首帧闪烁语义）——可安全移除',
  pre: 'v-pre 未支持（跳过编译的语义待建）——请手动改写为静态内容',
}
// ★★P2-6（2026-10-03）：v-text 已**真支持**（见下方 textSegments 分支——语义 = 覆盖子节点的纯文本）；
//   v-html 仍不支持（富文本通道缺失，**诚实标注**：能力清单此前写"可映射"，经查内核/宿主均无分段文本能力）。
// ★★P2-5（2026-10-03）：v-once / v-memo 已**真支持**（见 SlotSubscription.once / MemoGroup）——
//   本表不再收录；**不支持的形态**（v-memo 非数组字面量 / 行内 once）在下方遍历里逐条诊断。
/**
 * ★★★**逻辑容器**（不产元素的 Vue 内置组件，2026-10-03 · P3 批次）——统一**透传**。
 *
 * 【为什么必须透传（本仓实测的几何等价缺陷）】Vue 里这四个都**不渲染包裹元素**
 *   （它们是逻辑容器：过渡/缓存/传送/异步边界）⇒ 若我方给它们建节点，同一份 SFC 在
 *   Vapor 链上会**多一层盒** ⇒ 布局多一层、几何与 Vue 路径**不等价**（A/B 判据红）。
 *   ⇒ 与 `<Transition>` 同一处置（P3-3 已验证）：**不占节点 id、不产节点**，
 *     `template.ts` 与 `deps.ts` **两处同一条判据**（id 空间同源）。
 * 【诚实边界】透传只解决"几何等价"；**功能语义**（缓存/传送/异步）另见各自诊断。
 */
const LOGICAL_CONTAINERS: Record<string, string | null> = {
  // 已支持（P3-3）：编成预设动画规格 + 宿主动画入口——**无诊断**
  Transition: null,
  KeepAlive:
    'KeepAlive 的**组件级缓存**未支持（需组件实例系统——P1-3 组件内部渲染待建）。' +
    '★当前行为：**内容正常渲染但状态不缓存**（切走即销毁）。' +
    '★替代路径：**页面级**保活已支持——路由 `meta.branch.keepAlive` 三档（none=切走销毁 / active=当前+相邻 / all=全保活，见《导航体系》NB3）',
  Teleport:
    'Teleport 的**传送语义**未支持（需宿主多渲染面）。' +
    '★当前行为：内容渲染在**原位置**（不是 `to` 指定的容器）',
  Suspense:
    'Suspense 的**异步边界**未支持（需异步组件系统）。' +
    '★当前行为：只渲染 `#default` 内容（`#fallback` 永不显示——我方无 pending 态）',
}

/** 未支持的内置组件（官方有语义，我方当普通容器 ⇒ 语义静默丢失） */
const UNSUPPORTED_BUILTINS: Record<string, string> = {
  // ★P3 批次：Teleport/KeepAlive/Suspense 移入 LOGICAL_CONTAINERS（透传 + 精确诊断）——
  //   它们**不是**"当普通容器"（那是错的：会多建一层盒），而是"逻辑容器透传"。
  //   本表保留的只有**真·当普通容器**的（即：官方会渲染元素而我们要区别对待的）。
  // ★★P3-3（2026-10-03）：`Transition` 已**支持**（编译成预设动画规格；见 TRANSITION_PRESETS）——
  //   从本表移除。`TransitionGroup` 仍在（需**列表差异动画** = move 过渡，独立批次）。
  TransitionGroup: 'TransitionGroup 未支持（需**列表差异动画**/move 过渡——`Transition` 单元素过渡已支持）',
  Suspense: 'Suspense 未支持（异步边界待建）',
  Component: '动态组件 `<component :is>` 未支持（需运行时组件解析）',
  component: '动态组件 `<component :is>` 未支持（需运行时组件解析）',
}

/**
 * ★★★**过渡预设**（P3-3，2026-10-03）——`<Transition name="X">` 的通道规格（**闭集**）。
 *
 * 【为什么是闭集预设而不是解析 CSS】Vue 靠 CSS 类驱动过渡（`v-enter-from`/`-active`/`-to`）；
 *   我方无 CSS 引擎，但有**内核动画**（`AnimKind` 通道 + 曲线/时长）⇒ 直接把常见过渡
 *   编成通道规格。`kind` 编号与 `packages/layout-core-rust/src/anim.rs` 的 `AnimKind`
 *   **一一对应**（0=TranslateX / 1=TranslateY / 2=Scale / 4=Opacity）——跨语言契约，不得改号。
 * 【入场 vs 离场】入场 = from→to（如 fade：0→1）；离场 = **反向**（1→0）——
 *   语义与 Vue 的 enter/leave 对称性一致（同一 `name` 既有入场也有离场）。
 * 【未知名】产诊断（不静默退化成"无过渡"——那会让"写了过渡却不动"无从归因）。
 */
const TRANSITION_PRESETS: Record<string, Array<{ kind: number; from: number; to: number }>> = {
  fade: [{ kind: 4, from: 0, to: 1 }],
  'slide-up': [{ kind: 1, from: 40, to: 0 }],
  'slide-down': [{ kind: 1, from: -40, to: 0 }],
  'slide-left': [{ kind: 0, from: 40, to: 0 }],
  'slide-right': [{ kind: 0, from: -40, to: 0 }],
  zoom: [{ kind: 2, from: 0.9, to: 1 }],
  /** 组合（淡入 + 上滑）——最常见的入场形态；多通道 = 同一节点的多条动画并行 */
  'fade-slide-up': [
    { kind: 4, from: 0, to: 1 },
    { kind: 1, from: 24, to: 0 },
  ],
}

/** 预设名 → `{enter, leave}` 通道规格（未知名 ⇒ null，调用方诊断） */
export function transitionPresetOf(
  name: string,
): { enter: Array<{ kind: number; from: number; to: number }>; leave: Array<{ kind: number; from: number; to: number }> } | null {
  const base = TRANSITION_PRESETS[name]
  if (!base) return null
  return {
    enter: base.map((c) => ({ ...c })),
    // 离场 = 入场**反向**（from/to 互换）——与 Vue enter/leave 的对称语义一致
    leave: base.map((c) => ({ kind: c.kind, from: c.to, to: c.from })),
  }
}

/** 预设名清单（诊断里列出，便于照抄） */
export const TRANSITION_PRESET_NAMES = Object.keys(TRANSITION_PRESETS)

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
 * ★★★**`<Transition>` → 过渡规格**（P3-3，2026-10-03）
 *
 * 支持的 props（**闭集**，其余诊断）：
 *   · `name="fade"`      → 预设名（见 `TRANSITION_PRESETS`；未知名 ⇒ 诊断）
 *   · `:duration="300"`  → 时长 ms（缺省 220；静态字符串数字也认）
 *   · `appear`           → 首帧也播入场（带值即视为真；`appear="false"` 视为假）
 *   · `:css="false"`     → 忽略（我方本就无 CSS——不报错，属"已满足"）
 *
 * 【不支持的形态 ⇒ 诊断（不静默）】多子元素 / 无子元素（Vue 对 Transition 的同一约束）——
 *   多子时 Vue 会告警并改用"单元素"语义，我方**明确诊断**（避免"以为在过渡、其实没动"）。
 */
export function transitionOfElement(
  n: { props?: Array<{ type: number; name: string; arg?: { content?: string }; exp?: { content?: string }; value?: { content?: string } }>; children?: unknown[] },
  diag: (msg: string, hint?: string, code?: string) => void,
): LayoutNode['transition'] | undefined {
  let name = 'fade'
  let durMs = 220
  let appear = false
  for (const p of n.props ?? []) {
    // ★两种形态都要读（本仓实测）：静态属性（`duration="300"`，值在 `value.content`）与
    //   **绑定**（`:duration="300"` / `:name="'fade'"`，值在 `exp.content`）——
    //   首版只读静态 ⇒ `:duration="300"` 被忽略（静默回落 220，症状是"时长不对"而非报错）。
    // ★★形态取证（本仓实测）：`:duration="300"` 在 @vue/compiler-dom 里被归一为
    //   **`{type:7, name:'bind', exp:'300'}`（不带 arg！）**——与 `v-bind="obj"` 同形。
    //   ⇒ 判据要认两种：① 静态 `duration="300"`（type 6）；② **无 arg 的 bind 且值是纯数字**
    //     （`:duration="300"` 的归一形态——值本身就是时长，不是"展开对象"）。
    const rawName = p.type === 6 ? p.name : (p.arg?.content ?? '')
    const isDurationBind = p.type === 7 && p.name === 'bind' && !p.arg?.content && /^\s*\d+\s*$/.test(String(p.exp?.content ?? ''))
    const value = p.type === 6 ? p.value?.content : p.exp?.content
    if (p.name === 'name' && value) name = value.replace(/["']/g, '').trim()
    if (isDurationBind && value) {
      const num = Number(String(value).trim())
      if (Number.isFinite(num) && num > 0) durMs = num
    }
    if (rawName === 'duration' && value) {
      const num = Number(String(value).replace(/["']/g, '').trim())
      if (Number.isFinite(num) && num > 0) durMs = num
      else {
        diag(
          `<Transition :duration="${value}">：本版只支持**字面量数值**（如 :duration="300"）`,
          '改成字面量，或等运行时时长通道（动态时长的过渡规格需要运行时解析）',
          'VAPOR_TRANSITION_DURATION_DYNAMIC',
        )
      }
    }
    if (p.name === 'appear') appear = String(value ?? '') !== 'false'
    if (p.name === 'css') {
      // `:css="false"` = 告诉 Vue "不要用 CSS 类，我全在 JS 里做"——我方本就无 CSS
      // ⇒ 语义已满足（不诊断；`css="true"` 则**我们做不到**，如实提示一次）
      if (String(value ?? '').replace(/["']/g, '') === 'true') {
        diag(
          `<Transition :css="true">：我方没有 CSS 类机制（过渡由**内核动画**驱动，不是 v-enter-from 类）`,
          '删掉 `:css`（缺省即由本框架的预设动画驱动），或保留 Vue 渲染路径（L0）',
          'VAPOR_TRANSITION_CSS',
        )
      }
    }
  }
  const preset = transitionPresetOf(name)
  if (!preset) {
    diag(
      `<Transition name="${name}">：未知预设名`,
      `可用预设：${TRANSITION_PRESET_NAMES.join(' / ')}（闭集；CSS 自定义过渡我方无 CSS 引擎）`,
      'VAPOR_TRANSITION_UNKNOWN_PRESET',
    )
    return undefined
  }
  return { preset: name, enter: preset.enter, leave: preset.leave, durMs, curve: 1, ...(appear ? { appear: true } : {}) }
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
  // ★行收集器栈（嵌套 v-for 用——见 v-for 分支注释：单变量会被内层覆盖）
  const pendingCollectors: Array<{ listId: number; ids: number[] }> = []

  type Node = {
    type: number
    tag?: string
    props?: Array<{
      type: number
      name: string
      arg?: { content?: string }
      exp?: { content?: string }
      value?: { content?: string }
      /** ★指令修饰符（P2-4：v-model .trim/.number/.lazy；AST 形态 `{content}[]`） */
      modifiers?: Array<{ content?: string } | string>
    }>
    children?: unknown[]
  }

  /**
   * ★★★**插槽声明探测**（2026-10-03 · P1-3 插槽分发）：元素上是否有 `v-slot` 指令。
   *
   * 返回：`undefined` = 无 v-slot；`''` = 无参（⇒ `default`）；非空 = 具名。
   * ★父元素是不是组件由调用方判定（Vue 里 `#x` 只对组件有意义）。
   */
  const vSlotNameOf = (n: Node): string | undefined => {
    const p = (n.props ?? []).find((x) => x.type === 7 && x.name === 'slot')
    if (!p) return undefined
    const arg = p.arg?.content
    return arg === undefined ? '' : String(arg)
  }
  /** `v-slot` 的**作用域变量**（`#default="sp"` ⇒ `'sp'`；无 ⇒ undefined） */
  const vSlotScopeOf = (n: Node): string | undefined => {
    const p = (n.props ?? []).find((x) => x.type === 7 && x.name === 'slot')
    const exp = p?.exp?.content?.trim()
    return exp ? exp : undefined
  }

  const walk = (
    children: unknown[],
    parentId: number | null,
    /**
     * ★P3-3：外层 `<Transition>` 的过渡规格（透传给**直接子元素**；无则 undefined）
     */
    pendingTransition?: LayoutNode['transition'],
    /**
     * ★★★**插槽上下文**（2026-10-03 · P1-3 插槽分发）——两者互斥（一次 walk 只处于一种）：
     *   · `parentIsComponent`：本次 walk 的直接子元素是**组件的孩子** ⇒ 它们是
     *     默认插槽内容根（打 `slotFor: default`）；`<template #x>` 是插槽声明（不产节点）。
     *   · `slotContentOf`：本次 walk 的直接子元素是**某个具名插槽的内容根** ⇒ 打 `slotFor: name`。
     */
    slotCtx?: { parentIsComponent?: boolean; slotContentOf?: string },
  ): void => {
    for (const raw of children) {
      const n = raw as Node
      if (n.type !== 1 /* ELEMENT */) {
        // 文本/插值节点在**父元素**上处理（本函数只在元素遍历里被调用，见下方 children 过滤）
        continue
      }
      const tag = n.tag ?? ''
      // ★★★**插槽声明 `<template #x>`**（Vue 里 `template` 是**片段/插槽声明**、不产元素）：
      //   不占 id、不产节点；其**直接子元素**是该具名插槽的内容根（打 `slotFor`）。
      //   ★判据与 deps.ts/events.ts **同源**（有 v-slot 的 template ⇒ 跳过）。
      if (tag === 'template') {
        const vs = vSlotNameOf(n)
        if (vs !== undefined) {
          const name = vs === '' ? 'default' : vs
          const scope = vSlotScopeOf(n)
          if (scope) {
            diag(
              `作用域插槽未支持：\`#${name}="${scope}"\` 的作用域变量不会绑定到出口 props（内容仍会分发）`,
              '本版支持具名/默认插槽分发；作用域插槽（出口 :prop ⇒ 父级 scope 变量）为后续批次',
              'VAPOR_SLOT_SCOPED_UNSUPPORTED',
            )
          }
          // 内容根标记：仅在「组件孩子」上下文中才有意义（slotCtx 决定标记名）
          walk((n.children ?? []) as unknown[], parentId, pendingTransition,
            slotCtx?.parentIsComponent ? { slotContentOf: name } : slotCtx)
          continue
        }
        if (slotCtx?.parentIsComponent) {
          diag(
            `组件下的 <template>（无 v-slot）会建一层盒（Vue 里 template 是片段、不产元素）`,
            '若想表达插槽内容请用具名写法 `<template #name>`；若只是条件渲染，盒子差异见本诊断',
            'VAPOR_SLOT_TEMPLATE_BOX',
          )
        }
      }
      // ★★★**逻辑容器统一透传**（P3 批次，2026-10-03）——`Transition` / `KeepAlive` /
      //   `Teleport` / `Suspense`：Vue 里都**不渲染包裹元素** ⇒ 透传（不占 id、不产节点），
      //   否则同一份 SFC 在 Vapor 链上多一层盒 ⇒ 几何与 Vue 不等价（A/B 判据红）。
      //   ★`deps.ts` 必须用**同一条判据**（两处 id 分配同源 ⇒ 订阅表 nodeId 逐位一致）。
      if (tag in LOGICAL_CONTAINERS) {
        const hint = LOGICAL_CONTAINERS[tag]
        // ★诊断**不带 id**（本容器透传、不占节点 id——引用它反而是错的）
        if (hint) diag(`<${tag}> ${hint}`, undefined, 'VAPOR_BUILTIN_PARTIAL')
        if (tag === 'Transition') {
          // Transition：props 编成预设规格，挂到**直接子元素**
          const t = transitionOfElement(n, diag)
          walk((n.children ?? []) as unknown[], parentId, t ?? pendingTransition, slotCtx)
        } else if (tag === 'Suspense') {
          // ★Suspense：只走 `#default`（我方无异步 ⇒ 永远 resolved）；`#fallback` 跳过。
          //   【为什么不能两个都走】两棵子树都会建 ⇒ 内容**双份**（fallback 永不隐藏 ⇒ 叠影）。
          //   ★`<template #default>` 本身是**插槽声明**（Vue 里不产元素）⇒ 必须**下钻一层**：
          //     把它的 children 提上来走（否则会多一个 `template` 节点——本仓实测：
          //     Suspense 的 width 槽位 nodeId 偏到 2、多一层盒）。
          const kids = (n.children ?? []) as Array<Node>
          const slotOf = (c: Node): string | undefined =>
            (c.props ?? []).find((p) => p.type === 7 && p.name === 'slot')?.arg?.content
          const defaultKids = kids.filter((c) => {
            const slotArg = slotOf(c)
            return slotArg === undefined || slotArg === 'default'
          })
          // 下钻：`<template #default>` 的 children 直接提到本层（template 不产节点）
          const flattened: unknown[] = []
          for (const c of defaultKids) {
            if ((c as { tag?: string }).tag === 'template') {
              flattened.push(...(((c as { children?: unknown[] }).children) ?? []))
            } else {
              flattened.push(c)
            }
          }
          walk(flattened, parentId, pendingTransition, slotCtx)
        } else {
          walk((n.children ?? []) as unknown[], parentId, pendingTransition, slotCtx)
        }
        continue
      }
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
        // ★★**v-model 的诚实边界诊断**（P2-4，2026-10-03）：Vapor 路目前只有**下行**（值 → 文本槽位），
        //   **没有回写通道**（App 端输入法/键盘事件未接；宿主手势层只有 tap/longpress）。
        //   ⇒ 元素上出现 v-model 时明确诊断——不静默半支持（"页面看着对、输入不生效"属最危险一类）。
        //   ★`v-model` 的**修饰符**在 Vapor 路的语义（`.trim/.number` 作用于回写值）**依赖回写通道**，
        //     通道缺失时修饰符一并如实标注（不假装生效）。
        if (p.type === 7 && p.name === 'model') {
          const mods = (p.modifiers ?? [])
            .map((m) => (typeof m === 'string' ? m : (m?.content ?? '')))
            .filter(Boolean)
          diag(
            `${tag}(id=${id}) v-model 在 Vapor 路只有**下行**（值→文本槽位），**无回写通道**` +
              (mods.length ? `（修饰符 .${mods.join(' / .')} 依赖回写、同样无法生效）` : '') +
              `——输入不会写回数据`,
            '需要双向绑定时请保留 Vue 渲染路径（L0），或等 App 端输入通道批次',
            'VAPOR_VMODEL_NO_WRITEBACK',
          )
        }
        // ★P2-5：v-memo 的**形态诊断**（只支持数组字面量——运行时按"逐项比较"建依赖表，
        //   动态形态（`v-memo="deps"` / 变量数组）无法静态建表 ⇒ 明确诊断，不静默按"总是更新"跑）
        if (p.type === 7 && p.name === 'memo') {
          const memoSrc = (p.exp as { content?: string } | undefined)?.content?.trim() ?? ''
          if (!/^\[[\s\S]*\]$/.test(memoSrc)) {
            diag(
              `${tag}(id=${id}) v-memo 的依赖需为**数组字面量**（如 v-memo="[a, b]"）——当前 \`${memoSrc || '<空>'}\` 无法静态建依赖表`,
              '请把依赖写成数组字面量（成员/算术/比较均可），或去掉 v-memo（仅少一层优化）',
              'VAPOR_MEMO_SHAPE',
            )
          }
        }
        // ★动态名判据 = `arg.isStatic === false`（实测：静态与动态的 arg.type 都是 4，
        //   **只有 isStatic 区分**——首版按"有无 arg.content"判 ⇒ 两者都有 content ⇒ 全漏）。
        const argNode = p.arg as { isStatic?: boolean; content?: string } | undefined
        const isDynamicName = p.type === 7 && argNode != null && argNode.isStatic === false
        if (p.type === 7 && p.name === 'on' && isDynamicName) {
          diag(
            `${tag}(id=${id}) 动态事件名 \`@[expr]\` 未支持（本版只处理静态事件名）`,
            '请改用静态事件名（如 @click / @tap）',
          )
        }
        if (p.type === 7 && p.name === 'bind' && isDynamicName) {
          const rawArg = String(argNode?.content ?? '').trim()
          // ★★P2-7（2026-10-03）：**字符串字面量**形态（`:['width']`）编译期可判定
          //   ⇒ 降级为静态属性名（**已支持**，诊断不再报）；只有**真动态**（`:[k]`）才诊断。
          const strLit = /^(['"])([^'"]*)\1$/.exec(rawArg)
          if (!strLit) {
            diag(
              `${tag}(id=${id}) 动态属性名 \`:[expr]\` 未支持（键名运行时才知 ⇒ 无法静态建槽位）`,
              `字符串字面量形态可直接用（如 :['width'] 编译期等价于 :width）；真动态键名请改用静态属性名或条件分支`,
            )
          }
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

      // ── v-for：建立行模板（★嵌套已支持 —— 2026-10-03 P2 批次）──
      let nodeListId: number | undefined
      if (forCode) {
        const parts = forCode.split(/\s+(?:in|of)\s+/)
        const alias = (parts[0] ?? '').trim()
        const names = alias.replace(/[()]/g, '').split(',').map((s) => s.trim()).filter(Boolean)
        const sourceExpr = (parts[1] ?? '').trim()
        nodeListId = nextListId++
        // ★★嵌套支持（P2 批次）：记录外层列表 id 与外层作用域名——
        //   运行时按外层 item 递归实例化内层（见 ListTemplate.parentListId 注释）。
        const parentListId = activeListStack.length > 0 ? activeListStack[activeListStack.length - 1] : undefined
        // 外层作用域名 = 本列表的源表达式**根标识符**（如 `g.x` 的 `g`）——内层求值要靠它绑定
        const outerScope = parentListId !== undefined ? (sourceExpr.split('.')[0] ?? '') : undefined
        // ★数据源字段名（嵌套用）：`g.items` → `items`（去掉外层作用域前缀）
        const sourceField = parentListId !== undefined
          ? sourceExpr.split('.').slice(1).join('.') || sourceExpr
          : sourceExpr
        const collector = { listId: nodeListId, ids: [] as number[] }
        // ★★行收集器栈（嵌套的关键）：内层节点归属**内层**列表；内层收尾时弹回外层收集器。
        //   首版用**单变量** rowCollector ⇒ 内层一压就覆盖外层（嵌套直接错乱）。
        //   ★各列表**管各自的子树**（不把内层后代合并进外层）——合并会让外层克隆与内层展开
        //     对同一批模板 id **撞车**（实测：外层 li 全丢）。见收尾处注释。
        pendingCollectors.push(collector)
        rowCollector = collector
        activeListStack.push(nodeListId)
        lists.push({
          listId: nodeListId,
          rowRootId: id,
          subtreeIds: collector.ids,
          scope: names[0] ?? '',
          sourceField,
          ...(parentListId !== undefined ? { parentListId } : {}),
          ...(outerScope ? { outerScope } : {}),
        })
      }

      // ★★内置组件探测（P0：当普通容器 = 语义静默丢失——见 UNSUPPORTED_BUILTINS 头注）
      //   ★P3 批次：逻辑容器（LOGICAL_CONTAINERS）已在**透传分支**里诊断（含精确边界 + 替代路径）
      //     ⇒ 此处不再重复；本分支只剩"真·当普通容器"的那些。
      if (tag && UNSUPPORTED_BUILTINS[tag]) {
        diag(`${tag}(id=${id}) ${UNSUPPORTED_BUILTINS[tag]}`)
      }
      // ★★**组件边界标记**（P1 组件系统第一批，2026-10-03）：`<MyComp>` 这类**大写开头**的标签
      //   是 Vue 组件（协议：PascalCase = 组件，kebab-case = 原生标签——与 Vue 官方同约定）。
      //   ⇒ 在节点上打 `component` 标记（运行时据此走 L0 边界语义；见 LayoutNode.component 注释）。
      //   ★本版只做**标记 + props 通道**；组件内部渲染/生命周期/插槽分发是后续批次
      //     （标记本身已比"当普通元素"有价值：宿主能识别"这里是组件位、需要 L0 处理"）。
      // ★逻辑容器（KeepAlive/Teleport/Suspense/Transition）虽是 PascalCase，但**不是**组件边界
      //   （它们已被透传分支 `continue` 掉了 ⇒ 此处本就走不到；判据保留以防未来顺序调整）
      const isComponentTag = /^[A-Z]/.test(tag) && !UNSUPPORTED_BUILTINS[tag] && !(tag in LOGICAL_CONTAINERS)
      // ★★插槽出口 `<slot>`（P1-3 插槽分发，2026-10-03）：打 `slotOutlet` 标记——
      //   实例化期把父级内容**分发到出口位置**（出口自身**不产元素**，见 LayoutNode.slotOutlet）。
      //   ★静态名（`<slot name="header">`）/ 缺省（`default`）都支持；动态名（`:name`）
      //     与出口 props（`<slot :text="msg">`，作用域插槽）为后续批次 ⇒ 精确诊断（不静默）。
      let slotOutletName: string | undefined
      if (tag === 'slot') {
        const nameProp = (n.props ?? []).find((p) => p.type === 6 && p.name === 'name')
        const dynName = (n.props ?? []).some((p) => p.type === 7 && p.arg?.content === 'name')
        const scopedProps = (n.props ?? []).some((p) => p.type === 7 && p.arg?.content !== 'name' && p.name === 'bind')
        if (dynName) {
          diag(
            `slot(id=${id}) 动态插槽名（:name）未支持——内容不会分发到这里`,
            '请改用静态名（<slot name="x">）；动态名为后续批次',
            'VAPOR_SLOT_DYNAMIC_NAME',
          )
        } else if (scopedProps) {
          diag(
            `slot(id=${id}) 出口 props（\`:x="..."\`）未支持——作用域插槽为后续批次`,
            '出口仍会分发内容；父级 #x="sp" 拿不到出口值（见 scoped 诊断）',
            'VAPOR_SLOT_SCOPED_UNSUPPORTED',
          )
          slotOutletName = nameProp?.value?.content ?? 'default'
        } else {
          slotOutletName = nameProp?.value?.content ?? 'default'
        }
      }
      const node: LayoutNode = { id, parentId, tag, style }
      if (nodeListId !== undefined) node.listId = nodeListId
      if (isComponentTag) node.component = tag
      if (slotOutletName !== undefined) node.slotOutlet = { name: slotOutletName }
      // ★★**插槽内容根标记**（P1-3 插槽分发）：本元素是「组件孩子」（默认插槽）或
      //   「<template #x> 的直接子元素」（具名插槽）⇒ 实例化期把它重挂到子组件的出口位置。
      //   ★只有**根**带标记（后代随根走——父指针链不变 ⇒ 实例化期按祖先链推导内容集合）。
      if (slotCtx?.slotContentOf !== undefined) {
        node.slotFor = { name: slotCtx.slotContentOf }
      } else if (slotCtx?.parentIsComponent) {
        node.slotFor = { name: 'default' }
      }
      // ★P3-3：外层 `<Transition>` 的规格挂到本节点（直接被过渡的元素）
      if (pendingTransition) {
        node.transition = pendingTransition
        // 过渡作用于**可见性切换**（v-show / :show）——这是本批驱动路径（见 LayoutNode.transition 边界）
        const hasShow = (n.props ?? []).some((p) => p.type === 7 && (p.name === 'show' || p.name === 'if'))
        if (!hasShow) {
          diag(
            `${tag}(id=${id}) 外层 <Transition> 但本元素既无 v-show 也无 v-if——过渡不会被驱动`,
            '把 v-show/v-if 放到被过渡的元素上（本批只驱动可见性切换这条路径）',
            'VAPOR_TRANSITION_NO_TRIGGER',
          )
        }
      }
      // 文本：静态文本 / 插值 / ★★**混合文本**（`a{{x}}b` ⇒ 编译期切分，2026-10-03 · P2-2）
      //
      // 【这一批补的是什么（能力清单 P2-2）】此前"文本 + 插值混合"（`<p>a{{x}}b</p>`）
      //   被诊断拒绝 ⇒ 模板里极常见的写法（前后缀 + 变量）只能改写或退回 Vue 路径。
      //   ⇒ 现在把子节点序列编成**段数组**（静态段 / 表达式段），运行时求值后拼成完整文本。
      //     这与"组合表达式"是同一件事（`a{{x}}b` ≡ `'a' + x + 'b'`）——切分只是
      //     把模板写法归一成表达式**段**，不引入第二套求值语义。
      //
      // 【为什么仍拒绝"元素 + 文本"混排】那需要**文本节点结构化**（自绘树里文本是元素属性，
      //   没有独立文本节点）⇒ 是节点模型问题，不是表达式问题（本版如实保留诊断）。
      // ★★P2-6：`v-text="expr"` ⇒ 文本槽位（**覆盖**子节点——与 Vue 语义一致：v-text 设置 textContent）
      //   与插值共用 `text.content` 通道 ⇒ 下游（订阅表/运行时/回填）零改动。
      //   ★形态取"单表达式段"（与 `{{ expr }}` 完全同形）——但**不**参与 P2-2 的多段合成
      //     （v-text 只有一个表达式、没有静态段）。
      {
        const vTextProp = (n.props ?? []).find((p) => p.type === 7 && p.name === 'text')
        const vTextCode = vTextProp?.exp?.content?.trim()
        if (vTextCode) {
          if (elementChildren.length > 0) {
            diag(`${tag}(id=${id}) v-text 与子元素并存——v-text 会**覆盖**全部子节点（Vue 语义）`, '请删掉子元素或改用插值')
          }
          node.text = ''
          const compiled = compileExpr(vTextCode)
          if (compiled.ok) {
            node.textSegments = [{ expr: compiled.program, src: vTextCode }]
          } else {
            diag(
              `${tag}(id=${id}) v-text 的表达式 \`${vTextCode}\` 无法编译为可求值程序：${compiled.unsupported}`,
              '可改写为受支持的表达式子集（成员访问/算术/比较/逻辑/三元/白名单内建）',
              'VAPOR_TEXT_INTERP_UNSUPPORTED',
            )
          }
        }
      }
      if (textChildren.length > 0 && !node.textSegments) {
        if (elementChildren.length > 0) {
          diag(`${tag}(id=${id}) 同时含元素与文本子节点（本版不支持混合内容）`, '请拆分为纯容器或纯文本元素')
        } else {
          const segs: TextSegment[] = []
          for (const raw of textChildren) {
            const c = raw as Node & { content?: unknown }
            // TEXT 的 content 是字符串；INTERPOLATION 的 content 是 {content: 'expr'}
            const isInterp = (c as { type: number }).type === 5
            if (isInterp) {
              const inner = c.content as { content?: string } | string | undefined
              const code = typeof inner === 'object' ? (inner?.content ?? '') : String(inner ?? '')
              if (!code.trim()) continue
              // ★插值表达式**立即按表达式程序编译**（与 `{{ x }}` 单段同一套能力边界：
              //   不支持的语法在编译期就可见；未支持的形态仍由订阅表带出诊断）
              const compiled = compileExpr(code.trim())
              if (compiled.ok) {
                segs.push({ expr: compiled.program, src: code.trim() })
              } else {
                // 参考实现编不出（如调用表达式）⇒ 若把源码当字面量文本保留 = **静默算错**
                // ⇒ 不产出该段 + 诊断（修法指向表达式能力边界）
                diag(
                  `${tag}(id=${id}) 混合文本里的插值 \`${code.trim()}\` 无法编译为可求值程序：${compiled.unsupported}`,
                  '可改写为受支持的表达式子集（成员访问/算术/比较/逻辑/三元），或对该元素改用纯插值 + 独立静态元素',
                  'VAPOR_TEXT_INTERP_UNSUPPORTED',
                )
                continue
              }
            } else {
              const text = String((c.content as string) ?? '')
              if (!text) continue
              segs.push({ text })
            }
          }
          const hasExpr = segs.some((s) => 'expr' in s)
          if (!hasExpr || segs.length === 1) {
            // ★单段（纯静态 / 纯插值）⇒ 走既有占位路径（产物形态对既有模板**逐字节不变**）；
            //   纯静态多段（如 `a{{ }}b` 的空插值被丢掉后）⇒ 直接拼成占位串（无表达式 ⇒ 无需运行时求值）
            node.text = segs.map((s) => ('text' in s ? s.text : '')).join('')
          } else {
            // ★多段（静态+插值混合 / 多插值 / 插值+静态）⇒ 段数组；运行时求值拼接
            //   `node.text` 留空串占位（由回填/更新写满），与既有"插值初值为空串"同一形态
            node.textSegments = segs
            node.text = ''
          }
        }
      }
      if (hasDynamicStyle) {
        diag(`${tag}(id=${id}) 含动态 :style 对象（模板不解析；由订阅表以 SET_STYLE 逐键下发）`)
      }
      nodes.push(node)
      if (parentId === null) roots.push(id)
      if (rowCollector) rowCollector.ids.push(id)

      // ★P3-3：`pendingTransition` **只作用于直接子元素**（Vue 同：Transition 只包一个元素）
      // ★★P1-3 插槽分发：组件元素的**直接子元素**是默认插槽内容根（打 `slotFor`）；
      //   非组件元素无插槽语义（slotCtx 缺省 ⇒ 不标记）。
      walk(subChildren, id, undefined, isComponentTag ? { parentIsComponent: true } : undefined)

      // 行子树收集结束（pre-order ⇒ 子树连续；此处收尾）
      if (nodeListId !== undefined) {
        activeListStack.pop()
        // ★★嵌套收尾（P2）：弹回**外层**的收集器（单变量版会把外层也清空 ⇒ 后续兄弟节点丢失）
        pendingCollectors.pop()
        rowCollector = pendingCollectors.length > 0 ? pendingCollectors[pendingCollectors.length - 1] : null
      }
    }
  }

  walk(ast.children ?? [], null)
  const ok = !diagnostics.some((d) => d.severity === 'error')
  // ★产物本身不带诊断（干净形状便于跨端序列化）；诊断放在包装层
  return { template: { nodes, lists, roots, ok }, diagnostics, ok }
}
