// tests/compiler-ir-m3.test.ts
// ★#505 M3：conformance 对准真实产物——主编译语义声明 ↔ CompilerIR 语义树 ↔ 平台语义注册表的机器通道
// 草案 docs/compiler-ir-contract-draft.md §4.4/§6 M3
// 审计取证 #④（最致命断裂）：compileVueSfc 不 import 任何 IR 包、compiler-backend conformance 用
//   fixture 自测自——「修一次多端受益」无机器通道。M3 通道 = 同一份真实 .vue 跑双管线交叉对齐：
//   ① 主编译（compileVueSfc → CompileIR 语义声明快照 result.ir）
//   ② 旁路后端（NodeBackend → CompilerIR：render 树语义链接 + semantic 计数）
//   ③ 交叉不变量（真实产物全量，探针实证 84 文件零冲突后固化为门禁）：
//     R1 语义链接无残留：每个 p-* 元素 semantic === TAG_SEMANTIC_MAP[type]，无「p-* 存在但空白」
//     R2 v-model 绑定字段集合一致：main(vModelTargets ∪ handler.models) == backend(bindings.models[].expr)
//     R3 p-grid 语义元素数一致：main(semanticGrids.length) == backend(render 树 layout.grid 数)
//   ④ conformance 收紧：compat 根页面语义计数如实（view 壳 + 嵌套 p-* 不再整树空白）；
//      p-* 未登记（语义空白）在 runCompilerConformance 显式失败而非静默计入 compat
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'
import { createNodeCompilerBackend, runCompilerConformance } from '@proteus-vue/compiler-backend'
import { TAG_SEMANTIC_MAP } from '@proteus-vue/component-ir'

const REPO_ROOT = path.resolve('.')
const WALK_ROOTS = [path.resolve('examples/pages'), path.resolve('examples/subpackages'), path.resolve('src/components')]

function walkVue(dir: string, acc: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walkVue(p, acc)
    else if (f.endsWith('.vue')) acc.push(p)
  }
  return acc
}

const FILES = WALK_ROOTS.reduce((acc, root) => walkVue(root, acc), [] as string[])

function walkRender(node: { type?: string; semantic?: string; children?: unknown[] }, fn: (n: { type?: string; semantic?: string; children?: unknown[] }) => void): void {
  fn(node)
  for (const c of (node.children ?? []) as Array<{ type?: string; semantic?: string; children?: unknown[] }>) walkRender(c, fn)
}

/** R1：渲染树语义链接残留扫描——p-* 必须 exact 映射；无「p-* 存在但空白」；非 p- 元素不得携带 semantic */
function semanticResidue(renderRoot: { type?: string; semantic?: string; children?: unknown[] }): string[] {
  const residue: string[] = []
  walkRender(renderRoot, (n) => {
    if (!n.type || n.type.startsWith('#')) return
    const isP = n.type.startsWith('p-')
    if (n.semantic) {
      if (!isP) {
        residue.push(`${n.type}: 非 p- 元素携带 semantic=${n.semantic}`)
      } else if (TAG_SEMANTIC_MAP[n.type] !== n.semantic) {
        residue.push(`${n.type}: semantic=${n.semantic} ≠ TAG_SEMANTIC_MAP=${TAG_SEMANTIC_MAP[n.type] ?? '未登记'}`)
      }
    } else if (isP) {
      residue.push(`${n.type}: p-* 无 semantic（TAG_SEMANTIC_MAP 未登记——编译产物语义空白）`)
    }
  })
  return residue
}

/** R2：v-model 绑定字段差集（main 声明侧 vs 旁路 models 收集侧——同一 AST 两侧必须一致） */
function vmodelFieldDiff(mainFields: string[], backendExprs: string[]): string[] {
  const main = new Set(mainFields)
  const back = new Set(backendExprs)
  const onlyMain = [...main].filter((f) => !back.has(f))
  const onlyBack = [...back].filter((f) => !main.has(f))
  return [...onlyMain.map((f) => `main-only: ${f}`), ...onlyBack.map((f) => `backend-only: ${f}`)]
}

