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
import { createAppFileStorage, appKvStorageAvailable, APP_KV_STORE_PATH } from '../packages/api/src/capability-app-storage'

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

  it('★★异步面与 info 如实（limitSize=0 不编假上限）', async () => {
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
      // ★App 端没有平台配额概念 ⇒ limitSize 如实 0，不编一个假的
      expect(inf.data.limitSize, '★编了假上限').toBe(0)
    }
  })
})
