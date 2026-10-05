// tests/consistency-snapshot.test.ts
// ★VC3-a/b：统一快照格式 —— 归一化原语 + schema 校验器 + 确定性序列化
//
// 【这份测试在防什么】比对层的"格式适配"会把差异藏进转换里（卡片硬约束禁止）；
//   本档把"同一格式"钉死：拒绝非法快照（未知键/path 错位/精度超限）、归一化不猜（未识别形态抛错）、
//   序列化字节级确定（同数据 ⇒ 同字节）。
import { describe, it, expect } from 'vitest'
import {
  round3, normalizeColor, normalizeLength, normalizeFontWeight, normalizeFontFamily,
  validateGeometrySnapshot, validateStyleSnapshot, serializeGeometry,
} from '@proteus-vue/consistency'
import type { GeometrySnapshot, StyleSnapshot } from '@proteus-vue/consistency'

const goodGeo = (): GeometrySnapshot => ({
  format: 'proteus-geometry-snapshot',
  version: 1,
  end: 'web',
  viewport: { width: 390, height: 844 },
  root: {
    nodeId: 1, path: '', x: 0, y: 0, w: 390, h: 844, depth: 0,
    children: [
      { nodeId: 2, path: '0', x: 12, y: 12, w: 200, h: 60, depth: 1, children: [] },
      {
        nodeId: 3, path: '1', x: 12, y: 80, w: 300, h: 100, depth: 1,
        children: [{ nodeId: 4, path: '1.0', x: 16, y: 84, w: 100, h: 24, depth: 2, children: [] }],
      },
    ],
  },
})

describe('VC3 · 归一化原语（VC3-b：唯一实现）', () => {
  it('① round3：唯一舍入点，3 位小数', () => {
    expect(round3(1.23456)).toBe(1.235)
    expect(round3(-0.0004)).toBe(0) // -0 → 0
    expect(round3(100)).toBe(100)
  })

  it('② 颜色：六种形态归一为同一 RGBA', () => {
    const white = { r: 255, g: 255, b: 255, a: 1 }
    expect(normalizeColor('#fff')).toEqual(white)
    expect(normalizeColor('#ffffff')).toEqual(white)
    expect(normalizeColor('rgb(255,255,255)')).toEqual(white)
    expect(normalizeColor('rgba(255, 255, 255, 1)')).toEqual(white)
    expect(normalizeColor('white')).toEqual(white)
    expect(normalizeColor('WHITE')).toEqual(white)
    // 半透明：alpha 归一 0..1（3 位小数）
    expect(normalizeColor('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: 0.502 })
    expect(normalizeColor('rgba(0,0,0,0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 })
    expect(normalizeColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('③ 颜色：未识别形态**抛错不猜**（"零静默失败"）', () => {
    expect(() => normalizeColor('hsl(120, 50%, 50%)')).toThrow(/未识别颜色/)
    expect(() => normalizeColor('notacolor')).toThrow(/未识别颜色/)
    expect(() => normalizeColor('#12345')).toThrow(/hex 长度/)
  })

  it('④ 长度：px 与纯数字；auto/none 语义为非数值（null）；em 等**抛错**（不在此处换算）', () => {
    expect(normalizeLength('16px')).toBe(16)
    expect(normalizeLength('16')).toBe(16)
    expect(normalizeLength('1.2345px')).toBe(1.235)
    expect(normalizeLength('auto')).toBeNull()
    expect(normalizeLength('none')).toBeNull()
    expect(() => normalizeLength('1.5em')).toThrow(/不是 px 数值/)
    expect(() => normalizeLength('50%')).toThrow(/不是 px 数值/)
  })

  it('⑤ 字重/字族：与适配器同口径', () => {
    expect(normalizeFontWeight('bold')).toBe(700)
    expect(normalizeFontWeight('normal')).toBe(400)
    expect(normalizeFontWeight(600)).toBe(600)
    expect(() => normalizeFontWeight('heavy')).toThrow(/未识别字重/)
    expect(normalizeFontFamily('"PingFang SC", system-ui, sans-serif')).toBe('PingFang SC')
    expect(normalizeFontFamily('system-ui')).toBe('system-ui')
  })
})

describe('VC3 · 几何快照 schema 校验器（VC3-a 验收）', () => {
  it('⑥ 合法快照通过 + 节点计数正确（防空绿）', () => {
    const r = validateGeometrySnapshot(goodGeo())
    expect(r.ok).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.nodeCount).toBe(4)
  })

  it('⑦ path 与树结构必须一致（错位报 path-mismatch）', () => {
    const bad = goodGeo()
    bad.root.children[1]!.children[0]!.path = '0.0' // 应为 '1.0'
    const r = validateGeometrySnapshot(bad)
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'path-mismatch')).toBe(true)
  })

  it('⑧ depth 必须等于实际深度（错位报 depth-mismatch）', () => {
    const bad = goodGeo()
    bad.root.children[0]!.depth = 5
    const r = validateGeometrySnapshot(bad)
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'depth-mismatch')).toBe(true)
  })

  it('⑨ 浮点必须 3 位小数内（超限报 bad-precision）', () => {
    const bad = goodGeo()
    bad.root.children[0]!.x = 12.12345
    const r = validateGeometrySnapshot(bad)
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'bad-precision')).toBe(true)
  })

  it('⑩ 空快照/缺 root 不通过（空绿防护）', () => {
    expect(validateGeometrySnapshot({ format: 'proteus-geometry-snapshot', version: 1, end: 'web', viewport: { width: 1, height: 1 } }).ok).toBe(false)
    expect(validateGeometrySnapshot(null).ok).toBe(false)
  })

  it('⑪ 序列化字节级确定：同数据 ⇒ 同字节（含键序）', () => {
    const a = serializeGeometry(goodGeo())
    const b = serializeGeometry(goodGeo())
    expect(a).toBe(b)
    // 键序固定（nodeId 在 path 前——第一个节点）
    expect(a.indexOf('"nodeId"')).toBeLessThan(a.indexOf('"path"'))
    // 往返：serialize → parse → validate 通过
    const r = validateGeometrySnapshot(JSON.parse(a))
    expect(r.ok).toBe(true)
  })
})

