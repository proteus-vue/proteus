// packages/compiler/src/cse/types.ts
// ★★★G-61 B1（2026-10-05）：**CSE（编译期 CSS 引擎）· 类型契约**
//
// 【CSE 是什么（plan `docs/proteus-css-engine-plan/README.md` §1 的 L-A）】
//   唯一 CSS 真源：收集 → 索引 → 右→左匹配 → **完整五级层叠** → 继承 → 计算值 → StyleIR。
//   运行期零解析（INV-CE-03）：宿主只消费已折叠的 IR。
//
// 【与既有 `vapor/template.ts` 折叠通路的关系（过渡期纪律 — plan §2.2「新通路并行」）】
//   既有通路（`parseClassRules`/`resolveClassStyles`/`parseStaticStyle`）是 **App 端现行折叠器**：
//   在**简写层**折叠、无 @layer、id 特异性恒 0、em/rem/% 多数丢弃（探针实测）。
//   本模块是 **IR 通路**（B1 产物）：在**长手层**层叠（CSS 正确做法——简写与长手竞争同一属性）、
//   支持 @layer / id / CSS 宽关键字 / var()，输出 StyleIR。
//   ⇒ 两条通路并存，B3 按端/按字段切换；切换完成后旧通路下线（届时本模块为唯一实现）。
//
// 【诚实边界（v1 支持面，逐条可测）】
//   · 选择器：类 / 元素 / **id** / 通配 / 后代 / 子组合 / 静态结构伪类 / `:not(简单选择器)` / `:deep()` 展开；
//     其余（状态伪类 / 属性 / 兄弟 / 伪元素）→ **显式记 skipped**（不静默）
//   · at-rule：`@layer`（命名层 + 块 + 语句序）✅ · `@keyframes` 跳过（动画通道另有实现）·
//     `@media`/`@supports`/`@container`/`@import` **跳过并计数**（v1 不展开——诚实，不假装响应式）
//   · 简写展开：margin/padding/inset/gap/overflow/flex/border/border-*/border-radius（`/` 椭圆形式记 unsupported）
//   · 值：px / em / rem / % / vw / vh / rpx / pt(按 1:1，**与浏览器 4/3 不同——已知偏差，v1 登记**) ·
//     颜色（hex/rgb/hsl/命名色）· 数值 · 枚举（封闭集校验）· CSS 宽关键字（inherit/initial/unset）
//   · 不做（v1，显式计数）：calc() 表达式 · background-image/渐变 · font 简写 · `!important` 之外的
//     origin（UA/user）——本仓只有 author 级
//
// 【为什么长手层（关键设计——别改回简写层）】
//   CSS 层叠按**长手属性**判定：`margin: 0` 与后写的 `margin-top: 5px` 竞争的是同一属性 `margin-top`
//   （简写先展开成 4 条长手）。若在简写层折叠（现有旧通路做法），"`margin` 覆盖 `margin-top`"这类
//   正确行为**做不到**（现有代码实测：`margin` 的折叠结果会整体覆盖 `margin.top`，同一属性两种来源无法竞争）。
//   ⇒ CSE 的规则表存**长手声明**，层叠后逐长手取唯一胜者。

/** 结构伪类（编译期可判——与既有通路同语义） */
export interface CsePseudo {
  kind: 'first-child' | 'last-child' | 'nth-child'
  a: number
  b: number
}

/** 选择器段（复合：可选 id + 类集 + 元素 + 通配 + 结构伪类 + :not） */
export interface CseSegment {
  /** 类名集合（复合 `.a.b` ⇒ ['a','b']；已剥 scoped 后缀） */
  classes: string[]
  /** id（`#main`；特异性 a 分量） */
  id?: string
  /** 元素名（`h3` / `div`） */
  tag?: string
  /** 通配 `*`（特异性 0） */
  universal?: boolean
  /**
   * ★`:root`（文档根）：只匹配**根节点**（`CseNode` 无父者）。
   *   用法：令牌命名空间（`:root { --x: … }`）与根级默认值；编译器语境没有"文档/HTML"概念 ⇒ 以树根为准。
   */
  root?: boolean
  /** 静态结构伪类 */
  pseudo?: CsePseudo
  /** `:not(<简单选择器>)` 取反 */
  not?: CseSegment
}

/** 一条选择器链（段 + 组合符；长度 = segments.length - 1） */
export interface CseSelectorChain {
  segments: CseSegment[]
  combinators: Array<' ' | '>'>
  /** 原始文本（trace/诊断用） */
  raw: string
}

