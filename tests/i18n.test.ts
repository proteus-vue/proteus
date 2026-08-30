// tests/i18n.test.ts
// ★i18n-plan B1：@proteus-vue/i18n（createI18n 类型安全 + ICU 子集解析器 + dir/RTL + locale 切换）
import { describe, it, expect } from 'vitest'
import { createI18n } from '../packages/i18n/src'
import { renderMessage } from '../packages/i18n/src/icu'

const zhCN = {
  'common.confirm': '确认',
  'user.greeting': '你好，{name}',
  'cart.items': '{count, plural, one {1 件} other {# 件}}',
  'cart.exact': '{count, plural, =0 {空空如也} =1 {仅 1 件} other {# 件}}',
  'gender.notice': '{gender, select, male {他} female {她} other {TA}}',
  'nested': '共 {count, plural, one {1 条} other {# 条}}，来自 {name}',
} as const

const enUS = {
  'common.confirm': 'Confirm',
  'user.greeting': 'Hello, {name}',
  'cart.items': '{count, plural, one {1 item} other {# items}}',
  'cart.exact': '{count, plural, =0 {nothing} =1 {only 1} other {# items}}',
  'gender.notice': '{gender, select, male {he} female {she} other {they}}',
  'nested': '{count, plural, one {1 item} other {# items}} from {name}',
} as const

describe('ICU 子集解析器（renderMessage）', () => {
  it('{name} 插值 + 缺失参数渲染空串', () => {
    expect(renderMessage('你好，{name}', { name: 'Alex' })).toBe('你好，Alex')
    expect(renderMessage('你好，{name}！', {})).toBe('你好，！')
  })
  it('plural：one/other + # 数量占位', () => {
    expect(renderMessage('{count, plural, one {1 件} other {# 件}}', { count: 1 })).toBe('1 件')
    expect(renderMessage('{count, plural, one {1 件} other {# 件}}', { count: 5 })).toBe('5 件')
    expect(renderMessage('{count, plural, one {1 件} other {# 件}}', { count: 0 })).toBe('0 件')
  })
  it('plural 精确值 =N 优先', () => {
    const tpl = '{count, plural, =0 {空空如也} =1 {仅 1 件} other {# 件}}'
    expect(renderMessage(tpl, { count: 0 })).toBe('空空如也')
    expect(renderMessage(tpl, { count: 1 })).toBe('仅 1 件')
    expect(renderMessage(tpl, { count: 7 })).toBe('7 件')
  })
  it('select：按值精确匹配 + other 兜底', () => {
    const tpl = '{gender, select, male {他} female {她} other {TA}}'
    expect(renderMessage(tpl, { gender: 'male' })).toBe('他')
    expect(renderMessage(tpl, { gender: 'female' })).toBe('她')
    expect(renderMessage(tpl, { gender: 'unknown' })).toBe('TA')
  })
  it('嵌套：plural 块内再含插值', () => {
    const tpl = '共 {count, plural, one {1 条} other {# 条}}，来自 {name}'
    expect(renderMessage(tpl, { count: 3, name: '小 P' })).toBe('共 3 条，来自 小 P')
  })
  it('孤儿 } 跳过防崩溃；普通文本 # 字面保留', () => {
    expect(renderMessage('a}b', {})).toBe('ab')
    expect(renderMessage('版本 #2', {})).toBe('版本 #2')
  })
})

describe('createI18n（类型安全 + locale 切换 + dir）', () => {
  it('默认 locale + t() 插值/复数', () => {
    const i18n = createI18n({ catalogs: { zhCN, enUS }, defaultLocale: 'zhCN' })
    expect(i18n.t('common.confirm')).toBe('确认')
    expect(i18n.t('user.greeting', { name: 'Alex' })).toBe('你好，Alex')
    expect(i18n.t('cart.items', { count: 5 })).toBe('5 件')
  })
  it('setLocale 切换 + 未知 locale 忽略 + onLocaleChange 回调', () => {
    const i18n = createI18n({ catalogs: { zhCN, enUS }, defaultLocale: 'zhCN' })
    const changes: string[] = []
    i18n.onLocaleChange((l) => changes.push(l))
    i18n.setLocale('enUS')
    expect(i18n.locale).toBe('enUS')
    expect(i18n.t('cart.items', { count: 5 })).toBe('5 items')
    expect(changes).toEqual(['enUS'])
    i18n.setLocale('fr-FR') // 未注册 → 忽略
    expect(i18n.locale).toBe('enUS')
  })
  it('缺失消息回退 key 本身（i18n:check 审计覆盖）', () => {
    const i18n = createI18n({ catalogs: { zhCN }, defaultLocale: 'zhCN' })
    // @ts-expect-error —— 类型安全：不存在的 key 编译报错（tsc 断言）
    const _bad = i18n.t('not.exists')
    expect(i18n.t('not.exists' as never)).toBe('not.exists')
  })
  it('dir()：RTL locale 前缀匹配（ar/he/fa/ur）', () => {
    const i18n = createI18n({ catalogs: { zhCN, enUS, arEG: zhCN }, defaultLocale: 'zhCN' })
    expect(i18n.dir()).toBe('ltr')
    i18n.setLocale('arEG')
    expect(i18n.dir()).toBe('rtl')
    // 自定义 rtlLocales
    const i18n2 = createI18n({ catalogs: { zhCN, enUS }, defaultLocale: 'zhCN', rtlLocales: ['en'] })
    expect(i18n2.dir()).toBe('ltr')
  })
})

describe('类型安全（免 codegen，tsc 断言）', () => {
  it('合法 key 通过；非法 key 编译报错（@ts-expect-error 验证）', () => {
    const i18n = createI18n({ catalogs: { zhCN }, defaultLocale: 'zhCN' })
    const ok: string = i18n.t('user.greeting', { name: 'x' })
    expect(ok).toBe('你好，x')
    // @ts-expect-error —— key 类型约束：typo 编译报错
    const _typo = i18n.t('user.greetin')
    // @ts-expect-error —— params 缺 name 不影响类型（运行时渲染空串，审计可见）
    const _noParam = i18n.t('user.greeting')
  })
})