/** R3：p-grid 语义元素数差（main semanticGrids 声明 vs 旁路 layout.grid 节点） */
function gridCountDiff(mainGridCount: number, backendGridCount: number): string | null {
  return mainGridCount === backendGridCount ? null : `main semanticGrids=${mainGridCount} vs backend layout.grid=${backendGridCount}`
}

/** 主编译语义声明字段（R2 左侧） */
function mainVmodelFields(ir: NonNullable<ReturnType<typeof compileVueSfc>['ir']>): string[] {
  return [...ir.template.vModelTargets, ...ir.template.vModelComponentHandlers.map((h) => h.model)]
}

describe('★#505 M3 门禁①：真实文件 × 双管线交叉对齐（编译语义 ↔ 语义树——审计断裂 #④ 的机器通道）', () => {
  const backend = createNodeCompilerBackend()
  for (const file of FILES) {
    const rel = path.relative(REPO_ROOT, file)
    it(rel, () => {
      const source = fs.readFileSync(file, 'utf-8')
      const isComponent = rel.includes('src/components')
      // ① 主编译（真实产物 + CompileIR 语义声明快照）
      const main = compileVueSfc(source, { filename: file, isComponent })
      expect(main.ir, 'M1 快照必须附着').toBeDefined()
      expect(main.ir?.version).toBe(1)
      // ② 旁路后端（render 树语义链接 + semantic 计数）
      const back = backend.compile({ filename: file, source })
      // R1：语义链接无残留（无 p-* 空白 / 无漂移 / 非 p- 不携带语义）
      expect(semanticResidue(back.render.root as never)).toEqual([])
      // R2：v-model 绑定字段一致（main 与 backend 对同一 AST 的 v-model 契约感知一致）
      expect(vmodelFieldDiff(mainVmodelFields(main.ir!), back.bindings.models.map((m) => m.expr))).toEqual([])
      // R3：p-grid 语义元素数一致（main 编译期档位声明数 == 旁路 layout.grid 节点数）
      const gridNodes = (() => {
        let n = 0
        walkRender(back.render.root as never, (nd) => {
          if (nd.semantic === 'layout.grid') n++
        })
        return n
      })()
      expect(gridCountDiff(main.ir!.template.semanticGrids.length, gridNodes)).toBeNull()
    })
  }
})

describe('★#505 M3 门禁②：语义计数口径——compat 根页面的嵌套 p-* 语义如实计入（此前整树空白）', () => {
  it('view 壳根 + 嵌套 p-grid/p-text → tree=null 但 semanticCount=4、compatCount=1、renderMatch 自洽', () => {
    const back = createNodeCompilerBackend().compile({
      filename: 'pages/m3page.vue',
      source: `<template>
  <view class="page">
    <p-grid :min-col-width="160" :gap="12"><p-box /><p-box /></p-grid>
    <p-text>{{ t }}</p-text>
  </view>
</template>`,
    })
    const sem = back.semantic
    // C-IR 树：compat 根不产生单根语义树（诚实——页级语义以渲染树 + 计数为准）
    expect(sem.tree).toBeNull()
    expect(sem.compatCount).toBe(1) // view 壳
    expect(sem.semanticCount).toBe(4) // p-grid + p-box×2 + p-text——全树语义如实
    // renderMatch 自洽：渲染树 semantic 节点数 == semanticCount（conformance 交叉核对口径）
    let renderSem = 0
    walkRender(back.render.root as never, (n) => {
      if (n.semantic) renderSem++
    })
    expect(renderSem).toBe(4)
    // 语义链接不因 compat 根而丢失（嵌套 p-* 逐节点链接）
    expect(semanticResidue(back.render.root as never)).toEqual([])
  })

  it('compat 根 + 已知语义的页面形态经 runCompilerConformance 全过（真实页面形状进 conformance fixture）', () => {
    const result = runCompilerConformance(
      createNodeCompilerBackend(),
      '<template><view class="page"><p-grid :min-col-width="160" :gap="12"><p-box /></p-grid><p-text>hi</p-text></view></template>',
    )
    expect(result.ok, JSON.stringify(result.checks.filter((c) => !c.pass), null, 2)).toBe(true)
    expect(result.checks.find((c) => c.name === 'ir.semantic.countMatch')?.pass).toBe(true)
    expect(result.checks.find((c) => c.name === 'ir.semantic.unrooted')?.pass).toBe(true)
  })
})

