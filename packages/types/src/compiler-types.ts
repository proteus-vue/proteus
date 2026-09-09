// packages/types/src/compiler-types.ts
// ★类型收口（10-type-consolidation）：编译引擎公共类型（原 @proteus-vue/compiler/types.ts + trace 纯类型）
// 约束：本组类型不 import vite / proteus.config（保持编译引擎可独立分发）
// runtime 值（createTrace/lineAt 函数）留 @proteus-vue/compiler

/** 编译阶段（transforms 注册表 phase 字段） */
export type TransformPhase = 'template' | 'script' | 'style' | 'validate'

/** ★平台化薄接缝（2026-09-08，proteus-compiler-platform-plan）：MP 内部渲染引擎。
 *  编译器当前仅服务 MP（web/app 走运行时 render-backend，不经本编译器，ps app 端无编译侧管线）；引入
 *  renderer 使平台/Skyline 特判有显式挂点，避免后续「拆平台」需横穿散点硬编码。后续平台化全拆时以
 *  此字段为维，向三级（或按 target: mp/web/app）扩展，当前保持最小接缝。
 */
export type Renderer = 'skyline' | 'webview'

/** 单条决策事件：某份源码位置触发了某条规则 */
export interface TransformTraceEvent {
  /** 规则 ID（与 transforms 注册表一致） */
  ruleId: string
  /** 所属编译阶段 */
  phase: TransformPhase
  /** 源码行号 */
  line?: number
  /** 转换前片段 */
  before?: string
  /** 转换后片段 */
  after?: string
}

/** trace 收集器：由转换函数注入（存在才记录，不存在则零开销） */
export interface TransformTrace {
  events: TransformTraceEvent[]
  add(ruleId: string, opts?: { line?: number; before?: string; after?: string }): void
}

/**
 * 规则覆盖（★底线循环 ①③）：AI 或 proteus.config.ts 改写 / 禁用编译规则，编译器即时生效
 */
export interface TransformRuleOverrides {
  /** 禁用的规则 ID 列表：规则不生效，对应输出退化为无转换 + 编译期警告 */
  disabled?: string[]
  /** 覆盖映射：规则 ID → 映射补丁（tag/* 标签映射 / event/click-to-tap 事件 / semantic/base-class 语义类） */
  mapping?: Record<string, Record<string, string>>
  /** 自定义标签映射：新增 HTML 标签 → 小程序标签（AI 扩展新标签的入口） */
  customTags?: Record<string, string>
  /** ★2026-09-09 支持矩阵 fail-fast：矩阵外语义（「已原样输出」类——非方法引用事件处理器/无对等组件标签/SVG/键盘事件）
   *  从软警告升级为编译期硬报错（CompilerError fail-closed——防「已原样输出」静默放行产出无效产物）；
   *  缺省 false 保持警告（诚实但不拦截） */
  failFast?: boolean
}

/** 样式转换选项 */
/** 柔性布局配置（★G-22 fluid-layout）：p-fluid 编译期 clamp 生成参数（缺省设计稿 375 / 视口 320-1440） */
export interface FluidLayoutConfig {
  designWidth?: number
  viewport?: { min?: number; max?: number }
}

export interface StyleTransformOptions {
  /** 是否 px → rpx */
  px2rpx: boolean
  /** px→rpx 比例 */
  rpxRatio: number
  /** <transition> 页面注入进入动画 keyframes（按需） */
  usesTransition?: boolean
  /** 决策 trace 收集器 */
  trace?: TransformTrace
  /** 规则覆盖 */
  rules?: TransformRuleOverrides
  /** scoped CSS 作用域属性（如 'data-v-abc123'） */
  scopeId?: string
  /** ★平台化薄接缝：MP 渲染引擎（skyline/webview）——缺省沿用现行为；使 platform 特判有显式挂点 */
  renderer?: Renderer
}

