// packages/compiler-backend/src/node.ts
// ★G-29 B1（compiler-backend-1-plan 01 §4/02 §2）：NodeBackend 参考实现——真实模板编译 → CompilerIR
//   复用 @vue/compiler-sfc（SFC 解析）+ @vue/compiler-dom（模板 AST）——与 @proteus-vue/compiler 同源编译器堆栈
//   ★G-31 衔接：CompilerIR.semantic = toComponentIR 产物（真实模板 p-* 标签 → C-IR 语义树）
//   ——「源码 → C-IR」的生产端（G-29 §9 协同：语义 IR 供 G-27 渲染 / G-23 AI Agent 操作）
//   v-if/v-for 容器（IF/FOR 包装节点）摊平：B1 不做条件/循环展开，render 树保留元素本身（后续批次）

import { parse as sfcParse } from '@vue/compiler-sfc'
import { parse as domParse, NodeTypes } from '@vue/compiler-dom'
import type { AttributeNode, DirectiveNode, ElementNode, TemplateChildNode } from '@vue/compiler-dom'
import { toComponentIR, TAG_SEMANTIC_MAP } from '@proteus-vue/component-ir'
import type { ComponentIR } from '@proteus-vue/component-ir'
import type {
  BindingIR,
  CompilerCapabilities,
  CompilerIR,
  ProteusCompilerBackend,
  RenderNode,
  SFCSource,
  TemplateAST,
  TemplateNode,
} from './spi'

const NODE_CAPABILITIES: CompilerCapabilities = {
  incremental: true, // 官方 Node 后端支持增量（G-34 HMR 已有编译侧增量）
  sourceMap: false, // B4
  treeShaking: false, // B4
  wasmRuntime: false,
  plugins: true, // 与 @proteus-vue/compiler 规则注册表同源
  maxFileSize: 5 * 1024 * 1024,
}

// —— 工具 ——

function camelize(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** 摊平 IF/FOR 指令容器（B1 不展开条件/循环；v-model/v-on 等在元素 props 上原样保留） */
function flattenChildNodes(children: TemplateChildNode[]): TemplateChildNode[] {
  const out: TemplateChildNode[] = []
  for (const c of children) {
    if (c.type === NodeTypes.IF) {
      const branches = (c as unknown as { branches?: Array<{ children: TemplateChildNode[] }> }).branches ?? []
      for (const b of branches) out.push(...flattenChildNodes(b.children))
    } else if (c.type === NodeTypes.FOR) {
      out.push(...flattenChildNodes((c as unknown as { children: TemplateChildNode[] }).children))
    } else {
      out.push(c)
    }
  }
  return out
}

/** 表达式内容（SimpleExpressionNode 才有 content——复合表达式原样跳过） */
function exprContent(exp: unknown): string | null {
  if (exp && typeof exp === 'object' && 'content' in (exp as { content?: unknown }) && typeof (exp as { content: unknown }).content === 'string') {
    return (exp as { content: string }).content
  }
  return null
}

interface BindingAccumulator {
  capabilities: Array<{ name: string; semantic: string }>
  models: Array<{ name: string; expr: string }>
  handlers: Array<{ name: string; target: string }>
}

/** 元素 → 渲染 IR 节点（语义链接 + 属性规范化 + 绑定收集） */
function elementToRenderNode(el: ElementNode, acc: BindingAccumulator): RenderNode {
  const props: Record<string, unknown> = {}
  for (const attr of el.props) {
    if (attr.type === NodeTypes.ATTRIBUTE) {
      const a = attr as AttributeNode
      if (a.name === 'class' || a.name === 'style' || a.name === 'id' || a.name === 'key' || a.name === 'ref') continue // 非约束属性（样式/身份走各自通道）
      props[a.name] = a.value?.content ?? true
      continue
    }
    const d = attr as DirectiveNode
    const arg = d.arg && 'content' in (d.arg as { content?: unknown }) ? (d.arg as { content: string }).content : undefined
    const exp = exprContent(d.exp)
    if (d.name === 'bind') {
      const key = camelize(arg ?? '')
      props[key] = exp !== null ? { expr: exp } : true // 动态绑定标记 { expr }（编译期不求值——G-29 生产端只看结构）
    } else if (d.name === 'on') {
      acc.handlers.push({ name: arg ?? 'tap', target: exp ?? '' })
    } else if (d.name === 'model') {
      acc.models.push({ name: arg ?? 'modelValue', expr: exp ?? '' })
    } else {
      props[`v-${d.name}`] = exp !== null ? exp : true // v-if/v-for 已被摊平；v-html/v-show 等保留可观测标记
    }
  }

  return {
    type: el.tag,
    // ★G-31 语义链接：p-* 标签 → TAG_SEMANTIC_MAP 语义（渲染树 semantic 与 C-IR 树同源）；非 p- → undefined（Layer 1 兼容层）
    semantic: el.tag.startsWith('p-') ? TAG_SEMANTIC_MAP[el.tag] : undefined,
    props,
    children: flattenChildNodes(el.children).filter((c) => c.type === NodeTypes.ELEMENT).map((c) => elementToRenderNode(c as ElementNode, acc)),
    loc: { line: el.loc.start.line, column: el.loc.start.column },
  }
}

/** 属性 → C-IR 约束属性（只留静态字符串 + 动态 { expr }；去掉 v-* 指令标记） */
function pickConstraintProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(props)) {
    if (k.startsWith('v-')) continue
    out[k] = props[k]
  }
  return out
}

