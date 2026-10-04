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
// ★P3-5 宿主指令注册表（**唯一事实来源在运行时包**——编译器据此产诊断、桥据此执行）
import { HOST_DIRECTIVE_NAMES, HOST_DIRECTIVE_SPECS, isHostDirective } from '@proteus-vue/slot-runtime'
// ★混合文本（P2-2）里的插值段要编成表达式程序——复用**同一套**编译器（能力边界一处收敛）
import { compileExpr } from './expr'
// ★★★元素/文本**混排**归一化（2026-10-03）——三处遍历（template/deps/events）的**唯一**输入
import { normalizedChildSequence } from './text-runs'
// ★作用域插槽的变量形态解析（单名 / 对象解构——唯一入口；2026-10-03）
import { parseSlotScope } from './slot-scope'
// ★`:style` 对象字面量（逐键展开 / 常量折叠；2026-10-03）
import { isAllConstantObject, mapStyleObjectKey, parseStyleObject } from './style-object'
// ★单键拼接形态的判据（`'width:' + w`）——与 deps 的降级**同一函数**（一处实现）
import { stylePropKeyFromExpr } from './deps'

// ★类型定义在**运行时契约包**（slot-runtime/layout-template.ts）——编译器只是产出方之一，
//   消费方定义的形状才是唯一契约（与 SubscriptionTable 同一处置）。
//   这里 re-export 便于 `proteus explain` 等工具从编译器侧一并取用。
export type { LayoutTemplate, LayoutNode, ListTemplate, TextSegment } from '@proteus-vue/slot-runtime'

/**
 * 静态样式里**引擎认的**字段（其余（如 paint.*）由宿主绘制读，不进核心）。
 * ★★App 端 CSS 支持面 SSOT（2026-10-04）：数组形态**导出**（供三门禁对照矩阵消费）——
 *   Set 由数组构造 ⇒ 单一来源（不会出现"表改了、Set 没改"的分叉）。
 *   ★诚实边界：这是 **App（Vapor/selfdraw）编译期折叠面**——比 Web/MP 的 CSS 引擎面小得多
 *   （无选择器/层叠/伪类/媒体查询/grid/box-shadow）。App 折叠面的属性名**与 CSS 同名**，
 *   值仅收 px/数字（宽高另支持百分比 → 比例字段）。对照矩阵见
 *   `docs/generated/app-css-surface.md`（`pnpm check:app-css-surface` 生成 + 门禁）。
 */
export const APP_LAYOUT_FIELDS = [
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'margin', 'padding', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignSelf',
  'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'display', 'position', 'top', 'left', 'right', 'bottom', 'overflow',
] as const
const LAYOUT_FIELDS = new Set<string>(APP_LAYOUT_FIELDS)
/**
 * ★★★**App 引擎的枚举值封闭集**（2026-10-04 修：真机 `RustLayout.create` 失败暴露）——
 *   内核（`layout-core-rust/src/ffi.rs`）对 `display`/`position`/`overflow`/`flexDirection` 只认**固定值**，
 *   其余值 ⇒ `RustLayout.create` 失败（**整个小程序/App 树建不起来**）。
 *   ⇒ 编译期折叠这些键时**必须校验**：CSS 里的 `display: block/inline-block/grid/inline-flex`（App 无对等）
 *     以前**原样透传** ⇒ 端上崩。现改为：不支持的值 ⇒ **诊断 + 跳过**（用内核默认，不传非法值）。
 *   ★诚实边界：这是"App 端 CSS 支持面收窄"的落点之一（CSS 里合法的值在 App 未必有对等）。
 */
export const APP_ENUM_VALUES: Record<string, readonly string[]> = {
  display: ['flex', 'none'],
  position: ['static', 'relative', 'absolute'],
  overflow: ['visible', 'hidden', 'scroll', 'auto'],
  flexDirection: ['row', 'column', 'row-reverse', 'column-reverse'],
  flexWrap: ['nowrap', 'wrap', 'wrap-reverse'],
}

/** 绘制字段（宿主自绘读这些键；模板照样要带上，否则挂载后无底色/无字色） */
export const APP_PAINT_FIELDS = ['backgroundColor', 'color', 'fontSize', 'fontWeight', 'textAlign', 'borderRadius', 'borderColor', 'borderWidth', 'opacity', 'boxShadow'] as const
const PAINT_FIELDS = new Set<string>(APP_PAINT_FIELDS)
/**
 * ★批次 4（CSS 兼容对齐）：`text-align` 的**封闭集**（App 自绘文本在盒内的水平对齐）。
 *   宿主映射：iOS `CATextLayer.alignmentMode` · Android `Paint.Align` · 鸿蒙 `OH_Drawing_TextAlign`。
 *   `justify`/`start`/`end` 等未列 ⇒ 诊断跳过（不静默当默认）。
 */
export const APP_TEXT_ALIGN_VALUES = ['left', 'center', 'right'] as const
/** 四边简写字段（`margin`/`padding` → 结构化 `{top,right,bottom,left}`） */
export const APP_EDGE_FIELDS = ['margin', 'padding'] as const
/** 百分比宽高折叠出的**比例字段**（App 端原生支持 `widthRatio`/`heightRatio`；非长度、不乘密度） */
export const APP_DERIVED_FIELDS = ['widthRatio', 'heightRatio'] as const
/** 特殊透传键（App 两内核恒 border-box ⇒ `box-sizing` 只作忠实记录、无副作用） */
export const APP_SPECIAL_FIELDS = ['boxSizing'] as const

/**
 * ★★★批次 1（CSS 兼容对齐 · 层叠正确性）：**可继承的引擎字段**（App 文本模型的子集）。
 *
 * 【为什么必须编译期折叠】App 端**无运行时 CSS 引擎** ⇒ 继承（CSS 默认：`color`/`font-size` 等
 *   沿树向下传播）必须在**编译期**算进每个节点的 computed style（Profile §3 L0「继承」）。
 *   Web/Skyline 由各自 CSS 引擎按标准处理，本仓**不干预**（只折叠 App 面）。
 * 【为什么只有这两个】App 折叠面里语义上可继承的只有文本色/字号；背景/边框/圆角/不透明度
 *   在 CSS 里**不继承**（见 Profile §3 可继承/不可继承表）⇒ 不得纳入。
 */
export const APP_INHERITABLE_FIELDS = ['color', 'fontSize', 'fontWeight'] as const

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

/**
 * ★★★**内置组件名规范化**（2026-10-03 · 静默风险批次）——kebab-case 形态 → PascalCase。
 *
 * 【为什么必须有（本仓实测的静默缺陷）】Vue 官方**同时接受** `<KeepAlive>` 与 `<keep-alive>`
 *   （官方编译器把后者也解析成 `_KeepAlive`——已实证）；而我方判据（`tag in LOGICAL_CONTAINERS`、
 *   动态组件 `tag === 'component'` 等）此前**只认 PascalCase** ⇒ 写 `<keep-alive>` /
 *   `<transition>` / `<teleport>` / `<suspense>` 时：
 *   · **多建一层盒**（几何与 Vue 不等价——"透传"根本没生效）；
 *   · **零诊断**（最危险的一类静默：用户以为用了内置组件，实际是普通容器）。
 *
 * 【规范化什么、不规范化什么（收窄原则）】只规范化**确定性等价**的短名单（Vue 内置组件名）——
 *   对每个 `<keep-alive>` 都自动"翻成" `KeepAlive` 正是 Vue 官方行为的等价物（官方编译器亦如此）。
 *   不引入一般性大小写转换（那会误伤用户的 `<my-comp>` 自定义标签语义——PascalCase 才是组件约定）。
 *
 * ★本函数是**唯一入口**：template.ts / deps.ts / events.ts 三处 id 分配共用同一份判据
 *   （本仓纪律："同一语义只允许一处实现"，此前三处各写一遍 kebab 判据必漂移）。
 */
