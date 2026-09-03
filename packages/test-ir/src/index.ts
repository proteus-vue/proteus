// packages/test-ir/src/index.ts —— @proteus-vue/test-ir 公共入口（G-44 验证语义层）
// Test IR（可序列化测试语义）+ TestBackend SPI 五官方后端 + 断言解释器 + ConformanceRunner + 断点矩阵
export { getPath, evalAssertion, applyAct } from './assertion-runner'
export { renderState, officialBackends, NodeBackend, JSCarrierBackend, AOTBackend, HostBackend, DeviceBackend } from './backends'
export { ConformanceRunner } from './conformance-runner'
export { W_BREAK, H_BREAK, F_FORMS, formForWidth, generateBreakpointSuite } from './breakpoint'
export { integrationSuite } from './integration'
export type {
  Profile3D,
  TestLayer,
  TestTarget,
  AssertionNode,
  ActOp,
  TestIR,
  BackendCaps,
  TestContext,
  AssertionResult,
  TestReport,
  TraceNode,
  SuiteReport,
  ProteusTestBackend,
} from './types'
