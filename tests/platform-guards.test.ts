// tests/platform-guards.test.ts
// ★types-plan B4：平台守卫（matchPlatform/assertPlatform/exhaustiveCheck/getPlatform）——铁律 #4 替代 #ifdef
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import { getPlatform, matchPlatform, assertPlatform, exhaustiveCheck, detectPlatform } from '../packages/capabilities/src'

// ★官方 miniprogram-api-typings 的 require 全局无 resolve（覆盖 node require）——测试用 node 语义需 createRequire
const nodeRequire = createRequire(import.meta.url)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getPlatform / detectPlatform（运行时探测）', () => {
  it('无 wx → web', () => {
    expect(getPlatform()).toBe('web')
  })
  it('wx 存在 → skyline', () => {
    vi.stubGlobal('wx', {})
    expect(getPlatform()).toBe('skyline')
  })
})

describe('matchPlatform（三端分支 + 类型收窄）', () => {
  it('web 分支执行（仅调用对应分支）', () => {
    const calls: string[] = []
    const r = matchPlatform({
      web: () => { calls.push('web'); return 'W' },
      skyline: () => { calls.push('skyline'); return 'S' },
      app: () => { calls.push('app'); return 'A' },
    })
    expect(r).toBe('W')
    expect(calls).toEqual(['web'])
  })

  it('skyline 分支（wx 存在）', () => {
    vi.stubGlobal('wx', {})
    const r = matchPlatform({ web: () => 'w', skyline: () => 'mp', app: () => 'app' })
    expect(r).toBe('mp')
  })

  it('返回值类型统一（T 推断）', () => {
    vi.stubGlobal('wx', {})
    const n: number = matchPlatform({ web: () => 1, skyline: () => 2, app: () => 3 })
    expect(n).toBe(2)
  })
})

describe('assertPlatform（运行时断言）', () => {
  it('匹配 → 通过；不匹配 → 抛错', () => {
    expect(() => assertPlatform('web')).not.toThrow()
    expect(() => assertPlatform('skyline')).toThrow(/expected skyline, got web/)
  })
})

describe('exhaustiveCheck（穷尽兜底）', () => {
  it('抛错含消息', () => {
    expect(() => exhaustiveCheck('web' as never, 'guard 未穷尽')).toThrow(/guard 未穷尽/)
  })
})

describe('平台守卫的 MP 产物安全（无 ?./??/展开/解构）', () => {
  it('guard.ts 源码不含禁用语法（决策 #32/#36）', () => {
    const fs = require('node:fs')
    const src = fs.readFileSync(nodeRequire.resolve('../packages/capabilities/src/guard.ts'), 'utf-8')
    expect(src).not.toMatch(/\?\./)
    expect(src).not.toMatch(/\?\?/)
    expect(src).not.toMatch(/\.\.\./)
    // 解构（数组/对象）检测：matchPlatform 里没有解构赋值
    expect(src).not.toMatch(/const\s*\{\s*[a-zA-Z]/)
  })
})
