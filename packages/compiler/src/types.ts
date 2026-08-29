// src/compiler/types.ts
// ★类型收口（10-type-consolidation）：编译引擎公共类型已统一收口到 @proteus/types/compiler-types
// 本文件保留为 re-export 兼容层（包内 import './types' 与包外消费方路径不变）
export type {
  TransformPhase,
  TransformTraceEvent,
  TransformTrace,
  TransformRuleOverrides,
  StyleTransformOptions,
  TemplateTransformOptions,
  TemplateTransformResult,
  ScriptTransformOptions,
  ScriptTransformResult,
  CompileOptions,
  CompileResult,
} from '@proteus/types/compiler-types'
