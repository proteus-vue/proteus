// packages/compiler-backend/src/conformance.ts
// ★G-29（compiler-backend-1-plan 02 §5 + 04-ir-contract.md）：CompilerBackend conformance test
//   后端实现者跑 runCompilerConformance(backend) 自检（与 G-27 runBackendConformance 同构）：
//   ① CMP004：版本协商（minCompatVersion / IR version）
//   ② IR 契约合规（CMP002）：render 树 shape + semantic 树与渲染树交叉核对（计数一致）
//   ③ ★G-31.1 语义链接：p-* 标签必须映射到 TAG_SEMANTIC_MAP 语义（渲染树 semantic 字段）
//   ④ capabilities 声明合法 + 可选方法存在时须为函数
//   零运行时依赖（TAG_SEMANTIC_MAP 来自本包已声明的 component-ir 依赖）
import { TAG_SEMANTIC_MAP } from '@proteus-vue/component-ir'
import type { ComponentIR } from '@proteus-vue/component-ir'
import type { CompilerIR, ProteusCompilerBackend, RenderNode } from './spi'

export interface ConformanceCheck {
  name: string
  pass: boolean
  detail?: string
}

export interface ConformanceResult {
  ok: boolean
  checks: ConformanceCheck[]
}

/** 默认 conformance fixture（一份含布局原语 + 兼容层 + 能力入口 + 事件/模型的真实 SFC） */
export const DEFAULT_CONFORMANCE_SFC = `<template>
  <p-stack :gap="12">
    <p-grid :min-col-width="160" :max-cols="4">
      <p-box />
      <view class="compat"></view>
    </p-grid>
    <p-text>{{ title }}</p-text>
    <p-button @click="onSave">保存</p-button>
    <p-input v-model="keyword" />
    <p-scan-qr />
  </p-stack>
</template>`

function walkRender(node: RenderNode, fn: (n: RenderNode) => void): void {
  fn(node)
  for (const c of node.children) walkRender(c, fn)
}

/** C-IR 树节点计数（递归） */
function countCIR(node: ComponentIR): number {
  return 1 + node.children.reduce((acc, c) => acc + countCIR(c), 0)
}

/**
 * CompilerBackend 接口完整性 + IR 产出合规自检
 * - CMP004：minCompatVersion ≠ 1 / IR version ≠ 1 → fail
 * - CMP002：render 树 shape（type/children）+ semantic 计数与渲染树交叉核对 + bindings shape
 * - G-31.1：渲染树中 p-* 元素 semantic 必须 == TAG_SEMANTIC_MAP[type]（语义链接机器验证）
 */
