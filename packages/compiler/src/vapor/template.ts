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
import { isEnvVarName } from '@proteus-vue/contracts/env-vars'
import type { VaporDiagnostic } from './build'
import type { VueCompatDeps } from './sources'
import type { LayoutNode, LayoutTemplate, ListTemplate, TextSegment } from '@proteus-vue/slot-runtime'
// ★P3-5 宿主指令注册表（**唯一事实来源在运行时包**——编译器据此产诊断、桥据此执行）
import { HOST_DIRECTIVE_NAMES, HOST_DIRECTIVE_SPECS, isHostDirective } from '@proteus-vue/slot-runtime'
// ★混合文本（P2-2）里的插值段要编成表达式程序——复用**同一套**编译器（能力边界一处收敛）
import { compileExpr } from './expr'
import { foldCalcArithmetic } from '../calc-fold'
// ★★★批次 45：构建期静态实例化（App 壳 v-if/v-for 折叠）
import { staticInstantiate } from './static-instantiate'
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
  'margin', 'padding', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignContent', 'alignSelf',
  'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'rowGap', 'columnGap', 'display', 'position', 'top', 'left', 'right', 'bottom', 'overflow',
  // ★★★overflow-x 项（2026-10-06 · css:next P0·10×）：**逐轴溢出**（长手 overflow-x/y + overflow 1–2 值）。
  //   内核/宿主按轴裁剪子内容；归一化（visible↔非visible ⇒ visible→auto）在**级联后的最终样式**上执行
  //   （见 normalizeOverflowFields——per-rule 归一会被跨规则级联破坏）。
  'overflowX', 'overflowY',
  'lineClamp', 'gridTemplateColumns', 'gridTemplateRows', 'gridAutoColumns', 'gridAutoRows', 'gridColumn', 'gridRow', 'gridTemplateAreas', 'gridArea', 'aspectRatio', 'pointerEvents',
  // ★★★justify-self 项（2026-10-06 · css:next P0·9×）：网格项**行内轴自对齐**（CSS Box Alignment 3）。
  //   语料 9 处全在 grid 上下文（p-formfactor 仪表盘——`justify-self: start/stretch`）；
  //   内核 taffy `Style.justify_self` 原生支持（仅 grid 容器消费——与 Web「flex 下被忽略」同语义）
  //   ⇒ 宿主零改动（纯内核布局，宿主按算出的 rect 绘制）。
  'justifySelf', 'justifyItems',
  // ★★全端对齐批（2026-10-05 · white-space）：文本换行/空白语义（值透传宿主消费；内核忽略该键）——
  //   此前 App 端只有单行模型是历史缺口；现五端实现（Android/iOS/鸿蒙/MP 对齐 Web 基准）。
  // ★★★grid-auto-flow 项（2026-10-08 · css:next P0·3× · CSS Grid）：类 grid 容器的**自动放置方向/密度**
  //   （row/column/dense/column dense）。内核 taffy `GridAutoFlow` 原生（仅 grid 容器消费）；宿主零改动（纯内核布局）。
  'gridAutoFlow',
  'whiteSpace',
  // ★★★word-break 项（2026-10-06 · css:next P0·7× · CSS Text）：**行内断词策略**（继承属性；
  //   值透传宿主消费——内核忽略该键，与 whiteSpace 同处置）。语料 7 处（长串/代码块 `break-all`）。
  'wordBreak',
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
  display: ['flex', 'grid', 'none'],
  // ★批 A（2026-10-08 · 决策 #651）：fixed / sticky 入集（超应用刚需——固定头/底栏、吸顶）。
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  overflow: ['visible', 'hidden', 'scroll', 'auto'],
  // ★★★overflow-x 项（同上）：逐轴同集（归一化后出现 auto）
  overflowX: ['visible', 'hidden', 'scroll', 'auto'],
  overflowY: ['visible', 'hidden', 'scroll', 'auto'],
  // ★★★justify-self 项（2026-10-06）：网格项行内轴自对齐封闭集（与 runtime PROP_TYPES.JustifySelf 同集）。
  //   内核映射：auto ⇒ 不设（回落父 justify-items——CSS 语义）；normal ⇒ stretch（Web 对 grid 项的语义）；
  //   baseline/left/right 未列 ⇒ 诊断跳过（内核无对应/会按 start 近似——不静默近似）。
  justifySelf: ['auto', 'normal', 'start', 'end', 'flex-start', 'flex-end', 'self-start', 'self-end', 'center', 'stretch'],
  // place-items 的 align-items 分量（align-items 本体是开放值；此处仅用于 place-items 校验）
  alignItems: ['normal', 'start', 'end', 'flex-start', 'flex-end', 'self-start', 'self-end', 'center', 'stretch', 'baseline'],
  // ★★★place-items/justify-items 项（2026-10-08）：网格容器内子项行内轴对齐（值集 = justifySelf 去 auto）
  justifyItems: ['normal', 'start', 'end', 'flex-start', 'flex-end', 'self-start', 'self-end', 'center', 'stretch'],
  flexDirection: ['row', 'column', 'row-reverse', 'column-reverse'],
  flexWrap: ['nowrap', 'wrap', 'wrap-reverse'],
  // ★★★grid-auto-flow 项（2026-10-08）：自动放置封闭集（与 runtime PROP_TYPES.GridAutoFlow 同集；Web `row dense` 归一为 `dense`）
  gridAutoFlow: ['row', 'column', 'dense', 'column dense'],
}

/** 绘制字段（宿主自绘读这些键；模板照样要带上，否则挂载后无底色/无字色） */
// ★★★逐边 border 批（2026-10-05 · border-bottom 等 4 个 P0 项）：追加**逐边** width/color（宿主逐边绘制；
//   uniform borderWidth/borderColor 保留 = 四边缺省值）。语料 21 处 `border-<side>: <w> <style> <color>`。
export const APP_PAINT_FIELDS = ['backgroundColor', 'color', 'fontSize', 'fontWeight', 'fontFamily', 'textAlign', 'lineHeight', 'textOverflow', 'letterSpacing', 'textDecoration', 'visibility', 'borderRadius', 'borderColor', 'borderWidth', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle', 'opacity', 'boxShadow', 'textShadow', 'transform', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'outlineWidth', 'outlineColor', 'outlineStyle', 'outlineOffset'] as const
const PAINT_FIELDS = new Set<string>(APP_PAINT_FIELDS)
/**
 * ★批次 4（CSS 兼容对齐）：`text-align` 的**封闭集**（App 自绘文本在盒内的水平对齐）。
 *   宿主映射：iOS `CATextLayer.alignmentMode` · Android `Paint.Align` · 鸿蒙 `OH_Drawing_TextAlign`。
 *   `justify`/`start`/`end` 等未列 ⇒ 诊断跳过（不静默当默认）。
 */
export const APP_TEXT_ALIGN_VALUES = ['left', 'center', 'right'] as const
/**
 * ★批次 16（CSS 兼容对齐）：`text-overflow` 的**封闭集**（App 自绘文本单行溢出处理）。
 *   Web 默认 `clip`（截断不省略）；`ellipsis` ⇒ 超出盒宽时行尾以 `…` 表示。
 *   宿主映射：iOS `CATextLayer.truncationMode` · Android `TextUtils.ellipsize` ·
 *   鸿蒙 `OH_Drawing_SetTypographyTextEllipsis`。其余（如 `fade`）⇒ 诊断跳过（不猜）。
 */
export const APP_TEXT_OVERFLOW_VALUES = ['clip', 'ellipsis'] as const
/** 四边简写字段（`margin`/`padding` → 结构化 `{top,right,bottom,left}`） */
export const APP_EDGE_FIELDS = ['margin', 'padding'] as const
/** 百分比宽高折叠出的**比例字段**（App 端原生支持 `widthRatio`/`heightRatio`；非长度、不乘密度） */
export const APP_DERIVED_FIELDS = ['widthRatio', 'heightRatio', 'marginAuto', 'borderRadiusCorners', 'borderRadiusPct', 'transformOrigin', 'minWidthPct', 'maxWidthPct', 'minHeightPct', 'maxHeightPct'] as const
/** 特殊透传键（App 两内核恒 border-box ⇒ `box-sizing` 只作忠实记录、无副作用） */
export const APP_SPECIAL_FIELDS = ['boxSizing'] as const

/**
 * ★★★批次 1（CSS 兼容对齐 · 层叠正确性）：**可继承的引擎字段**（App 文本模型的子集）。
 *
 * 【为什么必须编译期折叠】App 端**无运行时 CSS 引擎** ⇒ 继承（CSS 默认：`color`/`font-size` 等
 *   沿树向下传播）必须在**编译期**算进每个节点的 computed style（Profile §3 L0「继承」）。
 *   Web/Skyline 由各自 CSS 引擎按标准处理，本仓**不干预**（只折叠 App 面）。
 * 【纳入哪些（以 Web 为基准）】只纳**CSS 里确实继承**的文本类属性：`color`/`font-size`/
 *   `font-weight`/`line-height`/`text-align`/`text-overflow`（批 16）。
 *   背景/边框/圆角/不透明度在内核语义里**不继承**（见 Profile §3 可继承/不可继承表）⇒ 不得纳入。
 */
export const APP_INHERITABLE_FIELDS = ['color', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'textAlign', 'textOverflow', 'letterSpacing', 'textDecoration',
  // ★★★word-break 项（2026-10-06 · CSS 继承属性）：`white-space` 与 `word-break` 都是 CSS Text 的**继承**属性
  //   （规范：父设、子默认继承）——App 折叠面须编译期传播，否则 `word-break: break-all` 设在容器上、
  //   文本子节点继承不到（Web/Skyline 由 CSS 引擎原生继承 ⇒ 跨端不一致）。★补 `whiteSpace` 同样纳入
  //   （white-space 批的潜在缺口，本次同族一并修正）。
  'whiteSpace', 'wordBreak',
] as const
/** ★批次 28：支持 `inherit` 关键字的字段集（可继承 + visibility）。 */
const INHERIT_KEY_SET = new Set<string>([...APP_INHERITABLE_FIELDS, 'visibility'])

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
 * ★批次 13：`line-height` 归一为 token 串（宿主解析）：无单位倍数 → `"1.6"`；绝对 → `"24px"`；
 *   `160%` → 倍数 `"1.6"`。`normal` / 其它关键字 ⇒ null（调用方诊断）。
 */
function parseLineHeight(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  if (v === 'normal' || v === '') return null
  // ★★★min()/max()/clamp()（2026-10-08）：先折为 `<n>px` 再走既有 token 归一（px-only）
  if (/^(min|max|clamp)\(/i.test(v)) {
    const n = numOfMathFn(v)
    return n === undefined ? null : `${n}px`
  }
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(v)
  if (pct) return String(Number(pct[1]) / 100)
  if (/^\d*\.?\d+px$/.test(v)) return v
  // ★批次 21：rpx ⇒ px（×0.5），折为绝对 px token（宿主按 px 处理）
  { const r = /^(\d*\.?\d+)rpx$/.exec(v); if (r) return String(Number(r[1]) * 0.5) + 'px' }
  if (/^\d*\.?\d+$/.test(v)) return v
  return null
}

/**
 * ★批次 41 / ★★★2026-10-08（网格轨道项）：\`grid-column\`/\`grid-row\` 放置 → \`{start?, end?, span?}\`。
 *   支持：\`<line>\`（单值 ⇒ start）· \`<start> / <end>\`（线号可为负，-1 = 最后一条线）·
 *   \`span <n>\`（跨 n 轨，无起点 ⇒ 自动放置起）· \`<start> / span <n>\` · \`span <n> / <end>\`。
 *   \`auto\` / 命名线 ⇒ null（未支持，调用方诊断）。
 *   ★span 的 IR 形态：`{span:n}`（无 start）/ `{start:s, span:n}` / `{end:e, span:n}`——内核按
 *     taffy \`Line<GridPlacement>\`（start/end 各可为 Line/Span/Auto）映射。
 */
function parseGridLine(val: string): { start?: number; end?: number; span?: number } | null {
  const parts = val.split('/').map((s) => s.trim())
  if (parts.length === 0 || parts.length > 2) return null
  // 单个 token → 线号或 `span <n>`（`span` 与数之间可空格，忽略大小写）
  const tokOf = (t: string): { line?: number; span?: number } | null => {
    const sp = /^span\s+(\d+)$/i.exec(t)
    if (sp) { const n = Number(sp[1]); return n >= 1 ? { span: n } : null }
    if (/^-?\d+$/.test(t)) { const n = Number(t); return n === 0 ? null : { line: n } } // 0 非法线号
    return null
  }
  const a = tokOf(parts[0]!)
  if (!a) return null
  if (parts.length === 1) return a.line !== undefined ? { start: a.line } : { span: a.span }
  const b = tokOf(parts[1]!)
  if (!b) return null
  const out: { start?: number; end?: number; span?: number } = {}
  // a = 起点侧（line 或 span），b = 终点侧（line 或 span）
  if (a.line !== undefined) out.start = a.line
  if (a.span !== undefined) out.span = a.span
  if (b.line !== undefined) out.end = b.line
  if (b.span !== undefined) out.span = b.span
  // `span x / span y` 或 `x / y`（双线号）：至少要有起点或跨度信息，否则无意义
  if (out.start === undefined && out.end === undefined && out.span === undefined) return null
  return out
}

/**
 * ★批次 12（CSS Grid）：显式轨迹串 → 归一化的空格分隔串（内核再解析）。
 *   · `<n>fr` / `<n>px` / 纯数字 保留；`repeat(N, X)` 展开为 N 个 X（`repeat(3, 1fr)` → `1fr 1fr 1fr`）；
 *   · `auto`/`minmax`/`fit-content`/命名线 等**未支持** ⇒ 返回 null（调用方诊断——不猜）。
 */
/**
 * ★★★grid-template-areas 项（2026-10-08 · css:next P0·2×）：**命名区域模板**（CSS 多引号串）→ 规范化串。
 *   输入如 `'media info' 'rec rec'`（单/双引号均可）；输出 **浏览器 getComputedStyle 形态**
 *   `"media info" "rec rec"`（双引号逐行、行内单元空格分隔、`.` 保留空单元）——与 parity 真值对齐；
 *   内核（taffy）按行/列建命名线供子项 grid-area 引用。
 *   · `none` ⇒ `none`（无模板——内核忽略）；· 无可识别引号串 ⇒ `undefined`（调用方诊断）。
 */
function parseGridTemplateAreas(raw: string): string | undefined {
  const v = raw.trim()
  if (v.toLowerCase() === 'none') return 'none'
  const rows: string[] = []
  const re = /"([^"]*)"|'([^']*)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(v)) !== null) {
    const cells = (m[1] ?? m[2] ?? '').trim().split(/\s+/).filter(Boolean)
    if (cells.length > 0) rows.push(cells.join(' '))
  }
  return rows.length > 0 ? rows.map((r) => '"' + r + '"').join(' ') : undefined
}

/**
 * ★★★grid-area 项（2026-10-08）：**线号形态** `grid-area: <rs> / <cs> / <re> / <ce>`（1–4 值）→ grid-row/grid-column。
 *   位置语义（CSS 规范）：v0=row-start · v1=column-start · v2=row-end · v3=column-end。仅纯整数线号（0 非法）。
 *   命名区域形态（单标识符）不走此函数（见折叠分支——直接落 gridArea）。
 */
function parseGridAreaLines(val: string): { row?: { start: number; end?: number }; column?: { start: number; end?: number } } | null {
  const parts = val.split('/').map((x) => x.trim())
  if (parts.length < 1 || parts.length > 4) return null
  const nums = parts.map((t) => (/^-?\d+$/.test(t) && Number(t) !== 0 ? Number(t) : undefined))
  if (nums.some((n) => n === undefined)) return null
  const out: { row?: { start: number; end?: number }; column?: { start: number; end?: number } } = {}
  out.row = parts.length >= 3 ? { start: nums[0]!, end: nums[2]! } : { start: nums[0]! }
  if (parts.length >= 2) out.column = parts.length >= 4 ? { start: nums[1]!, end: nums[3]! } : { start: nums[1]! }
  return out
}
function parseGridTemplate(raw: string): string | null {
  const out: string[] = []
  const toks = splitTopLevelSpaces(raw)
  if (toks.length === 0) return null
  for (const tok of toks) {
    // ★数值 repeat(N, X)：展开为 N 个 X（taffy 也支持，但展开后更直观、与既有行为一致）
    const rep = /^repeat\(\s*(\d+)\s*,\s*(.+?)\s*\)$/i.exec(tok)
    if (rep) {
      const n = Number(rep[1])
      const inner = splitTopLevelSpaces(rep[2]!.trim())
      if (inner.length === 0 || inner.some((x) => !isGridTrack(x))) return null
      for (let i = 0; i < n; i++) out.push(...inner)
      continue
    }
    // ★★★repeat(auto-fill|auto-fit, X)：原样透传（内核 taffy 原生解析 AutoFill/AutoFit）
    if (/^repeat\(\s*auto-(?:fill|fit)\s*,.*\)$/i.test(tok)) { out.push(tok); continue }
    if (!isGridTrack(tok)) return null
    out.push(tok)
  }
  return out.length > 0 ? out.join(' ') : null
}

/** place-items 诊断文案（避免在内嵌模板串里出现反引号/花括号） */
function placeItemsDiag(raw: string, hint: string): string {
  return 'place-items: ' + raw + ' 未解析（' + hint + '）——已跳过'
}

