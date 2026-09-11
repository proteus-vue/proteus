// tests/capability-skyline.test.ts
// ★Skyline 线收口批 3：能力桥选择守卫（web 模拟层 wx 不误选）+ wx 桥诚实降级（缺失→Err，不假成功）
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createCapabilityBridge, createCapabilityHooks } from '@proteus-vue/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 真·小程序环境（window 缺席 + wx） */
function stubMp(wx: Record<string, unknown>) {
  vi.stubGlobal('window', undefined)
  vi.stubGlobal('wx', wx)
}

describe('createCapabilityBridge 选择守卫', () => {
  it('真·小程序（window 缺席 + wx）→ wx 桥（raw Promise resolve）', async () => {
    let called = false
    stubMp({ getSystemInfoSync: () => ({ renderer: 'skyline' }), setClipboardData: (o: { success?: () => void }) => { called = true; if (o.success) o.success() } })
    const bridge = createCapabilityBridge()
    await expect(bridge.setClipboard('hi')).resolves.toBeUndefined()
    expect(called).toBe(true) // 确认走的是 wx.setClipboardData
  })

  it('★Web（window 存在 + wx 模拟层）→ web 桥（不误选窄 wx 桥）', async () => {
    let wxCalled = false
    vi.stubGlobal('window', {})
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }), setClipboardData: () => { wxCalled = true } })
    const bridge = createCapabilityBridge()
    // web 桥用 navigator.clipboard（此环境无）→ reject，且未调用 wx.setClipboardData
    await expect(bridge.setClipboard('hi')).rejects.toMatchObject({ code: 'clipboard.write.unsupported' })
    expect(wxCalled).toBe(false)
  })
})

describe('wx 桥诚实降级（缺失能力 → 显式错误，不虚构）', () => {
  it('getNetwork：wx.getNetworkType 缺失 → Err（原实现谎报 online:true）', async () => {
    stubMp({ getSystemInfoSync: () => ({ renderer: 'skyline' }) }) // 无 getNetworkType
    const hooks = createCapabilityHooks(createCapabilityBridge())
    const r = await hooks.useNetwork()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('network.unsupported')
  })

  it('getNetwork：有 wx.getNetworkType → ok（网络类型归一）', async () => {
    stubMp({
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      getNetworkType: (o: { success: (r: { networkType: string }) => void }) => o.success({ networkType: 'wifi' }),
    })
    const hooks = createCapabilityHooks(createCapabilityBridge())
    const r = await hooks.useNetwork()
    expect(r.ok && r.data.type).toBe('wifi')
  })

  it('getOrientation：onDeviceOrientationChange 缺失 → Err（原实现谎报 portrait）', async () => {
    stubMp({ getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    const hooks = createCapabilityHooks(createCapabilityBridge())
    const r = await hooks.useOrientation()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('orientation.unsupported')
  })

  it('getBluetooth：openBluetoothAdapter 失败 → Err（原实现谎报 supported:true）', async () => {
    stubMp({
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      openBluetoothAdapter: (o: { fail?: (e: unknown) => void }) => o.fail && o.fail({ errMsg: 'openAdapter:fail' }),
    })
    const hooks = createCapabilityHooks(createCapabilityBridge())
    const r = await hooks.useBluetooth()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('bluetooth.unavailable')
  })
})