export function normalizeBuiltinTag(tag: string): string {
  switch (tag) {
    case 'keep-alive': return 'KeepAlive'
    case 'transition': return 'Transition'
    case 'transition-group': return 'TransitionGroup'
    case 'teleport': return 'Teleport'
    case 'suspense': return 'Suspense'
    case 'component': return 'component'   // 动态组件：小写本就是规范写法
    default: return tag
  }
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
const EDGE_FIELDS = new Set<string>(APP_EDGE_FIELDS)

const kebabToCamel = (s: string): string => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

/**
 * 解析 `style="a: b; c: d"` 静态样式串 → 引擎字段
 *
 * 【为什么支持字符串而不只支持 `:style="{}"`（模板常见写法）】SFC 里静态样式几乎都写成
 *   `style="height: 56px; ..."`；不支持它等于"模板里的样式全部丢失且无提示"。
 *   本函数对**认不出的键/值**产出诊断（不静默吞——本仓纪律）。
 */
/**
 * ★批次 10：`box-shadow` 解析（单层：`<dx> <dy> <blur> [<spread>] <color>`）。
 *   · 长度 token → 数值（px）；颜色 token → `normalizeCssColor` 归一 hex；
 *   · `inset` / 多重阴影（含 `,`）⇒ 只取第一层（调用方诊断）；解析不出 ⇒ null。
 *   ★诚实边界：无 blur 渲染时各端用 blur 近似（见宿主）；`inset` 内阴影不支持。
 */
function parseBoxShadow(raw: string, toNum: (v: string) => number | undefined): { dx: number; dy: number; blur: number; spread: number; color: string } | null {
  // 多重阴影：取第一段（逗号分隔，**括号深度 0 处**才切——`rgba(0,0,0,..)` 内的逗号不算）
  let depth = 0
  let cut = raw.length
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) { cut = i; break }
  }
  const first = raw.slice(0, cut).trim()
  if (!first || /\binset\b/i.test(first)) return null
  // 按**括号深度 0 处的空白**切 token（`rgba(0, 0, 0, 0.15)` 内的空格不算——不能裸 split）
  const toks: string[] = []
  {
    let d = 0
    let cur = ''
    for (const ch of first) {
      if (ch === '(') d++
      else if (ch === ')') d--
      if (/\s/.test(ch) && d === 0) { if (cur) { toks.push(cur); cur = '' } continue }
      cur += ch
    }
    if (cur) toks.push(cur)
  }
  let color: string | undefined
  const nums: number[] = []
  for (const tok of toks) {
    if (/^[a-z]+$/i.test(tok) && !/^0$/.test(tok)) continue // 关键字（none 等）
    const c = normalizeCssColor(tok)
    if (c !== undefined && /^#|rgb|hsl|var\(|transparent/i.test(tok)) { color = c; continue }
    const n = toNum(tok)
    if (n !== undefined) nums.push(n)
  }
  if (color === undefined || nums.length < 2) return null
  return { dx: nums[0] ?? 0, dy: nums[1] ?? 0, blur: nums[2] ?? 0, spread: nums[3] ?? 0, color }
}

/**
 * ★批次 9（CSS 兼容对齐 · 超级应用承载）：**CSS 自定义属性（设计令牌）→ 编译期折叠**。
 *
 * 【为什么必须有（超级应用最大的结构缺口）】现代前端/组件库几乎全靠设计令牌
 *   （`var(--sp-3)` / `var(--brand)`）——真项目里 `var()` 出现 **242 处**。App 折叠面**无运行时
 *   CSS 引擎** ⇒ `var()` 编译期不解析就整条丢弃（"布局对、样式空"）。Web/Skyline 由各自 CSS
 *   运行时处理 `var()`（本仓不干预），App 端在编译期把令牌**替换成字面值**。
 *
 * 【令牌来源】项目 `proteus.config.ts` 的 `globalStyle`（如 `styles/tokens.css`）——同一份
 *   令牌文件 Web/MP/App 三端消费（单一事实源）。本函数解析其中的 `--name: value` 声明。
 *
 * 【诚实边界】只支持**字面值**令牌（含 `var()` 引用另一令牌 ⇒ 递归展开）；`calc()`/`env()` 等
 *   动态令牌值不解析（保留 `var()` 由调用方诊断）。`@media` 内的令牌同样被提取（无媒体上下文，
 *   取声明值——与"取任一值"的保守一致）。
 */
export function parseCssVarTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) out[m[1]!.trim()] = m[2]!.trim()
  return out
}

/** 把 `var(--x[, fallback])` 替换为令牌值（递归展开；未知且无 fallback ⇒ 原样保留）。 */
export function substituteCssVars(value: string, tokens: Record<string, string>): string {
  if (!value.includes('var(')) return value
  let v = value
  for (let i = 0; i < 8; i++) {
    let changed = false
    v = v.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*))?\)/g, (full, name: string, fallback?: string) => {
      const t = tokens[name]
      if (t !== undefined) { changed = true; return t }
      if (fallback !== undefined) { changed = true; return fallback.trim() }
      return full
    })
    if (!changed) break
  }
  return v
}

