// tests/snapshot-core.test.ts
// ★test-framework B2：编译快照规范化工具（02-snapshot-compile.md）
// parseWxml / normalizeWxml / canonicalizeWxml / diffWxml / assertWxmlEqual
// decodeVlqSegment / decodeMappings / verifySourceMap / checkJsExports / normalizeJson
import { describe, expect, it } from 'vitest'
import {
  parseWxml,
  normalizeWxml,
  canonicalizeWxml,
  diffWxml,
  assertWxmlEqual,
  decodeVlqSegment,
  decodeMappings,
  verifySourceMap,
  checkJsExports,
  normalizeJson,
} from '@proteus-vue/test-core/snapshot'

describe('parseWxml（02 §快照对象 .wxml：结构解析）', () => {
  it('基础元素：标签 + 属性 + 文本 + 嵌套', () => {
    const nodes = parseWxml('<view class="page"><text>hello</text></view>')
    expect(nodes).toEqual([
      {
        type: 'element',
        tag: 'view',
        attrs: [{ name: 'class', value: 'page' }],
        children: [{ type: 'element', tag: 'text', attrs: [], children: [{ type: 'text', value: 'hello' }] }],
      },
    ])
  })

  it('自闭合标签 + 无值布尔属性', () => {
    const nodes = parseWxml('<image src="/a.png" mode="aspectFill" lazy-load /><view disabled />')
    expect(nodes[0]).toMatchObject({
      type: 'element',
      tag: 'image',
      attrs: [
        { name: 'src', value: '/a.png' },
        { name: 'mode', value: 'aspectFill' },
        { name: 'lazy-load', value: '' },
      ],
    })
    expect((nodes[1] as { attrs: { name: string; value: string }[] }).attrs).toEqual([{ name: 'disabled', value: '' }])
  })

  it('属性值含 > 与引号（{{a > 1}} 表达式）不终止标签', () => {
    const nodes = parseWxml('<view wx:if="{{count > 1}}">x</view>')
    expect((nodes[0] as { attrs: { name: string; value: string }[] }).attrs).toEqual([
      { name: 'wx:if', value: '{{count > 1}}' },
    ])
  })

  it('注释节点保留（normalize 时丢弃）', () => {
    const nodes = parseWxml('<!-- header --><view />')
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toEqual({ type: 'comment', value: ' header ' })
  })
})

describe('normalizeWxml / canonicalizeWxml（结构规范化）', () => {
  it('空白折叠 + 注释丢弃 + 空文本剔除', () => {
    const nodes = normalizeWxml('<view>\n  <text>  a  b </text>\n  <!-- c -->\n</view>')
    expect(nodes).toEqual([
      { type: 'element', tag: 'view', attrs: [], children: [{ type: 'element', tag: 'text', attrs: [], children: [{ type: 'text', value: 'a b' }] }] },
    ])
  })

  it('属性顺序不敏感：交换属性序 → canonicalizeWxml 输出一致', () => {
    const a = canonicalizeWxml('<view class="x" id="y" bindtap="t" />')
    const b = canonicalizeWxml('<view bindtap="t" id="y" class="x" />')
    expect(a).toBe(b)
    expect(a).toContain('class="x"')
  })

  it('canonicalizeWxml 输出稳定形态（缩进 + 排序属性）', () => {
    expect(canonicalizeWxml('<view class="p"><text>t</text></view>')).toBe('<view class="p">\n  <text>\n    t\n  </text>\n</view>')
  })
})

describe('diffWxml / assertWxmlEqual（结构 diff 定位）', () => {
  it('等价（仅空白/属性序/注释差异）→ null', () => {
    expect(diffWxml('<view a="1" b="2">x</view>', '<view b="2" a="1">\n  x\n</view>')).toBeNull()
  })

  it('属性值差异 → 定位 attrs 路径', () => {
    const d = diffWxml('<view class="a" />', '<view class="b" />')
    expect(d?.path).toContain('class')
    expect(d?.actual).toBe('a')
    expect(d?.expected).toBe('b')
  })

  it('标签差异 → 定位 tag 路径', () => {
    const d = diffWxml('<view />', '<text />')
    expect(d?.path).toContain('<tag>')
    expect(d?.actual).toBe('view')
  })

  it('子节点数量差异 → 定位 length', () => {
    const d = diffWxml('<view><text /></view>', '<view><text /><image /></view>')
    expect(d?.path).toContain('<length>')
  })

  it('assertWxmlEqual：一致不抛错 / 不一致抛错带路径', () => {
    expect(() => assertWxmlEqual('<view a="1" />', '<view a="1" />')).not.toThrow()
    expect(() => assertWxmlEqual('<view a="1" />', '<view a="2" />')).toThrow(/class|attrs/)
  })
})

