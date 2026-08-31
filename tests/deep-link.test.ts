// tests/deep-link.test.ts
// ★router-plus G-32 M4：Deep Link（04-deep-link.md：解析 + pattern 匹配 + 白名单 + 冷启动栈）
import { describe, expect, it } from 'vitest'
import {
  parseDeepLinkUrl,
  matchPattern,
  isDeepLinkAllowed,
  resolveDeepLink,
  buildColdStartStack,
} from '../packages/router/src/deep-link'
import type { DeepLinkConfig } from '../packages/router/src/deep-link'

const CONFIG: DeepLinkConfig = {
  scheme: 'proteusdemo',
  host: 'app.proteus.vue',
  universalLinks: ['https://app.proteus.vue/*'],
  routes: [
    { pattern: '/product/:id', path: '/detail/:id' },
    { pattern: '/user/:id/order/:oid', path: '/order/detail' },
  ],
}

describe('parseDeepLinkUrl（手写 URL 解析，小程序无 URL 类）', () => {
  it('custom scheme + host + path + query', () => {
    const p = parseDeepLinkUrl('proteusdemo://app.proteus.vue/product/42?from=share&kw=a%20b')
    expect(p.scheme).toBe('proteusdemo')
    expect(p.host).toBe('app.proteus.vue')
    expect(p.pathname).toBe('/product/42')
    expect(p.query).toEqual({ from: 'share', kw: 'a b' }) // decodeURIComponent
  })

  it('无 host / 无 query 边界', () => {
    expect(parseDeepLinkUrl('proteusdemo:///product/1').host).toBe('')
    expect(parseDeepLinkUrl('proteusdemo://app/x').query).toEqual({})
  })
})

describe('matchPattern（04 §5 pattern 映射）', () => {
  it(':param 提取 + 字面段匹配', () => {
    expect(matchPattern('/product/:id', '/product/42')).toEqual({ id: '42' })
    expect(matchPattern('/product/:id', '/product/a/b')).toBeNull() // 段数不符
    expect(matchPattern('/product/:id', '/other/42')).toBeNull() // 字面段不匹配
  })

  it('多参数', () => {
    expect(matchPattern('/user/:id/order/:oid', '/user/7/order/9')).toEqual({ id: '7', oid: '9' })
  })
})

describe('resolveDeepLink（白名单 + pattern → ResolvedRoute）', () => {
  it('合法 scheme + host + pattern → path/params/query', () => {
    const r = resolveDeepLink('proteusdemo://app.proteus.vue/product/42?from=share', CONFIG)
    expect(r).toEqual({ path: '/detail/:id', params: { id: '42' }, query: { from: 'share' }, stack: 'push' })
  })

  it('白名单拒绝：错误 scheme / host → null', () => {
    expect(resolveDeepLink('evil://app.proteus.vue/product/1', CONFIG)).toBeNull()
    expect(resolveDeepLink('proteusdemo://evil.com/product/1', CONFIG)).toBeNull()
  })

  it('universal link（https host 通配）', () => {
    const r = resolveDeepLink('https://app.proteus.vue/user/7/order/9', CONFIG)
    expect(r?.path).toBe('/order/detail')
    expect(r?.params).toEqual({ id: '7', oid: '9' })
  })

  it('无匹配 pattern → null', () => {
    expect(resolveDeepLink('proteusdemo://app.proteus.vue/unknown', CONFIG)).toBeNull()
  })
})

describe('buildColdStartStack（04 §3 冷启动构造初始栈）', () => {
  it('祖先链（存在时）→ 多层栈', () => {
    const stack = buildColdStartStack('/a/b/c', ['/a', '/a/b', '/a/b/c'])
    expect(stack).toEqual(['/a', '/a/b', '/a/b/c'])
  })

  it('祖先不在路由表 → 直达（单层）', () => {
    expect(buildColdStartStack('/a/b/c', ['/x', '/a/b/c'])).toEqual(['/a/b/c'])
  })
})
