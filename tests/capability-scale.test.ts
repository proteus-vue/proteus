// tests/capability-scale.test.ts
// ★★★2026-10-19（决策 #1071）——「能力通道能否承载上百页面超级应用」的四类结构性风险回归。
//
// 【本文件防的是实测抓到的四个真缺陷（都是"页面越多越糟"型）】
//   ① **事件源不幂等**：`createCapabilityHooks()` 默认内含 `createCapabilityBridge()` → `webBridge()`
//      每次都往 `window` 挂 5 个监听器，而总线是**全局单例** ⇒ 一次系统事件被 N 个监听器各 emit 一次，
//      再分发给 N 个页面订阅者 = **N×N 次回调**。实测 100 页 ⇒ 10000 次（应 100）；500 页 ⇒ 50 万次。
//   ② **订阅不回收**：`onShow(cb)` 返回的取消函数没人保存 ⇒ 页面卸载后订阅仍活（100 页 ⇒ 200 悬挂订阅）。
//   ③ **待决表无界**：App 引擎无 `setTimeout` ⇒ 超时降级 host-only ⇒ 宿主丢一次回推，Promise 永久挂起。
//   ④ **宿主记账无界**：`callLog` 每次 invoke 都 append，从不清理。
//
// 【判据形态】都读**运行时真实读数**（监听器数量 / subscriberCount / pending 计数），不读注释。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
import { utf8Decode, utf8Encode } from '@proteus-vue/shared'
import { resetSharedCapabilityBridge, getSharedCapabilityBridge, hasSharedCapabilityBridge } from '../packages/api/src/capability-bridge-shared'
import { createCapabilityHooks } from '../packages/api/src/capability'
import { getHostLifecycleBus } from '../packages/api/src/capability-app'
import {
  invokeHostAsync,
  installHostResolveBridge,
  pendingHostCallCount,
  pendingHostCallEvictions,
  HOST_INVOKE_BYTES_KEY,
  HOST_INVOKE_KEY,
} from '../packages/api/src/capability-invoke'
import { decodeInvokeFrame, encodeResolveFrame } from '../packages/api/src/invoke-wire'

const g = globalThis as unknown as Record<string, unknown> & {
  addEventListener?: (t: string, cb: () => void) => void
  removeEventListener?: (t: string, cb: () => void) => void
  document?: unknown
  window?: unknown
}

/** 装一个会记账的假 window（每次调用返回**新身份**的 addEventListener ⇒ 每个用例独立安装） */
function installFakeWindow(): { listeners: Array<{ t: string }>; restore: () => void } {
  const listeners: Array<{ t: string }> = []
  const prevAdd = g.addEventListener
  const prevRemove = g.removeEventListener
  const prevDoc = g.document
  const add = (t: string): void => { listeners.push({ t }) }
  const remove = (): void => {}
  g.addEventListener = add
  g.removeEventListener = remove
  g.document = {
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
    documentElement: { scrollTop: 0, scrollHeight: 2000, clientHeight: 800 },
  }
  ;(g as { window?: unknown }).window = g
  return {
    listeners,
    restore: () => {
      if (prevAdd) g.addEventListener = prevAdd
      else delete g.addEventListener
      if (prevRemove) g.removeEventListener = prevRemove
      else delete g.removeEventListener
      g.document = prevDoc
      delete (g as { window?: unknown }).window
    },
  }
}

const EVENT_TYPES = ['visibilitychange', 'resize', 'load', 'scroll', 'beforeunload']

describe('① 事件源幂等（页面数 ↑ 不得让监听器 ↑）', () => {
  let win: ReturnType<typeof installFakeWindow>
  beforeEach(() => {
    resetSharedCapabilityBridge() // ★共享桥是模块级单例（决策 #1072）：每个用例换桩后必须重置
    win = installFakeWindow()
  })
  afterEach(() => { win.restore() })

  it('100 个页面各建一次 Hooks ⇒ window 监听器仍只有**一套**（5 个）', () => {
    for (let i = 0; i < 100; i++) createCapabilityHooks()
    expect(win.listeners.length, '监听器数量必须与页面数无关（幂等）').toBe(EVENT_TYPES.length)
    const byType: Record<string, number> = {}
    for (const l of win.listeners) byType[l.t] = (byType[l.t] ?? 0) + 1
    for (const t of EVENT_TYPES) expect(byType[t], `${t} 只能注册一次`).toBe(1)
  })

  it('★平方放大已消失：100 页订阅者 × 1 个监听器 ⇒ 一次事件 = 100 次回调（不是 10000）', () => {
    const bus = getHostLifecycleBus()
    let calls = 0
    for (let i = 0; i < 100; i++) {
      const hooks = createCapabilityHooks()
      hooks.usePageLifecycle().onShow(() => { calls++ })
    }
    // 模拟浏览器一次真实事件：调用**全部**已注册监听器
    const visHandlers = win.listeners.filter((l) => l.t === 'visibilitychange')
    expect(visHandlers.length).toBe(1)
    calls = 0
    const before = bus.subscriberCount
    // 直接按浏览器语义派发：用总线的 emit 模拟那唯一一个监听器的工作
    bus.emit({ topic: 'page', kind: 'show' } as never)
    expect(calls, '一次事件应恰好每页一次').toBe(before)
  })
})

