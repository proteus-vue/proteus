// tests/capability-app-storage.test.ts
// ★★★#1207：App 端 KV 存储（`getStorage`）——按 useFetch 的标准落地后的行为判据。
//
// 【它守什么】
//   ① **同步语义**：`CompatStorage.get/set` 必须**立即**返回（`useStorage` 是同步 API）；
//      这是本项能"零新原生代码"的前提（宿主 `fs.*` 与 `invokeHost` 都是同步派发）。
//   ② **持久化落到宿主文件**：写 → 走 `fs.writeBytes`；读 → 走 `fs.readBytes`（整份文档）。
//   ③ ★★★**鸿蒙如实不可用**：宿主没有 `fs.*` ⇒ `createAppFileStorage()` 返回**空对象**（不提供 getStorage）
//      ⇒ 装配点**不提供** `getStorage` ⇒ `useStorage` 抛 `storage.unsupported`。
//      **绝不用内存兜底冒充持久化**（那会让业务以为存住了、重启即丢）。
//   ④ 清空 = 写空文档（不是"删文件"）：宿主 `fs.remove` 在目录非空时不可靠，
//      且 `clear()` 后 `info().keys` 必须为空。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { HOST_INVOKE_KEY } from '../packages/api/src/capability-invoke'
import {
  createAppFileStorage, appKvStorageAvailable, APP_KV_STORE_PATH,
  STORAGE_MAX_TOTAL_BYTES, STORAGE_MAX_VALUE_BYTES, STORAGE_MAX_KEY_BYTES, STORAGE_MAX_KEYS,
  storageStats, getStorageLastError, __resetStorageStats,
} from '../packages/api/src/capability-app-storage'

const g = globalThis as Record<string, unknown>

/** ★工厂返回桥成员对象（抽取器契约）；测试里取存储实例用这个助手 */
const mk = () => createAppFileStorage().getStorage?.()

type HostStore = { files: Map<string, number[]>; calls: string[]; missing: Set<string> }

/** 宿主桩：模拟 Android/iOS 的 `fs.readBytes` / `fs.writeBytes` / `fs.remove`（**同步**派发） */
function installFsHost(opts: { missing?: string[] } = {}): HostStore {
  const store: HostStore = {
    files: new Map(),
    calls: [],
    missing: new Set(opts.missing ?? []),
  }
  g[HOST_INVOKE_KEY] = (method: string, argsJson: string): string => {
    store.calls.push(method)
    if (store.missing.has(method)) {
      return JSON.stringify({ ok: false, missing: true, reason: '未知方法 ' + method })
    }
    const args = JSON.parse(argsJson || '{}') as Record<string, unknown>
    if (method === 'fs.readBytes') {
      const path = String(args.path ?? '')
      const f = store.files.get(path)
      if (!f) return JSON.stringify({ ok: false, missing: false, reason: '文件不存在：' + path })
      return JSON.stringify({ ok: true, data: { bytes: f, size: f.length } })
    }
    if (method === 'fs.writeBytes') {
      const path = String(args.path ?? '')
      const bytes = (args.bytes as number[]) ?? []
      store.files.set(path, bytes.slice())
      return JSON.stringify({ ok: true, data: { path, size: bytes.length } })
    }
    if (method === 'fs.remove') {
      store.files.delete(String(args.path ?? ''))
      return JSON.stringify({ ok: true, data: { removed: 1 } })
    }
    return JSON.stringify({ ok: false, missing: true, reason: '未知方法 ' + method })
  }
  return store
}

beforeEach(() => {
  delete g[HOST_INVOKE_KEY]
  __resetStorageStats()   // ★#1241 读数在模块级 ⇒ 用例间必须归零
})
afterEach(() => {
  delete g[HOST_INVOKE_KEY]
})