describe('★#505 M3 门禁③：conformance 收紧——「p-* 存在但空白」（未登记）显式失败而非静默兼容层', () => {
  it('未知 p-*（p-gride 拼写错误形态）→ render.semanticLink 失败并指明语义空白', () => {
    const result = runCompilerConformance(createNodeCompilerBackend(), '<template><view><p-gride /></view></template>')
    expect(result.ok).toBe(false)
    const link = result.checks.find((c) => c.name === 'render.semanticLink')
    expect(link?.pass).toBe(false)
    expect(link?.detail).toContain('p-gride')
    expect(link?.detail).toContain('语义空白')
  })

  it('语义漂移（p-grid 被编成 layout.stack）→ 失败（G-31.1 既有语义链接门禁回归锚点）', () => {
    const drifted = {
      ...createNodeCompilerBackend(),
      compile: () => ({
        version: 1 as const,
        render: {
          root: {
            type: 'p-grid',
            semantic: 'layout.stack',
            props: {},
            children: [] as never[],
            loc: { line: 1, column: 1 },
          },
        },
        semantic: { tree: null, semanticCount: 1, compatCount: 0 },
        bindings: { capabilities: [], models: [], handlers: [] },
      }),
    }
    const result = runCompilerConformance(drifted)
    expect(result.ok).toBe(false)
    expect(result.checks.find((c) => c.name === 'render.semanticLink')?.detail).toContain('layout.grid')
  })
})

describe('★#505 M3 门禁⑤：主编译未知 p-* 反黑盒——p-* 语义空白收紧同源带到主编译产物侧', () => {
  const opts = { px2rpx: true, rpxRatio: 2 }
  it('未登记 p-*（拼写错误形态 p-gride）→ 编译警告（原样输出但显式提示，不再静默）', () => {
    const r = compileVueSfc('<template><view><p-gride @click="go">x</p-gride></view></template>', { filename: 'pages/m3unknown.vue', ...opts })
    expect(r.warnings.some((w) => w.includes('p-gride') && w.includes('TAG_SEMANTIC_MAP'))).toBe(true)
    // 产物不被破坏（仍按未注册自定义组件原样输出——逃生舱不变），警告让使用者知晓
    expect(r.wxml).toContain('<p-gride')
  })
  it('登记过的 p-*（p-grid 语义编译 + p-stack 组件）→ 零未知 p-* 警告（不误报）', () => {
    const r = compileVueSfc('<template><p-stack><p-grid :min-col-width="160" :gap="12"><p-box /></p-grid></p-stack></template>', { filename: 'pages/m3known.vue', ...opts })
    expect(r.warnings.some((w) => w.includes('语义登记表'))).toBe(false)
  })
  it('禁用 tag/unknown-p-star → 无警告（退旧行为；逃生舱留给用户决策）', () => {
    const r = compileVueSfc('<template><view><p-gride>x</p-gride></view></template>', { filename: 'pages/m3off.vue', ...opts, rules: { disabled: ['tag/unknown-p-star'] } })
    expect(r.warnings.some((w) => w.includes('p-gride') && w.includes('TAG_SEMANTIC_MAP'))).toBe(false)
  })
  it('config customTags 映射显式覆盖的 p-*（用户自定义逃生舱）→ 不警告', () => {
    const r = compileVueSfc('<template><view><p-foo>自定义</p-foo></view></template>', { filename: 'pages/m3override.vue', ...opts, rules: { customTags: { 'p-foo': 'view' } } })
    expect(r.warnings.some((w) => w.includes('p-foo') && w.includes('TAG_SEMANTIC_MAP'))).toBe(false)
    expect(r.wxml).toContain('<view')
  })
})

