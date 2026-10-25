// tests/capability-app-hook-e2e.test.ts
// ★★★#1238 Hook 层**端到端**判据（`useLog` / `useStorage` / `useFileSystem`）。
//
// 【为什么必须单独有这一层（用户本轮的原话是「严格按照 useFetch 的那套标准」）】
//   已有判据都停在**桥层**：`createAppLog().log` 存在、`createAppFileStorage().getStorage` 存在。
//   但业务**永远不直接调桥**——它调 `useLog()` / `useStorage()` / `useFileSystem()`。
//   两层之间有真实的接线风险，本仓踩过同族：
//     · #1096 桥成员写在装配层返回对象里，没登记 ⇒ 文档判"未接线"（代码做了、对外谎报）
//     · #1230 保存三件套被错误登记进 `HOST_CAPABILITY_METHODS` ⇒ 覆盖率误报
//     · #1232 只改 `FileSystemBridge` 漏了 `FSAdapter` ⇒ 类型都不一致（一层改、一层没改）
//   ⇒ 「桥有方法」≠「Hook 拿得到 handle」≠「handle 真的派发到宿主」。三条都要判。
//
// 【判据口径：三层贯通 + 反向对照】
//   ① `useLog()` 返回的 handle 调 `.log()` ⇒ 宿主 `log` 方法**真的收到** payload（不是"resolve 了"）
//   ② `useStorage()` 拿到同步句柄 ⇒ `set` 落到宿主 `fs.writeBytes`、`get` 从 `fs.readBytes` 回落
//   ③ `useFileSystem()` 拿到 FSAdapter ⇒ `readFile` 真派发 `fs.readBytes`，且**不传 encoding 走异步面返回 string**
//   ④ 反向对照：宿主**不支持**该能力时，三个 Hook 必须**如实抛/回 unsupported**（不是静默成功）
//
// ★为什么用真实 `createCapabilityBridge` 而不是手搭 bridge：
//   手搭会绕过装配点（`createAppCapabilities` 的条件 spread），而那正是最易断的一环。
import { describe, it, expect, beforeEach } from 'vitest'
import { HOST_INVOKE_KEY } from '../packages/api/src/capability-invoke'

const g = globalThis as Record<string, unknown>

/** 宿主桩：记录调用 + 可选"不支持哪些方法"（同步派发，与三端宿主同语义） */
function installHost(opts: { missing?: string[] } = {}) {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = []
  const files = new Map<string, number[]>()
  const missing = new Set(opts.missing ?? [])
  g[HOST_INVOKE_KEY] = (method: string, argsJson: string): string => {
    const args = JSON.parse(argsJson || '{}') as Record<string, unknown>
    calls.push({ method, args })
    if (missing.has(method)) {
      return JSON.stringify({ ok: false, missing: true, reason: '未知方法 ' + method })
    }
    switch (method) {
      case 'log': {
        if (args.probe === true) return JSON.stringify({ ok: true, data: { probe: true } })
        return JSON.stringify({ ok: true, data: { written: true, level: args.level, bytes: String(args.message ?? '').length } })
      }
      case 'fs.readBytes': {
        if (args.probe === true) return JSON.stringify({ ok: true, data: { probe: true } })
        const p = String(args.path ?? '')
        const f = files.get(p)
        if (!f) return JSON.stringify({ ok: false, missing: false, reason: '文件不存在 ' + p })
        return JSON.stringify({ ok: true, data: { bytes: f, size: f.length } })
      }
      case 'fs.writeBytes': {
        if (args.probe === true) return JSON.stringify({ ok: true, data: { probe: true } })
        const p = String(args.path ?? '')
        files.set(p, (args.bytes as number[]) ?? [])
        return JSON.stringify({ ok: true, data: { path: p, size: ((args.bytes as number[]) ?? []).length } })
      }
      case 'fs.remove':
        if (args.probe === true) return JSON.stringify({ ok: true, data: { probe: true } })
        files.delete(String(args.path ?? ''))
        return JSON.stringify({ ok: true, data: { removed: 1 } })
      case 'fs.exists': {
        if (args.probe === true) return JSON.stringify({ ok: true, data: { probe: true } })
        const p = String(args.path ?? '')
        return JSON.stringify({ ok: true, data: { exists: files.has(p), isFile: files.has(p), isDir: false } })
      }
      case 'fs.stat': {
        if (args.probe === true) return JSON.stringify({ ok: true, data: { probe: true } })
        const p = String(args.path ?? '')
        const f = files.get(p)
        return f
          ? JSON.stringify({ ok: true, data: { size: f.length, mode: 0, isFile: true, isDirectory: false } })
          : JSON.stringify({ ok: false, missing: false, reason: '文件不存在 ' + p })
      }
      default:
        if (args.probe === true) return JSON.stringify({ ok: true, data: { probe: true } })
        return JSON.stringify({ ok: true, data: {} })
    }
  }
  return { calls, files, missing }
}