export function parseStaticStyle(
  css: string,
  pushDiag: (msg: string, hint?: string) => void,
  /** ★批次 1：**逐属性**记录哪些引擎字段来自 `!important` 声明（层叠排序用；缺省不记） */
  importantOut?: Set<string>,
  /** ★批次 9：设计令牌表（`--name` → 值）——`var()` 编译期折叠；缺省则 var() 原样（会在后续诊断） */
  tokens?: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const part of css.split(';')) {
    const t = part.trim()
    if (!t) continue
    const idx = t.indexOf(':')
    if (idx < 0) continue
    const rawKey = t.slice(0, idx).trim()
    let rawVal = t.slice(idx + 1).trim()
    if (!rawKey || !rawVal) continue
    // ★批次 1：识别并剥离 `!important`（逐声明）——重要性参与层叠排序（见 cascadeStyles）
    let important = false
    const impMatch = /^(.*?)\s*!important\s*$/i.exec(rawVal)
    if (impMatch) { rawVal = impMatch[1]!.trim(); important = true }
    // ★批次 9：`var()` 令牌折叠（在键/值解析**之前**——令牌可能承载整个值或一段）
    if (tokens) rawVal = substituteCssVars(rawVal, tokens)
    const markImportant = (engineKey: string): void => { if (important) importantOut?.add(engineKey) }
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
      markImportant(f)
      continue
    }
    if (EDGE_FIELDS.has(key)) {
      // ★批次 2（值归一化）：四值简写 `margin/padding: a [b [c [d]]]`（CSS 标准展开）——
      //   真项目高频（`margin: 8px 0`、`padding: 8px 12px`），此前**整体丢弃 + 诊断**。
      //   `auto` 无内核对等 ⇒ 该边不设（其余边照设），不拖垮整条规则。
      const box = expandBoxShorthand(rawVal, numOf)
      if (!box) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 无法解析为四值简写（支持 1–4 个 px/数字；auto 忽略）`); continue }
      out[key] = box
      markImportant(key)
      continue
    }
    // ★★`box-sizing`（2026-10-02）：**Web/MP 由 CSS 引擎读**（百分比宽度 + 横向 padding 要
    //   正确收进盒内，必须显式 border-box——各端默认值不同，显式声明才跨端一致）；
    //   App 两内核**恒为 border-box**（taffy `BoxSizing::BorderBox` / TS 核心「宽高含 padding」）
    //   ⇒ 该键进产物后对端上是无副作用的忠实记录（Rust serde 忽略未知键、Android 白名单不收）。
    if (key === 'boxSizing') {
      out[key] = rawVal
      markImportant(key)
      continue
    }
    if (LAYOUT_FIELDS.has(key)) {
      if (key === 'flexDirection' || key === 'flexWrap' || key === 'justifyContent' || key === 'alignItems' || key === 'alignSelf' || key === 'position' || key === 'display' || key === 'overflow') {
        // ★★★枚举值**校验**（2026-10-04 修：真机 RustLayout.create 失败暴露）——内核只认封闭集；
        //   不支持的值（如 `display: block/grid`、`position: sticky`）⇒ **诊断 + 跳过**（用内核默认），
        //   否则原样透传会让**整棵树建不起来**（App/小程序端页面全崩）。
        const allowed = APP_ENUM_VALUES[key]
        if (allowed && !allowed.includes(rawVal)) {
          pushDiag(
            `\`${rawKey}: ${rawVal}\` 不是 App 引擎支持的值（${key} 仅认：${allowed.join(' / ')}）——已跳过（用引擎默认）`,
            'App 端无浏览器 CSS 布局引擎：把该样式改为引擎支持的值，或保留 Web 端渲染（该值在 Web/MP 由 CSS 引擎处理）',
          )
          continue
        }
        out[key] = rawVal
        markImportant(key)
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
          const ratioKey = key === 'width' ? 'widthRatio' : 'heightRatio'
          out[ratioKey] = Number(pct[1]) / 100
          markImportant(ratioKey)
          continue
        }
      }
      const num = numOf(rawVal)
      if (num === undefined) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 不是纯数值（支持 px/数字/百分比宽高）`); continue }
      out[key] = num
      markImportant(key)
      continue
    }
    if (PAINT_FIELDS.has(key)) {
      if (key === 'fontWeight') {
        // ★批次 3：`font-weight`（真项目第 2 高频丢弃项）——`normal`/`bold` 关键字 + 100–900 数值
        //   归一为**数值**（宿主按 `weight >= 600 ⇒ bold` 判定——见 Android typefaceOf / iOS）。
        const w = normalizeFontWeight(rawVal)
        if (w === undefined) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 不是合法字重（normal/bold/100–900）`); continue }
        out[key] = w
        markImportant(key)
        continue
      }
      if (key === 'textAlign') {
        // ★批次 4：`text-align`——封闭集 left/center/right（宿主文本对齐通道；值原样下发）
        const v = rawVal.trim().toLowerCase()
        if (!(APP_TEXT_ALIGN_VALUES as readonly string[]).includes(v)) {
          pushDiag(`\`${rawKey}: ${rawVal}\` 不是 App 支持的对齐（仅 ${APP_TEXT_ALIGN_VALUES.join(' / ')}）——已跳过`)
          continue
        }
        out[key] = v
        markImportant(key)
        continue
      }
      if (key === 'boxShadow') {
        // ★批次 10：`box-shadow` → 结构化 boxShadow（宿主绘制；见 parseBoxShadow）
        const sh = parseBoxShadow(rawVal, numOf)
        if (!sh) {
          pushDiag(
            `box-shadow \`${rawVal}\` 未解析（支持 dx dy blur [spread] color；多重阴影取首个）——已跳过`,
            'App 端盒阴影为单层：`box-shadow: 0 2px 8px rgba(0,0,0,0.15)`；`inset`/多重阴影暂不支持',
          )
          continue
        }
        out.boxShadow = sh
        markImportant('boxShadow')
        continue
      }
      if (key === 'backgroundColor' || key === 'color' || key === 'borderColor') {
        // ★★★颜色**归一化**（2026-10-04 修：真机 RustLayout.create 失败暴露）——内核 `parse_css_color`
        //   只认 `#RGB/#RRGGBB/#RRGGBBAA` 十六进制；CSS 常见的 `rgb()/rgba()/transparent` 原样透传
        //   ⇒ create 拒绝 ⇒ **整棵树建不起来**（页面全崩）。⇒ 编译期把常见形态归一为 hex。
        const norm = normalizeCssColor(rawVal)
        if (!norm) {
          pushDiag(
            `颜色 \`${rawKey}: ${rawVal}\` 无法归一为 App 引擎接受的十六进制（#RGB/#RRGGBB/#RRGGBBAA）——已跳过`,
            'App 端颜色只支持 hex / rgb() / rgba() / transparent；命名色（red 等）请改 hex',
          )
          continue
        }
        out[key] = norm
      } else {
        const num = numOf(rawVal)
        if (num === undefined) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 不是纯数值`); continue }
        out[key] = num
      }
      markImportant(key)
      continue
    }
    // ★批次 2（值/简写归一化）：`background` 简写 → backgroundColor（仅纯色；渐变/图片另走通道）
    if (key === 'background') {
      const color = extractBackgroundColor(rawVal)
      if (!color) {
        pushDiag(
          `background 简写 \`${rawVal}\` 未归一为纯色（仅支持单色；渐变请用引擎 \`fill-gradient\` 通道）——已跳过`,
          '纯色 `background: #fff` 会折进 backgroundColor；`linear-gradient` 等请改用 fill-gradient 属性',
        )
        continue
      }
      out.backgroundColor = color
      markImportant('backgroundColor')
      continue
    }
    // ★批次 5（CSS 兼容对齐 · 边框）：`border` 简写 → borderWidth + borderColor（uniform solid）。
    if (key === 'border') {
      const b = parseBorderShorthand(rawVal)
      if (b.width === undefined && b.color === undefined) {
        pushDiag(
          `border 简写 \`${rawVal}\` 未解析出宽度/颜色（仅支持 uniform 单色实线，如 \`1px solid #ccc\`）——已跳过`,
          'App 端边框为**统一实线**：`border: <width> solid <color>`；虚线/逐边（border-bottom 等）/var() 暂不支持',
        )
        continue
      }
      if (b.width !== undefined) { out.borderWidth = b.width; markImportant('borderWidth') }
      if (b.color !== undefined) { out.borderColor = b.color; markImportant('borderColor') }
      else {
        // 宽度有、颜色没解析出（多为 var() 令牌色）⇒ 边框不可见，如实诊断（不静默当已支持）
        pushDiag(
          `border 简写 \`${rawVal}\` 的颜色未解析（` +
            (/\bvar\(/.test(rawVal) ? 'var() 编译期不可解析' : '非 hex/rgb/rgba 颜色') +
            '）——该边框不会绘制',
          '把颜色写为 hex（如 #e3e6eb）；var() 令牌色当前不在 App 折叠面内',
        )
      }
      continue
    }
    // `border-style`：宿主只画**实线**——solid 视为无操作，其余如实诊断（不静默当实线）
    if (key === 'borderStyle') {
      const s = rawVal.trim().toLowerCase()
      if (s !== 'solid' && s !== 'none') {
        pushDiag(`\`border-style: ${rawVal}\` 未支持（App 端边框仅实线 solid）——已按无边框处理`)
      }
      continue
    }
    // ★批次 7（CSS 兼容对齐 · flex 简写）：`flex` → flexGrow/flexShrink/flexBasis（引擎已支持这三者）
    if (key === 'flex') {
      const f = parseFlexShorthand(rawVal, numOf)
      if (!f) {
        pushDiag(`\`flex: ${rawVal}\` 未解析（支持 grow [shrink [basis]] / none / auto）——已跳过`)
        continue
      }
      if (f.grow !== undefined) { out.flexGrow = f.grow; markImportant('flexGrow') }
      if (f.shrink !== undefined) { out.flexShrink = f.shrink; markImportant('flexShrink') }
      if (f.basis !== undefined) { out.flexBasis = f.basis; markImportant('flexBasis') }
      continue
    }
    // 逐边边框（`border-bottom` 等）：引擎/宿主只支持**统一**边框 ⇒ 如实诊断（不静默丢弃）
    if (/^border(Top|Right|Bottom|Left)(Width|Color|Style)?$/.test(key) || /^border(Top|Right|Bottom|Left)$/.test(key)) {
      pushDiag(
        `\`${rawKey}\` 逐边边框未支持（App 端仅统一 \`border\`）——已跳过`,
        '改用统一 `border: 1px solid #ccc`；或该边用独立元素/背景色近似',
      )
      continue
    }
    // 认不出的键：诊断（可能是指令/伪类等不需要的键——故用 hint 说明而非 error）
    pushDiag(`style 里 \`${rawKey}\` 不在引擎字段表内（已忽略）`, '引擎字段见 packages/compiler/src/vapor/template.ts 的 LAYOUT_FIELDS/PAINT_FIELDS')
  }
  return out
}

/**
 * ★★★C1（2026-10-04 · App 三端对齐缺口 C1）：**SFC `<style>` 选择器规则 → 可匹配的规则表**。
 *
 * 【为什么需要】App 路径**没有 CSS 引擎**——`buildLayoutTemplate` 只吃节点上的 **inline `style`**；
 *   真实项目的样式多在 **`<style>` + `class`** 里 ⇒ App 端页面「有结构、无样式」。本族函数把 `<style>`
 *   里**可静态解析的选择器**规则抽成结构，供模板节点按 `class` / `tag`（+ 祖先链）匹配合并。
 *
 * 【支持的选择器子集（如实，不假装全支持）】
 *   · 类型（元素）选择器：`h3` / `code`（按节点原始 tag 匹配）；可与类复合：`p.foo`；
 *   · 类选择器：`.a` · 复合 `.a.b`（同元素须同时有这些类）；
 *   · 后代/子组合：`.a .b`（后代）· `.a > .b`（直接子）——用**祖先链**（tag+class）匹配；
 *   · **跳过**：伪类 `:` / 伪元素 `::` / 属性 `[x]` / `*` / `+`~` 兄弟 / `@media`——
 *     `@keyframes` 块整体**不算选择器**（其 `from/to/0%` 不是选择器——旧实现会误当元素选择器，已修）。
 *   ★scoped：规则里的类名带后缀（`.a-data-v-x`）⇒ 抽出时**去后缀**（`stripScopeSuffix`），与元素原始类名对齐。
 * 【层叠】规则**按源序**依次 Object.assign（同属性后声明胜）——★修正了"按 class 属性序"的错误层叠。
 * 【诚实边界】无**特异性**权重（只按源序）· 无继承 · 只静态类（动态 `:class` 值形态不可展开）。
 */
export interface ClassStyleSegment {
  /** 该段要求的类名集合（复合 `.a.b` ⇒ `['a','b']`；可空） */
  classes: string[]
  /** 该段要求的类型（元素）名（`h3` / `code`；可空） */
  tag?: string
}

export interface ClassStyleRule {
  /** 选择器链（每段 = tag 和/或类集） */
  segments: ClassStyleSegment[]
  /** 段间组合符（长度 = segments.length - 1；空格 = 后代、`>` = 直接子）——用 string[] 避免泛型嵌套歧义 */
  combinators: string[]
  /** 该规则折叠出的引擎字段声明（源序） */
  decls: Record<string, unknown>
  /** ★批次 1：**特异性** `(id, class, tag)`（只支持 class/tag ⇒ id 恒 0；`.a.b`=(0,2,0)、`h3.x`=(0,1,1)） */
  specificity: [number, number, number]
  /** ★批次 1：**来自 `!important` 的引擎字段**（层叠排序用——important 声明优先于非 important） */
  important: Set<string>
  /** ★批次 1：**源序**（样式表里的出现序；相同 (importance, specificity) 时后写的胜） */
  order: number
}

/** 计算选择器链的特异性 `(id, class, tag)`——只统计 class 段与 tag 段（id 选择器不支持 ⇒ 恒 0） */
function specificityOf(segments: ClassStyleSegment[]): [number, number, number] {
  let a = 0 // id
  let b = 0 // class
  let c = 0 // type
  for (const seg of segments) {
    b += seg.classes.length
    if (seg.tag) c += 1
  }
  return [a, b, c]
}