/** template 转换选项（含反黑盒调试能力） */
export interface TemplateTransformOptions extends StyleTransformOptions {
  /** 源文件名（行号注释定位） */
  filename?: string
  /** 产物注入源码行号注释（dev 调试） */
  annotateLines?: boolean
  /** 组件模式（★2026-08：组件根节点绑定 {{rootClass}} 接收外部 class 透传） */
  isComponent?: boolean
  /** ★15-page-scroll-container：页面模式自动包滚动容器（默认 true） */
  autoScrollContainer?: boolean
  /** ★15-page-scroll-container 批次2：页面滚动 API 桥接检测（声明了对应生命周期 → 自动包装 scroll-view 加事件绑定） */
  pageScrollHooks?: {
    hasOnPageScroll?: boolean
    hasOnReachBottom?: boolean
    hasOnPullDownRefresh?: boolean
    hasPageScrollTo?: boolean
  }
  /** ★G-22 柔性布局：p-fluid 指令编译期 clamp 生成（designWidth/viewport） */
  fluidLayout?: FluidLayoutConfig
}

/** 自定义组件 v-model[:arg] 回写契约（★#500 prop + update:arg 事件 → 页面 setData）
 * ★#505 M4：从 {name, model} 升级为完整契约——arg（v-model 参数）/propName（组件属性名）不再旁路丢失；
 *   name = script 回写方法名（proteusUpdate<Arg>Model）；model = 绑定目标字段。 */
export interface VModelComponentHandler {
  /** 回写方法名（script 注入 setData 方法） */
  name: string
  /** 绑定目标字段（data 字段名） */
  model: string
  /** v-model 参数（v-model:visible → 'visible'；无参数组件形态缺省 → 不携带） */
  arg?: string
  /** 组件属性名（arg ?? 'modelValue'——template 侧 {{propName}} 绑定 + bind:update:propName 事件） */
  propName: string
}

/** template → wxml 结果 */
export interface TemplateTransformResult {
  wxml: string
  /** v-model 绑定字段名 */
  vModelBindings: string[]
  /** 模板是否出现导航链接 */
  usesNavigate: boolean
  /** .self 修饰符 handler 名 */
  selfHandlers?: string[]
  /** .once 修饰符 handler 名 */
  onceHandlers?: string[]
  /** 内联事件表达式包装方法 */
  inlineHandlers?: Array<{ name: string; code: string }>
  /** 模板是否使用 <transition> */
  usesTransition?: boolean
  /** 离开动画状态机（裸 ref v-if 的 transition 子元素） */
  transitions?: Array<{ ref: string; tName: string; index: number }>
  /** ★#494 模板表达式裸标识符（与 runtimeInits 求交 → 快照 setData） */
  templateRefs?: string[]
  /** ★2026-09-08 useTemplateRef/模板 ref 承接：ref="x" 收集名（script 侧 useTemplateRef → this.<var>=selectComponent('#x')） */
  templateRefNames?: string[]
  /** ★模板 store.<field> 引用字段 */
  storeBindings?: string[]
  /** ★#496 柔性语义编译：p-grid 语义元素收集（script 注入档位变量/求解段） */
  semanticGrids?: Array<{ minColWidth: number; gap: number; index: number; defaultStyle: string }>
  /** ★#500 :style 绑定的动态标识符（computed 派生对象 → 编译器自动序列化字符串——MP 双渲染器 style 仅收字符串） */
  styleBindings?: string[]
  /** ★2026-09-09 G-62 事件命中：带事件的静态 SVG 图形表（touch 坐标 + 几何判定） */
  svgHits?: Array<{ imageId: string; viewBox: string; shapes: SvgHitShape[] }>
  /** ★2026-09-09 动画提升：SVG 整体变换 → CSS @keyframes 片段（追加到 wxss） */
  animCss?: string[]
  /** ★2026-09-09 Canvas 通道：含形状变化动画的 SVG 场景（script 侧注入 data） */
  svgScenes?: Array<{ name: string; scene: unknown; width: number; height: number; duration: number }>
  /** ★2026-09-09 G-62 P1：动态 SVG（computed 名 + 结构化片段树 + 依赖）——script 侧生成 computed */
  dynamicSvgs?: Array<{ computedName: string; parts: SvgPart[]; deps: string[]; viewBox: string }>
  /** ★#500 自定义组件 v-model[:arg] 回写处理器（页面 setData 方法） */
  vModelComponentHandlers?: VModelComponentHandler[]
  /** ★15-page-scroll-container：页面已自动包滚动容器（compileVueSfc 据此注入高度样式） */
  pageScrollWrapped?: boolean
  warnings: string[]
}

