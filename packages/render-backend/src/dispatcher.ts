// packages/render-backend/src/dispatcher.ts
// ★G-41 B1（proteus-host-integration-plan batches B1）：ProteusNodeOpsDispatcher——方案 B 全局转发层
//   宿主接入契约 + Vue 绑定架构的核心：
//     · 唯一变量：nodeOps 的转发目标（currentBackend），Vue 与业务代码完全不感知引擎切换
//     · toIRNode：p-* 语义标签 → C-IR（component-ir 的 toComponentIR 驱动，G-31/32 原语表 = 数据源）
//     · switchBackend：热切换 = 一次赋值（DevTools/路由守卫/远程配置均可用）
//     · trace：nodeOps 调用日志（机器证据——同一 IR 在两引擎下渲染驱动一致 = H-03）
//   纯逻辑零依赖（component-ir 同为零依赖纯 TS）；与 G-27 ProteusRenderBackend SPI 紧耦合（同包）。
import { toComponentIR } from '@proteus-vue/component-ir'
import type { IRNode, NodeHandle, ProteusRenderBackend } from './spi'

/** 未知标签（非 p-* / 未知 p-*）→ 编译期就该拦截，运行期硬拖底（G-41.2：禁止静默） */
export class DispatcherError extends Error {
  constructor(
    readonly code: 'unknown.primitive',
    readonly detail: { type: string },
  ) {
    super(`unknown primitive tag: ${detail.type}（须在 G-32 原语表内，编译期拦截；运行期兜底）`)
    this.name = 'DispatcherError'
  }
}

/** nodeOps 调用日志条目（H-03-04 机器证据：渲染驱动与引擎无关） */
export type NodeOpsCall =
  | { seq: number; op: 'createElement'; type: string; semantic: string }
  | { seq: number; op: 'insert'; child: number; parent: number | null; anchor: number | null }
  | { seq: number; op: 'remove'; child: number }
  | { seq: number; op: 'patchProp'; el: number; key: string; next: unknown }
  | { seq: number; op: 'setText'; el: number; text: string }
  | { seq: number; op: 'createText'; text: string }
  | { seq: number; op: 'createComment'; text: string }
  | { seq: number; op: 'parentNode'; node: number; result: number | null }
  | { seq: number; op: 'nextSibling'; node: number; result: number | null }
  | { seq: number; op: 'switchBackend'; from: string; to: string; strategy?: HotSwitchStrategy }

/** Vue createRenderer(nodeOps) 兼容子集（签名对齐 vue-binding-architecture §3.2：createElement(type, props)） */
export interface DispatcherNodeOps {
  createElement(type: string, props?: Record<string, unknown>): NodeHandle
  insert(child: NodeHandle, parent: NodeHandle, anchor?: NodeHandle): void
  remove(child: NodeHandle): void
  patchProp(el: NodeHandle, key: string, prev: unknown, next: unknown): void
  setText(el: NodeHandle, text: string): void
  createText(text: string): NodeHandle
  createComment(text: string): NodeHandle
  parentNode(node: NodeHandle): NodeHandle | null
  nextSibling(node: NodeHandle): NodeHandle | null
}

/** ★G-41 B5：热切换策略（rebuild=销毁重建·开发期 / rehydrate=同一 IR 在新引擎重建·保状态 / hybrid=同页面多引擎·区域路由） */
export type HotSwitchStrategy = 'rebuild' | 'rehydrate' | 'hybrid'

/** ★G-41 方案 B 定型：全局转发层（currentBackend 一次间接调用，热切换 = 赋值） */
export interface ProteusNodeOpsDispatcher {
  readonly currentBackend: ProteusRenderBackend
  /** 热切换（G-41 B5）：换 currentBackend；strategy 决定已渲染节点处理 */
  switchBackend(next: ProteusRenderBackend, opts?: { strategy?: HotSwitchStrategy }): void
  readonly switchHistory: ProteusRenderBackend[]
  /** 节点操作集（Vue createRenderer 消费；全部转发到 currentBackend） */
  readonly nodeOps: DispatcherNodeOps
  /** 标签 → C-IR（G-32 原语表数据源；未知标签 throw——G-41.2 禁止静默） */
  toIRNode(type: string, props?: Record<string, unknown>): IRNode
  /** 调用日志（机器证据：clear 后逐条比对两引擎一致性） */
  readonly trace: NodeOpsCall[]
  clearTrace(): void
}

/** ★G-31 原语表语义缺省（非组件语义 fallback——toComponentIR 只认 p-*；兜底不允许） */
function resolveSemantic(type: string): string | null {
  const cir = toComponentIR(type, {})
  return cir ? cir.semantic : null
}

