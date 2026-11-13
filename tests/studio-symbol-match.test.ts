/**
 * 符号面板匹配口径 —— 纯函数单测（决策 #1499）
 *
 * 【为什么需要它】UI 判据（㊿z）只能证明「打 uas 后列表里出现了 useAutoSave」，
 *   证明不了词形边界（`XMLHttpRequest` 的分词、连续大写、缩写档与子序列档的优先级）。
 *   ⇒ 算法层在这里用真值钉死，UI 层只断接线与真实键盘入口。
 *
 * ★破坏性验证：把 filterSymbols 退回纯子串 ⇒ 第 ⑤⑥⑦ 组必须红；
 *   去掉「只取最高档」⇒ 第 ⑤ 组（精确优先）必须红（㊿t 也会跟着红）。
 */
import { describe, expect, it } from 'vitest'
import { filterSymbols, symbolAbbr, symbolMatchRank, symbolWords } from '../packages/studio/ui/src/symbolMatch'

type Row = { name: string; kind: string; line: number }
const r = (name: string, kind = 'function', line = 1): Row => ({ name, kind, line })

/** 与门禁桩同形的前 6 项 + 两个用于验证「子序列不得淹没精确命中」的样本 */
const rows: Row[] = [
  r('Stats', 'interface'),
  r('BridgeState', 'type'),
  r('hasBridge'),
  r('invoke'),
  r('MAX_BYTES'),
  r('useAutoSave'),
  r('sym21'),
  r('sym1'),
]

const names = (q: string, list: Row[] = rows) => filterSymbols(list, q).map((x) => x.name)

describe('symbolWords / symbolAbbr（分词是缩写档的地基）', () => {
  it('① 驼峰边界分词', () => {
    expect(symbolWords('useAutoSave')).toEqual(['use', 'Auto', 'Save'])
    expect(symbolWords('BridgeState')).toEqual(['Bridge', 'State'])
  })

  it('② 连续大写词尾 + 下划线分词', () => {
    expect(symbolWords('XMLHttpRequest')).toEqual(['XML', 'Http', 'Request'])
    expect(symbolWords('MAX_BYTES')).toEqual(['MAX', 'BYTES'])
  })

  it('③ 词首缩写按词取首字母，不受大小写影响', () => {
    expect(symbolAbbr('useAutoSave')).toBe('uas')
    expect(symbolAbbr('BridgeState')).toBe('bs')
    expect(symbolAbbr('hasBridge')).toBe('hb')
    expect(symbolAbbr('MAX_BYTES')).toBe('mb')
  })
})

describe('symbolMatchRank（三档口径）', () => {
  it('④ 连续子串 / 词首缩写 / 子序列 / 不命中', () => {
    expect(symbolMatchRank(r('sym1'), 'sym1')).toBe(3)
    expect(symbolMatchRank(r('useAutoSave'), 'uas')).toBe(2)
    expect(symbolMatchRank(r('Stats'), 'ss')).toBe(1)
    expect(symbolMatchRank(r('Stats'), 'zz')).toBe(0)
  })

  it('④b kind 也算连续子串；空查询视为全命中', () => {
    expect(symbolMatchRank(r('invoke'), 'fun')).toBe(3)
    expect(symbolMatchRank(r('Stats', 'interface'), '')).toBe(3)
  })
})

describe('filterSymbols（只取最高档 = 精确优先）', () => {
  it('⑤ ★连续子串命中时，子序列命中必须被屏蔽（否则 ㊿t 会红）', () => {
    expect(names('sym1')).toEqual(['sym1'])
    expect(names('sym21')).toEqual(['sym21'])
  })

  it('⑤b 跨档同理：有连续命中就不显示缩写命中', () => {
    expect(names('bs', [r('BridgeState'), r('absPath')])).toEqual(['absPath'])
  })

  it('⑥ 词首缩写：uas / bs / mb / BS', () => {
    expect(names('uas')).toEqual(['useAutoSave'])
    expect(names('bs')).toEqual(['BridgeState'])
    expect(names('mb')).toEqual(['MAX_BYTES'])
    expect(names('BS')).toEqual(['BridgeState'])
  })

  it('⑦ 子序列：Stats 搜 ss 命中，且不放进只有一个 s 的项', () => {
    expect(names('ss')).toEqual(['Stats', 'useAutoSave'])
    expect(names('ss')).not.toContain('sym21')
  })

  it('⑧ 保留 #1491 的 kind 子串匹配', () => {
    expect(names('fun')).toEqual(['hasBridge', 'invoke', 'MAX_BYTES', 'useAutoSave', 'sym21', 'sym1'])
  })

  it('⑨ 空查询返回原数组；无命中返回空', () => {
    expect(filterSymbols(rows, '')).toBe(rows)
    expect(filterSymbols(rows, '   ')).toBe(rows)
    expect(names('zzzz')).toEqual([])
  })

  it('⑩ 结果保持输入顺序（面板还要按 kind 分组、组内按行号排）', () => {
    const picked = filterSymbols(rows, 'fun')
    expect(picked.map((x) => rows.indexOf(x))).toEqual([2, 3, 4, 5, 6, 7])
  })
})
