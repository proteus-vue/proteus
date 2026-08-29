// src/compiler/index.ts
// 编译引擎公开 API —— 未来独立包 @proteus/compiler 的入口
// 约束：本模块及同目录文件不得 import vite / proteus.config，选项全部入参
import { parse as sfcParse } from '@vue/compiler-sfc'
import { transformTemplateToWxml } from './template'
import { transformScriptToPage } from './script'
import { transformStyleToWxss } from './style'
import { assertValidResult, CompilerError } from './validate'
import { createTrace } from './trace'
import type { CompileOptions, CompileResult } from './types'

export type {
  CompileOptions,
  CompileResult,
  StyleTransformOptions,
  TemplateTransformOptions,
  TemplateTransformResult,
  ScriptTransformOptions,
  ScriptTransformResult,
} from './types'

export { transformTemplateToWxml } from './template'
export { transformScriptToPage } from './script'
export { transformStyleToWxss } from './style'
export { validateJs, validateWxml, CompilerError } from './validate'

// AI-native 透明定位：编译规则注册表（每条规则一份 AI 说明书）
export { listTransformRules, getTransformRule, formatTransformRule, formatTransformCatalog } from './transforms/registry'
export type { TransformRule, TransformPhase, RuleStatus } from './transforms/types'
export type { TransformRuleOverrides } from './types'

// 阶段二：决策 trace（explainTransform 输出源码触发的全部转换规则）
export { explainTransform, formatTransformTrace } from './explain'
export type { ExplainOptions, ExplainResult } from './explain'
export { createTrace, lineAt } from './trace'
export type { TransformTrace, TransformTraceEvent } from './trace'

/** 整包编译：标准 Vue SFC 源码 → { wxml, js, wxss }（.json 由路由生成器负责） */
export function compileVueSfc(source: string, options: CompileOptions = {}): CompileResult {
  const { descriptor } = sfcParse(source, { filename: options.filename ?? 'anonymous.vue' })
  const styleOpts = {
    px2rpx: options.px2rpx ?? true,
    rpxRatio: options.rpxRatio ?? 2,
    rules: options.rules,
  }

  // 决策 trace（阶段二）：三阶段共用一条链路，产物侧可据此反查规则（★底线循环 ②）
  const tplTrace = createTrace('template')
  const tpl = descriptor.template?.content ?? ''
  const tplResult = transformTemplateToWxml(tpl, {
    ...styleOpts,
    filename: options.filename,
    annotateLines: options.annotateLines,
    trace: tplTrace,
  })

  const setup = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? ''
  const scriptTrace = createTrace('script')
  const scriptResult = transformScriptToPage(setup, styleOpts, {
    file: options.filename,
    isComponent: options.isComponent,
    vModelBindings: tplResult.vModelBindings,
    usesNavigate: tplResult.usesNavigate,
    debug: options.debug,
    rules: options.rules,
    trace: scriptTrace,
  })

  const styleTrace = createTrace('style')
  const wxss = transformStyleToWxss(descriptor.styles.map((s) => s.content).join('\n'), {
    ...styleOpts,
    trace: styleTrace,
  })

  const result: CompileResult = {
    wxml: tplResult.wxml,
    js: scriptResult.js,
    wxss,
    warnings: [...tplResult.warnings, ...scriptResult.warnings],
    trace: [...tplTrace.events, ...scriptTrace.events, ...styleTrace.events],
  }

  // 反黑盒：产物自校验，坏产物当场抛错并指明文件（绝不静默输出）
  assertValidResult(result, options.filename ?? 'anonymous.vue')
  return result
}