/** script 转换附加信息 */
/** ★2026-09-09 G-62 事件命中：带事件的 SVG 图形几何（编译期提取） */
export interface SvgHitShape {
  handler: string
  kind: 'circle' | 'rect' | 'ellipse' | 'path'
  geom: Record<string, number | number[]>
  strokeOnly?: boolean
}

/** ★2026-09-09 G-62 P1：动态 SVG 片段（lit 字面量 / expr 动态表达式 / if 条件片段） */
export type SvgPart =
  | { t: 'lit'; v: string }
  | { t: 'expr'; v: string }
  | { t: 'if'; cond: string; parts: SvgPart[] }

export interface ScriptTransformOptions {
  /** ★2026-09-09 G-62 事件命中：带事件的静态 SVG 图形表（模板侧收集 → script 侧生成命中方法） */
  svgHits?: Array<{ imageId: string; viewBox: string; shapes: SvgHitShape[] }>
  /** ★2026-09-09 Canvas 通道：SVG 场景（模板侧收集 → script 侧注入 data） */
  svgScenes?: Array<{ name: string; scene: unknown; width: number; height: number; duration: number }>
  /** ★2026-09-09 G-62 P1：动态 SVG（模板侧收集 → script 侧生成 computed 重生成 SVG 字符串） */
  dynamicSvgs?: Array<{ computedName: string; parts: SvgPart[]; deps: string[]; viewBox: string }>
  file?: string
  /** 组件模式 → Component() 构造器 */
  isComponent?: boolean
  vModelBindings?: string[]
  usesNavigate?: boolean
  debug?: boolean
  rules?: TransformRuleOverrides
  selfHandlers?: string[]
  onceHandlers?: string[]
  inlineHandlers?: Array<{ name: string; code: string }>
  transitions?: Array<{ ref: string; tName: string; index: number }>
  storeBindings?: string[]
  /** ★#496 柔性语义编译：p-grid 语义元素（data 档位变量 + onLoad/attached 求解段注入） */
  semanticGrids?: Array<{ minColWidth: number; gap: number; index: number; defaultStyle: string }>
  /** ★#494 模板表达式裸标识符（与 runtimeInits 求交 → 快照 setData——实例属性模板读不到） */
  templateRefs?: string[]
  /** ★#500 :style 绑定的动态标识符（同名 computed 派生值自动 styleToString 化——MP 双渲染器 style 仅收字符串） */
  styleBindings?: string[]
  /** ★2026-09-08 useTemplateRef/模板 ref 承接：ref="x" 收集名（script 侧 useTemplateRef → this.<var>=selectComponent('#x') + .value 剥除） */
  templateRefNames?: string[]
  /** ★#500 自定义组件 v-model[:arg] 回写处理器（setData 方法名 + 字段） */
  vModelComponentHandlers?: VModelComponentHandler[]
  /** ★module-plan B0：跨模块引用映射（import 转 require） */
  moduleImports?: Array<{ source: string; requirePath: string }>
  /** ★2026-09-08 P1（defineModel 地基）：compileScript 权威源的模型引用（var→propName）——m.value 读写重写 + prop 注册 */
  modelRefs?: Array<{ varName: string; propName: string }>
  /** ★2026-09-08 defineOptions 对齐：compileScript 权威语义 { name?, inheritAttrs? }——剥离为 no-op + name 写组件字段（inheritAttrs 诚实降级） */
  defineOptions?: { name?: string; inheritAttrs?: boolean }
  trace?: TransformTrace
}

