// tests/style-safety-runtime.test.ts —— G-31 style-safety B1+B2 运行时 Validator
// 白名单属性 + 值类型校验 + createStyleGuard 拦截/降级/记录（DevTools style-safety Inspector 数据源）
import { describe, it, expect, vi } from 'vitest'
import {
  validateStyleValue,
  createStyleGuard,
  isLength,
  isOpacity,
  isSemanticProp,
  FORBIDDEN_PROPS,
} from '@proteus-vue/style-safety'

describe('validateStyleValue 单值校验', () => {
  it('白名单长度属性：合法数/px 串/auto 通过；NaN/负数串/对象拒绝', () => {
    expect(validateStyleValue('width', 100).ok).toBe(true)
    expect(validateStyleValue('width', '10px').ok).toBe(true)
    expect(validateStyleValue('width', 'auto').ok).toBe(true)
    expect(validateStyleValue('width', '10%').ok).toBe(true)
    expect(validateStyleValue('width', Number.NaN).ok).toBe(false)
    expect(validateStyleValue('width', '10vw').ok).toBe(false) // 非白名单单位
    expect(validateStyleValue('width', { v: 1 }).ok).toBe(false)
  })

  it('opacity 0-1；数值属性有限数；颜色字符串；transform 函数', () => {
    expect(validateStyleValue('opacity', 0.5).ok).toBe(true)
    expect(validateStyleValue('opacity', 1.5).ok).toBe(false)
    expect(validateStyleValue('opacity', 1.5)).toMatchObject({ ok: false, fallback: 1 })
    expect(validateStyleValue('zIndex', 10).ok).toBe(true)
    expect(validateStyleValue('zIndex', Number.POSITIVE_INFINITY).ok).toBe(false)
    expect(validateStyleValue('color', '#fff').ok).toBe(true)
    expect(validateStyleValue('color', 123).ok).toBe(false)
    expect(validateStyleValue('transform', 'translateX(10px)').ok).toBe(true)
    expect(validateStyleValue('transform', 'none').ok).toBe(false)
  })

  it('forbidden 属性拒绝 + 语义组件 p-* 放行', () => {
    for (const p of FORBIDDEN_PROPS) {
      expect(validateStyleValue(p, 'x').ok).toBe(false)
    }
    expect(validateStyleValue('display', 'flex').ok).toBe(false)
    expect(validateStyleValue('backdropFilter', 'blur(10px)').ok).toBe(false)
    expect(isSemanticProp('p-glass')).toBe(true)
    expect(validateStyleValue('p-glass', { blur: 10 }).ok).toBe(true)
  })
})

describe('createStyleGuard', () => {
  it('patch：非法剔除 + 降级默认值 + 记录 rejected（strict 模式）', () => {
    const guard = createStyleGuard({ mode: 'strict' })
    const safe = guard.patch({ width: 100, opacity: 1.5, display: 'inline-flex', 'p-glass': true })
    expect(safe).toEqual({ width: 100, opacity: 1, 'p-glass': true }) // opacity 降级 1，display 剔除
    const records = guard.records()
    expect(records.length).toBe(2)
    expect(records[0]).toMatchObject({ prop: 'opacity', reason: expect.stringContaining('0-1') })
    expect(records[1]).toMatchObject({ prop: 'display', reason: expect.stringContaining('禁止') })
    expect(records[0].ts).toBeGreaterThan(0)
    guard.clear()
    expect(guard.records().length).toBe(0)
  })

  it('onReject 回调逐条推送（DevTools 实时数据源）', () => {
    const onReject = vi.fn()
    const guard = createStyleGuard({ mode: 'loose', onReject })
    guard.patch({ width: '10vw' })
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0][0]).toMatchObject({ prop: 'width' })
  })

  it('mode off：原样放行零开销（生产默认）', () => {
    const guard = createStyleGuard({ mode: 'off' })
    const style = { width: '10vw', opacity: 99, display: 'flex' }
    expect(guard.patch(style)).toBe(style) // 同一引用——零拷贝
    expect(guard.records().length).toBe(0)
  })
})
