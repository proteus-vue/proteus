// tests/state-snapshot.test.ts —— @proteus-vue/devtools-runtime 状态快照 + 时间旅行（devtools-plan M4/B4）
// export：收集非 volatile store + redact 敏感键 + 循环引用标记 + route/meta
// serialize/deserialize：Date/Map/Set/BigInt 往返 + 循环引用不栈溢出
// import：校验 version + 按 id 还原
// recordPatch/timeTravel：步骤记录（before/after）+ 环形缓冲 + 回放到第 i 步
import { describe, it, expect } from 'vitest'
import { createStateSnapshotter, serializeState, deserializeState } from '@proteus-vue/devtools-runtime'
import type { SnapshotStoreLike, StateSnapshot } from '@proteus-vue/devtools-runtime'

function makeStore(id: string, initial: Record<string, unknown>, volatile = false): SnapshotStoreLike {
  let state = initial
  return {
    id,
    volatile,
    readState: () => state,
    writeState: (s) => {
      state = s
    },
  }
}

describe('序列化：type tag 还原 + 循环引用', () => {
  it('Date/Map/Set/BigInt 往返还原', () => {
    const raw = {
      d: new Date('2026-01-01T00:00:00Z'),
      m: new Map([['k', 1]]),
      s: new Set(['a', 'b']),
      b: 12345678901234567890n,
      n: 42,
    }
    const ser = serializeState(raw)
    const des = deserializeState(ser) as typeof raw
    expect(des.d).toBeInstanceOf(Date)
    expect((des.d as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(des.m instanceof Map).toBe(true)
    expect((des.m as Map<string, number>).get('k')).toBe(1)
    expect(des.s instanceof Set).toBe(true)
    expect((des.s as Set<string>).has('a')).toBe(true)
    expect(des.b).toBe(12345678901234567890n)
    expect(des.n).toBe(42)
  })

  it('循环引用 → 标记降级（不栈溢出）', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    const ser = serializeState(a)
    const des = deserializeState(ser) as Record<string, unknown>
    expect(des.name).toBe('a')
    expect(des.self).toBeUndefined() // 循环标记还原为 undefined
  })

  it('嵌套对象/数组递归', () => {
    const ser = serializeState({ list: [{ x: 1 }], nested: { deep: [true, null, 's'] } })
    expect(deserializeState(ser)).toEqual({ list: [{ x: 1 }], nested: { deep: [true, null, 's'] } })
  })
})

describe('StateSnapshotter：export / import', () => {
  it('export 收集非 volatile store + route/meta；volatile 不参与', () => {
    const s = createStateSnapshotter({
      stores: () => [makeStore('user', { name: 'proteus', token: 'secret' }), makeStore('cart', { items: [] }, true)],
      route: () => ({ path: '/pages/cart', query: { q: '1' } }),
      meta: () => ({ platform: 'web' }),
    })
    const snap = s.export()
    expect(snap.version).toBe(1)
    expect(snap.takenAt).toBeGreaterThan(0)
    expect(snap.stores.length).toBe(1) // cart volatile 被过滤
    expect(snap.stores[0].id).toBe('user')
    expect(snap.route).toEqual({ path: '/pages/cart', query: { q: '1' } })
    expect(snap.meta).toEqual({ platform: 'web' })
  })

  it('export redact 敏感键（token → 脱敏）', () => {
    const s = createStateSnapshotter({ stores: () => [makeStore('user', { name: 'proteus', token: 's3cret' })] })
    const snap = s.export()
    const state = snap.stores[0].state as Record<string, unknown>
    expect(state.name).toBe('proteus')
    expect(String(state.token)).not.toBe('s3cret') // 已脱敏
  })

  it('import 还原 store（含 Date 还原）；version 不兼容抛错', () => {
    const user = makeStore('user', { name: 'old' })
    const s = createStateSnapshotter({ stores: () => [user] })
    const snap: StateSnapshot = { version: 1, takenAt: Date.now(), stores: [{ id: 'user', state: { name: 'new', d: serializeState(new Date('2026-05-01T00:00:00Z')) } }] }
    s.import(snap)
    expect(user.readState().name).toBe('new')
    expect((user.readState().d as Date).toISOString()).toBe('2026-05-01T00:00:00.000Z')
    expect(() => s.import({ version: 2, takenAt: 0, stores: [] } as never)).toThrow(/版本不兼容/)
  })
})

describe('StateSnapshotter：时间旅行', () => {
  it('recordPatch 记录 before/after + index 递增', () => {
    const counter = makeStore('counter', { count: 0 })
    const s = createStateSnapshotter({ stores: () => [counter] })
    counter.writeState({ count: 1 })
    s.recordPatch('counter', 'patch', { count: 1 })
    counter.writeState({ count: 2 })
    s.recordPatch('counter', 'mutation', { count: 2 })
    const steps = s.steps()
    expect(steps.length).toBe(2)
    expect(steps[0]).toMatchObject({ index: 0, storeId: 'counter', type: 'patch' })
    expect(steps[1]).toMatchObject({ index: 1, storeId: 'counter', type: 'mutation' })
    expect(steps[0].after.count).toBe(1)
    expect(steps[1].after.count).toBe(2)
  })

  it('timeTravel(i) 回放到第 i 步后的状态（各 store 取最后一条 after）', () => {
    const counter = makeStore('counter', { count: 0 })
    const user = makeStore('user', { name: 'a' })
    const s = createStateSnapshotter({ stores: () => [counter, user] })
    counter.writeState({ count: 1 })
    s.recordPatch('counter', 'patch', { count: 1 })
    counter.writeState({ count: 2 })
    s.recordPatch('counter', 'patch', { count: 2 })
    user.writeState({ name: 'b' })
    s.recordPatch('user', 'mutation', { name: 'b' })
    counter.writeState({ count: 3 })
    s.recordPatch('counter', 'patch', { count: 3 })
    // 回放到 step 2（user 变更后）：counter = step1 的 after(2)，user = step2 的 after(b)
    s.timeTravel(2)
    expect(counter.readState().count).toBe(2)
    expect(user.readState().name).toBe('b')
    // 回放到 step 0：counter = 1，user 无步骤 → 不变
    s.timeTravel(0)
    expect(counter.readState().count).toBe(1)
    expect(user.readState().name).toBe('b')
  })

  it('timeTravel 越界抛错；clearSteps 重置', () => {
    const s = createStateSnapshotter({ stores: () => [makeStore('a', {})] })
    expect(() => s.timeTravel(0)).toThrow(/越界/)
    s.recordPatch('a', 'patch', {})
    s.clearSteps()
    expect(s.steps().length).toBe(0)
    expect(() => s.timeTravel(0)).toThrow(/越界/)
  })

  it('步骤环形缓冲上限（bufferSize 裁剪）', () => {
    const a = makeStore('a', { n: 0 })
    const s = createStateSnapshotter({ stores: () => [a], bufferSize: 3 })
    for (let i = 1; i <= 5; i++) {
      a.writeState({ n: i })
      s.recordPatch('a', 'patch', { n: i })
    }
    const steps = s.steps()
    expect(steps.length).toBe(3)
    expect(steps[0].index).toBe(2) // 最旧两条被裁剪（index 保持原值）
    expect(steps[2].after.n).toBe(5)
  })

  it('未知 storeId 的 patch 忽略', () => {
    const s = createStateSnapshotter({ stores: () => [makeStore('a', {})] })
    s.recordPatch('ghost', 'patch', {})
    expect(s.steps().length).toBe(0)
  })
})
