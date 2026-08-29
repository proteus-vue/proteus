// src/compiler/types.ts
// 编译引擎公共类型 —— 未来独立包 @proteus/compiler 的公开 API 类型
// 约束：本目录所有代码不得 import vite / proteus.config（保持可独立分发）

import type { TransformTrace, TransformTraceEvent } from './trace'

/**
 * 规则覆盖（★底线循环 ①③）：AI 或 proteus.config.ts 改写 / 禁用编译规则，编译器即时生效
 * 生效范围：template（标签/事件/语义类映射 + 指令开关）、style（选择器重写/px2rpx/基础样式）、
 * script（data 提取 / 自动 handler / onload 注入 / ref 重写）
 */
export interface TransformRuleOverrides {
  /** 禁用的规则 ID 列表（如 ['directive/v-show-limit']）：规则不生效，对应输出退化为无转换 + 编译期警告 */
  disabled?: string[]
  /** 覆盖映射：规则 ID → 映射补丁（合并进 tags.ts 常量 / 规则自带 mapping）
   *  tag/*（如 'tag/link-to-view'）→ 标签映射；'event/click-to-tap' → 事件映射；'semantic/base-class' → 语义基础类 */
  mapping?: Record<string, Record<string, string>>
  /** 自定义标签映射：新增 HTML 标签 → 小程序标签（如 { 'my-widget': 'view' }）——AI 扩展新标签的入口 */
  customTags?: Record<string, string>
}

/** 样式转换选项 */
export interface StyleTransformOptions {
  /** 是否 px → rpx */
  px2rpx: boolean
  /** px→rpx 比例 */
  rpxRatio: number
  /** vue-compat-advance Batch 2：页面使用 <transition> 时注入进入动画 keyframes（按需） */
  usesTransition?: boolean
  /** 决策 trace 收集器（可选：透明定位阶段二，explainTransform 使用） */
  trace?: TransformTrace
  /** 规则覆盖（可选：底线循环 ①③） */
  rules?: TransformRuleOverrides
  /** scoped CSS 作用域属性（如 'data-v-abc123'，v0.3：style 选择器追加 [scopeId]、template 元素附加该属性） */
  scopeId?: string
}

/** template 转换选项（含反黑盒调试能力） */
export interface TemplateTransformOptions extends StyleTransformOptions {
  /** 源文件名（写入行号注释，便于定位） */
  filename?: string
  /** 是否在产物中注入源码行号注释（反黑盒：dev 调试用，默认 false） */
  annotateLines?: boolean
}

/** template → wxml 结果 */
export interface TemplateTransformResult {
  wxml: string
  /** v-model 绑定的字段名（供 script 转换注入 __onXxxInput） */
  vModelBindings: string[]
  /** 模板中是否出现导航链接（供 script 转换注入 __navigateTo） */
  usesNavigate: boolean
  /** .self 修饰符 handler 名（script 生成 proteusSelfXxx 包装，v0.3 尾） */
  selfHandlers?: string[]
  /** .once 修饰符 handler 名（script 生成 proteusOnceXxx 包装，v0.3 尾） */
  onceHandlers?: string[]
  /** vue-compat Batch B：内联事件表达式包装方法（自增/自减/简单方法调用） */
  inlineHandlers?: Array<{ name: string; code: string }>
  /** vue-compat-advance Batch 2：模板是否使用 <transition>（style 按需注入动画 keyframes） */
  usesTransition?: boolean
  /** ★vue-compat-advance Batch 5：离开动画状态机（裸 ref v-if 的 transition 子元素） */
  transitions?: Array<{ ref: string; tName: string; index: number }>
  warnings: string[]
}

/** script 转换附加信息 */
export interface ScriptTransformOptions {
  /** 相对路径（写入产物注释，便于定位） */
  file?: string
  /** 组件模式 → Component() 构造器（默认 Page()） */
  isComponent?: boolean
  /** 来自 template 的 v-model 绑定名（生成自动 handler） */
  vModelBindings?: string[]
  /** 模板中是否出现导航链接（生成自动 __navigateTo handler） */
  usesNavigate?: boolean
  /** 生成的自动 handler 是否附带调试日志（PROTEUS_DEBUG，默认 false） */
  debug?: boolean
  /** 规则覆盖（可选：底线循环 ①③） */
  rules?: TransformRuleOverrides
  /** .self 修饰符 handler 名（来自 template，生成 proteusSelfXxx 包装） */
  selfHandlers?: string[]
  /** .once 修饰符 handler 名（来自 template，生成 proteusOnceXxx 包装） */
  onceHandlers?: string[]
  /** vue-compat Batch B：内联事件表达式包装方法（来自 template） */
  inlineHandlers?: Array<{ name: string; code: string }>
  /** ★vue-compat-advance Batch 5：离开动画状态机（来自 template；生成 __tv/__tl data + toggle 方法 + 写入点注入） */
  transitions?: Array<{ ref: string; tName: string; index: number }>
  /** ★module-plan B0：跨模块引用映射（插件预计算：源码 import 路径 → 产物相对 require 路径）；命中 → import 转 require，未收录 → 剥离 + 警告 */
  moduleImports?: Array<{ source: string; requirePath: string }>
  /** 决策 trace 收集器（阶段二，可空） */
  trace?: TransformTrace
}

/** script → Page/Component 构造器结果 */
export interface ScriptTransformResult {
  js: string
  warnings: string[]
  /** sourcemap v3 JSON（v0.3：方法级 JS 源码映射，调试构建落盘） */
  sourcemap?: string
}

/** 编译选项（compileVueSfc 入口） */
export interface CompileOptions {
  /** 相对路径（产物注释 / 错误定位） */
  filename?: string
  /** 组件模式 → Component() 构造器 */
  isComponent?: boolean
  /** 是否 px → rpx（默认 true） */
  px2rpx?: boolean
  /** px→rpx 比例（默认 2） */
  rpxRatio?: number
  /** 是否在 wxml 产物中注入源码行号注释（dev 调试，默认 false） */
  annotateLines?: boolean
  /** 自动生成的 handler 是否附带调试日志（PROTEUS_DEBUG，默认 false） */
  debug?: boolean
  /** 规则覆盖（可选：底线循环 ①③）：AI/config 改写或禁用规则 */
  rules?: TransformRuleOverrides
  /**
   * style 预处理器钩子（v0.3 尾：CSS 预处理器）——lang=scss/less 的 style 块先经此转 css
   * 由适配层注入（插件用 sass/less），保持编译器零依赖；未提供则原样传入
   */
  preprocessStyle?: (lang: string, content: string) => string
  /** ★module-plan B0：跨模块引用映射（插件预计算：源码 import 路径 → 产物相对 require 路径）；命中 → import 转 require */
  moduleImports?: Array<{ source: string; requirePath: string }>
}

/** 整包编译结果（.wxml + .js + .wxss） */
export interface CompileResult {
  wxml: string
  js: string
  wxss: string
  warnings: string[]
  /** 决策 trace（阶段二：本次编译实际触发的规则，供产物侧调试定位——底线循环 ②） */
  trace?: TransformTraceEvent[]
  /** sourcemap v3 JSON（v0.3：方法级 JS 源码映射） */
  sourcemap?: string
}
