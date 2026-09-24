// tests/event-field-bare-payload.test.ts
// ★2026-09-24 实测缺陷的回归锁：eventField 未处理**裸载荷**（框架 Web 模拟层的约定形态）。
//
// 背景：框架约定「Web 模拟层 emit 裸载荷」——如 WebScrollView emit `{ scrollTop, scrollLeft, ... }`，
//   无 detail/target 外壳（见 built-in-components/src/components/scroll-view.ts 的注释
//   「★裸载荷（框架约定）」）。而 runtime/event.ts 的 eventField 只认 e.detail / e.target →
//   **裸载荷恒读不到值**。
//   后果（实测）：p-list-view 虚拟滚动在 Web 端完全失效——scrollTop 恒为 0 → 窗口不更新 →
//   列表永远停在首屏那几行（滚动条动、内容不动；无任何报错，属静默失效）。
import { describe, it, expect } from 'vitest'
import { eventField, eventValue, eventScrollTop } from '../packages/components/runtime/event'

describe('★eventField 三种载荷形态（detail / target / 裸载荷）', () => {
  it('① MP 原生形态：e.detail.<field>', () => {
    expect(eventField({ detail: { value: 'mp' } }, 'value')).toBe('mp')
    expect(eventScrollTop({ detail: { scrollTop: 120 } })).toBe(120)
  })

  it('② Web 原生 DOM 事件形态：e.target.<field>', () => {
    expect(eventField({ target: { value: 'dom' } }, 'value')).toBe('dom')
    expect(eventScrollTop({ target: { scrollTop: 88 } })).toBe(88)
  })

  it('★③ 裸载荷形态（框架 Web 模拟层约定）：事件对象自身即载荷', () => {
    // WebScrollView emit('scroll', { scrollTop, scrollLeft, scrollHeight, scrollWidth })
    expect(eventScrollTop({ scrollTop: 2200 }), '裸载荷 scrollTop 必须被读到（此前恒 0）').toBe(2200)
    // 其它组件的裸载荷
    expect(eventField({ value: true }, 'value')).toBe(true)
    expect(eventValue({ value: 'bare' })).toBe('bare')
  })

  it('优先级：detail 优先于 target，target 优先于裸载荷（同名字段时）', () => {
    expect(eventField({ detail: { scrollTop: 1 }, target: { scrollTop: 2 }, scrollTop: 3 }, 'scrollTop')).toBe(1)
    expect(eventField({ target: { scrollTop: 2 }, scrollTop: 3 }, 'scrollTop')).toBe(2)
  })

  it('缺字段 / 空事件对象 → undefined（不抛错）', () => {
    expect(eventField({}, 'value')).toBeUndefined()
    expect(eventField(null, 'value')).toBeUndefined()
    expect(eventField(undefined, 'value')).toBeUndefined()
    expect(eventScrollTop({}), '缺失时 scrollTop 归零').toBe(0)
  })

  it('类型不符不误取（值必须是该类型）', () => {
    expect(eventValue({ value: 123 }), 'value 非字符串 → 空串（不返回数字）').toBe('')
    expect(eventScrollTop({ scrollTop: '100' }), 'scrollTop 非数字 → 0').toBe(0)
  })
})