/** script → Page/Component 构造器结果 */
export interface ScriptTransformResult {
  js: string
  warnings: string[]
  sourcemap?: string
  /** ★#505 M4 ScriptIR 语义快照（script 提取层结构化投影——codegen 出口不变；编译产物与既有逐字节等价） */
  ir?: ScriptIR
}

/** 编译选项（compileVueSfc 入口） */
export interface CompileOptions {
  filename?: string
  isComponent?: boolean
  px2rpx?: boolean
  rpxRatio?: number
  annotateLines?: boolean
  debug?: boolean
  rules?: TransformRuleOverrides
  /** ★G-22 柔性布局：p-fluid 编译期 clamp 生成参数 */
  fluidLayout?: FluidLayoutConfig
  /** style 预处理器钩子（适配层注入 sass/less，编译器零依赖） */
  preprocessStyle?: (lang: string, content: string) => string
  /** ★module-plan B0：跨模块引用映射 */
  moduleImports?: Array<{ source: string; requirePath: string }>
  /** ★15-page-scroll-container：页面模式自动包滚动容器（Skyline 页面本身不滚动，滚动必须 scroll-view；默认 true） */
  autoScrollContainer?: boolean
  /** ★平台化薄接缝（2026-09-08，proteus-compiler-platform-plan）：MP 内部渲染引擎。
   *  缺省 = undefined → 当前行为（Skyline 特判全开，现有产物不变）；显式 'webview' 时关 Skyline-only 降级/警告。
   *  编译器当前仅服务 MP（web/app 走运行时 render-backend），此字段为后续「全端平台化拆分」的最小挂点。
   */
  renderer?: Renderer
}

/** 整包编译结果（.wxml + .js + .wxss） */
export interface CompileResult {
  wxml: string
  js: string
  wxss: string
  warnings: string[]
  /** 决策 trace（本次编译实际触发的规则） */
  trace?: TransformTraceEvent[]
  sourcemap?: string
  /** ★#505 CompileIR 语义快照（M1 骨架：TemplateIR 投影；ScriptIR M4 迁入）——主编译路径经框架 IR 的第一段接线 */
  ir?: CompileIR
}

// ─────────────────────────────────────────────────────────────────────────────
// ★#505 CompileIR（编译管线阶段间语义 IR，草案 docs/compiler-ir-contract-draft.md）
// 定位：主编译管线的「框架自研边界 #1」——与 C-IR（component-ir，p-* 组件语义）/
// CompilerIR（compiler-backend，后端产物契约）平级第三套，但语义词表引用 C-IR，不重复建设。
// M1 只落 TemplateIR 结构投影（把 TemplateTransformResult 旁路字段提升为声明）；
// 表达式级语义丰富（elementKind/arg/modifiers 补全）随 M2 试点 / M4 ScriptIR 逐条迁入。
// 产物侧：wxml/js/wxss 文本仍由 codegen 直出（M1 codegen 出口不变，逐字节等价）。
// ─────────────────────────────────────────────────────────────────────────────

/** 编译 IR 容器（主编译路径中间表示） */
export interface CompileIR {
  /** 契约版本（与 TemplateIR/脚本侧演进同步 bump） */
  version: 1
  /** 模板语义声明（由 TemplateTransformResult 投影） */
  template: TemplateIR
  /** 脚本语义声明（M4 迁入：data/computed/watch/props/lifecycle/methods 结构化） */
  script?: ScriptIR
}

