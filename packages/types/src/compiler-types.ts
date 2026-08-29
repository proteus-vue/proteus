// packages/types/src/compiler-types.ts
// ★类型收口（10-type-consolidation）：编译引擎公共类型（原 @proteus/compiler/types.ts + trace 纯类型）
// 约束：本组类型不 import vite / proteus.config（保持编译引擎可独立分发）
// runtime 值（createTrace/lineAt 函数）留 @proteus/compiler

/** 编译阶段（transforms 注册表 phase 字段） */
export type TransformPhase = 'template' | 'script' | 'style' | 'validate'

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
}

/** 样式转换选项 */
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
}

/** template 转换选项（含反黑盒调试能力） */
export interface TemplateTransformOptions extends StyleTransformOptions {
  /** 源文件名（行号注释定位） */
  filename?: string
  /** 产物注入源码行号注释（dev 调试） */
  annotateLines?: boolean
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
  /** 模板 store.<field> 引用字段 */
  storeBindings?: string[]
  warnings: string[]
}

/** script 转换附加信息 */
export interface ScriptTransformOptions {
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
  /** ★module-plan B0：跨模块引用映射（import 转 require） */
  moduleImports?: Array<{ source: string; requirePath: string }>
  trace?: TransformTrace
}

/** script → Page/Component 构造器结果 */
export interface ScriptTransformResult {
  js: string
  warnings: string[]
  /** sourcemap v3 JSON（方法级 JS 源码映射） */
  sourcemap?: string
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
  /** style 预处理器钩子（适配层注入 sass/less，编译器零依赖） */
  preprocessStyle?: (lang: string, content: string) => string
  /** ★module-plan B0：跨模块引用映射 */
  moduleImports?: Array<{ source: string; requirePath: string }>
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
}
