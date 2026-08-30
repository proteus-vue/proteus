// src/compiler/index.ts
// 编译引擎公开 API —— 未来独立包 @proteus-vue/compiler 的入口
// 约束：本模块及同目录文件不得 import vite / proteus.config，选项全部入参
import { parse as sfcParse } from '@vue/compiler-sfc'
import { transformTemplateToWxml } from './template'
import { transformScriptToPage } from './script'
import { transformStyleToWxss } from './style'
import { assertValidResult, CompilerError } from './validate'
import { createTrace } from './trace'
import type { CompileOptions, CompileResult } from './types'

/** djb2 哈希 → scoped 属性名（稳定：同文件同 scopeId；零依赖纯函数） */
export function scopedIdFrom(filename: string): string {
  let hash = 5381
  for (let i = 0; i < filename.length; i++) {
    hash = ((hash << 5) + hash + filename.charCodeAt(i)) >>> 0
  }
  return `data-v-${hash.toString(16).slice(0, 6)}`
}

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

  // scoped CSS（★2026-08 用户决策：默认 scoped）：非 <style global> 的 style 块即作用域化（类名后缀拼接）
  //   <style>（无标记）按 scoped 处理 + 编译期警告；<style global>（Proteus 扩展）显式全局（不作用域化）
  //   MVP 简化：scoped 组与 global 组分开转换输出（global 在前，可被 scoped 覆盖）
  const globalStyles = descriptor.styles.filter((s) => s.attrs?.global !== undefined)
  const scopedStyles = descriptor.styles.filter((s) => s.attrs?.global === undefined)
  const hasScoped = scopedStyles.length > 0
  const scopeId = hasScoped ? scopedIdFrom(options.filename ?? 'anonymous.vue') : undefined
  // 决策 trace（阶段二）：三阶段共用一条链路，产物侧可据此反查规则（★底线循环 ②）
  const tplTrace = createTrace('template')
  const tpl = descriptor.template?.content ?? ''
  const tplResult = transformTemplateToWxml(tpl, {
    ...styleOpts,
    filename: options.filename,
    annotateLines: options.annotateLines,
    scopeId,
    isComponent: options.isComponent,
    trace: tplTrace,
  })

  const setup = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? ''
  const scriptTrace = createTrace('script')
  const scriptResult = transformScriptToPage(setup, styleOpts, {
    file: options.filename,
    isComponent: options.isComponent,
    vModelBindings: tplResult.vModelBindings,
    usesNavigate: tplResult.usesNavigate,
    selfHandlers: tplResult.selfHandlers,
    onceHandlers: tplResult.onceHandlers,
    inlineHandlers: tplResult.inlineHandlers,
    debug: options.debug,
    rules: options.rules,
    transitions: tplResult.transitions,
    storeBindings: tplResult.storeBindings,
    moduleImports: options.moduleImports,
    trace: scriptTrace,
  })

  const styleTrace = createTrace('style')
  // CSS 预处理器（v0.3 尾）：lang=scss/less 的 style 块先经 preprocessStyle 钩子转 css（适配层注入，编译器零依赖）
  const preprocess = (s: (typeof descriptor.styles)[number]): string =>
    s.lang && options.preprocessStyle ? options.preprocessStyle(s.lang, s.content) : s.content
  // ★默认 scoped（2026-08）：<style> 无标记按 scoped 处理 + 警告（每文件一条）
  if (!options.rules?.disabled?.includes('style/default-scoped')) {
    for (const s of scopedStyles) {
      if (!s.scoped) {
        const msg =
          `<style> 已按 scoped 处理（Proteus 默认局部作用域；Vue 标准 <style> 为全局，Web 端会泄漏到所有页面）——如需全局样式请改用 <style global>`
        tplResult.warnings.push(msg)
        console.warn(`[mp-transform] ${msg}`)
        break
      }
    }
  }
  // global 组（非作用域化，页面级）+ scoped 组（类名后缀），global 在前可被 scoped 覆盖
  const globalWxss = transformStyleToWxss(globalStyles.map(preprocess).join('\n'), {
    ...styleOpts,
    usesTransition: tplResult.usesTransition,
    trace: styleTrace,
  })
  const scopedWxss = transformStyleToWxss(scopedStyles.map(preprocess).join('\n'), {
    ...styleOpts,
    scopeId,
    usesTransition: tplResult.usesTransition,
    trace: styleTrace,
  })
  const wxss = [globalWxss, scopedWxss].filter(Boolean).join('\n')

  const result: CompileResult = {
    wxml: tplResult.wxml,
    js: scriptResult.js,
    wxss,
    warnings: [...tplResult.warnings, ...scriptResult.warnings],
    trace: [...tplTrace.events, ...scriptTrace.events, ...styleTrace.events],
    sourcemap: scriptResult.sourcemap,
  }

  // 反黑盒：产物自校验，坏产物当场抛错并指明文件（绝不静默输出）
  assertValidResult(result, options.filename ?? 'anonymous.vue')
  return result
}
