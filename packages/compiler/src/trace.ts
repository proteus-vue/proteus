// src/compiler/trace.ts
// 决策 trace —— 阶段二：转换过程可观察（透明定位的运行时形态）
// ★类型收口（10-type-consolidation）：TransformTraceEvent/TransformTrace 类型已收口到
//   @proteus-vue/types/compiler-types（本文件保留 runtime 函数 createTrace/lineAt + re-export）
import type { TransformPhase, TransformTrace, TransformTraceEvent } from '@proteus-vue/types/compiler-types'

export type { TransformTraceEvent, TransformTrace } from '@proteus-vue/types/compiler-types'

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
