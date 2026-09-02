// packages/compiler-backend/src/index.ts —— @proteus-vue/compiler-backend 公共入口
// ★G-29（compiler-backend-1-plan）：编译器可插拔——CompilerIR 契约 + conformance + NodeBackend 参考实现
//   B1：CompilerIR（render/semantic/bindings）+ runCompilerConformance（CMP002/CMP004 + G-31.1 语义链接）
//        + NodeBackend（真实模板编译 → C-IR 语义树——G-31「源码 → C-IR」生产端雏形）
//   核心（spi/conformance）零运行时依赖；NodeBackend 的 @vue/* 为 peerDeps（外部化）
export type {
  ProteusCompilerBackend,
  CompilerCapabilities,
  CompilerIR,
  RenderIR,
  RenderNode,
  SemanticIR,
  LayoutConstraintIR,
  BindingIR,
  SFCSource,
  SourceLoc,
  TemplateAST,
  TemplateNode,
  TemplateNodeType,
  FileChange,
  UpdatePayload,
  SourceMap,
} from './spi'
export { runCompilerConformance, DEFAULT_CONFORMANCE_SFC } from './conformance'
export type { ConformanceCheck, ConformanceResult } from './conformance'
export { createNodeCompilerBackend } from './node'