describe('★#505 M3 门禁⑥：fluid/semantic-grid 禁用整体回退——消除 template 照常编译但 script 不注入默认档的半失效产物', () => {
  const opts = { px2rpx: true, rpxRatio: 2 }
  const SRC = '<template><view class="page"><p-grid :min-col-width="160" :gap="12"><view class="cell" /></p-grid></view></template>'
  it('规则启用：页面 p-grid → 容器 flex 语义编译（wxml 无 <p-grid 字面标签、无 pgridStyle 悬空引用）+ IR 声明 semanticGrids', () => {
    const r = compileVueSfc(SRC, { filename: 'pages/m3grid-on.vue', ...opts })
    expect(r.wxml).not.toContain('<p-grid')
    expect(r.wxml).toContain('class="p-grid"')
    expect(r.ir?.template.semanticGrids.length).toBe(1)
    expect(r.warnings.some((w) => w.includes('fluid/semantic-grid 已被禁用'))).toBe(false)
  })
  it('禁用：显式警告 + 回退运行时组件（产物保留 <p-grid> 标签，供 gen-routes 注册）；IR 无 semanticGrids（无半失效 {{pgridStyleN}}）', () => {
    const r = compileVueSfc(SRC, { filename: 'pages/m3grid-off.vue', ...opts, rules: { disabled: ['fluid/semantic-grid'] } })
    expect(r.warnings.some((w) => w.includes('fluid/semantic-grid 已被禁用') && w.includes('回退运行时组件'))).toBe(true)
    expect(r.wxml).toContain('<p-grid')
    expect(r.ir?.template.semanticGrids).toEqual([])
    expect(r.js).not.toContain('pgridStyle')
  })
})

describe('★#505 M3 门禁④：交叉通道负面护栏——规则被删/禁用 → R2 红（语义缺口经真实产物矩阵暴露，非仅 fixture）', () => {
  const SRC = '<script setup lang="ts">import { ref } from "vue"\nconst keyword = ref("")</script>\n<template><input v-model="keyword" /></template>'
  const back = createNodeCompilerBackend()

  it('v-model 规则启用：main 与 backend 字段一致（通道正面）', () => {
    const main = compileVueSfc(SRC, { filename: 'pages/m3neg.vue', px2rpx: true, rpxRatio: 2 })
    expect(main.ir?.template.vModelTargets).toEqual(['keyword'])
    expect(vmodelFieldDiff(mainVmodelFields(main.ir!), back.compile({ filename: 'pages/m3neg.vue', source: SRC }).bindings.models.map((m) => m.expr))).toEqual([])
  })

  it('禁用 directive/v-model → main 声明消失而 AST 仍含 v-model → R2 差集非空（删规则即红——回到 #500 无绑定缺陷形态）', () => {
    const disabled = compileVueSfc(SRC, { filename: 'pages/m3neg.vue', px2rpx: true, rpxRatio: 2, rules: { disabled: ['directive/v-model'] } })
    expect(disabled.ir?.template.vModelTargets).toEqual([])
    // 旁路后端不受规则影响（同一 AST 依旧收集到 keyword）→ 主编译侧语义丢失被通道捕获
    const diff = vmodelFieldDiff(mainVmodelFields(disabled.ir!), back.compile({ filename: 'pages/m3neg.vue', source: SRC }).bindings.models.map((m) => m.expr))
    expect(diff).toContain('backend-only: keyword')
  })
})
