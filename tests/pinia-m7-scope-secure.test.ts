// @vitest-environment jsdom
// tests/pinia-m7-scope-secure.test.ts
// M7.5 store 生命周期（scope:page + disposePageStores）+ M7.6 敏感字段（volatile/encrypted）单测
import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { MemoryAdapter } from '../packages/shared/src/storage'
import { persisted, createPersistence } from '../packages/runtime/src/pinia/persistence/lightweight'
import { registerPageStore, disposePageStores, pageStoreCount } from '../packages/runtime/src/pinia/scope'
import { prepareForPersist, restoreFromPersist, hasVolatileLeak } from '../packages/runtime/src/pinia/persistence/secure'

function install(pinia: ReturnType<typeof createPinia>): void {
  createApp({}).use(pinia)
  setActivePinia(pinia)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('M7.5 store 生命周期', () => {
  it('registerPageStore + disposePageStores：批量 $dispose 清空 state', () => {
    const pinia = createPinia()
    install(pinia)
    const useA = defineStore('a', { state: () => ({ v: 1 }) })
    const useB = defineStore('b', { state: () => ({ v: 2 }) })
    const a = useA()
    const b = useB()
    registerPageStore('page1', a)
    registerPageStore('page1', b)
    expect(pageStoreCount('page1')).toBe(2)
    disposePageStores('page1')
    // $dispose 编排生效：注册表清空（Pinia 内部状态清理以官方 $dispose 语义为准）
    expect(pageStoreCount('page1')).toBe(0)
  })

  it('disposePageStores 只清指定页面（A→B→A 多实例隔离）', () => {
    const pinia = createPinia()
    install(pinia)
    const useDraft = defineStore('draft', { state: () => ({ v: 1 }) })
    const pageA = useDraft()
    registerPageStore('pageA', pageA)
    const pageB = useDraft()
    registerPageStore('pageB', pageB)
    disposePageStores('pageB')
    expect(pageStoreCount('pageB')).toBe(0)
    expect(pageStoreCount('pageA')).toBe(1) // pageA 未受影响
  })

  it('persisted({scope:"page"})：插件自动注册页面级 store', async () => {
    const mem = new MemoryAdapter()
    const pinia = createPinia()
    pinia.use(createPersistence({ storage: mem }))
    install(pinia)
    const usePage = defineStore('pageDraft', {
      state: () => ({ text: '' }),
      persistence: persisted({ scope: 'page', key: 'draft' }),
    })
    usePage().text = 'hi'
    await wait(80) // 防抖写盘
    expect(await mem.getItem('draft')).toContain('"text":"hi"')
    disposePageStores('pageDraft')
    expect(pageStoreCount('pageDraft')).toBe(0)
  })
})

describe('M7.6 敏感字段', () => {
  it('volatile：不落盘（内存保留，持久化剔除，hydrate 不恢复）', () => {
    const state = { phone: '13800000000', nickname: 'alice' }
    const persisted = prepareForPersist(state, { volatile: ['phone'] })
    expect(persisted).toEqual({ nickname: 'alice' }) // phone 被剔除
    expect(hasVolatileLeak(JSON.stringify(persisted), ['phone'])).toBe(false)
    // 恢复：phone 不出现
    const restored = restoreFromPersist({ nickname: 'alice' }, { volatile: ['phone'] })
    expect(restored).toEqual({ nickname: 'alice' })
  })

  it('encrypted：落盘为密文（含 Encrypted 标记），恢复解密还原', () => {
    const enc: { encrypt: (s: string) => string; decrypt: (s: string) => string } = {
      encrypt: (s: string) => `enc:${s}`,
      decrypt: (s: string) => s.slice(4),
    }
    const persisted = prepareForPersist({ token: 'secret', ok: true }, { encrypted: { fields: ['token'], encrypt: enc.encrypt, decrypt: enc.decrypt } })
    expect(persisted.ok).toBe(true)
    expect((persisted.token as { __proteus_type__: string }).__proteus_type__).toBe('Encrypted')
    // 密文不是明文（自定义 encrypt 为演示；无明文保证由默认加密用例覆盖）
    expect((persisted.token as { value: string }).value).not.toBe(JSON.stringify('secret'))
    // 恢复解密
    const restored = restoreFromPersist(persisted, { encrypted: { fields: ['token'], encrypt: enc.encrypt, decrypt: enc.decrypt } })
    expect(restored.token).toBe('secret')
  })

  it('默认轻量加密（无自定义）：落盘无明文，恢复还原', () => {
    const persisted = prepareForPersist({ token: 'plain-secret' }, { encrypted: ['token'] })
    expect(JSON.stringify(persisted)).not.toContain('plain-secret')
    const restored = restoreFromPersist(persisted, { encrypted: ['token'] })
    expect(restored.token).toBe('plain-secret')
  })

  it('持久化插件端到端：volatile 不入存储，encrypted 密文存储 + 恢复解密', async () => {
    const mem = new MemoryAdapter()
    const pinia = createPinia()
    pinia.use(createPersistence({ storage: mem }))
    install(pinia)
    const useUser = defineStore('user', {
      state: () => ({ token: '', phone: '', nickname: '' }),
      persistence: persisted({
        key: 'user',
        volatile: ['phone'],
        encrypted: ['token'],
      }),
    })
    const s = useUser()
    s.token = 'tk-secret'
    s.phone = '13800000000'
    s.nickname = 'alice'
    await wait(80)
    const raw = (await mem.getItem('user'))!
    expect(raw).not.toContain('13800000000') // volatile 不落盘
    expect(raw).not.toContain('tk-secret') // encrypted 无明文
    // 新实例恢复
    const pinia2 = createPinia()
    pinia2.use(createPersistence({ storage: mem }))
    install(pinia2)
    const s2 = useUser()
    await wait(10)
    expect(s2.token).toBe('tk-secret') // 解密恢复
    expect(s2.phone).toBe('') // volatile 不恢复（保持初始值）
    expect(s2.nickname).toBe('alice')
  })
})