export function runCompilerConformance(backend: ProteusCompilerBackend, fixture = DEFAULT_CONFORMANCE_SFC): ConformanceResult {
  const checks: ConformanceCheck[] = []

  function check(name: string, pass: boolean, detail?: string): void {
    checks.push({ name, pass, detail })
  }

  // 1. 身份声明 + 版本协商（CMP004）
  check('id', typeof backend.id === 'string' && backend.id.length > 0, `id=${String(backend.id)}`)
  check('version', typeof backend.version === 'string' && backend.version.length > 0, `version=${String(backend.version)}`)
  check('minCompatVersion', backend.minCompatVersion === 1, `minCompatVersion=${String(backend.minCompatVersion)}（契约=1，CMP004）`)

  // 2. capabilities 声明合法
  const caps = backend.capabilities
  if (!caps) {
    check('capabilities', false, '缺失 capabilities 声明')
  } else {
    check('capabilities.incremental', typeof caps.incremental === 'boolean', `incremental=${String(caps.incremental)}`)
    check('capabilities.sourceMap', typeof caps.sourceMap === 'boolean', `sourceMap=${String(caps.sourceMap)}`)
    check('capabilities.treeShaking', typeof caps.treeShaking === 'boolean', `treeShaking=${String(caps.treeShaking)}`)
    check('capabilities.wasmRuntime', typeof caps.wasmRuntime === 'boolean', `wasmRuntime=${String(caps.wasmRuntime)}`)
    check('capabilities.plugins', typeof caps.plugins === 'boolean', `plugins=${String(caps.plugins)}`)
    check('capabilities.maxFileSize', typeof caps.maxFileSize === 'number' && caps.maxFileSize > 0, `maxFileSize=${String(caps.maxFileSize)}`)
  }

  // 3. compile 产出合规 IR（CMP002 + G-31.1 语义链接）
  let ir: CompilerIR | null = null
  try {
    ir = backend.compile({ filename: 'conformance.vue', source: fixture })
  } catch (e) {
    check('compile', false, 'compile 抛错: ' + (e as Error).message)
  }
  if (ir) {
    check('ir.version', ir.version === 1, `version=${String(ir.version)}（CMP004）`)

    // render 树 shape + 语义链接（G-31.1）
    let semanticNodes = 0
    let compatElements = 0
    let linkBroken: string[] = []
    try {
      walkRender(ir.render.root, (n) => {
        check(`render.${n.type}`, typeof n.type === 'string' && n.type.length > 0, `type=${n.type}`)
        if (typeof n.type !== 'string' || !Array.isArray(n.children)) {
          return
        }
        if (n.semantic) {
          semanticNodes++
          const expected = n.type.startsWith('p-') ? TAG_SEMANTIC_MAP[n.type] : undefined
          // p-* 必须有语义链接且与参考映射一致；非 p- 元素出现 semantic 视为异常
          if (n.type.startsWith('p-')) {
            if (expected === undefined) {
              linkBroken.push(`${n.type}（TAG_SEMANTIC_MAP 未登记）`)
            } else if (expected !== n.semantic) {
              linkBroken.push(`${n.type}: semantic=${n.semantic} ≠ 期望 ${expected}`)
            }
          } else {
            linkBroken.push(`${n.type}: 非 p- 元素不应携带 semantic`)
          }
        } else if (n.type !== '#text' && n.type !== '#interpolation' && n.type !== '#comment') {
          compatElements++
        }
      })
    } catch (e) {
      check('render.tree', false, 'render 树遍历抛错: ' + (e as Error).message)
    }
    check('render.semanticLink', linkBroken.length === 0, linkBroken.length ? linkBroken.join('; ') : undefined)

    // semantic IR：C-IR 树形状 + 计数交叉核对（渲染树 semantic 节点数 == semanticCount == C-IR 树节点数）
    const sem = ir.semantic
    if (!sem) {
      check('ir.semantic', false, '缺失 semantic IR')
    } else {
      check('ir.semantic.tree', sem.tree === null || (typeof sem.tree.tag === 'string' && typeof sem.tree.semantic === 'string'), sem.tree ? `root=${sem.tree.tag}→${sem.tree.semantic}` : 'tree=null')
      const irCount = sem.tree ? countCIR(sem.tree) : 0
      check('ir.semantic.countMatch', irCount === sem.semanticCount, `C-IR 树 ${irCount} 节点 vs semanticCount=${sem.semanticCount}`)
      check('ir.semantic.renderMatch', sem.semanticCount === semanticNodes, `semanticCount=${sem.semanticCount} vs 渲染树语义节点 ${semanticNodes}`)
      check('ir.semantic.compatCount', sem.compatCount === compatElements, `compatCount=${sem.compatCount} vs 渲染树兼容元素 ${compatElements}`)
    }

    // bindings shape（G-28 消费）
    const b = ir.bindings
    check('bindings.capabilities', Array.isArray(b?.capabilities), undefined)
    check('bindings.models', Array.isArray(b?.models), undefined)
    check('bindings.handlers', Array.isArray(b?.handlers), undefined)
  }

  // 4. parse + generate 可用
  try {
    const ast = backend.parse('<p-grid />')
    check('parse', typeof ast.root === 'object' && ast.root !== null, `root.type=${String(ast?.root?.type)}`)
  } catch (e) {
    check('parse', false, 'parse 抛错: ' + (e as Error).message)
  }
  try {
    if (ir) {
      const gen = backend.generate(ir)
      check('generate', typeof gen.code === 'string' && Array.isArray(gen.warnings), undefined)
    }
  } catch {
    check('generate', false, 'generate 抛错')
  }

  // 5. 可选方法存在时须为函数
  if (backend.hotUpdate !== undefined && typeof backend.hotUpdate !== 'function') check('optional.hotUpdate', false, 'hotUpdate 非函数')
  if (backend.generateSourceMap !== undefined && typeof backend.generateSourceMap !== 'function') check('optional.generateSourceMap', false, 'generateSourceMap 非函数')

  return { ok: checks.every((c) => c.pass), checks }
}