/** 解析 `<style>` 文本 → 选择器规则表（源序）；不支持的整条跳过并计数（调用方决定是否诊断） */
export function parseClassRules(css: string, tokens?: Record<string, string>): { rules: ClassStyleRule[]; skipped: number } {
  const rules: ClassStyleRule[] = []
  let skipped = 0
  let order = 0
  // ★先剔除 `@keyframes` 块（含嵌套 `{}`）——其 `from/to/0%` 不是选择器（旧实现误当元素选择器 ⇒ 噪音）。
  const noKf = stripAtRuleBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ''), 'keyframes')
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = ruleRe.exec(noKf))) {
    const selector = m[1]!.trim()
    const decls = m[2]!.trim()
    if (!decls || !selector) continue
    if (selector.startsWith('@')) {
      // 其余 at-rule（@media/@supports/@font-face…）——整条跳过（诚实计数）
      skipped++
      continue
    }
    // 分组选择器 `a, b`：逐条拆（只保留可解析的）
    for (const one of selector.split(',')) {
      const parsed = parseSelectorChain(one.trim())
      if (!parsed) {
        skipped++
        continue
      }
      const important = new Set<string>()
      const style = parseStaticStyle(decls, () => {}, important, tokens)
      if (Object.keys(style).length === 0) continue
      rules.push({
        segments: parsed.segments,
        combinators: parsed.combinators,
        decls: style,
        specificity: specificityOf(parsed.segments),
        important,
        order: order++,
      })
    }
  }
  return { rules, skipped }
}

