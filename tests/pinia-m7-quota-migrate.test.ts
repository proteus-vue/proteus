// @vitest-environment jsdom
// tests/pinia-m7-quota-migrate.test.ts
// M7.3 配额淘汰（protected 优先）+ M7.4 版本迁移（链式/失败兜底）单测
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { MemoryAdapter, serialize, deserialize } from '../packages/shared/src/storage'
import { persisted, createPersistence } from '../packages/runtime/src/pinia/persistence/lightweight'
import { QuotaManager, QuotaExceededError } from '../packages/runtime/src/pinia/persistence/quota'
import { parseVersioned, runMigrations, serializeWithVersion } from '../packages/runtime/src/pinia/persistence/migrate'

function install(pinia: ReturnType<typeof createPinia>): void {
  createApp({}).use(pinia)
  setActivePinia(pinia)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('M7.3 配额与淘汰', () => {
  it('超阈值触发淘汰：protected key 保留，非 protected 被清', async () => {
    const mem = new MemoryAdapter()
    const quota = new QuotaManager(mem, { warnAt: 0.5, maxBytes: 1500, protectedKeys: ['token'] })
    const evicted: string[] = []
    quota.onEvict = (ev) => void evicted.push(ev.key)
    // recordWrite 只记账（写盘由 scheduler 负责）→ 测试先 setItem 模拟真实写盘
    await mem.setItem('hist', 'y'.repeat(200))
    await quota.recordWrite('hist', 'y'.repeat(200)) // 400B
    await mem.setItem('token', 'x'.repeat(200))
    await quota.recordWrite('token', 'x'.repeat(200)) // 400B（protected）
    await mem.setItem('big', 'z'.repeat(500))
    await quota.recordWrite('big', 'z'.repeat(500)) // 1000B → 总 1800B > 750 阈值 → 淘汰
    // 淘汰顺序：hist（最久）→ big；剩 token（protected）400B ≤ 750 停止
    expect(evicted).toEqual(['hist', 'big'])
    expect(await mem.getItem('token')).not.toBeNull() // protected 保留
    expect(await mem.getItem('hist')).toBeNull() // 非 protected 被清
  })

  it('protected 全满仍超阈值 → 抛 QuotaExceededError', async () => {
    const mem = new MemoryAdapter()
    await mem.setItem('token', 'a'.repeat(400))
    const quota = new QuotaManager(mem, { warnAt: 0.5, maxBytes: 500, protectedKeys: ['token'] })
    await expect(quota.recordWrite('other', 'b'.repeat(400))).rejects.toBeInstanceOf(QuotaExceededError)
    expect(await mem.getItem('token')).not.toBeNull() // protected 未被误删
  })

  it('单 key 超限直接抛错，不走淘汰', async () => {
    const mem = new MemoryAdapter()
    await mem.setItem('keep', 'v')
    const quota = new QuotaManager(mem, { maxBytes: 100 })
    await expect(quota.recordWrite('huge', 'x'.repeat(1000))).rejects.toBeInstanceOf(QuotaExceededError)
    expect(await mem.getItem('keep')).toBe('v') // 其他数据未被误删
  })

  it('持久化插件接入配额：写盘后淘汰（全局 quota 账本一致）', async () => {
    const mem = new MemoryAdapter()
    const pinia = createPinia()
    pinia.use(createPersistence({ storage: mem, quota: { warnAt: 0.5, maxBytes: 2000 } }))
    install(pinia)
    const useA = defineStore('a', { state: () => ({ v: '' }), persistence: persisted({ key: 'a' }) })
    const useB = defineStore('b', { state: () => ({ v: '' }), persistence: persisted({ key: 'b' }) })
    useA().v = 'x'.repeat(300) // ~600B
    useB().v = 'y'.repeat(300) // ~600B
    await wait(150) // flush → quota 检查：1200B > 1000 阈值 → 淘汰最久（a）
    const keys = await mem.keys()
    expect(keys).toEqual(['b']) // a 被淘汰，b 保留
    expect(await mem.getItem('a')).toBeNull()
  })
})

describe('M7.4 版本迁移', () => {
  it('parseVersioned：无版本标记 → version 0 + 裸 state（兼容旧格式）', () => {
    const raw = serialize({ name: 'old' })
    const parsed = parseVersioned(raw)
    expect(parsed.version).toBe(0)
    expect(parsed.state).toEqual({ name: 'old' })
  })

  it('serializeWithVersion：version 0 不包裹，version>0 携带标记', () => {
    expect(serializeWithVersion({ a: 1 }, 0)).toBe(serialize({ a: 1 }))
    const raw = serializeWithVersion({ a: 1 }, 3)
    expect(parseVersioned(raw).version).toBe(3)
  })

  it('迁移链：1→3 = 1→2→3 逐条执行', () => {
    const migrations = [
      { from: 1, to: 2, up: (s: Record<string, unknown>) => { s.name = s.userName; delete s.userName; return s } },
      { from: 2, to: 3, up: (s: Record<string, unknown>) => { s.vip = false; return s } },
    ]
    const r = runMigrations({ version: 1, state: { userName: 'alice' } }, 3, migrations)
    expect(r).not.toBeNull()
    expect(r!.state).toEqual({ name: 'alice', vip: false })
    expect(r!.migratedFrom).toBe(1)
  })

  it('迁移失败 → 返回 null（丢弃旧数据走初始值，不崩溃）', () => {
    const migrations = [
      { from: 1, to: 2, up: () => { throw new Error('boom') } },
    ]
    const r = runMigrations({ version: 1, state: { a: 1 } }, 2, migrations)
    expect(r).toBeNull()
  })

  it('数据版本高于当前 schema → 丢弃（不猜测旧格式）', () => {
    const r = runMigrations({ version: 5, state: { a: 1 } }, 2, [])
    expect(r).toBeNull()
  })

  it('持久化插件 hydrate 执行迁移：v1 旧数据恢复为 v2 schema', async () => {
    const mem = new MemoryAdapter()
    await mem.setItem('user', serializeWithVersion({ userName: 'bob' }, 1))
    const pinia = createPinia()
    pinia.use(createPersistence({ storage: mem }))
    install(pinia)
    const useUser = defineStore('user', {
      state: () => ({ name: '', vip: false }),
      persistence: persisted({
        key: 'user',
        version: 2,
        migrations: [
          { from: 1, to: 2, up: (s: Record<string, unknown>) => { s.name = s.userName; delete s.userName; s.vip = false; return s } },
        ],
      }),
    })
    const s = useUser()
    await wait(10)
    expect(s.name).toBe('bob')
    expect(s.vip).toBe(false)
  })
})
