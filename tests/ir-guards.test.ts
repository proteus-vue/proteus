// tests/ir-guards.test.ts
// ★types-plus-plan B5（05 §2）：IR 守卫运行时单测（isRouteIR/isStoreIR/isSFCIR + assert 抛错含错误码）
import { describe, expect, it } from 'vitest'
import {
  IR_GUARD_ERROR_CODES,
  assertRouteIR,
  assertStoreIR,
  isRouteIR,
  isSFCIR,
  isStoreIR,
} from '@proteus-vue/types'

describe('isRouteIR', () => {
  it('合法 RouteIR（path 必填 string）', () => {
    expect(isRouteIR({ path: '/pages/user', name: 'user' })).toBe(true)
    expect(isRouteIR({ path: '/pages/user', component: '/pages/user/index' })).toBe(true)
  })
  it('非法：缺 path / path 非 string / component 非 string', () => {
    expect(isRouteIR({ name: 'user' })).toBe(false)
    expect(isRouteIR({ path: 42 })).toBe(false)
    expect(isRouteIR({ path: '/pages/user', component: 42 })).toBe(false)
    expect(isRouteIR(null)).toBe(false)
  })
})

describe('isStoreIR', () => {
  it('合法 StoreIR（id 必填 string；version 可选 number）', () => {
    expect(isStoreIR({ id: 'player', version: 1 })).toBe(true)
    expect(isStoreIR({ id: 'player' })).toBe(true)
  })
  it('非法：缺 id / id 非 string / version 非 number', () => {
    expect(isStoreIR({ version: 1 })).toBe(false)
    expect(isStoreIR({ id: 7 })).toBe(false)
    expect(isStoreIR({ id: 'player', version: '1' })).toBe(false)
  })
})

describe('isSFCIR', () => {
  it('合法 SFCIR（styles 必填数组）', () => {
    expect(isSFCIR({ styles: [] })).toBe(true)
    expect(isSFCIR({ template: {}, script: {}, styles: [{}], customBlocks: { route: {} } })).toBe(true)
  })
  it('非法：缺 styles / styles 非数组', () => {
    expect(isSFCIR({})).toBe(false)
    expect(isSFCIR({ styles: 'x' })).toBe(false)
  })
})

describe('assert 版（05 §3 错误码 + 定位）', () => {
  it('assertRouteIR 失败抛错含 IR_INVALID_ROUTE + source', () => {
    expect(() => assertRouteIR({ name: 'x' }, 'pages/user/index.vue')).toThrow(/IR_INVALID_ROUTE.*pages\/user\/index\.vue/)
  })
  it('assertStoreIR 成功不抛 / 失败抛 IR_INVALID_STORE', () => {
    expect(() => assertStoreIR({ id: 'player' })).not.toThrow()
    expect(() => assertStoreIR({})).toThrow(IR_GUARD_ERROR_CODES.IR_INVALID_STORE)
  })
  it('错误码常量可枚举', () => {
    expect(IR_GUARD_ERROR_CODES.IR_INVALID_ROUTE).toBe('IR_INVALID_ROUTE')
    expect(Object.keys(IR_GUARD_ERROR_CODES)).toHaveLength(3)
  })
})
