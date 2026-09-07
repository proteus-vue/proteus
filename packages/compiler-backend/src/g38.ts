// packages/compiler-backend/src/g38.ts
// ★G-38（proteus-compiler-backend-spi-plan）B1/B2-Node 参考实现：parse/transform/emit 三阶段 SPI 真落地
//   与 G-29（compiler-backend-1-plan，compile 单入口 → CompilerIR）是两套契约——G-38 是「写编译后端的插头标准」：
//   parse(source,ctx) → ProgramIR（语法树）/ transform(ProgramIR,ctx) → IRModule（语义 IR，含 ComponentIR→G-37 消费）/
//   emit(IRModule,ctx) → CompiledArtifact；+ 生命周期 initialize/dispose + IncrementalSession（真实现，决策 #336——
//   依赖图 + 签名缓存 + 局部重算，见 g38-session.ts）+ reportDiagnostics/getCacheKey/getArtifactHash
//   参考实现基于 @vue/compiler-sfc + @vue/compiler-dom（真实解析，非 runner mock 的正则扫描）+ @proteus-vue/component-ir 语义表
//   类型命名加 G38 前缀（G-29 已占用 ProteusCompilerBackend/CompilerCapabilities——同形不同名，文档 01 §2.1 注记）
//   目标：conformance-runner.js --backend 指向本实现 → 42 项按能力声明 SKIP 合规（决策 #334）
import { parse as sfcParse } from '@vue/compiler-sfc'
import { parse as domParse, NodeTypes } from '@vue/compiler-dom'
import type { AttributeNode, DirectiveNode, ElementNode, TemplateChildNode } from '@vue/compiler-dom'
import { TAG_SEMANTIC_MAP } from '@proteus-vue/component-ir'
import type { ComponentIR } from '@proteus-vue/component-ir'
import { createG38IncrementalSession } from './g38-session'
import type { G38SessionOptions } from './g38-session'

// —— 类型（G-38 01 §2.1/§2.3/§4/§5 同形；命名加前缀防撞 G-29） ——

export interface G38CompilerCapabilities {
  incremental: boolean
  aot: boolean
  sourceMap: boolean
  minify: boolean
  treeShake: boolean
  targetPlatforms: ('web' | 'ios' | 'android' | 'harmony' | 'flutter')[]
  supportedLanguages: ('sfc' | 'tsx' | 'jsx' | 'vue')[]
  backend: 'native' | 'wasm' | 'js'
  deterministic: boolean
}

export interface G38SourceFile {
  path?: string
  content: string
}

export interface G38SourceLoc {
  line: number
  column: number
}

export interface G38Diagnostic {
  code: string
  message: string
  loc: G38SourceLoc
  severity?: 'error' | 'warning'
}

export interface G38ElementNode {
  kind: 'element'
  tag: string
  attributes: Record<string, unknown>
  children: G38ElementNode[]
  loc: G38SourceLoc
}

export interface G38ProgramIR {
  nodes: G38ElementNode[]
  diagnostics: G38Diagnostic[]
}

export interface G38ImportNode {
  source: string
  imported: string
}

export interface G38CapabilityNode {
  name: string
  semantic: string
}

export interface G38ModuleMetadata {
  semanticCount: number
  compatCount: number
  componentCount: number
}

export interface G38IRModule {
  readonly id: string
  readonly imports: G38ImportNode[]
  /** ★语义组件树（ComponentIR——G-31 C-IR 同构，直接交 G-37 RenderBackend 消费） */
  readonly components: ComponentIR[]
  readonly capabilities: G38CapabilityNode[]
  readonly metadata: G38ModuleMetadata
}

export interface G38CompiledArtifact {
  code: string
  map: unknown
  hash: string
}

export interface G38IRModuleDiff {
  changed: string[]
  removed: string[]
  added: string[]
  affectedFiles: string[]
}

export interface G38IncrementalSession {
  readonly id: string
  invalidate(file: string): void
  invalidateAll(): void
  recompute(): G38IRModuleDiff
  getDependencies(file: string): string[]
  getDependents(file: string): string[]
  commit(): void
  rollback(): void
  getStats(): Record<string, unknown>
  dispose(): void
  /** ★宿主驱动扩展（04-incremental-compilation：首次全量构建逐文件注册——非规范必需方法） */
  track?(file: string, content: string, deps?: string[]): void
}

export interface G38CompilerContext {
  cacheDir?: string
}

export interface G38ParseContext {
  filename?: string
}

export interface G38TransformContext {
  filename?: string
}

export interface G38EmitContext {
  format?: 'bundle' | 'ir-json' | 'list'
}

/** ★G-38 编译后端 SPI（01 §2.1 同形）——任何合规后端必须实现全部方法 */
export interface G38CompilerBackend {
  readonly id: string
  readonly version: string
  readonly capabilities: G38CompilerCapabilities
  initialize(ctx?: G38CompilerContext): Promise<void>
  dispose(): void
  parse(source: G38SourceFile, ctx?: G38ParseContext): G38ProgramIR
  transform(ast: G38ProgramIR, ctx?: G38TransformContext): G38IRModule
  emit(module: G38IRModule, ctx?: G38EmitContext): G38CompiledArtifact
  createIncrementalSession(cacheDir: string, opts?: G38SessionOptions): G38IncrementalSession
  reportDiagnostics(module: G38IRModule): G38Diagnostic[]
  getCacheKey(input: G38SourceFile): string
  getArtifactHash(artifact: G38CompiledArtifact): string
}

