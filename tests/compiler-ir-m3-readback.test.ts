// tests/compiler-ir-m3-readback.test.ts
// ★#505 M3 批 7：六端矩阵按 semanticForest 逐根 readback——M3 收口「修一次、多端一次过」的最后一段
// 背景：六端矩阵（component-conformance）此前只吃 fixture C-IR（toComponentIR/toComponentTree 手写）——
//   真实主编译页面（compat 根）的语义内容进不了矩阵。D6（批 6）后 CompilerIR.semantic.forest =
//   顶层语义根（C-IR 子树）平铺，本测试把 **84 个真实 .vue** 的 forest 逐根喂六后端
//   renderComponentSnapshot + checkComponentSnapshot：
//   - implemented 语义控件映射与 SEMANTIC_BACKEND_MAP 参考表一致（真机级矩阵门禁对真实产物生效）
//   - planned/未知语义/缺后端列 → unverified 不阻断（既有 G-24.2 不臆造门禁）
//   - 真实产物语义被后端「消费 semantic 而非 tag」的机器验证（G-31.1 readback 端）
// @vitest-environment happy-dom（VueDomBackend DOM 断言）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createNodeCompilerBackend } from '@proteus-vue/compiler-backend'
import {
  createVueDomBackend,
  createNativeBackend,
  createFlutterBackend,
  createHeadlessBackend,
  renderComponentSnapshot,
  createControlReader,
} from '@proteus-vue/render-backend'
import { checkComponentSnapshot, TAG_SEMANTIC_MAP, toComponentIR } from '@proteus-vue/component-ir'
import type { IRNode, ProteusRenderBackend } from '@proteus-vue/render-backend'

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

function buildBackends(): Array<{ id: string; backend: ProteusRenderBackend }> {
  return [
    { id: 'vue-dom', backend: createVueDomBackend(document) },
    { id: 'native-ios', backend: createNativeBackend(undefined, 'ios') },
    { id: 'native-android', backend: createNativeBackend(undefined, 'android') },
    { id: 'native-harmony', backend: createNativeBackend(undefined, 'harmony') },
    { id: 'flutter', backend: createFlutterBackend() },
    { id: 'headless', backend: createHeadlessBackend() },
  ]
}

describe('★#505 M3 门禁⑨：真实文件 semanticForest × 六端矩阵 readback（M3 收口——语义缺口修复用例进矩阵）', () => {
  it('84 真实 .vue：forest 逐根 × 六后端 → 控件映射与参考表一致（零 error；unverified 放行不阻断）', () => {
    const backends = buildBackends()
    const failures: Array<{ file: string; root: string; backend: string; error: string }> = []
    let unverifiedTotal = 0
    let readbackCount = 0
    for (const file of FILES) {
      const rel = path.relative(REPO_ROOT, file)
      const source = fs.readFileSync(file, 'utf-8')
      const ir = createNodeCompilerBackend().compile({ filename: file, source })
      const forest = (ir.semantic as { forest?: Array<{ tag?: string; semantic: string; children?: unknown[] }> }).forest ?? []
      for (const root of forest) {
        for (const { id, backend } of backends) {
          const snap = renderComponentSnapshot(backend, root as unknown as IRNode, createControlReader(id))
          const result = checkComponentSnapshot(id, snap)
          readbackCount++
          unverifiedTotal += result.unverified.length
          for (const e of result.errors) {
            failures.push({ file: rel, root: root.semantic, backend: id, error: `${e.semantic} → 期望 ${e.expected} 实得 ${e.actual}` })
          }
        }
      }
    }
    // 矩阵确实吃到了真实语义内容（防门禁自身退化——forest 全空则本测试空转）
    expect(readbackCount).toBeGreaterThan(100)
    expect(failures, `真实产物语义 × 六端控件映射漂移：\n${failures.map((f) => `  ${f.file} ${f.root} @${f.backend}: ${f.error}`).join('\n')}`).toEqual([])
  })

  it('SSOT 穷举：TAG_SEMANTIC_MAP 全部 p-* 标签 × 六后端 readback 与参考表一致（不依赖真实文件是否用到——后端内部映射/参考表任一侧漂移即红）', () => {
    const backends = buildBackends()
    const failures: Array<{ tag: string; semantic: string; backend: string; error: string }> = []
    let checked = 0
    for (const [tag, semantic] of Object.entries(TAG_SEMANTIC_MAP)) {
      if (!tag.startsWith('p-')) continue // router-link 等别名键无元素形态
      const ir = toComponentIR(tag, {}, [])
      if (!ir) continue
      for (const { id, backend } of backends) {
        const snap = renderComponentSnapshot(backend, ir as unknown as IRNode, createControlReader(id))
        const result = checkComponentSnapshot(id, snap)
        checked++
        for (const e of result.errors) {
          failures.push({ tag, semantic, backend: id, error: `${e.semantic} → 期望 ${e.expected} 实得 ${e.actual}` })
        }
      }
    }
    expect(checked).toBeGreaterThan(300) // 64 p-* × 6 后端（防门禁自身退化）
    expect(failures, `参考表 vs 后端内部映射漂移：\n${failures.map((f) => `  <${f.tag}> ${f.semantic} @${f.backend}: ${f.error}`).join('\n')}`).toEqual([])
  })
})
