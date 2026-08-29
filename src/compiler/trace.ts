// src/compiler/trace.ts
// 决策 trace —— 阶段二：转换过程可观察（透明定位的运行时形态）
// 转换函数在编译过程中把实际触发的规则记入 trace（可选注入，默认不收集、零开销），
// explainTransform() 借此输出"这份源码触发了哪些转换规则"的决策链。
import type { TransformPhase } from './transforms/types'

/** 单条决策事件：某份源码位置触发了某条规则 */
export interface TransformTraceEvent {
  /** 规则 ID（与 transforms 注册表一致，tests/explain.test.ts 校验可解析） */
  ruleId: string
  /** 所属编译阶段 */
  phase: TransformPhase
  /** 源码行号（template 精确到节点；script/style 尽力而为） */
  line?: number
  /** 转换前片段（示例性，非完整） */
  before?: string
  /** 转换后片段 */
  after?: string
}

/** trace 收集器：由转换函数注入（存在才记录，不存在则零开销） */
export interface TransformTrace {
  events: TransformTraceEvent[]
  add(ruleId: string, opts?: { line?: number; before?: string; after?: string }): void
}

/** 创建空收集器（phase 记录事件所属阶段，formatTransformTrace 分组用） */
export function createTrace(phase: TransformPhase = 'template'): TransformTrace {
  return {
    events: [],
    add(ruleId, opts) {
      this.events.push({ ruleId, phase, ...opts })
    },
  }
}

/** 由字符偏移计算源码行号（1-based） */
export function lineAt(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') line++
  }
  return line
}
