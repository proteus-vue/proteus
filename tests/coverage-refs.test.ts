// tests/coverage-refs.test.ts
// ★G-32.1 矩阵引用一致性（Hook 级）——用 @proteus-vue/api 真实 Hook 名集校验矩阵引用。
//   背景：CLI 的 audit:coverage 传空 knownHooks（cli 不依赖 api 包），Hook 幽灵需本测试兜底。
//   SSOT：packages/api/src/capability.ts 的 useXxx 声明（能力 Hook 唯一权威）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MP_MAPPING_MATRIX, auditMatrixReferences } from '@proteus-vue/component-ir'

const API_SRC = fileURLToPath(new URL('../packages/api/src/capability.ts', import.meta.url))

/** 从 api 源码抽取全部 useXxx Hook 名（接口声明 + 实现均可命中） */
function collectKnownHooks(src: string): Set<string> {
  const set = new Set<string>()
  for (const m of src.matchAll(/\buse[A-Z]\w*/g)) set.add(m[0])
  return set
}

describe('G-32.1 矩阵引用一致性（Hook 级 · SSOT=api）', () => {
  const knownHooks = collectKnownHooks(readFileSync(API_SRC, 'utf8'))

  it('api SSOT 抽到足量 Hook（防测试自身失效）', () => {
    expect(knownHooks.size).toBeGreaterThan(30)
    expect(knownHooks.has('useMap')).toBe(true)
    expect(knownHooks.has('useRecorder')).toBe(true)
  })

  it('矩阵所有 Hook 引用均真实存在于 api（0 幽灵 Hook）', () => {
    const { issues } = auditMatrixReferences(MP_MAPPING_MATRIX, knownHooks)
    const hookIssues = issues.filter((i) => i.kind === 'hook')
    expect(hookIssues.map((i) => `${i.mp} → ${i.ref}`)).toEqual([])
  })

  it('破坏性验证：幽灵 Hook 经 api SSOT 判定被拦截', () => {
    const ghost = [{ mp: 'wx.ghost', proteus: 'useTotallyFakeHook', status: 'ok' as const, group: 'api' as const }]
    const { issues } = auditMatrixReferences(ghost, knownHooks)
    expect(issues).toEqual([{ mp: 'wx.ghost', ref: 'useTotallyFakeHook', kind: 'hook' }])
  })
})
