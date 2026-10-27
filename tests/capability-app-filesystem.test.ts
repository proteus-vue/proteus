// tests/capability-app-filesystem.test.ts —— ★★★`getFileSystem` 判据（#1226 基础面 → #1237 追平）
//
// 【判据要点（不是"能调用"就算过）】
//   ① 每个方法**真的走到宿主**（断言 payload / 方法名，不是"Promise resolve 了"）；
//   ② `APP_FS_UNSUPPORTED` 与 `FileSystemBridge` 的方法集对得上 —— 契约有 26 个方法，
//      已实现 + 未支持 = 26（少一个就说明"漏登记"= 用户会遇到 undefined 调用）；
//   ③ ★#1237 之后 unsupported 表**必须为空**：26 个方法全部有真实现（含原生追加）。
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

  it('③ 没有 unsupported 残留：26 个契约方法全部有真实现（#1237）', async () => {
    const { APP_FS_UNSUPPORTED } = await import('../packages/api/src/capability-app-filesystem')
    // ★表保留但必须为空（门禁按"表里有什么 ⇒ 就是 unsupported"读，删符号会让它失明）
    expect(Object.keys(APP_FS_UNSUPPORTED), '不应再有 unsupported 方法（含异步 appendFile 已走原生追加）').toEqual([])
  })

  it('④ 方法集自洽：基础面 4 + 未支持 22 = FileSystemBridge 的 26 个方法', async () => {
    const { APP_FS_BASE_METHODS, APP_FS_UNSUPPORTED } = await import('../packages/api/src/capability-app-filesystem')
    const total = APP_FS_BASE_METHODS.length + Object.keys(APP_FS_UNSUPPORTED).length
    // ★写死 26 是为了让"契约新增方法却没登记"当场红（比读类型更硬——类型在运行时读不到）
    expect(total, '已实现 + 未支持 必须覆盖 FileSystemBridge 的全部方法').toBe(26)
    expect(APP_FS_BASE_METHODS.length, '★#1237 补上 appendFile 后已实现 = 26').toBe(26)
  })

  it('⑤ ★异步 appendFile 走宿主 fs.appendBytes（原生追加，不读全文、不整写）', async () => {
    const { createAppFileSystem } = await import('../packages/api/src/capability-app-filesystem')
    const fs = createAppFileSystem().getFileSystem!()
    calls.length = 0
    hostResult = { ok: true, data: { path: 'log.txt', size: 6, appended: 3 } }
    await fs.appendFile('log.txt', 'abc')
    // ★核心断言：打的是 fs.appendBytes（O_APPEND），而且**没有** readBytes/writeBytes 往返
    expect(calls.map((c) => c.method), '只应有 fs.stat 探测 + fs.appendBytes 一次').toEqual(['fs.stat', 'fs.appendBytes'])
    const args = calls[1]!.args as { path: string; bytes: number[] }
    expect(args.path).toBe('log.txt')
    expect(Array.from(args.bytes), 'UTF-8 编码后的字节').toEqual([97, 98, 99])
  })

  it('⑤b ★appendFileSync 也只打 fs.appendBytes（旧实现是 exists+readBytes+writeBytes 三跳）', async () => {
    const { createAppFileSystem } = await import('../packages/api/src/capability-app-filesystem')
    const fs = createAppFileSystem().getFileSystem!()
    calls.length = 0
    hostResult = { ok: true, data: { path: 'log.txt', size: 6, appended: 3 } }
    fs.appendFileSync('log.txt', 'xyz')
    expect(calls.map((c) => c.method)).toEqual(['fs.stat', 'fs.appendBytes'])
    expect(Array.from((calls[1]!.args as { bytes: number[] }).bytes)).toEqual([120, 121, 122])
  })

  it('⑤c ★宿主拒绝追加时如实报错（不静默成功）', async () => {
    const { createAppFileSystem } = await import('../packages/api/src/capability-app-filesystem')
    const fs = createAppFileSystem().getFileSystem!()
    hostResult = { ok: false, reason: 'fs.appendBytes 打不开', missing: false }
    await expect(fs.appendFile('log.txt', 'abc')).rejects.toThrow(/file-system\.failed: appendFile/)
    expect(() => fs.appendFileSync('log.txt', 'abc')).toThrow(/file-system\.failed: appendFileSync/)
  })

  it('⑥ ★回归：可选能力（unzip）缺失**不得**打死必需面探测', async () => {
    // ★★本条护着一个我真实引入过的 bug：把 fs.unzip 列进必需探测 ⇒ iOS/鸿蒙
    //   （无 ZIP 容器 API）整个 getFileSystem 不可用 ⇒ 连 readFile/writeFile 都没了。
    const mod = await import('../packages/api/src/capability-app-filesystem')
    // ① 必需面探测的方法清单里**不得**出现 fs.unzip
    const src = String(((mod as unknown as { appFileSystemAvailable: { toString(): string } }).appFileSystemAvailable))
    expect(src.includes('fs.unzip'), '必需探测里不应含 fs.unzip').toBe(false)
    // ② 可选能力有独立探测函数
    expect(typeof mod.appFileSystemOptionalAvailable, '可选能力有独立探测').toBe('function')
  })
})
