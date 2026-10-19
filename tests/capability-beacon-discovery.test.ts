// tests/capability-beacon-discovery.test.ts
// ★★★决策 #1090（2026-10-19）：`useBeacon` 契约补齐 `startBeaconDiscovery` / `stopBeaconDiscovery`。
//
// 【为什么（#1084/#1085 连续两轮登记的欠账，本轮还）】
//   原 `BeaconAPI` **只有两个订阅**（`onServiceChange` / `onUpdate`）。而微信的 iBeacon 语义是：
//   **必须先 `wx.startBeaconDiscovery({ uuids })` 才会回调 `onBeaconUpdate`** ——
//   不搜索就订阅，上层**永远收不到任何更新**（错误码 11004 / 静默无回调）。
//   ⇒ 原契约对业务是**不可用**的：照着文档写完，运行起来什么都不会发生。
//   这比 #1085 的"空订阅"更隐蔽——这次连"启动"这一步都没暴露出来。
//
// 【判据】
//   ① 契约存在两个方法，且 `startBeaconDiscovery` **必填 uuids**（微信 API 也要求）；
//   ② 微信桥真实现：调用映射到 `wx.startBeaconDiscovery` / `wx.stopBeaconDiscovery`；
//   ③ 行为：缺 uuids ⇒ `beacon.invalid-uuids`；基础库无该方法 ⇒ `beacon.unsupported`；
//      成功 ⇒ `ok:true`；失败 ⇒ `beacon.failed` 且保留原始 cause；
//   ④ **诚实边界**：Web / App 三端没有 iBeacon 扫描 ⇒ 该能力在那些端仍走 `beacon.unsupported`
//      （不得因为"契约有了"就假装能用）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TYPES = fs.readFileSync(path.join(ROOT, 'packages/api/src/capability-types.ts'), 'utf8')
const BRIDGES = fs.readFileSync(path.join(ROOT, 'packages/api/src/capability-bridges.ts'), 'utf8')

describe('★#1090 ① 契约：BeaconAPI 有搜索开关', () => {
  it('两个方法都在，且 start 收 uuids', () => {
    // ★接口已单列到 capability-beacon.ts（capability-types.ts 只 re-export）
    const beacon = fs.readFileSync(path.join(ROOT, 'packages/api/src/capability-beacon.ts'), 'utf8')
    expect(beacon).toMatch(/startBeaconDiscovery\(uuids: string\[\]\): Promise<CapResult<void>>/)
    expect(beacon).toMatch(/stopBeaconDiscovery\(\): Promise<CapResult<void>>/)
  })
  it('capability-types.ts 仍对外 re-export（公共面不变）', () => {
    expect(TYPES).toContain("export type { BeaconInfo, BeaconAPI }")
  })
  it('WxLike 声明了微信对应 API', () => {
    expect(TYPES).toMatch(/startBeaconDiscovery\?: \(opt: \{ uuids: string\[\]/)
    expect(TYPES).toMatch(/stopBeaconDiscovery\?: \(opt\?/)
  })
})

describe('★#1090 ② 微信桥：映射到真实 wx API', () => {
  it('实现调用了 wx.startBeaconDiscovery / wx.stopBeaconDiscovery', () => {
    // ★实现已单列到 capability-beacon.ts（capability-bridges.ts 是 4000+ 行存量棘轮）
    const impl = fs.readFileSync(path.join(ROOT, 'packages/api/src/capability-beacon.ts'), 'utf8')
    expect(impl).toContain('wx.startBeaconDiscovery')
    expect(impl).toContain('wx.stopBeaconDiscovery')
  })
  it('capability-bridges.ts 里的 getBeacon 委托给单列实现', () => {
    expect(BRIDGES).toContain('getBeacon: () => createWxBeacon(wx)')
  })
})

// ── 行为验证：直接构造一个假 wx 调桥（不走 createCapabilityBridge 的运行时探测）──
async function loadWxBridgeWith(wx: Record<string, unknown>) {
  const mod = await import('../packages/api/src/capability-bridges.ts')
  return mod.wxBridge(wx as never)
}

describe('★#1090 ③ 行为：四种路径', () => {
  it('缺 uuids ⇒ beacon.invalid-uuids（不是静默成功）', async () => {
    const bridge = await loadWxBridgeWith({ startBeaconDiscovery: () => {} })
    const api = bridge.getBeacon!()
    const r = await api.startBeaconDiscovery([])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('beacon.invalid-uuids')
  })
  it('基础库无该方法 ⇒ beacon.unsupported', async () => {
    const bridge = await loadWxBridgeWith({})
    const api = bridge.getBeacon!()
    const r = await api.startBeaconDiscovery(['xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('beacon.unsupported')
    const s = await api.stopBeaconDiscovery()
    expect(s.ok).toBe(false)
    if (!s.ok) expect(s.error.code).toBe('beacon.unsupported')
  })
  it('成功 ⇒ ok:true，且把 uuids 原样传给微信', async () => {
    const seen: string[][] = []
    const bridge = await loadWxBridgeWith({
      startBeaconDiscovery: (opt: { uuids: string[]; success: () => void }) => { seen.push(opt.uuids); opt.success() },
    })
    const uuids = ['fd-a5-06-93-./-..'.replace(/[^0-9a-f-]/g, ''), '00000000-0000-0000-0000-000000000000']
    const r = await bridge.getBeacon!().startBeaconDiscovery(uuids)
    expect(r.ok).toBe(true)
    expect(seen[0]).toEqual(uuids)
  })
  it('失败 ⇒ beacon.failed 且带 cause（11004 等错误可被业务读到）', async () => {
    const cause = { errCode: 11004, errMsg: 'not authorized' }
    const bridge = await loadWxBridgeWith({
      startBeaconDiscovery: (opt: { fail: (e: unknown) => void }) => opt.fail(cause),
    })
    const r = await bridge.getBeacon!().startBeaconDiscovery(['x'])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('beacon.failed')
      expect((r.error as unknown as { cause?: unknown }).cause).toBe(cause)
    }
  })
})

describe('★#1090 ④ 诚实边界：Web 端不得凭空可用', () => {
  it('webBridge 未提供 getBeacon（#1085 已删；本能力在 Web 无对等）', () => {
    const start = BRIDGES.indexOf('export function webBridge(')
    const seg = BRIDGES.slice(start)
    expect(seg.includes('getBeacon:'), 'Web 桥又提供了 getBeacon——iBeacon 在 Web 无标准扫描，应保持 unsupported').toBe(false)
  })
})