/**
 * 建真实桥 + 真实 Hook 层。
 * ★必须让 `detectAppHost()` 为真，否则装配点不会 spread App 能力（那正是要测的接线）。
 */
async function makeHooks() {
  const mod = await import('../packages/api/src/capability')
  const bridge = mod.createCapabilityBridge()
  return { hooks: mod.createCapabilityHooks(bridge), bridge }
}

beforeEach(async () => {
  delete g[HOST_INVOKE_KEY]
  // App 宿主判定：detectAppHost() 读 globalThis[HOST_ID_KEY]（= __PROTEUS_HOST_ID__）
  const appMod = await import('../packages/api/src/capability-app')
  g[appMod.HOST_ID_KEY] = 'test-host'
  // ★关键：共享桥是**模块级惰性单例**（#1072）⇒ 前一个用例/文件建的桥会被复用，
  //   那时宿主桩还是上一份（甚至还不存在）⇒ 探测结果全错（失败表现：明明 missing 却拿到 ✅）。
  //   ⇒ 每个用例前丢弃它，让下一次 getSharedCapabilityBridge() 在新宿主桩下重建。
  const sharedMod = await import('../packages/api/src/capability-bridge-shared')
  sharedMod.resetSharedCapabilityBridge()
  // 读数归零（log/storage 都是模块级计数）
  const logMod = await import('../packages/api/src/capability-app-log')
  logMod.__resetLogState()
  const stMod = await import('../packages/api/src/capability-app-storage')
  stMod.__resetStorageStats()
})