/** 一条声明（长手；值已做 var() 替换前的原文） */
export interface CseDeclaration {
  /** CSS 属性名（长手；kebab-case 原样，如 `margin-top`） */
  prop: string
  /** 值原文（可能含 var()——计算期替换） */
  value: string
  /** `!important` */
  important: boolean
  /** 该长手是否由某条简写展开而来（trace 用；如 `margin-top` ← `margin`） */
  fromShorthand?: string
}

/** 规则（长手声明 + 层叠元数据） */
export interface CseRule {
  chain: CseSelectorChain
  /** @layer 名（null = 无层/顶层） */
  layer: string | null
  /** 层内**层序号**（源序出现；仅同 importance 同层时参与比较——见 cascade.ts） */
  layerIndex: number
  /** 特异性 (a=id, b=类/伪类/属性, c=元素/伪元素) */
  specificity: [number, number, number]
  /** 源序（全表递增；同 层+特异性 时后写胜） */
  order: number
  /** 长手声明（列表序保留——同规则内同属性后者胜） */
  decls: CseDeclaration[]
  /**
   * ★inline style 伪规则标记（`style="..."` 属性）：CSS 中 style 属性高于任何选择器——
   *   比较时（同为普通声明）**恒胜**（不是靠特异性模拟——那会与"源序极大值"耦合出错）。
   */
  isInline?: boolean
  /** 来源（样式表索引 + 块内行；诊断/trace 用） */
  source: { sheet: number; line: number }
}

/** 解析产物 */
export interface CseStyleSheet {
  rules: CseRule[]
  /** @layer 声明序（`@layer a, b;` 与块首现顺序；索引 = 层序） */
  layerOrder: string[]
  /** 无法处理的选择器/at-rule 计数（诚实——不静默） */
  skipped: Array<{ kind: 'selector' | 'at-rule' | 'declaration'; detail: string; source: { sheet: number; line: number } }>
}

/** 节点（CSE 的输入树；与 LayoutTemplate 解耦——纯结构 + 匹配上下文） */
export interface CseNode {
  /** 稳定键（trace/结果寻址用；缺省由调用方按遍历序生成） */
  key: string
  tag: string
  /** 元素 id（`#x` 选择器匹配用） */
  id?: string
  /** 类集合（原样——匹配时剥 scoped 后缀） */
  classes: string[]
  /** 该节点在**元素兄弟**中的序号 / 总数（结构伪类用） */
  index: number
  count: number
  children: CseNode[]
}

/** 层叠胜者（逐长手） */
export interface CseWinner {
  prop: string
  value: string
  important: boolean
  layer: string | null
  layerIndex: number
  specificity: [number, number, number]
  order: number
  /** 获胜规则的选择器原文（trace） */
  selector: string
  /** 该声明来自哪条简写（trace；无则 undefined） */
  fromShorthand?: string
}

/** 计算值来源链的一步（trace：`proteus explain` 消费） */
export interface CseTraceStep {
  /** 最终值（已折叠形态：number/string/对象） */
  value: unknown
  /** 来自哪条规则（选择器 + 层 + 特异性 + 源序） */
  from: {
    selector: string
    layer: string | null
    specificity: [number, number, number]
    order: number
    important: boolean
    fromShorthand?: string
  } | null
  /** 值来源：cascade=本节点规则胜出 · inherited=继承父 · keyword=CSS 宽关键字结果 · derived=简写展开 */
  via: 'cascade' | 'inherited' | 'keyword' | 'default'
  /** 若经 var() 替换：最终替换值（trace 用） */
  varSubstituted?: string
}

/** 一个节点的计算结果 */
export interface CseComputedNode {
  key: string
  /** StyleIR 形态的逐字段值（键 = StyleIR 字段名） */
  fields: Record<string, unknown>
  /** 逐字段 trace（`proteus explain` 消费；生产可省） */
  trace: Record<string, CseTraceStep>
  /** 未映射到 IR 字段的长手（诚实计数；如 z-index/white-space——引擎不支持） */
  unmapped: Array<{ prop: string; value: string }>
}

/** 整树计算结果 */
export interface CseComputeResult {
  nodes: CseComputedNode[]
  /** 按 key 索引 */
  byKey: Record<string, CseComputedNode>
  /** 诊断（不静默：跳过/未支持/近似都进这里） */
  diagnostics: Array<{ level: 'info' | 'warn'; code: string; message: string }>
}
