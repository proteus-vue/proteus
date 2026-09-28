// packages/component-ir/src/pnode-build.ts
// ★★M0：渲染 IR 构建——把上游（语义 IR / 模板分析结果）转成 `PTree`。
//
// 两条入口：
//  ① `buildPTree(raw[])`：从**轻量声明**构建（测试 / 编译器直调——不依赖 ComponentIR 的完整形状）
//  ② `buildPTreeFromComponentIR(roots)`：从语义 IR 构建（编译器主路径；
//     语义 → 绘制类型映射见 `kindFromSemantic`）
//
// 纪律：本模块**纯函数、零副作用**；id 分配由传入的 `nextId` 闭包控制（可复现——同输入同 id）。
import type { ComponentIR } from './schema'
// ★指令集只允许一处定义（@proteus-vue/slot-runtime 的 opcode.ts）：
//   号值同时是**线上格式判别字节**，与 Rust 侧 ops.rs 逐字节对齐——复制一份必然分叉。
import { OpCode } from '@proteus-vue/slot-runtime'
import type { UpdateTier } from '@proteus-vue/slot-runtime'
import type { DynamicBinding, PDiagnostic, PKind, PNode, PProps, PTree, UpdateKind } from './pnode'
import { normalizeStyleDecls, normalizeStyleString } from './pnode-style'
import type { NodeFacts, AnalyzeOptions } from './pnode-analyze'
import { analyzePTree } from './pnode-analyze'

/**
 * 语义 → 绘制类型（**框架层收敛点**：semantic 是后端映射依据，kind 是绘制层分工）。
 * 映射表对齐 `render-backend/spi.ts` 的 `IRNode.semantic` 域前缀。
 */
export function kindFromSemantic(semantic: string | undefined, tag: string): PKind {
  const s = semantic ?? ''
  if (!s) {
    // 无语义（原生标签/调试节点）：按标签粗判
    if (tag === 'text' || tag === 'p-text') return 'text'
    if (tag === 'image' || tag === 'img') return 'image'
    return 'view'
  }
  if (s.startsWith('layout.virtual-list') || s.startsWith('layout.masonry')) return 'list'
  if (s.startsWith('layout.')) return 'view'
  if (s === 'ui.text' || s === 'ui.heading' || s === 'ui.label') return 'text'
  if (s === 'ui.rich-text') return 'rich-text'
  if (s.startsWith('ui.image') || s === 'ui.icon' || s === 'ui.avatar' || s === 'ui.media' || s === 'ui.svg' || s === 'ui.canvas') return 'image'
  // ★原生宿主（CSS Profile §0.2 非目标：地图/WebView/广告/相机必须原生嵌入）
  if (s === 'shell.webview' || s === 'ui.map' || s === 'ui.camera' || s === 'shell.ad' || s === 'ui.ad') return 'native-host'
  return 'view'
}

/** 轻量声明节点（供测试与编译器直调——刻意不要求完整 ComponentIR） */
export interface PRawNode {
  kind?: PKind
  semantic?: string
  tag?: string
  /** 内联样式：字符串或声明表 */
  style?: string | Record<string, string>
  /** 文本字面量（静态文本） */
  text?: string
  /** 事实（事件/动画/组件根/显式拍平请求——传给分析器） */
  facts?: Omit<NodeFacts, 'dynamicProps'>
  /** 动态绑定声明（编译器从模板分析得出） */
  bindings?: Array<{
    propKey: string
    exprId: string
    updateKind?: UpdateKind
    /** ★显式指定操作码（如 item 级 `LIST_UPDATE`；缺省由 updateKind 推导） */
    opCode?: OpCode
    /** ★分层（缺省 L0——保守：没证明安全就不许假设安全） */
    tier?: UpdateTier
    /** ★编译期识别的响应式依赖（V2 填充；缺省空数组） */
    deps?: string[]
  }>
  children?: PRawNode[]
}

export interface BuildOptions {
  /** 起始 id（多次构建可错开——同输入同输出） */
  startId?: number
  /** 自定义分析选项透传（boundaryIds 等） */
  analyze?: AnalyzeOptions
}

interface BuildState {
  nextId: number
  bindings: DynamicBinding[]
  diagnostics: PDiagnostic[]
  facts: Map<number, NodeFacts>
  slot: number
}

function normalizePropsOf(raw: PRawNode, kind: PKind, st: BuildState, ctx: { id: number; tag: string }): PProps {
  const source = { tag: ctx.tag, line: undefined as number | undefined }
  const res =
    typeof raw.style === 'string'
      ? normalizeStyleString(raw.style, { kind, nodeId: ctx.id, source })
      : normalizeStyleDecls(raw.style ?? {}, { kind, nodeId: ctx.id, source })
  st.diagnostics.push(...res.diagnostics)
  return res.props
}