describe('★★★#1238 Hook 层端到端（useLog / useStorage / useFileSystem）', () => {
  it('① useLog：handle.log 真的把 (level,message,data) 派发到宿主（不是"resolve 了"）', async () => {
    const host = installHost()
    const { hooks } = await makeHooks()
    const log = hooks.useLog()
    const r = await log.log('hello', { a: 1 })
    expect(r.ok, 'Hook 层返回 CapResult 且成功').toBe(true)
    const call = host.calls.find((c) => c.method === 'log' && c.args.probe !== true && c.args.message === 'hello')
    expect(call, '★宿主真的收到了这条日志（端到端贯通）').toBeTruthy()
    expect(call!.args).toMatchObject({ level: 'log', message: 'hello', data: { a: 1 } })
  })

  it('② useLog：warn/error 走各自的级别（不是全发 log）', async () => {
    const host = installHost()
    const { hooks } = await makeHooks()
    const log = hooks.useLog()
    await log.warn('w')
    await log.error('e')
    // ★必须排除探测调用：appLogAvailable() 会发 `{probe:true}`（它也是 method 'log'，
    //   若不排除会读到一个 undefined 级别——那不是业务日志）
    const levels = host.calls.filter((c) => c.method === 'log' && c.args.probe !== true).map((c) => c.args.level)
    expect(levels, '★三个级别必须分别派发').toEqual(['warn', 'error'])
  })

  it('③ useStorage：set 落到宿主 fs.writeBytes，get 从宿主读回（持久化真的发生）', async () => {
    const host = installHost()
    const { hooks } = await makeHooks()
    const st = hooks.useStorage()
    st.set('k', { n: 1 })
    const write = host.calls.find((c) => c.method === 'fs.writeBytes' && c.args.path === 'storage/proteus-kv.json')
    expect(write, '★set 必须落盘（不是只存内存）').toBeTruthy()
    expect(st.get<{ n: number }>('k'), '★读回同一个值（端到端）').toEqual({ n: 1 })
    expect(host.files.has('storage/proteus-kv.json'), '宿主侧文件存在').toBe(true)
  })

  it('④ useFileSystem：readFile 真派发 fs.readBytes 并返回文本', async () => {
    const host = installHost()
    host.files.set('a.txt', Array.from(new TextEncoder().encode('hello-fs')))
    const { hooks } = await makeHooks()
    const fsAdapter = hooks.useFileSystem()
    const r = await fsAdapter.readFile('a.txt')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('hello-fs')
    expect(host.calls.some((c) => c.method === 'fs.readBytes' && c.args.path === 'a.txt'), '★真派发').toBe(true)
  })

  it('⑤ useFileSystem：writeFile → readFile 往返（写进宿主、读回同内容）', async () => {
    const host = installHost()
    const { hooks } = await makeHooks()
    const fsAdapter = hooks.useFileSystem()
    const w = await fsAdapter.writeFile('dir/b.txt', 'round-trip')
    expect(w.ok).toBe(true)
    expect(host.files.has('dir/b.txt'), '★宿主侧真的写了').toBe(true)
    const rd = await fsAdapter.readFile('dir/b.txt')
    expect(rd.ok && rd.data).toBe('round-trip')
  })

  it('⑥ 反向对照·log：宿主不支持 ⇒ useLog 如实 Err（不静默成功）', async () => {
    installHost({ missing: ['log'] })
    const { hooks } = await makeHooks()
    const r = await hooks.useLog().log('x')
    // ★装配点按 appLogAvailable() 决定是否 spread ⇒ 宿主不支持时 bridge.log 不存在
    //   ⇒ Hook 层抛 `log.unsupported`（如实不可用），**不能**报 ok
    expect(r.ok, '★不可用时必须失败，绝对不能"看起来成功"').toBe(false)
    if (!r.ok) expect(r.error.code).toMatch(/unsupported/)
  })

  it('⑦ 反向对照·storage：宿主缺 fs.* ⇒ useStorage 抛 storage.unsupported', async () => {
    installHost({ missing: ['fs.readBytes', 'fs.writeBytes', 'fs.remove'] })
    const { hooks } = await makeHooks()
    expect(() => hooks.useStorage(), '★缺宿主能力 ⇒ 同步抛（不返回内存兜底）').toThrow(/storage\.unsupported/)
  })

  it('⑧ 反向对照·fileSystem：宿主缺 fs.* ⇒ useFileSystem 抛 file-system.unsupported', async () => {
    installHost({ missing: ['fs.readBytes', 'fs.writeBytes', 'fs.remove'] })
    const { hooks } = await makeHooks()
    expect(() => hooks.useFileSystem()).toThrow(/file-system\.unsupported/)
  })

  it('⑨ 装配点接线：三个桥方法真的被 spread 进 App 桥（否则 Hook 全断）', async () => {
    installHost()
    const { bridge } = await makeHooks()
    expect(typeof bridge.log, '★bridge.log 必须在（装配点条件 spread 的一环）').toBe('function')
    expect(typeof bridge.getStorage, '★bridge.getStorage 必须在').toBe('function')
    expect(typeof bridge.getFileSystem, '★bridge.getFileSystem 必须在').toBe('function')
  })
})
