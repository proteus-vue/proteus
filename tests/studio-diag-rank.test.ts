/**
 * 诊断排序口径 —— 纯函数单测（决策 #1498）
 *
 * 【为什么需要它】UI 判据（㊿y）能证明「徽标连点会循环、文案在变」，但证明不了
 *   「循环的**第二条**确实是另一条诊断」——桩编辑器内容只有 10 行，line 10/12
 *   会被 CodeMirror 夹到同一行，读光标行号不可靠。
 *   ⇒ 数据层的顺序在这里用真值钉死，UI 层只断接线与游标状态。
 *
 * ★破坏性验证：把 diagGroups 的排序改成「按路径」（#1494 的旧口径），
 *   第 1 条与「目录首次落点」两条必须同时红。
 */
import { describe, expect, it } from 'vitest'
import type { Diag } from '../packages/studio/ui/src/bridge'
import { diagGroups, diagScope, diagScopeFrom } from '../packages/studio/ui/src/diagRank'

const d = (path: string, line: number, severity?: 'error' | 'warning'): Diag => ({
  path,
  line,
  col: 1,
  code: 'TS0000',
  message: `m${line}`,
  severity,
})

describe('diagGroups —— 严重度优先（不是路径优先）', () => {
  it('★错误多的文件排在路径靠前的文件之前', () => {
    const list = [d('a/a.ts', 1, 'error'), d('z/z.ts', 1, 'error'), d('z/z.ts', 2, 'error'), d('z/z.ts', 3, 'error')]
    const g = diagGroups(list)
    expect(g.map((x) => x.path)).toEqual(['z/z.ts', 'a/a.ts'])
    expect(g[0].errors).toBe(3)
    expect(g[1].errors).toBe(1)
  })

  it('错误数相同时按警告数降序，再按路径稳定排序', () => {
    const list = [
      d('b.ts', 1, 'error'),
      d('a.ts', 1, 'error'),
      d('a.ts', 2, 'warning'),
      d('c.ts', 1, 'warning'),
    ]
    expect(diagGroups(list).map((x) => x.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('severity 缺省按 error 计（老后端可能不给该字段）', () => {
    const g = diagGroups([d('old.ts', 1), d('new.ts', 1, 'warning')])
    expect(g[0].path).toBe('old.ts')
    expect(g[0].errors).toBe(1)
    expect(g[1].warnings).toBe(1)
  })

  it('组内保持输入的 行顺序，不重排', () => {
    const g = diagGroups([d('x.ts', 5, 'error'), d('x.ts', 2, 'error'), d('x.ts', 9, 'error')])
    expect(g[0].items.map((i) => i.line)).toEqual([5, 2, 9])
  })
})

describe('diagScope —— 徽标作用域', () => {
  const list = [
    d('pkg/a/a.ts', 1, 'error'),
    d('pkg/z/z.ts', 10, 'error'),
    d('pkg/z/z.ts', 12, 'error'),
    d('pkg/z/z.ts', 14, 'error'),
    d('pkg/m/m.ts', 2, 'warning'),
  ]

  it('文件行只取自己，两条错误按 line 展开（循环跳的数据依据）', () => {
    expect(diagScope(list, 'pkg/z/z.ts', false).map((i) => i.line)).toEqual([10, 12, 14])
  })

  it('★目录首次落点是错误最多的文件，不是路径最靠前的文件', () => {
    const scope = diagScope(list, 'pkg', true)
    expect(scope.length).toBe(5)
    expect(scope[0].path).toBe('pkg/z/z.ts')
    expect(scope[0].line).toBe(10)
  })

  it('目录前缀不误吞同名兄弟目录（pkg 不含 pkg2）', () => {
    const withSibling = [...list, d('pkg2/n.ts', 1, 'error')]
    const scope = diagScope(withSibling, 'pkg', true)
    expect(scope.some((i) => i.path.startsWith('pkg2/'))).toBe(false)
  })

  it('诊断路径带 ./ 时仍能对上树行路径', () => {
    const dotted = [d('./pkg/a/a.ts', 7, 'error')]
    expect(diagScope(dotted, 'pkg/a/a.ts', false).map((i) => i.line)).toEqual([7])
    expect(diagScope(dotted, 'pkg', true).map((i) => i.line)).toEqual([7])
  })

  it('★diagScopeFrom 与 diagScope 同源（渲染缓存与一次性用法不漂移）', () => {
    expect(diagScopeFrom(diagGroups(list), 'pkg', true)).toEqual(diagScope(list, 'pkg', true))
  })

  it('空作用域返回空数组，徽标跳不动', () => {
    expect(diagScope(list, 'pkg/none', true)).toEqual([])
    expect(diagScope([], 'pkg', true)).toEqual([])
  })
})