export function createNodeOpsDispatcher(initialBackend: ProteusRenderBackend): ProteusNodeOpsDispatcher {
  let current: ProteusRenderBackend = initialBackend
  const history: ProteusRenderBackend[] = []
  const trace: NodeOpsCall[] = []
  let seq = 0
  // NodeHandle → 日志 id（句柄不透明，用首个 create 顺序号唯一标识）
  let handleIds = new WeakMap<object, number>()
  let nextHandleId = 1

  function idOf(handle: NodeHandle): number {
    if (handle && typeof handle === 'object') {
      let id = handleIds.get(handle)
      if (id === undefined) {
        id = nextHandleId++
        handleIds.set(handle, id)
      }
      return id
    }
    return 0
  }

  function toIRNode(type: string, props: Record<string, unknown> = {}): IRNode {
    const cir = toComponentIR(type, props)
    if (!cir) throw new DispatcherError('unknown.primitive', { type })
    return { type: cir.tag, semantic: cir.semantic, props: { ...cir.props }, children: [] }
  }

  const nodeOps: DispatcherNodeOps = {
    createElement(type, props = {}) {
      const ir = toIRNode(type, props)
      const handle = current.createElement(ir)
      trace.push({ seq: ++seq, op: 'createElement', type, semantic: ir.semantic ?? type })
      return handle
    },
    insert(child, parent, anchor) {
      current.insert(child, parent, anchor)
      trace.push({ seq: ++seq, op: 'insert', child: idOf(child), parent: parent ? idOf(parent) : null, anchor: anchor ? idOf(anchor) : null })
    },
    remove(child) {
      current.remove(child)
      trace.push({ seq: ++seq, op: 'remove', child: idOf(child) })
    },
    patchProp(el, key, prev, next) {
      current.patchProp(el, key, prev, next)
      trace.push({ seq: ++seq, op: 'patchProp', el: idOf(el), key, next })
    },
    setText(el, text) {
      current.setText(el, text)
      trace.push({ seq: ++seq, op: 'setText', el: idOf(el), text })
    },
    createText(text) {
      const handle = current.createElement({ type: 'text', props: {}, children: [], semantic: undefined })
      trace.push({ seq: ++seq, op: 'createText', text })
      return handle
    },
    createComment(text) {
      const handle = current.createElement({ type: 'comment', props: {}, children: [] })
      trace.push({ seq: ++seq, op: 'createComment', text })
      return handle
    },
    parentNode(node) {
      // G-27 SPI 未定义 parentNode（Vue nodeOps 可选）——引擎支持则转发，否则 null（Vue 契约允许）
      const fn = (current as unknown as { parentNode?: (n: NodeHandle) => NodeHandle | null }).parentNode
      const r = fn ? fn(node) : null
      trace.push({ seq: ++seq, op: 'parentNode', node: idOf(node), result: r ? idOf(r) : null })
      return r ?? null
    },
    nextSibling(node) {
      const fn = (current as unknown as { nextSibling?: (n: NodeHandle) => NodeHandle | null }).nextSibling
      const r = fn ? fn(node) : null
      trace.push({ seq: ++seq, op: 'nextSibling', node: idOf(node), result: r ? idOf(r) : null })
      return r ?? null
    },
  }

  return {
    get currentBackend() {
      return current
    },
    switchBackend(next, opts) {
      const strategy: HotSwitchStrategy = opts?.strategy ?? 'rebuild'
      history.push(current)
      trace.push({ seq: ++seq, op: 'switchBackend', from: current.id, to: next.id, strategy })
      current = next
    },
    get switchHistory() {
      return history
    },
    nodeOps,
    toIRNode,
    trace,
    clearTrace() {
      trace.length = 0
      seq = 0
      handleIds = new WeakMap()
    },
  }
}

/** ★H-03 机器验证助手：把 IR 树用某后端渲染（递归 createElement + insert），返回根句柄 */
export function renderIRTree(backend: ProteusRenderBackend, ir: IRNode, insertInto?: (child: NodeHandle, parent: NodeHandle) => void): NodeHandle {
  const root = backend.createElement(ir)
  for (const child of ir.children) {
    const c = renderIRTree(backend, child)
    if (insertInto) insertInto(c, root)
    else backend.insert(c, root)
  }
  return root
}

/** ★H-03-04：递归提取 IR 树的语义序列（引擎无关的输入指纹——两引擎消费同一 IR 的机器证据） */
export function semanticSequence(ir: IRNode): string[] {
  return [ir.semantic ?? ir.type, ...ir.children.flatMap(semanticSequence)]
}