describe('decodeMappings（sourcemap v3 VLQ 解码）', () => {
  it('单段 AAQA：genCol 0 / srcIdx 0 / srcLine delta 8 / srcCol 0', () => {
    expect(decodeVlqSegment('AAQA')).toEqual([0, 0, 8, 0])
  })

  it('负数编码：C=2→+1，D=3→-1；多字节 gB→16', () => {
    expect(decodeVlqSegment('C')).toEqual([1])
    expect(decodeVlqSegment('D')).toEqual([-1])
    expect(decodeVlqSegment('gB')).toEqual([16])
  })

  it('分号分行 + 逗号分段 + srcLine 跨段累积', () => {
    // 行0: AAAA（srcLine 0）→ 行1: AAQA（srcLine 0+8=8）→ 行2: 无映射
    const out = decodeMappings('AAAA;AAQA;')
    expect(out).toEqual([
      { genLine: 0, genCol: 0, srcLine: 0, srcCol: 0 },
      { genLine: 1, genCol: 0, srcLine: 8, srcCol: 0 },
    ])
  })
})

describe('verifySourceMap（回源完整性）', () => {
  const js = 'line0\nline1\nline2'
  const source = 'src0\nsrc1'

  it('合法映射 → 零违规', () => {
    // AAAA;AAAA：两行都映射到 src 行 0（在 2 行源码范围内）
    expect(verifySourceMap({ version: 3, mappings: 'AAAA;AAAA' }, js, source)).toEqual([])
  })

  it('gen 行越界 → gen-line-out-of-range', () => {
    // 第 5 行有映射，但产物只有 3 行
    const v = verifySourceMap({ mappings: ';;;;;AAAA' }, js, source)
    expect(v.some((x) => x.kind === 'gen-line-out-of-range')).toBe(true)
  })

  it('src 行越界 → src-line-out-of-range', () => {
    // AAQA：srcLine=8 ≥ 源码 2 行
    const v = verifySourceMap({ mappings: 'AAQA' }, js, source)
    expect(v.some((x) => x.kind === 'src-line-out-of-range')).toBe(true)
  })

  it('非合法 JSON / 缺 mappings → invalid-sourcemap', () => {
    expect(verifySourceMap('not json', js, source)[0]?.kind).toBe('invalid-sourcemap')
    expect(verifySourceMap({ version: 3 }, js, source)[0]?.kind).toBe('invalid-sourcemap')
  })
})

describe('checkJsExports（关键导出存在性）', () => {
  it('Page 配置：data + 生命周期 + 方法齐全 → 空缺失', () => {
    const js = `Page({ data: { a: 1 }, onLoad() { const p = {} }, handleTap() { this.setData({}) } })`
    expect(checkJsExports(js, ['data', 'onLoad', 'handleTap'])).toEqual([])
    expect(checkJsExports(js, ['data', 'missing'])).toEqual(['missing'])
  })

  it('Component 配置 + module.exports', () => {
    const comp = `Component({ properties: { size: Number }, methods: { onTap() {} } })`
    expect(checkJsExports(comp, ['properties', 'methods'])).toEqual([])
    const mod = `module.exports = { install, store }`
    expect(checkJsExports(mod, ['install', 'store'])).toEqual([])
  })

  it('嵌套对象不误判为顶层键', () => {
    const js = `Page({ data: { onLoad: 'not-a-method' } })`
    // 顶层只有 data；嵌套 onLoad 不算
    expect(checkJsExports(js, ['data'])).toEqual([])
    expect(checkJsExports(js, ['onLoad'])).toEqual(['onLoad'])
  })
})

describe('normalizeJson（键序稳定化）', () => {
  it('嵌套键排序 + 数组保序 + 缩进', () => {
    expect(normalizeJson({ b: 1, a: { d: 4, c: 3 } })).toBe('{\n  "a": {\n    "c": 3,\n    "d": 4\n  },\n  "b": 1\n}')
    expect(normalizeJson({ z: [2, 1] })).toBe('{\n  "z": [\n    2,\n    1\n  ]\n}')
  })

  it('键序不同的对象 → 输出一致（结构化等值）', () => {
    expect(normalizeJson({ a: 1, b: 2 })).toBe(normalizeJson({ b: 2, a: 1 }))
  })
})
