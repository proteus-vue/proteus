// packages/test-ir/src/types.ts
// ★G-44 B1（proteus-testing-framework-plan）：Test IR 类型（可序列化测试语义——唯一事实源）
//   对齐 plan test-ir.md §2-§5：断言是语义节点（非代码），跨进程/跨运行器/可观测

/** 三维断点（G-25：宽度 × 高度 × 输入形态） */
export interface Profile3D {
  w: number
  h: number
  f: 'touch' | 'cursor' | 'remote' | 'dial' | 'voice'
}

export type TestLayer = 'render' | 'compile' | 'runtime' | 'carrier' | 'integration' | 'ownership' | 'breakpoint'

export interface TestTarget {
  layer: TestLayer
  capability?: string
}

/** 断言语义节点（禁止 code 闭包——G-44.1） */
export type AssertionNode =
  | { kind: 'eq'; path?: string; value: unknown }
  | { kind: 'match'; path?: string; pattern: string }
  | { kind: 'exists'; path?: string }
  | { kind: 'count'; path?: string; op: '=' | '>' | '<'; n: number }
  | { kind: 'throws'; op: ActOp; error?: string }
  | { kind: 'notLeak'; resource: 'timer' | 'listener' | 'view' | 'arrayBuffer' }
  | { kind: 'conforms'; spec: string }
  | { kind: 'and' | 'or'; items: AssertionNode[] }

/** 操作序列（JSON 可序列化——MP/真机下发执行） */
export type ActOp =
  | { op: 'render'; to: string }
  | { op: 'update'; path: string; patch: Record<string, unknown> }
  | { op: 'destroy'; path: string }
  | { op: 'transfer'; resource: string; to: string }
  | { op: 'borrow'; resource: string; scope: string }
  | { op: 'press'; key: string }
  | { op: 'injectState'; state: Record<string, unknown> }
  | { op: 'resize'; w: number; h: number }
  | { op: 'setFormFactor'; f: Profile3D['f'] }
  | { op: 'callNative'; method: string; args: unknown[] }

/** ★Test IR：可序列化、可传输、可复现的测试语义树 */
export interface TestIR {
  id: string
  name?: string
  target: TestTarget
  arrange?: unknown
  act: ActOp[]
  assert: AssertionNode[]
  profile?: Profile3D
  /** 指定后端 id；缺省 = 全部 supports 的后端 */
  backend?: string
  tags?: string[]
  xfail?: { reason: string; issue: string }
}

/** 后端能力声明（诚实原则——G-37.3 同形） */
export interface BackendCaps {
  carrier?: 'node' | 'jsi' | 'aot'
  runtime?: 'ios' | 'android' | 'harmony' | 'web'
  formFactors: Profile3D['f'][]
  hasRealDevice: boolean
  supportsLeakDetection: boolean
}

export interface TestContext {
  profile?: Profile3D
  carrier?: string
  timeout?: number
  trace?: boolean
}

export interface AssertionResult {
  kind: string
  status: 'pass' | 'fail'
  actual?: unknown
  expected?: unknown
}

export interface TestReport {
  irId: string
  backend: string
  profile?: Profile3D
  status: 'pass' | 'fail'
  duration: number
  assertions: AssertionResult[]
  /** 失败 trace 链（G-44.6——定位 IR 节点） */
  trace?: TraceNode[]
}

export interface TraceNode {
  layer: string
  op?: ActOp
  state?: unknown
  children?: TraceNode[]
}

export interface SuiteReport {
  total: number
  pass: number
  fail: number
  byBackend: Record<string, number>
  reports: TestReport[]
}

/** TestBackend SPI（与 G-27 RenderBackend / G-29 CompilerBackend 同形设计语言） */
export interface ProteusTestBackend {
  readonly id: string
  readonly capabilities: BackendCaps
  /** 能否执行该类用例（能力诚实声明——不满足返回 false 由 runner 跳过） */
  supports(ir: TestIR): boolean
  /** 构造该后端的执行状态（后端各自的世界观） */
  buildState(ir: TestIR, ctx: TestContext): Record<string, unknown>
  run(ir: TestIR, ctx: TestContext): Promise<TestReport>
}
