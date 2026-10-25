// tests/capability-app-filesystem.test.ts —— ★★★#1226 `getFileSystem` 基础面判据
//
// 【判据要点（不是"能调用"就算过）】
//   ① 基础面 4 个方法**真的走到宿主**（断言 payload，不是"Promise resolve 了"）；
//   ② **其余 22 个必须显式 unsupported 且带具体原因**（不许静默 undefined、不许假实现）；
//   ③ `APP_FS_UNSUPPORTED` 与 `FileSystemBridge` 的方法集对得上 —— 契约有 26 个方法，
//      基础面 4 + 未支持 22 = 26（少一个就说明"漏登记"= 用户会遇到 undefined 调用）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: Array<{ method: string; args: unknown }> = []
let hostResult: { ok: true; data: unknown } | { ok: false; reason: string; missing: boolean } = { ok: true, data: {} }

vi.mock('../packages/api/src/capability-invoke', () => ({
  invokeHost: (method: string, args?: unknown) => {
    calls.push({ method, args })
    return hostResult
  },
}))

describe('★★★App 能力批 1 · getFileSystem 基础面（#1226）', () => {
  beforeEach(() => {
    calls.length = 0
    hostResult = { ok: true, data: {} }
  })

  it('① writeFile / readFile / remove / exists 都真的走到宿主 fs.*', async () => {
    const { createAppFileSystem } = await import('../packages/api/src/capability-app-filesystem')
    const fs = createAppFileSystem().getFileSystem!()

    hostResult = { ok: true, data: {} }
    await fs.writeFile('a/b.txt', 'hi')
    expect(calls.some((c) => c.method === 'fs.writeBytes')).toBe(true)

    hostResult = { ok: true, data: { bytes: [104, 105], size: 2 } }
    const text = await fs.readFile('a/b.txt')
    expect(text, 'UTF-8 解码正确').toBe('hi')

    hostResult = { ok: true, data: {} }
    await fs.remove('a/b.txt')
    expect(calls.some((c) => c.method === 'fs.remove')).toBe(true)

    hostResult = { ok: true, data: { exists: true } }
    expect(await fs.exists('a/b.txt')).toBe(true)
    expect(calls.some((c) => c.method === 'fs.exists')).toBe(true)
  })

  it('② exists 的布尔来自宿主（不是恒 true/false）', async () => {
    const { createAppFileSystem } = await import('../packages/api/src/capability-app-filesystem')
    const fs = createAppFileSystem().getFileSystem!()
    hostResult = { ok: true, data: { exists: false } }
    expect(await fs.exists('nope')).toBe(false)
    hostResult = { ok: true, data: { exists: true } }
    expect(await fs.exists('yes')).toBe(true)
  })

  it('③ 其余方法**显式 unsupported 且原因具体**（不静默、不假实现）', async () => {
    const { createAppFileSystem, APP_FS_UNSUPPORTED } = await import('../packages/api/src/capability-app-filesystem')
    const fs = createAppFileSystem().getFileSystem!() as unknown as Record<string, () => Promise<unknown>>
    const names = Object.keys(APP_FS_UNSUPPORTED)
    expect(names.length, '未支持方法数（目录面完成后 18 个）').toBe(18)
    for (const n of names) {
      expect(typeof fs[n], `${n} 必须是函数（不是 undefined）`).toBe('function')
      await expect(fs[n]!()).rejects.toThrow(/file-system\.unsupported/)
      await expect(fs[n]!()).rejects.toThrow(new RegExp(n))
    }
  })

  it('④ 方法集自洽：基础面 4 + 未支持 22 = FileSystemBridge 的 26 个方法', async () => {
    const { APP_FS_BASE_METHODS, APP_FS_UNSUPPORTED } = await import('../packages/api/src/capability-app-filesystem')
    const total = APP_FS_BASE_METHODS.length + Object.keys(APP_FS_UNSUPPORTED).length
    // ★写死 26 是为了让"契约新增方法却没登记"当场红（比读类型更硬——类型在运行时读不到）
    expect(total, '基础面 + 未支持 必须覆盖 FileSystemBridge 的全部方法').toBe(26)
    expect(APP_FS_BASE_METHODS.length, '★#1227 目录面后基础面 = 8（读写存删 + stat/readdir/mkdir/rmdir）').toBe(8)
  })

  it('⑤ appendFile 明确归 unsupported（读全文拼接再整写会在并发下丢数据）', async () => {
    const { APP_FS_UNSUPPORTED } = await import('../packages/api/src/capability-app-filesystem')
    expect(APP_FS_UNSUPPORTED.appendFile, 'appendFile 有具名理由').toMatch(/并发/)
  })
})