describe('VC3 · 样式快照 schema 校验器（VC3-b 验收）', () => {
  const goodStyle = (): StyleSnapshot => ({
    format: 'proteus-style-snapshot',
    version: 1,
    end: 'webview',
    nodes: [
      {
        nodeId: 2, path: '0',
        styles: {
          color: { r: 255, g: 255, b: 255, a: 1 },
          backgroundColor: normalizeColor('#2a3f66'),
          fontSize: 16, fontWeight: 700, fontFamily: 'system-ui',
          paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8,
          marginTop: 0, marginRight: 0, marginBottom: 8, marginLeft: 0,
          borderTopLeftRadius: 18, opacity: 1, display: 'flex', position: 'relative',
        },
      },
    ],
  })

  it('⑫ 合法样式快照通过', () => {
    const r = validateStyleSnapshot(goodStyle())
    expect(r.ok).toBe(true)
    expect(r.nodeCount).toBe(1)
  })

  it('⑬ 未登记的样式键**报错**（闭集纪律——要么登记要么别产出）', () => {
    const bad = goodStyle()
    // ★B3 更新：`transform` 已登记（L2 全覆盖扩集）；改用**真正未登记**的键验闭集纪律
    //   （用 CSS 里存在但快照闭集**故意不收**的：`animation`——它归动画通道/判据外）
    ;(bad.nodes[0]!.styles as Record<string, unknown>).animation = 'fade 1s'
    const r = validateStyleSnapshot(bad)
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'unknown-style-key')).toBe(true)
  })

  it('⑭ 颜色必须是 {r,g,b,a} 数值且 round3', () => {
    const bad = goodStyle()
    bad.nodes[0]!.styles.color = '#fff' as never
    let r = validateStyleSnapshot(bad)
    expect(r.issues.some((i) => i.code === 'wrong-type')).toBe(true)
    const bad2 = goodStyle()
    bad2.nodes[0]!.styles.color = { r: 255, g: 255, b: 255, a: 0.12345 }
    r = validateStyleSnapshot(bad2)
    expect(r.issues.some((i) => i.code === 'non-rounded-value')).toBe(true)
  })

  it('⑮ 两个格式互不混淆（几何快照喂给样式校验器必红）', () => {
    const r = validateStyleSnapshot(goodGeo())
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.detail.includes('proteus-style-snapshot'))).toBe(true)
  })
})