function buildNode(raw: PRawNode, st: BuildState): PNode {
  const id = st.nextId++
  const tag = raw.tag ?? raw.kind ?? 'view'
  const kind = raw.kind ?? kindFromSemantic(raw.semantic, tag)
  const props = normalizePropsOf(raw, kind, st, { id, tag })

  for (const b of raw.bindings ?? []) {
    const updateKind = b.updateKind ?? inferUpdateKind(b.propKey)
    st.bindings.push({
      slotId: st.slot++,
      nodeId: id,
      propKey: b.propKey,
      exprId: b.exprId,
      updateKind,
      // ★Vapor IR 扩展（方案 §3.2）：opCode 编译期确定 ⇒ 运行时无类型判断
      opCode: b.opCode ?? inferOpCode(updateKind),
      // ★缺省 L0：保守优先（误判 L1 = 静默不更新；方案 §5.1）
      tier: b.tier ?? 'L0',
      deps: b.deps ?? [],
    })
  }

  const facts: NodeFacts = {
    hasEvent: raw.facts?.hasEvent,
    isAnimationTarget: raw.facts?.isAnimationTarget,
    isComponentRoot: raw.facts?.isComponentRoot,
    requestFlatten: raw.facts?.requestFlatten,
    dynamicProps: (raw.bindings ?? []).map((b) => b.propKey),
  }
  st.facts.set(id, facts)

  const node: PNode = {
    id,
    kind,
    semantic: raw.semantic,
    props,
    children: [],
    flags: { isStatic: true, flattenEligible: false, isLayoutBoundary: false, hasEvent: false, isNativeHost: kind === 'native-host' },
    source: { tag },
  }
  if (raw.text !== undefined) node.text = raw.text
  node.children = (raw.children ?? []).map((c) => buildNode(c, st))
  return node
}

/** 绑定属性键 → 更新种类（运行时按种类走特化写值——D1「按槽位写值」） */
export function inferUpdateKind(propKey: string): UpdateKind {
  if (propKey.startsWith('text.')) return propKey === 'text.color' || propKey === 'text.fontSize' ? 'style' : 'text-content'
  if (propKey.startsWith('layout.')) return 'style'
  if (propKey.startsWith('paint.')) return 'style'
  if (propKey === 'visible' || propKey === 'display') return 'visibility'
  if (propKey.startsWith('list.')) return 'list-data'
  return 'attr'
}

/**
 * 更新种类 → 指令操作码（**编译期确定，运行时无分支**——方案 §2.1）
 *
 * ★为什么 `list-data` 默认映射到 `LIST_SET` 而不是 `LIST_UPDATE`：
 *   同一个 `updateKind` 有两种列表语义——「整体换数据源」（LIST_SET）与
 *   「单项内一个槽位变化」（LIST_UPDATE，方案 §2.3 的核心收益）。
 *   后者**必须由编译器显式指定**（它要知道 listId / itemKey / 项内槽位），
 *   不能在推进时猜——猜错会把「改一项」误当成「换整表」，是静默的性能回退。
 */
export function inferOpCode(updateKind: UpdateKind): OpCode {
  switch (updateKind) {
    case 'attr':
      return OpCode.SET_PROP
    case 'style':
      return OpCode.SET_STYLE
    case 'text-content':
      return OpCode.SET_TEXT
    case 'visibility':
      return OpCode.TOGGLE_VIS
    case 'list-data':
      return OpCode.LIST_SET
    default: {
      const never: never = updateKind
      throw new Error(`未知更新种类：${String(never)}`)
    }
  }
}

/** 从轻量声明构建渲染 IR（含分析） */
export function buildPTree(raws: PRawNode[], opts: BuildOptions = {}): PTree {
  const st: BuildState = {
    nextId: opts.startId ?? 1,
    bindings: [],
    diagnostics: [],
    facts: new Map(),
    slot: 0,
  }
  const roots = raws.map((r) => buildNode(r, st))
  const tree: PTree = {
    roots,
    bindings: st.bindings,
    diagnostics: st.diagnostics,
    stats: { nodeCount: 0, flattenableCount: 0, compositingCount: 0 },
  }
  analyzePTree(tree, { facts: st.facts, boundaryIds: opts.analyze?.boundaryIds })
  return tree
}

/* ─────────────────── ComponentIR 入口（编译器主路径） ─────────────────── */

/** 从 ComponentIR 提取内联样式（props.style 可能是字符串或对象） */
function styleOf(ir: ComponentIR): string | Record<string, string> | undefined {
  const s = (ir.props as Record<string, unknown>).style
  if (typeof s === 'string') return s
  if (s && typeof s === 'object') return s as Record<string, string>
  return undefined
}

/** 从 ComponentIR 转 PRawNode（保留语义、样式、文本） */
export function rawFromComponentIR(ir: ComponentIR): PRawNode {
  const children = (ir.children ?? []).map(rawFromComponentIR)
  const raw: PRawNode = {
    semantic: ir.semantic,
    tag: ir.tag,
    children,
  }
  const st = styleOf(ir)
  if (st) raw.style = st
  return raw
}

/** 从语义 IR 构建渲染 IR（编译器集成入口） */
export function buildPTreeFromComponentIR(roots: ComponentIR[], opts: BuildOptions = {}): PTree {
  return buildPTree(roots.map(rawFromComponentIR), opts)
}