describe('② 订阅自动回收（dispose）', () => {
  let win: ReturnType<typeof installFakeWindow>
  beforeEach(() => {
    resetSharedCapabilityBridge()
    win = installFakeWindow()
  })
  afterEach(() => { win.restore() })

  it('页面卸载时 dispose ⇒ 订阅数回到卸载前（不随访问页数增长）', () => {
    const bus = getHostLifecycleBus()
    const before = bus.subscriberCount
    for (let i = 0; i < 100; i++) {
      const hooks = createCapabilityHooks()
      hooks.useAppLifecycle().onShow(() => {})
      hooks.usePageLifecycle().onShow(() => {})
      hooks.dispose()
    }
    expect(bus.subscriberCount, '100 页进出后订阅应全部解绑').toBe(before)
  })

  it('未 dispose 时订阅保持（对照：证明上面的"回落"是 dispose 的功劳，不是本来就没有）', () => {
    const bus = getHostLifecycleBus()
    const before = bus.subscriberCount
    const held: Array<{ dispose(): void }> = []
    for (let i = 0; i < 10; i++) {
      const hooks = createCapabilityHooks()
      hooks.usePageLifecycle().onShow(() => {})
      held.push(hooks)
    }
    expect(bus.subscriberCount).toBe(before + 10)
    for (const h of held) h.dispose()
    expect(bus.subscriberCount).toBe(before)
  })

  it('dispose 幂等（重复调用不抛、不误删别人的订阅）', () => {
    const bus = getHostLifecycleBus()
    const other = createCapabilityHooks()
    other.usePageLifecycle().onShow(() => {})
    const before = bus.subscriberCount
    const h = createCapabilityHooks()
    h.usePageLifecycle().onShow(() => {})
    h.dispose()
    h.dispose()
    expect(bus.subscriberCount).toBe(before)
  })

  it('句柄的 getter 与返回值语义不被作用域包装破坏（phase 仍可读、off 仍返回函数）', () => {
    const h = createCapabilityHooks()
    const lc = h.useAppLifecycle()
    expect(typeof lc.phase).toBe('string')
    const off = lc.onShow(() => {})
    expect(typeof off).toBe('function')
    h.dispose()
  })
})

describe('③ 待决表有界（宿主丢回推不得让内存无限涨）', () => {
  afterEach(() => {
    delete g[HOST_INVOKE_BYTES_KEY]
    delete g[HOST_INVOKE_KEY]
  })

  it('宿主只受理不回推 ⇒ 待决表停在 1024 上限，并累计淘汰读数', async () => {
    installHostResolveBridge()
    // 宿主：永远"已受理、绝不回推"
    g[HOST_INVOKE_BYTES_KEY] = () => undefined
    const evictBefore = pendingHostCallEvictions()
    const promises: Array<Promise<unknown>> = []
    for (let i = 0; i < 1200; i++) {
      promises.push(invokeHostAsync('device.screen', {}, 60000).catch(() => undefined))
    }
    expect(pendingHostCallCount()).toBeLessThanOrEqual(1024)
    expect(pendingHostCallEvictions() - evictBefore).toBeGreaterThan(0)
    // 被淘汰的必须 reject（不是静默丢弃 → 但这里 catch 了，只验证计数增长）
    expect(promises.length).toBe(1200)
  })

  it('正常结算会把条目删掉（上限不影响健康路径）', async () => {
    installHostResolveBridge()
    g[HOST_INVOKE_BYTES_KEY] = (frame: Uint8Array) => {
      const f = decodeInvokeFrame(frame)
      return encodeResolveFrame({ reqId: f.reqId, ok: true, body: utf8Encode('{"ok":true,"data":1}') })
    }
    // ★前置用例会留下满表的待决条目（本模块的 pending 表是模块级单例）⇒ 断言"健康路径不新增"，
    //   而不是"回到 0"（后者是上一个用例的清理责任，不是本用例要证明的语义）。
    const before = pendingHostCallCount()
    for (let i = 0; i < 50; i++) await invokeHostAsync('device.screen', {}, 60000)
    expect(pendingHostCallCount()).toBeLessThanOrEqual(before)
  })
})

