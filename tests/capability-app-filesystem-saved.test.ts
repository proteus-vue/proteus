// tests/capability-app-filesystem-saved.test.ts —— ★★★#1230 保存文件三件套的真行为判据
//
// 【为什么单独一份 + 为什么要写内存假宿主】三件套是**纯 JS 组合**（saveFile = exists→mkdir→rename→stat
//   →写索引；getSavedFileList = 读索引 + 存在性修剪；removeSavedFile = remove + 清索引）。
//   只断言"函数存在"是**假判据**（本仓 #1191 记过）；必须让它在**一个有状态的文件系统**上真跑。
//
// 【假宿主的诚实边界】它是按契约**模拟** fs.*（不是真设备）。真机验证另有（真机验的是宿主实现；
//   本文件验的是 JS 侧组合逻辑 —— 两者互补，不能互相替代）。
//
// 【本文件护着的四件事】
//   ① saveFile 真的把文件**移动**到 saved/ 并写入索引（不是只返回一个路径）
//   ② 保存后源路径**不存在**（移动语义，不是复制）
//   ③ getSavedFileList 读索引；**外部删掉的文件会被修剪**（返回列表不含已消失的路径）
//   ④ removeSavedFile 删文件 + 清索引（幂等：文件已不在也不报错）
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** 假宿主的文件系统状态（路径 → 内容字节） */
const disk = new Map<string, number[]>()
const dirs = new Set<string>(['storage'])
const calls: Array<{ method: string; args: Record<string, unknown> }> = []

function fakeHost(method: string, rawArgs?: unknown): { ok: true; data: unknown } | { ok: false; reason: string; missing: boolean } {
  const args = (rawArgs ?? {}) as Record<string, unknown>
  calls.push({ method, args })
  const p = String(args.path ?? '')
  const isDirPath = (x: string) => dirs.has(x)
  const parentOf = (x: string) => x.split('/').slice(0, -1).join('/')
  switch (method) {
    case 'fs.exists': {
      const ex = disk.has(p) || isDirPath(p)
      return { ok: true, data: { exists: ex, isFile: disk.has(p), isDir: isDirPath(p) } }
    }
    case 'fs.mkdir': {
      dirs.add(p)
      if (args.recursive) for (let q = parentOf(p); q && q !== p; q = parentOf(q)) dirs.add(q)
      return { ok: true, data: {} }
    }
    case 'fs.rename': {
      const o = String(args.oldPath ?? '')
      const n = String(args.newPath ?? '')
      if (!disk.has(o)) return { ok: false, reason: '源不存在', missing: false }
      if (disk.has(n) || isDirPath(n)) return { ok: false, reason: '目标已存在', missing: false }
      const parent = parentOf(n)
      if (parent && !isDirPath(parent)) return { ok: false, reason: '父目录不存在', missing: false }
      disk.set(n, disk.get(o)!)
      disk.delete(o)
      return { ok: true, data: { newPath: n } }
    }
    case 'fs.remove': {
      disk.delete(p)
      return { ok: true, data: {} }   // ★幂等（与宿主实现同）
    }
    case 'fs.stat': {
      if (!disk.has(p)) return { ok: false, reason: '不存在', missing: false }
      const v = disk.get(p)!
      return { ok: true, data: { size: v.length, mode: 420, lastAccessedTime: 0, lastModifiedTime: Date.now(), isDirectory: false, isFile: true } }
    }
    case 'fs.readBytes': {
      if (!disk.has(p)) return { ok: false, reason: '不存在', missing: false }
      const v = disk.get(p)!
      return { ok: true, data: { bytes: v, size: v.length } }
    }
    case 'fs.writeBytes': {
      const bytes = (args.bytes as number[]) ?? []
      const parent = parentOf(p)
      if (parent && !isDirPath(parent)) return { ok: false, reason: '父目录不存在', missing: false }
      disk.set(p, bytes)
      return { ok: true, data: { path: p, size: bytes.length } }
    }
    default:
      return { ok: false, reason: `fake 未实现 ${method}`, missing: true }
  }
}

vi.mock('../packages/api/src/capability-invoke', () => ({
  invokeHost: (method: string, args?: unknown) => fakeHost(method, args),
}))

/** 把字符串写成字节（测试里只关心内容是否一致，ASCII 够用） */
const bytes = (s: string) => Array.from(s).map((c) => c.charCodeAt(0))