/** 剔除 `@<name> … { … }` 块（含嵌套大括号——`@keyframes` 的关键帧块是嵌套的） */
function stripAtRuleBlocks(css: string, name: string): string {
  const re = new RegExp(`@${name}[^{}]*\\{`, 'i')
  let out = css
  let m: RegExpExecArray | null
  while ((m = re.exec(out))) {
    const start = m.index
    // 从 `{` 起做深度匹配找配对 `}`
    let depth = 0
    let end = -1
    for (let i = out.indexOf('{', start); i < out.length; i++) {
      if (out[i] === '{') depth++
      else if (out[i] === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end < 0) break
    out = out.slice(0, start) + out.slice(end + 1)
  }
  return out
}

/** 解析单条选择器为「段 + 组合符」链；不支持的形态返回 null（伪类/属性/`*`/兄弟等） */
function parseSelectorChain(sel: string): { segments: ClassStyleSegment[]; combinators: Array<' ' | '>'> } | null {
  if (!sel) return null
  // 不支持：伪类/伪元素、属性选择器、兄弟组合、插值、通配
  if (/[:[\]*]|\+~/.test(sel)) return null
  // 按 `>`（子）与空白（后代）切段；先统一 `A>B` → `A > B`
  const normalized = sel.replace(/\s*>\s*/g, ' > ')
  const parts = normalized.split(/\s+/).filter(Boolean)
  const segments: ClassStyleSegment[] = []
  const combinators: Array<' ' | '>'> = []
  for (const part of parts) {
    if (part === '>') {
      if (segments.length === 0) return null // 以 > 开头
      combinators[segments.length - 1] = '>'
      continue
    }
    // 段：可选**类型名** + 零或多类（`.a.b` ⇒ classes=['a','b']；`h3` ⇒ tag='h3'；`p.foo` ⇒ tag='p' + ['foo']）
    const classes = [...part.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((x) => stripScopeSuffix(x[1]!))
    const tagPart = part.replace(/\.[A-Za-z_][\w-]*/g, '')
    // 类型名合法形态：单个标识符（字母开头）；其余（含 `#id`、残留符号）⇒ 不支持
    if (tagPart && !/^[A-Za-z][\w-]*$/.test(tagPart)) return null
    if (!tagPart && classes.length === 0) return null // 空段
    if (segments.length > 0 && combinators[segments.length - 1] === undefined) combinators[segments.length - 1] = ' '
    segments.push(tagPart ? { classes, tag: tagPart } : { classes })
  }
  if (segments.length === 0) return null
  return { segments, combinators }
}

/** 节点匹配上下文：类集合 + 类型名（tag） */
export interface StyleMatchNode {
  classes: Set<string>
  /** 节点原始 tag（如 `h3`/`code`/`div`/`p-button`）；用于类型选择器匹配 */
  tag?: string
}

/** 该节点是否满足某段要求（段的每个类都在集合里 + tag 相符） */
function segmentMatches(seg: ClassStyleSegment, node: StyleMatchNode): boolean {
  if (seg.tag && seg.tag !== node.tag) return false
  return seg.classes.every((c) => node.classes.has(c))
}

/**
 * 按**祖先链 + 自身**（tag+class）匹配规则表，返回合并后的声明。
 *
 * 【层叠（★批次 1 修正）】命中规则按 **特异性升序 + 源序** 依次应用（后应用者胜）；
 *   `!important` 声明进入独立层，**始终优先**于非 important（与 CSS 一致——important 与特异性正交）。
 *   ★修正了此前"只按源序"的缺陷（`.a` 后写本不该盖过 `#id`/`.a.b` 的高特异性）。
 * @param rules parseClassRules 产物
 * @param ancestors 祖先链（根 → 父）
 * @param self 本节点
 */
/** `resolveClassStyles` 的产物：合并后的引擎声明 + **哪些键来自 `!important`**（供与 inline 层比较） */
export interface ResolvedClassStyles {
  styles: Record<string, unknown>
  important: Set<string>
}

export function resolveClassStyles(
  rules: ClassStyleRule[],
  ancestors: StyleMatchNode[],
  self: StyleMatchNode,
): ResolvedClassStyles {
  const matched = rules.filter((rule) => matchChain(rule, ancestors, self))
  // 特异性升序 + 源序（后应用者胜）；特异性比较按 (id, class, tag) 字典序
  matched.sort((x, y) => {
    for (let i = 0; i < 3; i++) {
      const d = (x.specificity[i] ?? 0) - (y.specificity[i] ?? 0)
      if (d !== 0) return d
    }
    return x.order - y.order
  })
  const normal: Record<string, unknown> = {}
  const important: Record<string, unknown> = {}
  const importantKeys = new Set<string>()
  for (const rule of matched) {
    for (const [k, v] of Object.entries(rule.decls)) {
      if (rule.important.has(k)) { important[k] = v; importantKeys.add(k) }
      else normal[k] = v
    }
  }
  return { styles: { ...normal, ...important }, important: importantKeys } // important 优先
}

/** 选择器链匹配（从右往左：自身匹配末段，再按组合符回溯祖先） */
function matchChain(rule: ClassStyleRule, ancestors: StyleMatchNode[], self: StyleMatchNode): boolean {
  const { segments, combinators } = rule
  const last = segments.length - 1
  if (!segmentMatches(segments[last]!, self)) return false
  // 依次匹配前缀段（i 从 last-1 到 0）；组合符 combinators[i] 描述段 i 与 i+1 的关系
  let ai = ancestors.length - 1 // 当前可用的最近祖先下标（从父往上）
  for (let i = last - 1; i >= 0; i--) {
    const comb = combinators[i]!
    if (comb === '>') {
      if (ai < 0 || !segmentMatches(segments[i]!, ancestors[ai]!)) return false
      ai--
    } else {
      // 后代：在剩余祖先里向上找**任一**匹配段
      let found = false
      while (ai >= 0) {
        if (segmentMatches(segments[i]!, ancestors[ai]!)) {
          found = true
          ai--
          break
        }
        ai--
      }
      if (!found) return false
    }
  }
  return true
}

/**
 * 兼容旧 API：`<style>` → 「单一简单类 → 声明」平坦表（仅单段规则；供无需祖先链的简用处/测试）。
 * ★内部复用 parseClassRules（**一处实现**）。
 */
export function parseClassStyles(
  css: string,
  pushDiag?: (msg: string, hint?: string) => void,
  tokens?: Record<string, string>,
): Record<string, Record<string, unknown>> {
  const { rules, skipped } = parseClassRules(css, tokens)
  const out: Record<string, Record<string, unknown>> = {}
  for (const r of rules) {
    // 兼容旧形态：只收「单段、纯类」规则（`segments[0]` 无 tag 且恰一个类）
    const seg0 = r.segments[0]
    if (r.segments.length === 1 && seg0 && !seg0.tag && seg0.classes.length === 1) {
      const name = seg0.classes[0]!
      out[name] = { ...(out[name] ?? {}), ...r.decls }
    }
  }
  if (skipped > 0 && pushDiag) {
    pushDiag(
      `<style> 中有 ${skipped} 条**不支持的选择器**规则被跳过（支持：类/元素选择器 + 后代/子组合）`,
      'App 端无 CSS 引擎：伪类/属性/兄弟/`@media` 等暂不支持；把关键样式改为类/元素选择器或 inline style，或保留 Web 端渲染',
    )
  }
  return out
}

/**
 * ★★★C1 颜色归一（2026-10-04 修：真机 `RustLayout.create` 失败暴露）——CSS 颜色 → 内核接受的 hex。
 *
 * 【为什么需要】内核 `parse_css_color` 只认 `#RGB/#RRGGBB/#RRGGBBAA`；CSS 常见的 `rgb()/rgba()`
 *   （真实项目大量使用）原样透传 ⇒ create 拒绝 ⇒ **整棵树建不起来**。⇒ 编译期归一。
 * 【支持】`#rgb`/`#rrggbb`/`#rrggbbaa`（原样）· `rgb(r,g,b)` · `rgba(r,g,b,a)`（a 可为 0..1 小数或 0-255）·
 *   `transparent`（→ #00000000）。其余（命名色 / hsl / var()）⇒ 返回 undefined（调用方诊断 + 跳过）。
 * 【输出序】`#RRGGBB`（不透明）或 `#RRGGBBAA`（含 alpha）——与内核 parse_css_color 的 CSS4 序一致。
 */
export function normalizeCssColor(raw: string): string | undefined {
  const s = raw.trim().toLowerCase()
  if (!s) return undefined
  if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$|^#[0-9a-f]{8}$/.test(s)) return s
  if (s === 'transparent') return '#00000000'
  const m = /^rgba?\(([^)]*)\)$/.exec(s)
  if (!m) return undefined
  const parts = m[1].split(',').map((x) => x.trim())
  if (parts.length < 3) return undefined
  const ch = (t: string): number | undefined => {
    if (/%$/.test(t)) { const n = Number(t.slice(0, -1)); return Number.isFinite(n) ? Math.round((n / 100) * 255) : undefined }
    const n = Number(t)
    return Number.isFinite(n) ? Math.round(n) : undefined
  }
  const r = ch(parts[0]), g = ch(parts[1]), b = ch(parts[2])
  if (r === undefined || g === undefined || b === undefined) return undefined
  const cl = (n: number): number => Math.max(0, Math.min(255, n))
  const hx = (n: number): string => cl(n).toString(16).padStart(2, '0')
  if (parts.length >= 4) {
    let a = 1
    const at = parts[3]
    if (/%$/.test(at)) { const n = Number(at.slice(0, -1)); if (Number.isFinite(n)) a = n / 100 }
    else { const n = Number(at); if (Number.isFinite(n)) a = n > 1 ? n / 255 : n }
    return '#' + hx(r) + hx(g) + hx(b) + hx(Math.round(a * 255))
  }
  return '#' + hx(r) + hx(g) + hx(b)
}
/** 去 scoped 后缀（`foo-data-v-abc123` / `foo-data-v-abc` → `foo`；无后缀原样返回） */
export function stripScopeSuffix(name: string): string {
  return name.replace(/-data-v-[A-Za-z0-9]+$/, '')
}

/** `56px` / `56` / `0.5` → 数值；`50%` / `auto` → undefined（百分比**宽高**在调用处另行映射为 widthRatio/heightRatio；其余属性的百分比仍不支持，见诊断） */
function numOf(v: string): number | undefined {
  const t = v.trim().replace(/px$/i, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/**
 * ★批次 2（值归一化）：`margin`/`padding` 的 **1–4 值简写** → `{top,right,bottom,left}`（CSS 标准展开）。
 *   `auto` / 不可解析的边 ⇒ 该边**不设**（其余边照设）；整条全是非数值 ⇒ 返回 undefined（调用方诊断）。
 *   ★为什么忽略 auto：内核对等无 auto（浏览器才有的"均分剩余空间"）——设一个错误数值反而更糟。
 */
function expandBoxShorthand(rawVal: string, toNum: (v: string) => number | undefined): Record<string, number> | null {
  const toks = rawVal.trim().split(/\s+/).filter(Boolean)
  if (toks.length === 0 || toks.length > 4) return null
  const n = toks.map(toNum) // undefined = 该边忽略（auto 等）
  let top: number | undefined
  let right: number | undefined
  let bottom: number | undefined
  let left: number | undefined
  if (n.length === 1) { top = right = bottom = left = n[0] }
  else if (n.length === 2) { top = bottom = n[0]; right = left = n[1] }
  else if (n.length === 3) { top = n[0]; right = left = n[1]; bottom = n[2] }
  else { top = n[0]; right = n[1]; bottom = n[2]; left = n[3] }
  const box: Record<string, number> = {}
  if (top !== undefined) box.top = top
  if (right !== undefined) box.right = right
  if (bottom !== undefined) box.bottom = bottom
  if (left !== undefined) box.left = left
  return Object.keys(box).length > 0 ? box : null
}

/**
 * ★批次 3：`font-weight` → 数值（100–900）。关键字：`normal`→400 / `bold`→700；`bolder`/`lighter`
 *   依赖父级（App 折叠面无上下文）⇒ 返回 undefined（调用方诊断，不猜）。
 */
function normalizeFontWeight(raw: string): number | undefined {
  const v = raw.trim().toLowerCase()
  if (v === 'normal') return 400
  if (v === 'bold') return 700
  const n = Number(v)
  if (Number.isFinite(n) && n >= 1 && n <= 1000) return Math.round(n)
  return undefined
}

/**
 * ★批次 7：`flex` 简写 → `{ grow?, shrink?, basis? }`（CSS `flex` 简写：`<grow> <shrink>? <basis>?`）。
 *   · `flex: <n>` ⇒ grow=n, shrink=1, basis=0（CSS 语义）；`flex: <g> <s>` ⇒ basis=0；
 *   · `flex: <g> <s> <b>` ⇒ basis=数值（`auto`/`content` 无内核对等 ⇒ basis 略过）；
 *   · `flex: none` ⇒ grow=0, shrink=0；`flex: auto` ⇒ grow=1, shrink=1（basis auto ⇒ 略过）。
 */
function parseFlexShorthand(raw: string, toNum: (v: string) => number | undefined): {
  grow?: number; shrink?: number; basis?: number
} | null {
  const toks = raw.trim().split(/\s+/).filter(Boolean)
  if (toks.length === 0 || toks.length > 3) return null
  const low = toks[0]!.toLowerCase()
  if (low === 'none') return { grow: 0, shrink: 0 }
  if (low === 'auto') return { grow: 1, shrink: 1 }
  const grow = toNum(toks[0]!)
  if (grow === undefined) return null
  const out: { grow?: number; shrink?: number; basis?: number } = { grow }
  if (toks[1] !== undefined) {
    const shrink = toNum(toks[1]!)
    if (shrink === undefined) return null
    out.shrink = shrink
  } else {
    out.shrink = 1 // CSS：`flex:<n>` 的默认 shrink = 1
  }
  if (toks[2] !== undefined) {
    const basis = toNum(toks[2]!) // `auto`/`content` 等 ⇒ undefined（略过 basis）
    if (basis !== undefined) out.basis = basis
  } else {
    out.basis = 0 // CSS：省略 basis ⇒ 0
  }
  return out
}

/**
 * ★批次 5：`border` 简写解析（`<width> <style> <color>` 任意顺序）→ `{ width?, color? }`。
 *   · width：长度 token（`1px`/`2`）→ 数值；`thin/medium/thick` 无内核对等 ⇒ 忽略；
 *   · style：solid/dashed/dotted/double/none —— 仅记录（宿主只画实线；由调用方决定诊断）；
 *   · color：`normalizeCssColor` 可归一者（hex/rgb/rgba/transparent）；`var()`/命名色 ⇒ 忽略。
 *   ★`var(--x)` 编译期无法解析（token 源不在 SFC 内）⇒ 该维度为 undefined（如实反映）。
 */
function parseBorderShorthand(raw: string): { width?: number; color?: string } {
  const out: { width?: number; color?: string } = {}
  const STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'none', 'hidden', 'groove', 'ridge', 'inset', 'outset'])
  const KEYWORDS = new Set(['thin', 'medium', 'thick', 'currentcolor'])
  for (const tok of raw.trim().split(/\s+/).filter(Boolean)) {
    const low = tok.toLowerCase()
    if (STYLES.has(low) || KEYWORDS.has(low)) continue
    if (out.color === undefined) {
      const c = normalizeCssColor(tok)
      if (c) { out.color = c; continue }
    }
    if (out.width === undefined) {
      const n = numOf(tok)
      if (n !== undefined && n > 0) { out.width = n; continue }
    }
  }
  return out
}

/**
 * ★批次 2（值归一化）：`background` 简写 → 可用的**纯色**值（hex/rgb/rgba/transparent 归一为 hex）。
 *   `none` / `url()` / `gradient()` 等无单一颜色 ⇒ undefined（调用方诊断；渐变需走引擎 fill-gradient 通道，属后续）。
 */
function extractBackgroundColor(rawVal: string): string | undefined {
  const v = rawVal.trim()
  if (!v || /^none$/i.test(v)) return undefined
  if (/url\(|gradient\(/i.test(v)) return undefined // 图片/渐变 ⇒ 非纯色（渐变走引擎通道，属后续批次）
  const whole = normalizeCssColor(v)
  if (whole) return whole
  // 复合值（`#fff url(...) no-repeat`）：逐 token 找第一个可归一为颜色的（normalizeCssColor 对非颜色返回 undefined）
  for (const tok of v.split(/\s+/)) {
    const c = normalizeCssColor(tok)
    if (c) return c
  }
  return undefined
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
  /** ★批次 9：设计令牌表（`--name`→值，来自项目 `globalStyle`）——SFC 内 `var()` 编译期折叠 */
  tokens?: Record<string, string>,
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

  // ★★★C1（2026-10-04）：把 SFC `<style>` 的**类规则**抽成规则表——
  //   供模板节点按 `class`（+ 祖先类链）匹配合并（App 路径无 CSS 引擎；真实项目样式多在 `<style>`+class）。
  //   支持：单类 `.a` / 复合 `.a.b` / 后代 `.a .b` / 子 `.a>.b`；其余跳过 + 诊断（见 parseClassRules）。
  const classRules: ClassStyleRule[] = []
  for (const blk of desc.styles ?? []) {
    if (!blk?.content) continue
    const { rules, skipped } = parseClassRules(blk.content, tokens)
    classRules.push(...rules)
    if (skipped > 0) {
      diag(
        `<style> 中有 ${skipped} 条**不支持的选择器**规则被跳过（支持：类选择器 + 后代/子组合）`,
        'App 端无 CSS 引擎：伪类/属性/元素选择器等暂不支持；把关键样式改为类选择器或 inline style，或保留 Web 端渲染',
        'VAPOR_STYLE_SELECTOR_UNSUPPORTED',
      )
    }
  }

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
     *   · `slotContentOf`：本次 walk 的直接子元素是**某个具名插槽的内容根** ⇒ 打 `slotFor: name`；
     *     `scopeVar` = 作用域插槽的变量名（`#x="sp"` ⇒ `'sp'`；见 P1-3 作用域插槽）。
     */
    slotCtx?: {
      parentIsComponent?: boolean
      slotContentOf?: string
      scopeVar?: string
      /** ★解构绑定（`{ errors }` ⇒ local/key 对；与 scopeVar 互斥） */
      scopeBindings?: Array<{ local: string; key: string }>
    },
    /**
     * ★C1（2026-10-04）：**祖先类链**（根 → 父；每项是那个祖先的类集合）——用于选择器组合匹配
     *   （`.a .b` / `.a > .b`）。递归时把当前元素的类追加进来。
     */
    ancestorClasses: StyleMatchNode[] = [],
    /**
     * ★批次 1（层叠正确性）：**从祖先继承下来的可继承字段值**（`color`/`fontSize`）——
     *   节点无显式值时填入，并（更新后）继续向下传。根为空。
     */
    inherited: Record<string, unknown> = {},
  ): void => {
    // ★★★**混排归一化**（2026-10-03 · 三处遍历的唯一入口）：`<p>文字 <b>x</b></p>` 这类
    //   元素+文本混排 ⇒ 每段连续文本合成一个 `p-text` 叶（自绘树里文本是元素属性，
    //   没有独立文本节点）——与元素兄弟按**文档序**排布（与 B 路适配器同构）。
    //   ★非混排 ⇒ **引用原样**（既有产物逐字节不变）；空白压缩逐条照抄 Vue condense
    //     （见 text-runs.ts 头注——不对齐会合成一堆缩进空白叶、节点数全错）。
    for (const raw of normalizedChildSequence(children)) {
      const n = raw as Node
      if (n.type !== 1 /* ELEMENT */) {
        // 文本/插值节点在**父元素**上处理（本函数只在元素遍历里被调用，见下方 children 过滤）
        continue
      }
      // ★★★kebab 形态的内置组件规范化（2026-10-03）：`<keep-alive>` ⇒ `KeepAlive` 等——
      //   官方同时接受两种写法（实证：官方编译器把 `<keep-alive>` 也解析成 `_KeepAlive`），
      //   而此前判据只认 PascalCase ⇒ 小写写法**多建盒 + 零诊断**（静默缺陷）。见 normalizeBuiltinTag。
      const tag = normalizeBuiltinTag(n.tag ?? '')
      // ★★★**插槽声明 `<template #x>`**（Vue 里 `template` 是**片段/插槽声明**、不产元素）：
      //   不占 id、不产节点；其**直接子元素**是该具名插槽的内容根（打 `slotFor`）。
      //   ★判据与 deps.ts/events.ts **同源**（有 v-slot 的 template ⇒ 跳过）。
      if (tag === 'template') {
        const vs = vSlotNameOf(n)
        if (vs !== undefined) {
          const name = vs === '' ? 'default' : vs
          const scope = vSlotScopeOf(n)
          // ★★★P1-3 作用域插槽（2026-10-03）：`#x="sp"` 的变量名随内容标记下发（分发时绑出口 props）。
          //   ★只支持**简单标识符**——解构形态（`#x="{ count }"`）需把出口 props 展开成别名，
          //     属"作用域绑定协议"的推广（独立批次）⇒ 精确诊断（不静默半支持）。
          let scopeVar: string | undefined
          let scopeBindings: Array<{ local: string; key: string }> | undefined
          if (scope) {
            // ★★★**解构形态**（2026-10-03）：`#default="{ errors }"` —— 此前被拒（真实缺口：
            //   组件库页面的错误提示就是这么写的）⇒ 现在解析成"局部名 → props 键"的绑定，
            //   分发时**解构**出口 props 进内容作用域（Vue 语义；见 compiler/slot-scope.ts）。
            const parsedScope = parseSlotScope(scope)
            if (parsedScope.kind === 'simple') {
              scopeVar = parsedScope.name
            } else if (parsedScope.kind === 'destructure') {
              scopeBindings = parsedScope.entries
            } else if (parsedScope.kind === 'unsupported') {
              diag(
                `作用域插槽的变量形态未支持：\`#${name}="${scope.slice(0, 24)}"\` —— ${parsedScope.reason}`,
                '支持两种写法：单名（`#default="sp"`，用 `sp.xxx`）或**对象解构**（`#default="{ errors }"`）；'
                + '其余形态（嵌套解构/默认值/剩余项）保留 Vue 渲染路径（L0）',
                'VAPOR_SLOT_SCOPE_DESTRUCTURE',
              )
            }
          }
          // 内容根标记：仅在「组件孩子」上下文中才有意义（slotCtx 决定标记名）
          walk((n.children ?? []) as unknown[], parentId, pendingTransition,
            slotCtx?.parentIsComponent ? { slotContentOf: name, scopeVar, scopeBindings } : slotCtx, ancestorClasses, inherited)
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
          walk((n.children ?? []) as unknown[], parentId, t ?? pendingTransition, slotCtx, ancestorClasses, inherited)
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
          walk(flattened, parentId, pendingTransition, slotCtx, ancestorClasses, inherited)
        } else {
          walk((n.children ?? []) as unknown[], parentId, pendingTransition, slotCtx, ancestorClasses, inherited)
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
      // ★★★C1 + 批次 1：按 `class`（静态类名）+ **祖先类链**匹配 `<style>` 规则表——先合并类样式
      //   （按 **!important + 特异性 + 源序** 层叠，见 resolveClassStyles），随后 inline `style` 覆盖之。
      //   ★只处理**静态** class（ATTRIBUTE）；动态 `:class` 的值形态不可静态展开（既有诊断覆盖）。
      const selfClasses = new Set<string>()
      /** ★C1：本节点的匹配上下文（tag + 类）——供选择器（含元素/类型）匹配与祖先链 */
      let selfMatch: StyleMatchNode | undefined
      /** ★批次 1：class 层里来自 `!important` 的字段（inline 普通声明**不能**盖过它） */
      let classImportant = new Set<string>()
      /** ★批次 1：inline `style` 里来自 `!important` 的字段（可盖过 class 普通；但不能盖 class important） */
      let inlineImportant = new Set<string>()
      {
        const clsAttr = (n.props ?? []).find(
          (p) => p.type === 6 /* ATTRIBUTE */ && p.name === 'class' && p.value?.content,
        ) as { value?: { content?: string } } | undefined
        const clsStr = clsAttr?.value?.content?.trim()
        if (clsStr) for (const cn of clsStr.split(/\s+/).filter(Boolean)) selfClasses.add(cn)
        // ★C1：元素/类型选择器按**节点原始 tag** 匹配（`tag` 已是 normalize 后的形态：`h3`/`code`/`p-button`）
        selfMatch = { classes: selfClasses, tag }
        if ((selfClasses.size || tag) && classRules.length) {
          const resolved = resolveClassStyles(classRules, ancestorClasses, selfMatch)
          Object.assign(style, resolved.styles)
          classImportant = resolved.important
        }
      }
      // 本元素并入祖先链（tag+classes），供子节点组合匹配（`.a .b` / `h3 .x` / `.a > .b`）
      const childAncestors = selfMatch ? [...ancestorClasses, selfMatch] : ancestorClasses
      let hasDynamicStyle = false
      // ★P3-5 宿主指令收集器（声明在 props 扫描**之前**——扫描循环里 push；挂在节点上见下）
      let hostDirectives: NonNullable<LayoutNode['directives']> | undefined
      // ★混排（2026-10-03）：本元素是否有 `v-text`（有 ⇒ 覆盖子节点，不做混排合成）
      let hasVText = false
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
        // ★★★**宿主指令**（P3-5 自定义指令，2026-10-03）——注册表（`HOST_DIRECTIVE_SPECS`）内的
        //   指令收集成 `node.directives`；表外的走精确诊断（端上不执行 script ⇒ 指令体不会运行）。
        //   【为什么注册表在 slot-runtime】三端契约：编译器据此产诊断、桥据此执行（"一处实现"）。
        //   ★行内（v-for 内）指令本批不支持（需行作用域求值）——编译期诊断，不静默。
        const KNOWN_DIRECTIVES = ['bind', 'on', 'for', 'if', 'else-if', 'else', 'show', 'model', 'slot', 'text', 'html', 'memo', 'once', 'cloak', 'pre']
        if (p.type === 7 && typeof p.name === 'string'
            && UNSUPPORTED_DIRECTIVES[p.name] === undefined
            && !KNOWN_DIRECTIVES.includes(p.name)) {
          if (isHostDirective(p.name)) {
            // ★行内判据 = 本元素有 v-for（forCode 预扫描已就绪）**或**外层在 v-for 里
            //   （activeListStack——注意本元素自己的 push 发生在本分支**之后**，故必须两者合取）
            if (forCode !== undefined || activeListStack.length > 0) {
              diag(
                `${tag}(id=${id}) v-for **行内**的自定义指令 \`v-${p.name}\` 未支持`,
                '把指令移到列表外的元素上，或等行作用域指令通道（本批只做顶层/非行内）',
                'VAPOR_DIRECTIVE_IN_LIST',
              )
            } else {
              const spec = HOST_DIRECTIVE_SPECS[p.name]!
              const arg = p.arg?.content?.trim()
              const mods = (p.modifiers ?? []).map((m) => (typeof m === 'string' ? m : String(m?.content ?? '')))
              const presetName = arg || 'fade'
              const preset = transitionPresetOf(presetName)
              if (!preset) {
                diag(
                  `${tag}(id=${id}) \`v-${p.name}:${presetName}\`：未知${spec.argKind === 'anim-preset' ? '动画预设' : '参数'}`,
                  `可用：${TRANSITION_PRESET_NAMES.join(' / ')}（${spec.argHint}）`,
                  'VAPOR_DIRECTIVE_UNKNOWN_ARG',
                )
              } else {
                if (mods.length > 0) {
                  diag(
                    `${tag}(id=${id}) \`v-${p.name}\` 上的修饰符 \`.${mods.join('.')}\` 无定义语义（已忽略）`,
                    '本批指令不带修饰符语义；去掉修饰符即可',
                    'VAPOR_DIRECTIVE_MODIFIERS',
                  )
                }
                const valueSrc = p.exp?.content?.trim()
                let valueProgram: import('@proteus-vue/slot-runtime').ExprProgram | undefined
                if (valueSrc) {
                  const compiled = compileExpr(valueSrc)
                  if (!compiled.ok) {
                    diag(
                      `${tag}(id=${id}) \`v-${p.name}="${valueSrc}"\` 的值表达式无法编译：${compiled.unsupported}`,
                      '值须为纯求值表达式（成员访问/算术/比较/逻辑/三元）',
                      'VAPOR_DIRECTIVE_VALUE_UNSUPPORTED',
                    )
                  } else {
                    valueProgram = compiled.program
                  }
                }
                if (!hostDirectives) (hostDirectives = [])
                hostDirectives.push({
                  name: p.name,
                  ...(arg ? { arg } : {}),
                  ...(mods.length > 0 ? { modifiers: mods } : {}),
                  preset: presetName,
                  // 复用 transition 的**入场通道**（"播一次"= 从 from 到 to；与 <Transition> 同源）
                  channels: preset.enter,
                  durMs: 220,
                  curve: 1,
                  ...(valueProgram ? { value: valueProgram, valueSrc } : {}),
                })
              }
            }
          } else {
            diag(
              `${tag}(id=${id}) 自定义指令 \`v-${p.name}\` 未支持——端上**不执行 script**（指令体不会运行）`,
              `宿主指令注册表内的指令可直接用：${HOST_DIRECTIVE_NAMES.map((x) => `v-${x}`).join(' / ')}；` +
                '表外指令请改为等价的内置能力（如动画用 `v-animate:fade`），或保留 Vue 渲染路径（L0）',
              'VAPOR_DIRECTIVE_NOT_REGISTERED',
            )
          }
        }
      }
      for (const p of n.props ?? []) {
        if (p.type === 6 /* ATTRIBUTE */ && p.name === 'style' && p.value?.content) {
          const inlineImportantThis = new Set<string>()
          const inline = parseStaticStyle(p.value.content, (m, hint) => diag(`${tag}(id=${id}) ${m}`, hint), inlineImportantThis, tokens)
          // ★批次 1 层叠（与 CSS 一致）：inline `!important` > class `!important` > inline 普通 > class 普通。
          //   class 里 important 的字段不被 inline 普通声明覆盖（除非 inline 那条也是 important）。
          for (const [k, v] of Object.entries(inline)) {
            if (classImportant.has(k) && !inlineImportantThis.has(k)) continue // class !important 保护
            style[k] = v
          }
          for (const k of inlineImportantThis) inlineImportant.add(k)
        }
        if (p.type === 7 /* DIRECTIVE */ && p.name === 'bind' && p.arg?.content === 'style') {
          // ★★★**`:style` 对象字面量**（2026-10-03 · 静默失效批次）——分三种情形：
          //   ① 全字面量成员 ⇒ **折进静态 style**（零槽位，与 `style="…"` 等价——比建槽位更省）；
          //   ② 含表达式成员 ⇒ 由订阅表**逐键展开**（deps.ts；布局键进内核、绘制键由桥转宿主）；
          //   ③ 变量/不支持的成员（计算键 / 展开 / 嵌套对象）⇒ 精确诊断（不再声称"逐键下发"）。
          const styleExp = (p.exp as { content?: string } | undefined)?.content?.trim() ?? ''
          const parsed = styleExp ? parseStyleObject(styleExp) : null
          if (parsed) {
            for (const pr of parsed.problems) {
              const what =
                pr.kind === 'computed' ? '计算键 `[expr]`'
                : pr.kind === 'spread' ? '对象展开 `...obj`'
                : `嵌套对象 \`${pr.key}\``
              diag(
                `${tag}(id=${id}) \`:style\` 对象的${what}未支持（键名必须编译期可知）`,
                '把该成员拆成独立绑定（如 `:style="{ width: w }"`）或放静态 `style`；'
                + '全字面量的对象会被折进静态样式（可用）',
                'VAPOR_STYLE_OBJECT_UNSUPPORTED',
              )
            }
            const unsupportedKeys = parsed.entries.filter((e) => mapStyleObjectKey(e.key) === null)
            for (const e of unsupportedKeys) {
              diag(
                `${tag}(id=${id}) \`:style\` 的键 \`${e.key}\` 不支持**动态**更新` +
                  `（内核通道为数值几何；字符串类布局值/未知绘制字段不可动态）`,
                `请把 \`${e.key}\` 放静态 \`style\`（值固定时），或改用受支持的键` +
                  `（布局数值键 + 绘制键 backgroundColor/color/fontSize/fontWeight/textAlign/borderRadius/borderColor/borderWidth/opacity）`,
                'VAPOR_STYLE_KEY_UNSUPPORTED',
              )
            }
            if (isAllConstantObject(parsed)) {
              // ① 全字面量 ⇒ 折进静态 style（与 parseStaticStyle 同一形态：键归一化 + 数值/字符串原样）
              //   ★批次 1：`:style` 视作 inline 层 ⇒ 受 class `!important` 保护（同 static style 的规则）
              for (const e of parsed.entries) {
                const mapped = mapStyleObjectKey(e.key)
                if (!mapped) continue
                const fld = mapped.slice(mapped.indexOf('.') + 1)
                if (classImportant.has(fld)) continue
                style[fld] = e.constValue
              }
              hasDynamicStyle = false
            } else {
              // ② 含表达式 ⇒ 逐键展开（订阅表）；不再有"整对象"槽位，也不再有旧诊断
              hasDynamicStyle = parsed.entries.some((e) => mapStyleObjectKey(e.key) !== null)
            }
          } else {
            // ③ 变量形态 / 非对象字面量：键名编译期不可知 ⇒ **如实诊断**（不谎报"逐键下发"）
            hasDynamicStyle = true
            if (styleExp && !styleExp.startsWith('{')) {
              // 既有的单键拼接形态（`'width:' + w`）走 deps 降级，属可用 ⇒ 不产本诊断
              const fieldKey = stylePropKeyFromExpr(styleExp)
              if (!fieldKey) {
                diag(
                  `${tag}(id=${id}) \`:style="${styleExp}"\` 为**变量形态**（键名编译期不可知）——无法逐键下发`,
                  '改用对象字面量（`:style="{ width: w }"`——键静态可析出、逐键生效）或静态 `style`',
                  'VAPOR_STYLE_DYNAMIC_OBJECT',
                )
              }
            }
          }
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
      //   ★★★动态组件（P3 批次，2026-10-03）：`<component :is>` 已在**本步之后**单独处理
      //     ⇒ 从本表跳过（否则"未支持"诊断会把已实现的能力说成不支持）。
      if (tag && tag !== 'component' && UNSUPPORTED_BUILTINS[tag]) {
        diag(`${tag}(id=${id}) ${UNSUPPORTED_BUILTINS[tag]}`)
      }
      // ★★★**动态组件 `:is`**（P3 批次，2026-10-03）——`<component :is="expr">`：
      //   · 静态 `is="Name"`（普通属性）⇒ 直接当静态组件（与 `<Name>` 完全等价——零新机制）；
      //   · `:is="expr"` ⇒ 打 `componentIs` 标记（实例化期按表达式求值解析组件名）。
      //   ★诚实边界：只做**首帧解析**——运行时切换是**结构变更**（换组件 = 换整棵子树），
      //     静态树模型不支持 ⇒ 编译期诊断说明边界 + 替代路径（v-if/v-show 分支 + 静态标签）。
      let componentIsExpr: string | undefined
      /** 静态 `is="Name"` ⇒ 直接当静态组件（与 `<Name>` 完全等价——零新机制） */
      let staticIsName: string | undefined
      if (tag === 'component') {
        const staticIs = (n.props ?? []).find((p) => p.type === 6 && p.name === 'is')
        const dynIs = (n.props ?? []).find((p) => p.type === 7 && p.name === 'bind' && p.arg?.content === 'is')
        if (staticIs?.value?.content) {
          staticIsName = String(staticIs.value.content)
        } else if (dynIs?.exp?.content?.trim()) {
          componentIsExpr = dynIs.exp.content.trim()
          diag(
            `component(id=${id}) \`<component :is="${componentIsExpr}">\` 按**首帧值**解析组件（运行时切换不支持）`,
            '动态组件在实例化期解析一次（名字须在组件注册表里）；需要运行时切换请用 v-if/v-show 分支 + 静态组件标签',
            'VAPOR_DYNAMIC_COMPONENT_IS',
          )
        } else {
          diag(
            `component(id=${id}) 动态组件缺 \`:is\`——不会渲染任何组件`,
            '写法：`<component :is="\'MyComp\'" />` 或静态 `is="MyComp"`',
            'VAPOR_DYNAMIC_COMPONENT_NO_IS',
          )
        }
      }
      // ★★**组件边界标记**（P1 组件系统第一批，2026-10-03）：`<MyComp>` 这类**大写开头**的标签
      //   是 Vue 组件（协议：PascalCase = 组件，kebab-case = 原生标签——与 Vue 官方同约定）。
      //   ⇒ 在节点上打 `component` 标记（运行时据此走 L0 边界语义；见 LayoutNode.component 注释）。
      // ★逻辑容器（KeepAlive/Teleport/Suspense/Transition）虽是 PascalCase，但**不是**组件边界
      //   （它们已被透传分支 `continue` 掉了 ⇒ 此处本就走不到；判据保留以防未来顺序调整）
      // ★动态组件的**静态形态**（`is="Name"`）等价于静态组件——在此统一打标记（零新机制）
      const isComponentTag = /^[A-Z]/.test(tag) && !UNSUPPORTED_BUILTINS[tag] && !(tag in LOGICAL_CONTAINERS)
      // ★★插槽出口 `<slot>`（P1-3 插槽分发，2026-10-03）：打 `slotOutlet` 标记——
      //   实例化期把父级内容**分发到出口位置**（出口自身**不产元素**，见 LayoutNode.slotOutlet）。
      //   ★静态名（`<slot name="header">`）/ 缺省（`default`）都支持；动态名（`:name`）
      //     与出口 props（`<slot :text="msg">`，作用域插槽）为后续批次 ⇒ 精确诊断（不静默）。
      let slotOutletName: string | undefined
      let slotOutletProps: string[] | undefined
      if (tag === 'slot') {
        const nameProp = (n.props ?? []).find((p) => p.type === 6 && p.name === 'name')
        const dynName = (n.props ?? []).some((p) => p.type === 7 && p.arg?.content === 'name')
        // ★★★P1-3 作用域插槽（2026-10-03）：出口上的绑定属性 = 作用域 props（`:count="n"` 等）。
        //   值不在此处求——那些绑定本身就是子组件订阅表的普通槽位（nodeId=本出口 id），
        //   实例化期用子组件的表求值（见 deck 注释"一处实现"）。
        const scopedProps = (n.props ?? [])
          .filter((p) => p.type === 7 && p.name === 'bind' && p.arg?.content !== 'name')
          .map((p) => String(p.arg?.content ?? ''))
          .filter(Boolean)
        if (dynName) {
          diag(
            `slot(id=${id}) 动态插槽名（:name）未支持——内容不会分发到这里`,
            '请改用静态名（<slot name="x">）；动态名为后续批次',
            'VAPOR_SLOT_DYNAMIC_NAME',
          )
        } else {
          slotOutletName = nameProp?.value?.content ?? 'default'
          if (scopedProps.length > 0) slotOutletProps = scopedProps
        }
      }
      // ★★★批次 1（CSS 兼容对齐 · 继承）：可继承字段（color/fontSize）在**本节点无显式值**时
      //   取祖先继承值；随后把本节点"生效值"更新进 `childInherited` 传给子节点。
      //   CSS 语义：子节点自己的声明（含来自 class/style）覆盖继承值 ⇒ 继承只在**缺失**时填。
      const childInherited: Record<string, unknown> = { ...inherited }
      for (const f of APP_INHERITABLE_FIELDS) {
        if (style[f] === undefined && inherited[f] !== undefined) style[f] = inherited[f]
        if (style[f] !== undefined) childInherited[f] = style[f]
      }
      const node: LayoutNode = { id, parentId, tag, style }
      if (nodeListId !== undefined) node.listId = nodeListId
      if (isComponentTag) node.component = tag
      // ★静态 `is="Name"` ⇒ 当静态组件（与 `<Name>` 完全等价——组件标记指向真名）
      if (staticIsName !== undefined) node.component = staticIsName
      // ★P3 动态组件：`:is` 表达式标记（实例化期解析——见 LayoutNode.componentIs 边界）
      if (componentIsExpr !== undefined) node.componentIs = { expr: componentIsExpr }
      // ★P3-5 宿主指令（收集在 props 扫描里；此处挂到节点）
      if (hostDirectives !== undefined) node.directives = hostDirectives
      if (slotOutletName !== undefined) {
        node.slotOutlet = { name: slotOutletName, ...(slotOutletProps ? { props: slotOutletProps } : {}) }
      }
      // ★★**插槽内容根标记**（P1-3 插槽分发）：本元素是「组件孩子」（默认插槽）或
      //   「<template #x> 的直接子元素」（具名插槽）⇒ 实例化期把它重挂到子组件的出口位置。
      //   ★只有**根**带标记（后代随根走——父指针链不变 ⇒ 实例化期按祖先链推导内容集合）。
      //   ★作用域插槽：变量名随标记下发（`#x="sp"` ⇒ `scope: 'sp'`；分发时绑出口 props）。
      if (slotCtx?.slotContentOf !== undefined) {
        node.slotFor = {
          name: slotCtx.slotContentOf,
          ...(slotCtx.scopeVar ? { scope: slotCtx.scopeVar } : {}),
          ...(slotCtx.scopeBindings ? { scopeBindings: slotCtx.scopeBindings } : {}),
        }
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
      // ★（2026-10-03 更新：**混排已真支持**——文本合成 `p-text` 叶，见 text-runs.ts）
      // ★★P2-6：`v-text="expr"` ⇒ 文本槽位（**覆盖**子节点——与 Vue 语义一致：v-text 设置 textContent）
      //   与插值共用 `text.content` 通道 ⇒ 下游（订阅表/运行时/回填）零改动。
      //   ★形态取"单表达式段"（与 `{{ expr }}` 完全同形）——但**不**参与 P2-2 的多段合成
      //     （v-text 只有一个表达式、没有静态段）。
      {
        const vTextProp = (n.props ?? []).find((p) => p.type === 7 && p.name === 'text')
        const vTextCode = vTextProp?.exp?.content?.trim()
        if (vTextCode) {
          hasVText = true
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
        // ★★★**元素+文本混排**（2026-10-03 起真支持）：文本不再折到父元素上，而是由
        //   `walk` 的归一化序列**合成 `p-text` 叶**（与元素兄弟按文档序排布）。
        //   ⇒ 父元素自己不再带 `text`（否则同一段文字会渲染两遍：父属性一份 + 合成叶一份）。
        //   ★`v-text` 在场 ⇒ 按 Vue 语义**覆盖全部子节点**（上面已诊断），此时不做混排合成。
        if (elementChildren.length > 0 && !hasVText) {
          // 混排：交给归一化序列（父不带文本——见上）
        } else if (elementChildren.length > 0) {
          // v-text 覆盖子节点：父元素文本已由 v-text 设置（不合成、不继承子文本）
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
        // ★2026-10-03：旧的"由订阅表以 SET_STYLE 逐键下发"是**假承诺**（整对象多层键内核不认）
        //   ⇒ 对象字面量已在上面按成员逐键展开（或折进静态 style）；此处只剩"无法逐键"的形态，
        //     而它们**各自已有精确诊断**（见上面的 VAPOR_STYLE_* 系列）——不再产笼统消息。
        void 0
      }
      nodes.push(node)
      if (parentId === null) roots.push(id)
      if (rowCollector) rowCollector.ids.push(id)

      // ★P3-3：`pendingTransition` **只作用于直接子元素**（Vue 同：Transition 只包一个元素）
      // ★★P1-3 插槽分发：组件元素的**直接子元素**是默认插槽内容根（打 `slotFor`）；
      //   非组件元素无插槽语义（slotCtx 缺省 ⇒ 不标记）。
      walk(subChildren, id, undefined, isComponentTag ? { parentIsComponent: true } : undefined, childAncestors, childInherited)

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