/** 模板语义声明（M1 范围：TemplateTransformResult 14 旁路字段的结构化投影） */
export interface TemplateIR {
  /** v-model 绑定目标字段（含组件形态；组件回写见 vModelComponentHandlers） */
  vModelTargets: string[]
  /** 自定义组件 v-model[:arg] 回写处理器（完整契约：prop + update:arg 事件 + setData 回写——★#505 M4 arg/propName 不再丢） */
  vModelComponentHandlers: VModelComponentHandler[]
  /** 事件适配器（.self/.once 修饰符包装方法名） */
  eventWrappers: { self: string[]; once: string[] }
  /** 内联事件表达式包装方法（name + 代码段，script 原样发射） */
  inlineHandlers: Array<{ name: string; code: string }>
  /** 离开动画状态机声明（v-if 裸 ref 的 transition 子元素） */
  transitions: Array<{ ref: string; tName: string; index: number }>
  /**
   * :style 动态标识符绑定（同名 computed 派生对象 → script 侧自动序列化字符串）。
   * ★#505 M2：从 string[] 升级为声明对象——valueKind 携带平台序列化约束（MP 双渲染器 style 仅收字符串，
   *   对象直进 setData 静默失效 #500/#496b），供未来 conformance 断言「valueKind: string-only 的绑定
   *   产物必须走字符串化通道（__proteusStyleString 或编译期拼接）」；target = 派生值来源（computed/data）。
   */
  styleBindings: Array<{ target: string; valueKind: 'string-only' }>
  /** 模板表达式对组件实例属性依赖面（与 runtimeInits 求交 → 快照进 data） */
  templateRefs: string[]
  /** 模板 store.<field> 引用（Pinia MP 桥 $subscribe → setData） */
  storeBindings: string[]
  /** p-grid 语义布局元素声明（script 注入档位变量/求解段） */
  semanticGrids: Array<{ minColWidth: number; gap: number; index: number; defaultStyle: string }>
  /** 页面能力开关（各驱动一个注入段） */
  capabilities: {
    /** 模板出现导航链接 → 注入 proteusNavigateTo */
    navigate: boolean
    /** 模板使用 <transition> → style 侧注入 keyframes */
    transition: boolean
    /** 页面已自动包滚动容器 → 注入 .proteus-page-scroll 高度样式 */
    scrollContainer: boolean
  }
}

/** 脚本语义声明（★#505：类型先落地，M4 随逐条迁入填充）
 * ★#505 M4 ScriptIR 首条：data/computeds/runtimeInits/lifecycles 结构化投影（script 提取层局部态 → 声明）
 *   —— data = 进 data 对象的字段（ref/reactive/字面量 const）；computeds = 派生声明（deps 依赖 + 形态）；
 *   runtimeInits = 实例属性通道（函数调用初始化 + let 句柄——onLoad/attached 注入，非 data）；
 *   lifecycles = 命中的生命周期钩子名（onLoad/onReady/onUnload——Vue 钩子映射后目标）。 */
export interface ScriptIR {
  /** data 声明（ref/reactive/顶层 let 字面量 → data） */
  data?: Array<{ name: string }>
  /** computed 派生声明（含依赖 deps 与形态 kind——块体/可写/表达式） */
  computeds?: Array<{ name: string; deps?: string[]; kind?: 'expression' | 'block' | 'writable' }>
  /** 实例属性通道（runtimeInit 函数调用 + 顶层 let null 句柄——非 data，onLoad/attached 注入） */
  runtimeInits?: Array<{ name: string }>
  /** 生命周期钩子（Vue → MP 映射后命中目标名） */
  lifecycles?: string[]
  /** watch 声明（源形态/依赖/immediate/observers——★props 源 = WeChat observers；params = 原始回调参数名
   *   ——observers 形态产物回调参数恒归一为 n/o（#499 renameWatchParamsToNo），原始名在 params 保留） */
  watchers?: Array<{ deps: string[]; kind: 'ref' | 'array' | 'getter' | 'props'; immediate: boolean; observers: boolean; propField?: string; params?: string[] }>
  /** props 声明（defineProps 对象/泛型 → Component properties：name + 微信类型） */
  props?: Array<{ name: string; type: string }>
  /** provide 键表（key + 是否响应式 ref 提供——裸 ref → 写入点联动通知） */
  provides?: Array<{ key: string; reactive: boolean }>
  /** inject 键表（接收名 → 源 key） */
  injects?: Array<{ key: string; name: string }>
  /** methods 名册（顶层函数/箭头 → 产物方法——模板事件处理器回显关联面） */
  methods?: Array<{ name: string }>
}