describe('★★★App 能力 · getFileSystem 保存三件套（#1230）', () => {
  beforeEach(() => {
    disk.clear()
    dirs.clear()
    dirs.add('storage')
    calls.length = 0
  })

  it('① saveFile 真的移动文件到 saved/ 并写入索引（源路径消失）', async () => {
    const { createAppFileSystem } = await import('../packages/api/src/capability-app-filesystem')
    const fs = createAppFileSystem().getFileSystem!()
    disk.set('tmp/report.txt', bytes('hello'))

    const saved = await fs.saveFile('tmp/report.txt')

    expect(saved.startsWith('saved/'), '落在 saved/ 下').toBe(true)
    expect(saved.endsWith('report.txt'), '保留原文件名（前缀加时间戳）').toBe(true)
    expect(disk.has(saved), '目标文件真的存在').toBe(true)
    expect(disk.has('tmp/report.txt'), '★源路径已消失（移动，不是复制）').toBe(false)
    expect(dirs.has('saved'), 'saved/ 目录被建出来').toBe(true)
    // 索引文件写成
    expect(disk.has('storage/proteus-saved.json'), '索引已落盘').toBe(true)
  })

  it('② getSavedFileList 读索引并返回 filePath/size/createTime', async () => {
    const { createAppFileSystem } = await import('../packages/api/src/capability-app-filesystem')
    const fs = createAppFileSystem().getFileSystem!()
    disk.set('tmp/a.txt', bytes('12345'))
    const a = await fs.saveFile('tmp/a.txt')

    const list = await fs.getSavedFileList()
    expect(list.length, '一条').toBe(1)
    expect(list[0]!.filePath, '路径一致').toBe(a)
    expect(list[0]!.size, '大小来自 stat（5 字节）').toBe(5)
    expect(list[0]!.createTime, '有创建时间戳').toBeGreaterThan(0)
  })

  it('③ ★漂移修剪：文件被外部删掉后，列表不再返回它（并回写索引）', async () => {
    const { createAppFileSystem } = await import('../packages/api/src/capability-app-filesystem')
    const fs = createAppFileSystem().getFileSystem!()
    disk.set('tmp/x.txt', bytes('x'))
    const saved = await fs.saveFile('tmp/x.txt')

    disk.delete(saved)               // 模拟外部删除（绕过 removeSavedFile）
    const list = await fs.getSavedFileList()
    expect(list.length, '已消失的条目被修剪').toBe(0)

    const idxText = String.fromCharCode(...(disk.get('storage/proteus-saved.json') ?? []))
    expect(idxText.includes(saved), '索引也回写掉了该条目').toBe(false)
  })

  it('④ removeSavedFile 删文件 + 清索引；对已不存在的文件也幂等成功', async () => {
    const { createAppFileSystem } = await import('../packages/api/src/capability-app-filesystem')
    const fs = createAppFileSystem().getFileSystem!()
    disk.set('tmp/y.txt', bytes('yy'))
    const saved = await fs.saveFile('tmp/y.txt')

    await fs.removeSavedFile(saved)
    expect(disk.has(saved), '文件已删').toBe(false)
    expect((await fs.getSavedFileList()).length, '索引已清').toBe(0)

    // ★幂等：再删一次（文件已不在）不应抛
    await expect(fs.removeSavedFile(saved)).resolves.toBeUndefined()
  })

  it('⑤ 源文件不存在 ⇒ saveFile 如实报错（不静默造一个空文件）', async () => {
    const { createAppFileSystem } = await import('../packages/api/src/capability-app-filesystem')
    const fs = createAppFileSystem().getFileSystem!()
    await expect(fs.saveFile('tmp/nope.txt')).rejects.toThrow(/saveFile .*不存在/)
    expect((await fs.getSavedFileList()).length, '失败不产生索引条目').toBe(0)
  })

  it('⑥ 两次 saveFile 同一文件名 ⇒ 两个不同路径（时间戳前缀防冲突）', async () => {
    const { createAppFileSystem } = await import('../packages/api/src/capability-app-filesystem')
    const fs = createAppFileSystem().getFileSystem!()
    disk.set('tmp/dup.txt', bytes('1'))
    const p1 = await fs.saveFile('tmp/dup.txt')
    disk.set('tmp/dup.txt', bytes('2'))
    const p2 = await fs.saveFile('tmp/dup.txt')
    expect(p1 === p2, '同名不同次 ⇒ 路径不同（不会互相覆盖）').toBe(false)
    expect((await fs.getSavedFileList()).length, '两条都在').toBe(2)
  })
})