// —— 工具 ——

/** djb2 哈希（与 conformance-runner.js 同算法——产物 hash 可交叉比对） */
export function g38Hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

function camelize(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** 表达式内容（SimpleExpressionNode 才含 content） */
function exprContent(exp: unknown): string | null {
  if (exp && typeof exp === 'object' && 'content' in (exp as { content?: unknown }) && typeof (exp as { content: unknown }).content === 'string') {
    return (exp as { content: string }).content
  }
  return null
}

/** 摊平 IF/FOR 指令容器（与 G-29 flatten 同语义——B1 不展开条件/循环） */
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

/** compiler-dom 元素 → G38ElementNode（静态/绑定属性规范化 + loc 保留——C-03-04） */
function elementToG38(el: ElementNode, diagnostics: G38Diagnostic[]): G38ElementNode {
  const attributes: Record<string, unknown> = {}
  for (const attr of el.props) {
    if (attr.type === NodeTypes.ATTRIBUTE) {
      const a = attr as AttributeNode
      if (a.name === 'class' || a.name === 'style' || a.name === 'id' || a.name === 'key' || a.name === 'ref') continue
      attributes[a.name] = a.value?.content ?? true
      continue
    }
    const d = attr as DirectiveNode
    const arg = d.arg && 'content' in (d.arg as { content?: unknown }) ? (d.arg as { content: string }).content : undefined
    const exp = exprContent(d.exp)
    if (d.name === 'bind') {
      attributes[camelize(arg ?? '')] = exp !== null ? { expr: exp } : true
    } else if (d.name === 'model' || d.name === 'on' || d.name === 'slot') {
      // v-model/@handler/插槽指令不落 attributes（语义面无意义；绑定收集属 transform 后续批次）
      continue
    } else {
      attributes[`v-${d.name}`] = exp !== null ? exp : true
    }
  }
  // onError 诊断（缺闭合等）在 parse 顶层收集——此处不重复
  void diagnostics
  return {
    kind: 'element',
    tag: el.tag,
    attributes,
    children: flattenChildNodes(el.children)
      .filter((c) => c.type === NodeTypes.ELEMENT)
      .map((c) => elementToG38(c as ElementNode, diagnostics)),
    loc: { line: el.loc.start.line, column: el.loc.start.column },
  }
}

/** SFC/模板源码 → G38ProgramIR（语法错误 → diagnostics，不抛——C-03-03/CMP033） */
function parseToProgram(source: G38SourceFile): G38ProgramIR {
  const diagnostics: G38Diagnostic[] = []
  let template = ''
  // ★SFC 判定：<template>/<script> 顶层（前导注释容忍）→ sfcParse 取模板块；否则为裸模板片段（conformance 测试直接喂 <p-grid>…）
  const head = source.content.trimStart()
  const looksLikeSfc = /^(?:<!--[\s\S]*?-->\s*)*<(?:template|script)\b/.test(head)
  if (!looksLikeSfc) {
    template = source.content
  } else {
    try {
      const { descriptor, errors } = sfcParse(source.content, { filename: source.path ?? 'anonymous.vue' })
      for (const e of errors) {
        diagnostics.push({ code: 'sfc-parse', message: e.message, loc: { line: 0, column: 0 }, severity: 'error' })
      }
      template = descriptor.template?.content ?? ''
      if (!descriptor.template && (descriptor.script || descriptor.scriptSetup)) {
        diagnostics.push({ code: 'no-template', message: 'SFC 缺少 <template> 块', loc: { line: 0, column: 0 }, severity: 'warning' })
      }
    } catch {
      template = source.content // sfc 解析异常 → 兜底按模板解析
    }
  }
  const root = domParse(template, {
    onError: (e) => {
      diagnostics.push({
        code: `template-${e.code}`,
        message: e.message,
        loc: { line: e.loc?.start.line ?? 0, column: e.loc?.start.column ?? 0 },
        severity: 'error',
      })
    },
  })
  const nodes = flattenChildNodes(root.children)
    .filter((c) => c.type === NodeTypes.ELEMENT)
    .map((c) => elementToG38(c as ElementNode, diagnostics))
  return { nodes, diagnostics }
}

/** 语义链接（p-* → TAG_SEMANTIC_MAP）递归 → ComponentIR（兼容层/未知 p- 不产语义节点——G-31.1/C-IR 同构） */
function toComponentIRNode(el: G38ElementNode): ComponentIR | null {
  if (!el.tag.startsWith('p-')) return null
  const semantic = TAG_SEMANTIC_MAP[el.tag]
  if (!semantic) return null // 未知 p- 标签不臆造语义
  const children: ComponentIR[] = []
  for (const c of el.children) {
    const ci = toComponentIRNode(c)
    if (ci) children.push(ci)
  }
  // 约束属性：静态字符串 + 动态 { expr }；v-* 指令标记不入约束（与 G-29 pickConstraintProps 同）
  const props: Record<string, unknown> = {}
  for (const k of Object.keys(el.attributes)) {
    if (k.startsWith('v-')) continue
    props[k] = el.attributes[k]
  }
  return { tag: el.tag, semantic, props, children }
}

/** ComponentIR 子树节点计数（metadata.semanticCount） */
function countComponentNodes(c: ComponentIR): number {
  return 1 + c.children.reduce((n, ch) => n + countComponentNodes(ch), 0)
}

/** ★createG38NodeBackend：Node 参考实现（G-38 01 §2.1 全部 16 方法） */
export function createG38NodeBackend(): G38CompilerBackend {
  let initialized = false

  const backend: G38CompilerBackend = {
    id: 'node',
    version: '0.1.0',
    capabilities: {
      incremental: true, // ★决策 #336：真增量会话（g38-session.ts——依赖图+签名缓存+局部重算）
      aot: false,
      sourceMap: false,
      minify: false,
      treeShake: false,
      targetPlatforms: ['web'],
      supportedLanguages: ['sfc', 'vue'],
      backend: 'js',
      deterministic: true,
    },

    async initialize() {
      // 幂等（C-02-03）
      initialized = true
    },
    dispose() {
      initialized = false
    },

    parse(source, ctx) {
      if (ctx?.filename?.endsWith('.tsx') || ctx?.filename?.endsWith('.jsx')) {
        // 超出能力声明 → 明确报错（C-03-05：不静默）
        throw new Error(`G-38 parse：不支持语言 ${ctx.filename}（capabilities.supportedLanguages=['sfc','vue']——TSX/JSX 属 swc/oxc 生态后端）`)
      }
      return parseToProgram(source)
    },

    transform(ast) {
      // ★语义收集：模板内每棵「p-* 语义根」子树 → 一个 ComponentIR（兼容层容器 view/div 内的 p-* 也收——
      //   G-38 语义是「模板内全部语义组件清单」；语义子树内部嵌套语义已递归入树，不再下钻）
      const components: ComponentIR[] = []
      const capabilities: G38CapabilityNode[] = []
      const collectCap = (c: ComponentIR): void => {
        if (c.semantic.startsWith('capability.')) capabilities.push({ name: c.semantic.slice('capability.'.length), semantic: c.semantic })
        for (const ch of c.children) collectCap(ch)
      }
      const semanticOf = (tag: string): string | undefined => (tag.startsWith('p-') ? TAG_SEMANTIC_MAP[tag] : undefined)
      const collect = (el: G38ElementNode): void => {
        if (semanticOf(el.tag)) {
          const ci = toComponentIRNode(el)
          if (ci) {
            components.push(ci)
            collectCap(ci)
          }
          return // 语义子树整体已入树（内部兼容层不另收）
        }
        for (const c of el.children) collect(c)
      }
      for (const el of ast.nodes) collect(el)
      // 兼容层计数（无语义元素总数——含未知 p-；从顶层一次性递归，与 G-29 countCompat 同语义）
      const countCompatOf = (el: G38ElementNode): number => {
        let n = semanticOf(el.tag) ? 0 : 1
        for (const c of el.children) n += countCompatOf(c)
        return n
      }
      const compatCount = ast.nodes.reduce((n, el) => n + countCompatOf(el), 0)
      const semanticCount = components.reduce((n, c) => n + countComponentNodes(c), 0)
      return {
        id: `m-${ast.nodes.map((n) => n.tag).join('-') || 'empty'}`,
        imports: [],
        components,
        capabilities,
        metadata: { semanticCount, compatCount, componentCount: components.length },
      }
    },

    emit(module, ctx) {
      const format = ctx?.format ?? 'list'
      let code: string
      if (format === 'ir-json') {
        code = JSON.stringify(module.components, null, 2)
      } else if (format === 'bundle') {
        code = `/* proteus g38 bundle */\n${module.components.map((c) => `create('${c.semantic}')`).join('\n')}`
      } else {
        code = module.components.map((c) => `├─ ${c.semantic}（${c.tag}）`).join('\n')
      }
      return { code, map: null, hash: g38Hash(code) }
    },

    createIncrementalSession(cacheDir, opts) {
      // ★决策 #336：真增量会话（依赖图 + 签名缓存 + invalidate/recompute 局部重算 + commit/rollback 快照；opts.getContent 宿主注入）
      return createG38IncrementalSession(backend, cacheDir, opts)
    },

    reportDiagnostics(module) {
      // parse 期诊断已入 ProgramIR.diagnostics；模块级诊断后续批次
      void module
      return []
    },

    getCacheKey(input) {
      // 01 §5.3：cacheKey = hash(source) + hash(backendVersion)（transformOptions 后续接入）
      return g38Hash(`${input.content}|${backend.version}`)
    },
    getArtifactHash(artifact) {
      return artifact.hash ?? g38Hash(artifact.code ?? '')
    },
  }
  return backend
}