/** 按**括号深度 0** 处的空白切 token（`repeat(3, 1fr)` 内的空格不算） */
function splitTopLevelSpaces(s: string): string[] {
  const out: string[] = []
  let d = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') d++
    else if (ch === ')') d--
    if (/\s/.test(ch) && d === 0) { if (cur) { out.push(cur); cur = '' } continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/** 单个网格轨迹是否受支持：`<n>fr` / `<n>px` / 纯数字（非负） */
function isGridTrack(t: string): boolean {
  // ★★★grid 轨迹解析升级（2026-10-08）：接受全部 taffy 可解析的**单条轨道尺寸**——
  //   fr / px / 纯数字 / % / auto / min-content / max-content / fit-content(...) / minmax(a, b)。
  //   内核用 taffy 官方 FromStr 解析（见 layout-core-rust parse_grid_tracks）。
  if (t.startsWith('minmax(') && t.endsWith(')')) {
    const inner = t.slice(7, -1)
    const parts = splitTopLevelSpaces(inner.replace(/,/g, ' '))
    return parts.length === 2 && parts.every((p) => isTrackSize(p))
  }
  return isTrackSize(t)
}

/** 单条轨道尺寸（min/max 分量）：fr / px / 纯数字 / % / auto / min-content / max-content / fit-content(...) */
function isTrackSize(t: string): boolean {
  return /^\d*\.?\d+(fr|px|%)?$/.test(t)
    || t === 'auto' || t === 'min-content' || t === 'max-content'
    || /^fit-content\(.*\)$/.test(t)
}

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
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const declRe = /(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)/g
  /** 收集声明；**first-wins**（已存在的令牌不覆盖——基块优先，主题覆盖块只补缺） */
  const collect = (s: string, into: Record<string, string>): void => {
    let m: RegExpExecArray | null
    declRe.lastIndex = 0
    while ((m = declRe.exec(s))) {
      const k = m[1]!.trim()
      if (!(k in into)) into[k] = m[2]!.trim()
    }
  }
  // ★★批次 45 修复（App 端主题取错）：令牌表原**全文件按最后出现**取值 ⇒ 主题覆盖块（`.sa-dark` / `[data-theme]`）
  //   会**污染默认值**（实测：superapp 的 `--sa-text` 被取成深色 `#eef0f5`，而默认应为浅色 `#1a1c22`
  //   ⇒ App 端页面文字/背景与 Web 分叉）。
  //   ⇒ 改为**块感知**：先取**基选择器**块（`:root`/`html`/`body`/`page` 或无选择器的裸声明）的值（默认主题），
  //     仅对基块**未定义**的令牌，再从其余块（主题覆盖）补齐（first-wins）。
  //   ★向后兼容：无花括号的裸声明串（既有测试用法）整体视为**一个基块**。
  const blocks = [...body.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
  const out: Record<string, string> = {}
  if (blocks.length === 0) {
    collect(body, out)
    return out
  }
  const isBase = (selector: string): boolean => !/[.#[]/.test(selector)   // 无类/属性选择器 ⇒ 基块
  for (const b of blocks) if (isBase(b[1]!)) collect(b[2]!, out)          // 默认主题
  for (const b of blocks) if (!isBase(b[1]!)) collect(b[2]!, out)         // 主题覆盖只补缺
  return out
}

/** 把 `var(--x[, fallback])` 替换为令牌值（递归展开；未知且无 fallback ⇒ 原样保留）。 */
export function substituteCssVars(value: string, tokens: Record<string, string>): string {
  if (!value.includes('var(')) return value
  let v = value
  for (let i = 0; i < 8; i++) {
    let changed = false
    v = v.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*))?\)/g, (full, name: string, fallback?: string) => {
      // ★★★内置环境变量（2026-10-08 · 决策 #593）：`--pf-*` 是**运行期环境引用**（非设计令牌）——
      //   保留 `var(--pf-X[, fb])` 原文（交 envLengthToken 发射 env 引用），**勿折成 fallback**。
      if (name.startsWith('--pf-')) return full
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
  /** ★批次 42：`@keyframes` 表（`animation` 简写解析用；由 parseClassRules 传入） */
  keyframes?: KeyframesMap,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  /** ★★★边框族收口批：逐角 radius 长手账（同块内累积、就地合成——见循环内消费点）。 */
  const cornerAcc: Record<string, number> = {}
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
    // ★批次 26/27（CSS 兼容对齐 · 以 Web 为基准）：**Web 默认值 / 重置声明** ⇒ 记录**默认值**（不诊断）。
    //   ★批次 27 修正：**不能直接 skip**——重置声明（如 `.b{border:none}`）必须**记录**默认值，
    //   否则覆盖不了低优先级的 `.a{border:1px solid}`（级联失效，实测过）。无 App 字段的（transform 等）⇒ 空记录。
    const noop = noOpResetValue(key, rawVal)
    if (noop !== null) { for (const nk in noop) { out[nk] = noop[nk]; markImportant(nk) } continue }
    // ★批次 28（CSS 兼容对齐 · 以 Web 为基准）：`inherit` 关键字（可继承属性）——**显式取父值**。
    //   语义：`\.b{color:inherit}` 覆盖 `.a{color:red}` ⇒ b 应取**父节点**的 color（非 red）。
    //   记哨兵 `'inherit'`，由下方继承 walk 解析为父的 computed 值。
    if (rawVal.trim().toLowerCase() === 'inherit') {
      if (INHERIT_KEY_SET.has(key)) { out[key] = 'inherit'; markImportant(key) }
      continue
    }
    // 四边：`margin-bottom` / `padding-left` …
    const edge = key.match(/^(margin|padding)(Top|Right|Bottom|Left)$/)
    if (edge) {
      const f = edge[1]!
      const side = edge[2]!.toLowerCase()
      // ★批次 17（CSS 兼容对齐 · 以 Web 为基准）：`margin-<side>: auto` ⇒ 记入 marginAuto（此前静默丢弃）。
      if (f === 'margin' && rawVal.trim().toLowerCase() === 'auto') {
        const ma = (out.marginAuto as Record<string, boolean> | undefined) ?? {}
        ma[side] = true
        out.marginAuto = ma
        markImportant('marginAuto')
        continue
      }
      const envTokEdge = envLengthToken(rawVal)
      if (envTokEdge !== undefined) {
        const cur = (out[f] as Record<string, unknown> | undefined) ?? {}
        cur[side] = envTokEdge
        out[f] = cur
        markImportant(f)
        continue
      }
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
      // ★批次 17（CSS 兼容对齐 · 以 Web 为基准）：`margin` 简写支持 auto（`margin: 0 auto` 水平居中；
      //   `padding` 无 auto 语义，走下方通用路径）。此前 auto 被**静默丢弃** ⇒ App 不居中、Web 居中。
      if (key === 'margin') {
        const m = expandMarginShorthand(rawVal, lenOrEnv)
        if (!m) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 无法解析为四值简写（支持 1–4 个 px/数字/auto）`); continue }
        if (Object.keys(m.box).length > 0) { out.margin = m.box; markImportant('margin') }
        if (Object.keys(m.auto).length > 0) { out.marginAuto = m.auto; markImportant('marginAuto') }
        continue
      }
      const box = expandBoxShorthand(rawVal, lenOrEnv)
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
      // ★批次 14（多端一致性审计修）：App 两内核**恒为 border-box** ⇒ `content-box` 会被静默忽略
      //   （Web 生效 ⇒ 多端不一致）。⇒ 非 border-box 如实诊断（不静默）。（border-box 是 Web/MP 共同子集）
      if (rawVal.trim().toLowerCase() !== 'border-box') {
        pushDiag(
          `\`box-sizing: ${rawVal}\` App 端恒为 border-box（内核固定）⇒ 已忽略`,
          '改 `box-sizing: border-box`（三端共同子集），或保留 Web 端渲染',
        )
      }
      out[key] = rawVal
      markImportant(key)
      continue
    }
    if (key === 'inset') {
      // ★批次 38（对齐 Web · 削减胶水）：`inset` 简写（CSS `top/right/bottom/left` 的 1–4 值缩写）——
      //   覆盖层/遮罩 `position:absolute; inset:0` 刚需（真项目 15 处：路由层/浮层/scrim）。
      //   展开为 top/right/bottom/left 数值（引擎绝对定位已支持四边）；`auto` = 默认偏移（不偏移）⇒ 该边不设（忠实）。
      const m = expandMarginShorthand(rawVal, lenOrEnv)
      if (!m) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 无法解析为 inset 简写（支持 1–4 个 px/数字/auto）`); continue }
      for (const s of ['top', 'right', 'bottom', 'left'] as const) {
        if (m.box[s] !== undefined) { out[s] = m.box[s]; markImportant(s) }
      }
      continue
    }
      if (key === 'transformOrigin') {
        // ★批次 40（对齐 Web · 补齐批 39）：**`transform-origin`** —— 旋转/缩放的锚点（盒分数）。
        //   宿主通道已在（Android `injectTransformOrigin` / iOS 建层快照 + applyTransform）⇒ 编译器折成 `{x,y}` 即可。
        //   支持：关键字（left/center/right/top/bottom，1–2 值）/ 百分比 / `0`；非零 px 需盒尺寸（编译期不可知）⇒ 诊断跳过。
        const o = parseTransformOrigin(rawVal)
        if (o === null) {
          pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 未解析（支持 关键字 left/center/right/top/bottom · 百分比 · 0；非零 px 需盒尺寸）——已跳过`)
          continue
        }
        if (o.x === 0.5 && o.y === 0.5) continue   // 默认（元素中心）⇒ 不发射（零行为变化）
        out.transformOrigin = o
        markImportant('transformOrigin')
        continue
      }
      if (key === 'animation') {
        // ★批次 42（动效 · 对齐 Web）：`animation: <name> <dur> <timing?> [delay] [iter] [dir] [fill]` ——
        //   折成**逐通道 keyframe 规格**（内核 `anim_start` 的 `{kind, from, keyframes:[{to,durMs,curve}]}`）。
        //   名字须命中 `<style>` 里的 `@keyframes`（`keyframes` 表经 parseClassRules 传入）；未知名 ⇒ 诊断跳过。
        if (rawVal.trim().toLowerCase() === 'none') continue   // 默认无动画 ⇒ 不发射
        const spec = parseAnimationShorthand(rawVal)
        if (spec === null) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 未解析（支持 \`<name> <dur> <timing?> …\`；需带时间单位）——已跳过`); continue }
        const stops = keyframes ? keyframes[spec.name] : undefined
        if (stops) {
          const chans = resolveAnimationChannels(stops, spec.durMs, spec.curve)
          if (chans.length > 0) { out.animation = chans; markImportant('animation') }
          else pushDiag(`\`animation: ${rawVal}\` 的 @keyframes \`${spec.name}\` 无可动画通道（opacity / px 位移 / 等比缩放 / 旋转）——已跳过`)
        } else {
          pushDiag(`\`animation: ${rawVal}\` 未找到 \`@keyframes ${spec.name}\`（App 端 animation 需同文件的 @keyframes 声明）——已跳过`)
        }
        continue
      }
    if (LAYOUT_FIELDS.has(key)) {
      // ★批次 12（CSS Grid）：`grid-template-columns/rows` —— 显式轨迹串（`1fr 1fr 200px`）；
      //   `repeat(N, X)` 展开为 N 个 X；不支持的形态（`auto`/`minmax`/`fit-content`）诊断跳过。
      // ★★★grid-auto-columns/rows 项（2026-10-08）：**隐式轨道尺寸**——每个值走 isGridTrack（minmax/auto/%/…）。
      if (key === 'gridAutoColumns' || key === 'gridAutoRows') {
        const tracks = splitTopLevelSpaces(rawVal.trim())
        if (tracks.length === 0 || tracks.some((x) => !isGridTrack(x))) {
          pushDiag(`\`${rawKey}: ${rawVal}\` 未解析（支持 minmax(0, 1fr) / 100px / auto / 1fr 等轨道尺寸）——已跳过`)
          continue
        }
        out[key] = tracks.join(' ')
        markImportant(key)
        continue
      }
      if (key === 'gridTemplateColumns' || key === 'gridTemplateRows') {
        const tracks = parseGridTemplate(rawVal)
        if (tracks === null) {
          pushDiag(
            `\`${rawKey}: ${rawVal}\` 未解析（支持显式轨迹：` + '`1fr 1fr 200px` / `repeat(3, 1fr)`）——已跳过',
            'App 端 CSS Grid 为**显式轨迹**子集：fr / px / repeat(N,X)；auto/minmax/fit-content/命名线 暂不支持',
          )
          continue
        }
        out[key] = tracks
        markImportant(key)
        continue
      }
      // ★★★grid-template-areas 项（2026-10-08 · css:next P0·2× · CSS Grid）：**命名区域模板**。
      //   规范串 = 行以 `;` 分隔、每行区域名空格分隔（`.` = 空单元）——CSS 语法是多引号串
      //   （`"a b" "c c"`），折成内核规范串 `a b;c c`（内核按行/列建命名线，供子项 grid-area 引用）。
      if (key === 'gridTemplateAreas') {
        const norm = parseGridTemplateAreas(rawVal)
        if (norm === undefined) {
          pushDiag(`${rawKey}: ${rawVal} 未解析（支持 "a b" "c c" 引号串模板 / none）——已跳过`)
          continue
        }
        out.gridTemplateAreas = norm
        markImportant('gridTemplateAreas')
        continue
      }
      // ★★★grid-area 项（2026-10-08 · css:next P0·2× · CSS Grid）：**命名区域引用**（grid-area: <name>）。
      //   单标识符 ⇒ 命名区域放置（内核命名线）；线号形态（grid-area: 1 / 2 / 3 / 4）⇒ 拆成 grid-row/grid-column。
      if (key === 'gridArea') {
        const nm = rawVal.trim()
        if (/^[A-Za-z_][\w-]*$/.test(nm) && nm !== 'auto' && nm !== 'span') {
          out.gridArea = nm
          markImportant('gridArea')
          continue
        }
        const decomp = parseGridAreaLines(rawVal)
        if (decomp) {
          if (decomp.row) { out.gridRow = decomp.row; markImportant('gridRow') }
          if (decomp.column) { out.gridColumn = decomp.column; markImportant('gridColumn') }
          continue
        }
        pushDiag(`${rawKey}: ${rawVal} 未支持（命名区域 grid-area: <name> 或线号 1 / 2 / 3 / 4）——已跳过`)
        continue
      }
      if (key === 'gridColumn' || key === 'gridRow') {
        // ★批次 41（CSS Grid 补全 · 批 12 续）：`grid-column`/`grid-row` 放置——item 跨列/跨行（仪表盘 KPI 卡、全宽行）刚需。
        //   ★★★2026-10-08（网格轨道项）：**补 `span <n>`**（`span 2` / `1 / span 2` / `span 2 / 3`）——
        //     此前只认纯数字线号 ⇒ `grid-row: span 2` 被**静默丢弃**（App 三端案例 D 卡位错的根因）。
        //   仍不支持：`auto` / 命名线（`span <name>`）⇒ 诊断跳过（不猜）。
        const g = parseGridLine(rawVal)
        if (g === null) {
          pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 未支持（仅线号 \`<n>\` / \`<start> / <end>\` / \`span <n>\`；auto/命名线 暂不支持）——已跳过`)
          continue
        }
        out[key] = g
        markImportant(key)
        continue
      }
      // ★★★grid-auto-flow 项（2026-10-08 · css:next P0·3× · CSS Grid）：类 grid 容器的**自动放置方向/密度**。
      //   值集 = 四端可表达子集（row / column / dense / column dense）；Web `row dense` 归一为 `dense`（同为 RowDense）。
      //   内核 taffy `GridAutoFlow` 原生（仅 grid 容器消费）⇒ 宿主零改动（纯内核布局）。
      if (key === 'gridAutoFlow') {
        let v = rawVal.trim().toLowerCase()
        if (v === 'row dense') v = 'dense'
        const allowedGaf = APP_ENUM_VALUES.gridAutoFlow!
        if (!allowedGaf.includes(v)) {
          pushDiag(`\`${rawKey}: ${rawVal}\` 不是 App 引擎支持的值（gridAutoFlow 仅认：${allowedGaf.join(' / ')}）——已跳过`)
          continue
        }
        out.gridAutoFlow = v
        markImportant('gridAutoFlow')
        continue
      }
      if (key === 'whiteSpace') {
        // ★★全端对齐批（2026-10-05 · 用户要求「white-space 五端全部对齐、不留缺陷」）：
        //   `white-space` 值**透传宿主**——App 端文本引擎按此分流：
        //   normal/pre-wrap/pre-line ⇒ 自动折行；nowrap/pre ⇒ 不折行（配合 text-overflow / overflow 截断或裁切）。
        //   `break-spaces` 归一 `pre-wrap`（本仓四端无独立语义）。
        const v = rawVal.trim().toLowerCase()
        const norm = v === 'break-spaces' ? 'pre-wrap' : v
        if (norm === 'normal' || norm === 'nowrap' || norm === 'pre' || norm === 'pre-wrap' || norm === 'pre-line') {
          out.whiteSpace = norm
          markImportant('whiteSpace')
          continue
        }
        pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 未支持（仅 normal/nowrap/pre/pre-wrap/pre-line）——已跳过`)
        continue
      }
      if (key === 'wordBreak') {
        // ★★★word-break 项（2026-10-06 · css:next P0·7× · CSS Text）：`word-break` 值**透传宿主**——
        //   App 端文本引擎按此分流（与 white-space 同轴，都在换行/断行族）：
        //   normal ⇒ 词边界换行（长不可断串溢出）；break-all ⇒ 任意字符处可断。
        //   ★keep-all（CJK 专用，Skyline 无、内核无对应）/ break-word（Skyline 无——仅 Web+App 可表达）
        //     / auto-phrase（实验）⇒ 诊断跳过（**不静默近似**；值集 = 四端可表达子集，与 justify-self 同纪律）。
        const v = rawVal.trim().toLowerCase()
        if (v === 'normal' || v === 'break-all') {
          out.wordBreak = v
          markImportant('wordBreak')
          continue
        }
        pushDiag(
          `style 里 \`${rawKey}: ${rawVal}\` 未支持（仅 normal/break-all）——已跳过`,
          '词集 = 四端可表达子集（Skyline 官方表仅 normal/break-all）；keep-all（CJK 专用）/ break-word / auto-phrase 暂不支持',
        )
        continue
      }
      if (key === 'pointerEvents') {
        // ★批次 32（CSS 兼容对齐 · 以 Web 为基准）：pointer-events（none ⇒ 不参与命中，事件穿透）。
        //   折成布尔（none ⇒ false / auto ⇒ true）；缺省 = auto ⇒ 不发射（零行为变化）。
        const v = rawVal.trim().toLowerCase()
        if (v !== 'none' && v !== 'auto') { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 未支持（仅 none / auto）——已跳过`); continue }
        out[key] = v === 'none' ? false : true
        markImportant(key)
        continue
      }
      if (key === 'aspectRatio') {
        // ★批次 24（CSS 兼容对齐 · 以 Web 为基准）：`aspect-ratio`（宽高比；媒体卡/占位图刚需）。
        //   `<n>`（如 `1.5`）/ `<w>/<h>`（如 `16/9`）→ 比值；`auto` → 不发射（默认）。
        const v = rawVal.trim().toLowerCase()
        if (v === 'auto') continue   // 默认 ⇒ 不发射（零行为变化）
        const ratio = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(v)
        if (ratio) {
          const r = Number(ratio[1]) / Number(ratio[2])
          if (Number.isFinite(r) && r > 0) { out.aspectRatio = r; markImportant('aspectRatio'); continue }
        }
        const n = Number(v)
        if (Number.isFinite(n) && n > 0) { out.aspectRatio = n; markImportant('aspectRatio'); continue }
        pushDiag(`\`${rawKey}: ${rawVal}\` 未解析（支持 <n> 或 <w>/<h> 或 auto）——已跳过`)
        continue
      }
      if (key === 'flexDirection' || key === 'flexWrap' || key === 'justifyContent' || key === 'alignItems' || key === 'alignContent' || key === 'alignSelf' || key === 'justifySelf' || key === 'justifyItems' || key === 'position' || key === 'display' || key === 'overflow' || key === 'overflowX' || key === 'overflowY') {
        // ★★★overflow-x 项（2026-10-06）：`overflow` **两值简写**（<x> <y>，CSS 语法）⇒ 逐轴字段
        if (key === 'overflow') {
          const toks = splitTopLevelSpaces(rawVal)
          if (toks.length === 2) {
            const ox = toks[0]!.trim().toLowerCase()
            const oy = toks[1]!.trim().toLowerCase()
            const allow = APP_ENUM_VALUES.overflow
            if (allow.includes(ox) && allow.includes(oy)) {
              out.overflowX = ox
              out.overflowY = oy
              delete out.overflow
              markImportant('overflowX'); markImportant('overflowY')
              continue
            }
            pushDiag(`\`overflow: ${rawVal}\` 含非法值（仅认 ${allow.join(' / ')}）——已跳过（用引擎默认）`)
            continue
          }
        }
        // ★★★枚举值**校验**（2026-10-04 修：真机 RustLayout.create 失败暴露）——内核只认封闭集；
        //   不支持的值（如 `display: block/grid`、`position: sticky`）⇒ **诊断 + 跳过**（用内核默认），
        //   否则原样透传会让**整棵树建不起来**（App/小程序端页面全崩）。
        //   ★批次 14（多端一致性审计修）：CSS 关键字**大小写不敏感**（`display: FLEX` Web 生效）——
        //     此前大小写敏感 ⇒ `FLEX` 被丢弃 = 与 Web 偏差。⇒ 比较与存储均用小写。
        // ★★★line-clamp 项（2026-10-08）：`display: -webkit-box`（+ -webkit-box-orient:vertical）是多行截断的**惯用标记**，
        //   无 App 对等值（App 文本天然纵向块级）⇒ 静默接受、不落 display 字段、不诊断（仅作 clamp 惯用）。
        if (key === 'display') {
          const dv = rawVal.trim().toLowerCase()
          if (dv === '-webkit-box' || dv === '-webkit-inline-box' || dv === 'box') continue
        }
        let enumVal = rawVal.trim().toLowerCase()
        // ★★★批 A（2026-10-08 · 决策 #651）：**移除**批次 45 的 `position: fixed` → `absolute` 静默改写。
        //   旧理由「App 单全屏视口，fixed/absolute 等价」在**内容已支持滚动**后不成立——
        //   fixed 应**不随内容滚动**、absolute 会随。内核现已支持 `Position::Fixed`（宿主负责不随滚动）
        //   ⇒ 如实透传 `fixed`（不再静默改写；`sticky` 同理已入内核）。
        const allowed = APP_ENUM_VALUES[key]
        if (allowed && !allowed.includes(enumVal)) {
          pushDiag(
            `\`${rawKey}: ${rawVal}\` 不是 App 引擎支持的值（${key} 仅认：${allowed.join(' / ')}）——已跳过（用引擎默认）`,
            'App 端无浏览器 CSS 布局引擎：把该样式改为引擎支持的值，或保留 Web 端渲染（该值在 Web/MP 由 CSS 引擎处理）',
          )
          continue
        }
        out[key] = enumVal
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
      if (key === 'gap') {
        // ★批次 31（CSS 兼容对齐 · 以 Web 为基准）：两值 gap:<row> <col>（等价 row-gap/column-gap）。
        //   单值 ⇒ gap；两值 ⇒ rowGap + columnGap。
        const toks = splitTopLevelSpaces(rawVal)
        if (toks.length === 1) {
          const et = envLengthToken(toks[0]!)
          if (et !== undefined) { out.gap = et; markImportant('gap'); continue }
          const n = numOf(toks[0]!); if (n === undefined) { pushDiag(`gap 非法值 ${rawVal}——应为 1 个数值，已跳过`); continue } out.gap = n; markImportant('gap'); continue
        }
        if (toks.length === 2) {
          const er = envLengthToken(toks[0]!), ec = envLengthToken(toks[1]!)
          if (er !== undefined || ec !== undefined) {
            if (er === undefined || ec === undefined) { pushDiag(`gap 两值含 env 与数值混用 ${rawVal}——已跳过`); continue }
            out.rowGap = er; out.columnGap = ec; markImportant('rowGap'); markImportant('columnGap'); continue
          }
          const r = numOf(toks[0]!), c = numOf(toks[1]!)
          if (r === undefined || c === undefined) { pushDiag(`gap 两值非法 ${rawVal}——应为两个数值，已跳过`); continue }
          out.rowGap = r; out.columnGap = c; markImportant('rowGap'); markImportant('columnGap'); continue
        }
        pushDiag(`gap 无法解析 ${rawVal}——仅支持 1–2 个数值，已跳过`)
        continue
      }
      // ★批次 31：row-gap / column-gap（轴级）
      if (key === 'rowGap' || key === 'columnGap') {
        const et = envLengthToken(rawVal)
        if (et !== undefined) { out[key] = et; markImportant(key); continue }
        const n = numOf(rawVal)
        if (n === undefined) { pushDiag(`gap 非法值 ${rawVal}——应为 1 个数值，已跳过`); continue }
        out[key] = n; markImportant(key); continue
      }
      if (key === 'width' || key === 'height') {
        const pct = /^(\d+(?:\.\d+)?)%$/.exec(rawVal)
        if (pct) {
          const ratioKey = key === 'width' ? 'widthRatio' : 'heightRatio'
          out[ratioKey] = Number(pct[1]) / 100
          markImportant(ratioKey)
          continue
        }
      }
      // ★批次 19（CSS 兼容对齐 · 以 Web 为基准）：`min/max-width/height` 的**百分比** → `*Pct` 派生字段
      //   （`max-width: 100%` 不溢出容器、`min-height: 100%` 撑满——超级应用常用）。基准 = 父内容盒。
      if (key === 'minWidth' || key === 'maxWidth' || key === 'minHeight' || key === 'maxHeight') {
        const pct = /^(\d+(?:\.\d+)?)%$/.exec(rawVal)
        if (pct) {
          const pctKey = key + 'Pct'
          out[pctKey] = Number(pct[1]) / 100
          markImportant(pctKey)
          continue
        }
        // ★★★vw/vh 单位（2026-10-08 · 决策 #595）：`min-height:100vh` 等 → env 视口变量（**运行时真视口**，
        //   比原 `*Pct`（父内容盒近似）更准）。`envLengthToken` 在下方通用尾部先捕获——此处无需特例。
      }
      const envTok = envLengthToken(rawVal)
      if (envTok !== undefined) { out[key] = envTok; markImportant(key); continue }
      const num = numOf(rawVal)
      if (num === undefined) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 不是纯数值（支持 px/数字/百分比宽高/env）`); continue }
      out[key] = num
      markImportant(key)
      continue
    }
    // ★★★边框族收口批（2026-10-05 · 用户「把边框后续未收口的也收到边框里面，比如边框样式等等」）：
    //   `border-<corner>-radius`（逐角长手）——语义 = `border-radius: <tl> <tr> <br> <bl>`（缺省 0）；
    //   就地累积 + 合成（同块内多个逐角声明依次走到这里），与简写同一输出形态：
    //   全等 ⇒ 只写 borderRadius；否则统一值 = max + 逐角掩码。
    const cornerRadius = /^border(TopLeft|TopRight|BottomRight|BottomLeft)Radius$/.exec(key)
    if (cornerRadius) {
      const n = numOf(rawVal)
      if (n === undefined) { pushDiag(`\`${rawKey}: ${rawVal}\` 不是合法长度（支持 px/数字）——已跳过`); continue }
      cornerAcc[cornerRadius[1]!] = n
      const quad: Record<string, number> = {
        topLeft: cornerAcc.TopLeft ?? 0, topRight: cornerAcc.TopRight ?? 0,
        bottomRight: cornerAcc.BottomRight ?? 0, bottomLeft: cornerAcc.BottomLeft ?? 0,
      }
      const vals = [quad.topLeft!, quad.topRight!, quad.bottomRight!, quad.bottomLeft!]
      if (vals.every((v) => v === vals[0])) {
        out.borderRadius = vals[0]!
        markImportant('borderRadius')
      } else {
        out.borderRadius = Math.max(...vals)
        out.borderRadiusCorners = { topLeft: vals[0]! > 0, topRight: vals[1]! > 0, bottomRight: vals[2]! > 0, bottomLeft: vals[3]! > 0 }
        markImportant('borderRadius'); markImportant('borderRadiusCorners')
      }
      continue
    }
    // ★★★边框族收口批（2026-10-05 · 用户「把边框后续未收口的也收到边框里面，比如边框样式等等」）：
    //   `border-style` / `border-width` / `border-color` 的 **1–4 值简写**——CSS 语法：
    //   1 值=四边同 / 2 值=上下·左右 / 3 值=上·左右·下 / 4 值=上·右·下·左。
    //   ★单值形态**放行到既有分支**（统一字段，零行为变化）；多值展开为逐边字段。
    if (key === 'borderWidth' || key === 'borderColor' || key === 'borderStyle') {
      const toks = splitTopLevelSpaces(rawVal)
      if (toks.length >= 2 && toks.length <= 4) {
        const sides4 = ['Top', 'Right', 'Bottom', 'Left'] as const
        const map = toks.length === 2 ? [toks[0]!, toks[1]!, toks[0]!, toks[1]!]
          : toks.length === 3 ? [toks[0]!, toks[1]!, toks[2]!, toks[1]!]
          : [toks[0]!, toks[1]!, toks[2]!, toks[3]!]
        let ok = true
        const parsed: (number | string)[] = []
        for (const t of map) {
          if (key === 'borderWidth') {
            // ★E 组：宽度可为 env 引用（var(--pf-hairline)）——与 CSE 同口径（CSE 对 border-*-width 发射 env）
            const et = envLengthToken(t)
            if (et !== undefined) { parsed.push(et); continue }
            const n = numOf(t)
            if (n === undefined) { ok = false; break }
            parsed.push(n)
          } else if (key === 'borderColor') {
            const c = normalizeCssColor(t)
            if (!c) { ok = false; break }
            parsed.push(c)
          } else {
            const v = t.toLowerCase()
            if (v === 'none') parsed.push(0)   // none ⇒ 该边清零标记（负值语义由消费方处理）
            else if (v === 'solid' || v === 'dashed' || v === 'dotted') parsed.push(v)
            else { ok = false; break }
          }
        }
        if (!ok) {
          pushDiag(`\`${rawKey}: ${rawVal}\` 的 1–4 值简写含未支持取值——已跳过`,
            key === 'borderStyle' ? 'App 端线型支持 solid/dashed/dotted/none' : '宽度为 px/数字；颜色为 hex/rgb()/命名色')
          continue
        }
        for (let i = 0; i < 4; i++) {
          const f = `border${sides4[i]}${key === 'borderWidth' ? 'Width' : key === 'borderColor' ? 'Color' : 'Style'}`
          if (key === 'borderStyle' && parsed[i] === 0) { out[`border${sides4[i]}Width`] = 0; markImportant(`border${sides4[i]}Width`) }
          else { out[f] = parsed[i]!; markImportant(f) }
        }
        continue
      }
    }
    if (PAINT_FIELDS.has(key)) {
      if (key === 'transform') {
        // ★批次 38（对齐 Web · 削减胶水）：**静态 `transform`** —— 位移/缩放/旋转一次性折成数值（**不可继承**）。
        //   App 自绘宿主已有逐节点变换表（动画期用）⇒ 静态值写入**同一张表**（作为动画的基态）。
        //   支持：translate(x[,y]) / translateX / translateY（px/数字/%）、scale(s[,sy]) / scaleX / scaleY、rotate(<deg|rad|turn|grad>)。
        //   不支持（诊断跳过）：skew / matrix / translate3d / rotate3d / perspective（App 变换模型为 2D 位移+缩放+旋转）。
        const t = parseCssTransform(rawVal)
        if (t === false) {
          pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 未支持（仅 translate/translateX/translateY · scale/scaleX/scaleY · rotate；3D/skew/matrix 暂不支持）——已跳过`)
          continue
        }
        if (t === null) continue   // `none` / 单位变换 ⇒ 不发射（零行为变化）
        out.transform = t
        markImportant('transform')
        continue
      }
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
      if (key === 'textOverflow') {
        // ★批次 16（CSS 兼容对齐 · 以 Web 为基准）：`text-overflow` —— App 自绘文本**单行**溢出处理。
        //   Web 默认 `clip`（截断不省略）；`ellipsis` ⇒ 行尾 `…`（列表项/标签截断的超级应用刚需）。
        //   ★仅 `white-space:nowrap` 单行语义（本仓文本无自动换行）：多行 `-webkit-line-clamp` 不支持。
        const v = rawVal.trim().toLowerCase()
        if (!(APP_TEXT_OVERFLOW_VALUES as readonly string[]).includes(v)) {
          pushDiag(`\`${rawKey}: ${rawVal}\` 不是 App 支持的值（仅 ${APP_TEXT_OVERFLOW_VALUES.join(' / ')}）——已跳过`)
          continue
        }
        out[key] = v
        markImportant(key)
        continue
      }
      if (key === 'letterSpacing') {
        // ★批次 20（CSS 兼容对齐 · 以 Web 为基准）：`letter-spacing`（字距，超级应用排版）。
        //   Web 默认 `normal`（= 0，不发射即可）；`<n>px`/`<n>` → 数值（宿主文本通道按 px 应用）。
        //   相对单位（em/rem）本仓未支持 ⇒ 诊断（不猜）。作为**文本可继承**属性沿树继承。
        const v = rawVal.trim().toLowerCase()
        if (v === 'normal') continue   // 默认值 ⇒ 不发射（零行为变化）
        const n = numOf(rawVal)
        if (n === undefined) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 未解析（支持 normal / px / 数字）——已跳过`); continue }
        out[key] = n
        markImportant(key)
        continue
      }
      if (key === 'visibility') {
        // ★批次 25（CSS 兼容对齐 · 以 Web 为基准）：`visibility`（visible/hidden）。
        //   与 `display:none` 不同：盒子**仍占位**（保留布局），只是不绘制 ⇒ 宿主跳过绘制该节点及其子。
        //   CSS 语义**可继承**（父 hidden ⇒ 子默认 hidden，子显式 visible 可覆盖）——见下方继承 walk。
        const v = rawVal.trim().toLowerCase()
        if (v !== 'visible' && v !== 'hidden') { pushDiag(`\`${rawKey}: ${rawVal}\` 不是合法值（仅 visible / hidden）——已跳过`); continue }
        out[key] = v
        markImportant(key)
        continue
      }
      if (key === 'textDecoration') {
        // ★批次 35（对齐 Web）：text-decoration（none/underline/line-through；继承）。
        //   `none` = 默认 ⇒ 不发射；underline/line-through → 枚举字符串。
        const v = rawVal.trim().toLowerCase()
        if (v === 'none') continue   // 默认
        if (v === 'underline' || v === 'line-through') { out[key] = v; markImportant(key); continue }
        pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 未支持（仅 none / underline / line-through）——已跳过`)
        continue
      }
      if (key === 'fontFamily') {
        // ★批次 36（对齐 Web · 削减胶水）：`font-family` 候选清单 → **字体角色**（可继承）。
        //   与 renderer-app 的 normalizeFontFamily **同一映射**（两端一处归一；原生宿主按角色解析）。
        const role = parseFontFamilyRole(rawVal)
        if (role === undefined) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 无法归一为字体角色（system/serif/monospace/rounded/condensed）——已跳过`); continue }
        out[key] = role; markImportant(key); continue
      }
      if (key === 'lineHeight') {
        // ★批次 13：`line-height`（超级应用文本排版）——归一为 token 串：无单位倍数 `1.6` / 绝对 `24px`
        //   （`160%` → 倍数 1.6）。宿主据此算行盒高（倍数 × fontSize）并令字形**垂直居中**。
        const lh = parseLineHeight(rawVal)
        if (lh === null) {
          pushDiag(`\`${rawKey}: ${rawVal}\` 未解析（支持无单位倍数 \`1.6\` / \`160%\` / \`24px\`）——已跳过`)
          continue
        }
        out[key] = lh
        markImportant(key)
        continue
      }
      if (key === 'borderRadius') {
        // ★批次 18（CSS 兼容对齐 · 以 Web 为基准）：`border-radius` 支持**百分比**（Web `border-radius: 50%`
        //   = 内切圆/椭圆——头像/圆点刚需）。百分比折为 `borderRadiusPct`（0..1），宿主按盒尺寸算半径
        //   （`pct × min(w,h)`：正方盒 = 精确圆、与 Web 一致；非正方盒为统一圆角，Web 为椭圆——如实边界）。
        //   多值（逐角简写）未支持 ⇒ 诊断（不猜）。
        const toks = splitTopLevelSpaces(rawVal)
        // ★批次 34（对齐 Web）：1 值 = 统一；2–4 值 = 逐角（CSS 展开 [tl,tr,br,bl]）。
        if (toks.length === 1) {
          const pct = /^(\d+(?:\.\d+)?)%$/.exec(toks[0]!)
          if (pct) { out.borderRadiusPct = Number(pct[1]) / 100; markImportant('borderRadiusPct'); continue }
          const num = numOf(toks[0]!)
          if (num === undefined) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 未解析（支持 1–4 个 px/数字；百分比仅单值）——已跳过`); continue }
          out.borderRadius = num; markImportant('borderRadius'); continue
        }
        if (toks.length >= 2 && toks.length <= 4) {
          const v = toks.length === 2 ? [toks[0]!, toks[1]!, toks[0]!, toks[1]!]
            : toks.length === 3 ? [toks[0]!, toks[1]!, toks[2]!, toks[1]!] : toks
          const nums = v.map((t) => numOf(t))
          if (nums.every((n) => n !== undefined)) {
            const vals = nums as number[]
            const nz = vals.filter((n) => n > 0)
            if (nz.length === 0) continue   // 全 0 = 无圆角
            // 统一半径（全部相等）⇒ 只用 borderRadius
            if (vals.every((n) => n === vals[0])) { out.borderRadius = vals[0]!; markImportant('borderRadius'); continue }
            // 部分角圆 + 非零半径一致 ⇒ borderRadius + 逐角掩码（覆盖真实用法 `12px 12px 0 0`）
            if (nz.every((n) => n === nz[0])) {
              out.borderRadius = nz[0]!
              out.borderRadiusCorners = { topLeft: vals[0]! > 0, topRight: vals[1]! > 0, bottomRight: vals[2]! > 0, bottomLeft: vals[3]! > 0 }
              markImportant('borderRadius'); markImportant('borderRadiusCorners')
              continue
            }
            pushDiag(`border-radius 逐角半径**不一致**（${rawVal}）——已跳过（仅支持统一圆角半径，可只圆部分角如 12px 12px 0 0）`)
            continue
          }
        }
        pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 未解析（支持 1–4 个 px/数字；百分比仅单值）——已跳过`)
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
      // ★★★text-shadow 项（2026-10-08 · css:next P0·2× · CSS Text Decoration）：**文本阴影**。
      //   单层 <dx> <dy> [blur] <color>（无 spread；与 box-shadow 同法折叠为结构化 textShadow）——
      //   宿主在文本绘制时投影（Android setShadowLayer 仅支持文本 / iOS CATextLayer shadow / 鸿蒙 SetTextShadow）。
      if (key === 'textShadow') {
        const sh = parseBoxShadow(rawVal, numOf)
        if (!sh) {
          pushDiag(
            `text-shadow 未解析（支持 dx dy [blur] color；多重阴影取首个）——已跳过`,
            'App 端文本阴影为单层：' + `text-shadow: 0 1px 2px rgba(0,0,0,0.3)` + '；多重暂不支持',
          )
          continue
        }
        out.textShadow = { dx: sh.dx, dy: sh.dy, blur: sh.blur, color: sh.color }
        markImportant('textShadow')
        continue
      }
      // ★★★背景定位家族（2026-10-07 · css:next background-position · 静态单层）：
      //   size/position/repeat 是**背景图层的图像盒**几何（作用于渐变/背景图；值原样下发宿主解析——
      //   与 textAlign/transform 同类：字符串形态，宿主按 Web 几何算端点/平铺）。
      //   支持形态（Web 子集）：size = 长度/百分比/auto（1–2 值）；position = 关键字/长度/百分比（1–2 值）；
      //   repeat = repeat / no-repeat。多值/三值等复杂形态 ⇒ 诊断跳过（不静默近似）。
      if (key === 'backgroundSize' || key === 'backgroundPosition' || key === 'backgroundRepeat') {
        const v = rawVal.trim().toLowerCase()
        const toks = splitTopLevelSpaces(v).filter(Boolean)
        const isLenPct = (t: string): boolean => t === 'auto' || /^[+-]?(?:\d+\.?\d*|\.\d+)(px|rpx|%)$/.test(t) || /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(t)
        const isPosKw = (t: string): boolean => t === 'left' || t === 'center' || t === 'right' || t === 'top' || t === 'bottom'
        let ok = false
        if (key === 'backgroundRepeat') ok = v === 'repeat' || v === 'no-repeat'
        else if (key === 'backgroundSize') ok = toks.length >= 1 && toks.length <= 2 && toks.every(isLenPct)
        else ok = toks.length >= 1 && toks.length <= 2 && toks.every((t) => isLenPct(t) || isPosKw(t))
        if (!ok) {
          pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 未解析（背景定位家族仅支持 size/position 的 1–2 值 [长度/百分比/auto/关键字]、repeat 的 repeat/no-repeat）——已跳过`)
          continue
        }
        out[key] = v
        markImportant(key)
        continue
      }
      // ★★★逐边 border 批：逐边颜色同走**归一化**通道（`border-top-color` 等）
      if (key === 'backgroundColor' || key === 'color' || key === 'borderColor'
          || key === 'borderTopColor' || key === 'borderRightColor' || key === 'borderBottomColor' || key === 'borderLeftColor') {
        // ★★★颜色**归一化**（2026-10-04 修：真机 RustLayout.create 失败暴露）——内核 `parse_css_color`
        //   只认 `#RGB/#RRGGBB/#RRGGBBAA` 十六进制；CSS 常见的 `rgb()/rgba()/transparent` 原样透传
        //   ⇒ create 拒绝 ⇒ **整棵树建不起来**（页面全崩）。⇒ 编译期把常见形态归一为 hex。
        const norm = normalizeCssColor(rawVal)
        if (!norm) {
          pushDiag(
            `颜色 \`${rawKey}: ${rawVal}\` 无法归一为 App 引擎接受的十六进制（#RGB/#RRGGBB/#RRGGBBAA）——已跳过`,
            'App 端颜色支持 hex / rgb() / rgba() / hsl() / hsla() / 命名色 / transparent；其余形态（currentColor / CSS4 新空间 lab/oklch 等）请改 hex',
          )
          continue
        }
        out[key] = norm
      } else if (key === 'outlineWidth' || key === 'outlineColor' || key === 'outlineStyle' || key === 'outlineOffset') {
        // ★★★outline 族项（2026-10-08）：轮廓宽/色/线型 + 偏移（偏移可负）
        if (key === 'outlineOffset' || key === 'outlineWidth') {
          const n = numOf(rawVal)
          if (n === undefined) { pushDiag(`\`${rawKey}: ${rawVal}\` 不是纯数值`); continue }
          out[key] = n; markImportant(key); continue
        }
        if (key === 'outlineColor') {
          const c = normalizeCssColor(rawVal)
          if (!c) { pushDiag(`outline-color \`${rawVal}\` 无法归一为十六进制——已跳过`); continue }
          out.outlineColor = c; markImportant('outlineColor'); continue
        }
        const sv = rawVal.trim().toLowerCase()
        if (!['solid', 'dashed', 'dotted', 'none'].includes(sv)) { pushDiag(`outline-style \`${rawVal}\` 未支持（solid/dashed/dotted/none）——已跳过`); continue }
        out.outlineStyle = sv; markImportant('outlineStyle'); continue
      } else if (key === 'opacity') {
        // ★批次 15（以 Web 为基准）：Web 对 `opacity` 越界值一律 clamp 到 0..1（含 `%`）
        //   ⇒ App 同语义（此前原样透传 1.5 等，与 Web 不符）。
        const p = /^(\d*\.?\d+)%$/.exec(rawVal.trim())
        const n = p ? Number(p[1]) / 100 : numOf(rawVal)
        if (n === undefined) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 不是合法数值（0..1 或 %）`); continue }
        out[key] = Math.max(0, Math.min(1, n))
      } else {
        // ★E 组（设备标量）：绘制侧长度字段亦接受内置 env 引用（border-bottom-width: var(--pf-hairline) 等）
        const le = lenOrEnv(rawVal)
        if (le === undefined) { pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 不是纯数值`); continue }
        out[key] = le
      }
      markImportant(key)
      continue
    }
    // ★批次 2（值/简写归一化）：`background` 简写 → backgroundColor（仅纯色；渐变/图片另走通道）
    if (key === 'background') {
      // ★批次 33（CSS 兼容对齐 · 以 Web 为基准）：CSS 渐变 → 引擎 fillGradient 通道
      //   （复用既有绘制通道；免去开发者手写 fill-gradient='{json}' 的胶水）。
      const grad = parseCssGradient(rawVal)
      if (grad) { out.fillGradient = grad; markImportant('fillGradient'); continue }
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
    // ★批次 33：`background-image` 渐变 → fillGradient（`none` 已由 no-op 处理）
    if (key === 'backgroundImage') {
      const grad = parseCssGradient(rawVal)
      if (grad) { out.fillGradient = grad; markImportant('fillGradient'); continue }
      pushDiag(`style 里 \`${rawKey}: ${rawVal}\` 未解析（仅支持 linear-gradient / radial-gradient；图片 url() 请用原生组件）——已跳过`)
      continue
    }
    // ★★★outline 族项（2026-10-08 · css:next P0·3× · Basic UI）：**轮廓**（盒外/内偏移的环，不占布局）。
    //   `outline` 简写（<width> <style> <color>，序任意）→ outlineWidth/outlineStyle/outlineColor；
    //   `outline-offset`（可为负：正=盒外 / 负=盒内）→ outlineOffset。宿主绘制（host-only，内核零改动）。
    if (key === 'outline') {
      const b = parseBorderShorthand(rawVal)
      if (b.style !== undefined && b.style !== 'solid' && b.style !== 'dashed' && b.style !== 'dotted' && b.style !== 'none') {
        pushDiag(`outline 简写 \`${rawVal}\` 的线型 \`${b.style}\` 未支持（App 端线型支持 solid/dashed/dotted/none）——已跳过`)
        continue
      }
      if (b.width === undefined && b.color === undefined && b.style === undefined) {
        pushDiag(`outline 简写 \`${rawVal}\` 未解析出宽度/颜色（仅支持 \`<width> <style> <color>\`）——已跳过`)
        continue
      }
      if (b.width !== undefined) { out.outlineWidth = b.width; markImportant('outlineWidth') }
      if (b.color !== undefined) { out.outlineColor = b.color; markImportant('outlineColor') }
      if (b.style !== undefined && b.style !== 'solid') { out.outlineStyle = b.style; markImportant('outlineStyle') }
      continue
    }
    // ★批次 5（CSS 兼容对齐 · 边框）：`border` 简写 → borderWidth + borderColor（uniform）。
    if (key === 'border') {
      const b = parseBorderShorthand(rawVal)
      // ★★★边框族收口批（2026-10-05）：非 solid 线型**已支持**（dashed/dotted——宿主按线型绘制）。
      if (b.style !== undefined && b.style !== 'solid' && b.style !== 'none' && b.style !== 'dashed' && b.style !== 'dotted') {
        pushDiag(
          `border 简写 \`${rawVal}\` 的线型 \`${b.style}\` 未支持（App 端线型支持 solid/dashed/dotted/none）——已跳过（不画成实线冒充）`,
          'double/groove/ridge/inset/outset 无对应；dashed/dotted 已支持（用 solid/dashed/dotted/none）',
        )
        continue
      }
      if (b.width === undefined && b.color === undefined) {
        pushDiag(
          `border 简写 \`${rawVal}\` 未解析出宽度/颜色（仅支持 uniform 单色实线，如 \`1px solid #ccc\`）——已跳过`,
          'App 端边框为**统一实线**：`border: <width> solid <color>`；逐边（border-bottom 等）/var() 暂不支持',
        )
        continue
      }
      if (b.width !== undefined) { out.borderWidth = b.width; markImportant('borderWidth') }
      if (b.color !== undefined) { out.borderColor = b.color; markImportant('borderColor') }
      // ★★★边框族收口批：线型落四边 Style（solid 不落——是缺省零行为变化；dashed/dotted 落）
      if (b.style === 'dashed' || b.style === 'dotted') {
        for (const S of ['Top', 'Right', 'Bottom', 'Left'] as const) { out[`border${S}Style`] = b.style; markImportant(`border${S}Style`) }
      }
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
    // `border-style`（单值）：solid ⇒ 四边 Style 同值（宿主按线型绘制）；none ⇒ 四边清零；其余诊断
    if (key === 'borderStyle') {
      const v = rawVal.trim().toLowerCase()
      if (v === 'solid' || v === 'dashed' || v === 'dotted') {
        for (const S of ['Top', 'Right', 'Bottom', 'Left'] as const) { out[`border${S}Style`] = v; markImportant(`border${S}Style`) }
      } else if (v === 'none') {
        for (const S of ['Top', 'Right', 'Bottom', 'Left'] as const) { out[`border${S}Width`] = 0; markImportant(`border${S}Width`) }
      } else {
        pushDiag(`\`border-style: ${rawVal}\` 未支持（App 端线型支持 solid/dashed/dotted/none）——已跳过`, 'double/groove/ridge/inset/outset/hidden 无对应；solid/dashed/dotted/none 可用')
      }
      continue
    }
    // ★★★line-clamp 项（2026-10-08 · css:next P0·4×）：多行截断（最多 N 行 + 末行尾省略号）。
    //   WebKit 三件套的 `-webkit-line-clamp:<n>`（key=kebabToCamel=WebkitLineClamp）→ `lineClamp: n`；
    //   `-webkit-box-orient` 无 App 对等（App 文本天然纵向）⇒ 静默丢弃（clamp 惯用）。宿主据此绘制最多 N 行 + 尾省略号。
    if (key === 'WebkitLineClamp') {
      const n = Number.parseInt(rawVal.trim(), 10)
      if (!Number.isInteger(n) || n <= 0) {
        pushDiag('style 里 -webkit-line-clamp: ' + rawVal + ' 未解析（需正整数行数；0/负 = 无截断）——已跳过')
        continue
      }
      out.lineClamp = n
      markImportant('lineClamp')
      continue
    }
    if (key === 'WebkitBoxOrient') {
      // 无 App 对等（App 文本纵向块级）——仅作 clamp 惯用，静默丢弃
      continue
    }
    // ★★★place-items 简写（2026-10-08 · CSS Box Alignment）：align-items 前 justify-items 后（单值 ⇒ 两轴同）。
    //   展开为 alignItems（已支持）+ justifyItems（本项新增长手）。
    if (key === 'placeItems') {
      const toks = splitTopLevelSpaces(rawVal.trim()).map((t) => t.toLowerCase())
      if (toks.length === 0 || toks.length > 2) {
        pushDiag(placeItemsDiag(rawVal, '支持 1–2 个值：align-items 前 justify-items 后'))
        continue
      }
      const alignV = toks[0]!
      const justifyV = toks[1] ?? toks[0]!
      const alignAllowed = APP_ENUM_VALUES.alignItems!
      const justifyAllowed = APP_ENUM_VALUES.justifyItems!
      if (!alignAllowed.includes(alignV) || !justifyAllowed.includes(justifyV)) {
        pushDiag(placeItemsDiag(rawVal, 'align-items 认 ' + alignAllowed.join('/') + '；justify-items 认 ' + justifyAllowed.join('/')))
        continue
      }
      out.alignItems = alignV; markImportant('alignItems')
      out.justifyItems = justifyV; markImportant('justifyItems')
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
    // ★★★逐边 border 批（2026-10-05 · 用户「全端对齐不留缺陷」）：**逐边简写** `border-<side>`——
    //   语料 21 处（列表分隔线 / 卡片顶线 / 侧边强调）。宽度/颜色折为 per-side 字段（宿主逐边绘制）。
    //   · `border-bottom: 1px solid #ccc` ⇒ borderBottomWidth=1 + borderBottomColor=#ccc
    //   · `border-bottom: none` ⇒ borderBottomWidth=0（**重置**：级联可覆盖低优先级的旧值）
    //   · 非实线（dashed/dotted…）⇒ 诊断 + 跳过（App 端边框仅实线；与 uniform `border` 同口径，
    //     不静默画成实线冒充——该能力面属独立项 `border-*-style`）
    //   ★宽度/颜色**长手**（`border-bottom-width` 等）走上方 PAINT 分支（字段已在 APP_PAINT_FIELDS）。
    const sideShort = /^border(Top|Right|Bottom|Left)$/.exec(key)
    if (sideShort) {
      const side = sideShort[1]!
      const W = `border${side}Width`
      const C = `border${side}Color`
      const b = parseBorderShorthand(rawVal)
      // ★★★边框族收口批（2026-10-05）：非 solid 已支持（dashed/dotted）
      if (b.style !== undefined && b.style !== 'solid' && b.style !== 'none' && b.style !== 'dashed' && b.style !== 'dotted') {
        pushDiag(
          `border-${side.toLowerCase()}: ${rawVal} 的线型 \`${b.style}\` 未支持（App 端线型支持 solid/dashed/dotted/none）——已跳过`
            + '（不画成实线冒充）',
          'double/groove/ridge/inset/outset 无对应',
        )
        continue
      }
      // ★线型落该边 Style（solid 不落——缺省；dashed/dotted 落）
      if (b.style === 'dashed' || b.style === 'dotted') { out[`border${side}Style`] = b.style; markImportant(`border${side}Style`) }
      if (b.style === 'none' || (b.width === undefined && b.color === undefined)) {
        // `border-<side>: none`（或未解析出宽度/颜色）⇒ 该边**清零**（重置语义）
        out[W] = 0
        markImportant(W)
        continue
      }
      if (b.width !== undefined) { out[W] = b.width; markImportant(W) }
      if (b.color !== undefined) { out[C] = b.color; markImportant(C) }
      else if (b.width !== undefined) {
        pushDiag(
          `border-${side.toLowerCase()}: ${rawVal} 的颜色未解析`
            + (/\bvar\(/.test(rawVal) ? '（var() 编译期不可解析）' : '（非 hex/rgb/rgba 颜色）')
            + '——该边不会绘制',
          '把颜色写为 hex（如 #e3e6eb）；var() 令牌色当前不在 App 折叠面内',
        )
      }
      continue
    }
    // 逐边 **线型长手**（`border-<side>-style`）：solid = 默认（无操作）；none ⇒ 该边清零；其余诊断+跳过
    const sideStyle = /^border(Top|Right|Bottom|Left)Style$/.exec(key)
    if (sideStyle) {
      const side = sideStyle[1]!
      const v = rawVal.trim().toLowerCase()
      if (v === 'none') { out[`border${side}Width`] = 0; markImportant(`border${side}Width`) }
      else if (v === 'dashed' || v === 'dotted') { out[`border${side}Style`] = v; markImportant(`border${side}Style`) }
      else if (v !== 'solid') {
        pushDiag(`border-${side.toLowerCase()}-style: ${rawVal} 未支持（App 端线型支持 solid/dashed/dotted/none）——已跳过`)
      }
      continue
    }
    // 逐边宽度/颜色**长手**（`border-bottom-width` 等）由上方 PAINT 分支消费（字段已登记）；
    // 此处仅兜未登记形态（防静默丢：清单外键落到文件末尾的通用诊断）。
    // 认不出的键：诊断（可能是指令/伪类等不需要的键——故用 hint 说明而非 error）
    pushDiag(`style 里 \`${rawKey}\` 不在引擎字段表内（已忽略）`, '引擎字段见 packages/compiler/src/vapor/template.ts 的 LAYOUT_FIELDS/PAINT_FIELDS')
  }
  return out
}

/**
 * ★★★overflow-x 项（2026-10-06）：**Web 归一 + 形态收敛**（必须挂在**级联后的最终样式**上调用——
 *   per-rule 归一会被跨规则级联破坏，如 `.a{overflow-x:hidden}` + `.b{overflow-y:scroll}`）。
 *   · **归一**（CSS Overflow 3 计算值规则，真 Chromium getComputedStyle 实测）：一侧 visible、
 *     另一侧非 visible ⇒ visible 归为 auto（`overflow-x: hidden` ⇒ x=hidden · y=auto）；
 *   · **收敛**：x==y ⇒ 统一 `overflow`（既有引擎面语义、零 churn）；x≠y ⇒ 逐轴字段；全 visible ⇒ 删除。
 */
export function normalizeOverflowFields(style: Record<string, unknown>): void {
  const rawX = typeof style.overflowX === 'string' ? (style.overflowX as string) : undefined
  const rawY = typeof style.overflowY === 'string' ? (style.overflowY as string) : undefined
  const uniform = typeof style.overflow === 'string' ? (style.overflow as string) : undefined
  if (rawX === undefined && rawY === undefined && uniform === undefined) return
  let x = rawX ?? uniform ?? 'visible'
  let y = rawY ?? uniform ?? 'visible'
  const ok = (v: string): boolean => v === 'visible' || v === 'hidden' || v === 'scroll' || v === 'auto'
  if (!ok(x) || !ok(y)) return // 非法值在解析期已诊断（此处不动——不静默猜测）
  if (x === 'visible' && y !== 'visible') x = 'auto'
  if (y === 'visible' && x !== 'visible') y = 'auto'
  delete style.overflowX
  delete style.overflowY
  if (x === 'visible' && y === 'visible') delete style.overflow
  else if (x === y) style.overflow = x
  else {
    // x≠y（归一后两轴均非 visible）⇒ **折叠单字段** 'hidden' 保留：
    //   · 内核/宿主判"裁不裁"用单字段（App 域内 auto/scroll 无滚动交互、渲染 = 静态裁剪 ⇒ 折叠无损）；
    //   · 逐轴字段同步保留（IR/快照保真、跨端可表达性；宿主渲染不用逐轴）。
    style.overflow = 'hidden'
    style.overflowX = x
    style.overflowY = y
  }
}

/**
 * ★★★flex-direction 初值归一（2026-10-08 · 用户抓出 Web 分歧）：
 *   CSS 里 `flex-direction` 的**初值是 `row`**——但只对 **`display:flex` 的容器**有意义。
 *   而 App 内核只有 flex（无 block 流）：未声明 display 的节点被内核当 **column**（block-like 近似，决策 #518/#542）。
 *   ⇒ 凡**声明了 `display:flex` 且未显式写 `flex-direction`** ⇒ 补 `row`（= Web 初值）：
 *     让开发者按 **Web 标准**写（`display:flex; justify-content:center` 期望**水平**居中）在 App 上直接成立，
 *     无需再补 `flex-direction:row` 的**胶水对齐代码**（用户原则：开发者不感知多端差异、严格以 Web 为基准）。
 *   ★只补 `display==='flex'`：未声明 display 的 block 近似保持 column（否则块级纵向堆叠语义被破坏）；grid 不用主轴。
 *   ★级联后归一（class+inline 合并完毕才调用）——per-rule 补会把"后声明的 flex-direction"覆盖掉。
 */
export function normalizeFlexDirection(style: Record<string, unknown>): void {
  if (style.display === 'flex' && style.flexDirection === undefined) style.flexDirection = 'row'
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
  /** ★批次 37（对齐 Web · 选择器）：通配段 `*`——匹配任意元素（特异性 0） */
  universal?: boolean
  /**
   * ★批次 37：**静态结构伪类**（编译期可判——位置在模板树里是确定的）。
   *   `:first-child` / `:last-child` / `:nth-child(An+B|odd|even|n)`。
   *   【为什么能静态判】App 无 CSS 引擎，但**元素兄弟序在编译期树遍历里已知** ⇒ 编译期算一次。
   *   诚实边界：状态伪类（`:hover`/`:active`/`:focus`/`:checked`）需运行时状态通道 ⇒ 仍诊断跳过。
   */
  pseudo?: { kind: 'first-child' | 'last-child' | 'nth-child'; a: number; b: number }
  /** ★批次 37：`:not(<简单选择器>)` 的取反段（当前支持单段：类/标签/通配/结构伪类） */
  not?: ClassStyleSegment
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
    // ★批次 37：伪类按 **class 级**计（CSS 规则：`:first-child` 特异性同类）；`:not(x)` 计 x 的特异性。
    if (seg.pseudo) b += 1
    if (seg.not) { const s = specificityOf([seg.not]); a += s[0]; b += s[1]; c += s[2] }
    if (seg.tag) c += 1
    // 通配 `*` 不贡献特异性（CSS 规则）
  }
  return [a, b, c]
}

/** 解析 `<style>` 文本 → 选择器规则表（源序）；不支持的整条跳过并计数（调用方决定是否诊断） */
export function parseClassRules(css: string, tokens?: Record<string, string>, keyframes?: KeyframesMap): { rules: ClassStyleRule[]; skipped: number } {
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
      const style = parseStaticStyle(decls, () => {}, important, tokens, keyframes)
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

/** 解析单条选择器为「段 + 组合符」链；不支持的形态返回 null（状态伪类/属性/兄弟/伪元素等） */
function parseSelectorChain(sel: string): { segments: ClassStyleSegment[]; combinators: Array<' ' | '>'> } | null {
  if (!sel) return null
  // ★批次 37：先展开 Vue **作用域穿透选择器**（`:deep()`/`::v-deep()`/`>>>`）——展开后按普通选择器解析。
  let work: string | null = sel.replace(/\s*>>>\s*/g, ' ')
  work = unwrapDeep(work)
  if (work === null) return null
  // 不支持：属性选择器、兄弟组合、插值、花括号
  if (/[\[\]{}]|\+~|[$@]/.test(work)) return null
  // 按 `>`（子）与空白（后代）切段；先统一 `A>B` → `A > B`
  const normalized = work.replace(/\s*>\s*/g, ' > ')
  const parts = normalized.split(/\s+/).filter(Boolean)
  const segments: ClassStyleSegment[] = []
  const combinators: Array<' ' | '>'> = []
  for (const part of parts) {
    if (part === '>') {
      if (segments.length === 0) return null // 以 > 开头
      combinators[segments.length - 1] = '>'
      continue
    }
    const seg = parseSelectorSegment(part)
    if (!seg) return null
    if (segments.length > 0 && combinators[segments.length - 1] === undefined) combinators[segments.length - 1] = ' '
    segments.push(seg)
  }
  if (segments.length === 0) return null
  return { segments, combinators }
}

/**
 * ★批次 37：展开 Vue 作用域穿透选择器 `:deep(<inner>)` / `::v-deep(<inner>)`（含括号平衡）。
 *   展开即成普通后代选择器（本仓不做 scope 后缀之外的作用域处理）；`>>>` 由调用方先替换为空格。
 * @returns 展开后的选择器；括号不平衡 ⇒ null（不支持的形态）
 */
function unwrapDeep(sel: string): string | null {
  const re = /:{1,2}(?:deep|v-deep)\s*\(/i
  let out = sel
  for (let guard = 0; guard < 16; guard++) {
    const m = re.exec(out)
    if (!m) return out
    const open = out.indexOf('(', m.index)
    let depth = 0
    let close = -1
    for (let i = open; i < out.length; i++) {
      if (out[i] === '(') depth++
      else if (out[i] === ')') { depth--; if (depth === 0) { close = i; break } }
    }
    if (close < 0) return null
    const inner = out.slice(open + 1, close).trim()
    out = out.slice(0, m.index) + ' ' + inner + ' ' + out.slice(close + 1)
  }
  return null
}

/** `:nth-child(...)` 参数 → `{a,b}`（`An+B` / `odd` / `even` / 整数）；不合法 ⇒ null */
function parseNth(arg: string): { a: number; b: number } | null {
  const s = arg.trim().toLowerCase()
  if (!s) return null
  if (s === 'odd') return { a: 2, b: 1 }
  if (s === 'even') return { a: 2, b: 0 }
  if (/^[+-]?\d+$/.test(s)) return { a: 0, b: Number(s) }
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(s)
  if (!m) return null
  const a = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : Number(m[1])
  return { a, b: m[2] ? Number(m[2]) : 0 }
}

/**
 * 解析**单段**（可选标签 + 类 + 通配 + 结构伪类 + `:not(简单选择器)`）。
 * 不支持的形态（状态伪类 / 伪元素 / 多伪类叠加等）⇒ null（整条规则跳过 + 诊断，不静默半支持）。
 */
function parseSelectorSegment(part: string): ClassStyleSegment | null {
  let rest = part
  const pseudos: Array<{ name: string; arg?: string }> = []
  rest = rest.replace(/:([a-z-]+)(?:\(([^()]*)\))?/gi, (_m, name: string, arg: string | undefined) => {
    pseudos.push({ name: String(name).toLowerCase(), arg: arg === undefined ? undefined : String(arg) })
    return ''
  })
  if (rest.includes(':')) return null // 残留（伪元素 `::before` 等）⇒ 不支持
  let universal = false
  let pseudo: ClassStyleSegment['pseudo']
  let not: ClassStyleSegment | undefined
  for (const p of pseudos) {
    if (p.name === 'first-child') { if (pseudo) return null; pseudo = { kind: 'first-child', a: 0, b: 1 }; continue }
    if (p.name === 'last-child') { if (pseudo) return null; pseudo = { kind: 'last-child', a: 0, b: 1 }; continue }
    if (p.name === 'nth-child') {
      if (pseudo) return null
      const n = parseNth(p.arg ?? '')
      if (!n) return null
      pseudo = { kind: 'nth-child', a: n.a, b: n.b }
      continue
    }
    if (p.name === 'not') {
      if (not) return null
      const inner = parseSelectorSegment((p.arg ?? '').trim())
      if (!inner || inner.not) return null // 递归拒绝嵌套 `:not`
      not = inner
      continue
    }
    return null // 状态伪类（:hover/:active/:focus/...）与其余未支持伪类
  }
  const classes = [...rest.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((x) => stripScopeSuffix(x[1]!))
  rest = rest.replace(/\.[A-Za-z_][\w-]*/g, '')
  if (rest === '*') { universal = true; rest = '' }
  let tag: string | undefined
  if (rest) {
    if (!/^[A-Za-z][\w-]*$/.test(rest)) return null // 类型名合法形态：单标识符
    tag = rest
  }
  if (!universal && !tag && classes.length === 0 && !pseudo && !not) return null // 空段
  const seg: ClassStyleSegment = { classes }
  if (tag) seg.tag = tag
  if (universal) seg.universal = true
  if (pseudo) seg.pseudo = pseudo
  if (not) seg.not = not
  return seg
}

/** 节点匹配上下文：类集合 + 类型名（tag） */
export interface StyleMatchNode {
  classes: Set<string>
  /** 节点原始 tag（如 `h3`/`code`/`div`/`p-button`）；用于类型选择器匹配 */
  tag?: string
  /** ★批次 37：该节点在**元素兄弟**中的序号（0-based；仅计真元素）——结构伪类匹配用 */
  index?: number
  /** ★批次 37：同级**元素兄弟**总数——`:last-child`/`:nth-child` 计算用 */
  count?: number
}

/**
 * 该节点是否满足某段要求（标签/类/通配 + 结构伪类 + `:not` 取反）。
 * ★批次 37：结构伪类靠节点自身的**元素兄弟序**（`index`/`count`，见 StyleMatchNode）。
 */
function segmentMatches(seg: ClassStyleSegment, node: StyleMatchNode): boolean {
  if (!seg.universal) {
    if (seg.tag && seg.tag !== node.tag) return false
    if (!seg.classes.every((c) => node.classes.has(c))) return false
  }
  if (seg.pseudo) {
    if (node.index === undefined || node.count === undefined) return false
    if (seg.pseudo.kind === 'last-child') {
      if (node.index !== node.count - 1) return false
    } else if (!matchNth(seg.pseudo, node.index + 1)) {
      return false
    }
  }
  if (seg.not && segmentMatches(seg.not, node)) return false
  return true
}

/** `nth-child` 是否命中（`pos` = 1-based 位置）：存在整数 n≥0 使 pos = a·n + b */
function matchNth(p: NonNullable<ClassStyleSegment['pseudo']>, pos: number): boolean {
  if (p.kind === 'first-child') return pos === 1
  const { a, b } = p
  if (a === 0) return pos === b
  const d = pos - b
  return d % a === 0 && d / a >= 0
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
  /**
   * ★批次 37：是否有**命中的规则带静态结构伪类**（`:first-child`/`:last-child`/`:nth-child`）——
   *   供模板侧判断"行内（v-for）结构伪类"（运行期每行克隆同一模板 ⇒ 静态求值会作用于**所有行**，非 Web 语义）⇒ 诊断。
   */
  structural: boolean
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
  // ★批次 37：命中规则里是否含**结构伪类**（行内 v-for 需诊断——见 ResolvedClassStyles.structural）
  const structural = matched.some((rule) => rule.segments.some((seg) => seg.pseudo !== undefined))
  for (const rule of matched) {
    for (const [k, v] of Object.entries(rule.decls)) {
      if (rule.important.has(k)) { important[k] = v; importantKeys.add(k) }
      else normal[k] = v
    }
  }
  return { styles: { ...normal, ...important }, important: importantKeys, structural } // important 优先
}

/**
 * ★批次 30（对齐 Web · 削减胶水）：**动态 `:class` 的自匹配类规则**。
 *   投影口径：只保留**单段、纯类**规则（`.a` / `.a.b`，无 tag、无后代/子组合）——
 *   动态情境（运行期才知道活跃类）无祖先上下文；含 tag 或组合的规则如实**不投影**。
 *   返回按 (特异性, 源序) 升序（运行期「后应用者胜」可直接顺序覆盖）。
 */
export interface DynamicClassRule {
  classes: string[]
  decls: Record<string, unknown>
  specificity: [number, number, number]
  important: string[]
  order: number
}
export function projectDynamicClassRules(rules: ClassStyleRule[]): DynamicClassRule[] {
  const out: DynamicClassRule[] = []
  for (const r of rules) {
    if (r.combinators.length !== 0) continue          // 后代/子组合 ⇒ 无祖先上下文，舍去
    const seg = r.segments[0]
    if (!seg || seg.tag || !seg.classes || seg.classes.length === 0) continue  // 需 tag 匹配 或 无类 ⇒ 舍去
    out.push({
      classes: [...seg.classes],
      decls: r.decls,
      specificity: r.specificity,
      important: [...r.important],
      order: r.order,
    })
  }
  out.sort((x, y) => {
    for (let i = 0; i < 3; i++) { const d = (x.specificity[i] ?? 0) - (y.specificity[i] ?? 0); if (d !== 0) return d }
    return x.order - y.order
  })
  return out
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
      `<style> 中有 ${skipped} 条**不支持的选择器**规则被跳过（支持：类/元素/通配选择器 + 后代/子组合 + 静态结构伪类 :first-child / :last-child / :nth-child / :not(...)，以及 Vue :deep()/::v-deep()/>>>）`,
      'App 端无 CSS 引擎：**状态伪类**（:hover/:active/:focus/:checked）与属性/兄弟选择器/伪元素/@media 仍不支持；把关键样式改为类/元素/结构伪类选择器或 inline style，或保留 Web 端渲染',
    )
  }
  return out
}

/**
 * ★批次 26/27（CSS 兼容对齐 · 以 Web 为基准）：**Web 默认值 / 重置声明** → 要记录的默认值。
 *   null ⇒ 非 no-op（正常走后续解析）；否则返回要写入 `out` 的字段（可能为空 {} = 无 App 字段，直接跳过且不诊断）。
 *   ★批次 27：有 App 字段的**必须记录默认值**（`border:none`→borderWidth:0 等）——否则级联覆盖失效。
 */
function noOpResetValue(key: string, val: string): Record<string, unknown> | null {
  const v = val.trim().toLowerCase()
  switch (key) {
    // 无 App 对应字段 ⇒ 空记录（级联无关，直接跳过）
    case 'textDecoration':
    case 'backgroundImage':
      return v === 'none' ? {} : null
    // ★★★outline 族项（2026-10-08）：outline 成真字段 ⇒ `outline:none` 记重置（级联覆盖生效）
    case 'outline':
      return v === 'none' ? { outlineWidth: 0 } : null
    // ★批次 38：transform 已成真字段 ⇒ 记录重置（级联须能覆盖低优先级的 translate/scale/rotate）
    case 'transform':
      return v === 'none' ? { transform: null } : null
    // 有 App 字段 ⇒ 记录**默认值**（保证级联覆盖生效）
    case 'boxShadow':
      return v === 'none' ? { boxShadow: null } : null
    case 'textShadow':
      return v === 'none' ? { textShadow: null } : null
    case 'border':
      return (v === 'none' || v === '0' || v === '0px') ? { borderWidth: 0 } : null
    case 'background':
      return v === 'none' ? { backgroundColor: '#00000000' } : null
    case 'display':
      // App 默认 display = flex 且 flex-direction = column（= block-like）⇒ `display:block` **无行为差异** ⇒
      //   空记录（不落键；避免给每个 block 元素平白加 display:flex 的 churn）。`inline*` 才是真缺口。
      return v === 'block' ? {} : null
    // ★★全端对齐批（2026-10-05）：`white-space` 移出 no-op 表——现为**真字段**（宿主消费：
    //   折行/保留空白/单行截断/裁切），处理见下方 LAYOUT_FIELDS 分支。
    // ★★★overflow-x 项（2026-10-06）：overflowX/overflowY **移出 no-op 表**——显式 `visible` 也记录
    //   （级联保真：`.b{overflow-x:visible}` 可覆盖 `.a{overflow-x:hidden}`；归一化在最终样式上做）。
    default:
      return null
  }
}

/**
 * ★批次 40（对齐 Web）：CSS `transform-origin` → 盒分数 `{x, y}`（宿主变换锚点）。
 *   支持：关键字（left/center/right/top/bottom；1 值 `top`/`bottom` 定 y、`left`/`right` 定 x、`center` 两轴 0.5）
 *   · 百分比（→ 分数）· `0`。**非零 px/rpx 需盒尺寸**（编译期不可知）⇒ 返回 null（调用方诊断跳过）。
 */
function parseTransformOrigin(val: string): { x: number; y: number } | null {
  const toks = val.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (toks.length === 0 || toks.length > 2) return null
  const frac = (t: string): number | undefined => {
    const pct = /^([+-]?(?:\d+\.?\d*|\.\d+))%$/.exec(t)
    if (pct) return Number(pct[1]) / 100
    if (t === '0' || t === '0px' || t === '0rpx') return 0
    return undefined   // 非零 px/rpx / 其它单位 ⇒ 需盒尺寸（不可编译期求）
  }
  const xOf = (t: string): number | undefined => t === 'left' ? 0 : t === 'center' ? 0.5 : t === 'right' ? 1 : frac(t)
  const yOf = (t: string): number | undefined => t === 'top' ? 0 : t === 'center' ? 0.5 : t === 'bottom' ? 1 : frac(t)
  if (toks.length === 1) {
    const t = toks[0]!
    if (t === 'top') return { x: 0.5, y: 0 }
    if (t === 'bottom') return { x: 0.5, y: 1 }
    if (t === 'left') return { x: 0, y: 0.5 }
    if (t === 'right') return { x: 1, y: 0.5 }
    if (t === 'center') return { x: 0.5, y: 0.5 }
    const f = frac(t)
    return f === undefined ? null : { x: f, y: 0.5 }
  }
  // 两值：第一个是纵向关键字（top/bottom）⇒ 交换（CSS 允许 `top left` 顺序）
  const a = toks[0]!
  const b = toks[1]!
  const aIsVert = a === 'top' || a === 'bottom'
  const x = aIsVert ? xOf(b) : xOf(a)
  const y = aIsVert ? yOf(a) : yOf(b)
  if (x === undefined || y === undefined) return null
  return { x, y }
}

export interface KeyframeStop { offset: number; decls: Record<string, unknown> }
export type KeyframesMap = Record<string, KeyframeStop[]>

/**
 * ★批次 42（动效 · 对齐 Web）：解析 `<style>` 里的 `@keyframes <name> { … }` → `name → 停靠点表`。
 *   停靠点：`from`/`to`/`<n>%`（→ offset 0..1）；`decls` 只收**可动画通道**（`opacity` + `transform` 子项）。
 *   诚实边界：只支持 opacity 与 transform（px 位移/等比缩放/旋转）；其余声明忽略（不静默——由上层对未支持形态诊断）。
 */
export function parseKeyframes(css: string): KeyframesMap {
  const out: KeyframesMap = {}
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const kfRe = /@keyframes\s+([A-Za-z_][\w-]*)\s*\{/g
  let m: RegExpExecArray | null
  while ((m = kfRe.exec(body))) {
    const name = m[1]!
    const open = m.index + m[0].length - 1
    let depth = 0
    let close = -1
    for (let i = open; i < body.length; i++) {
      if (body[i] === '{') depth++
      else if (body[i] === '}') { depth--; if (depth === 0) { close = i; break } }
    }
    if (close < 0) continue
    const inner = body.slice(open + 1, close)
    const stops: KeyframeStop[] = []
    const stopRe = /([^{}]+)\{([^{}]*)\}/g
    let s: RegExpExecArray | null
    while ((s = stopRe.exec(inner))) {
      const offs = s[1]!.split(',').map((x) => x.trim()).filter(Boolean).map((t) => {
        if (t === 'from') return 0
        if (t === 'to') return 1
        const p = /^(\d+(?:\.\d+)?)%$/.exec(t)
        return p ? Number(p[1]) / 100 : NaN
      }).filter((n) => Number.isFinite(n))
      if (offs.length === 0) continue
      const decls: Record<string, unknown> = {}
      for (const part of s[2]!.split(';')) {
        const i2 = part.indexOf(':')
        if (i2 < 0) continue
        const k = part.slice(0, i2).trim().toLowerCase()
        const v = part.slice(i2 + 1).trim()
        if (k === 'opacity') {
          const n = numOf(v)
          if (n !== undefined) decls.opacity = n
        } else if (k === 'transform') {
          const t = parseCssTransform(v, true)   // ★关键帧端点：保留 identity（translateY(0) 是有意义的终点）
          if (t && t !== null) decls.transform = t
        }
      }
      for (const o of offs) stops.push({ offset: o, decls })
    }
    if (stops.length > 0) out[name] = stops
  }
  return out
}

/**
 * ★批次 42：把 `@keyframes` 停靠点表 + 总时长**解析为逐通道的 keyframe 规格**
 *   （内核 `anim_start` 的 `{kind, from, keyframes:[{to,durMs,curve}]}` 形态）。
 *   非等比缩放 / % 位移（需盒尺寸）⇒ 该通道跳过（如实，不猜）。
 */
function resolveAnimationChannels(
  stops: KeyframeStop[],
  durMs: number,
  curve: number,
): Array<{ kind: number; from: number; keyframes: Array<{ to: number; durMs: number; curve: number }> }> {
  const chans: Array<{ kind: number; from: number; keyframes: Array<{ to: number; durMs: number; curve: number }> }> = []
  const build = (kind: number, get: (d: Record<string, unknown>) => number | undefined): void => {
    const pts: Array<[number, number]> = []
    for (const st of stops) {
      const v = get(st.decls)
      if (v !== undefined) pts.push([st.offset, v])
    }
    if (pts.length < 2) return
    const from = pts[0]![1]
    const segs: Array<{ to: number; durMs: number; curve: number }> = []
    for (let i = 1; i < pts.length; i++) {
      const d = (pts[i]![0] - pts[i - 1]![0]) * durMs
      if (d <= 0) continue
      segs.push({ to: pts[i]![1], durMs: d, curve })
    }
    if (segs.length > 0) chans.push({ kind, from, keyframes: segs })
  }
  const tfNum = (d: Record<string, unknown>, pick: (t: { txPx: number; tyPx: number; txPct: number; tyPct: number; sx: number; sy: number; rotate: number }) => number | undefined): number | undefined => {
    const t = d.transform as { txPx: number; tyPx: number; txPct: number; tyPct: number; sx: number; sy: number; rotate: number } | undefined
    if (!t) return undefined
    if (t.txPct !== 0 || t.tyPct !== 0) return undefined   // % 位移需盒尺寸 ⇒ 该通道跳过
    if (t.sx !== t.sy) return undefined                    // 非等比缩放 ⇒ 跳过
    return pick(t)
  }
  build(4, (d) => d.opacity as number | undefined)                                        // 4=opacity
  build(0, (d) => tfNum(d, (t) => t.txPx))                                                // 0=translateX(px)
  build(1, (d) => tfNum(d, (t) => t.tyPx))                                                // 1=translateY(px)
  build(2, (d) => tfNum(d, (t) => t.sx))                                                  // 2=scale
  build(3, (d) => tfNum(d, (t) => t.rotate))                                              // 3=rotate
  return chans
}

/** CSS `timing-function`/关键字 → 内核 curve id（0=linear / 1=ease-out / 2=ease-in / 3=ease-in-out） */
function cssTimingToCurve(t: string): number {
  const s = t.trim().toLowerCase()
  if (s === 'linear') return 0
  if (s === 'ease-out' || s === 'ease-out-cubic') return 1
  if (s === 'ease-in' || s === 'ease-in-cubic') return 2
  // `ease`（CSS 默认，≈先快后慢）与 `ease-in-out` 都落 ease-in-out（最接近的内置曲线）
  return 3
}


/**
 * ★批次 42：CSS `animation` 简写 → `{name, durMs, curve}`。
 *   取首 token 为名字（命中 @keyframes）、首个带时间单位的 token 为时长、timing 关键字 → curve。
 *   迭代/delay/direction/fill 暂忽略（诚实边界：App 端 animation 播**单次**、终态保持）。
 */
function parseAnimationShorthand(val: string): { name: string; durMs: number; curve: number } | null {
  const toks = val.trim().split(/\s+/).filter(Boolean)
  if (toks.length === 0) return null
  const name = toks[0]!
  if (!/^[A-Za-z_][\w-]*$/.test(name)) return null
  let durMs: number | undefined
  let curve: number | undefined
  for (const t of toks.slice(1)) {
    const s = t.toLowerCase()
    const sec = /^([\d.]+)s$/.exec(s)
    const ms = /^([\d.]+)ms$/.exec(s)
    if (sec) { if (durMs === undefined) durMs = Number(sec[1]) * 1000 }
    else if (ms) { if (durMs === undefined) durMs = Number(ms[1]) }
    else if (['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'].includes(s)) { if (curve === undefined) curve = cssTimingToCurve(s) }
  }
  if (durMs === undefined) return null   // 无时长 ⇒ 不可静态化
  return { name, durMs, curve: curve ?? 3 }
}
/**
 * ★批次 38（对齐 Web）：CSS transform（**静态**）→ 引擎变换数值集。
 *   支持 2D 子集：translate/translateX/translateY（px/数字/%）、scale/scaleX/scaleY、rotate（deg/rad/grad/turn）。
 *   不支持 ⇒ false（诊断跳过）；无变换 ⇒ null（不发射）。
 *   【为什么位移分 px / pct 两栏】translate(-50%,-50%) 是居中标准写法（% 相对自身盒）——编译期不知盒尺寸，
 *   存盒比例，由宿主按 pct × w/h 落成物理位移（三端同一口径）。
 */
function parseCssTransform(val: string, keepIdentity = false): { txPx: number; tyPx: number; txPct: number; tyPct: number; sx: number; sy: number; rotate: number } | false | null {
  const v = val.trim()
  if (v === '' || v.toLowerCase() === 'none') return null
  const fnRe = /([a-zA-Z][a-zA-Z0-9]*)\(([^()]*)\)/g
  let m: RegExpExecArray | null
  const out = { txPx: 0, tyPx: 0, txPct: 0, tyPct: 0, sx: 1, sy: 1, rotate: 0 }
  const len = (s: string): { px?: number; pct?: number } | null => {
    const t = s.trim()
    const mm = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|rpx|%)?$/.exec(t)
    if (!mm) return null
    const n = Number(mm[1])
    if (!Number.isFinite(n)) return null
    const u = mm[2]
    if (u === '%') return { pct: n / 100 }
    if (u === 'rpx') return { px: n * 0.5 }
    return { px: n }
  }
  const ang = (s: string): number | null => {
    const t = s.trim().toLowerCase()
    const mm = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|rad|grad|turn)?$/.exec(t)
    if (!mm) return null
    const n = Number(mm[1])
    if (!Number.isFinite(n)) return null
    const u = mm[2]
    if (u === 'rad') return (n * 180) / Math.PI
    if (u === 'turn') return n * 360
    if (u === 'grad') return (n * 360) / 400
    return n
  }
  let covered = 0
  while ((m = fnRe.exec(v))) {
    covered += m[0].length
    const name = m[1]!.toLowerCase()
    const args = m[2]!.split(',').map((s) => s.trim()).filter((s) => s !== '')
    if (name === 'translatex' || name === 'translatey' || name === 'translate') {
      if (name === 'translate') {
        const a = len(args[0] ?? '')
        if (!a) return false
        if (a.px !== undefined) out.txPx = a.px; else out.txPct = a.pct!
        if (args[1] !== undefined) { const b = len(args[1]); if (!b) return false; if (b.px !== undefined) out.tyPx = b.px; else out.tyPct = b.pct! }
      } else {
        const a = len(args[0] ?? '')
        if (!a) return false
        if (name === 'translatex') { if (a.px !== undefined) out.txPx = a.px; else out.txPct = a.pct! }
        else { if (a.px !== undefined) out.tyPx = a.px; else out.tyPct = a.pct! }
      }
      continue
    }
    if (name === 'scale' || name === 'scalex' || name === 'scaley') {
      const sx = Number(args[0])
      if (!Number.isFinite(sx)) return false
      if (name === 'scaley') { out.sy = sx } else { out.sx = sx; if (name === 'scale') out.sy = Number.isFinite(Number(args[1])) ? Number(args[1]) : sx }
      continue
    }
    if (name === 'rotate') {
      const a = ang(args[0] ?? '')
      if (a === null) return false
      out.rotate = a
      continue
    }
    return false
  }
  if (v.replace(/[a-zA-Z][a-zA-Z0-9]*\([^()]*\)/g, '').trim() !== '') return false
  if (covered === 0) return null
  // App 宿主变换模型为单一缩放 ⇒ 非等比缩放（scaleX/scaleY 单独或不等）如实拒绝（不静默按 x 冒充）
  if (out.sx !== out.sy) return false
  if (out.txPx === 0 && out.tyPx === 0 && out.txPct === 0 && out.tyPct === 0 && out.sx === 1 && out.sy === 1 && out.rotate === 0) return keepIdentity ? out : null
  return out
}

/**
 * ★批次 36（对齐 Web）：`font-family` 候选清单 → **字体角色**。
 *   映射与 `@proteus-vue/renderer-app` 的 `normalizeFontFamily` **逐条一致**（本仓纪律：一处归一；
 *   编译器 App 折叠面 + 适配器 JS 路共用同一角色词表）。未识别 ⇒ 取首个具体族名 `custom:<名>`（自定义族透传）。
 *   返回 undefined ⇔ 空清单/全为通用族关键字但未命中（调用方诊断）。
 */
function parseFontFamilyRole(v: string): string | undefined {
  const rawList = v.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  if (rawList.length === 0) return undefined
  const cands = rawList.map((s) => s.toLowerCase())
  for (const c of cands) {
    if (!c) continue
    if (c === 'system' || c === 'system-ui' || c === '-apple-system' || c === 'sans-serif' || c === 'sans') return 'system'
    if (c === 'serif' || (c.includes('serif') && !c.includes('sans'))) return 'serif'
    if (c === 'monospace' || c === 'mono') return 'monospace'
    if (c.includes('rounded')) return 'rounded'
    if (c.includes('condensed')) return 'condensed'
    if (c.includes('georgia') || c.includes('times') || c.includes('songti') || c.includes('宋')) return 'serif'
    if (c.includes('menlo') || c.includes('consolas') || c.includes('courier') || c.includes('mono')) return 'monospace'
    if (c === 'helvetica' || c === 'roboto' || c === 'arial' || c.includes('pingfang')) return 'system'
  }
  return 'custom:' + rawList[0]!
}

/**
 * ★★★C1 颜色归一（2026-10-04 修：真机 `RustLayout.create` 失败暴露）——CSS 颜色 → 内核接受的 hex。
 *
 * 【为什么需要】内核 `parse_css_color` 只认 `#RGB/#RRGGBB/#RRGGBBAA`；CSS 其它合法形态
 *   （`rgb()/rgba()/hsl()/hsla()`、4 位 hex）原样透传 ⇒ create 拒绝 ⇒ **整棵树建不起来**。⇒ 编译期归一。
 *
 * 【★基准 = Web（2026-10-04 用户指定「以 web 为基准对齐」）】凡 **Web 合法**的颜色形态都归一，不丢：
 *   · hex：`#RGB` / `#RGBA`（4 位，Web 合法）/ `#RRGGBB` / `#RRGGBBAA`
 *   · 函数式：`rgb()/rgba()` · `hsl()/hsla()`——**两种语法都收**：
 *     传统逗号 `rgb(255, 0, 0)` 与 现代空格 `rgb(255 0 0)`，alpha 走 4 参或 `/ a`；
 *     通道可 `%`（`rgb(100%, 0%, 0%)`）；hsl 色相带 `deg/rad/grad/turn` 或裸数（度）。
 *   · 关键字：`transparent`（→ `#00000000`）· 148 个命名色（查表）。
 *   · alpha：`%` ⇒ /100；数值**按 Web 语义 clamp 到 0..1**（旧实现的 `>1 ⇒ /255` 是 Web 偏差，
 *     Web 对越界 alpha 一律 clamp 到 1）。
 * 【未支持 ⇒ 返回 undefined（调用方诊断 + 跳过，不猜）】`currentColor`（依赖运行时 color，
 *   编译期无上下文）· `lab()/lch()/oklab()/oklch()/color()/hwb()` 等 CSS4 新空间 · `var()`（由 var 折叠前置处理）。
 * 【输出序】`#RRGGBB`（不透明，小写）或 `#RRGGBBAA`（含 alpha）——与内核 parse_css_color 的 CSS4 序一致。
 */
export function normalizeCssColor(raw: string): string | undefined {
  const s = raw.trim().toLowerCase()
  if (!s) return undefined
  // ── hex：3 / 6 / 8 位原样（内核展开 3 位）；★4 位 `#RGBA` Web 合法但内核不认 ⇒ 展开为 8 位 ──
  const hexm = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)
  if (hexm) {
    const h = hexm[1]!
    if (h.length === 4) {
      const [r, g, b, a] = h
      return ('#' + r! + r! + g! + g! + b! + b! + a! + a!)
    }
    return s
  }
  if (s === 'transparent') return '#00000000'
  // ★命名色（148 个标准色；Web 一律生效，此前直接丢弃 ⇒ App 失样式）。核心只认 hex ⇒ 编译期查表。
  const named = CSS_NAMED_COLORS[s]
  if (named) return named
  // ★批次 23（CSS 兼容对齐 · 以 Web 为基准）：`color-mix(in srgb, …)` 常量折叠——
  //   设计令牌的**着色/淡化**写法（组件库 16 处：`color-mix(in srgb, var(--pf-accent,#...), 18%, transparent)`）。
  //   var() 已在前置换 ⇒ 两色已知 ⇒ 编译期按 sRGB（预乘 alpha）混合。其余色彩空间 ⇒ undefined（诊断）。
  if (/^color-mix\(/i.test(s)) return foldColorMix(s)
  // ── 函数式：rgb/rgba/hsl/hsla ──
  const m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s)
  if (!m) return undefined
  const fn = m[1]!
  const parts = splitColorArgs(m[2]!)
  if (parts.length < 3) return undefined
  let rgb: number[] | undefined
  if (fn === 'rgb' || fn === 'rgba') {
    const r = cssChannel(parts[0]!), g = cssChannel(parts[1]!), b = cssChannel(parts[2]!)
    if (r === undefined || g === undefined || b === undefined) return undefined
    rgb = [r, g, b]
  } else {
    const h = cssHue(parts[0]!), sat = cssPercent01(parts[1]!), light = cssPercent01(parts[2]!)
    if (h === undefined || sat === undefined || light === undefined) return undefined
    rgb = hslToRgb(h, sat, light)
  }
  const hx = (n: number): string => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  const out = '#' + hx(rgb[0]!) + hx(rgb[1]!) + hx(rgb[2]!)
  if (parts.length >= 4) {
    const a = cssAlpha01(parts[3]!)
    if (a !== undefined && a < 1) return out + hx(Math.round(a * 255))
  }
  return out
}

