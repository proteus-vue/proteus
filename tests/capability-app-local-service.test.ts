// tests/capability-app-local-service.test.ts
// ★★★决策 #1097（2026-10-19）：C78 局域网服务发现（mDNS）——**契约补齐启停 + App 两端实现**。
//
// 【为什么本轮要先改契约（真缺陷，与 #1091 的 useBeacon 同族）】
//   原 `LocalServiceAPI` **只有四个订阅**，没有启停开关。而微信语义是：
//   **必须先 `wx.startLocalServiceDiscovery({ serviceType })`** 才会回调 `onLocalServiceFound`
//   ⇒ 原契约对业务不可用：照文档写完，运行起来收不到任何服务。
//   ★这是同一个家族缺陷**第二次出现**（beacon → local-service），说明"契约只有订阅"这个形态本身可疑。
//
// 【App 两端能真做】Android `NsdManager` / iOS `NWBrowser` 都是系统 mDNS 客户端，无第三方依赖。
//
// 【判据】
//   ① 契约有 `startDiscovery` / `stopDiscovery`，且 **start 收 serviceType**；
//   ② 未 start 时 start 空类型 ⇒ `local-service.invalid-type`（不静默成功）；
//   ③ 宿主缺方法 ⇒ `local-service.unsupported`；
//   ④ start 成功后事件才分发（壳推 → onFound/onLost/onResolveFail/onDiscoveryStop）；
//   ⑤ stop 幂等（没在搜也算成功）；
//   ⑥ 资源账本：start 登记 `mdns-discovery`，stop 销账（页面离开时自动停搜索）；
//   ⑦ wx 桥也补了启停（静态判据：实现里存在 startLocalServiceDiscovery 调用）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createAppLocalService, dispatchLocalServicePush, resetLocalServiceSubscriptions,
  APP_LOCAL_SERVICE_METHODS, localServiceSubCount,
} from '../packages/api/src/capability-local-service'
import { createCapabilityResourceRegistry } from '../packages/api/src/capability-resources'
import { HOST_INVOKE_KEY } from '../packages/api/src/capability-invoke'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function installFakeHost(handler: (method: string, args: Record<string, unknown>) => unknown) {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = []
  ;(globalThis as Record<string, unknown>)[HOST_INVOKE_KEY] = (method: string, argsJson: string) => {
    const args = argsJson ? JSON.parse(argsJson) : {}
    calls.push({ method, args })
    const r = handler(method, args)
    if (r === undefined) return JSON.stringify({ ok: false, missing: true, reason: `未实现 ${method}` })
    return JSON.stringify({ ok: true, data: r })
  }
  return calls
}
function clearHost() { delete (globalThis as Record<string, unknown>)[HOST_INVOKE_KEY] }

describe('★#1097 ① 契约有启停（补真缺陷）', () => {
  it('LocalServiceAPI 声明了 startDiscovery(serviceType) / stopDiscovery()', () => {
    const src = fs.readFileSync(path.join(ROOT, 'packages/api/src/capability-types.ts'), 'utf8')
    expect(src).toMatch(/startDiscovery\(serviceType: string\): Promise<CapResult<void>>/)
    expect(src).toMatch(/stopDiscovery\(\): Promise<CapResult<void>>/)
  })

  it('wx 桥实现了 start/stop（静态：真的调了那两个 wx API）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'packages/api/src/capability-local-service-wx.ts'), 'utf8')
    expect(src).toContain('wx.startLocalServiceDiscovery')
    expect(src).toContain('wx.stopLocalServiceDiscovery')
  })
})

describe('★#1097 ② start 的参数校验与错误分档', () => {
  beforeEach(() => { resetLocalServiceSubscriptions(); clearHost() })
  afterEach(() => { resetLocalServiceSubscriptions(); clearHost() })

  it('空 serviceType ⇒ invalid-type（不静默成功）', async () => {
    installFakeHost(() => ({}))
    const api = createAppLocalService()()
    const r = await api.startDiscovery('')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('local-service.invalid-type')
  })

  it('宿主缺方法 ⇒ unsupported', async () => {
    installFakeHost(() => undefined)
    const api = createAppLocalService()()
    const r = await api.startDiscovery('_http._tcp')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('local-service.unsupported')
  })

  it('成功 ⇒ ok，且把 serviceType 原样传给宿主', async () => {
    const calls = installFakeHost(() => ({}))
    const api = createAppLocalService()()
    const r = await api.startDiscovery('_ipp._tcp')
    expect(r.ok).toBe(true)
    const start = calls.find((c) => c.method === APP_LOCAL_SERVICE_METHODS.start)!
    expect(start.args.serviceType).toBe('_ipp._tcp')
  })
})

