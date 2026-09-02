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
// ★G-29 阶段 A：编译器后端插拔消费点（config.compiler.backend='rust' / proteus build --compiler rust）
export { verifyDualCompilerEquivalence, resolveRustCliBin } from './dual-check'
export type { CompilerBackendChoice } from './dual-check'
// ★G-38（compiler-backend-spi-plan）B1/B2-Node 参考实现：parse/transform/emit 三阶段 SPI（决策 #334）
export { createG38NodeBackend, g38Hash } from './g38'
export type {
  G38CompilerBackend,
  G38CompilerCapabilities,
  G38SourceFile,
  G38SourceLoc,
  G38Diagnostic,
  G38ElementNode,
  G38ProgramIR,
  G38ImportNode,
  G38CapabilityNode,
  G38ModuleMetadata,
  G38IRModule,
  G38CompiledArtifact,
  G38IRModuleDiff,
  G38IncrementalSession,
  G38CompilerContext,
  G38ParseContext,
  G38TransformContext,
  G38EmitContext,
} from './g38'
// ★G-38 B2 尾：FallbackBackend（01 §6）——preferred 不可用 → 自动降级 node + 可观测事件（决策 #335）
export { createG38FallbackBackend } from './g38-fallback'
export type { G38FallbackOptions, G38FallbackResult, G38FallbackLog } from './g38-fallback'
// ★G-38 B2 尾：仓库内 conformance 套件（02 §C-01~C-10 权威 TS 版——proteus conformance CLI + vitest 消费）
export { createG38TerminalBackend, runG38Conformance, formatG38Conformance } from './g38-conformance'
export type { G38ConformanceResult, G38ConformanceSummary } from './g38-conformance'