/** 颜色实参切分：传统逗号 `a, b, c[, d]` 或 现代空格 `a b c[/ d]` ⇒ 3~4 个 token。 */
function splitColorArgs(body: string): string[] {
  const b = body.trim()
  if (b.includes(',')) return b.split(',').map((x) => x.trim())
  const slash = b.split('/')
  const head = (slash[0] ?? '').trim().split(/\s+/).filter(Boolean)
  if (slash.length > 1) head.push((slash.slice(1).join('/')).trim())
  return head
}

/** rgb 通道：`n`（0..255）或 `n%`。 */
function cssChannel(t: string): number | undefined {
  const s = t.trim()
  if (/%$/.test(s)) { const n = Number(s.slice(0, -1)); return Number.isFinite(n) ? Math.round((n / 100) * 255) : undefined }
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : undefined
}

/** hsl 的 s/l：`n%` ⇒ /100；裸数按 0..100 百分比处理。 */
function cssPercent01(t: string): number | undefined {
  const s = t.trim()
  if (/%$/.test(s)) { const n = Number(s.slice(0, -1)); return Number.isFinite(n) ? n / 100 : undefined }
  const n = Number(s)
  return Number.isFinite(n) ? n / 100 : undefined
}

/** alpha：`%` ⇒ /100；数值**按 Web 语义 clamp 到 0..1**。 */
function cssAlpha01(t: string): number | undefined {
  const s = t.trim()
  if (!s) return undefined
  if (/%$/.test(s)) { const n = Number(s.slice(0, -1)); return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : undefined }
  const n = Number(s)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : undefined
}

