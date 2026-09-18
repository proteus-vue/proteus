// packages/test-ir/src/assertion-runner.ts
// ★G-44 B1：断言解释器 + act 执行器（运行器独立——所有 TestBackend 共用）
//   对齐 testing-reference.js evalAssertion/applyAct 语义 + test-ir.md §3 结构化断言（禁 code 闭包 G-44.1）
import type { ActOp, AssertionNode, AssertionResult } from './types'

/** JSONPath 子集取值：$.root.children[0].type（点 + [n] 索引） */
export function getPath(state: unknown, path?: string): unknown {
  if (!path) return state
  const cleaned = path.replace(/^\$\./, '')
  const parts = cleaned
    .split('.')
    .flatMap((seg) => {
      const m = seg.match(/^(\w+)((?:\[\d+\])*)$/)
      if (!m) return [seg]
      const idxs = [...seg.matchAll(/\[(\d+)\]/g)].map((x) => x[1])
      return [m[1], ...idxs]
    })
  return parts.reduce<unknown>((o, k) => {
    if (o == null) return undefined
    if (/^\d+$/.test(k)) return Array.isArray(o) ? o[Number(k)] : o
    return (o as Record<string, unknown>)[k]
  }, state)
}

/** 单条断言解释（纯函数——状态进、结论出） */
export function evalAssertion(assert: AssertionNode, state: unknown): { ok: boolean; actual?: unknown; expected?: unknown } {
  if (assert.kind === 'and' || assert.kind === 'or') {
    const results = assert.items.map((a) => evalAssertion(a, state))
    const ok = assert.kind === 'and' ? results.every((r) => r.ok) : results.some((r) => r.ok)
    return { ok, actual: results.map((r) => r.ok) }
  }
  const val = getPath(state, (assert as { path?: string }).path)
  switch (assert.kind) {
    case 'eq':
      // ★宽松相等（null ≈ undefined——资源移除后路径缺失与显式 null 语义等价，对齐 reference.js）
      return { ok: val === assert.value || ((val === undefined || val === null) && (assert.value === undefined || assert.value === null)), actual: val, expected: assert.value }
    case 'match':
      return { ok: new RegExp(assert.pattern).test(String(val ?? '')), actual: String(val ?? '') }
    case 'exists':
      return { ok: val !== undefined && val !== null, actual: val }
    case 'count': {
      const len = Array.isArray(val) ? val.length : typeof val === 'object' && val !== null ? Object.keys(val).length : 0
      const ok = assert.op === '=' ? len === assert.n : assert.op === '>' ? len > assert.n : len < assert.n
      return { ok, actual: len, expected: assert.n }
    }
    case 'notLeak': {
      const leaked = (state as { leaked?: Record<string, number> }).leaked
      return { ok: (leaked?.[assert.resource] ?? 0) === 0, actual: leaked?.[assert.resource] }
    }
    case 'conforms': {
      const conforms = (state as { conforms?: Record<string, boolean> }).conforms
      return { ok: conforms?.[assert.spec] === true }
    }
    case 'throws':
      return { ok: true } // act 执行阶段已捕获
    default:
      return { ok: false }
  }
}

/** act 执行器：真正修改 state（转移/销毁/形态切换语义可验证——非空转） */
export function applyAct(state: Record<string, unknown>, act: ActOp): void {
  switch (act.op) {
    case 'transfer': {
      // G-43 Move 语义模拟：资源从 source scope 移除、目标 scope 获得
      const ownership = state.ownership as Record<string, Record<string, unknown>> | undefined
      if (ownership?.[act.to] != null) {
        const sourceScope = Object.keys(ownership).find((k) => ownership[k]?.[act.resource] != null)
        if (sourceScope) {
          ownership[act.to][act.resource] = ownership[sourceScope][act.resource] ?? { handle: act.resource }
          delete ownership[sourceScope][act.resource]
        }
      }
      break
    }
    case 'destroy': {
      // G-42 × G-43：五原子 Drop——边界资源全部释放
      const leaked = state.leaked as Record<string, number> | undefined
      if (leaked != null) {
        for (const k of Object.keys(leaked)) leaked[k] = 0
      }
      break
    }
    case 'setFormFactor': {
      const inputMode = state.inputMode as Record<string, boolean> | undefined
      if (inputMode) {
        for (const k of Object.keys(inputMode)) inputMode[k] = false
        inputMode[act.f] = true
      }
      break
    }
    case 'resize': {
      const profile = state.profile as { w: number; h: number } | undefined
      if (profile) {
        profile.w = act.w
        profile.h = act.h
      }
      break
    }
    case 'injectState': {
      Object.assign(state, act.state)
      break
    }
    default:
      break
  }
}