describe('④ UTF-8 解码（ASCII 快路径 + 严格性不丢）', () => {
  it('往返一致：ASCII / 中文 / emoji / 混合长串', () => {
    const samples = ['', 'ascii', '中文测试', '😀🎉', 'x'.repeat(20000) + '中文' + 'y'.repeat(5000)]
    for (const s of samples) expect(utf8Decode(utf8Encode(s))).toBe(s)
  })

  it('快路径不吞严格校验：非法首字节 / 非法续字节 / 截断 都必须抛', () => {
    expect(() => utf8Decode(new Uint8Array([0xff, 0x41]))).toThrow(/非法 UTF-8 首字节/)
    // ★注意：\[0xe4, 0x41\] 是"3 字节首字节 + 只有 1 个后续字节" ⇒ 先命中**截断**（长度不足），
    //   与改动前实现的分支顺序一致。真正验"续字节非法"要用足够长的输入。
    expect(() => utf8Decode(new Uint8Array([0xe4, 0x41, 0x41]))).toThrow(/非法 UTF-8 续字节/)
    expect(() => utf8Decode(new Uint8Array([0xe4, 0xb8]))).toThrow(/截断/)
  })

  it('★ASCII 快路径确实生效（1MB ASCII 明显快于纯 CJK 同尺寸——量级判据，不锁绝对值）', () => {
    const ascii = utf8Encode('x'.repeat(1024 * 1024))
    const cjk = utf8Encode('中'.repeat(1024 * 1024 / 3))
    const time = (b: Uint8Array): number => {
      utf8Decode(b)
      const t = process.hrtime.bigint()
      utf8Decode(b)
      return Number(process.hrtime.bigint() - t) / 1e6
    }
    const tAscii = time(ascii)
    const tCjk = time(cjk)
    // ★判据取宽区间（不同机器/负载差异大）：ASCII 应明显快于 CJK 逐码点路径
    expect(tAscii, `ASCII ${tAscii.toFixed(1)}ms 应快于 CJK ${tCjk.toFixed(1)}ms`).toBeLessThan(tCjk * 0.8)
  })
})

describe('⑤ 宿主记账有界（超级应用长跑不得单调涨内存）', () => {
  const JAVA = path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HostCapabilities.java')
  const SWIFT = path.join(ROOT, 'hosts/ios/ProteusHost/runtime/host-capabilities.swift')

  it('Android：callLog 是有界环形（ArrayDeque + 上限常量），不是无界 List', () => {
    const src = fs.readFileSync(JAVA, 'utf8')
    expect(src, '必须有上限常量').toMatch(/CALL_LOG_MAX\s*=\s*\d+/)
    expect(src, '应用有界容器').toMatch(/ArrayDeque<String>\s+callLog/)
    expect(src, '不得留下无界 List').not.toMatch(/List<String>\s+callLog\s*=\s*new ArrayList/)
    expect(src, '必须有淘汰逻辑').toMatch(/while\s*\(callLog\.size\(\)\s*>\s*CALL_LOG_MAX\)/)
  })

  it('iOS：callLog 超过上限时裁剪', () => {
    const src = fs.readFileSync(SWIFT, 'utf8')
    expect(src).toMatch(/callLogMax\s*=\s*\d+/)
    expect(src).toMatch(/callLog\.removeFirst\(callLog\.count\s*-\s*Self\.callLogMax\)/)
  })
})

describe('⑥ 共享桥单例（每页不再各建一份 23.8KB 的桥）', () => {
  let win: ReturnType<typeof installFakeWindow>
  beforeEach(() => {
    resetSharedCapabilityBridge()
    win = installFakeWindow()
  })
  afterEach(() => { win.restore() })

  it('createCapabilityHooks() 的默认桥**就是**共享桥（不新建）', () => {
    // ★判据：调前共享桥不存在；调一次 Hooks 后共享桥**被建出来**。
    //   若默认参数退回 createCapabilityBridge()，共享桥会一直是 null ⇒ 本断言直接抓到。
    expect(hasSharedCapabilityBridge()).toBe(false)
    createCapabilityHooks()
    expect(hasSharedCapabilityBridge()).toBe(true)
    const a = getSharedCapabilityBridge<object>()
    for (let i = 0; i < 100; i++) createCapabilityHooks()
    expect(getSharedCapabilityBridge<object>()).toBe(a) // 100 次调用后仍是同一份
  })

  it('reset 后重建（测试隔离语义）', () => {
    const a = getSharedCapabilityBridge<object>()
    resetSharedCapabilityBridge()
    expect(hasSharedCapabilityBridge()).toBe(false)
    const b = getSharedCapabilityBridge<object>()
    expect(b).not.toBe(a)
  })

  it('多个 Hooks 共享同一桥，但**订阅各自独立**（scope 每页一份）', () => {
    const bus = getHostLifecycleBus()
    const before = bus.subscriberCount
    const h1 = createCapabilityHooks()
    const h2 = createCapabilityHooks()
    h1.usePageLifecycle().onShow(() => {})
    h2.usePageLifecycle().onShow(() => {})
    expect(bus.subscriberCount).toBe(before + 2)
    h1.dispose()
    expect(bus.subscriberCount, 'dispose 只解自己的订阅').toBe(before + 1)
    h2.dispose()
    expect(bus.subscriberCount).toBe(before)
  })
})