describe('★★★#1207 App 端 KV 存储（getStorage）', () => {
  it('★★★同步语义：get/set/remove/clear 立即生效（不返回 Promise）', () => {
    const host = installFsHost()
    const st = mk()
    expect(st, '★宿主有 fs.* 时应创建成功').toBeTruthy()
    // ★同步写入：返回值不是 Promise（`useStorage` 是同步 API）
    const r = st!.set('k', { a: 1 }) as unknown
    expect(r instanceof Promise, '★set 返回了 Promise ⇒ 同步 API 契约被破坏').toBe(false)
    // ★同步读取：立即可见，且是同一个对象值
    expect(st!.get<{ a: number }>('k')).toEqual({ a: 1 })
    st!.remove('k')
    expect(st!.get('k')).toBeUndefined()
    // ★确实落到了宿主文件（不是纯内存）
    expect(host.files.has(APP_KV_STORE_PATH), `★没有写到宿主文件 ${APP_KV_STORE_PATH}`).toBe(true)
  })

  it('★★持久化路径：重启后（重新创建实例）能读回——证明真的在文件里', () => {
    const host = installFsHost()
    const st1 = mk()!
    st1.set('token', 'abc-123')
    st1.set('count', 42)
    const before = host.files.size
    // 模拟"进程重启"：新建实例（内部缓存清空，只能从文件读）
    const st2 = mk()!
    expect(st2.get<string>('token'), '★重启后读不到 token ⇒ 没真正落盘').toBe('abc-123')
    expect(st2.get<number>('count')).toBe(42)
    // ★读路径必须真的走了 fs.readBytes（而不是"缓存恰好还在"）
    expect(host.calls.filter((c) => c === 'fs.readBytes').length).toBeGreaterThan(0)
    expect(host.files.size).toBe(before)
  })

  it('★★★鸿蒙如实不可用：宿主无 fs.* ⇒ 返回 undefined（不提供内存兜底）', () => {
    installFsHost({ missing: ['fs.readBytes', 'fs.writeBytes', 'fs.remove'] })
    expect(appKvStorageAvailable(), '★宿主缺 fs.* 时应判定为不可用').toBe(false)
    const st = mk()
    expect(st, '★宿主缺 fs.* 却仍返回了存储 ⇒ 那是内存兜底冒充持久化（本仓最忌）').toBeUndefined()
  })

  it('★部分缺符号也必须判不可用（三件套缺一不可）', () => {
    installFsHost({ missing: ['fs.writeBytes'] })
    expect(appKvStorageAvailable(), '★缺 fs.writeBytes 仍判可用 ⇒ 写入会静默失败').toBe(false)
    expect(mk()).toBeUndefined()
  })

  it('★clear 后 keys 为空，且文件里是空文档（不是删文件）', () => {
    const host = installFsHost()
    const st = mk()!
    st.set('a', 1)
    st.set('b', 2)
    st.clear()
    expect(st.get('a')).toBeUndefined()
    expect(st.get('b')).toBeUndefined()
    // ★clear 走 writeBytes 写空对象（fs.remove 在目录非空时不可靠，见文件头）
    expect(host.files.has(APP_KV_STORE_PATH), '★clear 把文件删了——应写空文档').toBe(true)
    const raw = host.files.get(APP_KV_STORE_PATH)!
    expect(String.fromCharCode(...raw), '★清空后文件内容不是空对象').toBe('{}')
  })

  it('★损坏文档当空处理（不抛、不半修）', () => {
    const host = installFsHost()
    // 预置一份坏 JSON
    host.files.set(APP_KV_STORE_PATH, Array.from(new TextEncoder().encode('{not json')))
    const st = mk()!
    expect(st.get('anything'), '★坏文档应读到 undefined（不是抛异常）').toBeUndefined()
    // 仍可正常写（覆盖成合法文档）
    st.set('ok', 1)
    expect(st.get<number>('ok')).toBe(1)
  })

  it('★★异步面与 info 如实（limitSize 报**本层真强制**的上限，不是平台配额）', async () => {
    installFsHost()
    const st = mk()!
    const w = await st.setAsync('x', 'y')
    expect(w.ok).toBe(true)
    const g1 = await st.getAsync<string>('x')
    expect(g1.ok && g1.data).toBe('y')
    const inf = await st.info()
    expect(inf.ok).toBe(true)
    if (inf.ok) {
      expect(inf.data.keys).toContain('x')
      expect(inf.data.currentSize, '★currentSize 应 > 0').toBeGreaterThan(0)
      // ★★#1241 口径变更（原断言是 `limitSize===0`，理由"App 没有平台配额概念，不编假上限"）：
      //   现在本层**真有一个强制上限** STORAGE_MAX_TOTAL_BYTES（超了 setAsync 回 storage.tooLarge）
      //   ⇒ 报它才是如实；报 0 反而会让业务以为"无限"。
      //   ★关键是"报的数必须真的被强制"——下面同时断言它真的会拒（见 ⑧）。
      expect(inf.data.limitSize, '★limitSize 必须是本层真强制的那个常量').toBe(STORAGE_MAX_TOTAL_BYTES)
    }
  })

  // ══════════════ ★★★#1241 四项必答（§1.0 S3）的可触发判据 ══════════════
  // ★每条都断言**行为**（拒绝 / 计数 / 落盘次数 / 回滚），不是"常量存在"。
  //   本仓教训（#1223）：判据分支被前面的通用分支吃掉 ⇒ 死代码也算"有实现"（假绿）。

  it('⑥ ① 上限·单值：超过 STORAGE_MAX_VALUE_BYTES ⇒ setAsync 回 storage.tooLarge 且不落盘', async () => {
    const host = installFsHost()
    const st = mk()!
    const huge = 'x'.repeat(STORAGE_MAX_VALUE_BYTES + 10)
    const r = await st.setAsync('big', huge)
    expect(r.ok, '★超限必须显式报错，不静默截断').toBe(false)
    if (!r.ok) expect(r.error.code).toBe('storage.tooLarge')
    expect(host.files.has(APP_KV_STORE_PATH), '★被拒的写入不该落盘').toBe(false)
    expect(getStorageLastError(), '同步错误通道可读').toMatch(/storage\.tooLarge/)
    expect(storageStats().refused).toBe(1)
  })

  it('⑦ ① 上限·键名：超过 STORAGE_MAX_KEY_BYTES ⇒ 拒绝', async () => {
    installFsHost()
    const st = mk()!
    const r = await st.setAsync('k'.repeat(STORAGE_MAX_KEY_BYTES + 1), 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('storage.tooLarge')
    expect(storageStats().refused).toBe(1)
  })

  it('⑧ ①④ 上限·总额与键数：总额超限拒绝；键数超限回 storage.tooManyKeys', async () => {
    installFsHost()
    const st = mk()!
    // 总额：用一个接近单值上限的值 × 若干键把文档推过 STORAGE_MAX_TOTAL_BYTES
    const chunk = 'y'.repeat(STORAGE_MAX_VALUE_BYTES - 64)
    let refusedByTotal = false
    for (let i = 0; i < 12; i++) {
      const r = await st.setAsync('t' + i, chunk)
      if (!r.ok && r.error.code === 'storage.tooLarge') { refusedByTotal = true; break }
    }
    expect(refusedByTotal, '★文档总额超过 8 MiB ⇒ 显式拒绝（这是修掉"越 64 MiB 后全部键静默消失"的那道闸）').toBe(true)
    // 键数：把 STORAGE_MAX_KEYS 顶满后再加一个
    const st2 = mk()!
    await st2.clearAsync()
    let hitManyKeys = false
    for (let i = 0; i <= STORAGE_MAX_KEYS; i++) {
      const r = await st2.setAsync('n' + i, 1)
      if (!r.ok && r.error.code === 'storage.tooManyKeys') { hitManyKeys = true; break }
    }
    expect(hitManyKeys, '★键数上界触发 storage.tooManyKeys').toBe(true)
  })

  it('⑨ ② 背压·写合并：coalesce 模式下同微任务多次 set 只落盘一次，且 coalesced 计数', async () => {
    const host = installFsHost()
    const st = createAppFileStorage({ coalesce: true }).getStorage!()
    const before = host.calls.filter((c) => c === 'fs.writeBytes').length
    st.set('a', 1)
    st.set('b', 2)
    st.set('c', 3)
    expect(storageStats().dirty, '★未落盘标记可观测').toBe(true)
    // 值立即可见（内存先认——合并不改变读语义）
    expect(st.get<number>('a')).toBe(1)
    expect(host.calls.filter((c) => c === 'fs.writeBytes').length - before, '★此时还没落盘').toBe(0)
    await Promise.resolve()   // 让微任务跑
    const writes = host.calls.filter((c) => c === 'fs.writeBytes').length - before
    expect(writes, '★三次 set 只落盘一次').toBe(1)
    expect(storageStats().coalesced, '省掉 2 次落盘').toBe(2)
    expect(storageStats().dirty).toBe(false)
  })

  it('⑩ ② 默认不合并：coalesce 缺省时每次 set 都立即落盘（不偷偷延迟持久化）', async () => {
    const host = installFsHost()
    const st = mk()!
    st.set('a', 1)
    const n1 = host.calls.filter((c) => c === 'fs.writeBytes').length
    st.set('b', 2)
    const n2 = host.calls.filter((c) => c === 'fs.writeBytes').length
    expect(n2 - n1, '★默认语义：每次 set 一次落盘').toBe(1)
    expect(storageStats().coalesced).toBe(0)
  })

  it('⑪ ③ 回收：文档缓存登记进账本；release 后缓存回滚到已落盘快照', async () => {
    installFsHost()
    const { createCapabilityResourceRegistry } = await import('../packages/api/src/capability-resources')
    const registry = createCapabilityResourceRegistry({ owner: 'test' })
    const st = createAppFileStorage({ coalesce: true, resources: registry }).getStorage!()
    st.set('durable', 'yes')
    await Promise.resolve()          // 落盘
    st.set('pending', 'no')          // 未落盘的修改
    expect(registry.countsByType()['storage-doc'], '文档缓存已登记').toBe(1)
    registry.releaseAll()
    expect(registry.size(), '账本归零').toBe(0)
    expect(storageStats().dirty, '★未落盘标记被清').toBe(false)
    // ★回滚语义：只有已落盘的那条还在，未落盘的"pending"不能假装持久化
    expect(st.get<string>('durable'), '已落盘的值仍可读（release 只是丢缓存，不是清数据）').toBe('yes')
    expect(st.get<string>('pending'), '★未落盘的修改不被当作已持久化').toBeUndefined()
  })

  it('⑫ ④ 并发/读数：storageStats 六项齐全且键数/字节随写入更新', async () => {
    installFsHost()
    const st = mk()!
    await st.setAsync('a', 1)
    await st.setAsync('b', 'hello')
    const s = storageStats()
    expect(Object.keys(s).sort()).toEqual(['coalesced', 'dirty', 'keys', 'refused', 'totalBytes', 'writes'])
    expect(s.keys, '键数跟随').toBe(2)
    expect(s.totalBytes, '字节数跟随').toBeGreaterThan(0)
    expect(s.writes).toBe(2)
  })

  it('⑬ ③ 宿主读失败不装空文档：记 lastError（原实现静默返回空 ⇒ 看起来"键全没了"）', async () => {
    const host = installFsHost()
    host.files.set(APP_KV_STORE_PATH, Array.from(new TextEncoder().encode('{"a":1}')))
    // 探测（`{probe:true}`）放行；真正的读失败 ⇒ 非 "不存在" 的错误
    const orig = g[HOST_INVOKE_KEY] as (m: string, a: string) => string
    g[HOST_INVOKE_KEY] = (m: string, a: string) => {
      const probe = /"probe"\s*:\s*true/.test(a)
      return m === 'fs.readBytes' && !probe
        ? JSON.stringify({ ok: false, missing: false, reason: 'IO 错误：权限不足' })
        : orig(m, a)
    }
    __resetStorageStats()
    const st = mk()!
    expect(st.get('a'), '读失败时读到 undefined（不抛）').toBeUndefined()
    expect(getStorageLastError(), '★读失败必须记错，不能装作"空文档"').toMatch(/storage\.load/)
  })
})
