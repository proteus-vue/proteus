// src/compiler/index.ts
// 编译引擎公开 API —— 未来独立包 @proteus/compiler 的入口
// 约束：本模块及同目录文件不得 import vite / proteus.config，选项全部入参
import { parse as sfcParse } from '@vue/compiler-sfc'
import { transformTemplateToWxml } from './template'
import { transformScriptToPage } from './script'
import { transformStyleToWxss } from './style'
import { assertValidResult, CompilerError } from './validate'
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

/** 整包编译：标准 Vue SFC 源码 → { wxml, js, wxss }（.json 由路由生成器负责） */
export function compileVueSfc(source: string, options: CompileOptions = {}): CompileResult {
  const { descriptor } = sfcParse(source, { filename: options.filename ?? 'anonymous.vue' })
  const styleOpts = {
    px2rpx: options.px2rpx ?? true,
    rpxRatio: options.rpxRatio ?? 2,
  }

  const tpl = descriptor.template?.content ?? ''
  const tplResult = transformTemplateToWxml(tpl, {
    ...styleOpts,
    filename: options.filename,
    annotateLines: options.annotateLines,
  })

  const setup = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? ''
  const scriptResult = transformScriptToPage(setup, styleOpts, {
    file: options.filename,
    isComponent: options.isComponent,
    vModelBindings: tplResult.vModelBindings,
    usesNavigate: tplResult.usesNavigate,
    debug: options.debug,
  })

  const wxss = transformStyleToWxss(descriptor.styles.map((s) => s.content).join('\n'), styleOpts)

  const result: CompileResult = {
    wxml: tplResult.wxml,
    js: scriptResult.js,
    wxss,
    warnings: [...tplResult.warnings, ...scriptResult.warnings],
  }

  // 反黑盒：产物自校验，坏产物当场抛错并指明文件（绝不静默输出）
  assertValidResult(result, options.filename ?? 'anonymous.vue')
  return result
}