describe('★#1097 ③ 事件分发（壳推 → 四个订阅）', () => {
  beforeEach(() => { resetLocalServiceSubscriptions(); clearHost() })
  afterEach(() => { resetLocalServiceSubscriptions(); clearHost() })

  it('onFound / onLost / onResolveFail / onDiscoveryStop 各自收到对应事件', async () => {
    installFakeHost(() => ({}))
    const api = createAppLocalService()()
    await api.startDiscovery('_http._tcp')
    const found: unknown[] = []
    const lost: unknown[] = []
    const failed: unknown[] = []
    let stopped = 0
    api.onFound((s) => found.push(s))
    api.onLost((s) => lost.push(s))
    api.onResolveFail((s) => failed.push(s))
    api.onDiscoveryStop(() => { stopped += 1 })

    dispatchLocalServicePush({ event: 'found', service: { serviceName: 'printer', serviceType: '_ipp._tcp', ip: '192.168.1.9', port: 631 } })
    dispatchLocalServicePush({ event: 'lost', service: { serviceName: 'printer', serviceType: '_ipp._tcp' } })
    dispatchLocalServicePush({ event: 'resolveFail', service: { serviceName: 'bad', serviceType: '_x._tcp' } })
    dispatchLocalServicePush({ event: 'stop' })

    expect(found).toEqual([{ serviceName: 'printer', serviceType: '_ipp._tcp', ip: '192.168.1.9', port: 631 }])
    expect(lost).toEqual([{ serviceName: 'printer', serviceType: '_ipp._tcp' }])
    expect(failed).toEqual([{ serviceName: 'bad', serviceType: '_x._tcp' }])
    expect(stopped).toBe(1)
  })

  it('取消订阅后不再收到', async () => {
    installFakeHost(() => ({}))
    const api = createAppLocalService()()
    const got: unknown[] = []
    const off = api.onFound((s) => got.push(s))
    dispatchLocalServicePush({ event: 'found', service: { serviceName: 'a', serviceType: '_t._tcp' } })
    off()
    dispatchLocalServicePush({ event: 'found', service: { serviceName: 'b', serviceType: '_t._tcp' } })
    expect(got).toHaveLength(1)
  })

  it('畸形载荷不抛、也不误分发', () => {
    expect(dispatchLocalServicePush(null)).toBe(0)
    expect(dispatchLocalServicePush({ event: 'nope' })).toBe(0)
    expect(dispatchLocalServicePush({ event: 'found' })).toBe(0)   // 缺 service
    expect(dispatchLocalServicePush({ event: 'found', service: { serviceName: 'x' } })).toBe(0)  // 缺 serviceType
  })

  it('ip / port 缺失时如实省略字段（不填假值）', async () => {
    installFakeHost(() => ({}))
    const api = createAppLocalService()()
    const got: Array<Record<string, unknown>> = []
    api.onFound((s) => got.push(s as unknown as Record<string, unknown>))
    dispatchLocalServicePush({ event: 'found', service: { serviceName: 'n', serviceType: '_t._tcp' } })
    expect(got[0]).toEqual({ serviceName: 'n', serviceType: '_t._tcp' })
    expect('ip' in got[0]).toBe(false)
    expect('port' in got[0]).toBe(false)
  })
})

describe('★#1097 ④ stop 幂等 + 资源账本', () => {
  beforeEach(() => { resetLocalServiceSubscriptions(); clearHost() })
  afterEach(() => { resetLocalServiceSubscriptions(); clearHost() })

  it('未 start 直接 stop ⇒ 成功（幂等）', async () => {
    installFakeHost(() => ({}))
    const api = createAppLocalService()()
    const r = await api.stopDiscovery()
    expect(r.ok).toBe(true)
  })

  it('start 登记 mdns-discovery；stop 销账', async () => {
    installFakeHost(() => ({}))
    const reg = createCapabilityResourceRegistry()
    const api = createAppLocalService({ resources: reg, owner: 'screen:scan' })()
    await api.startDiscovery('_http._tcp')
    expect(reg.countsByType()).toEqual({ 'mdns-discovery': 1 })
    await api.stopDiscovery()
    expect(reg.size(), 'stop 后账本应销账').toBe(0)
  })

  it('releaseAll 能兜底停搜索（页面离开场景）', async () => {
    const calls = installFakeHost(() => ({}))
    const reg = createCapabilityResourceRegistry()
    const api = createAppLocalService({ resources: reg })()
    await api.startDiscovery('_http._tcp')
    reg.releaseAll()
    expect(reg.size()).toBe(0)
    // ★释放钩子应真的向宿主发过 stop
    expect(calls.some((c) => c.method === APP_LOCAL_SERVICE_METHODS.stop)).toBe(true)
  })

  it('不传 resources ⇒ 零回归（不登记也不报错）', async () => {
    installFakeHost(() => ({}))
    const api = createAppLocalService()()
    expect((await api.startDiscovery('_http._tcp')).ok).toBe(true)
    expect(localServiceSubCount()).toBe(0)
  })
})