/** hsl 色相：裸数（度）或 `deg/rad/grad/turn`。 */
function cssHue(t: string): number | undefined {
  const s = t.trim().toLowerCase()
  const m = /^(-?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)?$/.exec(s)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n)) return undefined
  switch (m[2]) {
    case 'grad': return n * 0.9
    case 'rad': return (n * 180) / Math.PI
    case 'turn': return n * 360
    default: return n
  }
}

/** CSS hsl → rgb（0..255）；s/l ∈ 0..1。标准公式（CSS Color 4）。 */
function hslToRgb(h: number, s: number, l: number): number[] {
  const ht = (((h % 360) + 360) % 360) / 30
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => {
    const k = (n + ht) % 12
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
  }
  return [f(0), f(8), f(4)].map((x) => Math.round(x))
}

/** 顶层逗号切分（括号深度 0；`rgb(0,0,0)` 内的逗号不算）。 */
function splitTopLevelComma(s: string): string[] {
  const out: string[] = []; let d = 0; let cur = ''
  for (const ch of s) {
    if (ch === '(') d++
    else if (ch === ')') d--
    if (ch === ',' && d === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

/** color-mix 操作数：`<color> [<pct>%]?` → { hex(归一), pct? }。非法色 ⇒ undefined。 */
function parseMixOperand(t: string): { hex: string; pct?: number } | undefined {
  const s = t.trim()
  const m = /^(.*?)\s+(\d+(?:\.\d+)?)%$/.exec(s)
  const colorStr = (m ? m[1]! : s).trim()
  const pct = m ? Number(m[2]) : undefined
  const hex = normalizeCssColor(colorStr)
  if (!hex) return undefined
  return { hex, pct }
}

/** `color-mix(in srgb, A [pa%], B [pb%])` → hex（sRGB 预乘 alpha 混合）；其余空间/非法 ⇒ undefined。 */
function foldColorMix(v: string): string | undefined {
  const m = /^color-mix\(\s*in\s+srgb\s*,([\s\S]*)\)$/i.exec(v.trim())
  if (!m) return undefined
  const parts = splitTopLevelComma(m[1]!)
  if (parts.length !== 2) return undefined
  const a = parseMixOperand(parts[0]!), b = parseMixOperand(parts[1]!)
  if (!a || !b) return undefined
  const rgba = (hex: string): { r: number; g: number; b: number; a: number } => {
    let h = hex.replace('#', '')
    if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!   // ★批次 23：展开 #RGB
    else if (h.length === 4) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! + h[3]! + h[3]!   // #RGBA
    return {
      r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    }
  }
  let w1: number; let w2: number
  if (a.pct !== undefined && b.pct !== undefined) { w1 = a.pct; w2 = b.pct }
  else if (a.pct !== undefined) { w1 = a.pct; w2 = 100 - a.pct }
  else if (b.pct !== undefined) { w2 = b.pct; w1 = 100 - b.pct }
  else { w1 = 50; w2 = 50 }
  const tot = w1 + w2
  if (!(tot > 0)) return undefined
  w1 /= tot; w2 /= tot
  const c1 = rgba(a.hex); const c2 = rgba(b.hex)
  const alpha = c1.a * w1 + c2.a * w2
  if (alpha <= 0) return '#00000000'
  const mixc = (x: number, y: number): number => Math.round((x * c1.a * w1 + y * c2.a * w2) / alpha)
  const hx = (n: number): string => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  const base = '#' + hx(mixc(c1.r, c2.r)) + hx(mixc(c1.g, c2.g)) + hx(mixc(c1.b, c2.b))
  return alpha >= 1 ? base : base + hx(Math.round(alpha * 255))
}


/** ★批次 14：CSS 标准命名色 → hex（148 个；取自 CSS Color Level 4）。核心只认 hex ⇒ 编译期查表。 */
const CSS_NAMED_COLORS: Record<string, string> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4', azure: '#f0ffff',
  beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000', blanchedalmond: '#ffebcd', blue: '#0000ff',
  blueviolet: '#8a2be2', brown: '#a52a2a', burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00',
  chocolate: '#d2691e', coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b', darkgray: '#a9a9a9',
  darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b', darkmagenta: '#8b008b', darkolivegreen: '#556b2f',
  darkorange: '#ff8c00', darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b', darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1',
  darkviolet: '#9400d3', deeppink: '#ff1493', deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969',
  dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22', fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700', goldenrod: '#daa520', gray: '#808080',
  green: '#008000', greenyellow: '#adff2f', grey: '#808080', honeydew: '#f0fff0', hotpink: '#ff69b4',
  indianred: '#cd5c5c', indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
  lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080',
  lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3', lightgreen: '#90ee90',
  lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a', lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa', lightslategray: '#778899', lightslategrey: '#778899', lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6', magenta: '#ff00ff',
  maroon: '#800000', mediumaquamarine: '#66cdaa', mediumblue: '#0000cd', mediumorchid: '#ba55d3',
  mediumpurple: '#9370db', mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc', mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa',
  mistyrose: '#ffe4e1', moccasin: '#ffe4b5', navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6',
  olive: '#808000', olivedrab: '#6b8e23', orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6',
  palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee', palevioletred: '#db7093',
  papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb', plum: '#dda0dd',
  powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399', red: '#ff0000', rosybrown: '#bc8f8f',
  royalblue: '#4169e1', saddlebrown: '#8b4513', salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57',
  seashell: '#fff5ee', sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd',
  slategray: '#708090', slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f', steelblue: '#4682b4',
  tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347', turquoise: '#40e0d0',
  violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00',
  yellowgreen: '#9acd32',
}
/** 去 scoped 后缀（`foo-data-v-abc123` / `foo-data-v-abc` → `foo`；无后缀原样返回） */
export function stripScopeSuffix(name: string): string {
  return name.replace(/-data-v-[A-Za-z0-9]+$/, '')
}

/** 顶层逗号切分（括号感知；`min(a, b)` / `clamp(a, b, c)` 用） */
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = []
  let d = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') d++
    else if (ch === ')') d--
    if (ch === ',' && d === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

/** ★min()/max()/clamp() 单值求值（**px-only**，与 CSE 折叠面 evalMathPx 同口径）：参数须全为 `<n>px`
 *   （裸 0 / calc(...)→px / 嵌套数学）；否则 undefined（不猜——`%`/`vw`/unitless 不可编译期绝对化）。 */
function evalMathPx(t: string): number | undefined {
  const s2 = t.trim()
  const px = /^(-?\d*\.?\d+)px$/i.exec(s2)
  if (px) return Number(px[1])
  if (/^-?0(\.0+)?$/.test(s2)) return 0
  if (/^calc\(/i.test(s2)) return foldCalc(s2)
  const m = /^(min|max|clamp)\(([\s\S]*)\)$/i.exec(s2)
  if (m) {
    const args = splitTopLevelCommas(m[2]!).map((x) => evalMathPx(x))
    if (args.some((x) => x === undefined)) return undefined
    const n = args as number[]
    const fn = m[1]!.toLowerCase()
    if (fn === 'clamp' && n.length !== 3) return undefined
    if (fn === 'min') return Math.min(...n)
    if (fn === 'max') return Math.max(...n)
    return Math.max(n[0]!, Math.min(n[1]!, n[2]!)) // clamp(min, val, max)
  }
  return undefined
}

/** ★★★min()/max()/clamp() → 数值（2026-10-08 · css:next P0）；非数学函数 ⇒ undefined。px-only（与 CSE 同口径）。 */
function numOfMathFn(s: string): number | undefined {
  if (!/^(min|max|clamp)\(/i.test(s.trim())) return undefined
  return evalMathPx(s)
}

/* ───────── ★★★内置环境变量引用（2026-10-08 · 决策 #593）─────────
 * App 折叠面把 var(--pf-X) / env(safe-area-inset-X) / calc(<env> ± Npx) 发射为**引用 token**
 *   （env:--pf-inset-top / env:--pf-inset-bottom+12），由宿主在构建内核请求前用平台 insets
 *   （WindowInsets / safeAreaInsets / avoidArea）解析成逻辑像素（Stage 1：宿主侧解析）。
 *   ★为什么不去内核：Stage 1 先在宿主快速验证整链；验证通过后 Stage 2 迁内核 env 表 + ABI v2。
 *   ★仅**布局长度字段**支持（绘制字段如 fontSize 不在折叠长度路径，自然不命中）。 */

/** 单个 env 基元（var(--pf-X[, fb]) / env(safe-area-inset-X[, fb])）→ { name, fallback? }。 */
function envBase(s: string): { name: string; fallback?: number } | undefined {
  const t = s.trim()
  const v = /^var\(\s*(--pf-[a-z0-9-]+)\s*(?:,\s*(-?\d*\.?\d+)px\s*)?\)$/i.exec(t)
  // ★闭集校验：未知 --pf-* 名（拼写漂移）⇒ 不发射引用（落到调用方诊断，不静默为 0）
  if (v && isEnvVarName(v[1]!)) return { name: v[1]!, ...(v[2] !== undefined ? { fallback: Number(v[2]) } : {}) }
  const e = /^env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,\s*(-?\d*\.?\d+)px\s*)?\)$/i.exec(t)
  if (e) return { name: '--pf-inset-' + e[1]!, ...(e[2] !== undefined ? { fallback: Number(e[2]) } : {}) }
  return undefined
}

/** env 引用 → token 串：`env:<name>[*<scale>][+/-<offset>][~<fallback>]`。 */
function envTokenOf(name: string, offset: number, fallback?: number, scale?: number): string {
  let t = 'env:' + name
  if (scale !== undefined && scale !== 1) t += '*' + scale
  if (offset) t += (offset > 0 ? '+' : '') + offset
  if (fallback !== undefined) t += '~' + fallback
  return t
}

/** 长度或 env：env token 优先（返回字符串），否则 numOf（返回数值）。 */
function lenOrEnv(v: string): number | string | undefined {
  const e = envLengthToken(v)
  if (e !== undefined) return e
  return numOf(v)
}

/** ★★★`vw`/`vh` 单位（2026-10-08 · 决策 #595 · Stage 2）：`Nvw`/`Nvh` → `env:--pf-vw*<N/100>`（视口尺寸，
 *   运行期真实视口；App 端此前**整条丢弃** `vw`/`vh`）。与 Web `vw`/`vh` 同语义（Web 原生支持→此处仅 App 折叠面用）。 */
function vwVhToken(s: string): string | undefined {
  const m = /^(\d*\.?\d+)(vw|vh)$/i.exec(s.trim())
  if (!m) return undefined
  const scale = Number(m[1]) / 100
  return envTokenOf(m[2]!.toLowerCase() === 'vw' ? '--pf-vw' : '--pf-vh', 0, undefined, scale)
}

/** 识别 env 长度表达式（含 vw/vh 单位）→ token 串；非 env ⇒ undefined（走原逻辑）。 */
function envLengthToken(raw: string): string | undefined {
  const s = raw.trim()
  const base = envBase(s)
  if (base) return envTokenOf(base.name, 0, base.fallback)
  const vw = vwVhToken(s)
  if (vw) return vw
  const c = /^calc\(\s*([\s\S]+?)\s*\)$/i.exec(s)
  if (!c) return undefined
  const inner = c[1]!.trim()
  // 先试「env ± Npx」（偏移）
  const fwd = /^([\s\S]+?)\s*([+-])\s*(-?\d*\.?\d+)px$/i.exec(inner)
  const rev = /^(-?\d*\.?\d+)px\s*([+-])\s*([\s\S]+)$/i.exec(inner)
  let b: { name: string; fallback?: number } | undefined
  let off = 0
  let scale: number | undefined
  if (fwd) { b = envBase(fwd[1]!) ?? envVwVhBase(fwd[1]!); if (b) off = (fwd[2] === '-' ? -1 : 1) * Number(fwd[3]) }
  else if (rev) { b = envBase(rev[3]!) ?? envVwVhBase(rev[3]!); if (b) off = (rev[2] === '-' ? -1 : 1) * Number(rev[1]) }
  if (!b) {
    // 再试「env * N」「N * env」「env / N」（缩放）
    const fwd2 = /^([\s\S]+?)\s*\*\s*(-?\d*\.?\d+)$/i.exec(inner)
    const rev2 = /^(-?\d*\.?\d+)\s*\*\s*([\s\S]+)$/i.exec(inner)
    const div = /^([\s\S]+?)\s*\/\s*(-?\d*\.?\d+)$/i.exec(inner)
    if (fwd2) { b = envBase(fwd2[1]!) ?? envVwVhBase(fwd2[1]!); if (b) scale = Number(fwd2[2]) }
    else if (rev2) { b = envBase(rev2[2]!) ?? envVwVhBase(rev2[2]!); if (b) scale = Number(rev2[1]) }
    else if (div) { const d = Number(div[2]); b = envBase(div[1]!) ?? envVwVhBase(div[1]!); if (b && d !== 0) scale = 1 / d }
  }
  if (!b) return undefined
  return envTokenOf(b.name, off, b.fallback, scale)
}

/** `Nvw`/`Nvh` 作为 env 基元（供 calc 内使用）→ `--pf-vw`/`--pf-vh`（scale 由外层 calc 处理）。 */
function envVwVhBase(s: string): { name: string } | undefined {
  const m = /^(?:\d*\.?\d+)?(vw|vh)$/i.exec(s.trim())
  if (!m) return undefined
  return { name: m[1]!.toLowerCase() === 'vw' ? '--pf-vw' : '--pf-vh' }
}

/** `56px` / `56` / `0.5` → 数值；`50%` / `auto` → undefined（百分比**宽高**在调用处另行映射为 widthRatio/heightRatio；其余属性的百分比仍不支持，见诊断） */
function numOf(v: string): number | undefined {
  const s = v.trim()
  // ★批次 22（CSS 兼容对齐 · 以 Web 为基准）：`calc()` 常量折叠——设计令牌算术
  //   `calc(var(--u) * 1.15)` 的 var() 已在解析前置换 ⇒ 此处对已知常量的算术求值（无 % / 相对单位时）。
  //   组件库 64 处 `calc(var(--x) * N)` 依赖它（间距/字号刻度）。
  if (/^calc\(/i.test(s)) return foldCalc(s)
  // ★★★min()/max()/clamp()（2026-10-08）：数学函数常量化（全参数可折 ⇒ 数值；含 %/vw ⇒ undefined 诊断跳过）
  if (/^(min|max|clamp)\(/i.test(s)) return numOfMathFn(s)
  // ★批次 21（多端一致 · 以 MP 为基准）：`rpx`（小程序 750 设计单位）⇒ px。
  //   比例 0.5（1rpx = 0.5px）＝ 与 `rpxRatio:2`（px→rpx）互为逆——本仓 UA 基础样式即按此书写
  //   （`h1: font-size:64rpx` = 32px）。此前 App 折叠**丢弃 rpx** ⇒ 真实项目（125 处）失样式。
  if (/rpx$/i.test(s)) {
    const n = Number(s.slice(0, -3))
    return Number.isFinite(n) ? n * 0.5 : undefined
  }
  const t = s.replace(/px$/i, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/**
 * ★★★calc() 常量折叠 → 数值（px/无单位参与）。**唯一实现** `calc-fold.ts`（与 CSE 同口径，决策 #591）。
 *   支持完整算术（`+ - * /` 与括号）+ `env(safe-area-inset-*)` fallback；含 `%`/相对单位 ⇒ undefined（不猜）。
 */
function foldCalc(v: string): number | undefined {
  const m = /^calc\(([\s\S]*)\)$/i.exec(v.trim())
  if (!m) return undefined
  return foldCalcArithmetic(m[1]!)
}

/**
 * ★批次 2（值归一化）：`margin`/`padding` 的 **1–4 值简写** → `{top,right,bottom,left}`（CSS 标准展开）。
 *   `auto` / 不可解析的边 ⇒ 该边**不设**（其余边照设）；整条全是非数值 ⇒ 返回 undefined（调用方诊断）。
 *   ★为什么忽略 auto：内核对等无 auto（浏览器才有的"均分剩余空间"）——设一个错误数值反而更糟。
 */
function expandBoxShorthand(rawVal: string, toNum: (v: string) => number | string | undefined): Record<string, number | string> | null {
  const toks = splitTopLevelSpaces(rawVal)
  if (toks.length === 0 || toks.length > 4) return null
  const n = toks.map(toNum) // undefined = 该边忽略（auto 等）；string = env token
  let top: number | string | undefined
  let right: number | string | undefined
  let bottom: number | string | undefined
  let left: number | string | undefined
  if (n.length === 1) { top = right = bottom = left = n[0] }
  else if (n.length === 2) { top = bottom = n[0]; right = left = n[1] }
  else if (n.length === 3) { top = n[0]; right = left = n[1]; bottom = n[2] }
  else { top = n[0]; right = n[1]; bottom = n[2]; left = n[3] }
  const box: Record<string, number | string> = {}
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
 * ★批次 17（CSS 兼容对齐 · 以 Web 为基准）：`margin` 简写 → `{ box, auto }`。
 *   与 `expandBoxShorthand` 同形，但把 `auto` token 记进 `auto`（true = 该边 auto 外距）。
 *   CSS 语义：`margin: 0 auto` ⇒ top/bottom=0、left/right=auto（水平居中）。
 *   返回 null ⇔ 既无有效数值边、也无 auto 边（调用方诊断）。
 */
function expandMarginShorthand(rawVal: string, toNum: (v: string) => number | string | undefined): {
  box: Record<string, number | string>; auto: Record<string, boolean>
} | null {
  const toks = splitTopLevelSpaces(rawVal)
  if (toks.length === 0 || toks.length > 4) return null
  const sides = ['top', 'right', 'bottom', 'left'] as const
  // 1–4 值 → 四边展开（CSS 标准）
  const per: Array<{ n?: number | string; auto: boolean }> = toks.map((t) => {
    if (t.toLowerCase() === 'auto') return { auto: true }
    const n = toNum(t)
    return n === undefined ? { auto: false } : { n, auto: false }
  })
  const idx = (side: string): number => {
    if (toks.length === 1) return 0
    if (toks.length === 2) return side === 'top' || side === 'bottom' ? 0 : 1
    if (toks.length === 3) return side === 'top' ? 0 : side === 'bottom' ? 2 : 1
    return { top: 0, right: 1, bottom: 2, left: 3 }[side]!
  }
  const box: Record<string, number | string> = {}
  const auto: Record<string, boolean> = {}
  for (const s of sides) {
    const p = per[idx(s)]!
    if (p.auto) auto[s] = true
    else if (p.n !== undefined) box[s] = p.n
  }
  if (Object.keys(box).length === 0 && Object.keys(auto).length === 0) return null
  return { box, auto }
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
function parseBorderShorthand(raw: string): { width?: number | string; color?: string; style?: string } {
  const out: { width?: number | string; color?: string; style?: string } = {}
  const STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'none', 'hidden', 'groove', 'ridge', 'inset', 'outset'])
  const KEYWORDS = new Set(['thin', 'medium', 'thick', 'currentcolor'])
  for (const tok of splitTopLevelSpaces(raw)) {   // ★批次 23：括号感知（color-mix() 内空格不切）
    const low = tok.toLowerCase()
    if (STYLES.has(low)) { out.style = low; continue }
    if (KEYWORDS.has(low)) continue
    if (out.color === undefined) {
      const c = normalizeCssColor(tok)
      if (c) { out.color = c; continue }
    }
    if (out.width === undefined) {
      // ★E 组（设备标量 · --pf-hairline）：边框宽度亦可是内置 env 引用（border-bottom: var(--pf-hairline) solid #ccc）
      const et = envLengthToken(tok)
      if (et !== undefined) { out.width = et; continue }
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
 * ★批次 33（CSS 兼容对齐 · 以 Web 为基准）：CSS 渐变 → 引擎 `fillGradient` 结构。
 *   支持 `linear-gradient([<n>deg | to <dir>,] <color> [<pos>%], …)` 与 `radial-gradient([…shape…,] <color> …)`。
 *   输出形如 `{kind, angle, stops:[{offset, color:'#RRGGBB', alpha?}]}`（与 `fill-gradient` 属性**同一契约**）。
 *   颜色须能归一（hex/rgb/hsl/命名色/transparent）；`color-mix()` 亦已支持。不可解析 ⇒ null（调用方诊断）。
 */
function parseCssGradient(raw: string): Record<string, unknown> | null {
  const m = /^(linear|radial)-gradient\(([\s\S]*)\)$/i.exec(raw.trim())
  if (!m) return null
  const kind = m[1]!.toLowerCase()
  const args = splitTopLevelComma(m[2]!)
  if (args.length < 2) return null
  let start = 0
  let angle = 180 // CSS 缺省 = `to bottom`
  if (kind === 'linear') {
    const first = args[0]!.trim()
    const am = /^(-?\d+(?:\.\d+)?)deg$/i.exec(first)
    if (am) { angle = Number(am[1]); start = 1 }
    else if (/^to\s+/i.test(first)) { const d = dirToDeg(first); if (d !== undefined) { angle = d; start = 1 } }
  } else {
    // radial：跳过 shape/preposition 参数（`circle` / `at 50% 50%` / `closest-side` …）直到首个颜色
    while (start < args.length && !normalizeCssColor(args[start]!.trim().split(/\s+/)[0] ?? '')) start++
  }
  const stops = parseGradientStops(args.slice(start))
  if (!stops || stops.length < 2) return null
  return kind === 'linear' ? { kind: 'linear', angle, stops } : { kind: 'radial', cx: 0.5, cy: 0.5, r: 1.0, stops }
}

/** 方向关键字 → 角度（CSS：0deg = to top、90 = to right、180 = to bottom、270 = to left）。 */
function dirToDeg(t: string): number | undefined {
  const set = new Set(t.trim().toLowerCase().split(/\s+/).filter(Boolean))
  if (!set.has('to')) return undefined
  const up = set.has('top'); const down = set.has('bottom'); const left = set.has('left'); const right = set.has('right')
  if (up && right) return 45; if (down && right) return 135; if (down && left) return 225; if (up && left) return 315
  if (up) return 0; if (right) return 90; if (down) return 180; if (left) return 270
  return undefined
}

/** 色标序列：`<color> [<pos>%]`；缺省位置按 CSS 均分/插值补齐。色不可归一 ⇒ null。 */
function parseGradientStops(args: string[]): Array<{ offset: number; color: string; alpha?: number }> | null {
  const raw: Array<{ color: string; alpha?: number; pos?: number }> = []
  for (const a of args) {
    const t = a.trim()
    if (!t) continue
    const pm = /^([\s\S]*?)\s+(-?\d+(?:\.\d+)?)%$/.exec(t)
    const colorStr = (pm ? pm[1]! : t).trim()
    const pos = pm ? Number(pm[2]) / 100 : undefined
    const norm = normalizeCssColor(colorStr)
    if (!norm) return null
    let color = norm; let alpha: number | undefined
    if (norm.length === 9) { alpha = parseInt(norm.slice(7, 9), 16) / 255; color = norm.slice(0, 7) }
    raw.push({ color, ...(alpha !== undefined ? { alpha } : {}), ...(pos !== undefined ? { pos } : {}) })
  }
  if (raw.length < 2) return null
  const n = raw.length
  const stops: Array<{ offset: number; color: string; alpha?: number }> = []
  for (let i = 0; i < n; i++) {
    const r = raw[i]!
    // 缺省位置：按 CSS 均分（端点 0/1，中间均匀）
    const offset = r.pos !== undefined ? Math.max(0, Math.min(1, r.pos)) : i / (n - 1)
    stops.push({ offset, color: r.color, ...(r.alpha !== undefined ? { alpha: r.alpha } : {}) })
  }
  return stops
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
  /** ★批次 30：投影后的**动态类规则**（仅自匹配、纯类；供动态 `:class` 运行期解析） */
  dynamicClassRules?: DynamicClassRule[]
}

export function buildLayoutTemplate(
  source: string,
  filename = 'anonymous.vue',
  compat?: Pick<VueCompatDeps, 'sfcParse' | 'domParse'>,
  /** ★批次 9：设计令牌表（`--name`→值，来自项目 `globalStyle`）——SFC 内 `var()` 编译期折叠 */
  tokens?: Record<string, string>,
  /**
   * ★★★批次 45：**构建期已知初值**（`App 壳静态实例化`）——给了它就在序列化前对 AST 做一次
   *   `staticInstantiate`（折叠 `v-if` / 展开静态 `v-for` / 折常量插值）。缺省（常态）行为**逐字节不变**。
   */
  statics?: Record<string, unknown>,
  /**
   * ★★★批次 46：**全局样式表内容**（项目 `globalStyle`，如 `styles/global.css`）——其 `.class{}` 规则
   *   一并折进 App 节点样式（与 SFC 内 `<style>` 同等地位，SFC 内规则优先）。
   *   【为什么必须】App 端无 CSS 引擎，页面大量用**全局类**（`sa-card`/`sa-item`…）——此前只折 SFC 内
   *   `<style>` ⇒ 全局类全部落空（卡片/列表/文字样式全丢，页面塌）。缺省 ⇒ 零行为变化。
   */
  globalCss?: string,
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
  let ast = dom(desc.template.content, { comments: false }) as unknown as { children: unknown[] }
  // ★★★批次 45：构建期静态实例化（给了 `statics` 才做——缺省零行为变化）。
  if (statics) {
    const si = staticInstantiate(ast as unknown as { type: number; children: unknown[] }, statics)
    ast = si.ast as unknown as { children: unknown[] }
    for (const d of si.diagnostics) diag(d, undefined, 'VAPOR_STATIC_IF_DROPPED')
  }

  // ★★★C1（2026-10-04）：把 SFC `<style>` 的**类规则**抽成规则表——
  //   供模板节点按 `class`（+ 祖先类链）匹配合并（App 路径无 CSS 引擎；真实项目样式多在 `<style>`+class）。
  //   支持：单类 `.a` / 复合 `.a.b` / 后代 `.a .b` / 子 `.a>.b`；其余跳过 + 诊断（见 parseClassRules）。
  const classRules: ClassStyleRule[] = []
  // ★批次 42：先收集 <style> 里的 @keyframes（animation 简写解析用）
  const keyframesMap: Record<string, import('./template').KeyframeStop[]> = {}
  for (const blk of desc.styles ?? []) {
    if (!blk?.content) continue
    Object.assign(keyframesMap, parseKeyframes(blk.content))
  }
  for (const blk of desc.styles ?? []) {
    if (!blk?.content) continue
    const { rules, skipped } = parseClassRules(blk.content, tokens, keyframesMap)
    classRules.push(...rules)
    if (skipped > 0) {
      diag(
        `<style> 中有 ${skipped} 条**不支持的选择器**规则被跳过（支持：类/元素/通配选择器 + 后代/子组合 + 静态结构伪类 :first-child / :last-child / :nth-child / :not(...)，以及 Vue :deep()/::v-deep()/>>>）`,
        'App 端无 CSS 引擎：**状态伪类**（:hover/:active/:focus/:checked）与属性/兄弟选择器/伪元素/@media 仍不支持；把关键样式改为类/元素/结构伪类选择器或 inline style，或保留 Web 端渲染',
        'VAPOR_STYLE_SELECTOR_UNSUPPORTED',
      )
    }
  }
  // ★★★批次 46：全局样式表（`globalStyle`）的类规则——**追加在后面**（SFC 内规则优先：resolveClassStyles
  //   按源序做层叠，SFC 规则先入表 ⇒ 同特异性时 SFC 胜）。App 端无 CSS 引擎 ⇒ 全局类也必须在构建期折进来。
  if (globalCss) {
    Object.assign(keyframesMap, parseKeyframes(globalCss))
    const { rules, skipped } = parseClassRules(globalCss, tokens, keyframesMap)
    classRules.push(...rules)
    if (skipped > 0) {
      diag(
        `全局样式表中有 ${skipped} 条**不支持的选择器**规则被跳过（同上）`,
        'App 端无 CSS 引擎：状态伪类/属性/兄弟/伪元素/@media 仍不支持',
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
    const elemSeq = normalizedChildSequence(children)
    // ★批次 37：本层**元素兄弟表**（供静态结构伪类 `:first-child`/`:last-child`/`:nth-child` 计数）——
    //   只计**真元素**（排除混排合成的文本 run 与不产节点的 `<template>`），与 Web「元素兄弟」语义一致。
    const elemSiblings = elemSeq.filter((x) => {
      const e = x as Node & { __syntheticTextRun?: boolean }
      return e.type === 1 && !e.__syntheticTextRun && normalizeBuiltinTag(e.tag ?? '') !== 'template'
    })
    for (const raw of elemSeq) {
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
        // ★批次 37：带上**元素兄弟序**（结构伪类匹配用；非本层真元素 ⇒ 不带）
        const sibIdx = elemSiblings.indexOf(n)
        selfMatch = sibIdx >= 0
          ? { classes: selfClasses, tag, index: sibIdx, count: elemSiblings.length }
          : { classes: selfClasses, tag }
        if ((selfClasses.size || tag) && classRules.length) {
          const resolved = resolveClassStyles(classRules, ancestorClasses, selfMatch)
          Object.assign(style, resolved.styles)
          classImportant = resolved.important
          // ★批次 37（诚实边界 · 不静默半支持）：**行内（v-for）结构伪类**——Element 兄弟序在编译期
          //   按**模板序**求值；而 v-for 行是**运行期克隆同一模板节点** ⇒ 该结构伪类会作用于**所有行**
          //   （Web 只作用于第 1 行 / 末行）。⇒ 如实诊断（行级首末应走 :class 或数据驱动）。
          if (resolved.structural && (forCode !== undefined || activeListStack.length > 0)) {
            diag(
              `${tag}(id=${id}) 行内（v-for）的**结构伪类**（:first-child/:last-child/:nth-child）按**模板序**静态求值——` +
                `运行期每行克隆同一模板节点 ⇒ 实际会作用于**所有行**（Web 只作用于首/末行）`,
              '行级首末样式改用动态 :class（按数据判首末）或组件属性；结构伪类只用于**静态兄弟**（非 v-for 行）',
              'VAPOR_STRUCTURAL_PSEUDO_IN_LIST',
            )
          }
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
                  `（布局数值键 + 绘制键 backgroundColor/color/fontSize/fontWeight/textAlign/lineHeight/textOverflow/letterSpacing/visibility/borderRadius/borderColor/borderWidth/opacity）`,
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
        // ★批次 28：`inherit` 哨兵 ⇒ 显式取父值（父无 ⇒ 回落 undefined = 默认）
        if (style[f] === 'inherit') style[f] = inherited[f]
        if (style[f] === undefined && inherited[f] !== undefined) style[f] = inherited[f]
        if (style[f] !== undefined) childInherited[f] = style[f]
      }
      // ★批次 25（visibility 继承 —— 语义与文本字段略异）：父 hidden ⇒ 子默认 hidden；
      //   子**显式** visible 可**覆盖**为可见（CSS 规定）。⇒ 单独处理，不并入 APP_INHERITABLE_FIELDS。
      if (style.visibility === 'inherit') style.visibility = inherited.visibility
      if (style.visibility === undefined && inherited.visibility !== undefined) style.visibility = inherited.visibility
      // ★批次 32：pointer-events 可继承（CSS 语义）——父 none ⇒ 子默认 none，子显式 auto 可覆盖
      if (style.pointerEvents === undefined && inherited.pointerEvents !== undefined) style.pointerEvents = inherited.pointerEvents
      if (style.pointerEvents !== undefined) childInherited.pointerEvents = style.pointerEvents
      if (style.visibility !== undefined) childInherited.visibility = style.visibility
      // ★★★overflow-x 项（2026-10-06）：**Web 归一 + 形态收敛**（级联与 inline 均已合并完毕）
      normalizeOverflowFields(style)
      // ★★★flex-direction 项（2026-10-08）：display:flex 容器补 flex-direction 初值 row（级联后归一）
      normalizeFlexDirection(style)
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
  return { template: { nodes, lists, roots, ok }, diagnostics, ok, dynamicClassRules: projectDynamicClassRules(classRules) }
}