/** 渲染树节点 → C-IR（★G-31：p-* 标签 → toComponentIR；非 p-/未知 p- → null——Layer 1 兼容层不产生 C-IR） */
function renderToComponentIR(node: RenderNode): ComponentIR | null {
  if (!node.type.startsWith('p-')) return null
  const children = node.children.map(renderToComponentIR).filter(Boolean) as ComponentIR[]
  return toComponentIR(node.type, pickConstraintProps(node.props), children)
}

/** 模板源码 → { render / semantic / bindings } */
function buildIR(template: string): { render: RenderNode; semantic: { tree: ComponentIR | null; semanticCount: number; compatCount: number }; bindings: BindingIR } {
  const root = domParse(template, { onError: () => undefined })
  const rootEl = flattenChildNodes(root.children).find((c) => c.type === NodeTypes.ELEMENT) as ElementNode | undefined
  if (!rootEl) {
    return {
      render: { type: 'template', props: {}, children: [], loc: { line: 1, column: 1 } },
      semantic: { tree: null, semanticCount: 0, compatCount: 0 },
      bindings: { capabilities: [], models: [], handlers: [] },
    }
  }
  const acc: BindingAccumulator = { capabilities: [], models: [], handlers: [] }
  const render = elementToRenderNode(rootEl, acc)
  // 语义链接登记（render 树 semantic 与 C-IR 同源）：capability.* 入口进 bindings
  const tree = renderToComponentIR(render)
  const semanticCount = tree ? countCIR(tree) : 0
  const compatCount = countCompat(render)
  if (tree) {
    collectCapabilities(tree, acc)
  }
  return { render, semantic: { tree, semanticCount, compatCount }, bindings: acc }
}

function countCIR(node: ComponentIR): number {
  return 1 + node.children.reduce((acc, c) => acc + countCIR(c), 0)
}

/** 兼容层元素计数（渲染树元素无 semantic——view/text/scroll-view 及未知 p- 标签；#text/#interpolation 不计） */
function countCompat(node: RenderNode): number {
  let n = 0
  if (node.type !== '#text' && node.type !== '#interpolation' && node.type !== '#comment' && !node.semantic) n++
  for (const c of node.children) n += countCompat(c)
  return n
}

/** capability.* 语义组件 → bindings.capabilities（G-28 能力调用收集） */
function collectCapabilities(node: ComponentIR, acc: BindingAccumulator): void {
  if (node.semantic.startsWith('capability.')) {
    acc.capabilities.push({ name: node.semantic.slice('capability.'.length), semantic: node.semantic })
  }
  for (const c of node.children) collectCapabilities(c, acc)
}

/** 渲染树 → 结构化 TemplateNode（parse() 的中间产物投影——与 @vue/compiler-dom 解耦） */
function renderToTemplateNode(node: RenderNode): TemplateNode {
  return {
    type: node.type === '#text' ? 'text' : node.type === '#interpolation' ? 'interpolation' : node.type === '#comment' ? 'comment' : 'element',
    tag: node.type,
    props: { ...node.props },
    children: node.children.map(renderToTemplateNode),
    line: node.loc.line,
  }
}

/** NodeBackend：官方 Node 编译器后端（参考实现——conformance 基线） */
export function createNodeCompilerBackend(): ProteusCompilerBackend {
  return {
    id: 'node',
    version: '0.1.0',
    minCompatVersion: 1,
    capabilities: NODE_CAPABILITIES,

    compile(sfc: SFCSource): CompilerIR {
      const { descriptor } = sfcParse(sfc.source, { filename: sfc.filename ?? 'anonymous.vue' })
      const template = descriptor.template?.content ?? ''
      const { render, semantic, bindings } = buildIR(template)
      return { version: 1, render: { root: render }, semantic, bindings }
    },

    parse(template: string): TemplateAST {
      const ir = buildIR(template)
      return { root: renderToTemplateNode(ir.render) }
    },

    generate(ir: CompilerIR) {
      return { code: JSON.stringify(ir, null, 2), warnings: [] }
    },
  }
}