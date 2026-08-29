// tests/security.test.ts
// ★security-plan B1-B2：SecretStorage（加密 round-trip / volatile 跳过 / redact / migrate / 可序列化校验）+ PermissionRegistry（withPermission / PermissionDenied / 持久化）
import { describe, it, expect, vi } from 'vitest'
import { SecretStorage, createDemoCipher, createWebCipher, PermissionRegistry, PermissionDenied, permissionFor, withPermission } from '../packages/security/src'
import type { StorageLike } from '../packages/security/src'

/** 内存 storage（可断言写入次数） */
function makeStorage(): StorageLike & { writes: string[] } {
  const map = new Map<string, string>()
  const writes: string[] = []
  return {
    writes,
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v)
      writes.push(k)
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
}

const FIELDS = {
  token: { value: '', volatile: true },
  profile: { value: {}, encrypted: true },
  settings: { value: {} },
}

describe('SecretStorage（M1）', () => {
  it('加密 round-trip：getItem 还原一致，密文与明文不同', async () => {
    const storage = makeStorage()
    const { cipher } = await createCipherFor('secret-1')
    const s = new SecretStorage({ storage, fields: FIELDS, cipher })
    await s.setItem('user', { token: 't', profile: { name: 'P', age: 3 }, settings: { theme: 'dark' } })
    const raw = storage.getItem('user') as string
    expect(raw).not.toContain('P') // profile 密文，明文不可见
    const state = await s.getItem('user')
    expect(state?.profile).toEqual({ name: 'P', age: 3 })
    expect(state?.settings).toEqual({ theme: 'dark' })
    expect(state?.token).toBeUndefined() // volatile 不还原
  })

  it('volatile 字段不写盘（mock storage 断言）', async () => {
    const storage = makeStorage()
    const { cipher } = await createCipherFor('secret-2')
    const s = new SecretStorage({ storage, fields: FIELDS, cipher })
    await s.setItem('user', { token: 't', profile: { p: 1 }, settings: {} })
    const raw = storage.getItem('user') as string
    expect(raw).not.toContain('"token"')
    expect(raw).not.toContain('"t"')
  })

  it('不可序列化字段（Function）→ 抛错（M1 校验）', async () => {
    const storage = makeStorage()
    const { cipher } = await createCipherFor('secret-3')
    const s = new SecretStorage({ storage, fields: FIELDS, cipher })
    await expect(
      s.setItem('user', { token: 't', profile: { fn: () => 1 }, settings: {} }),
    ).rejects.toThrow(/不可序列化|Function/)
  })

  it('redact：encrypted 字段 → ***，明文保留', async () => {
    const storage = makeStorage()
    const { cipher } = await createCipherFor('secret-4')
    const s = new SecretStorage({ storage, fields: FIELDS, cipher })
    const out = s.redact({ token: 't', profile: { a: 1 }, settings: { theme: 'dark' } })
    expect(out.profile).toBe('***')
    expect(out.settings).toEqual({ theme: 'dark' })
  })

  it('无 cipher → encrypted 字段明文降级 + warn（生产禁止）', async () => {
    const storage = makeStorage()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const s = new SecretStorage({ storage, fields: FIELDS, cipher: null })
      await s.setItem('user', { profile: { a: 1 }, settings: {} })
      expect(storage.getItem('user')).toContain('"a":1') // 明文
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('SecretStorage migrate（M1 §4）', () => {
  it('旧明文（无 __v）→ 加密写回；已是 v1 → 不迁移', async () => {
    const storage = makeStorage()
    const { cipher } = await createCipherFor('migrate-1')
    // 旧明文数据（无 __v）
    storage.setItem('user', JSON.stringify({ profile: { name: 'legacy' }, settings: {} }))
    const s = new SecretStorage({ storage, fields: FIELDS, cipher })
    const r = await s.migrate('user')
    expect(r.migrated).toBe(true)
    const raw = storage.getItem('user') as string
    expect(raw).toContain('__v')
    expect(raw).not.toContain('legacy') // 已加密
    // 二次迁移 → 已是 v1
    expect((await s.migrate('user')).migrated).toBe(false)
  })

  it('解密失败 → 清除不崩溃', async () => {
    const storage = makeStorage()
    const { cipher } = await createCipherFor('migrate-2')
    storage.setItem('user', JSON.stringify({ profile: { name: 'x' }, settings: {} }))
    // migrate 只加密不解密：模拟 encrypt 失败（crypto 不可用）→ 清除
    const broken = new SecretStorage({
      storage,
      fields: FIELDS,
      cipher: { encrypt: async () => { throw new Error('bad') }, decrypt: async () => 'x' },
    })
    const r = await broken.migrate('user')
    expect(r.migrated).toBe(false)
    expect(r.reason).toBe('crypto-fail')
    expect(storage.getItem('user')).toBeNull() // 已清除
  })
})

describe('PermissionRegistry（M3）', () => {
  const CAMERA = permissionFor('camera', 'use')

  it('has/hasAll/grant/revoke/clear', () => {
    const r = new PermissionRegistry()
    expect(r.has(CAMERA)).toBe(false)
    r.grant([CAMERA, 'user:read'])
    expect(r.has(CAMERA)).toBe(true)
    expect(r.hasAll(['camera:use', 'user:read'])).toBe(true)
    expect(r.hasAll(['camera:use', 'trade:create'])).toBe(false)
    r.revoke([CAMERA])
    expect(r.has(CAMERA)).toBe(false)
    r.grant([CAMERA])
    r.clear()
    expect(r.hasAll([CAMERA, 'user:read'])).toBe(false)
  })

  it('withPermission：缺权限 → PermissionDenied（含权限名）；授权后通过', async () => {
    const r = new PermissionRegistry()
    let called = false
    await expect(withPermission(r, [CAMERA], async () => { called = true })).rejects.toBeInstanceOf(PermissionDenied)
    await expect(withPermission(r, [CAMERA], () => undefined)).rejects.toThrow(/camera:use/)
    expect(called).toBe(false) // 未执行 fn
    r.grant([CAMERA])
    const v = await withPermission(r, [CAMERA], () => 42)
    expect(v).toBe(42)
  })

  it('granted 持久化：storage 恢复 + grant 落盘（只存 key 不存凭证）', () => {
    const storage = makeStorage()
    const r = new PermissionRegistry({ storage, initial: [CAMERA] })
    r.grant(['user:read'])
    const raw = storage.getItem('proteus.permissions') as string
    expect(raw).toContain('camera:use')
    expect(raw).not.toContain('token')
    const r2 = new PermissionRegistry({ storage })
    expect(r2.hasAll([CAMERA, 'user:read'])).toBe(true)
  })

  it('request：grantFn 授权结果分流 granted/denied', async () => {
    const r = new PermissionRegistry()
    const res = await r.request([CAMERA, 'user:read'], (p) => p === CAMERA)
    expect(res.granted).toEqual([CAMERA])
    expect(res.denied).toEqual(['user:read'])
    expect(r.has(CAMERA)).toBe(true)
    expect(r.has('user:read')).toBe(false)
  })
})

/** 测试用：优先 WebCrypto（Node 20+ 有），无则 DemoCipher */
async function createCipherFor(pass: string): Promise<{ cipher: { encrypt(plain: string): Promise<string>; decrypt(s: string): Promise<string> } }> {
  const g = globalThis as { crypto?: { subtle?: unknown } }
  if (g.crypto && g.crypto.subtle) {
    return { cipher: await createWebCipher(pass) }
  }
  return { cipher: createDemoCipher(pass) }
}
