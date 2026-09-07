// packages/agent/src/ir-builder.ts
// ★G-36 B2（proteus-ai-agent-plan 04-agent-kit §3）：IRBuilder——不依赖 LLM 构造 ComponentIR
//   · semantic → tag 反查基于 TAG_SEMANTIC_MAP（G-31 SSOT 同源，机器映射非手写）
//   · G-36 降级策略：LLM 不可用时走 IR 模板（Agent Kit 的底座）
//   · setDeviceAdaptation：页面级多端适配声明（CMP020——不改语义只改布局约束）
import { TAG_SEMANTIC_MAP } from '@proteus-vue/component-ir'
import type { ComponentIR } from '@proteus-vue/component-ir'

/** semantic → tag 反查表（TAG_SEMANTIC_MAP 反转——构建期一次性派生） */
const SEMANTIC_TO_TAG: Record<string, string> = {}
for (const [tag, semantic] of Object.entries(TAG_SEMANTIC_MAP)) {
  if (!(semantic in SEMANTIC_TO_TAG)) SEMANTIC_TO_TAG[semantic] = tag
}

export class IRBuilderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IRBuilderError'
  }
}

export interface IRNodeSpec {
  /** 语义标识（G-32 catalog——layout.stack/ui.text/capability.scan-qr…） */
  readonly semantic: string
  /** 显式 tag 覆盖（缺省按 semantic 反查 TAG_SEMANTIC_MAP） */
  readonly tag?: string
  readonly props?: Record<string, unknown>
  /** 能力引用（CMP006：须声明降级——degradation 必填） */
  readonly capabilities?: Array<{ name: string; degradation: string }>
}

/** 多端适配声明（CMP020：只改布局约束不改语义） */
export type DeviceAdaptation = Record<string, Record<string, unknown>>

export interface BuiltPage {
  /** 页面名（组件命名基准） */
  readonly name: string
  /** ComponentIR 树（G-31 契约——validate_ir 可校验） */
  readonly ir: ComponentIR
  /** 多端适配声明（未设置 = 空对象） */
  readonly adaptation: DeviceAdaptation
}

/** 构造器上下文（addNode 回调内继续加子节点） */
export interface IRBuilderNode {
  addNode(spec: IRNodeSpec, children?: (child: IRBuilderNode) => void): IRBuilderNode
}

function makeNodeBuilder(attach: (node: ComponentIR) => void): IRBuilderNode {
  const addNode = (spec: IRNodeSpec, children?: (child: IRBuilderNode) => void): IRBuilderNode => {
    attach(buildNode(spec, children))
    // 链式返回新上下文（同层继续添加）
    return makeNodeBuilder(attach)
  }
  return { addNode }
}

function buildNode(spec: IRNodeSpec, children?: (child: IRBuilderNode) => void): ComponentIR {
  const tag = spec.tag ?? SEMANTIC_TO_TAG[spec.semantic]
  if (!tag) {
    throw new IRBuilderError(`语义 ${spec.semantic} 无组件形态（catalog 无 tag）——请显式指定 tag 或改用组件原语（G-31.1：仅 p- 前缀组件产 C-IR）`)
  }
  const node: ComponentIR = {
    tag,
    semantic: spec.semantic,
    props: { ...(spec.props ?? {}) },
    children: [],
  }
  if (spec.capabilities) {
    // CMP006：能力属性须声明降级（degradation 必填——builder 层强制）
    node.capabilities = spec.capabilities.map((c) => ({ name: c.name, degradation: c.degradation }))
  }
  if (children) {
    children(
      makeNodeBuilder((child) => {
        node.children.push(child)
      }),
    )
  }
  return node
}

/** ★G-36 B2：IRBuilder——链式构造 ComponentIR（不绑 LLM；语义反查 TAG_SEMANTIC_MAP 同源） */
export class IRBuilder {
  private readonly _name: string
  private readonly _roots: ComponentIR[] = []
  private _adaptation: DeviceAdaptation = {}

  constructor(name: string) {
    this._name = name
  }

  /** 添加根级节点（children 回调内继续嵌套） */
  addNode(spec: IRNodeSpec, children?: (child: IRBuilderNode) => void): this {
    this._roots.push(buildNode(spec, children))
    return this
  }

  /** 多端适配声明（CMP020：只改布局约束——car/watch/tv…） */
  setDeviceAdaptation(adaptation: DeviceAdaptation): this {
    this._adaptation = { ...this._adaptation, ...adaptation }
    return this
  }

  /** 产出 BuiltPage（name + ComponentIR + adaptation——validate_ir 可直接校验 ir） */
  build(): BuiltPage {
    const ir: ComponentIR = {
      tag: 'p-page',
      semantic: 'shell.page',
      props: { name: this._name },
      children: [...this._roots],
    }
    return { name: this._name, ir, adaptation: this._adaptation }
  }
}
