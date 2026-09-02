// packages/compiler-backend/src/spi.ts
// ★G-29（compiler-backend-1-plan 02-compiler-backend-spi.md）：ProteusCompilerBackend SPI + CompilerIR 契约
//   「编译可插拔」：Node / Rust(SWC-ecosystem) / WASM 三端后端对同一份 SFC 必须产出语义等价的 CompilerIR
//   ——与 G-27 ProteusRenderBackend / G-28 ProteusNativeBackend 同构（语义契约 + 后端实现 + conformance）
//   ★G-31 衔接：CompilerIR.semantic = C-IR 树（toComponentIR 产物——真实模板编译接语义层）
//   零运行时依赖（类型 + 纯逻辑；NodeBackend 的 @vue/* 依赖在 node.ts 层外部化）
import type { ComponentIR } from '@proteus-vue/component-ir'

// —— 输入 ——

export interface SFCSource {
  filename?: string
  source: string
}

export interface SourceLoc {
  line: number
  column: number
}

// —— 中间产物：TemplateAST（与 @vue/compiler-dom 解耦的结构投影——后端无关） ——

export type TemplateNodeType = 'element' | 'text' | 'interpolation' | 'comment'

export interface TemplateNode {
  type: TemplateNodeType
  /** element 时的标签名（p-grid/view/...） */
  tag: string
  /** element 时的规范化属性（静态属性 camelCase→字符串；动态绑定 → { expr }） */
  props: Record<string, unknown>
  children: TemplateNode[]
  line: number
}

export interface TemplateAST {
  root: TemplateNode
}

// —— CompilerIR 契约（04-ir-contract.md） ——

/** 渲染 IR 节点（G-27 nodeOps 消费：有 semantic 走语义映射；无 semantic 属 Layer 1 兼容层按 type 原样） */
export interface RenderNode {
  type: string
  semantic?: string
  props: Record<string, unknown>
  children: RenderNode[]
  loc: SourceLoc
}

export interface RenderIR {
  root: RenderNode
}

/** 语义 IR（G-31 C-IR 树——真实模板编译 → toComponentIR；非 p- 标签不产生 Layer 0 C-IR） */
export interface SemanticIR {
  tree: ComponentIR | null
  /** C-IR 树节点数（= 渲染树中带 semantic 的元素数——conformance 交叉核对） */
  semanticCount: number
  /** 兼容层元素数（渲染树中无 semantic 的元素——view/text/scroll-view 等） */
  compatCount: number
}

/** 布局约束（G-22——B1 占位，v1 可选） */
export interface LayoutConstraintIR {
  // G-22 编译器产出柔性布局约束（断点/clamp/网格）——后续批次接入
}

export interface BindingIR {
  /** 能力入口（p-scan-qr 等 capability.* 语义组件——G-28 消费） */
  capabilities: Array<{ name: string; semantic: string }>
  /** v-model 绑定（name → 表达式） */
  models: Array<{ name: string; expr: string }>
  /** 事件处理器（@click → target 方法名） */
  handlers: Array<{ name: string; target: string }>
}

export interface CompilerIR {
  /** IR 契约版本（版本协商：backend.minCompatVersion ≤ 1） */
  version: 1
  render: RenderIR
  semantic: SemanticIR
  bindings: BindingIR
  layout?: LayoutConstraintIR
}

// —— 能力声明 ——

export interface CompilerCapabilities {
  /** HMR 增量编译 */
  incremental: boolean
  sourceMap: boolean
  treeShaking: boolean
  /** 能否在浏览器跑（WASM） */
  wasmRuntime: boolean
  /** 是否支持 G-21 Plugin */
  plugins: boolean
  maxFileSize: number
}

// —— HMR / SourceMap（B4 接口形态，B1 为可选方法） ——

export interface FileChange {
  file: string
  type: 'create' | 'update' | 'delete'
}

export interface UpdatePayload {
  file: string
  action: 'update' | 'reload'
  code?: string
}

export interface SourceMap {
  version: 3
  sources: string[]
  mappings: string
}

// —— 核心 SPI ——

export interface ProteusCompilerBackend {
  readonly id: string
  readonly version: string
  /** 产出 IR 的最低兼容版本（当前契约 = 1；不匹配 → CMP004 版本不兼容） */
  readonly minCompatVersion: number
  readonly capabilities: CompilerCapabilities

  /** SFC 源码 → CompilerIR（B1 核心：真实模板编译 → 语义 IR） */
  compile(sfc: SFCSource): CompilerIR
  /** 模板字符串 → 结构化元素树（中间产物，后端无关） */
  parse(template: string): TemplateAST
  /** IR → 代码生成（B1 最小实现：序列化；产物代码生成后续批次） */
  generate(ir: CompilerIR): { code: string; warnings: string[] }

  // —— B4（可选）：HMR 一致性 / Source Map ——
  hotUpdate?(changes: FileChange[]): UpdatePayload
  generateSourceMap?(): SourceMap
}