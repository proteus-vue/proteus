// src/compiler/explain.ts
// explainTransform —— 阶段二核心：对一份 Vue SFC 输出它实际触发的全部转换规则（决策 trace）
// AI 用法：改完编译器 / 写完页面后，跑 explainTransform 看转换链路，理解"为什么产物是这样"。
import { parse as sfcParse } from '@vue/compiler-sfc'
import { transformTemplateToWxml } from './template'
import { transformScriptToPage } from './script'
import { transformStyleToWxss } from './style'
import { createTrace } from './trace'
import type { TransformTraceEvent } from './trace'
import type { TransformRuleOverrides } from './types'

export interface ExplainOptions {
  /** 源文件名（写入 trace 注释） */
  filename?: string
  /** 组件模式（Component() vs Page()） */
  isComponent?: boolean
  /** 是否 px → rpx（默认 true） */
  px2rpx?: boolean
  /** px→rpx 比例（默认 2） */
  rpxRatio?: number
  /** 是否启用行号注释（默认 false） */
  annotateLines?: boolean
  /** 规则覆盖（可选：★底线循环 ①③，与 proteus.config.ts rules 同构） */
  rules?: TransformRuleOverrides
}

export interface ExplainResult {
  filename?: string
  /** 全部决策事件（template → script → style 按阶段顺序） */
  events: TransformTraceEvent[]
}

/** 对一份 Vue SFC 源码执行全链路转换并收集决策 trace */
export function explainTransform(source: string, options: ExplainOptions = {}): ExplainResult {
  const { descriptor } = sfcParse(source, { filename: options.filename ?? 'anonymous.vue' })
  const styleOpts = { px2rpx: options.px2rpx ?? true, rpxRatio: options.rpxRatio ?? 2 }
  const events: TransformTraceEvent[] = []

  // template 阶段（vModelBindings / usesNavigate 传给 script 阶段）
  const tplTrace = createTrace('template')
  const tpl = descriptor.template?.content ?? ''
  const tplResult = transformTemplateToWxml(tpl, {
    ...styleOpts,
    filename: options.filename,
    annotateLines: options.annotateLines,
    rules: options.rules,
    trace: tplTrace,
  })
  events.push(...tplTrace.events)

  // script 阶段
  const setup = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? ''
  const scriptTrace = createTrace('script')
  transformScriptToPage(setup, styleOpts, {
    file: options.filename,
    isComponent: options.isComponent,
    vModelBindings: tplResult.vModelBindings,
    usesNavigate: tplResult.usesNavigate,
    rules: options.rules,
    trace: scriptTrace,
  })
  events.push(...scriptTrace.events)

  // style 阶段
  const styleTrace = createTrace('style')
  transformStyleToWxss(
    descriptor.styles.map((s) => s.content).join('\n'),
    { ...styleOpts, rules: options.rules, trace: styleTrace },
  )
  events.push(...styleTrace.events)

  return { filename: options.filename, events }
}

/** 渲染决策 trace 为人类可读文本（按阶段分组 + 行号） */
export function formatTransformTrace(result: ExplainResult): string {
  const phases: Array<TransformTraceEvent['phase']> = ['template', 'script', 'style', 'validate']
  const blocks: string[] = []
  for (const phase of phases) {
    const evts = result.events.filter((e) => e.phase === phase)
    if (!evts.length) continue
    const lines = evts.map((e) => {
      const line = e.line != null ? `L${e.line} ` : ''
      const detail = [e.before, e.after].filter(Boolean).join(' → ')
      return `  ${line}${e.ruleId}${detail ? `：${detail}` : ''}`
    })
    blocks.push(`### ${phase} 阶段（${evts.length} 个决策）\n${lines.join('\n')}`)
  }
  return `# explainTransform ${result.filename ?? ''}\n\n${blocks.join('\n\n')}`
}
