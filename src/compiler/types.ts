// src/compiler/types.ts
// 编译引擎公共类型 —— 未来独立包 @proteus/compiler 的公开 API 类型
// 约束：本目录所有代码不得 import vite / proteus.config（保持可独立分发）

import type { TransformTrace } from './trace'

/** 样式转换选项 */
export interface StyleTransformOptions {
  /** 是否 px → rpx */
  px2rpx: boolean
  /** px→rpx 比例 */
  rpxRatio: number
  /** 决策 trace 收集器（可选：透明定位阶段二，explainTransform 使用） */
  trace?: TransformTrace
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
  /** 生成的自动 handler 是否附带调试日志（PROTEUS_DEBUG） */
  debug?: boolean
  /** 决策 trace 收集器（阶段二，可空） */
  trace?: TransformTrace
}

/** script → Page/Component 构造器结果 */
export interface ScriptTransformResult {
  js: string
  warnings: string[]
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
}

/** 整包编译结果（.wxml + .js + .wxss） */
export interface CompileResult {
  wxml: string
  js: string
  wxss: string
  warnings: string[]
}
