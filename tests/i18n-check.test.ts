// tests/i18n-check.test.ts
// ★i18n-plan B2：proteus i18n:check —— 消息引用审计（缺失/多余/注释豁免）
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkI18nUsage, formatI18nCheck } from '../packages/cli/src/i18n-check'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-i18n-check-'))
afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

function writeFixture(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

function makeProject(root: string): void {
  // 语言包
  writeFixture(
    root,
    'locales/zh-CN.json',
    JSON.stringify({ 'common.confirm': '确认', 'user.greeting': '你好，{name}', 'cart.items': '{count, plural, one {1 件} other {# 件}}' }, null, 2),
  )
  // 页面：引用两个存在的 key + 一个缺失 key + 注释里的 t()（豁免）+ 变量 key（跳过）
  writeFixture(
    root,
    'pages/index.vue',
    [
      `<script setup lang="ts">`,
      `import { i18n } from '../locales'`,
      `const a = i18n.t('common.confirm')`,
      `const b = i18n.t('user.greeting', { name: 'x' })`,
      `const c = i18n.t('user.greeting.typo')`,
      `// const commented = i18n.t('user.greeting')（注释应豁免）`,
      `const key = 'common.confirm'`,
      `const d = i18n.t(key) // 变量 key 跳过`,
      `</script>`,
      `<template><view>{{ $t('cart.items', { count: 5 }) }}</view></template>`,
    ].join('\n'),
  )
}

describe('checkI18nUsage 消息引用审计', () => {
  it('缺失 key → error（ok=false）；多余未引用 → warning 报告', () => {
    const root = path.join(TMP, 'basic')
    makeProject(root)
    const result = checkI18nUsage(root)
    expect(result.ok).toBe(false)
    // 缺失：user.greeting.typo（注释里的 user.greeting 豁免、变量 key 跳过）
    expect(result.missing).toEqual(['user.greeting.typo'])
    // 引用集合：common.confirm / user.greeting / user.greeting.typo / cart.items
    expect(result.usedKeys.sort()).toEqual(['cart.items', 'common.confirm', 'user.greeting', 'user.greeting.typo'].sort())
    // 清单 3 条全部被引用 → unused 为空
    expect(result.unused).toEqual([])
    expect(formatI18nCheck(result)).toContain('[missing] user.greeting.typo')
  })

  it('多余未引用 key → unused 报告', () => {
    const root = path.join(TMP, 'unused')
    makeProject(root)
    fs.writeFileSync(
      path.join(root, 'locales/zh-CN.json'),
      JSON.stringify({ 'common.confirm': '确认', 'user.greeting': '你好', 'cart.items': 'x', 'legacy.old': '旧' }, null, 2),
    )
    const result = checkI18nUsage(root)
    expect(result.unused).toEqual(['legacy.old'])
  })

  it('全部引用存在 → ok=true（零缺失）', () => {
    const root = path.join(TMP, 'ok')
    makeProject(root)
    fs.writeFileSync(
      path.join(root, 'locales/zh-CN.json'),
      JSON.stringify({ 'common.confirm': '确认', 'user.greeting': '你好', 'cart.items': 'x', 'user.greeting.typo': '补上' }, null, 2),
    )
    const result = checkI18nUsage(root)
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('语言包缺失 → 明确报错（--catalog 可指定）', () => {
    const root = path.join(TMP, 'nocatalog')
    fs.mkdirSync(path.join(root, 'pages'), { recursive: true })
    fs.writeFileSync(path.join(root, 'pages/a.vue'), `<script setup lang="ts">const x = t('a.b')</script>`)
    expect(() => checkI18nUsage(root)).toThrow(/语言包清单/)
    // --catalog 显式指定
    writeFixture(root, 'my-catalog.json', JSON.stringify({ 'a.b': 'AB' }))
    const result = checkI18nUsage(root, path.join(root, 'my-catalog.json'))
    expect(result.ok).toBe(true)
  })
})
